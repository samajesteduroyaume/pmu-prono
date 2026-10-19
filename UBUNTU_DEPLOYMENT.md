# Installation et exploitation sur Ubuntu

Parcours de déploiement recommandé : Ubuntu Server 22.04 ou 24.04 LTS, architecture x86_64, Node.js 20. Le projet utilise `sqlite3` et `@tensorflow/tfjs-node`, deux dépendances comportant des composants natifs. Cette cible réduit les incertitudes de compilation; si votre Ubuntu est ARM, vérifiez d’abord `npm ci` et le chargement du modèle sur la machine cible.

## 1. Installer les prérequis

Installez les outils système :

```sh
sudo apt update
sudo apt install -y ca-certificates curl build-essential python3 make g++ sqlite3
```

Installez Node.js 20 selon la méthode approuvée pour votre serveur, puis vérifiez `node --version` et `npm --version`. Dans une installation gérée par NodeSource, par exemple :

```sh
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

## 2. Installer et configurer le projet

Placez le dépôt dans un chemin stable, par exemple `/opt/pmu-prono`, attribuez-le à un utilisateur de service non privilégié, puis :

```sh
cd /opt/pmu-prono
npm ci --omit=dev
cp .env.example .env
```

Éditez `.env` si nécessaire. Le processus doit pouvoir écrire dans `data/` et dans tout répertoire utilisé par `DB_PATH`. Gardez les secrets dans un fichier lisible uniquement par l’utilisateur de service, hors du contrôle de version.

Les poids du modèle sont enregistrés dans `data/ml-model` par défaut indiqué dans `.env.example`. Ce dossier est ignoré par Git et doit rester sur un disque persistant. Pour systemd, `ReadWritePaths=/opt/pmu-prono/data` autorise déjà l’accès au répertoire par défaut. Docker Compose mappe aussi ce stockage sous `/app/data/ml-model`.

Avant d’exposer le service, faites un contrôle local :

```sh
npm test
```

Le démarrage du serveur lance une synchronisation PMU et les tâches planifiées; les tests ci-dessus n’en ont pas besoin. Les vérifications d’API PMU réelles sont facultatives et détaillées dans le README.

## 3. Lancer temporairement

```sh
npm start
```

Par défaut, l’application écoute sur `0.0.0.0:3000`. Depuis le serveur, vérifiez dans un autre terminal :

```sh
curl -i http://127.0.0.1:3000/
curl -i 'http://127.0.0.1:3000/api/courses?date=all&limit=1'
```

Pour un accès depuis le réseau, ouvrez uniquement le port nécessaire dans le pare-feu et limitez les sources selon votre configuration. `CORS_ORIGINS` est une politique d’origine navigateur, pas une authentification des API. Évitez d’exposer directement l’application à Internet sans proxy TLS et contrôles d’accès adaptés.

## 4. Créer un service systemd

Adaptez les chemins et le nom d’utilisateur à l’installation. Exemple `/etc/systemd/system/pmu-prono.service` :

```ini
[Unit]
Description=PMU Prono
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pmu-prono
Group=pmu-prono
WorkingDirectory=/opt/pmu-prono
EnvironmentFile=/opt/pmu-prono/.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/node /opt/pmu-prono/src/server/app.mjs
Restart=on-failure
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=60
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/opt/pmu-prono/data

[Install]
WantedBy=multi-user.target
```

Confirmez le chemin de Node avec `command -v node`. Si `DB_PATH` pointe ailleurs que `data/`, ajoutez ce répertoire à `ReadWritePaths`. Puis activez et vérifiez le service :

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now pmu-prono
sudo systemctl status pmu-prono
sudo journalctl -u pmu-prono -f
```

Le service appelle l’API PMU au démarrage et toutes les cinq minutes, programme une synchronisation quotidienne à 06:30 et un réentraînement le dimanche à 23:30 (heure locale du système). Prévoyez un accès réseau sortant, de l’espace disque, et surveillez les journaux.

## 5. Sauvegarder et mettre à jour

Sauvegardez régulièrement SQLite avec une méthode cohérente (par exemple `sqlite3 data/pmu.db ".backup 'data/pmu-backup.db'"`) et testez la restauration. Ne copiez pas simplement le fichier pendant des écritures actives sans procédure SQLite appropriée.

Pour une mise à jour : sauvegardez d’abord la base et `.env`, arrêtez le service, mettez à jour le code, installez les dépendances et redémarrez :

```sh
sudo systemctl stop pmu-prono
cd /opt/pmu-prono
git pull --ff-only
npm ci --omit=dev
sudo systemctl start pmu-prono
sudo journalctl -u pmu-prono -n 100 --no-pager
```

Ne lancez `git pull` que si ce répertoire est un clone Git et si la branche souhaitée est correctement configurée. Validez les migrations et les routes locales après chaque déploiement.

## Docker sur Ubuntu

Le dépôt inclut un `Dockerfile` et `docker-compose.yml`. Avec Docker Engine et le plugin Compose installés, utilisez `docker compose up -d --build`. Compose monte `./data` et publie le port 3000; consultez le README pour les limites de configuration et les journaux. Une seule méthode de supervision (systemd direct ou redémarrage Docker) suffit.
