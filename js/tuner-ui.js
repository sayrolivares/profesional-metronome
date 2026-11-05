/* tuner-ui.js — the tuner's page: draws what js/tuner-model.js decides and sends the
   musician's choices to the store and the engine. It never measures pitch itself.

   Safe DOM: every piece of text, including the names of custom tunings, is set with
   textContent or created as a text node; nothing user-supplied goes through innerHTML. */
(function (root) {
  const MN = (root.MN = root.MN || {});
  const N = MN.notes, T = MN.tunings;
  const $ = (s, c = document) => c.querySelector(s);
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
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids) if (c != null) e.append(c);
    return e;
  };
  const isTyping = (t) => !!t && (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes(t.type)));
  const reducedMotion = () => root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* gauge geometry: pivot below the scale, 1 degree per cent, ±50 ¢ on the scale */
  const CX = 200, CY = 250, R = 180, SPAN = 50, PEG = 55;
  const polar = (deg, r) => { const a = (deg * Math.PI) / 180; return [CX + r * Math.sin(a), CY - r * Math.cos(a)]; };
  const arcPath = (a0, a1, r) => { const [x0, y0] = polar(a0, r), [x1, y1] = polar(a1, r); return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`; };
  const bandPath = (a0, a1, r0, r1) => { const [ax, ay] = polar(a0, r1), [bx, by] = polar(a1, r1), [cx, cy] = polar(a1, r0), [dx, dy] = polar(a0, r0); return `M${ax} ${ay}A${r1} ${r1} 0 0 1 ${bx} ${by}L${cx} ${cy}A${r0} ${r0} 0 0 0 ${dx} ${dy}Z`; };

  function init(opts = {}) {
    const appStore = opts.appStore;                       // metronome store: help hints, Simple/Advanced
    const toast = opts.toast || (() => {});
    const custom = new T.CustomTunings();
    const findTuning = (id) => T.preset(id) || custom.get(id);
    const store = new MN.TunerStore(undefined, (id) => !!findTuning(id));
    const engine = new MN.TunerEngine();
    const model = new MN.TunerModel();
    const tone = new MN.tunerAudio.ReferenceTone();
    const S = () => store.get();
    let tuning = findTuning(S().tuningId) || T.preset(T.DEFAULT_TUNING);
    let view = { m: null, lastFreq: null, quietSince: null, stopReason: null, announced: '', announceAt: 0, wakeLock: null, permission: 'unknown', devices: [] };

    /* ================= gauge ================= */
    const gaugeWrap = $('#gaugeWrap'), gauge = $('#gauge');
    let band, needle;
    (function buildGauge() {
      gauge.append(svg('path', { class: 'g-arc', d: arcPath(-SPAN, SPAN, R) }));
      band = svg('path', { class: 'g-band' });
      gauge.append(band);
      for (let c = -SPAN; c <= SPAN; c += 5) {
        const major = c === 0 || Math.abs(c) === SPAN, mid = c % 10 === 0 || Math.abs(c) === 25;
        const [x0, y0] = polar(c, R + (major ? 3 : 0)), [x1, y1] = polar(c, R - (major ? 16 : mid ? 11 : 6));
        gauge.append(svg('line', { class: 'g-tick' + (major ? ' major' : mid ? ' mid' : ''), x1: x0, y1: y0, x2: x1, y2: y1 }));
      }
      for (const c of [-50, -25, -10, 0, 10, 25, 50]) {
        const [x, y] = polar(c, R + 15);
        const t = svg('text', { class: 'g-label', x, y });
        t.textContent = String(Math.abs(c));
        gauge.append(t);
      }
      const [fx, fy] = polar(-SPAN - 9, R + 4), [sx, sy] = polar(SPAN + 9, R + 4);
      const flat = svg('text', { class: 'g-sign flat', x: fx, y: fy }); flat.textContent = '♭';
      const sharp = svg('text', { class: 'g-sign sharp', x: sx, y: sy }); sharp.textContent = '♯';
      gauge.append(flat, sharp);
      const [mx, my] = polar(0, R + 26);
      gauge.append(svg('path', { class: 'g-mark', d: `M${mx - 5} ${my - 4}L${mx + 5} ${my - 4}L${mx} ${my + 3}Z` }));
      /* chevrons shown when the note is beyond the scale */
      const peg = (deg, cls, dir) => { const [x, y] = polar(deg, R - 34); const g = svg('path', { class: 'g-peg ' + cls, d: dir < 0 ? `M${x + 3} ${y - 5}L${x - 3} ${y}L${x + 3} ${y + 5}` : `M${x - 3} ${y - 5}L${x + 3} ${y}L${x - 3} ${y + 5}`, transform: `rotate(${deg} ${x} ${y})` }); gauge.append(g); };
      peg(-SPAN + 3, 'low', -1); peg(SPAN - 3, 'high', 1);
      needle = svg('g', { class: 'g-needle' });
      const [nx0, ny0] = polar(0, 146), [nx1, ny1] = polar(0, R + 8);
      needle.append(svg('line', { x1: nx0, y1: ny0, x2: nx1, y2: ny1 }), svg('circle', { cx: nx0, cy: ny0, r: 3.4 }));
      gauge.append(needle);
    })();
    function drawBand() { const tol = Math.max(0.8, S().tolerance); band.setAttribute('d', bandPath(-tol, tol, R - 3.5, R + 3.5)); }

    /* needle motion: eased toward the target on animation frames, only while it moves */
    let angle = 0, targetAngle = 0, raf = 0, lastT = 0;
    function setNeedle(a) { targetAngle = Math.max(-PEG, Math.min(PEG, a)); if (!raf) { lastT = performance.now(); raf = requestAnimationFrame(stepNeedle); } }
    function stepNeedle(t) {
      const dt = Math.min(0.1, (t - lastT) / 1000); lastT = t;
      const tau = reducedMotion() ? 0 : 0.085;
      angle = tau ? angle + (targetAngle - angle) * (1 - Math.exp(-dt / tau)) : targetAngle;
      if (Math.abs(targetAngle - angle) < 0.02) angle = targetAngle;
      needle.setAttribute('transform', `rotate(${angle.toFixed(2)} ${CX} ${CY})`);
      raf = angle === targetAngle ? 0 : requestAnimationFrame(stepNeedle);
    }

    /* ================= readout ================= */
    const noteEl = $('#noteName'), hzNow = $('#hzNow'), centsNow = $('#centsNow'), targetLine = $('#targetLine');
    const statusEl = $('#tuneStatus'), statusText = $('#tuneStatusText'), announce = $('#tuneAnnounce');
    const micBtn = $('#micBtn'), level = $('#level'), levelFill = $('#levelFill'), levelGate = $('#levelGate');
    const listenNote = $('#listenNote'), resumeBtn = $('#resumeBtn');
    const alertBox = $('#tunerAlert'), alertText = $('#tunerAlertText'), alertHint = $('#tunerAlertHint');
    const stringsEl = $('#strings'), measure = $('#measure'), sigQ = $('#sigQuality'), micProc = $('#micProc');
    const dbToPct = (db) => Math.max(0, Math.min(100, ((db + 80) / 80) * 100));   // −80…0 dBFS

    function setNote(n) {
      const [l, a, o] = noteEl.children;
      l.textContent = n ? n.letter : ''; a.textContent = n ? n.accidental : ''; o.textContent = n ? String(n.octave) : '';
      noteEl.setAttribute('aria-label', n ? `Note ${n.letter}${n.accidental === '♯' ? ' sharp' : n.accidental === '♭' ? ' flat' : ''} ${n.octave}` : 'No note');
    }
    function semis(c) { const s = Math.round(Math.abs(c) / 100); return s >= 1 ? `, about ${s} semitone${s > 1 ? 's' : ''}` : ''; }
    function targetName(m) {
      if (!m.target) return '';
      if (m.target.kind === 'freq') return m.target.label;
      return m.target.label;
    }

    function render(m) {
      view.m = m;
      const s = S();
      /* gauge state */
      let state = 'idle';
      if (m.listening) state = m.hasPitch ? (m.faded ? 'hold' : m.inTune ? 'ok' : 'off') : 'wait';
      gaugeWrap.dataset.state = state;
      gaugeWrap.dataset.dir = m.hasPitch && !m.faded && m.direction !== 'settle' ? m.direction : '';
      gaugeWrap.dataset.peg = m.hasPitch && Math.abs(m.cents) > SPAN ? (m.cents < 0 ? 'low' : 'high') : '';
      setNeedle(m.hasPitch ? m.cents : 0);

      setNote(m.note);
      hzNow.textContent = m.hasPitch ? N.hz(m.freq) : '';
      hzNow.parentNode.classList.toggle('empty', !m.hasPitch);
      centsNow.textContent = m.hasPitch ? N.signed(m.cents) + ' ¢' : '';
      /* target line: the frequency being tuned to and the difference from it */
      targetLine.textContent = '';
      if (m.target && (m.target.kind !== 'note' || m.hasPitch)) {
        const parts = [m.target.kind === 'freq' ? 'Target ' : 'Target ', el('b', { text: m.target.kind === 'freq' ? m.target.label : `${targetName(m)}` })];
        if (m.target.kind !== 'freq') parts.push(` at ${N.hz(m.target.freq)} Hz`);
        if (m.hasPitch) parts.push(Math.abs(m.deltaHz) < 0.005 ? ', on pitch' : `, ${N.hz(Math.abs(m.deltaHz))} Hz ${m.deltaHz < 0 ? 'low' : 'high'}`);
        targetLine.append(...parts);
      } else if (!m.listening) targetLine.textContent = `A4 = ${N.hz(s.a4, s.a4 % 1 ? 1 : 0)} Hz`;

      /* status line */
      let text = '', dir = '';
      if (!m.listening) text = view.stopReason === 'idle' ? 'Stopped to save battery' : 'Ready when you are';
      else if (m.hasPitch) {
        if (m.faded) text = 'Pluck again';                       // the note has decayed: last reading kept, dimmed
        else if (m.direction === 'settle') text = 'Settling…';   // within tolerance, the attack not yet over
        else { dir = m.direction; text = m.direction === 'ok' ? 'In tune' : (m.direction === 'up' ? 'Tune up' : 'Tune down') + semis(m.cents); }
      } else if (m.status === 'noisy') text = 'Too noisy to read';
      else if (m.status === 'searching') text = 'Listening…';
      else text = m.target && m.target.kind === 'string' && s.stringMode === 'manual' ? `Play the ${m.target.label} string` : tuning.strings.length && s.targetMode !== 'freq' ? 'Play any string' : 'Play a note';
      statusText.textContent = text;
      statusEl.dataset.dir = dir;
      speak(m, text);

      /* level meter and its threshold mark */
      level.classList.toggle('on', m.listening);
      levelFill.style.width = (m.listening ? dbToPct(m.db) : 0) + '%';
      if (m.gateDb != null) levelGate.style.left = dbToPct(m.gateDb) + '%';
      level.classList.toggle('heard', m.listening && m.gateDb != null && m.db >= m.gateDb);
      micBtn.style.setProperty('--lv', m.listening ? Math.max(0, Math.min(1, (m.db + 50) / 40)).toFixed(2) : 0);
      /* signal quality: the confidence of the reading on screen */
      const q = !m.listening ? 'none' : m.hasPitch ? (m.faded ? 'weak' : m.quality || 'none') : m.status === 'searching' || m.status === 'noisy' ? 'weak' : 'none';
      if (sigQ.dataset.q !== q) { sigQ.dataset.q = q; sigQ.setAttribute('aria-label', `Signal quality: ${q === 'none' ? 'no note' : q}`); }

      if (m.listening) {
        if (m.hasPitch || m.status !== 'quiet') view.quietSince = null;
        else if (view.quietSince === null) view.quietSince = performance.now();
        const longQuiet = view.quietSince !== null && performance.now() - view.quietSince > 8000;
        listenNote.textContent = m.status === 'noisy' ? 'There’s too much sound at once to find one clear note. Play a single string, closer to the microphone, or lower the sensitivity in Advanced.'
          : longQuiet ? 'Nothing heard yet. Play a little louder or closer to the microphone, or raise the sensitivity in Advanced.'
          : engine.input.deviceLabel ? `Listening on ${engine.input.deviceLabel}.` : 'Listening.';
      }
      renderStrings(m);
      if (!document.body.classList.contains('simple') && S().detailed) renderMeasure(m);
      if (m.justTuned !== null) { const st = tuning.strings[m.justTuned]; if (st) toast(`${st.label} is in tune`); }
      if (m.hasPitch) {
        /* a help hint left open by tapping Start would cover the strings: clear it once a note sounds */
        if (!view.lastFreq && MN.helpTip) MN.helpTip.hide();
        view.lastFreq = m.freq;
      }
    }

    /* screen readers hear the note and direction when they change, at most every 1.5 s */
    function speak(m, text) {
      const key = m.hasPitch && !m.faded ? `${m.note ? m.note.text : ''} ${m.direction}` : text;
      const now = performance.now();
      if (key === view.announced || now - view.announceAt < 1500) return;
      view.announced = key; view.announceAt = now;
      announce.textContent = m.hasPitch && !m.faded ? `${m.note ? m.note.text.replace('♯', ' sharp').replace('♭', ' flat') : ''}, ${text}` : text;
    }

    /* ================= strings ================= */
    function buildStrings() {
      stringsEl.textContent = '';
      tuning.strings.forEach((st, i) => {
        const name = N.name(st.midi, tuning.flats);
        const b = el('button', { class: 'string', type: 'button', 'data-i': i,
          help: `${st.label} string::${N.hz(T.stringFreq(tuning, i, S().a4, S().temperament))} Hz at A4 = ${N.hz(S().a4, 1)} Hz. Tap to tune this string (Manual). Keys: ← →`,
          onclick: () => store.set({ stringMode: 'manual', stringIndex: i }) },
        el('span', { class: 'sl' }, name.letter + name.accidental, el('small', { text: String(name.octave) })));
        stringsEl.append(b);
      });
      stringsEl.classList.toggle('freq-mode', S().targetMode === 'freq');
      renderStrings(view.m);
    }
    function renderStrings(m) {
      const s = S();
      const active = s.targetMode === 'freq' ? -1 : m && m.stringIndex >= 0 ? m.stringIndex : s.stringMode === 'manual' ? s.stringIndex : -1;
      Array.from(stringsEl.children).forEach((b, i) => {
        const tuned = !!(m && m.tuned && m.tuned[i]);
        b.classList.toggle('active', i === active);
        b.classList.toggle('tuned', tuned);
        b.setAttribute('aria-pressed', String(s.stringMode === 'manual' && i === s.stringIndex));
        const st = tuning.strings[i];
        b.setAttribute('aria-label', `${st.label.replace('♯', ' sharp').replace('♭', ' flat')} string${tuned ? ', in tune' : ''}`);
      });
    }

    /* ================= measurements (Advanced) ================= */
    const MEASURE = [['measured', 'Measured'], ['target', 'Target'], ['diff', 'Difference'], ['cents', 'Cents'], ['nearest', 'Nearest note'], ['ref', 'Reference'], ['conf', 'Confidence'], ['level', 'Level']];
    const mCells = {};
    for (const [k, label] of MEASURE) { const dd = el('dd', { text: '–' }); mCells[k] = dd; measure.append(el('div', {}, el('dt', { text: label }), dd)); }
    function renderMeasure(m) {
      const s = S(), p = m && m.hasPitch;
      mCells.measured.textContent = p ? N.hz(m.freq, 3) + ' Hz' : '–';
      mCells.target.textContent = m && m.target && (p || m.target.kind !== 'note') ? N.hz(m.target.freq, 3) + ' Hz' : '–';
      mCells.diff.textContent = p ? N.signed(m.deltaHz, 3).replace('−', '−') + ' Hz' : '–';
      mCells.cents.textContent = p ? N.signed(m.cents, 1) + ' ¢' : '–';
      mCells.nearest.textContent = p ? `${m.note.text} ${N.signed(m.nearestCents, 1)} ¢` : '–';
      mCells.ref.textContent = `A4 ${N.hz(s.a4, 1)} Hz`;
      mCells.conf.textContent = m && m.listening && m.hasPitch ? (m.faded ? 'faded' : `${Math.round((m.confidence || 0) * 100)}% (${m.quality})`) : '–';
      mCells.level.textContent = m && m.listening && m.db > -119 ? Math.round(m.db) + ' dB' : '–';
    }

    /* ================= listening ================= */
    function idleModel() { return model.update(null, S(), tuning, performance.now(), false); }
    function setListeningUI(state) {
      const on = state === 'listening' || state === 'suspended' || state === 'starting';
      micBtn.classList.toggle('on', on);
      micBtn.classList.toggle('busy', state === 'starting');
      micBtn.setAttribute('aria-pressed', String(on));
      micBtn.setAttribute('aria-label', on ? 'Stop listening' : 'Start listening');
      resumeBtn.classList.toggle('hidden', state !== 'suspended');
      if (state === 'starting') listenNote.textContent = view.permission === 'granted' ? 'Starting the microphone…' : 'Allow the microphone when your browser asks.';
      if (state === 'suspended') listenNote.textContent = 'Your browser paused the audio. Tap Continue to start listening.';
      if (state === 'idle') {
        listenNote.textContent = view.stopReason === 'idle' ? 'Stopped after five minutes without a note, to save battery. Press start to listen again.'
          : view.stopReason ? 'Stopped. Press start to listen again.'
          : 'Press start and allow the microphone. Sound is analysed on this device and never recorded.';
        render(idleModel());
      }
      if (state !== 'error') alertBox.hidden = true;
      keepAwake(state === 'listening');
    }
    /* where to find the microphone setting, for the browser in use */
    const ua = navigator.userAgent || '';
    const iOS = /iP(hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const browserHint = iOS ? 'On iPhone and iPad: tap aA in the address bar › Website Settings › Microphone › Allow. If it is still blocked, check Settings › Safari › Microphone.'
      : /Firefox\//.test(ua) ? 'In Firefox: click the microphone icon in the address bar and remove the block, then press Start again.'
      : /Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua) ? 'In Safari: Safari › Settings › Websites › Microphone, then choose Allow for this site.'
      : /Android/.test(ua) ? 'In Chrome on Android: tap the icon left of the address › Permissions › Microphone › Allow.'
      : 'In Chrome or Edge: click the icon left of the address › Site settings › Microphone › Allow, then reload the page.';
    const HINTS = {
      denied: browserHint,
      insecure: 'Browsers only allow the microphone on https pages (or on localhost while developing).',
      busy: 'On a phone, a call or a recording app may be holding the microphone.',
      unavailable: 'On a computer, check the input device in your system’s sound settings.',
    };
    function showError(err) {
      alertText.textContent = err ? err.message : 'The microphone could not be started.';
      alertHint.textContent = (err && HINTS[err.code]) || '';
      alertBox.hidden = false;
      listenNote.textContent = '';
      render(idleModel());
    }
    engine.on((type, d) => {
      if (type === 'reading') { render(model.update(d, S(), tuning, performance.now(), true)); drawScope(d); return; }
      if (type === 'state') {
        if (d.state === 'idle') view.stopReason = d.reason === 'user' || d.reason === 'view' ? (view.stopReason === 'idle' ? null : 'user') : d.reason === 'hidden' ? null : d.reason;
        if (d.state === 'listening' || d.state === 'starting') view.stopReason = null;
        setListeningUI(d.state);
        if (d.state === 'error') showError(d.error);
        if (d.state === 'listening') { refreshPermission(); refreshDevices(); render(model.update(null, S(), tuning, performance.now(), true)); }
        renderMicStatus();
      }
    });
    async function toggleListening() {
      if (engine.listening) { await engine.stop('user'); return; }
      alertBox.hidden = true;
      view.lastFreq = null;
      model.resetStrings(tuning.strings.length);
      applyEngineSettings();
      await engine.start(S().deviceId);
    }
    micBtn.addEventListener('click', toggleListening);
    resumeBtn.addEventListener('click', () => engine.resume());
    $('#tunerRetry').addEventListener('click', toggleListening);

    /* keep the screen on while listening (phone on a music stand) */
    async function keepAwake(on) {
      try {
        if (on && !view.wakeLock && navigator.wakeLock && document.visibilityState === 'visible') {
          view.wakeLock = await navigator.wakeLock.request('screen');
          view.wakeLock.addEventListener('release', () => { view.wakeLock = null; });
        } else if (!on && view.wakeLock) { const w = view.wakeLock; view.wakeLock = null; await w.release(); }
      } catch (e) { view.wakeLock = null; }
    }

    /* ================= microphone status & devices ================= */
    const micStatus = $('#micStatus'), micSelect = $('#micSelect');
    async function refreshPermission() {
      view.permission = await MN.tunerAudio.AudioInput.permission((st) => { view.permission = st; renderMicStatus(); if (st === 'granted') refreshDevices(); });
      renderMicStatus();
    }
    function renderMicStatus() {
      const st = engine.state;
      let text = 'Asks when you press start', bad = false;
      if (st === 'listening') text = engine.input.deviceLabel ? `Listening: ${engine.input.deviceLabel}` : 'Listening';
      else if (st === 'error' && engine.error && engine.error.code !== 'denied') { text = 'Not available right now'; bad = true; }
      else if (view.permission === 'granted') text = 'Allowed for this site';
      else if (view.permission === 'denied' || (st === 'error' && engine.error && engine.error.code === 'denied')) { text = 'Blocked in this browser’s site settings'; bad = true; }
      micStatus.textContent = text;
      micStatus.classList.toggle('bad', bad);
      renderProcessing();
    }
    /* what the browser did with the request to switch voice processing off */
    const PROC_NAMES = { echoCancellation: 'echo cancellation', noiseSuppression: 'noise suppression', autoGainControl: 'automatic gain' };
    function renderProcessing() {
      const p = engine.state === 'listening' || engine.state === 'suspended' ? engine.processing : null;
      micProc.hidden = !p;
      if (!p) return;
      const list = (keys) => { const n = keys.map((k) => PROC_NAMES[k]); return n.length > 1 ? n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1] : n[0]; };
      const unknown = Object.keys(PROC_NAMES).filter((k) => p[k] === null);
      let text;
      if (p.on.length) {
        text = `This browser kept ${list(p.on)} on. The tuner still works`
          + (p.on.includes('noiseSuppression') ? '; a long note may fade sooner, so pluck again if the reading drops' : '')
          + (p.on.includes('autoGainControl') ? '; the end of a note is judged by how clear it is rather than how loud' : '') + '.';
      } else if (unknown.length === 3) text = 'Raw sound requested (echo cancellation, noise suppression and automatic gain off); this browser doesn’t report whether it complied.';
      else text = 'Raw sound: ' + list(Object.keys(PROC_NAMES).filter((k) => p[k] === false)) + ' off' + (unknown.length ? ` (${list(unknown)} not reported)` : '') + '.';
      micProc.textContent = text;
      micProc.classList.toggle('warn', p.on.length > 0);
    }
    async function refreshDevices() {
      const list = await engine.input.devices();
      view.devices = list;
      micSelect.textContent = '';
      micSelect.append(el('option', { value: '', text: 'System default' }));
      for (const d of list) if (d.id !== 'default') micSelect.append(el('option', { value: d.id, text: d.label }));
      micSelect.value = list.some((d) => d.id === S().deviceId) ? S().deviceId : '';
      micSelect.classList.toggle('hidden', list.filter((d) => d.id !== 'default').length < 2);
    }
    micSelect.addEventListener('change', () => { store.set({ deviceId: micSelect.value }); if (engine.listening) engine.start(micSelect.value); });
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener('devicechange', refreshDevices);

    /* ================= settings controls ================= */
    const segs = [['#stringModeSeg', 'stringMode'], ['#accSeg', 'accidentals'], ['#sensSeg', 'sensitivity'], ['#waveSeg', 'toneWave']];
    for (const [sel, key] of segs) $(sel).addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (b) store.set({ [key]: b.dataset.v }); });
    const tolSeg = $('#tolSeg');
    for (const v of MN.tunerSettings.TOLERANCES) tolSeg.append(el('button', { 'data-v': v, text: `±${v}`, 'aria-label': `${v} cent${v > 1 ? 's' : ''}` }));
    tolSeg.addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (b) store.set({ tolerance: +b.dataset.v }); });

    /* reference pitch: stepper, typed value and common choices */
    const a4Input = $('#a4Input'), a4Picks = $('#a4Picks');
    const A4_PICKS = [[415, 'Baroque'], [432, ''], [440, 'Standard'], [442, 'Orchestra'], [443, '']];
    for (const [v, why] of A4_PICKS) a4Picks.append(el('button', { class: 'chip', 'data-v': v, text: String(v), help: `A4 = ${v} Hz::${why ? why + ' pitch.' : 'Set the reference to ' + v + ' Hz.'}`, onclick: () => store.set({ a4: v }) }));
    const setA4 = (v) => { if (N.validRef(v)) store.set({ a4: Math.round(v * 10) / 10 }); else { toast(`Reference pitch must be between ${N.REF.min} and ${N.REF.max} Hz`); a4Input.value = S().a4; } };
    $('#a4Minus').addEventListener('click', () => setA4(Math.round((S().a4 - 0.1) * 10) / 10));
    $('#a4Plus').addEventListener('click', () => setA4(Math.round((S().a4 + 0.1) * 10) / 10));
    a4Input.addEventListener('change', () => setA4(parseFloat(a4Input.value)));
    a4Input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { setA4(parseFloat(a4Input.value)); a4Input.blur(); } });

    const detailSw = $('#detailSw');
    detailSw.addEventListener('click', () => store.set({ detailed: !S().detailed }));

    /* tune to a frequency */
    const freqSw = $('#freqSw'), freqInput = $('#freqInput'), freqNote = $('#freqNote');
    freqSw.addEventListener('click', () => store.set({ targetMode: S().targetMode === 'freq' ? 'note' : 'freq' }));
    const setFreq = (v, enable) => {
      if (N.validFreq(v)) store.set(Object.assign({ customHz: Math.round(v * 1000) / 1000 }, enable ? { targetMode: 'freq' } : {}));
      else { toast(`Choose a frequency between ${N.RANGE.min} and ${N.RANGE.max} Hz`); freqInput.value = S().customHz; }
    };
    $('#freqMinus').addEventListener('click', () => setFreq(Math.round((S().customHz - 0.1) * 100) / 100));
    $('#freqPlus').addEventListener('click', () => setFreq(Math.round((S().customHz + 0.1) * 100) / 100));
    freqInput.addEventListener('change', () => setFreq(parseFloat(freqInput.value), true));
    freqInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { setFreq(parseFloat(freqInput.value), true); freqInput.blur(); } });
    $('#freqFromNote').addEventListener('click', () => { if (view.lastFreq) { setFreq(view.lastFreq, true); toast(`Target set to ${N.hz(view.lastFreq)} Hz`); } else toast('Play a note first'); });

    /* reference tone */
    const toneSw = $('#toneSw'), toneNote = $('#toneNote'), toneOct = $('#toneOct'), toneHz = $('#toneHz'), toneVol = $('#toneVol'), toneVolV = $('#toneVolV');
    function fillToneNotes() {
      const names = S().accidentals === 'flat' ? N.FLATS : N.SHARPS, cur = toneNote.value;
      toneNote.textContent = '';
      names.forEach((n, pc) => toneNote.append(el('option', { value: pc, text: n })));
      if (cur) toneNote.value = cur;
    }
    for (let o = 0; o <= 8; o++) toneOct.append(el('option', { value: o, text: String(o) }));
    const toneMidi = () => (parseInt(toneOct.value, 10) + 1) * 12 + parseInt(toneNote.value, 10);
    const setToneHz = (v) => { if (v >= 20 && v <= 5000) store.set({ toneHz: Math.round(v * 1000) / 1000 }); else { toast('Choose a frequency between 20 and 5000 Hz'); toneHz.value = S().toneHz; } };
    toneNote.addEventListener('change', () => setToneHz(N.midiToFreq(toneMidi(), S().a4, S().temperament)));
    toneOct.addEventListener('change', () => setToneHz(N.midiToFreq(toneMidi(), S().a4, S().temperament)));
    toneHz.addEventListener('change', () => setToneHz(parseFloat(toneHz.value)));
    toneHz.addEventListener('keydown', (e) => { if (e.key === 'Enter') { setToneHz(parseFloat(toneHz.value)); toneHz.blur(); } });
    toneVol.addEventListener('input', () => store.set({ toneVolume: parseFloat(toneVol.value) }));
    toneSw.addEventListener('click', async () => {
      if (tone.playing) { tone.stop(); toneSw.classList.remove('on'); return; }
      try { await tone.play(S().toneHz, S().toneWave, S().toneVolume); toneSw.classList.add('on'); }
      catch (e) { toast(e.message || 'The tone could not start'); }
    });
    $('#toneFromTarget').addEventListener('click', () => {
      const m = view.m, s = S();
      let f = null;
      if (s.targetMode === 'freq') f = s.customHz;
      else if (m && m.target && m.target.freq) f = m.target.freq;
      else if (s.stringMode === 'manual' && tuning.strings.length) f = T.stringFreq(tuning, s.stringIndex, s.a4, s.temperament);
      else if (tuning.strings.length) f = T.stringFreq(tuning, 0, s.a4, s.temperament);
      if (f) setToneHz(f); else toast('Pick a string or play a note first');
    });
    function renderTone(s) {
      const near = N.nearest(s.toneHz, s.a4, s.temperament);
      if (near) { toneNote.value = String(N.pcOf(near.midi)); toneOct.value = String(Math.max(0, Math.min(8, Math.floor(near.midi / 12) - 1))); }
      if (document.activeElement !== toneHz) toneHz.value = N.fixed(s.toneHz, 2);
      toneVol.value = s.toneVolume; toneVol.style.setProperty('--fill', s.toneVolume * 100 + '%');
      toneVolV.textContent = Math.round(s.toneVolume * 100) + '%';
      tone.set({ freq: s.toneHz, wave: s.toneWave, volume: s.toneVolume });
    }

    /* ================= signal view (Advanced) ================= */
    const scope = $('#scope'), sigStats = $('#sigStats');
    let scopeCtx = null, colors = null;
    const readColors = () => { const cs = getComputedStyle(document.documentElement); colors = { line: cs.getPropertyValue('--accent').trim(), grid: cs.getPropertyValue('--line').trim(), ok: cs.getPropertyValue('--ok').trim() }; };
    function scopeVisible() { return !document.body.classList.contains('simple') && document.body.dataset.view === 'tuner' && scope.offsetParent !== null; }
    function drawScope(reading) {
      if (!scopeVisible()) return;
      const buf = engine.lastBuffer, sr = engine.sampleRate;
      if (!scopeCtx) { scopeCtx = scope.getContext('2d'); readColors(); }
      const w = scope.clientWidth, h = scope.clientHeight, dpr = Math.min(2, root.devicePixelRatio || 1);
      if (scope.width !== Math.round(w * dpr) || scope.height !== Math.round(h * dpr)) { scope.width = Math.round(w * dpr); scope.height = Math.round(h * dpr); }
      const c = scopeCtx;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, w, h);
      c.strokeStyle = colors.grid; c.lineWidth = 1;
      c.beginPath(); c.moveTo(0, h / 2); c.lineTo(w, h / 2); c.stroke();
      if (buf && buf.length) {
        /* show about three cycles, starting at a rising zero crossing so the shape stands still */
        const period = reading && reading.raw ? sr / reading.raw : reading && reading.freq ? sr / reading.freq : 0;
        const span = Math.min(buf.length - 1, Math.max(256, Math.round(period ? period * 3 : 1024)));
        let start = Math.max(0, buf.length - span - Math.round(period || 512) - 2);
        for (let i = start; i < buf.length - span - 1; i++) if (buf[i] <= 0 && buf[i + 1] > 0) { start = i; break; }
        let peak = 1e-4; for (let i = start; i < start + span; i++) peak = Math.max(peak, Math.abs(buf[i]));
        const gain = (h * 0.42) / Math.max(peak, 0.02);
        c.strokeStyle = reading && reading.status === 'pitch' && view.m && view.m.inTune ? colors.ok : colors.line;
        c.lineWidth = 1.6; c.lineJoin = 'round'; c.beginPath();
        for (let x = 0; x <= w; x++) { const i = start + Math.floor((x / w) * span); const y = h / 2 - buf[i] * gain; x ? c.lineTo(x, y) : c.moveTo(x, y); }
        c.stroke();
      }
      const stat = (label, value) => el('div', {}, label, el('b', { text: value }));
      sigStats.textContent = '';
      sigStats.append(
        stat('Level', reading && reading.db > -119 ? `${Math.round(reading.db)} dBFS` : '–'),
        stat('Clarity', reading && reading.clarity ? `${Math.round(reading.clarity * 100)}%` : '–'),
        stat('Confidence', reading && reading.confidence ? `${Math.round(reading.confidence * 100)}%` : '–'),
        stat('Sample rate', sr ? `${(sr / 1000).toFixed(1)} kHz` : '–'),
        stat('Window', sr ? `${Math.round((engine.windowSize() / sr) * 1000)} ms` : '–'));
    }

    /* ================= recent notes ================= */
    const historyEl = $('#history');
    let historyKey = null;
    function renderHistory() {
      const h = model.history;
      const key = h.map((x) => x.label + x.time + N.hz(x.freq)).join('|');
      if (key === historyKey) return;
      historyKey = key;
      historyEl.textContent = '';
      if (!h.length) { historyEl.append(el('li', { class: 'empty', text: 'Notes you hold in tune appear here.' })); return; }
      for (const x of h) historyEl.append(el('li', {}, el('span', { class: 'hn', text: x.label }), el('span', { class: 'hf', text: `${N.hz(x.freq)} Hz` }), el('span', { class: 'hc', text: `${N.signed(x.cents)} ¢` })));
    }
    setInterval(() => { if (document.body.dataset.view === 'tuner' && !document.body.classList.contains('simple')) renderHistory(); }, 1000);
    $('#historyClear').addEventListener('click', () => { model.history = []; renderHistory(); });

    /* ================= tunings: header, dialog, editor, library ================= */
    const tuningName = $('#tuningName'), tuningInst = $('#tuningInst');
    const instPicks = $('#instPicks'), tuningList = $('#tuningList'), editor = $('#tuningEditor');
    let dlgInst = 'guitar', editingId = null;
    function renderTuningHeader() {
      tuningName.textContent = tuning.instrumentId === 'chromatic' ? 'Chromatic' : tuning.name;
      tuningInst.textContent = tuning.instrumentId === 'chromatic' ? 'Any note' : tuning.custom ? `${T.instrumentName(tuning.instrumentId)}, my tuning` : T.instrumentName(tuning.instrumentId);
    }
    const chips = (t) => el('span', { class: 'note-chips', 'aria-hidden': 'true' }, ...t.strings.map((s) => el('span', { text: s.label })));
    function tuningRow(t) {
      const label = t.strings.length ? `${t.name}: ${t.strings.map((s) => s.label).join(' ')}` : t.name;
      return el('button', { class: 'tuning-row', type: 'button', role: 'listitem', 'aria-current': String(t.id === tuning.id), 'aria-label': label, onclick: () => { store.set({ tuningId: t.id }); MN.dialogs.close(); } },
        el('span', {}, el('span', { class: 'rn', text: t.name }), t.alias || t.meta ? el('span', { class: 'ra', text: t.alias || t.meta }) : null),
        t.strings.length ? chips(t) : el('span', { class: 'ra', text: 'Every note, nearest pitch' }));
    }
    function renderDialog() {
      instPicks.textContent = '';
      const tabs = T.INSTRUMENTS.map((i) => [i.id, i.name]).concat([['mine', 'My tunings']]);
      for (const [id, name] of tabs) instPicks.append(el('button', { class: 'chip' + (id === dlgInst ? ' on' : ''), role: 'tab', 'aria-selected': String(id === dlgInst), text: name, onclick: () => { dlgInst = id; editor.hidden = true; renderDialog(); } }));
      tuningList.textContent = '';
      tuningList.hidden = !editor.hidden;
      if (dlgInst === 'mine') {
        const mine = custom.list();
        if (!mine.length) tuningList.append(el('p', { class: 'empty-line', text: 'No tunings of your own yet. Create one for any instrument with up to 12 strings.' }));
        for (const t of mine) tuningList.append(el('div', { class: 'mine-row' }, tuningRow(t), el('button', { class: 'btn small ghost', type: 'button', text: 'Edit', 'aria-label': `Edit ${t.name}`, onclick: () => openEditor(t.id) })));
        tuningList.append(el('div', { class: 'row', style: 'margin-top:12px' }, el('button', { class: 'btn small', type: 'button', text: 'New tuning', onclick: () => openEditor(null) })));
      } else {
        const inst = T.instrument(dlgInst);
        for (const raw of inst.tunings) tuningList.append(tuningRow(T.preset(raw.id)));
      }
      const on = instPicks.querySelector('.on');
      if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    $('#tunings-dlg').addEventListener('dlg-open', () => { if (!editingFromCard) { dlgInst = tuning.custom ? 'mine' : tuning.instrumentId; editor.hidden = true; } editingFromCard = false; renderDialog(); });

    /* editor */
    const edName = $('#edName'), edInst = $('#edInst'), edNotes = $('#edNotes'), edPreview = $('#edPreview'), edErrors = $('#edErrors');
    let editingFromCard = false;
    for (const i of T.INSTRUMENTS) if (i.id !== 'chromatic') edInst.append(el('option', { value: i.id, text: i.name }));
    edInst.append(el('option', { value: T.CUSTOM_INSTRUMENT.id, text: T.CUSTOM_INSTRUMENT.name }));
    function openEditor(id) {
      editingId = id;
      const rec = id ? custom.raw(id) : null;
      $('#editorTitle').textContent = rec ? 'Edit tuning' : 'New tuning';
      edName.value = rec ? rec.name : '';
      edInst.value = rec ? rec.instrumentId : tuning.instrumentId !== 'chromatic' ? tuning.instrumentId : 'guitar';
      edNotes.value = rec ? rec.notes : tuning.strings.map((s) => s.label).join(' ');
      $('#edDelete').hidden = !rec;
      edErrors.textContent = '';
      editor.hidden = false; tuningList.hidden = true;
      preview();
      edName.focus();
    }
    function preview() {
      edPreview.textContent = '';
      for (const tok of T.tokens(edNotes.value).slice(0, T.MAX_STRINGS + 2)) {
        const midi = N.parse(tok);
        const ok = midi !== null && N.validFreq(N.midiToFreq(midi, S().a4));
        edPreview.append(el('span', { class: ok ? '' : 'bad' }, ok ? N.label(midi, /♭|b/.test(tok.slice(1))) : tok, ok ? el('em', { text: N.hz(N.midiToFreq(midi, S().a4, S().temperament)) }) : null));
      }
    }
    edNotes.addEventListener('input', preview);
    editor.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = { name: edName.value, instrumentId: edInst.value, notes: edNotes.value };
      const r = editingId ? custom.update(editingId, data) : custom.create(data);
      if (!r.ok) { edErrors.textContent = r.errors.join(' '); return; }
      if (r.saved === false) toast('Saved for now, but this browser won’t keep it after you close the page');
      else toast(editingId ? 'Tuning updated' : 'Tuning saved');
      store.set({ tuningId: r.id });
      if (r.id === tuning.id) { tuning = findTuning(r.id); onTuningChanged(); }
      editor.hidden = true; dlgInst = 'mine';
      renderDialog(); renderLibrary();
    });
    $('#edCancel').addEventListener('click', () => { editor.hidden = true; renderDialog(); });
    $('#edDelete').addEventListener('click', () => {
      const rec = editingId && custom.raw(editingId);
      if (!rec || !confirm(`Delete “${rec.name}”? This can’t be undone.`)) return;
      custom.remove(editingId);
      if (S().tuningId === editingId) store.set({ tuningId: T.DEFAULT_TUNING });
      toast('Tuning deleted');
      editor.hidden = true; renderDialog(); renderLibrary();
    });

    /* "My tunings" card */
    const myTunings = $('#myTunings');
    function renderLibrary() {
      myTunings.textContent = '';
      const mine = custom.list();
      if (!mine.length) { myTunings.append(el('div', { class: 'empty', text: 'No tunings of your own yet.' })); return; }
      for (const t of mine) {
        myTunings.append(el('div', { class: 'item' },
          el('div', {}, el('div', { text: t.name }), el('div', { class: 'meta', text: `${T.instrumentName(t.instrumentId)}: ${t.strings.map((s) => s.label).join(' ')}` })),
          el('div', { class: 'acts' },
            el('button', { class: 'btn small ghost', text: t.id === tuning.id ? 'In use' : 'Use', disabled: t.id === tuning.id, onclick: () => store.set({ tuningId: t.id }) }),
            el('button', { class: 'btn small ghost', text: 'Edit', 'aria-label': `Edit ${t.name}`, onclick: () => { editingFromCard = true; dlgInst = 'mine'; MN.dialogs.open('tunings'); openEditor(t.id); } }))));
      }
    }
    $('#newTuning').addEventListener('click', () => { editingFromCard = true; dlgInst = 'mine'; MN.dialogs.open('tunings'); openEditor(null); });
    $('#tunerReset').addEventListener('click', () => { if (confirm('Restore the tuner settings to their defaults? Your tunings are kept.')) { store.reset(); toast('Tuner settings restored'); } });

    /* ================= keyboard ================= */
    document.addEventListener('keydown', (e) => {
      if (document.body.dataset.view !== 'tuner' || MN.dialogs.isOpen() || isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const s = S(), n = tuning.strings.length;
      if (e.key === ' ') { e.preventDefault(); if (!e.repeat) toggleListening(); }
      else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && n) {
        e.preventDefault();
        const cur = s.stringMode === 'manual' ? s.stringIndex : view.m && view.m.stringIndex >= 0 ? view.m.stringIndex : e.key === 'ArrowRight' ? -1 : n;
        store.set({ stringMode: 'manual', stringIndex: Math.max(0, Math.min(n - 1, cur + (e.key === 'ArrowRight' ? 1 : -1))) });
      }
    });
    document.addEventListener('keyup', (e) => { if (e.key === ' ' && document.body.dataset.view === 'tuner' && !isTyping(e.target) && e.target.tagName === 'BUTTON') e.preventDefault(); });
    const sc = $('#shortcuts2');
    if (sc) {
      const rows = [el('h4', { class: 'sc-head', text: 'Tuner' })];
      for (const [k, d] of [['Space', 'Start / stop listening'], ['← / →', 'Previous / next string'], ['H', 'Help hints on / off']]) rows.push(el('kbd', { text: k }), el('span', { text: d }));
      sc.prepend(...rows);
    }

    /* ================= store → page ================= */
    function applyEngineSettings() {
      const s = S();
      engine.setGate(MN.tunerSettings.SENSITIVITY[s.sensitivity]);
      const lows = tuning.strings.map((x, i) => T.stringFreq(tuning, i, s.a4, s.temperament)).filter((f) => f > 0);
      engine.setLowest(lows.length ? Math.min(...lows) : 30, lows.length ? Math.max(...lows) : 0);
      engine.setHint(s.targetMode === 'freq' ? s.customHz : s.stringMode === 'manual' && tuning.strings.length ? T.stringFreq(tuning, Math.min(s.stringIndex, tuning.strings.length - 1), s.a4, s.temperament) : 0);
    }
    function onTuningChanged() {
      model.resetStrings(tuning.strings.length);
      if (S().stringIndex >= tuning.strings.length) store.set({ stringIndex: 0 });
      renderTuningHeader(); buildStrings(); renderLibrary(); applyEngineSettings();
      $('#stringModeSeg').classList.toggle('hidden', !tuning.strings.length);
      if (!engine.listening) render(idleModel());
    }
    const segOn = (sel, v) => Array.from($(sel).querySelectorAll('button[data-v]')).forEach((b) => { const on = String(b.dataset.v) === String(v); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    function apply(s, changed) {
      const has = (...k) => !changed || k.some((x) => x in changed);
      if (has('tuningId')) { const t = findTuning(s.tuningId); if (t) tuning = t; onTuningChanged(); }
      if (has('a4', 'temperament')) { model.resetStrings(tuning.strings.length); if (changed) buildStrings(); }
      if (has('stringMode')) segOn('#stringModeSeg', s.stringMode);
      if (has('stringMode', 'stringIndex', 'targetMode')) { renderStrings(view.m); stringsEl.classList.toggle('freq-mode', s.targetMode === 'freq'); }
      if (has('accidentals')) { segOn('#accSeg', s.accidentals); fillToneNotes(); renderTone(s); }
      if (has('sensitivity')) segOn('#sensSeg', s.sensitivity);
      if (has('tolerance')) { segOn('#tolSeg', s.tolerance); drawBand(); }
      if (has('a4')) {
        if (document.activeElement !== a4Input) a4Input.value = N.fixed(s.a4, s.a4 % 1 ? 1 : 0);
        Array.from(a4Picks.children).forEach((b) => b.classList.toggle('on', +b.dataset.v === s.a4));
      }
      if (has('detailed')) { detailSw.classList.toggle('on', s.detailed); detailSw.setAttribute('aria-pressed', String(s.detailed)); measure.classList.toggle('off', !s.detailed); }
      if (has('targetMode', 'customHz', 'a4')) {
        freqSw.classList.toggle('on', s.targetMode === 'freq'); freqSw.setAttribute('aria-pressed', String(s.targetMode === 'freq'));
        if (document.activeElement !== freqInput) freqInput.value = N.fixed(s.customHz, 2);
        const near = N.nearest(s.customHz, s.a4, s.temperament);
        freqNote.textContent = near ? `${N.label(near.midi, s.accidentals === 'flat')} ${N.signed(near.cents)} ¢` : '';
      }
      if (has('toneWave')) segOn('#waveSeg', s.toneWave);
      if (has('toneHz', 'toneVolume', 'toneWave', 'a4')) renderTone(s);
      if (has('targetMode', 'stringMode', 'stringIndex', 'sensitivity', 'customHz', 'a4', 'temperament')) applyEngineSettings();
      if (!engine.listening && changed) render(idleModel());
      else if (view.m && changed && has('a4', 'tolerance', 'targetMode', 'customHz', 'stringMode', 'stringIndex', 'accidentals')) render(model.update(null, s, tuning, performance.now(), true));
    }
    store.subscribe((s, changed) => apply(s, changed));
    window.addEventListener('pagehide', () => { store.flush(); engine.stop('hidden'); tone.close(); });

    /* the app shell tells us when the tuner is shown or left */
    window.addEventListener('mn:view', (e) => {
      if (e.detail.view !== 'tuner') { if (engine.listening) engine.stop('view'); if (tone.playing) { tone.stop(); toneSw.classList.remove('on'); } }
      else if (scopeCtx) readColors();
    });
    if (appStore) appStore.subscribe((s, patch) => { if ('theme' in patch || 'palette' in patch) colors = null, scopeCtx = null; if ('mode' in patch && s.mode === 'advanced') { renderHistory(); if (S().detailed) renderMeasure(view.m); } });

    /* first paint */
    fillToneNotes();
    apply(S(), null);
    renderHistory();
    refreshPermission();
    setListeningUI('idle');

    const api = { store, engine, model, tone, custom, get tuning() { return tuning; } };
    MN.tuner = api;
    return api;
  }

  MN.tunerUI = { init };
})(window);
