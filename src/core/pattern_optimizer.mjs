/**
 * OPTIMISATION DE PATTERNS AVANCÉE - ARCHITECT v27.1
 * 
 * Analyse croisée multi-critères pour identifier les combinaisons gagnantes
 */

import logger from '../utils/logger.mjs';
import CONFIG from '../config/settings.mjs';

const PAT = CONFIG.engine_settings.patterns;

/**
 * Analyse croisée de patterns multi-critères
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
        if (!/^\d{4}-\d{2}-\d{2}$/.test(pari.date || '')) return;
        const [year, month, day] = pari.date.split('-').map(Number);
        const date = new Date(Date.UTC(year, month - 1, day, 12));
        if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return;
        const jour = date.toLocaleDateString('fr-FR', { weekday: 'long', timeZone: 'Europe/Paris' });

        // Extraire l'heure
        const heureMatch = String(pari.heure_depart).match(/(\d{1,2})(?:h|:)/i);
        const heure = heureMatch ? Number.parseInt(heureMatch[1], 10) : null;
        if (!Number.isInteger(heure) || heure < 0 || heure > 23) return;

        const plageHoraire = getPlageHoraire(heure);

        const catTrend = pari.cat_trend || 'STABLE';

        const mise = Number(pari.mise);
        if (!Number.isFinite(mise) || mise <= 0) return;

        // Générer toutes les combinaisons possibles (Enrichies v43.3)
        const combinaisons = [
            // Simples
            `${discipline}`,
            `${jour}`,
            `${plageHoraire}`,
            `${hippodrome}`,
            `${catTrend}`,

            // Doubles
            `${discipline} + ${jour}`,
            `${discipline} + ${catTrend}`,
            `${hippodrome} + ${catTrend}`,
            `${discipline} + ${hippodrome}`,
            `${jour} + ${plageHoraire}`,

            // Triples (Combinaisons Elite)
            `${discipline} + ${catTrend} + ${hippodrome}`,
            `${discipline} + ${jour} + ${plageHoraire}`,
            `${discipline} + ${plageHoraire} + ${hippodrome}`,

            // Quadruple (Pattern Sniper)
            `${discipline} + ${catTrend} + ${hippodrome} + ${plageHoraire}`
        ];

        const isWin = pari.resultat === 'WIN' || pari.resultat === 'win';
        const gain = pari.gain == null || !Number.isFinite(Number(pari.gain)) ? null : Number(pari.gain);

        combinaisons.forEach(pattern => {
            if (!patterns.has(pattern)) {
                patterns.set(pattern, {
                    pattern,
                    count: 0,
                    wins: 0,
                    losses: 0,
                    totalMise: 0,
                    totalGain: 0,
                    missingPayouts: 0,
                    roi: 0,
                    winRate: 0,
                    avgOdds: 0,
                    oddsSum: 0,
                    oddsCount: 0
                });
            }

            const p = patterns.get(pattern);
            p.count++;
            p.totalMise += mise;
            if (gain === null) p.missingPayouts++;
            else p.totalGain += gain;

            if (isWin) {
                p.wins++;
                const odds = Number(pari.cote);
                if (Number.isFinite(odds) && odds > 1) {
                    p.oddsSum += odds;
                    p.oddsCount++;
                }
            } else {
                p.losses++;
            }
        });
    });

    // Calculer les métriques finales
    const results = [];
    patterns.forEach(p => {
        if (p.count >= PAT.min_significance_count) { // Minimum significatif
            p.winRate = (p.wins / p.count) * 100;
            p.roi = p.totalMise > 0 && p.missingPayouts === 0 ? ((p.totalGain / p.totalMise) * 100) : null;
            p.avgOdds = p.oddsCount > 0 ? (p.oddsSum / p.oddsCount) : 0;

            // Score de qualité (combinaison de ROI et win rate)
            p.qualityScore = p.roi === null ? null : (p.roi * 0.6) + (p.winRate * 0.4);

            results.push({
                pattern: p.pattern,
                count: p.count,
                wins: p.wins,
                losses: p.losses,
                winRate: parseFloat(p.winRate.toFixed(2)),
                roi: p.roi === null ? null : parseFloat(p.roi.toFixed(2)),
                avgOdds: parseFloat(p.avgOdds.toFixed(2)),
                payoutCoverage: parseFloat((((p.count - p.missingPayouts) / p.count) * 100).toFixed(1)),
                qualityScore: p.qualityScore === null ? null : parseFloat(p.qualityScore.toFixed(2)),
                profit: p.missingPayouts === 0 ? parseFloat(p.totalGain.toFixed(2)) : null
            });
        }
    });

    // Trier par quality score décroissant
    results.sort((a, b) => (b.qualityScore ?? -Infinity) - (a.qualityScore ?? -Infinity));

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
        p.roi > PAT.golden_roi_threshold &&
        p.winRate > PAT.golden_winrate_threshold &&
        p.count >= PAT.golden_count_threshold
    );
}

/**
 * Identifie les patterns "Dangereux" (ROI < -10% ET count >= 5)
 */
export function identifierPatternsAEviter(patterns) {
    return patterns.filter(p =>
        p.roi < PAT.danger_roi_threshold &&
        p.count >= PAT.golden_count_threshold
    );
}

/**
 * Analyse des performances par plage de cotes
 */
export function analyserCorrelationCotes(historique) {
    const ranges = [
        { min: 1, max: 2, label: '1.0-2.0', count: 0, wins: 0, totalMise: 0, totalGain: 0, missingPayouts: 0 },
        { min: 2, max: 3, label: '2.0-3.0', count: 0, wins: 0, totalMise: 0, totalGain: 0, missingPayouts: 0 },
        { min: 3, max: 5, label: '3.0-5.0', count: 0, wins: 0, totalMise: 0, totalGain: 0, missingPayouts: 0 },
        { min: 5, max: 10, label: '5.0-10.0', count: 0, wins: 0, totalMise: 0, totalGain: 0, missingPayouts: 0 },
        { min: 10, max: Infinity, label: '10.0+', count: 0, wins: 0, totalMise: 0, totalGain: 0, missingPayouts: 0 }
    ];

    if (!historique || historique.length === 0) {
        return { ranges: [], recommendation: getBestCoteRange([]) };
    }

    historique.forEach(pari => {
        const cote = Number(pari.cote);
        const mise = Number(pari.mise);
        const gain = pari.gain == null || !Number.isFinite(Number(pari.gain)) ? null : Number(pari.gain);
        const isWin = pari.resultat === 'WIN' || pari.resultat === 'win';

        if (!Number.isFinite(cote) || cote <= 1 || !Number.isFinite(mise) || mise <= 0) return;
        const range = ranges.find(r => cote >= r.min && cote < r.max);
        if (range) {
            range.count++;
            range.totalMise += mise;
            if (gain === null) range.missingPayouts++;
            else range.totalGain += gain;
            if (isWin) range.wins++;
        }
    });

    // Calculer métriques par range
    const results = ranges.map(r => ({
        label: r.label,
        count: r.count,
        winRate: r.count > 0 ? ((r.wins / r.count) * 100).toFixed(2) : 0,
        roi: r.totalMise > 0 && r.missingPayouts === 0 ? (((r.totalGain / r.totalMise) * 100)).toFixed(2) : null
    }));

    return {
        ranges: results,
        recommendation: getBestCoteRange(results)
    };
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
    let found = false;

    ranges.forEach(r => {
        if (r.count < 5 || r.roi == null) return; // Pas assez de données ou de rapports officiels
        const score = parseFloat(r.roi) * 0.7 + parseFloat(r.winRate) * 0.3;
        if (score > bestScore) {
            bestScore = score;
            best = r;
            found = true;
        }
    });

    if (!found) return { range: null, roi: null, winRate: null, message: 'Données insuffisantes avec rapports officiels complets.' };

    return {
        range: best.label,
        roi: best.roi,
        winRate: best.winRate,
        message: `Meilleure plage de cotes: ${best.label} (ROI: ${best.roi}%, Win Rate: ${best.winRate}%)`
    };
}

export function matchPattern(pattern, contexte) {
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

        // Vérifier Catégorie (v43.3)
        if (contexte.catTrend && part === contexte.catTrend) return true;

        return false;
    });
}

/**
 * Fonction principale d'analyse complète
 */
export async function analyseCompletePatterns(historique) {
    logger.info('Analyse complète des patterns...');

    const patternsCroises = await analysePatternsCroises(historique);
    const goldenPatterns = identifierGoldenPatterns(patternsCroises.patterns);
    const dangerPatterns = identifierPatternsAEviter(patternsCroises.patterns);
    const correlationCotes = analyserCorrelationCotes(historique);

    logger.success(`${patternsCroises.patterns.length} patterns identifiés`);
    logger.info(`${goldenPatterns.length} Golden Patterns`);
    logger.info(`${dangerPatterns.length} Patterns à éviter`);

    return {
        allPatterns: patternsCroises.patterns.slice(0, 50), // Top 50
        goldenPatterns,
        dangerPatterns,
        correlationCotes,
        stats: patternsCroises.stats
    };
}
