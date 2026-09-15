import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { CatalogItem, Furniture, Opening, Room } from '../types';
import { buildPiece, disposeGroup } from './furniture';
import { surfaceMaterial } from './textures';
import { EYE_HEIGHT, Player, type Blocker } from './player';

export type ViewMode = 'orbit' | 'walk';

export interface SceneCallbacks {
  onSelect?: (furnitureId: string | null) => void;
  /** Fired continuously while dragging, then once on release with commit=true. */
  onMove?: (furnitureId: string, xCm: number, yCm: number, commit: boolean) => void;
  /** The piece under the crosshair in walk mode, for the on-screen readout. */
  onLookAt?: (furnitureId: string | null) => void;
  /** Whether the pointer is locked, so the UI can show or hide its prompt. */
  onPointerLock?: (locked: boolean) => void;
}

const WALL_THICKNESS = 0.12;

/**
 * The 3D view.
 *
 * Two modes over one scene. Orbit is the planning view: walls between you and
 * the room are culled so you can look down into it and drag furniture around.
 * Walk is the game view: pointer-locked first-person, collision against walls
 * and furniture, a ceiling overhead and daylight coming through the windows.
 *
 * Kept as a plain class rather than a React component tree — the scene has to
 * survive re-renders mid-drag, and owning the render loop is what keeps both
 * dragging and walking smooth.
 */
export class SceneManager {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  private shell = new THREE.Group();
  private furnitureRoot = new THREE.Group();
  private selectionBox: THREE.LineSegments | null = null;
  private pieces = new Map<string, THREE.Group>();

  private mode: ViewMode = 'orbit';
  private selectedId: string | null = null;
  private dragging: { id: string; offset: THREE.Vector3 } | null = null;
  private frame = 0;
  private disposed = false;

  private player = new Player();
  private lookingAt: string | null = null;
  private lookRay = new THREE.Raycaster();
  private screenCentre = new THREE.Vector2(0, 0);
  private sun!: THREE.DirectionalLight;
  private sky!: THREE.HemisphereLight;
  private ceiling: THREE.Mesh | null = null;
  /** Window panes, dimmed with the sun so they do not glow at midnight. */
  private glazing: THREE.MeshBasicMaterial[] = [];
  private timeOfDay = 15;
  private roomCentre = new THREE.Vector3(0, EYE_HEIGHT, 0);
  private clock = new THREE.Clock();

  constructor(private canvas: HTMLCanvasElement, private callbacks: SceneCallbacks = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    this.scene.background = new THREE.Color('#E6E1D8');

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.05, 200);
    this.camera.position.set(5, 4.5, 6);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;   // never drop below the floor
    this.controls.minDistance = 1;
    this.controls.maxDistance = 30;

    this.addLighting();
    this.scene.add(this.shell, this.furnitureRoot);

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);

    this.animate();
  }

  // --- Lighting ------------------------------------------------------------

  private addLighting() {
    // Sky and bounce. Warm from above, cooler from the floor bounce, which is
    // roughly what a room with daylight and warm lamps actually does.
    this.sky = new THREE.HemisphereLight('#FFF2DC', '#6B6455', 0.85);
    this.scene.add(this.sky);

    this.sun = new THREE.DirectionalLight('#FFE2B8', 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 0.5;
    this.sun.shadow.camera.far = 42;
    const s = 11;
    Object.assign(this.sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0007;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);

    this.applyTimeOfDay();
  }

  /**
   * Move the sun and retint everything for the hour.
   *
   * Worth having beyond the novelty: a palette that sings at 3pm can go grey by
   * evening, and north-facing rooms never get direct sun at all. Being able to
   * scrub the day is how you find that out before you buy the paint.
   */
  setTimeOfDay(hour: number) {
    this.timeOfDay = THREE.MathUtils.clamp(hour, 5, 23);
    this.applyTimeOfDay();
  }

  getTimeOfDay() {
    return this.timeOfDay;
  }

  private applyTimeOfDay() {
    // Map 6am-8pm onto a sun arc; outside that the sun is down.
    const t = (this.timeOfDay - 6) / 14;
    const elevation = Math.sin(THREE.MathUtils.clamp(t, 0, 1) * Math.PI);
    const azimuth = (t - 0.5) * Math.PI * 1.4;
    const daylight = Math.max(0, elevation);

    const radius = 16;
    this.sun.position.set(
      this.roomCentre.x + Math.sin(azimuth) * radius,
      1.5 + elevation * 15,
      this.roomCentre.z - Math.cos(azimuth) * radius * 0.6,
    );
    this.sun.target.position.copy(this.roomCentre).setY(0);
    this.sun.target.updateMatrixWorld();

    // Warm and low at the ends of the day, neutral at noon.
    const warmth = 1 - daylight;
    this.sun.color.setRGB(1, 0.94 - warmth * 0.2, 0.82 - warmth * 0.34);
    this.sun.intensity = daylight * 3.1;

    this.sky.intensity = 0.24 + daylight * 0.8;
    this.sky.color.setRGB(1, 0.95 - warmth * 0.1, 0.88 - warmth * 0.16);

    // After dark the room is lit by its lamps, so the ambient drops away and
    // the background goes to evening blue rather than daylight grey.
    const night = 1 - daylight;
    const bg = new THREE.Color().setRGB(
      0.9 - night * 0.76,
      0.88 - night * 0.73,
      0.85 - night * 0.63,
    );
    this.scene.background = bg;
    this.renderer.toneMappingExposure = 1.1 + night * 0.35;

    // What you see through the glass is the sky, so it tracks the same curve.
    for (const pane of this.glazing) {
      pane.color.copy(bg).lerp(new THREE.Color('#FFFFFF'), 0.25 + daylight * 0.75);
    }
  }

  // --- Room construction ---------------------------------------------------

  /** Rebuild the room shell and everything in it. */
  setRoom(room: Room, catalog: Map<string, CatalogItem>) {
    this.clearGroup(this.shell);
    this.clearGroup(this.furnitureRoot);
    this.pieces.clear();
    this.selectionBox = null;
    this.ceiling = null;
    this.glazing = [];

    const poly = room.polygon.map((p) => new THREE.Vector2(p.x / 100, p.y / 100));
    const height = room.heightCm / 100;

    const bounds = new THREE.Box2().setFromPoints(poly);
    const span = Math.max(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, 2);

    // Floor from the actual outline, so L-shaped rooms come through correctly.
    const floor = new THREE.Mesh(
      new THREE.ShapeGeometry(new THREE.Shape(poly)),
      surfaceMaterial({
        color: room.floorColor || '#C4A77D',
        kind: 'floorboards',
        // Tile by real size so the boards stay the same width in any room.
        repeat: Math.max(1, Math.round(span / 1.6)),
        roughness: 0.55,
        doubleSide: true,
      }),
    );
    // +PI/2, not -PI/2: plan-y has to land on world +z, which is where the
    // walls and the furniture both put it.
    floor.rotation.x = Math.PI / 2;
    floor.receiveShadow = true;
    floor.userData = { kind: 'floor' };
    this.shell.add(floor);

    // Ceiling. Hidden while orbiting (you are looking down into the room) and
    // shown while walking, where an open sky overhead breaks the illusion.
    const ceiling = new THREE.Mesh(
      new THREE.ShapeGeometry(new THREE.Shape(poly)),
      surfaceMaterial({ color: '#F6F2EA', kind: 'plaster', repeat: 3, roughness: 0.96, doubleSide: true }),
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = height;
    ceiling.receiveShadow = true;
    ceiling.visible = false;
    ceiling.userData = { kind: 'ceiling' };
    this.ceiling = ceiling;
    this.shell.add(ceiling);

    const wallMaterial = surfaceMaterial({
      color: room.wallColor || '#EDE6D8',
      kind: 'plaster',
      repeat: Math.max(2, Math.round(span / 1.2)),
      roughness: 0.96,
      doubleSide: true,
    });

    const openings = room.openings ?? [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      this.shell.add(this.buildWall(a, b, i, height, openings, wallMaterial, poly));
      this.addGlazing(a, b, i, openings);
    }

    for (const piece of room.furniture ?? []) {
      this.addPiece(piece, catalog.get(piece.catalogKey ?? '') ?? null);
    }

    const cx = poly.reduce((sum, p) => sum + p.x, 0) / poly.length;
    const cz = poly.reduce((sum, p) => sum + p.y, 0) / poly.length;
    this.roomCentre.set(cx, EYE_HEIGHT, cz);

    this.applyTimeOfDay();
    this.rebuildBlockers();
    this.frameRoom(room);
  }

  /**
   * One wall, extruded from a 2D shape with rectangular holes punched for each
   * door and window — the openings are real geometry, not painted on, so you
   * can see through them and they export correctly.
   */
  private buildWall(
    a: THREE.Vector2, b: THREE.Vector2, index: number, height: number,
    openings: Opening[], material: THREE.Material, poly: THREE.Vector2[],
  ): THREE.Mesh {
    const length = a.distanceTo(b);
    const shape = new THREE.Shape([
      new THREE.Vector2(0, 0),
      new THREE.Vector2(length, 0),
      new THREE.Vector2(length, height),
      new THREE.Vector2(0, height),
    ]);

    for (const o of openings.filter((x) => x.wallIndex === index)) {
      const x0 = Math.max(0.02, o.offsetCm / 100);
      const w = Math.min(o.widthCm / 100, length - x0 - 0.02);
      const y0 = Math.max(0.005, o.sillCm / 100);
      const h = Math.min(o.heightCm / 100, height - y0 - 0.02);
      if (w <= 0.05 || h <= 0.05) continue;
      shape.holes.push(new THREE.Path([
        new THREE.Vector2(x0, y0),
        new THREE.Vector2(x0 + w, y0),
        new THREE.Vector2(x0 + w, y0 + h),
        new THREE.Vector2(x0, y0 + h),
      ]));
    }

    const geometry = new THREE.ExtrudeGeometry(shape, { depth: WALL_THICKNESS, bevelEnabled: false });
    const mesh = new THREE.Mesh(geometry, material);

    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    mesh.rotation.order = 'YXZ';
    mesh.rotation.y = -angle;
    mesh.position.set(a.x, 0, a.y);

    // Where the thickness actually goes: local +z after a -angle turn about Y.
    const extrude = new THREE.Vector2(-Math.sin(angle), Math.cos(angle));
    const centre = poly.reduce((acc, p) => acc.add(p), new THREE.Vector2()).divideScalar(poly.length);
    const mid = new THREE.Vector2((a.x + b.x) / 2, (a.y + b.y) / 2);
    const toCentre = centre.clone().sub(mid);

    // If the extrusion runs into the room it would eat 12 cm off the floor the
    // user measured, so shift the wall out by its own thickness instead.
    if (extrude.dot(toCentre) > 0) {
      mesh.position.add(new THREE.Vector3(-extrude.x * WALL_THICKNESS, 0, -extrude.y * WALL_THICKNESS));
    }

    const inward = toCentre.clone().normalize();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = {
      kind: 'wall',
      wallIndex: index,
      inward: new THREE.Vector3(inward.x, 0, inward.y),
      mid: new THREE.Vector3(mid.x, 0, mid.y),
    };
    return mesh;
  }

  /**
   * A bright panel filling each window.
   *
   * Without it a window is a hole onto the background colour, which reads as a
   * gap in the wall rather than as glass with daylight behind it.
   */
  private addGlazing(a: THREE.Vector2, b: THREE.Vector2, index: number, openings: Opening[]) {
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const length = a.distanceTo(b);

    for (const o of openings.filter((x) => x.wallIndex === index && x.kind === 'window')) {
      const w = o.widthCm / 100;
      const h = o.heightCm / 100;
      if (w <= 0.05 || h <= 0.05) continue;
      const along = (o.offsetCm / 100 + w / 2) / (length || 1);

      const pane = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color: '#FFFFFF', side: THREE.DoubleSide, toneMapped: false }),
      );
      this.glazing.push(pane.material as THREE.MeshBasicMaterial);
      pane.position.set(
        a.x + (b.x - a.x) * along,
        o.sillCm / 100 + h / 2,
        a.y + (b.y - a.y) * along,
      );
      // A plane's local +x must run along the wall. Local +x under rotation.y
      // is (cos, 0, -sin), and the wall runs at (cos angle, 0, sin angle), so
      // the rotation is -angle. Adding a quarter turn stood them across the
      // room instead of filling the opening.
      pane.rotation.y = -angle;
      pane.userData = { kind: 'glazing', wallIndex: index };
      this.shell.add(pane);
    }
  }

  private addPiece(piece: Furniture, item: CatalogItem | null) {
    const { group, isLight } = buildPiece(piece, item);
    if (isLight) {
      // A real point light, so lamps light the room they stand in and the
      // evening hours have something to be lit by.
      const lamp = new THREE.PointLight('#FFCF92', 9, 7, 2);
      lamp.position.set(0, Math.max(0.3, piece.heightCm / 100 - 0.2), 0);
      lamp.castShadow = true;
      lamp.shadow.mapSize.set(512, 512);
      lamp.shadow.bias = -0.004;
      group.add(lamp);
    }
    this.furnitureRoot.add(group);
    this.pieces.set(piece.id, group);
  }

  /**
   * Collect the boxes the player collides with.
   *
   * Rugs and anything overhead are skipped — you walk over a rug and under a
   * pendant, and being stopped by either would feel broken.
   */
  private rebuildBlockers() {
    const blockers: Blocker[] = [];
    const box = new THREE.Box3();

    for (const child of this.shell.children) {
      if (child.userData?.kind !== 'wall') continue;
      blockers.push({ box: new THREE.Box3().setFromObject(child), label: 'wall' });
    }

    for (const [id, group] of this.pieces) {
      box.setFromObject(group);
      const height = box.max.y - box.min.y;
      // Low enough to step over, or high enough to duck under: not a blocker.
      if (box.max.y < 0.22 || box.min.y > 1.75 || height < 0.15) continue;
      blockers.push({ box: box.clone(), label: id });
    }

    this.player.setBlockers(blockers);
  }

  /** Update one piece in place without rebuilding the room. */
  updatePiece(piece: Furniture, item: CatalogItem | null) {
    const existing = this.pieces.get(piece.id);
    if (existing) {
      this.furnitureRoot.remove(existing);
      disposeGroup(existing);
    }
    this.addPiece(piece, item);
    if (this.selectedId === piece.id) this.setSelection(piece.id);
    this.rebuildBlockers();
  }

  removePiece(id: string) {
    const existing = this.pieces.get(id);
    if (!existing) return;
    this.furnitureRoot.remove(existing);
    disposeGroup(existing);
    this.pieces.delete(id);
    if (this.selectedId === id) this.setSelection(null);
    this.rebuildBlockers();
  }

  setSelection(id: string | null) {
    this.selectedId = id;
    if (this.selectionBox) {
      this.scene.remove(this.selectionBox);
      this.selectionBox.geometry.dispose();
      this.selectionBox = null;
    }
    const group = id ? this.pieces.get(id) : null;
    if (!group) return;

    const bounds = new THREE.Box3().setFromObject(group);
    const helper = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(
        Math.max(bounds.max.x - bounds.min.x, 0.05),
        Math.max(bounds.max.y - bounds.min.y, 0.05),
        Math.max(bounds.max.z - bounds.min.z, 0.05),
      )),
      new THREE.LineBasicMaterial({ color: '#D94F30', depthTest: false }),
    );
    bounds.getCenter(helper.position);
    helper.renderOrder = 999;
    this.selectionBox = helper;
    this.scene.add(helper);
  }

  // --- Modes ---------------------------------------------------------------

  setMode(mode: ViewMode) {
    this.mode = mode;
    this.controls.enabled = mode === 'orbit';
    if (this.ceiling) this.ceiling.visible = mode === 'walk';

    if (mode === 'walk') {
      // Start standing in the middle of the room, facing the way you were
      // already looking.
      const dir = this.camera.position.clone().sub(this.controls.target);
      this.player.place(this.roomCentre.x, this.roomCentre.z, Math.atan2(dir.x, dir.z) + Math.PI);
      this.setSelection(null);
      this.rebuildBlockers();
    } else {
      this.exitPointerLock();
      this.camera.fov = 55;
      this.camera.updateProjectionMatrix();
      this.camera.rotation.set(0, 0, 0);
      this.controls.target.set(this.roomCentre.x, 0.8, this.roomCentre.z);
      this.callbacks.onLookAt?.(null);
    }
  }

  getMode() {
    return this.mode;
  }

  /** Ask the browser for pointer lock. Must be called from a user gesture. */
  requestPointerLock() {
    if (this.mode !== 'walk') return;
    this.canvas.requestPointerLock();
  }

  exitPointerLock() {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  private onPointerLockChange = () => {
    const locked = document.pointerLockElement === this.canvas;
    this.player.setActive(locked);
    this.callbacks.onPointerLock?.(locked);
    if (!locked) this.callbacks.onLookAt?.(null);
  };

  /** Frame the whole room in view. */
  frameRoom(room: Room) {
    const xs = room.polygon.map((p) => p.x / 100);
    const ys = room.polygon.map((p) => p.y / 100);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cz = (Math.min(...ys) + Math.max(...ys)) / 2;
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 2);
    this.controls.target.set(cx, 0.8, cz);
    this.camera.position.set(cx + span * 0.85, span * 0.85 + 1.4, cz + span * 1.05);
    this.controls.update();
  }

  // --- Pointer and keyboard ------------------------------------------------

  private updatePointer(event: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  /** Walk up from a hit mesh to the furniture group that owns it. */
  private ownerOf(object: THREE.Object3D): THREE.Group | null {
    let node: THREE.Object3D | null = object;
    while (node) {
      if (node.userData?.kind === 'furniture') return node as THREE.Group;
      node = node.parent;
    }
    return null;
  }

  private onPointerDown = (event: PointerEvent) => {
    if (this.mode === 'walk') {
      // Clicking the view is how you take control; the browser requires the
      // request to come from a gesture like this one.
      if (!this.player.isActive()) this.requestPointerLock();
      return;
    }
    if (event.button !== 0) return;

    this.updatePointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.furnitureRoot.children, true);
    const owner = hits.length ? this.ownerOf(hits[0].object) : null;

    if (!owner) {
      this.setSelection(null);
      this.callbacks.onSelect?.(null);
      return;
    }

    const id = owner.userData.furnitureId as string;
    this.setSelection(id);
    this.callbacks.onSelect?.(id);

    // Grab from where the pointer met the floor, so the piece does not jump.
    const groundHit = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.floorPlane, groundHit)) {
      this.dragging = { id, offset: owner.position.clone().sub(groundHit).setY(0) };
      this.controls.enabled = false;
      this.canvas.setPointerCapture(event.pointerId);
    }
  };

  private onPointerMove = (event: PointerEvent) => {
    if (this.mode === 'walk') {
      // Pointer lock delivers relative motion, which is what mouse look needs.
      if (this.player.isActive()) this.player.look(event.movementX, event.movementY);
      return;
    }
    if (!this.dragging) return;

    this.updatePointer(event);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const groundHit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.floorPlane, groundHit)) return;

    const group = this.pieces.get(this.dragging.id);
    if (!group) return;
    const next = groundHit.add(this.dragging.offset);
    group.position.x = next.x;
    group.position.z = next.z;
    if (this.selectedId === this.dragging.id) this.setSelection(this.dragging.id);
    this.callbacks.onMove?.(this.dragging.id, next.x * 100, next.z * 100, false);
  };

  private onPointerUp = (event: PointerEvent) => {
    if (!this.dragging) return;
    const group = this.pieces.get(this.dragging.id);
    if (group) this.callbacks.onMove?.(this.dragging.id, group.position.x * 100, group.position.z * 100, true);
    this.dragging = null;
    if (this.mode === 'orbit') this.controls.enabled = true;
    this.rebuildBlockers();
    try { this.canvas.releasePointerCapture(event.pointerId); } catch { /* not captured */ }
  };

  private onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    // Never swallow keys meant for a text field.
    if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
    if (event.code === 'Escape' && this.player.isActive()) {
      // Chrome releases the pointer on Escape by itself, but not every
      // browser or embedded view does, and being stuck looking around with
      // no way out is the worst possible failure here.
      this.exitPointerLock();
      return;
    }
    if (this.mode !== 'walk' || !this.player.isActive()) return;
    // The movement keys would otherwise scroll the page underneath.
    if (event.code.startsWith('Arrow') || event.code === 'Space') event.preventDefault();
    this.player.onKeyDown(event);
  };

  private onKeyUp = (event: KeyboardEvent) => this.player.onKeyUp(event);

  // --- Render loop ---------------------------------------------------------

  /**
   * Hide whichever walls stand between the camera and the room.
   *
   * Without this an orbit view just shows the outside of a closed box. Culling
   * by whether the camera is on a wall's outward side is what every interior
   * planner does, and it means the room opens up as you orbit around it.
   * In walk mode you are inside, so every wall stays up.
   */
  private cullWalls() {
    const inWalk = this.mode === 'walk';
    const wallVisible = new Map<number, boolean>();

    for (const child of this.shell.children) {
      const data = child.userData;
      if (data?.kind !== 'wall') continue;
      const visible = inWalk ||
        (data.inward as THREE.Vector3).dot(this.camera.position.clone().sub(data.mid as THREE.Vector3)) > 0;
      child.visible = visible;
      wallVisible.set(data.wallIndex as number, visible);
    }

    // Glazing belongs to its wall. Left to itself it stayed visible after the
    // wall was culled, leaving bright panes hanging in mid-air.
    for (const child of this.shell.children) {
      if (child.userData?.kind !== 'glazing') continue;
      child.visible = wallVisible.get(child.userData.wallIndex as number) ?? true;
    }
  }

  /** What the crosshair is pointing at, reported no more than once per change. */
  private updateLookAt() {
    if (this.mode !== 'walk' || !this.player.isActive()) return;
    this.lookRay.setFromCamera(this.screenCentre, this.camera);
    this.lookRay.far = 4.5;
    const hits = this.lookRay.intersectObjects(this.furnitureRoot.children, true);
    const owner = hits.length ? this.ownerOf(hits[0].object) : null;
    const id = (owner?.userData.furnitureId as string) ?? null;
    if (id !== this.lookingAt) {
      this.lookingAt = id;
      this.callbacks.onLookAt?.(id);
    }
  }

  private animate = () => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.animate);
    const delta = Math.min(this.clock.getDelta(), 0.1);
    if (this.mode === 'walk') {
      this.player.update(delta, this.camera);
      this.updateLookAt();
    } else {
      this.controls.update();
    }
    this.cullWalls();
    this.renderer.render(this.scene, this.camera);
  };

  resize(width: number, height: number) {
    if (width < 2 || height < 2) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  /**
   * Export the room as binary glTF.
   *
   * The selection outline, the helper lights and the glazing panels are
   * stripped first so the file contains only the apartment — drag the result
   * straight into Blender.
   */
  async exportGLB(): Promise<Blob> {
    const wasSelected = this.selectedId;
    this.setSelection(null);

    // Restore everything the on-screen cull hid; it must not reach the export.
    for (const child of this.shell.children) child.visible = true;
    const ceilingWasVisible = this.ceiling?.visible ?? false;

    const scene = new THREE.Scene();
    scene.add(this.shell.clone(true), this.furnitureRoot.clone(true));

    // Collect first, remove after. three's traverse walks `children` by index,
    // so removing a node mid-walk shifts the array under it and the traversal
    // steps off the end into undefined.
    const strip: THREE.Object3D[] = [];
    scene.traverse((node) => {
      if ((node as THREE.Light).isLight || node.userData?.kind === 'glazing') strip.push(node);
    });
    for (const node of strip) node.parent?.remove(node);

    const exporter = new GLTFExporter();
    const result = await exporter.parseAsync(scene, { binary: true, onlyVisible: false });

    if (this.ceiling) this.ceiling.visible = ceilingWasVisible;
    if (wasSelected) this.setSelection(wasSelected);
    return new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' });
  }

  private clearGroup(group: THREE.Group) {
    for (const child of [...group.children]) {
      group.remove(child);
      disposeGroup(child);
    }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.exitPointerLock();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.clearGroup(this.shell);
    this.clearGroup(this.furnitureRoot);
    this.controls.dispose();
    this.renderer.dispose();
  }
}
