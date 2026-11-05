/* pitch.js — pitch detection for the tuner. Pure DSP on Float32Array buffers: no Web Audio,
   no DOM, so it runs (and is tested) in node exactly as in the browser.

   Detector: McLeod Pitch Method (MPM, "A Smarter Way to Find Pitch", McLeod & Wyvill 2005).
     1. Normalised square difference function (NSDF) of the buffer, computed from an
        FFT autocorrelation: O(N log N) instead of O(N²).
     2. Key maxima: the highest point of each positive lobe of the NSDF.
     3. The first key maximum within k × (highest key maximum) is the period. Taking the
        FIRST such peak instead of the highest is what avoids octave-down errors (2×, 3×
        the period score almost as high as the period itself); requiring it to be close
        to the highest avoids octave-up errors on harmonics.
     4. Parabolic interpolation for a sub-sample period, then refined against the peaks at
        2×, 3×… the period, which multiplies the precision for high notes.
   The NSDF value at the chosen peak is the clarity, 0–1: how periodic the signal is.
   It doubles as the confidence of the reading.

   Why not the largest FFT bin: on a low guitar or bass string the strongest component is
   often the 2nd or 3rd harmonic (and phone microphones roll off below ~100 Hz), so the
   biggest bin is regularly an octave or a twelfth too high. Periodicity survives a weak
   or missing fundamental; spectral peaks do not.

   Tracker: turns noisy per-frame detections into a steady reading: a level gate that
   follows the room's noise floor, attack (pluck) rejection, a median filter, debounced
   note changes, adaptive smoothing and a short hold when the note dies away. */
(function (root) {
  const MN = (root.MN = root.MN || {});

  /* ---------------- FFT (radix-2, in place) ---------------- */
  const fftCache = new Map();
  function fftTables(size) {
    let t = fftCache.get(size);
    if (t) return t;
    const bits = Math.log2(size);
    const rev = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      rev[i] = r;
    }
    const cos = new Float64Array(size / 2), sin = new Float64Array(size / 2);
    for (let i = 0; i < size / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / size); sin[i] = Math.sin((2 * Math.PI * i) / size); }
    t = { rev, cos, sin, re: new Float64Array(size), im: new Float64Array(size) };
    fftCache.set(size, t);
    return t;
  }
  function fft(re, im, t, inverse) {
    const n = re.length, { rev, cos, sin } = t;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) { let x = re[i]; re[i] = re[j]; re[j] = x; x = im[i]; im[i] = im[j]; im[j] = x; }
    }
    const sign = inverse ? 1 : -1;
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1, step = n / len;
      for (let i = 0; i < n; i += len) {
        for (let k = 0; k < half; k++) {
          const wr = cos[k * step], wi = sign * sin[k * step];
          const a = i + k, b = a + half;
          const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
        }
      }
    }
  }
  const nextPow2 = (n) => 1 << Math.ceil(Math.log2(Math.max(2, n)));

  /* ---------------- detector ---------------- */
  class PitchDetector {
    constructor(opts = {}) {
      this.minFreq = opts.minFreq || 25;     // lowest pitch searched (B0 is 30.9 Hz, A0 27.5 Hz)
      this.maxFreq = opts.maxFreq || 4200;   // highest pitch searched (C8 is 4186 Hz)
      this.k = opts.threshold || 0.9;        // MPM key-maximum threshold
      this.work = null; this.nsdf = null;
    }

    /* Parabolic peak through (τ−1, τ, τ+1). Returns [τ', value]. */
    interp(d, tau) {
      const a = d[tau - 1], b = d[tau], c = d[tau + 1];
      const den = a - 2 * b + c;
      if (!den) return [tau, b];
      const shift = Math.max(-1, Math.min(1, (a - c) / (2 * den)));
      return [tau + shift, b - ((a - c) * shift) / 4];
    }

    /* Highest NSDF point within ±r of τ (inclusive), or −1. */
    localMax(d, tau, r, lo, hi) {
      let best = -1, bv = -Infinity;
      for (let i = Math.max(lo, Math.round(tau - r)); i <= Math.min(hi, Math.round(tau + r)); i++) {
        if (d[i] > bv && d[i] >= d[i - 1] && d[i] >= d[i + 1]) { bv = d[i]; best = i; }
      }
      return best;
    }

    /* buf: Float32Array (any length ≥ 256), sampleRate in Hz.
       Returns { freq, clarity, rms, candidates } — freq is null when nothing periodic was found.
       candidates: other strong periods [{ freq, clarity }], for octave continuity. */
    detect(buf, sampleRate) {
      const n = buf ? buf.length : 0;
      if (n < 256 || !(sampleRate > 0)) return { freq: null, clarity: 0, rms: 0, candidates: [] };
      if (!this.work || this.work.length !== n) { this.work = new Float64Array(n); this.nsdf = new Float64Array((n >> 1) + 2); }
      const first = this.analyse(buf, sampleRate, false);
      /* A slow trend (rumble, a bumped phone) keeps the NSDF positive at every lag and hides
         the period. Then, and only then, try again with the trend removed: detrending a
         clean low note would bend it by up to ~1.5 ¢. The browser also high-passes the input
         at 22 Hz before it gets here (js/tuner-audio.js). */
      return first.stuck ? this.analyse(buf, sampleRate, true) : first;
    }

    analyse(buf, sampleRate, detrend) {
      const n = buf.length, x = this.work, d = this.nsdf;
      let sy = 0, sxy = 0;
      for (let i = 0; i < n; i++) { sy += buf[i]; if (detrend) sxy += i * buf[i]; }
      const mx = (n - 1) / 2, sxx = (n * (n * n - 1)) / 12;
      const slope = detrend ? (sxy - mx * sy) / sxx : 0, icept = sy / n - slope * mx;
      let energy = 0;
      for (let i = 0; i < n; i++) { const v = buf[i] - (icept + slope * i); x[i] = v; energy += v * v; }
      const rms = Math.sqrt(energy / n);
      if (!(rms > 1e-6) || !Number.isFinite(rms)) return { freq: null, clarity: 0, rms: Number.isFinite(rms) ? rms : 0, candidates: [] };

      /* autocorrelation r(τ) through the FFT (zero-padded to 2N so it isn't circular) */
      const size = nextPow2(2 * n), t = fftTables(size), re = t.re, im = t.im;
      for (let i = 0; i < size; i++) { re[i] = i < n ? x[i] : 0; im[i] = 0; }
      fft(re, im, t, false);
      for (let i = 0; i < size; i++) { re[i] = re[i] * re[i] + im[i] * im[i]; im[i] = 0; }
      fft(re, im, t, true);
      /* re[τ] / size = r(τ) */

      const half = n >> 1;
      const minLag = Math.max(2, Math.floor(sampleRate / this.maxFreq));
      const maxLag = Math.min(half - 1, Math.ceil(sampleRate / this.minFreq) + 1);
      let m = 2 * energy;
      d[0] = 1;
      for (let tau = 1; tau <= half; tau++) {
        m -= x[tau - 1] * x[tau - 1] + x[n - tau] * x[n - tau];
        d[tau] = m > 1e-12 ? (2 * (re[tau] / size)) / m : 0;
      }
      d[half + 1] = d[half];

      /* key maxima: highest point of each positive lobe, after the initial lobe at τ = 0 */
      const keys = [];
      let tau = 1;
      while (tau < maxLag && d[tau] > 0) tau++;          // leave the lobe around zero lag
      if (tau >= maxLag) return { freq: null, clarity: 0, rms, candidates: [], stuck: !detrend };
      let inLobe = false, best = -1;
      for (; tau <= maxLag; tau++) {
        if (d[tau] > 0) {
          if (!inLobe) { inLobe = true; best = tau; }
          else if (d[tau] > d[best]) best = tau;
        } else if (inLobe) {
          inLobe = false;
          if (best >= minLag) keys.push(best);
        }
      }
      if (inLobe && best >= minLag && best < maxLag) keys.push(best);
      if (!keys.length) return { freq: null, clarity: 0, rms, candidates: [] };

      /* compare interpolated peak heights: for high notes the period is only ~10 samples,
         its peak falls between samples, and the raw value would lose to the peak at 2×
         the period purely because that one happens to land on a sample */
      const peaks = keys.map((k) => this.interp(d, k));
      let top = 0;
      for (const [, v] of peaks) if (v > top) top = v;
      const limit = this.k * top;
      let pickIdx = 0;
      for (let i = 0; i < peaks.length; i++) if (peaks[i][1] >= limit) { pickIdx = i; break; }
      const pick = keys[pickIdx];
      let [period, clarity] = peaks[pickIdx];

      /* refine against the peaks at j × period (j ≤ 8) */
      for (let j = Math.min(8, Math.floor((half - 2) / period)); j >= 2; j--) {
        const p = this.localMax(d, j * period, Math.max(2, j * 0.6), 1, half);
        if (p < 0 || d[p] < 0.85 * clarity) continue;
        const [pj] = this.interp(d, p);
        const refined = pj / j;
        if (Math.abs(refined - period) < 0.5) { period = refined; break; }
      }

      const candidates = [];
      for (let i = 0; i < keys.length; i++) {
        const [pk, vk] = peaks[i];
        if (keys[i] === pick || vk < 0.5 * top) continue;
        candidates.push({ freq: sampleRate / pk, clarity: Math.min(1, vk) });
      }
      return { freq: sampleRate / period, clarity: Math.max(0, Math.min(1, clarity)), rms, candidates };
    }
  }

  /* ---------------- tracker ---------------- */
  const centsOf = (f) => 1200 * Math.log2(f / 440);     // internal log scale only
  const freqOf = (c) => 440 * Math.pow(2, c / 1200);
  const median = (a) => { const s = a.slice().sort((x, y) => x - y); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };

  const TRACKER_DEFAULTS = {
    clarityEnter: 0.9,   // confidence needed to start showing a note
    clarityKeep: 0.8,    // …and to keep following it
    gateDb: -58,         // absolute level gate, dBFS (the Sensitivity setting moves it)
    floorMargin: 9,      // gate sits this far above the measured noise floor
    holdMs: 1400,        // keep the last reading visible this long after the note fades
    jumpCents: 60,       // a change bigger than this is a new note…
    confirmFrames: 2,    // …once this many frames agree on it
    medianSize: 5,
    attackDb: 10,        // a level jump this big is a new pluck: skip the attack frame
    noisyMs: 700,        // loud but not periodic for this long → "noisy"
  };

  class PitchTracker {
    constructor(opts = {}) { this.o = Object.assign({}, TRACKER_DEFAULTS, opts); this.reset(); this.floorDb = -75; }

    reset() {
      this.cents = null;       // smoothed pitch (internal cents)
      this.hist = [];          // recent accepted raw pitches
      this.pending = [];       // frames that disagree with the current note
      this.lastPitchAt = -Infinity;
      this.loudSince = null;
      this.prevDb = -120;
      this.frames = 0;         // consecutive frames on the current note
      this.skip = 0;
    }

    /* Choose among the detector's periods: prefer one that continues the current note
       (octave continuity), or, before a note is established, one near the hint (the
       string being tuned) — both only when it is nearly as clear as the best. */
    choose(res, hintHz) {
      const all = [{ freq: res.freq, clarity: res.clarity }, ...(res.candidates || [])];
      if (this.cents !== null) {
        const near = all.filter((c) => Math.abs(centsOf(c.freq) - this.cents) < 45 && c.clarity >= 0.9 * res.clarity);
        if (near.length) return near[0];
      } else if (hintHz > 0) {
        const hc = centsOf(hintHz);
        const dist = (c) => Math.abs(centsOf(c.freq) - hc);
        let pick = all[0];
        for (const c of all) if (c.clarity >= 0.92 * res.clarity && dist(c) < dist(pick) - 600) pick = c;
        return pick;
      }
      return all[0];
    }

    /* res: detector output. now: ms timestamp. hintHz: expected pitch or 0.
       Returns { status, freq, raw, clarity, rms, db, gateDb, stable }.
       status: 'quiet' (below the gate), 'searching' (loud, no clear pitch yet),
       'noisy' (loud and not periodic for a while), 'pitch', 'hold' (note just faded). */
    push(res, now, hintHz = 0) {
      const o = this.o;
      const rms = res && res.rms > 0 ? res.rms : 0;
      const db = rms > 0 ? 20 * Math.log10(rms) : -120;
      const gate = Math.max(o.gateDb, this.floorDb + o.floorMargin);
      const attack = db - this.prevDb > o.attackDb && this.prevDb > -100;
      this.prevDb = db;
      const out = { status: 'quiet', freq: null, raw: null, clarity: res ? res.clarity : 0, rms, db, gateDb: gate, stable: false };

      const loud = db >= gate;
      if (attack) { this.skip = 1; this.hist = []; this.pending = []; }

      const need = this.cents === null ? o.clarityEnter : o.clarityKeep;
      const ok = loud && res && res.freq > 0 && res.clarity >= need && !this.skip;
      if (this.skip) this.skip--;
      /* the noise floor follows the room whenever no note is sounding: down fast, up slowly
         (a fan or traffic raises the gate over a few seconds; a pluck never does) */
      if (!ok && this.cents === null) this.floorDb = Math.min(-30, this.floorDb + (db - this.floorDb) * (db < this.floorDb ? 0.3 : 0.015));

      if (ok) {
        const c = centsOf(this.choose(res, hintHz).freq);
        out.raw = freqOf(c);
        this.loudSince = null;
        if (this.cents !== null && Math.abs(c - this.cents) > o.jumpCents) {
          /* a different note: wait until it's confirmed, keep showing the old one meanwhile */
          if (this.pending.length && Math.abs(c - this.pending[this.pending.length - 1]) > 30) this.pending = [];
          this.pending.push(c);
          if (this.pending.length >= o.confirmFrames) {
            this.hist = this.pending.slice(); this.pending = [];
            this.cents = median(this.hist); this.frames = 1;
          }
        } else {
          this.pending = [];
          this.hist.push(c);
          if (this.hist.length > o.medianSize) this.hist.shift();
          const target = median(this.hist);
          if (this.cents === null) { this.cents = target; this.frames = 1; }
          else {
            const delta = Math.abs(target - this.cents);
            const a = delta < 3 ? 0.2 : delta > 15 ? 0.65 : 0.4;   // steady when settled, quick when moving
            this.cents += (target - this.cents) * a;
            this.frames++;
          }
        }
        this.lastPitchAt = now;
        out.status = 'pitch';
        out.freq = freqOf(this.cents);
        out.stable = this.frames >= 2;
        return out;
      }

      if (this.cents !== null && now - this.lastPitchAt <= o.holdMs) {
        out.status = 'hold'; out.freq = freqOf(this.cents); out.stable = this.frames >= 2;
        return out;
      }
      if (this.cents !== null) { this.cents = null; this.hist = []; this.pending = []; this.frames = 0; }
      if (loud) {
        if (this.loudSince === null) this.loudSince = now;
        out.status = now - this.loudSince >= o.noisyMs ? 'noisy' : 'searching';
      } else this.loudSince = null;
      return out;
    }
  }

  MN.pitch = { PitchDetector, PitchTracker, TRACKER_DEFAULTS, fft, fftTables, nextPow2 };
})(typeof window !== 'undefined' ? window : globalThis);
