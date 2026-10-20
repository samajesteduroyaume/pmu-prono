import assert from 'node:assert/strict';
import { balanceTrainingSet } from '../ml/dataset.mjs';

const samples = [
    { id: 'win-1', label: 1 },
    { id: 'win-2', label: 1 },
    ...Array.from({ length: 10 }, (_, index) => ({ id: `loss-${index}`, label: 0 }))
];

const first = balanceTrainingSet(samples, 123);
const second = balanceTrainingSet(samples, 123);
assert.deepEqual(first, second, 'Le tirage équilibré reste reproductible avec une seed fixe.');
assert.equal(first.filter(sample => sample.label === 1).length, 2);
assert.equal(first.filter(sample => sample.label === 0).length, 2);
assert.equal(new Set(first.map(sample => sample.id)).size, first.length, 'Un échantillon n’est jamais dupliqué.');

console.log('✓ Équilibrage ML — validation reproductible à 50/50');
