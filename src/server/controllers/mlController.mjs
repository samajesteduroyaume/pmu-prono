import logger from '../../utils/logger.mjs';
import cache from '../../utils/cache.mjs';

export async function getTendances(req, res) {
    try {
        const { days } = req.query;
        const daysFilter = days ? parseInt(days) : null;
        
        const cacheKey = cache.generateKey('tendances', daysFilter || 'all');
        const cached = cache.get(cacheKey);
        if (cached) return res.json(cached);

        const { getTendancesCumulees } = await import('../../core/db.mjs');
        const tendances = await getTendancesCumulees(daysFilter);
        
        cache.set(cacheKey, tendances, 3600); // 1h cache
        res.json(tendances);
    } catch (error) {
        logger.error(`API Error Tendances: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

export async function getPatterns(req, res) {
    try {
        const { days } = req.query;
        const daysFilter = days ? parseInt(days) : 30;
        const { getHistoriqueParis } = await import('../../core/db.mjs');
        const { detecterPatterns } = await import('../../core/tendances.mjs');
        const historique = await getHistoriqueParis(daysFilter);
        const patterns = detecterPatterns(historique);
        res.json(patterns);
    } catch (error) {
        logger.error(`API Error Patterns: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

export async function getSequence(req, res) {
    try {
        const { getSequenceActuelle } = await import('../../core/db.mjs');
        const sequence = await getSequenceActuelle();
        res.json(sequence);
    } catch (error) {
        logger.error(`API Error Séquence: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

export async function valueHunter(req, res) {
    try {
        const { date } = req.query;
        const { detectOpportunities } = await import('../../core/value_hunter.mjs');
        const opportunities = await detectOpportunities(date);
        
        // Broadcast via Websocket si Smart Money détecté
        const smartMoneys = opportunities.filter(o => o.is_smart_money || o.is_smart_money_alert);
        if (smartMoneys.length > 0) {
            const io = req.app.get('io');
            if (io) {
                io.emit('smart_money_alert', smartMoneys);
            }
        }

        res.json(opportunities);
    } catch (error) {
        logger.error(`API Value Hunter Error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

export async function backtest(req, res) {
    try {
        const { startDate, endDate } = req.body;
        const { runBacktest } = await import('../../ml/backtest.mjs');
        const results = await runBacktest(startDate, endDate);
        res.json(results);
    } catch (error) {
        logger.error(`API Backtest Error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

export async function backtestCompare(req, res) {
    try {
        const { startDate, endDate, initialBankroll = 1000 } = req.body;
        const { compareKellyStrategies } = await import('../../ml/backtest.mjs');
        const results = await compareKellyStrategies(startDate, endDate, initialBankroll);
        res.json(results);
    } catch (error) {
        logger.error(`API Compare Strategies Error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

export async function backtestMonteCarlo(req, res) {
    try {
        const { startDate, endDate, simulations = 100, initialBankroll = 1000 } = req.body;
        const { runMonteCarloSimulation } = await import('../../ml/backtest.mjs');
        const results = await runMonteCarloSimulation(startDate, endDate, simulations, initialBankroll);
        res.json(results);
    } catch (error) {
        logger.error(`API Monte Carlo Error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

export async function getOptimizedPatterns(req, res) {
    try {
        const { days = 30 } = req.query;
        const { getHistoriqueParis } = await import('../../core/db.mjs');
        const { analyseCompletePatterns } = await import('../../core/pattern_optimizer.mjs');
        const historique = await getHistoriqueParis(parseInt(days));
        const results = await analyseCompletePatterns(historique);
        res.json(results);
    } catch (error) {
        logger.error(`API Patterns Optimized Error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

export async function getRecommendations(req, res) {
    try {
        const { contexte, days = 30 } = req.body;
        const { getHistoriqueParis } = await import('../../core/db.mjs');
        const { analysePatternsCroises, genererRecommandations } = await import('../../core/pattern_optimizer.mjs');
        const historique = await getHistoriqueParis(parseInt(days));
        const { patterns } = await analysePatternsCroises(historique);
        const recommendations = genererRecommandations(patterns, contexte);
        res.json({ recommendations, totalPatterns: patterns.length, contexte });
    } catch (error) {
        logger.error(`API Recommendations Error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

export async function reloadMLModelController(req, res) {
    try {
        const { loadMLModel } = await import('../../core/hybrid.mjs');
        const success = await loadMLModel();
        if (success) {
            logger.success('[API] Modèle ML rechargé en mémoire avec succès !');
            res.json({ success: true, message: 'Modèle ML rechargé en mémoire avec succès !' });
        } else {
            res.status(500).json({ success: false, message: 'Échec du rechargement du modèle ML' });
        }
    } catch (error) {
        logger.error(`API Reload ML Error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

