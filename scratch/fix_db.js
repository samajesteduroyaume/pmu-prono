import sqlite3 from 'sqlite3';
const db = new sqlite3.Database('data/pmu.db');

db.all("SELECT id, ordre_arrivee FROM courses WHERE ordre_arrivee IS NOT NULL AND ordre_arrivee LIKE '%,%'", (err, rows) => {
    if (err) throw err;
    console.log(`Found ${rows.length} rows to fix.`);
    
    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        const stmt = db.prepare("UPDATE courses SET ordre_arrivee = ? WHERE id = ?");
        for (const row of rows) {
            // "4,13,14,..." -> "4-13-14-5-2"
            const fixed = row.ordre_arrivee.split(',').slice(0, 5).join('-');
            stmt.run(fixed, row.id);
        }
        stmt.finalize();
        db.run("COMMIT", () => {
            console.log("Database updated.");
        });
    });
});
