/* Freebox PVR — carte du tableau de bord : guide Programme TNT FR + enregistrement sur la Freebox.
   Chargée sur toutes les pages par l'intégration (aucune ressource Lovelace à ajouter). */

const VERSION_CARTE = "2026.11.2";

const TEXTES = {
  fr: {
    titre: "Programme TV",
    onglets: { maintenant: "Maintenant", soir: "Ce soir", enregistrements: "Enregistrements" },
    creneaux: { current: "En cours", next: "Ensuite", prime_time: "Première partie", second_part: "Deuxième partie" },
    enregistrer: "Enregistrer sur la Freebox",
    programme: "Enregistrement programmé — appuyer pour annuler",
    confirmer: "Annuler ?",
    en_cours: "Enregistrement en cours — appuyer pour arrêter",
    introuvable: "Chaîne introuvable sur la Freebox (voir les options de Freebox PVR)",
    aucun_guide: "Aucun capteur Programme TNT FR trouvé.",
    aucune_pvr: "Intégration Freebox PVR non trouvée.",
    aucun_enr: "Aucun enregistrement programmé.",
    pas_de_programme: "Pas de programme",
    conflit: "Conflit",
    reste: "encore {n} min",
    ok_enr: "Enregistrement programmé : {t}",
    deja: "Déjà programmé : {t}",
    ok_ann: "Enregistrement annulé : {t}",
    erreur: "Freebox PVR : {e}",
    etats: { waiting_start_time: "Prévu", starting: "Démarrage", running: "En cours", finished: "Terminé", failed: "Échec", disabled: "Désactivé" },
    ed: {
      title: "Titre", chaines: "Chaînes (vide = toutes, dans l'ordre choisi)", onglet: "Onglet affiché à l'ouverture",
      afficher_affiches: "Afficher les affiches dans le détail", pvr_entity: "Capteur « Enregistrements programmés » (facultatif)",
    },
  },
  en: {
    titre: "TV guide",
    onglets: { maintenant: "Now", soir: "Tonight", enregistrements: "Recordings" },
    creneaux: { current: "Now", next: "Next", prime_time: "Prime time", second_part: "Second part" },
    enregistrer: "Record on the Freebox",
    programme: "Recording scheduled — tap to cancel",
    confirmer: "Cancel?",
    en_cours: "Recording in progress — tap to stop",
    introuvable: "Channel not found on the Freebox (see Freebox PVR options)",
    aucun_guide: "No Programme TNT FR sensor found.",
    aucune_pvr: "Freebox PVR integration not found.",
    aucun_enr: "No scheduled recording.",
    pas_de_programme: "No program",
    conflit: "Conflict",
    reste: "{n} min left",
    ok_enr: "Recording scheduled: {t}",
    deja: "Already scheduled: {t}",
    ok_ann: "Recording cancelled: {t}",
    erreur: "Freebox PVR: {e}",
    etats: { waiting_start_time: "Scheduled", starting: "Starting", running: "Recording", finished: "Finished", failed: "Failed", disabled: "Disabled" },
    ed: {
      title: "Title", chaines: "Channels (empty = all, in the chosen order)", onglet: "Tab shown on opening",
      afficher_affiches: "Show posters in the details", pvr_entity: "“Scheduled recordings” sensor (optional)",
    },
  },
};

const ONGLETS = { maintenant: ["current", "next"], soir: ["prime_time", "second_part"] };
const GUIDE = "programme_tnt_fr";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const langue = (hass) => (String(hass?.locale?.language || hass?.language || "fr").startsWith("fr") ? "fr" : "en");
const ts = (iso) => { const t = Date.parse(iso); return Number.isNaN(t) ? null : Math.floor(t / 1000); };
const urlSure = (u) => (typeof u === "string" && /^https?:\/\//i.test(u) ? u : "");

function capteursGuide(hass) {
  const reg = hass?.entities || {};
  const ids = Object.keys(reg).filter((id) => reg[id]?.platform === GUIDE && id.startsWith("sensor.") && hass.states[id]?.attributes?.channel_name);
  if (ids.length) return ids;
  return Object.keys(hass?.states || {}).filter((id) => id.startsWith("sensor.") && hass.states[id].attributes?.channel_name && hass.states[id].attributes?.prime_time !== undefined);
}

function capteurPvr(hass, config) {
  if (config.pvr_entity && hass.states[config.pvr_entity]) return config.pvr_entity;
  const reg = hass?.entities || {};
  const id = Object.keys(reg).find((e) => reg[e]?.platform === "freebox_pvr" && e.startsWith("sensor.") && hass.states[e]?.attributes?.guide_channels);
  return id || Object.keys(hass?.states || {}).find((e) => e.startsWith("sensor.") && hass.states[e].attributes?.guide_channels);
}

/** Enregistrement qui couvre au moins la moitié du programme sur cette chaîne. */
function enregistrementPour(records, uuid, debut, fin) {
  if (!uuid || debut == null) return null;
  return (records || []).find((r) => {
    if (r.channel_uuid !== uuid) return false;
    const rs = r.start_ts ?? ts(r.start), re = r.end_ts ?? ts(r.end);
    if (fin && fin > debut) return (Math.min(re, fin) - Math.max(rs, debut)) * 2 >= fin - debut;
    return rs <= debut + 60 && re > debut;
  }) || null;
}

class FreeboxPvrCard extends HTMLElement {
  static getConfigElement() { return document.createElement("freebox-pvr-card-editor"); }
  static getStubConfig() { return { onglet: "soir" }; }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._onglet = null;
    this._ouvert = new Set();   // programmes dépliés
    this._attente = new Set();  // programmes en cours d'envoi
    this._confirmer = null;     // clé du programme dont l'annulation attend une confirmation
    this._signature = "";
  }

  setConfig(config) {
    this._config = { onglet: "soir", afficher_affiches: true, ...(config || {}) };
    if (!["maintenant", "soir", "enregistrements"].includes(this._config.onglet)) this._config.onglet = "soir";
    this._onglet = this._config.onglet;
    this._signature = "";
    if (this._hass) this._rendu();
  }

  set hass(hass) {
    this._hass = hass;
    const sig = this._calculerSignature();
    if (sig !== this._signature) { this._signature = sig; this._rendu(); }
  }

  getCardSize() { return 2 + this._chaines().length; }
  getGridOptions() { return { columns: 12, min_columns: 6, rows: "auto" }; }

  _t() { return TEXTES[langue(this._hass)]; }

  _chaines() {
    if (!this._hass) return [];
    const choix = (this._config.chaines || []).filter((e) => this._hass.states[e]);
    return choix.length ? choix : capteursGuide(this._hass);
  }

  _calculerSignature() {
    if (!this._hass) return "";
    const pvr = capteurPvr(this._hass, this._config);
    const parts = this._chaines().map((e) => this._hass.states[e]?.last_updated);
    parts.push(pvr ? this._hass.states[pvr]?.last_updated : "");
    parts.push(langue(this._hass), Math.floor(Date.now() / 60000)); // rafraîchit la barre de progression chaque minute
    return parts.join("|");
  }

  _heure(sec) {
    return new Date(sec * 1000).toLocaleTimeString(langue(this._hass) === "fr" ? "fr-FR" : "en-GB", { hour: "2-digit", minute: "2-digit" });
  }

  _jourHeure(sec) {
    const d = new Date(sec * 1000);
    const loc = langue(this._hass) === "fr" ? "fr-FR" : "en-GB";
    return `${d.toLocaleDateString(loc, { weekday: "short", day: "2-digit", month: "2-digit" })} ${this._heure(sec)}`;
  }

  _notifier(message) {
    this.dispatchEvent(new CustomEvent("hass-notification", { detail: { message }, bubbles: true, composed: true }));
  }

  async _enregistrer(entite, creneau, titre, cle) {
    const t = this._t();
    this._attente.add(cle); this._signature = ""; this._rendu();
    try {
      const rep = await this._hass.callService("freebox_pvr", "record", { entity_id: entite, slot: creneau }, undefined, false, true);
      const r = rep?.response || {};
      this._notifier((r.already_programmed ? t.deja : t.ok_enr).replace("{t}", titre));
    } catch (err) {
      this._notifier(t.erreur.replace("{e}", err?.message || err));
    } finally {
      this._attente.delete(cle); this._signature = ""; this._rendu();
    }
  }

  async _annuler(id, titre, cle) {
    const t = this._t();
    this._confirmer = null;
    this._attente.add(cle); this._signature = ""; this._rendu();
    try {
      await this._hass.callService("freebox_pvr", "cancel", { record_id: id }, undefined, false, true);
      this._notifier(t.ok_ann.replace("{t}", titre));
    } catch (err) {
      this._notifier(t.erreur.replace("{e}", err?.message || err));
    } finally {
      this._attente.delete(cle); this._signature = ""; this._rendu();
    }
  }

  _bouton(cle, rec, uuid, fin) {
    const t = this._t();
    const maintenant = Date.now() / 1000;
    if (fin && fin <= maintenant) return "";
    if (this._attente.has(cle)) return `<span class="rec attente" title="…"><ha-circular-progress indeterminate size="small"></ha-circular-progress></span>`;
    if (!uuid) return `<button class="rec indispo" disabled title="${esc(t.introuvable)}"><ha-icon icon="mdi:record-circle-outline"></ha-icon></button>`;
    if (rec) {
      const enCours = ["starting", "running"].includes(rec.state);
      if (this._confirmer === cle) {
        return `<button class="rec confirmer" data-action="annuler" data-cle="${esc(cle)}" data-id="${esc(rec.id)}">${esc(t.confirmer)}</button>`;
      }
      return `<button class="rec actif ${enCours ? "pulse" : ""}" data-action="demander" data-cle="${esc(cle)}" title="${esc(enCours ? t.en_cours : t.programme)}"><ha-icon icon="mdi:record-circle"></ha-icon></button>`;
    }
    return `<button class="rec" data-action="enregistrer" data-cle="${esc(cle)}" title="${esc(t.enregistrer)}"><ha-icon icon="mdi:record-circle-outline"></ha-icon></button>`;
  }

  _ligneProgramme(entite, creneau, p, uuid, records, principal) {
    const t = this._t();
    const cle = `${entite}|${creneau}`;
    if (!p || !p.title) {
      return `<div class="prog vide"><span class="cren">${esc(t.creneaux[creneau])}</span><span class="titre muted">${esc(t.pas_de_programme)}</span></div>`;
    }
    const debut = ts(p.start), fin = ts(p.stop || p.end);
    const rec = enregistrementPour(records, uuid, debut, fin);
    const maintenant = Date.now() / 1000;
    let progression = "";
    if (debut && fin && debut <= maintenant && maintenant < fin) {
      const pct = Math.round(((maintenant - debut) / (fin - debut)) * 100);
      progression = `<div class="barre"><div style="width:${pct}%"></div></div><span class="reste">${esc(t.reste.replace("{n}", Math.ceil((fin - maintenant) / 60)))}</span>`;
    }
    const ouvert = this._ouvert.has(cle);
    const sous = [p.subtitle, p.category].filter(Boolean).map(esc).join(" · ");
    let detail = "";
    if (ouvert) {
      const affiche = this._config.afficher_affiches ? urlSure(p.poster) : "";
      detail = `<div class="detail">${affiche ? `<img class="affiche" src="${esc(affiche)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}
        <div>${p.description ? `<p>${esc(p.description)}</p>` : ""}${p.rating ? `<span class="badge">${esc(p.rating)}</span>` : ""}${p.tmdb_rating ? `<span class="badge">★ ${esc(Number(p.tmdb_rating).toFixed(1))}</span>` : ""}</div></div>`;
    }
    return `<div class="prog ${principal ? "principal" : "second"} ${rec ? "programme" : ""}">
      <div class="info" data-action="deplier" data-cle="${esc(cle)}">
        <div class="ligne1"><span class="cren">${esc(t.creneaux[creneau])}</span><span class="heure">${debut ? esc(this._heure(debut)) : ""}${fin ? ` – ${esc(this._heure(fin))}` : ""}</span>${rec?.conflict ? `<span class="badge rouge">${esc(t.conflit)}</span>` : ""}</div>
        <div class="titre">${esc(p.title)}</div>
        ${sous ? `<div class="sous">${sous}</div>` : ""}
        ${progression}
      </div>
      <div class="action" data-entite="${esc(entite)}" data-creneau="${esc(creneau)}" data-titre="${esc(p.title)}">${this._bouton(cle, rec, uuid, fin)}</div>
      ${detail}
    </div>`;
  }

  _logo(attr) {
    const nom = attr.channel_name || "?";
    const url = urlSure(attr.channel_icon || attr.entity_picture);
    const initiales = esc(nom.replace(/[^A-Za-z0-9+]/g, "").slice(0, 3).toUpperCase());
    return `<div class="logo">${url ? `<img src="${esc(url)}" alt="${esc(nom)}" loading="lazy" referrerpolicy="no-referrer" data-initiales="${initiales}">` : `<span>${initiales}</span>`}</div>`;
  }

  _rendu() {
    if (!this._hass || !this._config) return;
    const t = this._t();
    const pvrId = capteurPvr(this._hass, this._config);
    const pvr = pvrId ? this._hass.states[pvrId] : null;
    const records = pvr?.attributes?.records || [];
    const mapping = pvr?.attributes?.guide_channels || {};
    const chaines = this._chaines();

    let corps = "";
    if (!pvr) corps = `<div class="msg">${esc(t.aucune_pvr)}</div>`;
    else if (this._onglet === "enregistrements") {
      corps = records.length ? records.map((r) => {
        const cle = `rec|${r.id}`;
        const rs = r.start_ts ?? ts(r.start), re = r.end_ts ?? ts(r.end);
        const enCours = ["starting", "running"].includes(r.state);
        const bouton = this._attente.has(cle)
          ? `<span class="rec attente"><ha-circular-progress indeterminate size="small"></ha-circular-progress></span>`
          : this._confirmer === cle
            ? `<button class="rec confirmer" data-action="annuler" data-cle="${esc(cle)}" data-id="${esc(r.id)}">${esc(t.confirmer)}</button>`
            : `<button class="rec actif ${enCours ? "pulse" : ""}" data-action="demander" data-cle="${esc(cle)}" title="${esc(enCours ? t.en_cours : t.programme)}"><ha-icon icon="mdi:record-circle"></ha-icon></button>`;
        return `<div class="enr"><div class="info">
            <div class="ligne1"><span class="cren">${esc(r.channel_name)}</span><span class="heure">${rs ? esc(this._jourHeure(rs)) : ""}${re ? ` – ${esc(this._heure(re))}` : ""}</span>
            <span class="badge ${enCours ? "rouge" : ""}">${esc(t.etats[r.state] || r.state)}</span>${r.conflict ? `<span class="badge rouge">${esc(t.conflit)}</span>` : ""}</div>
            <div class="titre">${esc(r.name)}</div>${r.subname ? `<div class="sous">${esc(r.subname)}</div>` : ""}
          </div><div class="action" data-titre="${esc(r.name)}">${bouton}</div></div>`;
      }).join("") : `<div class="msg">${esc(t.aucun_enr)}</div>`;
    } else if (!chaines.length) corps = `<div class="msg">${esc(t.aucun_guide)}</div>`;
    else {
      const [c1, c2] = ONGLETS[this._onglet] || ONGLETS.soir;
      corps = chaines.map((e) => {
        const a = this._hass.states[e].attributes;
        const uuid = mapping[a.channel_name] ?? null;
        return `<div class="chaine">${this._logo(a)}<div class="progs">
          ${this._ligneProgramme(e, c1, a[c1], uuid, records, true)}
          ${this._ligneProgramme(e, c2, a[c2], uuid, records, false)}
        </div></div>`;
      }).join("");
    }

    const nb = pvr ? Number(pvr.state) || 0 : 0;
    const onglets = ["maintenant", "soir", "enregistrements"].map((o) =>
      `<button class="onglet ${o === this._onglet ? "sel" : ""}" data-onglet="${o}">${esc(t.onglets[o])}${o === "enregistrements" && nb ? `<span class="nb">${nb}</span>` : ""}</button>`).join("");

    this.shadowRoot.innerHTML = `<style>${STYLE}</style>
      <ha-card>
        <div class="entete"><div class="titre-carte"><ha-icon icon="mdi:television-classic"></ha-icon>${esc(this._config.title || t.titre)}</div></div>
        <div class="onglets">${onglets}</div>
        <div class="liste">${corps}</div>
      </ha-card>`;

    this.shadowRoot.querySelectorAll(".logo img").forEach((img) => img.addEventListener("error", () => {
      const s = document.createElement("span"); s.textContent = img.dataset.initiales || "?"; img.replaceWith(s);
    }, { once: true }));
    this.shadowRoot.querySelectorAll("[data-onglet]").forEach((b) => b.addEventListener("click", () => {
      this._onglet = b.dataset.onglet; this._confirmer = null; this._signature = ""; this._rendu();
    }));
    this.shadowRoot.querySelectorAll("[data-action]").forEach((el) => el.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const action = el.dataset.action, cle = el.dataset.cle;
      const conteneur = el.closest(".action");
      if (action === "deplier") {
        this._ouvert.has(cle) ? this._ouvert.delete(cle) : this._ouvert.add(cle);
        this._signature = ""; this._rendu();
      } else if (action === "enregistrer") {
        this._enregistrer(conteneur.dataset.entite, conteneur.dataset.creneau, conteneur.dataset.titre, cle);
      } else if (action === "demander") {
        this._confirmer = cle; this._signature = ""; this._rendu();
        clearTimeout(this._minuteur);
        this._minuteur = setTimeout(() => { if (this._confirmer === cle) { this._confirmer = null; this._signature = ""; this._rendu(); } }, 4000);
      } else if (action === "annuler") {
        this._annuler(Number(el.dataset.id), conteneur.dataset.titre, cle);
      }
    }));
  }
}

const STYLE = `
  ha-card { overflow: hidden; }
  .entete { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px 4px; }
  .titre-carte { display: flex; align-items: center; gap: 8px; font-size: 1.15em; font-weight: 500; }
  .titre-carte ha-icon { color: var(--primary-color); }
  .onglets { display: flex; gap: 6px; padding: 6px 16px 10px; flex-wrap: wrap; }
  .onglet { border: 1px solid var(--divider-color); background: none; color: var(--primary-text-color); border-radius: 16px;
    padding: 4px 12px; font: inherit; font-size: .9em; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
  .onglet.sel { background: var(--primary-color); border-color: var(--primary-color); color: var(--text-primary-color, #fff); }
  .nb { background: #e53935; color: #fff; border-radius: 10px; font-size: .75em; padding: 0 6px; line-height: 16px; }
  .liste { padding: 0 8px 8px; }
  .chaine { display: flex; gap: 10px; padding: 8px; border-top: 1px solid var(--divider-color); }
  .chaine:first-child { border-top: none; }
  .logo { flex: 0 0 44px; height: 44px; border-radius: 8px; background: var(--secondary-background-color);
    display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .logo img { width: 40px; height: 40px; object-fit: contain; }
  .logo span { font-size: .75em; font-weight: 600; color: var(--secondary-text-color); }
  .progs { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
  .prog { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 4px 8px; border-radius: 8px; padding: 2px 4px; }
  .prog.programme { background: rgba(229, 57, 53, .08); }
  .prog .info { cursor: pointer; min-width: 0; }
  .prog .detail { grid-column: 1 / -1; display: flex; gap: 10px; font-size: .88em; color: var(--secondary-text-color); padding: 4px 0 6px; }
  .detail p { margin: 0 0 6px; }
  .affiche { width: 64px; border-radius: 6px; align-self: flex-start; }
  .ligne1 { display: flex; align-items: center; gap: 8px; font-size: .8em; color: var(--secondary-text-color); flex-wrap: wrap; }
  .cren { text-transform: uppercase; letter-spacing: .03em; font-weight: 600; }
  .titre { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .prog.second .titre { font-weight: 400; font-size: .95em; }
  .muted { color: var(--secondary-text-color); font-style: italic; }
  .sous { font-size: .82em; color: var(--secondary-text-color); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .barre { height: 3px; background: var(--divider-color); border-radius: 2px; margin-top: 4px; overflow: hidden; }
  .barre div { height: 100%; background: var(--primary-color); }
  .reste { font-size: .75em; color: var(--secondary-text-color); }
  .badge { font-size: .85em; border: 1px solid var(--divider-color); border-radius: 8px; padding: 0 6px; margin-right: 4px; }
  .badge.rouge { border-color: #e53935; color: #e53935; }
  .rec { width: 40px; height: 40px; border-radius: 50%; border: none; background: none; cursor: pointer; color: var(--secondary-text-color);
    display: inline-flex; align-items: center; justify-content: center; padding: 0; }
  .rec:hover { background: var(--secondary-background-color); }
  .rec.actif { color: #e53935; }
  .rec.indispo { opacity: .3; cursor: not-allowed; }
  .rec.confirmer { width: auto; border-radius: 16px; padding: 0 10px; background: #e53935; color: #fff; font: inherit; font-size: .85em; height: 32px; }
  .rec.pulse ha-icon { animation: pulse 1.4s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: .35; } }
  .enr { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 8px; padding: 8px; border-top: 1px solid var(--divider-color); }
  .enr:first-child { border-top: none; }
  .msg { padding: 16px; color: var(--secondary-text-color); text-align: center; }
`;

class FreeboxPvrCardEditor extends HTMLElement {
  setConfig(config) { this._config = { ...config }; this._rendu(); }
  set hass(hass) { this._hass = hass; if (this._form) this._form.hass = hass; else this._rendu(); }

  _rendu() {
    if (!this._hass || !this._config) return;
    const t = TEXTES[langue(this._hass)];
    if (!this._form) {
      this._form = document.createElement("ha-form");
      this._form.computeLabel = (s) => t.ed[s.name] || s.name;
      this._form.addEventListener("value-changed", (ev) => {
        this._config = ev.detail.value;
        this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: this._config }, bubbles: true, composed: true }));
      });
      this.appendChild(this._form);
    }
    this._form.hass = this._hass;
    this._form.schema = [
      { name: "title", selector: { text: {} } },
      { name: "chaines", selector: { entity: { multiple: true, filter: { integration: GUIDE, domain: "sensor" } } } },
      { name: "onglet", selector: { select: { mode: "dropdown", options: Object.entries(t.onglets).map(([value, label]) => ({ value, label })) } } },
      { name: "afficher_affiches", selector: { boolean: {} } },
      { name: "pvr_entity", selector: { entity: { filter: { integration: "freebox_pvr", domain: "sensor" } } } },
    ];
    this._form.data = { onglet: "soir", afficher_affiches: true, ...this._config };
  }
}

if (!customElements.get("freebox-pvr-card")) customElements.define("freebox-pvr-card", FreeboxPvrCard);
if (!customElements.get("freebox-pvr-card-editor")) customElements.define("freebox-pvr-card-editor", FreeboxPvrCardEditor);
window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "freebox-pvr-card")) {
  window.customCards.push({
    type: "freebox-pvr-card",
    name: "Freebox PVR",
    description: "Programme TV (Programme TNT FR) avec enregistrement sur la Freebox · TV guide with Freebox recording",
    preview: true,
    documentationURL: "https://github.com/akoonet-homeassistant/freebox_pvr",
  });
}
/* ------------------------------------------------------------------------------------------
   Surcouche de la carte « Programme TNT FR » (cyclope205/programme-tnt-fr) :
   ajoute « Enregistrer sur la Freebox » dans la fiche de chaque programme (carrousels,
   Guide TV, Top films). On enveloppe sa méthode _openModal(channelLabel, prog) sans
   modifier son code ; si une future version de la carte change cette méthode, la
   surcouche se désactive d'elle-même et la carte fonctionne comme avant.
   ------------------------------------------------------------------------------------------ */

const SURCOUCHE = {
  fr: { enregistrer: "Enregistrer sur la Freebox", programme: "Enregistrement programmé", en_cours: "Enregistrement en cours",
    annuler: "Annuler l'enregistrement", confirmer: "Confirmer l'annulation", introuvable: "Chaîne introuvable sur la Freebox",
    envoi: "Envoi à la Freebox…", conflit: "Conflit avec un autre enregistrement", ok: "Enregistrement programmé.", deja: "Déjà programmé.", annule: "Enregistrement annulé." },
  en: { enregistrer: "Record on the Freebox", programme: "Recording scheduled", en_cours: "Recording in progress",
    annuler: "Cancel the recording", confirmer: "Confirm cancellation", introuvable: "Channel not found on the Freebox",
    envoi: "Sending to the Freebox…", conflit: "Conflicts with another recording", ok: "Recording scheduled.", deja: "Already scheduled.", annule: "Recording cancelled." },
};

const normaliser = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\+/g, "plus").replace(/[^a-z0-9]/g, "");

function etatPourProgramme(hass, chaine, prog) {
  const pvrId = capteurPvr(hass, {});
  if (!pvrId) return null;
  const attr = hass.states[pvrId].attributes;
  const records = attr.records || [];
  const mapping = attr.guide_channels || {};
  const debut = ts(prog.start), fin = ts(prog.stop || prog.end);
  let uuid = mapping[chaine];
  let rec = null;
  if (uuid) rec = enregistrementPour(records, uuid, debut, fin);
  else {
    // Chaîne absente de la correspondance : on compare les noms (la recherche réelle se fait côté serveur)
    const n = normaliser(chaine);
    const r = records.find((x) => normaliser(x.channel_name) === n);
    if (r) { uuid = r.channel_uuid; rec = enregistrementPour(records, uuid, debut, fin); }
  }
  return { uuid, rec, introuvable: uuid === null && chaine in mapping, debut, fin };
}

function dessinerLigne(carte, ligne, chaine, prog) {
  const hass = carte._hass || carte.hass;
  if (!hass) { ligne.hidden = true; return; }
  const t = SURCOUCHE[langue(hass)];
  const e = etatPourProgramme(hass, chaine, prog);
  if (!e || !prog.title || !e.debut || (e.fin && e.fin <= Date.now() / 1000)) { ligne.hidden = true; return; }
  ligne.hidden = false;
  const st = ligne.__fbx || (ligne.__fbx = {});
  const bouton = (cls, txt, action) => `<button type="button" class="fbx-pvr-btn ${cls}" data-fbx="${action}">${txt}</button>`;
  let html;
  if (st.envoi) html = `<span class="fbx-pvr-info">${esc(t.envoi)}</span>`;
  else if (e.introuvable) html = `<span class="fbx-pvr-info">${esc(t.introuvable)}</span>`;
  else if (e.rec) {
    const enCours = ["starting", "running"].includes(e.rec.state);
    html = `<span class="fbx-pvr-etat">⏺ ${esc(enCours ? t.en_cours : t.programme)}</span>` +
      (st.confirmer ? bouton("danger", esc(t.confirmer), "annuler") : bouton("secondaire", esc(t.annuler), "demander")) +
      (e.rec.conflict ? `<span class="fbx-pvr-info alerte">${esc(t.conflit)}</span>` : "");
  } else html = bouton("rec", `⏺ ${esc(t.enregistrer)}`, "enregistrer");
  if (st.message) html += `<span class="fbx-pvr-info">${esc(st.message)}</span>`;
  ligne.innerHTML = html;
  ligne.querySelectorAll("[data-fbx]").forEach((b) => b.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    const action = b.dataset.fbx;
    const redessiner = () => { if (ligne.isConnected && carte.__fbxProg === prog) dessinerLigne(carte, ligne, chaine, prog); };
    if (action === "demander") { st.confirmer = true; st.message = ""; redessiner(); setTimeout(() => { st.confirmer = false; redessiner(); }, 4000); return; }
    st.envoi = true; st.confirmer = false; st.message = ""; redessiner();
    try {
      if (action === "enregistrer") {
        const rep = await hass.callService("freebox_pvr", "record", {
          channel_name: chaine, title: prog.title, ...(prog.subtitle ? { subtitle: prog.subtitle } : {}),
          start: prog.start, end: prog.stop || prog.end,
        }, undefined, false, true);
        st.message = rep?.response?.already_programmed ? t.deja : t.ok;
      } else if (action === "annuler" && e.rec) {
        await hass.callService("freebox_pvr", "cancel", { record_id: e.rec.id }, undefined, false, true);
        st.message = t.annule;
      }
    } catch (err) {
      st.message = `Freebox PVR : ${err?.message || err}`;
    } finally {
      st.envoi = false; redessiner();
      // le capteur se met à jour juste après l'appel : on relit son état
      setTimeout(redessiner, 1500); setTimeout(redessiner, 4000);
    }
  }));
}

const STYLE_SURCOUCHE = `
  .fbx-pvr-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--divider-color, #444); }
  .fbx-pvr-row[hidden] { display: none; }
  .fbx-pvr-btn { border: none; font: inherit; font-size: .8em; font-weight: 600; padding: 6px 12px; border-radius: 999px; cursor: pointer; }
  .fbx-pvr-btn:active { transform: scale(.95); }
  .fbx-pvr-btn.rec { background: #e53935; color: #fff; }
  .fbx-pvr-btn.secondaire { background: transparent; color: var(--primary-text-color); border: 1px solid var(--divider-color, #555); }
  .fbx-pvr-btn.danger { background: #b71c1c; color: #fff; }
  .fbx-pvr-etat { color: #e53935; font-weight: 600; font-size: .85em; }
  .fbx-pvr-info { font-size: .8em; opacity: .85; }
  .fbx-pvr-info.alerte { color: #e53935; opacity: 1; }
`;

function installerSurcouche() {
  customElements.whenDefined("programme-tnt-fr-card").then(() => {
    const Carte = customElements.get("programme-tnt-fr-card");
    const proto = Carte && Carte.prototype;
    if (!proto || proto.__freeboxPvr) return;
    if (typeof proto._openModal !== "function") {
      console.warn("Freebox PVR : la carte Programme TNT FR a changé, surcouche d'enregistrement désactivée.");
      return;
    }
    const original = proto._openModal;
    proto._openModal = function (channelLabel, prog) {
      const resultat = original.apply(this, arguments);
      try {
        const modal = this._els?.overlay?.querySelector(".modal") || this.querySelector?.(".overlay .modal");
        if (!modal) return resultat;
        if (!this.querySelector("style[data-fbx-pvr]")) {
          const s = document.createElement("style"); s.dataset.fbxPvr = ""; s.textContent = STYLE_SURCOUCHE; this.appendChild(s);
        }
        let ligne = modal.querySelector(".fbx-pvr-row");
        if (!ligne) { ligne = document.createElement("div"); ligne.className = "fbx-pvr-row"; modal.appendChild(ligne); }
        ligne.__fbx = {};
        this.__fbxProg = prog || {};
        dessinerLigne(this, ligne, channelLabel, prog || {});
      } catch (err) {
        console.warn("Freebox PVR : surcouche", err);
      }
      return resultat;
    };
    proto.__freeboxPvr = true;
  });
}
installerSurcouche();

console.info(`%c FREEBOX-PVR-CARD %c ${VERSION_CARTE} `, "background:#2B3A5C;color:#fff;border-radius:3px 0 0 3px", "background:#E53935;color:#fff;border-radius:0 3px 3px 0");
