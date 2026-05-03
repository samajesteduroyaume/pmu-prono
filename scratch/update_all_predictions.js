import sqlite3 from 'sqlite3';
import path from 'path';
import { calculerPrediction } from '../src/core/intelligence.mjs';
import { initDB } from '../src/core/db.mjs';

const dbPath = path.resolve('./data/pmu.db');
const db = new sqlite3.Database(dbPath);

async function updatePredictions() {
    await initDB();
    
    console.log("Recalculating all predictions with Architect v43.1...");

    const courses = await new Promise((resolve, reject) => {
        db.all("SELECT * FROM courses", (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });

    for (const course of courses) {
        const participants = await new Promise((resolve, reject) => {
            db.all("SELECT * FROM participants WHERE course_id = ?", [course.id], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        const predictions = [];
        for (const p of participants) {
            const score = await calculerPrediction(p, course);
            predictions.push({ id: p.id, score });
        }

        // Sort by score to get rank
        predictions.sort((a, b) => b.score - a.score);

        for (let i = 0; i < predictions.length; i++) {
            const p = predictions[i];
            await new Promise((resolve, reject) => {
                db.run(
                    "UPDATE participants SET prediction_score = ? WHERE id = ?",
                    [p.score, p.id],
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
        }
        process.stdout.write(".");
    }
    console.log("\nUpdate complete!");
    db.close();
}

updatePredictions().catch(console.error);
