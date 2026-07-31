import { initBrowser, closeBrowser, fetchDay } from '../core/fetcher.mjs';

(async () => {
    console.log('=== TEST DATES PASSÉES ===');
    
    await initBrowser();
    
    // Test avec quelques dates de 2024
    const testDates = [
        '2024-12-30',
        '2024-12-25',
        '2024-12-20',
        '2024-12-15',
        '2024-12-10',
        '2024-12-05',
        '2024-12-01'
    ];
    
    for (const dateStr of testDates) {
        console.log(`\n--- Test ${dateStr} ---`);
        try {
            const date = new Date(dateStr);
            const rawData = await fetchDay(date);
            
            if (rawData) {
                const reunions = rawData?.programme?.reunions || [];
                const allRaces = reunions.flatMap(r => r.courses || []);
                console.log(`✅ Données trouvées: ${reunions.length} réunions, ${allRaces.length} courses`);
                
                if (allRaces.length > 0) {
                    console.log('📋 Première course:', {
                        libelle: allRaces[0].libelle,
                        hippodrome: allRaces[0].hippodrome?.libelleLong,
                        discipline: allRaces[0].discipline,
                        heure: allRaces[0].heureDepart
                    });
                }
            } else {
                console.log('❌ Aucune donnée');
            }
        } catch (e) {
            console.error(`❌ Erreur:`, e.message);
        }
    }
    
    await closeBrowser();
    console.log('\n🔒 Test terminé');
})(); 