import NodeCache from 'node-cache';
import logger from './logger.mjs';

// Configuration du cache : décalage par défaut de 10 minutes (600s)
const appCache = new NodeCache({ stdTTL: 600, checkperiod: 120 });

export const cache = {
    /**
     * Récupère une valeur du cache
     */
    get: (key) => {
        const value = appCache.get(key);
        if (value) {
            logger.info(`[CACHE] Hit: ${key}`);
            return value;
        }
        return null;
    },

    /**
     * Stocke une valeur dans le cache
     */
    set: (key, value, ttl = 600) => {
        logger.info(`[CACHE] Set: ${key} (TTL: ${ttl}s)`);
        return appCache.set(key, value, ttl);
    },

    /**
     * Supprime une clé du cache
     */
    del: (key) => {
        logger.info(`[CACHE] Delete: ${key}`);
        return appCache.del(key);
    },

    /**
     * Vide tout le cache
     */
    flush: () => {
        logger.warn(`[CACHE] Flushing all data`);
        return appCache.flushAll();
    },

    /**
     * Génère une clé composite
     */
    generateKey: (...args) => args.join(':')
};

export default cache;
