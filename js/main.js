/* main.js — wiring: the metronome, the tuner, then the switch between them (the tuner
   opens first). */
(function () {
  const store = new MN.Store();
  const engine = new MN.Engine(store);
  MN.ui.init(store, engine);
  /* a small dot on the Metronome switch while it plays, so it's never forgotten running */
  engine.on((type) => { if (type === 'start' || type === 'stop') document.body.classList.toggle('mn-playing', !!engine.running); });
  const tuner = MN.tunerUI.init({ appStore: store, toast: MN.toast });
  MN.views.init();
  window.metronome = { store, engine };   // handy for the console
  window.tuner = tuner;
})();
