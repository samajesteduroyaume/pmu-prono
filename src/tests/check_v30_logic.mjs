import assert from 'node:assert/strict';
import { calculerPrediction } from '../core/intelligence.mjs';
import { closeDB, initDB } from '../core/db.mjs';

await initDB();

const testCases = [
    {
        name: "Favori public (Cote < 3) - Devrait être neutralisé",
        participant: {
            nom: "FAVORI_PUBLIC",
            cote_ref: 1.8,
            musique: "4a5a7a",
            age: 5,
            gains: 20000,
            nb_courses: 20,
            driver: "DUMMY",
            entraineur: "DUMMY"
        },
        contexte: { discipline: "ATTELE", prixCourse: 20000 }
    },
    {
        name: "Pépite technique (Cote 4.5) - Devrait être valorisée",
        participant: {
            nom: "VALUE_GEM",
            cote_ref: 4.5,
            musique: "1a2a1a",
            age: 5,
            gains: 150000,
            nb_courses: 15,
            driver: "BAZIRE",
            entraineur: "BAZIRE",
            ferrage: "D4"
        },
        contexte: { discipline: "ATTELE", prixCourse: 25000 }
    },
    {
        name: "Censure V30: Montée de catégorie + Driver faible",
        participant: {
            nom: "RISKY_MONTEE",
            cote_ref: 8.0,
            musique: "1a1a1a",
            age: 4,
            gains: 10000,
            nb_courses: 5,
            driver: "AMATEUR",
            entraineur: "AMATEUR"
        },
        contexte: { discipline: "ATTELE", prixCourse: 300000 }
    }
];

console.log("=== V32 PREDICTION LOGIC CHECK ===");

for (const tc of testCases) {
    console.log(`\nTEST: ${tc.name}`);
    const score = await calculerPrediction(tc.participant, tc.contexte);
    console.log(`SCORE FINAL: ${score} pts`);

    if (tc.name.includes("Favori")) {
        assert.ok(score <= 80, 'Le favori sans forme ne doit pas recevoir un score excessif.');
    }
    if (tc.name.includes("Technique")) {
        assert.ok(score > 70, 'La pépite technique doit être valorisée.');
    }
    if (tc.name.includes("Censure")) {
        assert.ok(score < 75, 'La censure de montée de catégorie doit être appliquée.');
        console.log("SUCCESS: Censure appliquée (Score < 75)");
    }
}

await closeDB();
