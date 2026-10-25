const select = document.getElementById('quantum-course');
const runButton = document.getElementById('quantum-run');
const statusEl = document.getElementById('quantum-status');
const resultsEl = document.getElementById('quantum-results');
let selectedParticipants = [];
let latestBloch = [];
let rotationDegrees = 0;

function localDate() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}
function quantumApi() { return document.getElementById('quantum-api-url').value.replace(/\/$/, ''); }
function isNonRunner(person) { return ['NON_PARTANT','NON-PARTANT','NON PARTANT','FORFAIT','NP'].includes(String(person.statut || '').trim().toUpperCase()); }
function raceLabel(course) {
    const time = String(course.heure || '').slice(0,5);
    return `${time} · R${course.reunionNum || '?'}C${course.courseNum || '?'} · ${course.hippodrome || 'Hippodrome'}`;
}
function normalizedPriors(participants) {
    const model = participants.map(p => Number(p.prediction_score ?? p.prediction_heuristic_score));
    if (model.every(value => Number.isFinite(value) && value > 0)) {
        const versions = [...new Set(participants.map(p => p.prediction_model_version).filter(Boolean))];
        return { weights: model, source: versions.length === 1 ? versions[0] : 'score modèle (version non vérifiée)' };
    }
    const inverse = participants.map(p => { const odds = Number(p.cote_ref); return Number.isFinite(odds) && odds > 0 ? 1/odds : null; });
    const available = inverse.filter(value => value !== null);
    const fallback = available.length ? available.reduce((a,b)=>a+b,0)/available.length : 1;
    return { weights: inverse.map(value => value ?? fallback), source: available.length ? 'cotes inversées' : 'répartition uniforme' };
}
async function loadCourses() {
    try {
        const response = await fetch(`/api/courses?date=${encodeURIComponent(localDate())}&page=1&limit=100`);
        if (!response.ok) throw new Error(`PMU API HTTP ${response.status}`);
        const payload = await response.json();
        const courses = (payload.data || []).filter(c => !c.ordre_arrivee && !/annul|arriv|termine|en_cours|depart/i.test(String(c.statut || '')));
        select.replaceChildren(new Option('Choisir une course…', ''));
        for (const course of courses) select.add(new Option(raceLabel(course), String(course.id)));
        statusEl.textContent = courses.length ? `${courses.length} course(s) disponibles.` : 'Aucune course à venir trouvée pour aujourd’hui.';
    } catch (error) {
        select.replaceChildren(new Option('Courses indisponibles', ''));
        statusEl.textContent = `Impossible de charger pmu-prono : ${error.message}`;
    }
}
async function loadParticipants(courseId) {
    selectedParticipants = [];
    if (!courseId) return;
    const response = await fetch(`/api/courses/${encodeURIComponent(courseId)}/participants`);
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        const detail = payload?.error || payload?.message || payload?.details;
        throw new Error(detail ? `Partants HTTP ${response.status} : ${detail}` : `Partants HTTP ${response.status}`);
    }
    const rows = payload;
    if (!Array.isArray(rows)) throw new Error('Réponse partants invalide depuis pmu-prono.');
    selectedParticipants = rows
        .filter(person => !isNonRunner(person))
        .sort((a, b) => Number(a.numero) - Number(b.numero));
    if (selectedParticipants.length < 3) throw new Error('Il faut au moins trois partants actifs.');
}
function svg(tag, attrs={}) {
    const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key,value] of Object.entries(attrs)) element.setAttribute(key, String(value));
    return element;
}
function renderBloch() {
    const grid = document.getElementById('bloch-grid');
    grid.replaceChildren();
    latestBloch.forEach((item,index) => {
        const card = document.createElement('div'); card.className = 'bloch-item';
        const title = document.createElement('strong');
        const participant = item.horse_number ? selectedParticipants[item.horse_number-1] : null;
        title.textContent = item.horse_number ? `N°${participant?.numero ?? item.horse_number} ${participant?.nom || ''}` : `Qubit ${item.qubit}`;
        const sphere = svg('svg',{viewBox:'0 0 120 120',class:'bloch-sphere','aria-label':`Sphère de Bloch ${title.textContent}`});
        sphere.append(svg('circle',{cx:60,cy:60,r:42}),svg('ellipse',{cx:60,cy:60,rx:42,ry:15}),svg('line',{x1:18,y1:60,x2:102,y2:60}),svg('line',{x1:60,y1:16,x2:60,y2:104}));
        const v = item.bloch_vector, angle=rotationDegrees*Math.PI/180;
        const x=v.x*Math.cos(angle)-v.y*Math.sin(angle), y=v.x*Math.sin(angle)+v.y*Math.cos(angle);
        sphere.append(svg('circle',{cx:60+34*x,cy:60-34*v.z-12*y,r:5,class:'bloch-dot'}));
        const caption = document.createElement('small'); caption.textContent=`x ${v.x.toFixed(2)} · y ${v.y.toFixed(2)} · z ${v.z.toFixed(2)}`;
        card.append(title,sphere,caption); grid.append(card);
    });
}
async function analyze() {
    runButton.disabled = true; resultsEl.hidden = true; statusEl.textContent = 'Calcul des ordres et du circuit…';
    try {
        await loadParticipants(select.value);
        const prior = normalizedPriors(selectedParticipants);
        const weights = prior.weights;
        const shots = Number(document.getElementById('quantum-shots').value);
        const orderResponse = await fetch(`${quantumApi()}/order-forecast`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({course_id:Number(select.value),horse_names:selectedParticipants.map(person=>String(person.nom||'')),probabilities:weights,top_k:Math.min(5,weights.length),shots,max_exact_outcomes:10000})});
        const orderPayload = await orderResponse.json();
        if (!orderResponse.ok || !orderPayload.success) throw new Error(orderPayload.detail || orderPayload.error || `Quantic HTTP ${orderResponse.status}`);
        const mode=weights.length<=20?'qubits':'basis';
        const vizResponse=await fetch(`${quantumApi()}/circuit-visualization`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({probabilities:weights,shots,mode})});
        const vizPayload=await vizResponse.json();
        if(!vizResponse.ok||!vizPayload.success) throw new Error(vizPayload.detail||`Visualisation HTTP ${vizResponse.status}`);
        const data=orderPayload.data, viz=vizPayload.data;
        const summary=document.getElementById('quantum-summary'); summary.replaceChildren();
        const entropy=data.entropy.normalized;
        const reportedMass=Number.isFinite(data.top_orders_reported_mass)?`${(data.top_orders_reported_mass*100).toFixed(1)} %`:'—';
        const metrics=[['Entropie Shannon',`${(entropy*100).toFixed(1)} %`],['Estimation du favori',`${(Math.max(...data.win_probabilities)*100).toFixed(1)} %`],['Partants actifs',String(weights.length)],['Masse des 20 ordres listés',reportedMass]];
        for(const [label,value] of metrics){const box=document.createElement('div');box.className='quantum-metric';const small=document.createElement('small');small.textContent=label;const strong=document.createElement('strong');strong.textContent=value;box.append(small,strong);summary.append(box);}
        const orders=document.getElementById('quantum-orders');orders.replaceChildren();
        document.getElementById('quantum-order-probability-heading').textContent =
            data.top_order_probability_source === 'monte_carlo' ? 'Fréquence estimée de l’ordre' : 'Probabilité exacte de l’ordre';
        data.top_orders.forEach((row,index)=>{const tr=document.createElement('tr');const rank=document.createElement('td');rank.textContent=String(index+1);const order=document.createElement('td');order.textContent=row.order.map(n=>{const p=selectedParticipants[n-1];return `N°${p.numero} ${p.nom||''}`}).join(' → ');const exact=document.createElement('td');exact.textContent=`${(row.probability*100).toFixed(3)} %`;const unordered=document.createElement('td');unordered.textContent=`${(row.unordered_probability*100).toFixed(3)} %`;tr.append(rank,order,exact,unordered);orders.append(tr);});
        const couples=document.getElementById('quantum-couples');couples.replaceChildren();
        const pairRows=[];
        for(let i=0;i<selectedParticipants.length;i++)for(let j=i+1;j<selectedParticipants.length;j++)pairRows.push({i,j,p:data.couple_probabilities[i][j]});
        pairRows.sort((a,b)=>b.p-a.p).slice(0,12).forEach(pair=>{const tr=document.createElement('tr');const names=document.createElement('td');names.textContent=`N°${selectedParticipants[pair.i].numero} ${selectedParticipants[pair.i].nom||''} — N°${selectedParticipants[pair.j].numero} ${selectedParticipants[pair.j].nom||''}`;const probability=document.createElement('td');probability.textContent=`${(pair.p*100).toFixed(3)} %`;tr.append(names,probability);couples.append(tr);});
        document.getElementById('quantum-circuit').textContent=viz.text_diagram;
        document.getElementById('bloch-description').textContent=mode==='qubits'?'Chaque qubit correspond à un partant; les vecteurs sont calculés avant mesure.':'Registre catégoriel : les qubits codent l’index du partant, pas un partant chacun.';
        latestBloch=viz.qubits;renderBloch();resultsEl.hidden=false;
        const entropyLabel=entropy>=0.7?'Course ouverte : distribution diffuse.':entropy<=0.35?'Course concentrée : favori net.':'Incertitude intermédiaire.';
        const modelLabel = prior.source === 'heuristic-fallback'
            ? 'Source : score heuristique v14; estimations non calibrées.'
            : `Source : ${prior.source}; estimations non calibrées.`;
        statusEl.textContent=`Prévision enregistrée (ID ${orderPayload.prediction_id ?? 'non persistée'}). ${modelLabel} ${entropyLabel}`;
    } catch(error){statusEl.textContent=`Échec de l’analyse : ${error.message}`;}
    finally{runButton.disabled=false;}
}
select.addEventListener('change',()=>{
    if (!select.value) {
        selectedParticipants = [];
        resultsEl.hidden = true;
        statusEl.textContent = 'Choisissez une course pour lancer son analyse.';
        return;
    }
    analyze();
});
runButton.addEventListener('click',analyze);
document.getElementById('bloch-rotation').addEventListener('input',event=>{rotationDegrees=Number(event.target.value);renderBloch();});
loadCourses();
