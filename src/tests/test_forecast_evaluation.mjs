import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { initDB, getDB, closeDB } from '../db/db.mjs';
import { getForecastEvaluation } from '../core/forecast_evaluation.mjs';

const isolatedDbPrefix = path.join(os.tmpdir(), 'pmu-tests-');
assert.ok(process.env.DB_PATH && path.resolve(process.env.DB_PATH).startsWith(isolatedDbPrefix),
    'Run this fixture through npm test so it cannot write to the project database.');

await initDB();
const db = getDB();

function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (error) {
            if (error) reject(error);
            else resolve(this.lastID);
        });
    });
}

async function addCourse({ date, number, modelVersion, winner, predictionRanks, marketRanks, payout, settled = true, settlementTimestampMissing = false, mixedVersion = false, withSnapshots = true }) {
    const courseId = await run(`
        INSERT INTO courses (date, heure, statut, partants, reunionNum, courseNum, ordre_arrivee)
        VALUES (?, '12:00', ?, 5, 'R1', ?, ?)
    `, [date, settled ? 'ARRIVEE_DEFINITIVE_COMPLETE' : 'ARRIVEE_DEFINITIVE_COMPLETE', `${number}`, settled ? '1-2-3-4-5' : '1-2-3-4-5']);
    if (!withSnapshots) return courseId;

    for (let horse = 1; horse <= 5; horse++) {
        const participantId = await run(`
            INSERT INTO participants (course_id, nom, numero, statut)
            VALUES (?, ?, ?, 'PARTANT')
        `, [courseId, `Cheval ${number}-${horse}`, horse]);
        await run(`
            INSERT INTO prediction_snapshots (
                course_id, participant_id, horse_number, horse_name, course_date,
                scheduled_time, captured_at, source, model_version, prediction_score,
                prediction_rank, market_rank, outcome_rank, settled_at,
                official_payout, is_non_runner
            ) VALUES (?, ?, ?, ?, ?, '12:00', ?, 'test', ?, ?, ?, ?, ?, ?, ?, 0)
        `, [
            courseId,
            participantId,
            horse,
            `Cheval ${number}-${horse}`,
            date,
            `${date}T10:00:00.000Z`,
            mixedVersion && horse === 5 ? `${modelVersion}-mixed` : modelVersion,
            80 - horse,
            predictionRanks[horse - 1],
            marketRanks[horse - 1],
            settled ? (horse === winner ? 1 : horse + 1) : null,
            settled && !settlementTimestampMissing ? `${date}T13:00:00.000Z` : null,
            settled && horse === winner ? payout : null
        ]);
    }
    return courseId;
}

try {
    // January: the first course misses Top 1 but puts the winner in Top 3;
    // the second course has an official winning payout.
    await addCourse({
        date: '2026-01-10', number: 'C1', modelVersion: 'model-v1', winner: 3, payout: 4,
        predictionRanks: [4, 1, 3, 2, 5], marketRanks: [5, 1, 4, 2, 3]
    });
    await addCourse({
        date: '2026-01-11', number: 'C2', modelVersion: 'model-v1', winner: 1, payout: 4,
        predictionRanks: [1, 2, 3, 4, 5], marketRanks: [2, 1, 3, 4, 5]
    });
    await addCourse({ date: '2026-01-12', number: 'LEGACY', withSnapshots: false });

    // February: the winner has no official payout, and a separate race mixes
    // model versions. It counts as captured, but must not enter model metrics.
    await addCourse({
        date: '2026-02-10', number: 'C3', modelVersion: 'model-v2', winner: 1, payout: null,
        predictionRanks: [1, 2, 3, 4, 5], marketRanks: [2, 1, 3, 4, 5]
    });
    await addCourse({
        date: '2026-02-11', number: 'MIXED', modelVersion: 'model-v2', winner: 2, payout: 3,
        predictionRanks: [2, 1, 3, 4, 5], marketRanks: [1, 2, 3, 4, 5], mixedVersion: true
    });

    // March has an arrival in the course table but no settled snapshot labels.
    await addCourse({
        date: '2026-03-10', number: 'PENDING', modelVersion: 'model-v2', winner: 1, payout: 2,
        predictionRanks: [1, 2, 3, 4, 5], marketRanks: [1, 2, 3, 4, 5], settled: false
    });
    await addCourse({
        date: '2026-03-11', number: 'MISSING-TIME', modelVersion: 'model-v2', winner: 1, payout: 2,
        predictionRanks: [1, 2, 3, 4, 5], marketRanks: [1, 2, 3, 4, 5], settlementTimestampMissing: true
    });
    await addCourse({
        date: '2026-03-12', number: 'PARTIAL-MARKET', modelVersion: 'model-v2', winner: 1, payout: 2,
        predictionRanks: [1, 2, 3, 4, 5], marketRanks: [1, 2, 3, 4, null]
    });

    const result = await getForecastEvaluation();
    const top1 = result.rankingComparison.find(row => row.topK === 1);
    const top3 = result.rankingComparison.find(row => row.topK === 3);
    const top5 = result.rankingComparison.find(row => row.topK === 5);

    assert.equal(top1.comparableCourses, 3, 'Top 1 comparison should use only fully settled, single-version races');
    assert.equal(top1.prediction.hits, 2);
    assert.equal(top1.market.hits, 0);
    assert.equal(top1.differencePoints, 66.7);
    assert.equal(top1.prediction.confidence95.length, 2);
    assert.deepEqual(top1.prediction.confidence95, [20.8, 93.9], 'Wilson interval for 2 hits out of 3 should match the controlled value');
    assert.ok(top1.prediction.confidence95[0] <= top1.prediction.hitRate);
    assert.ok(top1.prediction.confidence95[1] >= top1.prediction.hitRate);
    assert.equal(top3.prediction.hits, 3, 'Winner appears in the AI top 3 in all comparable races');
    assert.deepEqual(top3.prediction.confidence95, [43.8, 100], 'Wilson interval for 3 hits out of 3 should match the controlled value');
    assert.equal(top3.market.hits, 2);
    assert.equal(top5.prediction.hits, 3);
    assert.equal(top5.market.hits, 3);
    assert.equal(top1.differenceConfidence95.length, 2);
    assert.equal(result.winnerRankComparison.comparableCourses, 3);
    assert.equal(result.winnerRankComparison.predictionMeanReciprocalRank, 77.8);
    assert.equal(result.winnerRankComparison.marketMeanReciprocalRank, 41.7);
    assert.equal(result.winnerRankComparison.differencePoints, 36.1);
    assert.equal(result.winnerRankComparison.predictionConfidence95.length, 2);
    assert.equal(result.winnerRankComparison.marketConfidence95.length, 2);
    assert.equal(result.winnerRankComparison.differenceConfidence95.length, 2);
    assert.deepEqual((await getForecastEvaluation()).rankingComparison, result.rankingComparison, 'Bootstrap intervals should be deterministic');
    assert.deepEqual((await getForecastEvaluation()).winnerRankComparison, result.winnerRankComparison, 'MRR bootstrap interval should be deterministic');

    const january = result.monthlyTrend.find(row => row.month === '2026-01');
    const february = result.monthlyTrend.find(row => row.month === '2026-02');
    const march = result.monthlyTrend.find(row => row.month === '2026-03');
    assert.equal(january.finishedCourses, 3, 'Finished course denominator must not multiply by snapshot count');
    assert.equal(january.capturedFinishedCourses, 2);
    assert.equal(january.captureCoverage, 66.7);
    assert.equal(january.settlementCoverage, 100);
    assert.equal(january.predictionTop1Roi, 100, 'Two 1-unit bets, one 4-unit return, gives +100% ROI');
    assert.equal(february.predictionTop1Roi, null, 'ROI is unavailable when a winning pick has no official payout');
    assert.equal(february.predictionTop1PayoutCoverage, 0);
    assert.equal(february.comparableSettledCourses, 1, 'Mixed-version course should be excluded from monthly ranking metrics');
    assert.equal(march.settlementCoverage, 33.3, 'Settlement coverage includes fully settled courses even if a market rank is missing');
    assert.equal(march.comparableSettledCourses, 0, 'Unsettled snapshots must not enter hit-rate denominators');
    assert.equal(result.quality.settledCourses, 5, 'Outcome labels without a settlement timestamp must remain pending');
    assert.equal(result.quality.mixedModelVersionCourses, 1);
    const scoreBand70 = result.scoreBands.find(row => row.band === '70–79');
    assert.equal(scoreBand70.captured, 6, 'Descriptive score analysis must exclude mixed-version races');
    assert.equal(scoreBand70.settled, 4);
    assert.equal(scoreBand70.wins, 3);

    const modelV1 = result.modelVersionBreakdown.find(row => row.modelVersion === 'model-v1');
    const modelV2 = result.modelVersionBreakdown.find(row => row.modelVersion === 'model-v2');
    assert.equal(modelV1.comparableSettledCourses, 2);
    assert.equal(modelV2.comparableSettledCourses, 1);
    console.log('✓ Évaluation prospective — Top K, incertitude, cohortes, couverture et ROI vérifiés');
} finally {
    await closeDB();
}
