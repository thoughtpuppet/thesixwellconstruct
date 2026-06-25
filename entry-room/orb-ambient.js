(function () {
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reducedMotion) return;

  const orbs = Array.from(document.querySelectorAll('.entry-orb[data-orb]'));
  if (!orbs.length) return;

  document.body.classList.add('orb-ambient-active');

  const pointer = {
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
    active: false
  };

  const states = orbs.map((orb, index) => {
    const styles = getComputedStyle(orb);
    const driftX = parseFloat(styles.getPropertyValue('--drift-x')) || 6;
    const driftY = parseFloat(styles.getPropertyValue('--drift-y')) || -8;
    const scale = parseFloat(styles.getPropertyValue('--orb-scale')) || 1;
    return {
      orb,
      index,
      scale,
      driftX,
      driftY,
      pullX: 0,
      pullY: 0,
      currentX: 0,
      currentY: 0,
      phase: index * 1.73 + Math.random() * 0.4,
      speed: 0.00022 + index * 0.000018
    };
  });

  function setPointer(event) {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.active = true;
  }

  function softenPointer() {
    pointer.active = false;
  }

  window.addEventListener('pointermove', setPointer, { passive: true });
  window.addEventListener('pointerdown', setPointer, { passive: true });
  window.addEventListener('pointerleave', softenPointer, { passive: true });
  window.addEventListener('blur', softenPointer);

  function tick(now) {
    const w = window.innerWidth || 1;
    const h = window.innerHeight || 1;
    const field = Math.min(w, h);

    states.forEach((state) => {
      if (state.orb.classList.contains('is-dragging') || state.orb.classList.contains('is-locked')) {
        state.pullX = 0;
        state.pullY = 0;
        state.currentX = 0;
        state.currentY = 0;
        return;
      }

      const rect = state.orb.getBoundingClientRect();
      const orbX = rect.left + rect.width / 2;
      const orbY = rect.top + rect.height / 2;
      const dx = pointer.x - orbX;
      const dy = pointer.y - orbY;
      const distance = Math.hypot(dx, dy) || 1;
      const reach = Math.max(180, field * 0.38);
      const influence = pointer.active ? Math.max(0, 1 - distance / reach) : 0;
      const strength = influence * influence;
      const maxPull = 34 + rect.width * 0.22;
      const targetPullX = (dx / distance) * maxPull * strength;
      const targetPullY = (dy / distance) * maxPull * strength;

      state.pullX += (targetPullX - state.pullX) * 0.055;
      state.pullY += (targetPullY - state.pullY) * 0.055;

      const phase = now * state.speed + state.phase;
      const floatX = Math.sin(phase * 1.28) * state.driftX * 1.34 + Math.sin(phase * 0.47) * 3.8;
      const floatY = Math.cos(phase) * state.driftY * 1.54 + Math.sin(phase * 0.71) * 5.4;
      const breathe = Math.sin(phase * 0.82) * 0.026;
      const targetX = floatX + state.pullX;
      const targetY = floatY + state.pullY;

      state.currentX += (targetX - state.currentX) * 0.045;
      state.currentY += (targetY - state.currentY) * 0.045;

      state.orb.style.transform = `translate(-50%, -50%) translate3d(${state.currentX.toFixed(2)}px, ${state.currentY.toFixed(2)}px, 0) scale(${(state.scale + breathe + strength * 0.035).toFixed(4)})`;
    });

    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
})();
