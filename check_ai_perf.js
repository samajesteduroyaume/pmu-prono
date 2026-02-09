import sqlite3 from 'sqlite3';
import path from 'path';

const dbPath = path.resolve('./data/pmu.db');
const db = new sqlite3.Database(dbPath);

const query = `
    WITH TopProne AS (
        SELECT 
            p.course_id, 
            p.numero, 
            p.nom,
            p.cote_ref, 
            p.classement,
            p.prediction_score
        FROM participants p
        JOIN courses c ON p.course_id = c.id
        WHERE p.prediction_score > 0 
          AND c.ordre_arrivee IS NOT NULL 
          AND c.ordre_arrivee != ''
    ),
    RankedParticipants AS (
        SELECT *,
        ROW_NUMBER() OVER(PARTITION BY course_id ORDER BY prediction_score DESC) as rank_ia
        FROM TopProne
    ),
    BestBets AS (
        SELECT * FROM RankedParticipants WHERE rank_ia = 1
    )
    SELECT 
        COUNT(*) as total_bets,
        SUM(CASE WHEN CAST(classement AS INTEGER) = 1 THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN CAST(classement AS INTEGER) = 1 THEN CAST(cote_ref AS FLOAT) ELSE 0 END) as total_return
    FROM BestBets;
`;

db.get(query, (err, row) => {
    if (err) {
        console.error(err);
    } else {
        const total = row.total_bets;
        const wins = row.wins;
        const returns = row.total_return;
        const profit = returns - total;
        const roi = (profit / total) * 100;
        const winRate = (wins / total) * 100;

        console.log("AI Performance Report (Rank 1):");
        console.log(`Total Bets: ${total}`);
        console.log(`Wins: ${wins}`);
        console.log(`Win Rate: ${winRate.toFixed(2)}%`);
        console.log(`Total Returns: ${returns.toFixed(2)}`);
        console.log(`Net Profit: ${profit.toFixed(2)}`);
        console.log(`ROI: ${roi.toFixed(2)}%`);
    }
    db.close();
});
