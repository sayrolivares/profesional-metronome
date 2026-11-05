/* Run: node tests/tuner-engine.test.js — microphone handling and the analysis loop, against
   fake browser objects: permission granted, denied, no microphone, microphone busy, insecure
   page, stop while starting, page hidden and shown, device unplugged, idle auto-stop, and
   that the microphone is always released. */
require('../js/notes.js'); require('../js/pitch.js'); require('../js/tuner-audio.js'); require('../js/tuner-engine.js');
const { tunerAudio: A, TunerEngine, tunerEngine } = globalThis.MN;
const Sig = require('./signals.js');
const assert = require('assert');
const tests = []; const t = (name, fn) => tests.push([name, fn]);

/* ---- fakes ---- */
class Param { constructor(v) { this.value = v; } setTargetAtTime(v) { this.value = v; } cancelScheduledValues() {} }
class FakeNode { connect(n) { this.to = n; return n; } disconnect() { this.to = null; this.disconnected = true; } }
function fakeAudio(signal) {
  const made = [];
  class Ctx {
    constructor(opts = {}) { this.sampleRate = opts.sampleRate || 48000; this.state = 'running'; this.currentTime = 0; this.destination = new FakeNode(); made.push(this); }
    createMediaStreamSource(stream) { const n = new FakeNode(); n.stream = stream; return n; }
    createBiquadFilter() { return Object.assign(new FakeNode(), { type: '', frequency: new Param(0), Q: new Param(0) }); }
    createAnalyser() {
      const an = Object.assign(new FakeNode(), { fftSize: 2048, smoothingTimeConstant: 0.8 });
      an.getFloatTimeDomainData = (buf) => { const s = signal(); buf.fill(0); buf.set(s.subarray(Math.max(0, s.length - buf.length)), Math.max(0, buf.length - s.length)); };
      return an;
    }
    createGain() { return Object.assign(new FakeNode(), { gain: new Param(1) }); }
    createOscillator() { return Object.assign(new FakeNode(), { type: 'sine', frequency: new Param(440), start() {}, stop() { this.stopped = true; } }); }
    resume() { this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
  }
  return { Ctx, made };
}
function fakeMedia({ fail = null, trackRate = 48000 } = {}) {
  const tracks = [];
  return {
    tracks, calls: [],
    async getUserMedia(c) {
      this.calls.push(c);
      if (fail) { const e = new Error(fail); e.name = fail; throw e; }
      const tr = { label: 'Built-in microphone', stopped: false, stop() { this.stopped = true; }, getSettings: () => ({ sampleRate: trackRate, deviceId: c.audio.deviceId ? c.audio.deviceId.exact : 'default' }) };
      tracks.push(tr);
      return { getAudioTracks: () => [tr], getTracks: () => [tr] };
    },
    async enumerateDevices() { return [{ kind: 'audioinput', deviceId: 'default', label: '' }, { kind: 'audioinput', deviceId: 'usb', label: 'USB mic' }, { kind: 'videoinput', deviceId: 'cam', label: 'Camera' }]; },
  };
}
function fakeClock() {
  let now = 0, id = 0; const q = new Map();
  return {
    now: () => now,
    setTimeout: (f, ms) => { q.set(++id, { f, at: now + ms }); return id; },
    clearTimeout: (i) => q.delete(i),
    async advance(ms) { const end = now + ms; for (;;) { let next = null; for (const [k, v] of q) if (v.at <= end && (!next || v.at < next[1].at)) next = [k, v]; if (!next) break; q.delete(next[0]); now = next[1].at; next[1].f(); await Promise.resolve(); } now = end; },
    pending: () => q.size,
  };
}
function fakeDoc() { const ls = []; return { hidden: false, addEventListener: (type, f) => ls.push(f), fire() { ls.forEach((f) => f()); } }; }
function rig({ fail, signal = () => Sig.saw(82.41, { n: 16384 }), secure = true, trackRate } = {}) {
  const audio = fakeAudio(signal), media = fakeMedia({ fail, trackRate }), clock = fakeClock(), doc = fakeDoc();
  const input = new A.AudioInput({ mediaDevices: media, AudioContext: audio.Ctx, secure });
  const engine = new TunerEngine({ input, now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, document: doc });
  const states = [], readings = [];
  engine.on((type, d) => (type === 'state' ? states.push(d) : readings.push(d)));
  return { audio, media, clock, doc, input, engine, states, readings };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

t('permission granted: listens, detects E2, voice processing switched off', async () => {
  const r = rig();
  await r.engine.start();
  assert.equal(r.engine.state, 'listening');
  const c = r.media.calls[0].audio;
  assert.equal(c.echoCancellation, false); assert.equal(c.noiseSuppression, false); assert.equal(c.autoGainControl, false);
  await r.clock.advance(600);
  const last = r.readings[r.readings.length - 1];
  assert.equal(last.status, 'pitch');
  assert.ok(Math.abs(Sig.centsOff(last.freq, 82.41)) < 0.5, 'E2 found: ' + last.freq);
  assert.ok(r.readings.length >= 10 && r.readings.length <= 13, 'about 20 frames per second, got ' + r.readings.length);
});
t('stop releases the microphone and the audio context', async () => {
  const r = rig();
  await r.engine.start(); await r.clock.advance(200);
  await r.engine.stop();
  assert.ok(r.media.tracks.every((x) => x.stopped), 'every track stopped');
  assert.ok(r.audio.made.every((c) => c.state === 'closed'), 'context closed');
  assert.equal(r.engine.state, 'idle'); assert.equal(r.clock.pending(), 0, 'no timers left');
  const n = r.readings.length; await r.clock.advance(500);
  assert.equal(r.readings.length, n, 'no analysis after stop');
});
t('permission denied → clear error, nothing left open', async () => {
  const r = rig({ fail: 'NotAllowedError' });
  await r.engine.start();
  assert.equal(r.engine.state, 'error'); assert.equal(r.engine.error.code, 'denied');
  assert.match(r.engine.error.message, /site settings/);
  assert.equal(r.audio.made.length, 0, 'no audio context created without permission');
});
t('no microphone, busy microphone, unsupported browser, insecure page', async () => {
  for (const [fail, code] of [['NotFoundError', 'unavailable'], ['NotReadableError', 'busy'], ['TypeError', 'unsupported'], ['WeirdError', 'unknown']]) {
    const r = rig({ fail });
    await r.engine.start();
    assert.equal(r.engine.error.code, code, fail);
  }
  const insecure = rig({ secure: false });
  await insecure.engine.start();
  assert.equal(insecure.engine.error.code, 'insecure');
  assert.equal(insecure.media.calls.length, 0, 'does not even ask');
  const none = new A.AudioInput({ mediaDevices: null, AudioContext: fakeAudio(() => new Float32Array(1)).Ctx, secure: true });
  await assert.rejects(none.start(), (e) => e.code === 'unsupported');
});
t('a remembered device that is gone falls back to the default microphone', async () => {
  const r = rig();
  const orig = r.media.getUserMedia.bind(r.media);
  r.media.getUserMedia = async (c) => { if (c.audio.deviceId) { const e = new Error('x'); e.name = 'OverconstrainedError'; r.media.calls.push(c); throw e; } return orig(c); };
  await r.engine.start('old-usb-mic');
  assert.equal(r.engine.state, 'listening');
  assert.equal(r.media.calls.length, 2);
});
t('stop pressed while the permission prompt is open: nothing stays on', async () => {
  const r = rig();
  let release; const gate = new Promise((res) => (release = res));
  const orig = r.media.getUserMedia.bind(r.media);
  r.media.getUserMedia = async (c) => { await gate; return orig(c); };
  const p = r.engine.start();
  await r.engine.stop();
  release(); await p; await flush();
  assert.equal(r.engine.state, 'idle');
  assert.ok(r.media.tracks.every((x) => x.stopped), 'late stream closed');
});
t('hidden page stops listening; showing it again resumes', async () => {
  const r = rig();
  await r.engine.start();
  r.doc.hidden = true; r.doc.fire(); await flush();
  assert.equal(r.engine.state, 'idle'); assert.ok(r.media.tracks[0].stopped, 'mic released while hidden');
  r.doc.hidden = false; r.doc.fire(); await flush(); await flush();
  assert.equal(r.engine.state, 'listening');
  assert.equal(r.media.tracks.length, 2);
  await r.engine.stop();
  r.doc.hidden = true; r.doc.fire(); r.doc.hidden = false; r.doc.fire(); await flush();
  assert.equal(r.engine.state, 'idle', 'does not resume if it was off');
});
t('device unplugged → error, released', async () => {
  const r = rig();
  await r.engine.start();
  r.input.onended(); await flush();
  assert.equal(r.engine.state, 'error'); assert.equal(r.engine.error.code, 'unavailable');
  assert.ok(r.media.tracks[0].stopped);
});
t('stops by itself after five minutes without a note', async () => {
  const r = rig({ signal: () => new Float32Array(16384) });
  await r.engine.start();
  await r.clock.advance(tunerEngine.IDLE_STOP_MS + 200);
  assert.equal(r.engine.state, 'idle');
  assert.equal(r.states[r.states.length - 1].reason, 'idle');
  assert.ok(r.media.tracks[0].stopped);
});
t('analysis window: long for low notes, shorter for high ones', async () => {
  const r = rig({ signal: () => Sig.saw(659.25, { n: 16384 }) });
  r.engine.setLowest(82);
  await r.engine.start();
  assert.equal(r.engine.windowSize(), 8192);
  await r.clock.advance(300);
  assert.equal(r.engine.windowSize(), 4096, 'once a high note is tracked');
  r.engine.setLowest(196); await r.engine.stop(); await r.engine.start();
  assert.equal(r.engine.windowSize(), 4096, 'violin: shorter from the start');
});
t('mismatched hardware sample rate (iOS) is corrected', async () => {
  const r = rig({ trackRate: 44100 });
  await r.engine.start();
  assert.equal(r.engine.sampleRate, 44100);
  assert.equal(r.audio.made[0].state, 'closed', 'the wrong-rate context was closed');
});
t('device list: audio inputs only', async () => {
  const r = rig();
  const list = await r.input.devices();
  assert.deepEqual(list.map((d) => d.id), ['default', 'usb']);
  assert.equal(list[0].label, 'Microphone 1', 'unnamed before permission');
});
t('reference tone: plays, changes, stops and suspends its context', async () => {
  const { Ctx, made } = fakeAudio(() => new Float32Array(1));
  const tone = new A.ReferenceTone({ AudioContext: Ctx });
  await tone.play(440, 'triangle', 0.5);
  assert.ok(tone.playing); assert.equal(tone.osc.type, 'triangle'); assert.equal(tone.osc.frequency.value, 440);
  tone.set({ freq: 82.41, wave: 'sine', volume: 1 });
  assert.equal(tone.osc.frequency.value, 82.41); assert.equal(tone.osc.type, 'sine');
  assert.ok(tone.gain.gain.value <= 0.5, 'never louder than half scale');
  const osc = tone.osc;
  tone.stop();
  assert.ok(!tone.playing && osc.stopped);
  osc.onended(); await flush();
  assert.equal(made[0].state, 'suspended');
  await tone.close();
  assert.equal(made[0].state, 'closed');
});

(async () => {
  let n = 0;
  for (const [name, fn] of tests) { await fn(); n++; console.log('ok —', name); }
  console.log(`\n${n} tuner engine tests passed`);
  process.exit(0);
})().catch((err) => { console.error('FAIL —', err && err.stack || err); process.exit(1); });
