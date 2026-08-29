(function (global) {
  'use strict';

  var NOOP = function () {};
  var DEFAULT_OPEN_EYE = '/assets/eyes/openeye.png';
  var DEFAULT_CLOSED_EYE = '/assets/eyes/closedeye.png';
  var EYE_ROW_POOL = 20;
  var EYE_FALL_SPEED = 0.10;
  var EYE_ROW_SPEED = 0.18;

  function finite(value, fallback) {
    value = Number(value);
    return Number.isFinite(value) ? value : fallback;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function range(value, fallbackMin, fallbackMax) {
    if (Array.isArray(value) && value.length > 1) {
      var first = finite(value[0], fallbackMin);
      var second = finite(value[1], fallbackMax);
      return first <= second ? [first, second] : [second, first];
    }
    if (Number.isFinite(Number(value))) {
      var maximum = Math.max(0, Number(value));
      return [maximum * 0.3, maximum];
    }
    return [fallbackMin, fallbackMax];
  }

  function resolveElement(value) {
    return typeof value === 'string' ? document.querySelector(value) : value;
  }

  function mount(options) {
    options = options || {};

    var root = resolveElement(options.root) || document.documentElement;
    var eyesCanvas = resolveElement(options.eyesCanvas);
    var particleCanvas = resolveElement(options.particleCanvas);
    var eyeContext = eyesCanvas && eyesCanvas.getContext ? eyesCanvas.getContext('2d') : null;
    var particleContext = particleCanvas && particleCanvas.getContext ? particleCanvas.getContext('2d') : null;

    if (!eyeContext && !particleContext) return NOOP;

    var viewportRoot = root === document.documentElement || root === document.body;
    var dprCap = clamp(finite(options.dprCap, 2), 1, 2);
    var eyeTint = options.eyeTint || '';
    var animateEyes = options.animateEyes !== false;
    var particleCount = particleContext ? Math.max(0, Math.round(finite(options.particleCount, 120))) : 0;
    var particleColor = options.particleColor || '#FCB867';
    var particleOpacity = range(options.particleOpacity, 0.12, 0.42);
    var particleSize = range(options.particleSize, 2, 5.8);
    var particleSpeed = Math.max(0, finite(options.particleSpeed, 1.4));
    var centerX = finite(options.centerX, 0.5);
    var centerY = finite(options.centerY, 0.45);
    var spawnInterval = Math.max(16, finite(options.particleSpawnInterval, 180));
    var reduceQuery = global.matchMedia('(prefers-reduced-motion: reduce)');
    var reducedMotion = reduceQuery.matches;

    if (eyesCanvas) {
      if (options.eyeOpacity !== undefined) eyesCanvas.style.opacity = String(options.eyeOpacity);
      if (options.eyeFilter !== undefined) eyesCanvas.style.filter = options.eyeFilter || 'none';
      if (options.eyeMask !== undefined) {
        eyesCanvas.style.webkitMaskImage = options.eyeMask || 'none';
        eyesCanvas.style.maskImage = options.eyeMask || 'none';
      }
    }

    var width = 0;
    var height = 0;
    var pixelRatio = 1;
    var tileWidth = 0;
    var tileHeight = 0;
    var eyeSize = 0;
    var eyeOffsetX = 0;
    var eyeOffsetY = 0;
    var rowOffset = new Array(EYE_ROW_POOL);
    var rowSpeed = new Array(EYE_ROW_POOL);
    var rowsReady = false;
    var slotY = 0;
    var baseRow = 0;

    var openEye = null;
    var closedEye = null;
    var loadedEyes = 0;
    var eyesReady = false;

    var particles = [];
    var particlesSeeded = false;
    var spawnTimer = 0;

    var animationFrame = 0;
    var resizeFrame = 0;
    var lastTime = 0;
    var running = false;
    var destroyed = false;
    var resizeObserver = null;

    function measure() {
      if (viewportRoot) {
        width = Math.max(1, global.innerWidth || document.documentElement.clientWidth || 1);
        height = Math.max(1, global.innerHeight || document.documentElement.clientHeight || 1);
        return;
      }
      width = Math.max(1, root.clientWidth || root.getBoundingClientRect().width || 1);
      height = Math.max(1, root.clientHeight || root.getBoundingClientRect().height || 1);
    }

    function sizeCanvas(canvas, context) {
      if (!canvas || !context) return;
      canvas.width = Math.max(1, Math.round(width * pixelRatio));
      canvas.height = Math.max(1, Math.round(height * pixelRatio));
      canvas.style.width = width + 'px';
      canvas.style.height = height + 'px';
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    }

    function setTileSize() {
      if (width < 480) {
        tileWidth = 95;
        tileHeight = 85;
        eyeSize = 65;
      } else if (width < 768) {
        tileWidth = 120;
        tileHeight = 108;
        eyeSize = 85;
      } else if (width < 1200) {
        tileWidth = 148;
        tileHeight = 132;
        eyeSize = 100;
      } else {
        tileWidth = 175;
        tileHeight = 155;
        eyeSize = 115;
      }
      eyeOffsetX = (tileWidth - eyeSize) / 2;
      eyeOffsetY = (tileHeight - eyeSize) / 2;

      if (!rowsReady) {
        for (var row = 0; row < EYE_ROW_POOL; row += 1) {
          var direction = row % 2 === 0 ? 1 : -1;
          rowOffset[row] = Math.random() * tileWidth * 1000;
          rowSpeed[row] = direction * EYE_ROW_SPEED * (0.70 + Math.random() * 0.60);
        }
        rowsReady = true;
      }
    }

    function drawEyes() {
      if (!eyeContext) return;
      eyeContext.clearRect(0, 0, width, height);
      if (!eyesReady) return;

      var slots = Math.ceil(height / tileHeight) + 2;
      var columns = Math.ceil(width / tileWidth) + 3;

      for (var index = 0; index < slots; index += 1) {
        var logicalRow = baseRow + index;
        var rowId = ((logicalRow % EYE_ROW_POOL) + EYE_ROW_POOL) % EYE_ROW_POOL;
        var stagger = ((logicalRow % 2) + 2) % 2 === 1 ? tileWidth / 2 : 0;
        var offsetX = ((rowOffset[rowId] + stagger) % tileWidth + tileWidth) % tileWidth - tileWidth;
        var y = index * tileHeight + slotY - tileHeight;

        for (var column = 0; column < columns; column += 1) {
          var parity = ((logicalRow + column) % 2 + 2) % 2;
          eyeContext.drawImage(
            parity === 0 ? openEye : closedEye,
            column * tileWidth + offsetX + eyeOffsetX,
            y + eyeOffsetY,
            eyeSize,
            eyeSize
          );
        }
      }

      if (eyeTint) {
        eyeContext.globalCompositeOperation = 'source-in';
        eyeContext.fillStyle = eyeTint;
        eyeContext.fillRect(0, 0, width, height);
        eyeContext.globalCompositeOperation = 'source-over';
      }
    }

    function stepEyes(frameScale) {
      if (!eyeContext) return;
      slotY += EYE_FALL_SPEED * frameScale;
      while (slotY >= tileHeight) {
        slotY -= tileHeight;
        baseRow -= 1;
      }
      for (var row = 0; row < EYE_ROW_POOL; row += 1) {
        rowOffset[row] = (rowOffset[row] + rowSpeed[row] * frameScale + tileWidth * 10000) % (tileWidth * 10000);
      }
    }

    function particleCenter() {
      return {
        x: Math.abs(centerX) <= 1 ? width * centerX : centerX,
        y: Math.abs(centerY) <= 1 ? height * centerY : centerY
      };
    }

    function spawnParticle(preseed) {
      var startRadius = 60;
      var close = Math.random() < 0.4;
      var minimumDistance = close ? 8 : 80;
      var maximumDistance = close ? 90 : Math.max(240, Math.min(width, height) * 0.55);
      var opacity = particleOpacity[0] + Math.random() * (particleOpacity[1] - particleOpacity[0]);
      var size = particleSize[0] + Math.random() * (particleSize[1] - particleSize[0]);
      var particle = {
        angle: Math.random() * Math.PI * 2,
        dist: startRadius,
        targetDist: startRadius + minimumDistance + Math.random() * (maximumDistance - minimumDistance),
        orbitSpeed: (Math.random() * 0.000035 + 0.00001) * (Math.random() < 0.5 ? 1 : -1),
        driftSpeed: 0.003 + Math.random() * 0.007,
        size: Math.max(0.6, size),
        maxAlpha: opacity,
        floatAmpX: 2 + Math.random() * 4,
        floatAmpY: 2 + Math.random() * 4,
        floatPeriodX: 12000 + Math.random() * 10000,
        floatPeriodY: 14000 + Math.random() * 10000,
        floatOffsetX: Math.random() * Math.PI * 2,
        floatOffsetY: Math.random() * Math.PI * 2,
        fadeInDuration: 800 + Math.random() * 600,
        fadeOutDuration: 1400 + Math.random() * 1000,
        age: 0,
        totalLife: null,
        reached: false
      };

      if (preseed) {
        var progress = Math.random();
        particle.dist = startRadius + progress * (particle.targetDist - startRadius);
        particle.age = progress * (particle.fadeInDuration + 3000);
        if (particle.dist >= particle.targetDist) {
          particle.reached = true;
          particle.totalLife = particle.age + 4000 + Math.random() * 8000;
        }
      }

      particles.push(particle);
    }

    function drawParticles(delta, timestamp) {
      if (!particleContext) return;

      if (!particlesSeeded && width > 0) {
        for (var seed = 0; seed < particleCount; seed += 1) spawnParticle(true);
        particlesSeeded = true;
      }

      spawnTimer += delta;
      if (spawnTimer >= spawnInterval && particles.length < particleCount) {
        spawnParticle(false);
        spawnTimer = 0;
      }

      var center = particleCenter();
      particleContext.clearRect(0, 0, width, height);

      for (var index = particles.length - 1; index >= 0; index -= 1) {
        var particle = particles[index];
        particle.age += delta;
        particle.angle += particle.orbitSpeed * delta;

        if (!particle.reached) {
          particle.dist += particle.driftSpeed * delta;
          if (particle.dist >= particle.targetDist) {
            particle.dist = particle.targetDist;
            particle.reached = true;
            particle.totalLife = particle.age + 4000 + Math.random() * 8000;
          }
        }

        if (particle.reached && particle.age >= particle.totalLife) {
          particles.splice(index, 1);
          continue;
        }

        var alpha;
        if (!particle.reached) {
          alpha = Math.min(particle.age / particle.fadeInDuration, 1) * particle.maxAlpha;
        } else {
          var timeLeft = particle.totalLife - particle.age;
          alpha = timeLeft < particle.fadeOutDuration
            ? (timeLeft / particle.fadeOutDuration) * particle.maxAlpha
            : particle.maxAlpha;
        }

        var floatX = particle.floatAmpX * Math.sin((timestamp / particle.floatPeriodX) * Math.PI * 2 + particle.floatOffsetX);
        var floatY = particle.floatAmpY * Math.sin((timestamp / particle.floatPeriodY) * Math.PI * 2 + particle.floatOffsetY);
        particleContext.globalAlpha = alpha;
        particleContext.beginPath();
        particleContext.arc(
          center.x + Math.cos(particle.angle) * particle.dist + floatX,
          center.y + Math.sin(particle.angle) * particle.dist + floatY,
          particle.size,
          0,
          Math.PI * 2
        );
        particleContext.fillStyle = particleColor;
        particleContext.fill();
      }

      particleContext.globalAlpha = 1;
    }

    function renderSettledFrame() {
      drawEyes();
      drawParticles(16 * particleSpeed, 0);
    }

    function resize() {
      measure();
      pixelRatio = Math.min(dprCap, Math.max(1, finite(global.devicePixelRatio, 1)));
      sizeCanvas(eyesCanvas, eyeContext);
      sizeCanvas(particleCanvas, particleContext);
      setTileSize();
      renderSettledFrame();
    }

    function queueResize() {
      if (destroyed || resizeFrame) return;
      resizeFrame = global.requestAnimationFrame(function () {
        resizeFrame = 0;
        resize();
      });
    }

    function frame(timestamp) {
      if (!running || destroyed) return;
      var delta = Math.min(timestamp - lastTime, 50);
      lastTime = timestamp;
      if (animateEyes) stepEyes(delta / 16.667);
      drawEyes();
      drawParticles(delta * particleSpeed, timestamp);
      animationFrame = global.requestAnimationFrame(frame);
    }

    function start() {
      if (destroyed || reducedMotion || document.hidden || running || (!animateEyes && particleCount === 0)) return;
      running = true;
      animationFrame = global.requestAnimationFrame(function (timestamp) {
        lastTime = timestamp;
        animationFrame = global.requestAnimationFrame(frame);
      });
    }

    function stop() {
      running = false;
      if (animationFrame) global.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }

    function onVisibilityChange() {
      if (document.hidden) stop();
      else if (reducedMotion) renderSettledFrame();
      else start();
    }

    function onMotionChange(event) {
      reducedMotion = event.matches;
      if (reducedMotion) {
        stop();
        renderSettledFrame();
      } else {
        start();
      }
    }

    resize();

    if (eyeContext) {
      openEye = new Image();
      closedEye = new Image();
      var onEyeLoad = function () {
        loadedEyes += 1;
        if (loadedEyes < 2) return;
        eyesReady = true;
        drawEyes();
      };
      openEye.onload = onEyeLoad;
      closedEye.onload = onEyeLoad;
      openEye.src = options.openEyeSrc || DEFAULT_OPEN_EYE;
      closedEye.src = options.closedEyeSrc || DEFAULT_CLOSED_EYE;
    }

    global.addEventListener('resize', queueResize, { passive: true });
    document.addEventListener('visibilitychange', onVisibilityChange);
    if (reduceQuery.addEventListener) reduceQuery.addEventListener('change', onMotionChange);
    else if (reduceQuery.addListener) reduceQuery.addListener(onMotionChange);

    if (global.ResizeObserver) {
      resizeObserver = new ResizeObserver(function () {
        if (viewportRoot || root.clientWidth !== width || root.clientHeight !== height) queueResize();
      });
      resizeObserver.observe(root);
    }

    start();

    return function cleanup() {
      if (destroyed) return;
      destroyed = true;
      stop();
      if (resizeFrame) global.cancelAnimationFrame(resizeFrame);
      resizeFrame = 0;
      global.removeEventListener('resize', queueResize);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (reduceQuery.removeEventListener) reduceQuery.removeEventListener('change', onMotionChange);
      else if (reduceQuery.removeListener) reduceQuery.removeListener(onMotionChange);
      if (resizeObserver) resizeObserver.disconnect();
      if (openEye) openEye.onload = null;
      if (closedEye) closedEye.onload = null;
    };
  }

  global.ConstructAmbientField = Object.freeze({ mount: mount });
})(window);
