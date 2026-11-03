/* Run: node tests/privacy.test.js — the in-app privacy dialog and privacy.html must say the same thing. */
const fs = require('fs'), path = require('path'), assert = require('assert');
const grab = (f) => {
  const s = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const a = s.indexOf('<!-- privacy:start -->'), b = s.indexOf('<!-- privacy:end -->');
  assert.ok(a >= 0 && b > a, f + ' is missing the privacy markers');
  return s.slice(a, b).replace(/\s+/g, ' ').trim();
};
assert.equal(grab('index.html'), grab('privacy.html'), 'privacy text differs between index.html and privacy.html');
const idx = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
assert.ok(!/fonts\.googleapis|fonts\.gstatic|googletagmanager|google-analytics/.test(idx), 'third-party request found in index.html');
console.log('ok — privacy text identical in both places, no third-party requests\n\n1 privacy test passed');
