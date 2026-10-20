# Architecture et configuration métier

Ce fichier remplace l’ancienne note « Architect v27 », devenue obsolète. La version affichée dans la bannière du serveur et les anciens noms de versions ne garantissent ni une architecture figée ni une métrique de qualité. Pour installer et lancer l’application, utilisez le [README principal](README.md).

## Organisation actuelle

- `src/server/` : application Express, routes, contrôleurs, validation et gestion d’erreurs.
- `src/core/` : synchronisation, calculs métier, génération de scores et évaluation.
- `src/db/` : accès SQLite et migrations.
- `src/pipelines/` : collecte et tâches de traitement hors requêtes web.
- `src/tests/` : tests locaux et vérifications réseau explicites.
- `public/` : pages HTML, CSS et JavaScript du navigateur.
- `src/config/settings.mjs` : poids heuristiques par discipline, paramètres financiers et seuils internes.

## Calcul des scores

Les poids de configuration sont des paramètres de calcul, pas des coefficients de confiance ni des probabilités calibrées. Le moteur applique des règles spécialisées selon la discipline et peut incorporer une sortie TensorFlow.js si un modèle compatible est présent. La valeur configurée `mlWeight` est un réglage du calcul, elle ne prouve pas la performance hors échantillon. En l’absence de modèle chargeable, le serveur garde un chemin de repli heuristique.

Les valeurs de score, filtres « value » et calculs de bankroll sont des aides expérimentales. Une cote observée, une arrivée officielle, la version du modèle et les données disponibles au moment du pronostic doivent être conservées pour une évaluation reproductible.

## Évaluation prospective

`GET /api/performance/forecast` évalue des pronostics capturés avant le départ lorsque les résultats sont disponibles. Les courses sans snapshot restent exclues, même si l’arrivée a été enregistrée plus tard : recalculer leur score avec le code actuel créerait une fuite d’information et ne mesurerait pas le pronostic réellement présenté.

La synchronisation des 180 derniers jours importe les courses et leurs résultats, mais ne crée pas rétroactivement de snapshots pré-course. Pour constituer l’échantillon ML, laissez le serveur à jour démarré : il synchronise le programme au démarrage, toutes les cinq minutes et le matin à 06:30, puis règle les snapshots avec les arrivées officielles. Le réentraînement est tenté le dimanche à 23:30. Après une mise à jour du code, redémarrez le serveur afin qu’il applique les migrations; seules les courses futures capturées avec le schéma actuel seront admissibles au nouvel entraînement.

Les chevaux déclarés non-partants après la capture sont marqués au règlement puis exclus de l’entraînement et des comparaisons. Si le premier choix est forfait, l’évaluation utilise le meilleur rang restant parmi les partants.

Une base fraîche peut donc ne montrer aucun résultat réglé et afficher surtout des courses en attente. Une telle sortie signifie que l’échantillon prospectif est insuffisant, pas que le système a fait zéro gagnant. Consultez les compteurs de couverture, réglés et en attente avant d’interpréter tout taux ou ROI.

L’entraînement exige 120 courses prospectives réglées sur au moins 30 dates, puis un test chronologique commun d’au moins 100 courses comparables. Le statut `GET /api/ml/status` expose le nombre réel de courses de test comparables, car le premier seuil ne garantit pas que le test sera assez grand. Seuls les vrais non-partants sont exclus : abandon et disqualification restent des résultats de chevaux partants. La promotion évalue le score hybride qui serait réellement déployé : sortie ML recalibrée sur la fréquence de gagnants, puis mélangée au score heuristique avec les poids configurés. Les snapshots archivent donc aussi le composant heuristique. Le candidat n’est installé que si son Top 1 hybride dépasse à la fois le pronostic archivé et le favori du marché sur les mêmes courses complètes. En cas d’échec ou d’échantillon insuffisant, les poids existants sont conservés. Les poids sans provenance vérifiable restent désactivés.

Chaque modèle et snapshot pré-course enregistre également la version du schéma de ses 15 variables. Le chargement refuse les poids entraînés avec une version incompatible, et le prochain dataset d’entraînement écarte les anciennes captures dont la signification des variables diffère du code courant.

## Paramètres utiles

Les valeurs réelles sont définies dans `src/config/settings.mjs`; ce résumé ne doit pas servir de configuration indépendante. On y trouve notamment :

- `weights` : poids des critères heuristiques par discipline;
- `architect.hybride` : partage configuré entre composantes heuristique et ML;
- `engine_settings.finance` : fraction Kelly, plafond et seuil d’edge;
- `engine_settings.monitoring` : seuils internes d’alerte;
- `engine_settings.value_hunter` : filtres de sélection expérimentaux.

Avant de modifier ces paramètres, vérifiez où ils sont lus et couverts par les tests. Changez un facteur à la fois et évaluez sur des snapshots prospectifs arrivés à maturité; ne concluez pas à partir d’un score d’entraînement.

## Vérifications

```sh
npm test                 # tests locaux isolés
npm run test:pmu         # requête réelle à l’API PMU du jour
npm run test:pmu:history # requêtes réelles sur les dates incluses dans le script
```

Exécutez les vérifications réseau depuis le serveur cible. `ENOTFOUND` indique un échec de résolution DNS dans l’environnement qui lance le test et ne prouve pas que l’API PMU est indisponible.

Les deux dernières commandes nécessitent Internet et ne testent pas la qualité prédictive. Les commandes et limites d’exploitation sont détaillées dans le README principal.
