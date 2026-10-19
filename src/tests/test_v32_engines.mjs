import assert from 'node:assert/strict';
import { calculerPrediction } from '../core/intelligence.mjs';
import { closeDB, initDB } from '../core/db.mjs';

async function testEngines() {
    await initDB();
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
        { name: "ATTELE", expectedEngine: "ARCHITECT-ATTELÉ v27.1" },
        { name: "MONTE", expectedEngine: "ARCHITECT-MONTÉ v27.1" },
        { name: "PLAT", expectedEngine: "ARCHITECT-GALOP v27.1" },
        { name: "HAIE", expectedEngine: "ARCHITECT-OBSTACLE v27.1 (HAIE)" }
    ];

    for (const d of disciplines) {
        console.log(`\nTESTING DISCIPLINE: ${d.name}`);
        const p = { ...participant };
        const score = await calculerPrediction(p, { discipline: d.name, prixCourse: 50000 });
        console.log(`ENGINE USED: ${p.active_engine}`);
        console.log(`SCORE: ${score} pts`);
        assert.equal(p.active_engine, d.expectedEngine, `Moteur incorrect pour ${d.name}.`);
        console.log("SUCCESS: Correct engine matched.");
    }
}

testEngines().catch(error => {
    console.error(error);
    process.exitCode = 1;
}).finally(() => closeDB());
