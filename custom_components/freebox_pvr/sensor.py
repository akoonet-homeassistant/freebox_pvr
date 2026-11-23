"""Capteurs Freebox PVR."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.util import dt as dt_util

from .const import ACTIVE_STATES
from .entity import FreeboxPvrEntity, record_to_attr


def _upcoming(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [r for r in records if r.get("state") in ACTIVE_STATES]


async def async_setup_entry(hass: HomeAssistant, entry, async_add_entities: AddConfigEntryEntitiesCallback) -> None:
    coordinator = entry.runtime_data
    async_add_entities(
        [ScheduledRecordsSensor(coordinator, "scheduled_records"), NextRecordSensor(coordinator, "next_record")]
    )


class ScheduledRecordsSensor(FreeboxPvrEntity, SensorEntity):
    """Nombre d'enregistrements à venir ou en cours, avec leur liste."""

    _attr_icon = "mdi:record-rec"
    _attr_native_unit_of_measurement = None

    @property
    def native_value(self) -> int:
        return len(_upcoming(self.coordinator.data.records))

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        records = self.coordinator.data.records
        return {
            "records": [record_to_attr(r) for r in _upcoming(records)],
            "conflicts": sum(1 for r in _upcoming(records) if r.get("conflict")),
            "failed": [record_to_attr(r) for r in records if r.get("state") in {"failed", "start_error", "running_error"}][-5:],
        }


class NextRecordSensor(FreeboxPvrEntity, SensorEntity):
    """Heure de début du prochain enregistrement."""

    _attr_device_class = SensorDeviceClass.TIMESTAMP
    _attr_icon = "mdi:calendar-clock"

    def _next(self) -> dict[str, Any] | None:
        upcoming = [r for r in self.coordinator.data.records if r.get("state") == "waiting_start_time"]
        return upcoming[0] if upcoming else None

    @property
    def native_value(self) -> datetime | None:
        rec = self._next()
        return dt_util.utc_from_timestamp(rec["start"]) if rec and rec.get("start") else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        rec = self._next()
        return record_to_attr(rec) if rec else {}
