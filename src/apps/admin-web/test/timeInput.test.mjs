import assert from 'node:assert/strict';
import { isValidTime24h, normalizeTimeOnBlur } from '../src/lib/timeInput.ts';

const cases = [
  ['2', '02:00'],
  ['02', '02:00'],
  ['22', '22:00'],
  ['2:10', '02:10'],
  ['02:10', '02:10'],
  ['2:1', '02:01'],
  ['02:1', '02:01'],
  ['930', '09:30'],
  ['1230', '12:30'],
  ['0000', '00:00'],
  ['2359', '23:59'],
];

for (const [input, expected] of cases) {
  assert.equal(normalizeTimeOnBlur(input), expected, `${input} should normalize to ${expected}`);
}

for (const input of ['24:00', '23:60', '99', '1260']) {
  assert.equal(isValidTime24h(normalizeTimeOnBlur(input)), false, `${input} should stay invalid`);
}

console.log('timeInput normalization tests passed');
