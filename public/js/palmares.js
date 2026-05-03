document.addEventListener('DOMContentLoaded', () => {
    loadPalmares();
});

async function refreshData() {
    await loadPalmares();
}

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
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color: var(--text-low); padding: 40px;">Aucune donnée disponible</td></tr>';
        return;
    }

    data.slice(0, 50).forEach((item, index) => {
        const tr = document.createElement('tr');
        const winRate = item.reussite_gagne || ((item.victoires / item.courses) * 100).toFixed(1);
        const nameColor = index < 3 ? 'var(--accent-gold)' : 'var(--text-high)';

        tr.innerHTML = `
            <td style="color: ${nameColor}; font-weight: 600;">${item.name}</td>
            <td style="text-align: right; font-family: 'JetBrains Mono';">${item.courses}</td>
            <td style="text-align: right; font-family: 'JetBrains Mono'; color: var(--accent-emerald);">${item.victoires}</td>
            <td style="text-align: right; font-family: 'JetBrains Mono'; font-weight: 700;">${winRate}%</td>
        `;
        tbody.appendChild(tr);
    });
}
