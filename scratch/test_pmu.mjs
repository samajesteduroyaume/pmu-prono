import fetch from 'node-fetch';
async function test() {
    const url = 'https://online.turfinfo.api.pmu.fr/rest/client/61/programme/26042026/R2/C6';
    try {
        const res = await fetch(url);
        const data = await res.json();
        console.log("ordreArrivee:", JSON.stringify(data.ordreArrivee));
        console.log("pronostics:", data.pronostics ? data.pronostics.map(p => p.nom) : null);
    } catch(e) { console.error(e); }
}
test();
