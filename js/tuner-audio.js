/* tuner-audio.js — the tuner's contact with the browser's audio: the microphone input and
   the reference tone. Nothing here decides what pitch a sound has (that is js/pitch.js),
   and nothing here touches the page.

   Microphone graph:  mic → high-pass 22 Hz → analyser (→ silent gain → speakers)
     • Echo cancellation, noise suppression and automatic gain are switched OFF: they are
       built for voices and smear or cancel the steady tones a tuner needs.
     • The analyser simply holds the most recent samples; the engine copies a window of
       them out ~20 times a second. Audio never leaves this graph: it is not recorded,
       stored or sent anywhere.
     • The silent gain to the speakers keeps the graph running in every browser without
       playing the microphone back.
     • close() stops every track (the browser's "mic in use" indicator goes off), closes
       the AudioContext and drops every reference.

   The tone uses its own small AudioContext, created on first play and suspended when it
   stops, so it never shares a clock or a lifetime with the metronome or the microphone. */
(function (root) {
  const MN = (root.MN = root.MN || {});

  class TunerError extends Error {
    constructor(code, message, cause) { super(message); this.code = code; this.cause = cause; }
  }

  /* Maps getUserMedia failures to a code and a sentence a musician can act on. */
  function micError(err, secure = root.isSecureContext !== false) {
    if (err instanceof TunerError) return err;
    const name = err && err.name;
    if (!secure) return new TunerError('insecure', 'The microphone only works on a secure (https) page. Open the app from its https address.', err);
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError')
      return new TunerError('denied', 'Microphone access is blocked for this site. Allow it in your browser’s site settings, then press Start again.', err);
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError')
      return new TunerError('unavailable', 'No microphone was found. Connect one, or check that your device has one switched on.', err);
    if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError')
      return new TunerError('busy', 'The microphone is in use by another app or tab, or the system blocked it. Close the other app and try again.', err);
    if (name === 'TypeError') return new TunerError('unsupported', 'This browser can’t open the microphone. Try a current version of Chrome, Safari, Firefox or Edge.', err);
    return new TunerError('unknown', 'The microphone could not be started' + (err && err.message ? ': ' + err.message : '.'), err);
  }

  /* Safari 17+ lets a page say how it uses audio. Ignored elsewhere. */
  function audioSession(type) { try { if (root.navigator && navigator.audioSession) navigator.audioSession.type = type; } catch (e) { /* not supported */ } }

  const nextPow2 = (n) => 1 << Math.ceil(Math.log2(Math.max(2, n)));

  class AudioInput {
    constructor(env = {}) {
      this.mediaDevices = env.mediaDevices !== undefined ? env.mediaDevices : (root.navigator && navigator.mediaDevices) || null;
      this.AC = env.AudioContext || root.AudioContext || root.webkitAudioContext || null;
      this.secure = env.secure !== undefined ? env.secure : root.isSecureContext !== false;
      this.ctx = null; this.stream = null; this.analyser = null; this.buffer = null; this.nodes = [];
      this.deviceLabel = ''; this.deviceId = '';
    }

    get open() { return !!this.stream; }
    get sampleRate() { return this.ctx ? this.ctx.sampleRate : 0; }

    async start(deviceId) {
      if (this.stream) await this.close();
      if (!this.secure) throw micError(null, false);
      if (!this.mediaDevices || typeof this.mediaDevices.getUserMedia !== 'function') throw new TunerError('unsupported', 'This browser can’t open the microphone. Try a current version of Chrome, Safari, Firefox or Edge.');
      if (!this.AC) throw new TunerError('unsupported', 'This browser doesn’t support Web Audio, which the tuner needs.');
      const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 1 } };
      if (deviceId) audio.deviceId = { exact: deviceId };
      audioSession('play-and-record');
      let stream;
      try { stream = await this.mediaDevices.getUserMedia({ audio, video: false }); }
      catch (err) {
        /* a remembered device that has gone away: fall back to the default one */
        if (deviceId && err && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')) return this.start('');
        audioSession('auto');
        throw micError(err, this.secure);
      }
      try {
        /* The context is created after permission is granted: on iOS the hardware switches
           to its recording sample rate at that moment, and a context made earlier could
           report the wrong rate (every pitch would be off by ~1.5 semitones). */
        const track = stream.getAudioTracks()[0];
        const settings = track && track.getSettings ? track.getSettings() : {};
        let ctx = new this.AC({ latencyHint: 'interactive' });
        if (settings.sampleRate && ctx.sampleRate && Math.abs(settings.sampleRate - ctx.sampleRate) > 1) {
          try { const c2 = new this.AC({ latencyHint: 'interactive', sampleRate: settings.sampleRate }); try { ctx.close(); } catch (e) {} ctx = c2; } catch (e) { /* keep the first */ }
        }
        if (ctx.state === 'suspended' && ctx.resume) { try { await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 800))]); } catch (e) { /* needs a tap */ } }
        const src = ctx.createMediaStreamSource(stream);
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass'; hp.frequency.value = 22; hp.Q.value = 0.707;
        const an = ctx.createAnalyser();
        an.fftSize = Math.min(32768, nextPow2(ctx.sampleRate * 0.35));
        an.smoothingTimeConstant = 0;
        const mute = ctx.createGain(); mute.gain.value = 0;
        src.connect(hp); hp.connect(an); an.connect(mute); mute.connect(ctx.destination);
        this.ctx = ctx; this.stream = stream; this.analyser = an; this.nodes = [src, hp, an, mute];
        this.buffer = new Float32Array(an.fftSize);
        this.deviceLabel = (track && track.label) || '';
        this.deviceId = settings.deviceId || deviceId || '';
        if (track) track.onended = () => { if (this.onended) this.onended(); };
        return { sampleRate: ctx.sampleRate, label: this.deviceLabel, deviceId: this.deviceId, suspended: ctx.state === 'suspended' };
      } catch (err) {
        stream.getTracks().forEach((t) => t.stop());
        audioSession('auto');
        throw micError(err, this.secure);
      }
    }

    /* Resume after the browser suspended the context (needs a user gesture on iOS). */
    async resume() { if (this.ctx && this.ctx.state === 'suspended') { try { await this.ctx.resume(); } catch (e) {} } return this.ctx ? this.ctx.state : 'closed'; }

    /* The latest n samples (n ≤ analyser size). Returns a view into a reused buffer. */
    read(n) {
      if (!this.analyser) return null;
      const buf = this.buffer;
      if (this.analyser.getFloatTimeDomainData) this.analyser.getFloatTimeDomainData(buf);
      else {
        const bytes = new Uint8Array(buf.length);
        this.analyser.getByteTimeDomainData(bytes);
        for (let i = 0; i < bytes.length; i++) buf[i] = (bytes[i] - 128) / 128;
      }
      const size = Math.min(n || buf.length, buf.length);
      return buf.subarray(buf.length - size);
    }

    async close() {
      const { stream, ctx, nodes } = this;
      this.stream = null; this.ctx = null; this.analyser = null; this.buffer = null; this.nodes = [];
      if (stream) stream.getTracks().forEach((t) => { t.onended = null; try { t.stop(); } catch (e) {} });
      for (const node of nodes) { try { node.disconnect(); } catch (e) {} }
      if (ctx && ctx.state !== 'closed') { try { await ctx.close(); } catch (e) {} }
      audioSession('auto');
    }

    /* Audio inputs. Labels are only available once permission has been granted. */
    async devices() {
      if (!this.mediaDevices || !this.mediaDevices.enumerateDevices) return [];
      try {
        const all = await this.mediaDevices.enumerateDevices();
        return all.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications')
          .map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
      } catch (e) { return []; }
    }

    /* 'granted' | 'denied' | 'prompt' | 'unknown' (Permissions API isn't everywhere). */
    static async permission(onChange) {
      try {
        if (!root.navigator || !navigator.permissions || !navigator.permissions.query) return 'unknown';
        const st = await navigator.permissions.query({ name: 'microphone' });
        if (onChange) st.onchange = () => onChange(st.state);
        return st.state;
      } catch (e) { return 'unknown'; }
    }
  }

  /* ---------------- reference tone ---------------- */
  class ReferenceTone {
    constructor(env = {}) {
      this.AC = env.AudioContext || root.AudioContext || root.webkitAudioContext || null;
      this.ctx = null; this.osc = null; this.gain = null;
      this.freq = 440; this.wave = 'sine'; this.volume = 0.35;
    }
    get playing() { return !!this.osc; }
    level(v) { return Math.pow(Math.max(0, Math.min(1, v)), 2) * 0.5; }   // perceptual curve, capped well below clipping

    async play(freq, wave, volume) {
      if (!this.AC) throw new TunerError('unsupported', 'This browser doesn’t support Web Audio.');
      if (Number.isFinite(freq)) this.freq = freq;
      if (wave) this.wave = wave;
      if (Number.isFinite(volume)) this.volume = volume;
      if (!this.ctx || this.ctx.state === 'closed') this.ctx = new this.AC({ latencyHint: 'interactive' });
      if (this.ctx.state === 'suspended') { try { await this.ctx.resume(); } catch (e) {} }
      if (this.osc) { this.set({}); return; }
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      osc.type = this.wave; osc.frequency.value = this.freq;
      const g = this.ctx.createGain(); g.gain.value = 0;
      osc.connect(g); g.connect(this.ctx.destination);
      osc.start(t);
      g.gain.setTargetAtTime(this.level(this.volume), t, 0.03);
      this.osc = osc; this.gain = g;
    }
    set({ freq, wave, volume }) {
      if (Number.isFinite(freq)) this.freq = freq;
      if (wave) this.wave = wave;
      if (Number.isFinite(volume)) this.volume = volume;
      if (!this.osc || !this.ctx) return;
      const t = this.ctx.currentTime;
      this.osc.frequency.setTargetAtTime(this.freq, t, 0.01);
      if (this.osc.type !== this.wave) this.osc.type = this.wave;
      this.gain.gain.setTargetAtTime(this.level(this.volume), t, 0.03);
    }
    stop() {
      const { osc, gain, ctx } = this;
      this.osc = null; this.gain = null;
      if (!osc || !ctx) return;
      const t = ctx.currentTime;
      gain.gain.cancelScheduledValues(t);
      gain.gain.setTargetAtTime(0, t, 0.04);
      osc.stop(t + 0.3);
      osc.onended = () => { try { osc.disconnect(); gain.disconnect(); } catch (e) {} if (!this.osc && this.ctx === ctx && ctx.state === 'running') ctx.suspend().catch(() => {}); };
    }
    async close() { this.stop(); const c = this.ctx; this.ctx = null; if (c && c.state !== 'closed') { try { await c.close(); } catch (e) {} } }
  }

  MN.tunerAudio = { AudioInput, ReferenceTone, TunerError, micError };
})(typeof window !== 'undefined' ? window : globalThis);
