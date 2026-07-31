import express from 'express';
import * as agentController from '../controllers/agentController.mjs';

const router = express.Router();

// GET /api/agent/status - État du système
router.get('/status', agentController.getAgentStatus);

// POST /api/agent/command - Contrôle à distance par l'IA
router.post('/command', agentController.executeAgentCommand);

// GET /api/agent/schema - Schéma OpenAPI / Function Calling pour LLMs
router.get('/schema', agentController.getAgentSchema);

export default router;
