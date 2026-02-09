import sqlite3 from 'sqlite3';
import path from 'path';

const dbPath = path.resolve('./data/pmu.db');
const db = new sqlite3.Database(dbPath);

const query = `
    SELECT 
        COUNT(*) as total_winners,
        SUM(CASE WHEN cote_ref IS NULL OR cote_ref = '' THEN 1 ELSE 0 END) as missing_odds,
        AVG(CASE WHEN cote_ref > 0 THEN cote_ref ELSE NULL END) as avg_odds,
        MIN(CASE WHEN cote_ref > 0 THEN cote_ref ELSE NULL END) as min_odds,
        MAX(CASE WHEN cote_ref > 0 THEN cote_ref ELSE NULL END) as max_odds
    FROM participants 
    WHERE classement = '1'
`;

db.get(query, (err, row) => {
    if (err) {
        console.error(err);
    } else {
        console.log("Data Quality Report (Winners):");
        console.log(row);
    }
    db.close();
});
