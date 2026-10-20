# PMU Prono

Application de consultation et d’analyse des courses PMU, destinée à fonctionner sur Ubuntu. Elle récupère le programme auprès de l’API PMU, conserve les courses et les observations dans SQLite, calcule des scores heuristiques (et peut charger un modèle TensorFlow.js), puis expose une interface web et une API JSON.

Les scores sont des indicateurs expérimentaux, pas des probabilités garanties. Les anciennes mesures de précision ou de ROI présentes dans des notes de versions ne constituent pas une validation indépendante. L’évaluation prospective ne porte que sur les pronostics enregistrés avant le départ et dont le résultat officiel est ensuite disponible.

## Prérequis

- Ubuntu 22.04 ou 24.04 LTS recommandé, avec accès réseau sortant.
- Node.js 20 et npm.
- Outils de compilation nécessaires aux modules natifs SQLite3 et TensorFlow.js. Le conteneur fournit `python3`, `make`, `g++` et `sqlite3` comme base de compilation.

## Installation et démarrage

```sh
npm ci
cp .env.example .env
npm start
```

Ouvrir `http://localhost:3000`. L’application écoute sur `0.0.0.0`; configurez le pare-feu si elle est accessible depuis le réseau. La base par défaut est `data/pmu.db`.

**Au démarrage, le serveur initialise la base, charge le modèle disponible, puis lance une synchronisation PMU en arrière-plan.** Il répète la synchronisation toutes les cinq minutes, programme une synchronisation quotidienne à 06:30 et une tentative de réentraînement hebdomadaire le dimanche à 23:30 (heure locale du processus). Ces tâches font des appels réseau et écrivent dans la base. Pour exécuter des tests sans démarrer ces tâches, utilisez `npm test`.

Arrêt propre : `Ctrl+C` ou signal `SIGTERM`.

## Configuration

Copiez `.env.example` en `.env` et ajustez au besoin :

| Variable | Valeur par défaut | Usage |
|---|---|---|
| `PORT` | `3000` | Port HTTP |
| `NODE_ENV` | — | Environnement d’exécution |
| `DB_PATH` | `./data/pmu.db` | Fichier SQLite |
| `ML_MODEL_DIR` | `./data/ml-model` dans `.env.example` | Dossier des poids et métadonnées du modèle; doit être persistant et accessible en écriture |
| `CORS_ORIGINS` | vide | Origines web autorisées, séparées par des virgules; vide = même origine et requêtes sans en-tête Origin |
| `AGENT_API_KEY` | vide | Clé facultative de protection de l’API agent |
| `TELEGRAM_BOT_TOKEN` ou `TELEGRAM_TOKEN` | vide | Jeton facultatif pour les notifications |
| `TELEGRAM_CHAT_ID` | vide | Salon de notification Telegram |
| `LOG_LEVEL` | `info` | Niveau de journalisation si pris en charge par le logger |

Ne commitez pas `.env`, les jetons ou des données personnelles. Le chemin `DB_PATH` est résolu par le code de base de données; prévoyez un répertoire accessible en écriture et des sauvegardes SQLite cohérentes.

## Commandes

| Commande | Fonction |
|---|---|
| `npm start` | Serveur web, tâches planifiées et synchronisation live |
| `npm test` | Suite locale isolée avec base temporaire, sans appel PMU |
| `npm run test:pmu` | Vérification réseau/API PMU du jour; nécessite Internet et interroge le service réel |
| `npm run test:pmu:history` | Vérification API sur des dates historiques prédéfinies; nécessite Internet |

Lancez ces contrôles depuis la machine qui héberge l’application. Dans un environnement sans DNS sortant, `ENOTFOUND` signifie que le nom de domaine n’a pas été résolu localement; ce n’est pas une réponse de l’API PMU.
| `npm run sync` | Pipeline de synchronisation historique (consulter les journaux et le script avant une collecte volumineuse) |
| `npm run sync:month` / `sync:year` | Même pipeline sur la période indiquée par le script |

Les tests PMU valident l’accès aux données de l’API, pas le démarrage complet du serveur ni l’exactitude des pronostics. La collecte historique peut être longue et écrire beaucoup de données.

## Interface et API

Pages servies depuis `public/` : tableau de bord `/`, ainsi que `pepites.html`, `palmares.html`, `patterns.html`, `backtest.html` et `api.html`.

Routes principales (JSON sauf indication contraire) :

| Méthode et route | Fonction |
|---|---|
| `GET /api/courses` | Courses paginées; filtres `date` (`YYYY-MM-DD` ou `all`), `discipline`, `hippodrome`, `page`, `limit` (1–500) |
| `GET /api/courses/:id/participants` | Partants et données de la course |
| `POST /api/sync` | Synchronisation demandée; paramètres validés par l’API |
| `GET /api/alerts`, `/api/ml`, `/api/finance`, `/api/tuning`, `/api/agent` | Familles de fonctions spécialisées; consulter les routes dans `src/server/routes/` |
| `GET /api/ml/status` | Indique si le modèle ML est réellement chargé ou si le calcul utilise le repli heuristique |
| `GET /api/performance/forecast` | Évaluation prospective des snapshots et résultats réglés |
| `POST /api/backtest` | Évaluation selon les paramètres de la requête |

Routes de compatibilité supplémentaires (dont palmarès, tendances, patterns, valeur et performances) : voir `src/server/app.mjs`. Socket.IO émet notamment les mises à jour de synchronisation et de rechargement du modèle. Les corps et réponses détaillés restent définis par les validateurs et contrôleurs dans `src/server/`.

## Données, modèle et interprétation

- SQLite est initialisé/migré par l’application. Gardez une sauvegarde avant toute opération de maintenance.
- Le moteur combine des heuristiques métier et, si un modèle valide est disponible, une composante ML. En l’absence de modèle utilisable, un chemin heuristique de repli est disponible; l’interface de statut du modèle fait foi.
- L’entraînement demande au moins 120 courses prospectives réglées sur 30 dates, puis au moins 100 courses comparables dans le test chronologique commun. Seuls les snapshots à jour avec le schéma de variables courant sont utilisés; les anciens restent consultables, mais ne sont pas mélangés au nouvel entraînement. Le statut ML affiche aussi le nombre de courses admissibles dans le test, car atteindre le premier seuil ne suffit pas. Un candidat n’est installé que si le score hybride qu’il produirait en service bat le pronostic hybride archivé et le favori du marché en Top 1. Seuls les vrais non-partants sont exclus; un cheval ayant couru puis abandonné ou été disqualifié reste un partant. Ces contrôles limitent les promotions sur petit échantillon, sans garantir la rentabilité.
- Un historique de résultats seul ne permet pas de reconstruire un pronostic pré-course. Le tableau de bord d’évaluation exclut donc les courses sans snapshot enregistré à temps.
- Une synchronisation historique, même sur 180 jours, n’ajoute pas de snapshots pré-course pour les courses passées. Laissez le serveur démarré pour capturer les prochaines courses et associer ensuite leurs résultats; après une mise à jour du code, redémarrez-le pour appliquer les migrations.
- Les courses encore à courir restent en attente; elles ne comptent pas comme gagnées ou perdues. Les résultats non officiels ou manquants ne doivent pas être interprétés comme des pertes.
- Les mises ou portefeuilles sont des outils de simulation. Ne misez pas sur la seule base d’un score affiché.

## Déploiement sur Ubuntu

Consultez le [guide Ubuntu](UBUNTU_DEPLOYMENT.md) pour installer les prérequis, configurer systemd et gérer les sauvegardes. Le déploiement direct Node permet d’administrer explicitement l’environnement et les mises à jour.

## Déploiement Docker

Le dépôt fournit `Dockerfile` et `docker-compose.yml`, à lancer sur Ubuntu avec Docker Engine et le plugin Compose installés. Depuis la racine :

```sh
docker compose up -d --build
docker compose logs -f pmu-server
```

Le compose publie le port 3000 et monte `./data` dans `/app/data`. La base et le modèle entraîné (`/app/data/ml-model`) survivent ainsi aux reconstructions du conteneur. Il utilise actuellement `PORT=3000`; modifier le port hôte seul ne change pas le port interne. La politique `restart: always` redémarre le conteneur. Définissez les variables Telegram dans l’environnement ou un fichier `.env` local si elles sont nécessaires.

`scripts/setup_autostart.sh` peut activer ou créer un service système et requiert des droits élevés; lisez-le avant exécution. Ce n’est pas nécessaire avec le redémarrage Docker déjà configuré.

## Développement

Consultez [CONTRIBUTING.md](CONTRIBUTING.md), [le journal des changements](CHANGELOG.md) et [le guide Ubuntu](UBUNTU_DEPLOYMENT.md). Les notes de validation historiques sont dans `src/tests/`; elles sont distinctes des tests exécutables.

## Licence

MIT — voir [LICENSE](LICENSE).
