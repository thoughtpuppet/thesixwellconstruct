import * as THREE from '../vendor/three.module.js';

export function createTransition({ camera, seal, particles, audio, homepageReveal, status, entryRoot, referenceBg }) {
  const state = {
    activated: false,
    activationStart: 0,
    pressing: false,
    pressStart: 0,
    pulling: false,
    pullStart: 0
  };

  function activate() {
    state.activated = true;
    state.activationStart = performance.now();
    seal.group.visible = true;
    seal.group.scale.setScalar(0.2);
    status.textContent = 'press the red stone';
    referenceBg.src = './assets/reference/recessed_socket_frame_05.png';
    window.setTimeout(() => {
      seal.backing.visible = true;
      referenceBg.src = './assets/reference/recessed_socket_frame_06.png';
    }, 640);
  }

  function pressStone() {
    if (state.pressing) return;
    state.pressing = true;
    state.pressStart = performance.now();
    status.textContent = 'entering';
    entryRoot.classList.add('is-pulling');
    referenceBg.src = './assets/reference/recessed_socket_frame_07.png';
    audio.play();
    particles.burst(seal.center.clone().setZ(0.5), 210);
    window.setTimeout(() => {
      state.pulling = true;
      state.pullStart = performance.now();
    }, 540);
    window.setTimeout(() => {
      homepageReveal.reveal();
    }, 2280);
  }

  function update() {
    const now = performance.now();
    if (state.activated) {
      const p = easeOut(Math.min(1, (now - state.activationStart) / 880));
      seal.group.scale.setScalar(0.2 + p * 0.8);
      seal.group.rotation.z = (1 - p) * 0.08;
    }
    if (state.pressing) {
      const p = easeInOut(Math.min(1, (now - state.pressStart) / 640));
      seal.group.position.z = seal.center.z + 0.035 - p * 0.2;
      seal.group.scale.setScalar(Math.max(0.05, 1 - p * 0.72));
      seal.group.traverse((child) => {
        if (child.material && 'opacity' in child.material) {
          child.material.transparent = true;
          child.material.opacity = Math.max(0, 1 - p * 0.8);
        }
      });
    }
    if (state.pulling) {
      const p = easeInOut(Math.min(1, (now - state.pullStart) / 1500));
      camera.zoom = 1 + p * 1.65;
      camera.position.x = p * 0.95;
      camera.position.y = -p * 0.2;
      camera.updateProjectionMatrix();
    }
  }

  return { state, activate, pressStone, update };
}

function easeOut(v) {
  return 1 - Math.pow(1 - v, 3);
}

function easeInOut(v) {
  return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2;
}
