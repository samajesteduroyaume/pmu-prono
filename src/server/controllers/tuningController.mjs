export async function optimize(req, res) {
    res.status(410).json({
        success: false,
        message: 'Optimisation suspendue : l’ancien backtest recalculait les variables historiques et pouvait modifier les poids avec des données indisponibles avant le départ.'
    });
}

export function getStatus(req, res) {
    res.json({ isOptimizing: false, available: false, reason: 'Aucun optimiseur prospectif validé n’est encore disponible.' });
}
