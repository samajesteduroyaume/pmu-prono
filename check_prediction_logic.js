import { calculerPrediction } from './src/core/intelligence.mjs';

console.log("--- TEST PREDICTION V27 (FULL OPTIONS) ---");

// Mock Context
const mockContext = {
    discipline: 'ATTELE',
    prixCourse: 100000,
    hippodrome: 'VINCENNES',
    nom: 'PRIX D\'AMERIQUE',
    nbPartants: 14
};

// 1. CHEVAL "PARFAIT"
const perfectHorse = {
    nom: 'IDAO DE TILLARD',
    musique: '1a 1a (23) 1a',
    age: 6,
    gains: 1000000,
    ferrage: 'D4',
    driver: 'C. DUVALDESTIN',
    entraineur: 'T. DUVALDESTIN',
    cote_ref: 1.5,
    nb_courses: 30,
    nb_victoires: 25,
    nb_places: 2,
    // Simulation Driver Form
    driverStats: { victoires: 10, places: 5, total_courses: 30 } // > 30% win rate = HOT
};

console.log(`\nTEST 1: ${perfectHorse.nom} (Favori + Forme + D4 + Vincennes)`);
const score1 = calculerPrediction(perfectHorse, mockContext);
console.log(`>>> SCORE: ${score1} / 100`);
if (perfectHorse.is_track_specialist) console.log("✅ BONUS: Track Specialist");
if (perfectHorse.is_money_time) console.log("✅ BONUS: Money Time");

// 2. CHEVAL "OUTSIDER" (Money Time)
const outsiderHorse = {
    nom: 'GO ON BOY',
    musique: '4a 2a 5a',
    age: 8,
    gains: 800000,
    ferrage: 'D4',
    driver: 'R. DERIEUX',
    entraineur: 'R. DERIEUX',
    cote_ref: 4.8, // < 5 donc éligible Money Time
    nb_courses: 50,
    nb_victoires: 10,
    nb_places: 20,
    driverStats: { victoires: 2, places: 5, total_courses: 20 }
};

console.log(`\nTEST 2: ${outsiderHorse.nom} (Outsider + Money Time Potential)`);
const score2 = calculerPrediction(outsiderHorse, mockContext);
console.log(`>>> SCORE: ${score2} / 100`);
if (outsiderHorse.is_money_time) console.log("💰 ALERT: Money Time Détecté !");

if (outsiderHorse.kelly_suggestion) {
    console.log("------------------------------------------------");
    console.log(`💸 STRATÉGIE FINANCIÈRE (Kelly) :`);
    console.log(`   Conseil : ${outsiderHorse.kelly_suggestion.advice}`);
    console.log(`   Mise    : ${outsiderHorse.kelly_suggestion.mise}€ (sur bankroll 1000€)`);
    console.log(`   Raison  : ${outsiderHorse.kelly_suggestion.explanation || 'Value Bet détecté'}`);
}

