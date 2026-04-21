import { calculerPrediction } from './src/core/intelligence.mjs';

console.log("--- TEST PREDICTION V30 ELITE ---");

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
    driverStats: { victoires: 10, places: 5, total_courses: 30 }
};

console.log(`\nTEST 1: ${perfectHorse.nom} (Elite Driver/Trainer + Forme + D4 + Vincennes)`);
const score1 = await calculerPrediction(perfectHorse, mockContext);
console.log(`>>> SCORE: ${score1} / 100`);

// 2. CHEVAL "OUTSIDER" (Monte de catégorie)
const outsiderHorse = {
    nom: 'GO ON BOY',
    musique: '4a 2a 5a',
    age: 8,
    gains: 300000, // Faible gains pour simuler montée de catégorie
    ferrage: 'D4',
    driver: 'R. DERIEUX',
    entraineur: 'R. DERIEUX',
    cote_ref: 12.0,
    nb_courses: 50,
    nb_victoires: 10,
    nb_places: 20,
    driverStats: { victoires: 2, places: 5, total_courses: 20 }
};

console.log(`\nTEST 2: ${outsiderHorse.nom} (Outsider + Montée de Catégorie)`);
const score2 = await calculerPrediction(outsiderHorse, mockContext);
console.log(`>>> SCORE: ${score2} / 100`);

if (outsiderHorse.kelly_suggestion) {
    console.log("------------------------------------------------");
    console.log(`💸 STRATÉGIE FINANCIÈRE (Kelly) :`);
    console.log(`   Conseil : ${outsiderHorse.kelly_suggestion.advice}`);
    console.log(`   Mise    : ${outsiderHorse.kelly_suggestion.mise}€ (sur bankroll 1000€)`);
}
