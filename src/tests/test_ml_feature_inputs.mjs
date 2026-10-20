import assert from 'node:assert/strict';
import { extractMLFeatures } from '../core/hybrid.mjs';

const base = {
    forme: 0.5, classe: 0.5, config: 0.5, entourage: 0.5, regularite: 0.5,
    confiance: 0.5, isTrot: 0, isShielded: 0, sentiment: 0.5,
    distanceNorm: 0.5, cordeNorm: 0.5, poidsNorm: 0.5, reculNorm: 0.5
};

const missing = await extractMLFeatures(
    { nom: 'CHEVAL TEST', terrain_prefere: null, cote_ref: 0 },
    { discipline: 'PLAT', terrain: null }, [], base
);
assert.equal(missing[10], 0.5, 'Deux terrains inconnus doivent donner une valeur neutre.');

const preferred = await extractMLFeatures(
    { nom: 'CHEVAL TEST', terrain_prefere: 'SOUPLE', cote_ref: 0 },
    { discipline: 'PLAT', terrain: 'souple' }, [], base
);
assert.equal(preferred[10], 1, 'Une préférence qui correspond à un terrain connu est valorisée.');

const different = await extractMLFeatures(
    { nom: 'CHEVAL TEST', terrain_prefere: 'LOURD', cote_ref: 0 },
    { discipline: 'PLAT', terrain: 'SOUPLE' }, [], base
);
assert.equal(different[10], 0.5, 'Un terrain différent reste neutre en l’absence de modèle d’incompatibilité.');

console.log('✓ Variables ML — terrain inconnu neutre et préférence connue cohérente');
