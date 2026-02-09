import { calculerPrediction } from '../core/intelligence.mjs';

async function testEngines() {
    console.log("=== V32 ENGINES LOGIC TEST ===");

    const participant = {
        nom: "TEST_HORSE",
        cote_ref: 5.0,
        musique: "1a2a3m",
        age: 5,
        gains: 50000,
        nb_courses: 20,
        driver: "RAFFIN",
        entraineur: "BAZIRE",
        ferrage: "D4"
    };

    const disciplines = [
        { name: "ATTELE", expectedEngine: "PRO-ATTELÉ V32" },
        { name: "MONTE", expectedEngine: "PRO-MONTÉ V32" },
        { name: "PLAT", expectedEngine: "PRO-GALOP V32" },
        { name: "HAIE", expectedEngine: "PRO-OBSTACLE V32" }
    ];

    for (const d of disciplines) {
        console.log(`\nTESTING DISCIPLINE: ${d.name}`);
        const p = { ...participant };
        const score = await calculerPrediction(p, { discipline: d.name, prixCourse: 50000 });
        console.log(`ENGINE USED: ${p.active_engine}`);
        console.log(`SCORE: ${score} pts`);

        if (p.active_engine !== d.expectedEngine) {
            console.error(`FAIL: Expected ${d.expectedEngine}, got ${p.active_engine}`);
        } else {
            console.log("SUCCESS: Correct engine matched.");
        }
    }
}

testEngines().catch(console.error);
