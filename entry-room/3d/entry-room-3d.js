import * as THREE from './vendor/three.module.js';
import { mountCalibrationHud } from './entry-room-calibration-hud.js';
import RAPIER from 'https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.12.0/+esm';

await RAPIER.init();

/* ------------------------------------------------------------------ *
 *  the six.well construct — entry room (3D)
 *  Real lit orbs that seat into the holes baked into the room render.
 *  The render is the backdrop; this canvas overlays real spheres plus a
 *  per-socket front lip that occludes the orb's lower edge so it reads as
 *  resting INSIDE the hole rather than stuck on the wall.
 * ------------------------------------------------------------------ */

/* ===== CONFIG — tune these ========================================= *
 * All positions are normalized 0..1 over the calibrated core frame
 * (0,0 = top-left, 1,1 = bottom-right). Sizes are fractions of the
 * viewport WIDTH. Use ?calibrate to drag the sockets onto the holes
 * and read back exact numbers. Screen-level additions should instead use
 * viewportToWorld(), whose 0..1 bounds cover the full visible viewport.
 * ================================================================== */
const CORE_IMAGE = { width: 1441, height: 1092 };
// Per-orb floor-shadow params (calibrated independently per orb): cast = Y drop,
// skew = X lean, depth = spread/fade feel, z = additive Z offset.
const DEFAULT_SHADOW = { cast: 0.93, skew: 0.02, depth: 1.0, z: 0 };

const MOBILE_SOCKETS = [
  { x: 0.7129, y: 0.1075 }, { x: 0.7852, y: 0.1050 },
  { x: 0.7110, y: 0.2081 }, { x: 0.7872, y: 0.2081 },
  { x: 0.7129, y: 0.3112 }, { x: 0.7891, y: 0.3138 }
];
const MOBILE_ORB_HOMES = [
  { x: 0.1246, y: 0.1095 }, { x: 0.7499, y: 1.2356 },
  { x: 0.4094, y: -0.3853 }, { x: 0.1583, y: 1.1367 },
  { x: 0.5039, y: 0.6927 }, { x: 0.9119, y: 0.7072 }
];
const MOBILE_ORB_SHADOW = [
  { cast: 0.93, skew: 0.02, depth: 1.00, z: 0.00 },
  { cast: 2.58, skew: 0.02, depth: 1.00, z: 0.00 },
  { cast: 1.11, skew: 0.02, depth: 1.00, z: 0.00 },
  { cast: 0.93, skew: 0.02, depth: 1.00, z: 0.00 },
  { cast: 0.66, skew: 0.02, depth: 1.00, z: 0.00 },
  { cast: 1.14, skew: 0.02, depth: 1.00, z: 0.00 }
];

const DESKTOP_SOCKETS = [
  { x: 0.5867, y: 0.2532 }, { x: 0.6316, y: 0.2532 },
  { x: 0.5867, y: 0.3144 }, { x: 0.6316, y: 0.3153 },
  { x: 0.5874, y: 0.3755 }, { x: 0.6316, y: 0.3773 }
];
const DESKTOP_ORB_HOMES = [
  { x: 0.0140, y: 0.1883 }, { x: 0.4446, y: 0.1893 },
  { x: 0.2570, y: 0.5056 }, { x: -0.2320, y: 0.4509 },
  { x: 0.5187, y: 0.8417 }, { x: 0.8465, y: 0.6233 }
];
const DESKTOP_ORB_SHADOW = [
  { cast: 0.81, skew: 0.02, depth: 1.00, z: 0.00 },
  { cast: 0.63, skew: 0.02, depth: 1.00, z: 0.00 },
  { cast: 0.78, skew: 0.02, depth: 1.00, z: 0.00 },
  { cast: 0.93, skew: 0.02, depth: 1.00, z: 0.00 },
  { cast: 0.66, skew: 0.02, depth: 1.00, z: 0.00 },
  { cast: 0.60, skew: 0.02, depth: 1.00, z: 0.00 }
];
const DESKTOP_COMPLETION_RING = {
  x: 0.0575,
  y: 0.3588,
  aspectX: 0.92,
  aspectY: 1.0,
  radiusPad: 3.05,
  surfaceZ: 0.14,
  recessZ: -0.10,
  bodyOffsetX: -0.42,
  bodyOffsetY: -0.02,
  bodyOffsetZ: -0.14,
  emergeOffsetX: -0.34,
  emergeOffsetY: 0.02,
  emergeOffsetZ: -1.62,
  startScale: 0.34,
  bodyStartScale: 0.56,
  recessOpacity: 0.72,
  settledRecessOpacity: 0.18,
  ringOpacity: 1.0,
  bodyOpacity: 1.0
};
const MOBILE_COMPLETION_RING = {
  x: 0.4745,
  y: 1.0547,
  aspectX: 1.22,
  aspectY: 0.38,
  radiusPad: 2.75,
  surfaceZ: 0.10,
  recessZ: -0.08,
  bodyOffsetX: 0.00,
  bodyOffsetY: 0.10,
  bodyOffsetZ: -0.16,
  emergeOffsetX: 0.00,
  emergeOffsetY: 0.42,
  emergeOffsetZ: -1.34,
  startScale: 0.38,
  bodyStartScale: 0.58,
  recessOpacity: 0.66,
  settledRecessOpacity: 0.16,
  ringOpacity: 0.96,
  bodyOpacity: 0.96
};
const BASE_LAYOUTS = {
  desktop: {
    image: CORE_IMAGE,
    holeRadiusN: 0.0169,
    orbRadiusFactor: 0.9,
    // Six holes on the right wall - 2 columns x 3 rows.
    sockets: DESKTOP_SOCKETS,
    orbHomes: DESKTOP_ORB_HOMES,
    orbShadow: DESKTOP_ORB_SHADOW,
    completionRing: DESKTOP_COMPLETION_RING
  },
  mobile: {
    image: CORE_IMAGE,
    holeRadiusN: 0.0273,
    orbRadiusFactor: 0.9,
    sockets: MOBILE_SOCKETS,
    orbHomes: MOBILE_ORB_HOMES,
    orbShadow: MOBILE_ORB_SHADOW,
    completionRing: MOBILE_COMPLETION_RING
  }
};

function cloneLayout(layout) {
  return {
    image: { ...layout.image },
    holeRadiusN: layout.holeRadiusN,
    orbRadiusFactor: layout.orbRadiusFactor,
    sockets: layout.sockets.map((point) => ({ ...point })),
    orbHomes: layout.orbHomes.map((point) => ({ ...point })),
    orbShadow: (layout.orbShadow || []).map((shadow) => ({ ...shadow })),
    completionRing: layout.completionRing ? { ...layout.completionRing } : null
  };
}

function cloneLayouts(layouts) {
  return Object.fromEntries(
    Object.entries(layouts).map(([name, layout]) => [name, cloneLayout(layout)])
  );
}

const LAYOUTS = cloneLayouts(BASE_LAYOUTS);

const CONFIG = {

  lipAspectX: 0.82,      // perspective squish: lip/hole width = height * this (right wall recedes)

  homeZ: 1.2,            // floating orbs sit in front of the wall
  dragZ: 1.6,            // while dragging, fully in front
  lipZ: 0.0,             // socket lip plane
  floorY: 0.92,          // normalized Y of the floor band where orb shadows fall
                         // shadow cast/skew/depth/z are now per-orb — see DEFAULT_SHADOW and orb.shadow*

  colors: {
    orb: 0x17130f,
    orbComplete: 0x9f0704,
    completionRed: 0xd31810,
    lip: 0xb98c5e,       // wall tone near the holes
    interior: 0x140c06
  }
};

const mobileLayoutQuery = window.matchMedia('(max-aspect-ratio: 3/4)');
let activeLayoutName = mobileLayoutQuery.matches ? 'mobile' : 'desktop';
let activeLayout = LAYOUTS[activeLayoutName];

const urlParams = new URLSearchParams(location.search);
const calibrate = urlParams.has('calibrate');
const previewComplete = urlParams.has('previewComplete');
if (calibrate) mountCalibrationHud(document.body);

const canvas = document.getElementById('entry-canvas');
const coreFrame = document.getElementById('frame-stage');
const artStage = document.getElementById('art-stage');
const roomBgImage = document.querySelector('#room-bg img');
const ringRippleVideo = document.getElementById('ring-ripple-video');
const root = document.getElementById('entry-root');
const status = document.getElementById('entry-status');
const wrongShapeFlash = document.getElementById('wrong-shape-flash');
const calibrationConsole = document.getElementById('calibration-console');
const calibrationOutput = document.getElementById('calibration-output');
const calibrationToggle = document.getElementById('cal-toggle');
const RING_SETTLED_TIME = 4.8;
const HUD_COLLAPSE_KEY = 'entry3d-hud-collapsed';
const FEEDBACK_STORAGE_KEY = 'entry3d-feedback-enabled';
const feedbackQuery = new URLSearchParams(location.search).get('feedback');
const ROOM_BACKDROP_Z = -0.02;
const COMPLETION_RING_DEPTH = 0.44;
const COMPLETION_RING_FRONT_CLEARANCE = 0.08;
const COMPLETION_PATCH_LIFT = 1.42;
const COMPLETION_PATCH_SIZE = 1.68;
const COMPLETION_PATCH_SETTLED_SCALE = 0.46;
const COMPLETION_PATCH_SHIFT = 1.08;
const COMPLETION_PATCH_START_Z = 0.04;
const COMPLETION_PATCH_FADE_START = 0.54;
const COMPLETION_FIELD_SIZE = 2.6;
const COMPLETION_FIELD_SHIFT = 0.24;
const COMPLETION_FIELD_LIFT = 0.22;
const COMPLETION_FIELD_SCALE = 1.1;
const COMPLETION_FIELD_OPACITY = 0.32;
const COMPLETION_FIELD_FADE_START = 0.18;
const COMPLETION_RIPPLE_SIZE = 0.74;
const COMPLETION_RIPPLE_OPACITY = 0.68;
const COMPLETION_RIPPLE_SPEED = 0.22;
const COMPLETION_RIPPLE_COUNT = 6;
const COMPLETION_RING_COLOR = 0xcf3418;
const COMPLETION_RING_BODY_COLOR = 0x8a2416;
const COMPLETION_RING_SETTLED_COLOR = 0x000000;
const RING_COLOR_PAUSE_AFTER_EMERGENCE = 0.35;
const RING_PALETTE_COLOR_DURATION = 0.22;
const RING_SETTLE_FADE_DURATION = 0.55;
const RING_PALETTE_COLORS = [
  COMPLETION_RING_COLOR, 0xff9500, 0xffd60a, 0x34c759, 0x2dd4bf, 0x0a84ff, 0xbf5af2
];
const WRONG_SHAPE_FLASH_DURATION = 420;
// How long the completion ring's emerge + colour-cycle + settle-fade runs after it
// reaches its settled point. The doorway shape-lock waits this out before appearing.
const RING_SETTLE_SEQUENCE_DURATION = RING_COLOR_PAUSE_AFTER_EMERGENCE
  + (RING_PALETTE_COLORS.length - 1) * RING_PALETTE_COLOR_DURATION
  + RING_SETTLE_FADE_DURATION;
const SHAPE_STREAM_START_TIME = RING_SETTLED_TIME + RING_SETTLE_SEQUENCE_DURATION;
const SHAPE_LOCK_START_DELAY = 3; // extra pause after the ring settles before the lock cycles in

function readFeedbackEnabled() {
  if (feedbackQuery != null) {
    return !['0', 'false', 'off'].includes(String(feedbackQuery).toLowerCase());
  }
  try {
    const stored = localStorage.getItem(FEEDBACK_STORAGE_KEY);
    if (stored != null) return stored !== '0';
  } catch {}
  return true;
}

const interactionFeedback = {
  enabled: readFeedbackEnabled(),
  audioContext: null
};

const sceneFx = {
  wrongShapeFlashTimer: null
};

function setFeedbackEnabled(enabled) {
  interactionFeedback.enabled = !!enabled;
  try {
    localStorage.setItem(FEEDBACK_STORAGE_KEY, enabled ? '1' : '0');
  } catch {}
}

function primeSeatFeedback() {
  if (!interactionFeedback.enabled) return;
  if (!interactionFeedback.audioContext) {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return;
    try {
      interactionFeedback.audioContext = new AudioContextCtor();
    } catch {
      return;
    }
  }
  if (interactionFeedback.audioContext.state === 'suspended') {
    interactionFeedback.audioContext.resume().catch(() => {});
  }
}

function triggerSeatTone(ctx, startAt = ctx.currentTime) {
  const bodyOsc = ctx.createOscillator();
  const bodyGain = ctx.createGain();
  bodyOsc.type = 'triangle';
  bodyOsc.frequency.setValueAtTime(220, startAt);
  bodyOsc.frequency.exponentialRampToValueAtTime(172, startAt + 0.09);
  bodyGain.gain.setValueAtTime(0.0001, startAt);
  bodyGain.gain.exponentialRampToValueAtTime(0.075, startAt + 0.012);
  bodyGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.12);
  bodyOsc.connect(bodyGain);
  bodyGain.connect(ctx.destination);
  bodyOsc.start(startAt);
  bodyOsc.stop(startAt + 0.13);

  const clickOsc = ctx.createOscillator();
  const clickGain = ctx.createGain();
  clickOsc.type = 'sine';
  clickOsc.frequency.setValueAtTime(760, startAt);
  clickOsc.frequency.exponentialRampToValueAtTime(280, startAt + 0.03);
  clickGain.gain.setValueAtTime(0.0001, startAt);
  clickGain.gain.exponentialRampToValueAtTime(0.03, startAt + 0.004);
  clickGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.045);
  clickOsc.connect(clickGain);
  clickGain.connect(ctx.destination);
  clickOsc.start(startAt);
  clickOsc.stop(startAt + 0.05);
}

function playSeatFeedback() {
  if (!interactionFeedback.enabled) return;

  if (navigator.vibrate) {
    try { navigator.vibrate(18); } catch {}
  }

  primeSeatFeedback();
  const ctx = interactionFeedback.audioContext;
  if (!ctx) return;
  if (ctx.state === 'running') {
    triggerSeatTone(ctx);
    return;
  }
  if (ctx.state === 'suspended') {
    ctx.resume()
      .then(() => {
        if (ctx.state === 'running') triggerSeatTone(ctx, ctx.currentTime + 0.01);
      })
      .catch(() => {});
  }
}

function clearSceneFxTimers() {
  if (sceneFx.wrongShapeFlashTimer != null) {
    window.clearTimeout(sceneFx.wrongShapeFlashTimer);
    sceneFx.wrongShapeFlashTimer = null;
  }
}

function flashWrongShapeOverlay() {
  if (!wrongShapeFlash) return;
  wrongShapeFlash.classList.remove('is-flashing');
  void wrongShapeFlash.offsetWidth;
  wrongShapeFlash.classList.add('is-flashing');
  if (sceneFx.wrongShapeFlashTimer != null) window.clearTimeout(sceneFx.wrongShapeFlashTimer);
  sceneFx.wrongShapeFlashTimer = window.setTimeout(() => {
    wrongShapeFlash.classList.remove('is-flashing');
    sceneFx.wrongShapeFlashTimer = null;
  }, WRONG_SHAPE_FLASH_DURATION);
}

function resetSceneFx() {
  clearSceneFxTimers();
  wrongShapeFlash?.classList.remove('is-flashing');
}

window.entryRoom3d = Object.assign(window.entryRoom3d || {}, {
  setFeedbackEnabled,
  getFeedbackEnabled: () => interactionFeedback.enabled,
  getState: () => ({
    layout: activeLayoutName,
    dragging: !!active,
    placed: sockets.filter((s) => s.filledBy != null).length,
    feedbackEnabled: interactionFeedback.enabled,
    orbHomes: orbs.map((orb) => ({
      index: orb.index,
      home: { ...orb.home },
      seated: orb.seated,
      norm: worldToNorm(orb.mesh.position)
    })),
    sockets: sockets.map((socket) => ({ index: socket.index, filledBy: socket.filledBy, norm: { ...socket.norm } }))
  }),
  cancelActiveDrag: () => finishActiveDrag({ interrupted: true }),
  __shapeStream: () => ({
    count: shapeStream.items.length,
    settled: shapeStream.items.filter((i) => i.settled).length,
    full: shapeStream.full,
    tuning: {
      minSize: +SHAPE_STREAM.minSize.toFixed(3),
      maxSize: +SHAPE_STREAM.maxSize.toFixed(3),
      colors: SHAPE_STREAM_COLORS.map(colorHex)
    },
    landingPhase: (() => {
      const phase = shapeStreamPhaseAt(shapeStream.landingPhaseIndex);
      const zone = shapeStream.zones[0];
      const target = zone ? shapeStreamActiveLandingTarget(zone) : null;
      return {
        index: shapeStream.landingPhaseIndex,
        name: phase?.name || null,
        previous: shapeStreamPhaseAt(shapeStream.previousLandingPhaseIndex)?.name || null,
        elapsed: +shapeStream.landingPhaseElapsed.toFixed(2),
        blend: +THREE.MathUtils.clamp(
          shapeStream.landingPhaseBlendElapsed / Math.max(0.001, SHAPE_STREAM.phaseBlendDuration),
          0,
          1
        ).toFixed(2),
        pressure: +shapeStreamLandingPressure(0).toFixed(2),
        threshold: +SHAPE_STREAM.phaseCrowdHeight.toFixed(2),
        target: target ? {
          widthT: +target.widthT.toFixed(2),
          depthT: +target.depthT.toFixed(2),
          widthSpread: +target.widthSpread.toFixed(2),
          depthSpread: +target.depthSpread.toFixed(2)
        } : null
      };
    })(),
    zones: shapeStream.zones.map((zone) => zone.name),
    bounds: {
      xMin: +shapeStream.xMin.toFixed(2),
      xMax: +shapeStream.xMax.toFixed(2),
      zMin: +shapeStream.zMin.toFixed(2),
      zMax: +shapeStream.zMax.toFixed(2)
    },
    depthBands: shapeStream.zones.map((zone) => {
      const counts = new Array(shapeStream.depthBucketCount).fill(0);
      shapeStream.items.forEach((item) => {
        if (item.zoneIndex !== shapeStream.zones.indexOf(zone)) return;
        const zBucket = shapeStreamZBucketIndex(zone, item.mesh.position.z);
        counts[zBucket] += 1;
      });
      return { zone: zone.name, counts };
    }),
    spawn: { ...completionEffects.ring.userData.surfacePosition },
    sample: shapeStream.items.slice(0, 3).map((i) => ({
      x: +i.mesh.position.x.toFixed(2),
      y: +i.mesh.position.y.toFixed(2),
      z: +i.mesh.position.z.toFixed(2),
      settled: i.settled
    }))
  }),
  __meshes: () => {
    const rect = canvas.getBoundingClientRect();
    const toScreen = (v) => {
      const p = v.clone().project(camera);
      return { sx: Math.round((p.x * 0.5 + 0.5) * rect.width), sy: Math.round((-p.y * 0.5 + 0.5) * rect.height) };
    };
    const e = completionEffects;
    const report = (name, m) => ({ name, visible: m.visible, opacity: +m.material.opacity.toFixed(2), screen: toScreen(m.position) });
    return [
      report('ring', e.ring),
      report('ringBody', e.ringBody),
      report('imagePlug', e.imagePlug),
      report('imageField', e.imageField),
      report('surfaceMask', e.surfaceMask),
      report('recess', e.recess)
    ];
  },
  __settle: () => settleCompletionInstantly(),
  __step: (delta = 0.016, n = 1) => {
    for (let i = 0; i < n; i += 1) {
      updateCompletionEffects(delta);
      updateShapeStream(delta);
      renderer.render(scene, camera);
    }
    return { elapsed: completionEffects.elapsed };
  }
});

/* ===== scene + orthographic camera ================================ */
const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x000000, 0);

const roomBackdrop = (() => {
  const texture = new THREE.Texture();
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: texture,
      depthWrite: true,
      depthTest: false,
      toneMapped: false
    })
  );
  mesh.renderOrder = -10;
  mesh.position.z = ROOM_BACKDROP_Z;
  mesh.visible = false;
  scene.add(mesh);
  return { texture, mesh, currentSrc: '' };
})();

const viewport = { width: 10, height: 10 };
const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 50);
camera.position.set(0, 0, 10);
camera.lookAt(0, 0, 0);

scene.add(new THREE.HemisphereLight(0xf6ddad, 0x271509, 1.5));
const key = new THREE.PointLight(0xffc787, 55, 60, 2);
key.position.set(-4, 4, 8);
scene.add(key);
const fill = new THREE.PointLight(0x7d3f18, 12, 50, 2);
fill.position.set(4, -2, 7);
scene.add(fill);
const orbRim = new THREE.PointLight(0xffe0b8, 11, 45, 2);
orbRim.position.set(5, 4.5, 5);
scene.add(orbRim);

function resize() {
  const rect = canvas.getBoundingClientRect();
  const w = rect.width || 1441;
  const h = rect.height || 1092;
  viewport.height = 10;
  viewport.width = viewport.height * (w / Math.max(1, h));
  camera.left = -viewport.width / 2;
  camera.right = viewport.width / 2;
  camera.top = viewport.height / 2;
  camera.bottom = -viewport.height / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  layoutRoomBackdrop();
}

function syncRoomBackdropTexture() {
  const src = roomBgImage?.currentSrc || roomBgImage?.src || '';
  if (!src || !roomBgImage?.complete) return;
  if (roomBackdrop.currentSrc !== src || roomBackdrop.texture.image !== roomBgImage) {
    roomBackdrop.texture.image = roomBgImage;
    roomBackdrop.texture.needsUpdate = true;
    roomBackdrop.currentSrc = src;
    const plugMap = completionEffects.imagePlug.material.map;
    if (plugMap) {
      plugMap.image = roomBgImage;
      plugMap.needsUpdate = true;
    }
    const fieldMap = completionEffects.imageField.material.map;
    if (fieldMap) {
      fieldMap.image = roomBgImage;
      fieldMap.needsUpdate = true;
    }
  }
  roomBackdrop.mesh.visible = false;
}

function layoutRoomBackdrop() {
  roomBackdrop.mesh.position.set(0, 0, ROOM_BACKDROP_Z);
  roomBackdrop.mesh.scale.set(viewport.width, viewport.height, 1);
}

function toWorld(nx, ny, z = 0) {
  return new THREE.Vector3((nx - 0.5) * viewport.width, (0.5 - ny) * viewport.height, z);
}
function worldToNorm(v) {
  return { x: v.x / viewport.width + 0.5, y: 0.5 - v.y / viewport.height };
}
function coreMetrics() {
  const canvasRect = canvas.getBoundingClientRect();
  const coreRect = coreFrame.getBoundingClientRect();
  const canvasWidth = Math.max(1, canvasRect.width);
  const canvasHeight = Math.max(1, canvasRect.height);
  return {
    left: (coreRect.left - canvasRect.left) / canvasWidth,
    top: (coreRect.top - canvasRect.top) / canvasHeight,
    width: coreRect.width / canvasWidth,
    height: coreRect.height / canvasHeight
  };
}

function artMetrics() {
  const canvasRect = canvas.getBoundingClientRect();
  const artRect = artStage.getBoundingClientRect();
  const canvasWidth = Math.max(1, canvasRect.width);
  const canvasHeight = Math.max(1, canvasRect.height);
  return {
    left: (artRect.left - canvasRect.left) / canvasWidth,
    top: (artRect.top - canvasRect.top) / canvasHeight,
    width: artRect.width / canvasWidth,
    height: artRect.height / canvasHeight
  };
}

function coreUnitW() {
  return coreMetrics().width * viewport.width;
}

function imageToWorld(nx, ny, z = 0) {
  const core = coreMetrics();
  return toWorld(core.left + nx * core.width, core.top + ny * core.height, z);
}

// A separate coordinate space for UI, overlays, and scene additions that are
// not painted into the source image. Unlike imageToWorld(), these coordinates
// always span the full visible browser viewport, including generated extensions.
function viewportMetrics() {
  const canvasRect = canvas.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  const canvasWidth = Math.max(1, canvasRect.width);
  const canvasHeight = Math.max(1, canvasRect.height);
  return {
    left: (rootRect.left - canvasRect.left) / canvasWidth,
    top: (rootRect.top - canvasRect.top) / canvasHeight,
    width: rootRect.width / canvasWidth,
    height: rootRect.height / canvasHeight
  };
}

function viewportToWorld(nx, ny, z = 0) {
  const visible = viewportMetrics();
  return toWorld(visible.left + nx * visible.width, visible.top + ny * visible.height, z);
}

function viewportWorldSize() {
  const visible = viewportMetrics();
  return {
    width: visible.width * viewport.width,
    height: visible.height * viewport.height
  };
}

function worldToImage(v) {
  const core = coreMetrics();
  const n = worldToNorm(v);
  return {
    x: (n.x - core.left) / Math.max(0.0001, core.width),
    y: (n.y - core.top) / Math.max(0.0001, core.height)
  };
}

function activeHoleRadiusN() {
  return activeLayout.holeRadiusN;
}

function activeOrbRadiusFactor() {
  return activeLayout.orbRadiusFactor;
}

function syncLayoutFromViewport() {
  const nextName = mobileLayoutQuery.matches ? 'mobile' : 'desktop';
  if (nextName === activeLayoutName) return;
  activeLayoutName = nextName;
  activeLayout = LAYOUTS[activeLayoutName];
  sockets.forEach((s, index) => {
    s.norm = { ...activeLayout.sockets[index] };
  });
  orbs.forEach((o, index) => {
    o.home = { ...activeLayout.orbHomes[index] };
    o.shadow = { ...DEFAULT_SHADOW, ...((activeLayout.orbShadow && activeLayout.orbShadow[index]) || {}) };
    if (o.seated == null) o.target = null;
  });
  syncRoomBackdropTexture();
  updateCalibrationConsole();
}

if (roomBgImage) {
  roomBgImage.addEventListener('load', () => {
    syncRoomBackdropTexture();
    layoutRoomBackdrop();
  });
}

/* ===== contact-shadow texture (soft dark ring at the rim) ========= */
// Radial gradient: clear in the centre so the orb stays lit, ramping to dark at
// the opening edge — overlaid on the seated orb to deepen the rim contact.
function makeContactShadowTexture() {
  const size = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, 'rgba(0,0,0,0)');
  g.addColorStop(0.6, 'rgba(0,0,0,0)');
  g.addColorStop(0.88, 'rgba(0,0,0,0.16)');
  g.addColorStop(1.0, 'rgba(0,0,0,0.40)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const contactShadowTex = makeContactShadowTexture();

// Soft round blob (dark centre fading out) cast on the wall behind a floating orb.
function makeBlobShadowTexture() {
  const size = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, 'rgba(0,0,0,0.38)');
  g.addColorStop(0.5, 'rgba(0,0,0,0.18)');
  g.addColorStop(1.0, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const blobShadowTex = makeBlobShadowTexture();

/* ===== build sockets (mask + contact shadow) ===================== */
const sockets = activeLayout.sockets.map((p, index) => {
  const group = new THREE.Group();
  scene.add(group);

  // Invisible mask annulus sitting IN FRONT of the orb (z set in layout). Inner edge
  // = the hole opening. Writes depth, draws no color, and renders first — so any orb
  // surface outside the opening is masked away (revealing the painted rim behind it)
  // while the orb stays full-size at the opening plane. Outer radius is kept modest so
  // one socket's mask can't reach over and clip a neighbouring seated orb.
  const occluder = new THREE.Mesh(
    new THREE.RingGeometry(1, 1.8, 64),
    new THREE.MeshBasicMaterial({ colorWrite: false })
  );
  occluder.renderOrder = -1; // write depth before the orbs draw, so overflow is masked
  group.add(occluder);

  // Contact shadow: soft dark ring drawn OVER the seated orb (inside the opening) to
  // darken where it meets the socket rim. Hidden until an orb is placed. z set in layout.
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(1, 48),
    new THREE.MeshBasicMaterial({ map: contactShadowTex, transparent: true, depthWrite: false })
  );
  shadow.renderOrder = 1; // after the orb, so it darkens it
  shadow.visible = false;
  group.add(shadow);

  // Calibrate only: a thin cyan guide sitting on the opening edge, drawn on top,
  // so you can align the clip line to the painted rim. It does not affect masking.
  let guide = null;
  if (calibrate) {
    guide = new THREE.Mesh(
      new THREE.RingGeometry(1, 1.16, 64),
      new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, depthTest: false })
    );
    guide.position.z = CONFIG.lipZ + 0.02;
    guide.renderOrder = 5;
    group.add(guide);
  }

  return { index, group, occluder, shadow, guide, filledBy: null, norm: { ...p } };
});

/* ===== build orbs ================================================= */
const orbMat = new THREE.MeshPhysicalMaterial({
  color: CONFIG.colors.orb,
  roughness: 0.48,
  metalness: 0.02,
  clearcoat: 0.16,
  clearcoatRoughness: 0.58
});
const orbs = activeLayout.orbHomes.map((p, index) => {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 36), orbMat.clone());
  scene.add(mesh);

  // Soft shadow cast on the wall behind the orb while it floats / is dragged.
  const floatShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: blobShadowTex, transparent: true, depthWrite: false })
  );
  floatShadow.renderOrder = -2; // behind the orbs
  scene.add(floatShadow);

  return {
    index, mesh, floatShadow,
    home: { ...p },
    seated: null,        // socket index when placed
    dragging: false,
    target: null,        // world Vector3 to ease toward (seat / return)
    phase: Math.random() * Math.PI * 2,
    pullX: 0, pullY: 0,  // eased cursor-gravity offset while floating
    shadow: { ...DEFAULT_SHADOW, ...((activeLayout.orbShadow && activeLayout.orbShadow[index]) || {}) } // per-orb shadow cast/skew/depth/z
  };
});

function placeOrbAtHome(orb) {
  const home = imageToWorld(orb.home.x, orb.home.y, CONFIG.homeZ);
  orb.mesh.position.copy(home);
  orb.mesh.rotation.set(0, 0, 0);
  orb.target = null;
  orb.dragging = false;
  orb.seated = null;
  orb.pullX = 0;
  orb.pullY = 0;
}

function resetOrbPlacements() {
  releaseActivePointer(activePointer);
  active = null;
  activePointer = null;
  root.classList.remove('is-dragging');
  sockets.forEach((socket) => {
    socket.filledBy = null;
    socket.shadow.visible = false;
  });
  orbs.forEach((orb) => placeOrbAtHome(orb));
}

/* ===== completion signal: red orb glow + socket ring ============== */
const completionColor = new THREE.Color(CONFIG.colors.completionRed);
const completionBaseOrbColor = new THREE.Color(CONFIG.colors.orb);
function makeBlockRingGeometry(innerR = 0.74, outerR = 1, depth = 0.18) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outerR, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, innerR, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.035,
    bevelSize: 0.028,
    bevelSegments: 2,
    curveSegments: 128
  });
  geometry.center();
  return geometry;
}

function createCompletionRippleTexture(size = 320) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return { canvas, ctx, texture };
}

function createRippleVideoTexture(video) {
  if (!video) return null;
  const texture = new THREE.VideoTexture(video);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function drawCompletionRipple(rippleField, elapsed = 0) {
  const rippleTexture = rippleField.userData.rippleTexture;
  if (!rippleTexture?.ctx) return;
  const { canvas, ctx, texture } = rippleTexture;
  const { width, height } = canvas;
  const cx = width * 0.5;
  const cy = height * 0.5;
  const maxR = Math.min(width, height) * 0.46;
  const phase = (elapsed * COMPLETION_RIPPLE_SPEED) % 1;
  const driftX = Math.sin(elapsed * 0.42) * width * 0.008;
  const driftY = Math.cos(elapsed * 0.31) * height * 0.006;
  const c1x = cx + driftX;
  const c1y = cy + driftY;
  const c2x = cx - driftX * 0.6 + width * 0.014;
  const c2y = cy - driftY * 0.4 - height * 0.012;

  ctx.clearRect(0, 0, width, height);

  const pool = ctx.createRadialGradient(cx, cy, maxR * 0.08, cx, cy, maxR);
  pool.addColorStop(0, 'rgba(114, 70, 38, 0.40)');
  pool.addColorStop(0.38, 'rgba(118, 72, 39, 0.38)');
  pool.addColorStop(0.74, 'rgba(126, 78, 43, 0.24)');
  pool.addColorStop(1, 'rgba(126, 78, 43, 0.02)');
  ctx.fillStyle = pool;
  ctx.beginPath();
  ctx.arc(cx, cy, maxR, 0, Math.PI * 2);
  ctx.fill();

  const sheen = ctx.createRadialGradient(c1x, c1y - maxR * 0.06, 0, cx, cy, maxR * 0.94);
  sheen.addColorStop(0, 'rgba(216, 176, 126, 0.10)');
  sheen.addColorStop(0.58, 'rgba(182, 132, 86, 0.05)');
  sheen.addColorStop(1, 'rgba(174, 126, 82, 0)');
  ctx.fillStyle = sheen;
  ctx.beginPath();
  ctx.arc(cx, cy, maxR * 0.94, 0, Math.PI * 2);
  ctx.fill();

  for (let i = 0; i < COMPLETION_RIPPLE_COUNT; i += 1) {
    const progress = (phase + i / COMPLETION_RIPPLE_COUNT) % 1;
    const eased = Math.pow(progress, 0.88);
    const wobble = Math.sin(elapsed * 0.95 + i * 1.4) * width * 0.0045;
    const radius = maxR * (0.04 + eased * 0.88) + wobble;
    const alpha = Math.pow(1 - progress, 1.35) * 0.30;
    ctx.lineWidth = Math.max(1.6, width * (0.013 - progress * 0.0068));
    ctx.strokeStyle = `rgba(233, 194, 146, ${alpha.toFixed(4)})`;
    ctx.beginPath();
    ctx.ellipse(c1x, c1y, radius, radius * 0.84, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.lineWidth = Math.max(1.1, width * (0.0064 - progress * 0.003));
    ctx.strokeStyle = `rgba(164, 108, 64, ${(alpha * 0.78).toFixed(4)})`;
    ctx.beginPath();
    ctx.ellipse(c2x, c2y, radius + width * 0.008, (radius + width * 0.008) * 0.86, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  texture.needsUpdate = true;
}

function playRingRippleVideo() {
  if (!ringRippleVideo) return;
  try {
    if (ringRippleVideo.readyState < 2) ringRippleVideo.load();
    ringRippleVideo.currentTime = 0;
  } catch {}
  const playAttempt = ringRippleVideo.play?.();
  if (playAttempt?.catch) playAttempt.catch(() => {});
}

function stopRingRippleVideo() {
  if (!ringRippleVideo) return;
  ringRippleVideo.pause?.();
  try { ringRippleVideo.currentTime = 0; } catch {}
}

const completionEffects = (() => {
  const recess = new THREE.Mesh(
    new THREE.RingGeometry(0.76, 1.02, 96),
    new THREE.MeshBasicMaterial({
      color: 0x691109,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide
    })
  );
  recess.renderOrder = 4;
  recess.visible = false;
  recess.userData.baseScale = new THREE.Vector3(1, 1, 1);
  recess.userData.surfacePosition = new THREE.Vector3();
  recess.userData.startOffset = new THREE.Vector3();
  scene.add(recess);

  const surfaceMask = new THREE.Mesh(
    new THREE.CircleGeometry(1.18, 96),
    new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: true,
      depthTest: false,
      side: THREE.DoubleSide
    })
  );
  surfaceMask.renderOrder = 5;
  surfaceMask.visible = false;
  surfaceMask.userData.baseScale = new THREE.Vector3(1, 1, 1);
  surfaceMask.userData.surfacePosition = new THREE.Vector3();
  scene.add(surfaceMask);

  const ringBody = new THREE.Mesh(
    makeBlockRingGeometry(0.76, 1, COMPLETION_RING_DEPTH),
    new THREE.MeshStandardMaterial({
      color: COMPLETION_RING_BODY_COLOR,
      roughness: 0.62,
      metalness: 0.02,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: true
    })
  );
  ringBody.renderOrder = 6;
  ringBody.visible = false;
  ringBody.userData.baseScale = new THREE.Vector3(1, 1, 1);
  ringBody.userData.surfacePosition = new THREE.Vector3();
  ringBody.userData.startOffset = new THREE.Vector3();
  scene.add(ringBody);

  const ring = new THREE.Mesh(
    makeBlockRingGeometry(0.76, 1, COMPLETION_RING_DEPTH),
    new THREE.MeshStandardMaterial({
      color: COMPLETION_RING_COLOR,
      roughness: 0.46,
      metalness: 0.02,
      emissive: 0xb91d0f,
      emissiveIntensity: 0,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: true
    })
  );
  ring.renderOrder = 8;
  ring.visible = false;
  ring.userData.baseScale = new THREE.Vector3(1, 1, 1);
  ring.userData.surfacePosition = new THREE.Vector3();
  ring.userData.startOffset = new THREE.Vector3();
  scene.add(ring);

  const plugTexture = new THREE.Texture();
  plugTexture.colorSpace = THREE.SRGBColorSpace;
  const imagePlug = new THREE.Mesh(
    new THREE.CircleGeometry(1, 96),
    new THREE.MeshBasicMaterial({
      map: plugTexture,
      transparent: true,
      opacity: 1,
      depthWrite: true,
      depthTest: true,
      toneMapped: false
    })
  );
  imagePlug.renderOrder = 7;
  imagePlug.visible = false;
  imagePlug.userData.baseScale = new THREE.Vector3(1, 1, 1);
  imagePlug.userData.surfacePosition = new THREE.Vector3();
  imagePlug.userData.startOffset = new THREE.Vector3();
  imagePlug.userData.liftOffset = new THREE.Vector3();
  imagePlug.userData.textureRepeat = new THREE.Vector2(1, 1);
  imagePlug.userData.textureOffset = new THREE.Vector2(0, 0);
  scene.add(imagePlug);

  const rippleVideoTexture = createRippleVideoTexture(ringRippleVideo);
  const rippleVideoField = new THREE.Mesh(
    new THREE.CircleGeometry(1, 96),
    new THREE.MeshBasicMaterial({
      map: rippleVideoTexture,
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      toneMapped: false
    })
  );
  rippleVideoField.renderOrder = 7.55;
  rippleVideoField.visible = false;
  rippleVideoField.userData.baseScale = new THREE.Vector3(1, 1, 1);
  rippleVideoField.userData.surfacePosition = new THREE.Vector3();
  rippleVideoField.userData.startOffset = new THREE.Vector3();
  rippleVideoField.userData.liftOffset = new THREE.Vector3();
  rippleVideoField.userData.hasVideo = !!rippleVideoTexture;
  scene.add(rippleVideoField);

  const rippleTexture = createCompletionRippleTexture();
  const rippleField = new THREE.Mesh(
    new THREE.CircleGeometry(1, 96),
    new THREE.MeshBasicMaterial({
      map: rippleTexture.texture,
      color: 0x9b6a3c,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
      blending: THREE.NormalBlending
    })
  );
  rippleField.renderOrder = 7.8;
  rippleField.visible = false;
  rippleField.userData.baseScale = new THREE.Vector3(1, 1, 1);
  rippleField.userData.surfacePosition = new THREE.Vector3();
  rippleField.userData.startOffset = new THREE.Vector3();
  rippleField.userData.liftOffset = new THREE.Vector3();
  rippleField.userData.rippleTexture = rippleTexture;
  scene.add(rippleField);

  const fieldTexture = new THREE.Texture();
  fieldTexture.colorSpace = THREE.SRGBColorSpace;
  const imageField = new THREE.Mesh(
    new THREE.CircleGeometry(1, 96),
    new THREE.MeshBasicMaterial({
      map: fieldTexture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      toneMapped: false
    })
  );
  imageField.renderOrder = 6;
  imageField.visible = false;
  imageField.userData.baseScale = new THREE.Vector3(1, 1, 1);
  imageField.userData.surfacePosition = new THREE.Vector3();
  imageField.userData.startOffset = new THREE.Vector3();
  imageField.userData.liftOffset = new THREE.Vector3();
  imageField.userData.textureRepeat = new THREE.Vector2(1, 1);
  imageField.userData.textureOffset = new THREE.Vector2(0, 0);
  scene.add(imageField);

  return {
    recess,
    surfaceMask,
    ringBody,
    ring,
    imagePlug,
    rippleVideoField,
    rippleField,
    imageField,
    active: false,
    elapsed: 0,
    config: activeLayout.completionRing
  };
})();

/* ===== shape stream: solid matte shapes pouring from the ring ===== *
 * A continuous trickle of solid matte prisms (circle / square / triangle /
 * pentagon / hexagon) emerges from the centre of the completion ring, falls
 * under gravity, and piles up on the floor — gradually filling the room.
 * A coarse heightmap of "buckets" across the room floor lets settled shapes
 * stack on one another so the pile mounds naturally instead of overlapping.
 * ================================================================== */
const SHAPE_STREAM = {
  enabled: true,
  maxShapes: 980,      // hard cap for performance
  spawnInterval: 0.10, // seconds between spawns
  gravity: -17,        // world units / s^2
  minSize: 0.30,       // shape radius (world units)
  maxSize: 0.30,
  depthRatio: 0.55,    // prism thickness relative to radius
  vxSpread: 0.48,      // jitter around the ballistic aim velocity (+/-)
  vyPop: 1.15,         // initial upward pop range
  spawnBurst: 2.55,
  spawnClearance: 0.72, // radius multiples to push new bodies out of the aperture
  spawnSideJitter: 0.42,
  spawnDownwardBias: 0.62,
  aimCompensation: 1.55,
  farAimCompensation: 1.25,
  landingSteerDuration: 1.25,
  landingSteerStrength: 3.8,
  landingSteerMaxSpeed: 14,
  maxLaunchSpeed: 18.5,
  maxUpwardSpeed: 0.95,
  maxAngularSpeed: 4.8,
  linearDamping: 1.25,
  angularDamping: 5.2,
  floorFriction: 2.8,
  wallFriction: 0.22,
  frontBoundaryClearance: 1.15,
  shapeFriction: 2.35,
  phaseMinDuration: 1.8,
  phaseBlendDuration: 0.18,
  landingPhases: [
    { name: 'source', duration: 0.8, followSource: true, widthSpread: 0.10, depthSpread: 0.08 },
    { name: 'back-center', duration: 2.0, widthT: 0.172, depthT: 0.078, widthSpread: 0.36, depthSpread: 0.05 },
    { name: 'front-fill', duration: 2.2, widthT: 0.578, depthT: 0.990, widthSpread: 0.64, depthSpread: 0.22 },
    { name: 'center', duration: 1.9, widthT: 0.438, depthT: 0.297, widthSpread: 0.39, depthSpread: 0.16 },
    { name: 'front-right', duration: 2.1, widthT: 0.920, depthT: 0.990, widthSpread: 0.19, depthSpread: 0.22 },
    { name: 'back-right', duration: 2.0, widthT: 0.781, depthT: 0.250, widthSpread: 0.31, depthSpread: 0.19 },
    { name: 'left', duration: 2.0, widthT: 0.040, depthT: 0.940, widthSpread: 0.24, depthSpread: 0.24 },
    { name: 'right', duration: 2.0, widthT: 0.940, depthT: 0.640, widthSpread: 0.27, depthSpread: 0.30 }
  ],
  settleLinearThreshold: 0.055,
  settleAngularThreshold: 0.18,
  settleSleepDelay: 0.46,
  restitution: 0.26,   // floor/pile bounce
  wallBounce: 0.46,
  fillFactor: 1.64,    // how much a settled shape raises its bucket
  depthFillFactor: 0.88,
  z: CONFIG.homeZ
};
SHAPE_STREAM.phaseCrowdHeight = SHAPE_STREAM.maxSize * 7;
const SHAPE_STREAM_COLORS = [
  0xd01006, 0xf06c00, 0xffbb00, 0x008a22,
  0x00ced1, 0x006eff, 0xcb5cff
];
const BASE_SHAPE_STREAM_FLOOR_LAYOUTS = {
  desktop: {
    floor: {
      // One continuous floor field.
      frontLeft: { x: 0.0036, y: 0.9890 },
      frontRight: { x: 0.9980, y: 0.9970 },
      backLeft: { x: 0.5557, y: 0.6334 },
      leftCorner: { x: 0.005, y: 0.860 },
      backRight: { x: 0.9974, y: 0.8321 },
      apex: { x: 0.5480, y: 0.8230 },
      zFront: CONFIG.homeZ + 0.46,
      zBack: CONFIG.homeZ - 0.29,
      weight: 1
    }
  },
  mobile: {
    floor: {
      frontLeft: { x: -0.02, y: 0.972 },
      frontRight: { x: 1.02, y: 0.978 },
      backLeft: { x: 0.10, y: 0.745 },
      leftCorner: { x: 0.030, y: 0.860 },
      backRight: { x: 0.90, y: 0.765 },
      apex: { x: 0.525, y: 0.675 },
      zFront: CONFIG.homeZ + 0.42,
      zBack: CONFIG.homeZ - 0.28,
      weight: 1
    }
  }
};

const SHAPE_STREAM_LEFT_CORNER_DEPTH_T = 0.5;

function cloneShapeStreamFloorLayouts(layouts) {
  const cloneZone = (zone) => ({
    frontLeft: { ...zone.frontLeft },
    frontRight: { ...zone.frontRight },
    backLeft: { ...zone.backLeft },
    leftCorner: zone.leftCorner ? { ...zone.leftCorner } : {
      x: (zone.backLeft.x + zone.frontLeft.x) * 0.5,
      y: (zone.backLeft.y + zone.frontLeft.y) * 0.5
    },
    backRight: { ...zone.backRight },
    apex: zone.apex ? { ...zone.apex } : null,
    zFront: zone.zFront,
    zBack: zone.zBack,
    weight: zone.weight
  });

  return Object.fromEntries(
    Object.entries(layouts).map(([layoutName, zones]) => [
      layoutName,
      Object.fromEntries(Object.entries(zones).map(([zoneName, zone]) => [zoneName, cloneZone(zone)]))
    ])
  );
}

const SHAPE_STREAM_FLOOR_LAYOUTS = cloneShapeStreamFloorLayouts(BASE_SHAPE_STREAM_FLOOR_LAYOUTS);

const shapeStream = (() => {
  // One unit geometry per shape type (radius 1, axis along Z so the polygon
  // face points at the camera). Low radial segments -> faceted prisms.
  const depth = SHAPE_STREAM.depthRatio;
  const prism = (segments, twist = 0) => {
    const geo = new THREE.CylinderGeometry(1, 1, depth, segments);
    geo.rotateX(Math.PI / 2);     // lay the flat face toward the camera
    if (twist) geo.rotateZ(twist);
    return geo;
  };
  const geometries = [
    prism(48),              // circle
    prism(4, Math.PI / 4),  // square (flat top, not diamond)
    prism(3),               // triangle
    prism(5),               // pentagon
    prism(6)                // hexagon
  ];
  const palette = SHAPE_STREAM_COLORS.map((hex) => new THREE.MeshStandardMaterial({
    color: hex,
    roughness: 1.0,
    metalness: 0.0,
    flatShading: true
  }));

  const X_BUCKET_COUNT = 42;
  const DEPTH_BUCKET_COUNT = 18;
  const colliderVertices = geometries.map((geometry) => Float32Array.from(geometry.attributes.position.array));
  return {
    geometries,
    colliderVertices,
    palette,
    items: [],            // active shapes
    spawnTimer: 0,
    xBucketCount: X_BUCKET_COUNT,
    depthBucketCount: DEPTH_BUCKET_COUNT,
    zones: [],
    xMin: -5,
    xMax: 5,
    zMin: CONFIG.homeZ - 0.72,
    zMax: CONFIG.homeZ + 0.66,
    world: null,
    boundaryBodies: [],
    landingPhaseIndex: 0,
    landingPhaseElapsed: 0,
    previousLandingPhaseIndex: 0,
    landingPhaseBlendElapsed: SHAPE_STREAM.phaseBlendDuration,
    full: false
  };
})();

function layoutShapeStream() {
  const layoutSet = SHAPE_STREAM_FLOOR_LAYOUTS[activeLayoutName] || SHAPE_STREAM_FLOOR_LAYOUTS.desktop;
  const zoneEntries = Object.entries(layoutSet);
  shapeStream.zones = zoneEntries.map(([name, floorLayout]) => {
    const frontLeft = viewportToWorld(floorLayout.frontLeft.x, floorLayout.frontLeft.y, floorLayout.zFront);
    const frontRight = viewportToWorld(floorLayout.frontRight.x, floorLayout.frontRight.y, floorLayout.zFront);
    const backLeft = viewportToWorld(floorLayout.backLeft.x, floorLayout.backLeft.y, floorLayout.zBack);
    const leftCorner = viewportToWorld(
      floorLayout.leftCorner.x,
      floorLayout.leftCorner.y,
      THREE.MathUtils.lerp(floorLayout.zBack, floorLayout.zFront, SHAPE_STREAM_LEFT_CORNER_DEPTH_T)
    );
    const backRight = viewportToWorld(floorLayout.backRight.x, floorLayout.backRight.y, floorLayout.zBack);
    return {
      name,
      floorLayout,
      buckets: new Float32Array(shapeStream.xBucketCount * shapeStream.depthBucketCount),
      reservations: new Float32Array(shapeStream.xBucketCount * shapeStream.depthBucketCount),
      xMin: Math.min(frontLeft.x, frontRight.x, backLeft.x, leftCorner.x, backRight.x),
      xMax: Math.max(frontLeft.x, frontRight.x, backLeft.x, leftCorner.x, backRight.x),
      zMin: floorLayout.zBack,
      zMax: floorLayout.zFront,
      frontSpan: Math.max(0.0001, floorLayout.frontRight.x - floorLayout.frontLeft.x),
      weight: floorLayout.weight || 1
    };
  });
  shapeStream.xMin = Math.min(...shapeStream.zones.map((zone) => zone.xMin));
  shapeStream.xMax = Math.max(...shapeStream.zones.map((zone) => zone.xMax));
  shapeStream.zMin = Math.min(...shapeStream.zones.map((zone) => zone.zMin));
  shapeStream.zMax = Math.max(...shapeStream.zones.map((zone) => zone.zMax));
  rebuildShapeStreamPhysicsBounds();
}

function resetShapeStream() {
  // Clear the pile and physics state so the next ring-settle re-fills cleanly.
  for (const item of shapeStream.items) {
    scene.remove(item.mesh);
    if (shapeStream.world && item.body) shapeStream.world.removeRigidBody(item.body);
  }
  shapeStream.items.length = 0;
  shapeStream.zones.forEach((zone) => {
    zone.buckets.fill(0);
    zone.reservations.fill(0);
  });
  shapeStream.spawnTimer = 0;
  shapeStream.landingPhaseIndex = 0;
  shapeStream.previousLandingPhaseIndex = 0;
  shapeStream.landingPhaseElapsed = 0;
  shapeStream.landingPhaseBlendElapsed = SHAPE_STREAM.phaseBlendDuration;
  shapeStream.full = false;
}

function rapierQuat(quaternion) {
  return { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w };
}

function buildShapeStreamColliderDesc(index, size) {
  const raw = shapeStream.colliderVertices[index];
  const scaled = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) scaled[i] = raw[i] * size;
  const hull = RAPIER.ColliderDesc.convexHull(scaled);
  return hull || RAPIER.ColliderDesc.cuboid(size, size, size * SHAPE_STREAM.depthRatio * 0.5);
}

function createShapeStreamFixedBody(position, halfExtents, rotation = null, options = {}) {
  const body = shapeStream.world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(position.x, position.y, position.z)
  );
  if (rotation) body.setRotation(rapierQuat(rotation), true);
  const collider = RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
    .setFriction(options.friction ?? 1.1)
    .setRestitution(options.restitution ?? 0.02);
  shapeStream.world.createCollider(collider, body);
  shapeStream.boundaryBodies.push(body);
}

function rebuildShapeStreamPhysicsBounds() {
  if (!shapeStream.world) {
    shapeStream.world = new RAPIER.World({ x: 0, y: SHAPE_STREAM.gravity, z: 0 });
  }

  shapeStream.boundaryBodies.forEach((body) => shapeStream.world.removeRigidBody(body));
  shapeStream.boundaryBodies.length = 0;

  const floorZone = shapeStream.zones.find((zone) => zone.name === 'floor') || shapeStream.zones[0];
  const sampleGrid = [0, 0.2, 0.4, 0.6, 0.8, 1];
  const footprint = [];
  shapeStream.zones.forEach((zone) => {
    sampleGrid.forEach((depthT) => {
      sampleGrid.forEach((widthT) => {
        footprint.push(shapeStreamFloorSample(zone, depthT, widthT));
      });
    });
  });
  const xMin = Math.min(...footprint.map((sample) => sample.x));
  const xMax = Math.max(...footprint.map((sample) => sample.x));
  const yMin = Math.min(...footprint.map((sample) => sample.y));
  const yMax = Math.max(...footprint.map((sample) => sample.y));
  const zMin = Math.min(...footprint.map((sample) => sample.z));
  const zMax = Math.max(...footprint.map((sample) => sample.z));
  shapeStream.xMin = xMin;
  shapeStream.xMax = xMax;
  shapeStream.zMin = zMin;
  shapeStream.zMax = zMax;

  const toVector = (sample) => new THREE.Vector3(sample.x, sample.y, sample.z);
  const floorFront = toVector(shapeStreamFloorSample(floorZone, 0.92, 0.5));
  const floorBack = toVector(shapeStreamFloorSample(floorZone, 0.14, 0.5));
  const floorLeft = toVector(shapeStreamFloorSample(floorZone, 0.54, 0.10));
  const floorRight = toVector(shapeStreamFloorSample(floorZone, 0.54, 0.90));

  const floorCenter = floorFront.clone().add(floorBack).multiplyScalar(0.5);
  const axisZ = floorBack.clone().sub(floorFront).normalize();
  const axisX = floorRight.clone().sub(floorLeft).normalize();
  const softenedAxisZ = axisZ.clone();
  softenedAxisZ.y *= 0.38;
  softenedAxisZ.normalize();
  const floorNormal = new THREE.Vector3().crossVectors(axisX, softenedAxisZ).normalize();
  if (floorNormal.y < 0) floorNormal.multiplyScalar(-1);
  const floorRotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), floorNormal);
  const floorHalfExtents = new THREE.Vector3(
    Math.max(0.75, (xMax - xMin) * 0.62),
    0.10,
    Math.max(0.85, (zMax - zMin) * 0.56)
  );
  createShapeStreamFixedBody(
    floorCenter,
    floorHalfExtents,
    floorRotation,
    { friction: SHAPE_STREAM.floorFriction }
  );

  const wallMidY = 0;
  const wallHalfHeight = Math.max(6.5, viewport.height * 0.72);
  const zHalf = Math.max(0.65, (zMax - zMin) * 0.66);
  const xHalf = Math.max(0.65, (xMax - xMin) * 0.62);

  createShapeStreamFixedBody(
    new THREE.Vector3(xMin - 0.12, wallMidY, floorCenter.z + 0.02),
    new THREE.Vector3(0.18, wallHalfHeight, zHalf),
    null,
    { friction: SHAPE_STREAM.wallFriction }
  );
  createShapeStreamFixedBody(
    new THREE.Vector3(xMax + 0.12, wallMidY, floorCenter.z + 0.02),
    new THREE.Vector3(0.18, wallHalfHeight, zHalf),
    null,
    { friction: SHAPE_STREAM.wallFriction }
  );
  createShapeStreamFixedBody(
    new THREE.Vector3((xMin + xMax) * 0.5 + 0.04, wallMidY, zMin - 0.14),
    new THREE.Vector3(xHalf, wallHalfHeight, 0.18),
    null,
    { friction: SHAPE_STREAM.wallFriction }
  );
  const frontWallHalfDepth = 0.22;
  const frontWallGap = SHAPE_STREAM.maxSize * SHAPE_STREAM.frontBoundaryClearance;
  createShapeStreamFixedBody(
    new THREE.Vector3((xMin + xMax) * 0.5, wallMidY, zMax + frontWallGap + frontWallHalfDepth),
    new THREE.Vector3(xHalf, wallHalfHeight, frontWallHalfDepth),
    null,
    { friction: SHAPE_STREAM.wallFriction }
  );

  if (shapeStream.items.length) resetShapeStream();
}

function shapeStreamXBucketIndex(x) {
  const span = shapeStream.xMax - shapeStream.xMin || 1;
  const t = (x - shapeStream.xMin) / span;
  return THREE.MathUtils.clamp(Math.floor(t * shapeStream.xBucketCount), 0, shapeStream.xBucketCount - 1);
}

function shapeStreamDepthTForZ(zone, z) {
  const span = zone.zMax - zone.zMin || 1;
  return THREE.MathUtils.clamp((z - zone.zMin) / span, 0, 1);
}

function shapeStreamZBucketIndex(zone, z) {
  const t = shapeStreamDepthTForZ(zone, z);
  return THREE.MathUtils.clamp(Math.floor(t * shapeStream.depthBucketCount), 0, shapeStream.depthBucketCount - 1);
}

function shapeStreamBucketOffset(xBucket, zBucket) {
  return zBucket * shapeStream.xBucketCount + xBucket;
}

function shapeStreamBucketHeight(zone, xBucket, zBucket) {
  return zone.buckets[shapeStreamBucketOffset(xBucket, zBucket)];
}

function shapeStreamCrowdedHeight(zone, xBucket, zBucket) {
  const offset = shapeStreamBucketOffset(xBucket, zBucket);
  return zone.buckets[offset] + zone.reservations[offset];
}

function shapeStreamSignedRandom() {
  // Triangular-ish distribution: most targets stay near the active pour path,
  // while occasional wider throws keep the floor from becoming a narrow mound.
  return ((Math.random() + Math.random() + Math.random()) / 3 - 0.5) * 2;
}

function shapeStreamPhaseAt(index) {
  const phases = SHAPE_STREAM.landingPhases;
  if (!phases.length) return null;
  return phases[((index % phases.length) + phases.length) % phases.length];
}

function shapeStreamLandingPhaseTarget(zone, phase) {
  const source = completionEffects.ring.userData.surfacePosition;
  const sourceDepthT = THREE.MathUtils.clamp(shapeStreamDepthTForZ(zone, source.z), 0.08, 0.36);
  const sourceWidthT = THREE.MathUtils.clamp(shapeStreamWidthTForWorldX(zone, source.x, sourceDepthT), 0.08, 0.92);
  return {
    name: phase?.name || 'floor',
    widthT: phase?.followSource ? sourceWidthT : THREE.MathUtils.clamp(phase?.widthT ?? 0.5, 0.01, 0.99),
    depthT: phase?.followSource ? sourceDepthT : THREE.MathUtils.clamp(phase?.depthT ?? 0.5, 0.02, 1),
    widthSpread: phase?.widthSpread ?? 0.22,
    depthSpread: phase?.depthSpread ?? 0.18
  };
}

function shapeStreamActiveLandingTarget(zone) {
  const activePhase = shapeStreamPhaseAt(shapeStream.landingPhaseIndex);
  const activeTarget = shapeStreamLandingPhaseTarget(zone, activePhase);
  const previousPhase = shapeStreamPhaseAt(shapeStream.previousLandingPhaseIndex);
  const blendT = ease01(THREE.MathUtils.clamp(
    shapeStream.landingPhaseBlendElapsed / Math.max(0.001, SHAPE_STREAM.phaseBlendDuration),
    0,
    1
  ));
  if (!previousPhase || shapeStream.previousLandingPhaseIndex === shapeStream.landingPhaseIndex || blendT >= 1) {
    return activeTarget;
  }

  const previousTarget = shapeStreamLandingPhaseTarget(zone, previousPhase);
  return {
    name: activeTarget.name,
    widthT: THREE.MathUtils.lerp(previousTarget.widthT, activeTarget.widthT, blendT),
    depthT: THREE.MathUtils.lerp(previousTarget.depthT, activeTarget.depthT, blendT),
    widthSpread: THREE.MathUtils.lerp(previousTarget.widthSpread, activeTarget.widthSpread, blendT),
    depthSpread: THREE.MathUtils.lerp(previousTarget.depthSpread, activeTarget.depthSpread, blendT)
  };
}

function shapeStreamLandingPressure(zoneIndex = 0) {
  const zone = shapeStream.zones[zoneIndex] || shapeStream.zones[0];
  if (!zone) return 0;
  const phase = shapeStreamPhaseAt(shapeStream.landingPhaseIndex);
  const target = shapeStreamLandingPhaseTarget(zone, phase);
  const centerX = THREE.MathUtils.clamp(
    Math.floor(target.widthT * shapeStream.xBucketCount),
    0,
    shapeStream.xBucketCount - 1
  );
  const centerZ = THREE.MathUtils.clamp(
    Math.floor(target.depthT * shapeStream.depthBucketCount),
    0,
    shapeStream.depthBucketCount - 1
  );
  const radiusX = Math.max(2, Math.ceil(target.widthSpread * shapeStream.xBucketCount * 0.55));
  const radiusZ = Math.max(2, Math.ceil(target.depthSpread * shapeStream.depthBucketCount * 0.7));
  let pressure = 0;

  for (let z = Math.max(0, centerZ - radiusZ); z <= Math.min(shapeStream.depthBucketCount - 1, centerZ + radiusZ); z += 1) {
    for (let x = Math.max(0, centerX - radiusX); x <= Math.min(shapeStream.xBucketCount - 1, centerX + radiusX); x += 1) {
      const dx = (x - centerX) / Math.max(1, radiusX);
      const dz = (z - centerZ) / Math.max(1, radiusZ);
      if (dx * dx + dz * dz > 1.2) continue;
      pressure = Math.max(pressure, shapeStreamCrowdedHeight(zone, x, z));
    }
  }

  return pressure;
}

function advanceShapeStreamLandingPhase() {
  const phases = SHAPE_STREAM.landingPhases;
  if (!phases.length) return;
  shapeStream.previousLandingPhaseIndex = shapeStream.landingPhaseIndex;
  shapeStream.landingPhaseIndex = (shapeStream.landingPhaseIndex + 1) % phases.length;
  shapeStream.landingPhaseElapsed = 0;
  shapeStream.landingPhaseBlendElapsed = 0;
}

function updateShapeStreamLandingPhase(delta) {
  const phase = shapeStreamPhaseAt(shapeStream.landingPhaseIndex);
  if (!phase) return;
  shapeStream.landingPhaseElapsed += delta;
  shapeStream.landingPhaseBlendElapsed = Math.min(
    SHAPE_STREAM.phaseBlendDuration,
    shapeStream.landingPhaseBlendElapsed + delta
  );

  const timedOut = shapeStream.landingPhaseElapsed >= phase.duration;
  const canCrowdSwitch = shapeStream.landingPhaseElapsed >= SHAPE_STREAM.phaseMinDuration;
  const crowded = canCrowdSwitch
    && shapeStreamLandingPressure(0) >= SHAPE_STREAM.phaseCrowdHeight;
  if (timedOut || crowded) advanceShapeStreamLandingPhase();
}

function applyShapeStreamReservation(zone, xBucket, zBucket, lift, direction = 1) {
  const reserve = lift * direction;
  const centerOffset = shapeStreamBucketOffset(xBucket, zBucket);
  zone.reservations[centerOffset] = Math.max(0, zone.reservations[centerOffset] + reserve);
  if (xBucket > 0) {
    const leftOffset = shapeStreamBucketOffset(xBucket - 1, zBucket);
    zone.reservations[leftOffset] = Math.max(0, zone.reservations[leftOffset] + reserve * 0.3);
  }
  if (xBucket < shapeStream.xBucketCount - 1) {
    const rightOffset = shapeStreamBucketOffset(xBucket + 1, zBucket);
    zone.reservations[rightOffset] = Math.max(0, zone.reservations[rightOffset] + reserve * 0.3);
  }
  if (zBucket > 0) {
    const backOffset = shapeStreamBucketOffset(xBucket, zBucket - 1);
    zone.reservations[backOffset] = Math.max(0, zone.reservations[backOffset] + reserve * SHAPE_STREAM.depthFillFactor * 0.24);
  }
  if (zBucket < shapeStream.depthBucketCount - 1) {
    const frontOffset = shapeStreamBucketOffset(xBucket, zBucket + 1);
    zone.reservations[frontOffset] = Math.max(0, zone.reservations[frontOffset] + reserve * SHAPE_STREAM.depthFillFactor * 0.28);
  }
}

function shapeStreamRowBounds(zone, depthT) {
  const { floorLayout } = zone;
  const left = shapeStreamLeftEdgePoint(floorLayout, depthT);
  const right = {
    x: THREE.MathUtils.lerp(floorLayout.backRight.x, floorLayout.frontRight.x, depthT),
    y: THREE.MathUtils.lerp(floorLayout.backRight.y, floorLayout.frontRight.y, depthT)
  };
  return { left, right };
}

function shapeStreamLeftEdgePoint(floorLayout, depthT) {
  const leftCorner = floorLayout.leftCorner;
  if (!leftCorner) {
    return {
      x: THREE.MathUtils.lerp(floorLayout.backLeft.x, floorLayout.frontLeft.x, depthT),
      y: THREE.MathUtils.lerp(floorLayout.backLeft.y, floorLayout.frontLeft.y, depthT)
    };
  }
  if (depthT <= SHAPE_STREAM_LEFT_CORNER_DEPTH_T) {
    const localT = depthT / Math.max(0.0001, SHAPE_STREAM_LEFT_CORNER_DEPTH_T);
    return {
      x: THREE.MathUtils.lerp(floorLayout.backLeft.x, leftCorner.x, localT),
      y: THREE.MathUtils.lerp(floorLayout.backLeft.y, leftCorner.y, localT)
    };
  }
  const localT = (depthT - SHAPE_STREAM_LEFT_CORNER_DEPTH_T)
    / Math.max(0.0001, 1 - SHAPE_STREAM_LEFT_CORNER_DEPTH_T);
  return {
    x: THREE.MathUtils.lerp(leftCorner.x, floorLayout.frontLeft.x, localT),
    y: THREE.MathUtils.lerp(leftCorner.y, floorLayout.frontLeft.y, localT)
  };
}

function shapeStreamApexPull(depthT, widthT) {
  const centerWeight = Math.max(0, 1 - Math.abs(widthT - 0.5) / 0.5);
  const frontRelease = 1 - ease01((depthT - 0.78) / 0.22);
  return Math.pow(depthT, 1.25) * Math.pow(centerWeight, 0.9) * 0.14 * frontRelease;
}

function shapeStreamFloorSample(zone, depthT, widthT) {
  const row = shapeStreamRowBounds(zone, depthT);
  const baseX = THREE.MathUtils.lerp(row.left.x, row.right.x, widthT);
  const baseY = THREE.MathUtils.lerp(row.left.y, row.right.y, widthT);
  const apex = zone.floorLayout.apex || {
    x: (zone.floorLayout.backLeft.x + zone.floorLayout.backRight.x) * 0.5,
    y: Math.min(zone.floorLayout.backLeft.y, zone.floorLayout.backRight.y)
  };
  const centerWeight = Math.max(0, 1 - Math.abs(widthT - 0.5) / 0.5);
  const apexPull = Math.pow(depthT, 1.25) * Math.pow(centerWeight, 0.9) * 0.14;
  const nx = THREE.MathUtils.lerp(baseX, apex.x, apexPull);
  const ny = THREE.MathUtils.lerp(baseY, apex.y, apexPull);
  const z = THREE.MathUtils.lerp(zone.zMin, zone.zMax, depthT);
  return {
    ...viewportToWorld(nx, ny, z),
    nx,
    ny,
    depthT,
    widthT
  };
}

function shapeStreamPerspectiveScale(zone, depthT) {
  const row = shapeStreamRowBounds(zone, depthT);
  const rowSpan = Math.max(0.0001, row.right.x - row.left.x) * THREE.MathUtils.lerp(0.72, 1, Math.pow(depthT, 0.9));
  const perspective = rowSpan / zone.frontSpan;
  const depthBoost = THREE.MathUtils.lerp(0.90, 1.18, Math.pow(depthT, 0.82));
  return THREE.MathUtils.clamp(perspective * depthBoost, 0.52, 1.18);
}

function shapeStreamWidthTForWorldX(zone, worldX, depthT) {
  const row = shapeStreamRowBounds(zone, depthT);
  const worldLeft = viewportToWorld(row.left.x, row.left.y, THREE.MathUtils.lerp(zone.zMin, zone.zMax, depthT)).x;
  const worldRight = viewportToWorld(row.right.x, row.right.y, THREE.MathUtils.lerp(zone.zMin, zone.zMax, depthT)).x;
  const span = worldRight - worldLeft || 1;
  return THREE.MathUtils.clamp((worldX - worldLeft) / span, 0, 1);
}

function pickShapeStreamTargetCell() {
  // Keep one active landing patch at a time. The patch moves on a timed/crowded
  // rhythm, so the stream spreads without visibly forking at the ring.
  const candidates = [];
  shapeStream.zones.forEach((zone, zoneIndex) => {
    const target = shapeStreamActiveLandingTarget(zone);
    const centerWidthT = target.widthT;
    const centerDepthT = target.depthT;
    const widthSpread = target.widthSpread;
    const depthSpread = target.depthSpread;
    const frontFocused = centerDepthT >= 0.85;
    const minDepthT = frontFocused
      ? Math.max(0.84, centerDepthT - Math.max(0.10, depthSpread * 0.20))
      : 0.02;

    const sampleCount = frontFocused ? 30 : (centerWidthT > 0.84 ? 24 : 18);
    for (let i = 0; i < sampleCount; i += 1) {
      const wideThrow = i % 6 === 0 ? 1.36 : 1;
      const edgePull = centerWidthT > 0.84 && i % 4 === 0
        ? Math.random() * 0.08
        : 0;
      const rawWidthT = i === 0
        ? centerWidthT
        : centerWidthT + edgePull + shapeStreamSignedRandom() * widthSpread * wideThrow;
      const rawDepthT = i === 0
        ? centerDepthT
        : centerDepthT + shapeStreamSignedRandom() * depthSpread * wideThrow;
      const widthT = THREE.MathUtils.clamp(
        rawWidthT,
        0.01,
        0.99
      );
      const depthT = THREE.MathUtils.clamp(
        rawDepthT,
        minDepthT,
        1
      );
      const x = THREE.MathUtils.clamp(
        Math.floor(widthT * shapeStream.xBucketCount),
        0,
        shapeStream.xBucketCount - 1
      );
      const z = THREE.MathUtils.clamp(
        Math.floor(depthT * shapeStream.depthBucketCount),
        0,
        shapeStream.depthBucketCount - 1
      );
      const widthDist = (widthT - centerWidthT) / Math.max(0.001, widthSpread);
      const depthDist = (depthT - centerDepthT) / Math.max(0.001, depthSpread);
      const continuityPenalty = (widthDist * widthDist + depthDist * depthDist) * SHAPE_STREAM.maxSize * 0.24;
      const score = shapeStreamCrowdedHeight(zone, x, z)
        + continuityPenalty
        + Math.random() * SHAPE_STREAM.maxSize * 0.18;
      candidates.push({ zoneIndex, x, z, depthT, widthT, phaseName: target.name, score });
    }
  });
  if (!candidates.length) return { zoneIndex: 0, x: 0, z: shapeStream.depthBucketCount - 1 };
  return candidates.reduce((best, candidate) => (candidate.score < best.score ? candidate : best), candidates[0]);
}

function spawnStreamShape() {
  const geoIndex = Math.floor(Math.random() * shapeStream.geometries.length);
  const mat = shapeStream.palette[Math.floor(Math.random() * shapeStream.palette.length)];
  const mesh = new THREE.Mesh(shapeStream.geometries[geoIndex], mat);
  const size = SHAPE_STREAM.minSize + Math.random() * (SHAPE_STREAM.maxSize - SHAPE_STREAM.minSize);
  mesh.renderOrder = 1;

  const targetCell = pickShapeStreamTargetCell();
  const zone = shapeStream.zones[targetCell.zoneIndex] || shapeStream.zones[0];
  mesh.scale.setScalar(size);
  mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);

  // Aim each shape at one of the lowest cells in the unified floor field.
  const lowest = shapeStreamCrowdedHeight(zone, targetCell.x, targetCell.z);
  const targetDepthT = targetCell.depthT ?? THREE.MathUtils.clamp(
    (targetCell.z + Math.random()) / shapeStream.depthBucketCount,
    0.02,
    1
  );
  const targetWidthT = targetCell.widthT ?? THREE.MathUtils.clamp(
    (targetCell.x + Math.random()) / shapeStream.xBucketCount,
    0.01,
    0.99
  );
  const targetSample = shapeStreamFloorSample(zone, targetDepthT, targetWidthT);
  const targetX = targetSample.x;
  const targetZ = targetSample.z;
  const center = completionEffects.ring.userData.surfacePosition;
  const sourceZ = THREE.MathUtils.clamp(center.z, shapeStream.zMin + size, shapeStream.zMax - size);
  const spawnZ = THREE.MathUtils.clamp(
    THREE.MathUtils.lerp(sourceZ, targetZ, 0.22)
      + (Math.random() - 0.5) * (shapeStream.zMax - shapeStream.zMin) * 0.08,
    shapeStream.zMin + size,
    shapeStream.zMax - size
  );
  const throwDir = new THREE.Vector2(targetX - center.x, targetZ - spawnZ);
  if (throwDir.lengthSq() < 0.0001) throwDir.set(0.35, 1);
  throwDir.normalize();
  const sideDir = new THREE.Vector2(-throwDir.y, throwDir.x);
  const spawnClearance = size * SHAPE_STREAM.spawnClearance;
  const sideJitter = (Math.random() - 0.5) * size * SHAPE_STREAM.spawnSideJitter;
  const spawnPosition = new THREE.Vector3(
    center.x + throwDir.x * spawnClearance + sideDir.x * sideJitter,
    center.y,
    spawnZ + throwDir.y * spawnClearance + sideDir.y * sideJitter
  );
  const flowVector = new THREE.Vector3(targetX - spawnPosition.x, -SHAPE_STREAM.spawnDownwardBias, targetZ - spawnPosition.z);
  if (flowVector.lengthSq() < 0.0001) flowVector.set(1, -0.3, 0.18);
  flowVector.normalize();
  mesh.position.copy(spawnPosition);
  scene.add(mesh);

  const reservedLift = size * SHAPE_STREAM.fillFactor * 1.02;
  applyShapeStreamReservation(zone, targetCell.x, targetCell.z, reservedLift, 1);

  // Ballistic aim: solve for the horizontal velocity that lands the shape near
  // targetX/targetZ given the upward pop and gravity. Airtime = time to fall
  // from the spawn height down to the target surface (apex included).
  const vy0 = Math.random() * SHAPE_STREAM.vyPop;
  const surfaceY = targetSample.y + lowest;
  const fall = Math.max(0.5, mesh.position.y - surfaceY);
  const g = Math.abs(SHAPE_STREAM.gravity);
  // t for y(t)=y0+vy0*t-0.5*g*t^2 to reach surfaceY (the larger root).
  const airtime = (vy0 + Math.sqrt(vy0 * vy0 + 2 * g * fall)) / g;
  const safeAirtime = Math.max(0.25, airtime);
  const rightReach = THREE.MathUtils.clamp((targetWidthT - 0.72) / 0.27, 0, 1);
  const frontReach = THREE.MathUtils.clamp((targetDepthT - 0.70) / 0.28, 0, 1);
  const backReach = THREE.MathUtils.clamp((0.34 - targetDepthT) / 0.32, 0, 1);
  const xAimGain = SHAPE_STREAM.aimCompensation
    + SHAPE_STREAM.farAimCompensation * Math.max(rightReach, frontReach * 0.35);
  const zAimGain = SHAPE_STREAM.aimCompensation
    + SHAPE_STREAM.farAimCompensation * Math.max(frontReach, backReach * 0.7);
  const aimVx = ((targetX - mesh.position.x) / safeAirtime) * xAimGain;
  const aimVz = ((targetZ - mesh.position.z) / safeAirtime) * zAimGain;
  const burst = {
    x: flowVector.x * SHAPE_STREAM.spawnBurst,
    y: -Math.abs(flowVector.y) * SHAPE_STREAM.spawnBurst * 0.12,
    z: flowVector.z * SHAPE_STREAM.spawnBurst
  };

  const body = shapeStream.world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(mesh.position.x, mesh.position.y, mesh.position.z)
      .setLinearDamping(SHAPE_STREAM.linearDamping)
      .setAngularDamping(SHAPE_STREAM.angularDamping)
    );
  body.setRotation(rapierQuat(mesh.quaternion), true);
  const launchVelocity = new THREE.Vector3(
    aimVx + burst.x + (Math.random() - 0.5) * SHAPE_STREAM.vxSpread,
    vy0 + burst.y,
    aimVz + burst.z + (Math.random() - 0.5) * SHAPE_STREAM.vxSpread * 0.18
  );
  if (launchVelocity.length() > SHAPE_STREAM.maxLaunchSpeed) {
    launchVelocity.setLength(SHAPE_STREAM.maxLaunchSpeed);
  }
  body.setLinvel(
    {
      x: launchVelocity.x,
      y: launchVelocity.y,
      z: launchVelocity.z
    },
    true
  );
  body.setAngvel(
    {
      x: (Math.random() - 0.5) * 2.8,
      y: (Math.random() - 0.5) * 2.8,
      z: (Math.random() - 0.5) * 2.8
    },
    true
  );
  body.enableCcd(true);

  const colliderDesc = buildShapeStreamColliderDesc(geoIndex, size)
    .setFriction(SHAPE_STREAM.shapeFriction)
    .setRestitution(0.03)
    .setDensity(1.3);
  const collider = shapeStream.world.createCollider(colliderDesc, body);

  shapeStream.items.push({
    mesh,
    size,
    geoIndex,
    zoneIndex: targetCell.zoneIndex,
    body,
    collider,
    age: 0,
    target: {
      x: targetX,
      y: surfaceY,
      z: targetZ,
      widthT: targetWidthT,
      depthT: targetDepthT,
      phaseName: targetCell.phaseName || 'floor'
    },
    targetSurfaceY: surfaceY,
    reservation: {
      zoneIndex: targetCell.zoneIndex,
      xBucket: targetCell.x,
      zBucket: targetCell.z,
      lift: reservedLift
    },
    calmTime: 0,
    bucketCommitted: false,
    settled: false
  });
}

function steerShapeStreamItem(item, translation, linvel, delta) {
  if (!item.target || item.body.isSleeping() || item.age > SHAPE_STREAM.landingSteerDuration) return linvel;
  const heightAboveTarget = translation.y - item.target.y;
  if (heightAboveTarget <= item.size * 1.05) return linvel;

  const fallSpeed = Math.max(0.9, -linvel.y);
  const timeToTarget = THREE.MathUtils.clamp(heightAboveTarget / fallSpeed, 0.16, 0.75);
  const desired = new THREE.Vector2(
    (item.target.x - translation.x) / timeToTarget,
    (item.target.z - translation.z) / timeToTarget
  );
  if (desired.length() > SHAPE_STREAM.landingSteerMaxSpeed) {
    desired.setLength(SHAPE_STREAM.landingSteerMaxSpeed);
  }

  const steerT = THREE.MathUtils.clamp(delta * SHAPE_STREAM.landingSteerStrength, 0, 0.42);
  const steered = {
    x: THREE.MathUtils.lerp(linvel.x, desired.x, steerT),
    y: linvel.y,
    z: THREE.MathUtils.lerp(linvel.z, desired.y, steerT)
  };
  item.body.setLinvel(steered, true);
  return steered;
}

function updateShapeStream(delta) {
  if (!SHAPE_STREAM.enabled) return;
  if (!shapeStream.world) return;

  const ringBlackSettled = completionEffects.active
    && completionEffects.elapsed >= SHAPE_STREAM_START_TIME;

  if (ringBlackSettled && !shapeStream.full) updateShapeStreamLandingPhase(delta);

  if (ringBlackSettled && !shapeStream.full && shapeStream.items.length < SHAPE_STREAM.maxShapes) {
    shapeStream.spawnTimer += delta;
    while (shapeStream.spawnTimer >= SHAPE_STREAM.spawnInterval) {
      shapeStream.spawnTimer -= SHAPE_STREAM.spawnInterval;
      spawnStreamShape();
    }
  }

  shapeStream.world.integrationParameters.dt = delta;
  shapeStream.world.step();

  for (const item of shapeStream.items) {
    item.age += delta;
    let linvel = item.body.linvel();
    const angvel = item.body.angvel();
    const translation = item.body.translation();
    linvel = steerShapeStreamItem(item, translation, linvel, delta);
    const linearSpeed = Math.hypot(linvel.x, linvel.y, linvel.z);
    const angularSpeed = Math.hypot(angvel.x, angvel.y, angvel.z);
    if (item.age < 0.55) {
      if (linvel.y > SHAPE_STREAM.maxUpwardSpeed) {
        item.body.setLinvel({ x: linvel.x, y: SHAPE_STREAM.maxUpwardSpeed, z: linvel.z }, true);
      }
      if (angularSpeed > SHAPE_STREAM.maxAngularSpeed) {
        const scale = SHAPE_STREAM.maxAngularSpeed / Math.max(0.0001, angularSpeed);
        item.body.setAngvel({ x: angvel.x * scale, y: angvel.y * scale, z: angvel.z * scale }, true);
      }
    }

    const nearlyStill = linearSpeed <= SHAPE_STREAM.settleLinearThreshold
      && angularSpeed <= SHAPE_STREAM.settleAngularThreshold;
    item.calmTime = nearlyStill ? item.calmTime + delta : 0;
    if (!item.body.isSleeping() && item.age > 0.9 && item.calmTime >= SHAPE_STREAM.settleSleepDelay) {
      item.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      item.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      item.body.sleep();
    }

    const rotation = item.body.rotation();
    item.mesh.position.set(translation.x, translation.y, translation.z);
    item.mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    item.mesh.scale.setScalar(item.size);

    const shouldReleaseReservation = item.reservation
      && (item.body.isSleeping() || item.age > 2.4 || translation.y <= item.targetSurfaceY + item.size * 1.8);
    if (shouldReleaseReservation) {
      const reservedZone = shapeStream.zones[item.reservation.zoneIndex] || shapeStream.zones[0];
      applyShapeStreamReservation(
        reservedZone,
        item.reservation.xBucket,
        item.reservation.zBucket,
        item.reservation.lift,
        -1
      );
      item.reservation = null;
    }

    if (!item.bucketCommitted && item.body.isSleeping()) {
      const zone = shapeStream.zones[item.zoneIndex] || shapeStream.zones[0];
      const depthT = shapeStreamDepthTForZ(zone, item.mesh.position.z);
      const widthT = shapeStreamWidthTForWorldX(zone, item.mesh.position.x, depthT);
      const xBucket = THREE.MathUtils.clamp(
        Math.floor(widthT * shapeStream.xBucketCount),
        0,
        shapeStream.xBucketCount - 1
      );
      const zBucket = shapeStreamZBucketIndex(zone, item.mesh.position.z);
      const lift = item.size * SHAPE_STREAM.fillFactor * 1.08;
      const centerOffset = shapeStreamBucketOffset(xBucket, zBucket);
      zone.buckets[centerOffset] += lift;
      if (xBucket > 0) zone.buckets[shapeStreamBucketOffset(xBucket - 1, zBucket)] += lift * 0.24;
      if (xBucket < shapeStream.xBucketCount - 1) zone.buckets[shapeStreamBucketOffset(xBucket + 1, zBucket)] += lift * 0.24;
      if (zBucket > 0) zone.buckets[shapeStreamBucketOffset(xBucket, zBucket - 1)] += lift * SHAPE_STREAM.depthFillFactor * 0.18;
      if (zBucket < shapeStream.depthBucketCount - 1) zone.buckets[shapeStreamBucketOffset(xBucket, zBucket + 1)] += lift * SHAPE_STREAM.depthFillFactor * 0.22;
      item.bucketCommitted = true;
      item.settled = true;
    } else if (item.bucketCommitted && !item.body.isSleeping()) {
      item.settled = false;
    }
  }

  if (!shapeStream.full) {
    if (shapeStream.items.length >= SHAPE_STREAM.maxShapes) shapeStream.full = true;
  }
}

/* ===== doorway sequence lock ====================================== */
const SHAPE_LOCK_ORDER = ['circle', 'triangle', 'square', 'pentagon', 'hexagon'];
const SHAPE_LOCK_LAYOUTS = {
  desktop: { x: 0.619, y: 0.555, sizeN: 0.024 },
  mobile: { x: 0.750, y: 0.600, sizeN: 0.030 }
};
const SHAPE_LOCK_TUNING = {
  doorColor: 0xdc9b4c,
  overlayColor: 0xeea449,
  overlayOpacity: 0.35,
  cycleMin: 3.0,
  cycleMax: 3.0,
  fadeTime: 0.36
};
const shapeLockRaycaster = new THREE.Raycaster();
const shapeLockPointer = new THREE.Vector2();
const shapeLock = {
  group: new THREE.Group(),
  overlayGroup: new THREE.Group(),
  symbols: [],
  overlays: [],
  progress: 0,
  solved: false,
  currentIndex: -1,
  cycleElapsed: 0,
  cycleDuration: 1,
  previewing: false,
  center: new THREE.Vector3(),
  scale: 0.2
};
shapeLock.group.visible = false;
shapeLock.group.renderOrder = 12;
scene.add(shapeLock.group);
shapeLock.overlayGroup.visible = false;
shapeLock.overlayGroup.renderOrder = 20;
scene.add(shapeLock.overlayGroup);

const lockGeometries = [
  new THREE.CircleGeometry(1, 48),
  new THREE.CircleGeometry(1, 3, Math.PI / 2),
  new THREE.CircleGeometry(1, 4, Math.PI / 4),
  new THREE.CircleGeometry(1, 5, Math.PI / 2),
  new THREE.CircleGeometry(1, 6, Math.PI / 2)
];
lockGeometries.forEach((geometry) => geometry.center());
const OVERLAY_VISUAL_SCALE = [1, 1.24, Math.SQRT2, 1.08, 1.075];
SHAPE_LOCK_ORDER.forEach((name, index) => {
  // Keep every cycling symbol at one exact color. A lit + emissive material
  // produced two perceived amber tones as opacity and room lighting changed.
  const material = new THREE.MeshBasicMaterial({
    color: SHAPE_LOCK_TUNING.doorColor,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
    toneMapped: false
  });
  const mesh = new THREE.Mesh(lockGeometries[index], material);
  mesh.renderOrder = 12;
  mesh.userData.lockName = name;
  mesh.userData.spin = (index % 2 ? -1 : 1) * (0.55 + index * 0.13);
  mesh.userData.phase = index * 1.31;
  mesh.visible = false;
  shapeLock.group.add(mesh);
  shapeLock.symbols.push(mesh);

  const overlay = new THREE.Mesh(
    lockGeometries[index],
    new THREE.MeshBasicMaterial({
      color: SHAPE_LOCK_TUNING.overlayColor,
      transparent: true,
      opacity: SHAPE_LOCK_TUNING.overlayOpacity,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide
    })
  );
  overlay.visible = false;
  overlay.renderOrder = 20;
  shapeLock.overlayGroup.add(overlay);
  shapeLock.overlays.push(overlay);
});

function layoutShapeLock() {
  const lockLayout = SHAPE_LOCK_LAYOUTS[activeLayoutName];
  const anchor = imageToWorld(lockLayout.x, lockLayout.y, 3.2);
  shapeLock.center.copy(anchor);
  shapeLock.scale = coreUnitW() * lockLayout.sizeN;
  shapeLock.group.position.copy(anchor);
  shapeLock.group.rotation.set(0, 0, 0);
  shapeLock.symbols.forEach((mesh, index) => {
    mesh.position.set(0, 0, index * 0.002);
    mesh.scale.setScalar(shapeLock.scale * OVERLAY_VISUAL_SCALE[index]);
  });

  // This is a screen overlay, not part of the painted door/socket frame.
  const visibleSize = viewportWorldSize();
  const overlayScale = Math.min(visibleSize.height * 0.11, visibleSize.width / 12.5);
  const overlayGap = overlayScale * 2.35;
  const overlayStartX = -overlayGap * (shapeLock.overlays.length - 1) * 0.5;
  shapeLock.overlayGroup.position.copy(viewportToWorld(0.5, 0.5, 4.2));
  shapeLock.overlays.forEach((mesh, index) => {
    mesh.position.set(overlayStartX + index * overlayGap, 0, index * 0.002);
    mesh.scale.setScalar(overlayScale * OVERLAY_VISUAL_SCALE[index]);
  });
}

function cycleShapeLockSymbol() {
  let nextIndex = Math.floor(Math.random() * shapeLock.symbols.length);
  if (shapeLock.symbols.length > 1 && nextIndex === shapeLock.currentIndex) {
    nextIndex = (nextIndex + 1 + Math.floor(Math.random() * (shapeLock.symbols.length - 1))) % shapeLock.symbols.length;
  }
  shapeLock.currentIndex = nextIndex;
  shapeLock.cycleElapsed = 0;
  shapeLock.cycleDuration = SHAPE_LOCK_TUNING.cycleMin
    + Math.random() * Math.max(0, SHAPE_LOCK_TUNING.cycleMax - SHAPE_LOCK_TUNING.cycleMin);
  shapeLock.symbols.forEach((mesh, index) => {
    mesh.visible = index === nextIndex;
    mesh.material.opacity = 0;
    mesh.rotation.z = 0;
    mesh.userData.spin = 0;
  });
}

function resetShapeLock() {
  shapeLock.progress = 0;
  shapeLock.solved = false;
  shapeLock.currentIndex = -1;
  shapeLock.cycleElapsed = 0;
  shapeLock.previewing = false;
  shapeLock.group.visible = false;
  shapeLock.overlayGroup.visible = false;
  shapeLock.symbols.forEach((mesh, index) => {
    mesh.visible = false;
    mesh.material.opacity = 0;
    mesh.material.color.setHex(SHAPE_LOCK_TUNING.doorColor);
  });
  shapeLock.overlays.forEach((mesh) => { mesh.visible = false; });
}

function setOverlayPreview(visible) {
  shapeLock.previewing = visible;
  shapeLock.overlayGroup.visible = visible || shapeLock.progress > 0;
  shapeLock.overlays.forEach((mesh, index) => {
    mesh.visible = visible || index < shapeLock.progress;
  });
}

function handleShapeLockAction(action) {
  if (action === 'preview') {
    setOverlayPreview(true);
    status.textContent = `settled overlay view - ${activeLayoutName}`;
  } else if (action === 'clear-preview') {
    setOverlayPreview(false);
    status.textContent = `overlay preview cleared - ${activeLayoutName}`;
  }
}

function colorNumber(value, fallback) {
  const parsed = Number.parseInt(String(value || '').replace('#', ''), 16);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function colorHex(value) {
  return `#${Number(value).toString(16).padStart(6, '0')}`;
}

function updateShapeStreamDerivedTuning() {
  SHAPE_STREAM.phaseCrowdHeight = SHAPE_STREAM.maxSize * 7;
}

function formatStreamColors() {
  return `[ ${SHAPE_STREAM_COLORS.map(colorHex).join(', ')} ]`;
}

function formatShapeStreamSize() {
  return `{ minSize: ${SHAPE_STREAM.minSize.toFixed(2)}, maxSize: ${SHAPE_STREAM.maxSize.toFixed(2)} }`;
}

function formatShapeStreamLandingPhases() {
  const phaseBlocks = SHAPE_STREAM.landingPhases.map((phase) => {
    const parts = [
      `name: '${phase.name}'`,
      `duration: ${phase.duration.toFixed(1)}`
    ];
    if (phase.followSource) {
      parts.push('followSource: true');
    } else {
      parts.push(`widthT: ${Number(phase.widthT ?? 0.5).toFixed(3)}`);
      parts.push(`depthT: ${Number(phase.depthT ?? 0.5).toFixed(3)}`);
    }
    parts.push(`widthSpread: ${Number(phase.widthSpread ?? 0.22).toFixed(2)}`);
    parts.push(`depthSpread: ${Number(phase.depthSpread ?? 0.18).toFixed(2)}`);
    return `  { ${parts.join(', ')} }`;
  });
  return `[\n${phaseBlocks.join(',\n')}\n]`;
}

function syncShapeStreamControls() {
  if (!calibrate) return;
  const values = {
    'min-size': SHAPE_STREAM.minSize,
    'max-size': SHAPE_STREAM.maxSize
  };
  Object.entries(values).forEach(([name, value]) => {
    const input = calibrationConsole?.querySelector(`[data-stream-control="${name}"]`);
    if (input && document.activeElement !== input) input.value = String(value);
  });
  SHAPE_STREAM_COLORS.forEach((color, index) => {
    const input = calibrationConsole?.querySelector(`[data-stream-color="${index}"]`);
    if (input && document.activeElement !== input) input.value = colorHex(color);
  });
}

function handleShapeStreamControl(input) {
  const control = input.dataset.streamControl;
  const numericValue = Number(input.value);
  if (control === 'min-size' && Number.isFinite(numericValue)) {
    SHAPE_STREAM.minSize = THREE.MathUtils.clamp(numericValue, 0.05, 0.8);
    SHAPE_STREAM.maxSize = Math.max(SHAPE_STREAM.maxSize, SHAPE_STREAM.minSize);
  } else if (control === 'max-size' && Number.isFinite(numericValue)) {
    SHAPE_STREAM.maxSize = THREE.MathUtils.clamp(numericValue, 0.05, 0.8);
    SHAPE_STREAM.minSize = Math.min(SHAPE_STREAM.minSize, SHAPE_STREAM.maxSize);
  }
  updateShapeStreamDerivedTuning();
  syncShapeStreamControls();
  updateCalibrationConsole();
}

function handleShapeStreamColor(input) {
  const index = Number(input.dataset.streamColor);
  if (!Number.isInteger(index) || index < 0 || index >= SHAPE_STREAM_COLORS.length) return;
  const color = colorNumber(input.value, SHAPE_STREAM_COLORS[index]);
  SHAPE_STREAM_COLORS[index] = color;
  shapeStream.palette[index]?.color.setHex(color);
  syncShapeStreamControls();
  updateCalibrationConsole();
}

function syncLandingPhaseControls() {
  if (!calibrate || !calibrationConsole) return;
  calibrationConsole.querySelectorAll('[data-phase-control]').forEach((input) => {
    if (document.activeElement === input) return;
    const [indexText, field] = String(input.dataset.phaseControl || '').split('.');
    const phase = SHAPE_STREAM.landingPhases[Number(indexText)];
    if (!phase || !(field in phase)) return;
    const digits = field.includes('Spread') ? 2 : 3;
    input.value = String(+Number(phase[field]).toFixed(digits));
  });
}

function handleLandingPhaseControl(input) {
  const [indexText, field] = String(input.dataset.phaseControl || '').split('.');
  const index = Number(indexText);
  const phase = SHAPE_STREAM.landingPhases[index];
  const numericValue = Number(input.value);
  if (!phase || phase.followSource || !Number.isFinite(numericValue)) return;
  if (field === 'widthT' || field === 'depthT') {
    phase[field] = +THREE.MathUtils.clamp(numericValue, 0, 1).toFixed(3);
  } else if (field === 'widthSpread' || field === 'depthSpread') {
    phase[field] = +THREE.MathUtils.clamp(numericValue, 0.02, 0.8).toFixed(2);
  } else {
    return;
  }
  applyLandingPhaseChange(`${phase.name} landing zone updated`);
}

const FLOOR_HANDLE_POINTS = [
  { key: 'frontLeft', label: 'FL' },
  { key: 'frontRight', label: 'FR' },
  { key: 'backLeft', label: 'BL' },
  { key: 'leftCorner', label: 'LC' },
  { key: 'backRight', label: 'BR' },
  { key: 'apex', label: 'AP' }
];
const FLOOR_CORNER_KEYS = ['frontLeft', 'frontRight', 'backRight', 'backLeft', 'leftCorner'];
const FLOOR_GRID_STEPS = [0, 0.2, 0.4, 0.6, 0.8, 1];
const LANDING_PHASE_PICK_STEPS = 64;
const floorEditor = {
  visible: false,
  editing: false,
  drag: null,
  svg: null,
  polygon: null,
  gridGroup: null,
  phaseGroup: null,
  handleGroup: null,
  handles: new Map()
};

function activeShapeStreamFloorLayout(layoutName = activeLayoutName) {
  const layoutSet = SHAPE_STREAM_FLOOR_LAYOUTS[layoutName] || SHAPE_STREAM_FLOOR_LAYOUTS.desktop;
  return layoutSet.floor || Object.values(layoutSet)[0];
}

function baseShapeStreamFloorLayout(layoutName = activeLayoutName) {
  const layoutSet = BASE_SHAPE_STREAM_FLOOR_LAYOUTS[layoutName] || BASE_SHAPE_STREAM_FLOOR_LAYOUTS.desktop;
  return layoutSet.floor || Object.values(layoutSet)[0];
}

function copyFloorLayout(target, source) {
  ['frontLeft', 'frontRight', 'backLeft', 'leftCorner', 'backRight', 'apex'].forEach((key) => {
    target[key] = { ...source[key] };
  });
  target.zFront = source.zFront;
  target.zBack = source.zBack;
  target.weight = source.weight;
}

function floorSvgElement(tagName, attrs = {}) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tagName);
  Object.entries(attrs).forEach(([name, value]) => element.setAttribute(name, value));
  return element;
}

function floorLayoutPointToScreen(point) {
  const rect = root.getBoundingClientRect();
  return {
    x: point.x * rect.width,
    y: point.y * rect.height
  };
}

function floorNormSample(floorLayout, depthT, widthT) {
  const left = shapeStreamLeftEdgePoint(floorLayout, depthT);
  const right = {
    x: THREE.MathUtils.lerp(floorLayout.backRight.x, floorLayout.frontRight.x, depthT),
    y: THREE.MathUtils.lerp(floorLayout.backRight.y, floorLayout.frontRight.y, depthT)
  };
  const baseX = THREE.MathUtils.lerp(left.x, right.x, widthT);
  const baseY = THREE.MathUtils.lerp(left.y, right.y, widthT);
  const apex = floorLayout.apex || {
    x: (floorLayout.backLeft.x + floorLayout.backRight.x) * 0.5,
    y: Math.min(floorLayout.backLeft.y, floorLayout.backRight.y)
  };
  const apexPull = shapeStreamApexPull(depthT, widthT);
  return {
    x: THREE.MathUtils.lerp(baseX, apex.x, apexPull),
    y: THREE.MathUtils.lerp(baseY, apex.y, apexPull)
  };
}

function floorSampleToScreen(floorLayout, depthT, widthT) {
  return floorLayoutPointToScreen(floorNormSample(floorLayout, depthT, widthT));
}

function injectFloorEditorStyles() {
  if (document.getElementById('entry-floor-editor-style')) return;
  const style = document.createElement('style');
  style.id = 'entry-floor-editor-style';
  style.textContent = `
    #entry-floor-editor {
      position: fixed;
      inset: 0;
      z-index: 4;
      display: none;
      width: 100vw;
      height: 100vh;
      overflow: visible;
      pointer-events: none;
      font-family: Arial, sans-serif;
    }
    #entry-floor-editor.is-visible { display: block; }
    #entry-floor-editor .entry-floor-fill {
      fill: rgba(0, 229, 255, 0.10);
      stroke: rgba(0, 229, 255, 0.86);
      stroke-width: 1.5;
      vector-effect: non-scaling-stroke;
    }
    #entry-floor-editor .entry-floor-grid {
      fill: none;
      stroke: rgba(0, 229, 255, 0.34);
      stroke-width: 1;
      vector-effect: non-scaling-stroke;
    }
    #entry-floor-editor .entry-floor-apex-line {
      fill: none;
      stroke: rgba(255, 206, 120, 0.68);
      stroke-dasharray: 5 5;
      stroke-width: 1;
      vector-effect: non-scaling-stroke;
    }
    #entry-floor-editor .entry-floor-phase-dot {
      fill: rgba(255, 206, 120, 0.92);
      stroke: rgba(12, 7, 4, 0.85);
      stroke-width: 2;
      vector-effect: non-scaling-stroke;
    }
    #entry-floor-editor .entry-floor-phase-spread {
      fill: rgba(255, 206, 120, 0.08);
      stroke: rgba(255, 206, 120, 0.56);
      stroke-dasharray: 4 4;
      stroke-width: 1;
      vector-effect: non-scaling-stroke;
    }
    #entry-floor-editor .entry-floor-phase-label,
    #entry-floor-editor .entry-floor-handle text {
      fill: rgba(255, 238, 210, 0.95);
      stroke: rgba(12, 7, 4, 0.9);
      stroke-width: 3;
      paint-order: stroke fill;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-anchor: middle;
      dominant-baseline: central;
      user-select: none;
    }
    #entry-floor-editor .entry-floor-phase-handle {
      pointer-events: none;
      cursor: default;
    }
    #entry-floor-editor .entry-floor-handle {
      pointer-events: none;
      cursor: default;
    }
    #entry-floor-editor .entry-floor-handle circle {
      fill: rgba(12, 7, 4, 0.86);
      stroke: rgba(0, 229, 255, 0.96);
      stroke-width: 2;
      vector-effect: non-scaling-stroke;
    }
    #entry-floor-editor.is-editing .entry-floor-handle {
      pointer-events: auto;
      cursor: grab;
    }
    #entry-floor-editor.is-editing .entry-floor-phase-handle {
      pointer-events: auto;
      cursor: grab;
    }
    #entry-floor-editor.is-editing .entry-floor-handle circle {
      fill: rgba(0, 229, 255, 0.22);
      stroke: rgba(255, 238, 210, 0.98);
    }
    #entry-floor-editor.is-editing .entry-floor-phase-dot {
      fill: rgba(255, 206, 120, 0.25);
      stroke: rgba(255, 238, 210, 0.98);
    }
    #entry-floor-editor.is-dragging .entry-floor-handle,
    #entry-floor-editor.is-dragging .entry-floor-phase-handle { cursor: grabbing; }
  `;
  document.head.appendChild(style);
}

function ensureFloorEditorOverlay() {
  if (!calibrate) return null;
  if (floorEditor.svg) return floorEditor.svg;
  injectFloorEditorStyles();
  const svg = floorSvgElement('svg', { id: 'entry-floor-editor', 'aria-hidden': 'true' });
  const gridGroup = floorSvgElement('g', { 'data-floor-grid': 'true' });
  const polygon = floorSvgElement('polygon', { class: 'entry-floor-fill' });
  const phaseGroup = floorSvgElement('g', { 'data-floor-phases': 'true' });
  const handleGroup = floorSvgElement('g', { 'data-floor-handles': 'true' });

  FLOOR_HANDLE_POINTS.forEach(({ key, label }) => {
    const handle = floorSvgElement('g', { class: 'entry-floor-handle', 'data-floor-handle': key });
    handle.appendChild(floorSvgElement('circle', { r: key === 'apex' ? 8 : 9 }));
    const text = floorSvgElement('text', { y: key === 'apex' ? -17 : -19 });
    text.textContent = label;
    handle.appendChild(text);
    handle.addEventListener('pointerdown', floorEditorPointerDown);
    handleGroup.appendChild(handle);
    floorEditor.handles.set(key, handle);
  });

  svg.appendChild(gridGroup);
  svg.appendChild(polygon);
  svg.appendChild(phaseGroup);
  svg.appendChild(handleGroup);
  svg.addEventListener('pointermove', floorEditorPointerMove);
  svg.addEventListener('pointerup', floorEditorPointerUp);
  svg.addEventListener('pointercancel', floorEditorPointerUp);
  document.body.appendChild(svg);

  floorEditor.svg = svg;
  floorEditor.gridGroup = gridGroup;
  floorEditor.polygon = polygon;
  floorEditor.phaseGroup = phaseGroup;
  floorEditor.handleGroup = handleGroup;
  return svg;
}

function drawFloorEditorGrid(floorLayout) {
  floorEditor.gridGroup.replaceChildren();
  FLOOR_GRID_STEPS.forEach((depthT) => {
    const points = [];
    for (let i = 0; i <= 10; i += 1) {
      const p = floorSampleToScreen(floorLayout, depthT, i / 10);
      points.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}`);
    }
    floorEditor.gridGroup.appendChild(floorSvgElement('polyline', {
      class: 'entry-floor-grid',
      points: points.join(' ')
    }));
  });
  FLOOR_GRID_STEPS.forEach((widthT) => {
    const points = [];
    for (let i = 0; i <= 10; i += 1) {
      const p = floorSampleToScreen(floorLayout, i / 10, widthT);
      points.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}`);
    }
    floorEditor.gridGroup.appendChild(floorSvgElement('polyline', {
      class: 'entry-floor-grid',
      points: points.join(' ')
    }));
  });
  const apex = floorLayoutPointToScreen(floorLayout.apex);
  const center = floorSampleToScreen(floorLayout, 0.58, 0.5);
  floorEditor.gridGroup.appendChild(floorSvgElement('line', {
    class: 'entry-floor-apex-line',
    x1: apex.x.toFixed(1),
    y1: apex.y.toFixed(1),
    x2: center.x.toFixed(1),
    y2: center.y.toFixed(1)
  }));
}

function drawFloorEditorPhases(floorLayout) {
  floorEditor.phaseGroup.replaceChildren();
  SHAPE_STREAM.landingPhases.forEach((phase, index) => {
    if (phase.followSource || !Number.isFinite(phase.depthT) || !Number.isFinite(phase.widthT)) return;
    const p = floorSampleToScreen(floorLayout, phase.depthT, phase.widthT);
    const left = floorSampleToScreen(
      floorLayout,
      phase.depthT,
      THREE.MathUtils.clamp(phase.widthT - (phase.widthSpread ?? 0.22) * 0.5, 0, 1)
    );
    const right = floorSampleToScreen(
      floorLayout,
      phase.depthT,
      THREE.MathUtils.clamp(phase.widthT + (phase.widthSpread ?? 0.22) * 0.5, 0, 1)
    );
    const back = floorSampleToScreen(
      floorLayout,
      THREE.MathUtils.clamp(phase.depthT - (phase.depthSpread ?? 0.18) * 0.5, 0, 1),
      phase.widthT
    );
    const front = floorSampleToScreen(
      floorLayout,
      THREE.MathUtils.clamp(phase.depthT + (phase.depthSpread ?? 0.18) * 0.5, 0, 1),
      phase.widthT
    );
    const handle = floorSvgElement('g', {
      class: 'entry-floor-phase-handle',
      'data-floor-phase': String(index),
      transform: `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`
    });
    handle.appendChild(floorSvgElement('ellipse', {
      class: 'entry-floor-phase-spread',
      rx: Math.max(7, Math.hypot(right.x - left.x, right.y - left.y) * 0.5).toFixed(1),
      ry: Math.max(6, Math.hypot(front.x - back.x, front.y - back.y) * 0.5).toFixed(1)
    }));
    handle.appendChild(floorSvgElement('circle', {
      class: 'entry-floor-phase-dot',
      r: 4.5
    }));
    const label = floorSvgElement('text', {
      class: 'entry-floor-phase-label',
      y: -13
    });
    label.textContent = phase.name;
    handle.appendChild(label);
    handle.addEventListener('pointerdown', floorEditorPhasePointerDown);
    floorEditor.phaseGroup.appendChild(handle);
  });
}

function syncFloorButtons() {
  if (!calibrationConsole) return;
  const toggle = calibrationConsole.querySelector('[data-floor-action="toggle"]');
  const edit = calibrationConsole.querySelector('[data-floor-action="edit"]');
  if (toggle) {
    toggle.textContent = floorEditor.visible ? 'Hide Floor' : 'Show Floor';
    toggle.setAttribute('aria-pressed', String(floorEditor.visible));
  }
  if (edit) {
    edit.textContent = floorEditor.editing ? 'Stop Edit Floor' : 'Edit Floor';
    edit.setAttribute('aria-pressed', String(floorEditor.editing));
  }
}

function drawFloorEditorOverlay() {
  if (!calibrate) return;
  const svg = ensureFloorEditorOverlay();
  if (!svg) return;
  const rect = root.getBoundingClientRect();
  svg.setAttribute('viewBox', `0 0 ${Math.max(1, rect.width)} ${Math.max(1, rect.height)}`);
  svg.classList.toggle('is-visible', floorEditor.visible || floorEditor.editing);
  svg.classList.toggle('is-editing', floorEditor.editing);
  svg.classList.toggle('is-dragging', !!floorEditor.drag);
  syncFloorButtons();
  if (!floorEditor.visible && !floorEditor.editing) return;

  const floorLayout = activeShapeStreamFloorLayout();
  const polygonPoints = FLOOR_CORNER_KEYS
    .map((key) => floorLayoutPointToScreen(floorLayout[key]))
    .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ');
  floorEditor.polygon.setAttribute('points', polygonPoints);
  drawFloorEditorGrid(floorLayout);
  drawFloorEditorPhases(floorLayout);
  FLOOR_HANDLE_POINTS.forEach(({ key }) => {
    const handle = floorEditor.handles.get(key);
    const p = floorLayoutPointToScreen(floorLayout[key]);
    handle?.setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`);
  });
}

function syncFloorEditorControls() {
  if (!calibrate || !calibrationConsole) return;
  const floorLayout = activeShapeStreamFloorLayout();
  const values = {
    'frontLeft.x': floorLayout.frontLeft.x,
    'frontLeft.y': floorLayout.frontLeft.y,
    'frontRight.x': floorLayout.frontRight.x,
    'frontRight.y': floorLayout.frontRight.y,
    'backLeft.x': floorLayout.backLeft.x,
    'backLeft.y': floorLayout.backLeft.y,
    'leftCorner.x': floorLayout.leftCorner.x,
    'leftCorner.y': floorLayout.leftCorner.y,
    'backRight.x': floorLayout.backRight.x,
    'backRight.y': floorLayout.backRight.y,
    'apex.x': floorLayout.apex.x,
    'apex.y': floorLayout.apex.y,
    zBack: floorLayout.zBack,
    zFront: floorLayout.zFront
  };
  Object.entries(values).forEach(([name, value]) => {
    const input = calibrationConsole.querySelector(`[data-floor-control="${name}"]`);
    if (input && document.activeElement !== input) input.value = String(+Number(value).toFixed(4));
  });
}

function applyFloorEditorChange(message = 'floor updated') {
  layoutShapeStream();
  drawFloorEditorOverlay();
  syncFloorEditorControls();
  updateCalibrationConsole();
  status.textContent = `${message} - ${activeLayoutName}`;
}

function handleFloorControl(input) {
  const control = input.dataset.floorControl;
  const numericValue = Number(input.value);
  if (!Number.isFinite(numericValue)) return;
  const floorLayout = activeShapeStreamFloorLayout();
  if (control === 'zBack') {
    floorLayout.zBack = THREE.MathUtils.clamp(numericValue, -2, 4);
    if (floorLayout.zBack > floorLayout.zFront - 0.05) {
      floorLayout.zFront = Math.min(4, floorLayout.zBack + 0.05);
      floorLayout.zBack = Math.min(floorLayout.zBack, floorLayout.zFront - 0.05);
    }
  } else if (control === 'zFront') {
    floorLayout.zFront = THREE.MathUtils.clamp(numericValue, -2, 4);
    if (floorLayout.zFront < floorLayout.zBack + 0.05) {
      floorLayout.zBack = Math.max(-2, floorLayout.zFront - 0.05);
      floorLayout.zFront = Math.max(floorLayout.zFront, floorLayout.zBack + 0.05);
    }
  } else {
    const [pointKey, axis] = control.split('.');
    if (!floorLayout[pointKey] || !['x', 'y'].includes(axis)) return;
    floorLayout[pointKey][axis] = +THREE.MathUtils.clamp(numericValue, -0.5, 1.5).toFixed(4);
  }
  applyFloorEditorChange('floor control updated');
}

function handleFloorAction(action) {
  if (action === 'toggle') {
    floorEditor.visible = !floorEditor.visible;
    if (!floorEditor.visible) floorEditor.editing = false;
    drawFloorEditorOverlay();
    status.textContent = floorEditor.visible ? `floor overlay shown - ${activeLayoutName}` : 'floor overlay hidden';
  } else if (action === 'edit') {
    floorEditor.editing = !floorEditor.editing;
    floorEditor.visible = true;
    drawFloorEditorOverlay();
    status.textContent = floorEditor.editing ? `floor handles active - ${activeLayoutName}` : `floor handles locked - ${activeLayoutName}`;
  } else if (action === 'reset-active') {
    copyFloorLayout(activeShapeStreamFloorLayout(), baseShapeStreamFloorLayout());
    floorEditor.visible = true;
    applyFloorEditorChange('floor reset');
  }
  updateCalibrationConsole();
}

function nearestFloorUVForScreen(floorLayout, screenX, screenY) {
  let best = { widthT: 0.5, depthT: 0.5, distance: Infinity };
  for (let depthStep = 0; depthStep <= LANDING_PHASE_PICK_STEPS; depthStep += 1) {
    const depthT = depthStep / LANDING_PHASE_PICK_STEPS;
    for (let widthStep = 0; widthStep <= LANDING_PHASE_PICK_STEPS; widthStep += 1) {
      const widthT = widthStep / LANDING_PHASE_PICK_STEPS;
      const p = floorSampleToScreen(floorLayout, depthT, widthT);
      const dx = p.x - screenX;
      const dy = p.y - screenY;
      const distance = dx * dx + dy * dy;
      if (distance < best.distance) best = { widthT, depthT, distance };
    }
  }
  return best;
}

function applyLandingPhaseChange(message = 'landing zone updated') {
  if (shapeStream.items.length) resetShapeStream();
  drawFloorEditorOverlay();
  syncLandingPhaseControls();
  updateCalibrationConsole();
  status.textContent = `${message} - ${activeLayoutName}`;
}

function floorEditorPointerDown(event) {
  if (!floorEditor.editing) return;
  const handle = event.currentTarget;
  floorEditor.drag = {
    type: 'floor-handle',
    key: handle.dataset.floorHandle,
    pointerId: event.pointerId
  };
  floorEditor.svg?.setPointerCapture(event.pointerId);
  drawFloorEditorOverlay();
  event.preventDefault();
  event.stopPropagation();
}

function floorEditorPhasePointerDown(event) {
  if (!floorEditor.editing) return;
  const index = Number(event.currentTarget.dataset.floorPhase);
  const phase = SHAPE_STREAM.landingPhases[index];
  if (!phase || phase.followSource) return;
  floorEditor.drag = {
    type: 'phase',
    index,
    pointerId: event.pointerId
  };
  floorEditor.svg?.setPointerCapture(event.pointerId);
  drawFloorEditorOverlay();
  status.textContent = `dragging ${phase.name} landing zone`;
  event.preventDefault();
  event.stopPropagation();
}

function floorEditorPointerMove(event) {
  if (!floorEditor.drag || event.pointerId !== floorEditor.drag.pointerId) return;
  const rect = root.getBoundingClientRect();
  const floorLayout = activeShapeStreamFloorLayout();
  if (floorEditor.drag.type === 'phase') {
    const phase = SHAPE_STREAM.landingPhases[floorEditor.drag.index];
    if (!phase) return;
    const nearest = nearestFloorUVForScreen(
      floorLayout,
      event.clientX - rect.left,
      event.clientY - rect.top
    );
    phase.widthT = +nearest.widthT.toFixed(3);
    phase.depthT = +nearest.depthT.toFixed(3);
    applyLandingPhaseChange(`dragging ${phase.name}`);
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  const point = floorLayout[floorEditor.drag.key];
  if (!point) return;
  point.x = +THREE.MathUtils.clamp((event.clientX - rect.left) / Math.max(1, rect.width), -0.5, 1.5).toFixed(4);
  point.y = +THREE.MathUtils.clamp((event.clientY - rect.top) / Math.max(1, rect.height), -0.5, 1.5).toFixed(4);
  applyFloorEditorChange(`dragging ${floorEditor.drag.key}`);
  event.preventDefault();
  event.stopPropagation();
}

function floorEditorPointerUp(event) {
  if (!floorEditor.drag || event.pointerId !== floorEditor.drag.pointerId) return;
  const drag = floorEditor.drag;
  const label = drag.type === 'phase'
    ? SHAPE_STREAM.landingPhases[drag.index]?.name || 'landing zone'
    : drag.key;
  floorEditor.drag = null;
  try { floorEditor.svg?.releasePointerCapture(event.pointerId); } catch {}
  drawFloorEditorOverlay();
  updateCalibrationConsole();
  status.textContent = drag.type === 'phase'
    ? `landing ${label} set - ${activeLayoutName}`
    : `floor ${label} set - ${activeLayoutName}`;
  event.preventDefault();
  event.stopPropagation();
}

function syncShapeLockControls() {
  if (!calibrate) return;
  const lockLayout = SHAPE_LOCK_LAYOUTS[activeLayoutName];
  const values = {
    'door-color': colorHex(SHAPE_LOCK_TUNING.doorColor),
    'overlay-color': colorHex(SHAPE_LOCK_TUNING.overlayColor),
    'overlay-opacity': SHAPE_LOCK_TUNING.overlayOpacity,
    'cycle-min': SHAPE_LOCK_TUNING.cycleMin,
    'cycle-max': SHAPE_LOCK_TUNING.cycleMax,
    'fade-time': SHAPE_LOCK_TUNING.fadeTime,
    'door-x': lockLayout.x,
    'door-y': lockLayout.y,
    'door-size': lockLayout.sizeN
  };
  Object.entries(values).forEach(([name, value]) => {
    const input = calibrationConsole?.querySelector(`[data-lock-control="${name}"]`);
    if (input && document.activeElement !== input) input.value = String(value);
  });
}

function handleShapeLockControl(input) {
  const control = input.dataset.lockControl;
  const lockLayout = SHAPE_LOCK_LAYOUTS[activeLayoutName];
  const numericValue = Number(input.value);
  if (control === 'door-color') {
    SHAPE_LOCK_TUNING.doorColor = colorNumber(input.value, SHAPE_LOCK_TUNING.doorColor);
    shapeLock.symbols.forEach((mesh) => {
      mesh.material.color.setHex(SHAPE_LOCK_TUNING.doorColor);
    });
  } else if (control === 'overlay-color') {
    SHAPE_LOCK_TUNING.overlayColor = colorNumber(input.value, SHAPE_LOCK_TUNING.overlayColor);
    shapeLock.overlays.forEach((mesh) => mesh.material.color.setHex(SHAPE_LOCK_TUNING.overlayColor));
  } else if (control === 'overlay-opacity' && Number.isFinite(numericValue)) {
    SHAPE_LOCK_TUNING.overlayOpacity = THREE.MathUtils.clamp(numericValue, 0, 1);
    shapeLock.overlays.forEach((mesh) => { mesh.material.opacity = SHAPE_LOCK_TUNING.overlayOpacity; });
  } else if (control === 'cycle-min' && Number.isFinite(numericValue)) {
    SHAPE_LOCK_TUNING.cycleMin = THREE.MathUtils.clamp(numericValue, 0.2, 10);
    SHAPE_LOCK_TUNING.cycleMax = Math.max(SHAPE_LOCK_TUNING.cycleMax, SHAPE_LOCK_TUNING.cycleMin);
  } else if (control === 'cycle-max' && Number.isFinite(numericValue)) {
    SHAPE_LOCK_TUNING.cycleMax = THREE.MathUtils.clamp(numericValue, 0.2, 10);
    SHAPE_LOCK_TUNING.cycleMin = Math.min(SHAPE_LOCK_TUNING.cycleMin, SHAPE_LOCK_TUNING.cycleMax);
  } else if (control === 'fade-time' && Number.isFinite(numericValue)) {
    SHAPE_LOCK_TUNING.fadeTime = THREE.MathUtils.clamp(numericValue, 0.05, 4);
  } else if (control === 'door-x' && Number.isFinite(numericValue)) {
    lockLayout.x = THREE.MathUtils.clamp(numericValue, -0.5, 1.5);
    layoutShapeLock();
  } else if (control === 'door-y' && Number.isFinite(numericValue)) {
    lockLayout.y = THREE.MathUtils.clamp(numericValue, -0.5, 1.5);
    layoutShapeLock();
  } else if (control === 'door-size' && Number.isFinite(numericValue)) {
    lockLayout.sizeN = THREE.MathUtils.clamp(numericValue, 0.005, 0.1);
    layoutShapeLock();
  }
  syncShapeLockControls();
  updateCalibrationConsole();
}

function updateShapeLock(delta) {
  const lockStartTime = RING_SETTLED_TIME + RING_SETTLE_SEQUENCE_DURATION + SHAPE_LOCK_START_DELAY;
  const canBeginCycling = completionEffects.active && completionEffects.elapsed >= lockStartTime;
  if (!canBeginCycling || shapeLock.solved) {
    shapeLock.group.visible = false;
    return;
  }
  shapeLock.group.visible = true;
  if (shapeLock.currentIndex < 0) cycleShapeLockSymbol();
  shapeLock.cycleElapsed += delta;
  if (shapeLock.cycleElapsed >= shapeLock.cycleDuration) cycleShapeLockSymbol();
  const mesh = shapeLock.symbols[shapeLock.currentIndex];
  const fadeTime = Math.min(SHAPE_LOCK_TUNING.fadeTime, shapeLock.cycleDuration * 0.45);
  const fadeIn = THREE.MathUtils.clamp(shapeLock.cycleElapsed / fadeTime, 0, 1);
  const fadeOut = THREE.MathUtils.clamp((shapeLock.cycleDuration - shapeLock.cycleElapsed) / fadeTime, 0, 1);
  mesh.material.opacity = Math.min(fadeIn, fadeOut);
}

function handleShapeLockClick(event) {
  if (!shapeLock.group.visible || shapeLock.solved) return false;
  const rect = canvas.getBoundingClientRect();
  shapeLockPointer.set(
    ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
    -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1
  );
  shapeLockRaycaster.setFromCamera(shapeLockPointer, camera);
  const hit = shapeLockRaycaster.intersectObjects(shapeLock.symbols.filter((mesh) => mesh.visible), false)[0];
  if (!hit) return false;

  const clickedName = hit.object.userData.lockName;
  const expectedName = SHAPE_LOCK_ORDER[shapeLock.progress];
  if (clickedName === expectedName) {
    shapeLock.overlayGroup.visible = true;
    shapeLock.overlays[shapeLock.progress].visible = true;
    shapeLock.progress += 1;
    status.textContent = `door sequence ${shapeLock.progress} of ${SHAPE_LOCK_ORDER.length}`;
    if (shapeLock.progress >= SHAPE_LOCK_ORDER.length) {
      shapeLock.solved = true;
      shapeLock.group.visible = false;
      shapeLock.symbols.forEach((mesh) => {
        mesh.visible = false;
        mesh.material.opacity = 0;
      });
      status.textContent = 'door sequence complete';
    } else cycleShapeLockSymbol();
  } else {
    shapeLock.progress = 0;
    shapeLock.overlayGroup.visible = false;
    shapeLock.overlays.forEach((mesh) => { mesh.visible = false; });
    flashWrongShapeOverlay();
    status.textContent = 'wrong shape - sequence reset';
    cycleShapeLockSymbol();
  }
  event.preventDefault();
  return true;
}

/* ===== size + position everything (depends on viewport) =========== */
function layout() {
  const holeR = activeHoleRadiusN() * coreUnitW();
  const orbR = holeR * activeOrbRadiusFactor();

  const aspect = CONFIG.lipAspectX;
  sockets.forEach((s) => {
    const pos = imageToWorld(s.norm.x, s.norm.y, 0);
    s.group.position.set(pos.x, pos.y, 0);
    // inner edge of the annulus = the elliptical hole opening (X squished for perspective)
    s.occluder.scale.set(holeR * aspect, holeR, 1);
    s.occluder.position.z = orbR + 0.12; // mask sits in front of the orb's front pole
    s.shadow.scale.set(holeR * aspect, holeR, 1);
    s.shadow.position.z = orbR + 0.05; // just in front of the orb, behind the mask
    if (s.guide) s.guide.scale.set(holeR * aspect, holeR, 1);
  });

  orbs.forEach((o) => {
    o.orbR = orbR;
    o.mesh.scale.setScalar(orbR);
    if (o.seated == null && !o.dragging && !o.target) {
      const h = imageToWorld(o.home.x, o.home.y, CONFIG.homeZ);
      o.mesh.position.copy(h);
    }
  });

  layoutCompletionEffects(holeR, orbR);
  layoutShapeStream();
  layoutShapeLock();
}

function layoutCompletionEffects(holeR, orbR) {
  const ringConfig = activeLayout.completionRing || DESKTOP_COMPLETION_RING;
  const socketPositions = sockets.map((s) => imageToWorld(s.norm.x, s.norm.y, orbR + 0.18));
  const minX = Math.min(...socketPositions.map((pos) => pos.x));
  const maxX = Math.max(...socketPositions.map((pos) => pos.x));
  const minY = Math.min(...socketPositions.map((pos) => pos.y));
  const maxY = Math.max(...socketPositions.map((pos) => pos.y));
  const ringR = Math.max(maxX - minX, maxY - minY) * 0.5 + holeR * ringConfig.radiusPad;
  const anchor = imageToWorld(ringConfig.x, ringConfig.y, orbR + ringConfig.surfaceZ);
  const emergeOffset = new THREE.Vector3(
    holeR * ringConfig.emergeOffsetX,
    holeR * ringConfig.emergeOffsetY,
    holeR * ringConfig.emergeOffsetZ
  );
  const ringFrontHalfDepth = COMPLETION_RING_DEPTH * 0.5 + COMPLETION_RING_FRONT_CLEARANCE;
  const minStartZ = ROOM_BACKDROP_Z - anchor.z - ringFrontHalfDepth;
  emergeOffset.z = Math.min(emergeOffset.z, minStartZ);
  completionEffects.config = ringConfig;

  completionEffects.recess.position.set(anchor.x, anchor.y, orbR + ringConfig.recessZ);
  completionEffects.recess.userData.surfacePosition.copy(completionEffects.recess.position);
  completionEffects.recess.userData.startOffset.set(0, 0, 0);
  completionEffects.recess.userData.baseScale.set(ringR * ringConfig.aspectX, ringR * ringConfig.aspectY, 1);

  const maskPadX = Math.abs(holeR * ringConfig.emergeOffsetX) + Math.abs(holeR * ringConfig.bodyOffsetX) * 0.45 + holeR * 0.8;
  const maskPadY = Math.abs(holeR * ringConfig.emergeOffsetY) + Math.abs(holeR * ringConfig.bodyOffsetY) * 0.45 + holeR * 0.8;
  completionEffects.surfaceMask.position.set(anchor.x, anchor.y, anchor.z);
  completionEffects.surfaceMask.userData.surfacePosition.copy(completionEffects.surfaceMask.position);
  completionEffects.surfaceMask.userData.baseScale.set(
    ringR * ringConfig.aspectX + maskPadX,
    ringR * ringConfig.aspectY + maskPadY,
    1
  );

  completionEffects.ringBody.position.set(
    anchor.x + holeR * ringConfig.bodyOffsetX,
    anchor.y + holeR * ringConfig.bodyOffsetY,
    anchor.z + holeR * ringConfig.bodyOffsetZ
  );
  completionEffects.ringBody.userData.faceLockedPosition = new THREE.Vector3(anchor.x, anchor.y, anchor.z);
  completionEffects.ringBody.userData.surfacePosition.copy(completionEffects.ringBody.position);
  const bodyStartOffset = emergeOffset.clone();
  bodyStartOffset.z = Math.min(
    bodyStartOffset.z,
    ROOM_BACKDROP_Z - completionEffects.ringBody.userData.surfacePosition.z - ringFrontHalfDepth
  );
  completionEffects.ringBody.userData.startOffset.copy(bodyStartOffset);
  completionEffects.ringBody.userData.baseScale.set(ringR * ringConfig.aspectX, ringR * ringConfig.aspectY, 1);

  completionEffects.ring.position.copy(anchor);
  completionEffects.ring.userData.surfacePosition.copy(anchor);
  completionEffects.ring.userData.startOffset.copy(emergeOffset);
  completionEffects.ring.userData.baseScale.set(ringR * ringConfig.aspectX, ringR * ringConfig.aspectY, 1);

  const anchorNorm = worldToNorm(anchor);
  const art = artMetrics();
  const artWorldWidth = art.width * viewport.width;
  const artWorldHeight = art.height * viewport.height;
  const anchorArtX = (anchorNorm.x - art.left) / Math.max(0.0001, art.width);
  const anchorArtY = (anchorNorm.y - art.top) / Math.max(0.0001, art.height);
  const plugWidth = ringR * ringConfig.aspectX * COMPLETION_PATCH_SIZE;
  const plugHeight = ringR * ringConfig.aspectY * COMPLETION_PATCH_SIZE;
  const repeatX = THREE.MathUtils.clamp(plugWidth / Math.max(0.0001, artWorldWidth), 0.0001, 1);
  const repeatY = THREE.MathUtils.clamp(plugHeight / Math.max(0.0001, artWorldHeight), 0.0001, 1);
  const offsetX = THREE.MathUtils.clamp(anchorArtX - repeatX * 0.5, 0, 1 - repeatX);
  const offsetY = THREE.MathUtils.clamp(anchorArtY - repeatY * 0.5, 0, 1 - repeatY);

  completionEffects.imagePlug.position.copy(anchor);
  completionEffects.imagePlug.userData.surfacePosition.copy(anchor);
  completionEffects.imagePlug.userData.baseScale.set(plugWidth * 0.5, plugHeight * 0.5, 1);
  completionEffects.imagePlug.userData.startOffset.set(0, 0, holeR * COMPLETION_PATCH_START_Z);
  completionEffects.imagePlug.userData.liftOffset.set(
    holeR * ringConfig.emergeOffsetX * COMPLETION_PATCH_SHIFT,
    holeR * ringConfig.emergeOffsetY * COMPLETION_PATCH_SHIFT,
    holeR * COMPLETION_PATCH_LIFT
  );
  completionEffects.imagePlug.userData.textureRepeat.set(repeatX, repeatY);
  completionEffects.imagePlug.userData.textureOffset.set(offsetX, 1 - offsetY - repeatY);

  const plugMap = completionEffects.imagePlug.material.map;
  if (plugMap) {
    plugMap.repeat.copy(completionEffects.imagePlug.userData.textureRepeat);
    plugMap.offset.copy(completionEffects.imagePlug.userData.textureOffset);
    plugMap.needsUpdate = true;
  }

  completionEffects.rippleVideoField.position.copy(anchor);
  completionEffects.rippleVideoField.userData.surfacePosition.copy(anchor);
  completionEffects.rippleVideoField.userData.baseScale.set(
    completionEffects.imagePlug.userData.baseScale.x * 0.88,
    completionEffects.imagePlug.userData.baseScale.y * 0.88,
    1
  );
  completionEffects.rippleVideoField.userData.startOffset.set(0, 0, holeR * (COMPLETION_PATCH_START_Z + 0.015));
  completionEffects.rippleVideoField.userData.liftOffset.set(
    holeR * ringConfig.emergeOffsetX * COMPLETION_PATCH_SHIFT * 0.36,
    holeR * ringConfig.emergeOffsetY * COMPLETION_PATCH_SHIFT * 0.36,
    holeR * COMPLETION_PATCH_LIFT * 0.28
  );

  completionEffects.rippleField.position.copy(anchor);
  completionEffects.rippleField.userData.surfacePosition.copy(anchor);
  completionEffects.rippleField.userData.baseScale.set(
    completionEffects.imagePlug.userData.baseScale.x * COMPLETION_RIPPLE_SIZE,
    completionEffects.imagePlug.userData.baseScale.y * COMPLETION_RIPPLE_SIZE,
    1
  );
  completionEffects.rippleField.userData.startOffset.set(0, 0, holeR * (COMPLETION_PATCH_START_Z + 0.02));
  completionEffects.rippleField.userData.liftOffset.set(
    holeR * ringConfig.emergeOffsetX * COMPLETION_PATCH_SHIFT * 0.48,
    holeR * ringConfig.emergeOffsetY * COMPLETION_PATCH_SHIFT * 0.48,
    holeR * COMPLETION_PATCH_LIFT * 0.42
  );
  const fieldWidth = ringR * ringConfig.aspectX * COMPLETION_FIELD_SIZE;
  const fieldHeight = ringR * ringConfig.aspectY * COMPLETION_FIELD_SIZE;
  const fieldRepeatX = THREE.MathUtils.clamp(fieldWidth / Math.max(0.0001, artWorldWidth), 0.0001, 1);
  const fieldRepeatY = THREE.MathUtils.clamp(fieldHeight / Math.max(0.0001, artWorldHeight), 0.0001, 1);
  const fieldOffsetX = THREE.MathUtils.clamp(anchorArtX - fieldRepeatX * 0.5, 0, 1 - fieldRepeatX);
  const fieldOffsetY = THREE.MathUtils.clamp(anchorArtY - fieldRepeatY * 0.5, 0, 1 - fieldRepeatY);

  completionEffects.imageField.position.copy(anchor);
  completionEffects.imageField.userData.surfacePosition.copy(anchor);
  completionEffects.imageField.userData.baseScale.set(fieldWidth * 0.5, fieldHeight * 0.5, 1);
  completionEffects.imageField.userData.startOffset.set(0, 0, holeR * 0.01);
  completionEffects.imageField.userData.liftOffset.set(
    holeR * ringConfig.emergeOffsetX * COMPLETION_FIELD_SHIFT,
    holeR * ringConfig.emergeOffsetY * COMPLETION_FIELD_SHIFT,
    holeR * COMPLETION_FIELD_LIFT
  );
  completionEffects.imageField.userData.textureRepeat.set(fieldRepeatX, fieldRepeatY);
  completionEffects.imageField.userData.textureOffset.set(fieldOffsetX, 1 - fieldOffsetY - fieldRepeatY);

  const fieldMap = completionEffects.imageField.material.map;
  if (fieldMap) {
    fieldMap.repeat.copy(completionEffects.imageField.userData.textureRepeat);
    fieldMap.offset.copy(completionEffects.imageField.userData.textureOffset);
    fieldMap.needsUpdate = true;
  }

}

function seatWorld(socket, orbR) {
  // Orb sits AT the opening plane, full size; the front mask clips everything outside the ring.
  return imageToWorld(socket.norm.x, socket.norm.y, CONFIG.lipZ);
}

// Re-target any already-seated orbs after a live size/seat change.
function reseatPlaced() {
  orbs.forEach((o) => {
    if (o.seated == null) return;
    o.target = seatWorld(sockets[o.seated], o.orbR);
  });
}

/* ===== interaction (drag orbs, or sockets in calibrate mode) ====== */
let active = null, activePointer = null;
const dragOffset = new THREE.Vector3();
let pointerWorld = null; // live cursor position in world space, for the idle gravity pull

function eventToWorld(event, z) {
  const rect = canvas.getBoundingClientRect();
  const nx = (event.clientX - rect.left) / Math.max(1, rect.width);
  const ny = (event.clientY - rect.top) / Math.max(1, rect.height);
  return toWorld(nx, ny, z);
}

function nearestOrb(point) {
  let best = null;
  orbs.forEach((o) => {
    if (o.seated != null) return;
    const d = point.clone().setZ(o.mesh.position.z).distanceTo(o.mesh.position);
    if (d < o.orbR * 2.4 && (!best || d < best.d)) best = { o, d };
  });
  return best && best.o;
}

// Unbounded version of nearestOrb (no capture radius) used to pick which orb's
// shadow Z is being tuned while calibrating, based on the last known cursor position.
function nearestOrbUnbounded(point) {
  let best = null;
  orbs.forEach((o) => {
    const d = point.clone().setZ(o.mesh.position.z).distanceTo(o.mesh.position);
    if (!best || d < best.d) best = { o, d };
  });
  return best && best.o;
}
function nearestOpenSocket(orb) {
  let best = null;
  sockets.forEach((s) => {
    if (s.filledBy != null) return;
    const sp = imageToWorld(s.norm.x, s.norm.y, orb.mesh.position.z);
    const d = sp.distanceTo(orb.mesh.position);
    if (!best || d < best.d) best = { s, d };
  });
  return best;
}

function releaseActivePointer(pointerId) {
  if (pointerId == null) return;
  try { canvas.releasePointerCapture(pointerId); } catch {}
}

function finishActiveDrag({ pointerId = activePointer, interrupted = false } = {}) {
  if (!active) {
    releaseActivePointer(pointerId);
    return;
  }

  const orb = active;
  orb.dragging = false;

  if (interrupted) {
    if (calibrate) {
      const n = worldToImage(orb.mesh.position);
      orb.home.x = +n.x.toFixed(4);
      orb.home.y = +n.y.toFixed(4);
      dumpOrbHomes();
    } else {
      orb.target = imageToWorld(orb.home.x, orb.home.y, CONFIG.homeZ);
    }
  } else {
    const near = nearestOpenSocket(orb);
    const snapDist = Math.max(orb.orbR * 1.7, 0.07 * coreUnitW());
    if (near && near.d < snapDist) {
      orb.seated = near.s.index;
      near.s.filledBy = orb.index;
      near.s.shadow.visible = true;
      orb.mesh.position.copy(seatWorld(near.s, orb.orbR));
      orb.target = null;
      playSeatFeedback();
      updateStatus();
    } else if (calibrate) {
      const n = worldToImage(orb.mesh.position);
      orb.home.x = +n.x.toFixed(4);
      orb.home.y = +n.y.toFixed(4);
      orb.target = null;
      dumpOrbHomes();
    } else {
      orb.target = imageToWorld(orb.home.x, orb.home.y, CONFIG.homeZ);
    }
  }

  active = null;
  activePointer = null;
  root.classList.remove('is-dragging');
  releaseActivePointer(pointerId);
}

function pointerDown(event) {
  primeSeatFeedback();
  if (handleShapeLockClick(event)) return;
  if (active && event.pointerId !== activePointer) {
    event.preventDefault();
    return;
  }
  const point = eventToWorld(event, CONFIG.dragZ);
  const orb = nearestOrb(point);
  if (!orb) { if (calibrate) calibrateDown(event); return; }
  active = orb;
  activePointer = event.pointerId;
  orb.dragging = true;
  orb.target = null;
  orb.mesh.position.z = CONFIG.dragZ;
  dragOffset.copy(orb.mesh.position).sub(point);
  canvas.setPointerCapture(event.pointerId);
  root.classList.add('is-dragging');
  event.preventDefault();
}
function pointerMove(event) {
  pointerWorld = eventToWorld(event, CONFIG.homeZ);
  if (!active || event.pointerId !== activePointer) {
    if (calibrate) calibrateMove(event);
    return;
  }
  const point = eventToWorld(event, CONFIG.dragZ);
  active.mesh.position.copy(point).add(dragOffset);
  active.mesh.position.z = CONFIG.dragZ;
  const hw = viewport.width / 2 - active.orbR;
  const hh = viewport.height / 2 - active.orbR;
  active.mesh.position.x = THREE.MathUtils.clamp(active.mesh.position.x, -hw, hw);
  active.mesh.position.y = THREE.MathUtils.clamp(active.mesh.position.y, -hh, hh);
  event.preventDefault();
}
function pointerUp(event) {
  if (!active || event.pointerId !== activePointer) {
    if (calibrate) calibrateUp(event);
    return;
  }
  finishActiveDrag({ pointerId: event.pointerId, interrupted: false });
  event.preventDefault();
}

function updateStatus() {
  const n = sockets.filter((s) => s.filledBy != null).length;
  status.textContent = n >= sockets.length ? 'complete' : `${n} of ${sockets.length} placed`;
  if (n >= sockets.length) triggerCompletion();
}

function triggerCompletion() {
  if (completionEffects.active) return;
  startCompletionReplay();
}

function ease01(value) {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function easePullThrough(value) {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  const pulled = 1 - Math.pow(1 - t, 1.55);
  return pulled * pulled * (3 - 2 * pulled);
}

function setCompletionVisibility(visible) {
  completionEffects.recess.visible = visible;
  completionEffects.surfaceMask.visible = visible;
  completionEffects.ringBody.visible = visible;
  completionEffects.ring.visible = visible;
  completionEffects.imageField.visible = visible;
  completionEffects.imagePlug.visible = visible;
  completionEffects.rippleVideoField.visible = false;
  completionEffects.rippleField.visible = false;
}

function resetCompletionState({ keepRootClass = false } = {}) {
  resetShapeLock();
  resetShapeStream();
  resetSceneFx();
  completionEffects.active = false;
  completionEffects.elapsed = 0;
  setCompletionVisibility(false);
  completionEffects.recess.material.opacity = 0;
  completionEffects.ringBody.material.opacity = 0;
  completionEffects.ring.material.opacity = 0;
  completionEffects.ring.material.emissiveIntensity = 0;
  updateCompletionRingColor(0);
  completionEffects.imageField.material.opacity = 0;
  completionEffects.imagePlug.material.opacity = 1;
  completionEffects.rippleVideoField.material.opacity = 0;
  completionEffects.rippleField.material.opacity = 0;
  stopRingRippleVideo();
  if (!keepRootClass) root.classList.remove('is-complete');
}

function primeCompletionFrame() {
  completionEffects.surfaceMask.position.copy(completionEffects.surfaceMask.userData.surfacePosition);
  completionEffects.surfaceMask.scale.copy(completionEffects.surfaceMask.userData.baseScale);

  completionEffects.ringBody.position.copy(completionEffects.ringBody.userData.faceLockedPosition).add(completionEffects.ringBody.userData.startOffset);
  completionEffects.ringBody.scale.copy(completionEffects.ringBody.userData.baseScale).multiplyScalar(completionEffects.config.startScale || 1);
  completionEffects.ringBody.material.opacity = 1;

  completionEffects.ring.position.copy(completionEffects.ring.userData.surfacePosition).add(completionEffects.ring.userData.startOffset);
  completionEffects.ring.scale.copy(completionEffects.ring.userData.baseScale).multiplyScalar(completionEffects.config.startScale || 1);
  completionEffects.ring.material.opacity = 1;
  completionEffects.ring.material.emissiveIntensity = 0;

  completionEffects.imageField.position.copy(completionEffects.imageField.userData.surfacePosition).add(completionEffects.imageField.userData.startOffset);
  completionEffects.imageField.scale.copy(completionEffects.imageField.userData.baseScale);
  completionEffects.imageField.material.opacity = 0;

  completionEffects.imagePlug.position.copy(completionEffects.imagePlug.userData.surfacePosition).add(completionEffects.imagePlug.userData.startOffset);
  completionEffects.imagePlug.scale.copy(completionEffects.imagePlug.userData.baseScale);
  completionEffects.imagePlug.material.opacity = 1;

  completionEffects.rippleVideoField.position.copy(completionEffects.rippleVideoField.userData.surfacePosition).add(completionEffects.rippleVideoField.userData.startOffset);
  completionEffects.rippleVideoField.scale.copy(completionEffects.rippleVideoField.userData.baseScale).multiplyScalar(0.88);
  completionEffects.rippleVideoField.material.opacity = 0;

  completionEffects.rippleField.position.copy(completionEffects.rippleField.userData.surfacePosition).add(completionEffects.rippleField.userData.startOffset);
  completionEffects.rippleField.scale.copy(completionEffects.rippleField.userData.baseScale).multiplyScalar(0.92);
  completionEffects.rippleField.material.opacity = 0;
}

function startCompletionReplay() {
  resetCompletionState({ keepRootClass: true });
  primeCompletionFrame();
  completionEffects.active = true;
  completionEffects.elapsed = 0;
  root.classList.add('is-complete');
  setCompletionVisibility(true);
}

function settleCompletionInstantly() {
  startCompletionReplay();
  completionEffects.elapsed = RING_SETTLED_TIME;
  updateCompletionEffects(0);
}

function handleRingAction(action) {
  switch (action) {
    case 'replay':
      startCompletionReplay();
      status.textContent = `ring replay - ${activeLayoutName}`;
      break;
    case 'show':
      settleCompletionInstantly();
      status.textContent = `ring settled - ${activeLayoutName}`;
      break;
    case 'hide':
      resetCompletionState();
      status.textContent = `ring hidden - ${activeLayoutName}`;
      break;
    default:
      return;
  }
  updateCalibrationConsole();
}

function updateCompletionEffects(delta) {
  if (!completionEffects.active) return;
  completionEffects.elapsed += delta;
  const t = completionEffects.elapsed;
  const ringT = easePullThrough(t / 3.35);
  const patchT = easePullThrough(t / 4.6);

  orbs.forEach((o) => {
    o.mesh.material.color.copy(completionBaseOrbColor);
    o.mesh.material.emissive.set(0x000000);
    o.mesh.material.emissiveIntensity = 0;
  });

  completionEffects.recess.material.opacity = 0;
  completionEffects.surfaceMask.position.copy(completionEffects.surfaceMask.userData.surfacePosition);
  completionEffects.surfaceMask.scale.copy(completionEffects.surfaceMask.userData.baseScale);

  const ringStartScale = completionEffects.config.startScale || 1;
  const bodyOffsetBlend = ease01(Math.max(0, (ringT - 0.36) / 0.64));
  const ringBodyTravel = completionEffects.ringBody.userData.surfacePosition.clone()
    .sub(completionEffects.ringBody.userData.faceLockedPosition)
    .multiplyScalar(bodyOffsetBlend);

  completionEffects.ringBody.position.copy(completionEffects.ringBody.userData.faceLockedPosition)
    .addScaledVector(completionEffects.ringBody.userData.startOffset, 1 - ringT);
  completionEffects.ringBody.position.add(ringBodyTravel);
  completionEffects.ringBody.scale.copy(completionEffects.ringBody.userData.baseScale)
    .multiplyScalar(ringStartScale + (1 - ringStartScale) * ringT);
  completionEffects.ringBody.material.opacity = 1;

  completionEffects.ring.position.copy(completionEffects.ring.userData.surfacePosition)
    .addScaledVector(completionEffects.ring.userData.startOffset, 1 - ringT);
  completionEffects.ring.scale.copy(completionEffects.ring.userData.baseScale)
    .multiplyScalar(ringStartScale + (1 - ringStartScale) * ringT);
  completionEffects.ring.material.opacity = 1;
  completionEffects.ring.material.emissiveIntensity = 0;
  updateCompletionRingColor(t);

  completionEffects.imageField.position.copy(completionEffects.imageField.userData.surfacePosition)
    .add(completionEffects.imageField.userData.startOffset)
    .addScaledVector(completionEffects.imageField.userData.liftOffset, patchT);
  completionEffects.imageField.scale.copy(completionEffects.imageField.userData.baseScale)
    .multiplyScalar(1 + (COMPLETION_FIELD_SCALE - 1) * patchT);
  const fieldFadeT = THREE.MathUtils.clamp(
    (patchT - COMPLETION_FIELD_FADE_START) / Math.max(0.0001, 1 - COMPLETION_FIELD_FADE_START),
    0,
    1
  );
  completionEffects.imageField.material.opacity = COMPLETION_FIELD_OPACITY * (1 - ease01(fieldFadeT));

  completionEffects.imagePlug.position.copy(completionEffects.imagePlug.userData.surfacePosition)
    .add(completionEffects.imagePlug.userData.startOffset)
    .addScaledVector(completionEffects.imagePlug.userData.liftOffset, patchT);
  completionEffects.imagePlug.scale.copy(completionEffects.imagePlug.userData.baseScale)
    .multiplyScalar(1 - (1 - COMPLETION_PATCH_SETTLED_SCALE) * patchT);
  completionEffects.imagePlug.material.opacity = 1 - ease01(THREE.MathUtils.clamp((patchT - 0.36) / 0.44, 0, 1));

  completionEffects.rippleVideoField.position.copy(completionEffects.rippleVideoField.userData.surfacePosition)
    .add(completionEffects.rippleVideoField.userData.startOffset)
    .addScaledVector(completionEffects.rippleVideoField.userData.liftOffset, patchT);
  completionEffects.rippleVideoField.scale.copy(completionEffects.rippleVideoField.userData.baseScale)
    .multiplyScalar(0.8 + patchT * 0.18);
  completionEffects.rippleVideoField.material.opacity = 0;

  completionEffects.rippleField.position.copy(completionEffects.rippleField.userData.surfacePosition)
    .add(completionEffects.rippleField.userData.startOffset)
    .addScaledVector(completionEffects.rippleField.userData.liftOffset, patchT);
  completionEffects.rippleField.scale.copy(completionEffects.rippleField.userData.baseScale)
    .multiplyScalar(0.9 + patchT * 0.18);
  completionEffects.rippleField.material.opacity = 0;
}

function updateCompletionRingColor(elapsed) {
  const cycleElapsed = elapsed - RING_SETTLED_TIME;
  const colorElapsed = cycleElapsed - RING_COLOR_PAUSE_AFTER_EMERGENCE;
  const paletteDuration = (RING_PALETTE_COLORS.length - 1) * RING_PALETTE_COLOR_DURATION;
  const displayColor = new THREE.Color(COMPLETION_RING_COLOR);
  completionEffects.ring.material.emissive.setHex(COMPLETION_RING_SETTLED_COLOR);
  completionEffects.ring.material.emissiveIntensity = 0;

  if (colorElapsed >= paletteDuration) {
    const settleT = ease01(THREE.MathUtils.clamp(
      (colorElapsed - paletteDuration) / RING_SETTLE_FADE_DURATION,
      0,
      1
    ));
    const lastPaletteColor = new THREE.Color(RING_PALETTE_COLORS[RING_PALETTE_COLORS.length - 1]);
    const settledColor = new THREE.Color(COMPLETION_RING_SETTLED_COLOR);
    displayColor.copy(lastPaletteColor).lerp(settledColor, settleT);
  } else if (colorElapsed >= 0) {
    const index = Math.min(
      RING_PALETTE_COLORS.length - 2,
      Math.floor(colorElapsed / RING_PALETTE_COLOR_DURATION)
    );
    const localT = (colorElapsed % RING_PALETTE_COLOR_DURATION) / RING_PALETTE_COLOR_DURATION;
    const nextColor = new THREE.Color(RING_PALETTE_COLORS[index + 1]);
    displayColor.setHex(RING_PALETTE_COLORS[index]).lerp(nextColor, ease01(localT));
  }

  completionEffects.ring.material.color.copy(displayColor);
  completionEffects.ringBody.material.color.copy(displayColor).multiplyScalar(0.58);
}

function formatPointList(points) {
  return points.map((p) => `{ x: ${Number(p.x).toFixed(4)}, y: ${Number(p.y).toFixed(4)} }`).join(', ');
}

function activeSocketText() {
  return `sockets: [\n  ${formatPointList(sockets.map((s) => s.norm)).replaceAll(' }, {', ' },\n  {')}\n]`;
}

function activeOrbHomeText() {
  return `orbHomes: [\n  ${formatPointList(orbs.map((o) => o.home)).replaceAll(' }, {', ' },\n  {')}\n]`;
}

function activeOrbShadowText() {
  return `orbShadow: [\n  ${orbs.map((o) => formatShadow(o.shadow)).join(',\n  ')}\n]`;
}

function activeCompletionRingText() {
  const ring = activeLayout.completionRing || DESKTOP_COMPLETION_RING;
  return [
    'completionRing: {',
    `  x: ${ring.x.toFixed(4)}, y: ${ring.y.toFixed(4)},`,
    `  aspectX: ${ring.aspectX.toFixed(2)}, aspectY: ${ring.aspectY.toFixed(2)},`,
    `  radiusPad: ${ring.radiusPad.toFixed(2)}, surfaceZ: ${ring.surfaceZ.toFixed(2)}, recessZ: ${ring.recessZ.toFixed(2)},`,
    `  bodyOffsetX: ${ring.bodyOffsetX.toFixed(2)}, bodyOffsetY: ${ring.bodyOffsetY.toFixed(2)}, bodyOffsetZ: ${ring.bodyOffsetZ.toFixed(2)},`,
    `  emergeOffsetX: ${ring.emergeOffsetX.toFixed(2)}, emergeOffsetY: ${ring.emergeOffsetY.toFixed(2)}, emergeOffsetZ: ${ring.emergeOffsetZ.toFixed(2)},`,
    `  startScale: ${ring.startScale.toFixed(2)}, bodyStartScale: ${ring.bodyStartScale.toFixed(2)}`,
    '}',
    `ringState: ${completionEffects.active ? `active @ ${completionEffects.elapsed.toFixed(2)}s` : 'hidden'}`
  ].join('\n');
}

function formatShapeStreamZone(zone) {
  return [
    `frontLeft: { x: ${zone.frontLeft.x.toFixed(4)}, y: ${zone.frontLeft.y.toFixed(4)} },`,
    `frontRight: { x: ${zone.frontRight.x.toFixed(4)}, y: ${zone.frontRight.y.toFixed(4)} },`,
    `backLeft: { x: ${zone.backLeft.x.toFixed(4)}, y: ${zone.backLeft.y.toFixed(4)} },`,
    `leftCorner: { x: ${zone.leftCorner.x.toFixed(4)}, y: ${zone.leftCorner.y.toFixed(4)} },`,
    `backRight: { x: ${zone.backRight.x.toFixed(4)}, y: ${zone.backRight.y.toFixed(4)} },`,
    `apex: { x: ${zone.apex.x.toFixed(4)}, y: ${zone.apex.y.toFixed(4)} },`,
    `zFront: ${zone.zFront.toFixed(2)}, zBack: ${zone.zBack.toFixed(2)}, weight: ${zone.weight}`
  ].join('\n    ');
}

function activeShapeStreamText() {
  const streamLayout = SHAPE_STREAM_FLOOR_LAYOUTS[activeLayoutName] || SHAPE_STREAM_FLOOR_LAYOUTS.desktop;
  const zoneBlocks = Object.entries(streamLayout).map(([name, zone]) => [
    `  ${name}: {`,
    `    ${formatShapeStreamZone(zone)}`,
    '  }'
  ].join('\n'));
  return [
    `streamColors: ${formatStreamColors()}`,
    `streamShapeSize: ${formatShapeStreamSize()}`,
    `streamLandingPhases: ${formatShapeStreamLandingPhases()}`,
    'streamFloor: {',
    zoneBlocks.join(',\n'),
    '}'
  ].join('\n');
}

function activeShapeLockText() {
  const lock = SHAPE_LOCK_LAYOUTS[activeLayoutName];
  return [
    'shapeLock: {',
    `  x: ${lock.x.toFixed(4)}, y: ${lock.y.toFixed(4)}, sizeN: ${lock.sizeN.toFixed(4)},`,
    `  doorColor: ${colorHex(SHAPE_LOCK_TUNING.doorColor)}, overlayColor: ${colorHex(SHAPE_LOCK_TUNING.overlayColor)},`,
    `  overlayOpacity: ${SHAPE_LOCK_TUNING.overlayOpacity.toFixed(2)}, cycle: ${SHAPE_LOCK_TUNING.cycleMin.toFixed(2)}-${SHAPE_LOCK_TUNING.cycleMax.toFixed(2)}s, fade: ${SHAPE_LOCK_TUNING.fadeTime.toFixed(2)}s`,
    '}'
  ].join('\n');
}

function activeParamsText() {
  return [
    `holeRadiusN: ${activeHoleRadiusN().toFixed(4)}`,
    `orbRadiusFactor: ${activeOrbRadiusFactor().toFixed(2)}`,
    `lipAspectX: ${CONFIG.lipAspectX.toFixed(3)}`,
    `floorY: ${CONFIG.floorY.toFixed(2)}`
  ].join(', ');
}

function activeLayoutText() {
  return [
    `layout: ${activeLayoutName}`,
    `image: ${activeLayout.image.width} x ${activeLayout.image.height}`,
    activeParamsText(),
    '',
    activeSocketText(),
    '',
    activeOrbHomeText(),
    '',
    activeOrbShadowText(),
    '',
    activeShapeStreamText(),
    '',
    activeCompletionRingText(),
    '',
    activeShapeLockText()
  ].join('\n');
}

function allLayoutsText() {
  const previousLayoutName = activeLayoutName;
  const previousLayout = activeLayout;
  const blocks = Object.entries(LAYOUTS).map(([name, layout]) => {
    activeLayoutName = name;
    activeLayout = layout;
    const socketSource = name === previousLayoutName ? sockets.map((s) => s.norm) : layout.sockets;
    const homeSource = name === previousLayoutName ? orbs.map((o) => o.home) : layout.orbHomes;
    const shadowSource = name === previousLayoutName ? orbs.map((o) => o.shadow) : (layout.orbShadow || []);
    const streamLayout = SHAPE_STREAM_FLOOR_LAYOUTS[name] || SHAPE_STREAM_FLOOR_LAYOUTS.desktop;
    return [
      `${name}: {`,
      `  image: { width: ${layout.image.width}, height: ${layout.image.height} },`,
      `  holeRadiusN: ${layout.holeRadiusN.toFixed(4)},`,
      `  orbRadiusFactor: ${layout.orbRadiusFactor.toFixed(2)},`,
      `  sockets: [ ${formatPointList(socketSource)} ],`,
      `  orbHomes: [ ${formatPointList(homeSource)} ],`,
      `  orbShadow: [ ${shadowSource.map(formatShadow).join(', ')} ],`,
      `  streamColors: ${formatStreamColors()},`,
      `  streamShapeSize: ${formatShapeStreamSize()},`,
      `  streamLandingPhases: ${formatShapeStreamLandingPhases()},`,
      `  streamFloor: ${JSON.stringify(streamLayout)},`,
      `  completionRing: ${JSON.stringify(layout.completionRing)},`,
      `  shapeLock: ${JSON.stringify(SHAPE_LOCK_LAYOUTS[name])}`,
      `}`
    ].join('\n');
  });
  activeLayoutName = previousLayoutName;
  activeLayout = previousLayout;
  return blocks.join(',\n\n');
}

function updateCalibrationConsole() {
  if (!calibrate || !calibrationOutput) return;
  syncShapeStreamControls();
  syncFloorEditorControls();
  syncLandingPhaseControls();
  syncShapeLockControls();
  syncFeedbackToggle();
  drawFloorEditorOverlay();
  calibrationOutput.textContent = activeLayoutText();
}

function syncFeedbackToggle() {
  if (!calibrationConsole) return;
  const button = calibrationConsole.querySelector('[data-feedback-toggle]');
  if (!button) return;
  button.textContent = interactionFeedback.enabled ? 'Feedback On' : 'Feedback Off';
  button.setAttribute('aria-pressed', String(interactionFeedback.enabled));
}

async function copyCalibration(kind) {
  const text = kind === 'all' ? allLayoutsText() : activeLayoutText();
  try {
    await navigator.clipboard.writeText(text);
    status.textContent = `copied ${kind === 'all' ? 'all layouts' : activeLayoutName}`;
  } catch {
    status.textContent = 'copy failed - select HUD text';
  }
}

function setHudCollapsed(collapsed) {
  if (!calibrationConsole) return;
  calibrationConsole.classList.toggle('is-collapsed', collapsed);
  if (calibrationToggle) {
    calibrationToggle.setAttribute('aria-expanded', String(!collapsed));
    calibrationToggle.textContent = collapsed ? '+' : '_';
  }
  try { localStorage.setItem(HUD_COLLAPSE_KEY, collapsed ? '1' : '0'); } catch {}
}

if (calibrate && calibrationConsole) {
  document.body.classList.add('is-calibrating');
  let collapsed = false;
  try { collapsed = localStorage.getItem(HUD_COLLAPSE_KEY) === '1'; } catch {}
  setHudCollapsed(collapsed);
  calibrationConsole.addEventListener('pointerdown', (event) => event.stopPropagation());
  calibrationConsole.addEventListener('click', (event) => {
    if (event.target.closest('#cal-toggle')) {
      setHudCollapsed(!calibrationConsole.classList.contains('is-collapsed'));
      return;
    }
    const button = event.target.closest('[data-cal-copy]');
    if (button) {
      copyCalibration(button.dataset.calCopy);
      return;
    }
    if (event.target.closest('[data-feedback-toggle]')) {
      setFeedbackEnabled(!interactionFeedback.enabled);
      syncFeedbackToggle();
      status.textContent = interactionFeedback.enabled ? 'seat feedback on' : 'seat feedback off';
      return;
    }
    const ringButton = event.target.closest('[data-ring-action]');
    if (ringButton) handleRingAction(ringButton.dataset.ringAction);
    const lockButton = event.target.closest('[data-lock-action]');
    if (lockButton) handleShapeLockAction(lockButton.dataset.lockAction);
    const floorButton = event.target.closest('[data-floor-action]');
    if (floorButton) handleFloorAction(floorButton.dataset.floorAction);
  });
  calibrationConsole.addEventListener('input', (event) => {
    const streamColor = event.target.closest('[data-stream-color]');
    if (streamColor) {
      handleShapeStreamColor(streamColor);
      return;
    }
    const streamInput = event.target.closest('[data-stream-control]');
    if (streamInput) {
      handleShapeStreamControl(streamInput);
      return;
    }
    const floorInput = event.target.closest('[data-floor-control]');
    if (floorInput) {
      handleFloorControl(floorInput);
      return;
    }
    const phaseInput = event.target.closest('[data-phase-control]');
    if (phaseInput) {
      handleLandingPhaseControl(phaseInput);
      return;
    }
    const input = event.target.closest('[data-lock-control]');
    if (input) handleShapeLockControl(input);
  });
}

/* ----- calibrate mode: drag ring/floor anchors. Socket dragging is parked for now. ------- */
const SOCKET_CALIBRATION_ENABLED = false;
let calActive = null;

function nearestCompletionRing(point) {
  const ring = activeLayout.completionRing || DESKTOP_COMPLETION_RING;
  const anchor = imageToWorld(ring.x, ring.y, 0);
  const scale = completionEffects.ring.userData.baseScale;
  const outerX = Math.max(0.0001, scale.x);
  const outerY = Math.max(0.0001, scale.y);
  const dx = point.x - anchor.x;
  const dy = point.y - anchor.y;
  const norm = Math.sqrt((dx * dx) / (outerX * outerX) + (dy * dy) / (outerY * outerY));
  return norm <= 1.18 ? { ring, norm } : null;
}
function calibrateDown(event) {
  const point = eventToWorld(event, 0);
  const ringHit = nearestCompletionRing(point);
  if (ringHit) {
    calActive = { type: 'ring' };
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
    return;
  }
  if (!SOCKET_CALIBRATION_ENABLED) {
    status.textContent = 'socket calibration disabled';
    return;
  }
  let best = null;
  sockets.forEach((s) => {
    const d = imageToWorld(s.norm.x, s.norm.y, 0).distanceTo(point);
    if (!best || d < best.d) best = { s, d };
  });
  calActive = { type: 'socket', socket: best.s };
  canvas.setPointerCapture(event.pointerId);
  event.preventDefault();
}
function calibrateMove(event) {
  if (!calActive) return;
  const n = worldToImage(eventToWorld(event, 0));
  if (calActive.type === 'ring') {
    const ring = activeLayout.completionRing || DESKTOP_COMPLETION_RING;
    ring.x = +THREE.MathUtils.clamp(n.x, -0.5, 1.5).toFixed(4);
    ring.y = +THREE.MathUtils.clamp(n.y, -0.5, 1.5).toFixed(4);
    status.textContent = `ring anchor ${ring.x.toFixed(4)}, ${ring.y.toFixed(4)}`;
  } else {
    calActive.socket.norm.x = +n.x.toFixed(4);
    calActive.socket.norm.y = +n.y.toFixed(4);
  }
  layout();
  updateCalibrationConsole();
  event.preventDefault();
}
function calibrateUp(event) {
  if (!calActive) return;
  const wasRing = calActive.type === 'ring';
  calActive = null;
  if (wasRing) {
    console.log(`${activeLayoutName} completionRing: ${JSON.stringify(activeLayout.completionRing)}`);
    updateCalibrationConsole();
    status.textContent = 'ring moved - see HUD';
    try { canvas.releasePointerCapture(event.pointerId); } catch {}
    return;
  }
  const dump = sockets.map((s) => `{ x: ${s.norm.x}, y: ${s.norm.y} }`).join(', ');
  console.log(`${activeLayoutName} sockets: [ ${dump} ]`);
  dumpParams();
  updateCalibrationConsole();
  status.textContent = 'calibrating — see console';
  try { canvas.releasePointerCapture(event.pointerId); } catch {}
}

function dumpParams() {
  console.log(
    `PARAMS ${activeLayoutName}: lipAspectX: ${CONFIG.lipAspectX.toFixed(3)}, ` +
    `holeRadiusN: ${activeHoleRadiusN().toFixed(4)}, ` +
    `orbRadiusFactor: ${activeOrbRadiusFactor().toFixed(2)}, ` +
    `floorY: ${CONFIG.floorY.toFixed(2)}`
  );
}

function dumpOrbHomes() {
  const d = orbs.map((o) => `{ x: ${o.home.x}, y: ${o.home.y} }`).join(', ');
  console.log(`${activeLayoutName} orbHomes: [ ${d} ]`);
  updateCalibrationConsole();
}

function formatShadow(s) {
  return `{ cast: ${s.cast.toFixed(2)}, skew: ${s.skew.toFixed(2)}, depth: ${s.depth.toFixed(2)}, z: ${s.z.toFixed(2)} }`;
}

function dumpOrbShadow() {
  const d = orbs.map((o) => formatShadow(o.shadow)).join(', ');
  console.log(`${activeLayoutName} orbShadow: [ ${d} ]`);
  updateCalibrationConsole();
}

// Live perspective/size tuning while ?calibrate is on.
if (calibrate) {
  window.addEventListener('keydown', (e) => {
    let changed = true;
    let shadowZOrb = null; // set when a shadow key adjusts a single orb's shadow params, skips the generic param dump
    const selectShadowOrb = () => {
      const point = pointerWorld || (orbs[0] && orbs[0].mesh.position);
      return point ? nearestOrbUnbounded(point) : orbs[0];
    };
    switch (e.key) {
      case 'ArrowLeft':  CONFIG.lipAspectX = Math.max(0.3, CONFIG.lipAspectX - 0.02); break; // narrower
      case 'ArrowRight': CONFIG.lipAspectX = Math.min(1.2, CONFIG.lipAspectX + 0.02); break; // wider
      case 'ArrowUp':    activeLayout.holeRadiusN += 0.0008; break;  // bigger holes
      case 'ArrowDown':  activeLayout.holeRadiusN = Math.max(0.005, activeLayout.holeRadiusN - 0.0008); break;
      case ',':          activeLayout.orbRadiusFactor = Math.max(0.2, activeLayout.orbRadiusFactor - 0.03); break; // smaller orb
      case '.':          activeLayout.orbRadiusFactor += 0.03; break; // bigger orb (reads deeper)
      // All shadow keys below act on whichever orb is currently nearest the cursor —
      // shadows are calibrated per orb, not globally.
      case '[': { shadowZOrb = selectShadowOrb(); if (shadowZOrb) shadowZOrb.shadow.cast = Math.max(0, shadowZOrb.shadow.cast - 0.03); break; } // shadow nearer the orb
      case ']': { shadowZOrb = selectShadowOrb(); if (shadowZOrb) shadowZOrb.shadow.cast += 0.03; break; } // shadow further down
      case 'o': { shadowZOrb = selectShadowOrb(); if (shadowZOrb) shadowZOrb.shadow.skew -= 0.02; break; } // shadow leans left
      case 'p': { shadowZOrb = selectShadowOrb(); if (shadowZOrb) shadowZOrb.shadow.skew += 0.02; break; } // shadow leans right
      case 'z': { shadowZOrb = selectShadowOrb(); if (shadowZOrb) shadowZOrb.shadow.depth = Math.max(0.2, shadowZOrb.shadow.depth - 0.05); break; } // shallower
      case 'x': { shadowZOrb = selectShadowOrb(); if (shadowZOrb) shadowZOrb.shadow.depth = Math.min(3.0, shadowZOrb.shadow.depth + 0.05); break; } // deeper
      case 'n': { shadowZOrb = selectShadowOrb(); if (shadowZOrb) shadowZOrb.shadow.z = Math.max(-1, shadowZOrb.shadow.z - 0.02); break; } // nearer in Z
      case 'm': { shadowZOrb = selectShadowOrb(); if (shadowZOrb) shadowZOrb.shadow.z = Math.min(1, shadowZOrb.shadow.z + 0.02); break; } // farther in Z
      default: changed = false;
    }
    if ('[]opzxnm'.includes(e.key) && !shadowZOrb) changed = false;
    if (!changed) return;
    if (shadowZOrb) {
      dumpOrbShadow();
      const s = shadowZOrb.shadow;
      status.textContent =
        `orb ${shadowZOrb.index} shadow  drop ${s.cast.toFixed(2)}  skew ${s.skew.toFixed(2)}  depth ${s.depth.toFixed(2)}  z ${s.z.toFixed(2)}`;
      e.preventDefault();
      return;
    }
    layout();
    reseatPlaced();
    dumpParams();
    updateCalibrationConsole();
    status.textContent =
      `aspect ${CONFIG.lipAspectX.toFixed(2)}  hole ${activeHoleRadiusN().toFixed(4)}  ` +
      `orb ${activeOrbRadiusFactor().toFixed(2)}`;
    e.preventDefault();
  });
}

canvas.addEventListener('pointerdown', pointerDown);
canvas.addEventListener('pointermove', pointerMove);
canvas.addEventListener('pointerup', pointerUp);
canvas.addEventListener('pointercancel', (event) => {
  if (active && event.pointerId === activePointer) {
    finishActiveDrag({ pointerId: event.pointerId, interrupted: true });
    event.preventDefault();
    return;
  }
  if (calibrate) calibrateUp(event);
});
canvas.addEventListener('lostpointercapture', (event) => {
  if (active && event.pointerId === activePointer) {
    finishActiveDrag({ pointerId: event.pointerId, interrupted: true });
  }
});
canvas.addEventListener('pointerleave', () => { pointerWorld = null; });

/* ===== loop ======================================================= */
const clock = new THREE.Clock();
function animate() {
  const delta = Math.min(clock.getDelta(), 0.04);
  orbs.forEach((o) => {
    if (o.target) {
      o.mesh.position.lerp(o.target, 0.18);
      if (o.mesh.position.distanceTo(o.target) < 0.002) {
        o.mesh.position.copy(o.target);
        o.target = null;
      }
    } else if (o.seated == null && !o.dragging) {
      // Readable, unhurried drift for floating orbs. Two overlapping paths keep the
      // movement from looking like a synchronized vertical bob.
      o.phase += delta * 0.9;
      const home = imageToWorld(o.home.x, o.home.y, CONFIG.homeZ);
      const driftScale = o.orbR;
      home.x += (
        Math.sin(o.phase * 0.72 + o.index * 1.17) * 0.72 +
        Math.sin(o.phase * 0.31 + o.index * 2.03) * 0.22
      ) * driftScale;
      home.y += (
        Math.cos(o.phase * 0.57 + o.index * 1.41) * 0.58 +
        Math.sin(o.phase * 0.27 + o.index * 0.83) * 0.18
      ) * driftScale;

      // Broad cursor gravity: nearby orbs visibly lean toward the pointer, with a
      // softer response at the edge of the field and a decisive pull up close.
      let targetPullX = 0, targetPullY = 0;
      if (pointerWorld) {
        const dx = pointerWorld.x - o.mesh.position.x;
        const dy = pointerWorld.y - o.mesh.position.y;
        const dist = Math.hypot(dx, dy);
        const reach = o.orbR * 10;
        const influence = Math.max(0, 1 - dist / reach);
        const strength = influence * influence * (3 - 2 * influence);
        const maxPull = o.orbR * 1.45;
        if (dist > 0.0001) {
          targetPullX = (dx / dist) * maxPull * strength;
          targetPullY = (dy / dist) * maxPull * strength;
        }
      }
      const pullEase = 1 - Math.exp(-delta * 9);
      o.pullX += (targetPullX - o.pullX) * pullEase;
      o.pullY += (targetPullY - o.pullY) * pullEase;
      home.x += o.pullX;
      home.y += o.pullY;

      o.mesh.position.lerp(home, 0.07);
    }

    // Floor shadow: a flattened ellipse on the ground. The drop is proportional to how
    // high the orb sits above the floor band, so higher orbs cast further down (and the
    // shadow spreads + fades with height). Key light is upper-left, so it skews right.
    const floating = o.seated == null;
    o.floatShadow.visible = floating;
    if (floating) {
      const floorWorldY = imageToWorld(0.5, CONFIG.floorY).y;
      const height = Math.max(0, o.mesh.position.y - floorWorldY); // orb height above the floor
      const depth = o.shadow.depth;
      const spread = 1 + height * 0.10 * depth;
      o.floatShadow.scale.set(o.orbR * 2.6 * spread, o.orbR * 0.95 * spread, 1);
      o.floatShadow.position.set(
        o.mesh.position.x + height * o.shadow.skew, // light skew to the right
        o.mesh.position.y - height * o.shadow.cast,
        0.08 + depth * 0.10 + o.shadow.z
      );
      o.floatShadow.material.opacity = THREE.MathUtils.clamp(1 - height * 0.05 * depth, 0.26, 1);
    }
  });
  updateCompletionEffects(delta);
  updateShapeStream(delta);
  updateShapeLock(delta);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

resize();
syncRoomBackdropTexture();
layout();
window.addEventListener('blur', () => finishActiveDrag({ interrupted: true }));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) finishActiveDrag({ interrupted: true });
});
window.addEventListener('resize', () => {
  resize();
  syncLayoutFromViewport();
  syncRoomBackdropTexture();
  layout();
  reseatPlaced();
  updateCalibrationConsole();
});
if (calibrate) {
  status.textContent = 'calibrate - see HUD guide';
  updateCalibrationConsole();
}
animate();
if (previewComplete) {
  // Debug-only shortcut for reference checks without changing the real gated flow.
  const runPreviewCompletion = () => {
    settleCompletionInstantly();
    let warmupSteps = 1600;
    let settleSteps = 900;
    const stepChunk = () => {
      const chunk = 70;
      for (let i = 0; i < chunk && warmupSteps > 0; i += 1, warmupSteps -= 1) {
        updateShapeStream(0.025);
      }
      if (warmupSteps <= 0) shapeStream.full = true;
      for (let i = 0; i < chunk && warmupSteps <= 0 && settleSteps > 0; i += 1, settleSteps -= 1) {
        updateShapeStream(0.025);
      }
      renderer.render(scene, camera);
      if (warmupSteps > 0 || settleSteps > 0) requestAnimationFrame(stepChunk);
    };
    requestAnimationFrame(stepChunk);
  };
  if (roomBgImage?.complete) runPreviewCompletion();
  else roomBgImage?.addEventListener('load', runPreviewCompletion, { once: true });
}
