# PMU Elite Punter - Documentation ARCHITECT v27.1

Bienvenue dans la version **v27.1 (Architect)**. Le système a été entièrement refactorisé pour être piloté par une configuration centralisée, éliminant les boucles de rétroaction ML obsolètes et unifiant les heuristiques métier.

## ⚙️ Configuration Centrale : `src/config/settings.mjs`

Toute l'intelligence et la gestion des risques du système se pilotent désormais depuis ce fichier.

### 🏇 Moteurs de Discipline (`engine_settings`)
Quatre moteurs spécialisés gèrent les spécificités de chaque course :
- **ARCHITECT-ATTELÉ** : Focus sur la régularité et le ferrage.
- **ARCHITECT-MONTÉ** : Focus sur l'aptitude au trot monté.
- **ARCHITECT-GALOP** : Focus sur la décharge et le poids.
- **ARCHITECT-OBSTACLE** : Focus sur la sécurité et le "Shield".

### 💰 Gestion Financière (`finance`)
- `kelly_fraction` : Fraction du capital à miser (défaut: 0.25 pour un "Quarter-Kelly" sécurisé).
- `max_bet_percent` : Plafond de mise par course (défaut: 0.05 soit 5% du capital).
- `bankroll_default` : Portefeuille fictif utilisé si aucun solde réel n'est détecté.

### 🚨 Surveillance & Alertes (`monitoring`)
- `alert_drawdown_critical` : Seuil de perte à partir duquel le système recommande un arrêt (0.20 = 20%).
- `alert_lose_streak_critical` : Nombre de défaites consécutives déclenchant une alerte.
- `alert_momentum_ultra` : Score de forme globale du système.

## 🚀 Utilisation des Outils

### Synchronisation
Le nouveau `Sync Manager` sépare la récupération des données de la logique serveur.
- `node src/scripts/sync.mjs --days 7` : Synchronisation historique.
- Le serveur (`app.mjs`) utilise désormais des routes simplifiées via `sync_manager.mjs`.

### Backtesting
Le moteur de backtest est désormais aligné sur vos paramètres financiers réels.
- `node src/ml/backtest.mjs [DATE_DEBUT] [DATE_FIN]`
- Permet de comparer les stratégies Kelly (Statique vs Adaptatif) avec vos propres seuils.

### Entraînement IA
- `node src/ml/train.mjs`
- Entraîne le modèle TensorFlow.js avec une architecture optimisée [128, 64, 32, 1].

---
*Documentation générée par Antigravity pour la version Architect v27.1.*
