/* pitch-stabilizer.js — turns the detector's frame-by-frame estimates (js/pitch.js) into
   the steady reading a musician can tune by. Pure logic with timestamps passed in, so
   every rule is unit-tested in node.

   A plucked string is not a steady tone: it starts with a sharp, noisy attack, settles,
   then fades and drifts while the room noise takes over. This module:

     • follows the room's noise floor and opens a level gate a few dB above it;
     • detects each new pluck (a jump in level), skips the frame that straddles it,
       clears the history and marks the next ~250 ms as "settling": the reading is shown
       at once, but "in tune" is only confirmed after the attack has passed;
     • accepts a frame only if js/pitch-confidence.js trusts it: a clear frame on its own,
       a weaker one when it agrees with the frames before it (a string repeats its pitch,
       noise doesn't);
     • keeps the octave: a frame that reads an octave off the current note uses the
       detector's candidate at the note's own period, and the expected string or the
       instrument's range settles an octave question before a note is established;
     • asks for confirmation before moving to a different note (a stray frame never moves
       the display), except right after a pluck;
     • smooths with a 5-frame median followed by an exponential filter whose speed grows
       with the size of the change and with the confidence: steady when settled, quick
       when you turn a peg. Real changes are followed, never frozen;
     • when the note has faded (45 dB below its loudest moment, or sunk to within 8 dB of
       the room, or no trustworthy frame for a moment) reports 'decay': the last good
       reading stays, marked, with "Pluck again", instead of following the fading string
       as noise starts to pull it around.

   push(result, now, hintHz) → {
     status:  'quiet' | 'searching' | 'noisy' | 'pitch' | 'decay',
     freq     displayed frequency (Hz) or null,   raw: this frame's estimate or null,
     clarity, confidence (0–1), quality ('good'|'fair'|'weak'|'none'),
     db, gateDb, floorDb, rms, stable, settled, onset } */
(function (root) {
  const MN = (root.MN = root.MN || {});
  const C = MN.pitchConfidence;

  const centsOf = (f) => 1200 * Math.log2(f / 440);     // internal log scale
  const freqOf = (c) => 440 * Math.pow(2, c / 1200);
  const median = (a) => { const s = a.slice().sort((x, y) => x - y); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
  /* least-squares line through equally spaced values: slope per frame, rms residual, and
     the line's value at the last point */
  function lineFit(v) {
    const k = v.length, mx = (k - 1) / 2;
    let my = 0; for (const y of v) my += y; my /= k;
    let sxy = 0, sxx = 0;
    for (let i = 0; i < k; i++) { sxy += (i - mx) * (v[i] - my); sxx += (i - mx) * (i - mx); }
    const slope = sxx ? sxy / sxx : 0;
    let r = 0; for (let i = 0; i < k; i++) { const e = v[i] - (my + slope * (i - mx)); r += e * e; }
    return { slope, resid: Math.sqrt(r / k), last: my + slope * (k - 1 - mx) };
  }

  const DEFAULTS = {
    gateDb: -58,          // absolute level gate, dBFS (the Sensitivity setting moves it)
    enterMargin: 3,       // a note must stand this far above the noise floor to start…
    keepMargin: 1.5,      // …and this far to keep being followed (confidence does the rest)
    enterScore: 0.55,     // confidence needed to start showing a note
    keepScore: 0.3,       // …and to keep following it
    clarityFloor: 0.4,    // never accept a frame less periodic than this
    sameCents: 60,        // within this of the shown note: the same note
    confirmFrames: 2,     // frames that must agree before the display moves to another note
    medianSize: 5,
    onsetDb: 8,           // a level rise this big over ~150 ms is a new pluck
    attackMs: 160,        // while the attack is in the window, only clear frames start a note
    attackScore: 0.75,    // …this clear, without help from agreeing frames,
    attackHarmonicity: 0.85, // …and this harmonic (the thump of a pluck is not)
    keepSupport: 0.005,   // while a note is young (youngFrames), keep a lower octave only
    youngFrames: 6,       //   while its own partials hold this share of the energy
    settleMs: 250,        // after a pluck, wait this long before confirming "in tune"
    decayDb: 45,          // this far below the pluck's peak: the note has decayed…
    decayFloorDb: 8,      // …or has fallen to within this of the room's noise floor
    decayAfterMs: 220,    // no trustworthy frame for this long: the note has decayed
    decayShowMs: 3000,    // keep the faded reading (and "Pluck again") this long
    noisyMs: 700,         // loud but never trustworthy for this long → 'noisy'
    rangeLo: 0, rangeHi: 0, // the instrument's range, when known (octave preference)
  };

  class PitchStabilizer {
    constructor(opts = {}) { this.o = Object.assign({}, DEFAULTS, opts); this.floorDb = -75; this.floorKnown = false; this.reset(); }

    reset() {
      this.cents = null;        // shown pitch (internal cents) or null
      this.hist = [];           // recent accepted pitches, for the median
      this.pending = [];        // agreeing frames of a different note
      this.dbs = [];            // recent levels, for onset detection
      this.prevRaw = 0;         // last frame's estimate (for agreement)
      this.lastAcceptAt = -Infinity;
      this.loudSince = null;
      this.frames = 0;
      this.skip = 0;
      this.fresh = false;       // first frames after a pluck may change the note at once
      this.peakDb = -120;       // loudest PITCHED level since the pluck
      this.onsetAt = -Infinity;
      this.settleUntil = 0;
      this.settlePending = false;
      this.quality = 0;
    }

    setRange(lo, hi) { this.o.rangeLo = lo > 0 ? lo : 0; this.o.rangeHi = hi > 0 ? hi : 0; }

    /* Which of the detector's periods to use. The candidates' clarities are on the
       detector's cleaned scale, so they are compared with res.clean. */
    choose(res, hintHz) {
      const best = res.clean != null ? res.clean : res.clarity;
      const all = [{ freq: res.freq, clean: best }, ...(res.candidates || []).map((c) => ({ freq: c.freq, clean: c.clarity, support: c.support }))];
      const near = (c, ref, cents) => Math.abs(centsOf(c.freq) - ref) < cents;
      let pick = all[0];
      if (this.cents !== null) {
        /* stay on the octave being shown. A period twice as long always "fits" a periodic
           signal, so while the note is young a lower octave is kept only if its own partials
           are really there, and never two octaves or a twelfth lower (a note first caught
           too low, in the thump of the attack, corrects itself); once it is
           established, it is kept: late in its decay a low string is mostly 2nd harmonic */
        const young = this.frames < this.o.youngFrames;
        const lowerOk = (c) => c.support != null && c.support >= this.o.keepSupport && Math.round(res.freq / c.freq) === 2;
        const cont = all.filter((c, i) => near(c, this.cents, 45) && c.clean >= 0.85 * best && (i === 0 || !young || !(c.freq < res.freq) || lowerOk(c)));
        if (cont.length) pick = cont[0];
      } else if (hintHz > 0) {
        const hc = centsOf(hintHz), dist = (c) => Math.abs(centsOf(c.freq) - hc);
        for (const c of all) if (c.clean >= 0.92 * best && dist(c) < dist(pick) - 600) pick = c;
      } else if (this.o.rangeLo > 0) {
        const lo = this.o.rangeLo / 1.07, hi = (this.o.rangeHi || this.o.rangeLo * 16) * 1.07;
        const inside = (c) => c.freq >= lo && c.freq <= hi;
        if (!inside(pick)) { const alt = all.find((c) => inside(c) && c.clean >= 0.9 * best); if (alt) pick = alt; }
      }
      const clarity = pick === all[0] ? res.clarity : res.clarity * Math.min(1, pick.clean / (best || 1));
      return { freq: pick.freq, clarity };
    }

    push(res, now, hintHz = 0) {
      const o = this.o;
      const rms = res && res.rms > 0 ? res.rms : 0;
      const db = rms > 0 ? 20 * Math.log10(rms) : -120;
      if (!this.floorKnown) { this.floorKnown = true; this.floorDb = Math.min(db, -50); }   // first frame: a starting guess
      const gateIn = Math.max(o.gateDb, this.floorDb + o.enterMargin);
      const gateKeep = Math.max(o.gateDb - 4, this.floorDb + o.keepMargin);

      /* a new pluck: the level jumps well above the last few frames */
      const recentMin = this.dbs.length ? Math.min(...this.dbs) : -120;
      const onset = db >= gateIn && db - recentMin >= o.onsetDb && now - this.onsetAt >= o.attackMs;
      this.dbs.push(db); if (this.dbs.length > 3) this.dbs.shift();
      if (onset) {
        this.skip = 1; this.hist = []; this.pending = []; this.fresh = true;
        this.peakDb = -120; this.onsetAt = now; this.settleUntil = now + o.settleMs; this.prevRaw = 0; this.settlePending = true;
      }
      const inAttack = now - this.onsetAt < o.attackMs;

      const out = { status: 'quiet', freq: null, raw: null, clarity: res ? res.clarity : 0, confidence: 0, quality: 'none', rms, db, gateDb: gateIn, floorDb: this.floorDb, stable: false, settled: false, onset };

      let accepted = false, cand = null, score = 0;
      if (res && res.freq > 0 && !this.skip && res.clarity >= o.clarityFloor) {
        cand = this.choose(res, hintHz);
        const agree = C.agrees(cand.freq, this.prevRaw) || (this.cents !== null && C.agrees(cand.freq, freqOf(this.cents), 25));
        const a = C.assess({ clarity: cand.clarity, aboveFloorDb: db - this.floorDb, harmonicity: res.harmonicity, agree });
        score = a.score;
        out.raw = cand.freq; out.confidence = score; out.quality = a.quality;
        const c = centsOf(cand.freq);
        const enter = inAttack ? a.base >= o.attackScore && !(res.harmonicity < o.attackHarmonicity) : score >= o.enterScore;
        if (this.cents === null || this.fresh) accepted = db >= gateIn && enter;
        else if (Math.abs(c - this.cents) <= o.sameCents) accepted = db >= gateKeep && score >= o.keepScore;
        else accepted = db >= gateIn && enter;   // a different note: confirmed below
      }
      if (this.skip) this.skip--;
      this.prevRaw = cand ? cand.freq : 0;

      /* the noise floor follows the room while nothing is being followed: down quickly, up
         within a second or so while the level stays near it, but only very slowly toward
         anything much louder (a fan switched on raises it over several seconds; the attack
         of a pluck never does) */
      if (!accepted && this.cents === null) {
        const above = db - this.floorDb;
        /* a frame that sounds like a note (periodic and harmonic, if not yet trusted) never
           raises the floor: a bowed note that swells slowly must not be mistaken for the room */
        const tonal = res && res.freq > 0 && res.clarity >= 0.45 && res.harmonicity >= 0.8;
        if (above < 0 || !tonal) this.floorDb = Math.min(-30, this.floorDb + above * (above < 0 ? 0.3 : above < 10 ? 0.08 : 0.01));
      }

      /* decayed: far below the pluck's peak, or sunk to within a few dB of the room (where
         noise starts to pull the reading around) */
      const faded = this.cents !== null && (db < this.peakDb - o.decayDb || (db < this.floorDb + o.decayFloorDb && db < this.peakDb - 6));
      if (accepted && !faded) {
        const c = centsOf(cand.freq);
        this.peakDb = Math.max(this.peakDb, db);
        this.loudSince = null;
        if (this.cents !== null && Math.abs(c - this.cents) > o.sameCents) {
          if (this.fresh && score >= o.attackScore) {                // a different string, just plucked
            this.hist = [c]; this.pending = []; this.cents = c; this.frames = 1;
          } else {
            if (this.pending.length && Math.abs(c - this.pending[this.pending.length - 1]) > 30) this.pending = [];
            this.pending.push(c);
            if (this.pending.length >= o.confirmFrames) { this.hist = this.pending.slice(); this.pending = []; this.cents = median(this.hist); this.frames = 1; }
          }
        } else {
          this.pending = [];
          this.hist.push(c);
          if (this.hist.length > o.medianSize) this.hist.shift();
          /* the moment the attack is over, forget the attack's frames (they were sharp) */
          if (this.settlePending && now >= this.settleUntil) {
            this.settlePending = false;
            this.hist = this.hist.slice(-2);
            if (this.cents !== null) this.cents = median(this.hist);
          }
          /* Median of the last 5 frames while steady, of the last 3 while the pitch is
             moving (the attack settling, a peg being turned), then an exponential filter.
             Its speed depends on whether the difference from the display is real: bigger
             than three times the frames' own scatter (robust: from their median absolute
             deviation) means the pitch has moved, so follow quickly; within the scatter
             means jitter, so follow slowly. The display never waits for a change that the
             frames agree on. */
          const h = this.hist, k = h.length;
          const t5 = median(h), t3 = median(h.slice(-3));
          const settling = now < this.settleUntil;
          /* a steady glide (a peg being turned): a straight line through the last 5 frames
             fits far better than their scatter (the rise over the 5 frames is more than 8×
             the residual: ±3 ¢ random jitter passes this ~1 % of the time), and its slope
             is more than ~15 ¢/s. Then the line's latest point is the target, so the
             display doesn't trail behind */
          const ramp = k >= 5 ? lineFit(h.slice(-5)) : null;
          const gliding = !!ramp && Math.abs(ramp.slope) >= 0.8 && Math.abs(ramp.slope) * 4 > 8 * ramp.resid;
          const moving = this.cents !== null && (settling || gliding || (Math.abs(t3 - this.cents) > 4 && Math.abs(t5 - this.cents) > 2));
          const target = gliding ? ramp.last : moving ? t3 : t5;
          if (this.cents === null) { this.cents = target; this.frames = 1; if (this.settleUntil < now) { this.settleUntil = now + o.settleMs * 0.6; this.settlePending = true; } }
          else {
            const delta = Math.abs(target - this.cents);
            const scatter = k >= 3 ? Math.max(0.3, 1.4826 * median(h.map((v) => Math.abs(v - t5)))) : 1;
            const speed = gliding ? 0.85 : moving || delta > 15 ? 0.7 : delta > 3 * scatter ? 0.5 : delta < 3 ? 0.22 : 0.42;
            this.cents += (target - this.cents) * speed * (0.55 + 0.45 * score);
            this.frames++;
          }
        }
        this.fresh = false;
        this.lastAcceptAt = now;
        this.quality = this.quality ? this.quality + (score - this.quality) * 0.35 : score;
        out.status = 'pitch';
        out.freq = freqOf(this.cents);
        out.stable = this.frames >= 2;
        out.settled = out.stable && now >= this.settleUntil;
        out.confidence = this.quality; out.quality = C.quality(this.quality);
        return out;
      }

      if (this.cents !== null && (faded || now - this.lastAcceptAt >= o.decayAfterMs)) {
        if (now - this.lastAcceptAt <= o.decayShowMs) {
          out.status = 'decay'; out.freq = freqOf(this.cents); out.stable = this.frames >= 2;
          out.confidence = 0; out.quality = 'weak';
          return out;
        }
        this.cents = null; this.hist = []; this.pending = []; this.frames = 0; this.quality = 0; this.fresh = false;
      } else if (this.cents !== null) {
        /* one untrusted frame inside a note: keep showing it, unchanged */
        out.status = 'pitch'; out.freq = freqOf(this.cents); out.stable = this.frames >= 2;
        out.settled = out.stable && now >= this.settleUntil;
        out.confidence = this.quality; out.quality = C.quality(this.quality);
        return out;
      }
      if (db >= gateIn) {
        if (this.loudSince === null) this.loudSince = now;
        out.status = now - this.loudSince >= o.noisyMs ? 'noisy' : 'searching';
      } else this.loudSince = null;
      return out;
    }
  }

  MN.PitchStabilizer = PitchStabilizer;
  MN.pitchStabilizer = { DEFAULTS, centsOf, freqOf, median, lineFit };
})(typeof window !== 'undefined' ? window : globalThis);
