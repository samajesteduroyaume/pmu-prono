// src/tests/test_inconsistencies.mjs
import { calculerPrediction } from '../core/intelligence.mjs';
import { initDB } from '../core/db.mjs';
import logger from '../utils/logger.mjs';

async function runTest() {
    console.log("--- TEST DÉTECTION INCOHÉRENCES (V42) ---");
    
    try {
        await initDB();
    } catch (e) {
        console.warn("DB already initialized or error, continuing...");
    }

    const contexteCourse = {
        discipline: 'TROT ATTELE',
        prixCourse: 50000,
        hippodrome: 'VINCENNES'
    };

    // Cas 1 : D4 sans forme (Incohérence FAKE_INTENT)
    const p1 = {
        nom: "MYSTERY HORSE",
        musique: "9a8a0a(25)0a",
        ferrage: "D4",
        gains: 100000,
        age: 6,
        driver: "BAZIRE", // Top driver pour booster le score initial
        entraineur: "BAZIRE",
        cote_ref: 12
    };

    console.log("\nCas 1: D4 sans forme (BAZIRE au sulky)");
    const score1 = await calculerPrediction(p1, contexteCourse);
    console.log(`Score Final: ${score1}`);
    if (p1.is_inconsistent) {
        console.log("ALERTE DÉTECTÉE :");
        p1.inconsistency_alerts.forEach(a => console.log(`- [${a.type}] ${a.message}`));
    }

    // Cas 2 : Spécialiste hors-zone (Incohérence DISCIPLINE_VIRGIN)
    const contexteMonte = { discipline: 'TROT MONTE', prixCourse: 30000 };
    const p2 = {
        nom: "ATTELE KING",
        musique: "1a2a1a(25)3a",
        gains: 150000,
        age: 7,
        driver: "RAFFIN",
        entraineur: "GUARATO",
        cote_ref: 2.5
    };

    console.log("\nCas 2: Crack Attelé qui débute en Monté");
    const score2 = await calculerPrediction(p2, contexteMonte);
    console.log(`Score Final: ${score2}`);
    if (p2.is_inconsistent) {
        console.log("ALERTE DÉTECTÉE :");
        p2.inconsistency_alerts.forEach(a => console.log(`- [${a.type}] ${a.message}`));
    }
}

runTest().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
