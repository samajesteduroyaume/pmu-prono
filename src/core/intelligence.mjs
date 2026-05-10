import logger from '../utils/logger.mjs';
import { CONFIG } from '../config/settings.mjs';
import { determinerChangementCategorie, calculerRegularite } from '../utils/engine_utils.mjs';

// EXPORTS POUR COMPATIBILITÉ (FAÇADE)
export { determinerChangementCategorie, calculerRegularite };

import { calculateKellyMise } from './kelly.mjs';
import { getSynergyScore } from './db.mjs';
import { processAttelé } from './engines/attele_engine.mjs';
import { processMonté } from './engines/monte_engine.mjs';
import { processPlat } from './engines/plat_engine.mjs';
import { processObstacle } from './engines/obstacle_engine.mjs';
import { detectInconsistencies, applyCorrection } from './inconsistency_checker.mjs';
import { evaluerSignalGate } from './signal_gate.mjs';

/**
 * MOTEUR D'INTELLIGENCE ARTIFICIELLE "ARCHITECT v30 - ELITE"
 */


export function analyserFormeProfonde(musique, discipline = 'INCONNUE', avgHistoryPrix = 0) {
    if (!musique) return 20;

    // 1. Détection de "Rentrée" (Absence prolongée)
    let rentreeMalus = 0;
    const trimmedMusique = musique.trim();
    // v48: Détection multi-annuelle des rentrées
    const yearMatches = musique.match(/\((\d+)\)/g);
    if (yearMatches) {
        const currentYearShort = new Date().getFullYear() % 100; // fix v48.1: déclaration unique (suppression du shadowing)
        const years = yearMatches.map(m => parseInt(m.replace(/[()]/g, '')));
        const lastRunYear = years[0];
        
        // Calcul de l'écart par rapport à l'année actuelle
        const diff = (currentYearShort < lastRunYear) ? (currentYearShort + 100 - lastRunYear) : (currentYearShort - lastRunYear);
        
        if (diff > 2) rentreeMalus = CONFIG.architect.malus.rentreeLongue + 15; // Rentrée critique (> 2 ans)
        else if (diff > 1) rentreeMalus = CONFIG.architect.malus.rentreeLongue; 
        else if (diff === 1 && trimmedMusique.startsWith('(')) {
            rentreeMalus = CONFIG.architect.malus.rentreeSaisonniere;
        }

        // v48: Malus cumulatif si plusieurs années d'absence dans la musique (carrière hachée)
        if (years.length >= 3) rentreeMalus += 10;
    }

    // 2. Analyse Séquentielle Profonde
    const cleanMusic = musique.replace(/\(\d+\)/g, '');
    // v48.2: Regex robuste capturant rangs multi-chiffres et fautes variées
    const perfs = cleanMusic.match(/([0-9]+|DA|DAI|DIST|T|A|ARR|R|RET|D)[a-zA-Z]?/gi) || [];

    if (perfs.length === 0) return Math.max(0, 30 - rentreeMalus);

    let score = 0;
    let totalWeight = 0;
    const depth = Math.min(perfs.length, 10);
    const isTrot = (discipline || '').includes('TROT') || (discipline || '').includes('ATTELE') || (discipline || '').includes('MONTE');

    // Bonus Victoire Récente (V27)
    let recentWinBonus = 0;

    for (let i = 0; i < depth; i++) {
        const perf = perfs[i].toUpperCase();
        // Extraire la partie numérique ou faute (tout sauf la dernière lettre si c'est une discipline)
        let val = perf;
        let type = '';
        const lastChar = perf.slice(-1).toLowerCase();
        if (perf.length > 1 && 'apmhcrs'.includes(lastChar)) {
            val = perf.slice(0, -1);
            type = lastChar;
        }

        let points = 20;

        // Cas numérique (Rang)
        const place = parseInt(val);
        if (!isNaN(place)) {
            if (place === 1) {
                points = 120; // V27: Victoire valorisée (+20pts)
                if (i === 0) recentWinBonus = 15; // Bonus immédiat si dernière course gagnée
            } else if (place === 2) {
                points = 90;
            } else if (place === 3) {
                points = 75;
            } else if (place === 4) {
                points = 60;
            } else if (place === 5) {
                points = 50;
            } else if (place > 0 && place <= 7) {
                points = 15; // v48: Rangs 6-7 sont désormais des échecs (30 -> 15)
            } else {
                points = 5; // v48: Reste (10 -> 5)
            }
        } else {
            // Fautes spécialisées (v48.2: Alignement des malus)
            const fault = val.toUpperCase();
            if (fault === 'D' || fault === 'DIST' || fault === 'DAI' || fault === 'DIS') {
                points = isTrot ? 10 : 5; // Malus sévère en trot
            } else if (fault === 'T' || fault === 'A' || fault === 'ARR' || fault === 'RET') {
                points = 5; // Chute/Arrêté = Échec total
            }
        }

        // Bonus Spécialisation (Discipline) - V31: Renforcé pour Spécialités
        const currentType = isTrot ? (discipline.includes('MONTE') ? 'm' : 'a') : (discipline.includes('PLAT') ? 'p' : (discipline.includes('HAIE') ? 'h' : 's'));
        if (type === currentType) {
            const specBonus = (discipline.includes('MONTE') || !isTrot) ? 1.25 : 1.15;
            points *= specBonus;
        }

        // Pondération Dégressive (La dernière perf compte le plus)
        // V27: Dégressivité plus marquée (0.8 au lieu de 0.85)
        const weight = Math.pow(CONFIG.architect.forme.decay, i);
        score += Math.min(130, points) * weight;
        totalWeight += weight;
    }

    // 3. Détection d'Irrégularité (v43.1)
    let irregularityMalus = 0;
    const recentRanks = perfs.slice(0, 3).map(p => {
        const val = p.slice(0, -1).toUpperCase();
        return isNaN(val) ? 10 : parseInt(val);
    });
    if (recentRanks.includes(1) && (recentRanks.includes(0) || recentRanks.some(r => r > 8))) {
        irregularityMalus = 15; // Cheval "Tout ou Rien"
    }

    const finalFormeScore = Math.round(score / totalWeight) + recentWinBonus;
    let baseResult = finalFormeScore - rentreeMalus - irregularityMalus;

    // v48: Malus d'inexpérience (musique trop courte)
    if (perfs.length < 3 && perfs.length > 0) {
        const penalty = perfs.length === 1 ? 30 : 15; // v48: -30 si une seule course
        baseResult -= penalty;
        logger.debug(`[IA] Malus inexpérience: -${penalty} (${perfs.length} perfs)`);
    }

    // V43.3: MULTIPLICATEUR DE CLASSE (Indice de Forme Dynamique)
    // On valorise la forme si elle a été acquise dans des courses à forte allocation
    if (avgHistoryPrix > 0) {
        const disciplineAvg = isTrot ? 25000 : 35000; // Moyennes estimées par discipline
        const classMultiplier = Math.min(1.3, Math.max(0.8, avgHistoryPrix / disciplineAvg));
        
        // v48: Neutraliser le multiplicateur de classe si la forme est critique ou inexpérience
        if (baseResult >= 40 && perfs.length >= 3) {
            baseResult *= classMultiplier;
        }
    }

    return Math.max(0, Math.min(100, Math.round(baseResult)));
}

export function analyserClasse(participant) {
    const age = parseInt(participant.age) || 5;
    const gains = parseFloat(participant.gains) || 0;
    const nbCourses = Math.max(1, parseInt(participant.nb_courses) || 5);
    
    if (age < 2) return 50;
    if (gains === 0) return 45; // v46: Base neutre pour chevaux sans gains (maidens)

    const classFactor = CONFIG.architect.classe.factor || 15000;
    
    // 1. Score Patrimoine (Gains totaux rapportés à l'âge)
    const scorePatrimoine = (gains / (age * classFactor)) * 60;
    
    // 2. Score Rentabilité (Gains moyens par course)
    const gainsParCourse = gains / nbCourses;
    const scoreRentabilite = (gainsParCourse / (classFactor / 5)) * 60;
    
    // Mix hybride (v46) : 40% Patrimoine / 60% Rentabilité
    const result = Math.round((scorePatrimoine * 0.4) + (scoreRentabilite * 0.6));
    
    return Math.max(10, Math.min(100, result)) || 50;
}

export function analyserConfig(participant, discipline = '') {
    const isTrot = discipline.includes('TROT') || discipline.includes('ATTELE') || discipline.includes('MONTE');
    if (!isTrot) return 60; // Base neutre hors Trot

    let score = 50;
    const ferrage = (participant.ferrage || '').toUpperCase();
    const oeilleres = (participant.oeilleres || '').toUpperCase();

    // v48.2: Support Oeillères pour PLAT/OBSTACLE
    if (!discipline.includes('TROT') && !discipline.includes('ATTELE') && !discipline.includes('MONTE')) {
        if (oeilleres.includes('OEILLERES_CLASSIQUES')) score = 85;
        else if (oeilleres.includes('OEILLERES_AUSTRALIENNES')) score = 75;
        else if (oeilleres.includes('PEAU_DE_MOUTON')) score = 70;
    }

    // V27: Impact Déferrage renforcé (TROT)
    if (ferrage.includes('D4')) score = 100; // Optimal
    else if (ferrage.includes('DA') || ferrage.includes('DP')) score = 80; // Bon
    else if (ferrage.includes('PL')) score = 65; // Plaqué (correct)

    return score;
}

export function calculerScoreConfiance(cote) {
    let scoreConfiance = 50;
    const c = parseFloat(cote);
    if (!isNaN(c) && c > 0) {
        if (c < 2.0)  scoreConfiance = 90;
        else if (c < 3.5)  scoreConfiance = 88;
        else if (c < 6.0)  scoreConfiance = 78;
        else if (c < 10.0) scoreConfiance = 65;
        else if (c < 20.0) scoreConfiance = 40;
        else if (c < 50.0) scoreConfiance = 20;
        else scoreConfiance = 5;
    }
    return scoreConfiance;
}

export async function calculerScoreEntourage(participant) {
    const topDrivers = CONFIG.experts.drivers;
    const topTrainers = CONFIG.experts.trainers;
    
    const driverName = (participant.driver || '').toUpperCase();
    const trainerName = (participant.entraineur || '').toUpperCase();
    
    const isTopDriver = topDrivers.some(name => driverName.includes(name));
    const isTopTrainer = topTrainers.some(name => trainerName.includes(name));
    
    const isElite = isTopDriver && isTopTrainer;
    let scoreEntourage = isElite ? 98 : (isTopDriver || isTopTrainer ? 85 : 55);

    const synergyScore = await getSynergyScore(driverName, trainerName);
    if (synergyScore > 70) {
        scoreEntourage += 5;
        if (isElite && synergyScore > 80) scoreEntourage += 5; // v48: Elite+ Synergy boost
        participant.has_synergy = true; 
    } else if (synergyScore < 40) {
        scoreEntourage -= 10;
    }

    if (participant.driverStats) {
        const winRate = (participant.driverStats.victoires / participant.driverStats.total_courses) * 100;
        const placeRate = (participant.driverStats.places / participant.driverStats.total_courses) * 100;
        if (participant.driverStats.total_courses > 5) {
            if (winRate > 20 || placeRate > 40) scoreEntourage += 10;
            else if (winRate === 0 && participant.driverStats.total_courses > 20) scoreEntourage -= 10;
        }
    }

    return Math.max(0, Math.min(100, scoreEntourage));
}

export async function preparerBaseScores(participant, contexteCourse, avgHistoryPrix = 0) {
    const disc = (contexteCourse.discipline || 'PLAT').toUpperCase();
    
    const scoreForme = analyserFormeProfonde(participant.musique, disc, avgHistoryPrix);
    const scoreClasse = analyserClasse(participant);
    const scoreConfig = analyserConfig(participant, disc);

    const scoreEntourage = await calculerScoreEntourage(participant);
    const scoreConfiance = calculerScoreConfiance(participant.cote_ref);

    return {
        forme: scoreForme,
        entourage: scoreEntourage,
        confiance: scoreConfiance,
        config: scoreConfig,
        aptitude: scoreClasse,
        avgPrix: (avgHistoryPrix / 1000).toFixed(1)
    };
}

export async function calculerPrediction(participant, contexteCourse, activePatterns = []) {
    try {
        const disc = (contexteCourse.discipline || 'PLAT').toUpperCase();
        const baseScores = await preparerBaseScores(participant, contexteCourse);
        const isElite = (baseScores.entourage >= 98); 
        const cote = parseFloat(participant.cote_ref);

        participant.is_swimmer = false;
        if (contexteCourse.terrain && (contexteCourse.terrain.includes('LOURD') || contexteCourse.terrain.includes('COLLANT') || contexteCourse.terrain.includes('TRES_SOUPLE'))) {
            if (participant.terrain_prefere && (participant.terrain_prefere.includes('LOURD') || participant.terrain_prefere.includes('COLLANT'))) {
                participant.is_swimmer = true;
                logger.debug(`[RADAR] Terrain Spécialiste détecté: ${participant.nom}`);
            }
        }

        participant.is_hot_trainer = false;
        if (baseScores.entourage >= 95 && participant.has_synergy) {
            participant.is_hot_trainer = true;
        }

        participant.is_trap = false;
        if (cote < 4.0 && baseScores.forme <= 40) {
            participant.is_trap = true;
            logger.debug(`[RADAR] Faux Favori détecté (Piège): ${participant.nom} (Cote basse mais forme mauvaise)`);
        }

        // v48.2: Malus 'Bad Draw' et 'Changement Catégorie' déplacés dans les engines 
        // pour éviter la double peine observée en PLAT.
        participant.is_bad_draw = false; 
        participant.is_smart_money_alert = false;
        participant.smart_money_bonus = 0;
        participant.market_momentum_malus = 0;
        
        const coteDir = parseFloat(participant.cote_direct || 0);
        const marketSettings = CONFIG.engine_settings.common.market;

        if (cote > 0 && coteDir > 0) {
            const drop = (cote - coteDir) / cote;
            const threshold = cote < 4.0 ? marketSettings.smart_money_fav_threshold : marketSettings.smart_money_std_threshold;

            // 1. SMART MONEY (Baisse de cote)
            if (drop >= threshold) {
                participant.is_smart_money_alert = true;
                const baseBonus = drop * 50; 
                const outsiderMultiplier = cote > 15 ? 1.5 : (cote < 5 ? 0.7 : 1.0);
                participant.smart_money_bonus = Math.min(25, Math.round(baseBonus * outsiderMultiplier));
            }
            
            // 2. MARKET MOMENTUM (Hausse de cote - Malus)
            const ratio = coteDir / cote;
            if (ratio >= marketSettings.momentum_malus_hard) {
                participant.market_momentum_malus = 20;
            } else if (ratio >= marketSettings.momentum_malus_soft) {
                participant.market_momentum_malus = 10;
            }
        }

        let engineResult;
        if (disc.includes('MONTE')) {
            engineResult = await processMonté(participant, contexteCourse, baseScores);
        } else if (disc.includes('ATTELE') || disc.includes('TROT')) {
            engineResult = await processAttelé(participant, contexteCourse, baseScores);
        } else if (disc.includes('PLAT')) {
            engineResult = await processPlat(participant, contexteCourse, baseScores);
        } else if (disc.includes('HAIE') || disc.includes('STEEPLE') || disc.includes('CROSS') || disc.includes('OBSTACLE')) {
            engineResult = await processObstacle(participant, contexteCourse, baseScores);
        } else {
            let discKey = 'DEFAULT';
            if (disc.includes('TROT') || disc.includes('ATTELE') || disc.includes('MONTE')) discKey = 'ATTELE'; // fix v48.1: TROT supprimé (alias → ATTELE)
            else if (disc.includes('PLAT')) discKey = 'PLAT';
            else if (disc.includes('OBSTACLE') || disc.includes('HAIE') || disc.includes('STEEPLE') || disc.includes('CROSS')) discKey = 'OBSTACLE';
            
            const weights = CONFIG.weights[discKey];
            engineResult = {
                engine: 'ARCHITECT-GENERIC v30',
                finalScore: Math.round(
                    (baseScores.forme * weights.FORME) +
                    (baseScores.entourage * weights.ENTOURAGE) +
                    (baseScores.confiance * weights.CONFIANCE) +
                    (baseScores.config * weights.CONFIGURATION) +
                    (baseScores.aptitude * weights.APTITUDE) +
                    (50 * (weights.EXPERT || 0))
                )
            };
        }

        let predictionScore = engineResult.finalScore;
        participant.active_engine = engineResult.engine;

        // v48: Système de bonus cumulatifs contrôlés
        let cumulativeBonus = 0;
        let bonusMultiplier = 1.0;
        
        // Garde-fou de forme : un cheval hors de forme ne peut pas profiter pleinement des bonus
        if (baseScores.forme < 25) bonusMultiplier = 0.2;
        else if (baseScores.forme < 40) bonusMultiplier = 0.5;
        else if (baseScores.forme < 50) bonusMultiplier = 0.8;

        const hippoName = (contexteCourse.hippodrome || '').toUpperCase();
        const isInternational = hippoName.includes('USA') || hippoName.includes('ARG') || hippoName.includes('JPN') || 
                               hippoName.includes('GBR') || hippoName.includes('GER') || hippoName.includes('ITY') ||
                               hippoName.includes('BEL') || hippoName.includes('SUI') || hippoName.includes('CHURCHILL') ||
                               hippoName.includes('PALERMO');

        // Application des bonus avec multiplicateur et cumul
        const applyBonus = (val, label) => {
            if (val > 0) {
                const adjusted = val * bonusMultiplier;
                cumulativeBonus += adjusted;
                logger.debug(`[IA] Bonus ${label}: +${adjusted.toFixed(1)} (Form-scaled)`);
            } else {
                predictionScore += val; // Malus ne sont pas réduits
            }
        };

        const avis = (participant.avis || '').toUpperCase();
        if (avis === 'POSITIF') applyBonus(5, 'Sentiment');
        else if (avis === 'NEGATIF') predictionScore -= 15;

        // SHIELD SHUTDOWN (v48: Prioritaire sur les bonus)
        if (engineResult.expertiseBonus <= -30) {
            logger.info(`[IA] SHIELD SHUTDOWN: ${participant.nom} neutralisé (Expertise Malus: ${engineResult.expertiseBonus})`);
            predictionScore = Math.min(predictionScore, 30);
            participant.is_shielded_active = true;
        }

        // CAT-MALUS (v48: Malus de montée de catégorie)
        const cat = determinerChangementCategorie(participant, contexteCourse.prixCourse || 20000);
        if (cat === 'MONTEE' && !isElite && predictionScore > 70) {
            const malus = Math.min(15, (predictionScore - 70)); 
            predictionScore -= malus;
        }

        // PATTERNS
        if (activePatterns && activePatterns.length > 0) {
            activePatterns.forEach(p => {
                if (p.type === 'GOLDEN_PATTERN') {
                    const bonus = Math.min(15, p.roi / 5);
                    applyBonus(bonus, 'Golden Pattern');
                } else if (p.type === 'DANGER_PATTERN') {
                    predictionScore -= 20;
                }
            });
        }

        if (participant.is_swimmer) applyBonus(15, 'Swimmer');
        if (participant.is_hot_trainer) applyBonus(8, 'Hot Trainer');
        if (participant.is_trap) predictionScore -= 12;
        // v48.2: Malus is_bad_draw retiré d'ici car déjà intégré dans Expertise (Expert) via les engines.
        if (participant.is_smart_money_alert) applyBonus(participant.smart_money_bonus, 'Smart Money'); 
        if (participant.market_momentum_malus > 0) predictionScore -= participant.market_momentum_malus; // v48: Malus Momentum

        // Winrate Historique (v48: réservé aux chevaux ayant un minimum de forme)
        const wrhConf = CONFIG.architect.winrate_histo;
        if (wrhConf.enabled && participant.nb_courses >= wrhConf.min_courses) {
            const nbCourses = parseInt(participant.nb_courses) || 0;
            const nbVictoires = parseInt(participant.nb_victoires) || 0;
            if (nbCourses > 0) {
                const winRatePct = (nbVictoires / nbCourses) * 100;
                if (winRatePct >= wrhConf.excellent_threshold && baseScores.forme >= 50) {
                    applyBonus(wrhConf.excellent_bonus, 'Winrate Elite');
                } else if (winRatePct >= wrhConf.bon_threshold && baseScores.forme >= 45) {
                    applyBonus(wrhConf.bon_bonus, 'Winrate Bon');
                } else if (winRatePct <= wrhConf.faible_threshold && nbCourses >= 10) {
                    predictionScore += wrhConf.faible_malus;
                }
            }
        }

        if (participant._isMarketFavorite && predictionScore > 60) applyBonus(5, 'Market Fav');

        // Special Arrival & Class Drop
        let specialArrivalBoost = 0;
        const currentPrixK = (contexteCourse.prixCourse || 20000) / 1000;
        const avgHistoryPrixK = parseFloat(baseScores.avgPrix || 0);
        let isClassDrop = avgHistoryPrixK > (currentPrixK * 1.15); 
        
        if (isClassDrop && isInternational) {
            isClassDrop = false; 
            applyBonus(8, 'International Class (Cautious)');
        }

        const isHiddenForm = baseScores.forme < 40; 
        const isBarefoot = participant.ferrage && participant.ferrage.includes('D4');
        const hasTopEntourage = baseScores.entourage >= 85;
        const isOutsider = cote >= 8 && cote <= 35; 
        const isRetardGains = participant.nb_courses > 0 && (participant.gains / participant.nb_courses) > 15000;

        if (isOutsider) {
            if (isClassDrop && hasTopEntourage) specialArrivalBoost += 18;
            if (isHiddenForm && isBarefoot && hasTopEntourage) specialArrivalBoost += 15;
            if (isRetardGains && isClassDrop) specialArrivalBoost += 12;
        }
        
        if (specialArrivalBoost > 0) {
            applyBonus(specialArrivalBoost, 'Special Arrival');
            participant.is_special_arrival = true;
        }

        // Plafonnement Global des Bonus (v48)
        const maxBonus = CONFIG.engine_settings.common.max_cumulative_bonus || 25;
        if (cumulativeBonus > maxBonus) {
            cumulativeBonus = maxBonus;
        }

        // Assemblage final temporaire pour les calculs de stats
        let finalScoreRaw = Math.round((predictionScore || 0) + cumulativeBonus);

        // --- INCONSISTENCY CHECKER ---
        const alerts = detectInconsistencies(participant, contexteCourse, baseScores, finalScoreRaw);
        if (alerts.length > 0) {
            finalScoreRaw = applyCorrection(finalScoreRaw, alerts, participant);
            participant.inconsistency_alerts = alerts; 
            participant.is_inconsistent = true;
        }

        // --- SIGNAL GATE ---
        participant.signal_gate = evaluerSignalGate(participant, contexteCourse, finalScoreRaw); 

        // v48: BARRIÈRE DE FORME ABSOLUE
        // Si le cheval est en méforme totale, il ne peut pas être une sélection élite (cap à 55)
        if (baseScores.forme < 35 && finalScoreRaw > 55) {
            logger.warning(`[IA] Barrière de Forme activée pour ${participant.nom}: Score ${finalScoreRaw} -> 55`);
            finalScoreRaw = 55;
        }

        // v48.1: BARRIÈRE D'INEXPÉRIENCE — Regex aligné sur analyserFormeProfonde()
        // On utilise le même extracteur de perfs que dans analyserFormeProfonde pour cohérence.
        const cleanMusicBarre = (participant.musique || '').replace(/\(\d+\)/g, '');
        const perfsBarre = cleanMusicBarre.match(/([0-9]|DA|DAI|Dist)[a-zA-Z]?/g) || [];
        if (perfsBarre.length < 3 && finalScoreRaw > 75) {
            logger.warning(`[IA] Barrière Inexpérience activée pour ${participant.nom}: Score ${finalScoreRaw} -> 75 (${perfsBarre.length} perf(s))`);
            finalScoreRaw = 75;
        }

        // --- STATS & KELLY (calculés APRÈS les barrières pour mises cohérentes) ---
        // fix v48.1: Kelly calculé après barrières de forme/inexpérience pour éviter les mises excessives
        if (cote > 1) {
            const iaProb = finalScoreRaw / 100;
            const marketProb = 1 / cote;
            participant.edge_stat = parseFloat(((iaProb - marketProb) * 100).toFixed(2));
            participant.market_prob = parseFloat((marketProb * 100).toFixed(2));
            participant.kelly_suggestion = calculateKellyMise(cote, finalScoreRaw, 1000);
        }

        return Math.max(0, Math.min(100, finalScoreRaw));

    } catch (e) {
        logger.error(`IA Architecture Error: ${e.message}`);
        return 50;
    }
}

export function genererArgumentsXAI(participant, baseScores, cat_trend) {
    const arguments_ia = [];
    const disc = (participant.discipline || participant.discipline_course || '').toUpperCase();
    const isPlat = disc.includes('PLAT');
    const isObstacle = disc.includes('OBSTACLE') || disc.includes('HAIE') || disc.includes('STEEPLE') || disc.includes('CROSS');
    const isTrot = disc.includes('TROT') || disc.includes('ATTELE') || disc.includes('MONTE');

    if (baseScores.forme >= 85) arguments_ia.push("Forme étincelante (série de performances elite)");
    else if (baseScores.forme >= 70) arguments_ia.push("En condition ascendante (forme solide)");
    
    if (baseScores.entourage >= 95) arguments_ia.push("Duo Driver/Entraîneur au sommet (synergie maximale)");
    else if (baseScores.entourage >= 85) arguments_ia.push("Entourage de haut niveau (experts reconnus)");
    else if (participant.has_synergy) arguments_ia.push("Excellente synergie historique entre l'entourage");
    
    if (cat_trend === 'DOWN') arguments_ia.push("Engagement visé : descend de catégorie (lot abordable)");
    else if (cat_trend === 'UP' && baseScores.forme >= 80) arguments_ia.push("Tente sa chance au niveau supérieur (ambition entourage)");
    
    // v48: Arguments spécifiques à la discipline
    if (isTrot && baseScores.config >= 90) {
        arguments_ia.push("Configuration de ferrage optimale (déferré des 4)");
    } else if (isPlat) {
        if (parseInt(participant.corde) <= 4) arguments_ia.push("Excellent numéro de corde (avantage tactique)");
        if (participant.oeilleres && participant.oeilleres !== 'SANS_OEILLERES') arguments_ia.push("Équipé d'œillères (concentration accrue)");
    } else if (isObstacle) {
        if (baseScores.forme >= 75) arguments_ia.push("Sauteur expérimenté et en pleine possession de ses moyens");
    }
    if (participant.is_smart_money_alert) arguments_ia.push("Smart Money: Fort intérêt du marché (Pépite)");
    if (participant.market_momentum_malus >= 20) arguments_ia.push("Signal Négatif: Le marché abandonne ce cheval (cote en hausse)");
    else if (participant.market_momentum_malus >= 10) arguments_ia.push("Prudence: Désintérêt relatif des parieurs en live");

    const avis = (participant.avis || '').toUpperCase();
    if (avis === 'POSITIF') arguments_ia.push("Sentiment de l'entourage très favorable");
    
    if (arguments_ia.length === 0) arguments_ia.push("Profil équilibré et régulier pour ce lot");
    return arguments_ia.slice(0, 3);
}

export function calculerEdge(predictions) {
    if (!predictions || predictions.length < 2) return { edge: 0, label: 'PRUDENCE' };
    const sorted = [...predictions].sort((a, b) => b.score - a.score);
    const top1 = sorted[0];
    const top2 = sorted[1];
    const edge = top1.score - top2.score;
    let label = 'VALEUR';
    if (edge > 20) label = 'ULTRA-CONFIDENCE';
    else if (edge > 10) label = 'SOLIDE';
    else if (edge < 3) label = 'INCERTAIN';
    return { edge, label, top1: top1.nom, diff: edge };
}
