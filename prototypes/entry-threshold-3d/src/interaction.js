import * as THREE from '../vendor/three.module.js';

export function createInteraction({ canvas, viewport, tokens, sockets, seal, onComplete, onStonePress }) {
  let activeToken = null;
  let pointerId = null;
  let offset = new THREE.Vector3();
  let completed = false;
  let stonePressable = false;

  function eventToWorld(event, z = 0.18) {
    const rect = canvas.getBoundingClientRect();
    const nx = (event.clientX - rect.left) / Math.max(1, rect.width);
    const ny = (event.clientY - rect.top) / Math.max(1, rect.height);
    return new THREE.Vector3((nx - 0.5) * viewport.width, (0.5 - ny) * viewport.height, z);
  }

  function setComplete() {
    completed = true;
    stonePressable = true;
    document.getElementById('entry-root').classList.add('is-pressable');
  }

  function pointerDown(event) {
    const point = eventToWorld(event);
    if (stonePressable) {
      if (point.distanceTo(seal.center.clone().setZ(0.18)) < 1.15) {
        stonePressable = false;
        document.getElementById('entry-root').classList.remove('is-pressable');
        onStonePress();
        event.preventDefault();
        return;
      }
    }

    if (completed || activeToken) return;

    activeToken = findNearestToken(point);
    if (!activeToken) return;

    pointerId = event.pointerId;
    activeToken.dragging = true;
    offset.copy(activeToken.mesh.position).sub(point);
    canvas.setPointerCapture(pointerId);
    document.getElementById('entry-root').classList.add('is-dragging');
    event.preventDefault();
  }

  function pointerMove(event) {
    if (!activeToken || event.pointerId !== pointerId) return;
    const point = eventToWorld(event);
    activeToken.mesh.position.copy(point).add(offset);
    activeToken.mesh.position.x = THREE.MathUtils.clamp(activeToken.mesh.position.x, -viewport.width / 2 + 0.2, viewport.width / 2 - 0.2);
    activeToken.mesh.position.y = THREE.MathUtils.clamp(activeToken.mesh.position.y, -viewport.height / 2 + 0.2, viewport.height / 2 - 0.2);
    activeToken.mesh.position.z = 0.18;
    event.preventDefault();
  }

  function pointerUp(event) {
    if (!activeToken || event.pointerId !== pointerId) return;
    const token = activeToken;
    const nearest = findNearestSocket(token);
    if (nearest && nearest.distance < 1.0) {
      snapToken(token, nearest.socket);
      if (sockets.every((socket) => socket.filledBy !== null)) {
        setComplete();
        onComplete();
      }
    } else {
      token.mesh.position.lerp(token.base, 0.35);
    }
    token.dragging = false;
    activeToken = null;
    pointerId = null;
    document.getElementById('entry-root').classList.remove('is-dragging');
    try { canvas.releasePointerCapture(event.pointerId); } catch {}
    event.preventDefault();
  }

  function findNearestSocket(token) {
    let best = null;
    sockets.forEach((socket) => {
      if (socket.filledBy !== null) return;
      const dragComparable = new THREE.Vector3(socket.position.x, socket.position.y, 0.18);
      const distance = dragComparable.distanceTo(token.mesh.position);
      if (!best || distance < best.distance) best = { socket, distance };
    });
    return best;
  }

  function findNearestToken(point) {
    let best = null;
    tokens.forEach((token) => {
      if (token.socket) return;
      const distance = point.distanceTo(token.mesh.position);
      if (distance < token.radius * 2.4 && (!best || distance < best.distance)) {
        best = { token, distance };
      }
    });
    return best && best.token;
  }

  function snapToken(token, socket) {
    socket.filledBy = token.index;
    token.socket = socket;
    token.mesh.position.copy(socket.position).add(new THREE.Vector3(0, 0, 0.16));
    token.mesh.scale.setScalar(0.58);
    token.base.copy(token.mesh.position);
  }

  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', pointerUp);

  return { setComplete };
}
