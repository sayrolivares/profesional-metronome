/* version.js — single source of truth for the app's identity. */
(function (root) {
  const MN = (root.MN = root.MN || {});
  MN.APP = Object.freeze({
    name: 'Metronome',
    version: '1.4.0',
    released: 'November 2026',
    handle: 'sayrolivares',
    links: Object.freeze({
      instagram: 'https://www.instagram.com/sayrolivares/',
      x: 'https://x.com/sayrolivares',
    }),
  });
})(typeof window !== 'undefined' ? window : globalThis);
