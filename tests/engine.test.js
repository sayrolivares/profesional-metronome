/* Run: node tests/engine.test.js
   Drives the real scheduler against a simulated AudioContext clock and checks what it
   schedules — no browser, no speakers. */
const assert = require('assert');

/* ---- minimal Web Audio mock ---- */
class Param { constructor(v = 0) { this.value = v; } setValueAtTime() {} linearRampToValueAtTime() {} setTargetAtTime() {} exponentialRampToValueAtTime() {} cancelScheduledValues() {} }
class Node { connect(n) { return n; } disconnect() {} }
const src = () => Object.assign(new Node(), { start() {}, stop() {}, frequency: new Param(440), type: 'sine', buffer: null });
class Ctx {
  constructor() { this.currentTime = 0; this.state = 'running'; this.sampleRate = 8000; }
  createGain() { return Object.assign(new Node(), { gain: new Param(1) }); }
  createOscillator() { return src(); }
  createBufferSource() { return src(); }
  createBiquadFilter() { return Object.assign(new Node(), { frequency: new Param(), Q: new Param(), type: '' }); }
  createDynamicsCompressor() { return Object.assign(new Node(), { threshold: new Param(), knee: new Param(), ratio: new Param(), attack: new Param(), release: new Param() }); }
  createConvolver() { return Object.assign(new Node(), { buffer: null }); }
  createStereoPanner() { return Object.assign(new Node(), { pan: new Param() }); }
  createBuffer(ch, len) { return { sampleRate: this.sampleRate, getChannelData: () => new Float32Array(len) }; }
  resume() { this.state = 'running'; return Promise.resolve(); }
  close() { this.state = 'closed'; }
}
globalThis.AudioContext = Ctx;
globalThis.window = globalThis;
require('../js/rhythm.js'); require('../js/sounds.js'); require('../js/engine.js'); require('../js/store.js');
const { Engine, Store, rhythm: R } = globalThis.MN;

async function rig(settings) {
  const store = new Store();
  store.set(Object.assign({ countInBars: 0, silent: { enabled: false, play: 1, silence: 1 }, poly: { enabled: false, against: 3 },
    trainer: { enabled: false, start: 60, step: 2, every: 4, target: 100 }, progressive: { enabled: false, stages: [] }, subdivision: 1, subPattern: [1], feel: 'straight' }, settings));
  const e = new Engine(store);
  e.startClock = () => {}; e.stopClock = () => {};
  const log = [];
  e.play = (voice, role, time) => log.push({ role, time });
  const events = [];
  e.on((type, data) => events.push({ type, data }));
  await e.start();
  const t0 = e.cursorTime;
  const run = (seconds, step = 0.025) => { const end = e.ctx.currentTime + seconds; while (e.ctx.currentTime < end) { e.ctx.currentTime += step; e.tick(); } };
  return { e, store, log, events, run, t0 };
}
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
let n = 0; const tests = [];
const t = (name, fn) => tests.push([name, fn]);

t('steady 4/4 at 120: beats exactly 0.5 s apart', async () => {
  const { log, run, e } = await rig({ bpm: 120, sig: { num: 4, den: 4 }, accents: [3, 1, 2, 1] });
  run(5); e.stop();
  const beats = log.filter((x) => x.role !== 'sub');
  for (let i = 1; i < beats.length; i++) assert.ok(close(beats[i].time - beats[i - 1].time, 0.5), 'interval ' + (beats[i].time - beats[i - 1].time));
  assert.ok(beats.length >= 9);
});

t('6/8 in dotted beats at 60: 1 s beats, triplet pulses every 1/3 s', async () => {
  const { log, run, e } = await rig({ bpm: 60, sig: { num: 6, den: 8, compound: true }, accents: [3, 1], subdivision: 3, subPattern: [1, 1, 1] });
  run(4); e.stop();
  const all = log.map((x) => x.time).sort((a, b) => a - b);
  for (let i = 1; i < all.length; i++) assert.ok(close(all[i] - all[i - 1], 1 / 3, 1e-6));
});

t('silent bars mute beats, subdivisions AND polyrhythm for the whole bar', async () => {
  const { log, run, e, t0 } = await rig({ bpm: 120, sig: { num: 2, den: 4 }, accents: [3, 1], subdivision: 2, subPattern: [1, 1],
    silent: { enabled: true, play: 1, silence: 1 }, poly: { enabled: true, against: 3 } });
  run(8.05); e.stop();
  const bars = {};
  for (const x of log) { const b = Math.floor((x.time - t0 + 1e-6) / 1.0); (bars[b] = bars[b] || []).push(x.role); }
  for (const b of Object.keys(bars).map(Number)) {
    if (b % 2 === 1) assert.fail(`sound in silent bar ${b}: ${bars[b]}`);
    if (b < 7) {
      const c = (r) => bars[b].filter((x) => x === r).length;
      assert.deepEqual([c('accent'), c('beat'), c('sub'), c('poly')], [1, 1, 2, 3], 'bar ' + b);
    }
  }
});

t('polyrhythm pulses are evenly spaced across the bar (3 against 4)', async () => {
  const { log, run, e, t0 } = await rig({ bpm: 120, sig: { num: 4, den: 4 }, accents: [3, 1, 1, 1], poly: { enabled: true, against: 3 } });
  run(4.1); e.stop();
  const poly = log.filter((x) => x.role === 'poly').map((x) => x.time - t0);
  for (let i = 0; i < 6; i++) assert.ok(close(poly[i], i * (2 / 3)), `pulse ${i} at ${poly[i]}`);
});

t('tempo change while playing: heard within the look-ahead, no overlap or skipped beat', async () => {
  const { log, run, e, store } = await rig({ bpm: 40, sig: { num: 4, den: 4 }, accents: [3, 1, 1, 1] });
  run(0.3);                              // first beat played; next one 1.5 s away
  const changeAt = e.ctx.currentTime;
  store.set({ bpm: 200 });
  run(3); e.stop();
  const times = log.map((x) => x.time);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] > times[i - 1] + 0.2, 'beats overlap');
  const firstAfter = times.find((x) => x > changeAt);
  assert.ok(firstAfter - changeAt < 0.3 + 0.13, `new tempo took ${(firstAfter - changeAt).toFixed(2)} s`);
  const tail = times.slice(-5);
  for (let i = 1; i < tail.length; i++) assert.ok(close(tail[i] - tail[i - 1], 0.3), 'settles at 200 BPM');
});

t('a 3-second stall (window in background) causes no burst and keeps the grid', async () => {
  const { log, run, e, t0 } = await rig({ bpm: 120, sig: { num: 4, den: 4 }, accents: [3, 1, 1, 1], subdivision: 4, subPattern: [1, 1, 1, 1] });
  run(1);
  e.ctx.currentTime += 3;                 // the main thread froze for 3 s
  const resumeAt = e.ctx.currentTime;
  const before = log.length;
  e.tick();
  const burst = log.slice(before).filter((x) => x.time < resumeAt + 0.03);
  assert.ok(burst.length <= 1, `burst of ${burst.length}`);
  run(2); e.stop();
  for (const x of log.slice(before)) assert.ok(close(((x.time - t0) / 0.125) % 1, 0, 1e-6) || close(((x.time - t0) / 0.125) % 1, 1, 1e-6), 'off grid');
});

t('count-in: beats only, practice clock starts after it', async () => {
  const { log, run, e, events, t0 } = await rig({ bpm: 120, sig: { num: 4, den: 4 }, accents: [3, 1, 1, 1], countInBars: 1, subdivision: 2, subPattern: [1, 1] });
  run(3.2); e.stop();
  const inCount = log.filter((x) => x.time < t0 + 2 - 1e-6);
  assert.ok(inCount.every((x) => x.role === 'count') && inCount.length === 4);
  const ps = events.find((x) => x.type === 'practice-start');
  assert.ok(close(ps.data.time, t0 + 2));
});

t('tempo trainer: steps at bar lines, stops at target, reports once', async () => {
  const { run, e, store, events } = await rig({ bpm: 60, sig: { num: 1, den: 4 }, accents: [3], trainer: { enabled: true, start: 60, step: 5, every: 2, target: 70 } });
  run(12); e.stop();
  assert.equal(store.get().bpm, 70);
  assert.equal(events.filter((x) => x.type === 'trainer-done').length, 1);
});

t('trainer never drags a hand-set tempo back past the target', async () => {
  const { run, e, store } = await rig({ bpm: 60, sig: { num: 1, den: 4 }, accents: [3], trainer: { enabled: true, start: 60, step: 2, every: 1, target: 100 } });
  run(1); store.set({ bpm: 123 }); e.tempoTouched(); run(5); e.stop();
  assert.equal(store.get().bpm, 123);
});

t('start keeps the tempo you set when no program is on (bug: jumped to 60)', async () => {
  const { e, store } = await rig({ bpm: 123 });
  e.stop(); await e.start(); e.stop();
  assert.equal(store.get().bpm, 123);
});

t('progressive practice: stages switch on time and pause/resume continues', async () => {
  const { run, e, store, events } = await rig({ bpm: 90, sig: { num: 4, den: 4 }, accents: [3, 1, 1, 1],
    progressive: { enabled: true, stages: [{ bpm: 60, seconds: 15 }, { bpm: 80, seconds: 15 }] } });
  assert.equal(store.get().bpm, 60);
  run(10); e.stop();                      // pause after ~10 s
  await e.start(); run(8);                // resume: should be in stage 2 now
  assert.equal(store.get().bpm, 80);
  run(20);
  assert.ok(events.some((x) => x.type === 'progressive-done'));
  assert.equal(e.running, false);
});

t('stop cancels: nothing is scheduled after stop', async () => {
  const { log, run, e } = await rig({ bpm: 200, sig: { num: 4, den: 4 }, accents: [3, 1, 1, 1] });
  run(1); e.stop(); const k = log.length; run(1); assert.equal(log.length, k);
});

t('suspended audio is resumed instead of dying silently', async () => {
  const { run, e, log } = await rig({ bpm: 120, sig: { num: 4, den: 4 }, accents: [3, 1, 1, 1] });
  run(1); e.ctx.state = 'suspended'; e.lastNudge = undefined; e.tick();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(e.ctx.state, 'running');
  const k = log.length; run(1); assert.ok(log.length > k); e.stop();
});

t('a scheduler error never stops the clock', async () => {
  const { run, e, log, store } = await rig({ bpm: 120, sig: { num: 4, den: 4 }, accents: [3, 1, 1, 1] });
  const orig = e.fire.bind(e); let thrown = false;
  e.fire = (...a) => { if (!thrown) { thrown = true; throw new Error('boom'); } return orig(...a); };
  run(2); e.stop();
  assert.ok(thrown && log.length >= 3);
});

(async () => {
  for (const [name, fn] of tests) { await fn(); n++; console.log('ok —', name); }
  console.log(`\n${n} engine tests passed`);
  process.exit(0);
})().catch((err) => { console.error('FAIL —', err.message); process.exit(1); });
