# Journal des changements

Ce journal décrit les changements visibles dans le dépôt. Les anciennes notes de version contenaient des mesures de précision, des promesses de performance et des liens de publication qui ne sont pas accompagnés ici d’un protocole reproductible. Ces affirmations historiques ne sont pas reprises comme résultats validés.

## [Non publié]

### Ajouté

- Suite locale unifiée via `npm test` et commandes explicites pour les vérifications d’intégration PMU du jour et de dates historiques.
- Documentation d’installation, d’évaluation prospective, de configuration et de déploiement réécrite à partir du code et des commandes présents.
- Route `GET /api/ml/status` et avertissement sur le tableau de bord pour distinguer le modèle ML actif du repli heuristique.
- Garde de promotion des modèles évaluant le score hybride déployé (sortie ML recalibrée et mélangée à l’heuristique), face au pronostic archivé et au favori du marché sur au moins 100 courses complètes communes.
- Archivage du composant heuristique dans les snapshots pré-course afin que l’entraînement reproduise exactement le classement hybride de production.
- Correction des labels : les chevaux abandonnés ou disqualifiés après le départ restent dans le dataset comme partants; seuls les non-partants et forfaits sont exclus.
- Valeur terrain ML neutre quand la préférence ou le terrain de course est absent, au lieu de traiter deux valeurs manquantes comme une compatibilité maximale.
- Validation équilibrée au même prior que l’entraînement pour le callback d’arrêt anticipé; le jeu de test chronologique conserve la fréquence réelle des gagnants.
- Versionnement du schéma d’entrée des 15 variables et refus des modèles dont le schéma ne correspond plus au code courant.
- Versionnement également des vecteurs de features archivés; les anciennes captures restent disponibles à l’évaluation, mais ne sont pas mélangées au prochain entraînement.
- Stockage configurable des poids, avec chemin Docker persistant sous `data/ml-model` pour les conserver lors des reconstructions.

### Modifié

- L’entraînement utilise TensorFlow natif quand disponible, puis retombe sur TensorFlow.js pur JavaScript comme l’inférence.
- Les chevaux déclarés non-partants après la capture sont marqués et exclus de l’entraînement et des évaluations; le meilleur rang restant sert de choix de référence.
- Les tests locaux utilisent une base temporaire et couvrent plusieurs suites de régression.
- Les appels manuels à `syncHistoryPrompt` transmettent explicitement l’événement déclencheur.
- Corrections de fiabilité dans les assertions et nettoyages de tests, et de compatibilité de fuseau dans un test de dates.

### Vérification effectuée

- `npm test` : 7 suites réussies lors de la vérification locale documentée dans la session de travail.
- `npm run test:pmu` et `npm run test:pmu:history` : accès aux données PMU vérifié sur une série courante et des dates historiques.
- L’API et les pages ont aussi fait l’objet de contrôles HTTP/statique. Ces contrôles ne constituent pas une validation visuelle complète dans un navigateur.
- Une synchronisation réelle a alimenté des courses et partants pour la journée contrôlée; au moment du contrôle, les courses enregistrées étaient encore à courir. Le ROI prospectif réglé n’a donc pas pu être mesuré.

Les résultats ci-dessus sont un relevé ponctuel du dépôt/de la base de travail, pas une garantie que les mêmes commandes réussiront ultérieurement ou dans chaque environnement. Voir le README pour les limites et les commandes.

## Versions historiques

Les notes `v10` à `v15` ci-dessous existaient dans le journal précédent, mais aucune étiquette Git ou artefact de publication correspondant n’a été vérifié lors de cette réécriture. Les taux de précision, ROI et gains de performance anciennement associés à ces versions sont retirés car leur protocole n’est pas documenté.

- Les étapes historiques mentionnaient l’ajout progressif d’une base SQLite, d’une intégration PMU, d’une interface web, de filtres, de fonctions ML et financières.
- Consultez l’historique Git pour établir quand un changement précis a été introduit.
