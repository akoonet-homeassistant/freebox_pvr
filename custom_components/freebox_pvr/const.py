"""Constantes de l'intégration Freebox PVR."""

from __future__ import annotations

from datetime import timedelta
import socket

DOMAIN = "freebox_pvr"
VERSION = "2026.11.2"

APP_DESC: dict[str, str] = {
    "app_id": "fr.akoonet.freebox_pvr",
    "app_name": "Home Assistant - Freebox PVR",
    "app_version": VERSION,
    "device_name": socket.gethostname(),
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

SERVICE_RECORD = "record"
SERVICE_CANCEL = "cancel"
SERVICE_REFRESH_CHANNELS = "refresh_channels"
