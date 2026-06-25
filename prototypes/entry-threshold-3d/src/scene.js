import * as THREE from '../vendor/three.module.js';

export function createScene(canvas) {
  const scene = new THREE.Scene();

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const viewport = { width: 10, height: 10 };
  const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 50);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);

  const ambient = new THREE.HemisphereLight(0xf6ddad, 0x2a160c, 2.2);
  scene.add(ambient);

  const warmKey = new THREE.PointLight(0xffc276, 7.5, 18, 1.85);
  warmKey.position.set(-3, 3.4, 6);
  warmKey.castShadow = true;
  scene.add(warmKey);

  const lowFill = new THREE.PointLight(0x7d3f18, 1.8, 14, 2);
  lowFill.position.set(3.4, -2.6, 5);
  scene.add(lowFill);

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const width = rect.width || window.innerWidth;
    const height = rect.height || window.innerHeight;
    viewport.height = 10;
    viewport.width = viewport.height * (width / Math.max(1, height));
    camera.left = -viewport.width / 2;
    camera.right = viewport.width / 2;
    camera.top = viewport.height / 2;
    camera.bottom = -viewport.height / 2;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  function toWorld(nx, ny, z = 0) {
    return new THREE.Vector3((nx - 0.5) * viewport.width, (0.5 - ny) * viewport.height, z);
  }

  resize();
  window.addEventListener('resize', resize);

  return { scene, renderer, camera, resize, viewport, toWorld };
}
