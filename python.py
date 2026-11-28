"""Command-line entry point for the Python e-Clearance Hub."""

from __future__ import annotations

import argparse
import getpass
import json
import logging
import os
import re
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

from hub import (
    app,
    commit,
    create_user,
    query_one,
    upsert_clearance,
    upsert_student,
    validate_runtime_secrets,
)


def _configure_logging() -> None:
    log_folder = Path(app.config["LOG_FOLDER"])
    log_folder.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        filename=log_folder / "imports.log",
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        encoding="utf-8",
    )


def _init_db() -> None:
    database_path = Path(app.config["DB_PATH"])
    if not database_path.is_absolute():
        database_path = Path(__file__).resolve().parent / database_path
    if database_path.exists():
        raise FileExistsError(
            "Refusing to overwrite an existing SQLite database: " + str(database_path)
        )
    schema_path = Path(__file__).resolve().parent / "database" / "schema.sqlite.sql"
    if not schema_path.is_file():
        raise FileNotFoundError("SQLite schema file was not found: " + str(schema_path))

    database_path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=database_path.stem + ".init-",
        suffix=".sqlite3",
        dir=database_path.parent,
    )
    os.close(descriptor)
    temporary_path = Path(temporary_name)
    connection: sqlite3.Connection | None = None
    try:
        connection = sqlite3.connect(str(temporary_path))
        connection.execute("PRAGMA foreign_keys = ON")
        connection.executescript(schema_path.read_text(encoding="utf-8"))
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        foreign_key_violations = connection.execute("PRAGMA foreign_key_check").fetchall()
        if integrity != "ok" or foreign_key_violations:
            raise RuntimeError("New SQLite database failed its integrity checks.")
        connection.close()
        connection = None
        temporary_path.rename(database_path)
    except Exception:
        if connection is not None:
            connection.close()
        temporary_path.unlink(missing_ok=True)
        raise
    print("Initialized SQLite database at " + str(database_path))


def _tls_context() -> tuple[str, str] | None:
    cert = os.getenv("HUB_SSL_CERT", "").strip()
    key = os.getenv("HUB_SSL_KEY", "").strip()
    if not cert and not key:
        return None
    if not cert or not key:
        raise ValueError("HUB_SSL_CERT and HUB_SSL_KEY must both be configured.")
    if not Path(cert).is_file() or not Path(key).is_file():
        raise ValueError("Configured HTTPS certificate or key file does not exist.")
    return cert, key


def _seed_demo() -> None:
    password = os.getenv("DEMO_PASSWORD", "")
    if len(password) < 12:
        raise ValueError("Set DEMO_PASSWORD in .env to a local-only password of at least 12 characters.")
    from hub import _find_office, _find_student

    demo_students = [
        {
            "student_number": "DEMO-0001",
            "full_name": "Alex Rivera",
            "program": "BSIT",
            "year_level": 3,
            "email": "alex.rivera@example.invalid",
            "active": 1,
        },
        {
            "student_number": "DEMO-0002",
            "full_name": "Jamie Santos",
            "program": "BSIT",
            "year_level": 2,
            "email": "jamie.santos@example.invalid",
            "active": 1,
        },
        {
            "student_number": "DEMO-0003",
            "full_name": "Taylor Cruz",
            "program": "BSCS",
            "year_level": 1,
            "email": "taylor.cruz@example.invalid",
            "active": 1,
        },
    ]
    for student in demo_students:
        upsert_student(student)
    statuses = {
        "DEMO-0001": {
            "registrar": ("CLEARED", "Active in Registrar masterlist."),
            "library": ("CLEARED", "No outstanding books or fines."),
            "accounting": ("CLEARED", "No outstanding balance."),
            "student-affairs": ("CLEARED", "No outstanding equipment."),
        },
        "DEMO-0002": {
            "registrar": ("CLEARED", "Active in Registrar masterlist."),
            "library": ("HOLD", "Two unreturned books."),
            "accounting": ("CLEARED", "No outstanding balance."),
            "student-affairs": ("CLEARED", "No outstanding equipment."),
        },
        "DEMO-0003": {
            "registrar": ("CLEARED", "Active in Registrar masterlist."),
            "library": ("CLEARED", "No outstanding books or fines."),
            "accounting": ("HOLD", "Outstanding balance of PHP 500.00."),
            "student-affairs": ("CLEARED", "No outstanding equipment."),
        },
    }
    for student_number, offices in statuses.items():
        student = _find_student(student_number)
        if student is None:
            raise RuntimeError("Demo student was not inserted: " + student_number)
        for office_code, (status, reason) in offices.items():
            office = _find_office(office_code)
            if office is None:
                raise RuntimeError("Initialize the SQLite database before seeding demo data.")
            upsert_clearance(
                student["id"], office["id"], status, reason, "demo-seed", None
            )
    commit()

    demo_users = [
        ("demo.student", "student", "DEMO-0001", None),
        ("demo.library", "staff", None, "library"),
        ("demo.admin", "admin", None, None),
    ]
    for username, role, student_number, office in demo_users:
        if query_one("SELECT id FROM users WHERE username = ?", (username,)) is None:
            create_user(username, password, role, student_number, office)
    print("Synthetic demo records and accounts are ready.")
    print("Sign in as demo.student, demo.library, or demo.admin using DEMO_PASSWORD.")


def _create_user(args: argparse.Namespace) -> None:
    password = getpass.getpass("New password (12+ characters): ")
    confirmation = getpass.getpass("Confirm password: ")
    if password != confirmation:
        raise ValueError("Passwords do not match.")
    user_id = create_user(
        args.username,
        password,
        args.role,
        args.student_number,
        args.office,
    )
    print("Created {} account with id {}.".format(args.role, user_id))


def _sign_manifest(file_name: str, source: str) -> Path:
    from importer import create_manifest

    path = Path(file_name).resolve()
    payload = path.read_bytes()
    manifest = create_manifest(path.name, source, payload, app.config["HMAC_SECRET"])
    sidecar = path.with_name(path.name + ".manifest.json")
    sidecar.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return sidecar


def _sync_registrar() -> int:
    from hub import _find_office, _find_student
    from integration_clients import fetch_registrar_students

    base_url = app.config["REGISTRAR_API_URL"]
    api_key = app.config["REGISTRAR_API_KEY"]
    if not base_url or not api_key or "replace-with" in api_key:
        raise ValueError("Configure REGISTRAR_API_URL and REGISTRAR_API_KEY in .env.")
    students = fetch_registrar_students(base_url, api_key)
    office = _find_office("registrar")
    if office is None:
        raise RuntimeError("Registrar office is missing; initialize the SQLite database.")
    for student in students:
        upsert_student(student)
        saved = _find_student(student["student_number"])
        if saved is not None:
            status = "CLEARED" if student["active"] else "HOLD"
            reason = (
                "Active in Registrar masterlist."
                if student["active"]
                else "Inactive or on leave in Registrar masterlist."
            )
            upsert_clearance(
                saved["id"], office["id"], status, reason, "registrar", None
            )
    commit()
    return len(students)


def _install_schedule(args: argparse.Namespace) -> None:
    if os.name != "nt":
        raise RuntimeError("Scheduled task installation is available only on Windows.")

    tasks = (
        ("Registrar sync", "sync-registrar", args.registrar_time),
        ("Signed imports", "run-imports", args.import_time),
        ("Daily HOLD summary", "hold-summary", args.summary_time),
    )
    scheduled_minutes = []
    for _, _, start_time in tasks:
        if not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", start_time):
            raise ValueError("Scheduled task times must use 24-hour HH:MM format.")
        hours, minutes = (int(part) for part in start_time.split(":"))
        scheduled_minutes.append(hours * 60 + minutes)
    if scheduled_minutes != sorted(set(scheduled_minutes)):
        raise ValueError("Task times must be strictly increasing: Registrar, imports, then summary.")

    script_path = Path(__file__).resolve()
    for label, command, start_time in tasks:
        action = subprocess.list2cmdline(
            [sys.executable, str(script_path), command]
        )
        result = subprocess.run(
            [
                "schtasks.exe",
                "/Create",
                "/SC",
                "DAILY",
                "/ST",
                start_time,
                "/TN",
                "DNSC e-Clearance Hub - " + label,
                "/TR",
                action,
                "/F",
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        print(result.stdout.strip())


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="DNSC e-Clearance Hub")
    commands = parser.add_subparsers(dest="command")
    commands.add_parser("serve", help="start the Hub website and REST API")
    commands.add_parser("init-db", help="create a new SQLite database without overwriting an existing one")
    create = commands.add_parser("create-user", help="create a role-bound account")
    create.add_argument("--username", required=True)
    create.add_argument("--role", required=True, choices=["student", "staff", "admin"])
    create.add_argument("--student-number")
    create.add_argument("--office")
    sign = commands.add_parser("sign-manifest", help="create an HMAC manifest for an import file")
    sign.add_argument("file")
    sign.add_argument("--source", required=True, choices=["library", "accounting"])
    commands.add_parser("run-imports", help="process signed files in the drop folder")
    commands.add_parser("hold-summary", help="write the daily office HOLD summary")
    commands.add_parser("sync-registrar", help="synchronize the Registrar masterlist")
    commands.add_parser("seed-demo", help="create fictional local demo records")
    schedule = commands.add_parser(
        "install-schedule", help="register daily Windows tasks for sync, imports, and HOLD summary"
    )
    schedule.add_argument("--registrar-time", default="01:00")
    schedule.add_argument("--import-time", default="02:00")
    schedule.add_argument("--summary-time", default="02:15")
    return parser


def main(argv: list[str] | None = None) -> int:
    _configure_logging()
    args = _parser().parse_args(argv)
    command = args.command or "serve"
    if command == "serve":
        validate_runtime_secrets()
        app.run(
            host=os.getenv("HUB_HOST", "127.0.0.1"),
            port=int(os.getenv("HUB_PORT", "8000")),
            debug=os.getenv("HUB_DEBUG", "false").lower() == "true",
            ssl_context=_tls_context(),
        )
        return 0
    if command == "install-schedule":
        _install_schedule(args)
        return 0
    if command == "init-db":
        _init_db()
        return 0
    with app.app_context():
        if command == "create-user":
            if args.role == "student" and not args.student_number:
                raise ValueError("--student-number is required for student accounts.")
            if args.role == "staff" and not args.office:
                raise ValueError("--office is required for staff accounts.")
            _create_user(args)
        elif command == "sign-manifest":
            if len(app.config["HMAC_SECRET"]) < 32:
                raise ValueError("Configure HUB_HMAC_SECRET with at least 32 characters.")
            print("Created " + str(_sign_manifest(args.file, args.source)))
        elif command == "run-imports":
            from importer import run_drop_folder

            print(json.dumps(run_drop_folder(), indent=2))
        elif command == "hold-summary":
            from importer import write_hold_summary

            print("Created " + str(write_hold_summary()))
        elif command == "sync-registrar":
            print("Synchronized {} Registrar records.".format(_sync_registrar()))
        elif command == "seed-demo":
            _seed_demo()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())