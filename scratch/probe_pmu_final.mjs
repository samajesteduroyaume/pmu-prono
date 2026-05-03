import { fetchApi } from '../src/core/fetcher.mjs';
import { format } from 'date-fns';

async function main() {
    const today = format(new Date(), 'ddMMyyyy');
    const url = `https://online.turfinfo.api.pmu.fr/rest/client/61/programme/${today}/R1/C1/participants`;
    const data = await fetchApi(url);
    
    if (data && data.participants && data.participants.length > 0) {
        const p = data.participants[0];
        const id = p.idCheval;
        console.log(`Testing idCheval: ${id}`);
        
        // This is a common pattern for PMU's "Fiche Cheval"
        const tests = [
            `https://online.turfinfo.api.pmu.fr/rest/client/61/fiche-cheval/${id}`,
            `https://online.turfinfo.api.pmu.fr/rest/client/61/participants/${id}/performances`,
            `https://online.turfinfo.api.pmu.fr/rest/client/61/cheval/${id}/performances`
        ];
        
        for (const t of tests) {
             const res = await fetchApi(t);
             if (res) {
                 console.log(`✅ FOUND: ${t}`);
                 console.log("Keys:", Object.keys(res).join(', '));
                 break;
             }
        }
    }
}
main();
