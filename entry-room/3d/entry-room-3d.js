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
  { x: 0.1192, y: -0.0316 }, { x: 0.7499, y: 1.2356 },
  { x: 0.5752, y: -0.5221 }, { x: 0.1583, y: 1.1367 },
  { x: 0.4685, y: 0.4401 }, { x: 0.9119, y: 0.7072 }
];
const MOBILE_ORB_SHADOW = [
  { cast: 0.96, skew: 0.02, depth: 1.00, z: 0.00 },
  { cast: 2.58, skew: 0.02, depth: 1.00, z: 0.00 },
  { cast: 1.11, skew: 0.02, depth: 1.00, z: 0.00 },
  { cast: 0.93, skew: 0.02, depth: 1.00, z: 0.00 },
  { cast: 0.84, skew: 0.02, depth: 1.00, z: 0.00 },
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
  x: 0.1659,
  y: -0.2353,
  patchX: 0.1659,
  patchY: -0.2353,
  patchSize: 1.20,
  fieldSize: 1.55,
  fieldOpacity: 0.10,
  aspectX: 0.80,
  aspectY: 1.02,
  radiusPad: 1.56,
  surfaceZ: 0.14,
  recessZ: -0.10,
  bodyOffsetX: -0.20,
  bodyOffsetY: -0.02,
  bodyOffsetZ: -0.14,
  emergeOffsetX: -0.14,
  emergeOffsetY: 0.10,
  emergeOffsetZ: -1.46,
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
    orbRadiusFactor: 1.05,
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
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
let activeLayoutName = mobileLayoutQuery.matches ? 'mobile' : 'desktop';
let activeLayout = LAYOUTS[activeLayoutName];

const urlParams = new URLSearchParams(location.search);
const calibrate = urlParams.has('calibrate');
const previewComplete = urlParams.has('previewComplete');
const noNavigate = calibrate && urlParams.has('noNavigate');
if (calibrate) mountCalibrationHud(document.body);

const canvas = document.getElementById('entry-canvas');
const coreFrame = document.getElementById('frame-stage');
const artStage = document.getElementById('art-stage');
const roomBgImage = document.querySelector('#room-bg img');
const ringRippleVideo = document.getElementById('ring-ripple-video');
const root = document.getElementById('entry-root');
const status = document.getElementById('entry-status');
const wrongShapeFlash = document.getElementById('wrong-shape-flash');
const gravityWarpTurbulence = document.getElementById('entry-gravity-warp-turbulence');
const gravityWarpDisplacement = document.getElementById('entry-gravity-warp-displacement');
const calibrationConsole = document.getElementById('calibration-console');
const calibrationOutput = document.getElementById('calibration-output');
const calibrationToggle = document.getElementById('cal-toggle');
const RING_SETTLED_TIME = 4.8;
const HUD_COLLAPSE_KEY = 'entry3d-hud-collapsed';
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
const SHAPE_IMPACT_FEEDBACK_COOLDOWN_MS = 115;
const SHAPE_IMPACT_HAPTIC_COOLDOWN_MS = 240;
const FEEDBACK_DESKTOP_GAIN = 1.25;
const FEEDBACK_MOBILE_GAIN = 1.12;

const interactionFeedback = {
  audioContext: null,
  lastHapticAt: 0,
  lastShapeImpactSoundAt: 0,
  counters: {
    socket: 0,
    shapeImpact: 0,
    haptic: 0
  }
};

const sceneFx = {
  wrongShapeFlashTimer: null
};

function feedbackTimestamp() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

function feedbackAudioState() {
  return interactionFeedback.audioContext?.state || 'uninitialized';
}

function feedbackGainScale() {
  return activeLayoutName === 'desktop' ? FEEDBACK_DESKTOP_GAIN : FEEDBACK_MOBILE_GAIN;
}

function primeFeedback() {
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
  return interactionFeedback.audioContext;
}

function playFeedbackAudio(callback) {
  const ctx = primeFeedback();
  if (!ctx) return;
  if (ctx.state === 'running') {
    callback(ctx, ctx.currentTime);
    return;
  }
  if (ctx.state === 'suspended') {
    ctx.resume()
      .then(() => {
        if (ctx.state === 'running') callback(ctx, ctx.currentTime + 0.01);
      })
      .catch(() => {});
  }
}

function connectFeedbackOutput(ctx, outputNode, pan = 0) {
  if (typeof ctx.createStereoPanner === 'function') {
    const panner = ctx.createStereoPanner();
    panner.pan.value = THREE.MathUtils.clamp(pan, -0.85, 0.85);
    outputNode.connect(panner);
    panner.connect(ctx.destination);
    return;
  }
  outputNode.connect(ctx.destination);
}

function feedbackPanForPosition(position) {
  if (!position || !viewport?.width) return 0;
  return THREE.MathUtils.clamp(position.x / Math.max(0.001, viewport.width * 0.5), -0.85, 0.85);
}

function pulseFeedbackHaptic(pattern, cooldownMs = 0, now = feedbackTimestamp()) {
  if (!navigator.vibrate) return false;
  if (cooldownMs > 0 && now - interactionFeedback.lastHapticAt < cooldownMs) return false;
  try {
    const accepted = navigator.vibrate(pattern);
    if (accepted !== false) {
      interactionFeedback.lastHapticAt = now;
      interactionFeedback.counters.haptic += 1;
      return true;
    }
  } catch {}
  return false;
}

function triggerNoiseBurst(ctx, startAt, {
  duration = 0.045,
  gain = 0.018,
  filterType = 'bandpass',
  frequency = 700,
  q = 0.8,
  pan = 0
} = {}) {
  const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const scaledGain = Math.max(0.0002, gain * feedbackGainScale());
  for (let i = 0; i < length; i += 1) {
    const fade = 1 - i / length;
    data[i] = (Math.random() * 2 - 1) * fade;
  }

  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gainNode = ctx.createGain();
  source.buffer = buffer;
  filter.type = filterType;
  filter.frequency.setValueAtTime(frequency, startAt);
  filter.Q.setValueAtTime(q, startAt);
  gainNode.gain.setValueAtTime(0.0001, startAt);
  gainNode.gain.exponentialRampToValueAtTime(scaledGain, startAt + Math.min(0.012, duration * 0.28));
  gainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  source.connect(filter);
  filter.connect(gainNode);
  connectFeedbackOutput(ctx, gainNode, pan);
  source.start(startAt);
  source.stop(startAt + duration);
}

function triggerSocketTone(ctx, startAt = ctx.currentTime) {
  const gainScale = feedbackGainScale();
  triggerNoiseBurst(ctx, startAt, {
    duration: 0.026,
    gain: 0.062,
    filterType: 'bandpass',
    frequency: 1280,
    q: 1.25
  });

  triggerNoiseBurst(ctx, startAt + 0.016, {
    duration: 0.042,
    gain: 0.035,
    filterType: 'bandpass',
    frequency: 560,
    q: 0.85
  });

  triggerNoiseBurst(ctx, startAt + 0.006, {
    duration: 0.018,
    gain: 0.026,
    filterType: 'highpass',
    frequency: 2200,
    q: 0.45
  });

  const bodyOsc = ctx.createOscillator();
  const bodyGain = ctx.createGain();
  bodyOsc.type = 'triangle';
  bodyOsc.frequency.setValueAtTime(128, startAt);
  bodyOsc.frequency.exponentialRampToValueAtTime(72, startAt + 0.075);
  bodyGain.gain.setValueAtTime(0.0001, startAt);
  bodyGain.gain.exponentialRampToValueAtTime(0.038 * gainScale, startAt + 0.01);
  bodyGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.095);
  bodyOsc.connect(bodyGain);
  connectFeedbackOutput(ctx, bodyGain);
  bodyOsc.start(startAt);
  bodyOsc.stop(startAt + 0.105);
}

function triggerShapeImpactThud(ctx, startAt, pan = 0, intensity = 0.4) {
  const clamped = THREE.MathUtils.clamp(intensity, 0.2, 1);
  const gainScale = feedbackGainScale();
  const thudOsc = ctx.createOscillator();
  const thudGain = ctx.createGain();
  thudOsc.type = 'triangle';
  thudOsc.frequency.setValueAtTime(92 - clamped * 18, startAt);
  thudOsc.frequency.exponentialRampToValueAtTime(44, startAt + 0.085);
  thudGain.gain.setValueAtTime(0.0001, startAt);
  thudGain.gain.exponentialRampToValueAtTime((0.012 + clamped * 0.016) * gainScale, startAt + 0.012);
  thudGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.11);
  thudOsc.connect(thudGain);
  connectFeedbackOutput(ctx, thudGain, pan);
  thudOsc.start(startAt);
  thudOsc.stop(startAt + 0.12);

  triggerNoiseBurst(ctx, startAt, {
    duration: 0.048,
    gain: 0.006 + clamped * 0.009,
    filterType: 'lowpass',
    frequency: 480,
    q: 0.7,
    pan
  });

  triggerNoiseBurst(ctx, startAt + 0.006, {
    duration: 0.036,
    gain: 0.007 + clamped * 0.012,
    filterType: 'bandpass',
    frequency: 720,
    q: 0.75,
    pan
  });
}

function playSocketFeedback() {
  interactionFeedback.counters.socket += 1;
  pulseFeedbackHaptic(18);
  playFeedbackAudio((ctx, startAt) => triggerSocketTone(ctx, startAt));
}

function playShapeImpactFeedback(intensity, position) {
  const now = feedbackTimestamp();
  const clamped = THREE.MathUtils.clamp(intensity, 0.2, 1);
  if (now - interactionFeedback.lastShapeImpactSoundAt >= SHAPE_IMPACT_FEEDBACK_COOLDOWN_MS) {
    interactionFeedback.lastShapeImpactSoundAt = now;
    interactionFeedback.counters.shapeImpact += 1;
    const pan = feedbackPanForPosition(position);
    playFeedbackAudio((ctx, startAt) => triggerShapeImpactThud(ctx, startAt, pan, clamped));
  }
  if (clamped >= 0.38) {
    pulseFeedbackHaptic(clamped > 0.68 ? [8, 18, 10] : 12, SHAPE_IMPACT_HAPTIC_COOLDOWN_MS, now);
  }
}

function armFeedbackFromGesture() {
  primeFeedback();
}

window.addEventListener('pointerdown', armFeedbackFromGesture, { capture: true, passive: true });
window.addEventListener('touchstart', armFeedbackFromGesture, { capture: true, passive: true });
window.addEventListener('keydown', armFeedbackFromGesture, { capture: true });

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
  setFeedbackEnabled: () => true,
  getFeedbackEnabled: () => true,
  __feedback: () => ({
    enabled: true,
    layout: activeLayoutName,
    gainScale: +feedbackGainScale().toFixed(2),
    audioState: feedbackAudioState(),
    audioReady: feedbackAudioState() === 'running',
    haptics: !!navigator.vibrate,
    counters: { ...interactionFeedback.counters }
  }),
  getState: () => ({
    layout: activeLayoutName,
    dragging: !!active,
    placed: sockets.filter((s) => s.filledBy != null).length,
    feedbackEnabled: true,
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
    finalGrid: {
      active: shapeStream.finalGrid.active,
      animating: shapeStream.finalGrid.animating,
      phase: shapeStream.finalGrid.phase,
      progress: +shapeStream.finalGrid.progress.toFixed(2),
      vacuumProgress: +shapeStream.finalGrid.vacuumProgress.toFixed(2),
      rows: shapeStream.finalGrid.rows,
      columns: shapeStream.finalGrid.columns,
      count: shapeStream.finalGrid.count,
      visible: shapeStream.finalGrid.visible,
      vacuumTotal: shapeStream.finalGrid.vacuumTotal,
      exitPhase: shapeStream.finalGrid.exitPhase,
      exitProgress: +shapeStream.finalGrid.exitProgress.toFixed(2),
      flashCount: shapeStream.finalGrid.flashCount,
      collapseProgress: +shapeStream.finalGrid.collapseProgress.toFixed(2),
      dissolveProgress: +(shapeStream.finalGrid.dissolveProgress || 0).toFixed(2),
      portalProgress: +(shapeStream.finalGrid.portalProgress || 0).toFixed(2),
      viewerPull: +doorwayExit.pullProgress.toFixed(2),
      warpPhase: doorwayExit.gravityWarp.phase,
      warpProgress: +doorwayExit.gravityWarp.progress.toFixed(2),
      warpIntensity: +doorwayExit.gravityWarp.intensity.toFixed(2),
      warpScale: +doorwayExit.gravityWarp.filterScale.toFixed(2),
      navigating: shapeStream.finalGrid.navigating
    },
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
  __previewDoorVacuum: () => previewShapeStreamFinalGrid(),
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

function createDoorwayRadialVeilTexture() {
  const textureCanvas = document.createElement('canvas');
  textureCanvas.width = 256;
  textureCanvas.height = 256;
  const ctx = textureCanvas.getContext('2d');
  const gradient = ctx.createRadialGradient(128, 128, 8, 128, 128, 128);
  gradient.addColorStop(0, 'rgba(0,0,0,0)');
  gradient.addColorStop(0.24, 'rgba(0,0,0,0.08)');
  gradient.addColorStop(0.58, 'rgba(0,0,0,0.62)');
  gradient.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createDoorwayParticleMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    uniforms: {
      uOpacity: { value: 1 }
    },
    blending: THREE.NormalBlending,
    vertexShader: `
      attribute float alpha;
      attribute float particleSize;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vColor = color;
        vAlpha = alpha;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = particleSize;
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      varying vec3 vColor;
      varying float vAlpha;
      void main() {
        vec2 centered = gl_PointCoord - vec2(0.5);
        float radius = length(centered);
        if (radius > 0.5) discard;
        float softness = smoothstep(0.5, 0.22, radius);
        gl_FragColor = vec4(vColor, vAlpha * uOpacity * softness);
      }
    `,
    vertexColors: true
  });
}

function createDoorwayImageBreakMaterial(texture) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
    uniforms: {
      map: { value: texture },
      uOpacity: { value: 1 }
    },
    vertexShader: `
      attribute float alpha;
      varying vec2 vUv;
      varying float vAlpha;
      void main() {
        vUv = uv;
        vAlpha = alpha;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      uniform float uOpacity;
      varying vec2 vUv;
      varying float vAlpha;
      void main() {
        vec4 texel = texture2D(map, vUv);
        gl_FragColor = vec4(texel.rgb, texel.a * vAlpha * uOpacity);
      }
    `
  });
}

const doorwayClosedEyeTexture = new THREE.TextureLoader().load('/assets/eyes/closedeye.png');
doorwayClosedEyeTexture.colorSpace = THREE.SRGBColorSpace;
const doorwayOpenEyeTexture = new THREE.TextureLoader().load('/assets/eyes/openeye.png');
doorwayOpenEyeTexture.colorSpace = THREE.SRGBColorSpace;
const doorwayRadialVeilTexture = createDoorwayRadialVeilTexture();
const DOORWAY_EYE_TUNING = {
  eyeColor: 0xffd9a8,
  eyeOpacity: 0.40,
  overlayColor: 0x050302,
  overlayOpacity: 0.48
};
const DOORWAY_EYE_COLOR = new THREE.Color(DOORWAY_EYE_TUNING.eyeColor);
const doorwayExit = (() => {
  const gravityVeil = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: doorwayRadialVeilTexture,
      color: DOORWAY_EYE_TUNING.overlayColor,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      toneMapped: false
    })
  );
  gravityVeil.visible = false;
  gravityVeil.renderOrder = 27;
  scene.add(gravityVeil);

  const veil = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      color: DOORWAY_EYE_TUNING.overlayColor,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      toneMapped: false
    })
  );
  veil.visible = false;
  veil.renderOrder = 28;
  scene.add(veil);

  const eyeGeometry = new THREE.PlaneGeometry(1, 1);
  const createEye = (texture, renderOrder) => {
    const eye = new THREE.Mesh(
      eyeGeometry,
      new THREE.MeshBasicMaterial({
        map: texture,
        color: DOORWAY_EYE_TUNING.eyeColor,
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide
      })
    );
    eye.visible = false;
    eye.renderOrder = renderOrder;
    scene.add(eye);
    return eye;
  };
  const closedEye = createEye(doorwayClosedEyeTexture, 30);
  const openEye = createEye(doorwayOpenEyeTexture, 30.1);

  const voidPlane = new THREE.Mesh(
    new THREE.CircleGeometry(1, 64),
    new THREE.MeshBasicMaterial({
      color: 0x010000,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide
    })
  );
  voidPlane.visible = false;
  voidPlane.renderOrder = 29;
  scene.add(voidPlane);

  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
  dustGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 3));
  const dustPoints = new THREE.Points(
    dustGeometry,
    new THREE.PointsMaterial({
      size: 0.04,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.AdditiveBlending
    })
  );
  dustPoints.visible = false;
  dustPoints.renderOrder = 29.7;
  scene.add(dustPoints);

  const roomBreakGeometry = new THREE.BufferGeometry();
  roomBreakGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
  roomBreakGeometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(0), 2));
  roomBreakGeometry.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(0), 1));
  const roomBreakMaterial = createDoorwayImageBreakMaterial(roomBackdrop.texture);
  const roomBreakMesh = new THREE.Mesh(roomBreakGeometry, roomBreakMaterial);
  roomBreakMesh.visible = false;
  roomBreakMesh.renderOrder = 30.05;
  scene.add(roomBreakMesh);

  const doorParticleGeometry = new THREE.BufferGeometry();
  doorParticleGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
  doorParticleGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 3));
  doorParticleGeometry.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(0), 1));
  doorParticleGeometry.setAttribute('particleSize', new THREE.BufferAttribute(new Float32Array(0), 1));
  const doorParticleMaterial = createDoorwayParticleMaterial();
  const doorParticlePoints = new THREE.Points(doorParticleGeometry, doorParticleMaterial);
  doorParticlePoints.visible = false;
  doorParticlePoints.renderOrder = 30.2;
  scene.add(doorParticlePoints);

  const blackPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide
    })
  );
  blackPlane.visible = false;
  blackPlane.renderOrder = 90;
  scene.add(blackPlane);

  const rings = Array.from({ length: 6 }, (_value, index) => {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1.0, 96),
      new THREE.MeshBasicMaterial({
        color: index % 2 ? 0xffd492 : 0xfff0bd,
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide
      })
    );
    ring.visible = false;
    ring.renderOrder = 31;
    scene.add(ring);
    return ring;
  });

  return {
    eye: openEye,
    closedEye,
    openEye,
    gravityVeil,
    rings,
    veil,
    voidPlane,
    roomDust: {
      points: dustPoints,
      geometry: dustGeometry,
      starts: null,
      targets: null,
      swirls: null,
      colors: null,
      count: 0,
      key: ''
    },
    roomShards: {
      points: roomBreakMesh,
      geometry: roomBreakGeometry,
      material: roomBreakMaterial,
      doorPoints: doorParticlePoints,
      doorGeometry: doorParticleGeometry,
      doorMaterial: doorParticleMaterial,
      starts: null,
      targets: null,
      positions: null,
      uvs: null,
      alphas: null,
      cornerOffsets: null,
      swirls: null,
      doorStarts: null,
      doorTargets: null,
      doorPositions: null,
      doorColors: null,
      doorAlphas: null,
      doorSizes: null,
      doorBaseSizes: null,
      doorSwirls: null,
      count: 0,
      doorCount: 0,
      key: ''
    },
    blackPlane,
    scale: 0.18,
    voidScale: 0.2,
    pullProgress: 0,
    pullOriginX: 50,
    pullOriginY: 50,
      pullTranslateX: 0,
      pullTranslateY: 0,
      dissolveProgress: 0,
      portalProgress: 0,
      flashCount: 0,
    calibrationPreview: 'none',
    calibrationBlinkElapsed: 0,
    calibrationTransitionPreview: false,
    navigationTimer: null,
      gravityWarp: {
      phase: 'idle',
      progress: 0,
      intensity: 0,
      filterScale: 0,
      blur: 0,
      contrast: 1,
      brightness: 1,
      saturate: 1,
      originX: 50,
      originY: 50
    },
    navigationTriggered: false
  };
})();

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
    exitOpacityScale: 1,
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
    { name: 'front-right', duration: 2.1, widthT: 0.990, depthT: 0.990, widthSpread: 0.22, depthSpread: 0.22 },
    { name: 'back-right', duration: 2.0, widthT: 0.970, depthT: 0.250, widthSpread: 0.23, depthSpread: 0.19 },
    { name: 'left', duration: 2.0, widthT: 0.040, depthT: 0.940, widthSpread: 0.24, depthSpread: 0.24 },
    { name: 'right', duration: 2.0, widthT: 0.985, depthT: 0.640, widthSpread: 0.22, depthSpread: 0.30 }
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
  0x00ced1, 0x006eff, 0xcb5cff, 0xffcb70,
  0x814812, 0xfff1e0
];
const SHAPE_STREAM_COLOR_WEIGHTS = [
  1, 1, 1, 1, 1, 1, 1, 0.45, 0.45, 0.45
];
const SHAPE_STREAM_FINAL_GRID = {
  duration: 2.4,
  holdDuration: 0.6,
  vacuumItemDuration: 2.2,
  vacuumBatchSize: 3,
  vacuumBatchInterval: 0.075,
  vacuumDoorZ: 4.75,
  vacuumApproachScale: 0.92,
  vacuumSpin: 0.58,
  vacuumEndScaleFactor: 0.76,
  cellSizeFactor: 2.45,
  scaleFactor: 0.42,
  tiltX: -0.42,
  tiltY: 0.28,
  tiltVariation: 0.16,
  z: 4.6,
  zStep: 0.00003,
  closedRevealDuration: 0.10,
  openRevealDuration: 0.30,
  blinkCount: 6,
  blinkDuration: 0.60,
  postEyeHoldDuration: 0.45,
  roomBreakDuration: 4.85,
  roomImageHandoffDuration: 2.00,
  blackFadeDuration: 0.55,
  homeFadeHoldDuration: 0.18,
  homeHref: '/',
  roomParticlePullDuration: 1.45,
  roomParticleBatchSize: 72,
  roomParticleBatchInterval: 0.026,
  roomParticleOrbitScale: 0.055,
  doorParticleStartTime: 3.55,
  doorParticlePullDuration: 0.95,
  doorParticleBatchSize: 30,
  doorParticleBatchInterval: 0.012,
  doorParticleOrbitScale: 0.18,
  eyeZ: 4.82,
  eyeDoorScale: 0.72,
  voidStartScale: 0.24,
  voidDoorScale: 0.78,
  voidPullScale: 5.2,
  dustDesktopCount: 1450,
  dustMobileCount: 920,
  dustReducedCount: 360,
  roomShardDesktopCount: 7200,
  roomShardMobileCount: 4200,
  roomShardReducedCount: 900
};
const BASE_SHAPE_STREAM_FLOOR_LAYOUTS = {
  desktop: {
    floor: {
      // One continuous floor field.
      frontLeft: { x: 0.0036, y: 0.9890 },
      frontRight: { x: 1.0240, y: 0.9970 },
      backLeft: { x: 0.5557, y: 0.6334 },
      leftCorner: { x: 0.005, y: 0.860 },
      backRight: { x: 1.0200, y: 0.8321 },
      apex: { x: 0.5480, y: 0.8230 },
      zFront: CONFIG.homeZ + 0.46,
      zBack: CONFIG.homeZ - 0.29,
      weight: 1
    }
  },
  mobile: {
    floor: {
      frontLeft: { x: -0.02, y: 0.972 },
      frontRight: { x: 1.045, y: 0.978 },
      backLeft: { x: 0.10, y: 0.745 },
      leftCorner: { x: 0.030, y: 0.860 },
      backRight: { x: 0.935, y: 0.765 },
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
    full: false,
    finalGrid: {
      active: false,
      animating: false,
      phase: 'idle',
      elapsed: 0,
      progress: 0,
      holdElapsed: 0,
      vacuumElapsed: 0,
      vacuumProgress: 0,
      rows: 0,
      columns: 0,
      count: 0,
      visible: 0,
      vacuumTotal: 0,
      exitPhase: 'idle',
      exitElapsed: 0,
      exitProgress: 0,
      flashCount: 0,
      collapseProgress: 0,
      dissolveProgress: 0,
      portalProgress: 0,
      navigating: false
    }
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
  shapeStream.finalGrid.active = false;
  shapeStream.finalGrid.animating = false;
  shapeStream.finalGrid.phase = 'idle';
  shapeStream.finalGrid.elapsed = 0;
  shapeStream.finalGrid.progress = 0;
  shapeStream.finalGrid.holdElapsed = 0;
  shapeStream.finalGrid.vacuumElapsed = 0;
  shapeStream.finalGrid.vacuumProgress = 0;
  shapeStream.finalGrid.rows = 0;
  shapeStream.finalGrid.columns = 0;
  shapeStream.finalGrid.count = 0;
  shapeStream.finalGrid.visible = 0;
  shapeStream.finalGrid.vacuumTotal = 0;
  shapeStream.finalGrid.exitPhase = 'idle';
  shapeStream.finalGrid.exitElapsed = 0;
  shapeStream.finalGrid.exitProgress = 0;
  shapeStream.finalGrid.flashCount = 0;
  shapeStream.finalGrid.collapseProgress = 0;
  shapeStream.finalGrid.dissolveProgress = 0;
  shapeStream.finalGrid.portalProgress = 0;
  shapeStream.finalGrid.navigating = false;
  resetShapeStreamDoorwayExit();
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

function pickShapeStreamMaterial() {
  const totalWeight = shapeStream.palette.reduce((sum, _mat, index) => (
    sum + Math.max(0, SHAPE_STREAM_COLOR_WEIGHTS[index] ?? 1)
  ), 0);
  let cursor = Math.random() * Math.max(totalWeight, 1);
  for (let index = 0; index < shapeStream.palette.length; index++) {
    cursor -= Math.max(0, SHAPE_STREAM_COLOR_WEIGHTS[index] ?? 1);
    if (cursor <= 0) return { material: shapeStream.palette[index], colorIndex: index };
  }
  const colorIndex = shapeStream.palette.length - 1;
  return { material: shapeStream.palette[colorIndex], colorIndex };
}

function createShapeStreamMesh(geoIndex = Math.floor(Math.random() * shapeStream.geometries.length)) {
  const { material, colorIndex } = pickShapeStreamMaterial();
  const mesh = new THREE.Mesh(shapeStream.geometries[geoIndex], material);
  mesh.renderOrder = 1;
  scene.add(mesh);
  return { mesh, geoIndex, colorIndex };
}

function spawnStreamShape() {
  const { mesh, geoIndex, colorIndex } = createShapeStreamMesh();
  const size = SHAPE_STREAM.minSize + Math.random() * (SHAPE_STREAM.maxSize - SHAPE_STREAM.minSize);

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
    colorIndex,
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
    settled: false,
    feedbackImpactPlayed: false
  });
}

function detachShapeStreamItemPhysics(item) {
  if (!item?.body) return;
  if (shapeStream.world) shapeStream.world.removeRigidBody(item.body);
  item.body = null;
  item.collider = null;
  item.reservation = null;
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - THREE.MathUtils.clamp(t, 0, 1), 3);
}

function easeInCubic(t) {
  const clamped = THREE.MathUtils.clamp(t, 0, 1);
  return clamped * clamped * clamped;
}

function easeInOutCubic(t) {
  const clamped = THREE.MathUtils.clamp(t, 0, 1);
  return clamped < 0.5
    ? 4 * clamped * clamped * clamped
    : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
}

function shapeStreamDoorwayExitDuration(name) {
  if (!reducedMotionQuery.matches || calibrate) return SHAPE_STREAM_FINAL_GRID[name];
  if (name === 'closedRevealDuration') return 0.14;
  if (name === 'openRevealDuration') return 0.12;
  if (name === 'blinkDuration') return 0.14;
  if (name === 'postEyeHoldDuration') return 0.22;
  if (name === 'roomBreakDuration') return 2.55;
  if (name === 'blackFadeDuration') return 0.42;
  return SHAPE_STREAM_FINAL_GRID[name];
}

function setDoorwayEyeOpacity(closedOpacity = 0, openOpacity = 0, color = DOORWAY_EYE_COLOR, options = {}) {
  const maxOpacity = THREE.MathUtils.clamp(DOORWAY_EYE_TUNING.eyeOpacity, 0, 1);
  const closedMaxOpacity = options.closedMaxOpacity ?? maxOpacity;
  const openMaxOpacity = options.openMaxOpacity ?? maxOpacity;
  const closed = THREE.MathUtils.clamp(closedOpacity * closedMaxOpacity, 0, 1);
  const open = THREE.MathUtils.clamp(openOpacity * openMaxOpacity, 0, 1);
  doorwayExit.closedEye.visible = closed > 0.004;
  doorwayExit.openEye.visible = open > 0.004;
  doorwayExit.closedEye.material.opacity = closed;
  doorwayExit.openEye.material.opacity = open;
  doorwayExit.closedEye.material.color.copy(color);
  doorwayExit.openEye.material.color.copy(color);
}

function doorwayOverlayOpacity(baseRatio) {
  return THREE.MathUtils.clamp(DOORWAY_EYE_TUNING.overlayOpacity * baseRatio, 0, 1);
}

function applyDoorwayEyeTuning() {
  DOORWAY_EYE_COLOR.setHex(DOORWAY_EYE_TUNING.eyeColor);
  doorwayExit.closedEye.material.color.copy(DOORWAY_EYE_COLOR);
  doorwayExit.openEye.material.color.copy(DOORWAY_EYE_COLOR);
  doorwayExit.gravityVeil.material.color.setHex(DOORWAY_EYE_TUNING.overlayColor);
  doorwayExit.veil.material.color.setHex(DOORWAY_EYE_TUNING.overlayColor);
  doorwayExit.voidPlane.material.color.setHex(DOORWAY_EYE_TUNING.overlayColor);
}

function doorwayEyeAspect(texture = doorwayOpenEyeTexture) {
  const image = texture?.image;
  const width = image?.naturalWidth || image?.width || 1;
  const height = image?.naturalHeight || image?.height || 1;
  return width / Math.max(1, height);
}

function doorwayEyeScale() {
  return SHAPE_STREAM_FINAL_GRID.eyeDoorScale;
}

function doorwayDustRandom(index, salt = 0) {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

function doorwayDustCount() {
  if (reducedMotionQuery.matches) return SHAPE_STREAM_FINAL_GRID.dustReducedCount;
  return activeLayoutName === 'mobile'
    ? SHAPE_STREAM_FINAL_GRID.dustMobileCount
    : SHAPE_STREAM_FINAL_GRID.dustDesktopCount;
}

function seedDoorwayRoomDust(force = false) {
  const dust = doorwayExit.roomDust;
  const count = doorwayDustCount();
  const center = shapeLock.center;
  const key = [
    activeLayoutName,
    count,
    viewport.width.toFixed(3),
    viewport.height.toFixed(3),
    center.x.toFixed(3),
    center.y.toFixed(3)
  ].join(':');
  if (!force && dust.key === key && dust.count === count) return;

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const starts = new Float32Array(count * 3);
  const targets = new Float32Array(count * 3);
  const swirls = new Float32Array(count * 4);
  const doorNorm = worldToNorm(center);
  const reducedMotion = reducedMotionQuery.matches;

  for (let i = 0; i < count; i += 1) {
    const o = i * 3;
    const s = i * 4;
    let nx = doorwayDustRandom(i, 1);
    let ny = doorwayDustRandom(i, 2);
    const nearDoor = Math.abs(nx - doorNorm.x) < 0.12 && Math.abs(ny - doorNorm.y) < 0.16;
    if (nearDoor) {
      nx = nx < doorNorm.x ? nx * 0.72 : 1 - (1 - nx) * 0.72;
      ny = ny < doorNorm.y ? ny * 0.82 : 1 - (1 - ny) * 0.82;
    }
    const z = SHAPE_STREAM_FINAL_GRID.eyeZ - 0.24 - doorwayDustRandom(i, 3) * 0.22;
    const start = viewportToWorld(nx, ny, z);
    const targetAngle = doorwayDustRandom(i, 4) * Math.PI * 2;
    const targetRadius = THREE.MathUtils.lerp(0.015, 0.28, Math.pow(doorwayDustRandom(i, 5), 1.8));
    const target = new THREE.Vector3(
      center.x + Math.cos(targetAngle) * targetRadius,
      center.y + Math.sin(targetAngle) * targetRadius * 0.66,
      SHAPE_STREAM_FINAL_GRID.eyeZ + 0.025 + doorwayDustRandom(i, 6) * 0.035
    );

    starts[o] = start.x;
    starts[o + 1] = start.y;
    starts[o + 2] = start.z;
    targets[o] = target.x;
    targets[o + 1] = target.y;
    targets[o + 2] = target.z;
    positions[o] = start.x;
    positions[o + 1] = start.y;
    positions[o + 2] = start.z;

    swirls[s] = THREE.MathUtils.lerp(0.04, reducedMotion ? 0.18 : 0.62, doorwayDustRandom(i, 7));
    swirls[s + 1] = doorwayDustRandom(i, 8) * Math.PI * 2;
    swirls[s + 2] = THREE.MathUtils.lerp(1.2, reducedMotion ? 2.2 : 5.2, doorwayDustRandom(i, 9));
    swirls[s + 3] = doorwayDustRandom(i, 10) * 0.18;

    const warmth = doorwayDustRandom(i, 11);
    colors[o] = THREE.MathUtils.lerp(0.28, 1.0, warmth);
    colors[o + 1] = THREE.MathUtils.lerp(0.13, 0.66, warmth);
    colors[o + 2] = THREE.MathUtils.lerp(0.04, 0.24, warmth);
  }

  dust.count = count;
  dust.key = key;
  dust.starts = starts;
  dust.targets = targets;
  dust.swirls = swirls;
  dust.colors = colors;
  dust.positions = positions;
  dust.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  dust.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  dust.geometry.computeBoundingSphere();
}

function resetDoorwayRoomDust() {
  const dust = doorwayExit.roomDust;
  dust.points.visible = false;
  dust.points.material.opacity = 0;
  if (dust.positions && dust.starts) {
    dust.positions.set(dust.starts);
    const attr = dust.geometry.getAttribute('position');
    if (attr) attr.needsUpdate = true;
  }
}

function updateDoorwayRoomDust(progress = 0, opacityScale = 1) {
  seedDoorwayRoomDust();
  const dust = doorwayExit.roomDust;
  if (!dust.count || !dust.starts || !dust.targets || !dust.positions || !dust.swirls) return;
  const t = THREE.MathUtils.clamp(progress, 0, 1);
  const reducedMotion = reducedMotionQuery.matches;
  const opacityIn = easeOutCubic(THREE.MathUtils.clamp((t - 0.06) / 0.24, 0, 1));
  const opacityOut = 1 - easeInCubic(THREE.MathUtils.clamp((t - 0.72) / 0.28, 0, 1));
  const opacity = THREE.MathUtils.clamp(opacityIn * opacityOut * opacityScale, 0, 1);
  dust.points.visible = opacity > 0.004;
  dust.points.material.opacity = opacity * (reducedMotion ? 0.36 : 0.72);
  dust.points.material.size = reducedMotion ? 0.03 : 0.04;

  for (let i = 0; i < dust.count; i += 1) {
    const o = i * 3;
    const s = i * 4;
    const delay = dust.swirls[s + 3];
    const local = THREE.MathUtils.clamp((t - delay) / Math.max(0.001, 1 - delay * 0.56), 0, 1);
    const pull = easeInCubic(local);
    const spiral = Math.sin(local * Math.PI) * (1 - pull * 0.42);
    const radius = dust.swirls[s] * spiral * (reducedMotion ? 0.34 : 1);
    const angle = dust.swirls[s + 1] + dust.swirls[s + 2] * local;
    dust.positions[o] = THREE.MathUtils.lerp(dust.starts[o], dust.targets[o], pull) + Math.cos(angle) * radius;
    dust.positions[o + 1] = THREE.MathUtils.lerp(dust.starts[o + 1], dust.targets[o + 1], pull) + Math.sin(angle) * radius * 0.72;
    dust.positions[o + 2] = THREE.MathUtils.lerp(dust.starts[o + 2], dust.targets[o + 2], pull);
  }
  const attr = dust.geometry.getAttribute('position');
  if (attr) attr.needsUpdate = true;
}

function doorwayRoomShardCount() {
  if (reducedMotionQuery.matches) return SHAPE_STREAM_FINAL_GRID.roomShardReducedCount;
  return activeLayoutName === 'mobile'
    ? SHAPE_STREAM_FINAL_GRID.roomShardMobileCount
    : SHAPE_STREAM_FINAL_GRID.roomShardDesktopCount;
}

function clearDoorwayRoomShards() {
  const shards = doorwayExit.roomShards;
  shards.points.visible = false;
  shards.doorPoints.visible = false;
  shards.material.uniforms.uOpacity.value = 0;
  shards.doorMaterial.uniforms.uOpacity.value = 0;
  shards.starts = null;
  shards.targets = null;
  shards.positions = null;
  shards.uvs = null;
  shards.alphas = null;
  shards.cornerOffsets = null;
  shards.swirls = null;
  shards.doorStarts = null;
  shards.doorTargets = null;
  shards.doorPositions = null;
  shards.doorColors = null;
  shards.doorAlphas = null;
  shards.doorSizes = null;
  shards.doorBaseSizes = null;
  shards.doorSwirls = null;
  shards.count = 0;
  shards.doorCount = 0;
  shards.key = '';
  setDoorwayImageShardAttributes(shards.geometry, 0);
  setDoorwayParticleAttributes(shards.doorGeometry, 0);
}

function doorwayDoorParticleCount() {
  return 0;
}

function doorwayRoomBreakConfiguredDuration() {
  return Math.max(0.001, shapeStreamDoorwayExitDuration('roomBreakDuration'));
}

function doorwayRoomImageHandoffDuration() {
  return Math.min(
    doorwayRoomBreakConfiguredDuration() * 0.9,
    Math.max(0, SHAPE_STREAM_FINAL_GRID.roomImageHandoffDuration || 0)
  );
}

function doorwayRoomParticleBaseQueueDuration() {
  const count = Math.max(12, doorwayRoomShardCount());
  const batchSize = Math.max(1, SHAPE_STREAM_FINAL_GRID.roomParticleBatchSize);
  const batchCount = Math.ceil(count / batchSize) + 3;
  const batchSpan = Math.max(0, batchCount - 1) * SHAPE_STREAM_FINAL_GRID.roomParticleBatchInterval;
  return batchSpan
    + SHAPE_STREAM_FINAL_GRID.roomParticlePullDuration * 1.12
    + 0.28;
}

function doorwayRoomParticleQueueDuration() {
  const baseDuration = doorwayRoomParticleBaseQueueDuration();
  if (reducedMotionQuery.matches && !calibrate) return Math.max(1.55, baseDuration * 0.42);
  return baseDuration;
}

function doorwayRoomBreakPhaseDuration() {
  return Math.max(
    doorwayRoomBreakConfiguredDuration(),
    doorwayRoomImageHandoffDuration() + doorwayRoomParticleQueueDuration()
  );
}

function doorwayRoomBreakTimeScale() {
  return doorwayRoomParticleQueueDuration()
    / Math.max(0.001, doorwayRoomParticleBaseQueueDuration());
}

function doorwayRoomImageHandoffProgress(progress = 0) {
  const duration = doorwayRoomImageHandoffDuration();
  if (duration <= 0) return progress > 0 ? 1 : 0;
  const elapsed = THREE.MathUtils.clamp(progress, 0, 1) * doorwayRoomBreakPhaseDuration();
  return easeInOutCubic(THREE.MathUtils.clamp(elapsed / duration, 0, 1));
}

function doorwayRoomBreakVacuumElapsed(progress = 0) {
  const elapsed = THREE.MathUtils.clamp(progress, 0, 1) * doorwayRoomBreakPhaseDuration();
  return Math.max(0, elapsed - doorwayRoomImageHandoffDuration());
}

function doorwayRoomBackgroundHideProgress(progress = 0) {
  const handoff = doorwayRoomImageHandoffProgress(progress);
  return easeInOutCubic(THREE.MathUtils.clamp((handoff - 0.84) / 0.16, 0, 1));
}

function doorwayRoomVacuumProgress(progress = 0) {
  return THREE.MathUtils.clamp(
    doorwayRoomBreakVacuumElapsed(progress) / Math.max(0.001, doorwayRoomParticleQueueDuration()),
    0,
    1
  );
}

function doorwayRoomDimmingProgress(progress = 0) {
  const vacuum = doorwayRoomVacuumProgress(progress);
  return easeInOutCubic(THREE.MathUtils.clamp((vacuum - 0.04) / 0.86, 0, 1));
}

function clearDoorwayAmbientDimming() {
  doorwayExit.gravityVeil.visible = false;
  doorwayExit.gravityVeil.material.opacity = 0;
  doorwayExit.veil.visible = false;
  doorwayExit.veil.material.opacity = 0;
}

function applyDoorwayAmbientDimming(progress = 0) {
  const dim = doorwayRoomDimmingProgress(progress);
  const radialOpacity = doorwayOverlayOpacity((reducedMotionQuery.matches ? 0.20 : 0.34) * dim);
  const veilOpacity = doorwayOverlayOpacity((reducedMotionQuery.matches ? 0.10 : 0.22) * dim);
  doorwayExit.gravityVeil.visible = radialOpacity > 0.004;
  doorwayExit.gravityVeil.material.opacity = radialOpacity;
  doorwayExit.veil.visible = veilOpacity > 0.004;
  doorwayExit.veil.material.opacity = veilOpacity;
}

function assignDoorwayParticleVacuumQueue(records, swirls, stride, options) {
  const reducedMotion = reducedMotionQuery.matches;
  const timeScale = doorwayRoomBreakTimeScale();
  const batchSize = Math.max(1, options.batchSize);
  records
    .slice()
    .sort((a, b) => (
      a.distance - b.distance
      || a.angle - b.angle
      || a.index - b.index
    ))
    .forEach((record, order) => {
      const offset = record.index * stride;
      const batchIndex = Math.floor(order / batchSize);
      const startJitter = doorwayDustRandom(record.index, options.jitterSalt) * options.jitter;
      const durationJitter = THREE.MathUtils.lerp(
        options.durationJitterMin,
        options.durationJitterMax,
        doorwayDustRandom(record.index, options.durationSalt)
      );
      const radiusJitter = THREE.MathUtils.lerp(
        options.radiusJitterMin,
        options.radiusJitterMax,
        doorwayDustRandom(record.index, options.radiusSalt)
      );
      const spinJitter = THREE.MathUtils.lerp(
        options.spinJitterMin,
        options.spinJitterMax,
        doorwayDustRandom(record.index, options.spinSalt)
      );
      swirls[offset] = (options.startOffset + batchIndex * options.batchInterval + startJitter) * timeScale;
      swirls[offset + 1] = options.pullDuration * durationJitter * timeScale;
      swirls[offset + 2] = Math.max(options.minRadius, record.distance * options.orbitScale)
        * radiusJitter
        * (reducedMotion ? 0.26 : 1);
      swirls[offset + 3] = record.angle + order * options.angleStep;
      swirls[offset + 4] = options.spinTurns * spinJitter * (reducedMotion ? 0.28 : 1);
      swirls[offset + 5] = record.index % 2 ? -1 : 1;
    });
}

function setDoorwayParticleAttributes(geometry, count, positions, colors, alphas, sizes) {
  geometry.setAttribute('position', new THREE.BufferAttribute(positions || new Float32Array(count * 3), 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors || new Float32Array(count * 3), 3));
  geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas || new Float32Array(count), 1));
  geometry.setAttribute('particleSize', new THREE.BufferAttribute(sizes || new Float32Array(count), 1));
  geometry.computeBoundingSphere();
}

function setDoorwayImageShardAttributes(geometry, count, positions, uvs, alphas) {
  geometry.setAttribute('position', new THREE.BufferAttribute(positions || new Float32Array(count * 12), 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs || new Float32Array(count * 8), 2));
  geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas || new Float32Array(count * 4), 1));
  const IndexArray = count * 4 > 65535 ? Uint32Array : Uint16Array;
  const indices = new IndexArray(count * 6);
  for (let i = 0; i < count; i += 1) {
    const vertex = i * 4;
    const index = i * 6;
    indices[index] = vertex;
    indices[index + 1] = vertex + 1;
    indices[index + 2] = vertex + 2;
    indices[index + 3] = vertex;
    indices[index + 4] = vertex + 2;
    indices[index + 5] = vertex + 3;
  }
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
}

function doorwayRoomImageCoverMetrics() {
  if (!roomBgImage?.complete) return null;
  const naturalWidth = roomBgImage.naturalWidth || roomBgImage.width || 1;
  const naturalHeight = roomBgImage.naturalHeight || roomBgImage.height || 1;
  const rootRect = root.getBoundingClientRect();
  const containerWidth = rootRect.width || roomBgImage.clientWidth || naturalWidth;
  const containerHeight = rootRect.height || roomBgImage.clientHeight || naturalHeight;
  return {
    imageAspect: naturalWidth / Math.max(1, naturalHeight),
    containerAspect: containerWidth / Math.max(1, containerHeight)
  };
}

function roomImageCoverSampleUv(metrics, x, y) {
  let u = THREE.MathUtils.clamp(x, 0, 1);
  let v = THREE.MathUtils.clamp(y, 0, 1);
  if (!metrics) return { u, v };
  if (metrics.imageAspect > metrics.containerAspect) {
    const visibleWidth = THREE.MathUtils.clamp(metrics.containerAspect / metrics.imageAspect, 0.001, 1);
    u = (1 - visibleWidth) * 0.5 + u * visibleWidth;
  } else if (metrics.imageAspect < metrics.containerAspect) {
    const visibleHeight = THREE.MathUtils.clamp(metrics.imageAspect / metrics.containerAspect, 0.001, 1);
    v = (1 - visibleHeight) * 0.5 + v * visibleHeight;
  }
  return { u, v };
}

function seedDoorwayRoomShards(force = false) {
  if (!roomBgImage?.complete) return;
  syncRoomBackdropTexture();
  const shards = doorwayExit.roomShards;
  const visible = viewportMetrics();
  const visibleWidth = Math.max(0.001, visible.width * viewport.width);
  const visibleHeight = Math.max(0.001, visible.height * viewport.height);
  const aspect = visibleWidth / visibleHeight;
  const targetCount = Math.max(12, doorwayRoomShardCount());
  const columns = Math.max(4, Math.ceil(Math.sqrt(targetCount * aspect)));
  const rows = Math.max(4, Math.ceil(targetCount / columns));
  const src = roomBgImage.currentSrc || roomBgImage.src || '';
  const phaseDuration = doorwayRoomBreakPhaseDuration();
  const key = [
    src,
    activeLayoutName,
    columns,
    rows,
    phaseDuration.toFixed(3),
    viewport.width.toFixed(3),
    viewport.height.toFixed(3),
    visible.left.toFixed(4),
    visible.top.toFixed(4),
    visible.width.toFixed(4),
    visible.height.toFixed(4),
    shapeLock.center.x.toFixed(3),
    shapeLock.center.y.toFixed(3),
    DOORWAY_EYE_TUNING.eyeColor.toString(16)
  ].join(':');
  if (!force && shards.key === key && shards.count > 0) return;

  clearDoorwayRoomShards();
  shards.key = key;
  shards.material.uniforms.map.value = roomBackdrop.texture;
  shards.material.needsUpdate = true;

  const door = shapeLock.center;
  const reducedMotion = reducedMotionQuery.matches;
  const imageMetrics = doorwayRoomImageCoverMetrics();
  const count = rows * columns;
  const positions = new Float32Array(count * 12);
  const uvs = new Float32Array(count * 8);
  const alphas = new Float32Array(count * 4);
  const cornerOffsets = new Float32Array(count * 8);
  const starts = new Float32Array(count * 3);
  const targets = new Float32Array(count * 3);
  const swirls = new Float32Array(count * 6);
  const roomRecords = [];
  const cellW = visibleWidth / columns;
  const cellH = visibleHeight / rows;
  let index = 0;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x0 = column / columns;
      const x1 = (column + 1) / columns;
      const y0 = row / rows;
      const y1 = (row + 1) / rows;
      const localX = (x0 + x1) * 0.5;
      const localY = (y0 + y1) * 0.5;
      const nx = visible.left + localX * visible.width;
      const ny = visible.top + localY * visible.height;
      const startPosition = toWorld(
        nx,
        ny,
        SHAPE_STREAM_FINAL_GRID.eyeZ - 0.22 - index * 0.000002
      );
      const dx = startPosition.x - door.x;
      const dy = startPosition.y - door.y;
      const distance = Math.max(0.0001, Math.hypot(dx, dy));
      const angleToDoor = Math.atan2(dy, dx);
      const targetAngle = doorwayDustRandom(index, 61) * Math.PI * 2;
      const targetRadius = THREE.MathUtils.lerp(0.006, 0.14, Math.pow(doorwayDustRandom(index, 62), 1.8));
      const pullTarget = new THREE.Vector3(
        door.x + Math.cos(targetAngle) * targetRadius,
        door.y + Math.sin(targetAngle) * targetRadius * 0.66,
        SHAPE_STREAM_FINAL_GRID.eyeZ - 0.02 + doorwayDustRandom(index, 63) * 0.05
      );
      const offset = index * 3;
      const vertexOffset = index * 12;
      const uvOffset = index * 8;
      const cornerOffset = index * 8;
      const halfW = cellW * 0.505;
      const halfH = cellH * 0.505;
      const cornerData = [
        [-halfW, halfH, x0, y0],
        [halfW, halfH, x1, y0],
        [halfW, -halfH, x1, y1],
        [-halfW, -halfH, x0, y1]
      ];
      starts[offset] = startPosition.x;
      starts[offset + 1] = startPosition.y;
      starts[offset + 2] = startPosition.z;
      targets[offset] = pullTarget.x;
      targets[offset + 1] = pullTarget.y;
      targets[offset + 2] = pullTarget.z;
      cornerData.forEach(([cornerX, cornerY, uvX, uvY], cornerIndex) => {
        const positionIndex = vertexOffset + cornerIndex * 3;
        const imageUv = roomImageCoverSampleUv(imageMetrics, uvX, uvY);
        positions[positionIndex] = startPosition.x + cornerX;
        positions[positionIndex + 1] = startPosition.y + cornerY;
        positions[positionIndex + 2] = startPosition.z;
        cornerOffsets[cornerOffset + cornerIndex * 2] = cornerX;
        cornerOffsets[cornerOffset + cornerIndex * 2 + 1] = cornerY;
        uvs[uvOffset + cornerIndex * 2] = imageUv.u;
        uvs[uvOffset + cornerIndex * 2 + 1] = 1 - imageUv.v;
        alphas[index * 4 + cornerIndex] = 0;
      });
      roomRecords.push({ index, distance, angle: angleToDoor });
      index += 1;
    }
  }

  assignDoorwayParticleVacuumQueue(roomRecords, swirls, 6, {
    startOffset: 0,
    batchSize: SHAPE_STREAM_FINAL_GRID.roomParticleBatchSize,
    batchInterval: SHAPE_STREAM_FINAL_GRID.roomParticleBatchInterval,
    pullDuration: SHAPE_STREAM_FINAL_GRID.roomParticlePullDuration,
    orbitScale: SHAPE_STREAM_FINAL_GRID.roomParticleOrbitScale,
    minRadius: 0.012,
    angleStep: 0.37,
    spinTurns: 0.62,
    jitter: 0.010,
    jitterSalt: 66,
    durationSalt: 67,
    durationJitterMin: 0.92,
    durationJitterMax: 1.08,
    radiusSalt: 68,
    radiusJitterMin: 0.72,
    radiusJitterMax: 1.18,
    spinSalt: 69,
    spinJitterMin: 0.78,
    spinJitterMax: 1.18
  });

  shards.count = count;
  shards.starts = starts;
  shards.targets = targets;
  shards.positions = positions;
  shards.uvs = uvs;
  shards.alphas = alphas;
  shards.cornerOffsets = cornerOffsets;
  shards.swirls = swirls;
  setDoorwayImageShardAttributes(shards.geometry, count, positions, uvs, alphas);

  const doorCount = doorwayDoorParticleCount();
  const doorStarts = new Float32Array(doorCount * 3);
  const doorTargets = new Float32Array(doorCount * 3);
  const doorPositions = new Float32Array(doorCount * 3);
  const doorColors = new Float32Array(doorCount * 3);
  const doorAlphas = new Float32Array(doorCount);
  const doorSizes = new Float32Array(doorCount);
  const doorBaseSizes = new Float32Array(doorCount);
  const doorSwirls = new Float32Array(doorCount * 6);
  const doorRecords = [];
  const eyeAspect = doorwayEyeAspect(doorwayOpenEyeTexture);
  const eyeColor = new THREE.Color(DOORWAY_EYE_TUNING.eyeColor);
  for (let i = 0; i < doorCount; i += 1) {
    const offset = i * 3;
    const angle = doorwayDustRandom(i, 91) * Math.PI * 2;
    const radius = Math.pow(doorwayDustRandom(i, 92), 0.54) * SHAPE_STREAM_FINAL_GRID.eyeDoorScale * 0.52;
    const start = new THREE.Vector3(
      door.x + Math.cos(angle) * radius * eyeAspect * 0.82,
      door.y + Math.sin(angle) * radius * 0.56,
      SHAPE_STREAM_FINAL_GRID.eyeZ + 0.006 + doorwayDustRandom(i, 93) * 0.025
    );
    const targetAngle = doorwayDustRandom(i, 94) * Math.PI * 2;
    const targetRadius = THREE.MathUtils.lerp(0.002, 0.08, Math.pow(doorwayDustRandom(i, 95), 2.0));
    const target = new THREE.Vector3(
      door.x + Math.cos(targetAngle) * targetRadius,
      door.y + Math.sin(targetAngle) * targetRadius * 0.65,
      SHAPE_STREAM_FINAL_GRID.eyeZ + 0.04 + doorwayDustRandom(i, 96) * 0.04
    );
    doorStarts[offset] = start.x;
    doorStarts[offset + 1] = start.y;
    doorStarts[offset + 2] = start.z;
    doorPositions[offset] = start.x;
    doorPositions[offset + 1] = start.y;
    doorPositions[offset + 2] = start.z;
    doorTargets[offset] = target.x;
    doorTargets[offset + 1] = target.y;
    doorTargets[offset + 2] = target.z;
    const warmth = THREE.MathUtils.lerp(0.72, 1.18, doorwayDustRandom(i, 97));
    doorColors[offset] = THREE.MathUtils.clamp(eyeColor.r * warmth, 0, 1);
    doorColors[offset + 1] = THREE.MathUtils.clamp(eyeColor.g * warmth, 0, 1);
    doorColors[offset + 2] = THREE.MathUtils.clamp(eyeColor.b * warmth, 0, 1);
    const baseSize = THREE.MathUtils.lerp(reducedMotion ? 2.2 : 2.8, reducedMotion ? 4.0 : 6.8, doorwayDustRandom(i, 98));
    doorSizes[i] = baseSize;
    doorBaseSizes[i] = baseSize;
    const dx = start.x - door.x;
    const dy = start.y - door.y;
    doorRecords.push({
      index: i,
      distance: Math.max(0.0001, Math.hypot(dx, dy)),
      angle: Math.atan2(dy, dx)
    });
  }
  assignDoorwayParticleVacuumQueue(doorRecords, doorSwirls, 6, {
    startOffset: SHAPE_STREAM_FINAL_GRID.doorParticleStartTime,
    batchSize: SHAPE_STREAM_FINAL_GRID.doorParticleBatchSize,
    batchInterval: SHAPE_STREAM_FINAL_GRID.doorParticleBatchInterval,
    pullDuration: SHAPE_STREAM_FINAL_GRID.doorParticlePullDuration,
    orbitScale: SHAPE_STREAM_FINAL_GRID.doorParticleOrbitScale,
    minRadius: 0.014,
    angleStep: 0.29,
    spinTurns: 0.54,
    jitter: 0.006,
    jitterSalt: 99,
    durationSalt: 100,
    durationJitterMin: 0.94,
    durationJitterMax: 1.10,
    radiusSalt: 101,
    radiusJitterMin: 0.76,
    radiusJitterMax: 1.28,
    spinSalt: 102,
    spinJitterMin: 0.78,
    spinJitterMax: 1.14
  });
  shards.doorCount = doorCount;
  shards.doorStarts = doorStarts;
  shards.doorTargets = doorTargets;
  shards.doorPositions = doorPositions;
  shards.doorColors = doorColors;
  shards.doorAlphas = doorAlphas;
  shards.doorSizes = doorSizes;
  shards.doorBaseSizes = doorBaseSizes;
  shards.doorSwirls = doorSwirls;
  setDoorwayParticleAttributes(shards.doorGeometry, doorCount, doorPositions, doorColors, doorAlphas, doorSizes);
}

function updateDoorwayImageShardSet(options) {
  const {
    count,
    starts,
    targets,
    positions,
    alphas,
    cornerOffsets,
    swirls,
    elapsed,
    opacityScale,
    preStartVisible = false
  } = options;
  if (!count || !starts || !targets || !positions || !alphas || !cornerOffsets || !swirls) return 0;

  const reducedMotion = reducedMotionQuery.matches;
  let visibleCount = 0;
  for (let i = 0; i < count; i += 1) {
    const offset = i * 3;
    const vertexOffset = i * 12;
    const alphaOffset = i * 4;
    const cornerOffset = i * 8;
    const swirlOffset = i * 6;
    const startTime = swirls[swirlOffset];
    const duration = Math.max(0.001, swirls[swirlOffset + 1]);
    const rawLocal = (elapsed - startTime) / duration;
    const local = THREE.MathUtils.clamp(rawLocal, 0, 1);
    const started = rawLocal > 0;
    const finished = rawLocal >= 1;
    const pull = easeInCubic(local);
    const spinAngle = swirls[swirlOffset + 3]
      + pull * Math.PI * 2 * swirls[swirlOffset + 4] * swirls[swirlOffset + 5];
    const orbit = swirls[swirlOffset + 2] * Math.sin(local * Math.PI) * (1 - pull * 0.45);
    const centerX = THREE.MathUtils.lerp(starts[offset], targets[offset], pull)
      + Math.cos(spinAngle) * orbit;
    const centerY = THREE.MathUtils.lerp(starts[offset + 1], targets[offset + 1], pull)
      + Math.sin(spinAngle) * orbit * 0.62;
    const centerZ = THREE.MathUtils.lerp(starts[offset + 2], targets[offset + 2], pull)
      + Math.sin(spinAngle * 0.7) * orbit * 0.18;
    const opacityIn = preStartVisible
      ? 1
      : started
        ? easeOutCubic(THREE.MathUtils.clamp(local / 0.10, 0, 1))
        : 0;
    const opacityOut = 1 - easeInCubic(THREE.MathUtils.clamp((local - 0.84) / 0.16, 0, 1));
    const opacity = finished ? 0 : THREE.MathUtils.clamp(opacityIn * opacityOut * opacityScale, 0, 1);
    const shrink = easeInCubic(THREE.MathUtils.clamp((local - 0.78) / 0.22, 0, 1));
    const scale = THREE.MathUtils.lerp(1, 0.24, shrink);
    const rotation = started && !reducedMotion
      ? swirls[swirlOffset + 5] * easeInCubic(local) * Math.PI * 1.08
      : 0;
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);

    for (let corner = 0; corner < 4; corner += 1) {
      const cornerIndex = cornerOffset + corner * 2;
      const positionIndex = vertexOffset + corner * 3;
      const cornerX = cornerOffsets[cornerIndex] * scale;
      const cornerY = cornerOffsets[cornerIndex + 1] * scale;
      positions[positionIndex] = centerX + cornerX * cos - cornerY * sin;
      positions[positionIndex + 1] = centerY + cornerX * sin + cornerY * cos;
      positions[positionIndex + 2] = centerZ;
      alphas[alphaOffset + corner] = opacity;
    }
    if (opacity > 0.004) visibleCount += 1;
  }
  return visibleCount;
}

function updateDoorwayVacuumParticleSet(options) {
  const {
    count,
    starts,
    targets,
    positions,
    alphas,
    sizes,
    baseSizes,
    swirls,
    elapsed,
    opacityScale,
    preStartVisible = false
  } = options;
  if (!count || !starts || !targets || !positions || !alphas || !sizes || !baseSizes || !swirls) return 0;

  let visibleCount = 0;
  for (let i = 0; i < count; i += 1) {
    const offset = i * 3;
    const swirlOffset = i * 6;
    const startTime = swirls[swirlOffset];
    const duration = Math.max(0.001, swirls[swirlOffset + 1]);
    const rawLocal = (elapsed - startTime) / duration;
    const local = THREE.MathUtils.clamp(rawLocal, 0, 1);
    const started = rawLocal > 0;
    const finished = rawLocal >= 1;
    const pull = easeInCubic(local);
    const spinAngle = swirls[swirlOffset + 3]
      + pull * Math.PI * 2 * swirls[swirlOffset + 4] * swirls[swirlOffset + 5];
    const orbit = swirls[swirlOffset + 2] * Math.sin(local * Math.PI) * (1 - pull * 0.45);

    positions[offset] = THREE.MathUtils.lerp(starts[offset], targets[offset], pull)
      + Math.cos(spinAngle) * orbit;
    positions[offset + 1] = THREE.MathUtils.lerp(starts[offset + 1], targets[offset + 1], pull)
      + Math.sin(spinAngle) * orbit * 0.62;
    positions[offset + 2] = THREE.MathUtils.lerp(starts[offset + 2], targets[offset + 2], pull)
      + Math.sin(spinAngle * 0.7) * orbit * 0.18;

    const opacityIn = preStartVisible
      ? 1
      : started
        ? easeOutCubic(THREE.MathUtils.clamp(local / 0.10, 0, 1))
        : 0;
    const opacityOut = 1 - easeInCubic(THREE.MathUtils.clamp((local - 0.84) / 0.16, 0, 1));
    const opacity = finished ? 0 : THREE.MathUtils.clamp(opacityIn * opacityOut * opacityScale, 0, 1);
    const shrink = easeInCubic(THREE.MathUtils.clamp((local - 0.78) / 0.22, 0, 1));
    sizes[i] = baseSizes[i] * THREE.MathUtils.lerp(1, 0.26, shrink);
    alphas[i] = opacity;
    if (opacity > 0.004) visibleCount += 1;
  }
  return visibleCount;
}

function updateDoorwayRoomShards(progress = 0, opacityScale = 1) {
  seedDoorwayRoomShards();
  const shards = doorwayExit.roomShards;
  if (!shards.count || !shards.starts || !shards.targets || !shards.positions || !shards.alphas || !shards.cornerOffsets || !shards.swirls) return;
  const t = THREE.MathUtils.clamp(progress, 0, 1);
  const elapsed = doorwayRoomBreakVacuumElapsed(t);
  const handoff = doorwayRoomImageHandoffProgress(t);
  const effectiveOpacityScale = THREE.MathUtils.clamp(opacityScale, 0, 1) * handoff;
  const visibleCount = updateDoorwayImageShardSet({
    count: shards.count,
    starts: shards.starts,
    targets: shards.targets,
    positions: shards.positions,
    alphas: shards.alphas,
    cornerOffsets: shards.cornerOffsets,
    swirls: shards.swirls,
    elapsed,
    opacityScale: effectiveOpacityScale,
    preStartVisible: true
  });
  const posAttr = shards.geometry.getAttribute('position');
  const alphaAttr = shards.geometry.getAttribute('alpha');
  if (posAttr) posAttr.needsUpdate = true;
  if (alphaAttr) alphaAttr.needsUpdate = true;
  shards.material.uniforms.uOpacity.value = 1;
  shards.points.visible = visibleCount > 0;

  const doorVisibleCount = updateDoorwayVacuumParticleSet({
    count: shards.doorCount,
    starts: shards.doorStarts,
    targets: shards.doorTargets,
    positions: shards.doorPositions,
    alphas: shards.doorAlphas,
    sizes: shards.doorSizes,
    baseSizes: shards.doorBaseSizes,
    swirls: shards.doorSwirls,
    elapsed,
    opacityScale: effectiveOpacityScale
  });
  const doorPosAttr = shards.doorGeometry.getAttribute('position');
  const doorAlphaAttr = shards.doorGeometry.getAttribute('alpha');
  const doorSizeAttr = shards.doorGeometry.getAttribute('particleSize');
  if (doorPosAttr) doorPosAttr.needsUpdate = true;
  if (doorAlphaAttr) doorAlphaAttr.needsUpdate = true;
  if (doorSizeAttr) doorSizeAttr.needsUpdate = true;
  shards.doorMaterial.uniforms.uOpacity.value = 1;
  shards.doorPoints.visible = doorVisibleCount > 0;
}

function resetDoorwayRoomBreak() {
  if (roomBgImage) {
    roomBgImage.style.opacity = '';
    roomBgImage.style.filter = '';
    roomBgImage.style.willChange = '';
  }
  const shards = doorwayExit.roomShards;
  shards.points.visible = false;
  shards.doorPoints.visible = false;
  shards.material.uniforms.uOpacity.value = 0;
  shards.doorMaterial.uniforms.uOpacity.value = 0;
  if (shards.alphas) {
    shards.alphas.fill(0);
    const alphaAttr = shards.geometry.getAttribute('alpha');
    if (alphaAttr) alphaAttr.needsUpdate = true;
  }
  if (shards.doorAlphas) {
    shards.doorAlphas.fill(0);
    const doorAlphaAttr = shards.doorGeometry.getAttribute('alpha');
    if (doorAlphaAttr) doorAlphaAttr.needsUpdate = true;
  }
}

function applyDoorwayRoomBreak(progress = 0, fragmentsActive = progress > 0) {
  if (!roomBgImage) return;
  const t = THREE.MathUtils.clamp(progress, 0, 1);
  const hide = fragmentsActive ? doorwayRoomBackgroundHideProgress(t) : 0;
  const opacity = 1 - hide;
  roomBgImage.style.opacity = opacity.toFixed(3);
  roomBgImage.style.filter = '';
  roomBgImage.style.willChange = 'opacity';
}

function applyDoorwayBlackFade(progress = 0) {
  const t = easeInCubic(THREE.MathUtils.clamp(progress, 0, 1));
  doorwayExit.blackPlane.visible = t > 0.004;
  doorwayExit.blackPlane.material.opacity = t;
}

function resetDoorwayBlackFade() {
  doorwayExit.blackPlane.visible = false;
  doorwayExit.blackPlane.material.opacity = 0;
}

function resetDoorwayGravityWarp() {
  doorwayExit.gravityWarp.phase = 'idle';
  doorwayExit.gravityWarp.progress = 0;
  doorwayExit.gravityWarp.intensity = 0;
  doorwayExit.gravityWarp.filterScale = 0;
  doorwayExit.gravityWarp.blur = 0;
  doorwayExit.gravityWarp.contrast = 1;
  doorwayExit.gravityWarp.brightness = 1;
  doorwayExit.gravityWarp.saturate = 1;
  root.classList.remove('is-gravity-warping');
  root.style.setProperty('--gravity-warp-blur', '0px');
  root.style.setProperty('--gravity-warp-contrast', '1');
  root.style.setProperty('--gravity-warp-brightness', '1');
  root.style.setProperty('--gravity-warp-saturate', '1');
  if (gravityWarpDisplacement) gravityWarpDisplacement.setAttribute('scale', '0');
  if (gravityWarpTurbulence) gravityWarpTurbulence.setAttribute('baseFrequency', '0.010 0.016');
}

function resetDoorwayViewerPull() {
  doorwayExit.pullProgress = 0;
  doorwayExit.pullOriginX = 50;
  doorwayExit.pullOriginY = 50;
  doorwayExit.pullTranslateX = 0;
  doorwayExit.pullTranslateY = 0;
  artStage.style.transform = '';
  artStage.style.transformOrigin = '';
  artStage.style.willChange = '';
}

function updateDoorwayGravityRings(phase = 'idle', progress = 0) {
  doorwayExit.rings.forEach((ring) => {
    ring.visible = false;
    ring.material.opacity = 0;
    ring.userData.scale = 0;
  });
}

function layoutShapeStreamDoorwayExit(scale = doorwayExit.scale, voidScale = doorwayExit.voidScale) {
  doorwayExit.scale = scale;
  doorwayExit.voidScale = voidScale;
  const radialScale = Math.max(viewport.width, viewport.height) * 2.35;
  doorwayExit.gravityVeil.position.set(shapeLock.center.x, shapeLock.center.y, SHAPE_STREAM_FINAL_GRID.eyeZ - 0.04);
  doorwayExit.gravityVeil.scale.set(radialScale, radialScale, 1);
  doorwayExit.veil.position.set(0, 0, SHAPE_STREAM_FINAL_GRID.eyeZ - 0.02);
  doorwayExit.veil.scale.set(viewport.width, viewport.height, 1);
  doorwayExit.blackPlane.position.set(0, 0, SHAPE_STREAM_FINAL_GRID.eyeZ + 0.22);
  doorwayExit.blackPlane.scale.set(viewport.width, viewport.height, 1);
  doorwayExit.voidPlane.position.set(shapeLock.center.x, shapeLock.center.y, SHAPE_STREAM_FINAL_GRID.eyeZ - 0.01);
  doorwayExit.voidPlane.scale.setScalar(voidScale);
  doorwayExit.closedEye.position.set(shapeLock.center.x, shapeLock.center.y, SHAPE_STREAM_FINAL_GRID.eyeZ);
  doorwayExit.openEye.position.set(shapeLock.center.x, shapeLock.center.y, SHAPE_STREAM_FINAL_GRID.eyeZ + 0.001);
  doorwayExit.closedEye.rotation.set(0, 0, 0);
  doorwayExit.openEye.rotation.set(0, 0, 0);
  doorwayExit.closedEye.scale.set(scale * doorwayEyeAspect(doorwayClosedEyeTexture), scale, 1);
  doorwayExit.openEye.scale.set(scale * doorwayEyeAspect(doorwayOpenEyeTexture), scale, 1);
  doorwayExit.rings.forEach((ring, index) => {
    ring.position.set(shapeLock.center.x, shapeLock.center.y, SHAPE_STREAM_FINAL_GRID.eyeZ + 0.002 + index * 0.0002);
    ring.scale.setScalar(ring.userData.scale || scale);
  });
}

function isDoorwayEyeCalibrationPreviewActive() {
  return calibrate && (
    doorwayExit.calibrationPreview === 'open'
    || doorwayExit.calibrationPreview === 'closed'
    || doorwayExit.calibrationPreview === 'blink'
  );
}

function doorwayEyeCalibrationBlinkVisible() {
  const totalBlinks = Math.max(1, SHAPE_STREAM_FINAL_GRID.blinkCount);
  const duration = Math.max(0.001, SHAPE_STREAM_FINAL_GRID.blinkDuration * totalBlinks);
  const progress = THREE.MathUtils.clamp(doorwayExit.calibrationBlinkElapsed / duration, 0, 1);
  const rawBlink = progress * totalBlinks;
  const blinkLocal = progress >= 1 ? 1 : rawBlink - Math.floor(rawBlink);
  return progress < 1 && blinkLocal < 0.5;
}

function doorwayEyeCalibrationBlinkFrame() {
  const totalBlinks = Math.max(1, SHAPE_STREAM_FINAL_GRID.blinkCount);
  const blinkDuration = Math.max(0.001, SHAPE_STREAM_FINAL_GRID.blinkDuration * totalBlinks);
  const revealDuration = Math.max(0.001, SHAPE_STREAM_FINAL_GRID.openRevealDuration);
  if (doorwayExit.calibrationBlinkElapsed < blinkDuration) {
    return {
      closedOpacity: doorwayEyeCalibrationBlinkVisible() ? 1 : 0,
      openOpacity: 0,
      complete: false
    };
  }
  const revealProgress = THREE.MathUtils.clamp(
    (doorwayExit.calibrationBlinkElapsed - blinkDuration) / revealDuration,
    0,
    1
  );
  const t = easeOutCubic(revealProgress);
  return {
    closedOpacity: 1 - t,
    openOpacity: t,
    complete: revealProgress >= 1
  };
}

function applyDoorwayEyeCalibrationFrame(closedOpacity = 0, openOpacity = 0, options = {}) {
  resetDoorwayViewerPull();
  resetDoorwayGravityWarp();
  resetDoorwayRoomBreak();
  resetDoorwayBlackFade();
  resetDoorwayRoomDust();
  doorwayExit.voidPlane.visible = true;
  doorwayExit.voidPlane.material.color.setHex(DOORWAY_EYE_TUNING.overlayColor);
  doorwayExit.voidPlane.material.opacity = doorwayOverlayOpacity(0.71);
  doorwayExit.gravityVeil.visible = false;
  doorwayExit.gravityVeil.material.opacity = 0;
  doorwayExit.veil.visible = false;
  doorwayExit.veil.material.opacity = 0;
  updateDoorwayGravityRings('calibrationPreview', 0);
  setDoorwayEyeOpacity(closedOpacity, openOpacity, DOORWAY_EYE_COLOR, options);
  layoutShapeStreamDoorwayExit(
    doorwayEyeScale(),
    SHAPE_STREAM_FINAL_GRID.voidDoorScale * 0.58
  );
}

function applyDoorwayEyeCalibrationPreview() {
  if (!isDoorwayEyeCalibrationPreviewActive()) return;
  if (doorwayExit.calibrationPreview === 'closed') {
    applyDoorwayEyeCalibrationFrame(1, 0);
  } else if (doorwayExit.calibrationPreview === 'blink') {
    const frame = doorwayEyeCalibrationBlinkFrame();
    applyDoorwayEyeCalibrationFrame(frame.closedOpacity, frame.openOpacity, { openMaxOpacity: 1 });
  } else {
    applyDoorwayEyeCalibrationFrame(0, 1, { openMaxOpacity: 1 });
  }
}

function showDoorwayEyeCalibrationPreview(mode = 'open') {
  if (!calibrate) return;
  clearDoorwayTransitionPreviewState();
  doorwayExit.calibrationPreview = mode === 'closed' ? 'closed' : 'open';
  doorwayExit.calibrationBlinkElapsed = 0;
  applyDoorwayEyeCalibrationPreview();
  status.textContent = `${doorwayExit.calibrationPreview} eye preview - ${activeLayoutName}`;
  updateCalibrationConsole();
}

function startDoorwayEyeBlinkPreview() {
  if (!calibrate) return;
  clearDoorwayTransitionPreviewState();
  doorwayExit.calibrationPreview = 'blink';
  doorwayExit.calibrationBlinkElapsed = 0;
  applyDoorwayEyeCalibrationPreview();
  status.textContent = `blink preview - ${activeLayoutName}`;
  updateCalibrationConsole();
}

function hideDoorwayEyeCalibrationPreview() {
  if (!calibrate) return;
  clearDoorwayTransitionPreviewState();
  doorwayExit.calibrationPreview = 'none';
  doorwayExit.calibrationBlinkElapsed = 0;
  setDoorwayEyeOpacity(0, 0);
  doorwayExit.gravityVeil.visible = false;
  doorwayExit.gravityVeil.material.opacity = 0;
  doorwayExit.voidPlane.visible = false;
  doorwayExit.voidPlane.material.opacity = 0;
  doorwayExit.veil.visible = false;
  doorwayExit.veil.material.opacity = 0;
  updateDoorwayGravityRings('calibrationPreview', 0);
  resetDoorwayRoomDust();
  resetDoorwayRoomBreak();
  resetDoorwayBlackFade();
  status.textContent = `eye preview hidden - ${activeLayoutName}`;
  updateCalibrationConsole();
}

function updateDoorwayEyeBlinkPreview(delta) {
  if (!calibrate || doorwayExit.calibrationPreview !== 'blink') return;
  doorwayExit.calibrationBlinkElapsed += delta;
  const totalBlinks = Math.max(1, SHAPE_STREAM_FINAL_GRID.blinkCount);
  const duration = Math.max(0.001, SHAPE_STREAM_FINAL_GRID.blinkDuration * totalBlinks)
    + Math.max(0.001, SHAPE_STREAM_FINAL_GRID.openRevealDuration);
  if (doorwayExit.calibrationBlinkElapsed >= duration) {
    doorwayExit.calibrationPreview = 'open';
    doorwayExit.calibrationBlinkElapsed = 0;
    applyDoorwayEyeCalibrationPreview();
    status.textContent = `blink preview complete - ${activeLayoutName}`;
    updateCalibrationConsole();
    return;
  }
  applyDoorwayEyeCalibrationPreview();
}

function clearDoorwayTransitionPreviewState() {
  if (!doorwayExit.calibrationTransitionPreview) return;
  doorwayExit.calibrationTransitionPreview = false;
  resetShapeStream();
}

function resetShapeStreamDoorwayExit() {
  if (doorwayExit.navigationTimer != null) {
    window.clearTimeout(doorwayExit.navigationTimer);
    doorwayExit.navigationTimer = null;
  }
  resetDoorwayViewerPull();
  resetDoorwayGravityWarp();
  resetDoorwayRoomBreak();
  resetDoorwayBlackFade();
  resetDoorwayRoomDust();
  setCompletionExitOpacityScale(1);
  doorwayExit.navigationTriggered = false;
  doorwayExit.calibrationTransitionPreview = false;
  doorwayExit.calibrationPreview = 'none';
  doorwayExit.calibrationBlinkElapsed = 0;
  doorwayExit.scale = doorwayEyeScale();
  doorwayExit.voidScale = SHAPE_STREAM_FINAL_GRID.voidStartScale;
  doorwayExit.flashCount = 0;
  doorwayExit.dissolveProgress = 0;
  doorwayExit.portalProgress = 0;
  setDoorwayEyeOpacity(0, 0);
  doorwayExit.gravityVeil.visible = false;
  doorwayExit.gravityVeil.material.opacity = 0;
  doorwayExit.voidPlane.visible = false;
  doorwayExit.voidPlane.material.opacity = 0;
  doorwayExit.rings.forEach((ring) => {
    ring.visible = false;
    ring.material.opacity = 0;
    ring.userData.scale = 0;
  });
  doorwayExit.veil.visible = false;
  doorwayExit.veil.material.opacity = 0;
}

function startShapeStreamDoorwayExit() {
  doorwayExit.calibrationTransitionPreview = false;
  doorwayExit.calibrationPreview = 'none';
  doorwayExit.calibrationBlinkElapsed = 0;
  shapeStream.finalGrid.exitPhase = 'closedReveal';
  shapeStream.finalGrid.exitElapsed = 0;
  shapeStream.finalGrid.exitProgress = 0;
  shapeStream.finalGrid.flashCount = 0;
  shapeStream.finalGrid.collapseProgress = 0;
  shapeStream.finalGrid.dissolveProgress = 0;
  shapeStream.finalGrid.portalProgress = 0;
  shapeStream.finalGrid.navigating = false;
  shapeStream.finalGrid.animating = true;
  resetDoorwayViewerPull();
  resetDoorwayRoomBreak();
  resetDoorwayBlackFade();
  resetDoorwayRoomDust();
  seedDoorwayRoomDust(true);
  setCompletionExitOpacityScale(1);
  doorwayExit.navigationTriggered = false;
  doorwayExit.closedEye.visible = true;
  doorwayExit.openEye.visible = false;
  clearDoorwayAmbientDimming();
  doorwayExit.voidPlane.visible = true;
  setDoorwayEyeOpacity(0, 0);
  doorwayExit.voidPlane.material.opacity = 0;
  layoutShapeStreamDoorwayExit(doorwayEyeScale(), SHAPE_STREAM_FINAL_GRID.voidStartScale);
}

function startDoorwayTransitionPreview() {
  if (!calibrate) return;
  doorwayExit.calibrationPreview = 'transition';
  doorwayExit.calibrationBlinkElapsed = 0;
  doorwayExit.calibrationTransitionPreview = true;
  doorwayExit.navigationTriggered = false;

  shapeStream.finalGrid.active = true;
  shapeStream.finalGrid.phase = 'done';
  shapeStream.finalGrid.animating = true;
  shapeStream.finalGrid.exitPhase = 'postEyeHold';
  shapeStream.finalGrid.exitElapsed = 0;
  shapeStream.finalGrid.exitProgress = 0;
  shapeStream.finalGrid.flashCount = SHAPE_STREAM_FINAL_GRID.blinkCount;
  shapeStream.finalGrid.collapseProgress = 0;
  shapeStream.finalGrid.dissolveProgress = 0;
  shapeStream.finalGrid.portalProgress = 0;
  shapeStream.finalGrid.navigating = false;
  shapeStream.finalGrid.vacuumProgress = 1;
  shapeStream.finalGrid.visible = 0;

  shapeStream.items.forEach((item) => {
    if (item.mesh) item.mesh.visible = false;
    item.finalGridVacuum = null;
  });
  resetDoorwayViewerPull();
  resetDoorwayGravityWarp();
  resetDoorwayRoomBreak();
  resetDoorwayBlackFade();
  resetDoorwayRoomDust();
  clearDoorwayRoomShards();
  setCompletionExitOpacityScale(1);
  clearDoorwayAmbientDimming();
  doorwayExit.voidPlane.visible = true;
  doorwayExit.voidPlane.material.opacity = doorwayOverlayOpacity(0.71);
  setDoorwayEyeOpacity(0, 1, DOORWAY_EYE_COLOR, { openMaxOpacity: 1 });
  layoutShapeStreamDoorwayExit(
    doorwayEyeScale(),
    SHAPE_STREAM_FINAL_GRID.voidDoorScale * 0.58
  );
  status.textContent = `break transition preview - ${activeLayoutName}`;
  updateCalibrationConsole();
}

function finishShapeStreamDoorwayExitHandoff() {
  applyDoorwayBlackFade(1);
  applyDoorwayRoomBreak(1);
  updateDoorwayRoomShards(1, 0);
  updateDoorwayRoomDust(1, 0);
  setCompletionExitOpacityScale(0);
  shapeStream.finalGrid.exitProgress = 1;
  shapeStream.finalGrid.collapseProgress = 1;
  shapeStream.finalGrid.dissolveProgress = 1;
  shapeStream.finalGrid.portalProgress = 1;
  shapeStream.finalGrid.animating = false;

  if (noNavigate || doorwayExit.calibrationTransitionPreview) {
    shapeStream.finalGrid.exitPhase = 'ready';
    shapeStream.finalGrid.navigating = false;
    status.textContent = doorwayExit.calibrationTransitionPreview
      ? `break transition ready - ${activeLayoutName}`
      : `doorway exit ready - ${activeLayoutName}`;
    return;
  }

  if (doorwayExit.navigationTriggered) return;
  doorwayExit.navigationTriggered = true;
  shapeStream.finalGrid.exitPhase = 'navigating';
  shapeStream.finalGrid.navigating = true;
  status.textContent = `entering home - ${activeLayoutName}`;
  const navigateHome = () => {
    doorwayExit.navigationTimer = null;
    if (typeof window._constructFade === 'function') {
      window._constructFade(SHAPE_STREAM_FINAL_GRID.homeHref);
    } else {
      window.location.href = SHAPE_STREAM_FINAL_GRID.homeHref;
    }
  };
  const holdMs = Math.max(0, SHAPE_STREAM_FINAL_GRID.homeFadeHoldDuration || 0) * 1000;
  if (holdMs > 0) {
    doorwayExit.navigationTimer = window.setTimeout(navigateHome, holdMs);
  } else {
    navigateHome();
  }
}

function animateShapeStreamDoorwayExit(delta) {
  const exitPhase = shapeStream.finalGrid.exitPhase;
  if (exitPhase === 'idle' || exitPhase === 'ready' || exitPhase === 'navigating') return;

  shapeStream.finalGrid.exitElapsed += delta;
  if (exitPhase === 'closedReveal') {
    const duration = Math.max(0.001, shapeStreamDoorwayExitDuration('closedRevealDuration'));
    const progress = THREE.MathUtils.clamp(shapeStream.finalGrid.exitElapsed / duration, 0, 1);
    const t = easeOutCubic(progress);
    shapeStream.finalGrid.exitProgress = progress;
    shapeStream.finalGrid.flashCount = 0;
    shapeStream.finalGrid.collapseProgress = 0;
    shapeStream.finalGrid.dissolveProgress = 0;
    shapeStream.finalGrid.portalProgress = 0;
    doorwayExit.voidPlane.visible = true;
    setDoorwayEyeOpacity(t, 0);
    clearDoorwayAmbientDimming();
    doorwayExit.voidPlane.material.opacity = THREE.MathUtils.lerp(0, doorwayOverlayOpacity(0.46), t);
    updateDoorwayGravityRings('idle', 0);
    layoutShapeStreamDoorwayExit(
      doorwayEyeScale(),
      THREE.MathUtils.lerp(SHAPE_STREAM_FINAL_GRID.voidStartScale, SHAPE_STREAM_FINAL_GRID.voidStartScale * 1.25, t)
    );
    if (progress >= 1) {
      shapeStream.finalGrid.exitPhase = 'blinkSequence';
      shapeStream.finalGrid.exitElapsed = 0;
      shapeStream.finalGrid.exitProgress = 0;
    }
    return;
  }

  if (exitPhase === 'openReveal') {
    const duration = Math.max(0.001, shapeStreamDoorwayExitDuration('openRevealDuration'));
    const progress = THREE.MathUtils.clamp(shapeStream.finalGrid.exitElapsed / duration, 0, 1);
    const t = easeOutCubic(progress);
    shapeStream.finalGrid.exitProgress = progress;
    setDoorwayEyeOpacity(1 - t, t, DOORWAY_EYE_COLOR, { openMaxOpacity: 1 });
    clearDoorwayAmbientDimming();
    doorwayExit.voidPlane.material.opacity = THREE.MathUtils.lerp(doorwayOverlayOpacity(0.46), doorwayOverlayOpacity(0.71), t);
    updateDoorwayGravityRings('idle', 0);
    layoutShapeStreamDoorwayExit(
      doorwayEyeScale(),
      THREE.MathUtils.lerp(SHAPE_STREAM_FINAL_GRID.voidStartScale * 1.25, SHAPE_STREAM_FINAL_GRID.voidDoorScale * 0.58, t)
    );
    if (progress >= 1) {
      setDoorwayEyeOpacity(0, 1, DOORWAY_EYE_COLOR, { openMaxOpacity: 1 });
      shapeStream.finalGrid.exitPhase = 'postEyeHold';
      shapeStream.finalGrid.exitElapsed = 0;
      shapeStream.finalGrid.exitProgress = 0;
    }
    return;
  }

  if (exitPhase === 'blinkSequence') {
    const totalBlinks = Math.max(1, SHAPE_STREAM_FINAL_GRID.blinkCount);
    const duration = Math.max(0.001, shapeStreamDoorwayExitDuration('blinkDuration') * totalBlinks);
    const progress = THREE.MathUtils.clamp(shapeStream.finalGrid.exitElapsed / duration, 0, 1);
    const rawBlink = progress * totalBlinks;
    const blinkLocal = progress >= 1 ? 1 : rawBlink - Math.floor(rawBlink);
    const eyeVisible = progress < 1 && blinkLocal < 0.5;
    const completedBlinks = progress >= 1 ? totalBlinks : Math.floor(rawBlink);
    shapeStream.finalGrid.exitProgress = progress;
    shapeStream.finalGrid.flashCount = completedBlinks;
    shapeStream.finalGrid.collapseProgress = 0;
    shapeStream.finalGrid.dissolveProgress = 0;
    shapeStream.finalGrid.portalProgress = 0;
    setDoorwayEyeOpacity(eyeVisible ? 1 : 0, 0);
    clearDoorwayAmbientDimming();
    doorwayExit.voidPlane.material.opacity = doorwayOverlayOpacity(0.46);
    updateDoorwayGravityRings('blinkSequence', progress);
    layoutShapeStreamDoorwayExit(
      doorwayEyeScale(),
      SHAPE_STREAM_FINAL_GRID.voidStartScale * 1.25
    );
    if (progress >= 1) {
      shapeStream.finalGrid.flashCount = totalBlinks;
      setDoorwayEyeOpacity(1, 0);
      shapeStream.finalGrid.exitPhase = 'openReveal';
      shapeStream.finalGrid.exitElapsed = 0;
      shapeStream.finalGrid.exitProgress = 0;
    }
    return;
  }

  if (exitPhase === 'postEyeHold') {
    const duration = Math.max(0.001, shapeStreamDoorwayExitDuration('postEyeHoldDuration'));
    const progress = THREE.MathUtils.clamp(shapeStream.finalGrid.exitElapsed / duration, 0, 1);
    shapeStream.finalGrid.exitProgress = progress;
    shapeStream.finalGrid.flashCount = SHAPE_STREAM_FINAL_GRID.blinkCount;
    shapeStream.finalGrid.collapseProgress = 0;
    shapeStream.finalGrid.dissolveProgress = 0;
    shapeStream.finalGrid.portalProgress = 0;
    setDoorwayEyeOpacity(0, 1, DOORWAY_EYE_COLOR, { openMaxOpacity: 1 });
    applyDoorwayRoomBreak(0);
    setCompletionExitOpacityScale(1);
    doorwayExit.roomShards.points.visible = false;
    doorwayExit.roomShards.doorPoints.visible = false;
    doorwayExit.roomShards.material.uniforms.uOpacity.value = 0;
    doorwayExit.roomShards.doorMaterial.uniforms.uOpacity.value = 0;
    applyDoorwayBlackFade(0);
    clearDoorwayAmbientDimming();
    doorwayExit.voidPlane.material.opacity = doorwayOverlayOpacity(0.71);
    updateDoorwayGravityRings('idle', 0);
    layoutShapeStreamDoorwayExit(
      doorwayEyeScale(),
      SHAPE_STREAM_FINAL_GRID.voidDoorScale * 0.58
    );
    if (progress >= 1) {
      seedDoorwayRoomShards(true);
      updateDoorwayRoomShards(0, 1);
      applyDoorwayRoomBreak(0, true);
      shapeStream.finalGrid.exitPhase = 'roomBreak';
      shapeStream.finalGrid.exitElapsed = 0;
      shapeStream.finalGrid.exitProgress = 0;
    }
    return;
  }

  if (exitPhase === 'roomBreak') {
    const duration = doorwayRoomBreakPhaseDuration();
    const progress = THREE.MathUtils.clamp(shapeStream.finalGrid.exitElapsed / duration, 0, 1);
    shapeStream.finalGrid.exitProgress = progress;
    shapeStream.finalGrid.flashCount = SHAPE_STREAM_FINAL_GRID.blinkCount;
    shapeStream.finalGrid.collapseProgress = progress;
    shapeStream.finalGrid.dissolveProgress = progress;
    shapeStream.finalGrid.portalProgress = 0;
    doorwayExit.dissolveProgress = progress;
    const eyeFadeT = easeInCubic(THREE.MathUtils.clamp(progress / 0.16, 0, 1));
    setDoorwayEyeOpacity(0, 1 - eyeFadeT, DOORWAY_EYE_COLOR, { openMaxOpacity: 1 });
    updateDoorwayRoomDust(1, 0);
    updateDoorwayRoomShards(progress);
    applyDoorwayRoomBreak(progress, true);
    setCompletionExitOpacityScale(1 - doorwayRoomBackgroundHideProgress(progress));
    applyDoorwayBlackFade(0);
    applyDoorwayAmbientDimming(progress);
    doorwayExit.voidPlane.visible = false;
    doorwayExit.voidPlane.material.opacity = 0;
    updateDoorwayGravityRings('idle', 0);
    layoutShapeStreamDoorwayExit(
      doorwayEyeScale(),
      SHAPE_STREAM_FINAL_GRID.voidDoorScale * 0.58
    );
    if (progress >= 1) {
      updateDoorwayRoomShards(1);
      applyDoorwayRoomBreak(1, true);
      shapeStream.finalGrid.exitPhase = 'blackFade';
      shapeStream.finalGrid.exitElapsed = 0;
      shapeStream.finalGrid.exitProgress = 0;
    }
    return;
  }

  if (exitPhase === 'blackFade') {
    const duration = Math.max(0.001, shapeStreamDoorwayExitDuration('blackFadeDuration'));
    const progress = THREE.MathUtils.clamp(shapeStream.finalGrid.exitElapsed / duration, 0, 1);
    const cover = easeInCubic(progress);
    shapeStream.finalGrid.exitProgress = progress;
    shapeStream.finalGrid.flashCount = SHAPE_STREAM_FINAL_GRID.blinkCount;
    shapeStream.finalGrid.collapseProgress = 1;
    shapeStream.finalGrid.dissolveProgress = 1;
    shapeStream.finalGrid.portalProgress = progress;
    setDoorwayEyeOpacity(0, 0, DOORWAY_EYE_COLOR, { openMaxOpacity: 1 });
    updateDoorwayRoomShards(1, 1 - cover);
    updateDoorwayRoomDust(1, 0);
    applyDoorwayRoomBreak(1, true);
    setCompletionExitOpacityScale(0);
    applyDoorwayBlackFade(progress);
    applyDoorwayAmbientDimming(1);
    doorwayExit.voidPlane.visible = false;
    doorwayExit.voidPlane.material.opacity = 0;
    updateDoorwayGravityRings('idle', 0);
    layoutShapeStreamDoorwayExit(
      doorwayEyeScale(),
      SHAPE_STREAM_FINAL_GRID.voidDoorScale * 0.58
    );
    if (progress >= 1) {
      finishShapeStreamDoorwayExitHandoff();
    }
    return;
  }

}

function shapeStreamFinalGridMetrics(requiredCount = shapeStream.items.length) {
  const baseCellSize = Math.max(0.05, SHAPE_STREAM.maxSize * SHAPE_STREAM_FINAL_GRID.cellSizeFactor);
  const minColumns = Math.max(2, Math.ceil(viewport.width / baseCellSize) + 1);
  const minRows = Math.max(2, Math.ceil(viewport.height / baseCellSize) + 1);
  const aspect = viewport.width / Math.max(0.0001, viewport.height);
  let columns = minColumns;
  let rows = minRows;

  if (requiredCount > columns * rows) {
    columns = Math.max(minColumns, Math.ceil(Math.sqrt(requiredCount * aspect)));
    rows = Math.max(minRows, Math.ceil(requiredCount / columns));
    while (columns * rows < requiredCount) {
      if (columns / Math.max(1, rows) < aspect) columns += 1;
      else rows += 1;
    }
  }

  return {
    columns,
    rows,
    count: columns * rows,
    cellW: viewport.width / Math.max(1, columns - 1),
    cellH: viewport.height / Math.max(1, rows - 1)
  };
}

function shapeStreamFinalGridStartPosition(index) {
  const source = completionEffects.ring.userData.surfacePosition || new THREE.Vector3();
  const ring = (index * 2.399963229728653) % (Math.PI * 2);
  const radius = SHAPE_STREAM.maxSize * (0.25 + (index % 5) * 0.08);
  return new THREE.Vector3(
    source.x + Math.cos(ring) * radius,
    source.y + Math.sin(ring) * radius,
    SHAPE_STREAM_FINAL_GRID.z - 0.32 - (index % 11) * 0.002
  );
}

function shapeStreamFinalGridQuaternion(index) {
  const waveA = Math.sin(index * 1.713);
  const waveB = Math.cos(index * 2.171);
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(
    SHAPE_STREAM_FINAL_GRID.tiltX + waveA * SHAPE_STREAM_FINAL_GRID.tiltVariation,
    SHAPE_STREAM_FINAL_GRID.tiltY + waveB * SHAPE_STREAM_FINAL_GRID.tiltVariation,
    waveA * SHAPE_STREAM_FINAL_GRID.tiltVariation * 0.5
  ));
}

const SHAPE_STREAM_FINAL_GRID_SHAPE_ORDER = [0, 2, 1, 3, 4];

function shapeStreamFinalGridColorIndex(item) {
  if (Number.isFinite(item.colorIndex)) return item.colorIndex;
  const paletteIndex = shapeStream.palette.indexOf(item.mesh.material);
  return paletteIndex >= 0 ? paletteIndex : shapeStream.palette.length;
}

function shapeStreamFinalGridShapeRank(geoIndex) {
  const rank = SHAPE_STREAM_FINAL_GRID_SHAPE_ORDER.indexOf(geoIndex);
  return rank >= 0 ? rank : SHAPE_STREAM_FINAL_GRID_SHAPE_ORDER.length + geoIndex;
}

function sortedShapeStreamFinalGridItems() {
  return shapeStream.items
    .map((item, originalIndex) => ({ item, originalIndex }))
    .sort((a, b) => (
      shapeStreamFinalGridColorIndex(a.item) - shapeStreamFinalGridColorIndex(b.item)
      || shapeStreamFinalGridShapeRank(a.item.geoIndex) - shapeStreamFinalGridShapeRank(b.item.geoIndex)
      || a.originalIndex - b.originalIndex
    ));
}

function addShapeStreamFinalGridItem() {
  const { mesh, geoIndex, colorIndex } = createShapeStreamMesh();
  const index = shapeStream.items.length;
  mesh.position.copy(shapeStreamFinalGridStartPosition(index));
  mesh.quaternion.setFromEuler(new THREE.Euler(0, 0, Math.sin(index * 1.113) * 0.72));
  mesh.scale.setScalar(SHAPE_STREAM.minSize);
  const item = {
    mesh,
    size: SHAPE_STREAM.maxSize,
    geoIndex,
    colorIndex,
    zoneIndex: 0,
    body: null,
    collider: null,
    age: 0,
    target: null,
    targetSurfaceY: null,
    reservation: null,
    calmTime: 0,
    bucketCommitted: true,
    settled: true,
    feedbackImpactPlayed: true,
    finalGrid: true,
    finalGridStart: null,
    finalGridTarget: null,
    finalGridVacuum: null
  };
  shapeStream.items.push(item);
  return item;
}

function ensureShapeStreamFinalGridCount(targetCount) {
  while (shapeStream.items.length < targetCount) addShapeStreamFinalGridItem();
}

function setShapeStreamFinalGridStartsFromCurrent() {
  shapeStream.items.forEach((item) => {
    item.finalGridStart = {
      position: item.mesh.position.clone(),
      quaternion: item.mesh.quaternion.clone(),
      scale: item.mesh.scale.x || item.size || SHAPE_STREAM.minSize
    };
  });
}

function updateShapeStreamFinalGridTargets(captureStarts = false) {
  if (!shapeStream.finalGrid.active) return;
  if (shapeStream.finalGrid.phase === 'vacuum' || shapeStream.finalGrid.phase === 'done') return;
  const metrics = shapeStreamFinalGridMetrics(shapeStream.items.length);
  ensureShapeStreamFinalGridCount(metrics.count);
  const settledMetrics = shapeStreamFinalGridMetrics(shapeStream.items.length);
  const scale = Math.max(settledMetrics.cellW, settledMetrics.cellH) * SHAPE_STREAM_FINAL_GRID.scaleFactor;

  shapeStream.finalGrid.rows = settledMetrics.rows;
  shapeStream.finalGrid.columns = settledMetrics.columns;
  shapeStream.finalGrid.count = shapeStream.items.length;

  sortedShapeStreamFinalGridItems().forEach(({ item }, index) => {
    detachShapeStreamItemPhysics(item);
    const row = Math.floor(index / settledMetrics.columns);
    const column = index % settledMetrics.columns;
    const x = -viewport.width * 0.5 + column * settledMetrics.cellW;
    const y = viewport.height * 0.5 - row * settledMetrics.cellH;
    item.mesh.visible = true;
    item.mesh.renderOrder = 18;
    item.bucketCommitted = true;
    item.settled = true;
    item.finalGrid = true;
    item.finalGridVacuum = null;
    if (captureStarts || !item.finalGridStart) {
      item.finalGridStart = {
        position: item.mesh.position.clone(),
        quaternion: item.mesh.quaternion.clone(),
        scale: item.mesh.scale.x || item.size || SHAPE_STREAM.minSize
      };
    }
    item.finalGridTarget = {
      position: new THREE.Vector3(x, y, SHAPE_STREAM_FINAL_GRID.z + index * SHAPE_STREAM_FINAL_GRID.zStep),
      quaternion: shapeStreamFinalGridQuaternion(index),
      scale
    };
  });
  shapeStream.finalGrid.visible = shapeStream.items.filter((item) => item.mesh.visible).length;
}

function layoutShapeStreamFinalGrid() {
  if (!shapeStream.finalGrid.active) return;
  if (shapeStream.finalGrid.phase === 'vacuum' || shapeStream.finalGrid.phase === 'done') return;
  updateShapeStreamFinalGridTargets(false);
  shapeStream.items.forEach((item) => {
    if (!item.finalGridTarget) return;
    item.mesh.position.copy(item.finalGridTarget.position);
    item.mesh.quaternion.copy(item.finalGridTarget.quaternion);
    item.mesh.scale.setScalar(item.finalGridTarget.scale);
    item.size = item.finalGridTarget.scale;
  });
}

function animateShapeStreamFinalGrid(delta) {
  if (!shapeStream.finalGrid.active || !shapeStream.finalGrid.animating) return;
  shapeStream.finalGrid.elapsed += delta;
  shapeStream.finalGrid.progress = THREE.MathUtils.clamp(
    shapeStream.finalGrid.elapsed / SHAPE_STREAM_FINAL_GRID.duration,
    0,
    1
  );
  const t = easeOutCubic(shapeStream.finalGrid.progress);
  shapeStream.items.forEach((item) => {
    if (!item.finalGridStart || !item.finalGridTarget) return;
    item.mesh.position.lerpVectors(item.finalGridStart.position, item.finalGridTarget.position, t);
    item.mesh.quaternion.copy(item.finalGridStart.quaternion).slerp(item.finalGridTarget.quaternion, t);
    const scale = THREE.MathUtils.lerp(item.finalGridStart.scale, item.finalGridTarget.scale, t);
    item.mesh.scale.setScalar(scale);
    item.size = scale;
  });
  if (shapeStream.finalGrid.progress >= 1) {
    shapeStream.finalGrid.animating = false;
    shapeStream.finalGrid.elapsed = SHAPE_STREAM_FINAL_GRID.duration;
    shapeStream.finalGrid.progress = 1;
    shapeStream.finalGrid.phase = 'hold';
    shapeStream.finalGrid.holdElapsed = 0;
    layoutShapeStreamFinalGrid();
  }
}

function startShapeStreamFinalGridVacuum() {
  if (!shapeStream.finalGrid.active || shapeStream.finalGrid.phase === 'vacuum' || shapeStream.finalGrid.phase === 'done') return;
  const target = new THREE.Vector3(
    shapeLock.center.x,
    shapeLock.center.y,
    SHAPE_STREAM_FINAL_GRID.vacuumDoorZ
  );
  const batchSize = Math.max(1, SHAPE_STREAM_FINAL_GRID.vacuumBatchSize);
  const orderedItems = shapeStream.items
    .map((item, index) => {
      const dx = item.mesh.position.x - target.x;
      const dy = item.mesh.position.y - target.y;
      return {
        item,
        index,
        distance: Math.hypot(dx, dy),
        angle: Math.atan2(dy, dx)
      };
    })
    .sort((a, b) => (
      a.distance - b.distance
      || a.angle - b.angle
      || a.index - b.index
    ));

  shapeStream.finalGrid.phase = 'vacuum';
  shapeStream.finalGrid.animating = true;
  shapeStream.finalGrid.vacuumElapsed = 0;
  shapeStream.finalGrid.vacuumProgress = 0;
  shapeStream.finalGrid.vacuumTotal = orderedItems.length;
  orderedItems.forEach(({ item, index, distance, angle }, order) => {
    const startPosition = item.mesh.position.clone();
    const startQuaternion = item.mesh.quaternion.clone();
    const startScale = item.mesh.scale.x || item.size || SHAPE_STREAM.minSize;
    const batchIndex = Math.floor(order / batchSize);
    item.mesh.visible = true;
    item.finalGridVacuum = {
      startPosition,
      startQuaternion,
      startScale,
      target: target.clone(),
      startTime: batchIndex * SHAPE_STREAM_FINAL_GRID.vacuumBatchInterval,
      radius: Math.max(SHAPE_STREAM.maxSize * 0.045, distance * 0.055),
      spinOffset: angle + order * 0.37,
      gridIndex: index,
      spinSign: index % 2 ? -1 : 1
    };
  });
  shapeStream.finalGrid.visible = shapeStream.items.filter((item) => item.mesh.visible).length;
}

function finishShapeStreamFinalGridVacuum() {
  shapeStream.finalGrid.phase = 'done';
  shapeStream.finalGrid.animating = false;
  shapeStream.finalGrid.vacuumProgress = 1;
  shapeStream.finalGrid.visible = 0;
  resetDoorwayGravityWarp();
  shapeStream.items.forEach((item) => {
    item.mesh.visible = false;
    item.mesh.scale.setScalar(0.0001);
    scene.remove(item.mesh);
    item.finalGridVacuum = null;
  });
  startShapeStreamDoorwayExit();
}

function animateShapeStreamVacuum(delta) {
  if (!shapeStream.finalGrid.active || shapeStream.finalGrid.phase !== 'vacuum') return;
  shapeStream.finalGrid.vacuumElapsed += delta;
  let visible = 0;
  shapeStream.items.forEach((item) => {
    const vacuum = item.finalGridVacuum;
    if (!vacuum || !item.mesh.visible) return;
    const localT = THREE.MathUtils.clamp(
      (shapeStream.finalGrid.vacuumElapsed - vacuum.startTime) / SHAPE_STREAM_FINAL_GRID.vacuumItemDuration,
      0,
      1
    );
    if (localT <= 0) {
      visible += 1;
      return;
    }

    const t = easeInCubic(localT);
    const spinAngle = vacuum.spinOffset + t * Math.PI * 2 * SHAPE_STREAM_FINAL_GRID.vacuumSpin * vacuum.spinSign;
    const radius = vacuum.radius * Math.sin(localT * Math.PI) * (1 - t * 0.45);
    const base = new THREE.Vector3().lerpVectors(vacuum.startPosition, vacuum.target, t);
    base.x += Math.cos(spinAngle) * radius;
    base.y += Math.sin(spinAngle) * radius * 0.62;
    base.z += Math.sin(spinAngle * 0.7) * radius * 0.18;
    item.mesh.position.copy(base);

    const spinQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      t * Math.PI * 1.25 * vacuum.spinSign,
      t * Math.PI * 0.8 * -vacuum.spinSign,
      t * Math.PI * 1.45 * vacuum.spinSign
    ));
    item.mesh.quaternion.copy(vacuum.startQuaternion)
      .slerp(shapeStreamFinalGridQuaternion(vacuum.gridIndex), t * 0.18)
      .multiply(spinQuat);

    const approachT = easeInCubic(THREE.MathUtils.clamp((localT - 0.72) / 0.18, 0, 1));
    const vanishT = easeInCubic(THREE.MathUtils.clamp((localT - 0.91) / 0.09, 0, 1));
    const approachScale = THREE.MathUtils.lerp(
      vacuum.startScale,
      vacuum.startScale * SHAPE_STREAM_FINAL_GRID.vacuumApproachScale,
      approachT
    );
    const endScale = vacuum.startScale * SHAPE_STREAM_FINAL_GRID.vacuumEndScaleFactor;
    const scale = THREE.MathUtils.lerp(approachScale, endScale, vanishT);
    item.mesh.scale.setScalar(scale);
    item.size = scale;

    if (localT >= 1) {
      item.mesh.visible = false;
      scene.remove(item.mesh);
      item.finalGridVacuum = null;
      return;
    }
    visible += 1;
  });
  const total = Math.max(1, shapeStream.finalGrid.vacuumTotal || shapeStream.items.length);
  shapeStream.finalGrid.visible = visible;
  shapeStream.finalGrid.vacuumProgress = THREE.MathUtils.clamp((total - visible) / total, 0, 1);
  if (visible <= 0) finishShapeStreamFinalGridVacuum();
}

function updateShapeStreamFinalGrid(delta) {
  if (!shapeStream.finalGrid.active) return;
  if (shapeStream.finalGrid.phase === 'forming') {
    animateShapeStreamFinalGrid(delta);
    return;
  }
  if (shapeStream.finalGrid.phase === 'hold') {
    shapeStream.finalGrid.holdElapsed += delta;
    if (shapeStream.finalGrid.holdElapsed >= SHAPE_STREAM_FINAL_GRID.holdDuration) {
      startShapeStreamFinalGridVacuum();
    }
    return;
  }
  if (shapeStream.finalGrid.phase === 'vacuum') {
    animateShapeStreamVacuum(delta);
    return;
  }
  if (shapeStream.finalGrid.phase === 'done') {
    animateShapeStreamDoorwayExit(delta);
  }
}

function retargetShapeStreamFinalGrid(restartAnimation = false) {
  if (!shapeStream.finalGrid.active) return;
  if (shapeStream.finalGrid.phase === 'done') {
    const phase = shapeStream.finalGrid.exitPhase;
    if (phase === 'postEyeHold') {
      applyDoorwayRoomBreak(0);
      setCompletionExitOpacityScale(1);
      clearDoorwayAmbientDimming();
      doorwayExit.roomShards.points.visible = false;
      doorwayExit.roomShards.doorPoints.visible = false;
      doorwayExit.roomShards.material.uniforms.uOpacity.value = 0;
      doorwayExit.roomShards.doorMaterial.uniforms.uOpacity.value = 0;
      applyDoorwayBlackFade(0);
    } else if (phase === 'roomBreak') {
      const breakProgress = shapeStream.finalGrid.collapseProgress || 0;
      seedDoorwayRoomShards(true);
      updateDoorwayRoomShards(breakProgress);
      applyDoorwayRoomBreak(breakProgress, true);
      setCompletionExitOpacityScale(1 - doorwayRoomBackgroundHideProgress(breakProgress));
      applyDoorwayAmbientDimming(breakProgress);
      applyDoorwayBlackFade(0);
      updateDoorwayRoomDust(1, 0);
    } else if (phase === 'blackFade' || phase === 'ready' || phase === 'navigating') {
      const blackProgress = phase === 'blackFade' ? shapeStream.finalGrid.portalProgress || 0 : 1;
      const cover = easeInCubic(blackProgress);
      seedDoorwayRoomShards(true);
      updateDoorwayRoomShards(1, phase === 'blackFade' ? 1 - cover : 0);
      applyDoorwayRoomBreak(1, true);
      setCompletionExitOpacityScale(0);
      applyDoorwayAmbientDimming(1);
      applyDoorwayBlackFade(blackProgress);
      updateDoorwayRoomDust(1, 0);
    }
    layoutShapeStreamDoorwayExit();
    return;
  }
  if (shapeStream.finalGrid.phase === 'vacuum') {
    return;
  }
  if (restartAnimation && shapeStream.finalGrid.animating) {
    setShapeStreamFinalGridStartsFromCurrent();
    shapeStream.finalGrid.elapsed = 0;
    shapeStream.finalGrid.progress = 0;
  }
  updateShapeStreamFinalGridTargets(!shapeStream.finalGrid.animating);
  if (!shapeStream.finalGrid.animating) layoutShapeStreamFinalGrid();
}

function activateShapeStreamFinalGrid() {
  if (shapeStream.finalGrid.active) {
    retargetShapeStreamFinalGrid(true);
    return;
  }
  shapeStream.finalGrid.active = true;
  shapeStream.finalGrid.animating = true;
  shapeStream.finalGrid.phase = 'forming';
  shapeStream.finalGrid.elapsed = 0;
  shapeStream.finalGrid.progress = 0;
  shapeStream.finalGrid.holdElapsed = 0;
  shapeStream.finalGrid.vacuumElapsed = 0;
  shapeStream.finalGrid.vacuumProgress = 0;
  shapeStream.finalGrid.vacuumTotal = 0;
  shapeStream.finalGrid.exitPhase = 'idle';
  shapeStream.finalGrid.exitElapsed = 0;
  shapeStream.finalGrid.exitProgress = 0;
  shapeStream.finalGrid.flashCount = 0;
  shapeStream.finalGrid.collapseProgress = 0;
  shapeStream.finalGrid.dissolveProgress = 0;
  shapeStream.finalGrid.portalProgress = 0;
  shapeStream.finalGrid.navigating = false;
  resetShapeStreamDoorwayExit();
  shapeStream.spawnTimer = 0;
  shapeStream.full = true;
  shapeStream.zones.forEach((zone) => {
    zone.reservations.fill(0);
  });
  shapeStream.items.forEach(detachShapeStreamItemPhysics);
  const metrics = shapeStreamFinalGridMetrics(shapeStream.items.length);
  ensureShapeStreamFinalGridCount(metrics.count);
  updateShapeStreamFinalGridTargets(true);
  shapeStream.finalGrid.visible = shapeStream.items.filter((item) => item.mesh.visible).length;
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
  if (shapeStream.finalGrid.active) {
    updateShapeStreamFinalGrid(delta);
    return;
  }
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
    const targetSurfaceY = item.targetSurfaceY ?? item.target?.y;
    const nearTargetSurface = targetSurfaceY != null
      && translation.y <= targetSurfaceY + item.size * 1.18;
    if (
      !item.feedbackImpactPlayed
      && item.age > 0.24
      && nearTargetSurface
      && (linvel.y <= -0.18 || linearSpeed > SHAPE_STREAM.settleLinearThreshold * 4)
    ) {
      item.feedbackImpactPlayed = true;
      const impactEnergy = Math.max(Math.abs(linvel.y), linearSpeed * 0.55);
      playShapeImpactFeedback(THREE.MathUtils.clamp(impactEnergy / 5.5, 0.24, 0.95), translation);
    }
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
      if (!item.feedbackImpactPlayed) {
        item.feedbackImpactPlayed = true;
        playShapeImpactFeedback(0.34, item.mesh.position);
      }
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
  if (isDoorwayEyeCalibrationPreviewActive()) applyDoorwayEyeCalibrationPreview();
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

function setShapeLockSolvedState() {
  shapeLock.solved = true;
  shapeLock.progress = SHAPE_LOCK_ORDER.length;
  shapeLock.previewing = false;
  shapeLock.group.visible = false;
  shapeLock.symbols.forEach((mesh) => {
    mesh.visible = false;
    mesh.material.opacity = 0;
  });
  shapeLock.overlayGroup.visible = false;
  shapeLock.overlays.forEach((mesh) => { mesh.visible = false; });
}

function previewShapeStreamFinalGrid() {
  settleCompletionInstantly();
  setShapeLockSolvedState();
  if (shapeStream.finalGrid.active || shapeStream.items.length === 0) resetShapeStream();
  activateShapeStreamFinalGrid();
  updateCalibrationConsole();
  return window.entryRoom3d.__shapeStream().finalGrid;
}

function handleShapeLockAction(action) {
  if (action === 'preview') {
    setOverlayPreview(true);
    status.textContent = `settled overlay view - ${activeLayoutName}`;
  } else if (action === 'clear-preview') {
    setOverlayPreview(false);
    status.textContent = `overlay preview cleared - ${activeLayoutName}`;
  } else if (action === 'preview-final-grid') {
    previewShapeStreamFinalGrid();
    status.textContent = `door vacuum preview - ${activeLayoutName}`;
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

function syncDoorwayEyeControls() {
  if (!calibrate) return;
  const values = {
    'eye-color': colorHex(DOORWAY_EYE_TUNING.eyeColor),
    'eye-opacity': DOORWAY_EYE_TUNING.eyeOpacity,
    'overlay-color': colorHex(DOORWAY_EYE_TUNING.overlayColor),
    'overlay-opacity': DOORWAY_EYE_TUNING.overlayOpacity,
    'closed-reveal-duration': SHAPE_STREAM_FINAL_GRID.closedRevealDuration,
    'open-reveal-duration': SHAPE_STREAM_FINAL_GRID.openRevealDuration,
    'blink-count': SHAPE_STREAM_FINAL_GRID.blinkCount,
    'blink-duration': SHAPE_STREAM_FINAL_GRID.blinkDuration,
    'break-handoff-duration': SHAPE_STREAM_FINAL_GRID.roomImageHandoffDuration
  };
  Object.entries(values).forEach(([name, value]) => {
    const input = calibrationConsole?.querySelector(`[data-eye-control="${name}"]`);
    if (input && document.activeElement !== input) input.value = String(value);
  });
}

function handleDoorwayEyeControl(input) {
  const control = input.dataset.eyeControl;
  const numericValue = Number(input.value);
  const wasPreviewActive = isDoorwayEyeCalibrationPreviewActive();
  clearDoorwayTransitionPreviewState();
  if (control === 'eye-color') {
    DOORWAY_EYE_TUNING.eyeColor = colorNumber(input.value, DOORWAY_EYE_TUNING.eyeColor);
  } else if (control === 'eye-opacity' && Number.isFinite(numericValue)) {
    DOORWAY_EYE_TUNING.eyeOpacity = THREE.MathUtils.clamp(numericValue, 0, 1);
  } else if (control === 'overlay-color') {
    DOORWAY_EYE_TUNING.overlayColor = colorNumber(input.value, DOORWAY_EYE_TUNING.overlayColor);
  } else if (control === 'overlay-opacity' && Number.isFinite(numericValue)) {
    DOORWAY_EYE_TUNING.overlayOpacity = THREE.MathUtils.clamp(numericValue, 0, 1);
  } else if (control === 'closed-reveal-duration' && Number.isFinite(numericValue)) {
    SHAPE_STREAM_FINAL_GRID.closedRevealDuration = THREE.MathUtils.clamp(numericValue, 0.05, 4);
  } else if (control === 'open-reveal-duration' && Number.isFinite(numericValue)) {
    SHAPE_STREAM_FINAL_GRID.openRevealDuration = THREE.MathUtils.clamp(numericValue, 0.05, 4);
  } else if (control === 'blink-count' && Number.isFinite(numericValue)) {
    SHAPE_STREAM_FINAL_GRID.blinkCount = THREE.MathUtils.clamp(Math.round(numericValue), 1, 16);
  } else if (control === 'blink-duration' && Number.isFinite(numericValue)) {
    SHAPE_STREAM_FINAL_GRID.blinkDuration = THREE.MathUtils.clamp(numericValue, 0.04, 1.5);
  } else if (control === 'break-handoff-duration' && Number.isFinite(numericValue)) {
    SHAPE_STREAM_FINAL_GRID.roomImageHandoffDuration = THREE.MathUtils.clamp(numericValue, 0, 3);
  }
  applyDoorwayEyeTuning();
  if (!isDoorwayEyeCalibrationPreviewActive()) doorwayExit.calibrationPreview = 'open';
  applyDoorwayEyeCalibrationPreview();
  if (!wasPreviewActive && isDoorwayEyeCalibrationPreviewActive()) {
    status.textContent = `${doorwayExit.calibrationPreview} eye preview - ${activeLayoutName}`;
  }
  syncDoorwayEyeControls();
  updateCalibrationConsole();
}

function handleDoorwayEyeAction(action) {
  if (action === 'preview-open') {
    showDoorwayEyeCalibrationPreview('open');
  } else if (action === 'preview-closed') {
    showDoorwayEyeCalibrationPreview('closed');
  } else if (action === 'preview-blink') {
    startDoorwayEyeBlinkPreview();
  } else if (action === 'preview-transition') {
    startDoorwayTransitionPreview();
  } else if (action === 'hide') {
    hideDoorwayEyeCalibrationPreview();
  }
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
      setShapeLockSolvedState();
      activateShapeStreamFinalGrid();
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

  const patchAnchor = imageToWorld(
    ringConfig.patchX ?? ringConfig.x,
    ringConfig.patchY ?? ringConfig.y,
    anchor.z
  );
  const patchNorm = worldToNorm(patchAnchor);
  const art = artMetrics();
  const artWorldWidth = art.width * viewport.width;
  const artWorldHeight = art.height * viewport.height;
  const patchArtX = (patchNorm.x - art.left) / Math.max(0.0001, art.width);
  const patchArtY = (patchNorm.y - art.top) / Math.max(0.0001, art.height);
  const patchSize = ringConfig.patchSize ?? COMPLETION_PATCH_SIZE;
  const fieldSize = ringConfig.fieldSize ?? COMPLETION_FIELD_SIZE;
  const plugWidth = ringR * ringConfig.aspectX * patchSize;
  const plugHeight = ringR * ringConfig.aspectY * patchSize;
  const repeatX = THREE.MathUtils.clamp(plugWidth / Math.max(0.0001, artWorldWidth), 0.0001, 1);
  const repeatY = THREE.MathUtils.clamp(plugHeight / Math.max(0.0001, artWorldHeight), 0.0001, 1);
  const offsetX = THREE.MathUtils.clamp(patchArtX - repeatX * 0.5, 0, 1 - repeatX);
  const offsetY = THREE.MathUtils.clamp(patchArtY - repeatY * 0.5, 0, 1 - repeatY);

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
  const fieldWidth = ringR * ringConfig.aspectX * fieldSize;
  const fieldHeight = ringR * ringConfig.aspectY * fieldSize;
  const fieldRepeatX = THREE.MathUtils.clamp(fieldWidth / Math.max(0.0001, artWorldWidth), 0.0001, 1);
  const fieldRepeatY = THREE.MathUtils.clamp(fieldHeight / Math.max(0.0001, artWorldHeight), 0.0001, 1);
  const fieldOffsetX = THREE.MathUtils.clamp(patchArtX - fieldRepeatX * 0.5, 0, 1 - fieldRepeatX);
  const fieldOffsetY = THREE.MathUtils.clamp(patchArtY - fieldRepeatY * 0.5, 0, 1 - fieldRepeatY);

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
      playSocketFeedback();
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
  primeFeedback();
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

function setCompletionExitOpacityScale(scale = 1) {
  const clamped = THREE.MathUtils.clamp(scale, 0, 1);
  completionEffects.exitOpacityScale = clamped;
  if (!completionEffects.active) return;
  const visible = clamped > 0.004;
  completionEffects.recess.visible = visible;
  completionEffects.surfaceMask.visible = visible;
  completionEffects.ringBody.visible = visible;
  completionEffects.ring.visible = visible;
  completionEffects.imageField.visible = visible;
  completionEffects.imagePlug.visible = visible;
  completionEffects.rippleVideoField.visible = false;
  completionEffects.rippleField.visible = false;
  if (!visible) {
    completionEffects.recess.material.opacity = 0;
    completionEffects.ringBody.material.opacity = 0;
    completionEffects.ring.material.opacity = 0;
    completionEffects.imageField.material.opacity = 0;
    completionEffects.imagePlug.material.opacity = 0;
    completionEffects.rippleVideoField.material.opacity = 0;
    completionEffects.rippleField.material.opacity = 0;
  }
}

function resetCompletionState({ keepRootClass = false } = {}) {
  resetShapeLock();
  resetShapeStream();
  resetSceneFx();
  completionEffects.active = false;
  completionEffects.elapsed = 0;
  completionEffects.exitOpacityScale = 1;
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
  const exitOpacity = completionEffects.exitOpacityScale ?? 1;
  const completionVisible = exitOpacity > 0.004;
  completionEffects.recess.visible = completionVisible;
  completionEffects.surfaceMask.visible = completionVisible;
  completionEffects.ringBody.visible = completionVisible;
  completionEffects.ring.visible = completionVisible;
  completionEffects.imageField.visible = completionVisible;
  completionEffects.imagePlug.visible = completionVisible;

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
  completionEffects.ringBody.material.opacity = exitOpacity;

  completionEffects.ring.position.copy(completionEffects.ring.userData.surfacePosition)
    .addScaledVector(completionEffects.ring.userData.startOffset, 1 - ringT);
  completionEffects.ring.scale.copy(completionEffects.ring.userData.baseScale)
    .multiplyScalar(ringStartScale + (1 - ringStartScale) * ringT);
  completionEffects.ring.material.opacity = exitOpacity;
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
  const fieldOpacity = completionEffects.config.fieldOpacity ?? COMPLETION_FIELD_OPACITY;
  completionEffects.imageField.material.opacity = fieldOpacity * (1 - ease01(fieldFadeT)) * exitOpacity;

  completionEffects.imagePlug.position.copy(completionEffects.imagePlug.userData.surfacePosition)
    .add(completionEffects.imagePlug.userData.startOffset)
    .addScaledVector(completionEffects.imagePlug.userData.liftOffset, patchT);
  completionEffects.imagePlug.scale.copy(completionEffects.imagePlug.userData.baseScale)
    .multiplyScalar(1 - (1 - COMPLETION_PATCH_SETTLED_SCALE) * patchT);
  completionEffects.imagePlug.material.opacity = (1 - ease01(THREE.MathUtils.clamp((patchT - 0.36) / 0.44, 0, 1))) * exitOpacity;

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
  const lines = [
    'completionRing: {',
    `  x: ${ring.x.toFixed(4)}, y: ${ring.y.toFixed(4)},`,
    `  aspectX: ${ring.aspectX.toFixed(2)}, aspectY: ${ring.aspectY.toFixed(2)},`,
    `  radiusPad: ${ring.radiusPad.toFixed(2)}, surfaceZ: ${ring.surfaceZ.toFixed(2)}, recessZ: ${ring.recessZ.toFixed(2)},`,
    `  bodyOffsetX: ${ring.bodyOffsetX.toFixed(2)}, bodyOffsetY: ${ring.bodyOffsetY.toFixed(2)}, bodyOffsetZ: ${ring.bodyOffsetZ.toFixed(2)},`,
    `  emergeOffsetX: ${ring.emergeOffsetX.toFixed(2)}, emergeOffsetY: ${ring.emergeOffsetY.toFixed(2)}, emergeOffsetZ: ${ring.emergeOffsetZ.toFixed(2)},`,
    `  startScale: ${ring.startScale.toFixed(2)}, bodyStartScale: ${ring.bodyStartScale.toFixed(2)},`,
  ];
  if (ring.patchX != null || ring.patchY != null) {
    lines.push(`  patchX: ${(ring.patchX ?? ring.x).toFixed(4)}, patchY: ${(ring.patchY ?? ring.y).toFixed(4)},`);
  }
  if (ring.patchSize != null || ring.fieldSize != null || ring.fieldOpacity != null) {
    lines.push(
      `  patchSize: ${(ring.patchSize ?? COMPLETION_PATCH_SIZE).toFixed(2)}, `
      + `fieldSize: ${(ring.fieldSize ?? COMPLETION_FIELD_SIZE).toFixed(2)}, `
      + `fieldOpacity: ${(ring.fieldOpacity ?? COMPLETION_FIELD_OPACITY).toFixed(2)}`
    );
  }
  lines.push(
    '}',
    `ringState: ${completionEffects.active ? `active @ ${completionEffects.elapsed.toFixed(2)}s` : 'hidden'}`
  );
  return lines.join('\n');
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

function activeDoorwayEyeText() {
  const previewName = doorwayExit.calibrationTransitionPreview
    ? 'transition'
    : doorwayExit.calibrationPreview;
  return [
    'doorwayEyeExit: {',
    `  eyeColor: ${colorHex(DOORWAY_EYE_TUNING.eyeColor)}, eyeOpacity: ${DOORWAY_EYE_TUNING.eyeOpacity.toFixed(2)},`,
    `  overlayColor: ${colorHex(DOORWAY_EYE_TUNING.overlayColor)}, overlayOpacity: ${DOORWAY_EYE_TUNING.overlayOpacity.toFixed(2)},`,
    `  closedFade: ${SHAPE_STREAM_FINAL_GRID.closedRevealDuration.toFixed(2)}s, openFade: ${SHAPE_STREAM_FINAL_GRID.openRevealDuration.toFixed(2)}s,`,
    `  blinkCount: ${SHAPE_STREAM_FINAL_GRID.blinkCount}, blinkDuration: ${SHAPE_STREAM_FINAL_GRID.blinkDuration.toFixed(2)}s,`,
    `  postEyeHold: ${SHAPE_STREAM_FINAL_GRID.postEyeHoldDuration.toFixed(2)}s, handoff: ${SHAPE_STREAM_FINAL_GRID.roomImageHandoffDuration.toFixed(2)}s, roomBreak: ${doorwayRoomBreakPhaseDuration().toFixed(2)}s, blackFade: ${SHAPE_STREAM_FINAL_GRID.blackFadeDuration.toFixed(2)}s, homeHold: ${SHAPE_STREAM_FINAL_GRID.homeFadeHoldDuration.toFixed(2)}s,`,
    `  roomImagePieces: ${SHAPE_STREAM_FINAL_GRID.roomShardDesktopCount}/${SHAPE_STREAM_FINAL_GRID.roomShardMobileCount}/${SHAPE_STREAM_FINAL_GRID.roomShardReducedCount},`,
    `  imageBreakFlow: ${SHAPE_STREAM_FINAL_GRID.roomParticlePullDuration.toFixed(2)}s/${SHAPE_STREAM_FINAL_GRID.roomParticleBatchSize}@${SHAPE_STREAM_FINAL_GRID.roomParticleBatchInterval.toFixed(3)}s,`,
    `  preview: '${previewName}'`,
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
    activeShapeLockText(),
    '',
    activeDoorwayEyeText()
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
  syncDoorwayEyeControls();
  drawFloorEditorOverlay();
  calibrationOutput.textContent = activeLayoutText();
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
    primeFeedback();
    if (event.target.closest('#cal-toggle')) {
      setHudCollapsed(!calibrationConsole.classList.contains('is-collapsed'));
      return;
    }
    const button = event.target.closest('[data-cal-copy]');
    if (button) {
      copyCalibration(button.dataset.calCopy);
      return;
    }
    const ringButton = event.target.closest('[data-ring-action]');
    if (ringButton) handleRingAction(ringButton.dataset.ringAction);
    const lockButton = event.target.closest('[data-lock-action]');
    if (lockButton) handleShapeLockAction(lockButton.dataset.lockAction);
    const eyeButton = event.target.closest('[data-eye-action]');
    if (eyeButton) {
      handleDoorwayEyeAction(eyeButton.dataset.eyeAction);
      return;
    }
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
    const eyeInput = event.target.closest('[data-eye-control]');
    if (eyeInput) {
      handleDoorwayEyeControl(eyeInput);
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
  updateDoorwayEyeBlinkPreview(delta);
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
  retargetShapeStreamFinalGrid(true);
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
        updateCompletionEffects(0.025);
        updateShapeStream(0.025);
      }
      if (warmupSteps <= 0) shapeStream.full = true;
      for (let i = 0; i < chunk && warmupSteps <= 0 && settleSteps > 0; i += 1, settleSteps -= 1) {
        updateCompletionEffects(0.025);
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
