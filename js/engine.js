/* engine.js — Web Audio scheduler, independent of the UI.

   Timing model
   ------------
   A cursor walks through the bar in musical positions (fractions of a beat). On every
   tick it commits only the pulses that fall inside a short look-ahead window, computing
   each pulse's time from the tempo *at that moment*. Consequences:
     • a tempo change is heard within ~0.12 s, never after a whole slow beat;
     • pulses are always in order, so tempo changes can't overlap or skip clicks;
     • beats, subdivisions and polyrhythm share one grid, and one silent-bar decision.

   Ticks come from a Web Worker clock (not throttled when the window loses focus) with a
   main-thread interval as a backup; ticks are idempotent, so running both is harmless.
   If the page stalls anyway, pulses whose time has passed are skipped silently instead
   of firing in a burst, so the grid is preserved. A watchdog restarts the audio device
   if it stops advancing, and suspended/interrupted contexts are resumed. */
(function (root) {
  const MN = (root.MN = root.MN || {});
  const R = MN.rhythm;

  const LOOK_VISIBLE = 0.12;       // s scheduled ahead while the page is visible
  const LOOK_HIDDEN_WORKER = 0.5;  // hidden, worker clock alive
  const LOOK_HIDDEN_TIMER = 1.5;   // hidden, only the (throttled) main-thread timer
  const LATE = 0.025;              // pulses later than this are skipped, not fired
  const fin = (v, d) => (Number.isFinite(v) ? v : d);
  const isHidden = () => !!(root.document && root.document.hidden);

  class Engine {
    constructor(store) {
      this.store = store;
      this.ctx = null;
      this.running = false;
      this.gen = 0;                // invalidates in-flight start() calls
      this.events = [];            // timestamped events for the visual layer
      this.active = [];            // scheduled voice nodes, for clean cancel
      this.listeners = new Set();
      this.acc = 0;                // practice seconds accumulated across pauses
      this.segStart = null;        // ctx time the current practice segment began
      this.progStage = -1;
      this.progOffset = 0;         // practice seconds before the progression was switched on
      this.tones = {};             // reference / generator oscillators
      this.lastWorkerTick = 0;
    }

    on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    emit(type, data) { for (const fn of this.listeners) { try { fn(type, data); } catch (e) { console.error(e); } } }

    /* ---------------- audio graph ---------------- */
    async init() {
      if (this.ctx && this.ctx.state !== 'closed') { await this.resume(); return this.ctx; }
      if (this.initPromise) return this.initPromise;
      this.initPromise = this.build().finally(() => { this.initPromise = null; });
      return this.initPromise;
    }

    async build() {
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) throw new Error('This browser does not support Web Audio.');
      const ctx = new AC({ latencyHint: 'interactive' });
      this.ctx = ctx;
      ctx.onstatechange = () => this.emit('audiostate', { state: ctx.state });

      this.master = ctx.createGain();
      this.mute = ctx.createGain();
      this.limiter = ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -8; this.limiter.knee.value = 10;
      this.limiter.ratio.value = 6; this.limiter.attack.value = 0.002; this.limiter.release.value = 0.12;
      this.bus = ctx.createGain();
      this.wet = ctx.createGain(); this.wet.gain.value = 0;
      this.convolver = ctx.createConvolver();
      this.convolver.buffer = this.makeRoom(ctx);
      this.roomOn = false;                         // convolver only connected when room > 0
      this.bus.connect(this.master);
      this.convolver.connect(this.wet).connect(this.master);
      this.master.connect(this.mute).connect(this.limiter).connect(ctx.destination);

      this.pans = {};
      for (const role of ['accent', 'beat', 'sub', 'poly', 'count']) {
        const node = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
        node.connect(this.bus);
        this.pans[role] = node;
      }
      this.applySettings(this.store.get(), true);
      await this.resume();
      this.lastCtxTime = ctx.currentTime; this.lastWall = performance.now();
      return ctx;
    }

    async resume() {
      const c = this.ctx;
      if (!c || c.state === 'running' || c.state === 'closed') return;
      try { await Promise.race([c.resume(), new Promise((r) => setTimeout(r, 1500))]); } catch (e) { /* needs a gesture */ }
    }
    resumeIfNeeded() { if (this.ctx && this.ctx.state !== 'running' && this.ctx.state !== 'closed') this.resume(); }

    panFor(role, s) { return role === 'sub' ? s.panSub : role === 'poly' ? s.panPoly : s.panBeat; }

    makeRoom(ctx) {
      const len = Math.floor(ctx.sampleRate * 0.9);
      const buf = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2) * 0.5;
      }
      return buf;
    }

    applySettings(s, immediate) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const set = (param, v, tc) => { if (immediate) param.value = v; else param.setTargetAtTime(v, t, tc); };
      try {
        set(this.master.gain, R.clamp(fin(s.masterVolume, 0.8), 0, 1), 0.02);
        set(this.mute.gain, s.muted ? 0 : 1, 0.015);
        const room = R.clamp(fin(s.room, 0), 0, 0.5);
        set(this.wet.gain, room, 0.05);
        if (room > 0.001 && !this.roomOn) { this.bus.connect(this.convolver); this.roomOn = true; clearTimeout(this.roomOff); }
        if (room <= 0.001 && this.roomOn) {
          clearTimeout(this.roomOff);
          this.roomOff = setTimeout(() => {
            if (this.roomOn && !(this.store.get().room > 0.001)) { try { this.bus.disconnect(this.convolver); } catch (e) {} this.roomOn = false; }
          }, 400);
        }
        for (const role in this.pans) if (this.pans[role].pan) set(this.pans[role].pan, R.clamp(fin(this.panFor(role, s), 0), -1, 1), 0.02);
      } catch (e) { console.warn('[metronome] settings', e); }
    }

    /* ---------------- voices ---------------- */
    play(voiceId, role, time, opts = {}) {
      if (!this.ctx) return;
      try {
        const o = { vel: R.clamp(fin(opts.vel, 0.8), 0, 1.4), pitch: R.clamp(fin(opts.pitch, 1), 0.25, 4) };
        if (o.vel <= 0.001) return;
        const nodes = MN.sounds.get(voiceId).play(this.ctx, Math.max(time, this.ctx.currentTime), this.pans[role] || this.bus, o);
        this.active.push({ nodes, end: time + 1.2 });
      } catch (e) { console.warn('[metronome] voice', e); }
    }

    async preview(voiceId, role = 'beat') {
      try { await this.init(); } catch (e) { this.emit('error', e); return; }
      if (this.ctx.state === 'running') this.play(voiceId, role, this.ctx.currentTime + 0.03, { vel: 0.9 });
    }

    pruneActive(now) { if (this.active.length) this.active = this.active.filter((a) => a.end > now); }

    cancelAll() {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      for (const a of this.active) for (const n of a.nodes) {
        try {
          if (n.gain) { n.gain.cancelScheduledValues(now); n.gain.setValueAtTime(n.gain.value, now); n.gain.setTargetAtTime(0, now, 0.004); }
          if (n.stop) n.stop(now + 0.04);
        } catch (e) { /* already finished */ }
      }
      this.active = [];
    }

    /* ---------------- clock ---------------- */
    startClock() {
      if (!this.worker && !this.workerFailed && root.Worker && root.Blob && root.URL) {
        try {
          const src = 'var id=null;onmessage=function(e){if(e.data==="start"){if(id===null)id=setInterval(function(){postMessage(0)},25);}else{clearInterval(id);id=null;}};';
          this.worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
          this.worker.onmessage = () => { this.lastWorkerTick = performance.now(); this.tick(); };
          this.worker.onerror = () => { this.workerFailed = true; this.worker = null; };
        } catch (e) { this.workerFailed = true; this.worker = null; }
      }
      if (this.worker) this.worker.postMessage('start');
      clearInterval(this.timer);
      this.timer = setInterval(() => this.tick(), 40);   // backup clock
    }
    stopClock() {
      if (this.worker) this.worker.postMessage('stop');
      clearInterval(this.timer); this.timer = null;
    }
    workerAlive() { return performance.now() - this.lastWorkerTick < 400; }

    /* ---------------- transport ---------------- */
    async start({ countIn } = {}) {
      const gen = ++this.gen;
      await this.init();
      if (gen !== this.gen || this.running) return;
      const ctx = this.ctx;
      const s = this.store.get();
      this.running = true;
      this.events = [];
      this.beat = 0; this.bar = 0; this.cycleBar = 0; this.trainerBars = 0; this.trainerDone = false;
      this.pulses = null; this.pulseIdx = 0;
      this.countInTotal = countIn === undefined ? s.countInBars : countIn;
      this.countIn = this.countInTotal;
      this.cursorTime = ctx.currentTime + 0.06; this.cursorFrac = 0;
      this.segStart = null;
      this.lastCtxTime = ctx.currentTime; this.lastWall = performance.now();

      if (s.progressive.enabled && s.progressive.stages.length) {
        let st = R.progressiveStage(s.progressive.stages, Math.max(0, this.acc - this.progOffset));
        if (!st) { this.progOffset = this.acc; st = R.progressiveStage(s.progressive.stages, 0); }
        this.progStage = st.index;
        if (s.bpm !== st.bpm) this.store.set({ bpm: st.bpm }, 'engine');
      }
      if (ctx.state !== 'running') this.emit('audiostate', { state: ctx.state });
      this.emit('start', { time: ctx.currentTime });
      this.startClock();
      this.tick();
    }

    /* Pause: silence now, keep practice time and program position. */
    stop() {
      this.gen++;
      if (!this.running) return;
      this.running = false;
      this.stopClock();
      const now = this.ctx ? this.ctx.currentTime : 0;
      if (this.segStart !== null) { this.acc += Math.max(0, now - this.segStart); this.segStart = null; }
      this.cancelAll();
      this.events = [];
      this.emit('stop', { time: now });
    }

    /* Stop: also forget practice time and program position. */
    reset() { this.stop(); this.acc = 0; this.progOffset = 0; this.progStage = -1; }

    /* Progressive practice switched on now: its stage 1 starts from the current moment. */
    restartProgram() { this.progOffset = this.practiceElapsed(); this.progStage = -1; }
    programElapsed() { return Math.max(0, this.practiceElapsed() - this.progOffset); }

    practiceElapsed() {
      const live = this.segStart !== null && this.ctx ? Math.max(0, this.ctx.currentTime - this.segStart) : 0;
      return this.acc + live;
    }

    /* The player moved the tempo by hand: restart the trainer's interval from here. */
    tempoTouched() { this.trainerBars = 0; this.trainerDone = false; }

    now() { return this.ctx ? this.ctx.currentTime : 0; }

    /* ---------------- scheduler ---------------- */
    tick() {
      if (!this.running || this.ticking || !this.ctx) return;
      this.ticking = true;
      try {
        const ctx = this.ctx;
        if (ctx.state !== 'running') { this.nudge(); return; }
        const now = ctx.currentTime;
        if (!this.watchdog(now)) return;
        this.checkProgressive(now);
        if (!this.running) return;
        const look = isHidden() ? (this.workerAlive() ? LOOK_HIDDEN_WORKER : LOOK_HIDDEN_TIMER) : LOOK_VISIBLE;
        this.advance(now, now + look);
        this.pruneActive(now);
        if (this.events.length > 64) this.events = this.events.filter((e) => e.time > now - 0.5);
      } catch (e) {
        console.error('[metronome] scheduler', e);
        this.emit('error', e);
      } finally {
        this.ticking = false;
      }
    }

    nudge() {
      const t = performance.now();
      if (this.lastNudge !== undefined && t - this.lastNudge < 1000) return;
      this.lastNudge = t;
      this.emit('audiostate', { state: this.ctx.state });
      this.resume();
    }

    /* Detect an audio device that stopped advancing (e.g. output switched) and rebuild. */
    watchdog(now) {
      const wall = performance.now();
      if (now > this.lastCtxTime + 1e-4) { this.lastCtxTime = now; this.lastWall = wall; return true; }
      if (!isHidden() && wall - this.lastWall > 2500) { this.recover(); return false; }
      return true;
    }

    async recover() {
      if (this.recovering) return;
      this.recovering = true;
      const wasRunning = this.running;
      const elapsed = this.practiceElapsed();
      this.running = false; this.stopClock(); this.active = []; this.events = [];
      const old = this.ctx; this.ctx = null; this.tones = {};
      try { old && old.close(); } catch (e) {}
      try { await this.init(); }
      catch (e) { this.recovering = false; this.emit('error', e); return; }
      this.acc = elapsed; this.segStart = null;
      this.recovering = false;
      this.emit('recovered');
      if (wasRunning) await this.start({ countIn: 0 });
    }

    advance(now, horizon) {
      let guard = 0;
      while (this.running && guard++ < 1024) {
        const s = this.store.get();
        if (!this.pulses) this.enterBeat(s);
        const p = this.pulseIdx < this.pulses.length ? this.pulses[this.pulseIdx] : null;
        const frac = p ? p.frac : 1;
        const time = this.cursorTime + (frac - this.cursorFrac) * (60 / R.clamp(fin(s.bpm, 100), 20, 400));
        if (time >= horizon) break;
        this.cursorTime = time; this.cursorFrac = frac;
        if (!p) { this.endBeat(s); continue; }
        this.pulseIdx++;
        if (time < now - LATE) continue;          // missed during a stall: skip, keep the grid
        this.fire(p, time, s);
      }
    }

    enterBeat(s) {
      const bpb = R.beatsPerBar(s.sig);
      if (this.beat >= bpb) this.beat = 0;
      const inCountIn = this.countIn > 0;
      if (this.beat === 0 && !inCountIn && this.segStart === null) {
        this.segStart = this.cursorTime;
        this.emit('practice-start', { time: this.cursorTime });
      }
      const cycle = s.silent.play + s.silent.silence;
      const silent = !inCountIn && s.silent.enabled && cycle > 0 && (this.cycleBar % cycle) >= s.silent.play;
      const accents = s.accents.length === bpb ? s.accents : R.defaultAccents(s.sig);
      const accent = inCountIn ? (this.beat === 0 ? 3 : 1) : fin(accents[this.beat], 1);

      const pulses = [{ frac: 0, kind: 'beat' }];
      if (!inCountIn) {
        const n = s.subdivision;
        const offs = R.subOffsets(n, s.feel);
        for (let i = 1; i < n; i++) pulses.push({ frac: offs[i], kind: 'sub', i, level: s.subPattern[i] === undefined ? 1 : s.subPattern[i] });
        if (s.poly.enabled && s.poly.against >= 1) {
          const N = s.poly.against;
          for (let k = 0; k < N; k++) {
            const pos = (k * bpb) / N;
            const b = Math.floor(pos + 1e-9);
            if (b === this.beat) pulses.push({ frac: Math.max(0, pos - b), kind: 'poly', k, N });
          }
        }
        pulses.sort((a, b) => a.frac - b.frac);
      }
      this.pulses = pulses; this.pulseIdx = 0;
      this.cur = { beat: this.beat, bpb, accent, silent, inCountIn, bar: this.bar,
        countInBar: inCountIn ? this.countInTotal - this.countIn + 1 : 0 };
    }

    endBeat(s) {
      this.pulses = null; this.cursorFrac = 0;
      this.beat++;
      if (this.beat >= R.beatsPerBar(s.sig)) {
        this.beat = 0;
        if (this.countIn > 0) this.countIn--;
        else { this.bar++; this.cycleBar++; this.trainerBars++; this.applyTrainer(s); }
      }
    }

    fire(p, t, s) {
      const c = this.cur;
      if (p.kind === 'beat') {
        if (!c.silent && c.accent > 0) {
          if (c.inCountIn) this.play(s.soundBeat, 'count', t, { vel: c.accent === 3 ? 0.9 : 0.6, pitch: c.accent === 3 ? 1.15 : 1 });
          else if (c.accent === 3) this.play(s.soundAccent, 'accent', t, { vel: s.accentVolume, pitch: s.soundAccent === s.soundBeat ? 0.84 : 1 });
          else if (c.accent === 2) this.play(s.soundBeat, 'beat', t, { vel: s.accentVolume * 0.85, pitch: 1.12 });
          else this.play(s.soundBeat, 'beat', t, { vel: 0.72 });
        }
        this.events.push({ type: 'beat', time: t, beat: c.beat, bar: c.bar, beats: c.bpb, accent: c.accent, silent: c.silent,
          countIn: c.inCountIn, countInBar: c.countInBar, beatDur: 60 / s.bpm });
      } else if (p.kind === 'sub') {
        if (!c.silent && p.level > 0) this.play(s.soundSub, 'sub', t, { vel: s.subVolume * (p.level === 2 ? 1 : 0.65), pitch: p.level === 2 ? 1.1 : 1 });
        this.events.push({ type: 'sub', time: t, beat: c.beat, sub: p.i, level: p.level, silent: c.silent });
      } else {
        if (!c.silent) this.play(s.soundPoly, 'poly', t, { vel: s.polyVolume * (p.k === 0 ? 1 : 0.8), pitch: p.k === 0 ? 1.1 : 1 });
        this.events.push({ type: 'poly', time: t, idx: p.k, count: p.N, silent: c.silent });
      }
    }

    applyTrainer(s) {
      const tr = s.trainer;
      if (!tr.enabled || !(tr.every >= 1) || this.trainerBars % tr.every !== 0) return;
      const next = R.clamp(R.trainerStep(s.bpm, tr), 20, s.maxBpm);
      if (next !== s.bpm) { this.store.set({ bpm: next }, 'engine'); this.emit('trainer', { bpm: next }); }
      else if (!this.trainerDone) { this.trainerDone = true; this.emit('trainer-done', { bpm: next }); }
    }

    checkProgressive(now) {
      const s = this.store.get();
      if (!s.progressive.enabled || !s.progressive.stages.length || this.segStart === null) return;
      const elapsed = Math.max(0, this.acc + Math.max(0, now - this.segStart) - this.progOffset);
      const st = R.progressiveStage(s.progressive.stages, elapsed);
      if (!st) { this.stop(); this.emit('progressive-done'); return; }
      if (st.index !== this.progStage) {
        this.progStage = st.index;
        if (s.bpm !== st.bpm) this.store.set({ bpm: st.bpm }, 'engine');
        this.emit('stage', st);
      }
    }

    /* Visual layer: events whose time has arrived. Stale ones (page was hidden) are
       dropped, except the latest beat so the ring still shows the right position. */
    drain(now) {
      if (!this.events.length) return [];
      const due = [], keep = [];
      for (const e of this.events) (e.time <= now ? due : keep).push(e);
      this.events = keep;
      if (!due.length) return due;
      due.sort((a, b) => a.time - b.time);
      const fresh = due.filter((e) => e.time > now - 0.15);
      let lastBeat = null;
      for (let i = due.length - 1; i >= 0; i--) if (due[i].type === 'beat') { lastBeat = due[i]; break; }
      if (lastBeat && !fresh.includes(lastBeat)) fresh.unshift(lastBeat);
      return fresh;
    }

    /* ---------------- tone generators (independent of the metronome) ---------------- */
    async tone(name, on, freq, level = 0.13) {
      if (on) { try { await this.init(); } catch (e) { this.emit('error', e); return false; } }
      if (!this.ctx) return false;
      const t = this.ctx.currentTime;
      const cur = this.tones[name];
      if (on) {
        if (!cur) {
          const o = this.ctx.createOscillator(); o.type = 'sine';
          const g = this.ctx.createGain(); g.gain.value = 0;
          o.frequency.value = freq;
          o.connect(g).connect(this.master);
          o.start(t);
          g.gain.setTargetAtTime(level, t, 0.03);
          this.tones[name] = { o, g };
        } else this.setToneFrequency(name, freq);
      } else if (cur) {
        delete this.tones[name];
        cur.g.gain.setTargetAtTime(0, t, 0.03);
        cur.o.stop(t + 0.3);
      }
      return true;
    }
    setToneFrequency(name, freq) {
      const cur = this.tones[name];
      if (cur && this.ctx && Number.isFinite(freq)) cur.o.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.01);
    }
  }

  MN.Engine = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
