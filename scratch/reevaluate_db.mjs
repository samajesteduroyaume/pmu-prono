import sqlite3 from 'sqlite3';
import { initDB, closeDB } from '../src/core/db.mjs';
import { calculerPredictionHybride, loadMLModel } from '../src/core/hybrid.mjs';
import { extractMLFeatures } from '../src/core/hybrid.mjs';
import logger from '../src/utils/logger.mjs';

async function main() {
    await initDB();
    await loadMLModel();
    const db = new sqlite3.Database('./data/pmu.db');

    db.all("SELECT id, discipline, prix FROM courses WHERE ordre_arrivee IS NOT NULL AND ordre_arrivee != ''", async (err, courses) => {
        if (err) throw err;
        
        console.log(`Re-evaluating ${courses.length} courses...`);
        let updated = 0;
        
        for (const c of courses) {
            const participants = await new Promise((res, rej) => {
                db.all("SELECT * FROM participants WHERE course_id = ?", [c.id], (err, rows) => {
                    if (err) rej(err); else res(rows);
                });
            });

            if (participants.length === 0) continue;

            const context = { discipline: c.discipline, prixCourse: c.prix };
            
            for (const p of participants) {
                const result = await calculerPredictionHybride(p, context, []);
                
                await new Promise((res, rej) => {
                    db.run("UPDATE participants SET prediction_score = ? WHERE id = ?", [result.score, p.id], (err) => {
                        if (err) rej(err); else res();
                    });
                });
            }
            updated++;
            if (updated % 50 === 0) console.log(`${updated}/${courses.length} courses processed`);
        }
        
        console.log("Re-evaluation complete.");
        db.close();
        await closeDB();
    });
}
main();
