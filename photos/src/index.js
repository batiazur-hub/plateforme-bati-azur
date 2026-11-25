/**
 * Phototheque Bati Azur — https://photos.batiazurpiscine.fr
 *
 * Clement et son pere y deposent depuis l'iPhone les photos et videos des
 * chantiers (avec une legende). Le robot des reseaux sociaux s'en sert pour
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
const ETAPES = ["avant", "terrassement", "gros-oeuvre", "revetement", "mise-en-eau", "termine", "detail", "entretien", "equipe"];
const STATUTS = ["a-publier", "ecarte", "publie"];

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
  if (!o) return { etag: null, index: { chantiers: [], medias: [] } };
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

/* ------------------------------------------------------------------ api */

async function api(requete, env, chemin, qui) {
  const m = requete.method;

  if (chemin === "/api/index" && m === "GET") {
    const { index } = await lireIndex(env);
    return json({ ...index, qui });
  }

  if (chemin === "/api/chantiers" && m === "POST") {
    const d = await requete.json();
    const nom = propre(d.nom, 80), commune = propre(d.commune, 80);
    if (!nom || !commune) return erreur("Nom du chantier et commune obligatoires.");
    const c = { id: id(), nom, commune, cree: new Date().toISOString(), termine: false };
    await modifierIndex(env, ix => { ix.chantiers.unshift(c); });
    return json(c);
  }

  let r = chemin.match(/^\/api\/chantiers\/([a-f0-9]{16})$/);
  if (r && m === "PATCH") {
    const d = await requete.json();
    const c = await modifierIndex(env, ix => {
      const c = ix.chantiers.find(x => x.id === r[1]);
      if (!c) return null;
      if ("nom" in d) c.nom = propre(d.nom, 80) || c.nom;
      if ("commune" in d) c.commune = propre(d.commune, 80) || c.commune;
      if ("termine" in d) c.termine = !!d.termine;
      return c;
    });
    return c ? json(c) : erreur("Chantier introuvable.", 404);
  }

  if (chemin === "/api/medias" && m === "POST") {
    const f = await requete.formData();
    const fichier = f.get("fichier");
    if (!fichier || typeof fichier === "string") return erreur("Fichier manquant.");
    if (fichier.size > MAX_FICHIER) return erreur("Fichier trop lourd (95 Mo maximum).", 413);
    const type = fichier.type || "";
    if (!/^(image\/(jpeg|png|webp|heic)|video\/(mp4|quicktime))$/.test(type)) return erreur("Format non pris en charge.");
    const chantier = propre(f.get("chantier"), 16);
    const etape = propre(f.get("etape"), 20);
    if (!ETAPES.includes(etape)) return erreur("Étape inconnue.");
    const { index } = await lireIndex(env);
    if (!index.chantiers.some(c => c.id === chantier)) return erreur("Chantier inconnu.");
    const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "video/mp4": "mp4", "video/quicktime": "mov" }[type];
    const n = id();
    const cle = `medias/${chantier}/${n}.${ext}`;
    await env.PHOTOS.put(cle, fichier.stream(), { httpMetadata: { contentType: type } });
    const media = {
      id: n, cle, chantier, etape, type: type.startsWith("video") ? "video" : "photo",
      legende: propre(f.get("legende"), 2000), accord: f.get("accord") === "1",
      largeur: Number(f.get("largeur")) || 0, hauteur: Number(f.get("hauteur")) || 0,
      prise: propre(f.get("prise"), 30), ajoute: new Date().toISOString(), par: qui,
      statut: "a-publier", publie: null,
    };
    await modifierIndex(env, ix => { ix.medias.unshift(media); });
    return json(media);
  }

  r = chemin.match(/^\/api\/medias\/([a-f0-9]{16})$/);
  if (r && m === "PATCH") {
    const d = await requete.json();
    const media = await modifierIndex(env, ix => {
      const x = ix.medias.find(y => y.id === r[1]);
      if (!x) return null;
      if ("legende" in d) x.legende = propre(d.legende, 2000);
      if ("etape" in d && ETAPES.includes(d.etape)) x.etape = d.etape;
      if ("accord" in d) x.accord = !!d.accord;
      if ("statut" in d && STATUTS.includes(d.statut)) x.statut = d.statut;
      return x;
    });
    return media ? json(media) : erreur("Photo introuvable.", 404);
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
      for (const x of ix.medias) if (ids.includes(x.id)) { x.statut = "publie"; x.publie = new Date().toISOString(); x.lien = propre(d.lien, 300) || x.lien; n++; }
      return n;
    });
    return json({ ok: true, n });
  }
  return erreur("Introuvable.", 404);
}

/* ------------------------------------------------------------- l'appli */

const ICONE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5284CB"/><stop offset="1" stop-color="#2C4F80"/></linearGradient></defs><rect width="512" height="512" rx="112" fill="url(#g)"/><rect x="112" y="150" width="288" height="220" rx="36" fill="none" stroke="#fff" stroke-width="28"/><circle cx="256" cy="262" r="58" fill="none" stroke="#fff" stroke-width="28"/><rect x="196" y="112" width="120" height="52" rx="18" fill="#fff"/><path d="M120 420c40-26 80-26 120 0s80 26 120 0 60-20 72-14" fill="none" stroke="#9FD3FF" stroke-width="22" stroke-linecap="round"/></svg>`;

const MANIFESTE = JSON.stringify({
  name: "Photothèque Bati Azur", short_name: "Photos", start_url: "/", display: "standalone",
  background_color: "#F4F7FB", theme_color: "#3E6398", lang: "fr",
  icons: [{ src: "/icone.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
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
:root{--bleu:#3E6398;--bleu2:#5284CB;--fond:#F4F7FB;--carte:#fff;--texte:#14202E;--gris:#6B7785;--ligne:#E3E8EF;--vert:#2E9E6A;--rouge:#C9473B}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{margin:0;font:16px/1.4 -apple-system,BlinkMacSystemFont,"SF Pro Text",Inter,system-ui,sans-serif;background:var(--fond);color:var(--texte);padding-bottom:calc(110px + env(safe-area-inset-bottom))}
header{position:sticky;top:0;z-index:5;background:linear-gradient(180deg,var(--bleu2),var(--bleu));color:#fff;padding:calc(14px + env(safe-area-inset-top)) 18px 14px;display:flex;align-items:center;gap:12px}
header h1{font-size:20px;margin:0;flex:1;font-weight:700;letter-spacing:-.2px}
header button{background:rgba(255,255,255,.18);color:#fff;border:0;border-radius:10px;padding:7px 12px;font:inherit;font-size:14px}
main{padding:16px;max-width:760px;margin:0 auto}
.vide{color:var(--gris);text-align:center;padding:48px 12px}
.titre{font-size:13px;text-transform:uppercase;letter-spacing:.6px;color:var(--gris);margin:22px 4px 8px;font-weight:600}
.chantiers{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px}
.ch{background:var(--carte);border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(20,32,46,.08);border:0;padding:0;text-align:left;font:inherit;color:inherit}
.ch .im{aspect-ratio:4/3;background:#DCE5F0 center/cover no-repeat}
.ch .tx{padding:10px 12px}
.ch b{display:block;font-size:15px}.ch small{color:var(--gris)}
.grille{display:grid;grid-template-columns:repeat(3,1fr);gap:4px}
.vg{position:relative;aspect-ratio:1;background:#DCE5F0 center/cover no-repeat;border:0;padding:0;border-radius:6px;overflow:hidden}
.vg i{position:absolute;left:4px;bottom:4px;font-style:normal;font-size:11px;background:rgba(0,0,0,.55);color:#fff;border-radius:6px;padding:2px 6px}
.vg.ecarte{opacity:.35}.vg.publie::after{content:"✓";position:absolute;top:4px;right:4px;background:var(--vert);color:#fff;border-radius:50%;width:20px;height:20px;font-size:12px;display:grid;place-items:center}
.fab{position:fixed;left:16px;right:16px;bottom:calc(18px + env(safe-area-inset-bottom));max-width:728px;margin:0 auto;background:var(--bleu);color:#fff;border:0;border-radius:16px;padding:17px;font:inherit;font-size:17px;font-weight:600;box-shadow:0 8px 24px rgba(62,99,152,.35)}
.feuille{position:fixed;inset:0;z-index:20;background:rgba(10,20,35,.45);display:none;align-items:flex-end;justify-content:center}
.feuille.ouverte{display:flex}
.panneau{background:var(--fond);width:100%;max-width:760px;max-height:92vh;overflow:auto;border-radius:22px 22px 0 0;padding:18px 16px calc(24px + env(safe-area-inset-bottom))}
.panneau h2{margin:0 0 12px;font-size:19px;display:flex;justify-content:space-between;align-items:center}
.panneau h2 button{border:0;background:var(--ligne);border-radius:50%;width:32px;height:32px;font-size:18px;color:var(--gris)}
label{display:block;font-size:13px;color:var(--gris);margin:14px 2px 6px;font-weight:600}
select,input[type=text],textarea{width:100%;font:inherit;font-size:16px;border:1px solid var(--ligne);border-radius:12px;padding:12px;background:#fff;color:var(--texte)}
textarea{min-height:110px;resize:vertical}
.puces{display:flex;flex-wrap:wrap;gap:8px}
.puce{border:1px solid var(--ligne);background:#fff;border-radius:999px;padding:8px 13px;font:inherit;font-size:14px;color:var(--texte)}
.puce.on{background:var(--bleu);border-color:var(--bleu);color:#fff}
.bascule{display:flex;align-items:center;justify-content:space-between;background:#fff;border:1px solid var(--ligne);border-radius:12px;padding:12px;margin-top:14px;font-size:15px}
.bascule input{width:22px;height:22px;accent-color:var(--vert)}
.apercus{display:flex;gap:6px;overflow-x:auto;padding:2px 0 6px}
.apercus div{flex:0 0 72px;height:72px;border-radius:10px;background:#DCE5F0 center/cover;position:relative}
.apercus span{position:absolute;inset:auto 0 0 0;height:4px;background:var(--vert);transform-origin:left;transform:scaleX(0);transition:transform .2s}
.btn{width:100%;margin-top:18px;background:var(--bleu);color:#fff;border:0;border-radius:14px;padding:15px;font:inherit;font-size:17px;font-weight:600}
.btn:disabled{opacity:.5}
.btn.second{background:#fff;color:var(--bleu);border:1px solid var(--ligne);margin-top:10px}
.lien{background:none;border:0;color:var(--bleu);font:inherit;font-size:15px;padding:6px 2px}
.grand{width:100%;border-radius:14px;background:#000;max-height:55vh;object-fit:contain;display:block}
.etat{display:flex;gap:8px;margin-top:6px}.etat .puce{flex:1;text-align:center}
.info{font-size:13px;color:var(--gris);margin-top:8px}
.toast{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(96px + env(safe-area-inset-bottom));background:#14202E;color:#fff;border-radius:12px;padding:10px 16px;font-size:14px;z-index:30;display:none}
.retour{display:flex;align-items:center;gap:8px;margin:0 0 4px}
.retour h3{margin:0;font-size:20px;flex:1}
</style>
</head>
<body>
<header><h1>Photothèque</h1><button id="b-maj" aria-label="Actualiser">Actualiser</button></header>
<main id="vue"><p class="vide">Chargement…</p></main>
<button class="fab" id="b-ajout">Ajouter des photos ou vidéos</button>
<input type="file" id="fichiers" accept="image/*,video/*" multiple hidden>

<div class="feuille" id="f-ajout"><div class="panneau">
  <h2>Nouvel envoi <button data-fermer>×</button></h2>
  <div class="apercus" id="apercus"></div>
  <label for="a-chantier">Chantier</label>
  <select id="a-chantier"></select>
  <div id="nouveau" hidden>
    <label for="n-nom">Nom du chantier (privé, jamais publié)</label>
    <input type="text" id="n-nom" placeholder="Ex. Dupont — piscine 8×4" autocomplete="off">
    <label for="n-commune">Commune (affichée dans les publications)</label>
    <input type="text" id="n-commune" placeholder="Ex. Yzeure" autocomplete="off">
  </div>
  <label>Étape</label>
  <div class="puces" id="a-etapes"></div>
  <label for="a-legende">Légende</label>
  <textarea id="a-legende" placeholder="Ce qu'on voit, en quelques mots : dimensions, revêtement, équipements, difficulté du terrain, ce que le client voulait… (le micro du clavier marche très bien)"></textarea>
  <label class="bascule">Le client est d'accord pour publier <input type="checkbox" id="a-accord"></label>
  <p class="info">Les photos sont réduites et la position GPS est retirée avant l'envoi. Le nom du client n'est jamais publié.</p>
  <button class="btn" id="a-envoyer">Envoyer</button>
</div></div>

<div class="feuille" id="f-media"><div class="panneau" id="p-media"></div></div>
<div class="toast" id="toast"></div>

<script>
const ETAPES = [["avant","Avant travaux"],["terrassement","Terrassement"],["gros-oeuvre","Gros œuvre"],["revetement","Membrane / revêtement"],["mise-en-eau","Mise en eau"],["termine","Terminé"],["detail","Détail / matière"],["entretien","Entretien / SAV"],["equipe","Équipe / magasin"]];
const NOM_ETAPE = Object.fromEntries(ETAPES);
let IX = { chantiers: [], medias: [] }, ouvert = null, choisis = [], etape = "termine";
const $ = s => document.querySelector(s);
const esc = t => String(t ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const url = m => "/f/" + m.cle;
function toast(t){ const e=$("#toast"); e.textContent=t; e.style.display="block"; clearTimeout(toast.t); toast.t=setTimeout(()=>e.style.display="none",2600); }

async function appel(chemin, options = {}) {
  const r = await fetch(chemin, { credentials: "include", ...options });
  if (r.status === 401) { location.href = "https://batiazurpiscine.fr/connexion?retour=" + encodeURIComponent(location.href); throw new Error("connexion"); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.erreur || "Erreur " + r.status);
  return d;
}
async function charger(){ IX = await appel("/api/index"); rendre(); }

function rendre(){
  const v = $("#vue");
  if (ouvert) {
    const c = IX.chantiers.find(x => x.id === ouvert);
    const ms = IX.medias.filter(m => m.chantier === ouvert);
    v.innerHTML = '<div class="retour"><button class="lien" id="b-retour">‹ Chantiers</button></div>'
      + '<div class="retour"><h3>' + esc(c.nom) + '</h3></div><p class="info">' + esc(c.commune) + ' · ' + ms.length + ' fichier' + (ms.length>1?'s':'') + (c.termine ? ' · terminé' : '') + '</p>'
      + (ms.length ? '<div class="grille">' + ms.map(m => '<button class="vg ' + m.statut + '" data-m="' + m.id + '" style="background-image:url(' + (m.type==="photo"?url(m):"") + ')">' + (m.type==="video"?'<video src="'+url(m)+'#t=0.5" muted playsinline preload="metadata" style="width:100%;height:100%;object-fit:cover"></video>':'') + '<i>' + esc(NOM_ETAPE[m.etape]||m.etape) + '</i></button>').join("") + '</div>' : '<p class="vide">Rien encore pour ce chantier.</p>')
      + '<button class="btn second" id="b-termine">' + (c.termine ? "Rouvrir le chantier" : "Marquer le chantier terminé") + '</button>';
    $("#b-retour").onclick = () => { ouvert = null; rendre(); };
    $("#b-termine").onclick = async () => { await appel("/api/chantiers/" + c.id, { method:"PATCH", headers:{"content-type":"application/json"}, body: JSON.stringify({ termine: !c.termine }) }); await charger(); };
    v.querySelectorAll("[data-m]").forEach(b => b.onclick = () => ouvrirMedia(b.dataset.m));
    return;
  }
  if (!IX.chantiers.length) { v.innerHTML = '<p class="vide">Aucun chantier pour l\\'instant.<br>Commencez par « Ajouter des photos ».</p>'; return; }
  const bloc = (titre, liste) => liste.length ? '<div class="titre">' + titre + '</div><div class="chantiers">' + liste.map(c => {
    const ms = IX.medias.filter(m => m.chantier === c.id), p = ms.find(m => m.type === "photo");
    return '<button class="ch" data-c="' + c.id + '"><div class="im" style="background-image:url(' + (p ? url(p) : "") + ')"></div><div class="tx"><b>' + esc(c.nom) + '</b><small>' + esc(c.commune) + ' · ' + ms.length + '</small></div></button>';
  }).join("") + '</div>' : "";
  v.innerHTML = bloc("En cours", IX.chantiers.filter(c => !c.termine)) + bloc("Terminés", IX.chantiers.filter(c => c.termine));
  v.querySelectorAll("[data-c]").forEach(b => b.onclick = () => { ouvert = b.dataset.c; rendre(); scrollTo(0,0); });
}

function ouvrirMedia(mid){
  const m = IX.medias.find(x => x.id === mid);
  const p = $("#p-media");
  p.innerHTML = '<h2>' + esc(NOM_ETAPE[m.etape]) + ' <button data-fermer>×</button></h2>'
    + (m.type === "video" ? '<video class="grand" src="' + url(m) + '" controls playsinline></video>' : '<img class="grand" src="' + url(m) + '" alt="">')
    + '<label>Étape</label><div class="puces" id="m-etapes">' + ETAPES.map(([k,n]) => '<button class="puce' + (k===m.etape?' on':'') + '" data-e="' + k + '">' + n + '</button>').join("") + '</div>'
    + '<label for="m-legende">Légende</label><textarea id="m-legende">' + esc(m.legende) + '</textarea>'
    + '<label class="bascule">Le client est d\\'accord pour publier <input type="checkbox" id="m-accord"' + (m.accord?' checked':'') + '></label>'
    + '<label>Publication</label><div class="etat">' + [["a-publier","À publier"],["ecarte","Ne pas publier"]].map(([k,n]) => '<button class="puce' + (k===m.statut?' on':'') + '" data-s="' + k + '">' + n + '</button>').join("") + '</div>'
    + (m.statut === "publie" ? '<p class="info">Publié le ' + new Date(m.publie).toLocaleDateString("fr-FR") + '.</p>' : '')
    + '<button class="btn" id="m-ok">Enregistrer</button>';
  let e = m.etape, s = m.statut;
  p.querySelectorAll("[data-e]").forEach(b => b.onclick = () => { e = b.dataset.e; p.querySelectorAll("[data-e]").forEach(x => x.classList.toggle("on", x === b)); });
  p.querySelectorAll("[data-s]").forEach(b => b.onclick = () => { s = b.dataset.s; p.querySelectorAll("[data-s]").forEach(x => x.classList.toggle("on", x === b)); });
  $("#m-ok").onclick = async () => {
    const corps = { etape: e, legende: $("#m-legende").value, accord: $("#m-accord").checked };
    if (m.statut !== "publie") corps.statut = s;
    await appel("/api/medias/" + m.id, { method:"PATCH", headers:{"content-type":"application/json"}, body: JSON.stringify(corps) });
    fermer(); toast("Enregistré"); await charger();
  };
  $("#f-media").classList.add("ouverte");
}

function fermer(){ document.querySelectorAll(".feuille").forEach(f => f.classList.remove("ouverte")); }
document.addEventListener("click", ev => { if (ev.target.matches("[data-fermer]") || ev.target.classList.contains("feuille")) fermer(); });

/* --- ajout --- */
$("#b-ajout").onclick = () => $("#fichiers").click();
$("#b-maj").onclick = () => charger().then(() => toast("À jour"));
$("#fichiers").onchange = ev => {
  choisis = [...ev.target.files]; ev.target.value = "";
  if (!choisis.length) return;
  $("#apercus").innerHTML = choisis.map((f, i) => '<div id="ap' + i + '" style="background-image:url(' + (f.type.startsWith("image") ? URL.createObjectURL(f) : "") + ')">' + (f.type.startsWith("video") ? '<small style="position:absolute;top:26px;left:0;right:0;text-align:center;font-size:12px">vidéo</small>' : '') + '<span></span></div>').join("");
  const sel = $("#a-chantier");
  sel.innerHTML = IX.chantiers.filter(c => !c.termine).map(c => '<option value="' + c.id + '">' + esc(c.nom) + ' — ' + esc(c.commune) + '</option>').join("") + '<option value="+">+ Nouveau chantier</option>';
  if (ouvert) sel.value = ouvert;
  sel.onchange = () => $("#nouveau").hidden = sel.value !== "+";
  sel.onchange();
  $("#a-etapes").innerHTML = ETAPES.map(([k,n]) => '<button class="puce' + (k===etape?' on':'') + '" data-e="' + k + '">' + n + '</button>').join("");
  $("#a-etapes").querySelectorAll("[data-e]").forEach(b => b.onclick = () => { etape = b.dataset.e; $("#a-etapes").querySelectorAll("[data-e]").forEach(x => x.classList.toggle("on", x === b)); });
  $("#a-legende").value = ""; $("#a-accord").checked = false;
  $("#a-envoyer").disabled = false; $("#a-envoyer").textContent = "Envoyer " + choisis.length + " fichier" + (choisis.length>1?"s":"");
  $("#f-ajout").classList.add("ouverte");
};

/** Reduit une photo (2400 px max) : retire aussi les EXIF et la position GPS. */
async function reduire(f){
  const img = await createImageBitmap(f, { imageOrientation: "from-image" });
  const k = Math.min(1, 2400 / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise(ok => c.toBlob(ok, "image/jpeg", 0.88));
  return { blob, largeur: c.width, hauteur: c.height };
}

$("#a-envoyer").onclick = async () => {
  const b = $("#a-envoyer"); b.disabled = true;
  try {
    let chantier = $("#a-chantier").value;
    if (chantier === "+") {
      const nom = $("#n-nom").value.trim(), commune = $("#n-commune").value.trim();
      if (!nom || !commune) { toast("Nom et commune du chantier"); b.disabled = false; return; }
      chantier = (await appel("/api/chantiers", { method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({ nom, commune }) })).id;
    }
    let n = 0;
    for (const [i, f] of choisis.entries()) {
      b.textContent = "Envoi " + (i+1) + " / " + choisis.length + "…";
      const fd = new FormData();
      if (f.type.startsWith("image")) {
        const r = await reduire(f);
        fd.append("fichier", new File([r.blob], "photo.jpg", { type: "image/jpeg" }));
        fd.append("largeur", r.largeur); fd.append("hauteur", r.hauteur);
      } else {
        if (f.size > 95 * 1024 * 1024) { toast("Vidéo trop lourde : " + f.name); continue; }
        fd.append("fichier", f);
      }
      fd.append("chantier", chantier); fd.append("etape", etape);
      fd.append("legende", $("#a-legende").value); fd.append("accord", $("#a-accord").checked ? "1" : "0");
      fd.append("prise", f.lastModified ? new Date(f.lastModified).toISOString() : "");
      await appel("/api/medias", { method: "POST", body: fd });
      const s = document.querySelector("#ap" + i + " span"); if (s) s.style.transform = "scaleX(1)";
      n++;
    }
    fermer(); ouvert = chantier; toast(n + " fichier" + (n>1?"s":"") + " envoyé" + (n>1?"s":""));
    await charger();
  } catch (e) { if (e.message !== "connexion") toast(e.message); b.disabled = false; b.textContent = "Réessayer"; }
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
    if (chemin === "/icone.png") {
      const o = await env.PHOTOS.get("app/icone-180.png");
      if (o) return new Response(o.body, { headers: { "content-type": "image/png", "cache-control": "public, max-age=604800" } });
      return new Response(ICONE, { headers: { "content-type": "image/svg+xml" } });
    }
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
};
