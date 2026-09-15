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
      this.velocity.set(0, 0, 0);
    }
  }

  isActive() {
    return this.active;
  }

  /** Place the player and point them in a direction, in radians. */
  place(x: number, z: number, yaw: number) {
    this.position.set(x, this.eyeHeight, z);
    this.yaw = yaw;
    this.pitch = 0;
    this.velocity.set(0, 0, 0);
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

    const speed = this.crouching ? CROUCH_SPEED : sprinting ? SPRINT_SPEED : WALK_SPEED;
    if (wish.lengthSq() > 0) {
      wish.normalize().multiplyScalar(speed);
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
    const before = this.position[axis];
    this.position[axis] += amount;
    for (const blocker of this.blockers) {
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
