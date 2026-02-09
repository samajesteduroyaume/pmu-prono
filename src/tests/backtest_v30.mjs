import sqlite3 from 'sqlite3';
import path from 'path';
import { calculerPrediction } from '../core/intelligence.mjs';

const dbPath = path.resolve('./data/pmu.db');
const db = new sqlite3.Database(dbPath);

function runQuery(q, params = []) {
    return new Promise((resolve, reject) => {
        db.all(q, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

async function analyze() {
    console.log("=== V30 SIMULATED BACKTEST ANALYSIS ===");

    // Get 50 recent courses with known winners
    const courses = await runQuery(`
        SELECT id, hippodrome, discipline, distance, prix, partants, ordre_arrivee 
        FROM courses 
        WHERE ordre_arrivee IS NOT NULL AND ordre_arrivee != ''
        ORDER BY date DESC LIMIT 50
    `);

    let totalRank1Wins = 0;
    let totalRank2Wins = 0;
    let totalRank3Wins = 0;
    let scoreHighFailures = 0; // Score > 80 but didn't win

    for (const course of courses) {
        const participants = await runQuery(`SELECT * FROM participants WHERE course_id = ?`, [course.id]);

        const winners = course.ordre_arrivee.split('-').map(n => parseInt(n.trim()));
        const realWinner = winners[0];

        const scored = participants.map(p => ({
            ...p,
            ai_score: calculerPrediction(p, {
                discipline: course.discipline,
                prixCourse: course.prix,
                hippodrome: course.hippodrome,
                nbPartants: course.partants
            })
        })).sort((a, b) => b.ai_score - a.ai_score);

        if (scored.length === 0) continue;

        const rank1 = scored[0];
        const rank2 = scored[1] || {};
        const rank3 = scored[2] || {};

        if (rank1.numero === realWinner) totalRank1Wins++;
        else if (rank2.numero === realWinner) totalRank2Wins++;
        else if (rank3.numero === realWinner) totalRank3Wins++;

        if (rank1.ai_score >= 80 && rank1.numero !== realWinner) {
            scoreHighFailures++;
            // console.log(`[FAIL] Score ${rank1.ai_score} for ${rank1.nom} in C${course.id} failed. Winner was #${realWinner}`);
        }
    }

    console.log(`\nSimulated Stats (50 courses):`);
    console.log(`Rank 1 Win Rate: ${(totalRank1Wins / 50 * 100).toFixed(2)}%`);
    console.log(`Rank 1-3 Win Rate: ${((totalRank1Wins + totalRank2Wins + totalRank3Wins) / 50 * 100).toFixed(2)}%`);
    console.log(`High Score Failures (>80 pts): ${scoreHighFailures}`);

    db.close();
}

analyze().catch(console.error);
