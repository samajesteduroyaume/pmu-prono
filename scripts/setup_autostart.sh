#!/bin/bash
set -eo pipefail

# Configuration du redémarrage automatique pour PMU Prono sur Freebox OS VM

GREEN='\033[0;32m'
GOLD='\033[0;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
RESET='\033[0m'

echo -e "${CYAN}============================================================${RESET}"
echo -e "${GOLD}   PMU PRONO - CONFIGURATION DU REDÉMARRAGE AUTOMATIQUE     ${RESET}"
echo -e "${CYAN}============================================================${RESET}"

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$( dirname "$SCRIPT_DIR" )"

# Option 1: Docker Compose (plugin v2 or legacy standalone)
COMPOSE_CMD=()
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD=(docker-compose)
fi

if [ ${#COMPOSE_CMD[@]} -gt 0 ] && [ -f "$PROJECT_DIR/docker-compose.yml" ]; then
    echo -e "${GREEN}[DOCKER] Activation du service Docker au démarrage système...${RESET}"
    sudo systemctl enable docker 2>/dev/null || true
    cd "$PROJECT_DIR"
    "${COMPOSE_CMD[@]}" -f "$PROJECT_DIR/docker-compose.yml" up -d
    echo -e "${GREEN}[OK] Docker configuré avec 'restart: always'. Le conteneur redémarrera avec la VM.${RESET}"
    exit 0
fi

# Option 2: PM2
if command -v pm2 >/dev/null 2>&1; then
    echo -e "${GREEN}[PM2] Configuration du démarrage via PM2...${RESET}"
    cd "$PROJECT_DIR"
    if pm2 describe pmu-prono >/dev/null 2>&1; then
        pm2 restart pmu-prono --update-env
    else
        pm2 start src/server/app.mjs --name "pmu-prono" --max-memory-restart 1024M
    fi
    pm2 save
    pm2 startup
    echo -e "${GREEN}[OK] PM2 est configuré. N'oubliez pas d'exécuter la commande sudo générée par 'pm2 startup'.${RESET}"
    exit 0
fi

# Option 3: Systemd
if command -v systemctl >/dev/null 2>&1; then
    echo -e "${GREEN}[SYSTEMD] Création du service systemd pmu-prono.service...${RESET}"
    NODE_PATH="$(which node)"
    CURRENT_USER="$(whoami)"
    
    SERVICE_FILE="/etc/systemd/system/pmu-prono.service"
    
    cat <<EOF | sudo tee "$SERVICE_FILE" > /dev/null
[Unit]
Description=PMU Prono - Moteur de Pronostics IA
After=network.target

[Service]
Type=simple
User=$CURRENT_USER
WorkingDirectory=$PROJECT_DIR
ExecStart=$NODE_PATH --max-old-space-size=1024 src/server/app.mjs
Restart=always
RestartSec=10
Environment=NODE_ENV=production PORT=3000

[Install]
WantedBy=multi-user.target
EOF

    sudo systemctl daemon-reload
    sudo systemctl enable pmu-prono
    sudo systemctl start pmu-prono
    echo -e "${GREEN}[OK] Service Systemd pmu-prono.service créé et activé avec succès !${RESET}"
    exit 0
fi

echo -e "${RED}[ERROR] Impossible de détecter Docker, PM2 ou Systemd sur ce système.${RESET}"
