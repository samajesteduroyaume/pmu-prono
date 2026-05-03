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
            p.prediction_score,
            c.discipline,
            ROW_NUMBER() OVER(PARTITION BY p.course_id ORDER BY p.prediction_score DESC) as rank_ia
        FROM participants p
        JOIN courses c ON p.course_id = c.id
        WHERE p.prediction_score > 0 
          AND c.ordre_arrivee IS NOT NULL 
          AND c.ordre_arrivee != ''
    ),
    BestBets AS (
        SELECT * FROM RankedParticipants WHERE rank_ia = 1
    )
    SELECT 
        discipline,
        COUNT(*) as total_bets,
        SUM(CASE WHEN CAST(classement AS INTEGER) = 1 THEN 1 ELSE 0 END) as wins
    FROM BestBets
    GROUP BY discipline
    ORDER BY total_bets DESC;
`;

db.all(query, (err, rows) => {
    if (err) {
        console.error(err);
    } else {
        console.log("AI Performance by Discipline (Rank 1):");
        rows.forEach(row => {
            const winRate = (row.wins / row.total_bets) * 100;
            console.log(`${row.discipline.padEnd(20)} | Bets: ${row.total_bets.toString().padStart(4)} | Wins: ${row.wins.toString().padStart(4)} | Win Rate: ${winRate.toFixed(2)}%`);
        });
    }
    db.close();
});
