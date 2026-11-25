# Photothèque Bati Azur — https://photos.batiazurpiscine.fr

Appli iPhone (à ajouter sur l'écran d'accueil) pour déposer les photos et
vidéos des chantiers, avec une légende. Connexion : celle du hub.

- Chantiers : nom (privé, jamais publié) + commune (publique).
- Chaque fichier : étape (avant, terrassement, gros œuvre, revêtement, mise en
  eau, terminé, détail, entretien, équipe), légende, accord du client,
  statut (à publier / ne pas publier / publié).
- Les photos sont réduites dans le téléphone (2400 px, JPEG) : les données
  EXIF, dont la position GPS, disparaissent.
- Stockage : bucket R2 `photos-batiazur` (fichiers + `index.json`).

## Robot

`Authorization: Bearer <ROBOT_TOKEN>` :

- `GET /api/robot/index` : chantiers et fichiers ;
- `GET /api/robot/f/<clé>` : un fichier ;
- `POST /api/robot/publie` `{ "ids": [...], "lien": "..." }` : marque publié.

## Déployer

Par l'action GitHub « Photothèque — déployer » (secrets du dépôt :
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `PHOTOS_ROBOT_TOKEN`), ou :

    cd photos && npx wrangler r2 bucket create photos-batiazur
    npx wrangler deploy && npx wrangler secret put ROBOT_TOKEN
