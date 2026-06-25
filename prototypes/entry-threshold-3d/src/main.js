import * as THREE from '../vendor/three.module.js';
import { createEntryAudio } from './audio.js';
import { createHomepageReveal } from './homepageReveal.js';
import { createScene } from './scene.js';
import { createMaterials } from './materials.js';
import { createSockets, createActivationSeal } from './sockets.js';
import { createTokens, setTokensRed, updateTokens } from './tokens.js';
import { createParticles } from './particles.js';
import { createInteraction } from './interaction.js';
import { createTransition } from './transition.js';

const canvas = document.getElementById('entry-canvas');
const skipButton = document.getElementById('skip-entry');
const status = document.getElementById('entry-status');
const entryRoot = document.getElementById('entry-root');
const referenceBg = document.getElementById('reference-bg');
const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const { scene, renderer, camera, viewport, toWorld } = createScene(canvas);
const materials = createMaterials();
const sockets = createSockets(scene, materials, toWorld);
const seal = createActivationSeal(scene, materials, sockets);
const tokens = createTokens(scene, materials, toWorld);
const particles = createParticles(scene, toWorld);
const audio = createEntryAudio();
const homepageReveal = createHomepageReveal();
const transition = createTransition({ camera, seal, particles, audio, homepageReveal, status, entryRoot, referenceBg });

createInteraction({
  canvas,
  viewport,
  tokens,
  sockets,
  seal,
  onComplete: () => {
    setTokensRed(tokens, materials.redStone);
    transition.activate();
  },
  onStonePress: () => {
    transition.pressStone();
  }
});

skipButton.addEventListener('click', () => {
  audio.play();
  status.textContent = 'entering';
  if (reduceMotion) {
    homepageReveal.reveal();
  } else {
    transition.pressStone();
    window.setTimeout(() => homepageReveal.reveal(), 850);
  }
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && document.activeElement !== skipButton) {
    skipButton.click();
  }
});

const clock = new THREE.Clock();

function animate() {
  const delta = Math.min(clock.getDelta(), 0.04);
  const elapsed = clock.elapsedTime;
  updateTokens(tokens, elapsed, delta, transition.state.activated);
  particles.update(delta, transition.state.pulling);
  transition.update(delta);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

if (reduceMotion) {
  status.textContent = 'press enter to begin';
}

animate();
