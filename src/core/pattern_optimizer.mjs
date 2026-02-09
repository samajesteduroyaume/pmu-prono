/**
 * OPTIMISATION DE PATTERNS AVANCÉE - V29
 * 
 * Analyse croisée multi-critères pour identifier les combinaisons gagnantes
 */

import logger from '../utils/logger.mjs';

/**
 * Analyse croisée de patterns multi-critères
 * Identifie les combinaisons de facteurs qui maximisent le ROI
 */
export async function analysePatternsCroises(historique) {
    if (!historique || historique.length === 0) {
        return { patterns: [], stats: { total: 0 } };
    }

    const patterns = new Map();

    // Analyser chaque pari historique
    historique.forEach(pari => {
        if (!pari.discipline || !pari.hippodrome || !pari.heure_depart) return;

        const discipline = pari.discipline.toUpperCase();
        const hippodrome = pari.hippodrome;
        const date = new Date(pari.date);
        const jour = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'][date.getDay()];

        // Extraire l'heure
        const heureMatch = pari.heure_depart.match(/(\d+)h/);
        const heure = heureMatch ? parseInt(heureMatch[1]) : null;
        if (!heure) return;

        const plageHoraire = getPlageHoraire(heure);

        // Générer toutes les combinaisons possibles
        const combinaisons = [
            // Simples
            `${discipline}`,
            `${jour}`,
            `${plageHoraire}`,
            `${hippodrome}`,

            // Doubles
            `${discipline} + ${jour}`,
            `${discipline} + ${plageHoraire}`,
            `${discipline} + ${hippodrome}`,
            `${jour} + ${plageHoraire}`,

            // Triples
            `${discipline} + ${jour} + ${plageHoraire}`,
            `${discipline} + ${plageHoraire} + ${hippodrome}`,

            // Quadruple (pattern complet)
            `${discipline} + ${jour} + ${plageHoraire} + ${hippodrome}`
        ];

        const isWin = pari.resultat === 'WIN' || pari.resultat === 'win';
        const mise = parseFloat(pari.mise) || 1;
        const gain = parseFloat(pari.gain) || 0;

        combinaisons.forEach(pattern => {
            if (!patterns.has(pattern)) {
                patterns.set(pattern, {
                    pattern,
                    count: 0,
                    wins: 0,
                    losses: 0,
                    totalMise: 0,
                    totalGain: 0,
                    roi: 0,
                    winRate: 0,
                    avgOdds: 0,
                    oddsSum: 0
                });
            }

            const p = patterns.get(pattern);
            p.count++;
            p.totalMise += mise;
            p.totalGain += gain;

            if (isWin) {
                p.wins++;
                if (mise > 0) {
                    const odds = (mise + gain) / mise;
                    p.oddsSum += odds;
                }
            } else {
                p.losses++;
            }
        });
    });

    // Calculer les métriques finales
    const results = [];
    patterns.forEach(p => {
        if (p.count >= 3) { // Minimum 3 occurrences pour être significatif
            p.winRate = (p.wins / p.count) * 100;
            p.roi = p.totalMise > 0 ? ((p.totalGain / p.totalMise) * 100) : 0;
            p.avgOdds = p.wins > 0 ? (p.oddsSum / p.wins) : 0;

            // Score de qualité (combinaison de ROI et win rate)
            p.qualityScore = (p.roi * 0.6) + (p.winRate * 0.4);

            results.push({
                pattern: p.pattern,
                count: p.count,
                wins: p.wins,
                losses: p.losses,
                winRate: parseFloat(p.winRate.toFixed(2)),
                roi: parseFloat(p.roi.toFixed(2)),
                avgOdds: parseFloat(p.avgOdds.toFixed(2)),
                qualityScore: parseFloat(p.qualityScore.toFixed(2)),
                profit: parseFloat((p.totalGain - p.totalMise).toFixed(2))
            });
        }
    });

    // Trier par quality score décroissant
    results.sort((a, b) => b.qualityScore - a.qualityScore);

    return {
        patterns: results,
        stats: {
            total: results.length,
            totalParis: historique.length
        }
    };
}

/**
 * Identifie les patterns "Golden" (ROI > 20% ET Win Rate > 40% ET count >= 5)
 */
export function identifierGoldenPatterns(patterns) {
    return patterns.filter(p =>
        p.roi > 20 &&
        p.winRate > 40 &&
        p.count >= 5
    );
}

/**
 * Identifie les patterns "Dangereux" (ROI < -10% ET count >= 5)
 */
export function identifierPatternsAEviter(patterns) {
    return patterns.filter(p =>
        p.roi < -10 &&
        p.count >= 5
    );
}

/**
 * Analyse de corrélation entre cotes et performance
 */
export function analyserCorrelationCotes(historique) {
    if (!historique || historique.length === 0) {
        return { ranges: [], correlation: 0 };
    }

    const ranges = [
        { min: 0, max: 2, label: '1.0-2.0', count: 0, wins: 0, totalMise: 0, totalGain: 0 },
        { min: 2, max: 3, label: '2.0-3.0', count: 0, wins: 0, totalMise: 0, totalGain: 0 },
        { min: 3, max: 5, label: '3.0-5.0', count: 0, wins: 0, totalMise: 0, totalGain: 0 },
        { min: 5, max: 10, label: '5.0-10.0', count: 0, wins: 0, totalMise: 0, totalGain: 0 },
        { min: 10, max: 999, label: '10.0+', count: 0, wins: 0, totalMise: 0, totalGain: 0 }
    ];

    historique.forEach(pari => {
        const cote = parseFloat(pari.cote) || 0;
        const mise = parseFloat(pari.mise) || 1;
        const gain = parseFloat(pari.gain) || 0;
        const isWin = pari.resultat === 'WIN' || pari.resultat === 'win';

        const range = ranges.find(r => cote >= r.min && cote < r.max);
        if (range) {
            range.count++;
            range.totalMise += mise;
            range.totalGain += gain;
            if (isWin) range.wins++;
        }
    });

    // Calculer métriques par range
    const results = ranges.map(r => ({
        label: r.label,
        count: r.count,
        winRate: r.count > 0 ? ((r.wins / r.count) * 100).toFixed(2) : 0,
        roi: r.totalMise > 0 ? (((r.totalGain / r.totalMise) * 100)).toFixed(2) : 0
    }));

    return {
        ranges: results,
        recommendation: getBestCoteRange(results)
    };
}

/**
 * Détecte les mouvements suspects de cotes (smart money)
 */
export function detecterSmartMoney(coursesRecentes) {
    const alerts = [];

    coursesRecentes.forEach(course => {
        if (!course.participants) return;

        course.participants.forEach(participant => {
            const coteInitiale = parseFloat(participant.cote_initiale);
            const coteActuelle = parseFloat(participant.cote_ref);

            if (!coteInitiale || !coteActuelle) return;

            const variation = ((coteActuelle - coteInitiale) / coteInitiale) * 100;

            // Baisse significative de cote (> 20%) = smart money
            if (variation < -20) {
                alerts.push({
                    course: `${course.reunionNum}C${course.courseNum}`,
                    cheval: participant.nom,
                    coteInitiale: coteInitiale.toFixed(2),
                    coteActuelle: coteActuelle.toFixed(2),
                    variation: variation.toFixed(2),
                    type: 'SMART_MONEY',
                    message: `Forte baisse de cote (${Math.abs(variation).toFixed(0)}%) - Argent intelligent détecté`
                });
            }

            // Hausse significative (> 30%) = délaissement
            if (variation > 30) {
                alerts.push({
                    course: `${course.reunionNum}C${course.courseNum}`,
                    cheval: participant.nom,
                    coteInitiale: coteInitiale.toFixed(2),
                    coteActuelle: coteActuelle.toFixed(2),
                    variation: variation.toFixed(2),
                    type: 'DELAISSEMENT',
                    message: `Forte hausse de cote (${variation.toFixed(0)}%) - Cheval délaissé`
                });
            }
        });
    });

    return alerts;
}

/**
 * Génère des recommandations basées sur les patterns
 */
export function genererRecommandations(patterns, contexteActuel) {
    const recommendations = [];

    // Vérifier si le contexte actuel correspond à un golden pattern
    const goldenPatterns = identifierGoldenPatterns(patterns);

    goldenPatterns.forEach(gp => {
        if (matchPattern(gp.pattern, contexteActuel)) {
            recommendations.push({
                type: 'GOLDEN_PATTERN',
                priority: 'HIGH',
                pattern: gp.pattern,
                winRate: gp.winRate,
                roi: gp.roi,
                message: `Pattern Golden détecté ! ROI: ${gp.roi}%, Win Rate: ${gp.winRate}%`,
                action: 'Augmenter les mises de 20-30%'
            });
        }
    });

    // Vérifier les patterns à éviter
    const badPatterns = identifierPatternsAEviter(patterns);

    badPatterns.forEach(bp => {
        if (matchPattern(bp.pattern, contexteActuel)) {
            recommendations.push({
                type: 'DANGER_PATTERN',
                priority: 'HIGH',
                pattern: bp.pattern,
                roi: bp.roi,
                message: `Pattern Dangereux détecté ! ROI: ${bp.roi}%`,
                action: 'Éviter de parier ou réduire fortement les mises'
            });
        }
    });

    return recommendations;
}

// ============= FONCTIONS UTILITAIRES =============

export function getPlageHoraire(heure) {
    if (heure >= 8 && heure < 10) return '8h-10h';
    if (heure >= 10 && heure < 12) return '10h-12h';
    if (heure >= 12 && heure < 14) return '12h-14h';
    if (heure >= 14 && heure < 16) return '14h-16h';
    if (heure >= 16 && heure < 18) return '16h-18h';
    if (heure >= 18 && heure < 20) return '18h-20h';
    return 'Autre';
}

function getBestCoteRange(ranges) {
    let best = ranges[0];
    let bestScore = -Infinity;

    ranges.forEach(r => {
        if (r.count < 5) return; // Pas assez de données
        const score = parseFloat(r.roi) * 0.7 + parseFloat(r.winRate) * 0.3;
        if (score > bestScore) {
            bestScore = score;
            best = r;
        }
    });

    return {
        range: best.label,
        roi: best.roi,
        winRate: best.winRate,
        message: `Meilleure plage de cotes: ${best.label} (ROI: ${best.roi}%, Win Rate: ${best.winRate}%)`
    };
}

function matchPattern(pattern, contexte) {
    if (!contexte) return false;

    const parts = pattern.split(' + ');

    return parts.every(part => {
        const partUpper = part.toUpperCase();

        // Vérifier discipline
        if (contexte.discipline && partUpper === contexte.discipline.toUpperCase()) return true;

        // Vérifier jour
        if (contexte.jour && part.toLowerCase() === contexte.jour.toLowerCase()) return true;

        // Vérifier plage horaire
        if (contexte.plageHoraire && part === contexte.plageHoraire) return true;

        // Vérifier hippodrome
        if (contexte.hippodrome && part === contexte.hippodrome) return true;

        return false;
    });
}

/**
 * Fonction principale d'analyse complète
 */
export async function analyseCompletePatterns(historique, coursesRecentes = []) {
    logger.info('Analyse complète des patterns...');

    const patternsCroises = await analysePatternsCroises(historique);
    const goldenPatterns = identifierGoldenPatterns(patternsCroises.patterns);
    const dangerPatterns = identifierPatternsAEviter(patternsCroises.patterns);
    const correlationCotes = analyserCorrelationCotes(historique);
    const smartMoney = detecterSmartMoney(coursesRecentes);

    logger.success(`${patternsCroises.patterns.length} patterns identifiés`);
    logger.info(`${goldenPatterns.length} Golden Patterns`);
    logger.info(`${dangerPatterns.length} Patterns à éviter`);

    return {
        allPatterns: patternsCroises.patterns.slice(0, 50), // Top 50
        goldenPatterns,
        dangerPatterns,
        correlationCotes,
        smartMoney,
        stats: patternsCroises.stats
    };
}
