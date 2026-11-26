import * as THREE from 'three';

const CHUNK_COUNT = 6;
const HOUSE_COLORS = [0xb9aa96, 0x8eaaa0, 0xa2aabc, 0xb79b89];
const ROOF_COLORS = [0x76515a, 0x536970, 0x676076];
const SHIRT_COLORS = [0x70b4a4, 0xe3ae73, 0xb298c7, 0x85a9ca];
const SKIN_COLORS = [0xe2b78e, 0xb58062, 0xf0cfaa];

// Static instances are uploaded once; only six parent transforms move each frame.
export function createRoadside(nearZ, farZ) {
  const group = new THREE.Group();
  group.name = 'roadside';
  const length = nearZ - farZ;
  const chunkLength = length / CHUNK_COUNT;
  const material = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    flatShading: true,
  });
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const roofGeometry = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4);
  roofGeometry.rotateY(Math.PI / 4);
  const roundGeometry = new THREE.IcosahedronGeometry(1, 0);
  const transform = new THREE.Object3D();
  const color = new THREE.Color();
  const chunks = [];
  let offset = 0;

  function batch(geometry, parts) {
    const mesh = new THREE.InstancedMesh(geometry, material, parts.length);
    parts.forEach((part, index) => {
      transform.position.set(part.x, part.y, part.z);
      transform.scale.set(part.width, part.height, part.depth);
      transform.rotation.set(part.rx, 0, part.rz);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
      mesh.setColorAt(index, color.setHex(part.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.userData.parts = parts;
    return mesh;
  }

  for (let chunkIndex = 0; chunkIndex < CHUNK_COUNT; chunkIndex++) {
    const boxes = [];
    const roofs = [];
    const rounds = [];
    const chunk = new THREE.Group();

    function part(parts, x, y, z, width, height, depth, tint, rx = 0, rz = 0) {
      parts.push({ x, y, z, width, height, depth, color: tint, rx, rz });
    }

    function house(side, x, z, width, height, depth, variant) {
      const roofHeight = 1.2;
      part(
        boxes,
        x,
        height / 2,
        z,
        width,
        height,
        depth,
        HOUSE_COLORS[variant % HOUSE_COLORS.length],
      );
      part(
        roofs,
        x,
        height + roofHeight / 2,
        z,
        width + 0.6,
        roofHeight,
        depth + 0.6,
        ROOF_COLORS[variant % ROOF_COLORS.length],
      );
      part(
        boxes,
        x + side * 0.8,
        height + 0.9,
        z - 0.6,
        0.45,
        1.3,
        0.45,
        0x6d6665,
      );

      // Door and warm windows face the road, on the inner wall of each house.
      const frontX = x - side * (width / 2 + 0.03);
      part(boxes, frontX, 0.8, z, 0.08, 1.6, 0.8, 0x554b4e);
      for (const windowZ of [-depth * 0.3, depth * 0.3]) {
        part(
          boxes,
          frontX,
          height * 0.65,
          z + windowZ,
          0.08,
          0.75,
          0.8,
          0xe8c995,
        );
      }
    }

    function spectator(side, person) {
      const variant = chunkIndex + person + (side > 0 ? 1 : 0);
      const size = 0.9 + (variant % 3) * 0.08;
      const x = side * (6.95 + (person % 2) * 0.3);
      const z = -4 - person * 2.1;
      const skin = SKIN_COLORS[variant % SKIN_COLORS.length];
      part(
        boxes,
        x,
        1.0 * size,
        z,
        0.44 * size,
        0.62 * size,
        0.28 * size,
        SHIRT_COLORS[variant % SHIRT_COLORS.length],
      );
      for (const limb of [-1, 1]) {
        part(
          boxes,
          x + limb * 0.11 * size,
          0.38 * size,
          z,
          0.15 * size,
          0.66 * size,
          0.18 * size,
          0x35465d,
        );
        part(
          boxes,
          x + limb * 0.32 * size,
          1.28 * size,
          z,
          0.13 * size,
          0.56 * size,
          0.14 * size,
          skin,
          0,
          -limb * 0.65,
        );
      }
      part(
        rounds,
        x,
        1.58 * size,
        z,
        0.23 * size,
        0.25 * size,
        0.23 * size,
        skin,
      );
    }

    function powerPole(side, z) {
      const x = side * 8.3;
      part(boxes, x, 3.1, z, 0.18, 6.2, 0.18, 0x8b7b68);
      part(boxes, x, 6.1, z, 1.4, 0.14, 0.18, 0x756b60);
      for (const wireSide of [-1, 1]) {
        const wireX = x + wireSide * 0.48;
        part(boxes, wireX, 6.3, z, 0.14, 0.26, 0.14, 0xb8c5c1);
        const halfSpan = chunkLength / 4;
        const slope = Math.atan2(0.3, halfSpan);
        const wireLength = Math.hypot(halfSpan, 0.3);
        // Two straight segments suggest sagging wire, without curves or physics.
        part(
          boxes,
          wireX,
          6.3,
          z - halfSpan / 2,
          0.025,
          0.025,
          wireLength,
          0x46515a,
          -slope,
        );
        part(
          boxes,
          wireX,
          6.3,
          z - halfSpan * 1.5,
          0.025,
          0.025,
          wireLength,
          0x46515a,
          slope,
        );
      }
    }

    for (const side of [-1, 1]) {
      const variant = chunkIndex + (side > 0 ? 2 : 0);
      // Ground and pavement stay outside the playable road (x = +/-5.4).
      part(
        boxes,
        side * 22.7,
        -0.14,
        -chunkLength / 2,
        34.6,
        0.24,
        chunkLength,
        0x172b26,
      );
      part(
        boxes,
        side * 6.15,
        0.015,
        -chunkLength / 2,
        1.3,
        0.06,
        chunkLength,
        0x3c4948,
      );
      house(
        side,
        side * 11.6,
        -21,
        4.2 + (variant % 2) * 0.8,
        2.8 + (variant % 3) * 0.45,
        4.6,
        variant,
      );
      house(
        side,
        side * 13.2,
        -46,
        5.0,
        3.3 + (variant % 2) * 0.7,
        5.4,
        variant + 1,
      );
      house(side, side * 22, -32, 6.2, 4.4 + (variant % 2), 6, variant + 2);
      for (let person = 0; person < 4; person++) spectator(side, person);
      powerPole(side, -14);
      powerPole(side, -14 - chunkLength / 2);
      part(boxes, side * 17, 0.8, -54, 0.3, 1.6, 0.3, 0x6b5746);
      part(rounds, side * 17, 2.4, -54, 1.25, 1.6, 1.25, 0x396b54);
    }

    chunk.add(
      batch(boxGeometry, boxes),
      batch(roofGeometry, roofs),
      batch(roundGeometry, rounds),
    );
    group.add(chunk);
    chunks.push(chunk);
  }

  function update(distance) {
    offset = (offset + distance) % length;
    for (let index = 0; index < chunks.length; index++) {
      let z = nearZ - index * chunkLength + offset;
      // Recycle behind the camera, before returning the same tile into the fog.
      if (z >= nearZ + chunkLength) z -= length;
      chunks[index].position.z = z;
    }
  }

  function reset() {
    offset = 0;
    update(0);
  }

  reset();
  function setTheme(theme) {
    for (const chunk of chunks) for (const mesh of chunk.children) {
      mesh.userData.parts.forEach((entry, index) => {
        let tint = entry.color;
        if (theme === 'day' && tint === 0x172b26) tint = 0x7fa66a;
        if (theme === 'day' && tint === 0x3c4948) tint = 0xd1c8b5;
        mesh.setColorAt(index, color.setHex(tint));
      });
      mesh.instanceColor.needsUpdate = true;
    }
  }
  return { group, update, reset, setTheme };
}
