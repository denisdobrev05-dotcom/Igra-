import * as THREE from 'three';

// ─── GLOBALS ───────────────────────────────────────────────────────────────
const CANNON = window.CANNON;

let scene, camera, renderer, world;
let vehicle, carBody, carMesh;
let wheelMeshes = [];
let groundMesh;
let started = false;
let clock = new THREE.Clock();
let prevTime = 0;
let fpsFrames = 0, fpsAccum = 0;

// Camera follow
const camOffset = new THREE.Vector3(0, 4, -10);
const camTarget = new THREE.Vector3();
const camCurrent = new THREE.Vector3(0, 4, -10);

// Controls
const keys = {};

// HUD
const speedCanvas = document.getElementById('speed-canvas');
const rpmCanvas   = document.getElementById('rpm-canvas');
const sCtx = speedCanvas.getContext('2d');
const rCtx = rpmCanvas.getContext('2d');
const speedVal = document.getElementById('speed-value');
const rpmVal   = document.getElementById('rpm-value');
const gearLabel = document.getElementById('gear-label');

// Skid marks
const skidMarks = [];
const MAX_SKID = 400;

// Dust particles
let dustParticles, dustGeo, dustPositions;

// ─── INIT ──────────────────────────────────────────────────────────────────
function init() {
  fakeLoading(() => {
    setupRenderer();
    setupScene();
    setupPhysics();
    buildTerrain();
    buildCar();
    buildSkybox();
    buildDust();
    setupControls();
    animate();
  });
}

function fakeLoading(cb) {
  const bar = document.getElementById('loading-progress');
  const txt = document.getElementById('loading-text');
  const msgs = ['Зареждане на физика...','Изграждане на терен...','Сглобяване на колата...','Готово!'];
  let p = 0;
  const steps = [20, 50, 80, 100];
  let i = 0;
  const tick = () => {
    p = steps[i];
    bar.style.width = p + '%';
    txt.textContent = msgs[i];
    i++;
    if (i < steps.length) setTimeout(tick, 300);
    else setTimeout(() => {
      document.getElementById('loading').classList.add('hidden');
      cb();
    }, 400);
  };
  tick();
}

// ─── RENDERER ──────────────────────────────────────────────────────────────
function setupRenderer() {
  renderer = new THREE.WebGLRenderer({
    canvas: document.getElementById('game-canvas'),
    antialias: true
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// ─── SCENE ────────────────────────────────────────────────────────────────
function setupScene() {
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x88aacc, 0.008);

  camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 6, -14);

  // Ambient
  const ambient = new THREE.AmbientLight(0x8899bb, 0.6);
  scene.add(ambient);

  // Sun
  const sun = new THREE.DirectionalLight(0xfff5e0, 2.2);
  sun.position.set(80, 120, 60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 500;
  sun.shadow.camera.left = -150;
  sun.shadow.camera.right = 150;
  sun.shadow.camera.top = 150;
  sun.shadow.camera.bottom = -150;
  sun.shadow.bias = -0.0005;
  scene.add(sun);

  // Fill light
  const fill = new THREE.DirectionalLight(0x4488ff, 0.4);
  fill.position.set(-50, 30, -50);
  scene.add(fill);
}

// ─── PHYSICS ──────────────────────────────────────────────────────────────
function setupPhysics() {
  world = new CANNON.World({ gravity: new CANNON.Vec3(0, -20, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.solver.iterations = 20;
  world.defaultContactMaterial.friction = 0.4;
  world.defaultContactMaterial.restitution = 0.0;
}

// ─── TERRAIN ──────────────────────────────────────────────────────────────
function buildTerrain() {
  const SIZE = 300;

  // Physics ground
  const groundBody = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC });
  groundBody.addShape(new CANNON.Plane());
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(groundBody);

  // Visual ground — grid texture
  const texSize = 512;
  const tc = document.createElement('canvas');
  tc.width = tc.height = texSize;
  const tx = tc.getContext('2d');

  // Base
  tx.fillStyle = '#3a4a3a';
  tx.fillRect(0, 0, texSize, texSize);

  // Grid lines
  tx.strokeStyle = '#506050';
  tx.lineWidth = 1.5;
  const cell = texSize / 8;
  for (let i = 0; i <= 8; i++) {
    tx.beginPath(); tx.moveTo(i * cell, 0); tx.lineTo(i * cell, texSize); tx.stroke();
    tx.beginPath(); tx.moveTo(0, i * cell); tx.lineTo(texSize, i * cell); tx.stroke();
  }
  // Dots at intersections
  tx.fillStyle = '#607060';
  for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
    tx.beginPath(); tx.arc(i * cell, j * cell, 2.5, 0, Math.PI * 2); tx.fill();
  }

  const tex = new THREE.CanvasTexture(tc);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(SIZE / 10, SIZE / 10);

  const gGeo = new THREE.PlaneGeometry(SIZE, SIZE);
  const gMat = new THREE.MeshLambertMaterial({ map: tex });
  groundMesh = new THREE.Mesh(gGeo, gMat);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  // Border walls (physics only)
  const wallMat = new CANNON.Material();
  const hw = SIZE / 2;
  const wallDefs = [
    { pos: [0, 2, -hw], rot: [0, 0, 0] },
    { pos: [0, 2,  hw], rot: [0, Math.PI, 0] },
    { pos: [-hw, 2, 0], rot: [0,  Math.PI/2, 0] },
    { pos: [ hw, 2, 0], rot: [0, -Math.PI/2, 0] },
  ];
  wallDefs.forEach(({ pos, rot }) => {
    const wb = new CANNON.Body({ mass: 0 });
    wb.addShape(new CANNON.Box(new CANNON.Vec3(hw, 4, 0.5)));
    wb.position.set(...pos);
    wb.quaternion.setFromEuler(...rot);
    world.addBody(wb);
  });

  // Visual border rails
  const railMat = new THREE.MeshLambertMaterial({ color: 0xff3300 });
  const railGeo = new THREE.BoxGeometry(SIZE, 1, 0.5);
  const positions2 = [[0, 0.5, -hw], [0, 0.5, hw]];
  const rotations2  = [0, Math.PI];
  positions2.forEach((p, i) => {
    const m = new THREE.Mesh(railGeo, railMat);
    m.position.set(...p); m.receiveShadow = true; m.castShadow = true;
    scene.add(m);
  });
  const railGeo2 = new THREE.BoxGeometry(0.5, 1, SIZE);
  [[-hw, 0.5, 0], [hw, 0.5, 0]].forEach(p => {
    const m = new THREE.Mesh(railGeo2, railMat);
    m.position.set(...p); m.receiveShadow = true; m.castShadow = true;
    scene.add(m);
  });

  // Scatter some obstacles
  buildObstacles();
}

function buildObstacles() {
  const mats = [
    new THREE.MeshLambertMaterial({ color: 0x886644 }),
    new THREE.MeshLambertMaterial({ color: 0x446688 }),
    new THREE.MeshLambertMaterial({ color: 0x668844 }),
  ];
  const configs = [
    { geo: new THREE.BoxGeometry(4, 2, 4),    shape: () => new CANNON.Box(new CANNON.Vec3(2,1,2)) },
    { geo: new THREE.CylinderGeometry(1.5,1.5,3,12), shape: () => new CANNON.Cylinder(1.5,1.5,3,12) },
    { geo: new THREE.BoxGeometry(3, 3, 3),    shape: () => new CANNON.Box(new CANNON.Vec3(1.5,1.5,1.5)) },
  ];
  const spots = [
    [30,0,30],[-30,0,30],[30,0,-30],[-30,0,-30],
    [60,0,10],[10,0,60],[-60,0,-10],[-10,0,-60],
    [80,0,80],[-80,0,80],[80,0,-80],[-80,0,-80],
  ];
  spots.forEach((pos, i) => {
    const cfg = configs[i % configs.length];
    const mat = mats[i % mats.length];
    const mesh = new THREE.Mesh(cfg.geo, mat);
    mesh.position.set(pos[0], 1.5, pos[2]);
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);

    const body = new CANNON.Body({ mass: 0 });
    body.addShape(cfg.shape());
    body.position.set(pos[0], 1.5, pos[2]);
    world.addBody(body);
  });
}

// ─── SKYBOX ────────────────────────────────────────────────────────────────
function buildSkybox() {
  const sk = 512;
  const canvas = document.createElement('canvas');
  canvas.width = sk; canvas.height = sk;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, sk);
  grad.addColorStop(0,    '#0d1b3e');
  grad.addColorStop(0.45, '#1a4080');
  grad.addColorStop(0.7,  '#4488cc');
  grad.addColorStop(1,    '#88bbdd');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, sk, sk);

  // Clouds
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  [[80,200,120,40],[300,160,160,50],[500,220,100,35],[150,280,200,45]].forEach(([x,y,w,h]) => {
    ctx.beginPath(); ctx.ellipse(x, y, w, h, 0, 0, Math.PI*2); ctx.fill();
  });

  const skyTex = new THREE.CanvasTexture(canvas);
  scene.background = skyTex;
}

// ─── DUST PARTICLES ────────────────────────────────────────────────────────
function buildDust() {
  const count = 200;
  dustGeo = new THREE.BufferGeometry();
  dustPositions = new Float32Array(count * 3);
  for (let i = 0; i < count * 3; i++) dustPositions[i] = 0;
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
  const dustMat = new THREE.PointsMaterial({
    color: 0xccbbaa, size: 0.3,
    transparent: true, opacity: 0.5,
    depthWrite: false
  });
  dustParticles = new THREE.Points(dustGeo, dustMat);
  scene.add(dustParticles);

  for (let i = 0; i < count; i++) {
    skidMarks.push({ active: false, life: 0, x: 0, y: 0, z: 0 });
  }
}

// ─── CAR ──────────────────────────────────────────────────────────────────
function buildCar() {
  // ── Physics body ──
  const chassisShape = new CANNON.Box(new CANNON.Vec3(1.0, 0.35, 2.1));
  carBody = new CANNON.Body({ mass: 1000 });
  carBody.addShape(chassisShape, new CANNON.Vec3(0, 0.1, 0));
  carBody.position.set(0, 2, 0);
  carBody.linearDamping = 0.15;
  carBody.angularDamping = 0.4;
  world.addBody(carBody);

  // ── Visual mesh ──
  carMesh = buildCarMesh();
  scene.add(carMesh);

  // ── RaycastVehicle ──
  vehicle = new CANNON.RaycastVehicle({
    chassisBody: carBody,
    indexRightAxis: 0,
    indexUpAxis: 1,
    indexForwardAxis: 2
  });

  const wheelOpts = {
    radius: 0.38,
    directionLocal: new CANNON.Vec3(0, -1, 0),
    suspensionStiffness: 38,
    suspensionRestLength: 0.35,
    frictionSlip: 1.6,
    dampingRelaxation: 2.5,
    dampingCompression: 4.2,
    maxSuspensionForce: 100000,
    rollInfluence: 0.05,
    axleLocal: new CANNON.Vec3(1, 0, 0),
    chassisConnectionPointLocal: new CANNON.Vec3(0, 0, 0),
    maxSuspensionTravel: 0.3,
    customSlidingRotationalSpeed: -30,
    useCustomSlidingRotationalSpeed: true
  };

  // Front-left, Front-right, Rear-left, Rear-right
  const wPos = [
    [-0.88, -0.1,  1.4],
    [ 0.88, -0.1,  1.4],
    [-0.88, -0.1, -1.4],
    [ 0.88, -0.1, -1.4],
  ];
  wPos.forEach(([x, y, z]) => {
    const o = { ...wheelOpts };
    o.chassisConnectionPointLocal = new CANNON.Vec3(x, y, z);
    vehicle.addWheel(o);
  });

  vehicle.addToWorld(world);

  // Wheel meshes
  vehicle.wheelInfos.forEach(() => {
    const wm = buildWheelMesh();
    wheelMeshes.push(wm);
    scene.add(wm);
  });
}

function buildCarMesh() {
  const group = new THREE.Group();

  // Materials
  const bodyMat  = new THREE.MeshPhongMaterial({ color: 0xcc2200, shininess: 120, specular: 0x884422 });
  const glassMat = new THREE.MeshPhongMaterial({ color: 0x99ccff, shininess: 200, transparent: true, opacity: 0.55 });
  const darkMat  = new THREE.MeshPhongMaterial({ color: 0x111111, shininess: 60 });
  const lightMat = new THREE.MeshPhongMaterial({ color: 0xffffcc, emissive: 0x444422, shininess: 200 });
  const chromeMat= new THREE.MeshPhongMaterial({ color: 0xcccccc, shininess: 200, specular: 0xffffff });

  // Main body — lower
  const lowerGeo = new THREE.BoxGeometry(1.92, 0.55, 4.2);
  const lower = new THREE.Mesh(lowerGeo, bodyMat);
  lower.position.y = 0.36;
  lower.castShadow = true;
  group.add(lower);

  // Cabin
  const cabinGeo = new THREE.BoxGeometry(1.72, 0.55, 2.2);
  const cabin = new THREE.Mesh(cabinGeo, bodyMat);
  cabin.position.set(0, 0.89, -0.1);
  cabin.castShadow = true;
  group.add(cabin);

  // Windshield
  const wsGeo = new THREE.PlaneGeometry(1.6, 0.58);
  const ws = new THREE.Mesh(wsGeo, glassMat);
  ws.position.set(0, 0.91, 1.0);
  ws.rotation.x = -0.35;
  group.add(ws);

  // Rear window
  const rwGeo = new THREE.PlaneGeometry(1.5, 0.52);
  const rw = new THREE.Mesh(rwGeo, glassMat);
  rw.position.set(0, 0.91, -1.16);
  rw.rotation.x = 0.35;
  group.add(rw);

  // Side windows L/R
  [-0.87, 0.87].forEach(x => {
    const swGeo = new THREE.PlaneGeometry(1.8, 0.42);
    const sw = new THREE.Mesh(swGeo, glassMat);
    sw.position.set(x, 0.91, -0.08);
    sw.rotation.y = x > 0 ? Math.PI / 2 : -Math.PI / 2;
    group.add(sw);
  });

  // Hood
  const hoodGeo = new THREE.BoxGeometry(1.88, 0.06, 1.5);
  const hood = new THREE.Mesh(hoodGeo, bodyMat);
  hood.position.set(0, 0.66, 1.25);
  hood.castShadow = true;
  group.add(hood);

  // Trunk
  const trunkGeo = new THREE.BoxGeometry(1.88, 0.06, 0.9);
  const trunk = new THREE.Mesh(trunkGeo, bodyMat);
  trunk.position.set(0, 0.66, -1.65);
  trunk.castShadow = true;
  group.add(trunk);

  // Bumpers
  [2.15, -2.15].forEach(z => {
    const bGeo = new THREE.BoxGeometry(2.0, 0.3, 0.18);
    const b = new THREE.Mesh(bGeo, darkMat);
    b.position.set(0, 0.28, z);
    group.add(b);
  });

  // Headlights
  [[-0.62, 0.5, 2.1], [0.62, 0.5, 2.1]].forEach(([x, y, z]) => {
    const lg = new THREE.CylinderGeometry(0.15, 0.15, 0.1, 12);
    const l  = new THREE.Mesh(lg, lightMat);
    l.rotation.x = Math.PI / 2;
    l.position.set(x, y, z);
    group.add(l);
  });

  // Tail lights
  [[-0.7, 0.5, -2.12], [0.7, 0.5, -2.12]].forEach(([x, y, z]) => {
    const lg = new THREE.BoxGeometry(0.3, 0.15, 0.08);
    const lm = new THREE.MeshPhongMaterial({ color: 0xff1100, emissive: 0x440000 });
    const l  = new THREE.Mesh(lg, lm);
    l.position.set(x, y, z);
    group.add(l);
  });

  // Chrome strip
  const csGeo = new THREE.BoxGeometry(1.95, 0.04, 0.1);
  const cs = new THREE.Mesh(csGeo, chromeMat);
  cs.position.set(0, 0.58, 0);
  group.add(cs);

  // Roof scoop
  const scoopGeo = new THREE.BoxGeometry(0.4, 0.12, 0.6);
  const scoop = new THREE.Mesh(scoopGeo, darkMat);
  scoop.position.set(0, 1.18, -0.05);
  group.add(scoop);

  // Door handles L/R
  [[-0.97, 0.75, 0.2], [0.97, 0.75, 0.2]].forEach(([x, y, z]) => {
    const dhg = new THREE.BoxGeometry(0.05, 0.06, 0.22);
    const dh  = new THREE.Mesh(dhg, chromeMat);
    dh.position.set(x, y, z);
    group.add(dh);
  });

  group.position.y = -0.1;
  return group;
}

function buildWheelMesh() {
  const group = new THREE.Group();
  const tireMat  = new THREE.MeshLambertMaterial({ color: 0x222222 });
  const rimMat   = new THREE.MeshPhongMaterial({ color: 0xaaaaaa, shininess: 150 });

  // Tire
  const tireGeo = new THREE.TorusGeometry(0.36, 0.14, 12, 24);
  const tire = new THREE.Mesh(tireGeo, tireMat);
  tire.rotation.y = Math.PI / 2;
  tire.castShadow = true;
  group.add(tire);

  // Rim disc
  const rimGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.06, 16);
  const rim = new THREE.Mesh(rimGeo, rimMat);
  rim.rotation.z = Math.PI / 2;
  rim.castShadow = true;
  group.add(rim);

  // Spokes
  for (let i = 0; i < 5; i++) {
    const sg = new THREE.BoxGeometry(0.04, 0.22, 0.04);
    const sp = new THREE.Mesh(sg, rimMat);
    const a = (i / 5) * Math.PI * 2;
    sp.position.set(0, Math.sin(a) * 0.13, Math.cos(a) * 0.13);
    sp.rotation.x = a;
    group.add(sp);
  }

  return group;
}

// ─── CONTROLS ─────────────────────────────────────────────────────────────
function setupControls() {
  document.addEventListener('keydown', e => {
    keys[e.code] = true;
    if (e.code === 'Enter' && !started) startGame();
    if (e.code === 'KeyR') resetCar();
  });
  document.addEventListener('keyup', e => { keys[e.code] = false; });
}

function startGame() {
  started = true;
  document.getElementById('controls-hint').classList.add('hidden');
  document.getElementById('hud').classList.add('visible');
  document.getElementById('info-bar').classList.add('visible');
}

function resetCar() {
  carBody.position.set(0, 2, 0);
  carBody.velocity.set(0, 0, 0);
  carBody.angularVelocity.set(0, 0, 0);
  carBody.quaternion.setFromEuler(0, 0, 0);
}

// ─── ANIMATE ──────────────────────────────────────────────────────────────
const engineForce  = 4500;
const brakeForce   = 35;
const steerMax     = 0.52;
let   steerAngle   = 0;
let   currentRPM   = 800;

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now() / 1000;
  const dt  = Math.min(now - prevTime, 0.05);
  prevTime  = now;

  if (!started) {
    renderer.render(scene, camera);
    return;
  }

  // ── Physics step ──
  world.step(1 / 60, dt, 3);

  // ── Engine / steering ──
  const gas     = keys['ArrowUp']   || keys['KeyW'];
  const brake   = keys['ArrowDown'] || keys['KeyS'];
  const left    = keys['ArrowLeft'] || keys['KeyA'];
  const right   = keys['ArrowRight']|| keys['KeyD'];
  const handbrk = keys['Space'];

  // Steering
  const steerTarget = left ? steerMax : right ? -steerMax : 0;
  steerAngle += (steerTarget - steerAngle) * 0.15;

  vehicle.setSteeringValue(steerAngle, 0);
  vehicle.setSteeringValue(steerAngle, 1);

  // Drive (rear wheels)
  if (gas) {
    vehicle.applyEngineForce(-engineForce, 2);
    vehicle.applyEngineForce(-engineForce, 3);
  } else if (brake) {
    vehicle.applyEngineForce(engineForce * 0.6, 2);
    vehicle.applyEngineForce(engineForce * 0.6, 3);
  } else {
    vehicle.applyEngineForce(0, 2);
    vehicle.applyEngineForce(0, 3);
  }

  // Brakes
  const bf = (brake && !gas) ? brakeForce : 0;
  const hbf = handbrk ? brakeForce * 3 : 0;
  vehicle.setBrake(bf, 0);
  vehicle.setBrake(bf, 1);
  vehicle.setBrake(bf + hbf, 2);
  vehicle.setBrake(bf + hbf, 3);

  // ── Sync meshes ──
  copyPhysicsToMesh(carBody, carMesh);

  vehicle.wheelInfos.forEach((wi, i) => {
    vehicle.updateWheelTransform(i);
    const t = wi.worldTransform;
    wheelMeshes[i].position.copy(t.position);
    wheelMeshes[i].quaternion.copy(t.quaternion);
  });

  // ── Camera ──
  updateCamera(dt);

  // ── Dust / skid ──
  updateDust(dt, handbrk || (gas && brake));

  // ── HUD ──
  const vel = carBody.velocity;
  const spd = Math.sqrt(vel.x * vel.x + vel.z * vel.z) * 3.6;

  currentRPM += (spd * 65 + 800 - currentRPM) * 0.08;
  currentRPM = Math.max(800, Math.min(7200, currentRPM));

  drawGauge(sCtx, spd, 220, '#4af', 'КМ/Ч');
  drawGauge(rCtx, currentRPM / 100, 72, '#f84', 'RPM');
  speedVal.textContent = Math.round(spd);
  rpmVal.textContent   = Math.round(currentRPM / 100);

  // Gear
  const gear = spd < 1 ? 'N' : spd < 25 ? '1' : spd < 55 ? '2' : spd < 90 ? '3' : spd < 130 ? '4' : '5';
  gearLabel.textContent = gear;

  // FPS
  fpsFrames++;
  fpsAccum += dt;
  if (fpsAccum >= 0.5) {
    document.getElementById('fps-counter').textContent = Math.round(fpsFrames / fpsAccum) + ' FPS';
    fpsFrames = 0; fpsAccum = 0;
  }

  renderer.render(scene, camera);
}

function copyPhysicsToMesh(body, mesh) {
  mesh.position.copy(body.position);
  mesh.quaternion.copy(body.quaternion);
}

function updateCamera(dt) {
  const q  = carBody.quaternion;
  const cp = carBody.position;

  const back  = new THREE.Vector3(0, 0, -1).applyQuaternion(
    new THREE.Quaternion(q.x, q.y, q.z, q.w)
  );

  const desiredPos = new THREE.Vector3(
    cp.x + back.x * 10,
    cp.y + 4.5,
    cp.z + back.z * 10
  );

  camCurrent.lerp(desiredPos, 0.06);
  camera.position.copy(camCurrent);

  camTarget.set(cp.x, cp.y + 0.8, cp.z);
  camera.lookAt(camTarget);
}

function updateDust(dt, spinning) {
  const pos = carBody.position;
  const count = dustPositions.length / 3;

  for (let i = 0; i < count; i++) {
    const base = i * 3;
    if (skidMarks[i].life > 0) {
      skidMarks[i].life -= dt;
      dustPositions[base + 1] += dt * 1.5;
      dustPositions[base]     += (Math.random() - 0.5) * 0.05;
      dustPositions[base + 2] += (Math.random() - 0.5) * 0.05;
    } else if (spinning && Math.random() < 0.3) {
      skidMarks[i].life = 0.8 + Math.random() * 0.5;
      const off = (Math.random() - 0.5) * 2;
      dustPositions[base]     = pos.x + off;
      dustPositions[base + 1] = pos.y - 0.3;
      dustPositions[base + 2] = pos.z + off;
    } else {
      dustPositions[base]     = 0;
      dustPositions[base + 1] = -100;
      dustPositions[base + 2] = 0;
    }
  }
  dustGeo.attributes.position.needsUpdate = true;
}

// ─── GAUGE DRAWING ────────────────────────────────────────────────────────
function drawGauge(ctx, value, maxVal, color, label) {
  const W = 160, cx = 80, cy = 88, r = 62;
  ctx.clearRect(0, 0, W, W);

  // Outer ring
  ctx.beginPath();
  ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
  ctx.strokeStyle = '#1a2a3a';
  ctx.lineWidth = 8;
  ctx.stroke();

  // Track
  const startA = Math.PI * 0.75;
  const endA   = Math.PI * 2.25;
  ctx.beginPath();
  ctx.arc(cx, cy, r, startA, endA);
  ctx.strokeStyle = '#223';
  ctx.lineWidth = 10;
  ctx.stroke();

  // Value arc
  const pct = Math.min(value / maxVal, 1);
  const valA = startA + pct * (endA - startA);
  const grad = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
  grad.addColorStop(0, color);
  grad.addColorStop(1, '#fff');
  ctx.beginPath();
  ctx.arc(cx, cy, r, startA, valA);
  ctx.strokeStyle = grad;
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Tick marks
  for (let i = 0; i <= 10; i++) {
    const a = startA + (i / 10) * (endA - startA);
    const inner = i % 5 === 0 ? r - 16 : r - 10;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
    ctx.lineTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4));
    ctx.strokeStyle = i % 5 === 0 ? '#ccc' : '#556';
    ctx.lineWidth = i % 5 === 0 ? 2 : 1;
    ctx.stroke();
  }

  // Needle
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(valA);
  ctx.beginPath();
  ctx.moveTo(-6, 0);
  ctx.lineTo(r - 14, 0);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.restore();

  // Center dot
  ctx.beginPath();
  ctx.arc(cx, cy, 7, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

// ─── KICK OFF ─────────────────────────────────────────────────────────────
init();
