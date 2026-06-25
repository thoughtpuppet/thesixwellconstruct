import * as THREE from '../vendor/three.module.js';

const TOKEN_SEEDS = [
  [0.118, 0.232, 0.18],
  [0.365, 0.225, 0.18],
  [0.246, 0.398, 0.18],
  [0.119, 0.541, 0.18],
  [0.295, 0.700, 0.18],
  [0.816, 0.780, 0.18]
];

export function createTokens(scene, materials, toWorld) {
  const tokens = TOKEN_SEEDS.map(([nx, ny, z], index) => {
    const radius = index === 5 ? 0.46 : index === 2 ? 0.23 : 0.2;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 32, 24),
      materials.ink.clone()
    );
    mesh.position.copy(toWorld(nx, ny, z));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.tokenIndex = index;
    scene.add(mesh);

    return {
      index,
      mesh,
      radius,
      base: mesh.position.clone(),
      normalizedBase: [nx, ny, z],
      velocity: new THREE.Vector3((Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.045, 0),
      phase: Math.random() * Math.PI * 2,
      socket: null,
      dragging: false
    };
  });

  return tokens;
}

export function updateTokens(tokens, elapsed, delta, completed) {
  tokens.forEach((token) => {
    if (token.dragging || token.socket) return;
    token.phase += delta * 0.62;
    const drift = new THREE.Vector3(
      Math.sin(token.phase * 0.7 + token.index) * 0.09,
      Math.cos(token.phase * 0.53 + token.index * 1.4) * 0.065,
      Math.sin(token.phase * 0.4) * 0.025
    );
    token.mesh.position.lerp(token.base.clone().add(drift), completed ? 0.004 : 0.012);
    token.mesh.rotation.y += delta * 0.12;
    token.mesh.rotation.x += delta * 0.05;
  });
}

export function setTokensRed(tokens, redStoneMaterial) {
  tokens.forEach((token) => {
    token.mesh.material = redStoneMaterial;
  });
}
