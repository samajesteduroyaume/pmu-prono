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

Une base fraîche peut donc ne montrer aucun résultat réglé et afficher surtout des courses en attente. Une telle sortie signifie que l’échantillon prospectif est insuffisant, pas que le système a fait zéro gagnant. Consultez les compteurs de couverture, réglés et en attente avant d’interpréter tout taux ou ROI.

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

Les deux dernières commandes nécessitent Internet et ne testent pas la qualité prédictive. Les commandes et limites d’exploitation sont détaillées dans le README principal.
