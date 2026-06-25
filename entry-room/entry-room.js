const shell = document.querySelector(".entry-shell");
const layer = document.querySelector(".interaction-layer");

const IMAGE_WIDTH = 1441;
const IMAGE_HEIGHT = 1092;

const sockets = [
  { id: "socket-1", x: 74.7, y: 17.3 },
  { id: "socket-2", x: 80.5, y: 17.3 },
  { id: "socket-3", x: 74.7, y: 26.2 },
  { id: "socket-4", x: 80.5, y: 26.2 },
  { id: "socket-5", x: 74.7, y: 35.1 },
  { id: "socket-6", x: 80.5, y: 35.1 }
];

const orbs = [
  { id: "orb-1", x: 17.8, y: 79.4 },
  { id: "orb-2", x: 28.2, y: 72.8 },
  { id: "orb-3", x: 39.4, y: 82.0 },
  { id: "orb-4", x: 50.3, y: 70.6 },
  { id: "orb-5", x: 58.8, y: 84.2 },
  { id: "orb-6", x: 67.3, y: 74.6 }
];

const state = {
  imageRect: { left: 0, top: 0, width: 0, height: 0, scale: 1 },
  activeOrb: null,
  audioContext: null
};

function percentToViewport(point) {
  const { left, top, width, height } = state.imageRect;
  return {
    x: left + (point.x / 100) * width,
    y: top + (point.y / 100) * height
  };
}

function applyPoint(element, point) {
  const screen = percentToViewport(point);
  element.style.setProperty("--x", `${screen.x}px`);
  element.style.setProperty("--y", `${screen.y}px`);
}

function updateImageRect() {
  const viewportWidth = shell.clientWidth || window.innerWidth;
  const viewportHeight = shell.clientHeight || window.innerHeight;
  const scale = Math.max(viewportWidth / IMAGE_WIDTH, viewportHeight / IMAGE_HEIGHT);
  const width = IMAGE_WIDTH * scale;
  const height = IMAGE_HEIGHT * scale;

  state.imageRect = {
    left: (viewportWidth - width) / 2,
    top: (viewportHeight - height) / 2,
    width,
    height,
    scale
  };

  shell.style.setProperty("--orb-size", `${Math.max(26, Math.min(54, 22 * scale))}px`);
  shell.style.setProperty("--socket-size", `${Math.max(28, Math.min(60, 27 * scale))}px`);

  document.querySelectorAll(".socket").forEach((socketElement) => {
    const socket = sockets.find((item) => item.id === socketElement.dataset.socketId);
    applyPoint(socketElement, socket);
  });

  document.querySelectorAll(".orb").forEach((orbElement) => {
    const orb = orbs.find((item) => item.id === orbElement.dataset.orbId);
    const socket = sockets.find((item) => item.id === orbElement.dataset.socketId);
    applyPoint(orbElement, socket || orb);
  });
}

function playClick() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;

  if (!state.audioContext) {
    state.audioContext = new AudioContext();
  }

  const context = state.audioContext;
  const now = context.currentTime;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const filter = context.createBiquadFilter();

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(96, now);
  oscillator.frequency.exponentialRampToValueAtTime(48, now + 0.07);
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(340, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.16, now + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);

  oscillator.connect(filter);
  filter.connect(gain);
  gain.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.13);
}

function makeSocket(socket) {
  const element = document.createElement("div");
  element.className = "socket";
  element.dataset.socketId = socket.id;
  element.setAttribute("aria-hidden", "true");
  layer.append(element);
  applyPoint(element, socket);
}

function makeOrb(orb) {
  const element = document.createElement("button");
  element.className = "orb";
  element.type = "button";
  element.dataset.orbId = orb.id;
  element.setAttribute("aria-label", "movable orb");
  layer.append(element);
  applyPoint(element, orb);
}

function findNearestSocket(clientX, clientY) {
  const threshold = Math.max(34, 29 * state.imageRect.scale);
  let nearest = null;

  for (const socket of sockets) {
    if (socket.occupied) continue;
    const screen = percentToViewport(socket);
    const distance = Math.hypot(screen.x - clientX, screen.y - clientY);
    if (distance <= threshold && (!nearest || distance < nearest.distance)) {
      nearest = { socket, distance };
    }
  }

  return nearest?.socket || null;
}

function releaseOrb(orbElement, clientX, clientY) {
  const orb = orbs.find((item) => item.id === orbElement.dataset.orbId);
  const socket = findNearestSocket(clientX, clientY);

  orbElement.classList.remove("is-dragging");
  state.activeOrb = null;

  if (socket) {
    socket.occupied = true;
    orbElement.dataset.socketId = socket.id;
    orbElement.classList.add("is-locked");
    orbElement.style.removeProperty("--drag-x");
    orbElement.style.removeProperty("--drag-y");
    applyPoint(orbElement, socket);
    playClick();
    return;
  }

  applyPoint(orbElement, orb);
}

function handlePointerDown(event) {
  const orbElement = event.target.closest(".orb");
  if (!orbElement || orbElement.classList.contains("is-locked")) return;

  event.preventDefault();
  orbElement.setPointerCapture(event.pointerId);
  orbElement.classList.add("is-dragging");
  state.activeOrb = {
    element: orbElement,
    pointerId: event.pointerId
  };

  orbElement.style.setProperty("--x", `${event.clientX}px`);
  orbElement.style.setProperty("--y", `${event.clientY}px`);
}

function handlePointerMove(event) {
  if (!state.activeOrb || state.activeOrb.pointerId !== event.pointerId) return;
  state.activeOrb.element.style.setProperty("--x", `${event.clientX}px`);
  state.activeOrb.element.style.setProperty("--y", `${event.clientY}px`);
}

function handlePointerUp(event) {
  if (!state.activeOrb || state.activeOrb.pointerId !== event.pointerId) return;
  releaseOrb(state.activeOrb.element, event.clientX, event.clientY);
}

sockets.forEach(makeSocket);
orbs.forEach(makeOrb);
updateImageRect();

layer.addEventListener("pointerdown", handlePointerDown);
layer.addEventListener("pointermove", handlePointerMove);
layer.addEventListener("pointerup", handlePointerUp);
layer.addEventListener("pointercancel", handlePointerUp);
window.addEventListener("resize", updateImageRect);
