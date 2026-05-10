import { initDB, getOptimizationSample, getDisciplines, closeDB } from '../core/db.mjs';
import { CONFIG } from '../config/settings.mjs';
import { preparerBaseScores } from '../core/intelligence.mjs';
import { processAttelé } from '../core/engines/attele_engine.mjs';
import { processMonté } from '../core/engines/monte_engine.mjs';
import { processPlat } from '../core/engines/plat_engine.mjs';
import { processObstacle } from '../core/engines/obstacle_engine.mjs';
import logger from '../utils/logger.mjs';
import fs from 'fs';
import path from 'path';

/**
 * ELITE WEIGHT OPTIMIZER v40
 * Recherche les poids optimaux par discipline pour maximiser le ROI
 */

async function getEnrichedSample(discipline, limit) {
    const rawSample = await getOptimizationSample(discipline, limit);
    const enriched = [];

    console.log(`  [INFO] Pré-traitement de ${rawSample.length} participants...`);
    
    // On met le logger en mode silencieux pour éviter les milliers de lignes de logs IA
    logger.setSilent(true);
    
    for (const p of rawSample) {
        const contexts = {
            discipline: p.discipline,
            hippodrome: p.hippodrome,
            prixCourse: p.prix_course,
            corde: p.corde
        };

        const base = await preparerBaseScores(p, contexts);
        
        // Obtenir l'expertise spécifique au moteur
        let expertise = 50;
        let engineResult;
        const disc = p.discipline.toUpperCase();

        if (disc.includes('MONTE')) {
            engineResult = await processMonté(p, contexts, base);
        } else if (disc.includes('ATTELE') || disc.includes('TROT')) {
            engineResult = await processAttelé(p, contexts, base);
        } else if (disc.includes('PLAT')) {
            engineResult = await processPlat(p, contexts, base);
        } else if (disc.includes('HAIE') || disc.includes('STEEPLE') || disc.includes('CROSS') || disc.includes('OBSTACLE')) {
            engineResult = await processObstacle(p, contexts, base);
        }

        if (engineResult) {
            expertise = 50 + (engineResult.expertiseBonus || 0);
        }

        // V45: Run hybrid prediction to set radar flags
        const { calculerPredictionHybride } = await import('../core/hybrid.mjs');
        await calculerPredictionHybride(p, contexts, [], [], base);

        enriched.push({
            course_id: p.course_id,
            numero: p.numero,
            classement: parseInt(p.classement),
            cote: parseFloat(p.cote_ref),
            scores: { ...base, expertise },
            is_trap: p.is_trap,
            is_bad_draw: p.is_bad_draw,
            is_swimmer: p.is_swimmer,
            is_hot_trainer: p.is_hot_trainer,
            is_smart_money_alert: p.is_smart_money_alert || (p.cote_direct > 0 && p.cote_direct < p.cote_ref * 0.75)
        });
    }

    logger.setSilent(false);
    return enriched;
}

function evaluateWeights(sample, weights) {
    const races = {};
    sample.forEach(p => {
        if (!races[p.course_id]) races[p.course_id] = [];
        races[p.course_id].push(p);
    });

    let totalMise = 0;
    let bankroll = 1000;
    const initialBankroll = 1000;
    const history = [];
    let peak = initialBankroll;
    let maxDD = 0;

    for (const id in races) {
        const participants = races[id];
        const scored = participants.map(p => {
            const s = p.scores;
            let finalScore = (s.forme * weights.FORME) +
                               (s.entourage * weights.ENTOURAGE) +
                               (s.confiance * weights.CONFIANCE) +
                               (s.config * weights.CONFIGURATION) +
                               (s.aptitude * weights.APTITUDE) +
                               (s.expertise * weights.EXPERT);
            
            // V45 AI Radars Application
            if (p.is_trap) finalScore -= 25;
            if (p.is_bad_draw) finalScore -= 10;
            if (p.is_smart_money_alert) finalScore += 15;
            if (p.is_swimmer) finalScore += 8;
            if (p.is_hot_trainer) finalScore += 12;

            return { ...p, finalScore };
        });

        scored.sort((a, b) => b.finalScore - a.finalScore);
        const top1 = scored[0];

        if (top1 && top1.cote > 0) {
            const mise = 1;
            totalMise += mise;
            let gain = -mise;

            if (top1.classement === 1) {
                gain = (mise * top1.cote) - mise;
            }

            bankroll += gain;
            history.push(gain);

            if (bankroll > peak) peak = bankroll;
            const dd = peak - bankroll;
            if (dd > maxDD) maxDD = dd;
        }
    }

    if (totalMise === 0) return { score: -100, roi: -100 };

    const roi = ((bankroll / initialBankroll) - 1) * 100;
    
    // Calcul Sharpe Ratio
    const avgGain = history.reduce((a, b) => a + b, 0) / history.length;
    const variance = history.reduce((s, g) => s + Math.pow(g - avgGain, 2), 0) / history.length;
    const stdDev = Math.sqrt(variance);
    const sharpe = stdDev > 0 ? (avgGain / stdDev) : 0;

    // Score Combiné (ROI + Sharpe - Pénallité Drawdown)
    // On veut un ROI positif, un Sharpe élevé et un DD faible
    const totalScore = (roi * 0.5) + (sharpe * 50) - (maxDD / initialBankroll * 100);

    return { 
        score: totalScore, 
        roi: parseFloat(roi.toFixed(2)), 
        sharpe: parseFloat(sharpe.toFixed(2)), 
        maxDD: parseFloat(maxDD.toFixed(2)) 
    };
}

async function runOptimization() {
    console.log("=== ELITE WEIGHT OPTIMIZER v40 ===");
    await initDB();
    
    const disciplines = await getDisciplines();
    const results = {};

    for (const disc of disciplines) {
        console.log(`\n--- Optimisation : ${disc} ---`);
        const sample = await getEnrichedSample(disc, 800);
        
        if (sample.length < 100) {
            console.log(`  [SKIP] Trop peu de données (${sample.length})`);
            continue;
        }

        let bestWeights = null;
        let maxScore = -1000;
        let bestResult = null;

        // GRID SEARCH : Test de combinaisons (Somme = 1.0)
        // Pour garder le calcul raisonnable, on varie par paliers de 0.05
        const steps = [0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40];

        console.log("  [SEARCH] Recherche du point d'équilibre optimal...");

        for (const f of steps) {
            for (const e of steps) {
                for (const c of [0.05, 0.10, 0.15]) { // Confiance souvent entre ces valeurs
                    const remainder = 1.0 - (f + e + c);
                    if (remainder < 0.2) continue; // On veut au moins 20% pour le reste (Config + Aptitude + Expert)
                    
                    // Répartition simplifiée du reste pour l'optimisation
                    const config = remainder * 0.45;
                    const apt = remainder * 0.45;
                    const exp = remainder * 0.1;

                    const weights = {
                        FORME: parseFloat(f.toFixed(2)),
                        ENTOURAGE: parseFloat(e.toFixed(2)),
                        CONFIANCE: parseFloat(c.toFixed(2)),
                        CONFIGURATION: parseFloat(config.toFixed(2)),
                        APTITUDE: parseFloat(apt.toFixed(2)),
                        EXPERT: parseFloat(exp.toFixed(2))
                    };

                    // Ajustement final pour que la somme soit exactement 1.0
                    const sum = Object.values(weights).reduce((a, b) => a + b, 0);
                    weights.EXPERT = parseFloat((weights.EXPERT + (1.0 - sum)).toFixed(2));

                    const result = evaluateWeights(sample, weights);
                    if (result.score > maxScore) {
                        maxScore = result.score;
                        bestResult = result;
                        bestWeights = weights;
                    }
                }
            }
        }

        if (bestWeights) {
            console.log(`  [RESULT] Discipline: ${disc}`);
            console.log(`  [RESULT] Score Combiné: ${maxScore.toFixed(2)}`);
            console.log(`  [RESULT] ROI: ${bestResult.roi}% | Sharpe: ${bestResult.sharpe} | MaxDD: ${bestResult.maxDD}€`);
            console.log(`  [RESULT] Poids:`, bestWeights);
            results[disc] = bestWeights;
        }
    }

    // Mise à jour de settings.mjs
    if (Object.keys(results).length > 0) {
        const settingsPath = path.resolve('src/config/settings.mjs');
        let content = fs.readFileSync(settingsPath, 'utf8');
        
        // On fusionne les résultats avec les poids par défaut
        const finalWeights = { ...CONFIG.weights };
        for (const disc in results) {
            // Mapper les noms de disciplines aux clés de settings.mjs
            let key = 'DEFAULT';
            const discUpper = disc.toUpperCase();
            if (discUpper.includes('TROT')) key = 'TROT';
            else if (discUpper.includes('PLAT')) key = 'PLAT';
            else if (discUpper.includes('STEEPLECHASE')) key = 'STEEPLECHASE';
            else if (discUpper.includes('HAIE') || discUpper.includes('OBSTACLE')) key = 'OBSTACLE';
            else if (discUpper.includes('ATTELE')) key = 'ATTELE';
            else if (discUpper.includes('MONTE')) key = 'MONTE';
            else if (discUpper.includes('CROSS')) key = 'CROSS';
            
            finalWeights[key] = results[disc];
        }
        
        const weightsRegex = /weights: \{[\s\S]*?\}/;
        const newWeightsStr = `weights: ${JSON.stringify(finalWeights, null, 4).replace(/"([^"]+)":/g, '$1:')}`;
        content = content.replace(weightsRegex, newWeightsStr);
        
        fs.writeFileSync(settingsPath, content);
        console.log("\n✅ ARCHITECT v40 : Configuration mise à jour avec les poids optimisés.");
    }

    await closeDB();
}

runOptimization().catch(console.error);
