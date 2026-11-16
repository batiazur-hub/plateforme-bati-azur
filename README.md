# Portail et hub Bâti Azur — https://batiazurpiscine.fr

Un seul Worker Cloudflare (`hub-batiazur`) :

- **Connexion** par adresse mail et mot de passe (`/connexion`), que Chrome
  peut enregistrer. Mot de passe stocké en PBKDF2 (100 000 tours, sel par
  compte) dans la base D1 `portail-batiazur`. Cinq erreurs en 15 minutes
  bloquent l'adresse 15 minutes.
- **Mot de passe oublié / première connexion** (`/oubli`) : un code à
  6 chiffres part de `noreply@batiazurpiscine.fr` (Cloudflare Email
  Routing), valable 15 minutes, cinq essais.
- **Le hub** sous `/hub/` (fichiers dans `public/hub/`).
- **La garde des outils** : `suivi.`, `pro.`, `bons.`, `implantation.`
  sont rattachés à ce Worker, qui vérifie la session puis transmet la requête
  à l'outil par liaison de service, avec l'en-tête `x-portail`.
  Restent ouverts sans session : les liens de confirmation des clients
  (`suivi…/c/…`) et les routes du robot (`/api/depot`, `/api/repondu`,
  `/api/courrier…`, protégées par leur jeton).

La session (cookie `portail`, 30 jours) vaut pour le domaine et ses
sous-domaines. Changer de mot de passe déconnecte tous les appareils.

`index.html` à la racine ne sert qu'à rediriger l'ancienne adresse GitHub
Pages vers le nouveau hub.

## Déployer

    npx wrangler deploy

Secrets : `SECRET_SESSION` (sessions et codes), `SECRET_PORTAIL` (le même
que sur `suivi-clients`). Ajouter un compte :

    npx wrangler d1 execute portail-batiazur --remote --command "INSERT INTO comptes (email) VALUES ('adresse@exemple.fr')"

puis passer par « Mot de passe oublié » pour choisir son mot de passe. Pour
envoyer le code à une nouvelle adresse, l'ajouter à
`allowed_destination_addresses` et la vérifier dans Email Routing.
