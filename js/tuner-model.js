/* tuner-model.js — turns a pitch reading and the settings into what the tuner shows: the
   note, the target, cents, in-tune state, which string is sounding and which strings are
   done. No DOM and no audio, so every rule here is unit-tested.

   Targets, in order of precedence:
     1. A frequency typed in Advanced ("Tune to a frequency").
     2. Manual string mode: the string you picked.
     3. Auto string mode: the string closest to what you play, when that is clear;
        otherwise the nearest note (it never guesses a string it isn't sure of).
     4. Chromatic: the nearest note. */
(function (root) {
  const MN = (root.MN = root.MN || {});
  const N = MN.notes;

  const NOTE_HYSTERESIS = 58;     // ¢ from the shown note before switching to a neighbour (50 is the midpoint)
  const AUTO_MAX = 400;           // ¢ — further than this from every string: no string
  const AUTO_MARGIN = 150;        // ¢ — the best string must win by at least this much
  const AUTO_SWITCH = 60;         // ¢ — another string must be this much closer to take over
  const TUNED_MS = 600;           // in tune this long → the string is marked done
  const HISTORY_SIZE = 12;

  class TunerModel {
    constructor() { this.history = []; this.resetStrings(); this.prevMidi = null; this.autoString = -1; }

    resetStrings(count = 0) { this.tuned = new Array(count).fill(false); this.inTuneSince = null; this.inTuneKey = null; }

    /* Auto string detection. Returns the string index or −1 when no string is clearly meant. */
    detectString(freq, tuning, s) {
      const list = tuning.strings;
      if (!list.length || !(freq > 0)) return -1;
      const dist = list.map((x, i) => Math.abs(N.cents(freq, MN.tunings.stringFreq(tuning, i, s.a4, s.temperament))));
      let best = -1, second = Infinity;
      for (let i = 0; i < dist.length; i++) {
        if (best < 0 || dist[i] < dist[best]) { if (best >= 0) second = Math.min(second, dist[best]); best = i; }
        else second = Math.min(second, dist[i]);
      }
      const cur = this.autoString;
      if (cur >= 0 && cur < dist.length && dist[cur] <= AUTO_MAX && dist[cur] - dist[best] < AUTO_SWITCH) return cur;
      if (dist[best] > AUTO_MAX || second - dist[best] < AUTO_MARGIN) return -1;
      return best;
    }

    /* reading: from the pitch tracker (or null when not listening). s: tuner settings.
       tuning: normalized tuning. now: ms. listening: whether the mic is on. */
    update(reading, s, tuning, now, listening = true) {
      const flats = tuning.flats || s.accidentals === 'flat';
      const out = {
        listening, status: listening ? (reading ? reading.status : 'quiet') : 'idle',
        hasPitch: false, freq: null, note: null, nearestCents: null, target: null,
        cents: null, deltaHz: null, inTune: false, direction: null, stringIndex: -1,
        autoString: false, clarity: reading ? reading.clarity : 0, db: reading ? reading.db : -120,
        gateDb: reading ? reading.gateDb : null, tolerance: s.tolerance, tuned: this.tuned.slice(), justTuned: null,
      };
      if (this.tuned.length !== tuning.strings.length) this.resetStrings(tuning.strings.length), (out.tuned = this.tuned.slice());

      const freq = listening && reading && reading.freq > 0 && (reading.status === 'pitch' || reading.status === 'hold') ? reading.freq : null;

      /* the target is known even before a note is played, so the UI can show it */
      if (s.targetMode === 'freq') out.target = { kind: 'freq', freq: s.customHz, label: N.hz(s.customHz) + ' Hz', midi: null, stringIndex: -1 };
      else if (s.stringMode === 'manual' && tuning.strings.length) {
        const i = Math.min(s.stringIndex, tuning.strings.length - 1);
        out.target = this.stringTarget(tuning, i, s);
        out.stringIndex = i;
      }

      if (!freq) { this.prevMidi = null; this.autoString = -1; this.inTuneSince = null; return out; }

      out.hasPitch = true;
      out.freq = freq;

      /* nearest note, with hysteresis so the name doesn't flicker at the half-way point */
      let near = N.nearest(freq, s.a4, s.temperament);
      if (this.prevMidi !== null && this.prevMidi !== near.midi) {
        const prevF = N.midiToFreq(this.prevMidi, s.a4, s.temperament);
        const c = N.cents(freq, prevF);
        if (Math.abs(c) < NOTE_HYSTERESIS) near = { midi: this.prevMidi, freq: prevF, cents: c };
      }
      this.prevMidi = near.midi;
      out.note = N.name(near.midi, flats);
      out.nearestCents = near.cents;

      if (!out.target && s.stringMode === 'auto' && tuning.strings.length) {
        const i = this.detectString(freq, tuning, s);
        this.autoString = i;
        if (i >= 0) { out.target = this.stringTarget(tuning, i, s); out.stringIndex = i; out.autoString = true; }
      }
      if (!out.target) out.target = { kind: 'note', freq: near.freq, midi: near.midi, label: out.note.text, stringIndex: -1 };

      out.cents = N.cents(freq, out.target.freq);
      out.deltaHz = freq - out.target.freq;
      out.inTune = Math.abs(out.cents) <= s.tolerance + 1e-9;   // inclusive, immune to float noise at the boundary
      out.direction = out.inTune ? 'ok' : out.cents < 0 ? 'up' : 'down';

      /* a target held in tune long enough is "done" (strings get a mark; notes go to history) */
      const key = out.target.kind + ':' + (out.target.stringIndex >= 0 ? out.target.stringIndex : out.target.midi != null ? out.target.midi : out.target.freq);
      if (out.inTune && reading.status === 'pitch' && reading.stable) {
        if (this.inTuneKey !== key) { this.inTuneKey = key; this.inTuneSince = now; }
        else if (now - this.inTuneSince >= TUNED_MS) {
          const i = out.target.stringIndex;
          if (i >= 0 && !this.tuned[i]) { this.tuned[i] = true; out.justTuned = i; }
          this.remember(out, now);
        }
      } else if (!out.inTune) { this.inTuneKey = null; this.inTuneSince = null; }
      out.tuned = this.tuned.slice();
      return out;
    }

    stringTarget(tuning, i, s) {
      const st = tuning.strings[i];
      return { kind: 'string', stringIndex: i, midi: st.midi, label: st.label, freq: MN.tunings.stringFreq(tuning, i, s.a4, s.temperament) };
    }

    /* Recent in-tune notes, this session only (never saved). One entry per target per
       10 s, so holding a note doesn't flood the list. */
    remember(m, now) {
      const label = m.target.kind === 'freq' ? m.target.label : m.note.text;
      const last = this.history[0];
      const entry = { label, freq: m.freq, cents: m.cents, target: m.target.freq, time: now, string: m.target.stringIndex };
      if (last && last.label === label && now - last.time < 10000) { this.history[0] = Object.assign(entry, { time: last.time }); return; }
      this.history.unshift(entry);
      if (this.history.length > HISTORY_SIZE) this.history.length = HISTORY_SIZE;
    }
  }

  MN.TunerModel = TunerModel;
  MN.tunerModel = { NOTE_HYSTERESIS, AUTO_MAX, AUTO_MARGIN, AUTO_SWITCH, TUNED_MS, HISTORY_SIZE };
})(typeof window !== 'undefined' ? window : globalThis);
