# User Guide

## Before using the Hub

The operator must start the Python API and sign in with an account created for the correct role. Start XAMPP Apache only if serving the browser front end through XAMPP. The Hub stores its SQLite database outside Apache's document root; the browser never connects directly to the database.

## Student account says the Registrar record is missing?

The Hub does **not** have a Registrar data-entry page. The Registrar system is the
official masterlist and is read through the Registrar API. The Hub's
**Sync Registrar masterlist** button only copies records from that API; it
cannot add students to the Registrar system. The **Users** page creates Hub
accounts for students already present in the synced roster; it does not create
Registrar records.

The bundled starter kit has now been configured locally and its synthetic
roster has been synced: 40 records total, 39 active and one LOA/inactive.
Student self-registration can now use an active starter-kit record. These
records are fictional, for local testing only, and are not official student
records.

### Step-by-step: make a student able to register and log in

1. **Choose the roster source.** The repository now includes
   `IT312_Final_Project_Starter_Kit`, whose read-only mock serves 40 synthetic
   students from `registrar_students.json`. For real school data, obtain the
   official Registrar service URL and API key from the LMS or instructor. Do
   not put a real API key in this repository, screenshots, messages, or source
   code.
2. **Add or confirm the student in the Registrar source.** Use the Registrar
   service's own admin page, fixture/data file, or instructions to add the
   official student record (student number, full name, program, year, email,
   and active status). That screen belongs to the Registrar service, not to
   the Hub. The bundled mock is read-only and has no add-student page or POST
   endpoint. To add a demo-only student, edit
   `IT312_Final_Project_Starter_Kit/registrar_students.json` using the existing
   record format and restart the mock server. For example, add one new object
   to its `students` array, using a unique student ID:

   ```json
   {
     "student_id": "2026-12345",
     "last_name": "Example",
     "first_name": "Demo",
     "middle_initial": "A",
     "program_code": "BSIT",
     "program_name": "Bachelor of Science in Information Technology",
     "year_level": 1,
     "email": "demo.example@example.invalid",
     "status": "ENROLLED"
   }
   ```

   This entry is fictional and for testing only. Restart the mock after
   editing, then sync again. For official data, use the
   school's approved Registrar process; do not insert a made-up record into
   the Hub SQLite database.
3. **Configure the Hub connection locally.** In the project folder, make a
   local `.env` file by copying `.env.example` only if one does not already
   exist:

   ```powershell
   if (-not (Test-Path .env)) { Copy-Item .env.example .env }
   notepad .env
   ```

   For the bundled demo, set `REGISTRAR_API_URL` to
   `http://127.0.0.1:8001/api/v1` and `REGISTRAR_API_KEY` to a private local
   development key. For an official service, use its assigned URL/key instead.
   Keep existing
   secrets unchanged; set `DB_PATH` only if you need a non-default SQLite
   location. Save `.env`; do not commit it or share the key. If `.env` already
   exists, edit it instead of overwriting it.
4. **Start the mock API for the bundled demo.** In one PowerShell window, load
   the key from `.env` and run the mock:

   ```powershell
   $line = Get-Content .env | Where-Object { $_.StartsWith('REGISTRAR_API_KEY=') } | Select-Object -First 1
   $env:REGISTRAR_API_KEY = $line.Substring('REGISTRAR_API_KEY='.Length)
   .\.venv\Scripts\python.exe .\IT312_Final_Project_Starter_Kit\registrar_mock_api.py
   ```

   Leave this window running. Its health endpoint is
   `http://127.0.0.1:8001/api/v1/health`. One ready-to-register synthetic
   example from the bundled data is student number `2026-29417`, name
   `Mark D. Navarro`. No Hub account has been created for it yet.
5. **Restart the Python API.** In the PowerShell window running the Hub API,
   press
   `Ctrl+C`, then start it again from the project directory:

   ```powershell
   .\.venv\Scripts\python.exe python.py serve
   ```

   Leave this window running. Check `http://localhost:8000/api/health` and
   confirm the database reports `"connected"`.
6. **Sync the roster.** Sign in to the Hub as an administrator, open
   **Import monitor**, and click **Sync Registrar masterlist**. A success
   message reports how many records were synchronized. Alternatively, run this
   in another PowerShell window from the project directory:

   ```powershell
   .\.venv\Scripts\python.exe python.py sync-registrar
   ```

   A `503` or `502` means the API URL/key is missing or rejected, or the
   Registrar service is unavailable. Check the URL, key, and that the
   Registrar service is running. The bundled mock intentionally returns HTTP
   503 once per ten requests; the Hub client retries temporary server errors.
   If sync reports zero records, check that the source roster actually contains
   active records.
7. **Create the Hub account.** Once sync succeeds, use either option:
   - **Student self-registration:** Open
     `http://localhost/Integrative-Prog/`, choose **Register an account**, and
     enter the student's exact roster student number and name, a unique
     username, and a password of at least 12 characters. Return to login and
     sign in with that new username/password.
   - **Admin-created account:** Sign in as an admin, open **Users**, choose
     **Student** in **Create account**, select the active student record, enter
     a unique username and initial password (at least 12 characters), confirm
     the password, and click **Create account**. Give the initial password to
     the student privately. The Hub does not email it.
8. **Verify login.** Return to the login page, enter the Hub username and
   password, and select **Log in**. A successful student login opens the
   student page. The login is a Hub account; the student does not log
   into the Registrar service with these credentials.

### What common messages mean

- **“Student registration is not configured yet” / “No active Registrar
  records are loaded”**: the Registrar API key is missing/placeholder, sync has
  not run, or the returned roster has no active students. Complete steps 1–6.
- **Student number/name do not match**: compare the entered values with the
  official active Registrar record. Use the same student number and name; the
  Hub ignores extra spaces and letter case in the name.
- **Account already exists**: that student already has a Hub account, or the
  chosen username is already used. Try the existing login. If the student
  cannot access the account, an admin can set a new password from **Users**.
- **Cannot reach the Hub API**: start/restart the Python API and make sure the
  page is opened from XAMPP at `http://localhost/Integrative-Prog/`, not by
  opening an `.html` file directly.
- **Login rejected**: use the Hub username and password created in step 7.
  Registrar API credentials are not student login credentials.

## Student

### Register and sign in

1. Make sure your active student record has already been synchronized from the Registrar masterlist. If it has not, ask the Hub administrator to follow **Step-by-step: make a real student able to register and log in** above.
2. On the login page select **Register an account** and enter your student number, the matching name on the Registrar record, a username, and a password of at least 12 characters.
3. After the account is created, enter the new username and password on the login form and select **Log in**.
4. If registration says the details do not match, contact the Registrar or Hub administrator to confirm the roster entry. Public registration is student-only; it is not an independent identity-verification method.

After signing in:

1. Review the overall result and each required office's CLEARED/HOLD status and reason.
2. Resolve holds with the named office. The student view is read-only.
3. When every required office is CLEARED, open **Clearance slip** and show the signed QR code or short code to an office verifier.
4. Open **Deadline** for the configured number of working days and the Philippine holidays/weekends skipped.
5. Use **Log out** to invalidate the API session.

## Office staff

1. Sign in with an account assigned to your office.
2. Use **Office queue** to review active students. A staff account cannot access another office's queue.
3. Choose **Sign off** only after checking the authoritative office record. Add a HOLD with a clear reason when an outstanding item exists.
4. Use **HOLD summary** for the office's current unresolved records.
5. Use **Verify slip** to enter a student's signed short code or full signed token. A verifier may scan the QR with a QR reader and enter the returned token. The result shows whether the slip is valid, expired, revoked, or unknown.
6. Every sign-off and hold action is recorded in the admin audit log.

## Admin

1. Sign in with an admin account.
2. On **Import monitor**, upload a Library XML or Accounting CSV together with its signed manifest. The Hub validates the file and reports imported and rejected row counts.
3. Select **Sync Registrar masterlist** to call the configured Registrar API.
4. Open **Users** to view/search accounts; filter by role or active status; create a student, staff, or admin account; edit the login ID, role, activation, linked student, profile, or staff office; or set a new password. Student accounts must link to an existing active Registrar record, and staff accounts require an office assignment.
5. Account creation requires the administrator to choose an initial password. Password reset requires a new password and signs out all existing sessions. Share initial/reset passwords through an approved private channel; this system does not send email or password-reset links.
6. The last active administrator cannot be deactivated or demoted, and an administrator cannot deactivate or demote their own account.
7. Review **Reports** and download CSV, JSON, or XML. Student numbers are masked in each report.
8. Review **Audit log**, **HOLD summary**, and **Import monitor** for operational events, including account changes.
9. Admin queue pages are read-only; office sign-off and HOLD changes require an assigned staff account.

## Import outcomes

- **COMPLETED**: manifest and all rows validated.
- **PARTIAL**: manifest passed; valid rows were applied and invalid rows logged with row numbers and reasons.
- **REJECTED**: manifest/file verification failed or the import was not parseable. No source rows were applied.

On the admin screen, the rejection table uses batch ID and row reference rather than copying student data. For incident follow-up, use the original source file only if permitted by the institution's data policy.

## Privacy and consent

Only fictional local demo data is supplied by the code. Do not use real student records in a public demo. Rater names, signatures, and photos are personal data: collect them only through the official project evaluation process and with the required consent.
