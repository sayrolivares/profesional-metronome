/* sounds.js — synthesized, non-fatiguing metronome voices.
   Every voice: play(ctx, time, dest, opts) → array of nodes to stop on cancel.
   opts: { pitch: multiplier, vel: 0..1 } */
(function (root) {
  const MN = (root.MN = root.MN || {});

  let noiseBuf = null;
  function noise(ctx) {
    if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
    const len = Math.floor(ctx.sampleRate * 0.5);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  /* Smooth gain envelope: short linear attack, exponential-ish release. */
  function env(ctx, t, peak, attack, decay) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setTargetAtTime(0.0001, t + attack, decay / 4);
    return g;
  }

  function tone(ctx, t, dest, { freq, type = 'sine', peak, attack = 0.002, decay = 0.08, glide = 0, glideTo = null }) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + glide);
    const g = env(ctx, t, peak, attack, decay);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + attack + decay * 1.6);
    return [o, g];
  }

  function burst(ctx, t, dest, { peak, attack = 0.001, decay = 0.03, filter = 'bandpass', freq = 1200, q = 6, lp = null }) {
    const s = ctx.createBufferSource();
    s.buffer = noise(ctx);
    const f = ctx.createBiquadFilter();
    f.type = filter; f.frequency.value = freq; f.Q.value = q;
    const g = env(ctx, t, peak, attack, decay);
    let chain = s.connect(f);
    if (lp) { const l = ctx.createBiquadFilter(); l.type = 'lowpass'; l.frequency.value = lp; chain = chain.connect(l); }
    chain.connect(g).connect(dest);
    s.start(t);
    s.stop(t + attack + decay * 1.6);
    return [s, g];
  }

  const VOICES = [
    { id: 'soft-wood', desc: 'Light, rounded wooden knock', name: 'Soft woodblock', play: (c, t, d, { pitch = 1, vel = 1 }) => [
      ...tone(c, t, d, { freq: 880 * pitch, peak: 0.55 * vel, attack: 0.002, decay: 0.05, glide: 0.012, glideTo: 640 * pitch }),
      ...burst(c, t, d, { peak: 0.3 * vel, decay: 0.025, freq: 1500 * pitch, q: 5, lp: 4500 }),
    ] },
    { id: 'warm-wood', desc: 'Deeper, fuller wooden knock', name: 'Warm woodblock', play: (c, t, d, { pitch = 1, vel = 1 }) => [
      ...tone(c, t, d, { freq: 620 * pitch, peak: 0.6 * vel, attack: 0.003, decay: 0.07, glide: 0.015, glideTo: 450 * pitch }),
      ...tone(c, t, d, { freq: 1240 * pitch, peak: 0.12 * vel, attack: 0.002, decay: 0.03 }),
      ...burst(c, t, d, { peak: 0.22 * vel, decay: 0.03, freq: 1100 * pitch, q: 4, lp: 3500 }),
    ] },
    { id: 'muted-piano', desc: 'Short, damped piano note', name: 'Muted piano', play: (c, t, d, { pitch = 1, vel = 1 }) => [
      ...tone(c, t, d, { freq: 523.25 * pitch, peak: 0.45 * vel, attack: 0.004, decay: 0.18 }),
      ...tone(c, t, d, { freq: 1046.5 * pitch, peak: 0.12 * vel, attack: 0.003, decay: 0.09 }),
      ...tone(c, t, d, { freq: 1569.75 * pitch, peak: 0.05 * vel, attack: 0.003, decay: 0.05 }),
      ...burst(c, t, d, { peak: 0.06 * vel, decay: 0.01, freq: 2000, q: 1, lp: 3000 }),
    ] },
    { id: 'felt-piano', desc: 'Mellow soft-hammer piano', name: 'Felt piano', play: (c, t, d, { pitch = 1, vel = 1 }) => [
      ...tone(c, t, d, { freq: 261.63 * pitch, peak: 0.5 * vel, attack: 0.008, decay: 0.28, type: 'triangle' }),
      ...tone(c, t, d, { freq: 523.25 * pitch, peak: 0.1 * vel, attack: 0.006, decay: 0.14 }),
    ] },
    { id: 'soft-click', desc: 'Quiet, dry click', name: 'Soft acoustic click', play: (c, t, d, { pitch = 1, vel = 1 }) => [
      ...burst(c, t, d, { peak: 0.45 * vel, decay: 0.012, freq: 1800 * pitch, q: 2.5, lp: 3800 }),
      ...tone(c, t, d, { freq: 1000 * pitch, peak: 0.15 * vel, attack: 0.001, decay: 0.012 }),
    ] },
    { id: 'rim-click', desc: 'Light stick on a rim', name: 'Gentle rim click', play: (c, t, d, { pitch = 1, vel = 1 }) => [
      ...burst(c, t, d, { peak: 0.4 * vel, decay: 0.02, freq: 2400 * pitch, q: 3, lp: 5000 }),
      ...tone(c, t, d, { freq: 1700 * pitch, peak: 0.18 * vel, attack: 0.001, decay: 0.02, glide: 0.01, glideTo: 1200 * pitch }),
    ] },
    { id: 'marimba', desc: 'Warm mallet tone, short ring', name: 'Marimba', play: (c, t, d, { pitch = 1, vel = 1 }) => [
      ...tone(c, t, d, { freq: 440 * pitch, peak: 0.5 * vel, attack: 0.003, decay: 0.3 }),
      ...tone(c, t, d, { freq: 1760 * pitch, peak: 0.14 * vel, attack: 0.002, decay: 0.08 }),
      ...burst(c, t, d, { peak: 0.1 * vel, decay: 0.008, freq: 1200, q: 2, lp: 2500 }),
    ] },
    { id: 'bell', desc: 'Clear chime, longer tail', name: 'Bell', play: (c, t, d, { pitch = 1, vel = 1 }) => [
      ...tone(c, t, d, { freq: 880 * pitch, peak: 0.3 * vel, attack: 0.003, decay: 0.55 }),
      ...tone(c, t, d, { freq: 880 * 2.0 * pitch, peak: 0.1 * vel, attack: 0.003, decay: 0.35 }),
      ...tone(c, t, d, { freq: 880 * 2.76 * pitch, peak: 0.06 * vel, attack: 0.003, decay: 0.25 }),
    ] },
    { id: 'analog-pulse', desc: 'Low, soft synth thump', name: 'Subtle analog pulse', play: (c, t, d, { pitch = 1, vel = 1 }) => [
      ...tone(c, t, d, { freq: 180 * pitch, peak: 0.7 * vel, attack: 0.004, decay: 0.07, glide: 0.04, glideTo: 120 * pitch }),
      ...tone(c, t, d, { freq: 360 * pitch, peak: 0.1 * vel, attack: 0.003, decay: 0.03 }),
    ] },
    { id: 'tick', desc: 'Classic mechanical tick', name: 'Traditional tick', play: (c, t, d, { pitch = 1, vel = 1 }) => [
      ...burst(c, t, d, { peak: 0.5 * vel, decay: 0.014, freq: 3000 * pitch, q: 1.5, lp: 6000 }),
      ...tone(c, t, d, { freq: 2300 * pitch, peak: 0.12 * vel, attack: 0.001, decay: 0.01 }),
      ...tone(c, t, d, { freq: 420 * pitch, peak: 0.2 * vel, attack: 0.002, decay: 0.04 }),
    ] },
  ];

  const byId = Object.fromEntries(VOICES.map((v) => [v.id, v]));
  MN.sounds = { VOICES, get: (id) => byId[id] || byId['soft-wood'] };
})(typeof window !== 'undefined' ? window : globalThis);
