import assert from 'node:assert/strict';
import { initDB, getDB, closeDB } from '../db/db.mjs';
import { getSynergyScore } from '../db/repositories/statRepo.mjs';

const run = (sql, params = []) => new Promise((resolve, reject) => {
    getDB().run(sql, params, function (error) {
        if (error) reject(error);
        else resolve(this);
    });
});

await initDB();
try {
    for (let index = 1; index <= 3; index++) {
        const course = await run(`
            INSERT INTO courses (date, heure, hippodrome, discipline, statut, ordre_arrivee)
            VALUES (?, '15:00', 'TEST', 'PLAT', 'ARRIVEE_DEFINITIVE_COMPLETE', '1-2')
        `, [`2026-09-0${index}`]);
        await run(`
            INSERT INTO participants (course_id, nom, numero, driver, entraineur, classement)
            VALUES (?, ?, 1, 'Jean Pilote', 'Écurie Test', '1')
        `, [course.lastID, `CHEVAL ${index}`]);
    }

    const score = await getSynergyScore('JEAN PILOTE', 'ÉCURIE TEST');
    assert.equal(score, 90, 'Une recherche insensible à la casse retrouve la synergie gagnante.');
    console.log('✓ Synergie ML — noms driver/entraîneur comparés sans sensibilité à la casse');
} finally {
    await closeDB();
}
