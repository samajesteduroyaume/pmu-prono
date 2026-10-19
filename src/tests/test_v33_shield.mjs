import assert from 'node:assert/strict';
import { calculerPrediction } from '../core/intelligence.mjs';
import { closeDB, initDB } from '../core/db.mjs';

async function testShield() {
    await initDB();
    console.log("=== V33 THE SHIELD - LOGIC TEST ===");

    const cases = [
        {
            name: "Favori public avec Échec Chronique (0 vic sur 5 courses)",
            participant: {
                nom: "CHRONIC_LOSER",
                cote_ref: 2.5,
                musique: "4a5a0a6a7a", // 5 courses attelé, 0 vic
                age: 6,
                gains: 50000,
                nb_courses: 30,
                driver: "DUMMY",
                entraineur: "DUMMY"
            },
            contexte: { discipline: "ATTELE", prixCourse: 20000 }
        },
        {
            name: "Fail Risk Total (Échec Chronique + Red Flags)",
            participant: {
                nom: "THE_TRAP",
                cote_ref: 3.0,
                musique: "DaDa4a5a6a", // 2 red flags + 3 échecs = 5 courses, 0 vic
                age: 5,
                gains: 100000,
                nb_courses: 20,
                driver: "RAFFIN",
                entraineur: "BAZIRE"
            },
            contexte: { discipline: "ATTELE", prixCourse: 30000 }
        }
    ];

    for (const c of cases) {
        console.log(`\nTESTING: ${c.name}`);
        const p = { ...c.participant };
        const score = await calculerPrediction(p, c.contexte);
        console.log(`SCORE FINAL: ${score} pts`);
        assert.ok(score <= 60, `Le profil à risque ${c.name} dépasse le plafond attendu (60).`);
    }
}

testShield().catch(error => {
    console.error(error);
    process.exitCode = 1;
}).finally(() => closeDB());
