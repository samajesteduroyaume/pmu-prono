import assert from 'node:assert/strict';
import { initDB, getDB, closeDB, insertCourses } from '../core/db.mjs';
import { getForecastEvaluation } from '../core/forecast_evaluation.mjs';

const all = (sql, params = []) => new Promise((resolve, reject) => {
    getDB().all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || []));
});

await initDB();
try {
    const featuresA = Array.from({ length: 15 }, (_, index) => index / 20);
    const featuresB = Array.from({ length: 15 }, (_, index) => (index + 1) / 20);
    const futureCourse = {
        date: '2099-06-15', heure: '15:00', hippodrome: 'TEST ML', discipline: 'PLAT',
        distance: '2000', statut: 'PROGRAMME', partants: 3, prix: 10000,
        reunionNum: '99', courseNum: '1', corde: 'GAUCHE', ordre_arrivee: null,
        rapports: null, prediction_model_version: 'snapshot-test-v1',
        participants: [
            { nom: 'CHEVAL A', numero: 1, statut: 'PARTANT', prediction_score: 80, prediction_heuristic_score: 74, cote_ref: 2, prediction_features: featuresA },
            { nom: 'CHEVAL B', numero: 2, statut: 'PARTANT', prediction_score: 70, prediction_heuristic_score: 82, cote_ref: 4, prediction_features: featuresB },
            { nom: 'CHEVAL C', numero: 3, statut: 'PARTANT', prediction_score: 65, prediction_heuristic_score: 68, cote_ref: 8, prediction_features: featuresA }
        ]
    };
    const historicalCourse = {
        ...futureCourse, date: '2020-01-01', reunionNum: '98', courseNum: '1',
        participants: futureCourse.participants.map(participant => ({ ...participant }))
    };

    await insertCourses([futureCourse, historicalCourse]);

    const future = await all(`SELECT horse_number, model_version, prediction_rank, market_rank, heuristic_score, feature_schema_version,
        feature_vector_json, settled_at, captured_at, course_date, scheduled_time
        FROM prediction_snapshots WHERE course_date = '2099-06-15' ORDER BY horse_number`);
    const historical = await all(`SELECT id FROM prediction_snapshots WHERE course_date = '2020-01-01'`);

    assert.equal(future.length, 3, 'Capture tous les partants de la course future.');
    assert.equal(future[0].model_version, 'snapshot-test-v1');
    assert.equal(future[0].prediction_rank, 1);
    assert.equal(future[0].market_rank, 1);
    assert.equal(future[0].heuristic_score, 74, 'Archive le composant heuristique utilisé pour le score hybride.');
    assert.equal(future[0].feature_schema_version, 2, 'Marque les nouveaux vecteurs avec le schéma courant.');
    assert.deepEqual(JSON.parse(future[0].feature_vector_json), featuresA);
    assert.equal(future[0].settled_at, null);
    assert.equal(future[0].course_date, '2099-06-15');
    assert.equal(future[0].scheduled_time, '15:00');
    assert.equal(historical.length, 0, 'Ne reconstruit pas de snapshot avant-course pour une course passée.');

    const refreshedCourse = {
        ...futureCourse,
        participants: futureCourse.participants.map((participant, index) => ({
            ...participant,
            prediction_score: index === 0 ? 60 : 90,
            prediction_heuristic_score: index === 0 ? 61 : 91
        }))
    };
    await insertCourses([refreshedCourse]);
    const refreshed = await all(`SELECT horse_number, prediction_rank, heuristic_score
        FROM prediction_snapshots WHERE course_date = '2099-06-15' ORDER BY horse_number`);
    assert.equal(refreshed[0].prediction_rank, 3, 'Une nouvelle capture avant-course remplace le classement précédent.');
    assert.equal(refreshed[0].heuristic_score, 61, 'La nouvelle capture garde le composant heuristique recalculé.');

    const settledCourse = {
        ...futureCourse,
        statut: 'ARRIVEE_DEFINITIVE_COMPLETE',
        ordre_arrivee: '2-1',
        participants: [
            { ...futureCourse.participants[0], statut: 'NON_PARTANT', classement: null },
            { ...futureCourse.participants[1], statut: 'PARTANT', classement: 1 },
            { ...futureCourse.participants[2], statut: 'DISQUALIFIE', classement: null }
        ]
    };
    await insertCourses([settledCourse]);
    const afterSettlement = await all(`SELECT horse_number, is_non_runner, outcome_rank, settled_at
        FROM prediction_snapshots WHERE course_date = '2099-06-15' ORDER BY horse_number`);
    assert.equal(afterSettlement[0].is_non_runner, 1, 'Marque le non-partant après l’arrivée officielle.');
    assert.ok(afterSettlement.every(row => row.settled_at), 'Règle les snapshots après l’arrivée officielle.');
    assert.equal(afterSettlement[1].outcome_rank, 1, 'Conserve le résultat du partant gagnant.');
    assert.equal(afterSettlement[2].is_non_runner, 0, 'Un cheval disqualifié après le départ reste un partant dans le dataset.');
    assert.equal(afterSettlement[2].outcome_rank, 0, 'Un partant disqualifié est étiqueté non-gagnant.');
    const evaluation = await getForecastEvaluation({ startDate: '2099-06-15', endDate: '2099-06-15' });
    assert.equal(evaluation.comparison[0].courses, 1);
    assert.equal(evaluation.comparison[0].wins, 1, 'Évalue le meilleur partant restant, pas le cheval forfait.');
    assert.equal(evaluation.quality.nonRunnerSnapshots, 1);

    console.log('✓ Capture ML — snapshots pré-course, résultat officiel et exclusion des non-partants');
} finally {
    await closeDB();
}
