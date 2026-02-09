/**
 * COMMON UTILS FOR ANALYSIS ENGINES - V32
 */

export function calculerRegularite(p) {
    if (!p.nb_courses || p.nb_courses === 0) return 0;
    const totalPlaces = (p.nb_victoires || 0) + (p.nb_places || 0);
    return Math.round((totalPlaces / p.nb_courses) * 100);
}

export function determinerChangementCategorie(p, prixCourse) {
    if (!p.nb_courses || p.nb_courses < 3) return 'STABLE';
    const gainMoyen = p.gains / p.nb_courses;
    if (gainMoyen > prixCourse * 0.8) return 'DESCENTE';
    if (gainMoyen < (prixCourse / 10)) return 'MONTEE';
    return 'STABLE';
}

export function getTopEntourage() {
    return ['BAZIRE', 'NIVARD', 'RAFFIN', 'ABRIVARD', 'ROCHARD', 'BARZALONA', 'SOUMILLON', 'GUYON', 'PASQUIER', 'DEMURO', 'MOUROT', 'MOTTIER', 'GELORMINI', 'LAGADEUC'];
}

export function getCracks() {
    return ['RAFFIN', 'BAZIRE', 'NIVARD', 'ABRIVARD'];
}

/**
 * V33 - "THE SHIELD" NEGATIVE FILTERING
 * Detects chronic failure or red flags
 */
export function checkShieldStatus(p, contexte) {
    let malus = 0;
    const musique = p.musique || '';
    const cleanMusic = musique.replace(/\(\d+\)/g, '');
    const perfs = cleanMusic.match(/([0-9DA]|Dist)[a-zA-Z]/g) || [];

    // 1. Échec Chronique (Discipline actuelle)
    const disc = (contexte.discipline || '').toUpperCase();
    const isTrot = disc.includes('TROT') || disc.includes('ATTELE') || disc.includes('MONTE');
    const type = isTrot ? (disc.includes('MONTE') ? 'm' : 'a') : (disc.includes('PLAT') ? 'p' : 'h');

    const sameDiscPerfs = perfs.filter(perf => perf.slice(-1).toLowerCase() === type);
    const wins = sameDiscPerfs.filter(perf => perf.startsWith('1')).length;

    if (sameDiscPerfs.length >= 5 && wins === 0) {
        const places = sameDiscPerfs.filter(perf => ['2', '3'].includes(perf[0])).length;
        if (places === 0) malus += 25; // Zéro réussite (Expertise Malus fort)
        else if (places / sameDiscPerfs.length < 0.15) malus += 15; // Très faible réussite
    }

    // 2. Double Red Flag (DAI/ARR sériels)
    if (perfs.length >= 2) {
        const lastTwo = perfs.slice(0, 2);
        const redFlags = lastTwo.filter(perf => ['D', 'A', 'T', 'Dist'].some(f => perf.toUpperCase().startsWith(f.toUpperCase()))).length;
        if (redFlags === 2) malus += 20; // Malus majeur
    }

    return malus;
}
