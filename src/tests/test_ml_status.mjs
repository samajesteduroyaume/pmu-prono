import assert from 'node:assert/strict';
import { initDB, getDB, closeDB } from '../db/db.mjs';
import { getMLStatusController } from '../server/controllers/mlController.mjs';

const run = (sql, params = []) => new Promise((resolve, reject) => {
    getDB().run(sql, params, function (error) {
        if (error) reject(error);
        else resolve(this);
    });
});

await initDB();
try {
    const course = await run(`
        INSERT INTO courses (date, heure, hippodrome, discipline, statut)
        VALUES ('2026-10-01', '15:00', 'TEST', 'PLAT', 'ARRIVEE_DEFINITIVE_COMPLETE')
    `);
    const participant = await run(`
        INSERT INTO participants (course_id, nom, numero, prediction_score, classement)
        VALUES (?, 'CHEVAL TEST', 1, 75, 1)
    `, [course.lastID]);
    await run(`
        INSERT INTO prediction_snapshots (
            course_id, participant_id, horse_number, horse_name, course_date, captured_at,
            source, model_version, prediction_score, prediction_rank, outcome_rank,
            settled_at, feature_vector_json
        ) VALUES (?, ?, 1, 'CHEVAL TEST', '2026-10-01', '2026-10-01T14:00:00.000Z',
                  'test', 'heuristic-fallback', 75, 1, 1, '2026-10-01T15:01:00.000Z', ?)
    `, [course.lastID, participant.lastID, JSON.stringify(Array(15).fill(0.5))]);

    let status;
    const response = {
        status(code) { this.code = code; return this; },
        json(value) { status = { code: this.code || 200, value }; }
    };
    await getMLStatusController({}, response);

    assert.equal(status.code, 200);
    assert.equal(status.value.trainingReadiness.eligibleCourses, 1);
    assert.equal(status.value.trainingReadiness.eligibleDates, 1);
    assert.equal(status.value.trainingReadiness.chronologicalSplit.test, 0);
    assert.equal(status.value.trainingReadiness.requiredTestCourses, 100);
    assert.equal(status.value.trainingReadiness.ready, false);
    console.log('✓ État ML — comptage des courses prospectives éligibles');
} finally {
    await closeDB();
}
