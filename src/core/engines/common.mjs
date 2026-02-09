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
