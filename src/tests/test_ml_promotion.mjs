import assert from 'node:assert/strict';
import { evaluateModelPromotion } from '../ml/promotion_gate.mjs';

assert.equal(evaluateModelPromotion({
    matchedCourses: 99,
    mlHitRate: 0.5,
    heuristicHitRate: 0.3,
    marketHitRate: 0.4
}).promote, false, 'Refuse un modèle sur un holdout trop petit.');

assert.equal(evaluateModelPromotion({
    matchedCourses: 120,
    mlHitRate: 0.4,
    heuristicHitRate: 0.4,
    marketHitRate: 0.3
}).promote, false, 'Refuse un modèle qui ne dépasse pas strictement les références.');

assert.equal(evaluateModelPromotion({
    matchedCourses: 120,
    mlHitRate: 0.4,
    heuristicHitRate: 0.3,
    marketHitRate: 0.35
}).promote, true, 'Autorise un modèle qui dépasse les références sur assez de courses.');

assert.equal(evaluateModelPromotion({
    matchedCourses: 120,
    mlHitRate: 1.2,
    heuristicHitRate: 0.3,
    marketHitRate: 0.35
}).promote, false, 'Refuse les métriques hors plage.');

console.log('✓ Garde de promotion ML — seuil d’échantillon, références communes et métriques valides');
