/* Run: node tests/themes.test.js — every palette, in light and dark, must stay readable
   (WCAG 2.1 contrast ratios). */
require('../js/themes.js');
const assert = require('assert');
const T = globalThis.MN.themes;
const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const RULES = [
  ['text', 'bg', 7], ['text', 'surface', 7], ['text', 'surface2', 7],
  ['muted', 'bg', 4.5], ['muted', 'surface', 4.5], ['muted', 'surface2', 4.0],
  ['faint', 'bg', 3], ['faint', 'surface', 3],
  ['accentInk', 'accent', 4.5],              // labels on selected buttons, the play icon
  ['accent', 'bg', 3], ['accent', 'surface', 3], ['accent', 'surface2', 3], // accent as text and UI
  ['danger', 'bg', 3], ['danger', 'surface', 3], ['poly', 'bg', 2.5],
  ['ok', 'bg', 3], ['ok', 'surface', 3], ['ok', 'surface2', 3],   // tuner: "in tune"
];
let n = 0, fails = [];
for (const p of T.PALETTES) for (const mode of ['light', 'dark']) {
  const t = T.tokens(p.id, mode);
  for (const [fg, bg, min] of RULES) {
    const r = ratio(t[fg], t[bg]);
    if (r < min) fails.push(`${p.id}/${mode}: ${fg} on ${bg} = ${r.toFixed(2)} (needs ${min})`);
    n++;
  }
}
assert.equal(new Set(T.PALETTES.map((p) => p.id)).size, T.PALETTES.length, 'duplicate palette id');
assert.ok(T.PALETTES.some((p) => p.id === T.DEFAULT), 'default palette exists');
if (fails.length) { console.error(fails.join('\n')); process.exit(1); }
console.log(`ok — ${T.PALETTES.length} palettes × 2 modes, ${n} contrast checks\n\n1 theme test passed`);
