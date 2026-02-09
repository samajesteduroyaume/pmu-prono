import { calculerPredictionHybride } from '../core/hybrid.mjs';
import logger from '../utils/logger.mjs';

async function testLiveIntegration() {
    logger.header('TEST INTÉGRATION LIVE PATTERNS V29');

    const participant = {
        nom: 'SPEEDY GONZALES',
        musique: '1a2a1a',
        cote_ref: 3.5,
        nb_courses: 10,
        nb_victoires: 3,
        gains: 50000,
        age: 5,
        driver: 'Raffi',
        ferrage: 'D4'
    };

    const contexte = {
        discipline: 'TROT ATTELE',
        hippodrome: 'Vincennes',
        prixCourse: 50000
    };

    // 1. Prédiction Sans Pattern
    const resNoPattern = await calculerPredictionHybride(participant, contexte, []);
    logger.info(`Score Sans Pattern: ${resNoPattern.score}`);

    // 2. Prédiction Avec Golden Pattern
    const activePatterns = [
        { type: 'GOLDEN_PATTERN', pattern: 'Trot + Vincennes', roi: 40 }
    ];
    const resWithPattern = await calculerPredictionHybride(participant, contexte, activePatterns);
    logger.info(`Score Avec Golden Pattern: ${resWithPattern.score}`);

    if (resWithPattern.score > resNoPattern.score) {
        logger.success('✅ Le score a été boosté par le Golden Pattern');
    } else {
        logger.error('❌ Le score n\'a pas bougé');
    }

    logger.header('FIN DES TESTS LIVE');
}

testLiveIntegration().catch(console.error);
