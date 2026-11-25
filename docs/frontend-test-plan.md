# Front-End and SQLite Smoke-Test Plan

This is a manual verification checklist for a presentation setup. The automated Python suite uses temporary SQLite databases and does not replace these browser and API checks. Record the date, browser, test account roles, actual outcome, and any issue for each executed case.

## Setup

1. Configure the local `.env`. For a new installation only, initialize the database with `python python.py init-db`; do not run this on the migrated database.
2. Start XAMPP Apache if needed for the browser front end, then start the Flask API with `python python.py serve`.
3. Confirm `http://localhost:8000/api/health` reports a connected database.
4. Seed fictional accounts with `python python.py seed-demo`, using a unique local `DEMO_PASSWORD`.
5. Open `http://localhost/Integrative-Prog/` in a browser and keep the API console available for errors.

## Manual cases

| ID | Scenario | Steps | Expected result | Actual result / evidence |
|---|---|---|---|---|
| FE-01 | API and database startup | Open `/api/health`. | HTTP 200 and database status `connected`; no database credentials appear in the response. | Passed 2026-11-14: HTTP 200, database connected. |
| FE-02 | Invalid login | Submit an unknown username or incorrect password. | Login remains on the page, shows an error, and does not create an authenticated session. | Pending |
| FE-03 | Student login and status | Sign in as `demo.student`. | Student clearance page loads through the API and displays the linked student's office records and overall status. | Pending |
| FE-04 | Student office boundary | While signed in as a student, request the office queue route. | API rejects the request; changing browser UI state cannot grant staff access. | Pending |
| FE-05 | Staff office queue | Sign in as `demo.library`. | Only the assigned Library queue is available. | Pending |
| FE-06 | Staff sign-off | Sign off an eligible queued record with a reason. | The status changes to CLEARED and the audit record is written. | Pending |
| FE-07 | Staff HOLD | Place a HOLD with a reason; then try without a reason. | Valid HOLD is saved with an audit event; missing reason is rejected with a visible error. | Pending |
| FE-08 | Cross-office staff restriction | Attempt to access or change a different office's record. | API rejects the action; no record is changed. | Pending |
| FE-09 | Clearance slip eligibility and QR | Sign in as a held student, then as a fully cleared student. | Held account cannot issue a slip; cleared account sees a real QR encoding the signed token and a short code; the token/code verifies through the API. | Pending |
| FE-10 | Slip verification | Verify a valid code, then a modified/expired code. | Valid slip verifies; invalid or expired slip is reported as unverified. | Pending |
| FE-11 | Admin access and import monitor | Sign in as `demo.admin`; open the monitor. | Admin can see import status and available admin actions; staff and student accounts cannot use these routes. | Pending |
| FE-12 | Signed import | Upload a sample file with a valid matching manifest, then change the file and upload again. | Valid import reports row counts; changed content is rejected before data is applied. | Pending |
| FE-13 | Masked reports | Download JSON, CSV, and XML reports. | Each format is valid and student identifiers are masked in public report output. | Pending |
| FE-14 | Logout and session expiry | Log out, then use a previously obtained token. | Logout invalidates the session; protected API route requires authentication. | Pending |
| FE-15 | PWA app shell | Open browser developer tools and reload the page. | Static app-shell assets may be cached; API responses and sensitive student data are not cached by the service worker. | Pending |
| FE-16 | Student registration and login | Register using a student number/name already in the active roster, then sign in with the new credentials. Try a mismatched name and a second account for the same student. | Matching student can register and log in; mismatches and duplicate student accounts are rejected; registration cannot select staff/admin. | Pending |
| FE-17 | Registration without a roster | Attempt student registration when no active Registrar records are loaded. | The API returns a clear message that the administrator must sync the Registrar masterlist; it does not create an unverified student record. | Passed 2026-11-14 and rechecked 2026-11-15: browser displayed the missing Registrar API key guidance for a synthetic request. |
| FE-18 | Admin user management | As admin, create an assigned staff account; change its role/office; reset its password; verify old sessions no longer work; then inspect the user audit log. | Only admins can manage accounts; role/office assignments are validated; account events appear in Audit log; passwords and sensitive values are not listed or audited. | Pending |
| FE-19 | Admin account edit CORS | From the XAMPP-served Users page, edit an account and save a valid change. | The API preflight allows PUT from the configured frontend origin; the update completes and the account list refreshes. | Pending |

## Completion record

| Date | Tester | Browser/version | Passed | Failed | Notes/evidence location |
|---|---|---|---:|---:|---|
| Pending | — | — | — | — | Complete during the actual XAMPP presentation smoke test. |

Do not mark a case passed until it has been run against the intended XAMPP setup. Capture only fictional demo data in screenshots. Do not include real student data, credentials, or tokens in evidence.
