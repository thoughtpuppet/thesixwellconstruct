(function () {
  const params = new URLSearchParams(window.location.search);
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const orbs = Array.from(document.querySelectorAll('.entry-orb[data-orb]'));
  const sockets = Array.from(document.querySelectorAll('.entry-socket[data-socket]'));
  const field = document.querySelector('.orb-field');
  if (!field || !orbs.length || !sockets.length) return;

  const orbState = new Map();
  const socketState = new Map();
  let active = null;

  function percentFromPoint(x, y) {
    const rect = field.getBoundingClientRect();
    return {
      x: Math.min(rect.width - 20, Math.max(20, x - rect.left)),
      y: Math.min(rect.height - 20, Math.max(20, y - rect.top))
    };
  }

  function centerOf(element) {
    const rect = element.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      radius: Math.max(rect.width, rect.height) / 2
    };
  }

  function setOrbPosition(orb, position) {
    orb.style.setProperty('--orb-x', `${position.x.toFixed(0)}px`);
    orb.style.setProperty('--orb-y', `${position.y.toFixed(0)}px`);
  }

  function resetInlineMotion(orb) {
    orb.style.transform = '';
  }

  function nearestOpenSocket(orb) {
    const orbCenter = centerOf(orb);
    let best = null;

    sockets.forEach((socket) => {
      if (socketState.get(socket.dataset.socket)) return;
      const socketCenter = centerOf(socket);
      const distance = Math.hypot(orbCenter.x - socketCenter.x, orbCenter.y - socketCenter.y);
      // Snap radius: actual snapping happens when within this distance
      const fieldRect = field.getBoundingClientRect();
      const snapRadius = Math.max(socketCenter.radius * 3, fieldRect.width * 0.15);
      if (distance > snapRadius) return;
      if (!best || distance < best.distance) {
        best = { socket, distance };
      }
    });

    return best && best.socket;
  }

  function nearestVisualTarget(orb) {
    const orbCenter = centerOf(orb);
    let best = null;

    sockets.forEach((socket) => {
      if (socketState.get(socket.dataset.socket)) return;
      const socketCenter = centerOf(socket);
      const distance = Math.hypot(orbCenter.x - socketCenter.x, orbCenter.y - socketCenter.y);
      // Visual target radius: very large for showing intent/feedback to drag towards sockets
      const fieldRect = field.getBoundingClientRect();
      const targetRadius = Math.max(socketCenter.radius * 10, fieldRect.width * 0.7);
      if (distance > targetRadius) return;
      if (!best || distance < best.distance) {
        best = { socket, distance };
      }
    });

    return best && best.socket;
  }

  function updateSocketTargets(orb) {
    const target = orb ? nearestVisualTarget(orb) : null;
    sockets.forEach((socket) => {
      socket.classList.toggle('is-target', socket === target);
    });
  }

  function freeHomeFor(orb) {
    const state = orbState.get(orb);
    return state && state.home;
  }

  function returnHome(orb) {
    const home = freeHomeFor(orb);
    if (!home) return;
    setOrbPosition(orb, home);
  }

  function lockOrb(orb, socket) {
    const state = orbState.get(orb);
    const socketPosition = percentFromPoint(centerOf(socket).x, centerOf(socket).y);
    socketState.set(socket.dataset.socket, orb.dataset.orb);
    socket.classList.add('is-filled');
    socket.classList.remove('is-target');
    orb.classList.remove('is-dragging');
    orb.classList.add('is-locked');
    orb.dataset.socket = socket.dataset.socket;
    orb.setAttribute('aria-disabled', 'true');
    if (state) state.locked = true;
    setOrbPosition(orb, socketPosition);
    resetInlineMotion(orb);

    if (orbs.every((item) => item.classList.contains('is-locked'))) {
      document.body.classList.add('entry-room-complete');
    }
  }

  function startDrag(orb, event) {
    if (orb.classList.contains('is-locked')) return;
    event.preventDefault();
    active = {
      orb,
      pointerId: event.pointerId
    };
    orb.classList.add('is-dragging');
    document.body.classList.add('orb-drag-active');
    resetInlineMotion(orb);
    try { orb.setPointerCapture(event.pointerId); } catch {}
    moveDrag(event);
  }

  function moveDrag(event) {
    if (!active || event.pointerId !== active.pointerId) return;
    const position = percentFromPoint(event.clientX, event.clientY);
    setOrbPosition(active.orb, position);
    resetInlineMotion(active.orb);
    updateSocketTargets(active.orb);
  }

  function endDrag(event) {
    if (!active || event.pointerId !== active.pointerId) return;
    const orb = active.orb;
    const socket = nearestOpenSocket(orb);
    try { orb.releasePointerCapture(event.pointerId); } catch {}
    active = null;
    document.body.classList.remove('orb-drag-active');

    if (socket) {
      lockOrb(orb, socket);
    } else {
      orb.classList.remove('is-dragging');
      updateSocketTargets(null);
      returnHome(orb);
      resetInlineMotion(orb);
    }
  }

  orbs.forEach((orb) => {
    const rect = orb.getBoundingClientRect();
    const fieldRect = field.getBoundingClientRect();
    orbState.set(orb, {
      home: {
        x: rect.left - fieldRect.left + rect.width / 2,
        y: rect.top - fieldRect.top + rect.height / 2
      },
      locked: false
    });
    orb.addEventListener('pointerdown', (event) => startDrag(orb, event));
    orb.addEventListener('pointermove', moveDrag);
    orb.addEventListener('pointerup', endDrag);
    orb.addEventListener('pointercancel', endDrag);
  });

  window.addEventListener('pointermove', moveDrag, { passive: false });
  window.addEventListener('pointerup', endDrag, { passive: false });
  window.addEventListener('pointercancel', endDrag, { passive: false });

  if (reducedMotion) {
    document.body.classList.add('orb-drag-reduced-motion');
  }
})();
