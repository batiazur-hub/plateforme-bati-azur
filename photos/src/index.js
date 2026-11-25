/**
 * Phototheque Bati Azur — https://photos.batiazurpiscine.fr
 *
 * Clement et son pere y deposent depuis l'iPhone les photos et videos des
 * chantiers : type de travaux, avancement, legende, date automatique. Aucun
 * nom de client. Le robot des reseaux sociaux s'en sert pour
 * fabriquer les publications Facebook / Instagram de Bati Azur.
 *
 * - Connexion : celle du hub. Le cookie « portail » vaut pour tout
 *   batiazurpiscine.fr ; on le fait verifier par le Worker du hub (liaison de
 *   service HUB) : /connexion renvoie une redirection 303 quand la session
 *   est valide.
 * - Stockage : R2 (liaison PHOTOS). Les fichiers sous medias/, et un index
 *   JSON (index.json) mis a jour avec une ecriture conditionnelle (etag).
 * - Robot : /api/robot/* avec l'en-tete Authorization: Bearer <ROBOT_TOKEN>.
 *
 * Les photos sont reduites dans le telephone avant l'envoi (2400 px, JPEG) :
 * ca enleve aussi les donnees EXIF, donc la position GPS de la maison.
 */

const HUB = "https://batiazurpiscine.fr";
const ICI = "https://photos.batiazurpiscine.fr";
const MAX_FICHIER = 95 * 1024 * 1024;
const STATUTS = ["a-publier", "ecarte", "publie"];

// Rester dans la part gratuite de R2 (10 Go) : plafond a 9 Go. Chaque nuit on
// supprime les envois de plus de 2 ans, puis les plus anciens tant que
// l'ensemble depasse 8 Go. Les envois de moins de 30 jours ne sont jamais
// supprimes automatiquement (ils n'ont peut-etre pas encore ete publies).
const GO = 1024 ** 3;
const PLAFOND = 9 * GO;
const CIBLE = 8 * GO;
const AGE_MAX_JOURS = 730;
const PROTEGE_JOURS = 30;

/* --------------------------------------------------------------- outils */

const json = (d, statut = 200) => new Response(JSON.stringify(d), {
  status: statut, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const erreur = (m, statut = 400) => json({ erreur: m }, statut);
const id = () => crypto.randomUUID().replace(/-/g, "").slice(0, 16);
const propre = (v, max = 2000) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, "").trim().slice(0, max);

function egales(a, b) {
  a = String(a); b = String(b);
  if (!a || a.length !== b.length) return false;
  let e = 0;
  for (let i = 0; i < a.length; i++) e |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return e === 0;
}

/** Session du hub : renvoie l'adresse connectee, ou null. */
async function connecte(requete, env) {
  const c = requete.headers.get("cookie") || "";
  const brut = c.split(/;\s*/).find(x => x.startsWith("portail="));
  if (!brut) return null;
  const retour = ICI + "/";
  const r = await env.HUB.fetch(new Request(`${HUB}/connexion?retour=${encodeURIComponent(retour)}`, {
    headers: { cookie: brut }, redirect: "manual" }));
  if (r.status !== 303 && r.status !== 302) return null;
  if ((r.headers.get("location") || "") !== retour) return null;
  return decodeURIComponent(brut.slice(8)).split("|")[0] || "connecte";
}

/* ---------------------------------------------------------------- index */

async function lireIndex(env) {
  const o = await env.PHOTOS.get("index.json");
  if (!o) return { etag: null, index: { envois: [] } };
  return { etag: o.etag, index: await o.json() };
}

/** Modifie l'index sans perdre une ecriture faite en meme temps ailleurs. */
async function modifierIndex(env, changer) {
  for (let essai = 0; essai < 5; essai++) {
    const { etag, index } = await lireIndex(env);
    const resultat = await changer(index);
    const ok = await env.PHOTOS.put("index.json", JSON.stringify(index), {
      httpMetadata: { contentType: "application/json" },
      onlyIf: etag ? { etagMatches: etag } : { etagDoesNotMatch: "*" },
    });
    if (ok) return resultat;
    await new Promise(r => setTimeout(r, 150 * (essai + 1)));
  }
  throw new Error("index occupé, réessayez");
}

/* ----------------------------------------------------------- nettoyage */

const poids = e => (e.medias || []).reduce((t, m) => t + (m.octets || 0), 0);
const occupe = index => (index.envois || []).reduce((t, e) => t + poids(e), 0);

/**
 * Retire de l'index puis de R2 les envois trop vieux, et les plus anciens
 * tant que le total depasse « limite ». Renvoie le total restant.
 */
async function nettoyer(env, limite) {
  const maintenant = Date.now(), jour = 86400000;
  const supprimes = [];
  const reste = await modifierIndex(env, ix => {
    supprimes.length = 0;
    const envois = ix.envois || [];
    const age = e => (maintenant - new Date(e.date).getTime()) / jour;
    let garde = envois.filter(e => { if (age(e) > AGE_MAX_JOURS) { supprimes.push(e); return false; } return true; });
    let total = occupe({ envois: garde });
    // du plus ancien au plus recent
    const parAnciennete = [...garde].sort((a, b) => new Date(a.date) - new Date(b.date));
    for (const e of parAnciennete) {
      if (total <= limite) break;
      if (age(e) < PROTEGE_JOURS) break;
      supprimes.push(e); total -= poids(e);
      garde = garde.filter(x => x !== e);
    }
    ix.envois = garde;
    return total;
  });
  const cles = supprimes.flatMap(e => (e.medias || []).map(m => m.cle));
  for (let i = 0; i < cles.length; i += 1000) await env.PHOTOS.delete(cles.slice(i, i + 1000));
  if (supprimes.length) console.log(`nettoyage : ${supprimes.length} envoi(s), ${cles.length} fichier(s) supprimés`);
  return reste;
}

/* ------------------------------------------------------------------ api */

// Un « envoi » = des photos/videos envoyees ensemble, avec le type de travaux,
// l'avancement, la legende et la date (mise automatiquement). Aucun nom de client.
const TYPES = ["coque", "beton", "renovation", "terrasse", "entretien", "equipement", "autre"];
const AVANCEMENTS = ["avant", "travaux", "termine"];

async function api(requete, env, chemin, qui) {
  const m = requete.method;

  if (chemin === "/api/index" && m === "GET") {
    const { index } = await lireIndex(env);
    return json({ envois: index.envois || [], qui, occupe: occupe(index), plafond: PLAFOND });
  }

  if (chemin === "/api/envois" && m === "POST") {
    const d = await requete.json();
    if (!TYPES.includes(d.type)) return erreur("Choisissez le type de travaux.");
    if (!AVANCEMENTS.includes(d.avancement)) return erreur("Choisissez l'avancement.");
    const e = { id: id(), type: d.type, avancement: d.avancement, commune: propre(d.commune, 60),
      legende: propre(d.legende, 2000), date: new Date().toISOString(), par: qui, statut: "a-publier", publie: null, medias: [] };
    await modifierIndex(env, ix => { (ix.envois ||= []).unshift(e); });
    return json(e);
  }

  let r = chemin.match(/^\/api\/envois\/([a-f0-9]{16})$/);
  if (r && m === "PATCH") {
    const d = await requete.json();
    const e = await modifierIndex(env, ix => {
      const e = (ix.envois || []).find(x => x.id === r[1]);
      if (!e) return null;
      if ("legende" in d) e.legende = propre(d.legende, 2000);
      if ("commune" in d) e.commune = propre(d.commune, 60);
      if ("type" in d && TYPES.includes(d.type)) e.type = d.type;
      if ("avancement" in d && AVANCEMENTS.includes(d.avancement)) e.avancement = d.avancement;
      if ("statut" in d && STATUTS.includes(d.statut) && e.statut !== "publie") e.statut = d.statut;
      return e;
    });
    return e ? json(e) : erreur("Envoi introuvable.", 404);
  }

  r = chemin.match(/^\/api\/envois\/([a-f0-9]{16})\/fichiers$/);
  if (r && m === "POST") {
    const f = await requete.formData();
    const fichier = f.get("fichier");
    if (!fichier || typeof fichier === "string") return erreur("Fichier manquant.");
    if (fichier.size > MAX_FICHIER) return erreur("Fichier trop lourd (95 Mo maximum).", 413);
    const type = fichier.type || "";
    const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heic", "video/mp4": "mp4", "video/quicktime": "mov" }[type];
    if (!ext) return erreur("Format non pris en charge.");
    const { index } = await lireIndex(env);
    if (!(index.envois || []).some(e => e.id === r[1])) return erreur("Envoi inconnu.", 404);
    if (occupe(index) + fichier.size > PLAFOND &&
        await nettoyer(env, PLAFOND - fichier.size) + fichier.size > PLAFOND)
      return erreur("Photothèque pleine (9 Go) : supprimez d'anciens envois ou prévenez Clément.", 507);
    const n = id(), cle = `medias/${r[1]}/${n}.${ext}`;
    await env.PHOTOS.put(cle, fichier.stream(), { httpMetadata: { contentType: type } });
    const media = { id: n, cle, type: type.startsWith("video") ? "video" : "photo",
      largeur: Number(f.get("largeur")) || 0, hauteur: Number(f.get("hauteur")) || 0, prise: propre(f.get("prise"), 30), octets: fichier.size };
    await modifierIndex(env, ix => { const e = ix.envois.find(x => x.id === r[1]); if (e) e.medias.push(media); });
    return json(media);
  }

  r = chemin.match(/^\/f\/(medias\/[a-f0-9]{16}\/[a-f0-9]{16}\.(jpg|png|webp|heic|mp4|mov))$/);
  if (r && m === "GET") return fichier(env, r[1], requete);

  return erreur("Introuvable.", 404);
}

async function fichier(env, cle, requete) {
  const plage = requete.headers.get("range");
  const o = await env.PHOTOS.get(cle, plage ? { range: requete.headers } : {});
  if (!o) return new Response("Introuvable", { status: 404 });
  const h = new Headers();
  o.writeHttpMetadata(h);
  h.set("etag", o.httpEtag);
  h.set("cache-control", "private, max-age=86400");
  h.set("accept-ranges", "bytes");
  if (plage && o.range) {
    const debut = o.range.offset ?? 0, longueur = o.range.length ?? (o.size - debut);
    h.set("content-range", `bytes ${debut}-${debut + longueur - 1}/${o.size}`);
    h.set("content-length", String(longueur));
    return new Response(o.body, { status: 206, headers: h });
  }
  return new Response(o.body, { headers: h });
}

/* ---------------------------------------------------------------- robot */

async function robot(requete, env, chemin) {
  const jeton = (requete.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!env.ROBOT_TOKEN || !egales(jeton, env.ROBOT_TOKEN)) return erreur("Non autorisé.", 401);
  if (chemin === "/api/robot/index" && requete.method === "GET") {
    const { index } = await lireIndex(env);
    return json(index);
  }
  const r = chemin.match(/^\/api\/robot\/f\/(medias\/[a-f0-9]{16}\/[a-f0-9]{16}\.[a-z0-9]+)$/);
  if (r && requete.method === "GET") return fichier(env, r[1], requete);
  if (chemin === "/api/robot/publie" && requete.method === "POST") {
    const d = await requete.json();
    const ids = Array.isArray(d.ids) ? d.ids.map(String) : [];
    const n = await modifierIndex(env, ix => {
      let n = 0;
      for (const x of ix.envois || []) if (ids.includes(x.id)) { x.statut = "publie"; x.publie = new Date().toISOString(); x.lien = propre(d.lien, 300) || x.lien; n++; }
      return n;
    });
    return json({ ok: true, n });
  }
  return erreur("Introuvable.", 404);
}

/* ------------------------------------------------------------- l'appli */

const ICONE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" rx="57" fill="#5E5CE6"/><g transform="translate(66.0 66.0) scale(5.1667)" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></g></svg>`;
const ICONE_PNG = "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";

const MANIFESTE = JSON.stringify({
  name: "Photothèque Bati Azur", short_name: "Photos", start_url: "/", display: "standalone",
  background_color: "#F4F7FB", theme_color: "#3E6398", lang: "fr",
  icons: [{ src: "/icone.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }, { src: "/icone.png", sizes: "180x180", type: "image/png" }],
});

const PAGE = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#3E6398">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Photos">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icone.svg">
<link rel="apple-touch-icon" href="/icone.png">
<title>Photothèque Bati Azur</title>
<style>
:root{--bleu:#3E6398;--bleu2:#5284CB;--fond:#F4F7FB;--texte:#14202E;--gris:#6B7785;--ligne:#E3E8EF;--vert:#2E9E6A}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{margin:0;font:16px/1.4 -apple-system,BlinkMacSystemFont,"SF Pro Text",Inter,system-ui,sans-serif;background:var(--fond);color:var(--texte);padding-bottom:calc(112px + env(safe-area-inset-bottom))}
header{background:linear-gradient(180deg,var(--bleu2),var(--bleu));color:#fff;padding:calc(18px + env(safe-area-inset-top)) 20px 22px}
header h1{font-size:26px;margin:0;font-weight:700;letter-spacing:-.3px}
header p{margin:4px 0 0;opacity:.8;font-size:15px}
main{padding:8px 16px;max-width:640px;margin:0 auto}
.titre{font-size:13px;text-transform:uppercase;letter-spacing:.6px;color:var(--gris);margin:20px 4px 10px;font-weight:600}
.vide{color:var(--gris);text-align:center;padding:40px 16px;line-height:1.5}
.envoi{display:flex;gap:12px;align-items:center;background:#fff;border-radius:16px;padding:10px;margin-bottom:10px;box-shadow:0 1px 3px rgba(20,32,46,.07);border:0;width:100%;text-align:left;font:inherit;color:inherit}
.envoi .im{flex:0 0 72px;height:72px;border-radius:12px;background:#DCE5F0 center/cover no-repeat;position:relative}
.envoi .im b{position:absolute;right:4px;bottom:4px;background:rgba(0,0,0,.6);color:#fff;font-size:11px;border-radius:8px;padding:1px 6px;font-weight:600}
.envoi .tx{flex:1;min-width:0}
.envoi strong{display:block;font-size:15px}
.envoi small{display:block;color:var(--gris);font-size:13px;margin-top:2px}
.envoi em{display:block;font-style:normal;font-size:14px;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#3B4856}
.envoi.ecarte{opacity:.45}
.pastille{font-size:11px;font-weight:600;border-radius:999px;padding:2px 8px;margin-left:6px;vertical-align:1px}
.pastille.publie{background:#E3F4EC;color:var(--vert)}
.pastille.ecarte{background:#EEE;color:var(--gris)}
.fab{position:fixed;left:16px;right:16px;bottom:calc(18px + env(safe-area-inset-bottom));max-width:608px;margin:0 auto;background:var(--bleu);color:#fff;border:0;border-radius:18px;padding:18px;font:inherit;font-size:18px;font-weight:600;box-shadow:0 8px 24px rgba(62,99,152,.35);display:flex;align-items:center;justify-content:center;gap:10px}
.fab svg{width:24px;height:24px}
.feuille{position:fixed;inset:0;z-index:20;background:rgba(10,20,35,.45);display:none;align-items:flex-end;justify-content:center}
.feuille.ouverte{display:flex}
.panneau{background:var(--fond);width:100%;max-width:640px;max-height:94vh;overflow:auto;border-radius:22px 22px 0 0;padding:18px 16px calc(22px + env(safe-area-inset-bottom))}
.panneau h2{margin:0 0 14px;font-size:20px;display:flex;justify-content:space-between;align-items:center}
.panneau h2 button{border:0;background:var(--ligne);border-radius:50%;width:34px;height:34px;font-size:20px;color:var(--gris)}
.q{font-size:15px;font-weight:600;margin:18px 2px 8px}
.q span{font-weight:400;color:var(--gris)}
.puces{display:flex;flex-wrap:wrap;gap:8px}
.puce{border:1.5px solid var(--ligne);background:#fff;border-radius:12px;padding:10px 14px;font:inherit;font-size:15px;color:var(--texte)}
.puce.on{background:var(--bleu);border-color:var(--bleu);color:#fff}
.trois{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.trois .puce{text-align:center;padding:12px 6px}
input[type=text],textarea{width:100%;font:inherit;font-size:16px;border:1.5px solid var(--ligne);border-radius:12px;padding:12px;background:#fff;color:var(--texte)}
textarea{min-height:96px;resize:vertical}
.apercus{display:flex;gap:6px;overflow-x:auto;padding:2px 0 4px}
.apercus div{flex:0 0 76px;height:76px;border-radius:12px;background:#DCE5F0 center/cover;position:relative;overflow:hidden}
.apercus div small{position:absolute;inset:0;display:grid;place-items:center;font-size:12px;color:var(--gris)}
.apercus span{position:absolute;left:0;right:0;bottom:0;height:5px;background:var(--vert);transform-origin:left;transform:scaleX(0);transition:transform .25s}
.date{font-size:13px;color:var(--gris);margin:14px 2px 0}
.btn{width:100%;margin-top:16px;background:var(--bleu);color:#fff;border:0;border-radius:14px;padding:16px;font:inherit;font-size:17px;font-weight:600}
.btn:disabled{opacity:.5}
.btn.second{background:#fff;color:var(--texte);border:1.5px solid var(--ligne);margin-top:10px;font-weight:500}
.galerie{display:grid;grid-template-columns:repeat(2,1fr);gap:6px}
.galerie img,.galerie video{width:100%;aspect-ratio:1;object-fit:cover;border-radius:12px;background:#000;display:block}
.toast{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(100px + env(safe-area-inset-bottom));background:#14202E;color:#fff;border-radius:12px;padding:10px 16px;font-size:15px;z-index:30;display:none;white-space:nowrap}
</style>
</head>
<body>
<header><h1>Photothèque</h1><p>Photos et vidéos des chantiers Bati Azur</p></header>
<main id="vue"><p class="vide">Chargement…</p></main>
<button class="fab" id="b-ajout"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/></svg>Ajouter des photos</button>
<input type="file" id="fichiers" accept="image/*,video/*" multiple hidden>

<div class="feuille" id="f-ajout"><div class="panneau">
  <h2><span id="a-titre">Nouvel envoi</span><button data-fermer aria-label="Fermer">×</button></h2>
  <div class="apercus" id="apercus"></div>
  <div class="q">Quels travaux ?</div>
  <div class="puces" id="a-type"></div>
  <div class="q">Où en est le chantier ?</div>
  <div class="trois" id="a-avancement"></div>
  <div class="q">Légende <span>(facultatif)</span></div>
  <textarea id="a-legende" placeholder="Ex. Coque 8×4, membrane gris clair, margelles ton pierre, terrain en pente…"></textarea>
  <div class="q">Commune <span>(facultatif)</span></div>
  <input type="text" id="a-commune" placeholder="Ex. Yzeure" autocomplete="off">
  <p class="date" id="a-date"></p>
  <button class="btn" id="a-envoyer">Envoyer</button>
</div></div>

<div class="feuille" id="f-envoi"><div class="panneau" id="p-envoi"></div></div>
<div class="toast" id="toast"></div>

<script>
const TYPES = [["coque","Piscine coque"],["beton","Piscine béton"],["renovation","Rénovation"],["terrasse","Terrasse / dalle"],["entretien","Entretien / SAV"],["equipement","Équipement"],["autre","Autre"]];
const AVANCEMENTS = [["avant","Avant"],["travaux","Travaux"],["termine","Terminé"]];
const NOM = Object.fromEntries([...TYPES, ...AVANCEMENTS]);
let ENVOIS = [], OCCUPE = 0, choisis = [], choix = { type: "", avancement: "" };
const $ = s => document.querySelector(s);
const esc = t => String(t ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const url = m => "/f/" + m.cle;
const quand = d => { const x = new Date(d), j = new Date(); const memeJour = x.toDateString() === j.toDateString();
  return (memeJour ? "Aujourd'hui" : x.toLocaleDateString("fr-FR", { day: "numeric", month: "long" })) + " à " + x.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }); };
function toast(t){ const e=$("#toast"); e.textContent=t; e.style.display="block"; clearTimeout(toast.t); toast.t=setTimeout(()=>e.style.display="none",2600); }

async function appel(chemin, options = {}) {
  const r = await fetch(chemin, { credentials: "include", ...options });
  if (r.status === 401) { location.href = "https://batiazurpiscine.fr/connexion?retour=" + encodeURIComponent(location.href); throw new Error("connexion"); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.erreur || "Erreur " + r.status);
  return d;
}
async function charger(){ const d = await appel("/api/index"); ENVOIS = d.envois; OCCUPE = d.occupe || 0; rendre(); }

function rendre(){
  const v = $("#vue");
  if (!ENVOIS.length) { v.innerHTML = '<p class="vide">Rien pour l\\'instant.<br>Appuyez sur « Ajouter des photos » pour envoyer celles d\\'un chantier.</p>'; return; }
  v.innerHTML = '<div class="titre">Derniers envois</div>' + ENVOIS.map(e => {
    const p = e.medias.find(m => m.type === "photo");
    const pastille = e.statut === "publie" ? '<span class="pastille publie">Publié</span>' : e.statut === "ecarte" ? '<span class="pastille ecarte">Pas publié</span>' : '';
    return '<button class="envoi ' + e.statut + '" data-e="' + e.id + '"><div class="im" style="background-image:url(' + (p ? url(p) : "") + ')"><b>' + e.medias.length + '</b></div><div class="tx"><strong>' + esc(NOM[e.type]) + ' · ' + esc(NOM[e.avancement]) + pastille + '</strong><small>' + quand(e.date) + (e.commune ? ' · ' + esc(e.commune) : '') + '</small>' + (e.legende ? '<em>' + esc(e.legende) + '</em>' : '') + '</div></button>';
  }).join("") + '<p class="date" style="text-align:center;margin:18px 0 90px">Espace utilisé : ' + (OCCUPE / 1073741824).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + ' Go sur 9 Go<br>Les envois de plus de 2 ans sont supprimés automatiquement.</p>';
  v.querySelectorAll("[data-e]").forEach(b => b.onclick = () => ouvrir(b.dataset.e));
}

function puces(boite, liste, cle){
  boite.innerHTML = liste.map(([k,n]) => '<button class="puce' + (choix[cle]===k?' on':'') + '" data-k="' + k + '">' + n + '</button>').join("");
  boite.querySelectorAll("[data-k]").forEach(b => b.onclick = () => { choix[cle] = b.dataset.k; boite.querySelectorAll("[data-k]").forEach(x => x.classList.toggle("on", x === b)); });
}

function ouvrir(eid){
  const e = ENVOIS.find(x => x.id === eid), p = $("#p-envoi");
  choix = { type: e.type, avancement: e.avancement };
  p.innerHTML = '<h2>' + quand(e.date) + '<button data-fermer aria-label="Fermer">×</button></h2>'
    + '<div class="galerie">' + e.medias.map(m => m.type === "video" ? '<video src="' + url(m) + '" controls playsinline preload="metadata"></video>' : '<img src="' + url(m) + '" alt="" loading="lazy">').join("") + '</div>'
    + '<div class="q">Quels travaux ?</div><div class="puces" id="e-type"></div>'
    + '<div class="q">Où en est le chantier ?</div><div class="trois" id="e-avancement"></div>'
    + '<div class="q">Légende</div><textarea id="e-legende">' + esc(e.legende) + '</textarea>'
    + '<div class="q">Commune</div><input type="text" id="e-commune" value="' + esc(e.commune) + '">'
    + '<button class="btn" id="e-ok">Enregistrer</button>'
    + (e.statut === "publie" ? '' : '<button class="btn second" id="e-statut">' + (e.statut === "ecarte" ? "Autoriser la publication" : "Ne pas publier ces photos") + '</button>');
  puces($("#e-type"), TYPES, "type"); puces($("#e-avancement"), AVANCEMENTS, "avancement");
  const maj = async corps => { await appel("/api/envois/" + e.id, { method:"PATCH", headers:{"content-type":"application/json"}, body: JSON.stringify(corps) }); fermer(); toast("Enregistré"); await charger(); };
  $("#e-ok").onclick = () => maj({ ...choix, legende: $("#e-legende").value, commune: $("#e-commune").value });
  if ($("#e-statut")) $("#e-statut").onclick = () => maj({ statut: e.statut === "ecarte" ? "a-publier" : "ecarte" });
  $("#f-envoi").classList.add("ouverte");
}

function fermer(){ document.querySelectorAll(".feuille").forEach(f => f.classList.remove("ouverte")); }
document.addEventListener("click", ev => { if (ev.target.matches("[data-fermer]") || ev.target.classList.contains("feuille")) fermer(); });

$("#b-ajout").onclick = () => $("#fichiers").click();
$("#fichiers").onchange = ev => {
  choisis = [...ev.target.files]; ev.target.value = "";
  if (!choisis.length) return;
  choix = { type: "", avancement: "" };
  $("#a-titre").textContent = choisis.length + (choisis.length > 1 ? " fichiers" : " fichier");
  $("#apercus").innerHTML = choisis.map((f, i) => '<div id="ap' + i + '" style="background-image:url(' + (f.type.startsWith("image") ? URL.createObjectURL(f) : "") + ')">' + (f.type.startsWith("video") ? '<small>vidéo</small>' : '') + '<span></span></div>').join("");
  puces($("#a-type"), TYPES, "type"); puces($("#a-avancement"), AVANCEMENTS, "avancement");
  $("#a-legende").value = ""; $("#a-commune").value = "";
  $("#a-date").textContent = "Date ajoutée automatiquement : " + quand(new Date());
  const b = $("#a-envoyer"); b.disabled = false; b.textContent = "Envoyer";
  $("#f-ajout").classList.add("ouverte");
};

/** Reduit une photo (2400 px max) : retire aussi les EXIF et la position GPS. */
async function reduire(f){
  const img = await createImageBitmap(f, { imageOrientation: "from-image" });
  const k = Math.min(1, 2400 / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return { blob: await new Promise(ok => c.toBlob(ok, "image/jpeg", 0.88)), largeur: c.width, hauteur: c.height };
}

$("#a-envoyer").onclick = async () => {
  if (!choix.type) return toast("Choisissez le type de travaux");
  if (!choix.avancement) return toast("Choisissez où en est le chantier");
  const b = $("#a-envoyer"); b.disabled = true;
  try {
    const e = await appel("/api/envois", { method:"POST", headers:{"content-type":"application/json"},
      body: JSON.stringify({ ...choix, legende: $("#a-legende").value, commune: $("#a-commune").value }) });
    let n = 0;
    for (const [i, f] of choisis.entries()) {
      b.textContent = "Envoi " + (i+1) + " sur " + choisis.length + "…";
      const fd = new FormData();
      if (f.type.startsWith("image") || /\\.(heic|heif)$/i.test(f.name)) {
        // iPhone : Safari lit le HEIC et on le convertit en JPEG ici. Si le
        // navigateur ne sait pas le lire, on envoie l'original : le robot le
        // convertira de son cote.
        const r = await reduire(f).catch(() => null);
        if (r) {
          fd.append("fichier", new File([r.blob], "photo.jpg", { type: "image/jpeg" }));
          fd.append("largeur", r.largeur); fd.append("hauteur", r.hauteur);
        } else fd.append("fichier", new File([f], "photo.heic", { type: "image/heic" }));
      } else {
        if (f.size > 95 * 1024 * 1024) { toast("Vidéo trop lourde (95 Mo max)"); continue; }
        fd.append("fichier", f);
      }
      fd.append("prise", f.lastModified ? new Date(f.lastModified).toISOString() : "");
      await appel("/api/envois/" + e.id + "/fichiers", { method: "POST", body: fd });
      const s = document.querySelector("#ap" + i + " span"); if (s) s.style.transform = "scaleX(1)";
      n++;
    }
    fermer(); toast("C'est envoyé, merci !"); await charger();
  } catch (err) { if (err.message !== "connexion") toast(err.message); b.disabled = false; b.textContent = "Réessayer"; }
};

charger().catch(e => { if (e.message !== "connexion") $("#vue").innerHTML = '<p class="vide">' + esc(e.message) + '</p>'; });
</script>
</body>
</html>`;

/* ------------------------------------------------------------- routeur */

export default {
  async fetch(requete, env) {
    const url = new URL(requete.url);
    const chemin = url.pathname;

    if (chemin === "/manifest.webmanifest")
      return new Response(MANIFESTE, { headers: { "content-type": "application/manifest+json", "cache-control": "public, max-age=3600" } });
    if (chemin === "/icone.svg")
      return new Response(ICONE, { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=604800" } });
    if (chemin === "/icone.png")
      return new Response(Uint8Array.from(atob(ICONE_PNG), (c) => c.charCodeAt(0)), { headers: { "content-type": "image/png", "cache-control": "public, max-age=604800" } });
    if (chemin.startsWith("/api/robot/")) return robot(requete, env, chemin);

    const qui = await connecte(requete, env);
    if (!qui) {
      if (chemin.startsWith("/api/") || chemin.startsWith("/f/")) return erreur("Connexion requise.", 401);
      return Response.redirect(`${HUB}/connexion?retour=${encodeURIComponent(ICI + chemin)}`, 303);
    }
    try {
      if (chemin === "/" || chemin === "/index.html")
        return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
          "content-security-policy": "default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
          "x-content-type-options": "nosniff", "referrer-policy": "same-origin" } });
      return await api(requete, env, chemin, qui);
    } catch (e) {
      return erreur(e.message || "Erreur", 500);
    }
  },

  // Chaque nuit : menage pour rester sous 8 Go et sans envois de plus de 2 ans.
  async scheduled(_evenement, env, ctx) {
    ctx.waitUntil(nettoyer(env, CIBLE));
  },
};
