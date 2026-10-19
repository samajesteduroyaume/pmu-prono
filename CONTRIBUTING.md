# Contribuer

Merci de contribuer à PMU Prono. Ce guide vise les changements de code, de données et de documentation.

## Préparer l’environnement

```sh
npm ci
cp .env.example .env
npm test
```

`npm test` utilise une base temporaire et ne démarre pas le serveur ni ses synchronisations planifiées. `npm run test:pmu` et `npm run test:pmu:history` interrogent l’API réelle : lancez-les seulement si vous voulez vérifier l’accès réseau et les données PMU. Ne confondez pas ces contrôles d’intégration avec une mesure de qualité prédictive.

## Cycle de changement

1. Créez une branche dédiée à partir de la branche de travail appropriée.
2. Gardez le changement ciblé et suivez le style du fichier voisin (ES modules, indentation généralement de quatre espaces, noms explicites).
3. Ajoutez ou adaptez les tests locaux pour une modification de comportement.
4. Mettez à jour le README ou le guide concerné si les commandes, routes, variables, schéma de données ou comportement observable changent.
5. Avant de proposer le changement, exécutez les vérifications pertinentes et indiquez clairement celles qui n’ont pas été exécutées.

Exemple de validation locale :

```sh
npm test
git diff --check
```

Les appels réseau PMU, la collecte historique volumineuse, le démarrage du serveur et les opérations système ont des effets externes ou des écritures : vérifiez leur portée et leur environnement avant de les lancer.

## Points d’attention métier

- N’affichez pas un score heuristique comme une probabilité calibrée sans calibration documentée.
- L’évaluation rétrospective doit s’appuyer sur les snapshots pris avant le départ et les résultats officiels. Ne régénérez pas un pronostic historique avec le code courant.
- Distinguez les courses réglées des courses en attente et exposez la couverture de l’échantillon.
- Ne publiez pas de chiffres de précision ou de ROI sans décrire le jeu de données, la période, le protocole, la taille d’échantillon et les limites.
- Gardez les secrets, bases locales, journaux sensibles et résultats personnels hors du dépôt.

## Documentation et commits

Rédigez la documentation en français, avec des commandes réellement définies par `package.json` et des routes effectivement montées dans `src/server/app.mjs`. Évitez les promesses de performance et les versions marketing non vérifiées.

Les messages de commit peuvent suivre une convention simple : `feat:`, `fix:`, `docs:`, `refactor:`, `test:` ou `chore:`. Dans une demande de fusion, résumez le problème, le comportement modifié, les vérifications exécutées et les limitations connues.
