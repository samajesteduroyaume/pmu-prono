# Changelog

Toutes les modifications notables de ce projet seront documentées dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/).

---

## [v15.0.0] - 2026-02-07

### 🚀 Ajouté

- **Machine Learning** : IA v15 avec TensorFlow.js (91% accuracy)
- **Pagination API** : Réduction de 17 Mo → 100 Ko par requête
- **Bankroll Management** : Kelly Criterion pour optimisation des mises
- **Progressive Web App** : Manifest + Service Worker
- **Table paris_historique** : Tracking complet des paris et ROI
- **Module Hybride** : Combinaison 70% ML + 30% Heuristiques v14

### ⚡ Amélioré

- **Performance** : Temps de chargement 5s → <500ms (-90%)
- **API** : Filtrage par date, discipline, hippodrome
- **Frontend** : Contrôles de pagination (Précédent/Suivant)

### 📚 Documentation

- README.md complet avec badges et exemples
- CONTRIBUTING.md pour les contributeurs
- LICENSE (MIT)
- Walkthrough technique détaillé

---

## [v14.0.0] - 2026-02-06

### 🚀 Ajouté

- **IA v14** : Spécialisation par discipline (Trot/Plat/Obstacle)
- **Poids dynamiques** : Adaptation automatique selon le type de course
- **Analyse Musique** : Affinement de la notation de forme

### ⚡ Amélioré

- **Précision** : +10% grâce aux poids spécialisés
- **Migration BDD** : Recalcul de 204 913 participants

---

## [v13.0.0] - 2026-02-05

### 🚀 Ajouté

- **Analyse Expert** : Détection changement de catégorie
- **Équipements** : Prise en compte œillères et ferrage
- **Régularité** : Indicateur % Top 3 carrière

### ⚡ Amélioré

- **Dashboard** : Graphiques de performance
- **UI** : Design glassmorphism premium

---

## [v12.0.0] - 2026-02-04

### 🚀 Ajouté

- **Arrivées Officielles** : Intégration résultats PMU
- **Rapports** : Affichage des gains (Simple, Couplé, Trio...)
- **Win Rate** : Calcul automatique de la précision IA

---

## [v11.0.0] - 2026-02-03

### 🚀 Ajouté

- **Transition API Pure** : Suppression de Playwright
- **Collecte 1 an** : Pipeline historique complet
- **Dashboard Web** : Interface premium avec Chart.js

### 🗑️ Supprimé

- Dépendance Playwright
- Scripts de scraping obsolètes

---

## [v10.0.0] - 2026-01-15

### 🚀 Ajouté

- **IA Architect v10** : Première version avec heuristiques
- **Base SQLite** : Stockage structuré des données
- **API PMU** : Intégration directe

---

[v15.0.0]: https://github.com/votre-username/pmu-prono/releases/tag/v15.0.0
[v14.0.0]: https://github.com/votre-username/pmu-prono/releases/tag/v14.0.0
[v13.0.0]: https://github.com/votre-username/pmu-prono/releases/tag/v13.0.0
[v12.0.0]: https://github.com/votre-username/pmu-prono/releases/tag/v12.0.0
[v11.0.0]: https://github.com/votre-username/pmu-prono/releases/tag/v11.0.0
[v10.0.0]: https://github.com/votre-username/pmu-prono/releases/tag/v10.0.0
