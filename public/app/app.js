// App iPhone du Suivi des demandes Bati Azur.
"use strict";

const $ = s => document.querySelector(s);
const ech = t => String(t ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const SOURCES = { aboral: "Aboral", site: "Site", magasin: "Magasin" };
const APPELS = ["appel_repondu", "appel_sans_reponse", "rdv", "devis"];
const GENRES = { appel_sans_reponse: "Appelé, pas de réponse", appel_repondu: "Appelé", rdv: "Rendez-vous", devis: "Devis envoyé", note: "Note" };
const CRENEAUX = { matin: "le matin", midi: "entre 12 h et 14 h", apres_midi: "l'après-midi", soir: "en fin de journée" };

const etat = {
  vue: "matin", contacts: [], matin: null, filtre: "a_traiter", recherche: "", limite: 40,
  periode: 1, charge: 0,
};

/* ------------------------------------------------------------ outils */

async function api(chemin, options = {}) {
  const r = await fetch("/app/api" + chemin, {
    credentials: "same-origin", headers: { "content-type": "application/json" }, ...options,
  });
  if (r.status === 401) { location.href = "/connexion?retour=" + encodeURIComponent(location.origin + "/app/"); throw new Error("non connecté"); }
  if (!r.ok) throw new Error("Erreur " + r.status);
  return r.json();
}

function toast(texte) {
  const t = $("#toast"); t.textContent = texte; t.classList.add("vu");
  clearTimeout(toast.m); toast.m = setTimeout(() => t.classList.remove("vu"), 2400);
}

const aujourdhui = () => new Date().toISOString().slice(0, 10);
const ilYa = j => new Date(Date.now() - j * 864e5).toISOString().slice(0, 10);

function dateCourte(iso) {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
  const j = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 864e5);
  if (j === 0) return "aujourd'hui";
  if (j === 1) return "hier";
  if (j < 7) return d.toLocaleDateString("fr-FR", { weekday: "long" });
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}
const heure = iso => iso ? new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "";
const quandEnvoi = iso => iso ? `${dateCourte(iso)} à ${heure(iso)}` : "";

/** Couleur de la fiche : rouge = personne n'a appelé depuis 48 h, orange = mail
 *  parti sans confirmation du client depuis 48 h, vert = le client a confirmé. */
function couleur(c) {
  if (c.statut !== "a_traiter") return "";
  const appele = (c.evenements || []).some(e => APPELS.includes(e.genre));
  if (!appele && c.recu <= ilYa(2)) return "rouge";
  if (c.repondu && !c.confirme && c.repondu <= ilYa(2)) return "orange";
  if (c.confirme) return "vert";
  return "";
}
function etiquetteEtat(c) {
  const k = couleur(c);
  if (c.statut === "traite") return `<span class="etat gris">Traité</span>`;
  if (k === "rouge") return `<span class="etat rouge">Personne n'a appelé (+ 48 h)</span>`;
  if (k === "orange") return `<span class="etat orange">Mail non confirmé (+ 48 h)</span>`;
  if (c.confirme) return `<span class="etat vert">Le client a confirmé la réception</span>`;
  if (c.repondu) return `<span class="etat gris">Mail parti, en attente du client</span>`;
  return `<span class="etat gris">À traiter</span>`;
}

const icTel = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.1 9.9a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`;
const icMail = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>`;
const telLien = t => "tel:" + String(t || "").replace(/[^\d+]/g, "");

function boutonsContact(c) {
  return `<div class="actions">
    ${c.telephone ? `<a class="rond tel" href="${telLien(c.telephone)}" aria-label="Appeler ${ech(c.nom)}">${icTel}</a>` : ""}
    ${c.email ? `<a class="rond" href="mailto:${ech(c.email)}" aria-label="Écrire à ${ech(c.nom)}">${icMail}</a>` : ""}
  </div>`;
}

/* ------------------------------------------------------------ chargement */

async function charger(silencieux) {
  const n = ++etat.charge;
  $("#rafraichir").classList.add("tourne");
  try {
    const depuis = new Date(Date.now() - etat.periode * 864e5).toISOString();
    const [contacts, matin] = await Promise.all([
      api("/contacts"), api("/matin?depuis=" + encodeURIComponent(depuis)),
    ]);
    if (n !== etat.charge) return;
    etat.contacts = contacts.contacts; etat.matin = matin;
    $("#maj").textContent = "à jour " + heure(new Date().toISOString());
    rendre();
    const h = location.hash.match(/^#contact-(\d+)$/);
    if (h && !$("#fiche").classList.contains("ouvert")) ouvrir(Number(h[1]));
  } catch (e) {
    if (!silencieux) toast("Impossible de charger : " + e.message);
  } finally {
    $("#rafraichir").classList.remove("tourne");
  }
}

/* ------------------------------------------------------------ vues */

function rendre() {
  for (const v of ["matin", "contacts"]) {
    $("#v-" + v).classList.toggle("cache", etat.vue !== v);
    $("#o-" + v).classList.toggle("actif", etat.vue === v);
  }
  if (etat.vue === "matin") rendreMatin(); else rendreContacts();
}

function rendreMatin() {
  const m = etat.matin; if (!m) return;
  const parId = new Map(etat.contacts.map(c => [c.id, c]));
  const rouges = etat.contacts.filter(c => couleur(c) === "rouge");
  const oranges = etat.contacts.filter(c => couleur(c) === "orange");
  const titre = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const periodes = [[1, "24 h"], [3, "3 jours"], [7, "7 jours"]];
  let h = `<h1>${ech(titre.charAt(0).toUpperCase() + titre.slice(1))}</h1>
    <p class="sous">${m.envoyes.length ? `Le robot a répondu à ${m.envoyes.length} client${m.envoyes.length > 1 ? "s" : ""}.` : "Aucun mail automatique sur la période."}</p>
    <div class="chiffres">
      <button class="chiffre" data-filtre="a_traiter"><b>${m.a_traiter}</b><span>à traiter</span></button>
      <button class="chiffre ${rouges.length ? "rouge" : ""}" data-filtre="rouge"><b>${rouges.length}</b><span>à appeler</span></button>
      <button class="chiffre ${oranges.length ? "orange" : ""}" data-filtre="orange"><b>${oranges.length}</b><span>sans confirmation</span></button>
    </div>
    <h2 style="display:flex;justify-content:space-between;align-items:center">Mails envoyés
      <span class="puces" style="margin:0;padding:0">${periodes.map(([j, t]) =>
        `<button data-periode="${j}" class="${etat.periode === j ? "actif" : ""}" style="padding:3px 9px;font-size:12px">${t}</button>`).join("")}</span></h2>`;
  h += m.envoyes.length ? `<div class="liste">${m.envoyes.map(e => {
      const c = parId.get(e.id) || e;
      return `<button class="ligne" data-id="${e.id}">
        <span class="point ${e.confirme ? "vert" : ""}"></span>
        <div class="corps"><div class="nom">${ech(e.nom || e.email)}</div>
          <div class="det">${e.confirme ? "✓ réception confirmée · " : ""}${ech([e.ville, e.projet].filter(Boolean).join(" · ") || e.email)}</div></div>
        <div class="heure">${ech(dateCourte(e.mail_envoye))}<br><b style="color:var(--texte)">${heure(e.mail_envoye)}</b></div>
      </button>`; }).join("")}</div>`
    : `<div class="vide">Aucun mail parti sur la période.</div>`;
  if (rouges.length) {
    h += `<h2>À appeler en priorité</h2><div class="liste">${rouges.slice(0, 8).map(ligneContact).join("")}</div>`;
    if (rouges.length > 8) h += `<button class="plus" data-filtre="rouge">Voir les ${rouges.length - 8} autres</button>`;
  }
  $("#v-matin").innerHTML = h;
}

function ligneContact(c) {
  return `<div class="ligne" data-id="${c.id}" role="button">
    <span class="point ${couleur(c)}"></span>
    <div class="corps">
      <div class="nom">${ech(c.nom || c.email || "Sans nom")} <span class="source">${ech(SOURCES[c.source] || c.source)}</span></div>
      <div class="det">${ech([dateCourte(c.recu), c.ville, c.projet].filter(Boolean).join(" · "))}</div>
    </div>
    ${boutonsContact(c)}
  </div>`;
}

const FILTRES = [["a_traiter", "À traiter"], ["rouge", "À appeler"], ["orange", "Sans confirmation"],
                 ["tous", "Tous"], ["aboral", "Aboral"], ["site", "Site"], ["magasin", "Magasin"], ["traite", "Traités"]];

function filtrer() {
  const q = etat.recherche.trim().toLowerCase();
  const chiffres = q.replace(/\D/g, "");
  return etat.contacts.filter(c => {
    const f = etat.filtre;
    if (f === "a_traiter" && c.statut !== "a_traiter") return false;
    if (f === "traite" && c.statut !== "traite") return false;
    if ((f === "rouge" || f === "orange") && couleur(c) !== f) return false;
    if (SOURCES[f] && c.source !== f) return false;
    if (!q) return true;
    const texte = [c.nom, c.ville, c.email, c.projet, c.notes].join(" ").toLowerCase();
    return texte.includes(q) || (chiffres.length >= 3 && String(c.telephone).replace(/\D/g, "").includes(chiffres));
  });
}

function rendreContacts() {
  $("#puces").innerHTML = FILTRES.map(([k, t]) => {
    const n = k === "tous" ? etat.contacts.length : null;
    return `<button data-filtre="${k}" class="${etat.filtre === k ? "actif" : ""}">${t}${n !== null ? ` · ${n}` : ""}</button>`;
  }).join("");
  const l = filtrer();
  $("#liste").innerHTML = l.length
    ? `<div class="liste">${l.slice(0, etat.limite).map(ligneContact).join("")}</div>` +
      (l.length > etat.limite ? `<button class="plus" id="plus">Afficher plus (${l.length - etat.limite})</button>` : "")
    : `<div class="vide">Aucun contact ${etat.recherche ? "ne correspond à la recherche" : "dans cette catégorie"}.</div>`;
}

/* ------------------------------------------------------------ fiche */

function ouvrir(id) {
  const c = etat.contacts.find(x => x.id === id);
  if (!c) return;
  history.replaceState(null, "", "#contact-" + id);
  const lignes = [
    ["Reçue", dateCourte(c.recu) + (c.recu ? ` (${new Date(c.recu + "T12:00").toLocaleDateString("fr-FR")})` : "")],
    ["Provenance", SOURCES[c.source] || c.source], ["Ville", c.ville], ["Projet", c.projet],
    ["Téléphone", c.telephone ? `<a href="${telLien(c.telephone)}">${ech(c.telephone)}</a>` : "", true],
    ["Mail", c.email ? `<a href="mailto:${ech(c.email)}">${ech(c.email)}</a>` : "", true],
    ["Rappel prévu", c.relance ? dateCourte(c.relance) : ""],
  ].filter(l => l[1]);
  let h = `<div class="poignee"></div><button class="fermer" data-fermer aria-label="Fermer">×</button>
    <h1 style="padding-right:40px">${ech(c.nom || c.email || "Sans nom")}</h1>
    <div>${etiquetteEtat(c)}</div>
    <div class="gros">
      <a href="${telLien(c.telephone)}" class="${c.telephone ? "" : "inactif"}">${icTel}Appeler</a>
      <a href="mailto:${ech(c.email)}" class="${c.email ? "" : "inactif"}">${icMail}Écrire</a>
    </div>
    <div class="info">${lignes.map(([k, v, brut]) => `<div><span>${k}</span><b>${brut ? v : ech(v)}</b></div>`).join("")}</div>`;
  if (c.confirme || c.creneau || c.message_client) {
    h += `<h2>Réponse du client</h2><div class="mail">${c.confirme ? `<div class="quand">Réception confirmée ${ech(quandEnvoi(c.confirme))}</div>` : ""}${
      c.creneau ? `Préfère être rappelé ${ech(CRENEAUX[c.creneau] || c.creneau)}.\n` : ""}${ech(c.message_client)}</div>`;
  }
  h += `<h2>Mail automatique</h2>`;
  if (c.mail_envoye || c.repondu) {
    h += `<div class="mail"><div class="obj">${ech(c.mail_sujet || "Votre demande de devis piscine — Bati Azur")}</div>
      <div class="quand">Parti ${c.mail_envoye ? ech(quandEnvoi(c.mail_envoye)) : ech(dateCourte(c.repondu))} à ${ech(c.email)}</div>${
      c.mail_texte ? ech(c.mail_texte) : `<span style="color:var(--gris)">Le contenu n'est enregistré que pour les mails partis depuis le 17 novembre 2026.</span>`}</div>`;
  } else {
    h += `<div class="vide">Aucun mail automatique envoyé à ce contact.</div>`;
  }
  if (c.notes) h += `<h2>Notes</h2><div class="mail">${ech(c.notes)}</div>`;
  if ((c.evenements || []).length) {
    h += `<h2>Historique</h2><div class="liste histo">${c.evenements.map(e => `<div class="ligne"><div class="corps">
      <div class="nom" style="font-weight:500">${ech(GENRES[e.genre] || e.genre)}</div>${e.detail ? `<div class="det" style="white-space:normal">${ech(e.detail)}</div>` : ""}</div>
      <div class="heure">${ech(dateCourte(e.quand))}${e.heure ? "<br>" + ech(e.heure) : ""}</div></div>`).join("")}</div>`;
  }
  h += `<h2>Noter</h2><div class="boutons">
    <button class="principal" data-ev="appel_repondu">J'ai eu le client au téléphone</button>
    <button data-ev="appel_sans_reponse">Appelé, pas de réponse</button>
    <button data-statut="${c.statut === "traite" ? "a_traiter" : "traite"}">${c.statut === "traite" ? "Remettre à traiter" : "Marquer comme traité"}</button>
  </div>`;
  const f = $("#fiche"); f.innerHTML = h; f.dataset.id = id; f.scrollTop = 0;
  f.classList.add("ouvert"); $("#voile").classList.add("ouvert");
}

function fermer() {
  $("#fiche").classList.remove("ouvert"); $("#voile").classList.remove("ouvert");
  history.replaceState(null, "", "#" + etat.vue);
}

async function noter(id, genre) {
  try {
    const r = await api(`/contacts/${id}/evenement`, { method: "POST", body: JSON.stringify({ genre, quand: aujourdhui(),
      heure: new Date().toTimeString().slice(0, 5) }) });
    if (r.contacts) etat.contacts = r.contacts;
    toast("C'est noté."); rendre(); ouvrir(id);
  } catch (e) { toast("Échec : " + e.message); }
}

async function changerStatut(id, valeur) {
  try {
    await api(`/contacts/${id}/statut`, { method: "POST", body: JSON.stringify({ valeur }) });
    const c = etat.contacts.find(x => x.id === id); if (c) c.statut = valeur;
    toast(valeur === "traite" ? "Marqué comme traité." : "Remis à traiter."); rendre(); ouvrir(id);
  } catch (e) { toast("Échec : " + e.message); }
}

/* ------------------------------------------------------------ notifications */

const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
const installee = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

function b64(cle) {
  const p = "=".repeat((4 - cle.length % 4) % 4);
  const s = atob((cle + p).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}

async function bandeau() {
  const zone = $("#bandeau");
  if (ios && !installee()) {
    zone.innerHTML = `<div class="bandeau"><div><b>Installer l'app sur l'iPhone</b>Touchez <b style="display:inline">Partager</b>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4682C7" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/></svg>
      puis <b style="display:inline">Sur l'écran d'accueil</b>. Les notifications ne marchent que depuis l'app installée.</div></div>`;
    return;
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) { zone.innerHTML = ""; return; }
  const reg = await navigator.serviceWorker.ready;
  const abo = await reg.pushManager.getSubscription();
  if (Notification.permission === "granted" && abo) {
    zone.innerHTML = localStorage.getItem("essaiFait") ? "" :
      `<div class="bandeau"><div><b>Notifications activées</b>Bilan chaque matin vers 7 h 45, et les nouvelles demandes en journée.</div>
       <button id="essai">Tester</button></div>`;
    return;
  }
  if (Notification.permission === "denied") {
    zone.innerHTML = `<div class="bandeau"><div><b>Notifications bloquées</b>Réglages › Notifications › Suivi, puis autorisez.</div></div>`;
    return;
  }
  zone.innerHTML = `<div class="bandeau"><div><b>Bilan du matin</b>Recevez chaque matin qui a été contacté, et les nouvelles demandes.</div>
    <button id="activer">Activer</button></div>`;
}

async function activer() {
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { toast("Notifications refusées."); return bandeau(); }
    const { cle } = await fetch("/app/push/cle", { credentials: "same-origin" }).then(r => r.json());
    if (!cle) throw new Error("clé de notification absente");
    const reg = await navigator.serviceWorker.ready;
    const abo = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(cle) });
    const r = await fetch("/app/push", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
      body: JSON.stringify({ abonnement: abo.toJSON(), appareil: navigator.userAgent.match(/iPhone|iPad|Mac|Android/)?.[0] || "" }) });
    if (!r.ok) throw new Error("enregistrement " + r.status);
    toast("Notifications activées.");
  } catch (e) { toast("Échec : " + e.message); }
  bandeau();
}

async function essai() {
  const r = await fetch("/app/push/essai", { method: "POST", credentials: "same-origin" }).then(r => r.json()).catch(() => ({}));
  localStorage.setItem("essaiFait", "1");
  toast(r.envoyes ? "Notification envoyée." : "Aucun appareil n'a reçu la notification.");
  bandeau();
}

/* ------------------------------------------------------------ événements */

document.addEventListener("click", e => {
  if (e.target.closest("a")) return;          // appeler / écrire : le lien suffit
  const t = e.target.closest("button,[data-id],[data-fermer]");
  if (!t) return;
  if (t.dataset.vue) { etat.vue = t.dataset.vue; history.replaceState(null, "", "#" + etat.vue); window.scrollTo(0, 0); return rendre(); }
  if (t.dataset.periode) { etat.periode = Number(t.dataset.periode); return charger(); }
  if (t.dataset.filtre) { etat.filtre = t.dataset.filtre; etat.limite = 40; etat.vue = "contacts"; window.scrollTo(0, 0); return rendre(); }
  if (t.id === "plus") { etat.limite += 40; return rendreContacts(); }
  if (t.id === "rafraichir") return charger();
  if (t.id === "activer") return activer();
  if (t.id === "essai") return essai();
  if (t.dataset.fermer !== undefined) return fermer();
  const id = Number($("#fiche").dataset.id);
  if (t.dataset.ev) return noter(id, t.dataset.ev);
  if (t.dataset.statut) return changerStatut(id, t.dataset.statut);
  if (t.dataset.id) return ouvrir(Number(t.dataset.id));
});
$("#voile").addEventListener("click", fermer);
$("#recherche").addEventListener("input", e => { etat.recherche = e.target.value; etat.limite = 40; rendreContacts(); });

// Fiche : glisser vers le bas pour fermer.
(() => {
  const f = $("#fiche"); let y0 = null;
  f.addEventListener("touchstart", e => { y0 = f.scrollTop <= 0 ? e.touches[0].clientY : null; }, { passive: true });
  f.addEventListener("touchend", e => { if (y0 !== null && e.changedTouches[0].clientY - y0 > 90) fermer(); y0 = null; }, { passive: true });
})();

// Temps réel : actualisation toutes les 30 s quand l'app est à l'écran.
document.addEventListener("visibilitychange", () => { if (!document.hidden) { charger(true); bandeau(); } });
setInterval(() => { if (!document.hidden) charger(true); }, 30000);

// Clic sur une notification alors que l'app est ouverte.
navigator.serviceWorker?.addEventListener("message", e => {
  if (e.data?.url) { location.hash = new URL(e.data.url, location.origin).hash; route(); charger(true); }
});

function route() {
  const h = location.hash;
  if (h === "#contacts") etat.vue = "contacts";
  else if (h.startsWith("#contact-")) etat.vue = etat.vue || "matin";
  else etat.vue = "matin";
}

route();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/app/sw.js", { scope: "/app/" }).then(bandeau).catch(() => {});
else bandeau();
charger();
