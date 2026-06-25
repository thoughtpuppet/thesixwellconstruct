import * as THREE from '../vendor/three.module.js';

function makeNoiseTexture() {
  const size = 192;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const grain = 190 + Math.random() * 45;
      const wave = Math.sin((x + y * 1.8) * 0.06) * 14;
      image.data[i] = grain + wave;
      image.data[i + 1] = grain * 0.83 + wave;
      image.data[i + 2] = grain * 0.58;
      image.data[i + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2.8, 2.8);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createMaterials() {
  const plasterMap = makeNoiseTexture();

  const plaster = new THREE.MeshStandardMaterial({
    color: 0xd8ad72,
    map: plasterMap,
    roughness: 0.96,
    metalness: 0.0
  });

  const shadowPlaster = new THREE.MeshStandardMaterial({
    color: 0xc49056,
    map: plasterMap,
    roughness: 0.98
  });

  const voidBlack = new THREE.MeshBasicMaterial({
    color: 0x010101,
    side: THREE.DoubleSide
  });

  const ink = new THREE.MeshStandardMaterial({
    color: 0x050403,
    roughness: 0.82,
    metalness: 0.02
  });

  const redStone = new THREE.MeshStandardMaterial({
    color: 0x9d0907,
    roughness: 0.92,
    metalness: 0.0
  });

  return { plaster, shadowPlaster, voidBlack, ink, redStone };
}
