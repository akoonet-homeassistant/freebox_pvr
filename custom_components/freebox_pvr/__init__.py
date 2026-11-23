"""Freebox PVR : programmer des enregistrements TV sur la Freebox depuis Home Assistant."""

from __future__ import annotations

from datetime import datetime
import logging
from pathlib import Path
from typing import Any

import voluptuous as vol

from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.const import ATTR_ENTITY_ID, CONF_HOST, CONF_PORT, Platform
from homeassistant.core import (
    HomeAssistant,
    ServiceCall,
    ServiceResponse,
    SupportsResponse,
)
from homeassistant.exceptions import (
    ConfigEntryNotReady,
    HomeAssistantError,
    ServiceValidationError,
)
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.storage import STORAGE_DIR
from homeassistant.helpers.typing import ConfigType
from homeassistant.util import dt as dt_util

from .api import (
    ChannelNotFound,
    FreeboxPvrClient,
    FreeboxPvrError,
    PermissionMissing,
    RecordRequest,
    find_channel,
    find_record_for_program,
    parse_aliases,
)
from .const import (
    ATTR_CHANNEL_NAME,
    ATTR_CHANNEL_UUID,
    ATTR_END,
    ATTR_RECORD_ID,
    ATTR_SLOT,
    ATTR_START,
    ATTR_SUBTITLE,
    ATTR_TITLE,
    CONF_CHANNEL_ALIASES,
    CONF_MARGIN_AFTER,
    CONF_MARGIN_BEFORE,
    CONF_QUALITY,
    DEFAULT_MARGIN_AFTER,
    DEFAULT_MARGIN_BEFORE,
    DEFAULT_QUALITY,
    DOMAIN,
    QUALITIES,
    SERVICE_CANCEL,
    SERVICE_RECORD,
    SERVICE_REFRESH_CHANNELS,
    SLOTS,
    STATIC_URL,
    VERSION,
)
from .coordinator import FreeboxPvrCoordinator

_LOGGER = logging.getLogger(__name__)

PLATFORMS = [Platform.BINARY_SENSOR, Platform.SENSOR]
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

type FreeboxPvrConfigEntry = ConfigEntry[FreeboxPvrCoordinator]

_DATETIME = vol.Any(cv.datetime, cv.positive_int)

RECORD_SCHEMA = vol.Schema(
    {
        vol.Optional(ATTR_ENTITY_ID): cv.entity_id,
        vol.Optional(ATTR_SLOT, default="current"): vol.In(SLOTS),
        vol.Optional(ATTR_CHANNEL_NAME): cv.string,
        vol.Optional(ATTR_CHANNEL_UUID): cv.string,
        vol.Optional(ATTR_TITLE): cv.string,
        vol.Optional(ATTR_SUBTITLE): vol.Any(None, cv.string),
        vol.Optional(ATTR_START): _DATETIME,
        vol.Optional(ATTR_END): _DATETIME,
        vol.Optional(CONF_MARGIN_BEFORE): vol.All(vol.Coerce(int), vol.Range(min=0, max=60)),
        vol.Optional(CONF_MARGIN_AFTER): vol.All(vol.Coerce(int), vol.Range(min=0, max=120)),
        vol.Optional(CONF_QUALITY): vol.In(QUALITIES),
        vol.Optional("config_entry_id"): cv.string,
    }
)

CANCEL_SCHEMA = vol.Schema(
    {
        vol.Optional(ATTR_RECORD_ID): vol.Coerce(int),
        vol.Optional(ATTR_ENTITY_ID): cv.entity_id,
        vol.Optional(ATTR_SLOT, default="current"): vol.In(SLOTS),
        vol.Optional(ATTR_CHANNEL_NAME): cv.string,
        vol.Optional(ATTR_CHANNEL_UUID): cv.string,
        vol.Optional(ATTR_START): _DATETIME,
        vol.Optional("config_entry_id"): cv.string,
    }
)


def token_path(hass: HomeAssistant, host: str) -> Path:
    """Fichier du jeton d'application, dans .storage (comme l'intégration Freebox)."""
    safe = "".join(c if c.isalnum() or c in ".-_" else "_" for c in host)
    return Path(hass.config.path(STORAGE_DIR, DOMAIN, f"{safe}.conf"))


def to_timestamp(value: Any) -> int | None:
    """Convertit datetime / chaîne ISO / timestamp en timestamp Unix."""
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        parsed = dt_util.parse_datetime(value)
        if parsed is None:
            raise ServiceValidationError(
                translation_domain=DOMAIN,
                translation_key="invalid_datetime",
                translation_placeholders={"value": value},
            )
        value = parsed
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=dt_util.get_default_time_zone())
        return int(value.timestamp())
    raise ServiceValidationError(
        translation_domain=DOMAIN,
        translation_key="invalid_datetime",
        translation_placeholders={"value": str(value)},
    )


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Enregistre les actions (services) et la carte du tableau de bord."""
    # Carte « Freebox PVR » : chargée sur toutes les pages, sans ressource Lovelace à ajouter
    frontend_dir = Path(__file__).parent / "frontend"
    await hass.http.async_register_static_paths([StaticPathConfig(STATIC_URL, str(frontend_dir), True)])
    add_extra_js_url(hass, f"{STATIC_URL}/freebox-pvr-card.js?v={VERSION}")

    def _coordinator(call: ServiceCall) -> FreeboxPvrCoordinator:
        entry_id = call.data.get("config_entry_id")
        entries = [
            e
            for e in hass.config_entries.async_entries(DOMAIN)
            if e.state is ConfigEntryState.LOADED and (not entry_id or e.entry_id == entry_id)
        ]
        if not entries:
            raise ServiceValidationError(translation_domain=DOMAIN, translation_key="not_loaded")
        return entries[0].runtime_data

    def _program_from_entity(call: ServiceCall) -> dict[str, Any]:
        """Lit chaîne/titre/heures sur un capteur « Programme TNT FR »."""
        entity_id = call.data[ATTR_ENTITY_ID]
        state = hass.states.get(entity_id)
        if state is None:
            raise ServiceValidationError(
                translation_domain=DOMAIN,
                translation_key="entity_not_found",
                translation_placeholders={"entity_id": entity_id},
            )
        slot = call.data[ATTR_SLOT]
        program = state.attributes.get(slot)
        if not isinstance(program, dict) or not program.get("start"):
            raise ServiceValidationError(
                translation_domain=DOMAIN,
                translation_key="no_program",
                translation_placeholders={"entity_id": entity_id, "slot": slot},
            )
        return {
            ATTR_CHANNEL_NAME: state.attributes.get("channel_name") or state.name,
            ATTR_TITLE: program.get("title") or state.state,
            ATTR_SUBTITLE: program.get("subtitle"),
            ATTR_START: program.get("start"),
            ATTR_END: program.get("stop") or program.get("end"),
        }

    def _resolve_channel(coordinator: FreeboxPvrCoordinator, name: str | None, uuid: str | None) -> dict[str, Any]:
        channels = coordinator.data.channels if coordinator.data else {}
        if uuid:
            return channels.get(uuid, {"uuid": uuid, "name": name or uuid})
        aliases = parse_aliases(coordinator.config_entry.options.get(CONF_CHANNEL_ALIASES))
        try:
            return find_channel(channels, name or "", aliases)
        except ChannelNotFound as err:
            raise ServiceValidationError(
                translation_domain=DOMAIN,
                translation_key="channel_not_found",
                translation_placeholders={"channel": name or ""},
            ) from err

    async def _guard(coro):
        try:
            return await coro
        except PermissionMissing as err:
            raise HomeAssistantError(
                translation_domain=DOMAIN, translation_key="permission_missing"
            ) from err
        except FreeboxPvrError as err:
            raise HomeAssistantError(
                translation_domain=DOMAIN,
                translation_key="api_error",
                translation_placeholders={"error": str(err)},
            ) from err

    async def async_record(call: ServiceCall) -> ServiceResponse:
        coordinator = _coordinator(call)
        options = coordinator.config_entry.options
        data: dict[str, Any] = {}
        if ATTR_ENTITY_ID in call.data:
            data.update(_program_from_entity(call))
        for key in (ATTR_CHANNEL_NAME, ATTR_TITLE, ATTR_SUBTITLE, ATTR_START, ATTR_END):
            if call.data.get(key) not in (None, ""):
                data[key] = call.data[key]

        start = to_timestamp(data.get(ATTR_START))
        end = to_timestamp(data.get(ATTR_END))
        if not data.get(ATTR_TITLE) or start is None or end is None or not (
            data.get(ATTR_CHANNEL_NAME) or call.data.get(ATTR_CHANNEL_UUID)
        ):
            raise ServiceValidationError(translation_domain=DOMAIN, translation_key="missing_fields")
        if end <= start:
            raise ServiceValidationError(translation_domain=DOMAIN, translation_key="end_before_start")
        now = int(dt_util.utcnow().timestamp())
        if end <= now:
            raise ServiceValidationError(translation_domain=DOMAIN, translation_key="already_finished")

        channel = _resolve_channel(coordinator, data.get(ATTR_CHANNEL_NAME), call.data.get(ATTR_CHANNEL_UUID))
        uuid = channel["uuid"]

        records = coordinator.data.records if coordinator.data else []
        existing = find_record_for_program(records, uuid, start, end)
        if existing:
            return {"record_id": existing.get("id"), "already_programmed": True, "channel_uuid": uuid}

        margin_before = call.data.get(CONF_MARGIN_BEFORE, options.get(CONF_MARGIN_BEFORE, DEFAULT_MARGIN_BEFORE))
        margin_after = call.data.get(CONF_MARGIN_AFTER, options.get(CONF_MARGIN_AFTER, DEFAULT_MARGIN_AFTER))
        # Programme déjà commencé (ou marge dans le passé) : on démarre maintenant.
        if start - margin_before * 60 < now + 30:
            start, margin_before = now + 30, 0

        request = RecordRequest(
            channel_uuid=uuid,
            channel_name=channel.get("name") or data.get(ATTR_CHANNEL_NAME) or uuid,
            title=str(data[ATTR_TITLE]),
            subtitle=data.get(ATTR_SUBTITLE),
            start=start,
            end=end,
            margin_before=int(margin_before),
            margin_after=int(margin_after),
            quality=call.data.get(CONF_QUALITY, options.get(CONF_QUALITY, DEFAULT_QUALITY)),
        )
        result = await _guard(coordinator.client.create_record(request))
        await coordinator.async_request_refresh()
        return {
            "record_id": result.get("id"),
            "already_programmed": False,
            "channel_uuid": uuid,
            "channel_name": request.channel_name,
            "start": dt_util.utc_from_timestamp(request.start - request.margin_before * 60).isoformat(),
            "end": dt_util.utc_from_timestamp(request.end + request.margin_after * 60).isoformat(),
            "conflict": bool(result.get("conflict")),
        }

    async def async_cancel(call: ServiceCall) -> ServiceResponse:
        coordinator = _coordinator(call)
        record_id = call.data.get(ATTR_RECORD_ID)
        if record_id is None:
            data: dict[str, Any] = {}
            if ATTR_ENTITY_ID in call.data:
                data.update(_program_from_entity(call))
            if call.data.get(ATTR_CHANNEL_NAME):
                data[ATTR_CHANNEL_NAME] = call.data[ATTR_CHANNEL_NAME]
            if call.data.get(ATTR_START):
                data[ATTR_START] = call.data[ATTR_START]
                data.pop(ATTR_END, None)
            start = to_timestamp(data.get(ATTR_START))
            end = to_timestamp(data.get(ATTR_END))
            if start is None or not (data.get(ATTR_CHANNEL_NAME) or call.data.get(ATTR_CHANNEL_UUID)):
                raise ServiceValidationError(translation_domain=DOMAIN, translation_key="missing_fields")
            channel = _resolve_channel(coordinator, data.get(ATTR_CHANNEL_NAME), call.data.get(ATTR_CHANNEL_UUID))
            rec = find_record_for_program(coordinator.data.records, channel["uuid"], start, end)
            if rec is None:
                raise ServiceValidationError(translation_domain=DOMAIN, translation_key="record_not_found")
            record_id = rec["id"]
        await _guard(coordinator.client.delete_record(int(record_id)))
        await coordinator.async_request_refresh()
        return {"record_id": int(record_id), "cancelled": True}

    async def async_refresh_channels(call: ServiceCall) -> None:
        coordinator = _coordinator(call)
        await _guard(coordinator.async_refresh_channels())
        await coordinator.async_request_refresh()

    hass.services.async_register(
        DOMAIN, SERVICE_RECORD, async_record, schema=RECORD_SCHEMA, supports_response=SupportsResponse.OPTIONAL
    )
    hass.services.async_register(
        DOMAIN, SERVICE_CANCEL, async_cancel, schema=CANCEL_SCHEMA, supports_response=SupportsResponse.OPTIONAL
    )
    hass.services.async_register(
        DOMAIN,
        SERVICE_REFRESH_CHANNELS,
        async_refresh_channels,
        schema=vol.Schema({vol.Optional("config_entry_id"): cv.string}),
    )
    return True


async def async_setup_entry(hass: HomeAssistant, entry: FreeboxPvrConfigEntry) -> bool:
    """Ouvre la session Freebox et démarre le coordinateur."""
    client = FreeboxPvrClient(
        entry.data[CONF_HOST], entry.data[CONF_PORT], token_path(hass, entry.data[CONF_HOST])
    )
    if not await hass.async_add_executor_job(client.token_file.exists):
        # Sans jeton, open() relancerait une demande d'autorisation sur l'écran de la box.
        raise ConfigEntryNotReady("Jeton d'application Freebox introuvable, reconfigurez l'intégration")
    try:
        await client.open()
    except Exception as err:
        raise ConfigEntryNotReady(f"Connexion à la Freebox impossible : {err}") from err

    coordinator = FreeboxPvrCoordinator(hass, entry, client)
    try:
        await coordinator.async_config_entry_first_refresh()
    except Exception:
        await client.close()
        raise
    entry.runtime_data = coordinator
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_reload))
    return True


async def _async_reload(hass: HomeAssistant, entry: FreeboxPvrConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: FreeboxPvrConfigEntry) -> bool:
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        await entry.runtime_data.client.close()
    return unloaded


async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Supprime le jeton local (l'appli reste à révoquer dans Freebox OS)."""
    path = token_path(hass, entry.data[CONF_HOST])
    await hass.async_add_executor_job(lambda: path.unlink(missing_ok=True))
