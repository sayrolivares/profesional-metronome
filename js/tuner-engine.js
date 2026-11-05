/* tuner-engine.js — runs the tuner: opens the microphone, analyses it about 20 times a
   second and emits readings. Pipeline per frame:
     microphone (js/tuner-audio.js) → detection (js/pitch.js) → confidence and
     stabilisation (js/pitch-confidence.js, js/pitch-stabilizer.js) → 'reading' event.
   Note matching (js/tuner-model.js) and drawing (js/tuner-ui.js) happen in the page.

   It owns the microphone's lifetime, so the rules about when the mic is on live in one place:
     • only between start() and stop();
     • stopped when the page is hidden (and reopened when it comes back, if it was on and
       the tuner is still the tool on screen);
     • stopped after five minutes without a note, to save battery;
     • stopped if the device disappears.
   The UI never computes pitch: it calls start/stop and listens for events.

   Events (on(fn) → fn(type, data)):
     'state'   { state: 'idle'|'starting'|'listening'|'suspended'|'error', reason, error }
     'reading' the stabiliser's output for one frame (see js/pitch-stabilizer.js) */
(function (root) {
  const MN = (root.MN = root.MN || {});

  const FRAME_MS = 50;             // analysis rate: 20 per second
  const IDLE_STOP_MS = 5 * 60e3;   // stop listening after this long without a note

  class TunerEngine {
    constructor(opts = {}) {
      this.input = opts.input || new MN.tunerAudio.AudioInput();
      this.detector = opts.detector || new MN.pitch.PitchDetector();
      this.tracker = opts.tracker || new MN.PitchStabilizer();
      this.now = opts.now || (() => performance.now());
      this.setTimer = opts.setTimeout || ((f, ms) => setTimeout(f, ms));
      this.clearTimer = opts.clearTimeout || ((id) => clearTimeout(id));
      this.doc = opts.document !== undefined ? opts.document : (root.document || null);
      this.state = 'idle';
      this.error = null;
      this.listeners = new Set();
      this.timer = null;
      this.hintHz = 0;
      this.lowestHz = 82;
      this.processing = null;
      this.deviceId = '';
      this.lastPitchAt = 0;
      this.resumeOnShow = false;
      this.lastBuffer = null;
      this.gen = 0;
      this.input.onended = () => { if (this.state === 'listening' || this.state === 'suspended') this.fail(new MN.tunerAudio.TunerError('unavailable', 'The microphone was disconnected.'), 'ended'); };
      if (this.doc && this.doc.addEventListener) this.doc.addEventListener('visibilitychange', () => this.onVisibility());
    }

    on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    emit(type, data) { for (const fn of this.listeners) { try { fn(type, data); } catch (e) { console.error(e); } } }
    setState(state, extra = {}) { this.state = state; this.emit('state', Object.assign({ state, error: this.error }, extra)); }

    get listening() { return this.state === 'listening' || this.state === 'suspended' || this.state === 'starting'; }
    get sampleRate() { return this.input.sampleRate; }

    setHint(hz) { this.hintHz = hz > 0 ? hz : 0; }
    /* lowest and highest string (or 0 for chromatic): the analysis window and the octave
       preference follow the instrument */
    setLowest(hz, highestHz = 0) {
      this.lowestHz = hz > 0 ? hz : 82;
      if (this.tracker.setRange) this.tracker.setRange(hz > 0 && highestHz > 0 ? hz : 0, highestHz > 0 ? highestHz * 4 : 0);
    }
    setGate(db) { this.tracker.o.gateDb = db; }

    /* Analysis window: ~170 ms (8192 samples at 48 kHz) whenever the instrument goes below
       160 Hz: 14 cycles of a low E, 5 of a bass's low B. Measured on recordings, the long
       window also halves the jitter on higher notes, so it is kept for the whole
       instrument rather than shortened once a high string sounds. Instruments that stay
       above 160 Hz (violin, ukulele, mandolin) use half, for a quicker response. */
    windowSize() {
      const sr = this.sampleRate || 48000;
      const long = 1 << Math.ceil(Math.log2(sr * 0.15));
      return this.lowestHz > 160 ? long >> 1 : long;
    }

    async start(deviceId) {
      if (this.state === 'starting') return;
      const gen = ++this.gen;
      this.error = null;
      this.resumeOnShow = false;
      if (deviceId !== undefined) this.deviceId = deviceId || '';
      this.setState('starting');
      try {
        const info = await this.input.start(this.deviceId);
        if (gen !== this.gen) { await this.input.close(); return; }   // stop() was pressed meanwhile
        this.deviceId = info.deviceId || this.deviceId;
        this.processing = info.processing || null;
        /* if the browser kept automatic gain on, the level no longer falls as a note decays:
           judge the decay by confidence alone */
        if (this.tracker.o) this.tracker.o.decayDb = this.processing && this.processing.autoGainControl ? Infinity : MN.pitchStabilizer.DEFAULTS.decayDb;
        this.tracker.reset();
        this.lastPitchAt = this.now();
        this.setState(info.suspended ? 'suspended' : 'listening', { info });
        this.schedule();
      } catch (err) {
        if (gen !== this.gen) return;
        this.fail(MN.tunerAudio.micError(err), 'start');
      }
    }

    /* After the browser suspended audio (iOS asks for a tap). */
    async resume() {
      if (this.state !== 'suspended') return;
      const st = await this.input.resume();
      if (st === 'running') { this.setState('listening'); this.schedule(); }
    }

    async stop(reason = 'user') {
      this.gen++;
      if (reason !== 'hidden') this.resumeOnShow = false;
      this.clearTimer(this.timer); this.timer = null;
      const was = this.state;
      await this.input.close();
      this.lastBuffer = null;
      this.tracker.reset();
      if (was !== 'idle' || reason !== 'user') { this.error = null; this.setState('idle', { reason }); }
    }

    async fail(err, reason) {
      this.gen++;
      this.clearTimer(this.timer); this.timer = null;
      await this.input.close();
      this.error = err;
      this.setState('error', { reason, error: err });
    }

    schedule() {
      this.clearTimer(this.timer);
      if (this.state !== 'listening' && this.state !== 'suspended') return;
      this.timer = this.setTimer(() => { this.timer = null; this.frame(); this.schedule(); }, FRAME_MS);
    }

    frame() {
      if (this.state !== 'listening') return null;
      const now = this.now();
      const buf = this.input.read(this.windowSize());
      if (!buf) return null;
      const res = this.detector.detect(buf, this.sampleRate);
      const reading = this.tracker.push(res, now, this.hintHz);
      this.lastBuffer = buf;
      if (reading.status === 'pitch') this.lastPitchAt = now;
      else if (now - this.lastPitchAt > IDLE_STOP_MS) { this.stop('idle'); return reading; }
      this.emit('reading', reading);
      return reading;
    }

    onVisibility() {
      if (!this.doc) return;
      if (this.doc.hidden) {
        if (this.listening) { this.stop('hidden'); this.resumeOnShow = true; }
      } else if (this.resumeOnShow) {
        this.resumeOnShow = false;
        this.start();
      }
    }
  }

  MN.TunerEngine = TunerEngine;
  MN.tunerEngine = { FRAME_MS, IDLE_STOP_MS };
})(typeof window !== 'undefined' ? window : globalThis);
