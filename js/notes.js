/* notes.js — pitch math for the tuner: note names, frequencies and cents. Pure functions,
   no DOM, so the tests can run them in node.

   Conventions (documented in docs/TUNER.md):
     • Scientific pitch notation. MIDI 69 = A4, MIDI 60 = C4 (middle C). Octave numbers
       change at C: B3 is followed by C4.
     • The reference pitch is the frequency of A4. It is a setting (default 440 Hz,
       400–480 Hz allowed), never a constant. A4 = 442 Hz is still "A4".
     • Equal temperament: f = A4 × 2^((midi − 69) / 12).
     • Cents between two frequencies: 1200 × log2(f / ref).
     • Temperaments are offsets in cents from equal temperament, per pitch class and
       relative to a root. Only equal temperament ships; the table is where others go. */
(function (root) {
  const MN = (root.MN = root.MN || {});

  const SHARPS = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const FLATS = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
  const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const A4_MIDI = 69;
  const REF = Object.freeze({ min: 400, max: 480, default: 440 });
  /* Frequencies a target or a tuning string may have: the detector covers about 25 Hz to
     4.2 kHz, which spans every supported instrument with room to spare. */
  const RANGE = Object.freeze({ min: 25, max: 4200 });
  const MIDI_RANGE = Object.freeze({ min: 12, max: 108 }); // C0 … C8

  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const pcOf = (midi) => ((Math.round(midi) % 12) + 12) % 12;

  /* ---- temperaments ----
     offset(pc, rootPc) → cents to add to the equal-tempered pitch of pitch class pc when
     the temperament is built on rootPc. To add one, give it an id, a name and an offset
     function, then list it in the UI (js/tuner-ui.js renders whatever is here). */
  const TEMPERAMENTS = Object.freeze({
    equal: Object.freeze({ id: 'equal', name: 'Equal temperament', short: '12-TET', offset: () => 0 }),
  });
  const temperament = (id) => TEMPERAMENTS[id] || TEMPERAMENTS.equal;

  function validRef(a4) { return isNum(a4) && a4 >= REF.min && a4 <= REF.max; }
  function clampRef(a4) { return isNum(a4) ? Math.min(REF.max, Math.max(REF.min, a4)) : REF.default; }
  function validFreq(f, min = RANGE.min, max = RANGE.max) { return isNum(f) && f >= min && f <= max; }

  /* Target frequency of a MIDI note under a reference pitch and temperament. */
  function midiToFreq(midi, a4 = REF.default, tempId = 'equal', rootPc = 9) {
    if (!isNum(midi) || !isNum(a4) || a4 <= 0) return NaN;
    const et = a4 * Math.pow(2, (midi - A4_MIDI) / 12);
    const off = temperament(tempId).offset(pcOf(midi), rootPc);
    return off ? et * Math.pow(2, off / 1200) : et;
  }

  /* Fractional MIDI number of a frequency in equal temperament (69 = A4). */
  function freqToMidi(f, a4 = REF.default) {
    if (!isNum(f) || f <= 0 || !isNum(a4) || a4 <= 0) return NaN;
    return A4_MIDI + 12 * Math.log2(f / a4);
  }

  function cents(f, ref) {
    if (!isNum(f) || !isNum(ref) || f <= 0 || ref <= 0) return NaN;
    return 1200 * Math.log2(f / ref);
  }

  /* Nearest note to a frequency: { midi, freq (its target), cents (deviation) } or null.
     Checks the neighbours too, so it stays correct for temperaments with offsets. */
  function nearest(f, a4 = REF.default, tempId = 'equal', rootPc = 9) {
    const m0 = Math.round(freqToMidi(f, a4));
    if (!isNum(m0)) return null;
    let best = null;
    for (let m = m0 - 1; m <= m0 + 1; m++) {
      const t = midiToFreq(m, a4, tempId, rootPc);
      const c = cents(f, t);
      if (!best || Math.abs(c) < Math.abs(best.cents)) best = { midi: m, freq: t, cents: c };
    }
    return best;
  }

  /* Name parts of a MIDI note. Octave changes at C, so B♯3 is spelled C4 here. */
  function name(midi, flats = false) {
    if (!isNum(midi)) return null;
    const m = Math.round(midi);
    const text = (flats ? FLATS : SHARPS)[pcOf(m)];
    return { letter: text[0], accidental: text.slice(1), octave: Math.floor(m / 12) - 1, pc: pcOf(m), text: text + (Math.floor(m / 12) - 1) };
  }
  const label = (midi, flats) => { const n = name(midi, flats); return n ? n.text : ''; };

  /* Parse a note such as "E2", "Eb2", "E♭2", "d#3", "F♯ 3", "B#3" (= C4) or "Cb4" (= B3).
     Returns the MIDI number, or null when the text isn't a note in C0–C8. */
  function parse(text) {
    if (typeof text !== 'string' || text.length > 8) return null;
    const m = /^\s*([A-Ga-g])\s*(♯|#|♭|b|𝄪|x|𝄫|bb)?\s*(-?\d)\s*$/.exec(text.replace(/♮/g, ''));
    if (!m) return null;
    const acc = m[2] || '';
    const shift = { '♯': 1, '#': 1, '♭': -1, b: -1, '𝄪': 2, x: 2, '𝄫': -2, bb: -2 }[acc] || 0;
    const octave = parseInt(m[3], 10);
    const midi = (octave + 1) * 12 + LETTER_PC[m[1].toUpperCase()] + shift;
    return midi >= MIDI_RANGE.min && midi <= MIDI_RANGE.max ? midi : null;
  }

  /* Display helpers that never show floating-point noise or "−0.0". */
  function fixed(v, digits) {
    if (!isNum(v)) return '–';
    const s = v.toFixed(digits);
    return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s;
  }
  const hz = (f, digits = 2) => fixed(f, digits);
  /* Signed cents with a real minus sign: "+3.2", "−12.0", "0.0". */
  function signed(v, digits = 1) {
    if (!isNum(v)) return '–';
    const s = fixed(v, digits);
    if (/^0(\.0+)?$/.test(s)) return s;
    return v > 0 ? '+' + s : '−' + s.replace('-', '');
  }

  MN.notes = {
    SHARPS, FLATS, A4_MIDI, REF, RANGE, MIDI_RANGE, TEMPERAMENTS,
    temperament, validRef, clampRef, validFreq, midiToFreq, freqToMidi, cents, nearest,
    name, label, parse, fixed, hz, signed, pcOf,
  };
})(typeof window !== 'undefined' ? window : globalThis);
