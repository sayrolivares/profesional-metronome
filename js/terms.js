/* terms.js — American and British names for note values.
   Mode: 'us' (quarter note), 'uk' (crotchet) or 'both' (quarter note · crotchet). */
(function (root) {
  const MN = (root.MN = root.MN || {});

  const NOTES = {
    1: ['whole note', 'semibreve'],
    2: ['half note', 'minim'],
    4: ['quarter note', 'crotchet'],
    8: ['eighth note', 'quaver'],
    16: ['sixteenth note', 'semiquaver'],
    32: ['thirty-second note', 'demisemiquaver'],
    64: ['sixty-fourth note', 'hemidemisemiquaver'],
  };
  /* Subdivision buttons. Names follow the usual convention of a quarter-note (crotchet) beat. */
  const SUBS = {
    1: { us: 'Quarters', uk: 'Crotchets', usLong: 'quarter notes', ukLong: 'crotchets' },
    2: { us: 'Eighths', uk: 'Quavers', usLong: 'eighth notes', ukLong: 'quavers' },
    3: { us: 'Triplets', uk: 'Triplets', usLong: 'eighth-note triplets', ukLong: 'quaver triplets' },
    4: { us: 'Sixteenths', uk: 'Semiquavers', usLong: 'sixteenth notes', ukLong: 'semiquavers' },
    6: { us: 'Sextuplets', uk: 'Sextuplets', usLong: 'sixteenth-note sextuplets', ukLong: 'semiquaver sextuplets' },
    8: { us: 'Thirty-seconds', uk: 'Demisemiquavers', usLong: 'thirty-second notes', ukLong: 'demisemiquavers' },
  };
  const MODES = ['us', 'uk', 'both'];
  let mode = 'both';

  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const pick = (us, uk) => (mode === 'us' ? us : mode === 'uk' ? uk : us === uk ? us : `${us} (${uk})`);

  /* "quarter note" / "crotchet" / "quarter note (crotchet)"; options: plural, dotted, capital */
  function note(den, o = {}) {
    const n = NOTES[den] || NOTES[4];
    const form = (s) => (o.dotted ? 'dotted ' : '') + s + (o.plural ? 's' : '');
    const s = pick(form(n[0]), form(n[1]));
    return o.capital ? cap(s) : s;
  }
  /* Button label: [main line, second line or ''] */
  function subLabel(n) {
    const d = SUBS[n] || SUBS[1];
    if (mode === 'us') return [d.us, ''];
    if (mode === 'uk') return [d.uk, ''];
    return [d.us, d.uk === d.us ? '' : d.uk.toLowerCase()];
  }
  /* One-line name, e.g. for the practice log: "sixteenths (semiquavers)" */
  function subName(n) { const d = SUBS[n] || SUBS[1]; return pick(d.us.toLowerCase(), d.uk.toLowerCase()); }
  function subLong(n) { const d = SUBS[n] || SUBS[1]; return pick(d.usLong, d.ukLong); }

  /* Browser language decides the first-run default; people can change it in Preferences. */
  function detect(langs) {
    const list = (langs || (root.navigator && (root.navigator.languages || [root.navigator.language])) || []).map((l) => String(l).toLowerCase());
    for (const l of list) {
      if (!l.startsWith('en')) continue;
      if (/^en-(gb|ie|au|nz|za|in|sg|hk|mt|jm|ng|ke)/.test(l)) return 'uk';
      if (/^en-(us|ca|ph)/.test(l)) return 'us';
    }
    return 'both';
  }

  /* "a quarter note", "an eighth note" */
  const a = (phrase) => (/^[aeiou]/i.test(phrase) ? 'an ' : 'a ') + phrase;

  MN.terms = {
    MODES, NOTES, SUBS, note, a, subLabel, subName, subLong, detect,
    set(m) { mode = MODES.includes(m) ? m : 'both'; },
    get mode() { return mode; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
