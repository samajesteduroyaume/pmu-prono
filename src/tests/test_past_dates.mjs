import assert from 'node:assert/strict';
import { initBrowser, closeBrowser, fetchDay } from '../core/fetcher.mjs';

async function testPastDates() {
    console.log('=== TEST DATES PASSÉES ===');
    await initBrowser();
    const testDates = [
        '2024-12-30',
        '2024-12-25',
        '2024-12-20',
        '2024-12-15',
        '2024-12-10',
        '2024-12-05',
        '2024-12-01'
    ];
    
    try {
        for (const dateStr of testDates) {
            console.log(`\n--- Test ${dateStr} ---`);
            const date = new Date(dateStr);
            const rawData = await fetchDay(date);
            assert.ok(rawData?.programme && Array.isArray(rawData.programme.reunions), `Programme absent pour ${dateStr}.`);
            const reunions = rawData.programme.reunions;
            const allRaces = reunions.flatMap(reunion => reunion.courses || []);
            assert.ok(allRaces.length > 0, `Aucune course historique renvoyée pour ${dateStr}.`);
            console.log(`✅ Données trouvées: ${reunions.length} réunions, ${allRaces.length} courses`);
            console.log('📋 Première course:', {
                libelle: allRaces[0].libelle,
                hippodrome: allRaces[0].hippodrome?.libelleLong,
                discipline: allRaces[0].discipline,
                heure: allRaces[0].heureDepart
            });
        }
    } finally {
        await closeBrowser();
    }
    console.log('\n🔒 Test terminé');
}

testPastDates().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
