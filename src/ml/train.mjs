import util from 'util';
if (!util.isNullOrUndefined) {
    util.isNullOrUndefined = (arg) => arg === null || arg === undefined;
}

import * as tf from '@tensorflow/tfjs-node';
import { prepareDataset } from './dataset.mjs';
import { evaluateModelPromotion, MIN_PROMOTION_TEST_COURSES } from './promotion_gate.mjs';
import { closeDB } from '../core/db.mjs';
import logger from '../utils/logger.mjs';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { isMainModule } from '../utils/isMainModule.mjs';
import { MODEL_PATH } from './model_paths.mjs';

const MODEL_STAGING_PATH = `${MODEL_PATH}.staging`;
const MODEL_BACKUP_PATH = `${MODEL_PATH}.previous`;

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
        runners.push({
            score: predData[index],
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
    let matchedMarketCourses = 0;
    for (const runners of testCourses.values()) {
        const topPick = runners.reduce((best, runner) => runner.score > best.score ? runner : best);
        if (topPick.label === 1) topPickHits++;

        const forecastPick = runners.find(runner => runner.predictionRank === 1);
        const marketPick = runners.find(runner => runner.marketRank === 1);
        if (forecastPick) {
            archivedForecastCourses++;
            if (forecastPick.label === 1) archivedForecastHits++;
        }
        if (marketPick) {
            marketFavoriteCourses++;
            if (marketPick.label === 1) marketFavoriteHits++;
        }
        if (forecastPick && marketPick) {
            matchedMarketCourses++;
            if (topPick.label === 1) matchedMlHits++;
            if (forecastPick.label === 1) matchedArchivedForecastHits++;
            if (marketPick.label === 1) matchedMarketFavoriteHits++;
        }
    }
    const testMlTop1HitRate = testCourses.size ? topPickHits / testCourses.size : 0;
    const testForecastTop1HitRate = archivedForecastCourses ? archivedForecastHits / archivedForecastCourses : null;
    const testMarketTop1HitRate = marketFavoriteCourses ? marketFavoriteHits / marketFavoriteCourses : null;
    const testMatchedMlTop1HitRate = matchedMarketCourses ? matchedMlHits / matchedMarketCourses : null;
    const testMatchedForecastTop1HitRate = matchedMarketCourses ? matchedArchivedForecastHits / matchedMarketCourses : null;
    const testMatchedMarketTop1HitRate = matchedMarketCourses ? matchedMarketFavoriteHits / matchedMarketCourses : null;
    logger.info(`Courses dans le test temporel : ${testCourses.size}`);
    logger.success(`Top 1 ML seul (recalculé sur les snapshots test) : ${(testMlTop1HitRate * 100).toFixed(2)}% (${testCourses.size} courses)`);
    logger.info(`Top 1 du pronostic hybride archivé : ${testForecastTop1HitRate === null ? 'indisponible' : `${(testForecastTop1HitRate * 100).toFixed(2)}% (${archivedForecastCourses} courses)`}`);
    logger.info(`Favori marché archivé : ${testMarketTop1HitRate === null ? 'indisponible' : `${(testMarketTop1HitRate * 100).toFixed(2)}% (${marketFavoriteCourses} courses)`}`);
    logger.info(`Comparaison sur les mêmes courses : ML ${testMatchedMlTop1HitRate === null ? 'indisponible' : `${(testMatchedMlTop1HitRate * 100).toFixed(2)}%`}, heuristique archivée ${testMatchedForecastTop1HitRate === null ? 'indisponible' : `${(testMatchedForecastTop1HitRate * 100).toFixed(2)}%`}, favori marché ${testMatchedMarketTop1HitRate === null ? 'indisponible' : `${(testMatchedMarketTop1HitRate * 100).toFixed(2)}%`} (${matchedMarketCourses} courses)`);

    predictions.dispose();

    // Ne jamais remplacer le modèle utilisé par l'application avec un candidat
    // qui n'a pas de test commun suffisant ou qui perd face aux deux références.
    const promotion = evaluateModelPromotion({
        matchedCourses: matchedMarketCourses,
        mlHitRate: testMatchedMlTop1HitRate,
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
        version: `Architect-v50-Prospective-Snapshots-${trainedAt}`,
        trainedAt,
        trainingMethod: 'immutable-pre-race-feature-snapshots',
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
