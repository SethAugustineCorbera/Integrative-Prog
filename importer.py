"""Signed CSV/XML import processing and daily office HOLD summaries."""

from __future__ import annotations

import csv
import hashlib
import hmac
import json
import logging
import re
import secrets
import shutil
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from flask import current_app

from hub import (
    commit,
    execute,
    mask_student_number,
    query_all,
    query_one,
    upsert_clearance,
)


LOGGER = logging.getLogger("clearance_hub.imports")
MAX_IMPORT_BYTES = 10 * 1024 * 1024
KEY_ALIASES = {
    "student_number": {"studentnumber", "studentid", "studentno", "studentnum", "id"},
    "book_count": {"unreturnedbooks", "unreturnedbookcount", "booksunreturned", "bookcount"},
    "fine": {"fine", "fines", "fineamount", "libraryfine"},
    "balance": {"balance", "amountdue", "tuitionbalance", "outstandingbalance", "amount"},
}


def canonical_manifest_bytes(manifest: dict[str, Any]) -> bytes:
    unsigned = {
        key: value
        for key, value in manifest.items()
        if key not in {"hmac_sha256", "signature"}
    }
    return json.dumps(unsigned, sort_keys=True, separators=(",", ":")).encode("utf-8")


def create_manifest(file_name: str, source: str, file_bytes: bytes, secret: str) -> dict[str, str]:
    manifest: dict[str, str] = {
        "file": Path(file_name).name,
        "source": source,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "nonce": secrets.token_urlsafe(24),
        "sha256": hashlib.sha256(file_bytes).hexdigest(),
    }
    manifest["hmac_sha256"] = hmac.new(
        secret.encode("utf-8"), canonical_manifest_bytes(manifest), hashlib.sha256
    ).hexdigest()
    return manifest


def verify_manifest(
    manifest: dict[str, Any], file_name: str, file_bytes: bytes, secret: str
) -> str | None:
    if not isinstance(manifest, dict):
        return "Manifest must be a JSON object."
    required = {"file", "source", "generated_at", "nonce", "sha256", "hmac_sha256"}
    if not required.issubset(manifest):
        return "Manifest is missing a required field."
    if not isinstance(manifest["file"], str) or manifest["file"] != Path(file_name).name:
        return "Manifest filename does not match the import file."
    if not isinstance(manifest["source"], str) or manifest["source"] not in {
        "library",
        "accounting",
    }:
        return "Manifest source must be library or accounting."
    expected_suffix = ".xml" if manifest["source"] == "library" else ".csv"
    if Path(file_name).suffix.lower() != expected_suffix:
        return "Source does not match the file format."
    if not isinstance(manifest["nonce"], str) or not re.fullmatch(
        r"[A-Za-z0-9_-]{16,120}", manifest["nonce"]
    ):
        return "Manifest nonce is invalid."
    if not isinstance(manifest["sha256"], str) or not re.fullmatch(
        r"[a-fA-F0-9]{64}", manifest["sha256"]
    ):
        return "Manifest SHA-256 digest is invalid."
    actual_digest = hashlib.sha256(file_bytes).hexdigest()
    if not hmac.compare_digest(manifest["sha256"].lower(), actual_digest):
        return "File digest does not match the signed manifest."
    if not isinstance(manifest["generated_at"], str):
        return "Manifest timestamp is invalid."
    try:
        generated = datetime.fromisoformat(manifest["generated_at"].replace("Z", "+00:00"))
        if generated.tzinfo is None:
            generated = generated.replace(tzinfo=timezone.utc)
    except ValueError:
        return "Manifest timestamp is invalid."
    now = datetime.now(timezone.utc)
    if generated < now - timedelta(hours=24) or generated > now + timedelta(minutes=5):
        return "Manifest is outside the accepted 24-hour time window."
    supplied = manifest["hmac_sha256"]
    if not isinstance(supplied, str) or not re.fullmatch(r"[a-fA-F0-9]{64}", supplied):
        return "Manifest HMAC is malformed."
    expected = hmac.new(
        secret.encode("utf-8"), canonical_manifest_bytes(manifest), hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(supplied.lower(), expected):
        return "Manifest HMAC verification failed."
    return None


def _normalized_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower().split("}")[-1])


def _normalize_record(record: dict[str, Any]) -> dict[str, str]:
    normalized = {_normalized_key(str(key)): str(value).strip() for key, value in record.items()}
    result: dict[str, str] = {}
    for target, aliases in KEY_ALIASES.items():
        for alias in aliases:
            if normalized.get(alias):
                result[target] = normalized[alias]
                break
    return result


def _xml_records(payload: bytes) -> list[dict[str, str]]:
    try:
        root = ET.fromstring(payload)
    except ET.ParseError as error:
        raise ValueError("XML document is malformed.") from error
    records: list[dict[str, str]] = []
    for node in root.iter():
        record: dict[str, Any] = dict(node.attrib)
        for child in list(node):
            if len(list(child)) == 0 and child.text is not None:
                record[child.tag] = child.text
        normalized = _normalize_record(record)
        if normalized.get("student_number") and (
            normalized.get("book_count") is not None or normalized.get("fine") is not None
        ):
            records.append(normalized)
    if not records:
        raise ValueError("XML must contain borrower records with student ID and issue fields.")
    return records


def _csv_records(payload: bytes) -> list[dict[str, str]]:
    try:
        text = payload.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise ValueError("CSV must be UTF-8 encoded.") from error
    reader = csv.DictReader(text.splitlines())
    if not reader.fieldnames:
        raise ValueError("CSV is missing a header row.")
    records = [_normalize_record(row) for row in reader]
    if not records:
        raise ValueError("CSV contains no data rows.")
    return records


def _positive_number(raw: str | None, field: str) -> Decimal:
    if raw is None or not raw.strip():
        return Decimal("0")
    cleaned = raw.strip().replace(",", "").replace("PHP", "").replace("php", "")
    cleaned = cleaned.replace("₱", "").strip()
    try:
        amount = Decimal(cleaned)
    except InvalidOperation as error:
        raise ValueError("{} is not a valid number.".format(field)) from error
    if not amount.is_finite() or amount < 0:
        raise ValueError("{} must be a non-negative number.".format(field))
    return amount


def _map_record(source: str, row: dict[str, str], row_number: int) -> dict[str, Any]:
    student_number = row.get("student_number", "").strip()
    if not student_number or len(student_number) > 40:
        raise ValueError("Student ID is missing or invalid.")
    if source == "library":
        book_count = _positive_number(row.get("book_count"), "unreturned book count")
        fine = _positive_number(row.get("fine"), "fine amount")
        reasons = []
        if book_count:
            reasons.append("{} unreturned book(s)".format(book_count.normalize()))
        if fine:
            reasons.append("unpaid fine of PHP {:,.2f}".format(fine))
        return {
            "row_reference": str(row_number),
            "student_number": student_number,
            "status": "HOLD" if reasons else "CLEARED",
            "reason": "; ".join(reasons) or "No outstanding books or fines in the latest Library export.",
        }
    balance = _positive_number(row.get("balance"), "accounting balance")
    return {
        "row_reference": str(row_number),
        "student_number": student_number,
        "status": "HOLD" if balance else "CLEARED",
        "reason": "Outstanding balance of PHP {:,.2f}".format(balance)
        if balance
        else "No outstanding balance in the latest Accounting export.",
    }


def _batch_result(
    file_name: str,
    source: str,
    file_digest: str,
    verified: bool,
    status: str,
    imported: int,
    rejected: int,
    actor_id: int | None,
    nonce: str | None,
) -> int:
    return execute(
        """INSERT INTO import_batches
           (file_name, source, file_sha256, nonce, manifest_verified, status,
            imported_count, rejected_count, created_by)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        (
            file_name[:255],
            source[:40],
            file_digest,
            nonce,
            1 if verified else 0,
            status,
            imported,
            rejected,
            actor_id,
        ),
    )


def _rejection(batch_id: int, row_reference: str, reason: str) -> None:
    execute(
        """INSERT INTO import_rejections (batch_id, row_reference, reason)
           VALUES (%s, %s, %s)""",
        (batch_id, row_reference[:120], reason[:500]),
    )


def _reject_file(
    file_name: str,
    file_bytes: bytes,
    source: str,
    reason: str,
    actor_id: int | None,
) -> dict[str, Any]:
    batch_id = _batch_result(
        file_name,
        source or "unknown",
        hashlib.sha256(file_bytes).hexdigest(),
        False,
        "REJECTED",
        0,
        1,
        actor_id,
        None,
    )
    _rejection(batch_id, "manifest", reason)
    commit()
    LOGGER.warning(
        "Import rejected file=%s source=%s reason=%s",
        Path(file_name).name,
        source or "unknown",
        reason,
    )
    return {
        "batch_id": batch_id,
        "file_name": Path(file_name).name,
        "source": source or "unknown",
        "manifest_verified": False,
        "status": "REJECTED",
        "imported": 0,
        "rejected": 1,
        "message": reason,
    }


def process_bytes(
    file_name: str,
    file_bytes: bytes,
    manifest_bytes: bytes,
    actor_id: int | None = None,
) -> dict[str, Any]:
    secret = current_app.config["HMAC_SECRET"]
    if not secret or "replace-with" in secret or len(secret) < 32:
        raise RuntimeError("HUB_HMAC_SECRET must be set to a random value of at least 32 characters.")
    if len(file_bytes) > MAX_IMPORT_BYTES or len(manifest_bytes) > 64 * 1024:
        return _reject_file(file_name, file_bytes, "unknown", "Import file or manifest exceeds the size limit.", actor_id)
    try:
        manifest = json.loads(manifest_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return _reject_file(file_name, file_bytes, "unknown", "Manifest is not valid UTF-8 JSON.", actor_id)
    manifest_source = manifest.get("source", "") if isinstance(manifest, dict) else ""
    source = manifest_source if isinstance(manifest_source, str) else "unknown"
    reason = verify_manifest(manifest, file_name, file_bytes, secret)
    if reason:
        return _reject_file(file_name, file_bytes, source, reason, actor_id)
    if query_one("SELECT id FROM import_batches WHERE nonce = %s", (manifest["nonce"],)):
        return _reject_file(file_name, file_bytes, source, "Manifest nonce has already been processed.", actor_id)
    try:
        rows = _xml_records(file_bytes) if source == "library" else _csv_records(file_bytes)
    except ValueError as error:
        return _reject_file(file_name, file_bytes, source, str(error), actor_id)
    office = query_one("SELECT id FROM offices WHERE code = %s", (source,))
    if office is None:
        return _reject_file(file_name, file_bytes, source, "Source office is not configured.", actor_id)

    seen: set[str] = set()
    mapped: list[dict[str, Any]] = []
    rejected_rows: list[tuple[str, str]] = []
    for row_number, row in enumerate(rows, start=2 if source == "accounting" else 1):
        try:
            result = _map_record(source, row, row_number)
            student = query_one(
                "SELECT id FROM students WHERE student_number = %s",
                (result["student_number"],),
            )
            if student is None:
                raise ValueError("Student ID is not in the Registrar masterlist.")
            if result["student_number"] in seen:
                raise ValueError("Duplicate student record in this file.")
            seen.add(result["student_number"])
            result["student_id"] = student["id"]
            mapped.append(result)
        except ValueError as error:
            rejected_rows.append((str(row_number), str(error)))

    batch_id = _batch_result(
        file_name,
        source,
        hashlib.sha256(file_bytes).hexdigest(),
        True,
        "PARTIAL" if rejected_rows else "COMPLETED",
        len(mapped),
        len(rejected_rows),
        actor_id,
        manifest["nonce"],
    )
    for record in mapped:
        upsert_clearance(
            record["student_id"],
            office["id"],
            record["status"],
            record["reason"],
            source,
            actor_id,
        )
    for row_reference, rejection_reason in rejected_rows:
        _rejection(batch_id, row_reference, rejection_reason)
    _audit_import(batch_id, source, len(mapped), len(rejected_rows))
    commit()
    status = "PARTIAL" if rejected_rows else "COMPLETED"
    LOGGER.info(
        "Import %s file=%s imported=%s rejected=%s",
        status,
        Path(file_name).name,
        len(mapped),
        len(rejected_rows),
    )
    return {
        "batch_id": batch_id,
        "file_name": Path(file_name).name,
        "source": source,
        "manifest_verified": True,
        "status": status,
        "imported": len(mapped),
        "rejected": len(rejected_rows),
    }


def _audit_import(batch_id: int, source: str, imported: int, rejected: int) -> None:
    from hub import _insert_audit

    _insert_audit(
        "IMPORT",
        details={"batch_id": batch_id, "source": source, "imported": imported, "rejected": rejected},
    )


def _archive_file(file_path: Path, manifest_path: Path) -> None:
    archive = Path(current_app.config["ARCHIVE_FOLDER"])
    archive.mkdir(parents=True, exist_ok=True)
    suffix = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    for path in (file_path, manifest_path):
        if not path.exists():
            continue
        destination = archive / path.name
        if destination.exists():
            destination = archive / (suffix + "_" + path.name)
        shutil.move(str(path), str(destination))


def process_path(file_path: Path, actor_id: int | None = None) -> dict[str, Any]:
    file_path = Path(file_path)
    manifest_path = file_path.with_name(file_path.name + ".manifest.json")
    file_bytes = file_path.read_bytes()
    if not manifest_path.is_file():
        result = _reject_file(
            file_path.name, file_bytes, "unknown", "Signed manifest sidecar is missing.", actor_id
        )
    else:
        result = process_bytes(
            file_path.name, file_bytes, manifest_path.read_bytes(), actor_id
        )
    _archive_file(file_path, manifest_path)
    return result


def run_drop_folder(actor_id: int | None = None) -> list[dict[str, Any]]:
    drop_dir = Path(current_app.config["DROP_FOLDER"])
    drop_dir.mkdir(parents=True, exist_ok=True)
    files = sorted(
        path
        for path in drop_dir.iterdir()
        if path.is_file()
        and path.suffix.lower() in {".xml", ".csv"}
        and not path.name.endswith(".manifest.json")
    )
    return [process_path(path, actor_id) for path in files]


def write_hold_summary() -> Path:
    report_folder = Path(current_app.config["REPORT_FOLDER"])
    report_folder.mkdir(parents=True, exist_ok=True)
    rows = query_all(
        """SELECT o.name AS office, s.student_number, s.full_name,
                  COALESCE(c.reason, 'Awaiting office review.') AS reason
           FROM offices AS o
           CROSS JOIN students AS s
           LEFT JOIN clearance_records AS c
             ON c.office_id = o.id AND c.student_id = s.id
           WHERE s.active = 1 AND o.required_for_clearance = 1
             AND COALESCE(c.status, 'HOLD') = 'HOLD'
           ORDER BY o.name, s.student_number"""
    )
    output = report_folder / ("hold-summary-" + datetime.now().strftime("%Y-%m-%d") + ".csv")
    with output.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=["office", "student_id", "student_name", "reason"])
        writer.writeheader()
        writer.writerows(
            {
                "office": row["office"],
                "student_id": mask_student_number(row["student_number"]),
                "student_name": row["full_name"],
                "reason": row["reason"],
            }
            for row in rows
        )
    LOGGER.info("Daily HOLD summary written with %s rows.", len(rows))
    return output
