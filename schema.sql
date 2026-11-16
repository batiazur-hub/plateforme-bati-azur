-- Portail Bati Azur : comptes, codes de reinitialisation, freins, trace.
-- Le mot de passe n'est jamais stocke : PBKDF2-SHA256, 100 000 tours, sel par compte.
CREATE TABLE IF NOT EXISTS comptes (
  email TEXT PRIMARY KEY,
  hash  TEXT NOT NULL DEFAULT '',   -- vide : mot de passe pas encore choisi
  sel   TEXT NOT NULL DEFAULT '',
  tours INTEGER NOT NULL DEFAULT 100000,
  maj   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS codes (
  email TEXT PRIMARY KEY,
  empreinte TEXT NOT NULL,
  expire INTEGER NOT NULL,
  essais INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tentatives (cle TEXT NOT NULL, quand INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS tentatives_cle ON tentatives(cle, quand);
CREATE TABLE IF NOT EXISTS securite (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quand TEXT NOT NULL DEFAULT (datetime('now')),
  email TEXT NOT NULL DEFAULT '', quoi TEXT NOT NULL, ip TEXT NOT NULL DEFAULT ''
);
INSERT OR IGNORE INTO comptes (email) VALUES ('bati.azur03@gmail.com');

-- App iPhone du Suivi : appareils abonnes aux notifications, et etat de la
-- tache planifiee (jour du dernier bilan, dernier contact signale).
CREATE TABLE IF NOT EXISTS abonnements (
  endpoint   TEXT PRIMARY KEY,
  abonnement TEXT NOT NULL,
  email      TEXT NOT NULL DEFAULT '',
  appareil   TEXT NOT NULL DEFAULT '',
  cree       TEXT NOT NULL DEFAULT (datetime('now')),
  maj        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS etat (cle TEXT PRIMARY KEY, valeur TEXT NOT NULL DEFAULT '');
