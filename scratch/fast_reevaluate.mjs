import sqlite3 from 'sqlite3';
import { initDB, closeDB } from '../src/core/db.mjs';
import { calculerPredictionHybride, loadMLModel } from '../src/core/hybrid.mjs';

async function main() {
    await initDB();
    await loadMLModel();
    const db = new sqlite3.Database('./data/pmu.db');

    console.log("Fetching all courses...");
    const courses = await new Promise((res, rej) => {
        db.all("SELECT id, discipline, prix FROM courses", (err, rows) => {
            if (err) rej(err); else res(rows);
        });
    });

    console.log("Fetching all participants...");
    const participants = await new Promise((res, rej) => {
        db.all("SELECT * FROM participants", (err, rows) => {
            if (err) rej(err); else res(rows);
        });
    });

    const coursesMap = new Map();
    for (const c of courses) {
        coursesMap.set(c.id, { ...c, participants: [] });
    }
    for (const p of participants) {
        if (coursesMap.has(p.course_id)) {
            coursesMap.get(p.course_id).participants.push(p);
        }
    }

    console.log("Re-evaluating scores...");
    const updates = [];
    let processed = 0;
    for (const c of coursesMap.values()) {
        const context = { discipline: c.discipline, prixCourse: c.prix };
        for (const p of c.participants) {
            const result = await calculerPredictionHybride(p, context, []);
            updates.push({ id: p.id, score: result.score });
        }
        processed++;
        if (processed % 500 === 0) console.log(`${processed} courses evaluated...`);
    }

    console.log(`Writing ${updates.length} updates to database...`);
    
    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        const stmt = db.prepare("UPDATE participants SET prediction_score = ? WHERE id = ?");
        for (const u of updates) {
            stmt.run(u.score, u.id);
        }
        stmt.finalize();
        db.run("COMMIT", async (err) => {
            if (err) console.error("Error on commit:", err);
            else console.log("Database update completed successfully.");
            db.close();
            await closeDB();
        });
    });
}

main().catch(console.error);
