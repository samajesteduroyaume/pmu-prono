import { analyserFormeProfonde } from './src/core/intelligence.mjs';

const musique1 = "1a 2a (25) 3a (24) 4a"; // Ran in 2026. Should be 100 (or close, no malus)
const score1 = analyserFormeProfonde(musique1, 'ATTELE');
console.log(`Musique: ${musique1} -> Score: ${score1}`);

const musique2 = "1a 2a"; // Ran in 2026, no history. Should be 100.
const score2 = analyserFormeProfonde(musique2, 'ATTELE');
console.log(`Musique: ${musique2} -> Score: ${score2}`);

const musique3 = "(25) 1a 2a"; // Hasn't run in 2026. Should have seasonal malus (10 pts).
const score3 = analyserFormeProfonde(musique3, 'ATTELE');
console.log(`Musique: ${musique3} -> Score: ${score3}`);

const musique4 = "(24) 1a 2a"; // Hasn't run in 2026 nor 2025. Should have long rest malus (35 pts).
const score4 = analyserFormeProfonde(musique4, 'ATTELE');
console.log(`Musique: ${musique4} -> Score: ${score4}`);
