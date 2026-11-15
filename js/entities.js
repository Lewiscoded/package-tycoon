// =====================================================
//  entities.js: bins, packages, trucks, staff
// =====================================================

// =====================================================
//  Bins
// =====================================================
const clickableBins = [];
const miniBoxGeo = new THREE.BoxGeometry(0.42, 0.42, 0.42);
const palletMat = mat(0xd9a066);

const bins = ROUTES.map((route, i) => {
  const group = new THREE.Group();
  const binMat = mat(route.color, { roughness: 0.45 });

  addBox(group, BIN_SIZE + 0.2, 0.15, BIN_SIZE + 0.2, palletMat, 0, 0.075, 0); // pallet
  const parts = [
    [BIN_SIZE, WALL, BIN_SIZE, 0, 0.15 + WALL / 2, 0],
    [BIN_SIZE, BIN_HEIGHT, WALL, 0, 0.15 + BIN_HEIGHT / 2, BIN_SIZE / 2],
    [BIN_SIZE, BIN_HEIGHT, WALL, 0, 0.15 + BIN_HEIGHT / 2, -BIN_SIZE / 2],
    [WALL, BIN_HEIGHT, BIN_SIZE, BIN_SIZE / 2, 0.15 + BIN_HEIGHT / 2, 0],
    [WALL, BIN_HEIGHT, BIN_SIZE, -BIN_SIZE / 2, 0.15 + BIN_HEIGHT / 2, 0],
  ];
  for (const [w, h, d, x, y, z] of parts) {
    const m = addBox(group, w, h, d, binMat, x, y, z);
    m.userData.binIndex = i;
    addOutline(m, 0.04).userData.binIndex = i;
    clickableBins.push(m);
  }

  // fill gauge on the front of the bin
  const gaugeBg = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.14), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45 }));
  gaugeBg.position.set(0, 0.45, BIN_SIZE / 2 + WALL / 2 + 0.01);
  const gaugeFill = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.14), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  gaugeFill.position.set(0, 0.45, BIN_SIZE / 2 + WALL / 2 + 0.02);
  group.add(gaugeBg, gaugeFill);

  // floating sign
  const signCanvas = makeCanvas(256, 112);
  const signTex = new THREE.CanvasTexture(signCanvas);
  signTex.encoding = THREE.sRGBEncoding;
  const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: signTex, depthWrite: false }));
  sign.scale.set(1.9, 0.83, 1);
  sign.position.y = BIN_HEIGHT + 0.95;
  group.add(sign);

  scene.add(group);
  return {
    index: i, route, group, binMat, gaugeFill, signCanvas, signTex, signText: "",
    boxes: [], value: 0, reserved: 0,
    truckComing: false, // a truck is on the way to this bin's pallet
    anim: null,
  };
});

function binCount(bin) { return bin.boxes.length; }
function binFree(bin) { return capacity() - binCount(bin) - bin.reserved; }

function layoutBins() {
  const n = routesUnlocked();
  bins.forEach((b, i) => {
    b.group.visible = i < n;
    b.group.position.set((i - (n - 1) / 2) * 2.7 - 1, 0, BIN_Z);
  });
}

function drawBinSign(bin) {
  const n = binCount(bin), cap = capacity();
  const dark = today && today.blackout > 0;
  const text = dark ? `???|${n}/${cap}` : `${bin.route.name}|${n}/${cap}`;
  if (text !== bin.signText) {
    bin.signText = text;
    const g = bin.signCanvas.getContext("2d");
    g.clearRect(0, 0, 256, 112);
    // chunky cream sticker with an ink outline
    g.fillStyle = "#2b2340";
    g.beginPath(); g.roundRect(6, 12, 244, 94, 30); g.fill();      // drop shadow
    g.fillStyle = "#fff8ec";
    g.strokeStyle = "#2b2340";
    g.lineWidth = 7;
    g.beginPath(); g.roundRect(6, 4, 244, 92, 30); g.fill(); g.stroke();
    g.fillStyle = dark ? "#6b6385" : bin.route.color;
    g.beginPath(); g.arc(46, 50, 22, 0, Math.PI * 2); g.fill(); g.stroke();
    g.textBaseline = "middle";
    g.fillStyle = "#2b2340";
    g.font = `600 40px ${GAME_FONT}`;
    g.textAlign = "left";
    g.fillText(dark ? "???" : bin.route.name, 78, 52);
    g.font = `700 32px ${GAME_FONT}`;
    g.textAlign = "right";
    g.fillStyle = n >= cap ? "#e8505b" : "#8a819e";
    g.fillText(`${n}/${cap}`, 236, 52);
    bin.signTex.needsUpdate = true;
  }
  const fill = Math.min(1, n / cap);
  bin.gaugeFill.scale.x = Math.max(0.001, fill);
  bin.gaugeFill.position.x = -0.75 + 0.75 * fill;
  bin.gaugeFill.material.color.set(fill >= 1 ? 0xff7b7b : fill > 0.7 ? 0xffd166 : 0x5fd3a5);
}

function addBoxToBin(bin, value) {
  const i = bin.boxes.length;
  const layer = Math.floor(i / 9), r = i % 9;
  const m = new THREE.Mesh(miniBoxGeo, cardboardMats[i % cardboardMats.length]);
  m.position.set(((r % 3) - 1) * 0.5, 0.15 + WALL + 0.22 + layer * 0.44, (Math.floor(r / 3) - 1) * 0.5);
  m.rotation.y = (Math.random() - 0.5) * 0.4;
  m.castShadow = true;
  bin.group.add(m);
  bin.boxes.push(m);
  bin.value += value;
}

function clearBin(bin) {
  bin.boxes.forEach(m => bin.group.remove(m));
  bin.boxes = [];
  bin.value = 0;
  bin.reserved = 0;
  bin.truckComing = false;
  bin.signText = "";
}

// =====================================================
//  Packages
// =====================================================
const tapeMat = mat(0xe6c58f, { roughness: 0.6 });
const goldTapeMat = mat(0xffcc4d, { emissive: 0x332200, roughness: 0.35 });
const redTapeMat = mat(0xe74c3c, { roughness: 0.5 });
const blueTapeMat = mat(0x7cc6fe);
const labelMats = ROUTES.map(r => toon({ map: labelTexture(r.name, r.color) }));
const priorityMat = toon({ map: labelTexture("★ PRIORITY", "#ffcc4d", "#222", 48) });
const fragileMat = toon({ map: labelTexture("⚠ FRAGILE", "#e74c3c", "#fff", 48) });
const perishableMat = toon({ map: labelTexture("❄ PERISHABLE", "#7cc6fe", "#2b2340", 40) });
const STICKERS = { priority: priorityMat, fragile: fragileMat, perishable: perishableMat };
const TAPES = { standard: tapeMat, priority: goldTapeMat, fragile: redTapeMat, perishable: blueTapeMat };
const boxGeo = new THREE.BoxGeometry(PKG, PKG, PKG);
const tapeGeo = new THREE.BoxGeometry(PKG + 0.01, 0.02, 0.2);
const labelGeo = new THREE.PlaneGeometry(PKG * 0.75, PKG * 0.38);
const stickerGeo = new THREE.PlaneGeometry(PKG * 0.82, PKG * 0.22);

let packages = [];

function makePackage(routeIndex, type) {
  const group = new THREE.Group();
  const shade = 0.9 + Math.random() * 0.15;
  const body = new THREE.Mesh(boxGeo, mat(new THREE.Color(0xd9a066).multiplyScalar(shade)));
  body.castShadow = body.receiveShadow = true;
  addOutline(body, 0.07);
  group.add(body);

  const tape = new THREE.Mesh(tapeGeo, TAPES[type]);
  tape.position.y = PKG / 2;
  group.add(tape);

  const top = new THREE.Mesh(labelGeo, labelMats[routeIndex]);
  top.rotation.x = -Math.PI / 2;
  top.position.set(0, PKG / 2 + 0.015, 0.18);
  group.add(top);

  const front = new THREE.Mesh(labelGeo, labelMats[routeIndex]);
  front.position.set(0, type === "standard" ? 0 : -0.08, PKG / 2 + 0.01);
  group.add(front);

  if (type !== "standard") {
    const sticker = new THREE.Mesh(stickerGeo, STICKERS[type]);
    sticker.position.set(0, 0.28, PKG / 2 + 0.012);
    group.add(sticker);
  }

  const size = 0.85 + Math.random() * 0.25;
  group.scale.setScalar(size);

  const p = {
    mesh: group, body, routeIndex, type, baseScale: size,
    value: ROUTES[routeIndex].pay * PACKAGE_TYPES[type].payMult,
    state: "belt", t: 0,
  };
  body.userData.pkg = p;
  return p;
}

function removePackage(p) {
  scene.remove(p.mesh);
  p.body.material.dispose();
  packages = packages.filter(q => q !== p);
}

// =====================================================
//  Trucks
// =====================================================
let trucks = [];

function syncTrucks() {
  const want = truckCount();
  while (trucks.length < want) {
    const model = makeTruckModel();
    model.position.set(-30, 0, LANE_Z);
    model.visible = false;
    scene.add(model);
    trucks.push({ model, state: "idle", timer: 0, bin: null, cargo: null });
  }
  while (trucks.length > want) {
    const t = trucks.pop();
    scene.remove(t.model);
  }
}

function freeTruck() {
  return trucks.find(t => t.state === "idle");
}

function trucksAvailable() {
  return trucks.filter(t => t.state === "idle").length;
}

function nextTruckBack() {
  const away = trucks.filter(t => t.state === "away").map(t => t.timer);
  return away.length ? Math.min(...away) : 0;
}

// =====================================================
//  Staff (models standing in the warehouse)
// =====================================================
let stationStaff = [];   // sorters + robots, one per station
let crew = {};           // dispatcher / technician / manager models

const CREW_SPOTS = {
  dispatcher: new THREE.Vector3(10.5, 0, 5.2),
  technician: new THREE.Vector3(-14, 0, -2.6),
  manager:    new THREE.Vector3(-15.5, 0, -5),
};

function syncStaff() {
  // station staff: robots take the first stations, then sorters
  stationStaff.forEach(s => scene.remove(s.model.group));
  stationStaff = [];
  const roster = [
    ...Array(game.staff.robot).fill("robot"),
    ...Array(game.staff.sorter).fill("sorter"),
  ];
  roster.forEach((type, i) => {
    const model = type === "robot" ? makeRobotModel() : makeWorkerModel();
    model.group.position.set(stationX(i), 0, STATION_Z);
    model.group.traverse(o => (o.userData.staffIndex = i));
    scene.add(model.group);
    stationStaff.push({ type, station: i, model, cooldown: Math.random(), anim: 0, broken: false, repair: null, carrying: null });
  });

  stationMarkers.forEach((m, i) => (m.visible = i < stations() && i >= roster.length));

  // one-off crew members
  const looks = {
    dispatcher: [0x3498db, 0xffffff, "clipboard"],
    technician: [0x7f8c8d, 0xff8a1a, "wrench"],
    manager:    [0x2c3e50, 0xffffff, "tie"],
  };
  for (const role of Object.keys(looks)) {
    if (game.staff[role] && !crew[role]) {
      const model = makeWorkerModel(...looks[role]);
      model.group.position.copy(CREW_SPOTS[role]);
      model.group.rotation.y = role === "dispatcher" ? -Math.PI / 2 : Math.PI / 4;
      scene.add(model.group);
      crew[role] = { model, target: null, phase: Math.random() * 6 };
    } else if (!game.staff[role] && crew[role]) {
      scene.remove(crew[role].model.group);
      delete crew[role];
    }
  }
}

// =====================================================
//  Drones (fly over the belt, no station needed)
// =====================================================
let drones = [];

function syncDrones() {
  while (drones.length < game.staff.drone) {
    const model = makeDroneModel();
    const home = new THREE.Vector3(-6 + drones.length * 5, 4.2, -0.6);
    model.group.position.copy(home);
    scene.add(model.group);
    drones.push({ model, home, target: null, cooldown: 0.5, carrying: null, bob: Math.random() * 6 });
  }
  while (drones.length > game.staff.drone) scene.remove(drones.pop().model.group);
}
