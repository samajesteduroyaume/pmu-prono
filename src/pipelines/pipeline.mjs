// scripts/pipeline.mjs
import { fetchDay, initBrowser, closeBrowser } from '../modules/fetcher.mjs';
import { processDayRaces } from '../modules/processor.mjs';
import { initDB, insertCourses, closeDB, getAllCourses } from '../modules/db.mjs';

// === Paramètres ===
const FILTER_OPTIONS = {
    disciplines: ['TROT', 'PLAT', 'OBSTACLE', 'STEEPLECHASE', 'HAIE', 'MONTE', 'ATTELE']
};

// Génère tous les jours d'une année donnée
function getDaysInYear(year) {
    const days = [];
    let date = new Date(year, 0, 1);
    while (date.getFullYear() === year) {
        days.push(new Date(date));
        date.setDate(date.getDate() + 1);
    }
    return days;
}

(async () => {
    const currentYear = new Date().getFullYear();
    console.log(`=== PIPELINE ANNUEL (${currentYear}) ===`);
    
    await initDB();
    await initBrowser();
    try {
        const days = getDaysInYear(currentYear);
        let totalInserted = 0;
        let daysWithRaces = 0;
        
        console.log(`\nTraitement de ${days.length} jours...`);
        
        for (let i = 0; i < days.length; i++) {
            const date = days[i];
            const dateStr = date.toISOString().split('T')[0];
            const progress = ((i + 1) / days.length * 100).toFixed(1);
            
            console.log(`\n[${i + 1}/${days.length}] (${progress}%) ${dateStr}...`);
            
            try {
                const rawData = await fetchDay(date);
                const processedRaces = processDayRaces(rawData, date, FILTER_OPTIONS);
                
                if (processedRaces.length > 0) {
                    await insertCourses(processedRaces);
                    totalInserted += processedRaces.length;
                    daysWithRaces++;
                    console.log(`✅ ${processedRaces.length} courses insérées`);
                } else {
                    console.log(`⚠️  Aucune course valide pour cette date`);
                }
                
            } catch (e) {
                console.error(`❌ Erreur pour ${dateStr}:`, e.message);
            }
        }
        
        console.log(`\n=== RÉSULTATS ===`);
        console.log(`Total de courses insérées: ${totalInserted.toLocaleString('fr-FR')}`);
        console.log(`Jours avec courses: ${daysWithRaces}/${days.length}`);

        // Exemple d'analyse : nombre de courses par discipline
        const allCourses = await getAllCourses();
        const byDiscipline = allCourses.reduce((acc, c) => {
            acc[c.discipline] = (acc[c.discipline] || 0) + 1;
            return acc;
        }, {});
        console.log('\nNombre de courses par discipline :');
        console.table(byDiscipline);
        
    } finally {
        await closeBrowser();
        await closeDB();
        console.log('\n🔒 Pipeline terminé');
    }
})(); 