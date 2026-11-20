# Solution Design — DNSC e-Clearance Hub

## 1. Problem and stakeholders

End-of-semester clearance currently requires students to visit offices that keep separate records and use separate formats. Students may have to repeat visits when a form is lost, while offices experience long queues near exam or graduation deadlines.

The Hub provides one authenticated view of office-by-office clearance. Its stakeholders are students, office staff, Registrar personnel, administrators, and the project team. Registrar remains the master source for student identity; Library and Accounting exports and Student Affairs entries are matched to that masterlist.

## 2. Objectives and scope

- Pull student master records from the Registrar REST API.
- Import signed Library XML and Accounting CSV snapshots, normalize them, and retain rejection reasons.
- Track CLEARED/HOLD per required office, an overall result, and staff actions.
- Expose a role-protected REST API used by the browser client.
- Issue short, signed clearance codes and verify them at an office.
- Calculate a working-day deadline using Philippine public holidays.
- Export Registrar reports with masked student numbers and maintain an audit log.
- Run imports and create daily office HOLD summaries from a Python command.

The implementation is intended for synthetic/demo records until the school has approved its privacy, security, hosting, and data-retention arrangements. Student Affairs staff actions are supported through the office queue; the installation team must create an account for that office to use the same workflow.

## 3. Architecture

```text
Registrar mock REST API -- JSON --> Registrar client ----+
Nager.Date public API ------ JSON --> Deadline client ----+--> Python Flask Hub API
Library signed XML --------- file --> Python import script +--> XAMPP MySQL database
Accounting signed CSV ----- file --> Python import script +--> audit / reject logs
Student Affairs ----------- form --> Hub API ------------+
                                          |
                     +--------------------+--------------------+
                     |                    |                    |
                Student UI           Staff UI             Admin UI
                     +------ REST/JSON only; no DB access ------+
```

The browser is served by XAMPP Apache. The Python Flask API runs locally on port 8000 and connects to the XAMPP MySQL service. MySQL is retained under the instructor-approved stack decision; include the approval evidence in the final submission if required. The front end calls only the API; it has no database credentials or direct SQL access. Files enter through the import command or authenticated admin upload. Completed or explicitly rejected files and manifests are archived; operational failures leave them in the drop folder for retry.

Students may register an account only when their active student number and name match an existing Registrar record. This check is not independent identity verification; staff and admin accounts remain administrator-provisioned.

## 4. Data flow

1. The admin synchronizes the Registrar masterlist. The client handles paging, API-key authentication, timeouts, HTTP errors, and malformed JSON.
2. The importer validates a sidecar manifest's HMAC, SHA-256 digest, timestamp, file type, and unique nonce before parsing source rows.
   Successfully processed files and ordinary rejected files are archived; operational failures leave the source and manifest in the drop folder for retry.
3. Each row is allow-listed, normalized, matched to a Registrar student, and mapped to an office clearance record. Rejected rows are stored with a row reference and reason.
4. Students and authorized staff access status or update an office record through the REST API. Clearance changes create audit events.
5. A student whose required offices are all CLEARED may request a signed slip. The response includes a QR encoding its signed token and a short code; office staff or an admin verify either through the API.
6. The deadline service uses Nager.Date holiday data and skips weekends. Admins can export CSV, JSON, or XML with masked student numbers.
7. `python.py install-schedule` registers daily Windows tasks for Registrar sync, imports, and the per-office HOLD summary.

## 5. Emerging technology

The group scope uses two selected components. First, the browser client is an
installable, mobile-friendly Progressive Web App with an app manifest and
service-worker app-shell caching; sensitive API responses are not cached.
Second, the clearance slip displays a locally generated QR code containing the
HMAC-signed slip token, alongside a short code for manual entry. The Hub
verifies the QR token or short code through the secured API, including expiry
and revocation checks. QR generation is local; no student details or token are
sent to an external QR service. These components support mobile self-service
and counter verification without requiring a separate native application.

The transformation replaces a paper form carried from office to office with a
shared, role-protected status view. Students can identify the office and reason
for an unresolved HOLD before making a visit, while staff keep their existing
systems and use the Hub only to record the office's decision. Registrar remains
the identity master, and Library/Accounting provide signed files; the Hub
adapts those existing sources rather than requiring offices to replace them.
This reduces duplicate entry and makes sign-offs traceable, while the
institution still controls official records, access, and retention.

The signing keys remain in environment configuration. A deployed installation must use HTTPS and a managed secrets store; the local XAMPP setup is for development/demo use only.

## 6. Security controls

- PBKDF2-HMAC-SHA256 salted password hashes and expiring opaque bearer sessions.
- Server-side role and office checks on every protected route.
- Student-only registration linked to an active roster record; no public role selection.
- Parameterized SQL statements and allow-listed request fields.
- HMAC-SHA256 manifests with digest, timestamp, and replay-nonce checks.
- Signed, expiring slip payloads; only a hash of the bearer session token is stored.
- Masked student numbers in reports and the admin audit view.
- CORS restricted to configured front-end origins; local API binds to loopback by default.
- Import logs omit row contents and secrets. Reject records retain a row reference and reason, not the original personal data.

## 7. Requirement traceability

| Requirement | Implementation evidence | Completion note |
|---|---|---|
| R1 | `python.py run-imports`, `importer.py`, timestamped `logs/imports.log`, file archive | Requires signed files in the drop folder; operational failures leave them available for retry. |
| R2 | `python.py hold-summary`, daily per-office CSV in `reports/`, `python.py install-schedule` | Run the installer on the Hub machine and confirm the resulting Windows tasks. |
| R3 | This design document and `docs/final-documentation.md` | Add actual team/set/submission details. |
| R4 | Mobile-friendly installable PWA and locally generated QR clearance slip | Two selected components: app-shell caching only (no API data) and an SVG QR encoding the signed token. |
| R5 | `integration_clients.py`, Registrar sync endpoint and CLI | Configure the mock service URL and API key from the course starter kit. |
| R6 | `/api/deadline`, Nager.Date client, weekend/holiday calculation | Requires public network access on first request for each year. |
| R7 | Flask routes in `hub.py` and `docs/api-spec.md` | The documented Hub API exceeds the group minimum of eight endpoints; the table specifies methods, roles, request/response shapes, and errors. |
| R8 | Login, student registration, and role-specific pages in `modules/` | Web views are provided for student, staff, and admin; all browser data access uses the Hub API. Registration links only to an active roster entry. |
| R9 | `importer.py` and `docs/data-mapping.md` | Source files must use the documented aliases/schema or be mapped before import. |
| R10 | `/api/reports/clearance` CSV/JSON/XML | Exports mask student numbers. |
| R11 | API allow-lists, typed values, file/manifest checks | Rejects invalid bodies, query values, file types, and rows. |
| R12 | Login, student registration, PBKDF2, sessions, role and office guards | Staff/admin accounts are created with the Python CLI; roster matching is not independent identity verification. |
| R13 | Parameterized SQL; `.env.example`; `.gitignore` | The team must keep its actual `.env` out of Git history. |
| R14 | HMAC manifest verification, digest and nonce replay check | The local signing command is for controlled demo files only. |
| R15 | HMAC-signed slip token, QR display, and short-code/token verification route | The QR carries the signed token; verification checks signature, expiry, revocation, and the linked student record. |
| R16 | Masked exports and audit events for holds, sign-offs, imports, and slips | Real records must remain restricted to authorized users. |
| R17 | `tests/test_hub.py`, `docs/test-report.md` | The current automated run has 79 passing cases (above the group minimum of 20), including SQL-injection, expired-session, wrong-role, tampered-file, expired-slip, and QR response/rendering coverage. Rerun and attach evidence from the final environment. |
| R18 | `docs/evaluation-readiness.md` | Requires 30 real outside raters, signed forms, and consented photos; no evidence is generated by code. |
