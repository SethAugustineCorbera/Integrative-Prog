# DNSC e-Clearance Hub

Python/Flask REST API, local SQLite persistence, and a mobile-friendly browser client for the IT312 Track A final project. The application connects a Registrar masterlist, signed Library XML and Accounting CSV exports, office actions, holiday data, student clearance views, masked reports, and signed clearance slips.

> **Final-project evidence reminder:** The software and documentation are in this repository. The required 30-person evaluation, official signed sheets, consented photos, completed rater masterlist, team details, and final compiled PDF must be completed by the team using real evidence. Do not fabricate these materials.
>
> **Database note:** The Hub uses a private SQLite database outside the Apache document root. Keep database and backup files private; do not commit them.

## 1. Prerequisites

- Windows with Python 3.11 or newer. XAMPP is not required; the Python Hub serves both the browser front end and API, and SQLite stores the data. MySQL and phpMyAdmin are not used.
- Python 3.11 or newer.
- The bundled `IT312_Final_Project_Starter_Kit` contains a synthetic Registrar mock API and signed demo imports. Its roster contains fictional students for testing.
- A browser. Nager.Date deadline calculation needs internet access on its first request for a year.

## 2. Install and start locally

### A. Initialize SQLite (new installations only)

The default database is `%USERPROFILE%\DNSC e-Clearance Hub\dnsc_clearance_hub.sqlite3`, outside the Apache document root. For a new installation with no existing database, run:

```powershell
python python.py init-db
```

This command refuses to overwrite an existing database. Do not run it on a migrated installation.

### B. Install the Python API

Open PowerShell in the repository folder:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Edit `.env` to configure the application secrets. `DB_PATH` is optional; when blank, the API uses the default SQLite location above. Do not overwrite an existing `.env` or its secrets. Generate three different secrets (run the command three times) and replace the placeholders:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Use the outputs for `FLASK_SECRET_KEY`, `HUB_HMAC_SECRET`, and `HUB_SLIP_SIGNING_KEY`. Do not commit `.env` or paste real secrets into this README.

For a deployed HTTPS installation, set `HUB_SSL_CERT` and `HUB_SSL_KEY` in `.env` to the certificate and private-key files for the deployment hostname. The server must receive both paths or it will not start. Local development uses loopback HTTP; never expose real student data through that setup. A production deployment should normally terminate TLS with a managed HTTPS reverse proxy or host certificate instead of relying on Flask's development server.

### C. Add local demo records and accounts

For a fictional local presentation only, set `DEMO_PASSWORD` in `.env` to a unique password of at least 12 characters. Then run:

```powershell
python python.py seed-demo
```

This creates three synthetic students and the accounts `demo.student`, `demo.library`, and `demo.admin`, all using the configured `DEMO_PASSWORD`. Student records use `.invalid` email addresses and are not real people. Remove demo accounts and records before any authorized production use.

### D. Run the API and open the UI

In one PowerShell window:

```powershell
.\.venv\Scripts\python.exe python.py serve
```

Always start the API with the project virtual environment. The clearance-slip QR generator depends on `qrcode`, which is installed from [requirements.txt](requirements.txt); starting `python.py serve` with a different system Python can make slip requests return an internal server error. If needed, create the environment and install dependencies with `py -3 -m venv .venv` and `.\.venv\Scripts\python.exe -m pip install -r requirements.txt`.

The Python server hosts the UI and API together. Confirm `http://127.0.0.1:8000/api/health` reports a connected database, then open `http://127.0.0.1:8000/` in your browser and log in. Keep the PowerShell window open while using the Hub.

To try student sign-up, start the bundled mock Registrar as described in [Registrar integration](#5-registrar-integration), then run `python python.py sync-registrar`. Select **Register an account** on the login page, enter an active student number and the matching roster name, then create a username and a password of at least 12 characters. The bundled roster includes synthetic student `2026-29417` / `Mark D. Navarro` for testing. After successful registration, return to the login form and sign in with the username and password you chose. Staff and admin accounts must be provisioned by an administrator. For the separate demo accounts, use `demo.student`, `demo.library`, or `demo.admin` with `DEMO_PASSWORD` configured before `seed-demo`. See the [user guide](docs/user-guide.md) for the full login flow.

The browser UI and API share `http://127.0.0.1:8000` by default, so no separate web server or CORS setup is needed for local use. Do not expose the Flask development server to the public internet.

### Admin account management

Sign in as an administrator and open **Users** in the sidebar. This page lists accounts and lets an admin search/filter them, create student/staff/admin accounts, edit login IDs and roles, link students, assign a staff office, edit student contact details, activate/deactivate accounts, and set a new password. Student accounts must link to an existing active Registrar record; staff accounts need an office assignment. Passwords are never displayed or emailed. Share an initial or reset password through an approved private channel. Role/assignment changes, deactivation, and password resets end the affected account's active sessions. An administrator cannot demote/deactivate their own account, and the last active admin cannot be removed.

The runtime [SQLite schema](database/schema.sqlite.sql) includes account-management audit actions. The original MySQL schema and its SQL migration are retained for reference only; do not apply them to the SQLite database.

## 3. Detailed system flow

### Student flow

1. Register from the login page if you are a student without an account, or sign in with the username/password issued for your role.
2. The API identifies the linked student record; users cannot select a role in the browser.
3. **Clearance status** loads one record per required office. Missing office review is shown as HOLD, not silently treated as cleared.
4. Visit the office named in each HOLD reason and wait for an authorized staff update.
5. Open **Clearance slip** at any point to display your unique QR code and short code. The QR encodes the exact same `ECH-...` signed short code printed below it, so scanning the QR or entering the code uses the same verification path. The code is reused until its 30-day expiry, and verification always reads current office progress.
6. Use **Deadline** to see the configured number of working days and the weekend/Philippine holidays skipped.
7. **Log out** invalidates the server-side session.

### Office staff flow

1. Sign in with an account assigned to one office.
2. **Office queue** calls the Hub API and shows only that office's students. The role/office restriction is checked by the server, not trusted from the page.
3. **Sign off** requires an explicit staff confirmation and reason; no office is automatically signed off when a record is loaded or an obligation is settled. **Place HOLD** requires a reason. Each change creates an audit event.
4. **HOLD summary** lists unresolved records for the assigned office.
5. **Verify slip** accepts the QR's signed short code, a manually entered short code, a legacy signed token, or a Student ID. The QR and short code are the same signed value and are checked for authenticity, revocation, and expiry before current office status is shown. Staff can continue to **Clearance Signing**, review the obligations, and explicitly click **Sign off now**. A Student ID lookup shows current status but does not verify a signed slip. Students cannot sign themselves off.

### Phone as a wireless scanner (Option 2)

The Hub's scan field works with a phone scanner app that has a Windows/PC receiver and sends scans as keyboard input (sometimes called *keyboard wedge* mode). The phone does not need direct access to the Hub API.

For app download links, pairing instructions, and troubleshooting, follow the step-by-step [phone setup guide](phone_setup.txt).

1. Connect the phone and PC to the same trusted Wi-Fi network. Install the scanner app on the phone and its companion receiver on the PC, then pair them using the app's instructions. Allow the receiver through Windows Firewall for **Private networks only** if prompted.
2. Sign in on the PC. Open **Verify Slip** in Admin for lookup-only access, or open **Verify Slip** in the assigned office account when preparing an office sign-off.
3. Click the **Scan QR or Student ID** field so it has focus. In the phone app, enable sending the scan as keyboard text and, if available, append Enter/Return.
4. Scan the student's QR (it types the same `ECH-...` short code printed on the slip) to verify it, or scan their Student ID barcode to look up current status. If the app does not append Enter, click **Verify or look up** on the PC.
5. For office staff, choose **Continue to clearance signing**, review the office checks, and click **Sign off now** only after confirming there are no outstanding obligations. Admin verification is read-only; only staff assigned to the office can sign off.

If scans appear in the wrong place, refocus the PC scan field and scan again. The existing Student ID, short-code, and token fields remain available for manual entry. Use a scanner app that pairs directly with the PC over your local network or Bluetooth; do not expose the Flask API to the public internet.

### Admin flow

1. Synchronize the official masterlist with **Sync Registrar masterlist** or `python python.py sync-registrar`. Sync leaves unreviewed active students pending for manual Registrar review and preserves staff-entered decisions.
2. Use **Users** to create and maintain student, staff, and admin accounts, assign student records/offices, and set/reset passwords.
3. Upload an XML/CSV file and its matching JSON manifest in **Import monitor**, or put both files in `drop_folder\` and run the importer.
4. Review each import outcome and row-level rejection reason. Invalid manifests are rejected before row processing; verified partial files apply valid rows and retain rejection reasons.
5. Review the masked **Reports**, audit log, and office HOLD summary.
6. Download reports as CSV, JSON, or XML. Student numbers are masked in public report output.

### Signed source-file flow

The office/source export must be paired with `<file-name>.manifest.json`. The importer checks source/type, exact filename, SHA-256 digest, HMAC, timestamp window, and nonce replay before parsing data. For a synthetic local file, place it in `drop_folder\` and create its sidecar:

```powershell
python python.py sign-manifest "drop_folder\library_export.xml" --source library
python python.py run-imports
```

This local signing command demonstrates the contract; it does not replace the real source office's signature process. Processed data and manifest files move to `archive\`. Import activity is written to `logs\imports.log`.

## 4. Register students and provision staff/admin accounts

Student records must already be present in the Registrar masterlist. Students can register from the login screen using their active student number and matching full name; registration does not grant staff or admin privileges. The roster check is not independent identity verification, so obtain approval and use an institution-approved verification process before deployment.

Administrators should provision staff and admin accounts from PowerShell. The database must already contain the assigned office. Account creation prompts for the password without echoing it:

```powershell
python python.py create-user --username student1 --role student --student-number 2023-0001-14
python python.py create-user --username library.staff --role staff --office library
python python.py create-user --username hub.admin --role admin
```

Passwords must be at least 12 characters. The database stores PBKDF2-HMAC-SHA256 salted hashes, not plaintext passwords. Do not reuse real credentials for the demo.

The SQLite schema enforces one account per linked student. Back up the SQLite
file before any future schema migration; MySQL migration SQL is not compatible
with the runtime database.

## 5. Registrar integration

The bundled starter kit's Registrar API serves a fixed synthetic roster from
`IT312_Final_Project_Starter_Kit\registrar_students.json`. Its API is read-only;
there is no Registrar page or API endpoint for adding records. Use the
course-provided Registrar service for official roster data. For demo-only
records, you may edit the starter kit JSON file and restart its mock server.

The local `.env` should contain a base URL and a private development key. For
the bundled mock, use `http://127.0.0.1:8001/api/v1` as the URL. In PowerShell
window 1, load the key from `.env` and start the mock:

```powershell
$line = Get-Content .env | Where-Object { $_.StartsWith('REGISTRAR_API_KEY=') } | Select-Object -First 1
$env:REGISTRAR_API_KEY = $line.Substring('REGISTRAR_API_KEY='.Length)
.\.venv\Scripts\python.exe .\IT312_Final_Project_Starter_Kit\registrar_mock_api.py
```

Keep that window open. The mock health endpoint is
`http://127.0.0.1:8001/api/v1/health`. In another window, synchronize the roster:

```powershell
.\.venv\Scripts\python.exe python.py sync-registrar
```

The bundled file has 40 synthetic records, including one LOA record which is
synced as inactive. After sync, students can register with an active record or
an admin can create their Hub accounts through **Users**. These students and
example IDs/names are fictional; use the official Registrar service and its
authorized URL/key for real school data.

## 6. SQLite data tables

`database/schema.sqlite.sql` defines these tables:

| Table | Use |
|---|---|
| `offices` | Required clearance offices and stable office codes. |
| `students` | Registrar masterlist and active status. |
| `users` | Password hashes, roles, and linked student/office records. |
| `auth_sessions` | Hashed bearer tokens and expiration. |
| `clearance_records` | One current clearance result per student and office. |
| `audit_logs` | Who changed what and when, plus import/slip events. |
| `import_batches` | File verification result and imported/rejected counts. |
| `import_rejections` | Row reference and reason for each rejected record. |
| `clearance_slips` | Public code, signed payload, expiry, and revocation state. |
| `holidays` | Cached Nager.Date holidays by date/country. |

Use a SQLite client to inspect the private database under
`%USERPROFILE%\DNSC e-Clearance Hub\`. The application uses parameterized SQL
and does not provide direct database access to the browser.

## 7. Scheduled automation (R1/R2)

After configuring the Registrar key and confirming the SQLite database is available, register
three daily Windows Task Scheduler jobs from PowerShell in the project folder:

```powershell
.\.venv\Scripts\python.exe python.py install-schedule `
  --registrar-time 01:00 --import-time 02:00 --summary-time 02:15
```

The times are local 24-hour times; set the import time after the offices' source
exports arrive. Tasks run as the Windows account that registers them, so that
account must be logged in at the scheduled times and be able to access the
project, SQLite database, and output folders. The registrar sync runs first, followed by
imports and the daily HOLD summary. Run each command manually once before
relying on its schedule, and verify
`logs\imports.log`, `archive\`, and the dated CSV in `reports\`. Registration
creates or updates only the three named Hub tasks; it does not start them
immediately. To run while logged out, change the tasks' logon setting in
Windows Task Scheduler and provide the Windows credentials there.

## 8. Tests

Install dependencies as above, then run:

```powershell
python -m unittest discover -s tests -v
```

The automated tests use temporary SQLite databases for isolation. Perform the browser and API smoke checks in [docs/test-report.md](docs/test-report.md); these do not require MySQL.

## 9. Project documentation

- [Solution design and R1–R18 traceability](docs/solution-design.md) — architecture, transformation impact, security, and requirement evidence.
- [Basic system flow](docs/system-flow.md) — end-to-end data, role, and automation flow.
- [User guide](docs/user-guide.md) — step-by-step setup, student registration/login, staff actions, and admin tasks.
- [API specification](docs/api-spec.md) — Hub routes, roles, request/response shapes, and errors.
- [Data mapping and signed manifest contract](docs/data-mapping.md) — Registrar/CSV/XML fields, validation, and rejection behavior.
- [Test report / Appendix G](docs/test-report.md) — individual automated cases plus the separate live-smoke evidence status.
- [Front-end test checklist](docs/frontend-test-plan.md) — manual browser and API checks, tracked separately from automated tests.
- [Evaluation and final clearance checklist](docs/evaluation-readiness.md) — R18 rater process, rubric cross-check, milestones, and remaining evidence.
- [Final documentation source](docs/final-documentation.md) — Chapters 1–5 and the required Appendix A–I assembly guide.

## 10. Repository layout

```text
python.py                    Python CLI / server entry point
hub.py                       Flask REST API, authentication, and database access
integration_clients.py       Registrar and Nager.Date clients
importer.py                  HMAC validation, XML/CSV mapping, automation
database/schema.sqlite.sql   SQLite schema and office seed rows
assets/                      Shared browser styles, API client, PWA icon
modules/                     Student, staff, admin, and login pages
manifest.webmanifest         Installable PWA metadata
service-worker.js            App-shell cache; never caches API data
tests/                       Automated Python tests
docs/                        Design, mapping, API, test, user, evaluation guides
```

## 11. Important limits before final submission

- Use the exact source XML/CSV formats from the course starter kit and adjust the documented aliases if those files differ.
- The mock Registrar kit/API key and original starter files are not in this repository.
- For the group scope, verify the daily Task Scheduler jobs and capture evidence of successful scheduled runs.
- The final report must follow the course layout: title page, abstract of at most 250 words, Chapters 1–5, references, and Appendices A–I on short bond paper with one-inch margins.
- Obtain institutional approval before using real student records or deploying outside localhost. Use HTTPS and a managed secrets store for a deployed service.
- Complete R18 with 30 eligible outside raters using the official LMS rating sheet. Collect signatures and photo consent properly; never fabricate or alter evaluation evidence.
- Fill in actual team/section details, screenshots, results, contributions, and appendices before generating the single final PDF.
