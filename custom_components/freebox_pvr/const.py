"""Constantes de l'intégration Freebox PVR."""

from __future__ import annotations

from datetime import timedelta

DOMAIN = "freebox_pvr"
VERSION = "2026.11.5"

# Description de l'application envoyée à la Freebox. Elle doit rester FIXE :
# freebox_api redemande une autorisation sur l'écran du Server dès qu'elle change
# (ne pas y mettre la version de l'intégration ni le nom de la machine).
APP_DESC: dict[str, str] = {
    "app_id": "fr.akoonet.freebox_pvr",
    "app_name": "Home Assistant - Freebox PVR",
    "app_version": "1",
    "device_name": "Home Assistant",
}
API_VERSION = "v6"

DEFAULT_HOST = "mafreebox.freebox.fr"
DEFAULT_PORT = 443

CONF_MARGIN_BEFORE = "margin_before"
CONF_MARGIN_AFTER = "margin_after"
CONF_QUALITY = "quality"
CONF_CHANNEL_ALIASES = "channel_aliases"

DEFAULT_MARGIN_BEFORE = 5
DEFAULT_MARGIN_AFTER = 10
DEFAULT_QUALITY = "auto"
QUALITIES = ["auto", "hd", "sd", "ld"]

SCAN_INTERVAL = timedelta(minutes=5)
CHANNELS_REFRESH = timedelta(hours=6)

# Créneaux exposés par les capteurs de l'intégration « Programme TNT FR »
GUIDE_DOMAIN = "programme_tnt_fr"
STATIC_URL = "/freebox_pvr_static"
SLOTS = ["current", "next", "prime_time", "second_part"]

# États d'un enregistrement programmé (API Freebox OS)
ACTIVE_STATES = {"waiting_start_time", "starting", "running"}
RUNNING_STATES = {"starting", "running"}

ATTR_RECORD_ID = "record_id"
ATTR_SLOT = "slot"
ATTR_CHANNEL_NAME = "channel_name"
ATTR_CHANNEL_UUID = "channel_uuid"
ATTR_TITLE = "title"
ATTR_SUBTITLE = "subtitle"
ATTR_START = "start"
ATTR_END = "end"
ATTR_END_TIME = "end_time"
ATTR_REPEAT_WEEKLY = "repeat_weekly"
ATTR_REPEAT_ID = "repeat_id"

SERVICE_RECORD = "record"
SERVICE_CANCEL = "cancel"
SERVICE_REFRESH_CHANNELS = "refresh_channels"
SERVICE_STOP_REPEAT = "stop_repeat"
