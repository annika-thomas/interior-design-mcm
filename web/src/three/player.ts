import * as THREE from 'three';

/**
 * First-person controller.
 *
 * Built to feel like walking rather than flying a camera: velocity has
 * acceleration and damping so you lean into a start and coast out of a stop,
 * the head bobs with your stride, and you collide with walls and furniture.
 *
 * Collision is a circle in plan against axis-aligned boxes, resolved one axis
 * at a time. That is deliberately simple, and it gives the behaviour people
 * expect indoors — you slide along a wall you walk into instead of sticking to
 * it, and you cannot clip through the sofa.
 */

export const EYE_HEIGHT = 1.62;
const CROUCH_HEIGHT = 1.05;
const RADIUS = 0.3;
const WALK_SPEED = 2.3;
const SPRINT_SPEED = 4.4;
const CROUCH_SPEED = 1.1;
const ACCEL = 14;
const DAMPING = 11;

export interface Blocker {
  box: THREE.Box3;
  /** Furniture you can see over is still furniture you cannot walk through. */
  label: string;
}

export class Player {
  yaw = 0;
  pitch = 0;
  position = new THREE.Vector3(0, EYE_HEIGHT, 0);

  private velocity = new THREE.Vector3();
  private keys = new Set<string>();
  /** Analogue input from an on-screen stick: x strafes, y walks forward. */
  private stick = new THREE.Vector2();
  private blockers: Blocker[] = [];
  private bobPhase = 0;
  private eyeHeight = EYE_HEIGHT;
  private crouching = false;
  /** Set while the pointer is locked; drives whether input is consumed. */
  private active = false;

  setBlockers(blockers: Blocker[]) {
    this.blockers = blockers;
  }

  setActive(active: boolean) {
    this.active = active;
    if (!active) {
      this.keys.clear();
      this.stick.set(0, 0);
      this.velocity.set(0, 0, 0);
    }
  }

  /** Feed the on-screen stick. Both components are clamped to -1..1. */
  setStick(x: number, y: number) {
    this.stick.set(THREE.MathUtils.clamp(x, -1, 1), THREE.MathUtils.clamp(y, -1, 1));
  }

  isActive() {
    return this.active;
  }

  /**
   * Place the player and point them in a direction, in radians.
   *
   * The requested spot is usually the middle of the room, which in a furnished
   * room is very often inside the coffee table. Spawning inside a blocker used
   * to wedge you there permanently, so this spirals outward for clear floor.
   */
  place(x: number, z: number, yaw: number) {
    this.yaw = yaw;
    this.pitch = 0;
    this.velocity.set(0, 0, 0);
    this.position.set(x, this.eyeHeight, z);
    if (!this.blocked()) return;

    for (let radius = 0.35; radius <= 4; radius += 0.35) {
      for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2;
        this.position.set(x + Math.cos(angle) * radius, this.eyeHeight, z + Math.sin(angle) * radius);
        if (!this.blocked()) return;
      }
    }
    // Nowhere clear found; stand at the requested spot and rely on the
    // already-stuck escape in moveAxis to walk out.
    this.position.set(x, this.eyeHeight, z);
  }

  private blocked(): boolean {
    return this.blockers.some((b) => this.intersects(b.box));
  }

  look(deltaX: number, deltaY: number, sensitivity = 0.0022) {
    this.yaw -= deltaX * sensitivity;
    // Stop just short of straight up or down, so the view never flips.
    this.pitch = THREE.MathUtils.clamp(this.pitch - deltaY * sensitivity, -1.45, 1.45);
  }

  onKeyDown(event: KeyboardEvent) {
    this.keys.add(event.code);
  }

  onKeyUp(event: KeyboardEvent) {
    this.keys.delete(event.code);
  }

  private wants(...codes: string[]) {
    return codes.some((c) => this.keys.has(c));
  }

  /** Advance the simulation and write the result onto the camera. */
  update(delta: number, camera: THREE.PerspectiveCamera) {
    const sprinting = this.wants('ShiftLeft', 'ShiftRight');
    this.crouching = this.wants('KeyC', 'ControlLeft', 'ControlRight');

    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const wish = new THREE.Vector3();
    if (this.wants('KeyW', 'ArrowUp')) wish.add(forward);
    if (this.wants('KeyS', 'ArrowDown')) wish.sub(forward);
    if (this.wants('KeyD', 'ArrowRight')) wish.add(right);
    if (this.wants('KeyA', 'ArrowLeft')) wish.sub(right);

    // The stick adds to the keys rather than replacing them, so a tablet with
    // a keyboard attached can use either.
    const stickLength = this.stick.length();
    if (stickLength > 0.04) {
      wish.addScaledVector(forward, this.stick.y);
      wish.addScaledVector(right, this.stick.x);
    }

    const speed = this.crouching ? CROUCH_SPEED : sprinting ? SPRINT_SPEED : WALK_SPEED;
    if (wish.lengthSq() > 0) {
      // A half-pushed stick walks at half speed; keys are always full tilt.
      const throttle = this.keys.size ? 1 : Math.min(1, Math.max(stickLength, 0.001));
      wish.normalize().multiplyScalar(speed * throttle);
      this.velocity.lerp(wish, Math.min(1, ACCEL * delta));
    } else {
      this.velocity.multiplyScalar(Math.max(0, 1 - DAMPING * delta));
      if (this.velocity.lengthSq() < 1e-4) this.velocity.set(0, 0, 0);
    }

    // One axis at a time, so walking into a wall at an angle slides along it.
    this.moveAxis('x', this.velocity.x * delta);
    this.moveAxis('z', this.velocity.z * delta);

    // Head bob, scaled by how fast you are actually moving.
    const speedNow = Math.hypot(this.velocity.x, this.velocity.z);
    this.bobPhase += delta * speedNow * 5.2;
    const bobAmount = Math.min(speedNow / SPRINT_SPEED, 1) * 0.035;
    const bob = Math.sin(this.bobPhase * 2) * bobAmount;
    const sway = Math.cos(this.bobPhase) * bobAmount * 0.5;

    const targetEye = this.crouching ? CROUCH_HEIGHT : EYE_HEIGHT;
    this.eyeHeight += (targetEye - this.eyeHeight) * Math.min(1, delta * 9);
    this.position.y = this.eyeHeight;

    camera.position.set(this.position.x, this.position.y + bob, this.position.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(this.pitch, this.yaw, sway * 0.35);

    // A touch of extra field of view when sprinting reads as speed.
    const targetFov = sprinting && speedNow > 1 ? 62 : 55;
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov += (targetFov - camera.fov) * Math.min(1, delta * 6);
      camera.updateProjectionMatrix();
    }
  }

  /** Move along one axis and undo it if the player would end up inside a box. */
  private moveAxis(axis: 'x' | 'z', amount: number) {
    if (amount === 0) return;

    // Anything we are already inside cannot be allowed to block us, or being
    // spawned in the coffee table means never moving again.
    const alreadyInside = new Set<Blocker>();
    for (const blocker of this.blockers) {
      if (this.intersects(blocker.box)) alreadyInside.add(blocker);
    }

    const before = this.position[axis];
    this.position[axis] += amount;
    for (const blocker of this.blockers) {
      if (alreadyInside.has(blocker)) continue;
      if (this.intersects(blocker.box)) {
        this.position[axis] = before;
        this.velocity[axis] = 0;
        return;
      }
    }
  }

  /** Circle-versus-box overlap in plan, ignoring anything above head height. */
  private intersects(box: THREE.Box3): boolean {
    if (box.min.y > this.eyeHeight + 0.15) return false;   // duck under it
    const nearestX = THREE.MathUtils.clamp(this.position.x, box.min.x, box.max.x);
    const nearestZ = THREE.MathUtils.clamp(this.position.z, box.min.z, box.max.z);
    const dx = this.position.x - nearestX;
    const dz = this.position.z - nearestZ;
    return dx * dx + dz * dz < RADIUS * RADIUS;
  }

  /** True while the player is pressing a movement key. */
  get moving() {
    return this.velocity.lengthSq() > 0.05;
  }
}
