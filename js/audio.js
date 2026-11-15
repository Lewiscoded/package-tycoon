// =====================================================
//  audio.js: tiny synth sound effects (no files needed)
// =====================================================
const Sound = (() => {
  let ctx = null;
  let enabled = true;

  function ensure() {
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function tone(freq, dur, type = "sine", vol = 0.12, slide = 0, delay = 0) {
    if (!enabled) return;
    const c = ensure();
    if (!c) return;
    const t = c.currentTime + delay;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(c.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  const sfx = {
    click:  () => tone(800, 0.04, "triangle", 0.05),
    pick:   () => tone(520, 0.08, "triangle", 0.1, 200),
    drop:   () => { tone(660, 0.1, "triangle", 0.1); tone(990, 0.12, "triangle", 0.08, 0, 0.06); },
    wrong:  () => tone(170, 0.25, "sawtooth", 0.07, -60),
    miss:   () => tone(110, 0.3, "square", 0.05, -50),
    ship:   () => { tone(880, 0.08, "square", 0.05); tone(1320, 0.15, "square", 0.05, 0, 0.08); },
    buy:    () => [523, 659, 784].forEach((f, i) => tone(f, 0.14, "triangle", 0.1, 0, i * 0.08)),
    alarm:  () => { tone(720, 0.15, "square", 0.05); tone(520, 0.15, "square", 0.05, 0, 0.18); },
    fix:    () => tone(400, 0.18, "triangle", 0.1, 400),
    bonus:  () => [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.15, "triangle", 0.09, 0, i * 0.07)),
    dayEnd: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.3, "sine", 0.1, 0, i * 0.12)),
  };

  return {
    play(name) { if (sfx[name]) sfx[name](); },
    setEnabled(v) { enabled = v; },
    unlock: ensure,
  };
})();
