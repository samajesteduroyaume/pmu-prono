// scripts/test_dates.mjs

console.log('=== TEST DES DATES ===');

const today = new Date();
console.log('Date actuelle:', today);
console.log('Date ISO:', today.toISOString());
console.log('Date locale:', today.toLocaleDateString('fr-FR'));

// Test du calcul des 7 derniers jours
console.log('\n=== 7 DERNIERS JOURS ===');
for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(today.getDate() - i);
    console.log(`Jour ${7-i}: ${date.toISOString().split('T')[0]} (${date.toLocaleDateString('fr-FR')})`);
}

// Test avec une date fixe pour voir
console.log('\n=== TEST AVEC DATE FIXE ===');
const testDate = new Date(2024, 11, 30); // 30 décembre 2024
console.log('Date de test:', testDate.toISOString().split('T')[0]); 