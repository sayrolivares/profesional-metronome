/* main.js — wiring */
(function () {
  const store = new MN.Store();
  const engine = new MN.Engine(store);
  MN.ui.init(store, engine);
  window.metronome = { store, engine }; // handy for the console
})();
