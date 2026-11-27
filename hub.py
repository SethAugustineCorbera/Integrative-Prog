"""Flask API for the DNSC e-Clearance Hub."""

from __future__ import annotations

import base64
import csv
import hashlib
import hmac
import io
import json
import os
import re
import secrets
import sqlite3
import uuid
from datetime import date, datetime, timedelta, timezone
from functools import wraps
from pathlib import Path
from typing import Any, Callable
from xml.etree import ElementTree

from flask import Flask, Response, g, jsonify, request
from werkzeug.exceptions import HTTPException


ROOT = Path(__file__).resolve().parent
if os.name == "nt":
    USER_DATA_ROOT = Path(os.getenv("USERPROFILE") or Path.home())
else:
    USER_DATA_ROOT = Path(os.getenv("XDG_DATA_HOME") or Path.home() / ".local" / "share")
DEFAULT_DB_PATH = (
    USER_DATA_ROOT / "DNSC e-Clearance Hub" / "dnsc_clearance_hub.sqlite3"
)


def load_environment_file() -> None:
    env_file = ROOT / ".env"
    if not env_file.is_file():
        return
    for raw_line in env_file.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip().strip("\"'")
        os.environ.setdefault(key.strip(), value)


load_environment_file()

app = Flask(__name__)
app.config.update(
    SECRET_KEY=os.getenv("FLASK_SECRET_KEY", ""),
    DB_PATH=os.getenv("DB_PATH") or str(DEFAULT_DB_PATH),
    HMAC_SECRET=os.getenv("HUB_HMAC_SECRET", ""),
    SLIP_SIGNING_KEY=os.getenv("HUB_SLIP_SIGNING_KEY", ""),
    REGISTRAR_API_URL=os.getenv("REGISTRAR_API_URL", ""),
    REGISTRAR_API_KEY=os.getenv("REGISTRAR_API_KEY", ""),
    HOLIDAYS_COUNTRY=os.getenv("HOLIDAYS_COUNTRY", "PH"),
    CLEARANCE_WORKING_DAYS=int(os.getenv("CLEARANCE_WORKING_DAYS", "15")),
    FRONTEND_ORIGINS=[
        origin.strip()
        for origin in os.getenv(
            "FRONTEND_ORIGINS", "http://localhost,http://127.0.0.1"
        ).split(",")
        if origin.strip()
    ],
    DROP_FOLDER=os.getenv("DROP_FOLDER", str(ROOT / "drop_folder")),
    ARCHIVE_FOLDER=os.getenv("ARCHIVE_FOLDER", str(ROOT / "archive")),
    LOG_FOLDER=os.getenv("LOG_FOLDER", str(ROOT / "logs")),
    REPORT_FOLDER=os.getenv("REPORT_FOLDER", str(ROOT / "reports")),
)
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024
SESSION_HOURS = 8
PASSWORD_ITERATIONS = 310_000
STUDENT_NUMBER_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{1,39}$")


def get_db() -> Any:
    if "db" not in g:
        database_path = Path(app.config["DB_PATH"])
        if not database_path.is_absolute():
            database_path = ROOT / database_path
        if not database_path.is_file():
            raise FileNotFoundError(
                "Configured SQLite database does not exist: " + str(database_path)
            )
        connection = sqlite3.connect(str(database_path), timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        if connection.execute("PRAGMA foreign_keys").fetchone()[0] != 1:
            connection.close()
            raise RuntimeError("SQLite foreign-key enforcement could not be enabled.")
        g.db = connection
    return g.db


@app.teardown_appcontext
def close_db(_error: BaseException | None = None) -> None:
    connection = g.pop("db", None)
    if connection is not None:
        connection.close()


def query_one(statement: str, values: tuple[Any, ...] = ()) -> dict[str, Any] | None:
    cursor = get_db().cursor()
    try:
        cursor.execute(statement, values)
        row = cursor.fetchone()
        return dict(row) if row is not None else None
    finally:
        cursor.close()


def query_all(statement: str, values: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    cursor = get_db().cursor()
    try:
        cursor.execute(statement, values)
        return [dict(row) for row in cursor.fetchall()]
    finally:
        cursor.close()


def execute(statement: str, values: tuple[Any, ...] = ()) -> int:
    cursor = get_db().cursor()
    try:
        cursor.execute(statement, values)
        return int(cursor.lastrowid or 0)
    finally:
        cursor.close()


def commit() -> None:
    get_db().commit()


def rollback() -> None:
    get_db().rollback()


def hash_password(password: str, salt: bytes | None = None) -> str:
    actual_salt = salt or os.urandom(16)
    derived = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), actual_salt, PASSWORD_ITERATIONS
    )
    return "pbkdf2_sha256${}${}${}".format(
        PASSWORD_ITERATIONS,
        base64.urlsafe_b64encode(actual_salt).decode("ascii"),
        base64.urlsafe_b64encode(derived).decode("ascii"),
    )


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        algorithm, rounds, salt_text, digest_text = stored_hash.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        salt = base64.urlsafe_b64decode(salt_text.encode("ascii"))
        expected = base64.urlsafe_b64decode(digest_text.encode("ascii"))
        candidate = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), salt, int(rounds)
        )
    except (ValueError, TypeError, UnicodeError):
        return False
    return hmac.compare_digest(candidate, expected)


def _token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _error(message: str, status: int, code: str) -> tuple[Any, int]:
    return jsonify({"error": message, "code": code}), status


def _json_body(allowed_fields: set[str]) -> dict[str, Any] | None:
    if not request.is_json:
        return None
    body = request.get_json(silent=True)
    if not isinstance(body, dict) or set(body) - allowed_fields:
        return None
    return body


def _required_text(body: dict[str, Any], key: str, limit: int) -> str | None:
    value = body.get(key)
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value if value and len(value) <= limit else None


def _valid_login_identifier(value: str) -> bool:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._@+-]{2,79}", value):
        return False
    if "@" not in value:
        return True
    if value.count("@") != 1:
        return False
    local, domain = value.split("@", 1)
    if not local or len(local) > 64 or not domain or "." not in domain:
        return False
    return (
        not local.endswith(".")
        and ".." not in local
        and not domain.startswith(".")
        and not domain.endswith(".")
        and ".." not in domain
    )


def _public_user(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "username": row["username"],
        "role": row["role"],
        "student_number": row.get("student_number"),
        "office": row.get("office_name"),
        "office_code": row.get("office_code"),
    }


def _authenticated_user() -> dict[str, Any] | None:
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return None
    token = header[7:].strip()
    if not token or len(token) > 512:
        return None
    expires = datetime.now(timezone.utc).replace(tzinfo=None).strftime(
        "%Y-%m-%d %H:%M:%S"
    )
    return query_one(
        """SELECT u.id, u.username, u.role, u.student_id, u.office_id,
                  s.student_number, o.name AS office_name, o.code AS office_code
           FROM auth_sessions AS a
           JOIN users AS u ON u.id = a.user_id
           LEFT JOIN students AS s ON s.id = u.student_id
           LEFT JOIN offices AS o ON o.id = u.office_id
           WHERE a.token_hash = ? AND a.expires_at > ? AND u.active = 1""",
        (_token_digest(token), expires),
    )


def require_roles(*roles: str) -> Callable[..., Any]:
    def decorate(view: Callable[..., Any]) -> Callable[..., Any]:
        @wraps(view)
        def guarded(*args: Any, **kwargs: Any) -> Any:
            user = _authenticated_user()
            if user is None:
                return _error("Authentication is required.", 401, "unauthorized")
            if roles and user["role"] not in roles:
                return _error("Your role cannot perform this action.", 403, "forbidden")
            g.user = user
            return view(*args, **kwargs)

        return guarded

    return decorate


def _find_office(code_or_name: str) -> dict[str, Any] | None:
    return query_one(
        """SELECT id, code, name, required_for_clearance
           FROM offices
           WHERE LOWER(code) = LOWER(?) OR LOWER(name) = LOWER(?)
           LIMIT 1""",
        (code_or_name, code_or_name),
    )


def _find_student(student_number: str) -> dict[str, Any] | None:
    if not STUDENT_NUMBER_PATTERN.fullmatch(student_number):
        return None
    return query_one(
        "SELECT id, student_number, full_name, program, year_level, email, active "
        "FROM students WHERE student_number = ?",
        (student_number,),
    )


def upsert_student(student: dict[str, Any]) -> None:
    execute(
        """INSERT INTO students
           (student_number, full_name, program, year_level, email, active)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(student_number) DO UPDATE SET
           full_name=excluded.full_name, program=excluded.program,
           year_level=excluded.year_level, email=excluded.email,
           active=excluded.active""",
        (
            student["student_number"],
            student["full_name"],
            student["program"],
            student["year_level"],
            student.get("email"),
            student.get("active", 1),
        ),
    )


def upsert_clearance(
    student_id: int,
    office_id: int,
    status: str,
    reason: str,
    source: str,
    updated_by: int | None,
) -> None:
    execute(
        """INSERT INTO clearance_records
           (student_id, office_id, status, reason, source, updated_by)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(student_id, office_id) DO UPDATE SET
           status=excluded.status, reason=excluded.reason,
           source=excluded.source, updated_by=excluded.updated_by,
           updated_at=CURRENT_TIMESTAMP""",
        (student_id, office_id, status, reason, source, updated_by),
    )


def clearance_for_student(student: dict[str, Any]) -> dict[str, Any]:
    offices = query_all(
        """SELECT o.id, o.code, o.name, o.required_for_clearance,
                  c.status, c.reason, c.updated_at
           FROM offices AS o
           LEFT JOIN clearance_records AS c
             ON c.office_id = o.id AND c.student_id = ?
           ORDER BY o.id""",
        (student["id"],),
    )
    office_results = []
    all_cleared = bool(student["active"])
    for office in offices:
        status = office["status"] or "HOLD"
        reason = office["reason"] or "Awaiting office review."
        if office["required_for_clearance"] and status != "CLEARED":
            all_cleared = False
        office_results.append(
            {
                "office": office["name"],
                "office_code": office["code"],
                "required": bool(office["required_for_clearance"]),
                "status": status,
                "reason": reason,
                "updated_at": office["updated_at"],
            }
        )
    return {
        "student": {
            "student_number": student["student_number"],
            "full_name": student["full_name"],
            "program": student["program"],
            "year_level": student["year_level"],
        },
        "overall": "CLEARED" if all_cleared and offices else "HOLD",
        "offices": office_results,
    }


def _clearance_progress(status: dict[str, Any]) -> dict[str, int]:
    required_offices = [
        office for office in status["offices"] if office["required"]
    ]
    cleared = sum(office["status"] == "CLEARED" for office in required_offices)
    total = len(required_offices)
    return {
        "cleared": cleared,
        "total": total,
        "percent": round(cleared / total * 100) if total else 0,
    }


def mask_student_number(student_number: str) -> str:
    digits = [index for index, character in enumerate(student_number) if character.isalnum()]
    if len(digits) <= 6:
        return "*" * len(student_number)
    masked = list(student_number)
    for index in digits[4:-2]:
        masked[index] = "*"
    return "".join(masked)


def _encode_slip(payload: dict[str, Any]) -> tuple[str, str, str]:
    key = app.config["SLIP_SIGNING_KEY"]
    if not key:
        raise RuntimeError("HUB_SLIP_SIGNING_KEY is not configured.")
    payload_json = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    payload_part = base64.urlsafe_b64encode(payload_json.encode("utf-8")).rstrip(b"=").decode()
    signature = hmac.new(key.encode("utf-8"), payload_part.encode("ascii"), hashlib.sha256).hexdigest()
    token = payload_part + "." + signature
    return token, payload_json, signature


def _insert_audit(
    action: str,
    student_id: int | None = None,
    office_id: int | None = None,
    reason: str | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    user = getattr(g, "user", None)
    execute(
        """INSERT INTO audit_logs
           (actor_user_id, action, student_id, office_id, reason, details_json)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (
            user["id"] if user else None,
            action,
            student_id,
            office_id,
            reason,
            json.dumps(details, separators=(",", ":")) if details else None,
        ),
    )


@app.after_request
def set_cors_headers(response: Response) -> Response:
    origin = request.headers.get("Origin")
    if origin and origin in app.config["FRONTEND_ORIGINS"]:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
        response.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, OPTIONS"
    return response


@app.errorhandler(HTTPException)
def handle_http_error(error: HTTPException) -> tuple[Any, int]:
    return _error(error.description, error.code or 500, error.name.lower().replace(" ", "_"))


@app.get("/api/health")
def health() -> Any:
    query_one("SELECT 1 AS ok")
    return jsonify({"status": "ok", "database": "connected"})


@app.post("/api/auth/login")
def login() -> Any:
    body = _json_body({"username", "password"})
    if body is None:
        return _error("Send a JSON object with username and password only.", 400, "invalid_body")
    username = _required_text(body, "username", 80)
    password = body.get("password")
    if username is None or not isinstance(password, str) or not password or len(password) > 256:
        return _error("Username or password is invalid.", 400, "invalid_credentials")
    user = query_one(
        """SELECT u.id, u.username, u.password_hash, u.role, u.student_id, u.office_id,
                  s.student_number, o.name AS office_name, o.code AS office_code
           FROM users AS u
           LEFT JOIN students AS s ON s.id = u.student_id
           LEFT JOIN offices AS o ON o.id = u.office_id
           WHERE u.username = ? AND u.active = 1""",
        (username,),
    )
    if user is None or not verify_password(password, user["password_hash"]):
        return _error("Username or password is incorrect.", 401, "invalid_credentials")
    if user["role"] == "student" and user["student_id"] is None:
        return _error("This student account is not linked to a student record.", 403, "account_not_configured")
    if user["role"] == "staff" and user["office_id"] is None:
        return _error("This staff account is not linked to an office.", 403, "account_not_configured")
    token = secrets.token_urlsafe(32)
    expiry = (datetime.now(timezone.utc) + timedelta(hours=SESSION_HOURS)).replace(tzinfo=None)
    execute(
        "INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
        (_token_digest(token), user["id"], expiry.strftime("%Y-%m-%d %H:%M:%S")),
    )
    commit()
    return jsonify(
        {
            "token": token,
            "expires_at": expiry.isoformat() + "Z",
            "user": _public_user(user),
        }
    )


@app.post("/api/auth/register")
def register_student() -> Any:
    body = _json_body({"username", "password", "student_number", "full_name"})
    if body is None:
        return _error(
            "Send a JSON object with username, password, student_number, and full_name only.",
            400,
            "invalid_body",
        )
    username = _required_text(body, "username", 80)
    student_number = _required_text(body, "student_number", 40)
    full_name = _required_text(body, "full_name", 160)
    password = body.get("password")
    if (
        username is None
        or len(username) < 3
        or not re.fullmatch(r"[A-Za-z0-9._-]{3,80}", username)
    ):
        return _error(
            "Username must be 3-80 characters using letters, numbers, '.', '_' or '-'.",
            400,
            "invalid_username",
        )
    if not isinstance(password, str) or len(password) < 12 or len(password) > 256:
        return _error(
            "Password must be between 12 and 256 characters.",
            400,
            "invalid_password",
        )
    if student_number is None or full_name is None:
        return _error(
            "Student number and full name are required.",
            400,
            "invalid_student",
        )
    roster = query_one("SELECT COUNT(*) AS active_count FROM students WHERE active = 1")
    if roster is not None and roster["active_count"] == 0:
        registrar_configured = (
            bool(app.config["REGISTRAR_API_URL"])
            and bool(app.config["REGISTRAR_API_KEY"])
            and "replace-with" not in app.config["REGISTRAR_API_KEY"].lower()
        )
        if registrar_configured:
            message = (
                "No active Registrar records are loaded. Ask the Hub administrator "
                "to sync the Registrar masterlist."
            )
        else:
            message = (
                "Student registration is not configured yet. Ask the Hub administrator "
                "to add a valid Registrar API key and sync the masterlist."
            )
        return _error(
            message,
            503,
            "student_roster_empty",
        )
    student = _find_student(student_number)
    if (
        student is None
        or not student["active"]
        or " ".join(student["full_name"].split()).casefold()
        != " ".join(full_name.split()).casefold()
    ):
        return _error(
            "Student details do not match an active Registrar record.",
            400,
            "student_not_verified",
        )
    existing = query_one(
        "SELECT id FROM users WHERE username = ? OR student_id = ? LIMIT 1",
        (username, student["id"]),
    )
    if existing is not None:
        return _error(
            "An account already exists for that username or student record.",
            409,
            "account_exists",
        )
    try:
        create_user(username, password, "student", student_number=student_number)
    except sqlite3.IntegrityError:
        rollback()
        return _error(
            "An account already exists for that username or student record.",
            409,
            "account_exists",
        )
    return jsonify({"message": "Student account created. You can now sign in."}), 201


@app.get("/api/auth/me")
@require_roles()
def who_am_i() -> Any:
    return jsonify({"user": _public_user(g.user)})


@app.post("/api/auth/logout")
@require_roles()
def logout() -> Any:
    token = request.headers.get("Authorization", "")[7:].strip()
    execute("DELETE FROM auth_sessions WHERE token_hash = ?", (_token_digest(token),))
    commit()
    return jsonify({"message": "Logged out."})


@app.get("/api/students/me/clearance")
@require_roles("student")
def my_clearance() -> Any:
    student = query_one(
        "SELECT id, student_number, full_name, program, year_level, active "
        "FROM students WHERE id = ?",
        (g.user["student_id"],),
    )
    if student is None:
        return _error("Student record was not found.", 404, "student_not_found")
    return jsonify(clearance_for_student(student))


@app.get("/api/offices/<office_name>/students")
@require_roles("staff", "admin")
def office_students(office_name: str) -> Any:
    office = _find_office(office_name)
    if office is None:
        return _error("Office was not found.", 404, "office_not_found")
    # Registrar staff give the final sign-off, so they may read (never change) every office's queue.
    if (
        g.user["role"] == "staff"
        and g.user["office_id"] != office["id"]
        and g.user.get("office_code") != "registrar"
    ):
        return _error("Staff may only view their assigned office.", 403, "office_forbidden")
    status = request.args.get("status", "").upper()
    if status and status not in {"HOLD", "CLEARED"}:
        return _error("status must be HOLD or CLEARED.", 400, "invalid_status")
    sql = """SELECT s.student_number, s.full_name, s.program,
                    COALESCE(c.status, 'HOLD') AS status,
                    COALESCE(c.reason, 'Awaiting office review.') AS reason,
                    c.updated_at
             FROM students AS s
             LEFT JOIN clearance_records AS c
               ON c.student_id = s.id AND c.office_id = ?
             WHERE s.active = 1"""
    values: tuple[Any, ...] = (office["id"],)
    if status:
        sql += " AND COALESCE(c.status, 'HOLD') = ?"
        values += (status,)
    sql += " ORDER BY s.student_number"
    return jsonify(
        {
            "office": {"code": office["code"], "name": office["name"]},
            "students": query_all(sql, values),
        }
    )


def _change_clearance(
    student_number: str, office_name: str, status: str, reason: str
) -> Any:
    student = _find_student(student_number)
    office = _find_office(office_name)
    if student is None or office is None:
        return _error("Student or office was not found.", 404, "record_not_found")
    if g.user["role"] != "staff" or g.user["office_id"] != office["id"]:
        return _error("Only staff assigned to this office can update its clearance.", 403, "office_forbidden")
    upsert_clearance(
        student["id"], office["id"], status, reason, "staff", g.user["id"]
    )
    _insert_audit(
        "SIGN_OFF" if status == "CLEARED" else "HOLD",
        student["id"],
        office["id"],
        reason,
    )
    commit()
    return jsonify(
        {
            "student_number": student["student_number"],
            "office": office["name"],
            "status": status,
            "reason": reason,
        }
    )


@app.post("/api/clearance/<student_number>/<office_name>/signoff")
@require_roles("staff")
def sign_off(student_number: str, office_name: str) -> Any:
    body = _json_body({"reason"})
    if body is None:
        return _error("Send a JSON object containing a reason.", 400, "invalid_body")
    reason = _required_text(body, "reason", 500)
    if reason is None:
        return _error("A reason between 1 and 500 characters is required.", 400, "invalid_reason")
    return _change_clearance(student_number, office_name, "CLEARED", reason)


@app.post("/api/clearance/<student_number>/<office_name>/hold")
@require_roles("staff")
def place_hold(student_number: str, office_name: str) -> Any:
    body = _json_body({"reason"})
    if body is None:
        return _error("Send a JSON object containing a reason.", 400, "invalid_body")
    reason = _required_text(body, "reason", 500)
    if reason is None:
        return _error("A reason between 1 and 500 characters is required.", 400, "invalid_reason")
    return _change_clearance(student_number, office_name, "HOLD", reason)


@app.get("/api/deadline")
@require_roles()
def deadline() -> Any:
    from integration_clients import IntegrationError, fetch_public_holidays

    working_days = app.config["CLEARANCE_WORKING_DAYS"]
    if not isinstance(working_days, int) or not 1 <= working_days <= 60:
        return _error("CLEARANCE_WORKING_DAYS must be between 1 and 60.", 500, "configuration_error")
    country = app.config["HOLIDAYS_COUNTRY"].upper()
    today = date.today()
    years = list(range(today.year, (today + timedelta(days=working_days * 2 + 370)).year + 1))
    holiday_map: dict[date, str] = {}
    try:
        for year in years:
            year_start = f"{year:04d}-01-01"
            next_year_start = f"{year + 1:04d}-01-01"
            cached = query_all(
                """SELECT holiday_date, local_name FROM holidays
                   WHERE country_code = ? AND holiday_date >= ? AND holiday_date < ?""",
                (country, year_start, next_year_start),
            )
            if not cached:
                holidays = fetch_public_holidays(year, country)
                for holiday in holidays:
                    execute(
                        """INSERT INTO holidays
                           (holiday_date, local_name, english_name, country_code)
                           VALUES (?, ?, ?, ?)
                           ON CONFLICT(holiday_date, country_code) DO UPDATE SET
                           local_name=excluded.local_name,
                           english_name=excluded.english_name,
                           fetched_at=CURRENT_TIMESTAMP""",
                        (holiday["date"], holiday["local_name"], holiday["name"], country),
                    )
                commit()
                cached = query_all(
                    """SELECT holiday_date, local_name FROM holidays
                       WHERE country_code = ? AND holiday_date >= ? AND holiday_date < ?""",
                    (country, year_start, next_year_start),
                )
            for holiday in cached:
                holiday_date = holiday["holiday_date"]
                if isinstance(holiday_date, str):
                    holiday_date = date.fromisoformat(holiday_date[:10])
                holiday_map[holiday_date] = holiday["local_name"]
    except (IntegrationError, ValueError) as error:
        return _error("Holiday service is unavailable: " + str(error), 502, "holiday_service_error")
    skipped: list[dict[str, str]] = []
    candidate = today
    counted = 0
    while counted < working_days:
        candidate += timedelta(days=1)
        if candidate.weekday() >= 5:
            skipped.append({"date": candidate.isoformat(), "reason": "Weekend"})
        elif candidate in holiday_map:
            skipped.append({"date": candidate.isoformat(), "reason": holiday_map[candidate]})
        else:
            counted += 1
    return jsonify(
        {
            "start_date": today.isoformat(),
            "deadline": candidate.isoformat(),
            "working_days": working_days,
            "country": country,
            "skipped_days": skipped,
        }
    )


def _report_rows() -> list[dict[str, Any]]:
    students = query_all(
        "SELECT id, student_number, full_name, program, year_level, active "
        "FROM students WHERE active = 1 ORDER BY student_number"
    )
    report = []
    for student in students:
        status = clearance_for_student(student)
        report.append(
            {
                "student_id": mask_student_number(student["student_number"]),
                "program": student["program"],
                "year_level": student["year_level"],
                "overall": status["overall"],
            }
        )
    return report


@app.get("/api/reports/clearance")
@require_roles("admin", "staff")
def clearance_report() -> Any:
    # The Registrar downloads the report (office staff of the Registrar and admins only).
    if g.user["role"] == "staff" and g.user.get("office_code") != "registrar":
        return _error("Only the Registrar office and administrators can download this report.", 403, "forbidden")
    export_format = request.args.get("format", "json").lower()
    if export_format not in {"csv", "json", "xml"}:
        return _error("format must be csv, json, or xml.", 400, "invalid_format")
    report = _report_rows()
    if export_format == "json":
        return jsonify({"generated_at": datetime.now(timezone.utc).isoformat(), "students": report})
    if export_format == "csv":
        output = io.StringIO(newline="")
        writer = csv.DictWriter(output, fieldnames=["student_id", "program", "year_level", "overall"])
        writer.writeheader()
        writer.writerows(report)
        return Response(
            output.getvalue(),
            mimetype="text/csv",
            headers={"Content-Disposition": 'attachment; filename="clearance-report.csv"'},
        )
    root = ElementTree.Element("clearanceReport")
    for item in report:
        student = ElementTree.SubElement(root, "student")
        for key, value in item.items():
            ElementTree.SubElement(student, key).text = str(value)
    payload = ElementTree.tostring(root, encoding="utf-8", xml_declaration=True)
    return Response(
        payload,
        mimetype="application/xml",
        headers={"Content-Disposition": 'attachment; filename="clearance-report.xml"'},
    )


def _slip_qr_svg(token: str) -> str:
    import qrcode
    from qrcode.image.svg import SvgPathImage

    qr = qrcode.QRCode(
        box_size=8,
        border=4,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
    )
    qr.add_data(token)
    qr.make(fit=True)
    return qr.make_image(image_factory=SvgPathImage).to_string().decode("utf-8")


@app.get("/api/slips/me")
@require_roles("student")
def my_slip() -> Any:
    student = query_one(
        "SELECT id, student_number, full_name, program, year_level, active "
        "FROM students WHERE id = ?",
        (g.user["student_id"],),
    )
    if student is None:
        return _error("Student record was not found.", 404, "student_not_found")
    status = clearance_for_student(student)
    progress = _clearance_progress(status)
    now = datetime.now(timezone.utc)
    expires = now + timedelta(days=30)
    payload = {
        "student_id": student["id"],
        "issued_at": int(now.timestamp()),
        "expires_at": int(expires.timestamp()),
        "jti": uuid.uuid4().hex,
    }
    token, payload_json, signature = _encode_slip(payload)
    public_code = "ECH-" + secrets.token_urlsafe(6).replace("-", "").replace("_", "").upper()
    execute(
        """INSERT INTO clearance_slips
           (public_code, token_hash, payload_json, signature, student_id, issued_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (
            public_code,
            _token_digest(token),
            payload_json,
            signature,
            student["id"],
            now.replace(tzinfo=None).strftime("%Y-%m-%d %H:%M:%S"),
            expires.replace(tzinfo=None).strftime("%Y-%m-%d %H:%M:%S"),
        ),
    )
    _insert_audit("SLIP_ISSUED", student["id"], details={"code": public_code})
    commit()
    return jsonify(
        {
            "student": {
                "full_name": student["full_name"],
                "student_number": mask_student_number(student["student_number"]),
                "program": student["program"],
            },
            "status": status["overall"],
            "offices": status["offices"],
            "progress": progress,
            "public_code": public_code,
            "signed_token": token,
            "qr_svg": _slip_qr_svg(token),
            "issued_at": now.isoformat(),
            "expires_at": expires.isoformat(),
        }
    )


def _verify_slip_signature(payload_json: str, signature: str) -> bool:
    try:
        payload = json.loads(payload_json)
        payload_part = base64.urlsafe_b64encode(
            json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).rstrip(b"=").decode("ascii")
        expected = hmac.new(
            app.config["SLIP_SIGNING_KEY"].encode("utf-8"),
            payload_part.encode("ascii"),
            hashlib.sha256,
        ).hexdigest()
    except (ValueError, TypeError, UnicodeError):
        return False
    return hmac.compare_digest(signature, expected)


@app.post("/api/slips/verify")
@require_roles("staff", "admin")
def verify_slip() -> Any:
    body = _json_body({"token", "code"})
    if body is None:
        return _error("Send a JSON object containing token or code only.", 400, "invalid_body")
    token = body.get("token")
    code = body.get("code")
    if bool(token) == bool(code):
        return _error("Provide exactly one signed token or public code.", 400, "invalid_slip")
    if token:
        if not isinstance(token, str) or len(token) > 512 or "." not in token:
            return _error("Signed token is malformed.", 400, "invalid_slip")
        payload_part, supplied_signature = token.rsplit(".", 1)
        expected_signature = hmac.new(
            app.config["SLIP_SIGNING_KEY"].encode("utf-8"),
            payload_part.encode("ascii"),
            hashlib.sha256,
        ).hexdigest()
        if not re.fullmatch(r"[a-fA-F0-9]{64}", supplied_signature) or not hmac.compare_digest(
            supplied_signature, expected_signature
        ):
            return jsonify({"verified": False, "reason": "Invalid signature."})
        slip = query_one(
            """SELECT c.*, s.student_number, s.full_name, s.program
               FROM clearance_slips AS c JOIN students AS s ON s.id = c.student_id
               WHERE c.token_hash = ?""",
            (_token_digest(token),),
        )
    else:
        if not isinstance(code, str) or not re.fullmatch(r"ECH-[A-Z0-9]{6,12}", code.strip().upper()):
            return _error("Public code is malformed.", 400, "invalid_slip")
        slip = query_one(
            """SELECT c.*, s.student_number, s.full_name, s.program
               FROM clearance_slips AS c JOIN students AS s ON s.id = c.student_id
               WHERE c.public_code = ?""",
            (code.strip().upper(),),
        )
    if slip is None or not _verify_slip_signature(str(slip["payload_json"]), slip["signature"]):
        return jsonify({"verified": False, "reason": "Slip is unknown or its signature is invalid."})
    expiry = slip["expires_at"]
    if isinstance(expiry, str):
        expiry = datetime.fromisoformat(expiry.replace("Z", "+00:00"))
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)
    if slip["revoked_at"] or expiry <= datetime.now(timezone.utc):
        return jsonify({"verified": False, "reason": "Slip is expired or revoked."})
    student = {
        "id": slip["student_id"],
        "student_number": slip["student_number"],
        "full_name": slip["full_name"],
        "program": slip["program"],
        "year_level": 0,
        "active": 1,
    }
    clearance = clearance_for_student(student)
    _insert_audit("SLIP_VERIFIED", slip["student_id"], details={"code": slip["public_code"]})
    commit()
    return jsonify(
        {
            "verified": True,
            "public_code": slip["public_code"],
            "student": {
                "full_name": slip["full_name"],
                "student_number": mask_student_number(slip["student_number"]),
            },
            "overall": clearance["overall"],
            "offices": [
                {
                    "office": office["office"],
                    "office_code": office["office_code"],
                    "required": office["required"],
                    "status": office["status"],
                    "updated_at": office["updated_at"],
                }
                for office in clearance["offices"]
            ],
            "progress": _clearance_progress(clearance),
            "expires_at": expiry.isoformat(),
        }
    )


@app.get("/api/audit")
@require_roles("admin")
def audit_log() -> Any:
    entries = query_all(
        """SELECT a.id, a.action, a.reason, a.details_json, a.created_at,
                  u.username, s.student_number, o.name AS office_name
           FROM audit_logs AS a
           LEFT JOIN users AS u ON u.id = a.actor_user_id
           LEFT JOIN students AS s ON s.id = a.student_id
           LEFT JOIN offices AS o ON o.id = a.office_id
           ORDER BY a.created_at DESC, a.id DESC LIMIT 500"""
    )
    for entry in entries:
        details = entry.pop("details_json", None)
        if isinstance(details, str):
            try:
                details = json.loads(details)
            except json.JSONDecodeError:
                details = None
        entry["details"] = (
            {
                key: value
                for key, value in details.items()
                if not re.search(r"password|hash|secret|token|code", str(key), re.I)
            }
            if isinstance(details, dict)
            else {}
        )
        if entry["student_number"]:
            entry["student_number"] = mask_student_number(entry["student_number"])
    return jsonify({"entries": entries})


@app.get("/api/imports")
@require_roles("admin")
def imports() -> Any:
    batches = query_all(
        """SELECT id, file_name, source, file_sha256, manifest_verified, status,
                  imported_count, rejected_count, created_at
           FROM import_batches ORDER BY created_at DESC, id DESC LIMIT 100"""
    )
    rejects = query_all(
        """SELECT r.id, r.batch_id, r.row_reference, r.reason, r.created_at
           FROM import_rejections AS r
           ORDER BY r.created_at DESC, r.id DESC LIMIT 500"""
    )
    return jsonify({"batches": batches, "rejections": rejects})


@app.post("/api/admin/import")
@require_roles("admin")
def upload_import() -> Any:
    from importer import process_path
    from werkzeug.utils import secure_filename

    uploaded_file = request.files.get("file")
    manifest_file = request.files.get("manifest")
    if uploaded_file is None or manifest_file is None:
        return _error("Attach both file and manifest multipart fields.", 400, "missing_file")
    filename = secure_filename(uploaded_file.filename or "")
    if not filename or Path(filename).suffix.lower() not in {".xml", ".csv"}:
        return _error("Only XML and CSV import files are accepted.", 400, "invalid_file")
    drop_dir = Path(app.config["DROP_FOLDER"])
    drop_dir.mkdir(parents=True, exist_ok=True)
    file_path = drop_dir / filename
    manifest_path = drop_dir / (filename + ".manifest.json")
    uploaded_file.save(file_path)
    manifest_file.save(manifest_path)
    result = process_path(file_path, g.user["id"])
    return jsonify(result), 200 if result["status"] != "REJECTED" else 400


@app.post("/api/admin/sync-registrar")
@require_roles("admin")
def sync_registrar() -> Any:
    from integration_clients import IntegrationError, fetch_registrar_students

    base_url = app.config["REGISTRAR_API_URL"]
    api_key = app.config["REGISTRAR_API_KEY"]
    if not base_url or not api_key or "replace-with" in api_key:
        return _error("Configure REGISTRAR_API_URL and REGISTRAR_API_KEY.", 503, "registrar_not_configured")
    try:
        students = fetch_registrar_students(base_url, api_key)
        registrar_office = _find_office("registrar")
        if registrar_office is None:
            return _error("Registrar office is missing from the database.", 500, "configuration_error")
        for student in students:
            upsert_student(student)
            saved_student = _find_student(student["student_number"])
            if saved_student is not None:
                status = "CLEARED" if student["active"] else "HOLD"
                reason = "Active in Registrar masterlist." if student["active"] else "Inactive or on leave in Registrar masterlist."
                upsert_clearance(
                    saved_student["id"],
                    registrar_office["id"],
                    status,
                    reason,
                    "registrar",
                    g.user["id"],
                )
        _insert_audit("IMPORT", details={"source": "registrar", "count": len(students)})
        commit()
    except IntegrationError as error:
        rollback()
        return _error(str(error), error.status_code, "registrar_service_error")
    return jsonify({"synchronized": len(students)})


@app.get("/api/admin/hold-summary")
@require_roles("admin", "staff")
def hold_summary() -> Any:
    # Admins see every office; office staff see only their own office.
    own_office = g.user.get("office_code") if g.user["role"] == "staff" else None
    if g.user["role"] == "staff" and not own_office:
        return _error("Your account is not linked to an office.", 403, "forbidden")
    summaries = query_all(
        """SELECT o.code AS office_code, o.name AS office,
                  s.student_number, s.full_name,
                  COALESCE(c.reason, 'Awaiting office review.') AS reason
           FROM offices AS o
           CROSS JOIN students AS s
           LEFT JOIN clearance_records AS c
             ON c.office_id = o.id AND c.student_id = s.id
           WHERE s.active = 1 AND o.required_for_clearance = 1
             AND COALESCE(c.status, 'HOLD') = 'HOLD'
           ORDER BY o.name, s.student_number"""
    )
    if own_office:
        summaries = [row for row in summaries if row["office_code"] == own_office]
    return jsonify({"holds": summaries})


@app.get("/api/admin/users")
@require_roles("admin")
def admin_users() -> Any:
    users = query_all(
        """SELECT u.id, u.username, u.role, u.active, s.student_number,
                  s.full_name, s.email, o.code AS office_code, o.name AS office_name
           FROM users AS u
           LEFT JOIN students AS s ON s.id = u.student_id
           LEFT JOIN offices AS o ON o.id = u.office_id
           ORDER BY u.username"""
    )
    offices = query_all("SELECT code, name FROM offices ORDER BY name")
    students = query_all(
        """SELECT student_number, full_name FROM students
           WHERE active = 1 ORDER BY full_name, student_number"""
    )
    return jsonify({"users": users, "offices": offices, "students": students})


@app.post("/api/admin/users")
@require_roles("admin")
def create_admin_user() -> Any:
    body = _json_body(
        {"username", "password", "role", "student_number", "office_code"}
    )
    if body is None:
        return _error("Send valid account details.", 400, "invalid_body")
    username = _required_text(body, "username", 80)
    password = body.get("password")
    role = body.get("role")
    if username is None or not _valid_login_identifier(username):
        return _error(
            "Enter a valid username or email-style login ID (3-80 characters).",
            400,
            "invalid_username",
        )
    if not isinstance(password, str) or not 12 <= len(password) <= 256:
        return _error(
            "Password must be between 12 and 256 characters.",
            400,
            "invalid_password",
        )
    if role not in {"student", "staff", "admin"}:
        return _error("Select student, staff, or admin as the role.", 400, "invalid_role")

    student_number: str | None = None
    office_code: str | None = None
    if role == "student":
        student_number = _required_text(body, "student_number", 40)
        student = _find_student(student_number) if student_number else None
        if student is None or not student["active"]:
            return _error(
                "Select an active student from the Registrar masterlist.",
                400,
                "invalid_student",
            )
    elif role == "staff":
        office_code = _required_text(body, "office_code", 40)
        if office_code is None or _find_office(office_code) is None:
            return _error("Select a valid office for this staff account.", 400, "invalid_office")

    duplicate = query_one(
        "SELECT id FROM users WHERE LOWER(username) = LOWER(?)", (username,)
    )
    if duplicate is not None:
        return _error("That login ID is already in use.", 409, "username_exists")

    try:
        _insert_audit(
            "USER_CREATED",
            details={"username": username, "role": role},
        )
        user_id = create_user(
            username,
            password,
            role,
            student_number=student_number,
            office_name=office_code,
        )
    except ValueError as error:
        rollback()
        return _error(str(error), 400, "invalid_account")
    except sqlite3.IntegrityError:
        rollback()
        return _error("The login ID or student account is already in use.", 409, "account_exists")
    return jsonify({"id": user_id, "message": "User account created."}), 201


@app.put("/api/admin/users/<int:user_id>")
@require_roles("admin")
def update_admin_user(user_id: int) -> Any:
    user = query_one(
        """SELECT id, username, role, student_id, office_id, active
           FROM users WHERE id = ?""",
        (user_id,),
    )
    if user is None:
        return _error("User account was not found.", 404, "user_not_found")

    fields = {
        "username", "active", "role", "student_number", "office_code",
        "full_name", "email",
    }
    body = _json_body(fields)
    if body is None or not {"username", "active"}.issubset(body):
        return _error("Send valid user details.", 400, "invalid_body")

    username = _required_text(body, "username", 80)
    if username is None or not _valid_login_identifier(username):
        return _error("Enter a valid username or email-style login ID.", 400, "invalid_username")
    role = body.get("role", user["role"])
    if role not in {"student", "staff", "admin"}:
        return _error("Select student, staff, or admin as the role.", 400, "invalid_role")
    if not isinstance(body["active"], bool):
        return _error("active must be true or false.", 400, "invalid_active")
    if user["id"] == g.user["id"]:
        if body["active"] is False:
            return _error("You cannot deactivate your own account.", 400, "cannot_deactivate_self")
        if role != "admin":
            return _error("You cannot remove your own administrator role.", 400, "cannot_demote_self")
    active_admins = query_one(
        "SELECT COUNT(*) AS active_count FROM users WHERE role = 'admin' AND active = 1"
    )
    if (
        user["role"] == "admin"
        and user["active"]
        and (role != "admin" or not body["active"])
        and active_admins is not None
        and active_admins["active_count"] <= 1
    ):
        return _error(
            "The last active administrator cannot be deactivated or changed to another role.",
            400,
            "last_active_admin",
        )
    duplicate = query_one(
        "SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id <> ?",
        (username, user_id),
    )
    if duplicate is not None:
        return _error("That login ID is already in use.", 409, "username_exists")

    student_id: int | None = None
    student_profile: tuple[str, str | None, int] | None = None
    if role == "student":
        student_number = _required_text(body, "student_number", 40)
        if student_number is None and user["role"] == "student":
            current_student = query_one(
                "SELECT student_number FROM students WHERE id = ?",
                (user["student_id"],),
            ) if user["student_id"] is not None else None
            student_number = current_student["student_number"] if current_student else None
        student = _find_student(student_number) if student_number else None
        if student is None or not student["active"]:
            return _error(
                "Select an active student from the Registrar masterlist.",
                400,
                "invalid_student",
            )
        linked_account = query_one(
            "SELECT id FROM users WHERE student_id = ? AND id <> ?",
            (student["id"], user_id),
        )
        if linked_account is not None:
            return _error("That student already has an account.", 409, "student_account_exists")
        student_id = student["id"]
        full_name = body.get("full_name", student["full_name"])
        if not isinstance(full_name, str) or not full_name.strip() or len(full_name.strip()) > 160:
            return _error("Student name is required and must be 160 characters or fewer.", 400, "invalid_name")
        full_name = full_name.strip()
        email = body.get("email", student["email"])
        if email is not None and not isinstance(email, str):
            return _error("Student email must be text.", 400, "invalid_email")
        email = email.strip() if isinstance(email, str) else None
        if email == "":
            email = None
        if email is not None and len(email) > 254:
            return _error("Student email must be 254 characters or fewer.", 400, "invalid_email")
        student_profile = (full_name, email, student_id)
    office_id: int | None = None
    if role == "staff":
        office_code = _required_text(body, "office_code", 40)
        if office_code is None and user["role"] == "staff":
            current_office = query_one(
                "SELECT code FROM offices WHERE id = ?", (user["office_id"],)
            ) if user["office_id"] is not None else None
            office_code = current_office["code"] if current_office else None
        office = query_one(
            "SELECT id FROM offices WHERE code = ?",
            (office_code,),
        ) if office_code else None
        if office is None:
            return _error("Select a valid office for this staff account.", 400, "invalid_office")
        office_id = office["id"]
    role_changed = role != user["role"]
    assignment_changed = student_id != user["student_id"] or office_id != user["office_id"]
    try:
        if student_profile is not None:
            execute(
                "UPDATE students SET full_name = ?, email = ? WHERE id = ?",
                student_profile,
            )
        _insert_audit(
            "USER_UPDATED",
            details={
                "user_id": user_id,
                "username_before": user["username"],
                "username_after": username,
                "role_before": user["role"],
                "role_after": role,
                "active_before": bool(user["active"]),
                "active_after": body["active"],
            },
        )
        execute(
            """UPDATE users
               SET username = ?, role = ?, student_id = ?, office_id = ?, active = ?
               WHERE id = ?""",
            (username, role, student_id, office_id, int(body["active"]), user_id),
        )
        if role_changed or assignment_changed or not body["active"]:
            execute("DELETE FROM auth_sessions WHERE user_id = ?", (user_id,))
        commit()
    except sqlite3.IntegrityError:
        rollback()
        return _error("The login ID or selected account assignment is already in use.", 409, "account_conflict")
    return jsonify(
        {
            "message": "User account updated.",
            "session_revoked": bool(role_changed or assignment_changed or not body["active"]),
        }
    )


@app.post("/api/admin/users/<int:user_id>/password")
@require_roles("admin")
def reset_admin_user_password(user_id: int) -> Any:
    body = _json_body({"password"})
    if body is None or not isinstance(body.get("password"), str):
        return _error("Send the new password as a string.", 400, "invalid_body")
    password = body["password"]
    if not 12 <= len(password) <= 256:
        return _error("Password must be between 12 and 256 characters.", 400, "invalid_password")
    user = query_one(
        "SELECT id, username, role FROM users WHERE id = ?",
        (user_id,),
    )
    if user is None:
        return _error("User account was not found.", 404, "user_not_found")
    _insert_audit(
        "PASSWORD_RESET",
        details={
            "user_id": user_id,
            "username": user["username"],
            "role": user["role"],
        },
    )
    execute(
        "UPDATE users SET password_hash = ? WHERE id = ?",
        (hash_password(password), user_id),
    )
    execute("DELETE FROM auth_sessions WHERE user_id = ?", (user_id,))
    commit()
    return jsonify(
        {
            "message": "Password updated. Existing sessions for this account were signed out.",
            "session_revoked": user_id == g.user["id"],
        }
    )


def create_user(
    username: str,
    password: str,
    role: str,
    student_number: str | None = None,
    office_name: str | None = None,
) -> int:
    if role not in {"student", "staff", "admin"}:
        raise ValueError("role must be student, staff, or admin")
    if len(password) < 12:
        raise ValueError("password must be at least 12 characters")
    student = _find_student(student_number) if student_number else None
    office = _find_office(office_name) if office_name else None
    if role == "student" and student is None:
        raise ValueError("student accounts must use an existing student number")
    if role == "staff" and office is None:
        raise ValueError("staff accounts must use an existing office")
    user_id = execute(
        """INSERT INTO users (username, password_hash, role, student_id, office_id)
           VALUES (?, ?, ?, ?, ?)""",
        (
            username,
            hash_password(password),
            role,
            student["id"] if student else None,
            office["id"] if office else None,
        ),
    )
    commit()
    return user_id


def validate_runtime_secrets() -> None:
    missing = [
        key
        for key in ("SECRET_KEY", "HMAC_SECRET", "SLIP_SIGNING_KEY")
        if not app.config[key]
        or "replace-with" in app.config[key]
        or len(app.config[key]) < 32
    ]
    if missing:
        names = {
            "SECRET_KEY": "FLASK_SECRET_KEY",
            "HMAC_SECRET": "HUB_HMAC_SECRET",
            "SLIP_SIGNING_KEY": "HUB_SLIP_SIGNING_KEY",
        }
        raise RuntimeError(
            "Set distinct random secrets of at least 32 characters in .env: "
            + ", ".join(names[key] for key in missing)
        )
    secret_values = [app.config[key] for key in ("SECRET_KEY", "HMAC_SECRET", "SLIP_SIGNING_KEY")]
    if len(set(secret_values)) != len(secret_values):
        raise RuntimeError("FLASK_SECRET_KEY, HUB_HMAC_SECRET, and HUB_SLIP_SIGNING_KEY must differ.")


if __name__ == "__main__":
    validate_runtime_secrets()
    cert = os.getenv("HUB_SSL_CERT", "").strip()
    key = os.getenv("HUB_SSL_KEY", "").strip()
    ssl_context = None
    if cert or key:
        if not cert or not key:
            raise RuntimeError("HUB_SSL_CERT and HUB_SSL_KEY must both be configured.")
        if not Path(cert).is_file() or not Path(key).is_file():
            raise RuntimeError("Configured HTTPS certificate or key file does not exist.")
        ssl_context = (cert, key)
    app.run(
        host=os.getenv("HUB_HOST", "127.0.0.1"),
        port=int(os.getenv("HUB_PORT", "8000")),
        debug=os.getenv("HUB_DEBUG", "false").lower() == "true",
        ssl_context=ssl_context,
    )
