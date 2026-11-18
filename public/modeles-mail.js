/**
 * Mails prets a envoyer depuis le Suivi (ordinateur et app iPhone).
 *
 * Depuis le 18 novembre 2026, plus aucun mail automatique : on clique sur
 * « Envoyer un mail », Gmail s'ouvre avec le message deja ecrit (destinataire,
 * objet, texte), on relit, on modifie si besoin, on envoie. La signature de
 * l'entreprise est toujours au bas du texte (SIGNATURE).
 *
 *   <script src="https://batiazurpiscine.fr/modeles-mail.js"></script>
 *   BatiMails.modeles             -> [{id, nom}]
 *   BatiMails.ouvrir(contact, id) -> ouvre Gmail (nouvel onglet ou app Gmail)
 *
 * Compte Gmail : Chrome peut etre connecte a plusieurs comptes Google. Le
 * numero du compte de l'entreprise (0 = le premier connecte) se regle une fois
 * dans le Suivi et reste memorise sur l'appareil (BatiMails.compte).
 */
(() => {
  const TELEPHONE = "04 70 34 21 96";

  // Signature de la boite Gmail de l'entreprise, toujours ajoutee au bas des
  // mails (Gmail ne l'insere pas dans un brouillon ouvert par lien, ni l'app
  // Gmail de l'iPhone).
  const SIGNATURE = `--
Arnaldo Monteiro
Gérant · Bati Azur Piscines – Spa

Tél. ${TELEPHONE}
Web batiazur.odoo.com
Les Cailles, route de Saint Ennemond – 03000 Avermes

Votre piscine vous rend heureux ?
Votre avis compte beaucoup pour notre équipe : 30 secondes suffisent.
★★★★★ Laisser un avis Google : https://g.page/r/CfwnXPUtWcjnEB0/review`;
  const SUIVI = "https://suivi.batiazurpiscine.fr";

  const A_ENVOYER = [
    "les dimensions ou le modèle qui vous intéressent",
    "quelques photos de l'emplacement prévu",
    "l'accès au terrain (largeur du passage, pente)",
    "la période souhaitée pour les travaux",
  ];

  const bonjour = c => {
    const nom = String(c.nom || "").trim();
    return nom ? `Bonjour ${nom},` : "Bonjour,";
  };
  const projet = c => (c.projet ? ` (${String(c.projet).trim()})` : "");

  function origine(c) {
    if (c.source === "site")
      return "Nous avons bien reçu la demande que vous nous avez adressée depuis notre site internet, et nous vous en remercions.";
    if (c.source === "magasin")
      return "Merci pour votre visite et pour l'intérêt que vous portez à nos réalisations.";
    const detail = c.projet ? ` pour le modèle ${String(c.projet).trim()}` : "";
    return `Votre demande de devis${detail} nous a bien été transmise par Aboral, dont nous sommes le distributeur pour l'Allier, la Nièvre et la Saône-et-Loire. Merci de l'intérêt que vous portez à nos réalisations.`;
  }

  // Le lien de confirmation : le client clique, la fiche passe au vert.
  const confirmation = c => c.jeton
    ? `\nUn clic pour nous confirmer que ce message vous est bien parvenu (vous pourrez aussi indiquer quand vous préférez être rappelé) :\n${SUIVI}/c/${c.jeton}\n`
    : "";

  const MODELES = [
    {
      id: "premiere", nom: "Première réponse",
      sujet: () => "Votre demande de devis piscine — Bati Azur",
      corps: c => `${bonjour(c)}

${origine(c)}
${confirmation(c)}
La suite :
  1. Nous vous recontactons dans les 48 heures ouvrées.
  2. Nous étudions votre projet avec vous, sur place si besoin.
  3. Vous recevez un devis détaillé et personnalisé.

Pour gagner du temps, répondez simplement à ce mail. Vous pouvez déjà nous envoyer :
${A_ENVOYER.map(x => "  - " + x).join("\n")}

Vous préférez en parler ? Appelez-nous au ${TELEPHONE}.

Cordialement,
`,
    },
    {
      id: "relance", nom: "Relance",
      sujet: () => "Votre projet de piscine — Bati Azur",
      corps: c => `${bonjour(c)}

Je reviens vers vous au sujet de votre projet de piscine${projet(c)}. Nous avons essayé de vous joindre sans succès.

Êtes-vous toujours intéressé ? Si oui, dites-nous simplement quand vous êtes disponible pour un appel ou un rendez-vous sur place, et nous nous organisons.

Vous pouvez aussi nous joindre au ${TELEPHONE}.
${confirmation(c)}
Cordialement,
`,
    },
    {
      id: "rdv", nom: "Proposer un rendez-vous",
      sujet: () => "Rendez-vous pour votre projet de piscine — Bati Azur",
      corps: c => `${bonjour(c)}

Pour avancer sur votre projet de piscine${projet(c)}, nous vous proposons de passer chez vous afin de voir l'emplacement et d'étudier ensemble la meilleure solution.

Quelles seraient vos disponibilités dans les prochains jours ?

Vous pouvez répondre directement à ce mail ou nous appeler au ${TELEPHONE}.

Cordialement,
`,
    },
    {
      id: "devis", nom: "Envoi du devis",
      sujet: () => "Votre devis piscine — Bati Azur",
      corps: c => `${bonjour(c)}

Comme convenu, vous trouverez ci-joint notre devis pour votre projet de piscine${projet(c)}.

Nous restons à votre disposition pour en parler, l'ajuster si besoin, ou vous recevoir au magasin. N'hésitez pas à nous appeler au ${TELEPHONE}.

Cordialement,
`,
    },
    { id: "vierge", nom: "Mail vierge", sujet: () => "", corps: c => `${bonjour(c)}\n\n\n\nCordialement,\n` },
  ];

  const mobile = () => /iPhone|iPad|iPod|Android/.test(navigator.userAgent);

  /** Numero du compte Gmail dans Chrome (0 = premier compte connecte). */
  const compte = {
    lire() { try { return localStorage.getItem("bati.compteGmail") || "0"; } catch { return "0"; } },
    ecrire(n) { try { localStorage.setItem("bati.compteGmail", String(n).replace(/\D/g, "") || "0"); } catch {} },
  };
  const base = () => `https://mail.google.com/mail/u/${compte.lire()}/`;

  function brouillon(c, id) {
    const m = MODELES.find(x => x.id === id) || MODELES[0];
    return { modele: m.id, nom: m.nom, a: c.email || "", sujet: m.sujet(c), corps: m.corps(c) + "\n" + SIGNATURE + "\n" };
  }

  /** Adresse qui ouvre le brouillon : Gmail dans un nouvel onglet sur
   *  ordinateur, l'app Gmail sur iPhone (mailto: en secours). */
  function lien(b, ou) {
    const q = (k, v) => `${k}=${encodeURIComponent(v)}`;
    if (ou === "mailto") return `mailto:${encodeURIComponent(b.a)}?${q("subject", b.sujet)}&${q("body", b.corps)}`;
    if (ou === "app") return `googlegmail:///co?${q("to", b.a)}&${q("subject", b.sujet)}&${q("body", b.corps)}`;
    return `${base()}?view=cm&fs=1&tf=1&${q("to", b.a)}&${q("su", b.sujet)}&${q("body", b.corps)}`;
  }

  function ouvrir(c, id, ou) {
    const b = brouillon(c, id);
    const cible = ou || (mobile() ? "app" : "web");
    const url = lien(b, cible);
    if (cible === "web") window.open(url, "_blank", "noopener");
    else location.href = url;
    return b;
  }

  /** Tous les echanges avec ce client, dans Gmail. */
  const rechercheGmail = adresse => `${base()}#search/${encodeURIComponent(adresse)}`;
  /** Un fil precis dans Gmail (identifiant hexadecimal du fil). */
  const filGmail = fil => `${base()}#all/${fil}`;

  window.BatiMails = {
    modeles: MODELES.map(({ id, nom }) => ({ id, nom })),
    brouillon, lien, ouvrir, rechercheGmail, filGmail, mobile, compte,
  };
})();
