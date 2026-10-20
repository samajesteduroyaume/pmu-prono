import assert from 'node:assert/strict';
import { combineHybridScores, mlProbabilityToPoints } from '../ml/scoring.mjs';

const calibrated = [0.1, 0.3, 0.5, 0.7, 0.9].map(value => mlProbabilityToPoints(value, 0.1));
assert.ok(calibrated.every(Number.isInteger), 'La sortie recalibrée doit être un score entier exploitable.');
assert.ok(calibrated.every((value, index) => index === 0 || value >= calibrated[index - 1]), 'La conversion préserve l’ordre des probabilités.');
assert.equal(mlProbabilityToPoints(Number.NaN, 0.1), null);
assert.equal(mlProbabilityToPoints(0.5, 1), null);

assert.equal(combineHybridScores(80, 60, { mlWeight: 0.5, heuristicWeight: 0.5 }), 70);
assert.equal(combineHybridScores(80, 60, { mlWeight: 0.25, heuristicWeight: 0.75 }), 65);
assert.equal(combineHybridScores(80, 60, { mlWeight: 0.5, heuristicWeight: 0.5 }), 70,
    'Le score de ranking est celui produit par le mélange appliqué en production.');
assert.equal(combineHybridScores(80, 60, { mlWeight: -1, heuristicWeight: 1 }), null);

console.log('✓ Scoring ML — calibration de la fréquence gagnante et mélange de production');
