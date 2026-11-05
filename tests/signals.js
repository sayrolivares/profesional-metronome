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

module.exports = { rng, harmonics, sine, saw, pluck, addNoise, noise, scale, midiFreq, centsOff };
