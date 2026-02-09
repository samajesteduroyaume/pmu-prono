import sqlite3 from 'sqlite3';
import path from 'path';

const dbPath = path.resolve('./data/pmu.db');
const db = new sqlite3.Database(dbPath);

const queries = {
    byDiscipline: `
        WITH RankedParticipants AS (
            SELECT 
                p.course_id, 
                p.numero, 
                p.classement,
                p.cote_ref,
                c.discipline,
                ROW_NUMBER() OVER(PARTITION BY p.course_id ORDER BY p.prediction_score DESC) as rank_ia
            FROM participants p
            JOIN courses c ON p.course_id = c.id
            WHERE p.prediction_score > 0 
              AND c.ordre_arrivee IS NOT NULL 
              AND c.ordre_arrivee != ''
        )
        SELECT 
            discipline,
            COUNT(*) as total,
            SUM(CASE WHEN CAST(classement AS INTEGER) = 1 THEN 1 ELSE 0 END) as wins,
            SUM(CASE WHEN CAST(classement AS INTEGER) = 1 THEN CAST(cote_ref AS FLOAT) ELSE 0 END) as returns
        FROM RankedParticipants 
        WHERE rank_ia = 1
        GROUP BY discipline
        ORDER BY total DESC;
    `,
    byScoreRange: `
        WITH RankedParticipants AS (
            SELECT 
                p.course_id, 
                p.numero, 
                p.classement,
                p.cote_ref,
                p.prediction_score,
                ROW_NUMBER() OVER(PARTITION BY p.course_id ORDER BY p.prediction_score DESC) as rank_ia
            FROM participants p
            JOIN courses c ON p.course_id = c.id
            WHERE p.prediction_score > 0 
              AND c.ordre_arrivee IS NOT NULL 
              AND c.ordre_arrivee != ''
        )
        SELECT 
            CASE 
                WHEN prediction_score >= 80 THEN '80-100'
                WHEN prediction_score >= 70 THEN '70-79'
                WHEN prediction_score >= 60 THEN '60-69'
                WHEN prediction_score >= 50 THEN '50-59'
                ELSE '0-49'
            END as score_range,
            COUNT(*) as total,
            SUM(CASE WHEN CAST(classement AS INTEGER) = 1 THEN 1 ELSE 0 END) as wins,
            SUM(CASE WHEN CAST(classement AS INTEGER) = 1 THEN CAST(cote_ref AS FLOAT) ELSE 0 END) as returns
        FROM RankedParticipants 
        WHERE rank_ia = 1
        GROUP BY score_range
        ORDER BY score_range DESC;
    `
};

function runQuery(q) {
    return new Promise((resolve, reject) => {
        db.all(q, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

async function main() {
    console.log("=== V30 SCORING AUDIT REPORT ===");

    console.log("\n[1] PERFORMANCE BY DISCIPLINE:");
    const discResults = await runQuery(queries.byDiscipline);
    discResults.forEach(r => {
        const roi = ((r.returns - r.total) / r.total * 100).toFixed(2);
        const wr = (r.wins / r.total * 100).toFixed(2);
        console.log(`${r.discipline.padEnd(20)} | Total: ${r.total.toString().padEnd(5)} | WR: ${wr}% | ROI: ${roi}%`);
    });

    console.log("\n[2] PERFORMANCE BY SCORE RANGE:");
    const scoreResults = await runQuery(queries.byScoreRange);
    scoreResults.forEach(r => {
        const roi = ((r.returns - r.total) / r.total * 100).toFixed(2);
        const wr = (r.wins / r.total * 100).toFixed(2);
        console.log(`${r.score_range.padEnd(20)} | Total: ${r.total.toString().padEnd(5)} | WR: ${wr}% | ROI: ${roi}%`);
    });

    db.close();
}

main().catch(console.error);
