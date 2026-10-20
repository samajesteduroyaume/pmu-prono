import util from 'util';
if (!util.isNullOrUndefined) {
    util.isNullOrUndefined = (arg) => arg === null || arg === undefined;
}

import { prepareDataset } from './dataset.mjs';
import { evaluateModelPromotion, MIN_PROMOTION_TEST_COURSES } from './promotion_gate.mjs';
import { loadTensorFlowBackend } from './tensorflow_runtime.mjs';
import { closeDB } from '../core/db.mjs';
import logger from '../utils/logger.mjs';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { isMainModule } from '../utils/isMainModule.mjs';
import { MODEL_PATH } from './model_paths.mjs';
import { CONFIG } from '../config/settings.mjs';
import { mlProbabilityToPoints, combineHybridScores } from './scoring.mjs';
import { ML_FEATURE_SCHEMA_VERSION, ML_TRAINING_METHOD } from './model_compatibility.mjs';

const MODEL_STAGING_PATH = `${MODEL_PATH}.staging`;
const MODEL_BACKUP_PATH = `${MODEL_PATH}.previous`;
let tfModule = null;

async function trainModel(options = {}) {
    const { closeDbAtEnd = false } = options;
    logger.header('ENTRAÎNEMENT IA - ARCHITECT v27.1');
    const tensors = [];
    let model;

    try {
        // 1. Préparation du dataset
        const { trainData, validationData, testData, trainPrior, courseCounts } = await prepareDataset();
        if (courseCounts.test < MIN_PROMOTION_TEST_COURSES) {
            throw new Error(`Entraînement différé : le test chronologique ne contient que ${courseCounts.test}/${MIN_PROMOTION_TEST_COURSES} courses; aucun candidat ne pourra être promu avec un test aussi petit.`);
        }
        const runtime = await loadTensorFlowBackend();
        tfModule = runtime.tf;
        logger.info(`Moteur TensorFlow.js sélectionné : ${runtime.backend === 'native' ? 'natif CPU' : 'JavaScript pur'}.`);
        const tf = tfModule;

        // 2. Conversion en tenseurs
        const trainFeatures = tf.tensor2d(trainData.map(d => d.features)); tensors.push(trainFeatures);
        const trainLabels = tf.tensor2d(trainData.map(d => [d.label])); tensors.push(trainLabels);
        const validationFeatures = tf.tensor2d(validationData.map(d => d.features)); tensors.push(validationFeatures);
        const validationLabels = tf.tensor2d(validationData.map(d => [d.label])); tensors.push(validationLabels);
        const testFeatures = tf.tensor2d(testData.map(d => d.features)); tensors.push(testFeatures);
        const testLabels = tf.tensor2d(testData.map(d => [d.label])); tensors.push(testLabels);

    logger.info('Tenseurs créés');

    // 3. Architecture du modèle
    model = tf.sequential({
        layers: [
            tf.layers.dense({
                units: 128,
                activation: 'relu',
                inputShape: [15],
                kernelInitializer: 'heNormal'
            }),
            tf.layers.batchNormalization(),
            tf.layers.dropout({ rate: 0.2 }),
            tf.layers.dense({
                units: 64,
                activation: 'relu'
            }),
            tf.layers.batchNormalization(),
            tf.layers.dropout({ rate: 0.1 }),
            tf.layers.dense({
                units: 32,
                activation: 'relu'
            }),
            tf.layers.dense({
                units: 1,
                activation: 'sigmoid'
            })
        ]
    });

    // 4. Compilation
    model.compile({
        optimizer: tf.train.adam(0.001),
        loss: 'binaryCrossentropy',
        metrics: []
    });

    logger.info('Modèle compilé');
    model.summary();

    // 5. Entraînement avec Early Stopping
    logger.info('Début de l\'entraînement (max 60 epochs avec Early Stopping)...');

    const earlyStopping = tf.callbacks.earlyStopping({
        monitor: 'val_loss',
        patience: 8
    });

    const loggerCallback = new tf.CustomCallback({
        onEpochEnd: async (epoch, logs) => {
            if (epoch % 5 === 0) {
                logger.info(`Epoch ${epoch + 1} - Loss: ${logs.loss.toFixed(4)}, Val_Loss: ${logs.val_loss.toFixed(4)}`);
            }
        }
    });

    await model.fit(trainFeatures, trainLabels, {
        epochs: 60,
        batchSize: 32,
        validationData: [validationFeatures, validationLabels],
        callbacks: [earlyStopping, loggerCallback]
    });

    // 6. Évaluation
    logger.header('ÉVALUATION');
    const predictions = model.predict(testFeatures);
    const predData = await predictions.data();
    const labelData = await testLabels.data();
    const testCourses = new Map();
    testData.forEach((sample, index) => {
        const runners = testCourses.get(sample.courseId) || [];
        const mlScore = mlProbabilityToPoints(predData[index], trainPrior);
        runners.push({
            score: predData[index],
            mlScore,
            deployedScore: mlScore === null || !Number.isFinite(sample.heuristicScore)
                ? null
                : combineHybridScores(mlScore, sample.heuristicScore, CONFIG.architect.hybride),
            heuristicScore: sample.heuristicScore,
            label: labelData[index],
            predictionRank: sample.predictionRank,
            marketRank: sample.marketRank
        });
        testCourses.set(sample.courseId, runners);
    });
    let topPickHits = 0;
    let archivedForecastHits = 0;
    let archivedForecastCourses = 0;
    let marketFavoriteHits = 0;
    let marketFavoriteCourses = 0;
    let matchedArchivedForecastHits = 0;
    let matchedMarketFavoriteHits = 0;
    let matchedMlHits = 0;
    let matchedCandidateHits = 0;
    let matchedMarketCourses = 0;
    for (const runners of testCourses.values()) {
        const topPick = runners.reduce((best, runner) => runner.score > best.score ? runner : best);
        if (topPick.label === 1) topPickHits++;

        // Si un cheval a été déclaré non-partant après la capture, les rangs
        // archivés peuvent commencer à 2. Le meilleur partant restant devient
        // alors le choix de référence.
        const forecastPick = runners.filter(runner => Number.isInteger(runner.predictionRank) && runner.predictionRank > 0)
            .reduce((best, runner) => !best || runner.predictionRank < best.predictionRank ? runner : best, null);
        const marketPick = runners.filter(runner => Number.isInteger(runner.marketRank) && runner.marketRank > 0)
            .reduce((best, runner) => !best || runner.marketRank < best.marketRank ? runner : best, null);
        if (forecastPick) {
            archivedForecastCourses++;
            if (forecastPick.label === 1) archivedForecastHits++;
        }
        if (marketPick) {
            marketFavoriteCourses++;
            if (marketPick.label === 1) marketFavoriteHits++;
        }
        const candidatePick = runners.filter(runner => Number.isFinite(runner.deployedScore))
            .reduce((best, runner) => !best || runner.deployedScore > best.deployedScore ? runner : best, null);
        const completeHeuristicCoverage = runners.every(runner => Number.isFinite(runner.heuristicScore));
        if (forecastPick && marketPick && candidatePick && completeHeuristicCoverage) {
            matchedMarketCourses++;
            if (topPick.label === 1) matchedMlHits++;
            if (candidatePick.label === 1) matchedCandidateHits++;
            if (forecastPick.label === 1) matchedArchivedForecastHits++;
            if (marketPick.label === 1) matchedMarketFavoriteHits++;
        }
    }
    const testMlTop1HitRate = testCourses.size ? topPickHits / testCourses.size : 0;
    const testForecastTop1HitRate = archivedForecastCourses ? archivedForecastHits / archivedForecastCourses : null;
    const testMarketTop1HitRate = marketFavoriteCourses ? marketFavoriteHits / marketFavoriteCourses : null;
    const testMatchedMlTop1HitRate = matchedMarketCourses ? matchedMlHits / matchedMarketCourses : null;
    const testMatchedCandidateTop1HitRate = matchedMarketCourses ? matchedCandidateHits / matchedMarketCourses : null;
    const testMatchedForecastTop1HitRate = matchedMarketCourses ? matchedArchivedForecastHits / matchedMarketCourses : null;
    const testMatchedMarketTop1HitRate = matchedMarketCourses ? matchedMarketFavoriteHits / matchedMarketCourses : null;
    logger.info(`Courses dans le test temporel : ${testCourses.size}`);
    logger.success(`Top 1 ML seul (recalculé sur les snapshots test) : ${(testMlTop1HitRate * 100).toFixed(2)}% (${testCourses.size} courses)`);
    logger.info(`Top 1 du pronostic hybride archivé : ${testForecastTop1HitRate === null ? 'indisponible' : `${(testForecastTop1HitRate * 100).toFixed(2)}% (${archivedForecastCourses} courses)`}`);
    logger.info(`Favori marché archivé : ${testMarketTop1HitRate === null ? 'indisponible' : `${(testMarketTop1HitRate * 100).toFixed(2)}% (${marketFavoriteCourses} courses)`}`);
    logger.info(`Comparaison sur ${matchedMarketCourses} courses comparables : candidat hybride déployable ${testMatchedCandidateTop1HitRate === null ? 'indisponible' : `${(testMatchedCandidateTop1HitRate * 100).toFixed(2)}%`}, ML seul ${testMatchedMlTop1HitRate === null ? 'indisponible' : `${(testMatchedMlTop1HitRate * 100).toFixed(2)}%`}, pronostic archivé ${testMatchedForecastTop1HitRate === null ? 'indisponible' : `${(testMatchedForecastTop1HitRate * 100).toFixed(2)}%`}, favori marché ${testMatchedMarketTop1HitRate === null ? 'indisponible' : `${(testMatchedMarketTop1HitRate * 100).toFixed(2)}%`}`);

    predictions.dispose();

    // Ne jamais remplacer le modèle utilisé par l'application avec un candidat
    // qui n'a pas de test commun suffisant ou qui perd face aux deux références.
    const promotion = evaluateModelPromotion({
        matchedCourses: matchedMarketCourses,
        mlHitRate: testMatchedCandidateTop1HitRate,
        heuristicHitRate: testMatchedForecastTop1HitRate,
        marketHitRate: testMatchedMarketTop1HitRate
    });
    if (!promotion.promote) throw new Error(`Modèle non promu : ${promotion.reason}`);

    // 7. Préparer entièrement la nouvelle génération avant de toucher au modèle actif.
    const modelPath = path.resolve(MODEL_PATH);
    const stagingPath = path.resolve(MODEL_STAGING_PATH);
    const backupPath = path.resolve(MODEL_BACKUP_PATH);
    if (!fs.existsSync(modelPath) && fs.existsSync(backupPath)) {
        fs.renameSync(backupPath, modelPath);
        logger.warn('Modèle précédent restauré après un remplacement interrompu.');
    }
    fs.rmSync(stagingPath, { recursive: true, force: true });
    await model.save(pathToFileURL(stagingPath).href);

    // 8. Métadonnées
    const trainedAt = new Date().toISOString();
    const metadata = {
        // Calibration et snapshots doivent distinguer chaque jeu de poids,
        // même lorsqu'ils appartiennent à la même famille d'architecture.
        version: `Architect-v51-Prospective-Snapshots-${trainedAt}`,
        trainedAt,
        trainingMethod: ML_TRAINING_METHOD,
        featureSchemaVersion: ML_FEATURE_SCHEMA_VERSION,
        trainSamples: trainData.length,
        testSamples: testData.length,
        courseCounts,
        // La métrique historique reste disponible comme alias du ML seul.
        testTop1HitRate: testMlTop1HitRate,
        testMlTop1HitRate,
        testForecastTop1HitRate,
        testForecastCourseCount: archivedForecastCourses,
        testMarketTop1HitRate,
        testMarketCourseCount: marketFavoriteCourses,
        testMatchedMlTop1HitRate,
        testMatchedCandidateTop1HitRate,
        testMatchedForecastTop1HitRate,
        testMatchedMarketTop1HitRate,
        testMatchedCourseCount: matchedMarketCourses,
        testCourseCount: testCourses.size,
        rawTrainWinnerRate: trainPrior,
        architecture: {
            layers: 4,
            neurons: [128, 64, 32, 1],
            dropout: [0.2, 0.1, 0, 0]
        }
    };

    fs.writeFileSync(
        path.join(stagingPath, 'metadata.json'),
        JSON.stringify(metadata, null, 2)
    );

    // Remplacement par renommage de répertoire. Si le second renommage échoue,
    // restaurer immédiatement le modèle actif précédent.
    fs.rmSync(backupPath, { recursive: true, force: true });
    const hadActiveModel = fs.existsSync(modelPath);
    if (hadActiveModel) fs.renameSync(modelPath, backupPath);
    try {
        fs.renameSync(stagingPath, modelPath);
    } catch (error) {
        if (hadActiveModel && fs.existsSync(backupPath) && !fs.existsSync(modelPath)) {
            fs.renameSync(backupPath, modelPath);
        }
        throw error;
    }
    fs.rmSync(backupPath, { recursive: true, force: true });
    logger.success(`Nouvelle génération du modèle déployée dans ${MODEL_PATH}`);
    logger.success('Métadonnées sauvegardées');

        return metadata;
    } finally {
        for (const tensor of tensors) tensor.dispose();
        model?.optimizer?.dispose?.();
        model?.dispose();
        if (closeDbAtEnd) await closeDB();
    }
}

// Exécution
if (isMainModule(import.meta.url)) {
    trainModel({ closeDbAtEnd: true }).then((meta) => {
        console.log('\n=== ENTRAÎNEMENT TERMINÉ ===');
        console.log(JSON.stringify(meta, null, 2));
        process.exit(0);
    }).catch(err => {
        console.error('Erreur entraînement:', err);
        process.exit(1);
    });
}

export { trainModel };
