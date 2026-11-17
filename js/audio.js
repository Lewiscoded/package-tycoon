// =====================================================
//  audio.js: all music and sound effects, made live with
//  the Web Audio API (no audio files, no copyright issues)
//
//  Music: a generative lo-fi loop. A scheduler plays notes
//  slightly ahead of time, so it loops forever with no gap.
// =====================================================
const Sound = (() => {
  let ctx = null;
  let master, musicBus, musicFilter, sfxBus, keysTremolo, crackleSrc, beltGain, beltSrc;
  let enabled = true, musicVol = 0.5, sfxVol = 0.8;
  const lastPlayed = {};

  const midi = m => 440 * Math.pow(2, (m - 69) / 12);

  // ---------- setup ----------
  function ensure() {
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
      build();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function build() {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    master = ctx.createGain();
    master.gain.value = enabled ? 1 : 0;
    master.connect(comp).connect(ctx.destination);

    musicFilter = ctx.createBiquadFilter();
    musicFilter.type = "lowpass";
    musicFilter.frequency.value = 2400;
    musicBus = ctx.createGain();
    musicBus.gain.value = musicVol * 1.6;
    musicFilter.connect(musicBus).connect(master);

    sfxBus = ctx.createGain();
    sfxBus.gain.value = sfxVol * 1.6;
    sfxBus.connect(master);

    // gentle wobble on the electric piano
    keysTremolo = ctx.createGain();
    keysTremolo.gain.value = 0.9;
    const lfo = ctx.createOscillator();
    const lfoDepth = ctx.createGain();
    lfo.frequency.value = 4.2;
    lfoDepth.gain.value = 0.1;
    lfo.connect(lfoDepth).connect(keysTremolo.gain);
    lfo.start();
    keysTremolo.connect(musicFilter);

    // vinyl crackle: a looped buffer of hiss with random pops
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * 0.04;
      if (Math.random() < 0.0004) d[i] += (Math.random() * 2 - 1) * 0.9;
    }
    crackleSrc = ctx.createBufferSource();
    crackleSrc.buffer = buf;
    crackleSrc.loop = true;
    const crackleFilter = ctx.createBiquadFilter();
    crackleFilter.type = "bandpass";
    crackleFilter.frequency.value = 2500;
    const crackleGain = ctx.createGain();
    crackleGain.gain.value = 0.35;
    crackleSrc.connect(crackleFilter).connect(crackleGain).connect(musicFilter);
    crackleSrc.start();

    // conveyor hum: low rumble whose volume follows the belt
    beltSrc = ctx.createBufferSource();
    beltSrc.buffer = noiseBuffer(2);
    beltSrc.loop = true;
    const beltLow = ctx.createBiquadFilter();
    beltLow.type = "lowpass";
    beltLow.frequency.value = 160;
    beltGain = ctx.createGain();
    beltGain.gain.value = 0;
    beltSrc.connect(beltLow).connect(beltGain).connect(sfxBus);
    beltSrc.start();

    startMusic();
  }

  let noiseCache = null;
  function noiseBuffer(seconds = 1) {
    if (noiseCache && seconds <= 1) return noiseCache;
    const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    if (seconds <= 1) noiseCache = b;
    return b;
  }

  // =====================================================
  //  Music: generative lo-fi
  // =====================================================
  const BPM = 76;
  const BEAT = 60 / BPM;
  const EIGHTH = BEAT / 2;
  // 8-bar progression: Fmaj7 Em7 Dm7 Cmaj9 | Fmaj7 Em7 Am7 G6
  const CHORDS = [
    { bass: 41, notes: [53, 57, 60, 64] },
    { bass: 40, notes: [52, 55, 59, 62] },
    { bass: 38, notes: [50, 53, 57, 60] },
    { bass: 36, notes: [52, 55, 59, 62] },
    { bass: 41, notes: [53, 57, 60, 64] },
    { bass: 40, notes: [52, 55, 59, 62] },
    { bass: 45, notes: [55, 57, 60, 64] },
    { bass: 43, notes: [55, 59, 62, 64] },
  ];
  const MELODY = [72, 74, 76, 79, 81, 84, 86]; // C major pentatonic
  let mode = "calm";            // "full" (drums) | "calm" (menus) | "muffled" (paused)
  let step = 0, nextTime = 0, melodyIdx = 3, timer = null;

  function startMusic() {
    nextTime = ctx.currentTime + 0.1;
    timer = setInterval(scheduler, 25);
  }

  function scheduler() {
    if (!ctx || ctx.state !== "running") return;
    if (nextTime < ctx.currentTime - 0.3) nextTime = ctx.currentTime + 0.05; // tab was asleep: skip ahead
    while (nextTime < ctx.currentTime + 0.15) {
      playStep(step, nextTime);
      nextTime += EIGHTH;
      step = (step + 1) % 64; // 8 bars × 8 eighths
    }
  }

  function playStep(s, t) {
    const bar = Math.floor(s / 8), e = s % 8;
    const chord = CHORDS[bar];
    const swing = e % 2 === 1 ? EIGHTH * 0.18 : 0;  // laid-back swing
    const time = t + swing;
    const drums = mode === "full";

    // electric piano chords
    if (e === 0) chord.notes.forEach((n, i) => keys(n, time + i * 0.012, 0.055, 2.6));
    if (e === 5) chord.notes.slice(1).forEach((n, i) => keys(n, time + i * 0.01, 0.03, 1.4));

    // bass
    if (e === 0) bass(chord.bass, time, BEAT * 1.8);
    if (e === 5 && drums) bass(chord.bass + (Math.random() < 0.3 ? 7 : 0), time, BEAT * 0.9);

    // sparse melody (random walk over the pentatonic scale)
    const chance = drums ? 0.2 : 0.1;
    if (e !== 0 && Math.random() < chance) {
      melodyIdx = Math.max(0, Math.min(MELODY.length - 1, melodyIdx + Math.floor(Math.random() * 5) - 2));
      bell(MELODY[melodyIdx], time, 0.035);
    }

    // drums
    if (drums) {
      if (e === 0 || (e === 5 && bar % 2 === 1)) kick(time);
      if (e === 2 || e === 6) snare(time);
      hat(time, e % 2 === 0 ? 0.035 : 0.02);
    }
  }

  function keys(m, t, vol, len) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    g.connect(keysTremolo);
    const f = midi(m);
    for (const [ratio, type, amt, detune] of [[1, "sine", 1, -4], [1, "triangle", 0.35, 5], [2, "sine", 0.12, 0]]) {
      const o = ctx.createOscillator();
      const og = ctx.createGain();
      o.type = type;
      o.frequency.value = f * ratio;
      o.detune.value = detune;
      og.gain.value = amt;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + len + 0.05);
    }
  }

  function bass(m, t, len) {
    const o = ctx.createOscillator();
    const lp = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = "triangle";
    o.frequency.value = midi(m);
    lp.type = "lowpass";
    lp.frequency.value = 380;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(lp).connect(g).connect(musicFilter);
    o.start(t);
    o.stop(t + len + 0.05);
  }

  function bell(m, t, vol) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    g.connect(musicFilter);
    for (const [ratio, amt] of [[1, 1], [3.01, 0.15]]) {
      const o = ctx.createOscillator();
      const og = ctx.createGain();
      o.type = "sine";
      o.frequency.value = midi(m) * ratio;
      og.gain.value = amt;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + 1.7);
    }
  }

  function kick(t) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.45, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(musicFilter);
    o.start(t);
    o.stop(t + 0.4);
  }

  function snare(t) {
    noiseHit(t, "bandpass", 1700, 0.09, 0.16, musicFilter);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "triangle";
    o.frequency.value = 185;
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(g).connect(musicFilter);
    o.start(t);
    o.stop(t + 0.12);
  }

  function hat(t, vol) { noiseHit(t, "highpass", 7500, vol, 0.045, musicFilter); }

  function noiseHit(t, type, freq, vol, len, dest, sweepTo = 0, pan = 0) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer();
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    src.connect(f).connect(g);
    connectPanned(g, dest, pan);
    src.start(t, Math.random() * 0.5);
    src.stop(t + len + 0.05);
  }

  function connectPanned(node, dest, pan) {
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      node.connect(p).connect(dest);
    } else node.connect(dest);
  }

  // =====================================================
  //  Sound effects
  // =====================================================
  function tone(freq, dur, type = "sine", vol = 0.12, slide = 0, delay = 0, pan = 0) {
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    connectPanned(g, sfxBus, pan);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  const noise = (type, freq, vol, len, sweepTo = 0, delay = 0, pan = 0) =>
    noiseHit(ctx.currentTime + delay, type, freq, vol, len, sfxBus, sweepTo, pan);
  const vary = (x, amt = 0.08) => x * (1 + (Math.random() * 2 - 1) * amt);

  // each entry: (o) => play, where o = { pan, vol }
  const sfx = {
    click:   o => tone(800, 0.04, "triangle", 0.05, 0, 0, o.pan),
    pick:    o => tone(520, 0.08, "triangle", 0.1, 200, 0, o.pan),
    drop:    o => { tone(660, 0.1, "triangle", 0.1, 0, 0, o.pan); tone(990, 0.12, "triangle", 0.08, 0, 0.06, o.pan); },
    wrong:   o => tone(170, 0.25, "sawtooth", 0.06, -60, 0, o.pan),
    miss:    o => tone(110, 0.3, "square", 0.04, -50, 0, o.pan),
    thud:    o => { tone(vary(90), 0.18, "sine", 0.22, -40, 0, o.pan); noise("lowpass", 600, 0.12, 0.12, 0, 0, o.pan); },
    ship:    o => { tone(880, 0.08, "square", 0.04, 0, 0, o.pan); tone(1320, 0.15, "square", 0.04, 0, 0.08, o.pan); coins(o.pan); },
    buy:     () => [523, 659, 784].forEach((f, i) => tone(f, 0.14, "triangle", 0.1, 0, i * 0.08)),
    alarm:   () => { tone(720, 0.15, "square", 0.04); tone(520, 0.15, "square", 0.04, 0, 0.18); },
    fix:     o => { tone(1400, 0.05, "square", 0.04, 0, 0, o.pan); tone(1700, 0.05, "square", 0.04, 0, 0.07, o.pan); tone(400, 0.2, "triangle", 0.08, 400, 0.12, o.pan); },
    bonus:   () => [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.15, "triangle", 0.08, 0, i * 0.07)),
    dayEnd:  () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.3, "sine", 0.1, 0, i * 0.12)),
    dayStart:() => { tone(1318, 0.6, "sine", 0.08); tone(1046, 0.8, "sine", 0.07, 0, 0.18); },  // shop door bell
    research:() => [1046, 1318, 1568, 2093, 2637].forEach((f, i) => tone(f, 0.35, "sine", 0.05, 0, i * 0.06)),
    fanfare: () => [523, 659, 784, 1046, 784, 1046].forEach((f, i) => tone(f, 0.22, "triangle", 0.09, 0, i * 0.11)),

    // automation (quiet, randomized pitch so a busy floor doesn't sound robotic)
    whoosh:  o => noise("bandpass", vary(500, 0.2), 0.05 * o.vol, 0.22, 2400, 0, o.pan),
    servo:   o => { tone(vary(220), 0.16, "sawtooth", 0.018 * o.vol, 160, 0, o.pan); tone(vary(330), 0.1, "sawtooth", 0.012 * o.vol, -80, 0.14, o.pan); },
    zip:     o => tone(vary(600, 0.15), 0.14, "sine", 0.05 * o.vol, 900, 0, o.pan),
    plop:    o => tone(vary(300, 0.2), 0.09, "triangle", 0.07 * o.vol, -140, 0, o.pan),

    // world events
    clank:   o => { noise("bandpass", 900, 0.25, 0.25, 300, 0, o.pan); tone(140, 0.3, "square", 0.06, -60, 0, o.pan); tone(2200, 0.15, "triangle", 0.05, 0, 0.03, o.pan); },
    powerdown: o => { tone(600, 0.7, "sawtooth", 0.05, -540, 0, o.pan); noise("highpass", 3000, 0.08, 0.3, 0, 0.05, o.pan); },
    boing:   o => tone(220, 0.35, "sine", 0.1, 440, 0, o.pan),
    engine:  o => { tone(55, 1.4, "sawtooth", 0.05, 30, 0, o.pan); noise("lowpass", 250, 0.12, 1.3, 0, 0, o.pan); },
    horn:    o => { tone(392, 0.16, "square", 0.04, 0, 0, o.pan); tone(392, 0.22, "square", 0.04, 0, 0.22, o.pan); },
    zap:     () => { tone(1800, 0.25, "sawtooth", 0.05, -1600); noise("highpass", 4000, 0.06, 0.2); },
    pop:     () => tone(vary(700), 0.08, "sine", 0.12, 500),
  };

  function coins(pan) {
    for (let i = 0; i < 3; i++) tone(vary(2200, 0.1), 0.08, "triangle", 0.035, 0, 0.12 + i * 0.07, pan);
  }

  // automation sounds are rate-limited so 8 robots don't make a wall of noise
  const LIMITS = { whoosh: 0.09, servo: 0.12, zip: 0.12, plop: 0.07, thud: 0.1, click: 0.03, coins: 0.1 };

  return {
    play(name, o = {}) {
      if (!enabled || !sfx[name]) return;
      if (!ensure()) return;
      const now = ctx.currentTime;
      if (LIMITS[name] && now - (lastPlayed[name] || 0) < LIMITS[name]) return;
      lastPlayed[name] = now;
      sfx[name]({ pan: o.pan || 0, vol: o.vol == null ? 1 : o.vol });
    },
    // world x position → left/right pan
    panFor(x) { return Math.max(-0.8, Math.min(0.8, (x + 1) / 14)); },
    setEnabled(v) {
      enabled = v;
      if (master) master.gain.setTargetAtTime(v ? 1 : 0, ctx.currentTime, 0.05);
    },
    setVolumes(music, effects) {
      musicVol = music;
      sfxVol = effects;
      if (!ctx) return;
      musicBus.gain.setTargetAtTime(music * 1.6, ctx.currentTime, 0.05);
      sfxBus.gain.setTargetAtTime(effects * 1.6, ctx.currentTime, 0.05);
    },
    // "full" during a shift, "calm" on menus, "muffled" while paused
    setMusicMode(m) {
      if (m === mode || !ctx) { mode = m; return; }
      mode = m;
      musicFilter.frequency.setTargetAtTime(m === "muffled" ? 650 : m === "calm" ? 1800 : 2600, ctx.currentTime, 0.25);
    },
    // 0 = silent, 1 = full speed belt
    setBelt(level) {
      if (!ctx || !beltGain) return;
      beltGain.gain.setTargetAtTime(enabled ? level * 0.14 : 0, ctx.currentTime, 0.15);
    },
    unlock: ensure,
  };
})();
