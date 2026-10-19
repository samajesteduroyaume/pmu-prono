import assert from 'node:assert/strict';
import { initDB, getDB, closeDB, insertCourses } from '../core/db.mjs';

const all = (sql, params = []) => new Promise((resolve, reject) => {
    getDB().all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || []));
});

await initDB();
try {
    const featuresA = Array.from({ length: 15 }, (_, index) => index / 20);
    const featuresB = Array.from({ length: 15 }, (_, index) => (index + 1) / 20);
    const futureCourse = {
        date: '2099-06-15', heure: '15:00', hippodrome: 'TEST ML', discipline: 'PLAT',
        distance: '2000', statut: 'PROGRAMME', partants: 2, prix: 10000,
        reunionNum: '99', courseNum: '1', corde: 'GAUCHE', ordre_arrivee: null,
        rapports: null, prediction_model_version: 'snapshot-test-v1',
        participants: [
            { nom: 'CHEVAL A', numero: 1, statut: 'PARTANT', prediction_score: 80, cote_ref: 2, prediction_features: featuresA },
            { nom: 'CHEVAL B', numero: 2, statut: 'PARTANT', prediction_score: 70, cote_ref: 4, prediction_features: featuresB }
        ]
    };
    const historicalCourse = {
        ...futureCourse, date: '2020-01-01', reunionNum: '98', courseNum: '1',
        participants: futureCourse.participants.map(participant => ({ ...participant }))
    };

    await insertCourses([futureCourse, historicalCourse]);

    const future = await all(`SELECT horse_number, model_version, prediction_rank, market_rank,
        feature_vector_json, settled_at, captured_at, course_date, scheduled_time
        FROM prediction_snapshots WHERE course_date = '2099-06-15' ORDER BY horse_number`);
    const historical = await all(`SELECT id FROM prediction_snapshots WHERE course_date = '2020-01-01'`);

    assert.equal(future.length, 2, 'Capture tous les partants de la course future.');
    assert.equal(future[0].model_version, 'snapshot-test-v1');
    assert.equal(future[0].prediction_rank, 1);
    assert.equal(future[0].market_rank, 1);
    assert.deepEqual(JSON.parse(future[0].feature_vector_json), featuresA);
    assert.equal(future[0].settled_at, null);
    assert.equal(future[0].course_date, '2099-06-15');
    assert.equal(future[0].scheduled_time, '15:00');
    assert.equal(historical.length, 0, 'Ne reconstruit pas de snapshot avant-course pour une course passée.');

    console.log('✓ Capture ML — snapshots futurs immuables, features/version/rangs présents, historique non reconstruit');
} finally {
    await closeDB();
}
