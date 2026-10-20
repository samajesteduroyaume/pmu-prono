import assert from 'node:assert/strict';
import { initDB, getDB, closeDB } from '../core/db.mjs';
import { trainModel } from '../ml/train.mjs';

await initDB();
try {
    await assert.rejects(
        trainModel(),
        /Aucun résultat prospectif exploitable/,
        'Une base vide doit arrêter la préparation du dataset.'
    );
    const db = getDB();
    const row = await new Promise((resolve, reject) => {
        db.get('SELECT 1 AS connected', (error, result) => error ? reject(error) : resolve(result));
    });
    assert.equal(row.connected, 1, 'Un échec de préparation ne doit pas fermer la connexion partagée du serveur.');
    console.log('✓ Cycle DB ML — l’échec de préparation préserve la connexion SQLite partagée');
} finally {
    await closeDB();
}
