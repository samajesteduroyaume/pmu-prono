import sqlite3 from 'sqlite3';
import path from 'path';

const dbPath = path.resolve('./data/pmu.db');
const db = new sqlite3.Database(dbPath);

const query = `
    WITH RankedParticipants AS (
        SELECT 
            p.course_id, 
            p.numero, 
            p.classement,
            p.cote_ref,
            c.discipline,
            p.prediction_score,
            ROW_NUMBER() OVER(PARTITION BY p.course_id ORDER BY p.prediction_score DESC) as rank_ia
        FROM participants p
        JOIN courses c ON p.course_id = c.id
        WHERE p.prediction_score > 0 
          AND c.ordre_arrivee IS NOT NULL 
          AND c.ordre_arrivee != ''
          AND c.date >= date('now', '-30 days')
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
`;

db.all(query, (err, rows) => {
    if (err) {
        console.error(err);
    } else {
        console.log("=== RECENT PERFORMANCE (LAST 30 DAYS) ===");
        rows.forEach(r => {
            const roi = ((r.returns - r.total) / r.total * 100).toFixed(2);
            const wr = (r.wins / r.total * 100).toFixed(2);
            console.log(`${r.discipline.padEnd(20)} | Total: ${r.total.toString().padEnd(5)} | WR: ${wr}% | ROI: ${roi}%`);
        });
    }
    db.close();
});
