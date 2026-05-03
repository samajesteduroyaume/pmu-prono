import sqlite3 from 'sqlite3';
import path from 'path';

const dbPath = path.resolve('./data/pmu.db');
const db = new sqlite3.Database(dbPath);

const query = `
    WITH RankedIA AS (
        SELECT 
            p.course_id,
            p.numero,
            p.nom,
            p.prediction_score,
            p.classement as final_rank,
            p.cote_ref,
            p.musique,
            p.driver,
            p.entraineur,
            ROW_NUMBER() OVER(PARTITION BY p.course_id ORDER BY p.prediction_score DESC) as rank_ia
        FROM participants p
        JOIN courses c ON p.course_id = c.id
        WHERE p.prediction_score > 0 
          AND c.ordre_arrivee IS NOT NULL 
          AND c.ordre_arrivee != ''
    ),
    CourseWinners AS (
        SELECT 
            course_id,
            numero as winner_num,
            nom as winner_name,
            prediction_score as winner_ia_score,
            rank_ia as winner_ia_rank,
            cote_ref as winner_cote,
            musique as winner_musique
        FROM RankedIA
        WHERE CAST(final_rank AS INTEGER) = 1
    ),
    CourseTopIA AS (
        SELECT 
            course_id,
            numero as top_ia_num,
            nom as top_ia_name,
            prediction_score as top_ia_score,
            final_rank as top_ia_final_rank,
            cote_ref as top_ia_cote,
            musique as top_ia_musique
        FROM RankedIA
        WHERE rank_ia = 1
    )
    SELECT 
        c.id as course_id,
        c.date,
        c.hippodrome,
        c.discipline,
        t.top_ia_name,
        t.top_ia_score,
        t.top_ia_final_rank,
        t.top_ia_cote,
        t.top_ia_musique,
        w.winner_name,
        w.winner_ia_score,
        w.winner_ia_rank,
        w.winner_cote,
        w.winner_musique
    FROM courses c
    JOIN CourseTopIA t ON c.id = t.course_id
    JOIN CourseWinners w ON c.id = w.course_id
    WHERE t.top_ia_final_rank != '1' OR t.top_ia_final_rank IS NULL
    ORDER BY c.date DESC
    LIMIT 10;
`;

db.all(query, (err, rows) => {
    if (err) {
        console.error(err);
    } else {
        console.log("Analysis of Recent IA Failures (Top 1 IA vs Actual Winner):");
        rows.forEach(row => {
            console.log(`\nCourse ID: ${row.course_id} | Date: ${row.date} | ${row.hippodrome} (${row.discipline})`);
            console.log(`IA #1: ${row.top_ia_name} (Score: ${row.top_ia_score.toFixed(1)}, Final Rank: ${row.top_ia_final_rank}, Odds: ${row.top_ia_cote})`);
            console.log(`Winner: ${row.winner_name} (IA Rank: ${row.winner_ia_rank}, IA Score: ${row.winner_ia_score.toFixed(1)}, Odds: ${row.winner_cote})`);
            console.log(`Musique IA #1: ${row.top_ia_musique}`);
            console.log(`Musique Winner: ${row.winner_musique}`);
        });
    }
    db.close();
});
