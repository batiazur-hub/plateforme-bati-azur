/**
 * Relevé d'heures — https://heures.batiazurpiscine.fr (derrière la connexion du hub).
 *
 * La page est celle du relevé créé sur Claude (public/outils/heures/index.html).
 * Elle range ses données comme des documents : « employes/<id> »,
 * « pointages/<salarié>_<aaaa-mm> », « config/general ». Ici, chaque document
 * est une ligne de la table `heures` (base du portail) ; chaque modification
 * est aussi recopiée dans `heures_journal`, avec l'avant et l'après, pour
 * pouvoir revenir en arrière en cas d'erreur de saisie.
 */

const CHEMIN = /^(employes\/[A-Za-z0-9_-]{1,40}|pointages\/[A-Za-z0-9_-]{1,40}_\d{4}-\d{2}|config\/general)$/;
const MAX = 64 * 1024;

const json = (obj, status = 200) => new Response(JSON.stringify(obj),
  { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

async function tables(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS heures (
      chemin TEXT PRIMARY KEY, donnees TEXT NOT NULL,
      maj TEXT NOT NULL DEFAULT (datetime('now')), par TEXT NOT NULL DEFAULT '')`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS heures_journal (
      id INTEGER PRIMARY KEY AUTOINCREMENT, quand TEXT NOT NULL DEFAULT (datetime('now')),
      chemin TEXT NOT NULL, avant TEXT, apres TEXT, par TEXT NOT NULL DEFAULT '')`),
  ]);
}

export async function routeHeures(requete, env, qui, chemin) {
  // Toutes les données d'un coup : deux salariés, quelques dizaines de mois.
  if (chemin === "/api/tout" && requete.method === "GET") {
    await tables(env);
    const { results } = await env.DB.prepare("SELECT chemin, donnees FROM heures").all();
    return json({ docs: results.map(r => ({ chemin: r.chemin, donnees: JSON.parse(r.donnees) })) });
  }

  // Écrire ou effacer un document.
  if (chemin === "/api/ecrire" && requete.method === "POST") {
    // une page d'un autre site ne doit pas pouvoir écrire à la place de l'utilisateur
    const origine = requete.headers.get("origin");
    if (origine && origine !== new URL(requete.url).origin) return json({ erreur: "origine" }, 403);
    let corps;
    try { corps = await requete.json(); } catch { return json({ erreur: "json" }, 400); }
    const c = String(corps?.chemin || "");
    if (!CHEMIN.test(c)) return json({ erreur: "chemin" }, 400);
    const apres = corps.donnees == null ? null : JSON.stringify(corps.donnees);
    if (apres && apres.length > MAX) return json({ erreur: "trop gros" }, 413);
    await tables(env);
    const avant = await env.DB.prepare("SELECT donnees FROM heures WHERE chemin = ?").bind(c).first();
    if ((avant?.donnees ?? null) === apres) return json({ ok: true });
    const ops = [env.DB.prepare("INSERT INTO heures_journal (chemin, avant, apres, par) VALUES (?, ?, ?, ?)")
      .bind(c, avant?.donnees ?? null, apres, qui)];
    ops.push(apres === null
      ? env.DB.prepare("DELETE FROM heures WHERE chemin = ?").bind(c)
      : env.DB.prepare(`INSERT INTO heures (chemin, donnees, maj, par) VALUES (?, ?, datetime('now'), ?)
          ON CONFLICT(chemin) DO UPDATE SET donnees = excluded.donnees, maj = excluded.maj, par = excluded.par`)
          .bind(c, apres, qui));
    await env.DB.batch(ops);
    return json({ ok: true });
  }

  if (chemin === "/" || chemin === "/index.html") {
    const r = await env.ASSETS.fetch(new Request("https://batiazurpiscine.fr/outils/heures/"));
    return new Response(r.body, { status: r.status,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-cache" } });
  }
  return new Response("Introuvable", { status: 404 });
}
