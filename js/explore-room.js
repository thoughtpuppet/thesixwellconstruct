import * as THREE from "/entry-room/3d/vendor/three.module.js";

const root = document.querySelector("[data-explore-room]");
const sceneCanvas = document.querySelector("[data-explore-scene-canvas]");
const eyesCanvas = document.querySelector("[data-explore-eyes]");
const particleCanvas = document.querySelector("[data-explore-particles]");
const portal = document.querySelector("[data-explore-portal]");
const controls = Array.from(document.querySelectorAll("[data-explore-scope]"));

if (root) {
  const styles = getComputedStyle(document.documentElement);
  const constructAmber = styles.getPropertyValue("--color-about").trim() || "#FCB867";
  const reduceMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reduceMotion = reduceMotionQuery.matches;
  const eyeMask = "radial-gradient(circle at 50% 44%, #000 0%, rgba(0, 0, 0, 0.88) 34%, rgba(0, 0, 0, 0.3) 66%, transparent 91%)";

  const unmountAmbient = window.ConstructAmbientField
    ? window.ConstructAmbientField.mount({
        root,
        eyesCanvas,
        particleCanvas,
        eyeOpacity: 0.05,
        eyeTint: "#6D3D15",
        eyeMask,
        eyeFilter: "brightness(0.72) saturate(1.35)",
        particleCount: 76,
        particleColor: constructAmber,
        particleOpacity: [0.08, 0.3],
        particleSize: [0.8, 7.2],
        centerX: 0.5,
        centerY: 0.47,
      })
    : function () {};

  let renderer = null;
  let resizeObserver = null;
  let animationFrame = 0;
  let disposed = false;
  let lastFrameTime = 0;
  let motionElapsed = 0;
  let previewBlend = 0;

  function useFallback() {
    root.dataset.exploreRenderer = "fallback";
    if (sceneCanvas) sceneCanvas.hidden = true;
  }

  try {
    if (!sceneCanvas) throw new Error("Explore scene canvas is missing.");

    renderer = new THREE.WebGLRenderer({
      canvas: sceneCanvas,
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60);
    camera.position.set(0, 0, 14);
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.HemisphereLight(0xffd8ad, 0x130b08, 1.45));

    const keyLight = new THREE.DirectionalLight(0xffe1bd, 3.2);
    keyLight.position.set(-4.5, 6, 8);
    scene.add(keyLight);

    const redFill = new THREE.PointLight(0xd01006, 18, 18, 2);
    redFill.position.set(3.5, -1.5, 5);
    scene.add(redFill);

    const rimLight = new THREE.DirectionalLight(0x537ec4, 1.35);
    rimLight.position.set(5, 2, -3);
    scene.add(rimLight);

    const backWallMaterial = new THREE.MeshBasicMaterial({
      color: 0x2a1a12,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    });
    const backWall = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), backWallMaterial);
    backWall.position.z = -1.15;
    backWall.renderOrder = -2;
    scene.add(backWall);

    const objectSpecs = {
      all: {
        color: 0xd01006,
        geometry: () => prismGeometry(48),
        diameterRatio: 0.86,
        rotation: [0.08, -0.18, -0.03],
        rotationSpeed: 0.00007,
        rollSway: 0.08,
        tumbleX: 0.2,
        tumbleY: 0.28,
        floatX: 0.04,
        floatY: 0.075,
        floatZ: 0.025,
        floatTilt: 0.035,
      },
      works: {
        color: 0xf06c00,
        geometry: () => prismGeometry(4, Math.PI / 4),
        diameterRatio: 0.72,
        rotation: [0.22, -0.31, -0.08],
        rotationSpeed: -0.00017,
        rollSway: 0.16,
        tumbleX: 0.26,
        tumbleY: 0.34,
        floatX: 0.07,
        floatY: 0.11,
        floatZ: 0.04,
        floatTilt: 0.06,
      },
      process: {
        color: 0xffbb00,
        geometry: () => prismGeometry(3),
        diameterRatio: 0.76,
        rotation: [-0.18, 0.28, 0.02],
        rotationSpeed: 0.00015,
        rollSway: 0.14,
        tumbleX: 0.28,
        tumbleY: 0.3,
        floatX: 0.065,
        floatY: 0.12,
        floatZ: 0.045,
        floatTilt: 0.055,
      },
      pages: {
        color: 0x006eff,
        geometry: () => prismGeometry(6),
        diameterRatio: 0.72,
        rotation: [0.2, 0.32, 0.08],
        rotationSpeed: -0.000135,
        rollSway: 0.12,
        tumbleX: 0.24,
        tumbleY: 0.36,
        floatX: 0.075,
        floatY: 0.105,
        floatZ: 0.04,
        floatTilt: 0.06,
      },
    };

    function prismGeometry(segments, twist = 0) {
      const geometry = new THREE.CylinderGeometry(1, 1, 0.46, segments);
      geometry.rotateX(Math.PI / 2);
      if (twist) geometry.rotateZ(twist);
      return geometry;
    }

    function materialFor(spec) {
      return new THREE.MeshStandardMaterial({
        color: spec.color,
        roughness: 1,
        metalness: 0,
        flatShading: true,
        transparent: true,
        opacity: 1,
      });
    }

    function createWallShadowTexture() {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 256;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Explore wall shadow canvas is unavailable.");

      const feather = context.createRadialGradient(128, 128, 8, 128, 128, 126);
      feather.addColorStop(0, "rgba(255, 255, 255, 0.72)");
      feather.addColorStop(0.28, "rgba(255, 255, 255, 0.46)");
      feather.addColorStop(0.58, "rgba(255, 255, 255, 0.16)");
      feather.addColorStop(1, "rgba(255, 255, 255, 0)");
      context.fillStyle = feather;
      context.fillRect(0, 0, canvas.width, canvas.height);

      const texture = new THREE.CanvasTexture(canvas);
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      return texture;
    }

    const wallShadowTexture = createWallShadowTexture();

    const objects = controls.map((control, index) => {
      const scope = control.dataset.exploreScope;
      const spec = objectSpecs[scope];
      const group = new THREE.Group();
      const material = materialFor(spec);
      const mesh = new THREE.Mesh(spec.geometry(), material);
      mesh.rotation.set(...spec.rotation);
      group.add(mesh);

      const wallShadowMaterial = new THREE.SpriteMaterial({
        map: wallShadowTexture,
        color: 0x000000,
        transparent: true,
        opacity: scope === "all" ? 0.52 : 0.42,
        depthWrite: false,
      });
      const wallShadow = new THREE.Sprite(wallShadowMaterial);
      wallShadow.position.set(0, 0, -0.82);
      wallShadow.renderOrder = -1;
      scene.add(wallShadow);
      scene.add(group);

      const item = {
        scope,
        control,
        group,
        mesh,
        material,
        wallShadow,
        wallShadowMaterial,
        spec,
        basePosition: new THREE.Vector3(),
        previewPositionX: 0,
        baseScale: 1,
        floatPhase: 0.45 + index * 1.73,
        hovered: false,
        focused: false,
        pressed: false,
      };

      function updateInteraction(property, value) {
        item[property] = value;
        if (reduceMotion) renderFrame(performance.now());
      }

      control.addEventListener("pointerenter", () => updateInteraction("hovered", true));
      control.addEventListener("pointerleave", () => {
        updateInteraction("hovered", false);
        updateInteraction("pressed", false);
      });
      control.addEventListener("focus", () => updateInteraction("focused", true));
      control.addEventListener("blur", () => updateInteraction("focused", false));
      control.addEventListener("pointerdown", () => updateInteraction("pressed", true));
      control.addEventListener("pointerup", () => updateInteraction("pressed", false));
      control.addEventListener("pointercancel", () => updateInteraction("pressed", false));

      return item;
    });

    const canvasBox = { left: 0, top: 0, width: 1, height: 1 };
    const projectionPoint = new THREE.Vector3();
    const projectionDirection = new THREE.Vector3();

    function screenToWorld(clientX, clientY, planeZ = 0) {
      projectionPoint.set(
        ((clientX - canvasBox.left) / canvasBox.width) * 2 - 1,
        -((clientY - canvasBox.top) / canvasBox.height) * 2 + 1,
        0.25,
      );
      projectionPoint.unproject(camera);
      projectionDirection.copy(projectionPoint).sub(camera.position).normalize();
      const distance = (planeZ - camera.position.z) / projectionDirection.z;
      return new THREE.Vector3()
        .copy(camera.position)
        .add(projectionDirection.multiplyScalar(distance));
    }

    function positionObjects() {
      const bounds = sceneCanvas.getBoundingClientRect();
      canvasBox.left = bounds.left;
      canvasBox.top = bounds.top;
      canvasBox.width = Math.max(1, bounds.width);
      canvasBox.height = Math.max(1, bounds.height);

      const wallTopLeft = screenToWorld(bounds.left, bounds.top, -1.15);
      const wallBottomRight = screenToWorld(bounds.right, bounds.bottom, -1.15);
      const previewShiftPixels = Math.min(280, bounds.width * 0.17);
      backWall.position.set(
        (wallTopLeft.x + wallBottomRight.x) / 2,
        (wallTopLeft.y + wallBottomRight.y) / 2,
        -1.15,
      );
      backWall.scale.set(
        Math.abs(wallBottomRight.x - wallTopLeft.x) * 0.51,
        Math.abs(wallTopLeft.y - wallBottomRight.y) * 0.51,
        1,
      );

      objects.forEach((item) => {
        const rect = item.control.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const center = screenToWorld(centerX, centerY, 0);
        const previewLeftLimit = bounds.left + Math.max(28, rect.width * 0.54);
        const portalLeft = bounds.right - Math.min(bounds.width * 0.42, 560);
        const previewRightLimit = bounds.width > 700
          ? portalLeft - Math.max(28, rect.width * 0.54)
          : bounds.right - Math.max(28, rect.width * 0.54);
        const previewCenterX = Math.min(previewRightLimit, Math.max(
          previewLeftLimit,
          centerX - previewShiftPixels,
        ));
        const previewCenter = screenToWorld(previewCenterX, centerY, 0);
        const edge = screenToWorld(centerX + (rect.width * item.spec.diameterRatio) / 2, centerY, 0);
        item.basePosition.copy(center);
        item.previewPositionX = previewCenter.x;
        item.baseScale = Math.max(0.01, center.distanceTo(edge));
        item.group.position.copy(item.basePosition);
        item.group.scale.setScalar(item.baseScale);
        item.wallShadow.position.set(
          item.basePosition.x + item.baseScale * 0.1,
          item.basePosition.y - item.baseScale * 0.04,
          -0.82,
        );
        item.wallShadow.scale.set(
          item.baseScale * (item.scope === "all" ? 2.85 : 2.45),
          item.baseScale * (item.scope === "all" ? 2.65 : 2.25),
          1,
        );
      });
    }

    function resize() {
      const width = Math.max(1, root.clientWidth);
      const height = Math.max(1, root.clientHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      positionObjects();
      if (reduceMotion) renderFrame(performance.now());
    }

    function syncRoomState() {
      const loading = root.dataset.exploreState === "loading";
      const activeScope = root.dataset.exploreActiveScope || "";

      objects.forEach((item) => {
        const selected = loading && item.scope === activeScope;
        item.control.dataset.exploreSelected = String(selected);
      });

      if (reduceMotion) renderFrame(performance.now());
    }

    function renderFrame(time) {
      if (disposed || !renderer) return;
      const loading = root.dataset.exploreState === "loading";
      const activeScope = root.dataset.exploreActiveScope || "";
      const portalOpen = Boolean(portal && !portal.hidden);
      const deltaSeconds = lastFrameTime ? Math.min(0.05, Math.max(0, (time - lastFrameTime) * 0.001)) : 0;
      const targetPreviewBlend = portalOpen ? 1 : 0;
      if (reduceMotion) previewBlend = targetPreviewBlend;
      else {
        const blendRate = targetPreviewBlend ? 1.25 : 2.1;
        previewBlend += (targetPreviewBlend - previewBlend) * Math.min(1, deltaSeconds * blendRate);
      }
      const previewEase = previewBlend * previewBlend * (3 - 2 * previewBlend);
      const motionFactor = 1 - previewEase;
      motionElapsed += deltaSeconds * motionFactor;
      lastFrameTime = time;
      const elapsed = motionElapsed;

      objects.forEach((item) => {
        const engaged = item.hovered || item.focused;
        const selected = loading && item.scope === activeScope;
        const dimmed = portalOpen || (loading && !selected);
        const pulse = selected && !portalOpen && !reduceMotion ? 1 + Math.sin(time * 0.009) * 0.035 : 1;
        const pressScale = item.pressed ? 0.97 : 1;
        const interactionScale = engaged && !item.pressed ? 1.055 : 1;
        const targetScale = item.baseScale * pulse * pressScale * interactionScale;
        const lift = engaged && !reduceMotion ? item.baseScale * 0.09 : 0;
        const responsiveness = reduceMotion ? 1 : 0.13;
        const driftX = reduceMotion
          ? 0
          : Math.cos(elapsed * 0.34 + item.floatPhase) * item.baseScale * item.spec.floatX;
        const driftY = reduceMotion
          ? 0
          : Math.sin(elapsed * 0.47 + item.floatPhase * 1.13) * item.baseScale * item.spec.floatY;
        const driftZ = reduceMotion
          ? 0
          : Math.sin(elapsed * 0.26 + item.floatPhase * 1.71) * item.baseScale * item.spec.floatZ;

        const nextScale = item.group.scale.x + (targetScale - item.group.scale.x) * responsiveness;
        item.group.scale.setScalar(nextScale);
        item.group.position.x +=
          (item.basePosition.x + (item.previewPositionX - item.basePosition.x) * previewEase + driftX -
            item.group.position.x) *
          responsiveness;
        item.group.position.y += (item.basePosition.y + driftY + lift - item.group.position.y) * responsiveness;
        item.group.position.z += (item.basePosition.z + driftZ - item.group.position.z) * responsiveness;
        item.wallShadow.position.x +=
          (item.basePosition.x + (item.previewPositionX - item.basePosition.x) * previewEase +
            item.baseScale * 0.1 +
            driftX * 0.58 - item.wallShadow.position.x) *
          responsiveness;
        item.wallShadow.position.y +=
          (item.basePosition.y - item.baseScale * 0.04 + (driftY + lift) * 0.58 -
            item.wallShadow.position.y) *
          responsiveness;
        item.wallShadow.position.z = -0.82;

        const targetOpacity = portalOpen ? 0.3 : dimmed ? 0.18 : 1;
        item.material.opacity += (targetOpacity - item.material.opacity) * responsiveness;
        const baseWallShadowOpacity = item.scope === "all" ? 0.52 : 0.42;
        const targetWallShadowOpacity = portalOpen ? 0.06 : dimmed ? 0.04 : baseWallShadowOpacity;
        item.wallShadowMaterial.opacity +=
          (targetWallShadowOpacity - item.wallShadowMaterial.opacity) * responsiveness;

        const depthTumbleX = reduceMotion
          ? 0
          : Math.sin(elapsed * 0.56 + item.floatPhase * 0.72) * item.spec.tumbleX;
        const depthTumbleY = reduceMotion
          ? 0
          : Math.cos(elapsed * 0.43 + item.floatPhase * 1.19) * item.spec.tumbleY;
        const tiltZ = reduceMotion
          ? 0
          : Math.sin(elapsed * 0.23 + item.floatPhase * 1.37) * item.spec.floatTilt * 0.55;
        const zAxisRoll = reduceMotion
          ? 0
          : motionElapsed * 1000 * item.spec.rotationSpeed +
            Math.sin(elapsed * 0.31 + item.floatPhase * 0.9) * item.spec.rollSway;
        item.mesh.rotation.set(
          item.spec.rotation[0] + depthTumbleX,
          item.spec.rotation[1] + depthTumbleY,
          item.spec.rotation[2] + tiltZ + zAxisRoll,
        );
      });

      renderer.render(scene, camera);
    }

    function loop(time) {
      animationFrame = 0;
      if (disposed || document.hidden || reduceMotion) return;
      try {
        renderFrame(time);
        animationFrame = requestAnimationFrame(loop);
      } catch (error) {
        useFallback();
      }
    }

    function startLoop() {
      if (!disposed && !reduceMotion && !document.hidden && !animationFrame) {
        animationFrame = requestAnimationFrame(loop);
      }
    }

    const stateObserver = new MutationObserver(syncRoomState);
    stateObserver.observe(root, {
      attributes: true,
      attributeFilter: ["data-explore-state", "data-explore-active-scope"],
    });

    function onVisibilityChange() {
      if (document.hidden && animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = 0;
      } else {
        startLoop();
      }
    }

    function onMotionChange(event) {
      reduceMotion = event.matches;
      if (reduceMotion) {
        if (animationFrame) cancelAnimationFrame(animationFrame);
        animationFrame = 0;
        renderFrame(performance.now());
      } else {
        startLoop();
      }
    }

    function onPageHide(event) {
      if (!event.persisted) {
        dispose();
        return;
      }
      if (animationFrame) cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }

    function onPageShow(event) {
      if (!event.persisted || disposed) return;
      resize();
      syncRoomState();
      renderFrame(performance.now());
      startLoop();
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      if (animationFrame) cancelAnimationFrame(animationFrame);
      stateObserver.disconnect();
      if (resizeObserver) resizeObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      if (reduceMotionQuery.removeEventListener) {
        reduceMotionQuery.removeEventListener("change", onMotionChange);
      } else if (reduceMotionQuery.removeListener) {
        reduceMotionQuery.removeListener(onMotionChange);
      }
      objects.forEach((item) => {
        item.mesh.geometry.dispose();
        item.material.dispose();
        scene.remove(item.wallShadow);
        item.wallShadowMaterial.dispose();
      });
      wallShadowTexture.dispose();
      backWall.geometry.dispose();
      backWallMaterial.dispose();
      renderer.dispose();
      unmountAmbient();
    }

    sceneCanvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      if (animationFrame) cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      useFallback();
    });

    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(root);
    document.addEventListener("visibilitychange", onVisibilityChange);
    if (reduceMotionQuery.addEventListener) {
      reduceMotionQuery.addEventListener("change", onMotionChange);
    } else if (reduceMotionQuery.addListener) {
      reduceMotionQuery.addListener(onMotionChange);
    }
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);

    resize();
    syncRoomState();
    renderFrame(0);
    root.dataset.exploreRenderer = "webgl";
    startLoop();
  } catch (error) {
    useFallback();
    window.addEventListener("pagehide", (event) => {
      if (!event.persisted) unmountAmbient();
    });
  }
}
