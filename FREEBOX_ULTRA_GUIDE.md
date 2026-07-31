# 📡 Guide d'Installation & Déploiement sur Freebox Ultra (ARM64 / Freebox OS)

Ce guide détaille l'installation et l'exécution optimisée du système **PMU-Prono** sur votre **Freebox Ultra** (Processeur Qualcomm IPQ9574 ARM64 Cortex-A73, 4 Go RAM).

---

## ⚡ 1. Résumé de la Compatibilité & Adaptations Effectuées

L'architecture matérielle de la Freebox Ultra (ARM64 Linux) a été prise en compte avec les optimisations suivantes :

1. **Chargeur TensorFlow.js Universel (ARM64 / Pure JS)** :
   - Les binaires C++ natifs `@tensorflow/tfjs-node` ne sont pré-compilés que pour x86_64.
   - Nous avons implémenté un **`IOHandler` Node.js purement JavaScript** dans `src/core/hybrid.mjs`.
   - **Résultat** : Le modèle ML (XP / XGBoost / Neural Net) se charge instantanément sur la Freebox Ultra sans aucune dépendance C++ externe.

2. **Optimisation Empreinte Mémoire (RAM)** :
   - La Freebox Ultra alloue généralement entre 512 Mo et 1.5 Go à une VM ou conteneur LXC/Docker.
   - Le serveur Node.js est configuré avec `--max-old-space-size=1024` pour garantir qu'il n'excède jamais 1 Go de RAM et évite tout crash OOM (*Out Of Memory*).

3. **Compatibilité SQLite3 & Persistance** :
   - La base de données SQLite `data/pmu.db` est conservée sur stockage persistent (NVMe / USB 3.0 Freebox).

---

## 🐳 Option A : Déploiement via Docker (Recommandé sur Freebox OS)

La Freebox Ultra gère nativement les conteneurs via Docker ou Docker Compose dans une VM LXC.

### Étape 1 : Copie du projet sur le disque Freebox
Placez le dossier du projet `pmu-prono` sur votre stockage Freebox (ex: `/disque1/docker/pmu-prono`).

### Étape 2 : Lancement avec Docker Compose
Dans le terminal de la VM Freebox :
```bash
cd /disque1/docker/pmu-prono
docker-compose up -d --build
```

Le serveur sera accessible sur le réseau local à l'adresse :
`http://mafreebox.freebox.fr:3000` ou `http://<IP_DE_VOTRE_FREEBOX>:3000`

---

## 🖥️ Option B : Déploiement Direct Node.js (VM Debian / LXC sur Freebox)

Si vous utilisez une VM Debian/Ubuntu ou Alpine sur Freebox OS :

### Étape 1 : Installer Node.js v20 (ARM64)
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs build-essential python3
```

### Étape 2 : Installer les dépendances & lancer
```bash
cd pmu-prono
npm install --only=production
chmod +x start.sh
./start.sh
```

---

## 🤖 Option C : Lancement du Studio Agent Mistral (`api-pmu-prono`)

Le module `api-pmu-prono` sur le port `3005` communique directement avec le serveur sur le port `3000`.

Pour le lancer sur la Freebox Ultra :
```bash
cd ../api-pmu-prono
npm install
npm start
```

Accès Web Studio Agent : `http://<IP_FREEBOX>:3005`

---

## 📊 Vérification du Fonctionnement sur Freebox Ultra

Une fois démarré, vérifiez le bon fonctionnement via terminal :
```bash
curl http://localhost:3000/api/agent/status
```

Réponse attendue :
```json
{
  "status": "online",
  "mlModelLoaded": true,
  "dbConnected": true
}
```
