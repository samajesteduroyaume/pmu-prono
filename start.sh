#!/bin/bash

# Configuration des couleurs (Thème Matrix/PMU)
GREEN='\033[0;32m'
BRIGHT_GREEN='\033[1;32m'
GOLD='\033[0;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
PURPLE='\033[0;35m'
RESET='\033[0m'
BOLD='\033[1m'

# Nettoyage à l'arrêt
cleanup() {
    echo -e "\n${RED}[SHUTDOWN] Arrêt des processus PMU PRONO...${RESET}"
    # On cherche le PID du serveur tournant sur le port 3000
    PID=$(lsof -t -i:3000)
    if [ ! -z "$PID" ]; then
        kill $PID 2>/dev/null
        echo -e "${GREEN}[SYSTEM] Serveur arrêté proprement.${RESET}"
    fi
    echo -e "${CYAN}[SYSTEM] Fin de session. À bientôt.${RESET}"
    exit 0
}

# Capture du Ctrl+C
trap cleanup SIGINT

# Animation ASCII de démarrage
animate_loading() {
    local frames=("⠋" "⠙" "⠹" "⠸" "⠼" "⠴" "⠦" "⠧" "⠇" "⠏")
    echo -ne "${BRIGHT_GREEN}[SYSTEM] Initialisation des séquences neuronales... "
    for i in {1..20}; do
        echo -ne "\b${frames[i % 10]}"
        sleep 0.05
    done
    echo -e "\b [ OK ]${RESET}"
}

# Entête UI
show_header() {
    clear
    animate_loading
    echo -e "${BRIGHT_GREEN}"
    echo "  ██████╗ ███╗   ███╗██╗   ██╗    ██████╗ ██████╗  ██████╗ ███╗   ██╗ ██████╗ "
    echo "  ██╔══██╗████╗ ████║██║   ██║    ██╔══██╗██╔══██╗██╔═══██╗████╗  ██║██╔═══██╗"
    echo "  ██████╔╝██╔████╔██║██║   ██║    ██████╔╝██████╔╝██║   ██║██╔██╗ ██║██║   ██║"
    echo "  ██╔═══╝ ██║╚██╔╝██║██║   ██║    ██╔═══╝ ██╔══██╗██║   ██║██║╚██╗██║██║   ██║"
    echo "  ██║     ██║ ╚═╝ ██║╚██████╔╝    ██║     ██║  ██║╚██████╔╝██║ ╚████║╚██████╔╝"
    echo "  ╚═╝     ╚═╝     ╚═╝ ╚═════╝     ╚═╝     ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝ ╚═════╝ "
    echo -e "${RESET}"
    echo -e "${CYAN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ SYSTEM v27.2 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
    echo -e "${GOLD}           [ ARCHITECT - Moteur de Pronostics de Haute Précision ]            ${RESET}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
}

# --- DÉMARRAGE DU SCRIPT ---
show_header

# 1. Vérification Port 3000 (Nettoyage automatique au démarrage)
if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null ; then
    echo -e "${GOLD}[INFO] Un processus utilise déjà le port 3000 (Nettoyage...)${RESET}"
    kill -9 $(lsof -t -i:3000) 2>/dev/null
    sleep 1
fi

# 2. Vérification Data
if [ ! -d "data" ]; then
    echo -e "${CYAN}[SYSTEM] Création du dossier data...${RESET}"
    mkdir -p data
fi

# 3. Lancement
echo -e "${BRIGHT_GREEN}[LAUNCH] Initialisation d'Architect v26 Hybrid (ML)...${RESET}"
echo -e "${CYAN}[SERVER] Dashboard accessible sur: ${BOLD}http://localhost:3000${RESET}"
echo -e "${CYAN}[HINT] Appuyez sur ${RED}Ctrl+C${CYAN} pour arrêter proprement le PROGRAMME.${RESET}"
echo -e "------------------------------------------------------------"

# Lancement effectif
node src/server/app.mjs
