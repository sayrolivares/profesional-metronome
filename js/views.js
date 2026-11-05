/* views.js — the app's two tools, Tuner and Metronome, and the switch between them.
   The tuner is always what opens; #metronome in the address (or a home-screen shortcut)
   opens the metronome instead. Switching is one tap from anywhere: in the header on wide
   screens, in a bar at the bottom on phones.

   Other modules hear about switches through a window event:
     window.addEventListener('mn:view', (e) => e.detail.view)   // 'tuner' | 'metronome' */
(function (root) {
  const MN = (root.MN = root.MN || {});
  const VIEWS = ['tuner', 'metronome'];
  const LABELS = { tuner: 'Tuner', metronome: 'Metronome' };
  let current = null;

  function show(view, opts = {}) {
    if (!VIEWS.includes(view)) view = 'tuner';
    if (view === current && !opts.force) return;
    current = view;
    for (const sec of document.querySelectorAll('.view[data-view]')) sec.hidden = sec.dataset.view !== view;
    for (const b of document.querySelectorAll('[data-view-btn]')) {
      const on = b.dataset.viewBtn === view;
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    }
    document.body.dataset.view = view;
    const name = (MN.APP && MN.APP.name) || '';
    document.title = name ? `${LABELS[view]} – ${name}` : LABELS[view];
    const hash = view === 'metronome' ? '#metronome' : '';
    if ((location.hash || '') !== hash && history.replaceState) history.replaceState(null, '', location.pathname + location.search + hash);
    if (opts.scroll !== false) root.scrollTo({ top: 0 });
    root.dispatchEvent(new CustomEvent('mn:view', { detail: { view } }));
  }

  function init() {
    for (const b of document.querySelectorAll('[data-view-btn]')) {
      b.addEventListener('click', (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;   // let "open in new tab" work
        e.preventDefault();
        show(b.dataset.viewBtn);
      });
    }
    root.addEventListener('hashchange', () => show(location.hash === '#metronome' ? 'metronome' : 'tuner'));
    show(location.hash === '#metronome' ? 'metronome' : 'tuner', { force: true, scroll: false });
  }

  MN.views = { init, show, get current() { return current; }, VIEWS };
})(window);
