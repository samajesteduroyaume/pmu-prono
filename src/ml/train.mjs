import * as tf from '@tensorflow/tfjs-node';
import { prepareDataset } from './dataset.mjs';
import { closeDB } from '../core/db.mjs';
import logger from '../utils/logger.mjs';
import fs from 'fs';
import path from 'path';

const MODEL_PATH = './src/ml/model';

async function trainModel() {
    logger.header('ENTRAÎNEMENT IA v15 (ML)');

    // 1. Préparation du dataset
    const { trainData, testData } = await prepareDataset();

    // 2. Conversion en tenseurs
    const trainFeatures = tf.tensor2d(trainData.map(d => d.features));
    const trainLabels = tf.tensor2d(trainData.map(d => [d.label]));
    const testFeatures = tf.tensor2d(testData.map(d => d.features));
    const testLabels = tf.tensor2d(testData.map(d => [d.label]));

    logger.info('Tenseurs créés');

    // 3. Architecture du modèle
    const model = tf.sequential({
        layers: [
            tf.layers.dense({
                units: 64,
                activation: 'relu',
                inputShape: [7],
                kernelInitializer: 'heNormal'
            }),
            tf.layers.dropout({ rate: 0.2 }),
            tf.layers.dense({
                units: 32,
                activation: 'relu',
                kernelInitializer: 'heNormal'
            }),
            tf.layers.dropout({ rate: 0.1 }),
            tf.layers.dense({
                units: 16,
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
        metrics: ['accuracy']
    });

    logger.info('Modèle compilé');
    model.summary();

    // 5. Entraînement
    logger.info('Début de l\'entraînement (50 epochs)...');

    const history = await model.fit(trainFeatures, trainLabels, {
        epochs: 50,
        batchSize: 32,
        validationSplit: 0.2,
        callbacks: {
            onEpochEnd: (epoch, logs) => {
                if (epoch % 10 === 0) {
                    logger.info(`Epoch ${epoch + 1}/50 - Loss: ${logs.loss.toFixed(4)}, Acc: ${(logs.acc * 100).toFixed(2)}%`);
                }
            }
        }
    });

    // 6. Évaluation
    logger.header('ÉVALUATION');
    const evaluation = model.evaluate(testFeatures, testLabels);
    const testLoss = await evaluation[0].data();
    const testAcc = await evaluation[1].data();

    logger.success(`Test Loss: ${testLoss[0].toFixed(4)}`);
    logger.success(`Test Accuracy: ${(testAcc[0] * 100).toFixed(2)}%`);

    // 7. Sauvegarde
    if (!fs.existsSync(MODEL_PATH)) {
        fs.mkdirSync(MODEL_PATH, { recursive: true });
    }

    await model.save(`file://${path.resolve(MODEL_PATH)}`);
    logger.success(`Modèle sauvegardé dans ${MODEL_PATH}`);

    // 8. Métadonnées
    const metadata = {
        version: 'v15-ML',
        trainedAt: new Date().toISOString(),
        trainSamples: trainData.length,
        testSamples: testData.length,
        testAccuracy: testAcc[0],
        testLoss: testLoss[0],
        architecture: {
            layers: 4,
            neurons: [64, 32, 16, 1],
            dropout: [0.2, 0.1, 0, 0]
        }
    };

    fs.writeFileSync(
        path.join(MODEL_PATH, 'metadata.json'),
        JSON.stringify(metadata, null, 2)
    );

    logger.success('Métadonnées sauvegardées');

    // Cleanup
    trainFeatures.dispose();
    trainLabels.dispose();
    testFeatures.dispose();
    testLabels.dispose();

    await closeDB();
    return metadata;
}

// Exécution
if (import.meta.url === `file://${process.argv[1]}`) {
    trainModel().then((meta) => {
        console.log('\n=== ENTRAÎNEMENT TERMINÉ ===');
        console.log(JSON.stringify(meta, null, 2));
        process.exit(0);
    }).catch(err => {
        console.error('Erreur entraînement:', err);
        process.exit(1);
    });
}

export { trainModel };
