/* Run: node tests/terms.test.js */
require('../js/terms.js');
const assert = require('assert');
const T = globalThis.MN.terms;
T.set('us');
assert.equal(T.note(2), 'half note'); assert.equal(T.note(4, { dotted: true, plural: true }), 'dotted quarter notes');
assert.deepEqual(T.subLabel(4), ['Sixteenths', '']);
T.set('uk');
assert.equal(T.note(2), 'minim'); assert.equal(T.note(16, { plural: true }), 'semiquavers'); assert.equal(T.note(8, { dotted: true }), 'dotted quaver');
assert.equal(T.note(1, { capital: true }), 'Semibreve'); assert.equal(T.note(32), 'demisemiquaver');
assert.deepEqual(T.subLabel(8), ['Demisemiquavers', '']);
T.set('both');
assert.equal(T.note(4), 'quarter note (crotchet)');
assert.deepEqual(T.subLabel(4), ['Sixteenths', 'semiquavers']);
assert.deepEqual(T.subLabel(3), ['Triplets', '']);
assert.equal(T.subName(2), 'eighths (quavers)');
assert.equal(T.detect(['en-GB']), 'uk'); assert.equal(T.detect(['en-US']), 'us'); assert.equal(T.detect(['es-CO', 'en-AU']), 'uk'); assert.equal(T.detect(['es-CO']), 'both');
assert.equal(T.a('eighth note'), 'an eighth note'); assert.equal(T.a('minim'), 'a minim');
console.log('ok — American, British and combined note names; language detection\n\n1 terms test passed');
