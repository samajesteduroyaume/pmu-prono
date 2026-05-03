import sqlite3 from 'sqlite3';
import path from 'path';

const dbPath = path.resolve('./data/pmu.db');
const db = new sqlite3.Database(dbPath);

async function restore() {
    console.log("Restoring actual rankings from ordre_arrivee...");

    const courses = await new Promise((resolve, reject) => {
        db.all("SELECT id, ordre_arrivee FROM courses WHERE ordre_arrivee IS NOT NULL AND ordre_arrivee != ''", (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });

    for (const course of courses) {
        const arrival = course.ordre_arrivee.split('-');
        
        // Reset all to NULL or a high value first for this course
        await new Promise((resolve, reject) => {
            db.run("UPDATE participants SET classement = NULL WHERE course_id = ?", [course.id], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        for (let i = 0; i < arrival.length; i++) {
            const num = parseInt(arrival[i]);
            if (isNaN(num)) continue;
            
            await new Promise((resolve, reject) => {
                db.run(
                    "UPDATE participants SET classement = ? WHERE course_id = ? AND numero = ?",
                    [i + 1, course.id, num],
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });
        }
        process.stdout.write(".");
    }
    console.log("\nRestoration complete!");
    db.close();
}

restore().catch(console.error);
