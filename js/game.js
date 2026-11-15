// =====================================================
//  game.js: game state, day cycle, AI, input, main loop
// =====================================================

let game = null;      // everything that gets saved
let today = null;     // resets every day
let phase = "menu";   // "menu" | "day" | "report" | "over"
let paused = false;
let gameSpeed = 1;

// =====================================================
//  Settings
// =====================================================
const settings = Object.assign(
  { sound: true, shadows: true, hints: true, pauseOnManage: false },
  (() => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) { return {}; } })()
);

function applySettings() {
  Sound.setEnabled(settings.sound);
  if (renderer.shadowMap.enabled !== settings.shadows) {
    renderer.shadowMap.enabled = settings.shadows;
    scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => (m.needsUpdate = true)); });
  }
  $("hint").classList.toggle("hidden", !settings.hints || phase !== "day");
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) {}
}

// =====================================================
//  Legacy (franchise trophies + perks): survives every reset
// =====================================================
const legacy = Object.assign(
  { trophies: 0, earned: 0, franchises: 0, perks: {} },
  (() => { try { return JSON.parse(localStorage.getItem(LEGACY_KEY)) || {}; } catch (e) { return {}; } })()
);
const perk = id => legacy.perks[id] || 0;
function saveLegacy() { try { localStorage.setItem(LEGACY_KEY, JSON.stringify(legacy)); } catch (e) {} }

function buyPerk(id) {
  const p = PERKS.find(x => x.id === id);
  if (perk(id) >= p.max || legacy.trophies < p.cost) return false;
  legacy.trophies -= p.cost;
  legacy.perks[id] = perk(id) + 1;
  saveLegacy();
  Sound.play("buy");
  return true;
}

// =====================================================
//  Save / load
// =====================================================
function newGame(mode = "career") {
  const versus = mode === "versus"; // online matches ignore legacy perks so it's fair
  game = {
    version: 2, mode, day: 1,
    money: versus ? VERSUS.startMoney : START_MONEY + 300 * perk("seed"),
    rep: versus ? 60 : Math.min(100, 60 + 10 * perk("rep")), debtDays: 0,
    staff: { sorter: versus ? 0 : perk("crew"), robot: 0, drone: 0, dispatcher: 0, technician: 0, manager: versus ? 0 : perk("partner") },
    up: {}, history: [], totals: { sorted: 0, earned: 0 },
    rp: 0, research: {},
    autopilot: !versus, autoInvest: !versus && perk("partner") > 0,
  };
  UPGRADES.forEach(u => (game.up[u.id] = 0));
}
const isVersus = () => !!(game && game.mode === "versus");

// small seeded random number generator: both players get the same packages
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function loadGame(saved) {
  newGame();
  const defaults = game;
  game = {
    ...defaults, ...saved,
    staff: { ...defaults.staff, ...saved.staff },
    up: { ...defaults.up, ...saved.up },
    totals: { ...defaults.totals, ...saved.totals },
    history: saved.history || [],
    research: saved.research || {},
    rp: saved.rp || 0,
  };
}

function save() { if (isVersus()) return; try { localStorage.setItem(SAVE_KEY, JSON.stringify(game)); } catch (e) {} }
function loadSave() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    return s && s.version === 2 ? s : null;
  } catch (e) { return null; }
}
function deleteSave() { if (isVersus()) return; try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }

// =====================================================
//  Derived stats (change the formulas to rebalance)
// =====================================================
const lvl = id => game.up[id] || 0;
const has = id => !!(game && game.research[id]);
const dayLength = () => DAY_LENGTH + (has("nightshift") && !isVersus() ? 30 : 0);
const incomeBonus = () => (isVersus() ? 1 : 1 + TROPHY_BONUS * legacy.earned);
const rpMultiplier = () => 1 + 0.25 * perk("notes");
const perishableChance = () => (has("perishables") ? 0.04 + 0.02 * lvl("marketing") : 0);
const routesUnlocked = () => START_ROUTES + lvl("route");
const capacity = () => 8 + 3 * lvl("capacity");
const stations = () => 2 + 2 * lvl("expansion");
const truckCount = () => 2 + lvl("fleet");
const tripTime = () => (14 - 2.5 * lvl("engines")) / (has("hub") ? 2 : 1);
const motorBoost = () => 1 + 0.12 * lvl("motor");
const beltSpeed = () => (1.5 + 0.06 * Math.min(game.day - 1, 10)) * motorBoost();
const spawnInterval = () => {
  let t = 2.5 / (1 + 0.3 * lvl("marketing")) / (1 + 0.07 * Math.min(game.day - 1, 15)) / motorBoost();
  if (today && today.rush > 0) t /= 2.2;
  return Math.max(0.35, t);
};
const priorityChance = () => 0.05 + 0.04 * lvl("marketing");
const fragileChance = () => 0.04 + 0.04 * lvl("marketing");
const sorterTime = () => 2.8 / (1 + 0.25 * lvl("training")) / (has("scanners") ? 1.2 : 1);
const sorterAccuracy = () => 1 - (1 - Math.min(0.995, 0.86 + 0.045 * lvl("training"))) * (has("scanners") ? 0.7 : 1);
const canHandleFragile = () => lvl("training") >= 2 || has("labeler");
const ROBOT_TIME = 1.1;
const breakChance = () => 0.035 / Math.pow(2, lvl("reliability"));
const rent = () => 30 + 8 * game.day;
const wages = () => Math.round(Object.keys(STAFF).reduce((sum, id) => sum + STAFF[id].wage * (game.staff[id] || 0), 0) * (has("hr") ? 0.8 : 1));
const upkeep = () => 10 * truckCount();
const dailyExpenses = () => rent() + wages() + upkeep();
const payMultiplier = () => 0.5 + game.rep / 100;

function shipValue(bin) {
  const full = binCount(bin) >= capacity();
  return Math.round(bin.value * payMultiplier() * incomeBonus() * (has("hub") ? 1.2 : 1) * (has("bulk") && full ? 1.25 : 1));
}

function addRP(amount) { game.rp += amount * rpMultiplier(); }

function changeRep(amount) {
  if (amount < 0 && has("loyalty")) amount /= 2;
  game.rep = Math.max(0, Math.min(100, game.rep + amount));
  if (game.rep <= 0 && phase === "day") endGame("Your reputation hit zero and the shipping contract was cancelled.");
}

function addMoney(amount) {
  game.money += amount;
  if (amount > 0) game.totals.earned += amount;
}

// =====================================================
//  Buying things
// =====================================================
function hireBlocked(id) {
  const s = STAFF[id];
  if (s.research && !has(s.research)) return true;
  if (s.station) return game.staff.sorter + game.staff.robot >= stations();
  return game.staff[id] >= (s.max || 99);
}

function hire(id, silent = false) {
  const s = STAFF[id];
  if (hireBlocked(id) || game.money < s.hire) return false;
  addMoney(-s.hire);
  game.staff[id]++;
  syncStaff();
  syncDrones();
  if (!silent) {
    Sound.play("buy");
    toast(`${s.icon} Hired a <b>${s.name}</b>`, "good");
    afterPurchase();
  }
  return true;
}

function fire(id) {
  if (!game.staff[id]) return;
  game.staff[id]--;
  if (id === "manager") game.autoInvest = false;
  syncStaff();
  syncDrones();
  Sound.play("click");
  toast(`${STAFF[id].icon} Let a ${STAFF[id].name} go`);
  afterPurchase();
}

function buyUpgrade(id, silent = false) {
  const u = UPGRADES.find(x => x.id === id);
  const l = lvl(id);
  if (l >= u.max || game.money < u.cost(l)) return false;
  addMoney(-u.cost(l));
  game.up[id]++;
  if (id === "route") { layoutBins(); toast(`🗺️ New route: <b>${ROUTES[routesUnlocked() - 1].name}</b> is open!`, "good"); }
  if (id === "fleet") syncTrucks();
  if (id === "expansion") syncStaff();
  if (!silent) {
    Sound.play("buy");
    afterPurchase();
  }
  return true;
}

function researchState(r) {
  if (has(r.id)) return "done";
  if (r.req && !has(r.req)) return "locked";
  return "open";
}

function doResearch(id, silent = false) {
  const r = RESEARCH.find(x => x.id === id);
  if (researchState(r) !== "open" || game.rp < r.cost) return false;
  game.rp -= r.cost;
  game.research[id] = true;
  if (id === "nightshift" && today && phase === "day") today.timeLeft += 30;
  if (!silent) {
    Sound.play("bonus");
    toast(`🔬 Researched <b>${r.name}</b>!`, "good");
    afterPurchase();
  }
  return true;
}

function afterPurchase() {
  if (manageOpen()) renderManage();
  if (phase === "day") updateSideCards();
  if (phase === "report") save();
}

// The manager spends spare cash at the end of each day.
function autoInvest() {
  const bought = [];
  const reserve = dailyExpenses() * 2 + 100;
  for (let k = 0; k < 4; k++) {
    const options = [];
    const add = (label, cost, prio, act) => { if (game.money - cost >= reserve) options.push({ label, cost, prio, act }); };
    if (!game.staff.dispatcher) add("Dispatcher", STAFF.dispatcher.hire, 1, () => hire("dispatcher", true));
    if (!game.staff.technician && (game.staff.robot || game.day >= 4)) add("Technician", STAFF.technician.hire, 2, () => hire("technician", true));
    if (!hireBlocked("sorter")) {
      const robotOk = lvl("reliability") >= 1 && game.money - STAFF.robot.hire >= reserve * 1.5;
      if (robotOk) add("Robo-Sorter", STAFF.robot.hire, 3, () => hire("robot", true));
      else add("Sorter", STAFF.sorter.hire, 3, () => hire("sorter", true));
    }
    if (truckCount() < routesUnlocked() && lvl("fleet") < 4) add("Truck", UPGRADES.find(u => u.id === "fleet").cost(lvl("fleet")), 4, () => buyUpgrade("fleet", true));
    UPGRADES.forEach(u => {
      if (lvl(u.id) < u.max) add(u.name.replace(/^\S+\s/, ""), u.cost(lvl(u.id)), 5, () => buyUpgrade(u.id, true));
    });
    if (has("drones") && !hireBlocked("drone")) add("Drone", STAFF.drone.hire, 3, () => hire("drone", true));
    if (!options.length) break;
    options.sort((a, b) => a.prio - b.prio || a.cost - b.cost);
    const pick = options[0];
    if (pick.act()) bought.push(pick.label);
  }
  // spend Research Points on the cheapest open research
  for (const r of RESEARCH.filter(r => researchState(r) === "open").sort((a, b) => a.cost - b.cost)) {
    if (doResearch(r.id, true)) bought.push("🔬 " + r.name);
  }
  return bought;
}

// =====================================================
//  Day cycle
// =====================================================
function clearWorld() {
  stopAutoCountdown();
  [...packages].forEach(removePackage);
  bins.forEach(clearBin);
  cargoTweens.forEach(c => c.m.parent && c.m.parent.remove(c.m));
  cargoTweens.length = 0;
  trucks.forEach(t => {
    (t.cargo || []).forEach(m => m.parent && m.parent.remove(m));
    Object.assign(t, { state: "idle", timer: 0, bin: null, cargo: null });
    t.model.visible = false;
  });
  if (today && today.blackout > 0) setBlackout(false);
  drones.forEach(d => { d.target = null; d.carrying = null; d.model.group.position.copy(d.home); });
  dragging = null;
  hoverPkg = null;
  techTask = null;
}

function startDay() {
  stopAutoCountdown();
  hideModal();
  $("manage").style.zIndex = "";
  showReport.waitingForStart = false;
  clearWorld();
  today = null;
  layoutBins();
  syncTrucks();
  syncStaff();
  syncDrones();

  // versus: seeded so both players get the same day; career: plain random
  const rng = isVersus() ? mulberry32(Versus.seed + game.day * 7919) : Math.random;
  const eventRng = isVersus() ? mulberry32(Versus.seed * 3 + game.day * 104729) : Math.random;
  const routeIndex = Math.floor(eventRng() * routesUnlocked());
  const expected = dayLength() / spawnInterval();
  const target = Math.max(6, Math.round((expected / routesUnlocked()) * 0.7));
  today = {
    timeLeft: dayLength(), spawnTimer: 0.5, rng, blackout: 0, shield: 0,
    jamTimes: Array.from({ length: eventRng() < 0.45 ? 0 : eventRng() < 0.7 ? 1 : 2 }, () => 15 + eventRng() * (dayLength() - 25)),
    shipping: 0, bonus: 0, sorted: 0, missed: 0, wrong: 0, fumbles: 0, turnedAway: 0,
    jam: null,
    rush: 0, rushAt: eventRng() < 0.45 ? 20 + eventRng() * (dayLength() - 45) : -1,
    contract: {
      routeIndex, target, progress: 0, done: false,
      reward: Math.round(target * ROUTES[routeIndex].pay * 2.5 * (has("brand") ? 1.5 : 1) * incomeBonus()),
    },
  };

  phase = "day";
  paused = false;
  lastMoney = null;
  showHUD(true);
  applySettings();
  updateSideCards();
  toast(isVersus()
    ? `⚔️ <b>Day ${game.day} of ${VERSUS.days}</b>: go go go! Contract: ${target} to ${ROUTES[routeIndex].name}.`
    : `☀️ <b>Day ${game.day}</b> begins. Contract: ${target} packages to ${ROUTES[routeIndex].name}.`);
}

function endDay() {
  // close up: everything left in the bins ships at the end of the day
  bins.slice(0, routesUnlocked()).forEach(b => ship(b, true));

  const r = {
    day: game.day, sorted: today.sorted, missed: today.missed, wrong: today.wrong,
    fumbles: today.fumbles, turnedAway: today.turnedAway,
    shipping: today.shipping, bonus: today.bonus,
    rent: rent(), wages: wages(), upkeep: upkeep(), purchases: [],
  };
  if (has("investors") && game.money > 0) {
    r.interest = Math.min(600, Math.round(game.money * 0.03));
    addMoney(r.interest);
  } else r.interest = 0;
  r.income = r.shipping + r.bonus + r.interest;
  r.expenses = r.rent + r.wages + r.upkeep;
  addMoney(-r.expenses);
  game.history.push({ day: r.day, income: r.income, expenses: r.expenses });
  if (game.history.length > 60) game.history.shift();

  if (game.money < 0) {
    game.debtDays++;
    if (game.debtDays >= 2) return endGame("Two nights in debt. The bank closed your warehouse.");
  } else game.debtDays = 0;

  if (game.staff.manager && game.autoInvest) r.purchases = autoInvest();

  game.day++;
  save();
  clearWorld();
  phase = "report";
  showHUD(false);
  Sound.play("dayEnd");
  if (isVersus()) Versus.onDayEnd(r);
  else showReport(r);
}

function endGame(reason) {
  if (isVersus()) {
    phase = "over";
    clearWorld();
    showHUD(false);
    Sound.play("miss");
    return Versus.onEliminated(reason);
  }
  phase = "over";
  deleteSave();
  clearWorld();
  showHUD(false);
  Sound.play("miss");
  showGameOver(reason);
}

// =====================================================
//  Franchise (prestige reset)
// =====================================================
function canFranchise() {
  return game.day >= FRANCHISE_MIN_DAY && game.totals.earned >= FRANCHISE_MIN_EARNED;
}

function franchise() {
  if (!canFranchise()) return;
  const gained = trophiesFor(game.totals.earned);
  legacy.trophies += gained;
  legacy.earned += gained;
  legacy.franchises++;
  saveLegacy();
  deleteSave();
  clearWorld();
  phase = "menu";
  showHUD(false);
  Sound.play("bonus");
  showFranchiseDone(gained);
}

function onManageClosed() {
  if (isVersus()) return Versus.onManageClosed();
  if (phase === "report" && showReport.waitingForStart) startDay();
}

// =====================================================
//  Packages: spawning, sorting, shipping
// =====================================================
function spawnPackage() {
  if (today.jam) {
    today.turnedAway++;
    changeRep(-1);
    popup("TURNED AWAY -1⭐", "#ff6b6b", new THREE.Vector3(BELT_START, BELT_TOP + 1, 0));
    return true;
  }
  const onBelt = packages.filter(p => p.state === "belt");
  const last = onBelt[onBelt.length - 1];
  if (last && last.mesh.position.x < BELT_START + PKG + 0.4) return false;

  const roll = today.rng();
  const pc = priorityChance(), fc = fragileChance(), ec = perishableChance();
  const type = roll < pc ? "priority" : roll < pc + fc ? "fragile" : roll < pc + fc + ec ? "perishable" : "standard";
  const p = makePackage(Math.floor(today.rng() * routesUnlocked()), type);
  p.mesh.position.set(BELT_START, BELT_TOP + (PKG * p.baseScale) / 2, (Math.random() - 0.5) * 0.6);
  p.mesh.rotation.y = (Math.random() - 0.5) * 0.3;
  scene.add(p.mesh);
  packages.push(p);
  return true;
}

function sendToBin(p, bin, by = "player") {
  p.state = "flying";
  p.t = 0;
  p.by = by;
  p.from = p.mesh.position.clone();
  p.to = bin.group.position.clone().setY(1.2);
  p.bin = bin;
  bin.reserved++;
}

function landInBin(p) {
  const bin = p.bin;
  bin.reserved--;
  addBoxToBin(bin, p.value);
  bin.anim = { type: "good", t: 0 };
  today.sorted++;
  game.totals.sorted++;
  addRP(RP_PER_PACKAGE * (p.type === "standard" ? 1 : 2));
  changeRep(PACKAGE_TYPES[p.type].repGain);
  if (p.type === "priority") {
    popup("★ PRIORITY", "#ffcc4d", p.mesh.position);
    burst(p.mesh.position, ["#ffcc4d", "#ffffff", bin.route.color], 16);
  }
  if (p.by === "player") Sound.play("drop");

  const c = today.contract;
  if (!c.done && p.routeIndex === c.routeIndex) {
    c.progress++;
    if (c.progress >= c.target) {
      c.done = true;
      addMoney(c.reward);
      today.bonus += c.reward;
      changeRep(5);
      addRP(RP_PER_CONTRACT);
      Sound.play("bonus");
      toast(`📝 Contract complete! <b class="good">+${fmt(c.reward)}</b>, +5⭐ and +${RP_PER_CONTRACT} 🔬`, "good");
      burst(bin.group.position.clone().setY(1.5), ["#ffcc4d", "#7dff9b", "#ffffff", "#3498db"], 40, 7);
    }
    updateSideCards();
  }
}

function knockOff(p, velocity) {
  p.state = "falling";
  p.t = 0;
  p.vel = velocity;
  p.spin = new THREE.Vector3(Math.random() * 6, 0, Math.random() * 6);
  p.body.material.emissive.setHex(0x000000);
}

function returnToBelt(p) {
  p.state = "returning";
  p.t = 0;
  p.from = p.mesh.position.clone();
  p.to = p.returnPos ? p.returnPos.clone() : p.from.clone().setY(BELT_TOP + PKG / 2);
}

function dropIntoBin(p, bin) {
  const pos = p.mesh.position;
  if (p.routeIndex !== bin.index) {
    popup("WRONG BIN -2⭐", "#ff6b6b", pos);
    Sound.play("wrong");
    bin.anim = { type: "bad", t: 0 };
    today.wrong++;
    changeRep(-2);
    returnToBelt(p);
  } else if (binFree(bin) <= 0) {
    popup("BIN FULL: SHIP IT!", "#ffcc4d", pos);
    Sound.play("wrong");
    bin.anim = { type: "bad", t: 0 };
    returnToBelt(p);
  } else {
    sendToBin(p, bin, "player");
  }
}

// ---------- shipping ----------
const cargoTweens = []; // { m, from, to, t, dur, removeAtEnd }

function tween(m, to, dur, removeAtEnd = false) {
  cargoTweens.push({ m, from: m.position.clone(), to, t: 0, dur, removeAtEnd });
}

function ship(bin, silent = false) {
  if (binCount(bin) === 0 || (!silent && bin.truckComing)) return;
  const truck = silent ? null : freeTruck();
  if (!silent && !truck) {
    popup("NO TRUCKS FREE", "#ffcc4d", bin.group.position.clone().setY(2));
    Sound.play("wrong");
    return;
  }
  const payout = shipValue(bin);
  addMoney(payout);
  today.shipping += payout;

  if (silent) {
    bin.boxes.forEach(m => bin.group.remove(m));
    bin.boxes = [];
    bin.value = 0;
    return;
  }

  popup(`+${fmt(payout)}`, "#7dff9b", bin.group.position.clone().setY(2.4));
  Sound.play("ship");

  // move the boxes out of the bin onto the pallet by the road
  const cargo = bin.boxes.splice(0);
  bin.value = 0;
  cargo.forEach((m, i) => {
    const world = new THREE.Vector3();
    m.getWorldPosition(world);
    bin.group.remove(m);
    m.position.copy(world);
    scene.add(m);
    const r = i % 9, layer = Math.floor(i / 9);
    tween(m, new THREE.Vector3(
      bin.group.position.x + ((r % 3) - 1) * 0.46,
      0.21 + layer * 0.43,
      PALLET_Z + (Math.floor(r / 3) - 1) * 0.42
    ), 0.35 + i * 0.015);
  });

  Object.assign(truck, { state: "arriving", bin, cargo, timer: 0 });
  truck.model.position.set(-34, 0, LANE_Z);
  truck.model.visible = true;
  bin.truckComing = true;
}

function updateTrucks(dt) {
  for (const t of trucks) {
    const m = t.model;
    if (t.state === "arriving") {
      const target = t.bin.group.position.x + 0.6;
      m.position.x = Math.min(target, m.position.x + 24 * dt);
      if (m.position.x >= target) {
        t.state = "loading";
        t.timer = 0.7;
        const dock = new THREE.Vector3(target - 0.6, 1.3, LANE_Z);
        t.cargo.forEach((box, i) => tween(box, dock.clone().add(new THREE.Vector3((i % 3) * 0.3 - 0.3, 0, 0)), 0.3 + i * 0.012, true));
      }
    } else if (t.state === "loading") {
      t.timer -= dt;
      if (t.timer <= 0) {
        t.state = "leaving";
        t.speed = 4;
        t.bin.truckComing = false;
        t.cargo = null;
      }
    } else if (t.state === "leaving") {
      t.speed = Math.min(30, t.speed + 25 * dt);
      m.position.x += t.speed * dt;
      if (m.position.x > 34) {
        t.state = "away";
        t.timer = tripTime();
        m.visible = false;
      }
    } else if (t.state === "away") {
      t.timer -= dt;
      if (t.timer <= 0) t.state = "idle";
    }
  }

  for (let i = cargoTweens.length - 1; i >= 0; i--) {
    const c = cargoTweens[i];
    c.t += dt / c.dur;
    const k = Math.min(1, c.t);
    c.m.position.lerpVectors(c.from, c.to, k);
    c.m.position.y += Math.sin(k * Math.PI) * 0.8;
    if (k >= 1) {
      if (c.removeAtEnd) c.m.parent && c.m.parent.remove(c.m);
      cargoTweens.splice(i, 1);
    }
  }
}

function jamBelt(sabotage = false) {
  if (today.jam) return;
  today.jam = { repair: null };
  Sound.play("alarm");
  toast(`${sabotage ? "😈 Your rival <b>jammed your belt!</b>" : "⚠ <b>The belt jammed!</b>"} ${game.staff.technician ? "Technician is on it." : "Click <b>Fix belt jam</b> before customers give up."}`, "bad");
}

// rival sabotage: labels and bin colors go dark for a while
function setBlackout(on, seconds = 8) {
  today.blackout = on ? seconds : 0;
  labelMats.forEach(m => m.color.set(on ? 0x1a1a1a : 0xffffff));
  bins.forEach(b => { b.binMat.color.set(on ? 0x6b6385 : b.route.color); b.signText = ""; });
}

// =====================================================
//  Staff AI
// =====================================================
let techTask = null; // { kind: "jam" } | { kind: "robot", s }

function startJamRepair() {
  if (!today.jam || today.jam.repair != null) return;
  today.jam.repair = 2;
  Sound.play("click");
}

function startRobotRepair(s) {
  if (!s.broken || s.repair != null) return;
  s.repair = 1.5;
  Sound.play("click");
}

function updateStationStaff(dt) {
  for (const s of stationStaff) {
    const sx = stationX(s.station);

    if (s.broken) {
      if (s.repair != null) {
        s.repair -= dt;
        if (s.repair <= 0) {
          s.broken = false;
          s.repair = null;
          if (techTask && techTask.s === s) techTask = null;
          Sound.play("fix");
          popup("🔧 FIXED", "#7dff9b", s.model.group.position.clone().setY(3.4));
        }
      }
      continue;
    }

    s.cooldown -= dt;
    if (s.cooldown > 0) continue;

    const reach = s.type === "robot" ? 3.2 : 2.6;
    let best = null;
    for (const p of packages) {
      if (p.state !== "belt") continue;
      const x = p.mesh.position.x;
      if (Math.abs(x - sx) > reach) continue;
      if (binFree(bins[p.routeIndex]) <= 0) continue;
      if (p.type === "fragile" && s.type === "sorter" && !canHandleFragile()) continue;
      if (!best || x > best.mesh.position.x) best = p;
    }
    if (!best) { s.cooldown = 0.15; continue; }

    s.anim = 1;
    if (s.type === "sorter" && Math.random() > sorterAccuracy()) {
      knockOff(best, new THREE.Vector3((Math.random() - 0.5) * 2, 3, 3));
      today.fumbles++;
      changeRep(-1);
      popup("FUMBLE -1⭐", "#ff6b6b", best.mesh.position);
    } else {
      sendToBin(best, bins[best.routeIndex], s.type);
      s.carrying = best;
    }
    s.cooldown = s.type === "robot" ? ROBOT_TIME : sorterTime();

    if (s.type === "robot" && Math.random() < breakChance()) {
      s.broken = true;
      s.repair = null;
      Sound.play("alarm");
      toast(`🤖 A Robo-Sorter broke down! ${game.staff.technician ? "Technician is on the way." : "Click <b>Repair</b> to fix it."}`, "bad");
    }
  }
}

function updateTechnician() {
  if (!game.staff.technician) return;
  if (techTask) {
    const stillNeeded = techTask.kind === "jam" ? today.jam : techTask.s.broken;
    if (!stillNeeded) techTask = null;
    else return;
  }
  if (today.jam && today.jam.repair == null) {
    today.jam.repair = 4;
    techTask = { kind: "jam" };
    return;
  }
  const brokenBot = stationStaff.find(s => s.broken && s.repair == null);
  if (brokenBot) {
    brokenBot.repair = 3.5;
    techTask = { kind: "robot", s: brokenBot };
  }
}

function updateDrones(dt) {
  for (const d of drones) {
    const pos = d.model.group.position;
    d.cooldown -= dt;
    if (d.target && d.target.state !== "belt") d.target = null;

    if (!d.target && d.cooldown <= 0) {
      let best = null;
      for (const p of packages) {
        if (p.state !== "belt" || drones.some(o => o.target === p)) continue;
        if (binFree(bins[p.routeIndex]) <= 0) continue;
        if (!best || p.mesh.position.x > best.mesh.position.x) best = p;
      }
      d.target = best;
    }

    const goal = d.target ? d.target.mesh.position.clone().setY(3) : d.home;
    const delta = goal.clone().sub(pos);
    const dist = delta.length();
    if (dist > 0.01) pos.addScaledVector(delta.normalize(), Math.min(dist, 10 * dt));

    if (d.target && Math.abs(pos.x - d.target.mesh.position.x) < 0.6 && Math.abs(pos.z - d.target.mesh.position.z) < 0.8) {
      sendToBin(d.target, bins[d.target.routeIndex], "drone");
      d.carrying = d.target;
      d.target = null;
      d.cooldown = 0.9;
    }
  }
}

function updateDispatcher() {
  if (!game.staff.dispatcher) return;
  for (const bin of bins.slice(0, routesUnlocked())) {
    const almostDone = today.timeLeft < 8 && binCount(bin) >= capacity() * 0.5;
    if ((binFree(bin) <= 0 || almostDone) && bin.reserved === 0 && !bin.truckComing && freeTruck()) ship(bin);
  }
}

// =====================================================
//  Simulation step (runs faster at 2× / 3×)
// =====================================================
function simulate(dt) {
  today.timeLeft -= dt;
  if (today.timeLeft <= 0) return endDay();

  // events
  const elapsedDay = dayLength() - today.timeLeft;
  if (today.rushAt >= 0 && elapsedDay >= today.rushAt) {
    today.rushAt = -1;
    today.rush = 15;
    Sound.play("alarm");
    toast("🔥 <b>Rush hour!</b> Packages are pouring in for 15s.", "bad");
  }
  if (today.rush > 0) today.rush -= dt;

  if (!today.jam && today.jamTimes.length && elapsedDay >= today.jamTimes[0]) {
    today.jamTimes.shift();
    jamBelt();
  }
  if (today.blackout > 0) { today.blackout -= dt; if (today.blackout <= 0) setBlackout(false); }
  if (today.shield > 0) today.shield -= dt;
  if (today.jam && today.jam.repair != null) {
    today.jam.repair -= dt;
    if (today.jam.repair <= 0) {
      today.jam = null;
      if (techTask && techTask.kind === "jam") techTask = null;
      Sound.play("fix");
      toast("🔧 Belt is running again.", "good", 2500);
    }
  }

  const speed = today.jam ? 0 : beltSpeed();
  beltTex.offset.x -= speed * dt;

  today.spawnTimer -= dt;
  if (today.spawnTimer <= 0) today.spawnTimer = spawnPackage() ? spawnInterval() : 0.1;
  if (phase !== "day") return;

  updateTechnician();
  updateStationStaff(dt);
  updateDrones(dt);
  updateDispatcher();
  if (phase !== "day") return;

  // packages
  for (const p of [...packages]) {
    const pos = p.mesh.position;
    if (p.state === "belt") {
      pos.x += speed * dt;
      if (pos.x > BELT_END + 0.3 && has("recycle") && !p.recycled) {
        p.recycled = true;
        popup("♻ LOOPED", "#7cc6fe", pos);
        pos.x = BELT_START;
        burst(pos.clone().setY(BELT_TOP + 0.5), ["#7cc6fe", "#ffffff"], 8, 3);
      } else if (pos.x > BELT_END + 0.3) {
        knockOff(p, new THREE.Vector3(speed, 1, 0));
        const loss = PACKAGE_TYPES[p.type].missRep;
        popup(`MISSED -${loss}⭐`, "#ff6b6b", pos);
        Sound.play("miss");
        today.missed++;
        changeRep(-loss);
        if (phase !== "day") return;
      }
    } else if (p.state === "flying") {
      p.t += dt / 0.42;
      const k = Math.min(p.t, 1);
      pos.lerpVectors(p.from, p.to, k);
      pos.y += Math.sin(k * Math.PI) * 2.2;
      p.mesh.rotation.y += dt * 6;
      p.mesh.scale.setScalar(p.baseScale * (1 - k * 0.5));
      if (k >= 1) { landInBin(p); removePackage(p); if (phase !== "day") return; }
    } else if (p.state === "returning") {
      p.t += dt / 0.25;
      const k = Math.min(p.t, 1);
      pos.lerpVectors(p.from, p.to, k);
      if (k >= 1) { p.state = "belt"; p.mesh.rotation.z = 0; }
    } else if (p.state === "falling") {
      p.t += dt;
      p.vel.y -= 20 * dt;
      pos.addScaledVector(p.vel, dt);
      p.mesh.rotation.x += p.spin.x * dt;
      p.mesh.rotation.z += p.spin.z * dt;
      if (pos.y < PKG / 2) {
        pos.y = PKG / 2;
        p.vel.multiplyScalar(0.3);
        p.vel.y = Math.abs(p.vel.y) * 0.3;
        p.spin.multiplyScalar(0.5);
      }
      if (p.t > 0.8) p.mesh.scale.setScalar(p.baseScale * Math.max(0.001, 1 - (p.t - 0.8) / 0.3));
      if (p.t > 1.1) removePackage(p);
    }
  }

  updateTrucks(dt);
}

// =====================================================
//  Visual-only animation (runs even while paused)
// =====================================================
let elapsed = 0;

function animate(dt) {
  elapsed += dt;
  updateParticles(dt);

  // held package follows the mouse
  if (dragging) {
    dragging.mesh.position.lerp(dragTarget, 1 - Math.exp(-25 * dt));
    dragging.mesh.rotation.z = Math.sin(elapsed * 6) * 0.06;
  }

  // package glow: hover, held, about to fall
  for (const p of packages) {
    const e = p.body.material.emissive;
    if (p === dragging || p === hoverPkg) e.setHex(0x333333);
    else if (p.state === "belt" && p.mesh.position.x > BELT_END - 3) e.setRGB((Math.sin(elapsed * 14) + 1) * 0.25, 0, 0);
    else e.setHex(0x000000);
  }

  // bins: bounce / shake / glow / signs
  for (const b of bins) {
    b.binMat.emissive.setHex(dragging && b === hoverBin ? 0x444444 : 0x000000);
    if (b.group.visible) drawBinSign(b);
    if (!b.anim) continue;
    b.anim.t += dt;
    const k = Math.min(b.anim.t / 0.3, 1);
    if (b.anim.type === "good") b.group.scale.setScalar(1 + Math.sin(k * Math.PI) * 0.08);
    else b.group.rotation.z = Math.sin(b.anim.t * 50) * 0.03 * (1 - k);
    if (k >= 1) { b.group.scale.setScalar(1); b.group.rotation.z = 0; b.anim = null; }
  }

  // jam beacon
  const jam = today && today.jam;
  const flash = jam ? (Math.sin(elapsed * 12) > 0 ? 1 : 0.15) : 0;
  beaconMat.emissive.setRGB(flash, 0.05 * flash, 0.05 * flash);
  beaconLight.intensity = flash * 2;

  // station staff
  for (const s of stationStaff) {
    s.anim = Math.max(0, s.anim - dt * 3);
    if (s.type === "sorter") {
      const g = s.model.group;
      g.position.y = Math.abs(Math.sin(elapsed * 3 + s.station)) * 0.03;
      s.model.arms.forEach(a => (a.rotation.x = -s.anim * 2.2));
      const p = s.carrying;
      const aim = p && p.state === "flying" ? p.mesh.position.x - g.position.x : 0;
      g.rotation.y += (Math.atan2(aim, 2) - g.rotation.y) * Math.min(1, dt * 10);
    } else {
      const p = s.carrying;
      const base = s.model.group.position;
      const target = p && p.state === "flying" ? p.mesh.position : new THREE.Vector3(base.x, 0, 0);
      const angle = Math.atan2(-(target.z - base.z), target.x - base.x);
      let diff = Math.atan2(Math.sin(angle - s.model.pivot.rotation.y), Math.cos(angle - s.model.pivot.rotation.y));
      s.model.pivot.rotation.y += diff * Math.min(1, dt * 12);
      const lightMat = s.model.light.material;
      if (s.broken) {
        const on = Math.sin(elapsed * 10) > 0;
        lightMat.color.set(0xff3030);
        lightMat.emissive.set(on ? 0xff3030 : 0x220000);
        if (Math.random() < dt * 4) puff(base.clone().setY(2.9));
      } else {
        lightMat.color.set(0x2ecc71);
        lightMat.emissive.set(0x2ecc71);
      }
    }
  }

  // crew
  for (const [role, c] of Object.entries(crew)) {
    const g = c.model.group;
    let goal = CREW_SPOTS[role];
    if (role === "technician" && techTask) {
      goal = techTask.kind === "jam"
        ? new THREE.Vector3(beltCenterX, 0, -1.9)
        : techTask.s.model.group.position.clone().add(new THREE.Vector3(1, 0, -0.6));
    }
    const delta = goal.clone().sub(g.position).setY(0);
    const dist = delta.length();
    const walking = dist > 0.1;
    if (walking) {
      const step = Math.min(dist, 6 * dt * (simPaused() ? 0 : gameSpeed));
      g.position.addScaledVector(delta.normalize(), step);
      g.rotation.y = Math.atan2(delta.x, delta.z);
    }
    const swing = walking && !simPaused() ? Math.sin(elapsed * 10) * 0.6 : Math.sin(elapsed * 2 + c.phase) * 0.05;
    c.model.arms[0].rotation.x = swing;
    c.model.arms[1].rotation.x = role === "technician" && techTask && !walking ? -1.2 + Math.sin(elapsed * 14) * 0.4 : -swing;
    g.position.y = walking ? Math.abs(Math.sin(elapsed * 10)) * 0.06 : 0;
  }

  // drones: spin propellers, bob
  for (const d of drones) {
    d.bob += dt;
    d.model.props.forEach((p, i) => (p.rotation.y += dt * (30 + i)));
    d.model.group.children[0].position.y = Math.sin(d.bob * 3) * 0.05;
    d.model.claw.scale.y = d.carrying && d.carrying.state === "flying" ? 0.5 : 1;
  }

  // trucks: wobble wheels a little
  trucks.forEach(t => { if (t.model.visible) t.model.position.y = Math.abs(Math.sin(elapsed * 20)) * 0.02; });
}

// =====================================================
//  Input
// =====================================================
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -DRAG_HEIGHT);
const binPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.9);
const dragTarget = new THREE.Vector3();
let dragging = null, hoverPkg = null, hoverBin = null;

function simPaused() {
  if (isVersus()) return false; // the clock never stops in a race
  return paused || modalOpen() || (settings.pauseOnManage && manageOpen());
}

function setMouse(e) {
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(mouse, camera);
}

function pickPackage() {
  const bodies = packages.filter(p => p.state === "belt").map(p => p.body);
  const hit = raycaster.intersectObjects(bodies)[0];
  return hit ? hit.object.userData.pkg || hit.object.parent.userData.pkg : null;
}

function visibleBinMeshes() { return clickableBins.filter(m => m.parent.visible); }

function binUnderMouse() {
  const hit = raycaster.intersectObjects(visibleBinMeshes())[0];
  if (hit) return bins[hit.object.userData.binIndex];
  const pt = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(binPlane, pt)) return null;
  return bins.slice(0, routesUnlocked()).find(b =>
    Math.abs(pt.x - b.group.position.x) < BIN_SIZE / 2 + 0.35 &&
    Math.abs(pt.z - b.group.position.z) < BIN_SIZE / 2 + 0.7) || null;
}

renderer.domElement.addEventListener("pointerdown", e => {
  Sound.unlock();
  if (phase !== "day" || simPaused() || e.button !== 0) return;
  setMouse(e);

  const p = pickPackage();
  if (p) {
    dragging = p;
    p.state = "held";
    p.returnPos = p.mesh.position.clone();
    raycaster.ray.intersectPlane(dragPlane, dragTarget);
    renderer.domElement.style.cursor = "grabbing";
    Sound.play("pick");
    return;
  }

  // broken robot?
  const robotMeshes = [];
  stationStaff.filter(s => s.broken).forEach(s => s.model.group.traverse(o => o.isMesh && robotMeshes.push(o)));
  const robotHit = raycaster.intersectObjects(robotMeshes)[0];
  if (robotHit) return startRobotRepair(stationStaff[robotHit.object.userData.staffIndex]);

  // jammed belt?
  if (today.jam && raycaster.intersectObject(belt)[0]) return startJamRepair();

  // bin → ship it
  const binHit = raycaster.intersectObjects(visibleBinMeshes())[0];
  if (binHit) ship(bins[binHit.object.userData.binIndex]);
});

addEventListener("pointermove", e => {
  if (phase !== "day") return;
  setMouse(e);
  if (dragging) {
    raycaster.ray.intersectPlane(dragPlane, dragTarget);
    hoverBin = binUnderMouse();
  } else if (!simPaused()) {
    hoverPkg = pickPackage();
    renderer.domElement.style.cursor = hoverPkg ? "grab" : "default";
  }
});

addEventListener("pointerup", () => {
  if (!dragging) return;
  const p = dragging;
  dragging = null;
  renderer.domElement.style.cursor = "default";
  if (phase !== "day") return;
  if (hoverBin) dropIntoBin(p, hoverBin);
  else returnToBelt(p);
  hoverBin = null;
});

function setSpeed(s) {
  Sound.play("click");
  if (isVersus()) return;
  if (s === 0) paused = !paused;
  else { gameSpeed = s; paused = false; }
}
document.querySelectorAll("#speed button").forEach(b => (b.onclick = () => setSpeed(Number(b.dataset.speed))));
$("menu-btn").onclick = () => { if (phase === "day") isVersus() ? Versus.showMenu() : showPauseMenu(); };

addEventListener("keydown", e => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();

  if (k === "escape") {
    if (manageOpen()) return closeManage();
    if (phase === "day") modalOpen() ? resumeFromMenu() : isVersus() ? Versus.showMenu() : showPauseMenu();
    return;
  }
  if (phase !== "day" && !(phase === "report" && k === "m")) return;
  if (modalOpen() && phase === "day") return;

  if (isVersus() && (k === " " || k === "1" || k === "2" || k === "3")) { if (k === " ") e.preventDefault(); return; }
  if (k === " ") { e.preventDefault(); setSpeed(0); }
  else if (k === "1" || k === "2" || k === "3") setSpeed(Number(k));
  else if (k === "m") toggleManage();
  else if (k === "r") showResearch();
  else {
    const i = ["q", "w", "e", "r", "t"].indexOf(k);
    if (i !== -1 && i < routesUnlocked()) ship(bins[i]);
  }
});

// pause automatically if the window loses focus
addEventListener("blur", () => { if (phase === "day" && !modalOpen() && !isVersus()) paused = true; });

// =====================================================
//  Main loop
// =====================================================
const clock = new THREE.Clock();
let uiTimer = 0;

function loop() {
  const dt = Math.min(clock.getDelta(), 0.1);

  if (phase === "day" && !simPaused()) {
    let simDt = dt * gameSpeed;
    while (simDt > 0 && phase === "day") {
      const step = Math.min(simDt, 1 / 30);
      simulate(step);
      simDt -= step;
    }
  }

  animate(dt);
  Versus.tick(dt);

  if (phase === "day") {
    updateHUD();
    updateWorldButtons();
    uiTimer -= dt;
    if (uiTimer <= 0) {
      uiTimer = 0.4;
      updateSideCards();
      if (manageOpen()) refreshAffordability();
    }
  } else if (phase === "report" && manageOpen()) {
    uiTimer -= dt;
    if (uiTimer <= 0) { uiTimer = 0.4; refreshAffordability(); }
  }

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

// =====================================================
//  Boot
// =====================================================
newGame();       // defaults so the title-screen scene has something to show
layoutBins();
syncTrucks();
applySettings();
showTitle();
loop();
