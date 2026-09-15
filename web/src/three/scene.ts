import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { CatalogItem, Furniture, Opening, Room } from '../types';
import { buildPiece, disposeGroup } from './furniture';

export type ViewMode = 'orbit' | 'walk';

export interface SceneCallbacks {
  onSelect?: (furnitureId: string | null) => void;
  /** Fired continuously while dragging, then once on release with commit=true. */
  onMove?: (furnitureId: string, xCm: number, yCm: number, commit: boolean) => void;
}

const WALL_THICKNESS = 0.12;

/**
 * The 3D view.
 *
 * Kept as a plain class rather than a React component tree: the scene is
 * rebuilt wholesale when the room changes but must survive React re-renders
 * during a drag, and imperative control over the render loop is what keeps
 * dragging smooth.
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
  /** Room centre at eye level, used as the entry point for walk mode. */
  private roomCentre = new THREE.Vector3(0, 1.62, 0);
  private selectionBox: THREE.LineSegments | null = null;
  private pieces = new Map<string, THREE.Group>();

  private mode: ViewMode = 'orbit';
  private selectedId: string | null = null;
  private dragging: { id: string; offset: THREE.Vector3 } | null = null;
  private frame = 0;
  private disposed = false;

  private keys = new Set<string>();
  private walkYaw = 0;
  private walkPitch = 0;
  private looking = false;
  private lastLook = { x: 0, y: 0 };
  private clock = new THREE.Clock();

  constructor(private canvas: HTMLCanvasElement, private callbacks: SceneCallbacks = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene.background = new THREE.Color('#E6E1D8');
    this.scene.fog = new THREE.Fog('#E6E1D8', 18, 46);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 200);
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

    this.animate();
  }

  private addLighting() {
    // Warm key + cool fill: the 2700K-plus-daylight mix the whole palette is
    // designed around. A single white light makes every wood tone read grey.
    const hemi = new THREE.HemisphereLight('#FFF3E0', '#6E6A5F', 1.15);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight('#FFE6C0', 2.0);
    key.position.set(6, 9, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 40;
    const s = 12;
    Object.assign(key.shadow.camera, { left: -s, right: s, top: s, bottom: -s });
    key.shadow.camera.updateProjectionMatrix();
    key.shadow.bias = -0.0008;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight('#CFE0F0', 0.45);
    fill.position.set(-7, 5, -4);
    this.scene.add(fill);
  }

  /** Rebuild the room shell and everything in it. */
  setRoom(room: Room, catalog: Map<string, CatalogItem>) {
    this.clearGroup(this.shell);
    this.clearGroup(this.furnitureRoot);
    this.pieces.clear();
    this.selectionBox = null;

    const poly = room.polygon.map((p) => new THREE.Vector2(p.x / 100, p.y / 100));
    const height = room.heightCm / 100;

    // Floor from the actual outline, so L-shaped rooms come through correctly.
    const floorShape = new THREE.Shape(poly);
    const floor = new THREE.Mesh(
      new THREE.ShapeGeometry(floorShape),
      // Double-sided because rotating the shape into the floor plane the way
      // round that matches the walls also flips its winding.
      new THREE.MeshStandardMaterial({ color: room.floorColor || '#C4A77D', roughness: 0.72, side: THREE.DoubleSide }),
    );
    // +PI/2, not -PI/2: plan-y has to land on world +z, which is where the
    // walls and the furniture both put it. The other way round mirrors the
    // floor to the far side of the room.
    floor.rotation.x = Math.PI / 2;
    floor.receiveShadow = true;
    floor.userData = { kind: 'floor' };
    this.shell.add(floor);

    const wallMaterial = new THREE.MeshStandardMaterial({
      color: room.wallColor || '#EDE6D8',
      roughness: 0.94,
      side: THREE.DoubleSide,
    });

    const openings = room.openings ?? [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      this.shell.add(this.buildWall(a, b, i, height, openings, wallMaterial, poly));
    }

    for (const piece of room.furniture ?? []) {
      this.addPiece(piece, catalog.get(piece.catalogKey ?? '') ?? null);
    }

    const cx = room.polygon.reduce((s, p) => s + p.x, 0) / room.polygon.length / 100;
    const cz = room.polygon.reduce((s, p) => s + p.y, 0) / room.polygon.length / 100;
    this.roomCentre.set(cx, 1.62, cz);

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

    // The inward normal, kept for the camera-facing cull in the render loop.
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

  private addPiece(piece: Furniture, item: CatalogItem | null) {
    const { group, isLight } = buildPiece(piece, item);
    if (isLight) {
      // A real point light so lamps actually light the room they are placed in.
      const lamp = new THREE.PointLight('#FFD9A0', 5.5, 6.5, 2);
      lamp.position.set(0, Math.max(0.3, piece.heightCm / 100 - 0.2), 0);
      group.add(lamp);
    }
    this.furnitureRoot.add(group);
    this.pieces.set(piece.id, group);
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
  }

  removePiece(id: string) {
    const existing = this.pieces.get(id);
    if (!existing) return;
    this.furnitureRoot.remove(existing);
    disposeGroup(existing);
    this.pieces.delete(id);
    if (this.selectedId === id) this.setSelection(null);
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

  setMode(mode: ViewMode) {
    this.mode = mode;
    this.controls.enabled = mode === 'orbit';
    if (mode === 'walk') {
      // Enter standing in the middle of the room at eye level, facing the way
      // you were already looking. Dropping in at the orbit camera's position
      // often put you outside the walls.
      const dir = this.camera.position.clone().sub(this.controls.target);
      this.camera.position.copy(this.roomCentre);
      this.walkYaw = Math.atan2(dir.x, dir.z) + Math.PI;
      this.walkPitch = 0;
      this.applyWalkRotation();
    } else {
      this.controls.target.set(this.camera.position.x, 0, this.camera.position.z - 2);
    }
  }

  getMode() { return this.mode; }

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
      this.looking = true;
      this.lastLook = { x: event.clientX, y: event.clientY };
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
    if (this.mode === 'walk' && this.looking) {
      const dx = event.clientX - this.lastLook.x;
      const dy = event.clientY - this.lastLook.y;
      this.lastLook = { x: event.clientX, y: event.clientY };
      this.walkYaw -= dx * 0.004;
      this.walkPitch = Math.max(-1.2, Math.min(1.2, this.walkPitch - dy * 0.004));
      this.applyWalkRotation();
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
    this.looking = false;
    if (!this.dragging) return;
    const group = this.pieces.get(this.dragging.id);
    if (group) this.callbacks.onMove?.(this.dragging.id, group.position.x * 100, group.position.z * 100, true);
    this.dragging = null;
    if (this.mode === 'orbit') this.controls.enabled = true;
    try { this.canvas.releasePointerCapture(event.pointerId); } catch { /* not captured */ }
  };

  private onKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    // Never swallow keys meant for a text field.
    if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
    this.keys.add(event.key.toLowerCase());
  };

  private onKeyUp = (event: KeyboardEvent) => this.keys.delete(event.key.toLowerCase());

  private applyWalkRotation() {
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.walkPitch, this.walkYaw, 0);
  }

  private stepWalk(delta: number) {
    const speed = (this.keys.has('shift') ? 3.2 : 1.5) * delta;
    const forward = new THREE.Vector3(-Math.sin(this.walkYaw), 0, -Math.cos(this.walkYaw));
    const right = new THREE.Vector3(Math.cos(this.walkYaw), 0, -Math.sin(this.walkYaw));
    const move = new THREE.Vector3();
    if (this.keys.has('w') || this.keys.has('arrowup')) move.add(forward);
    if (this.keys.has('s') || this.keys.has('arrowdown')) move.sub(forward);
    if (this.keys.has('d') || this.keys.has('arrowright')) move.add(right);
    if (this.keys.has('a') || this.keys.has('arrowleft')) move.sub(right);
    if (move.lengthSq() > 0) {
      this.camera.position.add(move.normalize().multiplyScalar(speed));
      this.camera.position.y = 1.62;
    }
  }

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
    for (const child of this.shell.children) {
      const data = child.userData;
      if (data?.kind !== 'wall') continue;
      if (inWalk) {
        child.visible = true;
        continue;
      }
      const toCamera = this.camera.position.clone().sub(data.mid as THREE.Vector3);
      // Visible only when the camera sits on the room side of the wall.
      child.visible = (data.inward as THREE.Vector3).dot(toCamera) > 0;
    }
  }

  private animate = () => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.animate);
    const delta = Math.min(this.clock.getDelta(), 0.1);
    if (this.mode === 'walk') this.stepWalk(delta);
    else this.controls.update();
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
   * The selection outline and the helper lights are stripped first so the file
   * contains only the apartment — drag the result straight into Blender.
   */
  async exportGLB(): Promise<Blob> {
    const wasSelected = this.selectedId;
    this.setSelection(null);
    // Restore every wall first: the on-screen cull must not reach the export.
    for (const child of this.shell.children) child.visible = true;
    const scene = new THREE.Scene();
    scene.add(this.shell.clone(true), this.furnitureRoot.clone(true));
    scene.traverse((obj) => {
      if ((obj as THREE.Light).isLight) obj.parent?.remove(obj);
    });
    const exporter = new GLTFExporter();
    const result = await exporter.parseAsync(scene, { binary: true, onlyVisible: true });
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
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.clearGroup(this.shell);
    this.clearGroup(this.furnitureRoot);
    this.controls.dispose();
    this.renderer.dispose();
  }
}
