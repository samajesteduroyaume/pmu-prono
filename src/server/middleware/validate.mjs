import logger from '../../utils/logger.mjs';

/**
 * Middleware Express générique pour valider la requête via un schéma Zod
 * @param {import('zod').ZodSchema} schema 
 * @param {'body' | 'query' | 'params'} source 
 */
export function validate(schema, source = 'query') {
    return (req, res, next) => {
        try {
            const dataToValidate = req[source] || {};
            const result = schema.safeParse(dataToValidate);

            if (!result.success) {
                logger.warn(`[Validation Error] ${req.method} ${req.originalUrl} - Source: ${source}`);
                return res.status(400).json({
                    success: false,
                    error: 'Validation Error',
                    details: result.error.format()
                });
            }

            // Express 5 compatibility: Override req.query, req.params, or req.body safely
            Object.defineProperty(req, source, {
                value: result.data,
                writable: true,
                configurable: true,
                enumerable: true
            });

            next();
        } catch (err) {
            logger.error(`[Validate Middleware Error]: ${err.message}`);
            return res.status(500).json({ success: false, error: 'Internal Validation Error' });
        }
    };
}

