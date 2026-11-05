/* signals.js — synthetic test signals for the pitch tests (node only).
   Every generator returns a Float32Array; randomness uses a seeded generator so the
   tests give the same result on every run. */
function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/* Sum of harmonics: amps[k] is the amplitude of harmonic k+1. phase0 offsets every partial. */
function harmonics(freq, amps, { sr = 48000, n = 8192, amp = 0.5, phase0 = 0.3, decay = 0, vibrato = null, start = 0 } = {}) {
  const out = new Float32Array(n);
  const total = amps.reduce((a, b) => a + Math.abs(b), 0) || 1;
  for (let k = 0; k < amps.length; k++) {
    if (!amps[k]) continue;
    const h = k + 1;
    if (freq * h >= sr / 2) break;
    let ph = phase0 * h * 1.7;
    for (let i = 0; i < n; i++) {
      const t = (start + i) / sr;
      const f = vibrato ? freq * Math.pow(2, (vibrato.cents * Math.sin(2 * Math.PI * vibrato.rate * t)) / 1200) : freq;
      ph += (2 * Math.PI * f * h) / sr;
      const env = decay ? Math.exp(-t / decay) : 1;
      out[i] += (amp * amps[k] * env * Math.sin(ph)) / total;
    }
  }
  return out;
}
const sine = (f, o) => harmonics(f, [1], o);
/* bright, string-like timbre: 1/k amplitudes, 12 partials */
const saw = (f, o) => harmonics(f, Array.from({ length: 12 }, (_, k) => 1 / (k + 1)), o);

/* Karplus–Strong plucked string: y[n] = d·(y[n−N] + y[n−N+1]) / 2. The two-point average
   sits half a sample inside the loop, so the period is N − 0.5 samples. The exact pitch
   is returned as .freq on the array. */
function pluck(freq, { sr = 48000, n = 8192, skip = 1200, amp = 0.6, seed = 7, damping = 0.996 } = {}) {
  const N = Math.max(3, Math.round(sr / freq + 0.5));
  const r = rng(seed);
  const line = new Float32Array(N);
  for (let i = 0; i < N; i++) line[i] = r() * 2 - 1;
  const mean = line.reduce((a, v) => a + v, 0) / N;          // a real string has no DC
  for (let i = 0; i < N; i++) line[i] -= mean;
  const out = new Float32Array(n);
  let p = 0;
  for (let i = 0; i < n + skip; i++) {
    const a = line[p], b = line[(p + 1) % N];
    const v = damping * 0.5 * (a + b);
    line[p] = v;
    p = (p + 1) % N;
    if (i >= skip) out[i - skip] = a * amp;
  }
  out.freq = sr / (N - 0.5);
  return out;
}

/* A realistic plucked string, sample by sample:
     • partials at k·f·√(1 + B·k²) — real strings are slightly inharmonic (B ≈ 1e-4 for a
       guitar's low E), so the waveform never repeats exactly;
     • amplitudes from where it is plucked: sin(kπβ)/k² for a pluck at β of the length
       (β = 1/2 removes every even partial, 1/5 every 5th…), times `weights` if given;
     • each partial decays with its own time constant, the upper ones faster;
     • the attack starts `glide` cents sharp and relaxes (the string's tension is higher
       while it swings wide), and a short burst of pick noise sits on top.
   Returns a Float32Array; .freq is the steady pitch of the fundamental. */
function string(freq, { sr = 48000, seconds = 3, amp = 0.5, B = 1e-4, pluckAt = 0.2, partials = 24, decay = 3, weights = null,
  glide = 8, glideMs = 70, pick = 0.12, seed = 11, lead = 0 } = {}) {
  const n = Math.round(seconds * sr), out = new Float32Array(n + Math.round(lead * sr)), off = Math.round(lead * sr);
  const r = rng(seed);
  let total = 0;
  const parts = [];
  for (let k = 1; k <= partials; k++) {
    const fk = k * freq * Math.sqrt(1 + B * k * k);
    if (fk >= sr * 0.45) break;
    const a = Math.abs(Math.sin(k * Math.PI * pluckAt)) / (k * k) * (weights ? (weights[k - 1] !== undefined ? weights[k - 1] : 0) : 1);
    if (!a) continue;
    parts.push({ fk, a, tau: decay / (1 + 0.35 * (k - 1)), ph: r() * 2 * Math.PI });
    total += a;
  }
  const g = new Float64Array(n);                    // pitch multiplier of the attack glide
  for (let i = 0; i < n; i++) g[i] = glide ? Math.pow(2, (glide * Math.exp(-i / sr / (glideMs / 1000))) / 1200) : 1;
  for (const p of parts) {
    const w0 = (2 * Math.PI * p.fk) / sr, step = Math.exp(-1 / (p.tau * sr));
    let ph = p.ph, env = (amp * p.a) / total;
    for (let i = 0; i < n; i++) {
      ph += w0 * g[i];
      out[off + i] += env * Math.sin(ph) * (i < 24 ? i / 24 : 1);
      env *= step;
    }
  }
  if (pick) { const len = Math.round(0.012 * sr); for (let i = 0; i < len; i++) out[off + i] += amp * pick * (r() * 2 - 1) * (1 - i / len); }
  out.freq = freq;
  return out;
}

/* RBJ biquad high-pass, applied `order`/2 times: order 4 ≈ a phone microphone's low cut
   (at 150–250 Hz a low E's fundamental is 15–40 dB down). */
function highpass(sig, fc, { sr = 48000, order = 2 } = {}) {
  let x = sig;
  for (let s = 0; s < order / 2; s++) {
    const w = (2 * Math.PI * fc) / sr, c = Math.cos(w), al = Math.sin(w) / (2 * Math.SQRT1_2);
    const b0 = (1 + c) / 2, b1 = -(1 + c), b2 = b0, a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
    const y = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) { const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
    x = y;
  }
  if (sig.freq) x.freq = sig.freq;
  return x;
}
/* Room noise at a given rms level in dBFS: white noise through a gentle low-pass (most room
   noise sits low), so it shares the band of the notes. */
function roomNoise(n, db, seed = 21, sr = 48000) {
  const r = rng(seed), y = new Float32Array(n);
  const w = (2 * Math.PI * 900) / sr, c = Math.cos(w), al = Math.sin(w) / (2 * Math.SQRT1_2);
  const b0 = (1 - c) / 2, b1 = 1 - c, b2 = b0, a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, p = 0;
  for (let i = 0; i < n; i++) { const x = r() * 2 - 1; const v = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0; x2 = x1; x1 = x; y2 = y1; y1 = v; y[i] = v; p += v * v; }
  const k = Math.pow(10, db / 20) / Math.sqrt(p / n || 1);
  for (let i = 0; i < n; i++) y[i] *= k;
  return y;
}
const mix = (a, b) => { const o = new Float32Array(Math.max(a.length, b.length)); for (let i = 0; i < o.length; i++) o[i] = (a[i] || 0) + (b[i] || 0); if (a.freq) o.freq = a.freq; return o; };
const dbfs = (sig) => { let p = 0; for (const v of sig) p += v * v; return 10 * Math.log10(p / sig.length); };

function addNoise(sig, snrDb, seed = 3) {
  const r = rng(seed);
  let p = 0;
  for (let i = 0; i < sig.length; i++) p += sig[i] * sig[i];
  p /= sig.length;
  const sigma = Math.sqrt(p / Math.pow(10, snrDb / 10));
  const out = new Float32Array(sig.length);
  for (let i = 0; i < sig.length; i++) {
    const u1 = r() || 1e-9, u2 = r();
    out[i] = sig[i] + sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
  return out;
}
function noise(n = 8192, amp = 0.3, seed = 5) { const r = rng(seed); const o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = (r() * 2 - 1) * amp; return o; }
const scale = (sig, k) => sig.map((v) => v * k);
const midiFreq = (m, a4 = 440) => a4 * Math.pow(2, (m - 69) / 12);
const centsOff = (f, ref) => 1200 * Math.log2(f / ref);

module.exports = { rng, harmonics, sine, saw, pluck, string, highpass, roomNoise, mix, dbfs, addNoise, noise, scale, midiFreq, centsOff };
