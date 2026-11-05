/* pitch.js — pitch DETECTION for the tuner: one buffer in, one estimate out. Pure DSP on
   Float32Array buffers (no Web Audio, no DOM), so it runs and is tested in node exactly as
   in the browser. Deciding whether to trust an estimate is js/pitch-confidence.js; turning
   a stream of estimates into a steady display is js/pitch-stabilizer.js.

   Method: McLeod Pitch Method (MPM, McLeod & Wyvill 2005), made robust to room noise and
   to sub-harmonic interference:

     1. Spectrum. FFT of the buffer, zero-padded to 2N so the autocorrelation that follows
        isn't circular.
     2. Noise floor removal. The room (fans, traffic, hiss, the microphone itself) spreads
        its power across the spectrum; a note concentrates it in harmonics. The floor is
        estimated per band as a median across frequency and subtracted from the power
        spectrum. Without this, noise lowers the clarity in proportion to the signal-to-
        noise ratio: at 8 dB SNR a perfectly readable low E scored 0.84 and was rejected.
     3. Normalised square difference function (NSDF) of the cleaned signal, through the
        inverse FFT (Wiener–Khinchin): O(N log N).
     4. Key maxima (the top of each positive lobe); the first one within k × the highest
        is the period. Taking the FIRST avoids octave-down errors (2×, 3× the period score
        as high as the period). Requiring it to be close to the highest avoids octave-up
        errors: a period of T/2 can only score that high if the odd harmonics are almost
        absent, i.e. if the note really is an octave higher.
     5. Harmonic check, on the cleaned spectrum. A guitar body's air resonance (~100 Hz)
        or a sympathetic string can make a multiple of the period look best. If a shorter
        period is also a strong candidate and the partials that only the longer period
        would explain carry almost no energy, the shorter period is the note.
     6. Parabolic interpolation for a sub-sample period, then refinement against the peaks
        at 2×, 3×… the period (more precision for high notes).

   Returns, besides the frequency: clarity (NSDF height of the chosen peak, 0–1),
   snrDb (signal energy over the removed noise floor), harmonicity (share of the cleaned
   energy that sits on the harmonics of the result) and other candidate periods.

   A YIN path (de Cheveigné & Kawahara 2002) computed from the same difference function
   is kept for the benchmark in tests/recordings.test.js (method: 'yin'); MPM measured
   better on real recordings and is the default. See docs/TUNER.md. */
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
    t = { rev, cos, sin, re: new Float64Array(size), im: new Float64Array(size), pow: new Float64Array(size / 2 + 1), raw: new Float64Array(size / 2 + 1), floor: new Float64Array(size / 2 + 1), tmp: new Float64Array(1024) };
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

  /* k-th smallest of a[0..n) (quickselect; reorders a) */
  function select(a, n, k) {
    let lo = 0, hi = n - 1;
    while (lo < hi) {
      const pivot = a[(lo + hi) >> 1];
      let i = lo, j = hi;
      while (i <= j) {
        while (a[i] < pivot) i++;
        while (a[j] > pivot) j--;
        if (i <= j) { const x = a[i]; a[i] = a[j]; a[j] = x; i++; j--; }
      }
      if (k <= j) hi = j; else if (k >= i) lo = i; else return a[k];
    }
    return a[k];
  }

  const DEFAULTS = {
    minFreq: 25,           // lowest pitch searched (A0 is 27.5 Hz, B0 30.9 Hz)
    maxFreq: 4200,         // highest (C8 is 4186 Hz)
    threshold: 0.9,        // MPM key-maximum threshold k
    denoise: true,         // remove the spectral noise floor before the period search
    floorBandHz: 180,      // width of the bands the noise floor is measured in
    overSubtract: 2.5,     // × the estimated mean noise power removed from every bin
    harmonicCheck: true,   // reject sub-harmonic (octave-down, twelfth-down…) errors
    offRatio: 0.06,        // …when the extra partials hold less than this share of energy
    downRatio: 0.02,       // octave-down check: the lower note's own partials hold this much
    rawClarity: 0.97,      // sub-sample refinement on the original signal only when it is this clean;
                           // in noise the cleaned NSDF scatters less than half as much
    method: 'mpm',         // 'mpm' | 'yin' (benchmark only)
    yinThreshold: 0.15,
  };

  class PitchDetector {
    constructor(opts = {}) {
      this.o = Object.assign({}, DEFAULTS, opts);
      if (opts.threshold) this.o.threshold = opts.threshold;
      this.minFreq = this.o.minFreq; this.maxFreq = this.o.maxFreq; this.k = this.o.threshold;
      this.work = null; this.nsdf = null; this.mm = null;
    }

    /* Parabolic peak through (τ−1, τ, τ+1). Returns [τ', value]. */
    interp(d, tau) {
      const a = d[tau - 1], b = d[tau], c = d[tau + 1];
      const den = a - 2 * b + c;
      if (!den) return [tau, b];
      const shift = Math.max(-1, Math.min(1, (a - c) / (2 * den)));
      return [tau + shift, b - ((a - c) * shift) / 4];
    }

    /* Highest local maximum of d within ±r of τ, or −1. */
    localMax(d, tau, r, lo, hi) {
      let best = -1, bv = -Infinity;
      for (let i = Math.max(lo, Math.round(tau - r)); i <= Math.min(hi, Math.round(tau + r)); i++) {
        if (d[i] > bv && d[i] >= d[i - 1] && d[i] >= d[i + 1]) { bv = d[i]; best = i; }
      }
      return best;
    }

    /* buf: Float32Array (≥ 256 samples), sampleRate in Hz.
       Returns { freq, clarity, rms, snrDb, harmonicity, candidates }; freq is null when
       nothing periodic was found. candidates: other strong periods [{ freq, clarity }]. */
    detect(buf, sampleRate) {
      const n = buf ? buf.length : 0;
      const none = { freq: null, clarity: 0, rms: 0, snrDb: -Infinity, harmonicity: 0, candidates: [] };
      if (n < 256 || !(sampleRate > 0)) return none;
      if (!this.work || this.work.length !== n) { this.work = new Float64Array(n); this.nsdf = new Float64Array((n >> 1) + 2); this.mm = new Float64Array((n >> 1) + 2); }
      const first = this.analyse(buf, sampleRate, false);
      /* A slow trend (rumble, a bumped phone) keeps the NSDF positive at every lag and hides
         the period. Then, and only then, try again with the trend removed: detrending a
         clean low note would bend it by up to ~1.5 ¢. (The browser also high-passes the
         input at 22 Hz: js/tuner-audio.js.) */
      return first.stuck ? this.analyse(buf, sampleRate, true) : first;
    }

    analyse(buf, sampleRate, detrend) {
      const o = this.o, n = buf.length, x = this.work, d = this.nsdf, mm = this.mm;
      let sy = 0, sxy = 0;
      for (let i = 0; i < n; i++) { sy += buf[i]; if (detrend) sxy += i * buf[i]; }
      const mx = (n - 1) / 2, sxx = (n * (n * n - 1)) / 12;
      const slope = detrend ? (sxy - mx * sy) / sxx : 0, icept = sy / n - slope * mx;
      let energy = 0;
      for (let i = 0; i < n; i++) { const v = buf[i] - (icept + slope * i); x[i] = v; energy += v * v; }
      const rms = Math.sqrt(energy / n);
      const out = { freq: null, clarity: 0, rms: Number.isFinite(rms) ? rms : 0, snrDb: -Infinity, harmonicity: 0, candidates: [] };
      if (!(rms > 1e-6) || !Number.isFinite(rms)) return out;

      /* 1. spectrum */
      const size = nextPow2(2 * n), t = fftTables(size), re = t.re, im = t.im, P = t.pow, half2 = size >> 1;
      for (let i = 0; i < size; i++) { re[i] = i < n ? x[i] : 0; im[i] = 0; }
      fft(re, im, t, false);
      for (let k = 0; k <= half2; k++) { P[k] = re[k] * re[k] + im[k] * im[k]; t.raw[k] = P[k]; }
      const binHz = sampleRate / size;

      /* 2. noise floor: per band, median power / ln 2 (the mean of an exponentially
         distributed noise bin), interpolated between band centres; then subtracted */
      let totalP = 0, keptP = 0;
      const F = t.floor;
      if (o.denoise) {
        const band = Math.max(16, Math.round(o.floorBandHz / binHz));
        if (t.tmp.length < band) t.tmp = new Float64Array(band);
        const centres = [], meds = [];
        for (let s = 1; s <= half2; s += band) {
          const e = Math.min(half2 + 1, s + band), len = e - s;
          for (let k = 0; k < len; k++) t.tmp[k] = P[s + k];
          centres.push(s + len / 2); meds.push(select(t.tmp, len, len >> 1) / Math.LN2);
        }
        for (let k = 0, b = 0; k <= half2; k++) {
          while (b < centres.length - 2 && k > centres[b + 1]) b++;
          const c0 = centres[b], c1 = centres[Math.min(b + 1, centres.length - 1)];
          const w = c1 > c0 ? Math.max(0, Math.min(1, (k - c0) / (c1 - c0))) : 0;
          F[k] = meds[b] + (meds[Math.min(b + 1, meds.length - 1)] - meds[b]) * w;
        }
        for (let k = 0; k <= half2; k++) {
          const p = P[k], c = Math.max(0, p - o.overSubtract * F[k]);
          totalP += k && k < half2 ? 2 * p : p; keptP += k && k < half2 ? 2 * c : c;
          P[k] = c;
        }
      } else {
        for (let k = 0; k <= half2; k++) { const p = P[k]; totalP += k && k < half2 ? 2 * p : p; F[k] = 0; }
        keptP = totalP;
      }
      const kept = totalP > 0 ? keptP / totalP : 0;
      this.kept = kept;
      out.snrDb = kept >= 1 ? 60 : kept <= 0 ? -60 : Math.max(-60, Math.min(60, 10 * Math.log10(kept / (1 - kept))));
      if (kept < 0.02) return out;                       // nothing but noise floor

      /* 3. autocorrelation of the cleaned signal (power spectrum is real and even) */
      for (let k = 0; k < size; k++) { const kk = k <= half2 ? k : size - k; re[k] = P[kk]; im[k] = 0; }
      fft(re, im, t, true);
      /* re[τ]/size = r'(τ). The NSDF denominator m(τ) = Σ x[j]² + x[j+τ]² over the overlap
         is measured on the original signal and scaled by the share of energy kept. */
      const half = n >> 1;
      const minLag = Math.max(2, Math.floor(sampleRate / this.maxFreq));
      const maxLag = Math.min(half - 1, Math.ceil(sampleRate / this.minFreq) + 1);
      let m = 2 * energy;
      d[0] = 1; mm[0] = m * kept;
      for (let tau = 1; tau <= half; tau++) {
        m -= x[tau - 1] * x[tau - 1] + x[n - tau] * x[n - tau];
        const mk = m * kept;
        mm[tau] = mk;
        d[tau] = mk > 1e-12 ? (2 * (re[tau] / size)) / mk : 0;
      }
      d[half + 1] = d[half];

      if (o.method === 'yin') return this.yin(d, mm, out, sampleRate, minLag, maxLag, half, kept, binHz, detrend);

      /* 4. key maxima: highest point of each positive lobe, after the lobe at τ = 0 */
      const keys = [];
      let tau = 1;
      while (tau < maxLag && d[tau] > 0) tau++;
      if (tau >= maxLag) { out.stuck = !detrend; return out; }
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
      if (!keys.length) return out;

      /* compare interpolated heights: a high note's period falls between samples */
      const peaks = keys.map((k) => this.interp(d, k));
      let top = 0;
      for (const [, v] of peaks) if (v > top) top = v;
      const limit = this.k * top;
      let pickIdx = 0;
      for (let i = 0; i < peaks.length; i++) if (peaks[i][1] >= limit) { pickIdx = i; break; }

      /* 5. harmonic checks: is a shorter candidate period the real note (an interfering
         low component made a multiple of the period look best)? Or a longer one (the
         fundamental is weak, as through a phone microphone, and the odd partials that only
         the lower note explains are clearly there)? */
      if (o.harmonicCheck) {
        pickIdx = this.harmonicPick(peaks, pickIdx, top, sampleRate, binHz, P);
        if (o.downRatio > 0) pickIdx = this.lowerPick(peaks, pickIdx, top, sampleRate, binHz, P);
      }

      return this.finish(d, keys, peaks, pickIdx, top, half, out, sampleRate, binHz, P);
    }

    /* 6. interpolation, refinement, harmonicity and candidates for the chosen peak */
    finish(d, keys, peaks, pickIdx, top, half, out, sampleRate, binHz, P) {
      const pick = keys[pickIdx];
      const [, cleanPeak] = peaks[pickIdx];
      /* The NSDF of the ORIGINAL signal at a few lags, by direct sums (O(N) each). The
         cleaned NSDF finds the period best in noise, but it scores almost any residue as
         periodic, so the clarity reported (and the confidence built on it) comes from the
         original. When the original is very clean, the sub-sample position comes from it
         too (removing the floor reshapes a pure tone's peak by ≈0.1 ¢); otherwise from the
         cleaned NSDF, which in room noise scatters less than half as much (1.2 ¢ against
         2.7 ¢ at 12 dB SNR on the low strings). */
      const x = this.work, n = x.length, mm = this.mm, kept = this.kept || 1, cache = new Map();
      const raw = (tau) => {
        if (cache.has(tau)) return cache.get(tau);
        let r = 0;
        for (let j = 0; j + tau < n; j++) r += x[j] * x[j + tau];
        const m = mm[tau] / kept, v = m > 1e-12 ? (2 * r) / m : 0;
        cache.set(tau, v);
        return v;
      };
      const rawPeak = this.interp([raw(pick - 1), raw(pick), raw(pick + 1)], 1)[1];
      const useRaw = this.o.refineOn === 'raw' ? rawPeak >= 0.6 : this.o.refineOn === 'clean' ? false : rawPeak >= this.o.rawClarity;
      const at = useRaw ? { get: raw } : { get: (t) => d[t] };
      const [p0] = useRaw ? this.interp([raw(pick - 1), raw(pick), raw(pick + 1)], 1) : this.interp(d, pick);
      let period = useRaw ? pick - 1 + p0 : p0;
      const ref = useRaw ? rawPeak : cleanPeak;
      /* refine against the peaks at j × period (j ≤ 8): more precision for high notes, whose
         period is only a few dozen samples. (Low notes are already precise to ~0.01 ¢, and
         on the original signal each lag costs a pass over the buffer.) */
      const jMax = useRaw && period > 96 ? 1 : 8;
      for (let j = Math.min(jMax, Math.floor((half - 2) / period)); j >= 2; j--) {
        const c = j * period, r = Math.max(2, Math.round(j * 0.6));
        let best = -1, bv = -Infinity;
        for (let i = Math.max(2, Math.round(c - r)); i <= Math.min(half - 1, Math.round(c + r)); i++) {
          const v = at.get(i);
          if (v > bv && v >= at.get(i - 1) && v >= at.get(i + 1)) { bv = v; best = i; }
        }
        if (best < 0 || bv < 0.85 * ref) continue;
        const [s] = this.interp([at.get(best - 1), bv, at.get(best + 1)], 1);
        const refined = (best - 1 + s) / j;
        if (Math.abs(refined - period) < 0.5) { period = refined; break; }
      }
      const freq = sampleRate / period;
      for (let i = 0; i < keys.length; i++) {
        const [pk, vk] = peaks[i];
        if (keys[i] === pick || vk < 0.5 * top) continue;
        const cf = sampleRate / pk, ratio = freq / cf, m = Math.round(ratio);
        /* support: for a candidate 1/m of the result (an octave or a twelfth below), how much
           energy sits on the partials only it would explain, relative to the shared ones.
           The stabiliser keeps a lower octave it is showing only while this is not ~0
           (js/pitch-stabilizer.js). */
        const support = m >= 2 && m <= 6 && Math.abs(ratio - m) < m * 0.03 ? this.offOn(P, cf, m, sampleRate, binHz) : null;
        out.candidates.push({ freq: cf, clarity: Math.min(1, vk), support });
      }
      out.freq = freq;
      out.clean = Math.max(0, Math.min(1, cleanPeak));
      out.clarity = Math.max(0, Math.min(1, this.o.clarityFrom === 'clean' ? cleanPeak : rawPeak));
      out.harmonicity = this.harmonicity(freq, sampleRate, binHz, P);
      return out;
    }

    /* Energy of the cleaned spectrum around frequency f (± a window that allows for the
       slight sharpening of a string's upper partials). */
    partial(P, f, binHz) {
      const c = f / binHz, w = Math.max(2, Math.ceil((f * 0.012) / binHz));
      let e = 0;
      for (let k = Math.max(1, Math.round(c - w)); k <= Math.min(P.length - 1, Math.round(c + w)); k++) e += P[k];
      return e;
    }

    /* Share of the cleaned energy (up to 5 kHz) that sits on the harmonics of f. */
    harmonicity(f, sampleRate, binHz, P) {
      const top = Math.min(5000, sampleRate * 0.45);
      let tot = 0;
      for (let k = 1; k < Math.min(P.length, Math.round(top / binHz)); k++) tot += P[k];
      if (!(tot > 0)) return 0;
      let on = 0;
      for (let h = 1; h * f <= top && h <= 40; h++) on += this.partial(P, h * f, binHz);
      return Math.max(0, Math.min(1, on / tot));
    }

    /* Among candidates at 1/m of the chosen period (m = 2…6), take the shortest whose
       partials explain the spectrum: the partials of f that are NOT multiples of m (the
       fundamental excluded, since a body resonance often sits there) must hold less than
       offRatio of the energy of those that are. */
    harmonicPick(peaks, pickIdx, top, sampleRate, binHz, P) {
      const [period] = peaks[pickIdx];
      const f = sampleRate / period;
      let choice = pickIdx;
      for (let m = 2; m <= 6; m++) {
        if (f * m > this.maxFreq) break;
        const want = period / m;
        let idx = -1;
        for (let i = 0; i < pickIdx; i++) if (Math.abs(peaks[i][0] - want) <= Math.max(1, want * 0.03) && peaks[i][1] >= 0.4 * top) idx = i;
        if (idx < 0) continue;
        if (this.offOn(P, f, m, sampleRate, binHz) < this.o.offRatio) choice = idx;
      }
      return choice;
    }

    /* The candidate an octave below (twice the chosen period) is the note when it is nearly
       as periodic and its own partials (the odd ones, which the chosen pitch can't explain)
       hold at least downRatio of the energy of the shared ones. Measured on real
       recordings through a simulated phone microphone: a low string whose fundamental
       the microphone has cut keeps this above ~0.035 even in its first frames, while a
       true higher note stays below ~0.003 (docs/TUNER.md). Only the octave: a twelfth
       below (3×) was wrong more often than right. */
    lowerPick(peaks, pickIdx, top, sampleRate, binHz, P) {
      const [period, val] = peaks[pickIdx];
      const want = period * 2;
      if (sampleRate / want < this.minFreq) return pickIdx;
      for (let i = pickIdx + 1; i < peaks.length; i++) {
        if (Math.abs(peaks[i][0] - want) <= Math.max(1, want * 0.02) && peaks[i][1] >= 0.9 * val) {
          return this.offOn(P, sampleRate / peaks[i][0], 2, sampleRate, binHz) >= this.o.downRatio ? i : pickIdx;
        }
      }
      return pickIdx;
    }

    /* Energy on the partials of f that are not multiples of m, over the energy on those
       that are (up to 5 kHz). ~0: f/… is not really there, f·m explains the sound. */
    offOn(P, f, m, sampleRate, binHz) {
      const lim = Math.min(5000, sampleRate * 0.45);
      let on = 0, off = 0;
      for (let h = 1; h * f <= lim && h <= 48; h++) { const e = this.partial(P, h * f, binHz); if (h % m === 0) on += e; else off += e; }
      return on > 0 ? off / on : Infinity;
    }

    /* YIN on the same difference function: d(τ) = m(τ) − 2r(τ) = m(τ)(1 − nsdf(τ));
       cumulative-mean normalised; first dip under the threshold. Benchmark only. */
    yin(nsdf, mm, out, sampleRate, minLag, maxLag, half, kept, binHz, detrend) {
      const n = maxLag + 2, c = new Float64Array(n);
      let run = 0;
      c[0] = 1;
      for (let tau = 1; tau < n; tau++) {
        const dv = Math.max(0, mm[tau] * (1 - nsdf[tau]));
        run += dv;
        c[tau] = run > 0 ? (dv * tau) / run : 1;
      }
      let tau = -1;
      for (let i = minLag; i <= maxLag; i++) {
        if (c[i] < this.o.yinThreshold) { while (i + 1 <= maxLag && c[i + 1] < c[i]) i++; tau = i; break; }
      }
      if (tau < 0) { let bv = Infinity; for (let i = minLag; i <= maxLag; i++) if (c[i] < bv) { bv = c[i]; tau = i; } }
      if (tau <= 0 || tau >= maxLag) { out.stuck = !detrend; return out; }
      const neg = c.map((v) => -v);
      let [period, v] = this.interp(neg, tau);
      out.freq = sampleRate / period;
      out.clarity = Math.max(0, Math.min(1, 1 + v));
      return out;
    }
  }

  MN.pitch = { PitchDetector, DETECTOR_DEFAULTS: DEFAULTS, fft, fftTables, nextPow2 };
})(typeof window !== 'undefined' ? window : globalThis);
