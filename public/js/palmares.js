document.addEventListener('DOMContentLoaded', () => {
    loadPalmares();
});

async function loadPalmares() {
    try {
        const response = await fetch('/api/palmares');
        const data = await response.json();

        if (data.error) {
            console.error('Erreur API:', data.error);
            return;
        }

        renderTable('table-jockeys', data.jockeys);
        renderTable('table-chevaux', data.chevaux);
        renderTable('table-entraineurs', data.entraineurs);
        renderTable('table-proprietaires', data.proprietaires);

    } catch (error) {
        console.error('Erreur chargement palmarès:', error);
    }
}

function renderTable(tableId, data) {
    const tbody = document.querySelector(`#${tableId} tbody`);
    if (!tbody) return;

    tbody.innerHTML = '';

    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center">Aucune donnée</td></tr>';
        return;
    }

    data.forEach((item, index) => {
        const tr = document.createElement('tr');

        let rankClass = '';
        if (index === 0) rankClass = 'rank-1';
        else if (index === 1) rankClass = 'rank-2';
        else if (index === 2) rankClass = 'rank-3';

        tr.innerHTML = `
            <td class="${rankClass}">${item.rang}</td>
            <td style="color:#fff">${item.name}</td>
            <td class="stat-val">${item.courses}</td>
            <td class="stat-val" style="color:var(--pmu-green)">${item.victoires}</td>
            <td class="stat-val">${item.reussite_gagne}%</td>
        `;
        tbody.appendChild(tr);
    });
}
