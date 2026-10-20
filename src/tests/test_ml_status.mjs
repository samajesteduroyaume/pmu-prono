import assert from 'node:assert/strict';
import { initDB, getDB, closeDB } from '../db/db.mjs';
import { getMLStatusController } from '../server/controllers/mlController.mjs';
import { ML_FEATURE_SCHEMA_VERSION } from '../ml/model_compatibility.mjs';

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
            settled_at, feature_vector_json, feature_schema_version
        ) VALUES (?, ?, 1, 'CHEVAL TEST', '2026-10-01', '2026-10-01T14:00:00.000Z',
                  'test', 'heuristic-fallback', 75, 1, 1, '2026-10-01T15:01:00.000Z', ?, ?)
    `, [course.lastID, participant.lastID, JSON.stringify(Array(15).fill(0.5)), ML_FEATURE_SCHEMA_VERSION]);

    const oldSchemaCourse = await run(`
        INSERT INTO courses (date, heure, hippodrome, discipline, statut, ordre_arrivee)
        VALUES ('2026-09-30', '14:00', 'TEST', 'PLAT', 'ARRIVEE_DEFINITIVE_COMPLETE', '1-2')
    `);
    const oldSchemaParticipant = await run(`
        INSERT INTO participants (course_id, nom, numero, prediction_score, classement)
        VALUES (?, 'CHEVAL ANCIEN SCHEMA', 1, 80, 1)
    `, [oldSchemaCourse.lastID]);
    await run(`
        INSERT INTO prediction_snapshots (
            course_id, participant_id, horse_number, horse_name, course_date, captured_at,
            source, model_version, prediction_score, prediction_rank, outcome_rank,
            settled_at, feature_vector_json
        ) VALUES (?, ?, 1, 'CHEVAL ANCIEN SCHEMA', '2026-09-30', '2026-09-30T13:00:00.000Z',
                  'test', 'heuristic-fallback', 80, 1, 1, '2026-09-30T14:01:00.000Z', ?)
    `, [oldSchemaCourse.lastID, oldSchemaParticipant.lastID, JSON.stringify(Array(15).fill(0.6))]);
    const nonRunner = await run(`
        INSERT INTO participants (course_id, nom, numero, prediction_score, classement, statut)
        VALUES (?, 'CHEVAL NON PARTANT', 3, 60, NULL, 'NON_PARTANT')
    `, [course.lastID]);
    await run(`
        INSERT INTO prediction_snapshots (
            course_id, participant_id, horse_number, horse_name, course_date, captured_at,
            source, model_version, prediction_score, prediction_rank, outcome_rank,
            settled_at, feature_vector_json, is_non_runner, feature_schema_version
        ) VALUES (?, ?, 3, 'CHEVAL NON PARTANT', '2026-10-01', '2026-10-01T14:00:00.000Z',
                  'test', 'heuristic-fallback', 60, 2, 0, '2026-10-01T15:01:00.000Z', ?, 1, ?)
    `, [course.lastID, nonRunner.lastID, JSON.stringify(Array(15).fill(0.3)), ML_FEATURE_SCHEMA_VERSION]);

    const pendingCourse = await run(`
        INSERT INTO courses (date, heure, hippodrome, discipline, statut)
        VALUES ('2026-10-02', '15:00', 'TEST', 'PLAT', 'PROGRAMME')
    `);
    const pendingParticipant = await run(`
        INSERT INTO participants (course_id, nom, numero, prediction_score, classement)
        VALUES (?, 'CHEVAL EN ATTENTE', 2, 70, NULL)
    `, [pendingCourse.lastID]);
    await run(`
        INSERT INTO prediction_snapshots (
            course_id, participant_id, horse_number, horse_name, course_date, captured_at,
            source, model_version, prediction_score, prediction_rank, feature_vector_json, feature_schema_version
        ) VALUES (?, ?, 2, 'CHEVAL EN ATTENTE', '2026-10-02', '2026-10-02T14:00:00.000Z',
                  'test', 'heuristic-fallback', 70, 1, ?, ?)
    `, [pendingCourse.lastID, pendingParticipant.lastID, JSON.stringify(Array(14).fill(0.4)), ML_FEATURE_SCHEMA_VERSION]);

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
    assert.equal(status.value.trainingReadiness.comparableTestCourses, 0);
    assert.equal(status.value.trainingReadiness.ready, false);
    assert.equal(status.value.captureHealth.capturedCourses, 3);
    assert.equal(status.value.captureHealth.fullySettledCourses, 2);
    assert.equal(status.value.captureHealth.awaitingResultsCourses, 1);
    assert.equal(status.value.captureHealth.coursesWithInvalidFeatures, 1);
    assert.equal(status.value.captureHealth.coursesWithIncompatibleFeatureSchema, 1);
    assert.equal(status.value.captureHealth.lastCaptureAt, '2026-10-02T14:00:00.000Z');
    assert.equal(status.value.captureHealth.nonRunnerSnapshots, 1);
    console.log('✓ État ML — comptage des courses prospectives éligibles');
} finally {
    await closeDB();
}
