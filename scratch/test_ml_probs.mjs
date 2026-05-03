import sqlite3 from 'sqlite3';
import { initDB, closeDB } from '../src/core/db.mjs';
import { loadMLModel } from '../src/core/hybrid.mjs';
import { extractMLFeatures } from '../src/core/hybrid.mjs';
import * as tf from '@tensorflow/tfjs-node';
import path from 'path';

async function main() {
    await initDB();
    const model = await tf.loadLayersModel(`file://${path.resolve('./src/ml/model/model.json')}`);
    const db = new sqlite3.Database('./data/pmu.db');

    db.all("SELECT id, discipline, prix FROM courses WHERE ordre_arrivee IS NOT NULL LIMIT 20", async (err, courses) => {
        let allProbs = [];
        for (const c of courses) {
            const participants = await new Promise((res, rej) => {
                db.all("SELECT * FROM participants WHERE course_id = ?", [c.id], (err, rows) => { res(rows); });
            });
            if (participants.length === 0) continue;
            
            const context = { discipline: c.discipline, prixCourse: c.prix };
            for (const p of participants) {
                const features = extractMLFeatures(p, context, participants);
                const safeVector = features.map(v => v === undefined || isNaN(v) ? 0.5 : v);
                const tensor = tf.tensor2d([safeVector]);
                const prediction = model.predict(tensor);
                const probability = await prediction.data();
                allProbs.push(probability[0]);
                tensor.dispose();
                prediction.dispose();
            }
        }
        allProbs.sort((a,b) => b-a);
        console.log("Top 10 ML Probabilities:", allProbs.slice(0, 10));
        console.log("Bottom 10 ML Probabilities:", allProbs.slice(-10));
        console.log("Average ML Probability:", allProbs.reduce((a,b)=>a+b,0)/allProbs.length);
        
        db.close();
        await closeDB();
    });
}
main();
