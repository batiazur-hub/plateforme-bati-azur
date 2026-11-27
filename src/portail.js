/**
 * Portail Bati Azur — https://batiazurpiscine.fr
 *
 * Une seule connexion (adresse mail + mot de passe) ouvre le hub et tous les
 * outils internes. Le cookie de session vaut pour batiazurpiscine.fr et ses
 * sous-domaines ; les outils recoivent les requetes par liaison de service,
 * apres verification, avec l'en-tete x-portail qui leur dit « deja connecte ».
 *
 * Mot de passe oublie : un code a 6 chiffres part par mail
 * (noreply@batiazurpiscine.fr, Cloudflare Email Routing), valable 15 minutes.
 */
import { EmailMessage } from "cloudflare:email";

import { routeApp, planifie } from "./app.js";
import { routeHeures } from "./heures.js";

const DOMAINE = "batiazurpiscine.fr";
const COOKIE = "portail";
const DUREE = 60 * 60 * 24 * 30;          // 30 jours
const TOURS = 100000;                     // maximum accepte par PBKDF2 dans les Workers
const MIN_MDP = 12;
const CODE_VALIDITE = 15 * 60 * 1000;

// Outils proteges : sous-domaine -> liaison de service.
const OUTILS = { suivi: "SUIVI", pro: "PRO", bons: "BONS", implantation: "IMPLANTATION" };

// Ce qui reste ouvert sans session : les liens de confirmation envoyes aux
// clients, et les routes du robot (protegees par leur propre jeton).
const OUVERT = {
  suivi: [/^\/(manifest\.webmanifest|sw\.js|icone-(192|512)\.png|favicon\.svg)$/, /^\/c\/[0-9a-f]{32}$/, /^\/api\/depot$/, /^\/api\/repondu$/, /^\/api\/echanges$/, /^\/api\/courrier(\/.*)?$/],
};

/* ---------------------------------------------------------------- outils */

const enc = new TextEncoder();
const hex = b => [...new Uint8Array(b)].map(o => o.toString(16).padStart(2, "0")).join("");
const deHex = h => new Uint8Array(h.match(/../g).map(x => parseInt(x, 16)));
const adresse = v => String(v || "").trim().toLowerCase();
const ip = r => r.headers.get("cf-connecting-ip") || "";
const echapper = t => String(t ?? "").replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function signer(valeur, secret) {
  const cle = await crypto.subtle.importKey("raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", cle, enc.encode(valeur)));
}

function egales(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let e = 0;
  for (let i = 0; i < a.length; i++) e |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return e === 0;
}

async function hacher(mdp, selHex, tours = TOURS) {
  const cle = await crypto.subtle.importKey("raw", enc.encode(mdp), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: deHex(selHex), iterations: tours }, cle, 256));
}

function mdpRefuse(mdp, email) {
  if (mdp.length < MIN_MDP) return `Le mot de passe doit faire au moins ${MIN_MDP} caractères.`;
  if (mdp.length > 200) return "Mot de passe trop long.";
  const types = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(r => r.test(mdp)).length;
  if (types < 3) return "Mélangez au moins trois types : minuscules, majuscules, chiffres, symboles.";
  if (mdp.toLowerCase().includes(email.split("@")[0])) return "Le mot de passe ne doit pas contenir l'adresse mail.";
  return "";
}

/** Freins : vrai si la limite d'essais est atteinte sur la fenetre. */
async function freine(env, cle, max, fenetre) {
  await env.DB.prepare("DELETE FROM tentatives WHERE quand < ?").bind(Date.now() - 86400000).run();
  const { n } = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM tentatives WHERE cle = ? AND quand > ?")
    .bind(cle, Date.now() - fenetre).first();
  return n >= max;
}
const noter = (env, cle) =>
  env.DB.prepare("INSERT INTO tentatives (cle, quand) VALUES (?, ?)").bind(cle, Date.now()).run();
const tracer = (env, email, quoi, r) =>
  env.DB.prepare("INSERT INTO securite (email, quoi, ip) VALUES (?, ?, ?)").bind(email, quoi, ip(r)).run();

/* -------------------------------------------------------------- sessions */

/** La signature depend de l'empreinte du mot de passe : en changer
 *  deconnecte tous les appareils ouverts avec l'ancien. */
async function jeton(env, email, hash) {
  const emis = String(Date.now());
  return `${email}|${emis}|${await signer(`${email}|${emis}|${hash.slice(0, 16)}`, env.SECRET_SESSION)}`;
}
const cookie = (valeur, duree = DUREE) =>
  `${COOKIE}=${encodeURIComponent(valeur)}; Domain=${DOMAINE}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${duree}`;

async function session(requete, env) {
  const brut = (requete.headers.get("cookie") || "").split(/;\s*/).find(c => c.startsWith(COOKIE + "="));
  if (!brut) return null;
  const [email, emis, sig] = decodeURIComponent(brut.slice(COOKIE.length + 1)).split("|");
  if (!email || !emis || !sig || Date.now() - Number(emis) > DUREE * 1000) return null;
  const c = await env.DB.prepare("SELECT hash FROM comptes WHERE email = ?").bind(email).first();
  if (!c || !c.hash) return null;
  return egales(sig, await signer(`${email}|${emis}|${c.hash.slice(0, 16)}`, env.SECRET_SESSION)) ? email : null;
}

/** Adresse de retour apres connexion : seulement chez nous. */
/** Nouveau cookie si la session a plus d'un jour : un appareil utilise
 *  regulierement reste connecte. "" sinon. */
async function renouvellement(requete, env) {
  const brut = (requete.headers.get("cookie") || "").split(/;\s*/).find(c => c.startsWith(COOKIE + "="));
  if (!brut) return "";
  const [email, emis] = decodeURIComponent(brut.slice(COOKIE.length + 1)).split("|");
  if (Date.now() - Number(emis) < 864e5) return "";
  const c = await env.DB.prepare("SELECT hash FROM comptes WHERE email = ?").bind(email).first();
  return c && c.hash ? cookie(await jeton(env, email, c.hash)) : "";
}

/** Remplace les icones d'une page d'outil par celles de Bati Azur : une
 *  seule famille d'icones pour tous les outils, sans toucher a leur code. */
function iconesBatiAzur(reponse) {
  if (!(reponse.headers.get("content-type") || "").includes("text/html")) return reponse;
  const v = "?v=2";
  return new HTMLRewriter()
    .on('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]', { element: e => e.remove() })
    .on("head", { element: e => e.append(
      `<link rel="icon" type="image/png" sizes="32x32" href="/__bati/icone-32.png${v}">` +
      `<link rel="icon" type="image/png" sizes="192x192" href="/__bati/icone-192.png${v}">` +
      `<link rel="apple-touch-icon" sizes="180x180" href="/__bati/icone-180.png${v}">`, { html: true }) })
    .on("body", { element: e => e.append(`<script src="https://${DOMAINE}/lanceur.js" defer></script>`, { html: true }) })
    .transform(reponse);
}

/** Ajoute le moteur de rendu GPU a la page de l'Implantation. Le numero de
 *  version est dans l'adresse : le service worker de l'outil garde ses
 *  fichiers en cache sans limite, une nouvelle version doit donc changer d'URL. */
const RENDU_IMPLANTATION = "1.2";
function renduImplantation(reponse) {
  if (!(reponse.headers.get("content-type") || "").includes("text/html")) return reponse;
  return new HTMLRewriter()
    .on("body", { element: e => e.append(`<script src="/rendu-gl.js?v=${RENDU_IMPLANTATION}"></script>`, { html: true }) })
    .transform(reponse);
}

function retourSur(valeur) {
  try {
    const u = new URL(valeur);
    if (u.protocol === "https:" && (u.hostname === DOMAINE || u.hostname.endsWith("." + DOMAINE))) return u.href;
  } catch {}
  return `https://${DOMAINE}/hub/`;
}

/* ----------------------------------------------------------------- mail */

async function envoyerCode(env, email, code) {
  const de = `noreply@${DOMAINE}`;
  const b64 = t => btoa(String.fromCharCode(...enc.encode(t)));
  const texte =
`Bonjour,

Voici le code pour choisir un nouveau mot de passe sur le portail Bati Azur :

    ${code}

Il est valable 15 minutes.

Si vous n'avez rien demandé, ignorez ce message : votre mot de passe actuel reste valable.

— Portail Bati Azur · https://${DOMAINE}/hub/`;
  const brut = [
    `From: =?UTF-8?B?${b64("Bati Azur")}?= <${de}>`,
    `To: <${email}>`,
    `Subject: =?UTF-8?B?${b64(`Code de réinitialisation : ${code}`)}?=`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${DOMAINE}>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64(texte).match(/.{1,76}/g).join("\r\n"),
  ].join("\r\n");
  await env.MAIL.send(new EmailMessage(de, email, brut));
}

/* ---------------------------------------------------------------- pages */

const ENTETES = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
  "x-robots-tag": "noindex",
};

function page(titre, contenu, statut = 200, extra = {}) {
  return new Response(`<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${echapper(titre)} — Bâti Azur</title>
<link rel="icon" href="/hub/favicon-32x32.png?v=2"><link rel="apple-touch-icon" href="/hub/apple-touch-icon.png?v=2">
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",Arial,sans-serif;color:#1c1c1e;
  background:radial-gradient(circle at 20% 10%,#dcecff 0,transparent 45%),radial-gradient(circle at 85% 90%,#e3f6ff 0,transparent 40%),#f4f8fd}
.carte{width:100%;max-width:400px;background:rgba(255,255,255,.88);backdrop-filter:blur(20px);border:1px solid rgba(15,79,163,.1);
  border-radius:22px;padding:32px 28px;box-shadow:0 20px 50px rgba(15,79,163,.12)}
.marque{display:flex;align-items:center;gap:12px;margin-bottom:22px}
.marque img{width:44px;height:44px;border-radius:12px}
.marque b{display:block;font-size:17px}.marque span{font-size:13px;color:#6e6e73}
h1{font-size:23px;margin:0 0 6px;letter-spacing:-.02em}p{color:#3a3a3c;font-size:14.5px;line-height:1.5;margin:0 0 18px}
label{display:block;font-size:13px;font-weight:600;color:#3a3a3c;margin:14px 0 6px}
input{width:100%;padding:13px 14px;font:inherit;font-size:16px;border:1px solid #d6dde6;border-radius:12px;background:#fff;color:inherit}
input:focus{outline:none;border-color:#0A84FF;box-shadow:0 0 0 3px rgba(10,132,255,.15)}
button{width:100%;margin-top:20px;padding:14px;font:inherit;font-size:16px;font-weight:700;color:#fff;border:0;border-radius:12px;
  background:linear-gradient(135deg,#0F4FA3,#0A84FF);cursor:pointer}
.lien{display:block;text-align:center;margin-top:16px;font-size:14px;color:#0A84FF;text-decoration:none;font-weight:600}
.erreur{background:#fff0ef;color:#c62a20;border-radius:10px;padding:10px 12px;font-size:14px;margin:0 0 6px}
.info{background:#eef6ff;color:#0F4FA3;border-radius:10px;padding:10px 12px;font-size:14px;margin:0 0 6px}
.aide{font-size:12.5px;color:#6e6e73;margin-top:6px}
</style></head><body><main class="carte">
<div class="marque"><img src="/hub/apple-touch-icon.png?v=2" alt=""><div><b>Bâti Azur Hub</b><span>Plateforme interne</span></div></div>
${contenu}</main></body></html>`, { status: statut, headers: { ...ENTETES, ...extra } });
}

const msg = (texte, genre = "erreur") => texte ? `<div class="${genre}">${echapper(texte)}</div>` : "";

function pageConnexion(retour, erreur = "", info = "", email = "") {
  return page("Connexion", `<h1>Connexion</h1>
<p>Accès réservé à l'équipe Bâti Azur.</p>
${msg(info, "info")}${msg(erreur)}
<form method="post" action="/connexion">
  <input type="hidden" name="retour" value="${echapper(retour)}">
  <label for="email">Adresse e-mail</label>
  <input id="email" name="email" type="email" autocomplete="username" required value="${echapper(email)}">
  <label for="mdp">Mot de passe</label>
  <input id="mdp" name="motdepasse" type="password" autocomplete="current-password" required>
  <button type="submit">Se connecter</button>
</form>
<a class="lien" href="/oubli?email=${encodeURIComponent(email)}">Mot de passe oublié ou première connexion ?</a>`, erreur ? 401 : 200);
}

function pageOubli(email = "", erreur = "") {
  return page("Mot de passe oublié", `<h1>Mot de passe oublié</h1>
<p>Indiquez votre adresse : un code à 6 chiffres vous sera envoyé par mail pour choisir un nouveau mot de passe.</p>
${msg(erreur)}
<form method="post" action="/oubli">
  <label for="email">Adresse e-mail</label>
  <input id="email" name="email" type="email" autocomplete="username" required value="${echapper(email)}">
  <button type="submit">Recevoir un code</button>
</form>
<a class="lien" href="/connexion">Retour à la connexion</a>`);
}

function pageCode(email, erreur = "") {
  return page("Nouveau mot de passe", `<h1>Nouveau mot de passe</h1>
<p>Si un compte existe pour <b>${echapper(email)}</b>, un code vient d'y être envoyé (pensez aux indésirables). Il est valable 15 minutes.</p>
${msg(erreur)}
<form method="post" action="/oubli/code">
  <input type="email" name="email" autocomplete="username" value="${echapper(email)}" readonly hidden>
  <label for="code">Code reçu par mail</label>
  <input id="code" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required>
  <label for="n1">Nouveau mot de passe</label>
  <input id="n1" name="nouveau" type="password" autocomplete="new-password" minlength="${MIN_MDP}" required>
  <label for="n2">Confirmer le mot de passe</label>
  <input id="n2" name="confirmation" type="password" autocomplete="new-password" minlength="${MIN_MDP}" required>
  <div class="aide">12 caractères minimum, avec au moins trois types parmi minuscules, majuscules, chiffres et symboles. Chrome peut en proposer un et l'enregistrer.</div>
  <button type="submit">Enregistrer et se connecter</button>
</form>
<a class="lien" href="/oubli?email=${encodeURIComponent(email)}">Renvoyer un code</a>`, erreur ? 400 : 200);
}

const rediriger = (vers, extra = {}) =>
  new Response(null, { status: 303, headers: { location: vers, "cache-control": "no-store", ...extra } });

/* ------------------------------------------------------- authentification */

async function connexion(requete, env) {
  const f = await requete.formData();
  const email = adresse(f.get("email")), mdp = String(f.get("motdepasse") || "");
  const retour = retourSur(f.get("retour"));
  const cle = "connexion:" + email;
  if (!email || !mdp) return pageConnexion(retour, "Adresse ou mot de passe incorrect.", "", email);
  if (await freine(env, cle, 5, 15 * 60 * 1000))
    return pageConnexion(retour, "Trop d'essais. Réessayez dans 15 minutes, ou utilisez « Mot de passe oublié ».", "", email);
  const c = await env.DB.prepare("SELECT hash, sel, tours FROM comptes WHERE email = ?").bind(email).first();
  // Meme sans compte, on calcule une empreinte : la reponse prend le meme
  // temps et ne revele pas quelles adresses existent.
  const calcule = await hacher(mdp, c && c.sel ? c.sel : "00".repeat(16), c ? c.tours : TOURS);
  if (!c || !c.hash || !egales(calcule, c.hash)) {
    await noter(env, cle);
    await tracer(env, email, "echec_connexion", requete);
    return pageConnexion(retour, c && !c.hash
      ? "Aucun mot de passe n'a encore été choisi : utilisez « Mot de passe oublié ou première connexion »."
      : "Adresse ou mot de passe incorrect.", "", email);
  }
  await env.DB.prepare("DELETE FROM tentatives WHERE cle = ?").bind(cle).run();
  await tracer(env, email, "connexion", requete);
  return rediriger(retour, { "set-cookie": cookie(await jeton(env, email, c.hash)) });
}

async function oubli(requete, env) {
  const f = await requete.formData();
  const email = adresse(f.get("email"));
  if (!email) return pageOubli("", "Indiquez votre adresse e-mail.");
  if (await freine(env, "oubli:" + email, 3, 60 * 60 * 1000) ||
      await freine(env, "oubli-ip:" + ip(requete), 10, 60 * 60 * 1000))
    return pageOubli(email, "Trop de demandes. Réessayez dans une heure.");
  await noter(env, "oubli:" + email);
  await noter(env, "oubli-ip:" + ip(requete));
  const c = await env.DB.prepare("SELECT email FROM comptes WHERE email = ?").bind(email).first();
  if (c) {
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
    await env.DB.prepare(
      `INSERT INTO codes (email, empreinte, expire, essais) VALUES (?, ?, ?, 0)
       ON CONFLICT(email) DO UPDATE SET empreinte = excluded.empreinte, expire = excluded.expire, essais = 0`)
      .bind(email, await signer(`code|${email}|${code}`, env.SECRET_SESSION), Date.now() + CODE_VALIDITE).run();
    try {
      await envoyerCode(env, email, code);
      await tracer(env, email, "code_envoye", requete);
    } catch (e) {
      console.error("envoi du code", e && e.message);
      return pageOubli(email, "Le mail n'a pas pu partir. Réessayez dans un instant.");
    }
  }
  // Meme page que l'adresse existe ou non.
  return pageCode(email);
}

async function nouveauMdp(requete, env) {
  const f = await requete.formData();
  const email = adresse(f.get("email")), code = String(f.get("code") || "").trim();
  const mdp = String(f.get("nouveau") || ""), conf = String(f.get("confirmation") || "");
  const ligne = await env.DB.prepare("SELECT empreinte, expire, essais FROM codes WHERE email = ?").bind(email).first();
  if (!ligne || ligne.expire < Date.now() || ligne.essais >= 5)
    return pageCode(email, "Code expiré ou trop d'essais : demandez-en un nouveau.");
  if (!/^\d{6}$/.test(code) || !egales(await signer(`code|${email}|${code}`, env.SECRET_SESSION), ligne.empreinte)) {
    await env.DB.prepare("UPDATE codes SET essais = essais + 1 WHERE email = ?").bind(email).run();
    return pageCode(email, "Code incorrect.");
  }
  if (mdp !== conf) return pageCode(email, "Les deux mots de passe ne sont pas identiques.");
  const refus = mdpRefuse(mdp, email);
  if (refus) return pageCode(email, refus);
  const sel = hex(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await hacher(mdp, sel);
  await env.DB.prepare("UPDATE comptes SET hash = ?, sel = ?, tours = ?, maj = datetime('now') WHERE email = ?")
    .bind(hash, sel, TOURS, email).run();
  await env.DB.prepare("DELETE FROM codes WHERE email = ?").bind(email).run();
  await env.DB.prepare("DELETE FROM tentatives WHERE cle = ?").bind("connexion:" + email).run();
  await tracer(env, email, "mot_de_passe_change", requete);
  return rediriger(`https://${DOMAINE}/hub/`, { "set-cookie": cookie(await jeton(env, email, hash)) });
}

/* --------------------------------------------------------------- routage */

export default {
  async fetch(requete, env) {
    const url = new URL(requete.url);
    const hote = url.hostname;
    const chemin = url.pathname;

    // Un en-tete x-portail venu de l'exterieur ne doit jamais passer.
    const propre = new Headers(requete.headers);
    for (const k of [...propre.keys()]) if (k.startsWith("x-portail")) propre.delete(k);

    if (hote === DOMAINE) {
      if (chemin === "/" ) return rediriger("/hub/");
      if (chemin === "/connexion") {
        if (requete.method === "POST") return connexion(requete, env);
        if (await session(requete, env)) return rediriger(retourSur(url.searchParams.get("retour")));
        return pageConnexion(retourSur(url.searchParams.get("retour")), "",
          url.searchParams.get("sortie") ? "Vous êtes déconnecté." : "");
      }
      if (chemin === "/oubli") {
        if (requete.method === "POST") return oubli(requete, env);
        return pageOubli(adresse(url.searchParams.get("email")));
      }
      if (chemin === "/oubli/code" && requete.method === "POST") return nouveauMdp(requete, env);
      if (chemin === "/deconnexion") return rediriger("/connexion?sortie=1", { "set-cookie": cookie("", 0) });
      // App iPhone du Suivi (voir app.js).
      if (chemin === "/app" || chemin.startsWith("/app/")) {
        const qui = await session(requete, env);
        return routeApp(new Request(requete, { headers: propre }), env, qui, () => renouvellement(requete, env));
      }
      // Lanceur des outils (bouton a 4 points) et ses icones : publics, ils
      // sont charges depuis les outils heberges ailleurs (GitHub, Terrain).
      if (chemin === "/lanceur.js" || chemin === "/modeles-mail.js" || /^\/icones-outils\/png\/[a-z]+-\d+\.png$/.test(chemin)) {
        const r = await env.ASSETS.fetch(requete);
        const h = new Headers(r.headers);
        h.set("cache-control", chemin.endsWith(".js") ? "public, max-age=3600" : "public, max-age=604800");
        h.set("access-control-allow-origin", "*");
        return new Response(r.body, { status: r.status, headers: h });
      }
      // Logos de la marque (publics : utilises dans les mails envoyes aux clients).
      if (/^\/marque\/logo-(blanc|bleu|noir)(-480)?\.png$/.test(chemin)) {
        const r = await env.ASSETS.fetch(requete);
        const h = new Headers(r.headers);
        h.set("cache-control", "public, max-age=86400");
        h.set("access-control-allow-origin", "*");
        return new Response(r.body, { status: r.status, headers: h });
      }
      // Icones du hub, utilisees aussi par les pages de connexion.
      if (/^\/hub\/(favicon[^/]*|apple-touch-icon\.png|android-chrome-[^/]+\.png)$/.test(chemin))
        return env.ASSETS.fetch(requete);
      // Installation du hub comme application (Chrome) : le manifeste et le
      // service worker sont lus sans cookie, ils doivent etre publics.
      if (chemin === "/hub/site.webmanifest" || chemin === "/hub/sw.js" || chemin === "/installer.js") {
        const r = await env.ASSETS.fetch(requete);
        const h = new Headers(r.headers);
        if (chemin.endsWith(".webmanifest")) h.set("content-type", "application/manifest+json");
        h.set("cache-control", "no-cache");
        if (chemin === "/installer.js") h.set("access-control-allow-origin", "*");
        return new Response(r.body, { status: r.status, headers: h });
      }

      const qui = await session(requete, env);
      if (!qui) return rediriger(`/connexion?retour=${encodeURIComponent(url.href)}`);
      const r = await env.ASSETS.fetch(new Request(requete, { headers: propre }));
      const h = new Headers(r.headers);
      h.set("cache-control", "private, no-store");
      return new Response(r.body, { status: r.status, headers: h });
    }

    // Analyse piscine : publique (clients). Relais tel quel, sauf les icones.
    if (hote === `analyse.${DOMAINE}`) {
      const ICONES_ANALYSE = {
        "/favicon.ico": ["analyse.ico", "image/x-icon"],
        "/favicon.svg": ["analyse.svg", "image/svg+xml"],
        "/favicon-16x16.png": ["analyse-16.png", "image/png"],
        "/favicon-32x32.png": ["analyse-32.png", "image/png"],
        "/apple-touch-icon.png": ["analyse-180.png", "image/png"],
        "/android-chrome-192x192.png": ["analyse-192.png", "image/png"],
        "/android-chrome-512x512.png": ["analyse-512.png", "image/png"],
      };
      const ic = ICONES_ANALYSE[chemin];
      if (ic) {
        const r = await env.ASSETS.fetch(new Request(`https://${DOMAINE}/icones-outils/png/${ic[0]}`));
        return new Response(r.body, { status: r.status, headers: { "content-type": ic[1], "cache-control": "public, max-age=86400" } });
      }
      return env.ANALYSE.fetch(requete);
    }

    const sous = hote.endsWith("." + DOMAINE) ? hote.slice(0, -DOMAINE.length - 1) : "";

    // Relevé d'heures : servi par le portail lui-même, données dans sa base (heures.js).
    if (sous === "heures") {
      const ic = chemin.match(/^\/__bati\/icone-(32|180|192|512)\.png$/) ||
                 (/^\/(favicon\.ico|apple-touch-icon(-precomposed)?\.png)$/.test(chemin) ? [0, chemin.includes("apple") ? 180 : 32] : null);
      if (ic) {
        const r = await env.ASSETS.fetch(new Request(`https://${DOMAINE}/icones-outils/png/heures-${ic[1]}.png`));
        return new Response(r.body, { status: r.status, headers: { "content-type": "image/png", "cache-control": "public, max-age=604800" } });
      }
      const qui = await session(requete, env);
      if (!qui) {
        const accepte = requete.headers.get("accept") || "";
        if (requete.method === "GET" && accepte.includes("text/html"))
          return rediriger(`https://${DOMAINE}/connexion?retour=${encodeURIComponent(url.href)}`);
        return new Response(JSON.stringify({ erreur: "non connecte" }),
          { status: 401, headers: { "content-type": "application/json" } });
      }
      return iconesBatiAzur(await routeHeures(requete, env, qui, chemin));
    }

    const outil = env[OUTILS[sous]];
    if (!outil) return new Response("Introuvable", { status: 404 });

    // Icones Bati Azur de l'outil (novembre 2026), servies par le portail.
    const icone = chemin.match(/^\/__bati\/icone-(32|180|192|512)\.png$/);
    if (icone) {
      const r = await env.ASSETS.fetch(new Request(`https://${DOMAINE}/icones-outils/png/${sous}-${icone[1]}.png`));
      return new Response(r.body, { status: r.status, headers: { "content-type": "image/png", "cache-control": "public, max-age=604800" } });
    }
    if (/^\/(favicon\.ico|apple-touch-icon(-precomposed)?\.png)$/.test(chemin)) {
      const r = await env.ASSETS.fetch(new Request(`https://${DOMAINE}/icones-outils/png/${sous}-${chemin.includes("apple") ? 180 : 32}.png`));
      return new Response(r.body, { status: r.status, headers: { "content-type": "image/png", "cache-control": "public, max-age=604800" } });
    }

    if ((OUVERT[sous] || []).some(r => r.test(chemin)))
      return outil.fetch(new Request(requete, { headers: propre }));

    const qui = await session(requete, env);
    if (!qui) {
      // Une page web : on renvoie vers la connexion. Une requete de l'appli : 401.
      const accepte = requete.headers.get("accept") || "";
      if (requete.method === "GET" && accepte.includes("text/html"))
        return rediriger(`https://${DOMAINE}/connexion?retour=${encodeURIComponent(url.href)}`);
      return new Response(JSON.stringify({ erreur: "non connecte" }),
        { status: 401, headers: { "content-type": "application/json" } });
    }
    // Implantation : moteur de rendu sur carte graphique (novembre 2026). Il est
    // servi par le portail et ajoute a la page, sans toucher au code de l'outil.
    if (sous === "implantation" && chemin === "/rendu-gl.js") {
      const r = await env.ASSETS.fetch(new Request(`https://${DOMAINE}/outils/implantation/rendu-gl.js`));
      return new Response(r.body, { status: r.status,
        headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "private, max-age=86400" } });
    }
    propre.set("x-portail", env.SECRET_PORTAIL);
    propre.set("x-portail-email", qui);
    const page = iconesBatiAzur(await outil.fetch(new Request(requete, { headers: propre })));
    return sous === "implantation" ? renduImplantation(page) : page;
  },

  // Toutes les 15 minutes : bilan du matin et nouvelles demandes (app.js).
  async scheduled(evenement, env, ctx) {
    ctx.waitUntil(planifie(env));
  },
};
