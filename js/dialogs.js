/* dialogs.js — accessible dialogs: [data-open="name"] opens #name-dlg; Esc, the backdrop
   or [data-close] closes; focus stays inside and returns to the opener. On phones the
   same markup becomes a bottom sheet (CSS). */
(function (root) {
  const MN = (root.MN = root.MN || {});
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';
  let current = null, opener = null;

  function open(name, from) {
    const dlg = document.getElementById(name + '-dlg');
    if (!dlg) return;
    if (current) close(true);
    opener = from || document.activeElement;
    current = dlg;
    dlg.hidden = false;
    document.body.classList.add('dlg-open');
    requestAnimationFrame(() => {
      dlg.classList.add('on');
      const box = dlg.querySelector('.dlg-box');
      const first = box.querySelector('[data-autofocus]') || box.querySelector(FOCUSABLE);
      (first || box).focus({ preventScroll: true });
    });
    dlg.dispatchEvent(new CustomEvent('dlg-open'));
  }

  function close(immediate) {
    const dlg = current;
    if (!dlg) return;
    current = null;
    dlg.classList.remove('on');
    document.body.classList.remove('dlg-open');
    const done = () => { if (!dlg.classList.contains('on')) dlg.hidden = true; };
    immediate ? done() : setTimeout(done, 220);
    if (opener && opener.focus && document.contains(opener)) opener.focus({ preventScroll: true });
    opener = null;
  }

  function init() {
    document.addEventListener('click', (e) => {
      const o = e.target.closest('[data-open]');
      if (o) { e.preventDefault(); open(o.dataset.open, o); return; }
      if (e.target.closest('[data-close]') || (current && e.target === current)) close();
    });
    document.addEventListener('keydown', (e) => {
      if (!current) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key === 'Tab') {
        const items = Array.from(current.querySelectorAll(FOCUSABLE)).filter((x) => x.offsetParent !== null);
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }, true);
  }

  MN.dialogs = { init, open, close, isOpen: () => !!current };
})(window);
