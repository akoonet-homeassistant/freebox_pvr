# Freebox PVR

🇫🇷 Français | [🇬🇧 English](README.en.md)

Programmez des enregistrements TV sur votre Freebox (Revolution, Mini 4K, Delta, Pop, Ultra) depuis Home Assistant, directement à partir du guide [Programme TNT FR](https://github.com/cyclope205/programme-tnt-fr).

> L'API d'enregistrement (PVR) de Freebox OS est indiquée comme « instable » par Free : elle peut changer sans préavis.

## Fonctionnalités

- Action `freebox_pvr.record` : enregistre le programme en cours, le suivant, la première ou la deuxième partie de soirée d'un capteur Programme TNT FR, ou un programme saisi à la main (chaîne, titre, début, fin).
- Action `freebox_pvr.cancel` : annule un enregistrement programmé, par identifiant ou par programme.
- Recherche automatique de la chaîne Freebox à partir du nom du guide (accents, « + », « HD »… gérés), avec des correspondances manuelles possibles.
- Marges avant et après réglables, qualité du flux au choix.
- Pas de doublon : un 2e appel pour le même programme renvoie l'enregistrement existant.
- Un programme déjà commencé est enregistré à partir de maintenant.

## Installation

1. HACS → Intégrations → ⋮ → Dépôts personnalisés → `https://github.com/akoonet-homeassistant/freebox_pvr` (catégorie Intégration).
2. Installez **Freebox PVR** puis redémarrez Home Assistant.
3. Paramètres → Appareils et services → Ajouter une intégration → **Freebox PVR**.

## Configuration

1. Indiquez l'adresse de la Freebox. Pour la première configuration, utilisez l'adresse locale `mafreebox.freebox.fr` (port 443) : l'autorisation d'une nouvelle application n'est possible que depuis le réseau local.
2. Cliquez sur **Valider**, puis appuyez dans la minute sur la **flèche droite** de l'écran du Freebox Server.
3. Dans Freebox OS → **Paramètres de la Freebox → Gestion des accès → Applications**, ouvrez « Home Assistant - Freebox PVR » et cochez le droit sur les **enregistrements TV (PVR)**.
4. Revenez dans Home Assistant et cliquez de nouveau sur **Valider**.

### Options

| Option | Par défaut | Rôle |
|---|---|---|
| Marge avant | 5 min | Minutes enregistrées avant le début |
| Marge après | 10 min | Minutes enregistrées après la fin |
| Qualité | Automatique | Automatique, HD, SD ou basse définition |
| Correspondances de chaînes | vide | Une par ligne : `Nom du guide = Nom Freebox` (ou `uuid-webtv-…`) |

## Entités

| Entité | Description |
|---|---|
| `sensor.freebox_pvr_enregistrements_programmes` | Nombre d'enregistrements à venir ou en cours ; attribut `records` avec la liste (id, titre, chaîne, début, fin, état, conflit) |
| `sensor.freebox_pvr_prochain_enregistrement` | Heure de début du prochain enregistrement (marge comprise) |
| `binary_sensor.freebox_pvr_enregistrement_en_cours` | Allumé pendant un enregistrement |

## Actions

### `freebox_pvr.record`

| Champ | Description |
|---|---|
| `entity_id` | Capteur Programme TNT FR (ex. `sensor.programme_tnt_fr_tf1`) |
| `slot` | `current`, `next`, `prime_time` ou `second_part` |
| `channel_name`, `title`, `subtitle`, `start`, `end` | À la place du capteur (ou pour remplacer une valeur) |
| `channel_uuid` | Identifiant Freebox de la chaîne, évite la recherche par nom |
| `margin_before`, `margin_after`, `quality` | Remplacent les options pour cet enregistrement |

Réponse : `record_id`, `already_programmed`, `channel_name`, `start`, `end`, `conflict`.

```yaml
action: freebox_pvr.record
data:
  entity_id: sensor.programme_tnt_fr_france_2
  slot: prime_time
```

### `freebox_pvr.cancel`

Par identifiant (`record_id`) ou par programme (`entity_id` + `slot`, ou `channel_name` + `start`).

### `freebox_pvr.refresh_channels`

Recharge la liste des chaînes de la Freebox (faite automatiquement toutes les 6 h).

## Exemple de tableau de bord

En attendant un bouton « Enregistrer » dans la fiche programme de la carte Programme TNT FR :

```yaml
type: button
name: Enregistrer le prime time de France 2
icon: mdi:record-rec
tap_action:
  action: perform-action
  perform_action: freebox_pvr.record
  data:
    entity_id: sensor.programme_tnt_fr_france_2
    slot: prime_time
  confirmation:
    text: Programmer l'enregistrement sur la Freebox ?
```

## Sécurité

- Le jeton d'application est stocké dans `.storage/freebox_pvr/` (comme l'intégration Freebox officielle). Il est supprimé quand l'intégration est retirée ; pensez aussi à révoquer l'application dans Freebox OS.
- Les échanges se font en HTTPS avec vérification du certificat (certificats système + autorité Freebox).
- Seul le droit sur les enregistrements TV (PVR) est nécessaire : vous pouvez retirer à l'application les autres droits accordés par défaut.
