# IT312 Final Project - Track A starter kit (DNSC e-Clearance Hub)

All data here is synthetic. No real student records.

## Contents
| File | Purpose |
|---|---|
| registrar_students.json | 40 students served by the mock Registrar API (master record) |
| registrar_mock_api.py | Mock Registrar REST API, Python standard library only |
| drop_folder/library_export_2026-11-20.xml | Library export, 29 borrowers (some deliberately invalid) |
| drop_folder/accounting_balances_2026-11-20.csv | Accounting export, 42 rows (some deliberately invalid) |
| drop_folder/*.manifest.json | HMAC-SHA256 signed manifests for the two exports (R14) |
| tamper_tests/ | Same accounting export with one balance changed after signing: your importer must reject it |
| verify_manifest.py | Reference manifest check you can compare your importer against |

## Run the mock Registrar API
    REGISTRAR_API_KEY=pick-your-own-dev-key python3 registrar_mock_api.py
    curl -H "X-API-Key: pick-your-own-dev-key" "http://127.0.0.1:8001/api/v1/students?page=1&size=10"

Endpoints: GET /api/v1/health, GET /api/v1/students?page=&size= (size 1-20), GET /api/v1/students/{student_id}
Errors on purpose: 401 bad key, 404 unknown student, 400 bad paging, 503 on every 10th request (with Retry-After).

## Verify the import files
Demo signing key for the starter files ONLY (your own system must use its own key from .env):

    STARTER_HMAC_KEY=it312-starter-demo-key-change-me python3 verify_manifest.py drop_folder/accounting_balances_2026-11-20.csv

Manifest signature = HMAC-SHA256 over the manifest JSON without "signature", keys sorted, separators (",", ":").

## Things your mapping must handle (find them all)
- Library: names not in "LAST, First M." format, malformed student numbers, unknown program codes (BSHM),
  impossible dates (31/09/2026), negative fines, duplicate cards for the same student,
  borrowers who are not in the Registrar masterlist.
- Accounting: amounts with thousands separators ("10,450.50"), empty payment dates, a student not in the
  Registrar masterlist, a row with non-numeric amounts and an invalid date.
- Registrar: one student is on LOA (status) - decide and document how the Hub treats them.

## Public holidays API (R6)
    GET https://date.nager.at/api/v3/PublicHolidays/2026/PH
