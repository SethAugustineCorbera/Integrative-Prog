from __future__ import annotations

import csv
import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from xml.etree import ElementTree

import hub
import python as hub_cli
from importer import (
    _map_record,
    _xml_records,
    create_manifest,
    process_bytes,
    process_path,
    verify_manifest,
    write_hold_summary,
)
from integration_clients import IntegrationError, fetch_public_holidays, fetch_registrar_students


PASSWORD = "LocalTestPassword123!"
TEST_HMAC = "test-hmac-secret-that-is-long-enough-123456"
TEST_SLIP = "test-slip-secret-that-is-long-enough-123456"
TEST_PASSWORD_HASH = hub.hash_password(PASSWORD)
REAL_GET_DB = hub.get_db


SQLITE_SCHEMA = (
    Path(__file__).resolve().parents[1]
    .joinpath("database", "schema.sqlite.sql")
    .read_text(encoding="utf-8")
)


class HubTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "hub-test.sqlite3"
        self.connection = sqlite3.connect(self.db_path)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA foreign_keys = ON")
        self.connection.executescript(SQLITE_SCHEMA)
        self.assertEqual(
            self.connection.execute("PRAGMA foreign_keys").fetchone()[0], 1
        )
        hub.app.config.update(
            TESTING=True,
            DB_PATH=str(self.db_path),
            HMAC_SECRET=TEST_HMAC,
            SLIP_SIGNING_KEY=TEST_SLIP,
            SECRET_KEY="test-flask-secret-123456789012345678901234",
            CLEARANCE_WORKING_DAYS=2,
            HOLIDAYS_COUNTRY="PH",
            FRONTEND_ORIGINS=["http://localhost"],
            REGISTRAR_API_URL="",
            REGISTRAR_API_KEY="",
            DROP_FOLDER=str(Path(self.temp_dir.name) / "drop"),
            ARCHIVE_FOLDER=str(Path(self.temp_dir.name) / "archive"),
            REPORT_FOLDER=str(Path(self.temp_dir.name) / "reports"),
        )
        self.db_patcher = patch.object(hub, "get_db", return_value=self.connection)
        self.db_patcher.start()
        self.client = hub.app.test_client()
        with hub.app.app_context():
            hub.upsert_student(
                {
                    "student_number": "2023-0001-14",
                    "full_name": "Alex Rivera",
                    "program": "BSIT",
                    "year_level": 3,
                    "email": "alex@example.invalid",
                    "active": 1,
                }
            )
            hub.upsert_student(
                {
                    "student_number": "2023-0002-14",
                    "full_name": "Jamie Santos",
                    "program": "BSIT",
                    "year_level": 2,
                    "email": "jamie@example.invalid",
                    "active": 1,
                }
            )
            student = hub.query_one(
                "SELECT id FROM students WHERE student_number = ?", ("2023-0001-14",)
            )
            held_student = hub.query_one(
                "SELECT id FROM students WHERE student_number = ?", ("2023-0002-14",)
            )
            offices = hub.query_all("SELECT id, code FROM offices")
            for office in offices:
                hub.upsert_clearance(
                    student["id"], office["id"], "CLEARED", "Verified.", "test", None
                )
                status = "HOLD" if office["code"] == "library" else "CLEARED"
                hub.upsert_clearance(
                    held_student["id"], office["id"], status, "Test record.", "test", None
                )
            hub.commit()

    def tearDown(self) -> None:
        self.db_patcher.stop()
        self.connection.close()
        self.temp_dir.cleanup()

    def login(self, username: str = "test.student") -> str:
        response = self.client.post(
            "/api/auth/login",
            json={"username": username, "password": PASSWORD},
        )
        self.assertEqual(response.status_code, 200)
        return response.get_json()["token"]


class SqliteConnectionTests(HubTestCase):
    def test_get_db_enables_foreign_keys_for_each_connection(self) -> None:
        with hub.app.app_context():
            connection = REAL_GET_DB()
            self.assertEqual(
                connection.execute("PRAGMA foreign_keys").fetchone()[0], 1
            )
            with self.assertRaises(sqlite3.IntegrityError):
                connection.execute(
                    "INSERT INTO auth_sessions (token_hash, user_id, expires_at) "
                    "VALUES (?, ?, ?)",
                    ("a" * 64, -1, "2099-01-01 00:00:00"),
                )

    def test_auth_session_token_hash_cannot_be_null(self) -> None:
        cursor = self.connection.execute(
            "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
            ("schema.test", TEST_PASSWORD_HASH, "admin"),
        )
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                "INSERT INTO auth_sessions (token_hash, user_id, expires_at) "
                "VALUES (NULL, ?, ?)",
                (cursor.lastrowid, "2099-01-01 00:00:00"),
            )

    def test_case_insensitive_office_uniqueness_is_preserved(self) -> None:
        with self.assertRaises(sqlite3.IntegrityError):
            self.connection.execute(
                "INSERT INTO offices (code, name) VALUES (?, ?)",
                ("REGISTRAR", "Duplicate code test"),
            )

    def test_student_and_clearance_updates_refresh_timestamps(self) -> None:
        sentinel = "2000-01-01 00:00:00"
        student = self.connection.execute(
            "SELECT id FROM students ORDER BY id LIMIT 1"
        ).fetchone()
        clearance = self.connection.execute(
            "SELECT id FROM clearance_records ORDER BY id LIMIT 1"
        ).fetchone()
        self.connection.execute(
            "UPDATE students SET updated_at = ? WHERE id = ?",
            (sentinel, student["id"]),
        )
        self.connection.execute(
            "UPDATE students SET full_name = full_name || ' ' WHERE id = ?",
            (student["id"],),
        )
        self.assertNotEqual(
            self.connection.execute(
                "SELECT updated_at FROM students WHERE id = ?", (student["id"],)
            ).fetchone()[0],
            sentinel,
        )
        self.connection.execute(
            "UPDATE clearance_records SET updated_at = ? WHERE id = ?",
            (sentinel, clearance["id"]),
        )
        self.connection.execute(
            "UPDATE clearance_records SET reason = reason || ' ' WHERE id = ?",
            (clearance["id"],),
        )
        self.assertNotEqual(
            self.connection.execute(
                "SELECT updated_at FROM clearance_records WHERE id = ?",
                (clearance["id"],),
            ).fetchone()[0],
            sentinel,
        )


class PasswordTests(HubTestCase):
    def test_hash_verifies_correct_password(self) -> None:
        stored = hub.hash_password(PASSWORD)
        self.assertTrue(hub.verify_password(PASSWORD, stored))

    def test_password_hashes_use_independent_salts(self) -> None:
        self.assertNotEqual(hub.hash_password(PASSWORD), hub.hash_password(PASSWORD))

    def test_wrong_password_is_rejected(self) -> None:
        self.assertFalse(hub.verify_password("not-the-password", hub.hash_password(PASSWORD)))

    def test_malformed_password_hash_is_rejected(self) -> None:
        self.assertFalse(hub.verify_password(PASSWORD, "bad$hash"))


class DeploymentTlsTests(unittest.TestCase):
    def test_tls_is_disabled_when_certificates_are_not_configured(self) -> None:
        with patch.dict(os.environ, {"HUB_SSL_CERT": "", "HUB_SSL_KEY": ""}, clear=False):
            self.assertIsNone(hub_cli._tls_context())

    def test_tls_accepts_existing_certificate_and_key(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            cert = Path(directory) / "server.crt"
            key = Path(directory) / "server.key"
            cert.write_text("test", encoding="utf-8")
            key.write_text("test", encoding="utf-8")
            with patch.dict(
                os.environ,
                {"HUB_SSL_CERT": str(cert), "HUB_SSL_KEY": str(key)},
                clear=False,
            ):
                self.assertEqual(hub_cli._tls_context(), (str(cert), str(key)))

    def test_tls_requires_both_certificate_and_key(self) -> None:
        with patch.dict(os.environ, {"HUB_SSL_CERT": "server.crt", "HUB_SSL_KEY": ""}, clear=False):
            with self.assertRaisesRegex(ValueError, "must both be configured"):
                hub_cli._tls_context()

    def test_tls_rejects_missing_certificate_files(self) -> None:
        with patch.dict(
            os.environ,
            {"HUB_SSL_CERT": "missing.crt", "HUB_SSL_KEY": "missing.key"},
            clear=False,
        ):
            with self.assertRaisesRegex(ValueError, "does not exist"):
                hub_cli._tls_context()


class ScheduleTests(unittest.TestCase):
    def test_schedule_installer_registers_daily_jobs_in_order(self) -> None:
        args = SimpleNamespace(
            registrar_time="01:00",
            import_time="02:00",
            summary_time="02:15",
        )
        with patch(
            "python.subprocess.run",
            return_value=SimpleNamespace(stdout="SUCCESS"),
        ) as run:
            hub_cli._install_schedule(args)
        self.assertEqual(run.call_count, 3)
        commands = [call.args[0] for call in run.call_args_list]
        self.assertEqual([command[5] for command in commands], ["01:00", "02:00", "02:15"])
        self.assertTrue(all(command[1:4] == ["/Create", "/SC", "DAILY"] for command in commands))
        self.assertIn("sync-registrar", commands[0][-2])
        self.assertIn("run-imports", commands[1][-2])
        self.assertIn("hold-summary", commands[2][-2])

    def test_schedule_installer_rejects_invalid_time_before_creating_tasks(self) -> None:
        args = SimpleNamespace(
            registrar_time="25:00",
            import_time="02:00",
            summary_time="02:15",
        )
        with patch("python.subprocess.run") as run:
            with self.assertRaisesRegex(ValueError, "HH:MM"):
                hub_cli._install_schedule(args)
        run.assert_not_called()


class ManifestTests(HubTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.file_bytes = b"<library><borrower/></library>"
        self.manifest = create_manifest(
            "library.xml", "library", self.file_bytes, TEST_HMAC
        )

    def test_valid_signed_manifest_passes(self) -> None:
        self.assertIsNone(
            verify_manifest(self.manifest, "library.xml", self.file_bytes, TEST_HMAC)
        )

    def test_changed_source_file_fails_digest_check(self) -> None:
        error = verify_manifest(
            self.manifest, "library.xml", self.file_bytes + b"x", TEST_HMAC
        )
        self.assertEqual(error, "File digest does not match the signed manifest.")

    def test_changed_manifest_field_fails_signature_check(self) -> None:
        changed = dict(self.manifest, source="accounting")
        self.assertIn("Source does not match", verify_manifest(
            changed, "library.xml", self.file_bytes, TEST_HMAC
        ))

    def test_missing_manifest_field_is_rejected(self) -> None:
        changed = dict(self.manifest)
        changed.pop("nonce")
        self.assertEqual(
            verify_manifest(changed, "library.xml", self.file_bytes, TEST_HMAC),
            "Manifest is missing a required field.",
        )

    def test_invalid_source_type_is_rejected(self) -> None:
        changed = dict(self.manifest, source=["library"])
        self.assertIn("source must be", verify_manifest(
            changed, "library.xml", self.file_bytes, TEST_HMAC
        ))

    def test_wrong_extension_is_rejected(self) -> None:
        changed = create_manifest("library.csv", "library", self.file_bytes, TEST_HMAC)
        self.assertEqual(
            verify_manifest(changed, "library.csv", self.file_bytes, TEST_HMAC),
            "Source does not match the file format.",
        )

    def test_stale_manifest_is_rejected(self) -> None:
        from datetime import datetime, timedelta, timezone

        changed = dict(self.manifest)
        changed["generated_at"] = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
        self.assertIn("24-hour", verify_manifest(
            changed, "library.xml", self.file_bytes, TEST_HMAC
        ))


class MappingTests(HubTestCase):
    def test_import_operational_error_leaves_source_and_manifest_in_drop_folder(self) -> None:
        drop = Path(self.temp_dir.name) / "drop"
        drop.mkdir()
        source = drop / "library.xml"
        manifest = drop / "library.xml.manifest.json"
        source.write_bytes(b"<library/>")
        manifest.write_bytes(b"{}")
        original_secret = hub.app.config["HMAC_SECRET"]
        hub.app.config["HMAC_SECRET"] = ""
        try:
            with hub.app.app_context():
                with self.assertRaisesRegex(RuntimeError, "HUB_HMAC_SECRET"):
                    process_path(source)
        finally:
            hub.app.config["HMAC_SECRET"] = original_secret
        self.assertTrue(source.exists())
        self.assertTrue(manifest.exists())

    def test_library_xml_records_are_extracted(self) -> None:
        records = _xml_records(
            b"<export><borrower><student_id>2023-0001-14</student_id>"
            b"<unreturned_books>2</unreturned_books><fine>0</fine></borrower></export>"
        )
        self.assertEqual(records[0]["student_number"], "2023-0001-14")
        self.assertEqual(records[0]["book_count"], "2")

    def test_malformed_library_xml_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "malformed"):
            _xml_records(b"<library>")

    def test_library_issues_map_to_hold(self) -> None:
        record = _map_record(
            "library",
            {"student_number": "2023-0001-14", "book_count": "2", "fine": "12.50"},
            1,
        )
        self.assertEqual(record["status"], "HOLD")
        self.assertIn("unreturned book", record["reason"])

    def test_zero_library_issues_map_to_cleared(self) -> None:
        record = _map_record(
            "library",
            {"student_number": "2023-0001-14", "book_count": "0", "fine": "0"},
            1,
        )
        self.assertEqual(record["status"], "CLEARED")

    def test_accounting_thousands_separator_is_parsed(self) -> None:
        record = _map_record(
            "accounting",
            {"student_number": "2023-0001-14", "balance": "PHP 1,250.00"},
            2,
        )
        self.assertEqual(record["status"], "HOLD")
        self.assertIn("1,250.00", record["reason"])

    def test_negative_accounting_balance_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "non-negative"):
            _map_record(
                "accounting",
                {"student_number": "2023-0001-14", "balance": "-1"},
                2,
            )

    def test_import_applies_valid_rows_and_records_unknown_student(self) -> None:
        payload = (
            b"student_id,balance\n"
            b"2023-0001-14,0\n"
            b"2023-9999-99,25.00\n"
        )
        manifest = create_manifest("balances.csv", "accounting", payload, TEST_HMAC)
        with hub.app.app_context():
            result = process_bytes(
                "balances.csv", payload, json.dumps(manifest).encode("utf-8")
            )
        self.assertEqual(result["status"], "PARTIAL")
        self.assertEqual((result["imported"], result["rejected"]), (1, 1))

    def test_import_replay_nonce_is_rejected(self) -> None:
        payload = b"student_id,balance\n2023-0001-14,0\n"
        manifest = create_manifest("balances.csv", "accounting", payload, TEST_HMAC)
        manifest_bytes = json.dumps(manifest).encode("utf-8")
        with hub.app.app_context():
            first = process_bytes("balances.csv", payload, manifest_bytes)
            replay = process_bytes("balances.csv", payload, manifest_bytes)
        self.assertEqual(first["status"], "COMPLETED")
        self.assertEqual(replay["status"], "REJECTED")
        self.assertIn("already been processed", replay["message"])

    def test_tampered_import_file_is_rejected_before_mapping(self) -> None:
        payload = b"student_id,balance\n2023-0001-14,0\n"
        manifest = create_manifest("balances.csv", "accounting", payload, TEST_HMAC)
        with hub.app.app_context():
            result = process_bytes(
                "balances.csv", payload + b"2023-0002-14,0\n",
                json.dumps(manifest).encode("utf-8"),
            )
        self.assertEqual(result["status"], "REJECTED")
        self.assertFalse(result["manifest_verified"])


class IntegrationClientTests(HubTestCase):
    @patch("integration_clients._get_json")
    def test_registrar_json_maps_student_aliases(self, get_json: Any) -> None:
        get_json.return_value = {
            "students": [
                {"id": "2023-0001-14", "name": "Alex Rivera", "program": "BSIT", "year": 3}
            ]
        }
        students = fetch_registrar_students("http://mock.test", "demo-key")
        self.assertEqual(students[0]["student_number"], "2023-0001-14")
        self.assertEqual(students[0]["year_level"], 3)

    @patch("integration_clients._get_json")
    def test_registrar_bad_json_shape_is_reported(self, get_json: Any) -> None:
        get_json.return_value = {"results": []}
        with self.assertRaisesRegex(IntegrationError, "students array"):
            fetch_registrar_students("http://mock.test", "demo-key")

    @patch("integration_clients._get_json")
    def test_registrar_bad_student_field_is_reported(self, get_json: Any) -> None:
        get_json.return_value = {"students": [{"name": "No ID"}]}
        with self.assertRaisesRegex(IntegrationError, "invalid required fields"):
            fetch_registrar_students("http://mock.test", "demo-key")

    @patch("integration_clients._get_json")
    def test_starter_kit_registrar_fields_are_mapped(self, get_json: Any) -> None:
        get_json.return_value = {
            "page": 1,
            "size": 20,
            "total": 1,
            "has_next": False,
            "data": [
                {
                    "student_id": "2024-12345",
                    "first_name": "Ari",
                    "middle_initial": "M",
                    "last_name": "Santos",
                    "program_code": "BSIT",
                    "program_name": "Bachelor of Science in Information Technology",
                    "year_level": 2,
                    "email": "ari@example.invalid",
                    "status": "ENROLLED",
                }
            ],
        }
        students = fetch_registrar_students("http://mock.test/api/v1", "demo-key")
        self.assertEqual(len(students), 1)
        self.assertEqual(students[0]["student_number"], "2024-12345")
        self.assertEqual(students[0]["full_name"], "Ari M. Santos")
        self.assertEqual(students[0]["program"], "BSIT")
        self.assertEqual(students[0]["active"], 1)
        self.assertIn("size=20", get_json.call_args.args[0])

    @patch("integration_clients._get_json")
    def test_starter_kit_has_next_metadata_is_followed(self, get_json: Any) -> None:
        first_page = {
            "data": [
                {
                    "student_id": "2024-12345",
                    "first_name": "Ari",
                    "last_name": "Santos",
                    "program_code": "BSIT",
                    "year_level": 2,
                    "status": "ENROLLED",
                }
            ],
            "has_next": True,
        }
        second_page = {
            "data": [
                {
                    "student_id": "2025-54321",
                    "first_name": "Bo",
                    "last_name": "Cruz",
                    "program_code": "BSCS",
                    "year_level": 1,
                    "status": "LOA",
                }
            ],
            "has_next": False,
        }
        get_json.side_effect = [first_page, second_page]
        students = fetch_registrar_students("http://mock.test/api/v1", "demo-key")
        self.assertEqual(
            [student["student_number"] for student in students],
            ["2024-12345", "2025-54321"],
        )
        self.assertEqual(students[1]["active"], 0)
        self.assertIn("page=2", get_json.call_args_list[1].args[0])

    @patch("integration_clients._get_json")
    def test_registrar_next_page_metadata_is_followed(self, get_json: Any) -> None:
        get_json.side_effect = [
            {
                "students": [
                    {
                        "student_number": "2023-0001-14",
                        "full_name": "Alex Rivera",
                        "program": "BSIT",
                        "year_level": 3,
                    }
                ],
                "next_page": 3,
            },
            {
                "students": [
                    {
                        "student_number": "2023-0002-14",
                        "full_name": "Sam Lee",
                        "program": "BSIT",
                        "year_level": 2,
                    }
                ],
                "has_more": False,
            },
        ]
        students = fetch_registrar_students("http://mock.test", "demo-key")
        self.assertEqual(
            [student["student_number"] for student in students],
            ["2023-0001-14", "2023-0002-14"],
        )
        self.assertIn("page=3", get_json.call_args_list[1].args[0])

    def test_holiday_query_rejects_invalid_country(self) -> None:
        with self.assertRaises(IntegrationError):
            fetch_public_holidays(2026, "P1")


class ApiTests(HubTestCase):
    def setUp(self) -> None:
        super().setUp()
        with hub.app.app_context():
            student = hub.query_one(
                "SELECT id FROM students WHERE student_number = ?", ("2023-0001-14",)
            )
            held_student = hub.query_one(
                "SELECT id FROM students WHERE student_number = ?", ("2023-0002-14",)
            )
            library = hub.query_one(
                "SELECT id FROM offices WHERE code = ?", ("library",)
            )
            hub.execute(
                "INSERT INTO users (username, password_hash, role, student_id) VALUES (?, ?, ?, ?)",
                ("test.student", TEST_PASSWORD_HASH, "student", student["id"]),
            )
            hub.execute(
                "INSERT INTO users (username, password_hash, role, student_id) VALUES (?, ?, ?, ?)",
                ("held.student", TEST_PASSWORD_HASH, "student", held_student["id"]),
            )
            hub.execute(
                "INSERT INTO users (username, password_hash, role, office_id) VALUES (?, ?, ?, ?)",
                ("test.library", TEST_PASSWORD_HASH, "staff", library["id"]),
            )
            registrar = hub.query_one(
                "SELECT id FROM offices WHERE code = ?", ("registrar",)
            )
            if registrar is not None:
                hub.execute(
                    "INSERT INTO users (username, password_hash, role, office_id) VALUES (?, ?, ?, ?)",
                    ("test.registrar", TEST_PASSWORD_HASH, "staff", registrar["id"]),
                )
            hub.execute(
                "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
                ("test.admin", TEST_PASSWORD_HASH, "admin"),
            )
            hub.commit()

    def test_health_endpoint_checks_database(self) -> None:
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["database"], "connected")

    def test_protected_route_rejects_missing_token(self) -> None:
        self.assertEqual(self.client.get("/api/students/me/clearance").status_code, 401)

    def test_login_rejects_unknown_credentials(self) -> None:
        response = self.client.post(
            "/api/auth/login", json={"username": "missing", "password": PASSWORD}
        )
        self.assertEqual(response.status_code, 401)

    def test_login_rejects_sql_injection_username(self) -> None:
        response = self.client.post(
            "/api/auth/login",
            json={"username": "' OR 1=1 --", "password": PASSWORD},
        )
        self.assertEqual(response.status_code, 401)
        self.assertNotIn("token", response.get_json())

    def test_login_rejects_unknown_fields(self) -> None:
        response = self.client.post(
            "/api/auth/login",
            json={"username": "test.student", "password": PASSWORD, "role": "admin"},
        )
        self.assertEqual(response.status_code, 400)

    def test_student_registration_creates_account_that_can_log_in(self) -> None:
        with hub.app.app_context():
            hub.upsert_student(
                {
                    "student_number": "2023-0003-14",
                    "full_name": "Taylor Cruz",
                    "program": "BSIT",
                    "year_level": 1,
                    "active": 1,
                }
            )
            hub.commit()
        registration = self.client.post(
            "/api/auth/register",
            json={
                "username": "taylor.cruz",
                "password": "NewStudentPassword123!",
                "student_number": "2023-0003-14",
                "full_name": "  Taylor   Cruz ",
            },
        )
        self.assertEqual(registration.status_code, 201)
        login = self.client.post(
            "/api/auth/login",
            json={"username": "taylor.cruz", "password": "NewStudentPassword123!"},
        )
        self.assertEqual(login.status_code, 200)
        self.assertEqual(login.get_json()["user"]["role"], "student")
        duplicate = self.client.post(
            "/api/auth/register",
            json={
                "username": "taylor.new",
                "password": "AnotherStudentPassword123!",
                "student_number": "2023-0003-14",
                "full_name": "Taylor Cruz",
            },
        )
        self.assertEqual(duplicate.status_code, 409)

    def test_student_registration_rejects_mismatched_student_details(self) -> None:
        response = self.client.post(
            "/api/auth/register",
            json={
                "username": "not.a.student",
                "password": "NewStudentPassword123!",
                "student_number": "2023-0001-14",
                "full_name": "Incorrect Name",
            },
        )
        self.assertEqual(response.status_code, 400)

    def test_student_registration_explains_when_roster_is_empty(self) -> None:
        with hub.app.app_context():
            hub.execute("UPDATE students SET active = 0")
            hub.commit()
        response = self.client.post(
            "/api/auth/register",
            json={
                "username": "new.student",
                "password": "NewStudentPassword123!",
                "student_number": "2023-0001-14",
                "full_name": "Alex Rivera",
            },
        )
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.get_json()["code"], "student_roster_empty")
        self.assertIn("valid Registrar API key", response.get_json()["error"])

    def test_student_registration_explains_when_configured_roster_is_empty(self) -> None:
        hub.app.config.update(
            REGISTRAR_API_URL="http://registrar.test/api",
            REGISTRAR_API_KEY="test-registrar-key",
        )
        with hub.app.app_context():
            hub.execute("UPDATE students SET active = 0")
            hub.commit()
        response = self.client.post(
            "/api/auth/register",
            json={
                "username": "new.student",
                "password": "NewStudentPassword123!",
                "student_number": "2023-0001-14",
                "full_name": "Alex Rivera",
            },
        )
        self.assertEqual(response.status_code, 503)
        self.assertIn("sync the Registrar masterlist", response.get_json()["error"])

    def test_student_registration_cannot_choose_staff_or_admin_role(self) -> None:
        response = self.client.post(
            "/api/auth/register",
            json={
                "username": "new.admin",
                "password": "NewStudentPassword123!",
                "student_number": "2023-0001-14",
                "full_name": "Alex Rivera",
                "role": "admin",
            },
        )
        self.assertEqual(response.status_code, 400)

    def test_student_registration_requires_a_strong_password(self) -> None:
        response = self.client.post(
            "/api/auth/register",
            json={
                "username": "new.student",
                "password": "short",
                "student_number": "2023-0001-14",
                "full_name": "Alex Rivera",
            },
        )
        self.assertEqual(response.status_code, 400)

    def test_student_gets_only_linked_clearance(self) -> None:
        token = self.login()
        response = self.client.get(
            "/api/students/me/clearance",
            headers={"Authorization": "Bearer " + token},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["overall"], "CLEARED")

    def test_student_cannot_read_office_queue(self) -> None:
        token = self.login()
        response = self.client.get(
            "/api/offices/library/students",
            headers={"Authorization": "Bearer " + token},
        )
        self.assertEqual(response.status_code, 403)

    def test_staff_reads_assigned_office_queue(self) -> None:
        token = self.login("test.library")
        response = self.client.get(
            "/api/offices/library/students",
            headers={"Authorization": "Bearer " + token},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["office"]["code"], "library")

    def test_staff_cannot_read_another_office(self) -> None:
        token = self.login("test.library")
        response = self.client.get(
            "/api/offices/accounting/students",
            headers={"Authorization": "Bearer " + token},
        )
        self.assertEqual(response.status_code, 403)

    def test_invalid_office_status_query_is_rejected(self) -> None:
        token = self.login("test.library")
        response = self.client.get(
            "/api/offices/library/students?status=WAITING",
            headers={"Authorization": "Bearer " + token},
        )
        self.assertEqual(response.status_code, 400)

    def test_staff_signoff_updates_record_and_audit(self) -> None:
        token = self.login("test.library")
        response = self.client.post(
            "/api/clearance/2023-0002-14/library/signoff",
            json={"reason": "Returned all library books"},
            headers={"Authorization": "Bearer " + token},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["status"], "CLEARED")
        admin_token = self.login("test.admin")
        audit = self.client.get(
            "/api/audit", headers={"Authorization": "Bearer " + admin_token}
        ).get_json()["entries"]
        self.assertTrue(any(item["action"] == "SIGN_OFF" for item in audit))

    def test_staff_signoff_requires_a_reason(self) -> None:
        token = self.login("test.library")
        response = self.client.post(
            "/api/clearance/2023-0002-14/library/signoff",
            json={},
            headers={"Authorization": "Bearer " + token},
        )
        self.assertEqual(response.status_code, 400)

    def test_expired_bearer_session_is_rejected(self) -> None:
        token = self.login()
        with hub.app.app_context():
            user = hub.query_one(
                "SELECT id FROM users WHERE username = ?", ("test.student",)
            )
            hub.execute(
                "UPDATE auth_sessions SET expires_at = ? WHERE user_id = ?",
                ("2000-01-01 00:00:00", user["id"]),
            )
            hub.commit()
        response = self.client.get(
            "/api/auth/me", headers={"Authorization": "Bearer " + token}
        )
        self.assertEqual(response.status_code, 401)

    def test_student_affairs_staff_can_record_office_hold(self) -> None:
        with hub.app.app_context():
            hub.create_user(
                "test.affairs", PASSWORD, "staff", office_name="student-affairs"
            )
        token = self.login("test.affairs")
        response = self.client.post(
            "/api/clearance/2023-0001-14/student-affairs/hold",
            json={"reason": "Unreturned equipment."},
            headers={"Authorization": "Bearer " + token},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["status"], "HOLD")

    def test_hold_summaries_include_pending_office_reviews(self) -> None:
        with hub.app.app_context():
            hub.upsert_student(
                {
                    "student_number": "2023-0003-14",
                    "full_name": "Pending Example",
                    "program": "BSIT",
                    "year_level": 1,
                    "active": 1,
                }
            )
            hub.commit()
            report_path = write_hold_summary()
        with report_path.open("r", encoding="utf-8-sig", newline="") as stream:
            report_rows = [
                row for row in csv.DictReader(stream)
                if row["student_name"] == "Pending Example"
            ]
        self.assertEqual(len(report_rows), 4)
        self.assertTrue(
            all(row["reason"] == "Awaiting office review." for row in report_rows)
        )

        token = self.login("test.admin")
        response = self.client.get(
            "/api/admin/hold-summary",
            headers={"Authorization": "Bearer " + token},
        )
        pending_rows = [
            row for row in response.get_json()["holds"]
            if row["full_name"] == "Pending Example"
        ]
        self.assertEqual(len(pending_rows), 4)
        self.assertTrue(
            all(row["reason"] == "Awaiting office review." for row in pending_rows)
        )

    def test_hold_requires_a_reason(self) -> None:
        token = self.login("test.library")
        response = self.client.post(
            "/api/clearance/2023-0001-14/library/hold",
            json={},
            headers={"Authorization": "Bearer " + token},
        )
        self.assertEqual(response.status_code, 400)

    def test_staff_can_place_hold_with_reason(self) -> None:
        token = self.login("test.library")
        response = self.client.post(
            "/api/clearance/2023-0001-14/library/hold",
            json={"reason": "Book is still overdue."},
            headers={"Authorization": "Bearer " + token},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["status"], "HOLD")

    def test_student_on_hold_can_request_qr_with_current_progress(self) -> None:
        token = self.login("held.student")
        response = self.client.get(
            "/api/slips/me", headers={"Authorization": "Bearer " + token}
        )
        self.assertEqual(response.status_code, 200)
        slip = response.get_json()
        self.assertTrue(slip["qr_svg"].startswith("<svg"))
        self.assertEqual(slip["status"], "HOLD")
        self.assertEqual(slip["progress"], {"cleared": 3, "total": 4, "percent": 75})
        self.assertEqual(
            {office["office_code"]: office["status"] for office in slip["offices"]}["library"],
            "HOLD",
        )

        staff_token = self.login("test.library")
        verified = self.client.post(
            "/api/slips/verify",
            json={"token": slip["signed_token"]},
            headers={"Authorization": "Bearer " + staff_token},
        ).get_json()
        self.assertTrue(verified["verified"])
        self.assertEqual(verified["overall"], "HOLD")
        self.assertEqual(verified["progress"], slip["progress"])
        self.assertEqual(
            {office["office_code"]: office["status"] for office in verified["offices"]}["library"],
            "HOLD",
        )
        self.client.post(
            "/api/clearance/2023-0002-14/library/signoff",
            json={"reason": "Returned all borrowed books."},
            headers={"Authorization": "Bearer " + staff_token},
        )
        updated = self.client.post(
            "/api/slips/verify",
            json={"token": slip["signed_token"]},
            headers={"Authorization": "Bearer " + staff_token},
        ).get_json()
        self.assertTrue(updated["verified"])
        self.assertEqual(updated["overall"], "CLEARED")
        self.assertEqual(updated["progress"], {"cleared": 4, "total": 4, "percent": 100})

    def test_qr_tokens_are_unique_to_each_student(self) -> None:
        student_slip = self.client.get(
            "/api/slips/me", headers={"Authorization": "Bearer " + self.login()}
        ).get_json()
        held_slip = self.client.get(
            "/api/slips/me", headers={"Authorization": "Bearer " + self.login("held.student")}
        ).get_json()
        self.assertNotEqual(student_slip["signed_token"], held_slip["signed_token"])
        self.assertNotEqual(student_slip["public_code"], held_slip["public_code"])

    def test_cleared_student_can_issue_and_verify_short_code(self) -> None:
        token = self.login()
        slip = self.client.get(
            "/api/slips/me", headers={"Authorization": "Bearer " + token}
        ).get_json()
        staff_token = self.login("test.library")
        verified = self.client.post(
            "/api/slips/verify",
            json={"code": slip["public_code"]},
            headers={"Authorization": "Bearer " + staff_token},
        )
        self.assertEqual(verified.status_code, 200)
        self.assertTrue(verified.get_json()["verified"])

    def test_slip_response_generates_qr_from_signed_token(self) -> None:
        token = self.login()
        svg = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>'
        with patch("hub._slip_qr_svg", return_value=svg) as make_qr:
            response = self.client.get(
                "/api/slips/me", headers={"Authorization": "Bearer " + token}
            )
        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertEqual(body["qr_svg"], svg)
        make_qr.assert_called_once_with(body["signed_token"])

    def test_slip_qr_renderer_returns_valid_svg(self) -> None:
        svg = hub._slip_qr_svg("signed-clearance-token")
        root = ElementTree.fromstring(svg)
        self.assertEqual(root.tag.rsplit("}", 1)[-1], "svg")
        self.assertTrue(any(
            element.tag.rsplit("}", 1)[-1] == "path" for element in root.iter()
        ))

    def test_changed_slip_token_fails_signature(self) -> None:
        student_token = self.login()
        slip = self.client.get(
            "/api/slips/me",
            headers={"Authorization": "Bearer " + student_token},
        ).get_json()
        staff_token = self.login("test.library")
        tampered = slip["signed_token"][:-1] + ("0" if slip["signed_token"][-1] != "0" else "1")
        response = self.client.post(
            "/api/slips/verify",
            json={"token": tampered},
            headers={"Authorization": "Bearer " + staff_token},
        )
        self.assertFalse(response.get_json()["verified"])

    def test_expired_slip_is_not_verified(self) -> None:
        student_token = self.login()
        slip = self.client.get(
            "/api/slips/me", headers={"Authorization": "Bearer " + student_token}
        ).get_json()
        with hub.app.app_context():
            hub.execute(
                "UPDATE clearance_slips SET expires_at = ? WHERE public_code = ?",
                ("2000-01-01 00:00:00", slip["public_code"]),
            )
            hub.commit()
        staff_token = self.login("test.library")
        response = self.client.post(
            "/api/slips/verify",
            json={"code": slip["public_code"]},
            headers={"Authorization": "Bearer " + staff_token},
        )
        self.assertFalse(response.get_json()["verified"])

    def test_public_json_report_masks_student_numbers(self) -> None:
        token = self.login("test.admin")
        response = self.client.get(
            "/api/reports/clearance?format=json",
            headers={"Authorization": "Bearer " + token},
        )
        report = response.get_json()["students"]
        self.assertEqual(response.status_code, 200)
        self.assertIn("****", report[0]["student_id"])
        self.assertNotIn("2023-0001-14", json.dumps(report))

    def test_report_supports_csv_and_xml(self) -> None:
        token = self.login("test.admin")
        headers = {"Authorization": "Bearer " + token}
        csv_response = self.client.get("/api/reports/clearance?format=csv", headers=headers)
        xml_response = self.client.get("/api/reports/clearance?format=xml", headers=headers)
        self.assertTrue(csv_response.mimetype == "text/csv")
        self.assertTrue(xml_response.mimetype == "application/xml")

    def test_registrar_staff_can_download_report(self) -> None:
        token = self.login("test.registrar")
        response = self.client.get(
            "/api/reports/clearance?format=csv",
            headers={"Authorization": "Bearer " + token},
        )
        self.assertEqual(response.status_code, 200)

    def test_other_office_staff_cannot_download_report(self) -> None:
        token = self.login("test.library")
        response = self.client.get(
            "/api/reports/clearance?format=json",
            headers={"Authorization": "Bearer " + token},
        )
        self.assertEqual(response.status_code, 403)

    def test_hold_summary_is_limited_to_own_office_for_staff(self) -> None:
        staff = self.client.get(
            "/api/admin/hold-summary",
            headers={"Authorization": "Bearer " + self.login("test.library")},
        )
        admin = self.client.get(
            "/api/admin/hold-summary",
            headers={"Authorization": "Bearer " + self.login("test.admin")},
        )
        self.assertEqual(staff.status_code, 200)
        self.assertTrue(all(row["office_code"] == "library" for row in staff.get_json()["holds"]))
        self.assertEqual(admin.status_code, 200)

    def test_student_cannot_read_hold_summary(self) -> None:
        response = self.client.get(
            "/api/admin/hold-summary",
            headers={"Authorization": "Bearer " + self.login("test.student")},
        )
        self.assertEqual(response.status_code, 403)

    def test_report_rejects_unsupported_format(self) -> None:
        token = self.login("test.admin")
        response = self.client.get(
            "/api/reports/clearance?format=pdf",
            headers={"Authorization": "Bearer " + token},
        )
        self.assertEqual(response.status_code, 400)

    def test_admin_only_audit_route_rejects_staff(self) -> None:
        token = self.login("test.library")
        response = self.client.get(
            "/api/audit", headers={"Authorization": "Bearer " + token}
        )
        self.assertEqual(response.status_code, 403)

    def test_audit_details_exclude_sensitive_fields(self) -> None:
        token = self.login("test.admin")
        with hub.app.app_context():
            hub.execute(
                "INSERT INTO audit_logs (action, details_json) VALUES (?, ?)",
                (
                    "IMPORT",
                    json.dumps(
                        {
                            "source": "test",
                            "password": "do-not-return",
                            "slip_code": "ECH-SECRET",
                            "token_hash": "do-not-return",
                        }
                    ),
                ),
            )
            hub.commit()
        response = self.client.get(
            "/api/audit", headers={"Authorization": "Bearer " + token}
        )
        entry = next(
            item for item in response.get_json()["entries"]
            if item["action"] == "IMPORT"
        )
        self.assertEqual(entry["details"], {"source": "test"})

    def test_admin_can_list_users_without_password_hashes(self) -> None:
        token = self.login("test.admin")
        response = self.client.get(
            "/api/admin/users", headers={"Authorization": "Bearer " + token}
        )
        self.assertEqual(response.status_code, 200)
        users = response.get_json()["users"]
        student = next(item for item in users if item["username"] == "test.student")
        self.assertEqual(student["full_name"], "Alex Rivera")
        self.assertNotIn("password_hash", student)
        self.assertTrue(response.get_json()["offices"])
        self.assertEqual(len(response.get_json()["students"]), 2)

    def test_cors_preflight_allows_admin_user_updates(self) -> None:
        response = self.client.options(
            "/api/admin/users/2",
            headers={
                "Origin": "http://localhost",
                "Access-Control-Request-Method": "PUT",
                "Access-Control-Request-Headers": "authorization,content-type",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.headers["Access-Control-Allow-Origin"], "http://localhost"
        )
        self.assertIn("PUT", response.headers["Access-Control-Allow-Methods"])

    def test_staff_cannot_list_or_update_users(self) -> None:
        token = self.login("test.library")
        headers = {"Authorization": "Bearer " + token}
        listing = self.client.get("/api/admin/users", headers=headers)
        update = self.client.put(
            "/api/admin/users/1",
            json={"username": "test.user", "active": True},
            headers=headers,
        )
        create = self.client.post(
            "/api/admin/users",
            json={
                "username": "new.staff@example.test",
                "password": "NewStaffPassword123!",
                "role": "staff",
                "office_code": "library",
            },
            headers=headers,
        )
        password_reset = self.client.post(
            "/api/admin/users/1/password",
            json={"password": "NewAdminPassword123!"},
            headers=headers,
        )
        self.assertEqual(listing.status_code, 403)
        self.assertEqual(update.status_code, 403)
        self.assertEqual(create.status_code, 403)
        self.assertEqual(password_reset.status_code, 403)

    def test_admin_can_create_staff_with_email_login_and_assignment(self) -> None:
        token = self.login("test.admin")
        response = self.client.post(
            "/api/admin/users",
            json={
                "username": "new.library@example.test",
                "password": "NewLibraryPassword123!",
                "role": "staff",
                "office_code": "library",
            },
            headers={"Authorization": "Bearer " + token},
        )
        self.assertEqual(response.status_code, 201)
        login = self.client.post(
            "/api/auth/login",
            json={
                "username": "new.library@example.test",
                "password": "NewLibraryPassword123!",
            },
        )
        self.assertEqual(login.status_code, 200)
        self.assertEqual(login.get_json()["user"]["office_code"], "library")
        audit_token = self.login("test.admin")
        audit = self.client.get(
            "/api/audit", headers={"Authorization": "Bearer " + audit_token}
        ).get_json()["entries"]
        created = next(item for item in audit if item["action"] == "USER_CREATED")
        self.assertEqual(created["details"]["username"], "new.library@example.test")
        self.assertNotIn("password", created["details"])
        with hub.app.app_context():
            action = hub.query_one(
                "SELECT action FROM audit_logs WHERE action = ?",
                ("USER_CREATED",),
            )
        self.assertEqual(action["action"], "USER_CREATED")

    def test_admin_can_create_admin_account(self) -> None:
        token = self.login("test.admin")
        response = self.client.post(
            "/api/admin/users",
            json={
                "username": "second.admin@example.test",
                "password": "NewAdminPassword123!",
                "role": "admin",
            },
            headers={"Authorization": "Bearer " + token},
        )
        self.assertEqual(response.status_code, 201)
        login = self.client.post(
            "/api/auth/login",
            json={
                "username": "second.admin@example.test",
                "password": "NewAdminPassword123!",
            },
        )
        self.assertEqual(login.status_code, 200)
        self.assertEqual(login.get_json()["user"]["role"], "admin")

    def test_admin_can_create_student_only_for_existing_active_record(self) -> None:
        token = self.login("test.admin")
        with hub.app.app_context():
            hub.upsert_student(
                {
                    "student_number": "2023-0003-14",
                    "full_name": "Taylor Cruz",
                    "program": "BSIT",
                    "year_level": 1,
                    "active": 1,
                }
            )
            hub.commit()
        response = self.client.post(
            "/api/admin/users",
            json={
                "username": "taylor.student@example.test",
                "password": "NewStudentPassword123!",
                "role": "student",
                "student_number": "2023-0003-14",
            },
            headers={"Authorization": "Bearer " + token},
        )
        self.assertEqual(response.status_code, 201)
        login = self.client.post(
            "/api/auth/login",
            json={
                "username": "taylor.student@example.test",
                "password": "NewStudentPassword123!",
            },
        )
        self.assertEqual(login.status_code, 200)
        self.assertEqual(login.get_json()["user"]["role"], "student")

    def test_admin_create_rejects_missing_office_and_short_password(self) -> None:
        token = self.login("test.admin")
        headers = {"Authorization": "Bearer " + token}
        missing_office = self.client.post(
            "/api/admin/users",
            json={
                "username": "unassigned.staff",
                "password": "NewStaffPassword123!",
                "role": "staff",
            },
            headers=headers,
        )
        short_password = self.client.post(
            "/api/admin/users",
            json={
                "username": "short.password",
                "password": "short",
                "role": "admin",
            },
            headers=headers,
        )
        self.assertEqual(missing_office.status_code, 400)
        self.assertEqual(short_password.status_code, 400)

    def test_admin_can_reset_password_and_revoke_existing_sessions(self) -> None:
        admin_token = self.login("test.admin")
        target_token = self.login("test.library")
        with hub.app.app_context():
            target = hub.query_one(
                "SELECT id FROM users WHERE username = ?", ("test.library",)
            )
        response = self.client.post(
            "/api/admin/users/{}/password".format(target["id"]),
            json={"password": "ResetStaffPassword123!"},
            headers={"Authorization": "Bearer " + admin_token},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            self.client.get(
                "/api/auth/me",
                headers={"Authorization": "Bearer " + target_token},
            ).status_code,
            401,
        )
        old_login = self.client.post(
            "/api/auth/login",
            json={"username": "test.library", "password": PASSWORD},
        )
        new_login = self.client.post(
            "/api/auth/login",
            json={
                "username": "test.library",
                "password": "ResetStaffPassword123!",
            },
        )
        self.assertEqual(old_login.status_code, 401)
        self.assertEqual(new_login.status_code, 200)
        with hub.app.app_context():
            audit = hub.query_one(
                "SELECT details_json FROM audit_logs WHERE action = ?",
                ("PASSWORD_RESET",),
            )
        self.assertNotIn("ResetStaffPassword123!", audit["details_json"])

    def test_admin_can_change_role_assignment_and_revoke_old_session(self) -> None:
        admin_token = self.login("test.admin")
        student_token = self.login("test.student")
        with hub.app.app_context():
            account = hub.query_one(
                "SELECT id FROM users WHERE username = ?", ("test.student",)
            )
        response = self.client.put(
            "/api/admin/users/{}".format(account["id"]),
            json={
                "username": "alex.staff@example.test",
                "role": "staff",
                "office_code": "accounting",
                "active": True,
            },
            headers={"Authorization": "Bearer " + admin_token},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            self.client.get(
                "/api/auth/me",
                headers={"Authorization": "Bearer " + student_token},
            ).status_code,
            401,
        )
        login = self.client.post(
            "/api/auth/login",
            json={"username": "alex.staff@example.test", "password": PASSWORD},
        )
        self.assertEqual(login.status_code, 200)
        self.assertEqual(login.get_json()["user"]["role"], "staff")
        self.assertEqual(login.get_json()["user"]["office_code"], "accounting")

    def test_admin_can_repair_account_with_unassigned_legacy_role(self) -> None:
        admin_token = self.login("test.admin")
        with hub.app.app_context():
            library = hub.query_one(
                "SELECT id FROM offices WHERE code = ?", ("library",)
            )
            hub.execute(
                """INSERT INTO users (username, password_hash, role, office_id)
                   VALUES (?, ?, ?, ?)""",
                (
                    "legacy.staff",
                    TEST_PASSWORD_HASH,
                    "",
                    library["id"],
                ),
            )
            hub.commit()
            account = hub.query_one(
                "SELECT id FROM users WHERE username = ?", ("legacy.staff",)
            )
        response = self.client.put(
            "/api/admin/users/{}".format(account["id"]),
            json={
                "username": "legacy.staff@example.test",
                "role": "staff",
                "office_code": "library",
                "active": True,
            },
            headers={"Authorization": "Bearer " + admin_token},
        )
        self.assertEqual(response.status_code, 200)
        login = self.client.post(
            "/api/auth/login",
            json={
                "username": "legacy.staff@example.test",
                "password": PASSWORD,
            },
        )
        self.assertEqual(login.status_code, 200)
        self.assertEqual(login.get_json()["user"]["office_code"], "library")

    def test_admin_cannot_demote_own_account(self) -> None:
        token = self.login("test.admin")
        with hub.app.app_context():
            admin = hub.query_one(
                "SELECT id FROM users WHERE username = ?", ("test.admin",)
            )
        response = self.client.put(
            "/api/admin/users/{}".format(admin["id"]),
            json={
                "username": "test.admin",
                "role": "staff",
                "office_code": "library",
                "active": True,
            },
            headers={"Authorization": "Bearer " + token},
        )
        self.assertEqual(response.status_code, 400)

    def test_admin_can_update_student_profile_and_account(self) -> None:
        token = self.login("test.admin")
        headers = {"Authorization": "Bearer " + token}
        with hub.app.app_context():
            student = hub.query_one(
                "SELECT id FROM students WHERE student_number = ?",
                ("2023-0001-14",),
            )
            account = hub.query_one(
                "SELECT id FROM users WHERE username = ?", ("test.student",)
            )
        response = self.client.put(
            "/api/admin/users/" + str(account["id"]),
            json={
                "username": "alex.rivera",
                "active": False,
                "full_name": "Alex Rivera Updated",
                "email": "alex.updated@example.invalid",
            },
            headers=headers,
        )
        self.assertEqual(response.status_code, 200)
        with hub.app.app_context():
            saved_user = hub.query_one(
                "SELECT username, active FROM users WHERE id = ?",
                (account["id"],),
            )
            saved_student = hub.query_one(
                "SELECT full_name, email FROM students WHERE id = ?",
                (student["id"],),
            )
        self.assertEqual(saved_user, {"username": "alex.rivera", "active": 0})
        self.assertEqual(
            saved_student,
            {
                "full_name": "Alex Rivera Updated",
                "email": "alex.updated@example.invalid",
            },
        )

    def test_admin_can_change_staff_office(self) -> None:
        token = self.login("test.admin")
        with hub.app.app_context():
            account = hub.query_one(
                "SELECT id FROM users WHERE username = ?", ("test.library",)
            )
        response = self.client.put(
            "/api/admin/users/" + str(account["id"]),
            json={
                "username": "test.library",
                "active": True,
                "office_code": "accounting",
            },
            headers={"Authorization": "Bearer " + token},
        )
        self.assertEqual(response.status_code, 200)
        with hub.app.app_context():
            saved = hub.query_one(
                """SELECT o.code AS office_code FROM users AS u
                   JOIN offices AS o ON o.id = u.office_id WHERE u.id = ?""",
                (account["id"],),
            )
        self.assertEqual(saved["office_code"], "accounting")

    def test_admin_user_update_rejects_duplicate_username_and_self_deactivation(self) -> None:
        token = self.login("test.admin")
        headers = {"Authorization": "Bearer " + token}
        with hub.app.app_context():
            student = hub.query_one(
                "SELECT id FROM users WHERE username = ?", ("test.student",)
            )
            admin = hub.query_one(
                "SELECT id FROM users WHERE username = ?", ("test.admin",)
            )
        duplicate = self.client.put(
            "/api/admin/users/" + str(student["id"]),
            json={
                "username": "test.admin",
                "active": True,
                "full_name": "Alex Rivera",
                "email": "alex@example.invalid",
            },
            headers=headers,
        )
        self_deactivation = self.client.put(
            "/api/admin/users/" + str(admin["id"]),
            json={"username": "test.admin", "active": False},
            headers=headers,
        )
        self.assertEqual(duplicate.status_code, 409)
        self.assertEqual(self_deactivation.status_code, 400)

    def test_logout_invalidates_token(self) -> None:
        token = self.login()
        headers = {"Authorization": "Bearer " + token}
        self.assertEqual(self.client.post("/api/auth/logout", json={}, headers=headers).status_code, 200)
        self.assertEqual(self.client.get("/api/auth/me", headers=headers).status_code, 401)


if __name__ == "__main__":
    unittest.main()
