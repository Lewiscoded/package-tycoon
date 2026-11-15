// =====================================================
//  ui.js: HUD, toasts, floating buttons, menus
// =====================================================
const $ = id => document.getElementById(id);
const fmt = n => "$" + Math.floor(n).toLocaleString();
const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// ---------- popups & toasts ----------
function toScreen(worldPos) {
  const v = worldPos.clone().project(camera);
  return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight, behind: v.z > 1 };
}

function popup(text, color, worldPos) {
  const s = toScreen(worldPos);
  const el = document.createElement("div");
  el.className = "popup";
  el.textContent = text;
  el.style.color = color;
  el.style.left = s.x + "px";
  el.style.top = s.y + "px";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 900);
}

function toast(html, kind = "", ms = 4000) {
  const box = $("toasts");
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.innerHTML = html;
  box.appendChild(el);
  while (box.children.length > 4) box.firstChild.remove();
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 300); }, ms);
}

let lastMoney = null;
const lastShown = {};
function popChip(id, value) {
  if (lastShown[id] !== undefined && lastShown[id] !== value) {
    const el = $(id);
    el.classList.remove("pop");
    void el.offsetWidth;
    el.classList.add("pop");
  }
  lastShown[id] = value;
}
function flashMoney(delta) {
  const el = $("money-delta");
  el.textContent = (delta > 0 ? "+" : "-") + fmt(Math.abs(delta));
  el.style.color = delta > 0 ? "var(--mint)" : "var(--coral)";
  el.classList.remove("show");
  void el.offsetWidth;
  el.classList.add("show");
}

// ---------- HUD ----------
function showHUD(show) {
  ["topbar", "side", "hint"].forEach(id => $(id).classList.toggle("hidden", !show || (id === "hint" && !settings.hints)));
  if (!show) {
    $("banner").classList.add("hidden");
    $("toasts").innerHTML = "";
    $("paused-banner").classList.add("hidden");
    $("world-ui").innerHTML = "";
    worldButtons.clear();
    closeManage();
  }
}

function updateHUD() {
  $("day").textContent = game.day;
  $("time-fill").style.width = (today.timeLeft / dayLength()) * 100 + "%";
  $("time-text").textContent = fmtTime(Math.max(0, today.timeLeft));

  const money = Math.floor(game.money);
  if (lastMoney !== null && money !== lastMoney) flashMoney(money - lastMoney);
  lastMoney = money;
  $("money").textContent = fmt(money);
  $("money").classList.toggle("bad", money < 0);
  popChip("chip-money", money);

  const rep = Math.round(game.rep);
  $("rep").textContent = rep;
  popChip("chip-rep", rep);
  const repFill = $("rep-fill");
  repFill.style.width = game.rep + "%";
  repFill.style.backgroundColor = game.rep > 60 ? "var(--mint)" : game.rep > 30 ? "var(--sun)" : "var(--coral)";

  $("trucks").textContent = `${trucksAvailable()}/${trucks.length}`;
  const rp = Math.floor(game.rp);
  $("rp").textContent = rp;
  popChip("chip-rp", rp);
  $("chip-rp").classList.toggle("glow", RESEARCH.some(r => researchState(r) === "open" && game.rp >= r.cost));

  document.querySelectorAll("#speed button").forEach(b =>
    b.classList.toggle("active", paused ? b.dataset.speed === "0" : Number(b.dataset.speed) === gameSpeed));
  $("paused-banner").classList.toggle("hidden", !paused || modalOpen());

  // banner for problems
  const problems = [];
  if (today.jam) problems.push("⚠ BELT JAMMED");
  const broken = stationStaff.filter(s => s.broken).length;
  if (broken) problems.push(`🤖 ${broken} robot${broken > 1 ? "s" : ""} down`);
  if (today.rush > 0) problems.push(`🔥 RUSH HOUR ${Math.ceil(today.rush)}s`);
  const banner = $("banner");
  banner.classList.toggle("hidden", problems.length === 0);
  banner.textContent = problems.join("   ·   ");
  banner.style.background = today.jam || broken ? "var(--coral)" : "var(--peach)";
}

function updateSideCards() {
  const c = today.contract;
  const route = ROUTES[c.routeIndex];
  $("contract").className = "sticker" + (c.done ? " done" : "");
  $("contract").innerHTML = `
    <h4>📝 Today's contract</h4>
    <div class="contract-goal"><span class="dot" style="background:${route.color}"></span>
      Sort ${c.target} packages to ${route.name}</div>
    <div class="progress"><div style="width:${Math.min(100, (c.progress / c.target) * 100)}%"></div></div>
    <div class="crew-row"><span class="muted">${c.done ? "✅ Completed!" : `${c.progress} / ${c.target}`}</span>
      <b class="good">+${fmt(c.reward)}</b></div>`;

  const sorters = stationStaff.filter(s => s.type === "sorter").length;
  const robots = stationStaff.filter(s => s.type === "robot").length;
  const droneRow = game.staff.drone ? `<div class="crew-row"><span>🛸 Drones</span><b>${game.staff.drone}</b></div>` : "";
  $("crew-card").innerHTML = `
    <h4>👷 Crew</h4>
    <div class="crew-row"><span>🧑‍🏭 Sorters</span><b>${sorters}</b></div>
    <div class="crew-row"><span>🤖 Robo-Sorters</span><b>${robots}</b></div>
    <div class="crew-row"><span>🏭 Stations</span><b>${sorters + robots}/${stations()}</b></div>
    ${droneRow}
    ${["dispatcher", "technician", "manager"].filter(r => game.staff[r]).map(r =>
      `<div class="crew-row"><span>${STAFF[r].icon} ${STAFF[r].name}</span><b>✔</b></div>`).join("")}
    ${game.staff.manager ? `<div class="crew-row" style="margin-top:4px"><span>Autopilot</span>
      <span class="pill ${game.autopilot ? "on" : ""}">${game.autopilot ? "ON" : "OFF"}</span></div>` : ""}
    <div class="crew-row"><span class="muted">Daily costs</span><b class="bad">-${fmt(dailyExpenses())}</b></div>`;
}

// ---------- floating buttons over the 3D world ----------
const worldButtons = new Map(); // key -> element

function worldButton(key, worldPos, text, { disabled = false, cls = "", onClick } = {}) {
  let el = worldButtons.get(key);
  if (!el) {
    el = document.createElement("button");
    el.className = "world-btn";
    el.addEventListener("pointerdown", e => e.stopPropagation());
    el.addEventListener("click", () => { Sound.unlock(); el._onClick && el._onClick(); });
    $("world-ui").appendChild(el);
    worldButtons.set(key, el);
  }
  el._onClick = onClick;
  el._seen = true;
  const s = toScreen(worldPos);
  el.style.left = s.x + "px";
  el.style.top = s.y + "px";
  if (el.textContent !== text) el.textContent = text;
  el.disabled = disabled;
  el.className = "world-btn " + cls;
}

function updateWorldButtons() {
  worldButtons.forEach(el => (el._seen = false));

  // ship buttons
  const keys = ["Q", "W", "E", "R", "T"];
  bins.slice(0, routesUnlocked()).forEach((bin, i) => {
    const pos = bin.group.position.clone().setY(BIN_HEIGHT + 1.75);
    const n = binCount(bin);
    let text, disabled = false, cls = "";
    if (bin.truckComing) { text = "🚚 Truck coming…"; disabled = true; }
    else if (n === 0) { text = `${keys[i]} · Empty`; disabled = true; }
    else if (!freeTruck()) { text = `No trucks · ${Math.ceil(nextTruckBack())}s`; disabled = true; }
    else {
      text = `${keys[i]} · Ship ${fmt(shipValue(bin))}`;
      if (binFree(bin) <= 0) cls = "full";
    }
    worldButton("ship" + i, pos, text, { disabled, cls, onClick: () => ship(bin) });
  });

  // repair buttons
  if (today.jam) {
    const label = today.jam.repair != null ? `🔧 Fixing… ${today.jam.repair.toFixed(1)}s` : "⚠ Fix belt jam";
    worldButton("jam", new THREE.Vector3(beltCenterX, BELT_TOP + 1.8, 0), label,
      { cls: "fix", disabled: today.jam.repair != null, onClick: startJamRepair });
  }
  stationStaff.forEach((s, i) => {
    if (!s.broken) return;
    const label = s.repair != null ? `🔧 ${s.repair.toFixed(1)}s` : "🔧 Repair";
    worldButton("robot" + i, s.model.group.position.clone().setY(3.6), label,
      { cls: "fix", disabled: s.repair != null, onClick: () => startRobotRepair(s) });
  });

  // remove buttons that weren't refreshed this frame
  worldButtons.forEach((el, key) => {
    if (!el._seen) { el.remove(); worldButtons.delete(key); }
  });
}

// =====================================================
//  Manage drawer (staff / upgrades / stats)
// =====================================================
let manageTab = "staff";

function openManage() {
  $("manage").classList.add("open");
  $("manage-btn").classList.add("active");
  document.body.classList.add("drawer-open");
  renderManage();
}
function closeManage() {
  const wasOpen = manageOpen();
  $("manage").classList.remove("open");
  $("manage-btn").classList.remove("active");
  document.body.classList.remove("drawer-open");
  if (wasOpen) onManageClosed();
}
function toggleManage() { $("manage").classList.contains("open") ? closeManage() : openManage(); }
function manageOpen() { return $("manage").classList.contains("open"); }

$("manage-btn").onclick = () => { Sound.play("click"); toggleManage(); };
$("manage-close").onclick = closeManage;
document.querySelectorAll(".tabs button").forEach(b => (b.onclick = () => {
  Sound.play("click");
  manageTab = b.dataset.tab;
  document.querySelectorAll(".tabs button").forEach(x => x.classList.toggle("active", x === b));
  renderManage();
}));

function dots(l, max) {
  return `<span class="lvl-dots">${Array.from({ length: max }, (_, i) => `<i class="${i < l ? "on" : ""}"></i>`).join("")}</span>`;
}

function renderManage() {
  const body = $("manage-body");
  if (manageTab === "staff") body.innerHTML = renderStaffTab();
  if (manageTab === "upgrades") body.innerHTML = renderUpgradesTab();
  if (manageTab === "stats") { body.innerHTML = renderStatsTab(); drawChart($("stats-chart"), game.history); }

  body.querySelectorAll("[data-hire]").forEach(b => (b.onclick = () => hire(b.dataset.hire)));
  if ($("do-franchise")) $("do-franchise").onclick = confirmFranchise;
  body.querySelectorAll("[data-fire]").forEach(b => (b.onclick = () => fire(b.dataset.fire)));
  body.querySelectorAll("[data-buy]").forEach(b => (b.onclick = () => buyUpgrade(b.dataset.buy)));
  body.querySelectorAll("[data-toggle]").forEach(b => (b.onclick = () => {
    game[b.dataset.toggle] = !game[b.dataset.toggle];
    Sound.play("click");
    renderManage();
    updateSideCards();
  }));
  refreshAffordability();
}

function renderStaffTab() {
  const used = game.staff.sorter + game.staff.robot;
  let html = `<div class="section-title">Belt stations: ${used}/${stations()} used</div>`;
  const colors = { sorter: "var(--peach)", robot: "var(--sun)", drone: "var(--lilac)", dispatcher: "var(--sky)", technician: "var(--mint)", manager: "var(--coral)" };
  for (const [id, s] of Object.entries(STAFF)) {
    const count = game.staff[id] || 0;
    const locked = s.research && !has(s.research);
    const full = s.station ? used >= stations() : count >= (s.max || 99);
    const label = locked ? `🔒 Research ${RESEARCH.find(r => r.id === s.research).name}`
      : full ? (s.station ? "No free station" : s.max === 1 ? "Hired" : "Maxed")
      : `Hire ${fmt(s.hire)}`;
    html += `
      <div class="item ${locked ? "locked" : ""}">
        <span class="big-ico" style="--c:${colors[id]}">${s.icon}</span>
        <div class="item-head"><span>${s.name}</span><span class="count">×${count}</span></div>
        <p>${s.desc}</p>
        <div class="item-foot">
          <button class="btn" data-hire="${id}" data-cost="${s.hire}" ${full || locked ? "disabled" : ""}>${label}</button>
          ${count ? `<button class="btn danger" data-fire="${id}">Let go</button>` : ""}
          <span class="muted">${fmt(s.wage * (has("hr") ? 0.8 : 1))}/day</span>
        </div>
      </div>`;
  }
  if (game.staff.manager) {
    html += `
      <div class="section-title">Manager controls</div>
      <div class="item">
        <div class="toggle-row"><span>🔁 Autopilot<br><small class="muted">Start the next day automatically</small></span>
          <button class="switch ${game.autopilot ? "on" : ""}" data-toggle="autopilot"></button></div>
        <div class="toggle-row"><span>💹 Auto-Invest<br><small class="muted">Spend spare cash on staff &amp; upgrades</small></span>
          <button class="switch ${game.autoInvest ? "on" : ""}" data-toggle="autoInvest"></button></div>
      </div>`;
  }
  return html;
}

function renderUpgradesTab() {
  const colors = ["var(--sun)", "var(--peach)", "var(--mint)", "var(--sky)", "var(--lilac)", "var(--coral)"];
  return UPGRADES.map((u, i) => {
    const l = lvl(u.id), maxed = l >= u.max, cost = u.cost(l);
    const [icon, ...rest] = u.name.split(" ");
    return `
      <div class="item">
        <span class="big-ico" style="--c:${colors[i % colors.length]}">${icon}</span>
        <div class="item-head"><span>${rest.join(" ")}</span>${dots(l, u.max)}</div>
        <p>${maxed ? "Fully upgraded." : u.desc(l)}</p>
        <div class="item-foot">
          <button class="btn" data-buy="${u.id}" ${maxed ? "disabled" : `data-cost="${cost}"`}>${maxed ? "MAX" : `Buy ${fmt(cost)}`}</button>
        </div>
      </div>`;
  }).join("");
}

function renderStatsTab() {
  const h = game.history;
  const best = h.reduce((m, d) => Math.max(m, d.income - d.expenses), 0);
  if (isVersus()) return renderStatsTabBody();
  const ready = canFranchise();
  const trophies = trophiesFor(game.totals.earned);
  return `
    <div class="item">
      <span class="big-ico" style="--c:var(--sun)">🏆</span>
      <div class="item-head"><span>Franchise</span><span class="count">${legacy.earned} 🏆</span></div>
      <p>Sell this company and start fresh with <b>+${Math.round(TROPHY_BONUS * 100)}% income per trophy</b>, forever.
        Spend trophies on Legacy Perks.
        ${ready ? `Selling now earns <b>${trophies} 🏆</b>.`
          : `Unlocks on day ${FRANCHISE_MIN_DAY} with ${fmt(FRANCHISE_MIN_EARNED)} earned (you: day ${game.day}, ${fmt(game.totals.earned)}).`}</p>
      <div class="item-foot"><button class="btn mint" id="do-franchise" ${ready && phase !== "day" ? "" : "disabled"}>
        ${ready ? (phase === "day" ? "Finish the day first" : `🏆 Franchise for ${trophies}`) : "Not yet"}</button></div>
    </div>
    ${renderStatsTabBody()}`;
}

function renderStatsTabBody() {
  const h = game.history;
  const best = h.reduce((m, d) => Math.max(m, d.income - d.expenses), 0);
  return `
    <div class="section-title">Profit history</div>
    <div class="item chart-wrap"><canvas id="stats-chart" width="680" height="300"></canvas>
      <div class="legend"><span style="color:#1f9e6e">● Income</span><span style="color:#e8505b">● Expenses</span></div></div>
    <div class="item ledger" style="max-width:none">
      <div><span>Days survived</span><b>${game.day - 1}</b></div>
      <div><span>Packages sorted (all time)</span><b>${game.totals.sorted.toLocaleString()}</b></div>
      <div><span>Money earned (all time)</span><b>${fmt(game.totals.earned)}</b></div>
      <div><span>Best day profit</span><b class="good">${fmt(best)}</b></div>
      <div><span>Shipments pay</span><b>×${payMultiplier().toFixed(2)} (reputation)</b></div>
      <div><span>Daily costs now</span><b class="bad">${fmt(dailyExpenses())}</b></div>
    </div>`;
}

function refreshAffordability() {
  document.querySelectorAll("#manage-body [data-cost]").forEach(b => {
    const cost = Number(b.dataset.cost);
    const blocked = !!b.dataset.hire && hireBlocked(b.dataset.hire);
    b.disabled = blocked || game.money < cost;
  });
}

function drawChart(canvas, history) {
  if (!canvas) return;
  const g = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height, pad = 30;
  g.clearRect(0, 0, W, H);
  const data = history.slice(-14);
  if (data.length === 0) {
    g.fillStyle = "#6b6385";
    g.font = `500 24px ${GAME_FONT}`;
    g.textAlign = "center";
    g.fillText("Finish a day to see your profits here", W / 2, H / 2);
    return;
  }
  const max = Math.max(50, ...data.map(d => Math.max(d.income, d.expenses)));
  const bw = (W - pad * 2) / data.length;
  g.strokeStyle = "#2b234022";
  g.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    const y = H - pad - ((H - pad * 2) * i) / 4;
    g.beginPath(); g.moveTo(pad, y); g.lineTo(W - pad, y); g.stroke();
  }
  data.forEach((d, i) => {
    const x = pad + i * bw;
    const hi = ((H - pad * 2) * d.income) / max;
    const he = ((H - pad * 2) * d.expenses) / max;
    const bar = (bx, h, color) => {
      g.fillStyle = color;
      g.strokeStyle = "#2b2340";
      g.lineWidth = 3;
      g.beginPath();
      g.roundRect(bx, H - pad - h, bw * 0.34, Math.max(h, 2), [8, 8, 0, 0]);
      g.fill();
      g.stroke();
    };
    bar(x + bw * 0.13, hi, "#5fd3a5");
    bar(x + bw * 0.53, he, "#ff7b7b");
    g.fillStyle = "#6b6385";
    g.font = `600 20px ${GAME_FONT}`;
    g.textAlign = "center";
    g.fillText(d.day, x + bw / 2, H - 8);
  });
}

// =====================================================
//  Modal menus
// =====================================================
function modalOpen() { return !$("modal").classList.contains("hidden"); }
function showModal(html, wide = false) {
  const panel = $("modal-panel");
  panel.innerHTML = html;
  panel.classList.toggle("wide", wide);
  panel.style.animation = "none";
  void panel.offsetWidth;
  panel.style.animation = "";
  $("modal").classList.remove("hidden");
}
function hideModal() { $("modal").classList.add("hidden"); }

function showTitle() {
  phase = "menu";
  showHUD(false);
  const saved = loadSave();
  const word = (w, cls) => [...w].map((ch, i) => `<span class="${cls}" style="animation-delay:${i * 0.08}s">${ch}</span>`).join("");
  showModal(`
    <div class="title-logo">
      <span class="box">📦</span>
      <h1>${word("Package", "a")}<br>${word("Tycoon", "b")}</h1>
    </div>
    <p>Sort packages, hire a cozy crew, research cool tech, and grow a shipping empire that runs itself.</p>
    ${legacy.earned ? `<div class="trophy-badge">🏆 ${legacy.earned} trophies · +${Math.round(TROPHY_BONUS * 100 * legacy.earned)}% income</div>` : ""}
    <div class="stack">
      ${saved ? `<button class="btn big mint" id="m-continue">▶ Continue: Day ${saved.day} · ${fmt(saved.money)}</button>` : ""}
      <button class="btn big ${saved ? "secondary" : ""}" id="m-new">✨ New company</button>
      <button class="btn big lilac" id="m-versus">⚔️ Play online (Versus)</button>
      ${legacy.franchises ? `<button class="btn lilac" id="m-perks">🏆 Legacy Perks (${legacy.trophies} to spend)</button>` : ""}
      <button class="btn secondary" id="m-help">❓ How to play</button>
    </div>`);
  if ($("m-perks")) $("m-perks").onclick = () => showPerks(showTitle);
  $("m-versus").onclick = () => { Sound.unlock(); Versus.showLobby(); };
  if (saved) $("m-continue").onclick = () => { Sound.unlock(); loadGame(saved); startDay(); };
  $("m-new").onclick = () => {
    Sound.unlock();
    if (saved && !confirm("Start over? Your saved company will be replaced.")) return;
    newGame();
    startDay();
  };
  $("m-help").onclick = () => showHelp(showTitle);
}

function showHelp(back) {
  showModal(`
    <h2>❓ How to play</h2>
    <ul class="howto">
      <li><b>Drag</b> packages off the belt into the bin with the matching city.</li>
      <li>Bins fill up. Press <b>Ship</b> (or <kbd>Q</kbd><kbd>W</kbd><kbd>E</kbd><kbd>R</kbd><kbd>T</kbd>) to load a truck and get paid.</li>
      <li>★ <b>Priority</b> packages pay 3×, ⚠ <b>Fragile</b> pay 2×. Missing them hurts your reputation more.</li>
      <li><b>Reputation</b> multiplies every payout (×0.5 to ×1.5). Missed packages, wrong bins and fumbles lower it. Hit 0 and you lose your contract.</li>
      <li>Rent, wages and truck upkeep are paid at the end of each day. Two nights in debt and you're bankrupt.</li>
      <li>Open <b>🏢 Manage</b> (<kbd>M</kbd>) any time to hire staff and buy upgrades.</li>
      <li>Belts jam and robots break: click the red <b>Fix</b> buttons or hire a Technician.</li>
      <li>Hire a <b>Manager</b> to unlock Autopilot and Auto-Invest, and the business runs itself.</li>
      <li>Sorting earns <b>🔬 Research Points</b>. Spend them in the <b>Research Lab</b> (<kbd>R</kbd>) on drones, new package types and more.</li>
      <li>Once you're big enough, <b>🏆 Franchise</b> (Manage → Stats): reset for trophies that boost income forever.</li>
      <li><kbd>Space</kbd> pause · <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> speed · <kbd>M</kbd> manage · <kbd>R</kbd> research · <kbd>Esc</kbd> menu · scroll to zoom.</li>
    </ul>
    <button class="btn big" id="m-back">Got it</button>`);
  $("m-back").onclick = back;
}

function showPauseMenu() {
  paused = true;
  showModal(`
    <h2>⏸ Paused</h2>
    <div class="stack">
      <button class="btn big" id="m-resume">▶ Resume</button>
      <button class="btn secondary" id="m-settings">⚙️ Settings</button>
      <button class="btn secondary" id="m-help">❓ How to play</button>
      <button class="btn danger" id="m-quit">🚪 Quit to title</button>
    </div>
    <p class="muted" style="font-size:.85rem">The game saves automatically at the end of each day. Quitting mid-shift restarts today.</p>`);
  $("m-resume").onclick = resumeFromMenu;
  $("m-settings").onclick = () => showSettings(showPauseMenu);
  $("m-help").onclick = () => showHelp(showPauseMenu);
  $("m-quit").onclick = () => { paused = false; clearWorld(); showTitle(); };
}

function resumeFromMenu() {
  hideModal();
  paused = false;
}

function showSettings(back) {
  const row = (key, label, sub) => `
    <div class="toggle-row" style="width:100%"><span style="text-align:left">${label}<br><small class="muted">${sub}</small></span>
      <button class="switch ${settings[key] ? "on" : ""}" data-setting="${key}"></button></div>`;
  showModal(`
    <h2>⚙️ Settings</h2>
    <div class="item" style="width:100%;max-width:380px">
      ${row("sound", "🔊 Sound effects", "Beeps and dings")}
      ${row("shadows", "🌗 Shadows", "Turn off if the game runs slowly")}
      ${row("hints", "💡 Control hints", "Bottom-of-screen key reminders")}
      ${row("pauseOnManage", "⏸ Pause while managing", "Freeze the belt when the Manage panel is open")}
    </div>
    <button class="btn big" id="m-back">Back</button>`);
  document.querySelectorAll("[data-setting]").forEach(b => (b.onclick = () => {
    settings[b.dataset.setting] = !settings[b.dataset.setting];
    applySettings();
    showSettings(back);
  }));
  $("m-back").onclick = back;
}

function showReport(r) {
  const net = r.income - r.expenses;
  showModal(`
    <h2>🌙 Day ${r.day} complete</h2>
    <div class="ledger">
      <div><span>Packages sorted</span><b>${r.sorted}</b></div>
      <div><span>Missed / wrong bin</span><b>${r.missed} / ${r.wrong}</b></div>
      <div><span>Fumbled by staff / turned away</span><b>${r.fumbles} / ${r.turnedAway}</b></div>
      <div><span>Shipping income</span><b class="good">+${fmt(r.shipping)}</b></div>
      ${r.bonus ? `<div><span>Contract bonus</span><b class="good">+${fmt(r.bonus)}</b></div>` : ""}
      ${r.interest ? `<div><span>📈 Investor interest</span><b class="good">+${fmt(r.interest)}</b></div>` : ""}
      <div><span>Rent</span><b class="bad">-${fmt(r.rent)}</b></div>
      ${r.wages ? `<div><span>Wages</span><b class="bad">-${fmt(r.wages)}</b></div>` : ""}
      <div><span>Truck upkeep</span><b class="bad">-${fmt(r.upkeep)}</b></div>
      <div class="total"><span>Profit</span><b class="${net >= 0 ? "good" : "bad"}">${net >= 0 ? "+" : "-"}${fmt(Math.abs(net))}</b></div>
      <div class="total"><span>Bank</span><b class="${game.money < 0 ? "bad" : ""}">${fmt(game.money)}</b></div>
      <div><span>Reputation</span><b>⭐ ${Math.round(game.rep)} (pays ×${payMultiplier().toFixed(2)})</b></div>
    </div>
    ${game.money < 0 ? `<p class="bad"><b>⚠ You're in debt!</b> Get back above $0 by the end of tomorrow or you go bankrupt.</p>` : ""}
    ${r.purchases.length ? `<p>👔 Your manager bought: <b>${r.purchases.join(", ")}</b></p>` : ""}
    <div class="chart-wrap"><canvas id="report-chart" width="680" height="300"></canvas>
      <div class="legend"><span style="color:#1f9e6e">● Income</span><span style="color:#e8505b">● Expenses</span></div></div>
    ${canFranchise() ? `<p>🏆 <b>You can franchise!</b> Open Manage → Stats to sell for ${trophiesFor(game.totals.earned)} trophies.</p>` : ""}
    <div class="row">
      <button class="btn secondary" id="m-manage">🏢 Manage</button>
      <button class="btn lilac" id="m-research">🔬 Research (${Math.floor(game.rp)})</button>
      <button class="btn big mint" id="m-next">Start Day ${game.day} ▶</button>
    </div>
    ${game.autopilot && game.staff.manager ? `<p class="muted" id="auto-msg">🔁 Autopilot: next day starts in <b id="auto-count">5</b>s</p>` : ""}`);
  drawChart($("report-chart"), game.history);
  showReport.last = r;
  $("m-research").onclick = () => { stopAutoCountdown(); showResearch(() => showReport(r)); };
  $("m-next").onclick = () => { stopAutoCountdown(); startDay(); };
  $("m-manage").onclick = () => {
    stopAutoCountdown();
    $("auto-msg")?.remove();
    openManage();
    $("modal").classList.add("hidden");
    $("manage").style.zIndex = 30;
    showReport.waitingForStart = true;
    toast("Close the Manage panel to start the next day.", "", 3000);
  };
  if (game.autopilot && game.staff.manager && !showReport.noAuto) startAutoCountdown(5);
  showReport.noAuto = false;
}

let autoTimer = null;
function startAutoCountdown(sec) {
  stopAutoCountdown();
  let left = sec;
  autoTimer = setInterval(() => {
    left--;
    if ($("auto-count")) $("auto-count").textContent = left;
    if (left <= 0) { stopAutoCountdown(); startDay(); }
  }, 1000);
}
function stopAutoCountdown() { clearInterval(autoTimer); autoTimer = null; }

function showGameOver(reason) {
  showModal(`
    <h1>💼 Out of business</h1>
    <p>${reason}</p>
    <div class="ledger">
      <div><span>Days in business</span><b>${game.day}</b></div>
      <div><span>Packages sorted</span><b>${game.totals.sorted.toLocaleString()}</b></div>
      <div><span>Money earned</span><b>${fmt(game.totals.earned)}</b></div>
    </div>
    <button class="btn big" id="m-again">Start a new company</button>`);
  $("m-again").onclick = () => { newGame(); startDay(); };
}

// =====================================================
//  Research Lab
// =====================================================
function showResearch(back) {
  const wasPaused = paused;
  paused = true;
  const render = () => {
    showModal(`
      <h2>🔬 Research Lab</h2>
      <p>You have <b>${Math.floor(game.rp)} RP</b>. Earn Research Points by sorting packages (special ones count double) and finishing contracts.</p>
      <div class="tree">
        ${RESEARCH_BRANCHES.map((b, bi) => `
          <div class="branch" style="--c:${b.color}">
            <div class="branch-head">${b.icon} ${b.name}</div>
            ${RESEARCH.filter(r => r.branch === bi).map(r => {
              const st = researchState(r);
              const foot = st === "done" ? `<span class="done-tag">✓ Researched</span>`
                : st === "locked" ? `<span class="muted">🔒 Needs ${RESEARCH.find(x => x.id === r.req).name}</span>`
                : `<button class="btn" data-research="${r.id}" ${game.rp < r.cost ? "disabled" : ""}>🔬 ${r.cost} RP</button>`;
              return `
                <div class="node ${st}">
                  <div class="node-top"><span class="node-ico">${r.icon}</span>${r.name}</div>
                  <p>${r.desc}</p>
                  ${foot}
                </div>`;
            }).join("")}
          </div>`).join("")}
      </div>
      <button class="btn big" id="r-close">Back to work ▶</button>`, true);
    document.querySelectorAll("[data-research]").forEach(b => (b.onclick = () => {
      if (doResearch(b.dataset.research)) {
        burst(new THREE.Vector3(-1, 4, 2), ["#ffd166", "#b79cff", "#5fd3a5", "#ff7b7b"], 30, 6);
        render();
      }
    }));
    $("r-close").onclick = () => {
      if (back) { showReport.noAuto = true; back(); }
      else { hideModal(); paused = wasPaused; }
    };
  };
  render();
}
$("chip-rp").onclick = () => { if (phase === "day") { Sound.play("click"); showResearch(); } };

// =====================================================
//  Franchise + Legacy Perks
// =====================================================
function confirmFranchise() {
  const gain = trophiesFor(game.totals.earned);
  closeManage();
  showModal(`
    <h2>🏆 Sell &amp; Franchise?</h2>
    <p>You'll start a brand-new company from Day 1. Money, staff, upgrades and research all reset.</p>
    <div class="ledger">
      <div><span>Trophies earned</span><b>+${gain} 🏆</b></div>
      <div><span>Income bonus after</span><b class="good">+${Math.round(TROPHY_BONUS * 100 * (legacy.earned + gain))}% forever</b></div>
      <div><span>Trophies to spend on perks</span><b>${legacy.trophies + gain}</b></div>
    </div>
    <div class="row">
      <button class="btn secondary" id="f-no">Not yet</button>
      <button class="btn big mint" id="f-yes">🏆 Franchise!</button>
    </div>`);
  $("f-no").onclick = () => showReport(showReport.last);
  $("f-yes").onclick = franchise;
}

function showFranchiseDone(gained) {
  burst(new THREE.Vector3(-1, 5, 2), ["#ffd166", "#ff7b7b", "#5fd3a5", "#7cc6fe", "#b79cff"], 60, 9);
  showModal(`
    <div class="title-logo"><span class="box">🏆</span></div>
    <h2>Franchise sold!</h2>
    <p>You earned <b>${gained} trophies</b>. Every new company now earns <b>+${Math.round(TROPHY_BONUS * 100 * legacy.earned)}% income</b>.</p>
    <button class="btn big mint" id="f-perks">Spend trophies ▶</button>`);
  $("f-perks").onclick = () => showPerks(null);
}

function showPerks(back) {
  const colors = ["var(--mint)", "var(--sun)", "var(--peach)", "var(--sky)", "var(--coral)"];
  showModal(`
    <h2>🏆 Legacy Perks</h2>
    <p>You have <b>${legacy.trophies} 🏆</b> to spend. Perks apply to every new company you start.</p>
    <div class="perk-grid">
      ${PERKS.map((p, i) => {
        const l = perk(p.id), maxed = l >= p.max;
        return `
          <div class="item">
            <span class="big-ico" style="--c:${colors[i]}">${p.icon}</span>
            <div class="item-head"><span>${p.name}</span>${dots(l, p.max)}</div>
            <p>${p.desc}</p>
            <button class="btn" data-perk="${p.id}" ${maxed || legacy.trophies < p.cost ? "disabled" : ""}>${maxed ? "MAX" : `${p.cost} 🏆`}</button>
          </div>`;
      }).join("")}
    </div>
    <div class="row">
      ${back ? `<button class="btn secondary" id="p-back">Back</button>` : ""}
      <button class="btn big mint" id="p-start">✨ Start new company</button>
    </div>`, true);
  document.querySelectorAll("[data-perk]").forEach(b => (b.onclick = () => { if (buyPerk(b.dataset.perk)) showPerks(back); }));
  if (back) $("p-back").onclick = back;
  $("p-start").onclick = () => {
    if (loadSave() && !confirm("Start over? Your saved company will be replaced.")) return;
    newGame();
    startDay();
  };
}

// redraw canvas signs once the cartoon font has loaded
if (document.fonts) document.fonts.ready.then(() => bins.forEach(b => (b.signText = "")));
