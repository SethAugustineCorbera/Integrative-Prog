# Basic System Flow

This guide explains the main user and data flows in the DNSC e-Clearance Hub.
The browser UI is served by XAMPP Apache; the Python Flask API validates requests
and reads or writes the XAMPP MySQL database. The browser never connects directly
to MySQL.

## 1. Start the system

1. Start **Apache** and **MySQL** in the XAMPP Control Panel.
2. From the project folder, start the API in PowerShell:

   ```powershell
   python python.py serve
   ```

3. Keep the API terminal open. Check `http://localhost:8000/api/health`; the
   response should report `"status":"ok"` and `"database":"connected"`.
4. Open `http://localhost/Integrative-Prog/` through Apache. Do not open the
   HTML file directly.
5. Sign in with an account provisioned for the correct role.

If the page reports that it cannot complete an API request, confirm the API is
running and `FRONTEND_ORIGINS` in `.env` includes the browser origin, normally
`http://localhost`. Restart the API after changing `.env`.

## 2. Load the student roster

Student accounts must be linked to an active record from the Registrar
masterlist. The system intentionally does not create unverified student records
from an account form.

1. For a local demo, use the bundled read-only Registrar mock and its 40
   synthetic records in `IT312_Final_Project_Starter_Kit`. For official data,
   obtain the authorized Registrar URL and API key from the course environment.
2. Set `REGISTRAR_API_URL` and `REGISTRAR_API_KEY` in `.env`. For the bundled
   mock the URL is `http://127.0.0.1:8001/api/v1`; start its Python server and
   leave it running.
3. Restart the Hub API so it reads the new settings.
4. Sign in as an administrator and open **Import monitor**.
5. Select **Sync Registrar masterlist** and confirm the synchronization result.
6. Open **Users**. Active Registrar records will be available for student
   account creation and assignment.

The bundled Registrar mock is read-only and has no add-student page. Its
synthetic demo roster can be extended in `registrar_students.json`; official
records must come from the approved Registrar source. If there are no active
roster records, student registration and admin creation of student accounts
are blocked. Do not enter fabricated records as official students.

## 3. Student flow

1. A student selects **Register an account** from the login page.
2. The student supplies their student number, the name matching the active
   Registrar record, a unique username, and a password of at least 12
   characters.
3. The API verifies the student number and name against the active roster,
   prevents duplicate accounts, and creates a student-role account.
4. The student signs in and opens **Clearance status** to review office
   decisions.
5. Staff record a sign-off or HOLD. Once all required offices clear the student,
   the student can issue a clearance slip containing a QR for the signed token
   and a short code for manual verification.

## 4. Staff flow

1. An administrator creates a staff account and assigns Registrar, Library,
   Accounting/Cashier, or Student Affairs. The staff account opens a separate
   page for that office.
2. Registrar staff view the read-only, synchronized official student masterlist
   in JSON. An administrator triggers synchronization from the Registrar API;
   the Hub does not create or edit Registrar records.
3. Library staff review XML-imported unreturned books and fines.
   Accounting/Cashier staff review CSV-imported tuition and fee balances.
   Authorized staff may sign off or place a HOLD after checking their office's
   records.
4. Student Affairs staff use the Hub web form to record membership/obligation
   details, equipment review, and their chosen status and reason.
5. The API enforces the office assignment and records each decision in the
   audit log.

## 5. Administrator flow

1. An administrator signs in and reviews **Import monitor**, **Reports**, and
   **HOLD summary** as needed.
2. In **Users**, an administrator can create student, staff, or admin accounts;
   edit login IDs, roles, profiles and assignments; activate or deactivate
   accounts; and set passwords.
3. Student accounts must use an active Registrar record; staff accounts must
   have a valid office. Initial and reset passwords must be shared privately;
   the application does not send email or password-reset links.
4. Account role/assignment changes, deactivation, and password resets invalidate
   the affected account's existing sessions. Account changes are recorded in
   **Audit log** without returning passwords, hashes, secrets, tokens, or slip
   codes.
5. Review **Audit log** for account changes, clearance actions, imports, and
   clearance-slip activity. Student numbers are masked in audit output.

## 6. Daily automation flow

1. Put each signed XML/CSV source file and its manifest in `drop_folder\`.
2. The scheduled Registrar task refreshes the active masterlist.
3. The import task verifies signatures and maps rows. Valid and rejected
   outcomes are archived; an operational failure leaves the files in the drop
   folder for retry.
4. The summary task writes a dated, per-office CSV under `reports\`. It includes
   active students with an explicit HOLD and those awaiting an office review.
5. To register the three daily Windows tasks, run
   `python python.py install-schedule` and adjust the times for source arrival.

## 7. Database and security boundaries

- MySQL is the source of truth for users, student records, clearance decisions,
  active sessions, and audit events.
- Passwords are stored as salted PBKDF2 hashes. The browser never receives a
  password hash.
- Admin-only endpoints enforce role authorization in the API, not only in the
  page navigation.
- Staff can change clearance records only for their assigned office.
- QR codes are generated locally from the signed slip token; the verification
  API validates token signature, expiry, and revocation without an external QR
  service.
- Run `database/migrations/001_user_management_audit.sql` once on an existing
  database created before account-management audit actions were added.

