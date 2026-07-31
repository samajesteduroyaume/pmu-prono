import { analyserEtGenererAlertes, getActiveAlerts } from '../core/alerts.mjs';
import { calculateKellyAdaptatif } from '../core/kelly.mjs';
import logger from '../utils/logger.mjs';

async function testIntegration() {
    logger.header('TEST INTÉGRATION PATTERNS V29');

    // 1. Simuler des données de patterns
    const patternData = {
        goldenPatterns: [
            { pattern: 'Trot + Vincennes', roi: 45.5, winRate: 35.0 }
        ],
        dangerPatterns: [
            { pattern: 'Galop + Chantilly', roi: -25.0, winRate: 10.0 }
        ],
        smartMoney: [
            { cheval: 'ZORRO', course: 'R1C1', variation: -25.5 }
        ],
        stats: { total: 100, totalParis: 500 }
    };

    const tendances = {
        drawdown: { currentPercent: 0.05 },
        sequence: { type: 'WIN', count: 2 },
        momentum: 75,
        tendance: { tendance: 'HAUSSIERE' }
    };

    const performance = { totalParis: 100, roi: 12.5 };

    // 2. Tester la génération d'alertes
    logger.info('Test: Génération d\'alertes avec patterns...');
    const alerts = analyserEtGenererAlertes(tendances, performance, patternData);

    const hasGolden = alerts.some(a => a.title.includes('GOLDEN'));
    const hasDanger = alerts.some(a => a.title.includes('ÉVITE') || a.title.includes('DANGER'));
    const hasSmart = alerts.some(a => a.title.includes('SMART MONEY'));

    if (hasGolden && hasDanger && hasSmart) {
        logger.success('✅ Alertes de patterns générées avec succès');
    } else {
        logger.error('❌ Échec de la génération des alertes de patterns');
        console.log(alerts);
    }

    // 3. Tester le critère de Kelly adaptatif
    logger.info('Test: Kelly Adaptatif avec Golden Pattern...');
    const activePatterns = [
        { type: 'GOLDEN_PATTERN', pattern: 'Trot + Vincennes', roi: 50 }
    ];

    const resKelly = await calculateKellyAdaptatif(3.0, 95, 1000, tendances, activePatterns);

    if (resKelly.adjustments && resKelly.adjustments.some(adj => adj.includes('Golden Pattern'))) {
        logger.success('✅ Kelly a détecté et ajusté pour le Golden Pattern');
        logger.info(`Ajustements: ${resKelly.adjustments.join(', ')}`);
        logger.info(`Mise finale: ${resKelly.mise}€ (Kelly Fraction: ${resKelly.kellyFraction})`);
    } else {
        logger.error('❌ Kelly n\'a pas ajusté pour le Golden Pattern');
    }

    logger.header('FIN DES TESTS');
}

testIntegration().catch(console.error);
