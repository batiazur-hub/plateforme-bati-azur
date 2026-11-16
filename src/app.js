/**
 * App iPhone du Suivi des demandes : https://batiazurpiscine.fr/app/
 *
 * Une application web installee sur l'ecran d'accueil (Safari > Partager >
 * Sur l'ecran d'accueil) : pas d'App Store, pas de signature a renouveler.
 * Elle vit sur le domaine du portail pour partager sa connexion : le cookie
 * de session est pose ici, et les appels a /app/api/* sont relayes au Worker
 * suivi-clients avec la preuve du portail.
 *
 * Notifications (Web Push, iOS 16.4+) :
 *  - le bilan du matin, vers 7 h 45 : a qui le robot a ecrit dans la nuit,
 *    et ce qui reste a appeler ;
 *  - une nouvelle demande dans la journee (pas la nuit : elle attend le bilan).
 */
import { buildPushPayload } from "@block65/webcrypto-web-push";

const FUSEAU = "Europe/Paris";
const HEURE_BILAN = "07:45";
const NUIT = { debut: 21 };               // de 21 h au bilan : les demandes attendent le bilan

// Ce que l'app peut demander au Suivi. Les routes du robot n'y figurent pas.
const API = [
  /^\/api\/contacts$/,
  /^\/api\/matin$/,
  /^\/api\/contacts\/\d+\/(statut|evenement|notes|relance)$/,
];

// Fichiers lisibles sans session : iOS les charge hors de la page.
const PUBLICS = /^\/app\/(manifest\.webmanifest|sw\.js|icones\/[a-z0-9-]+\.png)$/;

const json = (donnees, statut = 200) => new Response(JSON.stringify(donnees), {
  status: statut, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

/** Heure de Paris : {date: "AAAA-MM-JJ", heure: 7, hhmm: "07:45"}. */
function paris(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("fr-FR", {
    timeZone: FUSEAU, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, heure: Number(p.hour), hhmm: `${p.hour}:${p.minute}` };
}

/* ------------------------------------------------------------ etat (D1) */

async function lire(env, cle) {
  const r = await env.DB.prepare("SELECT valeur FROM etat WHERE cle = ?").bind(cle).first();
  return r ? r.valeur : "";
}
const ecrire = (env, cle, valeur) => env.DB.prepare(
  "INSERT INTO etat (cle, valeur) VALUES (?, ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur")
  .bind(cle, String(valeur)).run();

/* ------------------------------------------------------------ Suivi */

/** Appel au Worker suivi-clients, avec la preuve du portail. */
function suivi(env, chemin, init = {}, email = "") {
  const h = new Headers(init.headers || {});
  for (const k of [...h.keys()]) if (k.startsWith("x-portail")) h.delete(k);
  h.set("x-portail", env.SECRET_PORTAIL);
  if (email) h.set("x-portail-email", email);
  return env.SUIVI.fetch(new Request(`https://suivi.batiazurpiscine.fr${chemin}`, { ...init, headers: h }));
}

/* ------------------------------------------------------------ Web Push */

async function pousser(env, abonnement, donnees) {
  const charge = await buildPushPayload(
    { data: JSON.stringify(donnees), options: { ttl: 6 * 3600, urgency: "high", topic: donnees.sujet } },
    abonnement,
    { subject: "mailto:bati.azur03@gmail.com", publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY },
  );
  const r = await fetch(abonnement.endpoint, charge);
  if (!r.ok) { const e = new Error(`push ${r.status}`); e.statut = r.status; throw e; }
}

/** Envoie a tous les appareils abonnes. -> nombre d'envois reussis. */
async function diffuser(env, donnees) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return 0;
  const { results } = await env.DB.prepare("SELECT endpoint, abonnement FROM abonnements").all();
  let ok = 0;
  for (const a of results) {
    try { await pousser(env, JSON.parse(a.abonnement), donnees); ok++; }
    catch (e) {
      // 404/410 : l'appareil s'est desabonne (app supprimee, autorisation retiree).
      if (e.statut === 404 || e.statut === 410)
        await env.DB.prepare("DELETE FROM abonnements WHERE endpoint = ?").bind(a.endpoint).run();
      else console.warn("push", e.message);
    }
  }
  return ok;
}

const nomCourt = c => (c.nom || c.email || "Sans nom").trim();
const liste = (noms, max = 4) =>
  noms.length <= max ? noms.join(", ") : `${noms.slice(0, max).join(", ")} et ${noms.length - max} autre${noms.length - max > 1 ? "s" : ""}`;

/** Le bilan du matin : mails partis depuis la veille, ce qui reste a faire. */
async function bilan(env, depuis) {
  const r = await suivi(env, `/api/matin?depuis=${encodeURIComponent(depuis)}`);
  if (!r.ok) throw new Error(`suivi ${r.status}`);
  const m = await r.json();
  const n = m.envoyes.length;
  const lignes = [];
  lignes.push(n ? `${n} mail${n > 1 ? "s" : ""} parti${n > 1 ? "s" : ""} : ${liste(m.envoyes.map(nomCourt))}.`
                : "Aucun mail automatique parti cette nuit.");
  const alertes = [];
  if (m.sans_appel) alertes.push(`${m.sans_appel} à appeler (plus de 48 h)`);
  if (m.non_confirmes) alertes.push(`${m.non_confirmes} sans confirmation`);
  lignes.push(alertes.length ? alertes.join(" · ") + "." : `${m.a_traiter} demande${m.a_traiter > 1 ? "s" : ""} à traiter.`);
  return { titre: "Bilan du matin — Suivi Bati Azur", corps: lignes.join("\n"), url: "/app/#matin", sujet: "bilan",
           dernier_id: m.dernier_id };
}

/** Tache planifiee, toutes les 15 minutes. */
export async function planifie(env) {
  const p = paris();
  const jour = await lire(env, "bilan_jour");

  // Le bilan, une fois par jour, des l'heure passee.
  if (p.hhmm >= HEURE_BILAN && jour !== p.date) {
    await ecrire(env, "bilan_jour", p.date);
    const depuis = (await lire(env, "bilan_depuis")) || new Date(Date.now() - 864e5).toISOString();
    await ecrire(env, "bilan_depuis", new Date().toISOString());
    const b = await bilan(env, depuis);
    await diffuser(env, b);
    // Les demandes de la nuit sont dans le bilan : pas de seconde notification.
    if (b.dernier_id) await ecrire(env, "dernier_id", b.dernier_id);
    return;
  }

  // Nouvelles demandes : signalees en journee, gardees pour le bilan la nuit.
  const dernier = Number(await lire(env, "dernier_id")) || 0;
  const r = await suivi(env, `/api/matin?apres=${dernier || 1}`);
  if (!r.ok) return;
  const m = await r.json();
  if (!dernier) { await ecrire(env, "dernier_id", m.dernier_id || 0); return; }
  const nuit = p.heure >= NUIT.debut || p.hhmm < HEURE_BILAN;
  if (!m.nouveaux.length || nuit) return;
  await ecrire(env, "dernier_id", Math.max(dernier, ...m.nouveaux.map(c => c.id)));
  const n = m.nouveaux.length;
  const c = m.nouveaux[0];
  await diffuser(env, n === 1
    ? { titre: "Nouvelle demande", corps: [nomCourt(c), c.ville, c.projet].filter(Boolean).join(" · "),
        url: `/app/#contact-${c.id}`, sujet: "nouveau" }
    : { titre: `${n} nouvelles demandes`, corps: liste(m.nouveaux.map(nomCourt)), url: "/app/#contacts", sujet: "nouveau" });
}

/* ------------------------------------------------------------ routes */

/**
 * Routes /app/* du domaine principal. `qui` : adresse de la session, ou null.
 * Renvoie une Response, ou null si le chemin n'est pas de l'app.
 */
export async function routeApp(requete, env, qui, renouveler) {
  const url = new URL(requete.url);
  const chemin = url.pathname;
  if (chemin === "/app") return Response.redirect(`${url.origin}/app/`, 301);
  if (!chemin.startsWith("/app/")) return null;

  if (PUBLICS.test(chemin)) {
    const r = await env.ASSETS.fetch(requete);
    const h = new Headers(r.headers);
    // Le service worker doit etre relu a chaque visite pour se mettre a jour.
    h.set("cache-control", chemin.endsWith("sw.js") ? "no-cache" : "public, max-age=86400");
    if (chemin.endsWith(".webmanifest")) h.set("content-type", "application/manifest+json");
    return new Response(r.body, { status: r.status, headers: h });
  }

  const estApi = chemin.startsWith("/app/api/") || chemin.startsWith("/app/push");
  if (!qui) {
    if (estApi) return json({ erreur: "non connecte" }, 401);
    return Response.redirect(`${url.origin}/connexion?retour=${encodeURIComponent(`${url.origin}/app/`)}`, 303);
  }

  let reponse;
  if (chemin.startsWith("/app/api/")) {
    const cible = chemin.slice(4);                     // /api/...
    if (!API.some(r => r.test(cible))) return json({ erreur: "route inconnue" }, 404);
    const r = await suivi(env, cible + url.search, {
      method: requete.method,
      headers: { "content-type": "application/json", accept: "application/json" },
      body: requete.method === "GET" ? undefined : await requete.text(),
    }, qui);
    reponse = new Response(r.body, { status: r.status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  } else if (chemin === "/app/push/cle") {
    reponse = json({ cle: env.VAPID_PUBLIC_KEY || "" });
  } else if (chemin === "/app/push" && requete.method === "POST") {
    const { abonnement, appareil } = await requete.json().catch(() => ({}));
    if (!abonnement || !/^https:\/\//.test(abonnement.endpoint || "") || !abonnement.keys)
      return json({ erreur: "abonnement invalide" }, 400);
    await env.DB.prepare(
      `INSERT INTO abonnements (endpoint, abonnement, email, appareil) VALUES (?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET abonnement = excluded.abonnement, appareil = excluded.appareil, maj = datetime('now')`)
      .bind(abonnement.endpoint, JSON.stringify(abonnement), qui, String(appareil || "").slice(0, 120)).run();
    reponse = json({ ok: true });
  } else if (chemin === "/app/push" && requete.method === "DELETE") {
    const { endpoint } = await requete.json().catch(() => ({}));
    await env.DB.prepare("DELETE FROM abonnements WHERE endpoint = ?").bind(String(endpoint || "")).run();
    reponse = json({ ok: true });
  } else if (chemin === "/app/push/essai" && requete.method === "POST") {
    // Le bilan tel qu'il partirait maintenant, sur tous les appareils.
    const n = await diffuser(env, await bilan(env, new Date(Date.now() - 864e5).toISOString()));
    reponse = json({ ok: true, envoyes: n });
  } else {
    // Les fichiers de l'app.
    const r = await env.ASSETS.fetch(requete);
    const h = new Headers(r.headers);
    h.set("cache-control", "no-cache");
    reponse = new Response(r.body, { status: r.status, headers: h });
  }

  // Une app d'ecran d'accueil ne doit pas redemander le mot de passe tous les
  // mois : la session est prolongee a chaque usage.
  const cookie = await renouveler();
  if (cookie) {
    const h = new Headers(reponse.headers);
    h.append("set-cookie", cookie);
    reponse = new Response(reponse.body, { status: reponse.status, headers: h });
  }
  return reponse;
}
