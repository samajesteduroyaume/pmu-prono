import assert from 'node:assert/strict';
import { mergeWeather, normalizeWeather, weatherLabel } from '../core/weather.mjs';

assert.deepEqual(normalizeWeather({ nebulositeCode: 'NUAGEUX', temperature: 0, etatPiste: 'BON' }), {
    nebulositeCode: 'NUAGEUX', temperature: 0, etatPiste: 'BON'
});
assert.deepEqual(normalizeWeather({ temperature: ' 12,5 °C ' }), { temperature: 12.5 });
assert.deepEqual(normalizeWeather({ temperature: 'inconnue', nebulositeCode: {} }), null);
assert.deepEqual(normalizeWeather({ temperature: 18, datePrevision: 1e99 }), { temperature: 18 });
assert.equal(normalizeWeather(null), null);
assert.equal(normalizeWeather([]), null);
assert.equal(weatherLabel({ temperature: 0 }), '0°C');
assert.equal(weatherLabel(null), 'Météo indisponible');
assert.deepEqual(mergeWeather({ nebulositeCode: 'PLUIE', temperature: 11 }, { temperature: 0 }, '2026-10-22T10:00:00.000Z'), {
    nebulositeCode: 'PLUIE', temperature: 0, capturedAt: '2026-10-22T10:00:00.000Z'
});
assert.deepEqual(mergeWeather({ temperature: 10 }, null), { temperature: 10 });
assert.deepEqual(mergeWeather(
    { temperature: 10, nebulositeCode: 'P4', etatPiste: 'BON', datePrevision: '2026-10-22T10:00:00Z' },
    { temperature: 12, datePrevision: '2026-10-22T11:00:00Z' },
    '2026-10-22T10:00:00.000Z'
), { temperature: 12, datePrevision: '2026-10-22T11:00:00.000Z', etatPiste: 'BON', capturedAt: '2026-10-22T10:00:00.000Z' });
assert.equal(weatherLabel({ etatPiste: 'BON' }), 'Piste : BON');
const pmuPayload = normalizeWeather({
    datePrevision: 1792627980000,
    nebulositeCode: 'P8c',
    nebulositeLibelleCourt: 'Faibles averses ou pluie faible intermittente',
    nebulositeLibelleLong: 'Le ciel sera chargé.',
    temperature: 14,
    forceVent: 2,
    directionVent: 'S'
});
assert.equal(pmuPayload.temperature, 14);
assert.equal(pmuPayload.forceVent, 2);
assert.equal(pmuPayload.directionVent, 'S');
assert.equal(pmuPayload.nebulositeLibelleCourt, 'Faibles averses ou pluie faible intermittente');
assert.equal(pmuPayload.datePrevision, new Date(1792627980000).toISOString());
assert.equal(mergeWeather(null, { temperature: 14 }, '2026-10-22T10:00:00.000Z').capturedAt, '2026-10-22T10:00:00.000Z');
console.log('✅ Normalisation météo : valeurs nulles, température zéro et données invalides');
