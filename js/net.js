// =====================================================
//  net.js: online 1v1 Versus mode
//
//  Each player runs their own warehouse. The two browsers talk
//  directly (WebRTC via PeerJS, encrypted) and only send small
//  messages: scores, sabotage attacks, emotes and "day done".
// =====================================================

const Versus = {
  active: false,
  peer: null,
  conn: null,
  isHost: false,
  code: "",
  seed: 0,
  name: "",
  opp: null,          // what we know about the rival
  me: null,           // our own per-match state
  sendTimer: 0,
  cooldowns: {},
  rematchVotes: { me: false, them: false },

  // ---------- lobby ----------
  showLobby() {
    this.name = this.name || (() => { try { return localStorage.getItem("packageTycoon.name") || ""; } catch (e) { return ""; } })();
    showModal(`
      <h2>⚔️ Versus Online</h2>
      <p>Race a friend over the internet! Same packages, same jams, ${VERSUS.days} days. Most money wins. Sabotage each other along the way.</p>
      <label class="field">Your name
        <input id="v-name" maxlength="14" placeholder="Warehouse boss" value="${escapeHtml(this.name)}">
      </label>
      <div class="vs-choice">
        <div class="item">
          <span class="big-ico" style="--c:var(--sun)">🏠</span>
          <div class="item-head"><span>Host a match</span></div>
          <p>Get a room code to send to your friend.</p>
          <button class="btn" id="v-host">Create room</button>
        </div>
        <div class="item">
          <span class="big-ico" style="--c:var(--sky)">🔑</span>
          <div class="item-head"><span>Join a match</span></div>
          <p>Type the code your friend sent you.</p>
          <div class="row" style="justify-content:flex-start">
            <input id="v-code" maxlength="6" placeholder="ABC123" class="code-input">
            <button class="btn" id="v-join">Join</button>
          </div>
        </div>
      </div>
      <p id="v-status" class="muted"></p>
      <button class="btn secondary" id="v-back">◀ Back</button>`);
    $("v-host").onclick = () => this.host();
    $("v-join").onclick = () => this.join($("v-code").value);
    $("v-code").onkeydown = e => { if (e.key === "Enter") this.join($("v-code").value); };
    $("v-back").onclick = () => { this.leave(); showTitle(); };
  },

  readName() {
    const input = $("v-name");
    this.name = (input && input.value.trim()) || "Player";
    try { localStorage.setItem("packageTycoon.name", this.name); } catch (e) {}
  },

  status(html) { const el = $("v-status"); if (el) el.innerHTML = html; },

  peerAvailable() {
    if (typeof Peer === "undefined") {
      this.status("❌ Couldn't load the networking library. Check your internet connection and reload.");
      return false;
    }
    return true;
  },

  host() {
    if (!this.peerAvailable()) return;
    this.readName();
    this.leave();
    this.isHost = true;
    this.code = makeRoomCode();
    this.status("⏳ Creating room…");
    this.peer = new Peer(VERSUS.peerPrefix + this.code);
    this.peer.on("open", () => {
      showModal(`
        <h2>🏠 Room created!</h2>
        <p>Send this code to your friend. The match starts as soon as they join.</p>
        <div class="room-code" id="v-code-big">${this.code}</div>
        <div class="row">
          <button class="btn" id="v-copy">📋 Copy code</button>
          <button class="btn secondary" id="v-cancel">Cancel</button>
        </div>
        <p class="muted waiting">Waiting for a friend to join<span class="dots"></span></p>`);
      $("v-copy").onclick = () => {
        navigator.clipboard?.writeText(this.code).then(() => toast("📋 Code copied!", "good", 2000)).catch(() => {});
      };
      $("v-cancel").onclick = () => { this.leave(); this.showLobby(); };
    });
    this.peer.on("connection", c => {
      if (this.conn) { c.on("open", () => { c.send({ t: "full" }); setTimeout(() => c.close(), 500); }); return; }
      this.setupConn(c);
    });
    this.peer.on("error", e => this.onPeerError(e));
  },

  join(rawCode) {
    if (!this.peerAvailable()) return;
    const code = String(rawCode || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length !== 6) return this.status("🤔 Room codes are 6 letters/numbers.");
    this.readName();
    this.leave();
    this.isHost = false;
    this.code = code;
    this.status("⏳ Connecting…");
    this.peer = new Peer();
    this.peer.on("open", () => {
      this.setupConn(this.peer.connect(VERSUS.peerPrefix + code, { reliable: true }));
    });
    this.peer.on("error", e => this.onPeerError(e));
  },

  onPeerError(e) {
    const type = e && e.type;
    if (type === "unavailable-id" && this.isHost) return this.host();     // code taken, pick another
    if (type === "peer-unavailable") return this.status("❌ No room with that code. Check it and try again.");
    if (type === "network" || type === "server-error" || type === "socket-error")
      return this.status("❌ Can't reach the matchmaking server. Check your internet and try again.");
    if (this.active) this.onDisconnect();
    else this.status(`❌ Connection problem (${type || "unknown"}). Try again.`);
  },

  setupConn(c) {
    this.conn = c;
    c.on("open", () => {
      this.send("hello", { name: this.name, v: 1, version: GAME_VERSION });
      if (this.isHost) {
        this.seed = Math.floor(Math.random() * 1e9);
        this.send("start", { seed: this.seed });
        this.startMatch();
      } else this.status("✅ Connected! Starting…");
    });
    c.on("data", msg => this.onMessage(msg));
    c.on("close", () => this.onDisconnect());
    c.on("error", () => this.onDisconnect());
  },

  send(t, data = {}) {
    if (this.conn && this.conn.open) this.conn.send({ t, ...data });
  },

  // ---------- incoming messages ----------
  onMessage(msg) {
    if (!msg || typeof msg !== "object") return;
    const o = this.opp;
    switch (msg.t) {
      case "hello":
        this.oppName = String(msg.name || "Rival").slice(0, 14);
        if (msg.version && msg.version !== GAME_VERSION) {
          toast(`⚠ ${escapeHtml(this.oppName)} is on v${escapeHtml(String(msg.version))}, you're on v${GAME_VERSION}. Both refresh the page so you match!`, "bad", 8000);
        }
        if (o) o.name = this.oppName;
        break;
      case "full":
        this.status("❌ That room already has two players.");
        this.leave();
        break;
      case "start":
        this.seed = Number(msg.seed) || 1;
        this.startMatch();
        break;
      case "state":
        if (o) Object.assign(o, {
          money: +msg.money || 0, rep: +msg.rep || 0, sorted: +msg.sorted || 0,
          day: +msg.day || 1, timeLeft: +msg.timeLeft || 0, phase: String(msg.phase || ""),
        });
        break;
      case "attack": this.receiveAttack(String(msg.kind)); break;
      case "blocked":
        toast(`🛡️ ${escapeHtml(o.name)} <b>blocked</b> your ${SABOTAGE.find(s => s.id === msg.kind)?.name || "attack"}!`, "bad");
        break;
      case "emote": this.showEmote(String(msg.e), false); break;
      case "dayDone":
        if (o) { o.dayDone = msg.r; o.money = +msg.r.money || o.money; }
        this.refreshDayScreen();
        break;
      case "ready":
        if (o) o.ready = +msg.day;
        this.maybeStartNextDay();
        break;
      case "eliminated":
        if (o) { o.eliminated = String(msg.reason || "went out of business"); }
        this.finishMatch();
        break;
      case "rematch":
        this.rematchVotes.them = true;
        this.maybeRematch();
        break;
      case "bye":
        this.onDisconnect();
        break;
    }
  },

  // ---------- match flow ----------
  startMatch() {
    this.active = true;
    this.cooldowns = {};
    this.rematchVotes = { me: false, them: false };
    this.opp = { name: this.oppName || "Rival", money: VERSUS.startMoney, rep: 60, sorted: 0, day: 1, timeLeft: DAY_LENGTH, dayDone: null, ready: 0 };
    this.me = { dayDone: null, ready: 0, eliminated: null, finished: false };
    newGame("versus");
    paused = false;
    startDay();
    this.buildHud();
    Sound.play("bonus");
  },

  onDayEnd(r) {
    r.money = Math.floor(game.money);
    r.rep = Math.round(game.rep);
    this.me.dayDone = r;
    this.send("dayDone", { r: { day: r.day, money: r.money, rep: r.rep, sorted: r.sorted, income: r.income, expenses: r.expenses } });
    this.hideHud();
    if (r.day >= VERSUS.days) this.finishMatch();
    else this.refreshDayScreen();
  },

  refreshDayScreen() {
    if (!this.active || !this.me || !this.me.dayDone || this.me.finished) return;
    if (this.me.dayDone.day >= VERSUS.days) return this.finishMatch();
    const me = this.me.dayDone, them = this.opp.dayDone && this.opp.dayDone.day === me.day ? this.opp.dayDone : null;
    const col = (who, r, isMe) => `
      <div class="vs-col ${isMe ? "me" : ""}">
        <div class="vs-name">${isMe ? "🧑 " : "😈 "}${escapeHtml(who)}</div>
        ${r ? `
          <div class="vs-money">${fmt(r.money)}</div>
          <div class="ledger">
            <div><span>Sorted</span><b>${r.sorted}</b></div>
            <div><span>Income</span><b class="good">+${fmt(r.income)}</b></div>
            <div><span>Expenses</span><b class="bad">-${fmt(r.expenses)}</b></div>
            <div><span>Reputation</span><b>⭐ ${r.rep}</b></div>
          </div>` : `<p class="muted waiting">Still working<span class="dots"></span></p>`}
      </div>`;
    showModal(`
      <h2>⚔️ Day ${me.day} of ${VERSUS.days} done</h2>
      <div class="vs-cols">${col(this.name, me, true)}<div class="vs-vs">VS</div>${col(this.opp.name, them, false)}</div>
      <p>Spend your money before the next day starts. Upgrades and staff count, but only <b>cash</b> wins.</p>
      <div class="row">
        <button class="btn secondary" id="v-manage">🏢 Manage</button>
        <button class="btn lilac" id="v-research">🔬 Research (${Math.floor(game.rp)})</button>
        <button class="btn big mint" id="v-ready" ${this.me.ready === me.day + 1 ? "disabled" : ""}>
          ${this.me.ready === me.day + 1 ? "Waiting for rival…" : `Ready for Day ${me.day + 1} ▶`}</button>
      </div>
      ${this.opp.ready === me.day + 1 ? `<p class="good"><b>${escapeHtml(this.opp.name)} is ready!</b></p>` : ""}`, true);
    $("v-ready").onclick = () => {
      this.me.ready = me.day + 1;
      this.send("ready", { day: me.day + 1 });
      this.refreshDayScreen();
      this.maybeStartNextDay();
    };
    $("v-manage").onclick = () => {
      openManage();
      $("modal").classList.add("hidden");
      $("manage").style.zIndex = 30;
      showReport.waitingForStart = false;
      Versus.managingBetweenDays = true;
    };
    $("v-research").onclick = () => showResearch(() => this.refreshDayScreen());
  },

  onManageClosed() {
    if (this.managingBetweenDays) { this.managingBetweenDays = false; this.refreshDayScreen(); }
  },

  maybeStartNextDay() {
    if (!this.active || !this.me) return;
    const next = game.day;
    if (this.me.ready === next && this.opp.ready === next && phase !== "day") {
      this.opp.dayDone = null;
      this.me.dayDone = null;
      closeManage();
      startDay();
      this.showHud();
    } else this.refreshDayScreen();
  },

  onEliminated(reason) {
    this.me.eliminated = reason;
    this.send("eliminated", { reason });
    this.finishMatch();
  },

  finishMatch() {
    if (!this.active || !this.me) return;
    const meDone = this.me.eliminated || (this.me.dayDone && this.me.dayDone.day >= VERSUS.days);
    const themDone = this.opp.eliminated || (this.opp.dayDone && this.opp.dayDone.day >= VERSUS.days);
    this.hideHud();
    if (phase === "day" && !this.opp.eliminated) return; // we're still playing
    if (phase === "day" && this.opp.eliminated) { clearWorld(); phase = "over"; showHUD(false); }

    if (!themDone && !this.me.eliminated) {
      showModal(`
        <h2>🏁 You're done!</h2>
        <p>Final cash: <b>${fmt(game.money)}</b>. Waiting for ${escapeHtml(this.opp.name)} to finish their last day<span class="dots"></span></p>
        <p class="muted">They have about ${Math.ceil(this.opp.timeLeft || 0)}s left.</p>`);
      return;
    }

    this.me.finished = true;
    const myMoney = this.me.eliminated ? -Infinity : Math.floor(game.money);
    const theirMoney = this.opp.eliminated ? -Infinity : (this.opp.dayDone ? this.opp.dayDone.money : this.opp.money);
    let result = myMoney > theirMoney ? "win" : myMoney < theirMoney ? "lose" : "tie";
    if (this.me.eliminated && this.opp.eliminated) result = "tie";
    const show = v => (v === -Infinity ? "💀 Bankrupt" : fmt(v));

    if (result === "win") {
      Sound.play("bonus");
      burst(new THREE.Vector3(-1, 5, 2), ["#ffd166", "#ff7b7b", "#5fd3a5", "#7cc6fe", "#b79cff"], 70, 9);
    } else Sound.play("miss");

    showModal(`
      <div class="title-logo"><span class="box">${result === "win" ? "🏆" : result === "lose" ? "📦💨" : "🤝"}</span></div>
      <h1>${result === "win" ? "You win!" : result === "lose" ? "You lost!" : "It's a tie!"}</h1>
      ${this.me.eliminated ? `<p>${escapeHtml(this.me.eliminated)}</p>` : ""}
      ${this.opp.eliminated ? `<p>${escapeHtml(this.opp.name)} ${escapeHtml(this.opp.eliminated)}</p>` : ""}
      <div class="vs-cols">
        <div class="vs-col me ${result === "win" ? "winner" : ""}"><div class="vs-name">🧑 ${escapeHtml(this.name)}</div><div class="vs-money">${show(myMoney)}</div></div>
        <div class="vs-vs">VS</div>
        <div class="vs-col ${result === "lose" ? "winner" : ""}"><div class="vs-name">😈 ${escapeHtml(this.opp.name)}</div><div class="vs-money">${show(theirMoney)}</div></div>
      </div>
      <div class="row">
        <button class="btn big mint" id="v-rematch">🔁 Rematch</button>
        <button class="btn secondary" id="v-leave">Leave</button>
      </div>
      <p id="v-rematch-status" class="muted"></p>`);
    $("v-rematch").onclick = () => {
      this.rematchVotes.me = true;
      this.send("rematch");
      $("v-rematch").disabled = true;
      this.maybeRematch();
    };
    $("v-leave").onclick = () => { this.leave(); showTitle(); };
    this.maybeRematch();
  },

  maybeRematch() {
    const el = $("v-rematch-status");
    if (this.rematchVotes.them && !this.rematchVotes.me && el) el.innerHTML = `<b>${escapeHtml(this.opp.name)} wants a rematch!</b>`;
    if (this.rematchVotes.me && !this.rematchVotes.them && el) el.textContent = "Waiting for your rival…";
    if (this.rematchVotes.me && this.rematchVotes.them && this.isHost) {
      this.seed = Math.floor(Math.random() * 1e9);
      this.send("start", { seed: this.seed });
      this.startMatch();
    }
  },

  onDisconnect() {
    if (!this.conn && !this.active) return;
    const wasActive = this.active;
    this.conn = null;
    if (!wasActive) return this.status("❌ Connection closed.");
    if (this.me && this.me.finished) {           // results already on screen: just disable rematch
      this.active = false;
      const btn = $("v-rematch"), st = $("v-rematch-status");
      if (btn) btn.disabled = true;
      if (st) st.textContent = `${this.opp.name} left the room.`;
      return;
    }
    this.active = false;
    this.hideHud();
    clearWorld();
    phase = "over";
    showHUD(false);
    showModal(`
      <h2>🔌 Connection lost</h2>
      <p>${escapeHtml(this.opp ? this.opp.name : "Your rival")} left the match or the connection dropped.</p>
      <button class="btn big" id="v-home">Back to title</button>`);
    $("v-home").onclick = () => { this.leave(); showTitle(); };
  },

  leave() {
    if (this.conn) { try { this.send("bye"); this.conn.close(); } catch (e) {} }
    if (this.peer) { try { this.peer.destroy(); } catch (e) {} }
    this.conn = null;
    this.peer = null;
    this.active = false;
    this.managingBetweenDays = false;
    this.hideHud();
    if (isVersus()) newGame(); // never leave a versus game object around for career mode
  },

  showMenu() {
    showModal(`
      <h2>⚔️ Match menu</h2>
      <p>The clock keeps running in a race. No pausing!</p>
      <div class="stack">
        <button class="btn big" id="v-resume">▶ Back to work</button>
        <button class="btn secondary" id="v-help">❓ How to play</button>
        <button class="btn danger" id="v-forfeit">🏳️ Forfeit &amp; leave</button>
      </div>`);
    $("v-resume").onclick = hideModal;
    $("v-help").onclick = () => showHelp(() => this.showMenu());
    $("v-forfeit").onclick = () => {
      this.send("eliminated", { reason: "forfeited the match" });
      this.leave();
      clearWorld();
      showTitle();
    };
  },

  // ---------- sabotage ----------
  useAbility(id) {
    const a = SABOTAGE.find(s => s.id === id);
    if (!this.active || phase !== "day" || !a) return;
    if ((this.cooldowns[id] || 0) > 0 || game.money < a.cost) { Sound.play("wrong"); return; }
    addMoney(-a.cost);
    this.cooldowns[id] = a.cooldown;
    if (id === "shield") {
      today.shield = 20;
      toast("🛡️ Shield up for 20s!", "good", 2500);
      Sound.play("fix");
    } else {
      this.send("attack", { kind: id });
      toast(`${a.icon} Sent <b>${a.name}</b> to ${escapeHtml(this.opp.name)}!`, "good", 2500);
      Sound.play("zap");
    }
  },

  receiveAttack(kind) {
    if (phase !== "day" || !today) return;
    if (today.shield > 0) {
      today.shield = 0;
      this.send("blocked", { kind });
      toast(`🛡️ Your shield blocked a <b>${SABOTAGE.find(s => s.id === kind)?.name || "sabotage"}</b>!`, "good");
      Sound.play("fix");
      return;
    }
    if (kind === "jam") jamBelt(true);
    if (kind === "flood") {
      today.rush = Math.max(today.rush, 10);
      Sound.play("alarm");
      toast("😈 Your rival sent a <b>junk flood</b>! 10s rush hour.", "bad");
    }
    if (kind === "blackout") {
      setBlackout(true, 8);
      Sound.play("alarm");
      toast("😈 <b>Blackout!</b> Your labels are hidden for 8s.", "bad");
    }
  },

  showEmote(e, mine) {
    if (!EMOTES.includes(e)) return;
    const el = document.createElement("div");
    el.className = "emote " + (mine ? "mine" : "theirs");
    el.textContent = e;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1800);
    Sound.play("pop");
  },

  // ---------- HUD ----------
  buildHud() {
    $("vs-card").classList.remove("hidden");
    $("ability-bar").innerHTML = SABOTAGE.map(a => `
      <button class="ability" data-ability="${a.id}" title="${a.desc}">
        <span class="a-ico">${a.icon}</span>
        <span class="a-name">${a.name}</span>
        <span class="a-cost">${fmt(a.cost)}</span>
        <span class="a-cd"></span>
      </button>`).join("") +
      `<span class="emote-row">${EMOTES.map(e => `<button class="emote-btn" data-emote="${e}">${e}</button>`).join("")}</span>`;
    $("ability-bar").querySelectorAll("[data-ability]").forEach(b => (b.onclick = () => this.useAbility(b.dataset.ability)));
    $("ability-bar").querySelectorAll("[data-emote]").forEach(b => (b.onclick = () => {
      this.send("emote", { e: b.dataset.emote });
      this.showEmote(b.dataset.emote, true);
    }));
    this.showHud();
  },
  showHud() {
    if (!this.active) return;
    ["vs-card", "ability-bar"].forEach(id => $(id).classList.remove("hidden"));
    $("hint").classList.add("hidden");
    $("speed").classList.add("hidden");
  },
  hideHud() {
    ["vs-card", "ability-bar"].forEach(id => $(id).classList.add("hidden"));
    $("speed").classList.remove("hidden");
  },

  tick(dt) {
    if (!this.active) return;
    for (const k in this.cooldowns) this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);

    this.sendTimer -= dt;
    if (this.sendTimer <= 0) {
      this.sendTimer = 0.5;
      this.send("state", {
        money: Math.floor(game.money), rep: Math.round(game.rep),
        sorted: today ? today.sorted : 0, day: game.day, timeLeft: today ? Math.max(0, today.timeLeft) : 0, phase,
      });
    }
    if (phase !== "day") return;

    // rival card
    const o = this.opp;
    const mine = Math.floor(game.money);
    const lead = mine - o.money;
    $("vs-card").innerHTML = `
      <div class="vs-row"><span class="vs-tag">😈 ${escapeHtml(o.name)}</span><span class="pill">Day ${o.day}/${VERSUS.days}</span></div>
      <div class="vs-row"><span>💰 <b>${fmt(o.money)}</b></span><span>⭐ <b>${o.rep}</b></span><span>📦 <b>${o.sorted}</b></span></div>
      <div class="lead ${lead >= 0 ? "ahead" : "behind"}">${lead >= 0 ? "▲ You lead by" : "▼ You trail by"} <b>${fmt(Math.abs(lead))}</b></div>`;

    // ability buttons
    $("ability-bar").querySelectorAll("[data-ability]").forEach(b => {
      const a = SABOTAGE.find(s => s.id === b.dataset.ability);
      const cd = this.cooldowns[a.id] || 0;
      b.disabled = cd > 0 || game.money < a.cost;
      b.querySelector(".a-cd").textContent = cd > 0 ? Math.ceil(cd) + "s" : "";
      b.classList.toggle("active", a.id === "shield" && today.shield > 0);
    });
  },
};

function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I mix-ups
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map(b => chars[b % chars.length]).join("");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
