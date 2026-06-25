import * as THREE from '../vendor/three.module.js';

const DOOR_NX = 0.735;
const DOOR_NY = 0.505;

export function createParticles(scene, toWorld) {
  const count = 420;
  const positions = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const data = [];

  for (let i = 0; i < count; i++) {
    const particle = resetParticle({}, true, toWorld);
    data.push(particle);
    positions[i * 3] = particle.position.x;
    positions[i * 3 + 1] = particle.position.y;
    positions[i * 3 + 2] = particle.position.z;
    sizes[i] = particle.size;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.PointsMaterial({
    color: 0x020101,
    size: 0.035,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.78,
    depthWrite: false
  });

  const points = new THREE.Points(geometry, material);
  scene.add(points);

  function update(delta, pulling = false) {
    const attr = geometry.getAttribute('position');
    for (let i = 0; i < count; i++) {
      const particle = data[i];
      if (pulling) {
        const door = toWorld(DOOR_NX, DOOR_NY, 0.2);
        particle.velocity.z += delta * 0.9;
        particle.velocity.x += (door.x - particle.position.x) * delta * 0.4;
        particle.velocity.y += (door.y - particle.position.y) * delta * 0.35;
      }
      particle.age += delta;
      particle.position.addScaledVector(particle.velocity, delta);
      particle.position.x += Math.sin(particle.age * 1.7 + particle.seed) * delta * 0.045;
      particle.position.y += Math.cos(particle.age * 1.3 + particle.seed) * delta * 0.025;
      const floor = toWorld(0.5, 0.79, 0);
      if (particle.position.y < floor.y) {
        particle.position.y = floor.y;
        particle.velocity.multiplyScalar(0.52);
      }
      if (particle.age > particle.life || particle.position.z > 4.8) resetParticle(particle, false, toWorld);
      attr.setXYZ(i, particle.position.x, particle.position.y, particle.position.z);
    }
    attr.needsUpdate = true;
  }

  function burst(origin, amount = 170) {
    for (let i = 0; i < Math.min(amount, data.length); i++) {
      const particle = data[i];
      particle.position.copy(origin);
      particle.velocity.set(
        (Math.random() - 0.5) * 2.6,
        (Math.random() - 0.5) * 2.1,
        0.65 + Math.random() * 2.2
      );
      particle.life = 1.8 + Math.random() * 1.9;
      particle.age = 0;
    }
  }

  return { points, update, burst };
}

function resetParticle(particle, spread, toWorld) {
  const low = spread ? 1 : 0;
  const origin = toWorld(DOOR_NX - 0.055 + (Math.random() - 0.5) * 0.08, 0.585 + Math.random() * 0.11, 0.08);
  particle.position = particle.position || new THREE.Vector3();
  particle.velocity = particle.velocity || new THREE.Vector3();
  particle.position.copy(origin);
  particle.velocity.set(
    -0.18 - Math.random() * 0.32,
    -0.02 + Math.random() * 0.14,
    0.08 + Math.random() * 0.16
  );
  particle.age = Math.random() * low;
  particle.life = 3.5 + Math.random() * 4.2;
  particle.seed = Math.random() * Math.PI * 2;
  particle.size = 0.6 + Math.random() * 1.8;
  return particle;
}
