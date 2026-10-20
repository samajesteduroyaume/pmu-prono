import assert from 'node:assert/strict';
import { isNonRunnerStatus } from '../core/runner_status.mjs';

for (const status of ['NON_PARTANT', 'NON-PARTANT', 'NON PARTANT', 'FORFAIT', 'NP']) {
    assert.equal(isNonRunnerStatus(status), true, `${status} doit être exclu des partants.`);
}
for (const status of ['PARTANT', 'ABANDONNE', 'DISQUALIFIE', 'RETIRE', 'ARRETE']) {
    assert.equal(isNonRunnerStatus(status), false, `${status} reste un cheval ayant pris le départ.`);
}

console.log('✓ Statuts ML — seuls les véritables non-partants sont exclus');
