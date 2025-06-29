# PMU API - Système de Récupération de Données

Système modulaire pour récupérer, traiter et analyser les données de courses PMU.

## 🏗️ Structure du Projet

```
pmu-api/
├── src/
│   ├── core/           # Modules principaux
│   │   ├── fetcher.mjs     # Récupération des données
│   │   ├── processor.mjs   # Traitement des données
│   │   ├── filter.mjs      # Filtrage des données
│   │   └── db.mjs          # Gestion de la base de données
│   ├── pipelines/      # Scripts de traitement
│   │   ├── pipeline_1week.mjs
│   │   ├── pipeline_1month.mjs
│   │   ├── pipeline_4months.mjs
│   │   └── pipeline_6months.mjs
│   ├── utils/          # Utilitaires
│   │   ├── dateUtils.mjs   # Gestion des dates
│   │   └── logger.mjs      # Système de logging
│   ├── config/         # Configuration
│   │   └── settings.mjs    # Paramètres centralisés
│   └── tests/          # Tests et debug
├── data/               # Données et base SQLite
├── docs/               # Documentation
├── examples/           # Exemples d'utilisation
└── tests/              # Tests unitaires
```

## 🚀 Utilisation

### Installation
```bash
npm install
```

### Exécution des Pipelines

**1 Semaine de données :**
```bash
node src/pipelines/pipeline_1week.mjs
```

**1 Mois de données :**
```bash
node src/pipelines/pipeline_1month.mjs
```

**4 Mois de données :**
```bash
node src/pipelines/pipeline_4months.mjs
```

**6 Mois de données :**
```bash
node src/pipelines/pipeline_6months.mjs
```

### Scripts de Test
```bash
# Test de connexion
node src/tests/test_connection.mjs

# Test des dates
node src/tests/test_dates.mjs

# Debug du filtre
node src/tests/debug_filter.mjs
```

## 📊 Fonctionnalités

- **Récupération automatique** des données PMU via Playwright
- **Filtrage intelligent** des courses par discipline et validité
- **Stockage SQLite** avec gestion d'erreurs
- **Traitement modulaire** des données brutes
- **Logging centralisé** avec niveaux d'information
- **Configuration centralisée** pour tous les paramètres

## 🔧 Configuration

Tous les paramètres sont centralisés dans `src/config/settings.mjs` :

- **Disciplines** : TROT, PLAT, OBSTACLE, STEEPLECHASE, HAIE, MONTE, ATTELE
- **Base de données** : Chemin et paramètres de connexion
- **Récupération** : Tentatives, délais, timeouts
- **Périodes** : Définitions des durées (semaine, mois, etc.)

## 📈 Données Récupérées

Chaque course contient :
- Date et heure de départ
- Hippodrome
- Discipline
- Distance
- Statut
- Nombre de partants
- Prix
- Numéros de réunion et course

## 🛠️ Développement

### Ajouter un nouveau pipeline
1. Créer un fichier dans `src/pipelines/`
2. Importer les modules nécessaires
3. Utiliser les utilitaires de date et logging
4. Suivre le pattern des pipelines existants

### Modifier la configuration
Éditer `src/config/settings.mjs` pour ajuster :
- Disciplines à récupérer
- Paramètres de base de données
- Options de filtrage

## 📝 Logs

Le système utilise un logger centralisé avec :
- ✅ Succès
- ⚠️ Avertissements  
- ❌ Erreurs
- ℹ️ Informations
- 📊 Progression

## 🔒 Base de Données

- **Format** : SQLite
- **Emplacement** : `data/pmu.db`
- **Sauvegarde** : `data/backup/`
- **Table** : `courses` avec tous les champs des courses 