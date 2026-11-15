// =====================================================
//  world.js: scene, camera, lights, warehouse, 3D models
// =====================================================

const GAME_FONT = '"Fredoka", "Segoe UI Rounded", "Segoe UI", system-ui, sans-serif';

// ---------- renderer / camera ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xffe9cf);
scene.fog = new THREE.Fog(0xffe9cf, 30, 62);

const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.1, 150);
camera.position.set(-1, 11, 15.5);
camera.lookAt(-1, 0.5, 2.8);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.NoToneMapping; // keep the pastel colors bright
document.body.prepend(renderer.domElement);

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// mouse wheel zoom
addEventListener("wheel", e => {
  if (e.target !== renderer.domElement) return;
  camera.zoom = Math.min(1.7, Math.max(0.75, camera.zoom - e.deltaY * 0.001));
  camera.updateProjectionMatrix();
}, { passive: true });

// ---------- lights ----------
scene.add(new THREE.HemisphereLight(0xfff6e8, 0xb8a6d9, 0.65));

const sun = new THREE.DirectionalLight(0xfff3e0, 0.95);
sun.position.set(-8, 16, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0005;
Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 16, bottom: -16, far: 60 });
scene.add(sun);

for (const x of [-9, 5]) {
  const lamp = new THREE.PointLight(0xffd9a0, 0.3, 30, 1.5);
  lamp.position.set(x, 7, 2);
  scene.add(lamp);
}

// =====================================================
//  Texture helpers
// =====================================================
function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function canvasTexture(w, h, draw, repeatX = 1, repeatY = 1) {
  const c = makeCanvas(w, h);
  draw(c.getContext("2d"), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.encoding = THREE.sRGBEncoding;
  tex.anisotropy = 4;
  if (repeatX !== 1 || repeatY !== 1) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
  }
  return tex;
}

function labelTexture(text, bg, fg = "#fff", font = 60) {
  return canvasTexture(256, 128, (g, w, h) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = fg;
    g.font = `600 ${font}px ${GAME_FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, w / 2, h / 2 + 4);
  });
}

function hazardTexture(repeatX = 1) {
  return canvasTexture(64, 64, (g, w, h) => {
    g.fillStyle = "#2b2340";
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "#ffd166";
    g.lineWidth = 12;
    for (let i = -w; i < w * 2; i += 24) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i + h, h); g.stroke();
    }
  }, repeatX, 1);
}

// Cartoon look: toon shading with 3 flat bands of light
const toonGradient = (() => {
  const t = new THREE.DataTexture(new Uint8Array([110, 185, 255]), 3, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
})();
function toon(opts = {}) {
  const { roughness, metalness, ...rest } = opts; // toon materials don't use these
  return new THREE.MeshToonMaterial({ gradientMap: toonGradient, ...rest });
}
const mat = (color, opts = {}) => toon({ color, ...opts });

// thick dark outline drawn behind a mesh ("inverted hull" trick)
const INK = 0x2b2340;
const outlineMat = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });
function addOutline(mesh, thickness = 0.06) {
  const o = new THREE.Mesh(mesh.geometry, outlineMat);
  o.scale.setScalar(1 + thickness);
  o.userData.isOutline = true;
  mesh.add(o);
  return o;
}

function addBox(parent, w, h, d, material, x, y, z, shadows = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = shadows;
  parent.add(m);
  return m;
}

// =====================================================
//  Warehouse environment
// =====================================================
// concrete floor
const floorTex = canvasTexture(256, 256, (g, w, h) => {
  g.fillStyle = "#d9cfc2";
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 1800; i++) {
    const v = 190 + Math.random() * 40;
    g.fillStyle = `rgba(${v},${v - 8},${v - 16},${Math.random() * 0.35})`;
    g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
  g.strokeStyle = "#00000022";
  g.lineWidth = 2;
  g.strokeRect(0, 0, w, h); // slab seams
}, 14, 14);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), mat(0xffffff, { map: floorTex, roughness: 0.95 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

function floorDecal(w, d, x, z, material) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), material);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.012, z);
  m.receiveShadow = true;
  scene.add(m);
  return m;
}

// truck road
const yellowPaint = toon({ color: 0xffcc4d, roughness: 0.6 });
const whitePaint = toon({ color: 0xdddddd, roughness: 0.6 });
floorDecal(90, 2.8, 0, LANE_Z, mat(0x6d6a85));
floorDecal(90, 0.08, 0, LANE_Z - 1.4, yellowPaint);
floorDecal(90, 0.08, 0, LANE_Z + 1.4, yellowPaint);
for (let x = -40; x < 40; x += 3) floorDecal(1.4, 0.08, x, LANE_Z, whitePaint);

// sorting area outline + walkway hatching behind the belt
floorDecal(24, 0.08, -1, BIN_Z - 1.4, yellowPaint);
floorDecal(24, 0.5, -1, -3.4, toon({ map: hazardTexture(40), roughness: 0.8 }));

// back wall
const wallTex = canvasTexture(64, 256, (g, w, h) => {
  const grad = g.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, "#8ec5d6");
  grad.addColorStop(0.5, "#a6d6e4");
  grad.addColorStop(1, "#8ec5d6");
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
}, 40, 1);
const backWall = new THREE.Mesh(new THREE.BoxGeometry(80, 12, 0.4), mat(0xffffff, { map: wallTex }));
backWall.position.set(0, 6, -10);
backWall.receiveShadow = true;
scene.add(backWall);
addBox(scene, 80, 0.6, 0.5, yellowPaint, 0, 0.3, -9.75, false); // kick plate

// roll-up doors
const doorTex = canvasTexture(128, 128, (g, w, h) => {
  g.fillStyle = "#ff9f80";
  g.fillRect(0, 0, w, h);
  g.fillStyle = "#e9805f";
  for (let y = 0; y < h; y += 10) g.fillRect(0, y, w, 3);
});
for (const x of [-4.5, 3.5]) {
  const door = new THREE.Mesh(new THREE.PlaneGeometry(5, 5.5), mat(0xffffff, { map: doorTex, metalness: 0.3 }));
  door.position.set(x, 2.75, -9.78);
  scene.add(door);
  addBox(scene, 5.4, 0.3, 0.3, mat(0x333740), x, 5.6, -9.7, false);
}

// high windows (glow)
const windowMat = new THREE.MeshBasicMaterial({ color: 0xfff6c8 });
for (let x = -30; x <= 30; x += 6) {
  const w = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.2), windowMat);
  w.position.set(x, 9.5, -9.78);
  scene.add(w);
}

// pallet racks full of boxes along the back wall
const rackUpright = mat(0x7cc6fe);
const rackBeam = mat(0xffd166);
const cardboardMats = [0xc8995c, 0xb88a4f, 0xd4a86a, 0xa77b44].map(c => mat(c, { roughness: 0.85 }));
function makeRack(x) {
  const rack = new THREE.Group();
  const W = 5, D = 1.5, H = 6.4;
  for (const dx of [-W / 2, W / 2]) for (const dz of [-D / 2, D / 2]) {
    addBox(rack, 0.12, H, 0.12, rackUpright, dx, H / 2, dz);
  }
  for (const y of [0.25, 2.25, 4.25]) {
    for (const dz of [-D / 2, D / 2]) addBox(rack, W, 0.15, 0.1, rackBeam, 0, y, dz);
    // boxes on this shelf
    let bx = -W / 2 + 0.2;
    while (bx < W / 2 - 0.8) {
      const s = 0.7 + Math.random() * 0.5;
      if (Math.random() > 0.15) {
        addBox(rack, s, s * (0.8 + Math.random() * 0.4), D * 0.8, cardboardMats[Math.floor(Math.random() * 4)],
          bx + s / 2, y + 0.08 + s / 2, 0);
      }
      bx += s + 0.12;
    }
  }
  rack.position.set(x, 0, -8.6);
  scene.add(rack);
}
[-17, -11.2, 9.5, 15.3].forEach(makeRack);

// =====================================================
//  Conveyor belt
// =====================================================
const beltLength = BELT_END - BELT_START + 1;
const beltCenterX = (BELT_START + BELT_END) / 2;

const beltTex = canvasTexture(64, 64, (g, w, h) => {
  g.fillStyle = "#5b5873";
  g.fillRect(0, 0, w, h);
  g.fillStyle = "#6d6a88";
  g.fillRect(0, 0, 10, h);
  g.fillStyle = "#ffffff10";
  g.fillRect(30, 0, 2, h);
}, beltLength, 1);

const steelMat = mat(0xb6b3d6);
const beltTopMat = mat(0xffffff, { map: beltTex, roughness: 0.95 });
const belt = new THREE.Mesh(
  new THREE.BoxGeometry(beltLength, 0.3, 2.2),
  [steelMat, steelMat, beltTopMat, steelMat, steelMat, steelMat]
);
belt.position.set(beltCenterX, BELT_TOP - 0.15, 0);
belt.castShadow = belt.receiveShadow = true;
scene.add(belt);

const skirtMat = toon({ map: hazardTexture(beltLength * 1.5), roughness: 0.7 });
for (const z of [-1.15, 1.15]) {
  addBox(scene, beltLength, 0.25, 0.15, steelMat, beltCenterX, BELT_TOP + 0.05, z);
  addBox(scene, beltLength, 0.25, 0.05, skirtMat, beltCenterX, BELT_TOP - 0.42, z * 0.98, false);
}
// end rollers
for (const x of [BELT_START - 0.5, BELT_END + 0.5]) {
  const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 2.3, 20), steelMat);
  roller.rotation.x = Math.PI / 2;
  roller.position.set(x, BELT_TOP - 0.15, 0);
  scene.add(roller);
}
// legs
const legMat = mat(0x8d89b3);
for (let x = BELT_START + 1; x <= BELT_END; x += 4) {
  for (const z of [-0.9, 0.9]) addBox(scene, 0.2, BELT_TOP - 0.3, 0.2, legMat, x, (BELT_TOP - 0.3) / 2, z);
}
// end-of-belt drop sign
const hazardBlock = addBox(scene, 0.3, 0.32, 2.2, toon({ map: hazardTexture() }),
  BELT_END + 0.85, BELT_TOP - 0.15, 0);

// warning beacon (flashes during a belt jam)
const beaconMat = toon({ color: 0x551111, emissive: 0x000000 });
const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.4, 16), beaconMat);
beacon.position.set(beltCenterX, BELT_TOP + 0.95, -1.15);
addBox(scene, 0.08, 0.8, 0.08, steelMat, beltCenterX, BELT_TOP + 0.45, -1.15);
scene.add(beacon);
const beaconLight = new THREE.PointLight(0xff3030, 0, 8);
beaconLight.position.copy(beacon.position);
scene.add(beaconLight);

// station floor markers
const stationMarkerTex = canvasTexture(128, 128, (g, w, h) => {
  g.strokeStyle = "#ffcc4d";
  g.lineWidth = 8;
  g.setLineDash([16, 10]);
  g.strokeRect(8, 8, w - 16, h - 16);
});
const stationMarkerMat = new THREE.MeshBasicMaterial({ map: stationMarkerTex, transparent: true, opacity: 0.8 });
const stationMarkers = [];
for (let i = 0; i < MAX_STATIONS; i++) {
  const m = floorDecal(1.5, 1.5, stationX(i), STATION_Z, stationMarkerMat);
  m.visible = false;
  stationMarkers.push(m);
}

// =====================================================
//  Particles (confetti + smoke)
// =====================================================
const particles = [];
const particleGeo = new THREE.PlaneGeometry(0.13, 0.13);
const particleMats = {};
const smokeTex = canvasTexture(64, 64, (g, w) => {
  const grad = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  grad.addColorStop(0, "rgba(200,200,200,0.9)");
  grad.addColorStop(1, "rgba(200,200,200,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, w, w);
});

function burst(pos, colors, count = 18, power = 5) {
  for (let i = 0; i < count; i++) {
    const color = colors[i % colors.length];
    particleMats[color] ??= new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
    const m = new THREE.Mesh(particleGeo, particleMats[color]);
    m.position.copy(pos);
    scene.add(m);
    particles.push({
      mesh: m, life: 1 + Math.random() * 0.5, type: "confetti",
      vel: new THREE.Vector3((Math.random() - 0.5) * power, Math.random() * power + 2, (Math.random() - 0.5) * power),
      spin: Math.random() * 10,
    });
  }
}

function puff(pos) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, opacity: 0.6, depthWrite: false }));
  s.position.copy(pos);
  s.scale.setScalar(0.5);
  scene.add(s);
  particles.push({ mesh: s, life: 1.5, type: "smoke", vel: new THREE.Vector3((Math.random() - 0.5) * 0.4, 1.2, 0) });
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    p.mesh.position.addScaledVector(p.vel, dt);
    if (p.type === "confetti") {
      p.vel.y -= 12 * dt;
      p.mesh.rotation.x += p.spin * dt;
      p.mesh.rotation.y += p.spin * dt;
      if (p.mesh.position.y < 0.02) { p.mesh.position.y = 0.02; p.vel.set(0, 0, 0); }
    } else {
      p.mesh.scale.addScalar(dt * 0.8);
      p.mesh.material.opacity = Math.max(0, p.life / 1.5) * 0.6;
    }
    if (p.life <= 0) {
      scene.remove(p.mesh);
      if (p.type === "smoke") p.mesh.material.dispose();
      particles.splice(i, 1);
    }
  }
}

// =====================================================
//  Models: workers, robots, trucks
// =====================================================
const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac];
const darkMat = mat(0x4a4466);
const capsuleGeo = new THREE.CapsuleGeometry(0.28, 0.45, 4, 10);
const headGeo = new THREE.SphereGeometry(0.21, 16, 12);
const hatGeo = new THREE.SphereGeometry(0.24, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);

// vest = role color, hat = hard hat color
function makeWorkerModel(vest = 0xff7a1a, hat = 0xffcc4d, prop = null) {
  const group = new THREE.Group();
  const vestMat = mat(vest);
  for (const x of [-0.13, 0.13]) addBox(group, 0.18, 0.75, 0.2, mat(0x2c3e60), x, 0.38, 0);
  const body = new THREE.Mesh(capsuleGeo, vestMat);
  body.position.y = 1.12;
  body.castShadow = true;
  addOutline(body, 0.1);
  group.add(body);
  addBox(group, 0.58, 0.05, 0.58, mat(0xdddddd, { metalness: 0.6 }), 0, 1.05, 0, false); // reflective stripe
  const head = new THREE.Mesh(headGeo, mat(SKIN[Math.floor(Math.random() * SKIN.length)]));
  head.position.y = 1.72;
  head.castShadow = true;
  addOutline(head, 0.1);
  group.add(head);
  const hardHat = new THREE.Mesh(hatGeo, mat(hat, { roughness: 0.4 }));
  hardHat.position.y = 1.78;
  group.add(hardHat);
  addBox(group, 0.5, 0.03, 0.5, mat(hat, { roughness: 0.4 }), 0, 1.79, 0.05, false);

  // arms on shoulder pivots so we can animate them
  const arms = [-0.36, 0.36].map(x => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 1.42, 0);
    addBox(pivot, 0.14, 0.55, 0.14, vestMat, 0, -0.27, 0);
    group.add(pivot);
    return pivot;
  });

  if (prop === "clipboard") addBox(arms[1], 0.25, 0.32, 0.03, mat(0xf5f5f5), 0.02, -0.5, 0.12, false);
  if (prop === "wrench") addBox(arms[1], 0.06, 0.4, 0.06, mat(0xaaaaaa, { metalness: 0.8 }), 0, -0.6, 0.08, false);
  if (prop === "tie") addBox(group, 0.08, 0.35, 0.03, mat(0xc0392b), 0, 1.3, 0.28, false);

  return { group, arms };
}

const robotYellow = mat(0xffcc4d, { metalness: 0.3, roughness: 0.45 });
function makeRobotModel() {
  const group = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 0.3, 24), darkMat);
  base.position.y = 0.15;
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 2.4, 16), robotYellow);
  pillar.position.y = 1.5;
  [base, pillar].forEach(m => { m.castShadow = true; addOutline(m, 0.08); group.add(m); });

  const pivot = new THREE.Group();
  pivot.position.y = 2.75;
  const joint = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12), darkMat);
  pivot.add(joint);
  addBox(pivot, 2.2, 0.22, 0.22, robotYellow, 1.1, 0, 0);
  addBox(pivot, 0.28, 0.5, 0.28, darkMat, 2.2, -0.3, 0);
  group.add(pivot);

  const light = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8),
    toon({ color: 0x2ecc71, emissive: 0x2ecc71, emissiveIntensity: 1 }));
  light.position.set(0, 3.05, 0);
  group.add(light);
  return { group, pivot, light };
}

const truckLogoTex = canvasTexture(512, 192, (g, w, h) => {
  g.fillStyle = "#f4f4f4";
  g.fillRect(0, 0, w, h);
  g.fillStyle = "#ff7b7b";
  g.fillRect(0, h - 34, w, 34);
  g.fillStyle = "#2b2340";
  g.font = `600 64px ${GAME_FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("📦 PACKAGE CO.", w / 2, h / 2 - 14);
});
const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.25, 16);
function makeTruckModel() {
  const group = new THREE.Group();
  const trailerMat = mat(0xffffff, { map: truckLogoTex, roughness: 0.5 });
  const plain = mat(0xf4f4f4, { roughness: 0.5 });
  const trailer = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.7, 1.6), [plain, plain, plain, plain, trailerMat, trailerMat]);
  trailer.position.set(-0.6, 1.25, 0);
  trailer.castShadow = true;
  addOutline(trailer, 0.04);
  group.add(trailer);
  addOutline(addBox(group, 1.2, 1.3, 1.5, mat(0xff7b7b), 1.75, 1.05, 0), 0.06); // cab
  addBox(group, 0.05, 0.5, 1.3, mat(0x1c2633, { roughness: 0.1, metalness: 0.6 }), 2.36, 1.35, 0, false); // windshield
  addBox(group, 4.6, 0.25, 1.2, darkMat, 0.1, 0.38, 0, false); // chassis
  for (const x of [-1.8, -1, 1.7]) for (const z of [-0.7, 0.7]) {
    const wheel = new THREE.Mesh(wheelGeo, mat(0x111111));
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(x, 0.32, z);
    group.add(wheel);
  }
  return group;
}

// little quad-copter that sorts from the air
const propGeo = new THREE.BoxGeometry(0.7, 0.03, 0.08);
function makeDroneModel() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), mat(0xb79cff));
  body.scale.y = 0.6;
  addOutline(body, 0.1);
  body.castShadow = true;
  group.add(body);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), new THREE.MeshBasicMaterial({ color: 0x7dffd0 }));
  eye.position.set(0, -0.02, 0.28);
  group.add(eye);
  const props = [];
  for (const [x, z] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]]) {
    addBox(group, 0.5, 0.06, 0.06, darkMat, x / 2, 0, z / 2, false).rotation.y = Math.atan2(z, x);
    const prop = new THREE.Mesh(propGeo, mat(0xffffff));
    prop.position.set(x, 0.1, z);
    group.add(prop);
    props.push(prop);
  }
  const claw = addBox(group, 0.12, 0.3, 0.12, darkMat, 0, -0.3, 0, false);
  return { group, props, claw };
}
