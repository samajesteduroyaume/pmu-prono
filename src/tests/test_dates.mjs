import assert from 'node:assert/strict';
import { formatDate } from '../utils/dateUtils.mjs';

console.log('=== TEST DES DATES (Europe/Paris) ===');

const fixedDate = new Date('2024-12-30T12:00:00.000Z');
assert.equal(formatDate(fixedDate), '2024-12-30', 'La date locale du 30 décembre doit rester le 30 décembre.');
console.log('Date fixe:', formatDate(fixedDate));

const today = formatDate(new Date());
const dateOnly = new Date(`${today}T12:00:00.000Z`);
const lastSevenDays = [];
for (let offset = 6; offset >= 0; offset--) {
    const date = new Date(dateOnly);
    date.setUTCDate(date.getUTCDate() - offset);
    lastSevenDays.push(formatDate(date));
}

assert.equal(new Set(lastSevenDays).size, 7, 'Les sept dates doivent être distinctes.');
assert.equal(lastSevenDays.at(-1), today, 'La dernière date doit correspondre à aujourd’hui à Paris.');
console.log('Sept derniers jours:', lastSevenDays.join(', '));
console.log('Dates validées.');
