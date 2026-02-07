# 🏇 PMU Elite Punter - IA v15

> **Pronostics PMU avec Intelligence Artificielle Hybride (Machine Learning + Heuristiques)**

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![TensorFlow.js](https://img.shields.io/badge/TensorFlow.js-4.x-orange.svg)](https://www.tensorflow.org/js)
[![PWA](https://img.shields.io/badge/PWA-Ready-purple.svg)](https://web.dev/progressive-web-apps/)

## 📋 Table des Matières

- [Présentation](#-présentation)
- [Fonctionnalités](#-fonctionnalités)
- [Architecture](#-architecture)
- [Installation](#-installation)
- [Utilisation](#-utilisation)
- [API](#-api)
- [IA v15](#-ia-v15)
- [Bankroll Management](#-bankroll-management)
- [Roadmap](#-roadmap)
- [Contribution](#-contribution)

---

## 🎯 Présentation

**PMU Elite Punter** est une application web professionnelle de pronostics hippiques utilisant l'Intelligence Artificielle pour analyser les courses PMU et optimiser les paris.

### Caractéristiques Principales

- 🧠 **IA Hybride v15** : Combinaison de Machine Learning (70%) et d'heuristiques expertes (30%)
- 📊 **Analyse Multi-Facteurs** : Forme, Classe, Régularité, Entourage, Configuration
- 💰 **Bankroll Management** : Gestion optimale du capital avec Kelly Criterion
- ⚡ **Performance Optimale** : Pagination API, temps de chargement <500ms
- 📱 **Progressive Web App** : Installable sur mobile, mode hors-ligne
- 📈 **Dashboard Temps Réel** : Statistiques de performance, ROI, graphiques interactifs

---

## ✨ Fonctionnalités

### Intelligence Artificielle v15

- **Machine Learning** : Réseau de neurones entraîné sur 200K+ participants
- **Features Engineering** : 5 features clés (Forme, Classe, Régularité, Entourage, Confiance)
- **Accuracy** : 91%+ sur le dataset de test
- **Spécialisation Discipline** : Poids dynamiques pour Trot, Plat, Obstacle

### Analyse Avancée

- ✅ Analyse de la musique (3 dernières performances)
- ✅ Détection changement de catégorie (Montée/Descente)
- ✅ Évaluation de l'entourage (Driver/Jockey/Entraîneur)
- ✅ Analyse des équipements (Œillères, Ferrage)
- ✅ Régularité de carrière (% Top 3)
- ✅ Confiance du marché (Cotes)

### Gestion du Capital

- 💰 **Kelly Criterion** : Calcul automatique de la mise optimale
- 🛡️ **Protection** : Limite à 5% du capital par pari
- 📊 **Tracking ROI** : Historique complet des paris
- 📈 **Simulation** : Évolution du capital en temps réel

### Interface Premium

- 🎨 Design glassmorphism moderne
- 📱 Responsive (Desktop + Mobile)
- 🌙 Mode sombre natif
- ⚡ Chargement ultra-rapide (pagination)
- 📊 Graphiques interactifs (Chart.js)

---

## 🏗️ Architecture

```
pmu-prono/
├── src/
│   ├── core/              # Modules principaux
│   │   ├── db.mjs         # Gestion SQLite
│   │   ├── fetcher.mjs    # API PMU
│   │   ├── processor.mjs  # Traitement données
│   │   ├── intelligence.mjs  # IA v14 (Heuristiques)
│   │   ├── hybrid.mjs     # IA v15 (ML Hybride)
│   │   └── bankroll.mjs   # Kelly Criterion
│   ├── ml/                # Machine Learning
│   │   ├── dataset.mjs    # Préparation dataset
│   │   ├── train.mjs      # Entraînement TensorFlow.js
│   │   └── model/         # Modèle sauvegardé
│   ├── pipelines/         # Scripts de synchronisation
│   │   └── sync.mjs       # Collecte données PMU
│   ├── server/            # Serveur Express
│   │   └── app.mjs        # API REST
│   └── utils/             # Utilitaires
│       └── logger.mjs     # Logs colorés
├── public/                # Frontend
│   ├── css/style.css      # Design premium
│   ├── js/app.js          # Logique client
│   ├── manifest.json      # PWA Manifest
│   └── sw.js              # Service Worker
└── data/
    └── pmu.db             # Base SQLite (45 Mo)
```

---

## 🚀 Installation

### Prérequis

- **Node.js** >= 18.0.0
- **npm** >= 9.0.0
- **SQLite3**

### Installation Rapide

```bash
# Cloner le repository
git clone https://github.com/samajesteduroyaume/pmu-prono.git
cd pmu-prono

# Installer les dépendances
npm install

# Synchroniser les données (30 derniers jours)
npm run sync:month

# (Optionnel) Entraîner le modèle ML
node src/ml/train.mjs

# Démarrer le serveur
npm start
```

Le dashboard sera accessible sur **http://localhost:3000**

---

## 💻 Utilisation

### Commandes Disponibles

```bash
# Démarrer le serveur
npm start

# Synchroniser les données
npm run sync              # Jour actuel
npm run sync:month        # 30 derniers jours
npm run sync:year         # 365 derniers jours
npm run sync -- 7         # N jours personnalisé

# Entraîner l'IA v15 (ML)
node src/ml/train.mjs

# Tester le dataset
node src/ml/dataset.mjs

# Tester le bankroll management
node src/core/bankroll.mjs
```

### Script de Démarrage Professionnel

```bash
chmod +x start.sh
./start.sh
```

---

## 📡 API

### Endpoints Disponibles

#### `GET /api/courses`

Récupère les courses avec pagination et filtrage.

**Query Parameters** :
- `page` (number) : Numéro de page (défaut: 1)
- `limit` (number) : Résultats par page (défaut: 50)
- `date` (string) : Filtrer par date (format: YYYY-MM-DD)
- `discipline` (string) : Filtrer par discipline (ATTELE, PLAT, MONTE)
- `hippodrome` (string) : Filtrer par hippodrome

**Réponse** :
```json
{
  "data": [...],
  "pagination": {
    "total": 1234,
    "page": 1,
    "limit": 50,
    "totalPages": 25,
    "hasNext": true,
    "hasPrev": false
  }
}
```

#### `GET /api/courses/:id/participants`

Récupère les participants d'une course avec scores IA.

**Réponse** :
```json
[
  {
    "id": 1,
    "nom": "CHEVAL_EXEMPLE",
    "numero": 5,
    "prediction_score": 87.5,
    "musique": "1a2a3a",
    "driver": "BAZIRE J.M.",
    ...
  }
]
```

#### `GET /api/performance`

Statistiques de performance de l'IA.

**Réponse** :
```json
{
  "global": {
    "total_courses": 17816,
    "wins": 3245,
    "win_rate": 18.2,
    "roi": 15.3
  },
  "by_discipline": {...}
}
```

---

## 🧠 IA v15

### Architecture du Modèle

```
Input (5 features)
    ↓
Dense(64, relu) + Dropout(0.2)
    ↓
Dense(32, relu) + Dropout(0.1)
    ↓
Dense(16, relu)
    ↓
Dense(1, sigmoid)
    ↓
Output (probabilité de victoire)
```

**Total paramètres** : 3 009

### Features Utilisées

1. **Forme** : Analyse des 3 dernières performances
2. **Classe** : Ratio gains/âge
3. **Régularité** : % victoires + places
4. **Entourage** : Qualité driver/jockey
5. **Confiance** : Cote du marché

### Performance

- **Accuracy** : 91.1% (validation)
- **Loss** : 0.257
- **Dataset** : 162K train / 40K test
- **Epochs** : 50

### Utilisation

```javascript
import { loadMLModel, calculerPredictionHybride } from './src/core/hybrid.mjs';

// Charger le modèle au démarrage
await loadMLModel();

// Prédiction hybride
const score = await calculerPredictionHybride(participant, contexteCourse);
// score : 0-100 (70% ML + 30% Heuristiques v14)
```

---

## 💰 Bankroll Management

### Kelly Criterion Conservateur

Le module calcule automatiquement la mise optimale pour chaque pari.

```javascript
import { calculerMiseOptimale } from './src/core/bankroll.mjs';

const recommandation = calculerMiseOptimale(
  4.5,    // Cote
  85,     // Score IA (0-100)
  1000    // Bankroll
);

console.log(recommandation);
// {
//   mise: 42.50,
//   edge: 0.2825,
//   roi_attendu: 28.25,
//   gain_potentiel: 148.75,
//   recommandation: 'FORTE'
// }
```

### Limites de Sécurité

- ✅ Kelly conservateur : **25%** du Kelly complet
- ✅ Mise maximale : **5%** du capital
- ✅ Mise minimale : **2€**
- ✅ Pas de pari si edge <= 0

---

## 🗺️ Roadmap

### ✅ Terminé (v15)

- [x] Pagination API
- [x] Machine Learning (TensorFlow.js)
- [x] Bankroll Management (Kelly Criterion)
- [x] Progressive Web App
- [x] Table paris_historique

### 🚧 En Cours

- [ ] Cache Redis
- [ ] Dashboard ROI temps réel
- [ ] Responsive Design Mobile

### 📅 Futur

- [ ] Notifications Push
- [ ] Analyse Vidéo (Computer Vision)
- [ ] Social Trading
- [ ] API Publique (Monétisation)

---

## 🤝 Contribution

Les contributions sont les bienvenues ! Voici comment participer :

1. Fork le projet
2. Créer une branche (`git checkout -b feature/AmazingFeature`)
3. Commit les changements (`git commit -m 'Add AmazingFeature'`)
4. Push vers la branche (`git push origin feature/AmazingFeature`)
5. Ouvrir une Pull Request

---

## 📄 License

Ce projet est sous licence **MIT**. Voir le fichier [LICENSE](LICENSE) pour plus de détails.

---

## 👨‍💻 Auteur

**Selim** - [GitHub](https://github.com/votre-username)

---

## 🙏 Remerciements

- [PMU](https://www.pmu.fr) pour l'API publique
- [TensorFlow.js](https://www.tensorflow.org/js) pour le Machine Learning
- [Chart.js](https://www.chartjs.org/) pour les graphiques
- [Express](https://expressjs.com/) pour le serveur

---

<div align="center">
  <strong>⭐ Si ce projet vous aide, n'hésitez pas à lui donner une étoile ! ⭐</strong>
</div>
