import * as THREE from '../vendor/three.module.js';

const SOCKET_POINTS = [
  [0.692, 0.183],
  [0.752, 0.181],
  [0.692, 0.263],
  [0.752, 0.261],
  [0.693, 0.343],
  [0.752, 0.341]
];

export function createSockets(scene, materials, toWorld) {
  const group = new THREE.Group();
  const sockets = [];

  SOCKET_POINTS.forEach(([nx, ny], index) => {
      const position = toWorld(nx, ny, 0.035);

      const socketGroup = new THREE.Group();
      socketGroup.position.copy(position);

      const shadow = new THREE.Mesh(
        new THREE.CircleGeometry(0.22, 40),
        new THREE.MeshBasicMaterial({ color: 0x050403, transparent: true, opacity: 0.05 })
      );
      shadow.position.set(0.035, -0.035, -0.009);
      socketGroup.add(shadow);

      const recess = new THREE.Mesh(
        new THREE.CircleGeometry(0.18, 40),
        new THREE.MeshBasicMaterial({ color: 0x050403, transparent: true, opacity: 0.03 })
      );
      socketGroup.add(recess);

      const hollow = new THREE.Mesh(
        new THREE.CircleGeometry(0.116, 36),
        new THREE.MeshBasicMaterial({ color: 0x050403, transparent: true, opacity: 0.01 })
      );
      hollow.position.z = 0.006;
      socketGroup.add(hollow);

      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(0.17, 0.015, 9, 48),
        new THREE.MeshBasicMaterial({ color: 0x050403, transparent: true, opacity: 0.01 })
      );
      rim.position.z = 0.018;
      socketGroup.add(rim);

      group.add(socketGroup);
      sockets.push({ index, position, filledBy: null, group: socketGroup, hollow });
  });

  scene.add(group);
  return sockets;
}

export function createActivationSeal(scene, materials, sockets) {
  const center = sockets.reduce((acc, socket) => acc.add(socket.position), new THREE.Vector3()).multiplyScalar(1 / sockets.length);
  const group = new THREE.Group();
  group.position.set(center.x, center.y, center.z + 0.08);
  group.visible = false;

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.78, 0.045, 16, 96),
    materials.redStone
  );
  ring.scale.y = 1.04;
  group.add(ring);

  const backing = new THREE.Mesh(
    new THREE.CylinderGeometry(0.86, 0.86, 0.24, 80),
    materials.redStone
  );
  backing.rotation.x = Math.PI / 2;
  backing.position.z = -0.04;
  backing.visible = false;
  group.add(backing);

  scene.add(group);
  return { group, ring, backing, center };
}
