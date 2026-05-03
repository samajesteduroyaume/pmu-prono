import { processRaces } from '../src/core/processor.mjs';
import { getDB, initDB } from '../src/db/db.mjs';

async function main() {
    await initDB();
    const db = getDB();
    
    // Pick a course that is already in DB
    const course = await new Promise(res => db.get("SELECT * FROM courses WHERE ordre_arrivee IS NOT NULL LIMIT 1", (err, row) => res(row)));
    
    if (!course) {
        console.log("No courses with results found in DB to test.");
        return;
    }
    
    console.log(`Testing with course: ${course.date} R${course.reunionNum}C${course.courseNum}`);
    
    // Pick participants for this course
    const participants = await new Promise(res => db.all("SELECT * FROM participants WHERE course_id = ?", [course.id], (err, rows) => res(rows)));
    
    // Simulate API response format
    const mockRace = {
        ...course,
        participants: participants.map(p => ({
            nom: p.nom,
            numPmu: p.numero,
            musique: p.musique,
            deferre: p.ferrage
        }))
    };
    
    const processed = await processRaces([mockRace]);
    const firstP = processed[0].participants[0];
    
    console.log("--- PROCESSED PARTICIPANT ---");
    console.log(`Nom: ${firstP.nom}`);
    console.log(`Distances History: ${firstP.distances_history}`);
    console.log(`Terrain Préféré: ${firstP.terrain_prefere}`);
}
main();
