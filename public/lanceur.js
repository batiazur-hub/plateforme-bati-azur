/**
 * Lanceur des outils Bati Azur : le bouton a 4 points qui permet de passer
 * d'un outil a l'autre, comme chez Google. Le meme sur ordinateur et sur
 * telephone.
 *
 *   <script src="https://batiazurpiscine.fr/lanceur.js" defer></script>
 *
 * Sans emplacement prevu, le bouton flotte en haut a droite. Une page peut lui
 * reserver une place avec un element <span data-lanceur-bati></span>.
 * Tout est dans un shadow DOM : aucun style de la page n'est touche.
 */
(() => {
  if (window.__lanceurBati) return;
  window.__lanceurBati = true;

  const BASE = "https://batiazurpiscine.fr";
  const ICONE = id => `${BASE}/icones-outils/png/${id}-96.png`;
  const OUTILS = [
    { id: "hub", nom: "Hub", url: `${BASE}/hub/` },
    { id: "suivi", nom: "Suivi", url: "https://suivi.batiazurpiscine.fr/" },
    { id: "terrain", nom: "Terrain", url: "https://bati-azur-terrain.batiazur-mail.workers.dev/" },
    { id: "pro", nom: "Analyse Pro", url: "https://pro.batiazurpiscine.fr/" },
    { id: "analyse", nom: "Analyse", url: "https://analyse.batiazurpiscine.fr/" },
    { id: "implantation", nom: "Implantation", url: "https://implantation.batiazurpiscine.fr/" },
    { id: "bons", nom: "Bons d'achat", url: "https://bons.batiazurpiscine.fr/" },
    { id: "mails", nom: "Mails", url: "https://batiazur-hub.github.io/mail-generator-bati-azur/" },
    { id: "etiquettes", nom: "Étiquettes", url: "https://batiazur-hub.github.io/generateur-etiquettes-bati-azur/" },
    { id: "actus", nom: "Actualités", url: "https://batiazur-hub.github.io/batiazur-analyse/admin-actus.html" },
  ];

  // L'outil ouvert, pour le mettre en evidence.
  const ici = location.href;
  const actuel = (OUTILS.find(o => o.id !== "hub" && ici.startsWith(o.url)) ||
                  (ici.startsWith(BASE + "/hub") ? OUTILS[0] : null) || {}).id;

  const css = `
:host{all:initial}
*{box-sizing:border-box;font-family:-apple-system,system-ui,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
.btn{width:40px;height:40px;border-radius:50%;border:0;background:transparent;cursor:pointer;display:grid;place-items:center;
  color:#3c4043;-webkit-tap-highlight-color:transparent;transition:background .15s}
.btn:hover,.btn[aria-expanded=true]{background:rgba(60,64,67,.10)}
.btn:focus-visible{outline:2px solid #4682C7;outline-offset:2px}
.flotte .btn{background:rgba(255,255,255,.92);box-shadow:0 1px 3px rgba(0,0,0,.18),0 4px 12px rgba(0,0,0,.08);
  -webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px)}
.flotte .btn:hover,.flotte .btn[aria-expanded=true]{background:#fff}
.points{display:grid;grid-template-columns:repeat(2,6px);gap:4px}
.points i{width:6px;height:6px;border-radius:50%;background:currentColor;display:block}
.panneau{position:fixed;z-index:2147483647;width:316px;max-width:calc(100vw - 16px);max-height:calc(100vh - 80px);overflow:auto;
  background:#fff;border-radius:22px;padding:14px 10px 10px;box-shadow:0 2px 6px rgba(0,0,0,.15),0 12px 36px rgba(0,0,0,.18);
  opacity:0;transform:translateY(-6px) scale(.98);transform-origin:top right;pointer-events:none;transition:opacity .14s,transform .14s}
.panneau.ouvert{opacity:1;transform:none;pointer-events:auto}
.titre{font-size:12px;font-weight:600;color:#5f6368;letter-spacing:.03em;text-transform:uppercase;margin:0 8px 8px}
.grille{display:grid;grid-template-columns:repeat(3,1fr);gap:2px}
a.outil{display:flex;flex-direction:column;align-items:center;gap:7px;padding:12px 4px 10px;border-radius:14px;text-decoration:none;
  color:#202124;font-size:12.5px;line-height:1.2;text-align:center;-webkit-tap-highlight-color:transparent}
a.outil:hover,a.outil:focus-visible{background:#f1f5fb;outline:none}
a.outil.actuel{background:#eaf2fb}
a.outil img{width:48px;height:48px;border-radius:12px;display:block;box-shadow:0 1px 3px rgba(11,58,94,.18)}
@media (prefers-color-scheme:dark){
  .btn{color:#e8eaed}.btn:hover,.btn[aria-expanded=true]{background:rgba(232,234,237,.12)}
  .flotte .btn{background:rgba(40,40,44,.9)}.flotte .btn:hover{background:#2c2c30}
  .panneau{background:#2c2c30;box-shadow:0 12px 36px rgba(0,0,0,.5)}
  .titre{color:#9aa0a6}a.outil{color:#e8eaed}a.outil:hover{background:#3a3a40}a.outil.actuel{background:#24364d}
}
@media (max-width:480px){.panneau{width:calc(100vw - 16px)}}
@media (prefers-reduced-motion:reduce){.panneau{transition:none}}`;

  function monter() {
    const hote = document.createElement("span");
    const place = document.querySelector("[data-lanceur-bati]");
    const flotte = !place;
    if (flotte) {
      hote.style.cssText = "position:fixed;top:calc(env(safe-area-inset-top,0px) + 10px);right:10px;z-index:2147483646;";
      document.body.appendChild(hote);
    } else {
      hote.style.cssText = "display:inline-block;vertical-align:middle;";
      place.appendChild(hote);
    }
    const ombre = hote.attachShadow({ mode: "open" });
    ombre.innerHTML = `<style>${css}</style>
      <div class="${flotte ? "flotte" : ""}">
        <button class="btn" type="button" aria-label="Outils Bati Azur" aria-haspopup="true" aria-expanded="false" title="Outils Bati Azur">
          <span class="points"><i></i><i></i><i></i><i></i></span>
        </button>
      </div>
      <div class="panneau" role="menu" aria-label="Outils Bati Azur">
        <div class="titre">Outils Bati Azur</div>
        <div class="grille">${OUTILS.map(o => `<a class="outil${o.id === actuel ? " actuel" : ""}" role="menuitem" href="${o.url}"${o.id === actuel ? ' aria-current="page"' : ""}>
          <img src="${ICONE(o.id)}" alt="" width="48" height="48" loading="lazy"><span>${o.nom}</span></a>`).join("")}</div>
      </div>`;
    const btn = ombre.querySelector(".btn");
    const panneau = ombre.querySelector(".panneau");

    const placer = () => {
      const r = btn.getBoundingClientRect();
      const l = Math.min(panneau.offsetWidth || 316, window.innerWidth - 16);
      panneau.style.top = Math.round(r.bottom + 8) + "px";
      panneau.style.left = Math.round(Math.max(8, Math.min(r.right - l, window.innerWidth - l - 8))) + "px";
    };
    const ouvrir = (oui, clavier) => {
      if (oui) placer();
      panneau.classList.toggle("ouvert", oui);
      btn.setAttribute("aria-expanded", String(oui));
      if (oui && clavier) (ombre.querySelector("a.actuel") || ombre.querySelector("a.outil")).focus({ preventScroll: true });
    };
    // detail === 0 : bouton actionne au clavier (Entree, Espace).
    btn.addEventListener("click", e => { e.stopPropagation(); ouvrir(!panneau.classList.contains("ouvert"), e.detail === 0); });
    panneau.addEventListener("click", e => e.stopPropagation());
    document.addEventListener("click", () => ouvrir(false));
    document.addEventListener("keydown", e => { if (e.key === "Escape" && panneau.classList.contains("ouvert")) { ouvrir(false); btn.focus(); } });
    window.addEventListener("resize", () => panneau.classList.contains("ouvert") && placer());
    window.addEventListener("scroll", () => panneau.classList.contains("ouvert") && placer(), { passive: true });
  }

  if (document.body) monter();
  else document.addEventListener("DOMContentLoaded", monter);
})();
