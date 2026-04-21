import logger from '../../utils/logger.mjs';

export function errorHandler(err, req, res, next) {
    logger.error(`[SERVER ERROR] ${err.message}`);
    if (err.stack) {
        logger.error(err.stack);
    }

    const status = err.status || 500;
    const message = err.message || 'Erreur serveur interne';

    res.status(status).json({
        success: false,
        error: message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
}
