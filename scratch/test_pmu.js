const fetch = require('node-fetch');
async function test() {
    // 2026-04-26 R1 C1 (example)
    const url = 'https://offline.turfinfo.api.pmu.fr/rest/client/7/programme/26042026/R1/C1';
    try {
        const res = await fetch(url);
        const data = await res.json();
        console.log("ordreArrivee:", data.ordreArrivee);
        console.log("pronostics:", data.pronostics);
    } catch(e) { console.error(e); }
}
test();
