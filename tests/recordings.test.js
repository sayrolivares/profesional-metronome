/* Run: node tests/recordings.test.js   (first: node tests/fetch-recordings.js)

   The tuner on 165 recordings of real instruments (guitars, bass, cello, double bass,
   violin), each played through the whole chain exactly as the app runs it: 50 ms frames,
   the last ~170 ms of audio, detector → confidence and stabiliser. Each recording is heard
   through five simulated microphones:

     studio        clean, loud
     phone         a phone's low cut (150 Hz, 24 dB/octave), room noise at −58 dBFS
     phone-harsh   a harsher low cut (250 Hz): a low E's fundamental is ~40 dB down
     phone-soft    a soft pluck (−30 dBFS peak) through the phone
     phone-noisy   a noisy room only ~10 dB under the note

   Reference pitch of each recording: the median of high-clarity estimates over its
   sustain, with long windows, from the clean file (instruments are never exactly in tune,
   so the note's nominal frequency is not used). Three recordings whose name disagrees
   with their pitch are left out.

   Frames are only scored where the note is at least 6 dB above that microphone's noise
   (below that no tuner can be expected to read it) and within 40 dB of its own peak
   (further down, "Pluck again" is the intended answer). Reported per condition: frames on
   the right note (±35 ¢), frames on a WRONG note (the failure that matters most), blank
   frames, "Pluck again" frames, notes never found, time to the first reading and to a
   settled one, and the jitter of the reading. Skipped (exit 0) if the recordings haven't
   been fetched. */
for (const f of ['notes', 'pitch', 'pitch-confidence', 'pitch-stabilizer']) require(`../js/${f}.js`);
const { pitch, PitchStabilizer } = globalThis.MN;
const fs = require('fs'), path = require('path'), assert = require('assert');
const S = require('./signals.js');
const SR = 48000, HOP = 2400;
const dir = path.join(__dirname, 'fixtures', 'recordings');
if (!fs.existsSync(dir) || !fs.readdirSync(dir).some((f) => f.endsWith('.f32'))) {
  console.log('recordings test skipped: run `node tests/fetch-recordings.js` first (needs npm and ffmpeg)');
  process.exit(0);
}

/* ---- microphone conditions ---- */
const peak = (x, db) => { let p = 0; for (const v of x) p = Math.max(p, Math.abs(v)); const k = Math.pow(10, db / 20) / (p || 1); return x.map((v) => v * k); };
const COND = {
  studio: [(x) => peak(x, -6), -100, 1],
  phone: [(x) => S.highpass(peak(x, -14), 150, { order: 4 }), -58, 4],
  'phone-harsh': [(x) => S.highpass(peak(x, -24), 250, { order: 4 }), -62, 7],
  'phone-soft': [(x) => S.highpass(peak(x, -30), 150, { order: 4 }), -60, 5],
  'phone-noisy': [(x) => S.highpass(peak(x, -18), 180, { order: 4 }), -42, 6],
};
const PASS = {   // minimum share of usable frames on the right note; wrong-note frames ≤ 0.5 %
  studio: 0.99, phone: 0.99, 'phone-harsh': 0.99, 'phone-soft': 0.98, 'phone-noisy': 0.9,
};
const UNVERIFIED = ['cello.As4.f32', 'cello.G2.f32', 'guitar-nylon.D5.f32'];
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const nominal = (name) => { const m = /^([A-G])(s?)(-?\d)/.exec(name); return 440 * Math.pow(2, ((+m[3] + 1) * 12 + PC[m[1]] + (m[2] ? 1 : 0) - 69) / 12); };
const lowestOf = (f) => (/guitar/.test(f) ? 82.41 : /bass|contra/.test(f) ? 41.2 : /cello/.test(f) ? 65.41 : 196);
const highestOf = (f) => (/guitar/.test(f) ? 329.63 : /bass|contra/.test(f) ? 98 : /cello/.test(f) ? 220 : 659.26);
const med = (a) => { const s = a.slice().sort((p, q) => p - q); return s.length ? s[s.length >> 1] : NaN; };

function reference(x, nom) {
  const det = new pitch.PitchDetector(), est = [];
  for (let end = 0.4 * SR; end <= Math.min(x.length, 3 * SR); end += 4800) {
    const r = det.detect(x.subarray(end - 16384, end), SR);
    if (r.freq && r.clarity > 0.9 && Math.abs(1200 * Math.log2(r.freq / nom)) <= 80) est.push(r.freq);
  }
  return est.length ? med(est) : nom;
}

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.f32') && !UNVERIFIED.includes(f)).sort();
const agg = {}; for (const c in COND) agg[c] = { n: 0, ok: 0, wrong: 0, none: 0, decay: 0, never: [], first: [], settle: [], sd: [] };
const t0 = Date.now();
for (const f of files) {
  const b = fs.readFileSync(path.join(dir, f));
  const x = new Float32Array(b.buffer, b.byteOffset, b.length / 4).slice().subarray(0, 4 * SR);
  const ref = reference(x, nominal(f.split('.')[1]));
  const lowest = lowestOf(f), win = lowest > 160 ? 4096 : 8192;
  for (const c in COND) {
    const [sigPath, noiseDb, seed] = COND[c];
    const sig = S.highpass(sigPath(x), 22);                  // the app's own 22 Hz high-pass
    /* half a second of the room before the note, then note + room */
    const pre = Math.round(0.5 * SR), y = S.highpass(S.roomNoise(pre + sig.length, noiseDb, seed), 22);
    for (let i = 0; i < sig.length; i++) y[pre + i] += sig[i];
    /* scored: where the note is at least 6 dB above this microphone's noise and within
       40 dB of its own loudest moment (past that, a player plucks again) */
    let loud = -Infinity;
    for (let i = 2400; i < sig.length; i += 2400) { let e = 0; for (let k = i - 2400; k < i; k++) e += sig[k] * sig[k]; loud = Math.max(loud, 10 * Math.log10(e / 2400 + 1e-20)); }
    const usable = (i) => { if (i < 2400 || i >= sig.length) return false; let e = 0; for (let k = i - 2400; k < i; k++) e += sig[k] * sig[k]; const db = 10 * Math.log10(e / 2400 + 1e-20); return db >= noiseDb + 6 && db >= loud - 40; };
    const det = new pitch.PitchDetector(), st = new PitchStabilizer();
    st.setRange(lowest, highestOf(f) * 4);
    let first = null, settled = null, ok = 0, wrong = 0, none = 0, decay = 0, tot = 0; const cs = [];
    for (let end = HOP; end <= y.length; end += HOP) {
      const buf = new Float32Array(win), s0 = Math.max(0, end - win); buf.set(y.subarray(s0, end), win - (end - s0));
      const r = st.push(det.detect(buf, SR), (end / SR) * 1000, 0);
      const t = ((end - pre) / SR) * 1000;
      const shownF = r.status === 'pitch' && r.freq > 0 ? r.freq : null;
      if (shownF && first === null && t > 0) first = t;
      if (shownF && settled === null && t > 0 && r.settled && Math.abs(1200 * Math.log2(shownF / ref)) < 35) settled = t;
      if (t < 250 || !usable(end - pre)) continue;
      tot++;
      if (r.status === 'decay') { decay++; continue; }
      if (!shownF) { none++; continue; }
      const ce = 1200 * Math.log2(shownF / ref);
      if (Math.abs(ce) <= 35) { ok++; if (t > 600) cs.push(ce); } else wrong++;
    }
    if (!tot) continue;
    const A = agg[c]; A.n++; A.ok += ok / tot; A.wrong += wrong / tot; A.none += none / tot; A.decay += decay / tot;
    if (first === null) A.never.push(f); else A.first.push(first);
    if (settled !== null) A.settle.push(settled);
    if (cs.length > 5) { const m = cs.reduce((a, v) => a + v, 0) / cs.length; A.sd.push(Math.sqrt(cs.reduce((a, v) => a + (v - m) ** 2, 0) / cs.length)); }
  }
}
console.log(`${files.length} recordings × ${Object.keys(COND).length} microphones in ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);
console.log('microphone    notes  right   WRONG  blank  pluck-again  never  first   settled  jitter');
let failed = 0;
for (const c in COND) {
  const A = agg[c], pct = (v) => ((v / A.n) * 100).toFixed(1).padStart(5) + '%';
  console.log(`${c.padEnd(13)} ${String(A.n).padStart(5)}  ${pct(A.ok)}  ${pct(A.wrong).trim().padStart(6)}  ${pct(A.none)}  ${pct(A.decay).padStart(11)}  ${String(A.never.length).padStart(5)}  ${String(Math.round(med(A.first))).padStart(4)} ms  ${String(Math.round(med(A.settle))).padStart(4)} ms  ${med(A.sd).toFixed(2)} ¢`);
  try {
    assert.ok(A.ok / A.n >= PASS[c], `${c}: right note in ${(100 * A.ok / A.n).toFixed(1)} % of frames (need ${PASS[c] * 100} %)`);
    assert.ok(A.wrong / A.n <= 0.005, `${c}: a wrong note in ${(100 * A.wrong / A.n).toFixed(2)} % of frames`);
    assert.ok(A.never.length <= (c === 'phone-noisy' ? 2 : 0), `${c}: never found ${A.never.join(', ')}`);
    assert.ok(med(A.first) <= 250, `${c}: first reading after ${med(A.first)} ms`);
  } catch (e) { failed++; console.error('FAIL —', e.message); }
}
if (failed) process.exit(1);
console.log('\nrecordings test passed');
