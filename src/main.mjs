import { CONFIG } from './config/settings.mjs';
import logger from './utils/logger.mjs';

logger.header('PMU API - SYSTÈME DE RÉCUPÉRATION DE DONNÉES');
logger.info('Structure réorganisée avec succès !');
logger.info('Modules disponibles:');
logger.info('- src/core/: Modules principaux (fetcher, processor, db, filter)');
logger.info('- src/pipelines/: Scripts de traitement par période');
logger.info('- src/utils/: Utilitaires (dates, logging)');
logger.info('- src/config/: Configuration centralisée');
logger.info('- src/tests/: Scripts de test et debug');

logger.info('\nPour exécuter un pipeline:');
logger.info('node src/pipelines/pipeline_1week.mjs');
logger.info('node src/pipelines/pipeline_1month.mjs');
logger.info('node src/pipelines/pipeline_4months.mjs');
logger.info('node src/pipelines/pipeline_6months.mjs');

logger.info('\nPour tester la connexion:');
logger.info('node src/tests/test_connection.mjs');

logger.info('\nConfiguration actuelle:');
logger.table(CONFIG); 