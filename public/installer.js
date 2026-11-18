/**
 * Bouton « Installer sur ce Mac » (Chrome, Edge) pour le hub et le Suivi.
 *
 * Chrome propose d'installer un site qui a un manifeste et un service worker
 * comme une application : fenetre a part, icone dans le Dock et le Launchpad.
 * Ce script montre le bouton [data-installer] seulement quand Chrome le
 * permet, et le cache une fois l'outil installe (ou ouvert en application).
 */
(() => {
  let invite = null;
  const boutons = () => document.querySelectorAll("[data-installer]");
  const montrer = oui => boutons().forEach(b => { b.hidden = !oui; });
  const installe = () => matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: window-controls-overlay)").matches;

  addEventListener("beforeinstallprompt", e => {
    e.preventDefault();
    invite = e;
    if (!installe()) montrer(true);
  });
  addEventListener("appinstalled", () => { invite = null; montrer(false); });
  document.addEventListener("click", async e => {
    const b = e.target.closest("[data-installer]");
    if (!b) return;
    if (!invite) {
      alert("Pour installer : menu ⋮ de Chrome › Caster, enregistrer et partager › Installer la page en tant qu'application (ou l'icône d'installation à droite de la barre d'adresse).");
      return;
    }
    invite.prompt();
    const { outcome } = await invite.userChoice;
    if (outcome === "accepted") montrer(false);
    invite = null;
  });
  document.addEventListener("DOMContentLoaded", () => montrer(false));
})();
