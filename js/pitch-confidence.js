/* pitch-confidence.js — how far to trust one pitch estimate. Pure functions, no state:
   the stabiliser (js/pitch-stabilizer.js) supplies the context it keeps (the room's noise
   floor, whether recent frames agree) and decides what to do with the answer.

   A single number from the detector is not enough. Its clarity (how exactly the waveform
   repeats) falls as room noise rises, even when the period it found is right; and in
   noise, a wrong period can now and then look clear for one frame. So the score combines
   independent evidence:

     clarity      periodicity of the original signal at the chosen period (0–1)
     level        how far the sound stands above the room's noise floor, in dB
     harmonicity  share of the spectrum's energy that sits on the note's harmonics
     agreement    whether the previous frames found the same pitch: noise does not
                  repeat its mistakes from one frame to the next; a string does repeat
                  its pitch

   score ∈ [0, 1]; quality: 'good' ≥ 0.7, 'fair' ≥ 0.4, otherwise 'weak'. */
(function (root) {
  const MN = (root.MN = root.MN || {});

  const ramp = (lo, hi, v) => (!(v > lo) ? 0 : v >= hi ? 1 : (v - lo) / (hi - lo));

  const LIMITS = {
    clarity: [0.45, 0.93],       // below 0.45 nothing periodic; above 0.93 clearly a note
    aboveFloorDb: [3, 18],       // dB over the noise floor
    harmonicity: [0.25, 0.7],
    agreeCents: 20,              // frames within this many cents agree
    good: 0.7,
    fair: 0.4,
  };

  /* e: { clarity, aboveFloorDb, harmonicity?, agree? } → { score, base, quality }
     base: the same without the agreement bonus (used during a pluck's attack, when two
     frames can agree on the same wrong octave). */
  function assess(e) {
    if (!e || !(e.clarity > 0)) return { score: 0, base: 0, quality: 'none' };
    const c = ramp(LIMITS.clarity[0], LIMITS.clarity[1], e.clarity);
    const l = ramp(LIMITS.aboveFloorDb[0], LIMITS.aboveFloorDb[1], e.aboveFloorDb);
    const h = e.harmonicity == null ? 1 : ramp(LIMITS.harmonicity[0], LIMITS.harmonicity[1], e.harmonicity);
    const base = Math.max(0, Math.min(1, c * (0.4 + 0.6 * l) * (0.65 + 0.35 * h)));
    const score = e.agree ? 1 - (1 - base) * 0.55 : base;
    return { score, base, quality: quality(score) };
  }
  const quality = (s) => (s >= LIMITS.good ? 'good' : s >= LIMITS.fair ? 'fair' : s > 0 ? 'weak' : 'none');

  /* do two pitches agree (within LIMITS.agreeCents)? */
  const agrees = (f1, f2, cents = LIMITS.agreeCents) => f1 > 0 && f2 > 0 && Math.abs(1200 * Math.log2(f1 / f2)) <= cents;

  MN.pitchConfidence = { assess, quality, agrees, ramp, LIMITS };
})(typeof window !== 'undefined' ? window : globalThis);
