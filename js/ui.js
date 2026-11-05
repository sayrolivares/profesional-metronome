/* ui.js — DOM components, visuals synced to the audio clock, panels.
   Tempo ownership rule: what you set is what plays.
     • No program on: the BPM controls set the tempo, full stop.
     • Tempo trainer on: while stopped, the main tempo IS the trainer's start tempo.
     • Progressive on: the main tempo controls edit the current stage.
   Active tools are always shown as pills under the clocks, also in Simple mode. */
(function (root) {
  const MN = (root.MN = root.MN || {});
  const R = MN.rhythm;
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const svg = (tag, attrs = {}) => { const e = document.createElementNS(SVG_NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const k in attrs) {
      const v = attrs[k];
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'help') e.setAttribute('data-help', v);
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(e.dataset, v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids) if (c != null) e.append(c);
    return e;
  };
  const playIcon = () => { const s = svg('svg', { viewBox: '0 0 24 24' }); s.append(svg('path', { d: 'M6 4l14 8-14 8z' })); return s; };
  const fmt = (sec) => { sec = Math.max(0, Math.floor(sec)); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return (h ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(s).padStart(2, '0'); };
  const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
  const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const noteName = (f, a4) => {
    const n = Math.round(12 * Math.log2(f / a4)) + 57;
    const cents = Math.round(1200 * Math.log2(f / (a4 * Math.pow(2, (n - 57) / 12))));
    return `${NOTE_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12)}${cents ? (cents > 0 ? ' +' : ' ') + cents + '¢' : ''}`;
  };
  const isTyping = (t) => {
    if (!t) return false;
    if (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
    return t.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes(t.type);
  };

  function init(store, engine) {
    const S = () => store.get();
    const setPath = (path, v, extra) => {
      const [a, b] = path.split('.');
      const patch = b === undefined ? { [a]: v } : { [a]: Object.assign({}, S()[a], { [b]: v }) };
      store.set(Object.assign(patch, extra || {}));
    };
    const toastEl = $('#toast'); let toastT;
    const toast = (msg) => { toastEl.textContent = msg; toastEl.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('on'), 2600); };
    MN.toast = toast;   // shared with the tuner
    const chime = () => { if (!engine.ctx) return; const t = engine.now() + 0.05; engine.play('bell', 'beat', t, { vel: 0.6 }); engine.play('bell', 'beat', t + 0.35, { vel: 0.6, pitch: 1.5 }); };
    const tapper = new R.TapTempo();

    /* ================= help, dialogs, about ================= */
    MN.helpTip = MN.help.init(store);   // { hide }, also used by the tuner
    MN.dialogs.init();
    const APP = MN.APP;
    $('#appVersion').textContent = APP.version;
    $('#appReleased').textContent = APP.released;
    $('#igLink').href = APP.links.instagram;
    $('#xLink').href = APP.links.x;
    $('#copyDetails').addEventListener('click', async () => {
      const c = engine.ctx;
      const text = [
        `${APP.name} ${APP.version}`,
        navigator.userAgent,
        `Screen ${screen.width}×${screen.height}, window ${innerWidth}×${innerHeight}, touch ${navigator.maxTouchPoints > 0 ? 'yes' : 'no'}`,
        `Audio ${c ? `${c.state}, ${c.sampleRate} Hz` : 'not started'}`,
      ].join('\n');
      let ok = false;
      try { await navigator.clipboard.writeText(text); ok = true; } catch (e) {
        const ta = el('textarea', { style: 'position:fixed;opacity:0' }); ta.value = text; document.body.append(ta); ta.select();
        try { ok = document.execCommand('copy'); } catch (err) {} ta.remove();
      }
      toast(ok ? 'App details copied. Paste them into your message.' : 'Copy failed; please mention your device and browser instead.');
    });
    $('#helpToggle').addEventListener('click', () => {
      const on = !S().help; store.set({ help: on });
      toast(on ? 'Help hints on: hover over or tap any control' : 'Help hints off');
    });

    /* ================= audio gate & device state ================= */
    const gate = $('#gate'), gateTitle = $('#gateTitle'), gateText = $('#gateText'), gateBtn = $('#gateBtn');
    let gateMode = 'first';
    const seen = () => { try { return localStorage.getItem('metronome.v1.audioOk'); } catch (e) { return null; } };
    /* The app opens on the tuner, so the first-visit prompt waits until the metronome is
       actually opened, and leaves with it. */
    window.addEventListener('mn:view', (e) => {
      if (e.detail.view === 'metronome' && gateMode === 'first' && !seen() && !engine.ctx) gate.classList.remove('hidden');
      else if (e.detail.view !== 'metronome' && gateMode === 'first') gate.classList.add('hidden');
      /* Leaving the metronome stops it completely, as the Stop button does: the click goes
         silent, the bar, count-in, trainer and practice position are reset (a run of 10 s
         or more goes to the practice log as usual). Coming back finds it stopped; nothing
         restarts on its own. */
      if (e.detail.view !== 'metronome' && (engine.running || engine.practiceElapsed() > 0)) stopAll();
    });
    const showGate = (mode) => {
      gateMode = mode;
      if (mode === 'resume') { gateTitle.textContent = 'Sound paused'; gateText.textContent = 'Your device paused the audio, for example after a call or when another app took over. Tap to bring the sound back.'; gateBtn.textContent = 'Resume sound'; gate.classList.add('soft'); }
      gate.classList.remove('hidden');
    };
    gateBtn.addEventListener('click', async () => {
      try {
        await engine.init(); await engine.resume();
        gate.classList.add('hidden');
        try { localStorage.setItem('metronome.v1.audioOk', '1'); } catch (e) {}
        if (gateMode === 'resume') engine.tick();
      } catch (e) { toast(e.message || 'Audio could not start'); }
    });
    const anyTone = () => refOn || genOn;
    let lastErrorToast = 0;
    engine.on((type, data) => {
      if (type === 'audiostate') {
        if ((data.state === 'suspended' || data.state === 'interrupted') && (engine.running || anyTone())) setTimeout(() => {
          if (engine.ctx && engine.ctx.state !== 'running' && (engine.running || anyTone())) showGate('resume');
        }, 700);
        if (data.state === 'running' && gateMode === 'resume') gate.classList.add('hidden');
      }
      if (type === 'recovered') { setTone('ref', false); setTone('gen', false); toast('Audio output restarted'); }
      if (type === 'error' && performance.now() - lastErrorToast > 8000) { lastErrorToast = performance.now(); console.warn(data); }
    });
    /* any touch or key is a user gesture that lets the browser resume audio */
    document.addEventListener('pointerdown', () => engine.resumeIfNeeded(), true);
    document.addEventListener('keydown', () => engine.resumeIfNeeded(), true);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { engine.resumeIfNeeded(); engine.tick(); } else store.flush(); });
    window.addEventListener('pagehide', () => store.flush());

    /* ================= theme, mode, tabs ================= */
    /* ---- preferences: theme mode, palette, note names ---- */
    const T = MN.terms;
    T.set(S().terms);
    $$('#themeSeg button').forEach((b) => b.addEventListener('click', () => store.set({ theme: b.dataset.v })));
    $$('#termsSeg button').forEach((b) => b.addEventListener('click', () => store.set({ terms: b.dataset.v })));
    const palettesEl = $('#palettes');
    const checkIcon = () => { const c = svg('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }); c.append(svg('path', { d: 'M5 12.5l4.5 4.5L19 7.5' })); return c; };
    function swatch(id, mode) {
      const t = MN.themes.tokens(id, mode);
      const g = svg('svg', { viewBox: '0 0 120 64', 'aria-hidden': 'true' });
      g.append(svg('rect', { width: 120, height: 64, rx: 9, fill: t.bg }));
      g.append(svg('circle', { cx: 34, cy: 34, r: 18, fill: 'none', stroke: t.lineStrong, 'stroke-width': 1.6 }));
      g.append(svg('circle', { cx: 34, cy: 16, r: 4.6, fill: t.accent }));
      g.append(svg('rect', { x: 26, y: 31, width: 16, height: 5, rx: 2.5, fill: t.text, opacity: 0.85 }));
      g.append(svg('rect', { x: 68, y: 10, width: 42, height: 44, rx: 6, fill: t.surface, stroke: t.line }));
      g.append(svg('rect', { x: 74, y: 17, width: 13, height: 8, rx: 2.5, fill: t.accent }));
      g.append(svg('rect', { x: 90, y: 17, width: 13, height: 8, rx: 2.5, fill: t.surface2 }));
      g.append(svg('rect', { x: 74, y: 32, width: 29, height: 3, rx: 1.5, fill: t.muted, opacity: 0.6 }));
      g.append(svg('rect', { x: 74, y: 40, width: 20, height: 3, rx: 1.5, fill: t.faint, opacity: 0.7 }));
      return g;
    }
    function renderPrefs(s) {
      $$('#themeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === s.theme));
      $$('#termsSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === s.terms));
      const mode = MN.themes.resolveMode(s.theme);
      palettesEl.innerHTML = '';
      for (const p of MN.themes.PALETTES) {
        palettesEl.append(el('button', { class: 'palette' + (p.id === s.palette ? ' on' : ''), 'aria-pressed': String(p.id === s.palette), 'aria-label': `${p.name} palette`,
          help: `${p.name}::${p.blurb}. Available in light and dark.`, onclick: () => store.set({ palette: p.id }) },
          swatch(p.id, mode), el('span', { class: 'pn', text: p.name }), el('span', { class: 'pb', text: p.blurb }), el('span', { class: 'check' }, checkIcon())));
      }
      $('#termsExample').textContent = [4, 8, 16, 2].map((d, i) => (i ? T.note(d) : T.note(d, { capital: true }))).join(', ') + '.';
    }
    $('#prefs-dlg').addEventListener('dlg-open', () => renderPrefs(S()));
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onSys = () => { if (S().theme === 'auto') renderPrefs(S()); };
      mq.addEventListener ? mq.addEventListener('change', onSys) : mq.addListener(onSys);
    }

    /* ---- every place that names a note value follows the chosen terminology ---- */
    function applyTerms(s) {
      const { num, den } = s.sig;
      const compound = R.isCompound(s.sig);
      const felt = compound && s.sig.compound;
      $('#beatUnit').dataset.help = `Beat unit::Each BPM count is ${T.a(T.note(den, { dotted: felt }))}.` + (felt ? ' In compound feel, the beat is a dotted note.' : '');
      $('#sigDen').dataset.help = `Beat unit::The note that gets one beat: 2 = ${T.note(2)}, 4 = ${T.note(4)}, 8 = ${T.note(8)}, 16 = ${T.note(16)}.`;
      $('#compoundSeg').dataset.help = compound
        ? `Compound feel::Pulses counts every ${T.note(den)} (${num} beats per bar). Dotted beats groups them in threes (${num / 3} beats per bar) and the tempo counts ${T.note(den, { dotted: true, plural: true })}.`
        : 'Compound feel::Available for compound meters such as 6/8, 9/8 and 12/8.';
      $('#feelSeg [data-v="dotted"]').dataset.help = `Dotted::${T.note(8, { dotted: true, capital: true })} plus ${T.note(16)}, a 3:1 ratio. Works on even subdivisions.`;
      $('#feelSeg [data-v="swing"]').dataset.help = `Swing::Long-short pairs in a 2:1 ratio, the jazz triplet feel. Works on even subdivisions.`;
      $$('#sigPicks .sig').forEach((b) => {
        const n = +b.dataset.num, d = +b.dataset.den;
        const c = R.isCompound({ num: n, den: d });
        b.dataset.help = `${n}/${d}::` + (c
          ? `${n / 3} dotted beats per bar, each ${T.a(T.note(d, { dotted: true }))}; or ${n} pulses, each ${T.a(T.note(d))}.`
          : `${n} beats per bar, each ${T.a(T.note(d))}.`) + ' Changing the meter resets the accent pattern.';
      });
      $$('#subPicker .sub-btn').forEach((b) => {
        const n = +b.dataset.n; const [l1, l2] = T.subLabel(n);
        b.querySelector('.sl1').textContent = l1;
        b.querySelector('.sl2').textContent = l2;
        b.dataset.help = `${l1}${l2 ? ' · ' + l2 : ''}::${subHelp(n)}`;
      });
    }
    const subHelp = (n) => ({
      1: 'The beat only, with no subdivision.',
      2: `Two even pulses per beat (1 &): ${T.subLong(2)} when the beat is ${T.a(T.note(4))}.`,
      3: `Three pulses per beat (1 trip let): ${T.subLong(3)} when the beat is ${T.a(T.note(4))}. In 6/8 felt in dotted beats, these are the ${T.note(8, { plural: true })}.`,
      4: `Four pulses per beat (1 e & a): ${T.subLong(4)} when the beat is ${T.a(T.note(4))}.`,
      6: `Six pulses per beat, two triplets: ${T.subLong(6)} when the beat is ${T.a(T.note(4))}.`,
      8: `Eight pulses per beat: ${T.subLong(8)} when the beat is ${T.a(T.note(4))}.`,
    }[n]);
    $$('#modeSeg button').forEach((b) => b.addEventListener('click', () => store.set({ mode: b.dataset.mode })));
    $$('#tabs button').forEach((b) => b.addEventListener('click', () => store.set({ panel: b.dataset.panel })));
    const openPanel = (panel) => { store.set({ mode: 'advanced', panel }); requestAnimationFrame(() => $('#tabs').scrollIntoView({ behavior: 'smooth', block: 'start' })); };

    /* ================= tempo ================= */
    const bpmNum = $('#bpmNum'), marking = $('#marking'), slider = $('#bpmSlider'), bpmInput = $('#bpmInput'), beatUnit = $('#beatUnit');
    const stageIndexNow = (s) => {
      if (engine.running && engine.progStage >= 0) return engine.progStage;
      const st = R.progressiveStage(s.progressive.stages, engine.programElapsed());
      return st ? st.index : 0;
    };
    const setBpm = (v) => {
      const s = S();
      const n = Number(v);
      if (!Number.isFinite(n)) { bpmInput.value = s.bpm; return; }
      const bpm = R.clamp(Math.round(n), 20, s.maxBpm);
      if (bpm === s.bpm) { if (document.activeElement !== bpmInput) bpmInput.value = bpm; return; }
      const patch = { bpm };
      if (s.progressive.enabled && s.progressive.stages.length) {
        const i = stageIndexNow(s);
        const stages = s.progressive.stages.map((x) => Object.assign({}, x));
        if (stages[i]) stages[i].bpm = bpm;
        patch.progressive = Object.assign({}, s.progressive, { stages });
      } else if (s.trainer.enabled && !engine.running) {
        patch.trainer = Object.assign({}, s.trainer, { start: bpm });
      }
      store.set(patch);
      if (engine.running) engine.tempoTouched();
    };
    slider.addEventListener('input', () => setBpm(slider.value));
    const commitInput = () => {
      const raw = bpmInput.value.trim();
      if (raw === '') { bpmInput.value = S().bpm; return; }
      setBpm(raw);
      bpmInput.value = S().bpm;
    };
    bpmInput.addEventListener('change', commitInput);
    bpmInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { commitInput(); bpmInput.blur(); } });
    bpmInput.addEventListener('focus', () => bpmInput.select());
    bpmInput.addEventListener('wheel', (e) => { if (document.activeElement === bpmInput) e.preventDefault(); }, { passive: false });
    $$('.steps .chip').forEach((b) => b.addEventListener('click', () => setBpm(S().bpm + +b.dataset.step)));
    /* ± buttons: click = 1 BPM, hold = repeat */
    for (const [id, d] of [['#bpmMinus', -1], ['#bpmPlus', 1]]) {
      const b = $(id); let t1 = null, t2 = null, held = false;
      const stop = () => { clearTimeout(t1); clearInterval(t2); t1 = t2 = null; };
      b.addEventListener('pointerdown', (e) => {
        stop(); held = false;
        try { b.setPointerCapture(e.pointerId); } catch (err) {}
        t1 = setTimeout(() => { held = true; t2 = setInterval(() => setBpm(S().bpm + d), 70); }, 450);
      });
      ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => b.addEventListener(ev, stop));
      b.addEventListener('click', () => { if (!held) setBpm(S().bpm + d); held = false; });
      window.addEventListener('blur', stop);
    }

    /* ================= tap tempo ================= */
    const tapBtn = $('#tapBtn'), beatcount = $('#beatcount');
    const doTap = () => {
      const bpm = tapper.tap(performance.now() / 1000);
      tapBtn.classList.add('flash'); setTimeout(() => tapBtn.classList.remove('flash'), 90);
      if (bpm) setBpm(bpm);
      if (!engine.running) { beatcount.textContent = bpm ? `tapped · ${tapper.count()} taps` : 'tap again…'; beatcount.className = 'beatcount live'; }
    };
    tapBtn.addEventListener('pointerdown', (e) => { if (e.button === 0 || e.pointerType !== 'mouse') { e.preventDefault(); doTap(); } });
    tapBtn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doTap(); } });

    /* ================= transport ================= */
    const playBtn = $('#playBtn');
    let runStartBpm = null;
    const syncTransport = () => {
      playBtn.classList.toggle('playing', engine.running);
      playBtn.setAttribute('aria-label', engine.running ? 'Pause' : 'Play');
    };
    const start = async () => {
      try { await engine.start(); }
      catch (e) { toast(e.message || 'Audio could not start'); return; }
      if (!engine.running) return;
      gate.classList.add('hidden');
      try { localStorage.setItem('metronome.v1.audioOk', '1'); } catch (e) {}
      if (runStartBpm === null) runStartBpm = S().bpm;
    };
    const pause = () => engine.stop();
    const logRun = (s, dur) => {
      const parts = [];
      if (s.subdivision > 1) parts.push(T.subName(s.subdivision) + (s.feel !== 'straight' && s.subdivision % 2 === 0 ? ' ' + s.feel : ''));
      if (s.trainer.enabled) parts.push(`trainer ${s.trainer.start}→${s.trainer.target}`);
      if (s.progressive.enabled) parts.push('progressive');
      if (s.silent.enabled) parts.push(`silent ${s.silent.play}/${s.silent.silence}`);
      if (s.poly.enabled) parts.push(`poly ${R.beatsPerBar(s.sig)}:${s.poly.against}`);
      store.addSession({ date: Date.now(), duration: dur, startBpm: runStartBpm, endBpm: s.bpm, sig: `${s.sig.num}/${s.sig.den}`, name: s.sessionName || '', config: parts.join(', ') || 'plain beat' });
      todayCache = null;
      renderHistory();
    };
    const stopAll = () => {
      const s = S();
      const dur = engine.practiceElapsed();
      engine.reset();
      if (dur >= 10 && runStartBpm !== null) logRun(s, dur);
      runStartBpm = null;
      if (s.trainer.enabled && s.bpm !== s.trainer.start) store.set({ bpm: s.trainer.start }, 'program');
      else if (s.progressive.enabled && s.progressive.stages.length && s.bpm !== s.progressive.stages[0].bpm) store.set({ bpm: s.progressive.stages[0].bpm }, 'program');
      resetVisual(); syncTransport(); updateClocks(); renderStatus(); renderStages();
    };
    playBtn.addEventListener('click', () => (engine.running ? pause() : start()));
    $('#stopBtn').addEventListener('click', stopAll);

    engine.on((type, data) => {
      if (type === 'start' || type === 'stop') { syncTransport(); renderStatus(); }
      if (type === 'trainer-done') toast(`Target reached: ${data.bpm} BPM`);
      if (type === 'progressive-done') { toast('Progression complete'); if (S().timer.notify) chime(); stopAll(); }
      if (type === 'stage') { renderStages(); renderStatus(); if (data.index > 0) toast(`Stage ${data.index + 1}: ${data.bpm} BPM`); }
    });

    /* ================= ring ================= */
    const ring = $('#ring'), ringWrap = $('#ringWrap');
    const CX = 200, CY = 200, RAD = 170, PRAD = 128;
    let markers = [], labels = [], subDots = {}, polyMarkers = [], glow, pendArm, pendBob, ringKey = '';
    const polar = (deg, r) => [CX + r * Math.cos((deg - 90) * Math.PI / 180), CY + r * Math.sin((deg - 90) * Math.PI / 180)];
    function buildRing(s) {
      const bpb = R.beatsPerBar(s.sig);
      const key = JSON.stringify([bpb, s.accents, s.subdivision, s.subPattern, s.feel, s.poly, s.pendulum]);
      if (key === ringKey) return; ringKey = key;
      ring.innerHTML = ''; markers = []; labels = []; subDots = {}; polyMarkers = [];
      glow = svg('circle', { cx: CX, cy: CY, r: RAD - 14, class: 'ring-glow' }); ring.append(glow);
      ring.append(svg('circle', { cx: CX, cy: CY, r: RAD, class: 'ring-track' }));
      const step = 360 / bpb;
      const mr = Math.min(13, (2 * Math.PI * RAD) / bpb / 3.2);
      const offsets = R.subOffsets(s.subdivision, s.feel);
      for (let i = 0; i < bpb; i++) for (let j = 1; j < s.subdivision; j++) {
        const [x, y] = polar(i * step + offsets[j] * step, RAD);
        const lvl = s.subPattern[j] === undefined ? 1 : s.subPattern[j];
        const d = svg('circle', { cx: x, cy: y, r: lvl === 2 ? 4.2 : 3, class: 'sub-dot' + (lvl === 0 ? ' off' : lvl === 2 ? ' acc' : '') });
        ring.append(d); subDots[`${i}-${j}`] = d;
      }
      for (let i = 0; i < bpb; i++) {
        const [x, y] = polar(i * step, RAD);
        const lvl = s.accents[i] === undefined ? 1 : s.accents[i];
        const r = lvl === 3 ? mr : lvl === 2 ? mr * 0.86 : lvl === 1 ? mr * 0.72 : mr * 0.5;
        const c = svg('circle', { cx: x, cy: y, r, class: 'beat-marker ' + ['silent', '', 'medium', 'strong'][lvl] });
        ring.append(c); markers.push(c);
        if (bpb <= 16) { const t = svg('text', { x, y: y + 0.5, class: 'beat-label' }); t.style.fontSize = (mr >= 11 ? 11 : 9) + 'px'; t.textContent = i + 1; ring.append(t); labels[i] = t; }
      }
      if (s.poly.enabled) {
        ring.append(svg('circle', { cx: CX, cy: CY, r: PRAD, class: 'poly-ring' }));
        for (let k = 0; k < s.poly.against; k++) {
          const [x, y] = polar((k * 360) / s.poly.against, PRAD);
          const c = svg('circle', { cx: x, cy: y, r: 6.5, class: 'poly-marker' }); ring.append(c); polyMarkers.push(c);
        }
      }
      if (s.pendulum) {
        pendArm = svg('line', { x1: CX, y1: 24, x2: CX, y2: 8, class: 'pendulum' });
        pendBob = svg('circle', { cx: CX, cy: 6, r: 4.5, class: 'pendulum-bob' });
        ring.append(pendArm, pendBob);
      } else pendArm = pendBob = null;
      curBeat = -1;
    }
    let curBeat = -1, lastBeatTime = 0, lastBeatDur = 0.5, beatParity = 0;
    function resetVisual() {
      markers.forEach((m) => m.classList.remove('on', 'muted-bar', 'countin'));
      labels.forEach((l) => l && l.classList.remove('on', 'muted-bar'));
      for (const k in subDots) subDots[k].classList.remove('on');
      polyMarkers.forEach((m) => m.classList.remove('on'));
      $$('.accent-cell.live').forEach((c) => c.classList.remove('live'));
      curBeat = -1; beatcount.textContent = ''; beatcount.className = 'beatcount';
      if (pendArm) { pendArm.style.transform = ''; pendBob.style.transform = ''; }
    }
    function onBeat(ev) {
      const s = S();
      lastBeatTime = ev.time; lastBeatDur = ev.beatDur; beatParity ^= 1;
      if (s.visual !== 'off') {
        if (curBeat >= 0 && markers[curBeat]) { markers[curBeat].classList.remove('on', 'muted-bar', 'countin'); if (labels[curBeat]) labels[curBeat].classList.remove('on', 'muted-bar'); }
        const m = markers[ev.beat];
        if (m) {
          m.classList.add('on');
          if (ev.silent) m.classList.add('muted-bar');
          if (ev.countIn) m.classList.add('countin');
          else if (labels[ev.beat]) { labels[ev.beat].classList.add('on'); if (ev.silent) labels[ev.beat].classList.add('muted-bar'); }
        }
        if (s.visual === 'full' && !ev.silent && !s.muted) {
          const strong = ev.accent === 3 ? 1 : ev.accent === 2 ? 0.7 : 0.45;
          bpmNum.animate([{ transform: 'scale(1)' }, { transform: `scale(${1 + 0.03 * strong})` }, { transform: 'scale(1)' }], { duration: 170, easing: 'ease-out' });
          glow.animate([{ opacity: 0.13 * strong, transform: 'scale(.96)' }, { opacity: 0, transform: 'scale(1.03)' }], { duration: 320, easing: 'ease-out' });
        }
      }
      curBeat = ev.beat;
      if (ev.countIn) { beatcount.textContent = `count-in ${ev.countInBar} · ${ev.beat + 1}`; beatcount.className = 'beatcount countin'; }
      else if (ev.silent) { beatcount.textContent = `silent · ${ev.beat + 1} of ${ev.beats}`; beatcount.className = 'beatcount silent'; }
      else { beatcount.textContent = `bar ${ev.bar + 1} · ${ev.beat + 1} of ${ev.beats}`; beatcount.className = 'beatcount live'; }
      $$('.accent-cell').forEach((c, i) => c.classList.toggle('live', i === ev.beat && !ev.countIn));
    }
    function onSub(ev) {
      if (S().visual !== 'full' || ev.silent) return;
      const d = subDots[`${ev.beat}-${ev.sub}`]; if (!d) return;
      d.classList.add('on');
      setTimeout(() => d.classList.remove('on'), Math.min(140, (lastBeatDur * 1000) / Math.max(1, S().subdivision) * 0.8));
    }
    function onPoly(ev) {
      if (S().visual === 'off') return;
      polyMarkers.forEach((m, i) => m.classList.toggle('on', i === ev.idx && !ev.silent));
    }
    function frame() {
      try {
        if (engine.ctx) {
          const lat = engine.ctx.outputLatency || engine.ctx.baseLatency || 0;
          const now = engine.ctx.currentTime - lat;
          for (const ev of engine.drain(now)) { if (ev.type === 'beat') onBeat(ev); else if (ev.type === 'sub') onSub(ev); else onPoly(ev); }
          if (pendArm && engine.running && S().visual !== 'off') {
            const p = Math.min(1, Math.max(0, (now - lastBeatTime) / lastBeatDur));
            const ang = 34 * Math.cos(Math.PI * p) * (beatParity ? 1 : -1);
            pendArm.style.transform = pendBob.style.transform = `rotate(${ang}deg)`;
          }
        }
      } catch (e) { console.error(e); }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    /* ================= clocks & timer ================= */
    const elapsedEl = $('#elapsed'), remainWrap = $('#remainWrap'), remainEl = $('#remaining'), todayEl = $('#today');
    let todayCache = null;
    const todayLogged = () => {
      const key = new Date().toDateString();
      if (!todayCache || todayCache.key !== key) { const st = store.stats(); todayCache = { key, v: st ? st.today : 0 }; }
      return todayCache.v;
    };
    let stopping = false;
    function updateClocks() {
      const s = S(); const e = engine.practiceElapsed();
      elapsedEl.textContent = fmt(e);
      todayEl.textContent = fmt(todayLogged() + e);
      let remaining = null;
      if (s.timer.enabled) {
        const total = s.timer.minutes * 60 + s.timer.seconds;
        if (total > 0) {
          remaining = total - e;
          if (engine.running && remaining <= 0 && !stopping) {
            stopping = true; stopAll(); stopping = false;
            toast('Practice time is up'); if (s.timer.notify) chime();
            return;
          }
        }
      }
      if (remaining === null && s.progressive.enabled && s.progressive.stages.length && (engine.running || e > 0)) {
        const st = R.progressiveStage(s.progressive.stages, engine.programElapsed());
        if (st) remaining = st.remaining;
      }
      remainWrap.classList.toggle('hidden', remaining === null);
      if (remaining !== null) remainEl.textContent = fmt(remaining);
    }
    setInterval(updateClocks, 250);   // independent of animation frames, so it also runs in the background

    /* ================= status pills ================= */
    const statusEl = $('#status');
    function renderStatus() {
      const s = S(); const pills = [];
      const bpb = R.beatsPerBar(s.sig);
      if (s.muted) pills.push({ label: 'Muted', warn: true, help: 'Muted::The metronome keeps time without sound. Press × or M to unmute.', off: () => store.set({ muted: false }) });
      if (s.trainer.enabled) pills.push({ label: `Trainer ${s.trainer.start} → ${s.trainer.target} BPM`, help: `Tempo trainer::${s.trainer.step > 0 ? (s.trainer.target >= s.trainer.start ? '+' : '−') + s.trainer.step : ''} BPM every ${s.trainer.every} bar${s.trainer.every > 1 ? 's' : ''}. Click to edit, × to switch off.`, off: () => toggleTool('trainer', false), panel: 'practice' });
      if (s.progressive.enabled) {
        const n = s.progressive.stages.length;
        pills.push({ label: n ? `Progressive · stage ${stageIndexNow(s) + 1} of ${n}` : 'Progressive · no stages', help: 'Progressive practice::The tempo follows the stage list. The tempo controls edit the current stage. Click to edit, × to switch off.', off: () => toggleTool('progressive', false), panel: 'practice' });
      }
      if (s.silent.enabled) pills.push({ label: `Silent bars ${s.silent.play} + ${s.silent.silence}`, help: `Silent bars::${s.silent.play} bar${s.silent.play > 1 ? 's' : ''} with sound, then ${s.silent.silence} without. Click to edit, × to switch off.`, off: () => toggleTool('silent', false), panel: 'practice' });
      if (s.poly.enabled) pills.push({ label: `Polyrhythm ${bpb}:${s.poly.against}`, help: `Polyrhythm::${s.poly.against} pulses against ${bpb} beats in every bar. Click to edit, × to switch off.`, off: () => toggleTool('poly', false), panel: 'practice' });
      if (s.timer.enabled) pills.push({ label: `Timer ${fmt(s.timer.minutes * 60 + s.timer.seconds)}`, help: 'Practice timer::The metronome stops after this much practice. Click to edit, × to switch off.', off: () => toggleTool('timer', false), panel: 'practice' });
      statusEl.innerHTML = '';
      for (const p of pills) {
        statusEl.append(el('span', { class: 'pill' + (p.warn ? ' warn' : ''), help: p.help },
          el('button', { class: 'pl', text: p.label, onclick: () => (p.panel ? openPanel(p.panel) : p.off()) }),
          el('button', { class: 'px', 'aria-label': 'Switch off ' + p.label, text: '×', onclick: p.off })));
      }
    }

    /* ================= quick settings ================= */
    const sigPicks = $('#sigPicks');
    for (const [num, den] of R.SIGNATURES) {
      const compound = R.isCompound({ num, den });
      sigPicks.append(el('button', { class: 'sig', dataset: { num, den }, text: `${num}/${den}`, onclick: () => setSig(num, den),
        help: `${num}/${den}::${compound ? `${num / 3} dotted beats or ${num} eighth-note pulses per bar.` : `${num} ${den === 2 ? 'half' : den === 8 ? 'eighth' : 'quarter'}-note beats per bar.`} Changing the meter resets the accent pattern.` }));
    }
    const setSig = (num, den, compound) => {
      const s = S();
      const sig = { num, den, compound: compound === undefined ? s.sig.compound : compound };
      const same = num === s.sig.num && den === s.sig.den && sig.compound === s.sig.compound;
      if (same) return;
      store.set({ sig, accents: R.defaultAccents(sig) });
    };
    const sigNum = $('#sigNum');
    const commitSigNum = () => { const v = Math.round(+sigNum.value); if (!Number.isFinite(v) || v < 1) { sigNum.value = S().sig.num; return; } setSig(R.clamp(v, 1, 32), S().sig.den); };
    sigNum.addEventListener('change', commitSigNum);
    sigNum.addEventListener('keydown', (e) => { if (e.key === 'Enter') { commitSigNum(); sigNum.blur(); } });
    $('#sigDen').addEventListener('change', (e) => setSig(S().sig.num, +e.target.value));
    $$('#compoundSeg button').forEach((b) => b.addEventListener('click', () => { const s = S(); setSig(s.sig.num, s.sig.den, b.dataset.compound === 'true'); }));

    const quickSound = $('#quickSound');
    for (const v of MN.sounds.VOICES) quickSound.append(el('option', { value: v.id, text: v.name }));
    quickSound.addEventListener('change', () => {
      const s = S(), id = quickSound.value;
      const linked = s.soundAccent === s.soundBeat || (s.soundBeat === 'soft-wood' && s.soundAccent === 'warm-wood');
      const patch = { soundBeat: id };
      if (linked) patch.soundAccent = id === 'soft-wood' ? 'warm-wood' : id;
      store.set(patch);
      engine.preview(id);
    });
    $('#quickPreview').addEventListener('click', () => engine.preview(S().soundBeat));
    $$('#countInSeg button').forEach((b) => b.addEventListener('click', () => store.set({ countInBars: +b.dataset.v })));
    $('#masterVol').addEventListener('input', (e) => store.set({ masterVolume: +e.target.value }));
    $('#muteBtn').addEventListener('click', () => store.set({ muted: !S().muted }));
    $$('#visualSeg button').forEach((b) => b.addEventListener('click', () => store.set({ visual: b.dataset.v })));
    $('#pendulumSw').addEventListener('click', () => store.set({ pendulum: !S().pendulum }));

    /* ================= rhythm panel ================= */
    const subPicker = $('#subPicker');
    const noteIcon = (n) => {
      const beams = { 1: 0, 2: 1, 3: 1, 4: 2, 6: 2, 8: 3 }[n];
      const w = 54, h = 34, left = 7, span = n === 1 ? 0 : (w - 16) / (n - 1);
      const g = svg('svg', { viewBox: `0 0 ${w} ${h}` });
      for (let i = 0; i < n; i++) {
        const x = left + i * span, y = 27;
        g.append(svg('ellipse', { cx: x, cy: y, rx: 3.6, ry: 2.6, class: 'nh', transform: `rotate(-20 ${x} ${y})` }));
        g.append(svg('line', { x1: x + 3.1, y1: y - 1, x2: x + 3.1, y2: 8, class: 'st', 'stroke-width': 1.3 }));
      }
      for (let b = 0; b < beams; b++) g.append(svg('line', { x1: left + 3.1, y1: 8 + b * 3.4, x2: left + (n - 1) * span + 3.1, y2: 8 + b * 3.4, class: 'st', 'stroke-width': 2.4 }));
      if (n === 3 || n === 6) { const t = svg('text', { x: w / 2, y: 5.5, 'text-anchor': 'middle', class: 'nh', 'font-size': '8', 'font-style': 'italic' }); t.textContent = n; g.append(t); }
      return g;
    };
    for (const sd of R.SUBDIVISIONS) {
      subPicker.append(el('button', { class: 'sub-btn', dataset: { n: sd.n }, onclick: () => store.set({ subdivision: sd.n, subPattern: new Array(sd.n).fill(1) }) },
        noteIcon(sd.n), el('span', { class: 'sl1' }), el('span', { class: 'sl2' })));
    }
    $$('#feelSeg button').forEach((b) => b.addEventListener('click', () => store.set({ feel: b.dataset.v })));
    $('#subVol').addEventListener('input', (e) => store.set({ subVolume: +e.target.value }));
    const subPattern = $('#subPattern');
    function renderSubPattern(s) {
      subPattern.innerHTML = '';
      const n = s.subdivision; const off = R.subOffsets(n, s.feel);
      const names = { 2: ['1', '&'], 3: ['1', 'trip', 'let'], 4: ['1', 'e', '&', 'a'] };
      for (let i = 0; i < n; i++) {
        const lvl = i === 0 ? 1 : (s.subPattern[i] === undefined ? 1 : s.subPattern[i]);
        const c = el('button', { class: 'sub-cell' + (i === 0 ? ' main' : ''), dataset: { level: lvl }, 'aria-label': i === 0 ? 'Beat' : `Pulse ${i + 1}: ${['muted', 'normal', 'accented'][lvl]}`, onclick: () => {
          if (i === 0) return;
          const p = S().subPattern.slice(); while (p.length < n) p.push(1);
          p[i] = p[i] === 1 ? 2 : p[i] === 2 ? 0 : 1; store.set({ subPattern: p });
        } }, el('span', { class: 'pos', text: names[n] ? names[n][i] : (i === 0 ? '1' : '·') }));
        c.style.flexGrow = String(((i + 1 < n ? off[i + 1] : 1) - off[i]) * n);
        subPattern.append(c);
      }
      subPattern.classList.toggle('hidden', n === 1);
      $('#feelNote').textContent = n === 1 ? 'Choose a subdivision to use a feel' : n % 2 ? 'Feel applies to even subdivisions' : '';
    }
    const accentEditor = $('#accentEditor');
    function renderAccents(s) {
      accentEditor.innerHTML = '';
      s.accents.forEach((lvl, i) => accentEditor.append(el('button', { class: 'accent-cell', dataset: { level: lvl }, 'aria-label': `Beat ${i + 1}: ${['silent', 'normal', 'medium', 'strong'][lvl]}`,
        help: `Beat ${i + 1}: ${['silent', 'normal', 'medium accent', 'strong accent'][lvl]}::Tap to cycle strong → medium → normal → silent.`, onclick: () => {
          const a = S().accents.slice(); a[i] = (a[i] + 3) % 4; store.set({ accents: a });
        } }, el('span', { class: 'bar' }), el('span', { class: 'n', text: i + 1 }))));
    }
    $('#savePattern').addEventListener('click', () => { const n = $('#patternName').value.trim() || `${S().accents.length}-beat pattern`; store.saveAccentPattern(n); $('#patternName').value = ''; renderPatterns(); toast(`Saved pattern “${n}”`); });
    $('#resetPattern').addEventListener('click', () => store.set({ accents: R.defaultAccents(S().sig) }));
    function renderPatterns() {
      const list = $('#patternList'); list.innerHTML = '';
      const bpb = R.beatsPerBar(S().sig);
      for (const p of store.accentPatterns) {
        const fits = p.beats === bpb;
        list.append(el('div', { class: 'item' }, el('div', {}, el('div', { text: p.name }), el('div', { class: 'meta', text: `${p.beats} beats · ${p.accents.map((a) => '·-=≡'[a]).join(' ')}` })),
          el('div', { class: 'acts' },
            el('button', { class: 'btn small ghost', text: fits ? 'Use' : `needs ${p.beats} beats`, disabled: !fits, help: fits ? 'Use pattern::Apply it to the current meter.' : `Needs ${p.beats} beats::Switch to a meter with ${p.beats} beats per bar to use this pattern.`, onclick: () => store.set({ accents: p.accents.slice() }) }),
            el('button', { class: 'btn small ghost danger', text: 'Delete', onclick: () => { store.deleteAccentPattern(p.id); renderPatterns(); } }))));
      }
    }

    /* ================= sound panel ================= */
    const ROLES = [
      { key: 'soundBeat', label: 'Beat', role: 'beat', help: 'Beat voice::Plays normal and medium-accented beats, and the count-in.',
        status: () => 'Every beat', idle: () => false },
      { key: 'soundAccent', label: 'Accent', role: 'accent', help: 'Accent voice::Plays the strong beats. If it is the same voice as Beat, accents are pitched lower so they still stand out.',
        status: (s) => (s.accents.includes(3) ? 'Strong beats' : 'No strong beat in the accent pattern'), idle: (s) => !s.accents.includes(3) },
      { key: 'soundSub', label: 'Subdivision', role: 'sub', help: 'Subdivision voice::Plays the pulses between the beats.',
        status: (s) => (s.subdivision > 1 ? T.subLabel(s.subdivision).filter(Boolean).join(' · ') : 'Off · choose a subdivision in Rhythm'), idle: (s) => s.subdivision === 1 },
      { key: 'soundPoly', label: 'Polyrhythm', role: 'poly', help: 'Polyrhythm voice::Plays the second rhythm against your beats.',
        status: (s) => (s.poly.enabled ? `${R.beatsPerBar(s.sig)}:${s.poly.against}` : 'Off · switch on Polyrhythm in Practice'), idle: (s) => !s.poly.enabled },
    ];
    const roleRows = $('#roleRows');
    for (const r of ROLES) {
      const sel = el('select', { 'aria-label': r.label + ' voice' });
      for (const v of MN.sounds.VOICES) sel.append(el('option', { value: v.id, text: v.name }));
      const row = el('div', { class: 'role-row', dataset: { key: r.key } },
        el('div', { class: 'rinfo', help: r.help }, el('div', { class: 'rn', text: r.label }), el('div', { class: 'rs' })),
        sel,
        el('button', { class: 'preview-btn', 'aria-label': 'Listen to the ' + r.label.toLowerCase() + ' voice', help: `Listen::Play the ${r.label.toLowerCase()} voice once.`, onclick: () => engine.preview(S()[r.key], r.role) }, playIcon()));
      sel.addEventListener('change', () => {
        store.set({ [r.key]: sel.value });
        engine.preview(sel.value, r.role);
        row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 500);
      });
      roleRows.append(row);
    }
    function renderRoles(s) {
      for (const r of ROLES) {
        const row = roleRows.querySelector(`[data-key="${r.key}"]`);
        const sel = row.querySelector('select');
        if (sel.value !== s[r.key]) sel.value = s[r.key];
        row.querySelector('.rs').textContent = r.status(s);
        row.classList.toggle('idle', r.idle(s));
      }
    }
    const voices = $('#voices');
    for (const v of MN.sounds.VOICES) {
      const card = el('button', { class: 'voice', dataset: { id: v.id }, help: `${v.name}::${v.desc}. Tap to hear it; choose it for a role in Voices above.`, onclick: () => {
        engine.preview(v.id); card.classList.add('ping'); setTimeout(() => card.classList.remove('ping'), 300);
      } }, el('div', {}, el('div', { class: 'name', text: v.name }), el('div', { class: 'desc', text: v.desc })), el('span', { class: 'play-ico' }, playIcon()));
      voices.append(card);
    }
    const sliderRow = (label, key, min, max, fmtV, parentSel, help) => {
      const inp = el('input', { type: 'range', min, max, step: 0.01, 'aria-label': label, help });
      const val = el('b');
      inp.addEventListener('input', () => store.set({ [key]: +inp.value }));
      $(parentSel).append(el('div', { class: 'slider-row' }, el('span', { text: label }), inp, val));
      return (s) => { inp.value = s[key]; val.textContent = fmtV(s[key]); inp.style.setProperty('--fill', ((s[key] - min) / (max - min)) * 100 + '%'); };
    };
    const pct = (v) => Math.round(v * 100) + '%';
    const panF = (v) => (Math.abs(v) < 0.03 ? 'C' : (v < 0 ? 'L' : 'R') + Math.round(Math.abs(v) * 100));
    const levelRenders = [
      sliderRow('Master', 'masterVolume', 0, 1, pct, '#levels', 'Master::Overall loudness, including the tuning tones.'),
      sliderRow('Accent', 'accentVolume', 0.3, 1.3, pct, '#levels', 'Accent::How much louder strong and medium beats are than normal beats.'),
      sliderRow('Subdivision', 'subVolume', 0, 1, pct, '#levels', 'Subdivision::Loudness of the pulses between beats.'),
      sliderRow('Polyrhythm', 'polyVolume', 0, 1, pct, '#levels', 'Polyrhythm::Loudness of the second rhythm.'),
      sliderRow('Beat pan', 'panBeat', -1, 1, panF, '#space', 'Beat pan::Left–right position of beats, accents and the count-in.'),
      sliderRow('Subdivision pan', 'panSub', -1, 1, panF, '#space', 'Subdivision pan::Left–right position of the subdivision pulses. Panning layers apart makes them easy to tell apart on headphones.'),
      sliderRow('Polyrhythm pan', 'panPoly', -1, 1, panF, '#space', 'Polyrhythm pan::Left–right position of the polyrhythm voice.'),
      sliderRow('Room', 'room', 0, 0.5, (v) => (v === 0 ? 'off' : pct(v * 2)), '#space', 'Room::A subtle sense of space around the click. Off by default; keep it low at fast tempos.'),
    ];

    /* ================= practice panel ================= */
    function toggleTool(k, force) {
      const s = S();
      const on = force !== undefined ? force : !s[k].enabled;
      const patch = { [k]: Object.assign({}, s[k], { enabled: on }) };
      if (on && k === 'trainer') {
        patch.trainer.start = s.bpm;
        if (s.progressive.enabled) { patch.progressive = Object.assign({}, s.progressive, { enabled: false }); toast('Progressive practice switched off: one tempo program at a time'); }
        if (engine.running) engine.tempoTouched();
      }
      if (on && k === 'progressive') {
        if (s.trainer.enabled) { patch.trainer = Object.assign({}, s.trainer, { enabled: false }); toast('Tempo trainer switched off: one tempo program at a time'); }
        if (!s.progressive.stages.length) patch.progressive.stages = [{ bpm: s.bpm, seconds: 120 }];
        if (engine.running || engine.practiceElapsed() > 0) engine.restartProgram();
        patch.bpm = patch.progressive.stages[0].bpm;
      }
      store.set(patch);
      if (on && k === 'progressive' && engine.running) engine.tempoTouched();
    }
    $$('[data-toggle]').forEach((b) => b.addEventListener('click', () => toggleTool(b.dataset.toggle)));
    const steppers = [];
    $$('.stepper[data-stepper]').forEach((sp) => {
      const path = sp.dataset.stepper, min = +sp.dataset.min, max = +sp.dataset.max;
      const inp = el('input', { type: 'number', min, max, inputmode: 'numeric', 'aria-label': path });
      const commit = (v) => {
        const n = Math.round(Number(v));
        if (!Number.isFinite(n)) { inp.value = getPath(S(), path); return; }
        const val = R.clamp(n, min, max);
        const extra = path === 'trainer.start' && S().trainer.enabled && !engine.running ? { bpm: val } : null;
        setPath(path, val, extra);
      };
      inp.addEventListener('change', () => commit(inp.value));
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { commit(inp.value); inp.blur(); } });
      sp.append(el('button', { text: '−', 'aria-label': 'decrease', onclick: () => commit(getPath(S(), path) - 1) }), inp, el('button', { text: '+', 'aria-label': 'increase', onclick: () => commit(getPath(S(), path) + 1) }));
      steppers.push((s) => { if (document.activeElement !== inp) inp.value = getPath(s, path); });
    });
    $('#timerNotify').addEventListener('change', (e) => setPath('timer.notify', e.target.checked));
    const stagesEl = $('#stages');
    function renderStages() {
      const s = S(); stagesEl.innerHTML = '';
      const live = s.progressive.enabled && (engine.running || engine.practiceElapsed() > 0) ? stageIndexNow(s) : -1;
      s.progressive.stages.forEach((st, i) => {
        const bpm = el('input', { class: 'input narrow', type: 'number', min: 20, max: 300, value: st.bpm, 'aria-label': `Stage ${i + 1} tempo`, help: `Stage ${i + 1} tempo::BPM for this stage.` });
        const mins = el('input', { class: 'input narrow', type: 'number', min: 0.25, max: 120, step: 0.25, value: +(st.seconds / 60).toFixed(2), 'aria-label': `Stage ${i + 1} minutes`, help: `Stage ${i + 1} length::Minutes, in quarter-minute steps; 15 seconds at least.` });
        const upd = () => {
          const cur = S();
          const list = cur.progressive.stages.map((x) => Object.assign({}, x));
          if (!list[i]) return;
          list[i] = { bpm: R.clamp(Math.round(+bpm.value || list[i].bpm), 20, 300), seconds: Math.max(15, Math.round((+mins.value || list[i].seconds / 60) * 60)) };
          const extra = cur.progressive.enabled && i === stageIndexNow(cur) ? { bpm: list[i].bpm } : {};
          store.set(Object.assign({ progressive: Object.assign({}, cur.progressive, { stages: list }) }, extra));
        };
        bpm.addEventListener('change', upd); mins.addEventListener('change', upd);
        stagesEl.append(el('div', { class: 'stage' + (i === live ? ' live' : '') }, bpm, el('span', { text: 'BPM for' }), mins, el('span', { text: 'min' }),
          el('button', { class: 'btn small ghost', text: '×', 'aria-label': `Remove stage ${i + 1}`, onclick: () => { const cur = S(); setPath('progressive.stages', cur.progressive.stages.filter((_, j) => j !== i)); } })));
      });
      const total = s.progressive.stages.reduce((a, x) => a + x.seconds, 0);
      $('#progTotal').textContent = s.progressive.stages.length ? `total ${fmt(total)}` : 'add a stage to begin';
    }
    $('#addStage').addEventListener('click', () => { const st = S().progressive.stages; const last = st[st.length - 1] || { bpm: S().bpm - 5, seconds: 120 }; setPath('progressive.stages', [...st, { bpm: Math.min(300, last.bpm + 5), seconds: last.seconds }]); });
    const ratioPicks = $('#ratioPicks');
    for (const [a, b] of [[2, 3], [3, 2], [3, 4], [4, 3], [4, 5], [5, 4]]) ratioPicks.append(el('button', { class: 'sig', dataset: { a, b }, text: `${a}:${b}`,
      help: `${a} against ${b}::${a} beats against ${b} evenly spaced pulses per bar. Sets the meter to ${a}/4 and switches Polyrhythm on.`,
      onclick: () => store.set({ sig: { num: a, den: 4, compound: false }, accents: R.defaultAccents({ num: a, den: 4 }), poly: Object.assign({}, S().poly, { enabled: true, against: b }) }) }));

    /* ================= sessions ================= */
    $('#sessionName').addEventListener('input', (e) => store.set({ sessionName: e.target.value }));
    $('#sessionName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#savePreset').click(); });
    $('#savePreset').addEventListener('click', () => { const name = S().sessionName.trim() || `Preset ${store.presets.length + 1}`; store.savePreset(name); renderPresets(); toast(`Saved “${name}”`); });
    function renderPresets() {
      const list = $('#presetList'); list.innerHTML = '';
      if (!store.presets.length) { list.append(el('div', { class: 'empty', text: 'No presets yet. Set things up and save.' })); return; }
      for (const p of store.presets) {
        const d = p.data;
        const extras = [d.subdivision > 1 ? T.subName(d.subdivision) : null, d.trainer && d.trainer.enabled ? 'trainer' : null, d.silent && d.silent.enabled ? 'silent bars' : null, d.poly && d.poly.enabled ? 'polyrhythm' : null, d.progressive && d.progressive.enabled ? 'progressive' : null].filter(Boolean).join(', ').toLowerCase();
        list.append(el('div', { class: 'item' }, el('div', {}, el('div', { text: p.name }), el('div', { class: 'meta', text: `${d.bpm} BPM · ${d.sig.num}/${d.sig.den}${extras ? ' · ' + extras : ''}` })),
          el('div', { class: 'acts' },
            el('button', { class: 'btn small ghost', text: 'Load', help: 'Load::Apply this preset now.', onclick: () => { if (engine.running) stopAll(); store.loadPreset(p.id); toast(`Loaded “${p.name}”`); } }),
            el('button', { class: 'btn small ghost', text: 'Update', help: 'Update::Overwrite this preset with the current settings.', onclick: () => { store.updatePreset(p.id); renderPresets(); toast('Preset updated'); } }),
            el('button', { class: 'btn small ghost', text: 'Copy', help: 'Copy::Duplicate it to make a variation.', onclick: () => { store.duplicatePreset(p.id); renderPresets(); } }),
            el('button', { class: 'btn small ghost', text: 'Rename', onclick: () => { const n = prompt('Preset name', p.name); if (n && n.trim()) { store.renamePreset(p.id, n.trim()); renderPresets(); } } }),
            el('button', { class: 'btn small ghost danger', text: 'Delete', onclick: () => { if (confirm(`Delete “${p.name}”?`)) { store.deletePreset(p.id); renderPresets(); } } }))));
      }
    }
    function renderHistory() {
      const list = $('#historyList'), stats = $('#stats'); list.innerHTML = ''; stats.innerHTML = '';
      const st = store.stats();
      if (!st) { list.append(el('div', { class: 'empty', text: 'Nothing logged yet. Practice for a while and press Stop to record a run.' })); return; }
      const stat = (v, l, h) => stats.append(el('div', { class: 'stat', help: h }, el('b', { text: v }), el('span', { text: l })));
      stat(fmt(st.total), 'total practiced', 'Total::Sum of all logged runs.');
      stat(st.sessions, 'sessions', 'Sessions::Number of logged runs.');
      stat(fmt(st.avg), 'average session', 'Average::Total time divided by the number of runs.');
      stat(`${st.weekDays} / 7`, 'days this week', 'Days this week::Days with at least one run in the last seven days.');
      stat(fmt(st.longest), 'longest session', 'Longest::Your longest single run.');
      stat(st.avgBpm, 'average end tempo', 'Average end tempo::Mean of the tempos your runs finished at.');
      stat(st.streak, 'day streak', 'Streak::Consecutive days with practice, counting back from today.');
      stat(fmt(st.today), 'today', 'Today::Time logged today.');
      for (const h of store.history.slice(0, 40)) {
        const dt = new Date(h.date);
        const when = dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + dt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        const tempo = h.startBpm === h.endBpm ? `${h.endBpm} BPM` : `${h.startBpm} → ${h.endBpm} BPM`;
        list.append(el('div', { class: 'item' }, el('div', {}, el('div', { text: `${h.name ? h.name + ' · ' : ''}${fmt(h.duration)} · ${tempo} · ${h.sig}` }), el('div', { class: 'meta', text: `${when} · ${h.config}` }))));
      }
    }
    $('#clearHistory').addEventListener('click', () => { if (confirm('Clear the whole practice log?')) { store.clearHistory(); todayCache = null; renderHistory(); updateClocks(); } });

    /* ================= tools ================= */
    let refOn = false, genOn = false, genFreq = 440;
    const refSw = $('#refSw'), refFreq = $('#refFreq'), refFreqV = $('#refFreqV');
    const genSw = $('#genSw'), genSlider = $('#genSlider'), genV = $('#genV'), genInput = $('#genInput'), genNote = $('#genNote');
    function setTone(name, on) {
      if (name === 'ref') { refOn = on; refSw.classList.toggle('on', on); }
      else { genOn = on; genSw.classList.toggle('on', on); }
    }
    refSw.addEventListener('click', async () => {
      const on = !refOn; setTone('ref', on);
      const ok = await engine.tone('ref', on, S().refFreq, 0.14);
      if (on && !ok) { setTone('ref', false); toast('Audio could not start'); }
    });
    refFreq.addEventListener('input', () => store.set({ refFreq: +refFreq.value }));
    $$('[data-ref]').forEach((b) => b.addEventListener('click', () => store.set({ refFreq: +b.dataset.ref })));
    const genToSlider = (f) => Math.round((1000 * Math.log(f / 20)) / Math.log(250));
    const sliderToGen = (v) => 20 * Math.pow(250, v / 1000);
    const renderGen = () => {
      genV.textContent = Math.round(genFreq * 10) / 10 + ' Hz';
      genNote.textContent = noteName(genFreq, S().refFreq);
      if (document.activeElement !== genInput) genInput.value = Math.round(genFreq * 10) / 10;
      genSlider.value = genToSlider(genFreq); genSlider.style.setProperty('--fill', genSlider.value / 10 + '%');
      engine.setToneFrequency('gen', genFreq);
    };
    genSlider.addEventListener('input', () => { genFreq = sliderToGen(+genSlider.value); renderGen(); });
    genInput.addEventListener('change', () => { const v = +genInput.value; if (Number.isFinite(v) && v > 0) genFreq = R.clamp(v, 20, 5000); renderGen(); });
    genSw.addEventListener('click', async () => {
      const on = !genOn; setTone('gen', on);
      const ok = await engine.tone('gen', on, genFreq, 0.12);
      if (on && !ok) { setTone('gen', false); toast('Audio could not start'); }
    });
    renderGen();
    const table = $('#markingTable');
    for (const m of R.MARKINGS) table.append(el('tr', { dataset: { name: m.name } }, el('td', { text: m.name }), el('td', { text: m.max >= 300 ? `${m.min}+` : `${m.min}–${m.max}` })));
    const SHORTCUTS = [['Space', 'Play / pause'], ['↑ / ↓', 'Tempo ±1 (Shift ±5, Alt ±10)'], ['T', 'Tap tempo'], ['R', 'Stop and reset'], ['M', 'Mute / unmute'], ['H', 'Help hints on / off'], ['Esc', 'Close dialogs, leave a field']];
    $('#shortcuts2').append(el('h4', { class: 'sc-head', text: 'Metronome' }));
    for (const id of ['#shortcuts', '#shortcuts2']) for (const [k, d] of SHORTCUTS) if (!(id === '#shortcuts2' && k === 'H')) $(id).append(el('kbd', { text: k }), el('span', { text: d }));
    $('#resetAll').addEventListener('click', () => { if (confirm('Reset every setting to its default? Presets, saved patterns and the log are kept.')) { stopAll(); store.reset(); toast('Settings reset'); } });

    /* ================= keyboard ================= */
    document.addEventListener('keydown', (e) => {
      const t = e.target;
      if (MN.dialogs.isOpen()) return;
      if (e.key === 'Escape') { if (isTyping(t)) t.blur(); return; }
      if (isTyping(t) || e.metaKey || e.ctrlKey) return;
      if (document.body.dataset.view && document.body.dataset.view !== 'metronome' && e.key !== 'h' && e.key !== 'H') return;
      const s = S();
      switch (e.key) {
        case ' ': e.preventDefault(); if (!e.repeat) (engine.running ? pause() : start()); break;
        case 'ArrowUp': e.preventDefault(); setBpm(s.bpm + (e.shiftKey ? 5 : e.altKey ? 10 : 1)); break;
        case 'ArrowDown': e.preventDefault(); setBpm(s.bpm - (e.shiftKey ? 5 : e.altKey ? 10 : 1)); break;
        case 't': case 'T': if (!e.repeat) doTap(); break;
        case 'r': case 'R': if (!e.repeat) stopAll(); break;
        case 'm': case 'M': if (!e.repeat) store.set({ muted: !s.muted }); break;
        case 'h': case 'H': if (!e.repeat) $('#helpToggle').click(); break;
        default: return;
      }
    });
    /* Space on a focused button must not also "click" it */
    document.addEventListener('keyup', (e) => { if (e.key === ' ' && !MN.dialogs.isOpen() && !isTyping(e.target) && e.target.tagName === 'BUTTON') e.preventDefault(); });

    /* ================= render ================= */
    function render(s, patch) {
      const keys = patch ? Object.keys(patch) : null;
      const has = (...k) => !keys || k.some((x) => keys.includes(x));
      if (has('theme', 'palette', 'terms')) { MN.themes.apply(s.theme, s.palette); T.set(s.terms); renderPrefs(s); }
      if (has('terms', 'sig')) applyTerms(s);
      if (has('terms')) { renderRoles(s); renderPresets(); }
      if (has('help')) { $('#helpToggle').classList.toggle('on', s.help); $('#helpToggle').setAttribute('aria-pressed', String(s.help)); }
      if (has('mode')) { document.body.classList.toggle('simple', s.mode === 'simple'); $$('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === s.mode)); }
      if (has('panel')) { $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.panel === s.panel)); $$('.panel').forEach((p) => p.classList.toggle('on', p.dataset.panel === s.panel)); }
      if (has('bpm', 'maxBpm', 'sig')) {
        bpmNum.textContent = s.bpm; marking.textContent = R.marking(s.bpm);
        slider.max = s.maxBpm; slider.value = s.bpm; slider.style.setProperty('--fill', ((s.bpm - 20) / (s.maxBpm - 20)) * 100 + '%');
        if (document.activeElement !== bpmInput) bpmInput.value = s.bpm;
        beatUnit.textContent = R.beatUnitLabel(s.sig);
        $$('#markingTable tr').forEach((tr) => tr.classList.toggle('now', tr.dataset.name === R.marking(s.bpm)));
      }
      if (has('sig', 'accents')) {
        $$('#sigPicks .sig').forEach((b) => b.classList.toggle('on', +b.dataset.num === s.sig.num && +b.dataset.den === s.sig.den));
        if (document.activeElement !== sigNum) sigNum.value = s.sig.num;
        $('#sigDen').value = s.sig.den;
        $('#compoundSeg').classList.toggle('hidden', !R.isCompound(s.sig));
        $$('#compoundSeg button').forEach((b) => b.classList.toggle('on', (b.dataset.compound === 'true') === !!s.sig.compound));
        renderAccents(s); renderPatterns();
      }
      if (has('soundBeat', 'soundAccent', 'soundSub', 'soundPoly', 'subdivision', 'poly', 'accents', 'sig')) { quickSound.value = s.soundBeat; renderRoles(s); }
      if (has('countInBars')) $$('#countInSeg button').forEach((b) => b.classList.toggle('on', +b.dataset.v === s.countInBars));
      if (has('masterVolume', 'accentVolume', 'subVolume', 'polyVolume', 'panBeat', 'panSub', 'panPoly', 'room')) {
        $('#masterVol').value = s.masterVolume; $('#masterVol').style.setProperty('--fill', s.masterVolume * 100 + '%');
        $('#subVol').value = s.subVolume; $('#subVol').style.setProperty('--fill', s.subVolume * 100 + '%'); $('#subVolV').textContent = pct(s.subVolume);
        levelRenders.forEach((f) => f(s));
      }
      if (has('muted')) { $('#muteBtn').classList.toggle('muted', s.muted); $('#muteBtn').setAttribute('aria-pressed', String(s.muted)); }
      if (has('visual', 'pendulum')) {
        $$('#visualSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === s.visual));
        $('#pendulumSw').classList.toggle('on', s.pendulum);
        ringWrap.classList.toggle('visual-off', s.visual === 'off');
        ringWrap.classList.toggle('hidden-sub', s.visual === 'minimal');
        if (s.visual === 'off') resetVisual();
      }
      if (has('subdivision', 'subPattern', 'feel')) {
        $$('#subPicker .sub-btn').forEach((b) => b.classList.toggle('on', +b.dataset.n === s.subdivision));
        $$('#feelSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === s.feel));
        renderSubPattern(s);
      }
      if (has('silent', 'trainer', 'progressive', 'poly', 'timer', 'sig')) {
        for (const k of ['silent', 'trainer', 'progressive', 'poly', 'timer']) {
          const sw = $(`[data-toggle="${k}"]`);
          sw.classList.toggle('on', s[k].enabled); sw.setAttribute('aria-pressed', String(s[k].enabled));
          sw.closest('.feature').classList.toggle('enabled', s[k].enabled);
        }
        steppers.forEach((f) => f(s));
        $('#timerNotify').checked = s.timer.notify;
        $('#trainerDir').textContent = s.trainer.target === s.trainer.start ? '(start equals target)' : s.trainer.target > s.trainer.start ? '(speeding up)' : '(slowing down)';
        $$('#ratioPicks .sig').forEach((b) => b.classList.toggle('on', s.poly.enabled && +b.dataset.a === R.beatsPerBar(s.sig) && +b.dataset.b === s.poly.against));
        renderStages();
      }
      if (has('bpm', 'muted', 'silent', 'trainer', 'progressive', 'poly', 'timer', 'sig')) renderStatus();
      if (has('refFreq')) { refFreq.value = s.refFreq; refFreqV.textContent = s.refFreq + ' Hz'; refFreq.style.setProperty('--fill', ((s.refFreq - 430) / 20) * 100 + '%'); engine.setToneFrequency('ref', s.refFreq); renderGen(); }
      if (has('sessionName') && document.activeElement !== $('#sessionName')) $('#sessionName').value = s.sessionName;
      buildRing(s);
    }
    store.subscribe((s, patch) => { render(s, patch); engine.applySettings(s); });
    render(S(), null);
    renderPresets(); renderHistory(); renderPatterns(); updateClocks(); syncTransport();
  }

  MN.ui = { init };
})(window);
