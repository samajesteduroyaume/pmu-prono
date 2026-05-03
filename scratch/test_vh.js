import sqlite3 from 'sqlite3';
import { CONFIG } from '../src/config/settings.mjs';

const db = new sqlite3.Database('./data/pmu.db');
const VH = CONFIG.engine_settings.value_hunter;

const query = `
    SELECT 
        p.prediction_score, p.cote_ref, p.classement
    FROM participants p
    JOIN courses c ON p.course_id = c.id
    WHERE p.prediction_score >= ? 
      AND p.cote_ref >= ? 
      AND p.cote_ref <= ?
      AND c.ordre_arrivee IS NOT NULL
`;

db.all(query, [VH.min_score, VH.min_cote, VH.max_cote], (err, rows) => {
    if (err) throw err;
    let totalBets = rows.length;
    let wins = 0;
    let returns = 0;
    
    for (const r of rows) {
        if (parseInt(r.classement) === 1) {
            wins++;
            returns += parseFloat(r.cote_ref);
        }
    }
    
    console.log(`Value Hunter Settings: Min Score ${VH.min_score}, Cote ${VH.min_cote} - ${VH.max_cote}`);
    console.log(`Total Bets: ${totalBets}`);
    console.log(`Wins: ${wins}`);
    if(totalBets > 0) {
        console.log(`Win Rate: ${(wins / totalBets * 100).toFixed(2)}%`);
        console.log(`ROI: ${((returns - totalBets) / totalBets * 100).toFixed(2)}%`);
        console.log(`Net Profit: ${(returns - totalBets).toFixed(2)}`);
    }
    db.close();
});
