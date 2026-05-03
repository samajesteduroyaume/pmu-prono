import { checkShieldStatus, calculerRegularite } from '../utils/engine_utils.mjs';
import { 
    analyserFormeProfonde, 
    analyserClasse, 
    analyserConfig,
    calculerScoreConfiance,
    calculerScoreEntourage
} from './intelligence.mjs';
import { CONFIG } from '../config/settings.mjs';

/**
 * MOTEUR DE FEATURES IA - UNIFIÉ v30
 */

export async function extractBaseFeatures(participant, course) {
    const discipline = (course.discipline || 'PLAT').toUpperCase();
    const isTrot = discipline.includes('TROT') || discipline.includes('ATTELE') || discipline.includes('MONTE');

    // 1. Forme Profonde (Logic v30)
    const scoreForme = analyserFormeProfonde(participant.musique, discipline);
    const labelForme = scoreForme >= 80 ? "Forme Exceptionnelle" : (scoreForme >= 60 ? "Bonne Forme" : (scoreForme >= 40 ? "Forme Stable" : "Forme Douteuse"));

    // 2. Classe Calibrée (Logic v30)
    const scoreClasse = analyserClasse(participant);
    const labelClasse = scoreClasse >= 70 ? "Classe Supérieure" : (scoreClasse >= 40 ? "Catégorie Adaptée" : "Classe Limite");

    // 3. Configuration (Logic v30)
    const scoreConfig = analyserConfig(participant, discipline);
    let labelConfig = "Configuration Standard";
    if (isTrot) {
        if (scoreConfig >= 90) labelConfig = "Déferré des 4 (Optimal)";
        else if (scoreConfig >= 75) labelConfig = "Déferré Partiel";
        else if (scoreConfig >= 60) labelConfig = "Plaqué";
    } else {
        if (participant.oeilleres && participant.oeilleres !== 'SANS_OEILLERES') {
            labelConfig = "Équipé d'Œillères";
        }
    }

    // 4. Entourage (Experts v30 - UNIFIÉ v43.1)
    const scoreEntourage = await calculerScoreEntourage(participant);
    const labelEntourage = scoreEntourage >= 90 ? "Entourage Elite" : (scoreEntourage >= 75 ? "Expert Détecté" : "Entourage Standard");

    // 5. Régularité
    const scoreReg = calculerRegularite(participant);
    const labelReg = scoreReg >= 50 ? "Trés Régulier" : (scoreReg >= 30 ? "Régulier" : "Irrégulier");

    // 6. Confiance Marché (Cote - UNIFIÉ v43.1)
    const scoreConfiance = calculerScoreConfiance(participant.cote_ref);
    const labelConfiance = scoreConfiance >= 80 ? "Favori Solide" : (scoreConfiance >= 50 ? "Appui Marché" : "Outsider");

    const shieldMalus = checkShieldStatus(participant, course);
    const isShielded = shieldMalus >= 30; // Shutdown threshold

    // 8. Sentiment (v40)
    const avis = (participant.avis || '').toUpperCase();
    const sentimentScore = avis === 'POSITIF' ? 1.0 : (avis === 'NEGATIF' ? 0.0 : 0.5);

    // V30: Calcul d'influence XAI (basé sur les poids de la discipline)
    const weights = CONFIG.weights[discipline] || CONFIG.weights.DEFAULT || { FORME: 0.2, ENTOURAGE: 0.2, CONFIANCE: 0.2, CONFIGURATION: 0.2, APTITUDE: 0.1, EXPERT: 0.1 };
    const rawScores = {
        forme: scoreForme,
        entourage: scoreEntourage,
        confiance: scoreConfiance,
        config: scoreConfig,
        aptitude: 50, // Par défaut
        expertise: 50
    };

    const weightedScores = {
        forme: rawScores.forme * weights.FORME,
        entourage: rawScores.entourage * weights.ENTOURAGE,
        confiance: rawScores.confiance * weights.CONFIANCE,
        config: rawScores.config * weights.CONFIGURATION,
        aptitude: rawScores.aptitude * weights.APTITUDE,
        expertise: rawScores.expertise * weights.EXPERT
    };

    const totalWeighted = Object.values(weightedScores).reduce((a, b) => a + b, 0);
    const influences = {};
    Object.keys(weightedScores).forEach(k => {
        influences[k] = totalWeighted > 0 ? Math.round((weightedScores[k] / totalWeighted) * 100) : 0;
    });

    // Déterminer l'insight principal
    let topInsight = "Profil équilibré";
    if (scoreForme >= 90) topInsight = "Forme étincelante, pret pour la victoire";
    else if (scoreEntourage >= 90) topInsight = "Duo Driver/Entraîneur redoutable";
    else if (scoreConfig >= 90) topInsight = "Configuration de ferrage optimale";
    else if (isShielded) topInsight = "Attention : Signaux négatifs détectés (Shield)";

    return {
        forme: scoreForme / 100,
        classe: scoreClasse / 100,
        config: scoreConfig / 100,
        entourage: scoreEntourage / 100,
        regularite: scoreReg / 100,
        confiance: scoreConfiance / 100,
        isTrot: isTrot ? 1 : 0,
        isShielded: Math.min(shieldMalus, 100) / 100,
        sentiment: sentimentScore,
        // Labels XAI Enrichis v30
        xai: {
            labels: {
                forme: labelForme,
                classe: labelClasse,
                config: labelConfig,
                entourage: labelEntourage,
                regularite: labelReg,
                confiance: labelConfiance
            },
            isShielded: isShielded,
            influences,
            top_insight: topInsight
        }
    };
}
