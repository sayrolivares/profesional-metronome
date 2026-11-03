/* help.js — hover/focus/tap hints. Any element with data-help="Title::Explanation"
   gets an elegant tooltip while help hints are on (store.help). */
(function (root) {
  const MN = (root.MN = root.MN || {});

  function init(store) {
    const tip = document.getElementById('tip');
    const tTitle = tip.querySelector('.tip-title');
    const tBody = tip.querySelector('.tip-body');
    const arrow = tip.querySelector('.tip-arrow');
    let target = null, showT = 0, hideT = 0, touchT = 0, lastHide = 0;
    const on = () => store.get().help;

    function parse(el) {
      const raw = el.getAttribute('data-help') || '';
      const i = raw.indexOf('::');
      return i < 0 ? ['', raw] : [raw.slice(0, i), raw.slice(i + 2)];
    }
    function place(el) {
      const r = el.getBoundingClientRect();
      const tw = tip.offsetWidth, th = tip.offsetHeight, m = 10, vw = document.documentElement.clientWidth;
      let top = r.top - th - m, side = 'top';
      if (top < 8) { top = r.bottom + m; side = 'bottom'; }
      let left = Math.max(8, Math.min(r.left + r.width / 2 - tw / 2, vw - tw - 8));
      tip.style.left = left + 'px';
      tip.style.top = top + 'px';
      tip.dataset.side = side;
      arrow.style.left = Math.max(14, Math.min(r.left + r.width / 2 - left, tw - 14)) + 'px';
    }
    function show(el) {
      if (!on() || !el.isConnected) return;
      const [title, body] = parse(el);
      if (!title && !body) return;
      tTitle.textContent = title; tTitle.hidden = !title;
      tBody.textContent = body; tBody.hidden = !body;
      target = el;
      tip.classList.remove('on');
      tip.style.visibility = 'hidden'; tip.style.display = 'block';
      place(el);
      tip.style.visibility = '';
      requestAnimationFrame(() => tip.classList.add('on'));
    }
    function hide() {
      clearTimeout(showT);
      if (!target) return;
      target = null; lastHide = performance.now();
      tip.classList.remove('on');
    }

    document.addEventListener('pointerover', (e) => {
      if (!on()) return;
      const el = e.target.closest && e.target.closest('[data-help]');
      if (!el || el === target) return;
      clearTimeout(showT); clearTimeout(hideT);
      if (e.pointerType === 'touch') { show(el); clearTimeout(touchT); touchT = setTimeout(hide, 3800); return; }
      const warm = target || performance.now() - lastHide < 450;
      showT = setTimeout(() => show(el), warm ? 60 : 420);
    });
    document.addEventListener('pointerout', (e) => {
      if (e.pointerType === 'touch') return;
      const el = e.target.closest && e.target.closest('[data-help]');
      if (!el || (e.relatedTarget && el.contains(e.relatedTarget))) return;
      clearTimeout(showT);
      hideT = setTimeout(hide, 90);
    });
    document.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'touch') hide(); }, true);
    document.addEventListener('focusin', (e) => {
      if (!on()) return;
      const el = e.target.closest && e.target.closest('[data-help]');
      if (el && el.matches(':focus-visible')) { clearTimeout(showT); show(el); }
    });
    document.addEventListener('focusout', () => hide());
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
    window.addEventListener('scroll', hide, { passive: true, capture: true });
    window.addEventListener('resize', hide);
    store.subscribe((s, patch) => { if ('help' in patch && !s.help) hide(); });
    return { hide };
  }

  MN.help = { init };
})(window);
