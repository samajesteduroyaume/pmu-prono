import sqlite3 from 'sqlite3';
import path from 'path';
import { calculerPredictionHybride } from '../core/hybrid.mjs';
import { initDB } from '../core/db.mjs';

async function runBacktestV34() {
    await initDB();
    const dbPath = path.resolve('./data/pmu.db');
    const db = new sqlite3.Database(dbPath);

    function runQuery(q, params = []) {
        return new Promise((resolve, reject) => {
            db.all(q, params, (err, rows) => err ? reject(err) : resolve(rows));
        });
    }

    console.log("=== V34 HYBRID SYSTEM BACKTEST ===");

    // Test sur les 100 dernières courses avec arrivées
    const courses = await runQuery(`
        SELECT id, discipline, prix, hippodrome, partants, ordre_arrivee 
        FROM courses 
        WHERE ordre_arrivee IS NOT NULL AND ordre_arrivee != ''
        ORDER BY date DESC, heure DESC LIMIT 100
    `);

    let stats = {
        total: 0,
        rank1Win: 0,
        rank1to3Win: 0,
        shieldedCount: 0,
        totalWinnersFound: 0
    };

    for (const course of courses) {
        const participants = await runQuery(`SELECT * FROM participants WHERE course_id = ?`, [course.id]);
        if (participants.length === 0) continue;

        const winners = course.ordre_arrivee.split('-').map(n => parseInt(n.trim()));
        const realWinner = winners[0];

        const scored = [];
        for (const p of participants) {
            const result = await calculerPredictionHybride(p, {
                discipline: course.discipline,
                prixCourse: course.prix,
                hippodrome: course.hippodrome,
                nbPartants: course.partants
            });

            scored.push({
                ...p,
                ai_score: result.score,
                is_shielded: result.xai?.isShielded || false
            });
            if (result.xai?.isShielded) stats.shieldedCount++;
        }

        scored.sort((a, b) => b.ai_score - a.ai_score);

        stats.total++;
        if (scored[0].numero === realWinner) stats.rank1Win++;
        if (winners.slice(0, 3).includes(scored[0].numero)) stats.rank1to3Win++;
    }

    console.log(`\nRESULTS (on ${stats.total} courses):`);
    console.log(`Rank 1 Win Rate: ${((stats.rank1Win / stats.total) * 100).toFixed(2)}%`);
    console.log(`Rank 1-3 Win Rate (Selection Top 1): ${((stats.rank1to3Win / stats.total) * 100).toFixed(2)}%`);
    console.log(`Shielded horses detected: ${stats.shieldedCount}`);

    db.close();
}

runBacktestV34().catch(console.error);
