#!/bin/bash

# Couleurs pour le terminal
GOLD='\033[0;33m'
CYAN='\033[0;36m'
GREEN='\033[0;32m'
RESET='\033[0m'

clear
echo -e "${GOLD}"
echo "  ██████╗ ███╗   ███╗██╗   ██╗    ███████╗██╗     ██╗████████╗███████╗"
echo "  ██╔══██╗████╗ ████║██║   ██║    ██╔════╝██║     ██║╚══██╔══╝██╔════╝"
echo "  ██████╔╝██╔████╔██║██║   ██║    █████╗  ██║     ██║   ██║   █████╗  "
echo "  ██╔═══╝ ██║╚██╔╝██║██║   ██║    ██╔══╝  ██║     ██║   ██║   ██╔══╝  "
echo "  ██║     ██║ ╚═╝ ██║╚██████╔╝    ███████╗███████╗██║   ██║   ███████╗"
echo "  ╚═╝     ╚═╝     ╚═╝ ╚═════╝     ╚══════╝╚══════╝╚═╝   ╚═╝   ╚══════╝"
echo -e "${RESET}"

echo -e "${CYAN}------------------------------------------------------------${RESET}"
echo -e "${GOLD}           ELITE PUNTER - SYSTÈME D'ANALYSE IA V13          ${RESET}"
echo -e "${CYAN}------------------------------------------------------------${RESET}"

# Vérification du dossier data
if [ ! -d "data" ]; then
    echo -e "${CYAN}[SYSTEM] Création du dossier data...${RESET}"
    mkdir -p data
fi

# Démarrage du serveur
echo -e "${GREEN}[SERVER] Lancement du Dashboard sur http://localhost:3000...${RESET}"
node src/server/app.mjs
