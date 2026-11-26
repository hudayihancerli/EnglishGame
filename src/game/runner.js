import * as THREE from 'three';
import { QUESTIONS } from './questions.js';
import { createRoadside } from './roadside.js';
import { DIFFICULTIES, normalizeDifficulty, WORLD_THEMES } from './settings.js';

const LANE_X = [-3.6, -1.2, 1.2, 3.6];
const LANE_LETTERS = ['A', 'B', 'C', 'D'];
const LANE_COLORS = ['#ef4444', '#3b82f6', '#f59e0b', '#a855f7'];
const LANE_COLOR_HEX = [0xef4444, 0x3b82f6, 0xf59e0b, 0xa855f7];
const BASE_SPEED = 14;
const START_SPEED_MULT = 1.0;
const MIN_SPEED_MULT = 0.55;
let difficulty = 'normal';
let speedProfile = DIFFICULTIES.normal;
const GATE_SPAWN_Z = -68;
const GATE_SPACING = 62;
const TOTAL_QUESTIONS = 30;
const CAMERA_FOV = 46;
const CAMERA_PITCH = Math.atan(0.92 * Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2)));
const RUNNER_SCREEN_Y = 0.85;
const PLAYER_VIEW_HALF_WIDTH = 4.8;
const ROAD_HALF_WIDTH = 5.3;
const TRACK_NEAR_Z = 18;
const TRACK_FAR_Z = -330;
const TRACK_LENGTH = TRACK_NEAR_Z - TRACK_FAR_Z;
const TRACK_CENTER_Z = (TRACK_NEAR_Z + TRACK_FAR_Z) / 2;
const DASH_SPACING = 6;

let gameActive = false;
let myFinished = false;
let speedMult = START_SPEED_MULT;
let score = 0;
let streak = 0;
let currentLane = 1;
let targetX = LANE_X[currentLane];
let myDistance = 0;
let myPlayerId = null;
let myColorHex = '#38bdf8';
let ws = null;
let startTimeMs = 0;

let gameQuestions = [];
let spawnedCount = 0;
let passedCount = 0;
let finishLineGroup = null;
let finishLineActive = false;
let finishBannerTex = null;
let finalHudTimer = 0;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickRandomQuestions(arr, seed, count) {
  const rng = mulberry32(seed);
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count).map((item) => {
    const indices = [0, 1, 2, 3];
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    return {
      q: item.q,
      options: indices.map((idx) => item.options[idx]),
      correct: indices.indexOf(item.correct),
    };
  });
}

function sendToRN(payload) {
  if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
    window.ReactNativeWebView.postMessage(JSON.stringify(payload));
  }
}

// --- Scene Setup ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1020);
scene.fog = new THREE.FogExp2(0x0b1020, 0.0035);

const camera = new THREE.PerspectiveCamera(
  CAMERA_FOV,
  window.innerWidth / window.innerHeight,
  0.1,
  380
);

function configureCamera() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.fov = CAMERA_FOV;
  const halfFov = THREE.MathUtils.degToRad(CAMERA_FOV / 2);
  // Frame the four lanes at the player's feet, rather than at the screen bottom.
  const depth = Math.max(13, PLAYER_VIEW_HALF_WIDTH / (Math.tan(halfFov) * camera.aspect));
  const verticalOffset = (RUNNER_SCREEN_Y * 2 - 1) * Math.tan(halfFov);
  const height = depth * (Math.sin(CAMERA_PITCH) + verticalOffset * Math.cos(CAMERA_PITCH));
  const distance = depth * (Math.cos(CAMERA_PITCH) - verticalOffset * Math.sin(CAMERA_PITCH));
  camera.position.set(0, height, distance);
  camera.rotation.set(-CAMERA_PITCH, 0, 0);
  camera.far = Math.max(380, distance - TRACK_FAR_Z + 30);
  camera.updateProjectionMatrix();
}

configureCamera();

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.shadowMap.enabled = false;
document.body.appendChild(renderer.domElement);

// Four screen-space columns describe the tap targets, independently of road perspective.
const touchLaneGuide = document.createElement('div');
touchLaneGuide.className = 'touch-lane-guide';
touchLaneGuide.setAttribute('aria-hidden', 'true');
document.body.appendChild(touchLaneGuide);

function showTouchLaneGuide() {
  touchLaneGuide.replaceChildren();
  const flash = document.createElement('div');
  flash.className = 'touch-lane-flash';
  for (const color of LANE_COLORS) {
    const lane = document.createElement('div');
    lane.style.backgroundColor = color;
    flash.appendChild(lane);
  }
  flash.addEventListener('animationend', () => flash.remove(), { once: true });
  touchLaneGuide.appendChild(flash);
}

// --- Lighting ---
const ambientLight = new THREE.AmbientLight(0xdbeafe, 0.95);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.3);
dirLight.position.set(8, 18, 12);
scene.add(dirLight);

const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.7);
rimLight.position.set(-10, 6, -15);
scene.add(rimLight);

// --- Track & Environment ---
const trackGroup = new THREE.Group();
scene.add(trackGroup);

const roadGeo = new THREE.PlaneGeometry(10.8, TRACK_LENGTH);
const roadMat = new THREE.MeshStandardMaterial({
  color: 0x151c32,
  roughness: 0.75,
  metalness: 0.15,
});
const road = new THREE.Mesh(roadGeo, roadMat);
road.rotation.x = -Math.PI / 2;
road.position.z = TRACK_CENTER_Z;
trackGroup.add(road);

// Colored lane strips for A, B, C, D
const laneStripGeo = new THREE.PlaneGeometry(2.15, TRACK_LENGTH);
for (let i = 0; i < 4; i++) {
  const stripMat = new THREE.MeshBasicMaterial({
    color: LANE_COLOR_HEX[i],
    transparent: true,
    opacity: 0.16,
  });
  const strip = new THREE.Mesh(laneStripGeo, stripMat);
  strip.rotation.x = -Math.PI / 2;
  strip.position.set(LANE_X[i], 0.01, TRACK_CENTER_Z);
  trackGroup.add(strip);
}

const railGeo = new THREE.BoxGeometry(0.22, 0.4, TRACK_LENGTH);
const railMat = new THREE.MeshStandardMaterial({
  color: 0x38bdf8,
  emissive: 0x0284c7,
  emissiveIntensity: 0.8,
});
const leftRail = new THREE.Mesh(railGeo, railMat);
leftRail.position.set(-ROAD_HALF_WIDTH, 0.2, TRACK_CENTER_Z);
const rightRail = new THREE.Mesh(railGeo, railMat);
rightRail.position.set(ROAD_HALF_WIDTH, 0.2, TRACK_CENTER_Z);
trackGroup.add(leftRail, rightRail);

const dashGeo = new THREE.BoxGeometry(0.1, 0.02, 2.4);
const dashMat = new THREE.MeshBasicMaterial({ color: 0x475569 });
const dividerXs = [-2.4, 0, 2.4];
const dashRows = Math.ceil(TRACK_LENGTH / DASH_SPACING);
const dashes = new THREE.InstancedMesh(dashGeo, dashMat, dashRows * dividerXs.length);
const dashMatrix = new THREE.Matrix4();
let dashIndex = 0;

for (let row = 0; row < dashRows; row++) {
  const z = TRACK_NEAR_Z - row * DASH_SPACING;
  for (const x of dividerXs) {
    dashMatrix.makeTranslation(x, 0.02, z);
    dashes.setMatrixAt(dashIndex++, dashMatrix);
  }
}
dashes.instanceMatrix.needsUpdate = true;
dashes.computeBoundingSphere();
trackGroup.add(dashes);

const roadside = createRoadside(TRACK_NEAR_Z, TRACK_FAR_Z);
scene.add(roadside.group);

// Day decorations use two draw calls and no additional lights or shadows.
let activeTheme = 'day';
const skyGroup = new THREE.Group();
camera.add(skyGroup);
scene.add(camera);
const sun = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffdb70, fog: false }));
skyGroup.add(sun);
const clouds = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), 9);
skyGroup.add(clouds);
function positionSky() {
  // The horizon is at y = 0.92 in camera screen space. Keep the decorations above it
  // and near the far plane, so scenery occludes them naturally.
  const depth = camera.far - 8;
  const spread = depth * Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2));
  const width = spread * camera.aspect;
  sun.position.set(-width * 0.68, spread * 0.963, -depth);
  sun.scale.setScalar(spread * 0.029);
  const matrix = new THREE.Object3D();
  for (let i = 0; i < 9; i++) {
    const cluster = Math.floor(i / 3);
    const puff = i % 3;
    matrix.position.set(
      width * (-0.28 + cluster * 0.48 + (puff - 1) * 0.065),
      spread * (0.957 + cluster * 0.01 + (puff === 1 ? 0.008 : 0)),
      -depth,
    );
    matrix.scale.set(width * 0.07, spread * (puff === 1 ? 0.013 : 0.009), 0.5);
    matrix.updateMatrix();
    clouds.setMatrixAt(i, matrix.matrix);
  }
  clouds.instanceMatrix.needsUpdate = true;
  clouds.computeBoundingSphere();
}
function applyTheme(value) {
  activeTheme = value === 'night' ? 'night' : 'day';
  const palette = WORLD_THEMES[activeTheme];
  scene.background.setHex(palette.sky);
  scene.fog.color.setHex(palette.sky);
  roadMat.color.setHex(palette.road);
  dashMat.color.setHex(palette.dash);
  railMat.color.setHex(palette.rail);
  railMat.emissive.setHex(palette.emissive);
  ambientLight.color.setHex(palette.ambient);
  ambientLight.intensity = palette.intensity;
  rimLight.intensity = activeTheme === 'day' ? 0.2 : 0.7;
  dirLight.intensity = activeTheme === 'day' ? 1.0 : 1.3;
  roadside.setTheme(activeTheme);
  skyGroup.visible = activeTheme === 'day';
}
positionSky();
applyTheme('day');

// --- Name Tag Sprite ---
function createNameSprite(name, colorHex) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
  ctx.fillRect(8, 8, 240, 48);
  ctx.strokeStyle = colorHex;
  ctx.lineWidth = 4;
  ctx.strokeRect(8, 8, 240, 48);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(name || '').slice(0, 12), 128, 33);

  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.8, 0.45, 1);
  sprite.position.set(0, 2.85, 0);
  return { sprite, tex };
}

// --- 3D Runner Builder ---
function createRunnerMesh(colorStr, labelName) {
  const group = new THREE.Group();
  group.scale.setScalar(1.4);
  const colorVal = new THREE.Color(colorStr || '#38bdf8');

  const bodyMat = new THREE.MeshStandardMaterial({ color: colorVal, roughness: 0.35, metalness: 0.2 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xfef08a, roughness: 0.4 });
  const limbMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.45 });
  const shoeMat = new THREE.MeshStandardMaterial({ color: colorVal, emissive: colorVal, emissiveIntensity: 0.35 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.92, 0.38), bodyMat);
  torso.position.y = 1.45;
  torso.castShadow = true;
  group.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 16), headMat);
  head.position.y = 2.18;
  head.castShadow = true;
  group.add(head);

  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.38, 0.14, 0.16),
    new THREE.MeshBasicMaterial({ color: 0x0f172a })
  );
  visor.position.set(0, 2.2, -0.22);
  group.add(visor);

  const leftArmPivot = new THREE.Group();
  leftArmPivot.position.set(-0.46, 1.8, 0);
  const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.72, 0.2), limbMat);
  leftArm.position.y = -0.32;
  leftArm.castShadow = true;
  leftArmPivot.add(leftArm);
  group.add(leftArmPivot);

  const rightArmPivot = new THREE.Group();
  rightArmPivot.position.set(0.46, 1.8, 0);
  const rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.72, 0.2), limbMat);
  rightArm.position.y = -0.32;
  rightArm.castShadow = true;
  rightArmPivot.add(rightArm);
  group.add(rightArmPivot);

  const leftLegPivot = new THREE.Group();
  leftLegPivot.position.set(-0.2, 0.98, 0);
  const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.85, 0.24), limbMat);
  leftLeg.position.y = -0.42;
  leftLeg.castShadow = true;
  const leftShoe = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.18, 0.36), shoeMat);
  leftShoe.position.set(0, -0.84, -0.06);
  leftLegPivot.add(leftLeg, leftShoe);
  group.add(leftLegPivot);

  const rightLegPivot = new THREE.Group();
  rightLegPivot.position.set(0.2, 0.98, 0);
  const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.85, 0.24), limbMat);
  rightLeg.position.y = -0.42;
  rightLeg.castShadow = true;
  const rightShoe = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.18, 0.36), shoeMat);
  rightShoe.position.set(0, -0.84, -0.06);
  rightLegPivot.add(rightLeg, rightShoe);
  group.add(rightLegPivot);

  let nameTagTex = null;
  if (labelName) {
    const { sprite, tex } = createNameSprite(labelName, colorStr || '#38bdf8');
    nameTagTex = tex;
    group.add(sprite);
  }

  return {
    group,
    leftArmPivot,
    rightArmPivot,
    leftLegPivot,
    rightLegPivot,
    setColor(newColorStr) {
      const c = new THREE.Color(newColorStr);
      bodyMat.color.copy(c);
      shoeMat.color.copy(c);
      shoeMat.emissive.copy(c);
    },
    dispose() {
      if (nameTagTex) nameTagTex.dispose();
    },
  };
}

function animateRunnerLimbs(runner, phase) {
  const swing = Math.sin(phase) * 0.85;
  runner.leftLegPivot.rotation.x = swing;
  runner.rightLegPivot.rotation.x = -swing;
  runner.leftArmPivot.rotation.x = -swing * 0.8;
  runner.rightArmPivot.rotation.x = swing * 0.8;
  runner.group.position.y = Math.abs(Math.cos(phase)) * 0.14;
}

const myRunner = createRunnerMesh(myColorHex, null);
myRunner.group.position.set(targetX, 0, 0);
scene.add(myRunner.group);

const remotePlayers = new Map();

function clearRemotePlayers() {
  for (const remote of remotePlayers.values()) {
    scene.remove(remote.mesh.group);
    remote.mesh.dispose();
  }
  remotePlayers.clear();
}

function updateRemotePlayersFromServer(playersList) {
  const activeIds = new Set();

  for (const p of playersList) {
    if (p.id === myPlayerId) continue;
    activeIds.add(p.id);

    let remote = remotePlayers.get(p.id);
    if (!remote) {
      const mesh = createRunnerMesh(p.color || '#fb923c', p.name || `Oyuncu ${p.id}`);
      mesh.group.position.set(p.x ?? -1.2, 0, 0);
      scene.add(mesh.group);
      remote = {
        id: p.id,
        name: p.name || `Oyuncu ${p.id}`,
        color: p.color || '#fb923c',
        mesh,
        targetX: p.x ?? -1.2,
        targetDistance: p.distance ?? 0,
        currentDistance: p.distance ?? 0,
        speedMult: p.speedMult ?? 1.0,
        score: p.score ?? 0,
        finished: Boolean(p.finished),
        phase: 0,
      };
      remotePlayers.set(p.id, remote);
    } else {
      remote.targetX = p.x ?? remote.targetX;
      remote.targetDistance = p.distance ?? remote.targetDistance;
      remote.speedMult = p.speedMult ?? remote.speedMult;
      remote.score = p.score ?? remote.score;
      remote.finished = Boolean(p.finished);
      if (p.color && p.color !== remote.color) {
        remote.color = p.color;
        remote.mesh.setColor(p.color);
      }
    }
  }

  for (const [id, remote] of remotePlayers.entries()) {
    if (!activeIds.has(id)) {
      scene.remove(remote.mesh.group);
      remote.mesh.dispose();
      remotePlayers.delete(id);
    }
  }
}

// --- Particle Burst System ---
const particles = [];
const particleGeo = new THREE.BoxGeometry(0.16, 0.16, 0.16);

function spawnBurst(x, y, z, colorHex) {
  const mat = new THREE.MeshBasicMaterial({ color: colorHex });
  for (let i = 0; i < 18; i++) {
    const p = new THREE.Mesh(particleGeo, mat);
    p.position.set(x, y, z);
    p.userData = {
      vx: (Math.random() - 0.5) * 9,
      vy: Math.random() * 6 + 2,
      vz: (Math.random() - 0.5) * 6,
      life: 0.75,
    };
    scene.add(p);
    particles.push(p);
  }
}

// --- Large, Crisp Gate Texture Builder ---
function createOptionTexture(text, accentColor) {
  const canvas = document.createElement('canvas');
  // Match the sign's 2.3:1.9 aspect ratio and draw at double resolution.
  canvas.width = 1024;
  canvas.height = 848;
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2);
  ctx.fillStyle = '#090f22';
  ctx.fillRect(0, 0, 512, 424);
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 12;
  ctx.strokeRect(6, 6, 500, 412);
  ctx.fillStyle = accentColor;
  ctx.fillRect(12, 12, 488, 18);

  const words = String(text).trim().split(/\s+/);
  let lines = [];
  let fontSize = 88;
  for (; fontSize >= 24; fontSize -= 2) {
    ctx.font = `bold ${fontSize}px sans-serif`;
    lines = [];
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(candidate).width > 448) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
    if (lines.every(value => ctx.measureText(value).width <= 448) &&
        lines.length * (fontSize + 12) <= 320) break;
  }
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lineHeight = fontSize + 12;
  const startY = 228 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, index) => ctx.fillText(line, 256, startY + index * lineHeight, 448));

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return texture;
}

// --- Gate Row Spawner ---
const gateRows = [];

function clearGateRows() {
  for (const row of gateRows) {
    scene.remove(row.group);
    row.gates.forEach((g) => g.signTex.dispose());
  }
  gateRows.length = 0;
}

function spawnNextGateRow(zPos) {
  if (spawnedCount >= TOTAL_QUESTIONS) return null;
  const questionData = gameQuestions[spawnedCount];
  spawnedCount++;

  const rowGroup = new THREE.Group();
  rowGroup.position.z = zPos;

  const gates = [];
  const pillarGeo = new THREE.BoxGeometry(0.16, 3.6, 0.16);
  const archGeo = new THREE.BoxGeometry(2.3, 0.18, 0.2);
  const panelGeo = new THREE.PlaneGeometry(2.05, 3.0);
  const signGeo = new THREE.PlaneGeometry(2.3, 1.9);

  for (let i = 0; i < 4; i++) {
    const gateGroup = new THREE.Group();
    gateGroup.position.x = LANE_X[i];

    const laneColorHex = LANE_COLOR_HEX[i];
    const pillarMat = new THREE.MeshStandardMaterial({
      color: laneColorHex,
      emissive: laneColorHex,
      emissiveIntensity: 0.45,
    });
    const leftPillar = new THREE.Mesh(pillarGeo, pillarMat);
    leftPillar.position.set(-1.08, 1.8, 0);
    const rightPillar = new THREE.Mesh(pillarGeo, pillarMat);
    rightPillar.position.set(1.08, 1.8, 0);
    const arch = new THREE.Mesh(archGeo, pillarMat);
    arch.position.set(0, 3.6, 0);

    const panelMat = new THREE.MeshBasicMaterial({
      color: laneColorHex,
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide,
    });
    const panel = new THREE.Mesh(panelGeo, panelMat);
    panel.position.set(0, 1.5, 0);

    const signTex = createOptionTexture(questionData.options[i], LANE_COLORS[i]);
    const signMat = new THREE.MeshBasicMaterial({ map: signTex, side: THREE.DoubleSide, toneMapped: false });
    const sign = new THREE.Mesh(signGeo, signMat);
    sign.position.set(0, 2.7, 0.14);

    gateGroup.add(leftPillar, rightPillar, arch, panel, sign);
    rowGroup.add(gateGroup);
    gates.push({ panelMat, pillarMat, signTex });
  }

  scene.add(rowGroup);
  const rowObj = {
    group: rowGroup,
    questionData,
    gates,
    passed: false,
  };
  gateRows.push(rowObj);
  return rowObj;
}

function clearFinishLine() {
  if (finishLineGroup) {
    scene.remove(finishLineGroup);
    finishLineGroup = null;
  }
  if (finishBannerTex) {
    finishBannerTex.dispose();
    finishBannerTex = null;
  }
  finishLineActive = false;
}

function spawnFinishLine(zPos) {
  clearFinishLine();
  const group = new THREE.Group();
  group.position.z = zPos;

  const pillarMat = new THREE.MeshStandardMaterial({
    color: 0xfacc15,
    emissive: 0xca8a04,
    emissiveIntensity: 0.7,
  });
  const pillarGeo = new THREE.BoxGeometry(0.32, 4.6, 0.32);
  const leftP = new THREE.Mesh(pillarGeo, pillarMat);
  leftP.position.set(-5.0, 2.3, 0);
  const rightP = new THREE.Mesh(pillarGeo, pillarMat);
  rightP.position.set(5.0, 2.3, 0);
  group.add(leftP, rightP);

  // Checkered floor strip
  const checkCanvas = document.createElement('canvas');
  checkCanvas.width = 512;
  checkCanvas.height = 64;
  const cctx = checkCanvas.getContext('2d');
  const sq = 32;
  for (let y = 0; y < 64; y += sq) {
    for (let x = 0; x < 512; x += sq) {
      cctx.fillStyle = ((x / sq + y / sq) % 2 === 0) ? '#ffffff' : '#0f172a';
      cctx.fillRect(x, y, sq, sq);
    }
  }
  const checkTex = new THREE.CanvasTexture(checkCanvas);
  const floorStrip = new THREE.Mesh(
    new THREE.PlaneGeometry(10.4, 1.5),
    new THREE.MeshBasicMaterial({ map: checkTex, side: THREE.DoubleSide })
  );
  floorStrip.rotation.x = -Math.PI / 2;
  floorStrip.position.y = 0.03;
  group.add(floorStrip);

  // Top FİNAL banner
  const bCanvas = document.createElement('canvas');
  bCanvas.width = 512;
  bCanvas.height = 128;
  const bctx = bCanvas.getContext('2d');
  bctx.fillStyle = '#0f172a';
  bctx.fillRect(0, 0, 512, 128);
  bctx.strokeStyle = '#facc15';
  bctx.lineWidth = 10;
  bctx.strokeRect(5, 5, 502, 118);
  bctx.fillStyle = '#facc15';
  bctx.font = 'bold 74px sans-serif';
  bctx.textAlign = 'center';
  bctx.textBaseline = 'middle';
  bctx.fillText('FİNAL', 256, 66);

  finishBannerTex = new THREE.CanvasTexture(bCanvas);
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(10.2, 2.0),
    new THREE.MeshBasicMaterial({ map: finishBannerTex, side: THREE.DoubleSide })
  );
  banner.position.set(0, 3.8, 0);
  group.add(banner);

  scene.add(group);
  finishLineGroup = group;
  finishLineActive = true;
}

function resetAndStartGame(seed, selectedDifficulty = 'normal') {
  difficulty = normalizeDifficulty(selectedDifficulty);
  speedProfile = DIFFICULTIES[difficulty];
  activePointer = null;
  roadside.reset();
  dashes.position.z = 0;
  clearGateRows();
  clearFinishLine();
  gameQuestions = pickRandomQuestions(QUESTIONS, seed, TOTAL_QUESTIONS);
  spawnedCount = 0;
  passedCount = 0;
  speedMult = START_SPEED_MULT;
  score = 0;
  streak = 0;
  myDistance = 0;
  myFinished = false;
  currentLane = 1;
  targetX = LANE_X[currentLane];
  myRunner.group.position.set(targetX, 0, 0);
  myRunner.group.rotation.z = 0;
  startTimeMs = performance.now();

  for (const remote of remotePlayers.values()) {
    remote.currentDistance = 0;
    remote.targetDistance = 0;
    remote.finished = false;
    remote.score = 0;
  }

  const firstRow = spawnNextGateRow(GATE_SPAWN_Z);
  spawnNextGateRow(GATE_SPAWN_Z - GATE_SPACING);
  gameActive = true;
  showTouchLaneGuide();

  sendToRN({
    type: 'GAME_STARTED',
    difficulty,
    question: firstRow ? firstRow.questionData.q : '',
    options: firstRow ? firstRow.questionData.options : [],
    questionNum: 1,
    totalQuestions: TOTAL_QUESTIONS,
    speedMult,
    score,
    streak,
    playerCount: remotePlayers.size + 1,
  });
}

// --- Multiplayer WebSocket Connection ---
function leaveRoom() {
  if (ws) {
    ws.onmessage = null;
    ws.onopen = null;
    ws.onerror = null;
    try { ws.close(); } catch {}
    ws = null;
  }
  clearRemotePlayers();
  myPlayerId = null;
}

function connectToRoom(serverUrl, code, name, color) {
  leaveRoom();
  myColorHex = color || '#38bdf8';
  myRunner.setColor(myColorHex);

  let url = (serverUrl || 'wss://multi.hudayi.space').trim();
  if (url.startsWith('https://')) url = 'wss://' + url.slice(8);
  else if (url.startsWith('http://')) url = 'ws://' + url.slice(7);
  else if (!url.startsWith('ws://') && !url.startsWith('wss://')) url = 'wss://' + url;

  try {
    ws = new WebSocket(url);
  } catch {
    sendToRN({ type: 'ERROR', message: 'Geçersiz sunucu adresi.' });
    return;
  }

  const socket = ws;
  const timeout = setTimeout(() => {
    if (ws === socket && socket.readyState !== 1) {
      try { socket.close(); } catch {}
      sendToRN({ type: 'ERROR', message: 'Sunucuya bağlanılamadı (zaman aşımı).' });
    }
  }, 8000);

  socket.onopen = () => {
    clearTimeout(timeout);
    socket.send(JSON.stringify({
      type: 'JOIN',
      code: code || '1234',
      name: name || 'Oyuncu',
      color: myColorHex,
    }));
  };

  socket.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'WELCOME') {
        myPlayerId = msg.playerId;
        sendToRN({
          type: 'LOBBY',
          code: msg.code,
          status: msg.status,
          hostId: msg.hostId,
          difficulty: msg.difficulty,
          players: msg.players || [],
          myPlayerId,
        });
        if (msg.status === 'PLAYING') {
          resetAndStartGame(msg.seed || 42, msg.difficulty);
        }
      } else if (msg.type === 'LOBBY_UPDATE') {
        if (msg.status === 'PLAYING') return;
        gameActive = false;
        touchLaneGuide.replaceChildren();
        myFinished = false;
        activePointer = null;
        clearGateRows();
        sendToRN({
          type: 'LOBBY',
          code: msg.code,
          status: msg.status,
          hostId: msg.hostId,
          difficulty: msg.difficulty,
          players: msg.players || [],
          myPlayerId,
        });
      } else if (msg.type === 'GAME_START') {
        resetAndStartGame(msg.seed || 42, msg.difficulty);
      } else if (msg.type === 'PLAYERS') {
        updateRemotePlayersFromServer(msg.players || []);
      } else if (msg.type === 'RANKINGS') {
        sendToRN({ type: 'RANKINGS', rankings: msg.rankings || [], myPlayerId });
      }
    } catch {}
  };

  socket.onerror = () => {
    clearTimeout(timeout);
    sendToRN({ type: 'ERROR', message: 'Bağlantı hatası! Sunucu adresini kontrol edin.' });
  };

  socket.onclose = () => {
    clearTimeout(timeout);
  };
}

function handleRNMessage(event) {
  try {
    const msg = JSON.parse(event.data);
    if (msg.type === 'SET_THEME') {
      applyTheme(msg.theme);
    } else if (msg.type === 'JOIN') {
      connectToRoom(msg.serverUrl, msg.code, msg.name, msg.color);
    } else if (msg.type === 'LEAVE_ROOM') {
      leaveRoom();
    } else if (msg.type === 'SET_DIFFICULTY') {
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'SET_DIFFICULTY', difficulty: normalizeDifficulty(msg.difficulty) }));
      }
    } else if (msg.type === 'START_GAME') {
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'START_GAME',
          difficulty: typeof msg.difficulty === 'string' ? normalizeDifficulty(msg.difficulty) : undefined,
        }));
      }
    } else if (msg.type === 'BACK_TO_LOBBY') {
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'BACK_TO_LOBBY' }));
      }
    } else if (msg.type === 'SELECT_LANE') {
      if (gameActive && !myFinished && Number.isInteger(msg.lane) &&
          msg.lane >= 0 && msg.lane < LANE_X.length) {
        selectLane(msg.lane, true);
      }
    } else if (msg.type === 'SOLO') {
      leaveRoom();
      myPlayerId = 'solo';
      myColorHex = msg.color || '#38bdf8';
      myRunner.setColor(myColorHex);
      applyTheme(msg.theme);
      resetAndStartGame(Math.floor(Math.random() * 100000), msg.difficulty);
    }
  } catch {}
}

window.addEventListener('message', handleRNMessage);
document.addEventListener('message', handleRNMessage);

// --- Controls ---
let activePointer = null;

function selectLane(lane, repeatFeedback = false) {
  const nextLane = Math.min(LANE_X.length - 1, Math.max(0, lane));
  if (nextLane === currentLane && !repeatFeedback) return;
  currentLane = nextLane;
  targetX = LANE_X[currentLane];
  sendToRN({ type: 'LANE_SELECTED', lane: currentLane });
}

// Pointer events handle touch, mouse and pen without duplicate synthetic clicks.
window.addEventListener('pointerdown', (e) => {
  if (!gameActive || myFinished || !e.isPrimary || e.button !== 0) return;
  activePointer = { id: e.pointerId, startX: e.clientX };
}, { passive: true });

window.addEventListener('pointerup', (e) => {
  if (!activePointer || activePointer.id !== e.pointerId) return;
  const dx = e.clientX - activePointer.startX;
  activePointer = null;
  if (!gameActive || myFinished) return;

  if (Math.abs(dx) > 28) {
    selectLane(currentLane + (dx < 0 ? -1 : 1));
  } else {
    selectLane(Math.floor((e.clientX / window.innerWidth) * LANE_X.length), true);
  }
}, { passive: true });

window.addEventListener('pointercancel', (e) => {
  if (activePointer?.id === e.pointerId) activePointer = null;
}, { passive: true });
window.addEventListener('blur', () => { activePointer = null; });

window.addEventListener('keydown', (e) => {
  if (!gameActive || myFinished) return;
  if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
    selectLane(currentLane - 1);
  } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
    selectLane(currentLane + 1);
  }
});

window.addEventListener('resize', () => {
  configureCamera();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- Main Loop ---
let lastTime = performance.now();
let runPhase = 0;
let syncTimer = 0;

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  if (!gameActive) {
    runPhase += dt * 5;
    animateRunnerLimbs(myRunner, runPhase);
    renderer.render(scene, camera);
    return;
  }

  // Smooth remote players (dead reckoning + gentle error correction)
  for (const remote of remotePlayers.values()) {
    if (!remote.finished) {
      remote.currentDistance += BASE_SPEED * remote.speedMult * dt;
      remote.currentDistance += (remote.targetDistance - remote.currentDistance) * Math.min(1, dt * 6);
      remote.phase += dt * 10 * remote.speedMult;
    } else {
      remote.currentDistance += (remote.targetDistance - remote.currentDistance) * Math.min(1, dt * 10);
      remote.phase += dt * 4;
    }
    const prevRx = remote.mesh.group.position.x;
    remote.mesh.group.position.x += (remote.targetX - remote.mesh.group.position.x) * Math.min(1, dt * 12);
    const rVel = (remote.mesh.group.position.x - prevRx) / Math.max(dt, 0.001);
    remote.mesh.group.rotation.z = THREE.MathUtils.clamp(-rVel * 0.02, -0.22, 0.22);
    remote.mesh.group.position.z = -(remote.currentDistance - myDistance);
    animateRunnerLimbs(remote.mesh, remote.phase);
  }

  if (myFinished) {
    // Wait at finish line while watching others
    runPhase += dt * 4;
    animateRunnerLimbs(myRunner, runPhase);
    renderer.render(scene, camera);
    return;
  }

  const worldSpeed = BASE_SPEED * speedMult;
  myDistance += worldSpeed * dt;

  const prevX = myRunner.group.position.x;
  myRunner.group.position.x += (targetX - myRunner.group.position.x) * Math.min(1, dt * 14);
  const lateralVel = (myRunner.group.position.x - prevX) / Math.max(dt, 0.001);
  myRunner.group.rotation.z = THREE.MathUtils.clamp(-lateralVel * 0.025, -0.25, 0.25);

  runPhase += dt * 10 * speedMult;
  animateRunnerLimbs(myRunner, runPhase);

  roadside.update(worldSpeed * dt);
  dashes.position.z = (dashes.position.z + worldSpeed * dt) % DASH_SPACING;

  for (let i = gateRows.length - 1; i >= 0; i--) {
    const row = gateRows[i];
    row.group.position.z += worldSpeed * dt;

    if (!row.passed && row.group.position.z >= -0.35) {
      row.passed = true;
      passedCount++;

      let chosenLane = 0;
      let minDist = Infinity;
      for (let l = 0; l < 4; l++) {
        const dist = Math.abs(myRunner.group.position.x - LANE_X[l]);
        if (dist < minDist) {
          minDist = dist;
          chosenLane = l;
        }
      }

      const isCorrect = chosenLane === row.questionData.correct;
      const chosenGate = row.gates[chosenLane];

      let feedback;
      if (isCorrect) {
        speedMult = Math.min(speedProfile.max, Number((speedMult + speedProfile.correctStep).toFixed(2)));
        score += 1;
        streak += 1;
        chosenGate.panelMat.color.setHex(0x22c55e);
        chosenGate.panelMat.opacity = 0.65;
        chosenGate.pillarMat.color.setHex(0x22c55e);
        spawnBurst(LANE_X[chosenLane], 1.5, 0, 0x4ade80);
        feedback = { correct: true, text: 'DOĞRU! +HIZ' };
      } else {
        speedMult = Math.max(MIN_SPEED_MULT, Number((speedMult - speedProfile.wrongStep).toFixed(2)));
        streak = 0;
        chosenGate.panelMat.color.setHex(0xef4444);
        chosenGate.panelMat.opacity = 0.65;
        chosenGate.pillarMat.color.setHex(0xef4444);
        spawnBurst(LANE_X[chosenLane], 1.5, 0, 0xf87171);
        feedback = { correct: false, text: 'YANLIŞ! YAVAŞLA' };
      }

      const nextRow = gateRows.find((r) => !r.passed);
      if (passedCount >= TOTAL_QUESTIONS) {
        spawnFinishLine(-100);
        sendToRN({
          type: 'STATE',
          question: "SON DÜZLÜK! FİNAL'E KOŞ! (100m)",
          options: [],
          questionNum: TOTAL_QUESTIONS,
          totalQuestions: TOTAL_QUESTIONS,
          speedMult,
          score,
          streak,
          feedback,
          playerCount: remotePlayers.size + 1,
        });
      } else {
        sendToRN({
          type: 'STATE',
          question: nextRow ? nextRow.questionData.q : '',
          options: nextRow ? nextRow.questionData.options : [],
          questionNum: Math.min(TOTAL_QUESTIONS, passedCount + 1),
          totalQuestions: TOTAL_QUESTIONS,
          speedMult,
          score,
          streak,
          feedback,
          playerCount: remotePlayers.size + 1,
        });
      }
    }

    if (row.group.position.z > 12) {
      scene.remove(row.group);
      row.gates.forEach((g) => g.signTex.dispose());
      gateRows.splice(i, 1);

      const furthestZ = Math.min(...gateRows.map((r) => r.group.position.z), GATE_SPAWN_Z);
      spawnNextGateRow(furthestZ - GATE_SPACING);
    }
  }

  // Move Finish Line (final 100m sprint)
  if (finishLineActive && finishLineGroup) {
    finishLineGroup.position.z += worldSpeed * dt;
    finalHudTimer += dt;
    if (finalHudTimer >= 0.2) {
      finalHudTimer = 0;
      const rem = Math.max(0, Math.round(-finishLineGroup.position.z));
      sendToRN({
        type: 'STATE',
        question: `SON DÜZLÜK! FİNAL'E KOŞ! (${rem}m)`,
        options: [],
      });
    }

    if (finishLineGroup.position.z >= 0) {
      finishLineActive = false;
      myFinished = true;
      touchLaneGuide.replaceChildren();
      activePointer = null;
      spawnBurst(myRunner.group.position.x, 1.8, 0, 0xfacc15);
      const elapsedMs = Math.round(performance.now() - startTimeMs);
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'FINISH', score, elapsedMs }));
        sendToRN({
          type: 'FINISHED_WAIT',
          myScore: score,
          totalQuestions: TOTAL_QUESTIONS,
          elapsedMs,
        });
      } else {
        sendToRN({
          type: 'FINISHED_WAIT',
          myScore: score,
          totalQuestions: TOTAL_QUESTIONS,
          elapsedMs,
          solo: true,
        });
      }
    }
  }

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.userData.life -= dt;
    p.userData.vy -= 14 * dt;
    p.position.x += p.userData.vx * dt;
    p.position.y += p.userData.vy * dt;
    p.position.z += p.userData.vz * dt;
    p.scale.setScalar(Math.max(0.01, p.userData.life / 0.75));
    if (p.userData.life <= 0) {
      scene.remove(p);
      particles.splice(i, 1);
    }
  }

  // Sync position to WS server (~12.5 Hz)
  syncTimer += dt;
  if (ws && ws.readyState === 1 && syncTimer >= 0.08) {
    syncTimer = 0;
    ws.send(
      JSON.stringify({
        type: 'STATE',
        lane: currentLane,
        x: Number(myRunner.group.position.x.toFixed(2)),
        distance: Number(myDistance.toFixed(2)),
        speedMult,
        score,
      })
    );
  }

  renderer.render(scene, camera);
}

requestAnimationFrame(animate);
