/* themes.js — colour palettes, each with a light and a dark version. Loaded in <head> so
   the saved theme is applied before the first paint (no flash). The CSS for every palette
   is generated from this one table; components only use the tokens (var(--accent) …). */
(function (root) {
  const MN = (root.MN = root.MN || {});

  /* `ok` is the "in tune" colour of the tuner; palettes without one use their accent. */
  const PALETTES = [
    { id: 'luthier', name: 'Luthier', blurb: 'Walnut, brass and ice blue',
      light: { bg: '#f4f4da', surface: '#fbfbf3', surface2: '#efefcb', line: '#d8d4a6', lineStrong: '#bab07c', text: '#302020', muted: '#3c546c', faint: '#57757b', accent: '#846024', accentInk: '#ffffff', poly: '#183c54', ok: '#183c54', danger: '#a3412b' },
      dark:  { bg: '#220d0d', surface: '#2b1919', surface2: '#372420', line: '#422c20', lineStrong: '#533720', text: '#efefcb', muted: '#a59e87', faint: '#7e7362', accent: '#b09050', accentInk: '#220d0d', poly: '#9cc0cc', ok: '#9cc0cc', danger: '#e0866a' } },
    { id: 'studio', name: 'Studio', blurb: 'Teal and amber',
      light: { bg: '#f5f2ec', surface: '#ffffff', surface2: '#eeeae2', line: '#e0dad0', lineStrong: '#c9c2b5', text: '#25282d', muted: '#6b675f', faint: '#8b857a', accent: '#1f7f7a', accentInk: '#ffffff', poly: '#b8643f', danger: '#b8473a' },
      dark:  { bg: '#1b1d21', surface: '#23262b', surface2: '#2b2f35', line: '#33383f', lineStrong: '#454b54', text: '#f3ede3', muted: '#a29d93', faint: '#757a83', accent: '#e2a75c', accentInk: '#1b1d21', poly: '#7fb7c9', danger: '#e07a69' } },
    { id: 'nocturne', name: 'Nocturne', blurb: 'Indigo and moonlight',
      light: { bg: '#f2f3f8', surface: '#ffffff', surface2: '#e9ebf3', line: '#dcdfea', lineStrong: '#c3c8d8', text: '#1f2333', muted: '#5c6175', faint: '#868aa0', accent: '#3f4db3', accentInk: '#ffffff', poly: '#b36a2e', danger: '#bf4339' },
      dark:  { bg: '#141726', surface: '#1b1f31', surface2: '#23283c', line: '#2c3249', lineStrong: '#3d4460', text: '#e9ebf5', muted: '#9ea4bc', faint: '#717797', accent: '#99a5ff', accentInk: '#141726', poly: '#e3b06b', danger: '#f07a6c' } },
    { id: 'pastorale', name: 'Pastorale', blurb: 'Sage and moss',
      light: { bg: '#f1f3ee', surface: '#fbfcf9', surface2: '#e7ebe2', line: '#d9dfd2', lineStrong: '#bfc8b6', text: '#1f2a22', muted: '#57624f', faint: '#828c7e', accent: '#33704b', accentInk: '#ffffff', poly: '#a85f3e', danger: '#b4443a' },
      dark:  { bg: '#161c18', surface: '#1d241f', surface2: '#252d27', line: '#2e3830', lineStrong: '#3f4b41', text: '#ecf0e8', muted: '#a0ab9d', faint: '#717d6f', accent: '#93cda0', accentInk: '#142018', poly: '#d9a46f', danger: '#e5806f' } },
    { id: 'rosewood', name: 'Rosewood', blurb: 'Warm wood and cream',
      light: { bg: '#f7f1ee', surface: '#fffbf9', surface2: '#efe5e0', line: '#e3d6cf', lineStrong: '#cdbab0', text: '#2b1f1d', muted: '#6b5b55', faint: '#98877f', accent: '#9a3d35', accentInk: '#ffffff', poly: '#3b7a80', danger: '#a8343a' },
      dark:  { bg: '#1d1615', surface: '#261d1b', surface2: '#2f2421', line: '#3a2d2a', lineStrong: '#4d3d39', text: '#f4e9e5', muted: '#b2a19b', faint: '#85746e', accent: '#e8907b', accentInk: '#1d1615', poly: '#8cc0c4', danger: '#f27a7a' } },
    { id: 'ivory', name: 'Ebony and Ivory', blurb: 'Black and white',
      light: { bg: '#f6f5f1', surface: '#ffffff', surface2: '#ecebe6', line: '#dedcd5', lineStrong: '#c4c1b8', text: '#171717', muted: '#5c5a55', faint: '#86837c', accent: '#1d1d1f', accentInk: '#f6f5f1', poly: '#8a6d3b', danger: '#ad3d2c' },
      dark:  { bg: '#121212', surface: '#1a1a1a', surface2: '#232323', line: '#2c2c2c', lineStrong: '#3d3d3d', text: '#f2f0eb', muted: '#a6a39d', faint: '#77756f', accent: '#ece8df', accentInk: '#121212', poly: '#c9a86a', danger: '#e5786a' } },
    { id: 'lilac', name: 'Lilac', blurb: 'Lavender and plum',
      light: { bg: '#f5f2f7', surface: '#fffdff', surface2: '#ece6f0', line: '#e0d8e6', lineStrong: '#c8bdd1', text: '#251f2b', muted: '#62586b', faint: '#8d8396', accent: '#6f45a0', accentInk: '#ffffff', poly: '#3b8070', danger: '#b4403a' },
      dark:  { bg: '#18151d', surface: '#201c26', surface2: '#29242f', line: '#322c39', lineStrong: '#453d4e', text: '#f1ecf5', muted: '#aba2b5', faint: '#7c7387', accent: '#cba9f0', accentInk: '#18151d', poly: '#7fc4b0', danger: '#ee7f74' } },
  ];
  const byId = Object.fromEntries(PALETTES.map((p) => [p.id, p]));
  const DEFAULT = 'luthier';

  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const toHex = (rgb) => '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, t) => { const x = hex(a), y = hex(b); return toHex(x.map((v, i) => v + (y[i] - v) * t)); };
  const rgba = (h, a) => `rgba(${hex(h).join(',')},${a})`;

  /* Full token set for a palette in one mode (derived values included). */
  function tokens(id, mode) {
    const p = byId[id] || byId[DEFAULT];
    const c = p[mode === 'dark' ? 'dark' : 'light'];
    const dark = mode === 'dark';
    return Object.assign({ ok: c.accent }, c, {
      okSoft: rgba(c.ok || c.accent, dark ? 0.18 : 0.12),
      accentSoft: rgba(c.accent, dark ? 0.16 : 0.13),
      tipBg: dark ? mix(c.surface2, c.text, 0.05) : c.surface,
      shadow: dark ? 'none' : '0 1px 2px rgba(30,25,15,.05)',
      tipShadow: dark ? '0 14px 34px -12px rgba(0,0,0,.6)' : '0 12px 32px -14px rgba(40,30,15,.3)',
      scheme: dark ? 'dark' : 'light',
    });
  }
  function block(t) {
    return `--bg:${t.bg};--surface:${t.surface};--surface-2:${t.surface2};--line:${t.line};--line-strong:${t.lineStrong};` +
      `--text:${t.text};--muted:${t.muted};--faint:${t.faint};--accent:${t.accent};--accent-soft:${t.accentSoft};--accent-ink:${t.accentInk};` +
      `--poly:${t.poly};--ok:${t.ok};--ok-soft:${t.okSoft};--danger:${t.danger};--shadow:${t.shadow};--tip-bg:${t.tipBg};--tip-shadow:${t.tipShadow};color-scheme:${t.scheme};`;
  }
  function css() {
    let out = `:root{${block(tokens(DEFAULT, 'light'))}}\n:root[data-theme="dark"]{${block(tokens(DEFAULT, 'dark'))}}\n`;
    for (const p of PALETTES) {
      out += `:root[data-palette="${p.id}"]{${block(tokens(p.id, 'light'))}}\n`;
      out += `:root[data-palette="${p.id}"][data-theme="dark"]{${block(tokens(p.id, 'dark'))}}\n`;
    }
    return out;
  }

  const MODES = ['light', 'dark', 'auto'];
  const mq = root.matchMedia ? root.matchMedia('(prefers-color-scheme: dark)') : null;
  const resolveMode = (mode) => (mode === 'auto' ? (mq && mq.matches ? 'dark' : 'light') : mode === 'light' ? 'light' : 'dark');
  let current = { mode: 'dark', palette: DEFAULT };

  function apply(mode, palette) {
    current = { mode: MODES.includes(mode) ? mode : 'dark', palette: byId[palette] ? palette : DEFAULT };
    const de = document.documentElement;
    const resolved = resolveMode(current.mode);
    de.dataset.theme = resolved;
    de.dataset.palette = current.palette;
    const bg = tokens(current.palette, resolved).bg;
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => { m.setAttribute('content', bg); m.removeAttribute('media'); });
  }

  /* Run now, in <head>: inject the palette CSS and apply the saved choice before paint. */
  if (root.document) {
    const style = document.createElement('style');
    style.id = 'palette-css';
    style.textContent = css();
    document.head.appendChild(style);
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('metronome.v1.settings') || '{}') || {}; } catch (e) {}
    /* 2.0 introduced Luthier as the default. Visitors still on the old default (Studio) move
       to it once; anyone can switch back in Preferences, and that choice is then kept. */
    try {
      if (!localStorage.getItem('app.v2.palette')) {
        if (!saved.palette || saved.palette === 'studio') { saved.palette = DEFAULT; if (Object.keys(saved).length > 1) localStorage.setItem('metronome.v1.settings', JSON.stringify(saved)); }
        localStorage.setItem('app.v2.palette', '1');
      }
    } catch (e) {}
    apply(saved.theme, saved.palette);
    if (mq) {
      const onChange = () => { if (current.mode === 'auto') apply('auto', current.palette); };
      mq.addEventListener ? mq.addEventListener('change', onChange) : mq.addListener(onChange);
    }
  }

  MN.themes = { PALETTES, MODES, DEFAULT, tokens, css, apply, resolveMode, get current() { return current; } };
})(typeof window !== 'undefined' ? window : globalThis);
