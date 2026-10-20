import { initDB, closeDB } from '../core/db.mjs';
import sqlite3 from 'sqlite3';
import { CONFIG } from '../config/settings.mjs';
import logger from '../utils/logger.mjs';
import { isMainModule } from '../utils/isMainModule.mjs';
import { MIN_CAPTURED_COURSES, splitCourseGroups } from './course_split.mjs';
import { ML_FEATURE_SCHEMA_VERSION } from './model_compatibility.mjs';

function shuffleWithSeed(items, seed) {
    let state = seed >>> 0;
    const random = () => {
        state = (1664525 * state + 1013904223) >>> 0;
        return state / 0x100000000;
    };

    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

export function balanceTrainingSet(samples, seed) {
    const winners = samples.filter(sample => sample.label === 1);
    const nonWinners = samples.filter(sample => sample.label === 0);
    if (winners.length === 0 || nonWinners.length === 0) {
        throw new Error('Le jeu d’entraînement doit contenir des gagnants et des non-gagnants.');
    }
    const sampledNonWinners = shuffleWithSeed(nonWinners, seed).slice(0, winners.length);
    return shuffleWithSeed([...winners, ...sampledNonWinners], seed ^ 0x9e3779b9);
}

export async function prepareDataset({ seed = 42 } = {}) {
    logger.header('PRÉPARATION DATASET ML');
    await initDB();

    try {
        const db = new sqlite3.Database(process.env.DB_PATH || CONFIG.database.path);
        const rows = await new Promise((resolve, reject) => {
            db.all(`
                SELECT course_id, course_date, horse_number, feature_vector_json, outcome_rank, settled_at,
                       prediction_rank, market_rank, heuristic_score, feature_schema_version
                FROM prediction_snapshots
                WHERE course_id IN (
                    SELECT DISTINCT course_id FROM prediction_snapshots WHERE settled_at IS NOT NULL
                )
                  AND COALESCE(is_non_runner, 0) = 0
                ORDER BY course_date, course_id, horse_number
            `, (error, result) => error ? reject(error) : resolve(result));
        }).finally(() => new Promise(resolve => db.close(() => resolve())));

        const byCourse = new Map();
        for (const row of rows) {
            if (!byCourse.has(row.course_id)) {
                byCourse.set(row.course_id, { course_id: row.course_id, date: row.course_date, samples: [], invalidFeatureCount: 0, invalidOutcomeCount: 0 });
            }
            const course = byCourse.get(row.course_id);
            if (Number(row.feature_schema_version) !== ML_FEATURE_SCHEMA_VERSION) course.invalidFeatureCount++;
            if (row.settled_at == null || row.outcome_rank == null) course.invalidOutcomeCount++;
            let features;
            try { features = JSON.parse(row.feature_vector_json); } catch { features = null; }
            if (!Array.isArray(features) || features.length !== 15 || !features.every(Number.isFinite)) {
                course.invalidFeatureCount++;
                continue;
            }
            if (row.settled_at == null || row.outcome_rank == null) continue;
            course.samples.push({
                courseId: row.course_id,
                date: row.course_date,
                numero: row.horse_number,
                predictionRank: row.prediction_rank == null ? null : Number(row.prediction_rank),
                marketRank: row.market_rank == null ? null : Number(row.market_rank),
                heuristicScore: row.heuristic_score == null ? null : Number(row.heuristic_score),
                features,
                label: Number(row.outcome_rank) === 1 ? 1 : 0
            });
        }

        const eligibleCourses = [...byCourse.values()].filter(course =>
            course.invalidFeatureCount === 0
            && course.invalidOutcomeCount === 0
            && course.samples.length > 0
            && course.samples.some(sample => sample.label === 1)
        );
        const rejectedCourseCount = byCourse.size - eligibleCourses.length;
        if (eligibleCourses.length === 0) {
            throw new Error('Aucun résultat prospectif exploitable : il faut des snapshots pré-course avec variables et arrivée officielle. Les anciennes courses ne sont pas recalculées.');
        }
        if (eligibleCourses.length < MIN_CAPTURED_COURSES) {
            throw new Error(`Données prospectives insuffisantes : ${eligibleCourses.length}/${MIN_CAPTURED_COURSES} courses avec variables figées et résultats officiels.`);
        }
        const { trainCourses, validationCourses, testCourses } = splitCourseGroups(eligibleCourses);
        const trainRaw = trainCourses.flatMap(course => course.samples);
        const validationRaw = validationCourses.flatMap(course => course.samples);
        const testData = testCourses.flatMap(course => course.samples);

        const trainPrior = trainRaw.filter(sample => sample.label === 1).length / trainRaw.length;
        const trainData = balanceTrainingSet(trainRaw, seed);
        const validationData = balanceTrainingSet(validationRaw, seed ^ 0x85ebca6b);

        logger.info(`Snapshots pré-course séparés chronologiquement : ${trainCourses.length} train, ${validationCourses.length} validation, ${testCourses.length} test.`);
        logger.info(`Train et validation équilibrés à 50/50 pour l’apprentissage et l’arrêt anticipé; le test garde la fréquence réelle des gagnants (${(trainPrior * 100).toFixed(2)}% dans train brut).`);
        if (rejectedCourseCount > 0) logger.warn(`${rejectedCourseCount} courses écartées : variables incomplètes ou aucun gagnant étiqueté.`);
        logger.success(`Échantillons : ${trainData.length} train, ${validationData.length}/${validationRaw.length} validation équilibrés/bruts, ${testData.length} test.`);

        return {
            trainData,
            validationData,
            testData,
            trainPrior,
            courseCounts: { train: trainCourses.length, validation: validationCourses.length, test: testCourses.length, rejected: rejectedCourseCount }
        };
    } catch (error) {
        // This module may run inside the application process, where the
        // connection is shared with request handlers. The caller that owns
        // the lifecycle (trainModel or the CLI) decides when to close it.
        throw error;
    }
}

if (isMainModule(import.meta.url)) {
    prepareDataset().then(async data => {
        console.log(JSON.stringify({
            train: data.trainData.length,
            validation: data.validationData.length,
            test: data.testData.length,
            trainPrior: data.trainPrior
        }, null, 2));
        await closeDB();
        process.exit(0);
    }).catch(error => {
        console.error('Erreur préparation dataset:', error);
        process.exit(1);
    });
}
