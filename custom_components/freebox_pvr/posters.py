"""Mémoire des affiches des enregistrements.

La Freebox ne fournit aucune image pour un enregistrement, et le guide Programme TNT FR
ne décrit que la journée en cours. Tant qu'un enregistrement programmé figure dans le
guide du jour, on retient l'affiche de son programme ; elle reste ensuite disponible
pour l'enregistrement terminé (60 jours).
"""

from __future__ import annotations

from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .api import normalize_channel
from .const import DOMAIN

RETENTION = 60 * 24 * 3600
MAX_ENTRIES = 400


def _ts(value: Any) -> int | None:
    if not value:
        return None
    parsed = dt_util.parse_datetime(str(value))
    return int(parsed.timestamp()) if parsed else None


def _overlap_ok(a_start: int, a_end: int, b_start: int, b_end: int) -> bool:
    """Le créneau b couvre au moins la moitié du créneau a."""
    if not (a_start and a_end and b_start and b_end) or a_end <= a_start:
        return False
    return (min(a_end, b_end) - max(a_start, b_start)) * 2 >= a_end - a_start


def _url(value: Any) -> str | None:
    return value if isinstance(value, str) and value.startswith(("http://", "https://")) else None


class PosterMemory:
    """Affiches retenues : liste d'entrées {uuid, channel, start, end, poster}."""

    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        self._store: Store[dict[str, Any]] = Store(hass, 1, f"{DOMAIN}.{entry_id}.posters")
        self.entries: list[dict[str, Any]] = []
        self._dirty = False

    async def async_load(self) -> None:
        data = await self._store.async_load() or {}
        self.entries = data.get("entries", [])

    async def async_save_if_needed(self) -> None:
        if self._dirty:
            await self._store.async_save({"entries": self.entries})
            self._dirty = False

    def learn(self, records: list[dict[str, Any]], programs: dict[str, list[dict[str, Any]]]) -> None:
        """Associe chaque enregistrement à venir au programme du guide qu'il couvre."""
        for rec in records:
            uuid = rec.get("channel_uuid")
            r_start, r_end = rec.get("start"), rec.get("end")
            if not uuid or not r_start or not r_end:
                continue
            for prog in programs.get(uuid, []):
                p_start, p_end = _ts(prog.get("start")), _ts(prog.get("stop") or prog.get("end"))
                poster = _url(prog.get("poster")) or _url(prog.get("icon"))
                if not poster or not p_start or not p_end or not _overlap_ok(p_start, p_end, r_start, r_end):
                    continue
                if self.find(uuid, rec.get("channel_name"), r_start, r_end) == poster:
                    break
                self.entries = [
                    e for e in self.entries
                    if not (e["uuid"] == uuid and e["start"] == r_start and e["end"] == r_end)
                ]
                self.entries.append({
                    "uuid": uuid,
                    "channel": normalize_channel(rec.get("channel_name")),
                    "start": int(r_start),
                    "end": int(r_end),
                    "poster": poster,
                })
                self._dirty = True
                break
        limit = int(dt_util.utcnow().timestamp()) - RETENTION
        kept = [e for e in self.entries if e["end"] >= limit][-MAX_ENTRIES:]
        if len(kept) != len(self.entries):
            self.entries, self._dirty = kept, True

    def find(self, uuid: str | None, channel_name: str | None, start: Any, end: Any) -> str | None:
        """Affiche mémorisée pour un enregistrement (même chaîne, créneau recouvert à 50 %)."""
        if not start or not end:
            return None
        channel = normalize_channel(channel_name)
        for e in reversed(self.entries):
            if (uuid and e["uuid"] == uuid) or (channel and e["channel"] == channel):
                if _overlap_ok(int(start), int(end), e["start"], e["end"]):
                    return e["poster"]
        return None
