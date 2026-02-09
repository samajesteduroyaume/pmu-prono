import { checkShieldStatus } from './engines/common.mjs';

/**
 * MOTEUR DE FEATURES IA - UNIFIÉ v15.1
 */

export function extractBaseFeatures(participant, course) {
    const discipline = (course.discipline || 'PLAT').toUpperCase();
    const isTrot = discipline.includes('TROT') || discipline.includes('ATTELE') || discipline.includes('MONTE');

    // 1. Forme Profonde (Logic v14)
    const scoreForme = calculateForme(participant.musique, discipline);
    const labelForme = scoreForme >= 80 ? "Forme Exceptionnelle" : (scoreForme >= 60 ? "Bonne Forme" : (scoreForme >= 40 ? "Forme Stable" : "Forme Douteuse"));

    // 2. Classe Calibrée
    const age = parseInt(participant.age) || 5;
    const gains = parseFloat(participant.gains) || 0;
    const scoreClasse = (age < 2) ? 50 : Math.min(Math.round((gains / (age * 12000)) * 45), 100) || 50;
    const labelClasse = scoreClasse >= 70 ? "Classe Supérieure" : (scoreClasse >= 40 ? "Catégorie Adaptée" : "Classe Limite");

    // 3. Configuration (Ferrage/Oeilleres)
    let scoreConfig = 50;
    let labelConfig = "Configuration Standard";
    if (isTrot) {
        const ferrage = (participant.ferrage || '').toUpperCase();
        if (ferrage.includes('D4')) { scoreConfig = 95; labelConfig = "Déferré des 4 (Optimal)"; }
        else if (ferrage.includes('DA') || ferrage.includes('DP')) { scoreConfig = 75; labelConfig = "Déferré Partiel"; }
        else if (ferrage.includes('PL')) { scoreConfig = 60; labelConfig = "Plaqué"; }
    } else {
        if (participant.oeilleres && participant.oeilleres !== 'SANS_OEILLERES') {
            scoreConfig = 70;
            labelConfig = "Équipé d'Œillères";
        }
    }

    // 4. Entourage
    const topDrivers = ['BAZIRE', 'NIVARD', 'RAFFIN', 'ABRIVARD', 'ROCHARD', 'BARZALONA', 'SOUMILLON', 'GUYON', 'PASQUIER', 'DEMURO'];
    const dr = (participant.driver || '').toUpperCase();
    const isTopDriver = topDrivers.some(d => dr.includes(d));
    const scoreEntourage = isTopDriver ? 90 : 50;
    const labelEntourage = isTopDriver ? "Driver/Jockey Elite" : "Entourage Standard";

    // 5. Régularité & Expert
    const nbCourses = participant.nb_courses || 1;
    const scoreReg = Math.round((((participant.nb_victoires || 0) + (participant.nb_places || 0)) / nbCourses) * 100);
    const labelReg = scoreReg >= 50 ? "Trés Régulier" : (scoreReg >= 30 ? "Régulier" : "Irrégulier");

    // 6. Confiance Marché (Cote)
    const cote = parseFloat(participant.cote_ref);
    let scoreConfiance = 50;
    if (!isNaN(cote) && cote > 0) {
        if (cote < 3) scoreConfiance = 95;
        else if (cote < 6) scoreConfiance = 80;
        else if (cote < 12) scoreConfiance = 60;
        else if (cote < 25) scoreConfiance = 40;
        else scoreConfiance = 20;
    }
    const labelConfiance = scoreConfiance >= 80 ? "Favori Solide" : (scoreConfiance >= 50 ? "Appui Marché" : "Outsider");

    // 7. V33 THE SHIELD
    const shieldMalus = checkShieldStatus(participant, course);
    const isShielded = shieldMalus >= 30; // Shutdown threshold

    return {
        forme: scoreForme / 100,
        classe: scoreClasse / 100,
        config: scoreConfig / 100,
        entourage: scoreEntourage / 100,
        regularite: scoreReg / 100,
        confiance: scoreConfiance / 100,
        isTrot: isTrot ? 1 : 0,
        isShielded: isShielded ? 1 : 0,
        // Labels XAI
        xai: {
            forme: labelForme,
            classe: labelClasse,
            config: labelConfig,
            entourage: labelEntourage,
            regularite: labelReg,
            confiance: labelConfiance,
            isShielded: isShielded
        }
    };
}

function calculateForme(musique, discipline) {
    if (!musique) return 20;
    const cleanMusic = musique.replace(/\(\d+\)/g, '');
    const perfs = cleanMusic.match(/([0-9DA]|Dist)[a-zA-Z]/g) || [];
    if (perfs.length === 0) return 30;

    let score = 0;
    let totalWeight = 0;
    const depth = Math.min(perfs.length, 6);
    const isTrot = discipline.includes('TROT') || discipline.includes('ATTELE') || discipline.includes('MONTE');

    for (let i = 0; i < depth; i++) {
        const perf = perfs[i];
        const val = perf.slice(0, -1).toUpperCase();
        let points = 20;

        if (!isNaN(val)) {
            const place = parseInt(val);
            if (place === 1) points = 100;
            else if (place === 2) points = 80;
            else if (place === 3) points = 65;
            else if (place === 4) points = 50;
            else if (place === 5) points = 40;
            else points = 10;
        } else {
            if (val === 'D' || val === 'DIST') points = isTrot ? 0 : 10;
            else points = 5;
        }

        const weight = Math.pow(0.85, i);
        score += points * weight;
        totalWeight += weight;
    }
    return Math.round(score / totalWeight);
}
