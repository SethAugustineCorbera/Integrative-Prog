"""HTTP clients for the mock Registrar and Nager.Date holiday service."""

from __future__ import annotations

import json
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


class IntegrationError(Exception):
    def __init__(self, message: str, status_code: int = 502) -> None:
        super().__init__(message)
        self.status_code = status_code


def _get_json(url: str, headers: dict[str, str] | None = None) -> Any:
    request = Request(url, headers=headers or {}, method="GET")
    last_error = "The external service could not be reached."
    for attempt in range(3):
        try:
            with urlopen(request, timeout=5) as response:
                raw = response.read(2_000_001)
                if len(raw) > 2_000_000:
                    raise IntegrationError("External response exceeded the size limit.")
            try:
                return json.loads(raw.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as error:
                raise IntegrationError("External service returned invalid JSON.") from error
        except HTTPError as error:
            if 400 <= error.code < 500:
                raise IntegrationError(
                    "External service rejected the request (HTTP {}).".format(error.code)
                ) from error
            last_error = "External service returned HTTP {}.".format(error.code)
        except (URLError, TimeoutError) as error:
            last_error = "External service request timed out or failed."
            if isinstance(error, URLError) and error.reason:
                last_error = "External service request failed."
        if attempt < 2:
            time.sleep(0.1 * (attempt + 1))
    raise IntegrationError(last_error)


def fetch_registrar_students(base_url: str, api_key: str) -> list[dict[str, Any]]:
    endpoint = base_url.rstrip("/")
    if not endpoint.endswith("/students"):
        endpoint += "/students"
    students: list[dict[str, Any]] = []
    page_size = 20
    page = 1
    for _ in range(100):
        url = endpoint + "?" + urlencode({"page": page, "size": page_size})
        payload = _get_json(url, {"X-API-Key": api_key, "Accept": "application/json"})
        if isinstance(payload, list):
            rows = payload
        elif isinstance(payload, dict):
            rows = payload.get("students", payload.get("data"))
        else:
            rows = None
        if not isinstance(rows, list):
            raise IntegrationError("Registrar JSON must contain a students array.")
        for row in rows:
            if not isinstance(row, dict):
                raise IntegrationError("Registrar returned a non-object student record.")
            student_number = row.get("student_number", row.get("student_id", row.get("id")))
            full_name = row.get("full_name", row.get("name"))
            if not isinstance(full_name, str):
                first_name = row.get("first_name")
                last_name = row.get("last_name")
                if isinstance(first_name, str) and isinstance(last_name, str):
                    middle_initial = row.get("middle_initial")
                    name_parts = [first_name.strip()]
                    if isinstance(middle_initial, str) and middle_initial.strip():
                        initial = middle_initial.strip().rstrip(".")
                        name_parts.append(initial + ".")
                    name_parts.append(last_name.strip())
                    full_name = " ".join(name_parts)
            program = row.get("program", row.get("program_code", row.get("program_name")))
            year_level = row.get("year_level", row.get("year", 1))
            if (
                not isinstance(student_number, (str, int))
                or not isinstance(full_name, str)
                or not isinstance(program, str)
                or not str(student_number).strip()
                or not full_name.strip()
                or not program.strip()
                or not str(year_level).isdigit()
                or not 1 <= int(year_level) <= 8
            ):
                raise IntegrationError("Registrar returned a student with invalid required fields.")
            students.append(
                {
                    "student_number": str(student_number).strip(),
                    "full_name": full_name.strip(),
                    "program": program.strip(),
                    "year_level": int(year_level),
                    "email": row.get("email") if isinstance(row.get("email"), str) else None,
                    "active": 0 if str(row.get("status", "")).upper() in {"LOA", "INACTIVE"} else 1,
                }
            )
        next_page = payload.get("next_page") if isinstance(payload, dict) else None
        if next_page is not None:
            if type(next_page) is not int or next_page <= page:
                raise IntegrationError("Registrar returned an invalid next_page value.")
            page = next_page
            continue
        has_next = payload.get("has_next") if isinstance(payload, dict) else None
        if has_next is not None:
            if type(has_next) is not bool:
                raise IntegrationError("Registrar returned invalid has_next metadata.")
            if has_next:
                page += 1
                continue
            return students
        if isinstance(payload, dict) and payload.get("has_more") is False:
            return students
        if isinstance(payload, dict) and payload.get("has_more") is True:
            page += 1
            continue
        if len(rows) < page_size or not rows:
            return students
        page += 1
    raise IntegrationError("Registrar paging exceeded 100 pages.")


def fetch_public_holidays(year: int, country: str) -> list[dict[str, str]]:
    if not 2000 <= year <= 2100 or len(country) != 2 or not country.isalpha():
        raise IntegrationError("Holiday request parameters are invalid.", 400)
    url = "https://date.nager.at/api/v3/PublicHolidays/{}/{}".format(
        year, country.upper()
    )
    payload = _get_json(url, {"Accept": "application/json"})
    if not isinstance(payload, list):
        raise IntegrationError("Holiday service returned an unexpected response.")
    holidays = []
    for item in payload:
        if not isinstance(item, dict):
            raise IntegrationError("Holiday service returned an invalid holiday entry.")
        holiday_date = item.get("date")
        local_name = item.get("localName")
        name = item.get("name")
        if not all(isinstance(value, str) and value for value in (holiday_date, local_name, name)):
            raise IntegrationError("Holiday service omitted required holiday fields.")
        holidays.append(
            {"date": holiday_date, "local_name": local_name, "name": name}
        )
    return holidays
