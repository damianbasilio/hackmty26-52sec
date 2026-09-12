"""JSON responses that follow the project's timestamp convention: ISO 8601 UTC ending in Z.

Supabase returns timestamptz as "2026-09-12T18:04:00+00:00". Rewriting it once,
on the way out, covers every route instead of every repository function.
"""

from __future__ import annotations

import re
from typing import Any

from fastapi.responses import JSONResponse

# Only a full UTC timestamp: calendar days, other offsets and free text pass through.
_UTC_OFFSET_RE = re.compile(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?)\+00:00$")


def to_utc_z(value: Any) -> Any:
    if isinstance(value, str):
        return _UTC_OFFSET_RE.sub(r"\1Z", value)
    if isinstance(value, list):
        return [to_utc_z(item) for item in value]
    if isinstance(value, dict):
        return {key: to_utc_z(item) for key, item in value.items()}
    return value


class UTCJSONResponse(JSONResponse):
    def render(self, content: Any) -> bytes:
        return super().render(to_utc_z(content))
