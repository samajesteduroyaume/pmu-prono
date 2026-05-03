import { fetchApi } from '../src/core/fetcher.mjs';
import { format } from 'date-fns';

async function main() {
    const today = format(new Date(), 'ddMMyyyy');
    const r = 1;
    const c = 1;
    const url = `https://online.turfinfo.api.pmu.fr/rest/client/61/programme/${today}/R1/C1/participants`;
    const data = await fetchApi(url);
    
    if (data && data.participants && data.participants.length > 0) {
        const p = data.participants[0];
        console.log(`Horse: ${p.nom}, idCheval: ${p.idCheval}`);
        
        // Try common PMU endpoints
        const tests = [
            `https://online.turfinfo.api.pmu.fr/rest/client/61/infos-cheval/${p.idCheval}`,
            `https://online.turfinfo.api.pmu.fr/rest/client/61/horse/${p.idCheval}`,
            `https://online.turfinfo.api.pmu.fr/rest/client/61/fiche-cheval/${p.idCheval}`
        ];
        
        for (const t of tests) {
            console.log(`Testing ${t}...`);
            const res = await fetchApi(t);
            if (res) {
                console.log(`✅ SUCCESS on ${t}`);
                console.log("Keys found:", Object.keys(res).join(', '));
                break;
            } else {
                console.log(`❌ FAIL on ${t}`);
            }
        }
    }
}

main().catch(console.error);
