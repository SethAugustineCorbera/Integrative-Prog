# Hub REST API Specification

Base URL: `http://127.0.0.1:8000/api` for local development. The Python server also serves the browser UI from `http://127.0.0.1:8000/`, so XAMPP is not required. All protected routes require `Authorization: Bearer <token>`. Request bodies are JSON unless an endpoint says multipart. Errors use `{"error":"...","code":"..."}`. Student numbers are masked in public report and audit responses.

| Method and path | Role | Request | Success | Main errors |
|---|---|---|---|---|
| `GET /health` | Public | — | `200 {"status":"ok","database":"connected"}` | `500` database unavailable |
| `POST /auth/register` | Public; student only | `{"username":"...","password":"...","student_number":"...","full_name":"..."}` | `201 {"message":"Student account created. You can now sign in."}` | `400` invalid input/roster mismatch, `409` username or student account exists, `503` no active Registrar records loaded |
| `POST /auth/login` | Public | `{"username":"...","password":"..."}` | `200 {"token":"...","expires_at":"...","user":{...}}` | `400` invalid body, `401` incorrect credentials, `403` unlinked account |
| `GET /auth/me` | Any signed-in user | — | `200 {"user":{...}}` | `401` missing/expired token |
| `POST /auth/logout` | Any signed-in user | `{}` | `200 {"message":"Logged out."}` | `401` missing/expired token |
| `GET /students/me/clearance` | Student | — | `200 {"student":{...},"overall":"HOLD","offices":[...]}` | `401`, `403`, `404` |
| `GET /students/clearance?student_number=...` | Staff/Admin | Exactly one `student_number` query parameter | `200` with current status; non-Registrar staff receive only their assigned office, while Registrar staff/Admin receive all offices | `400` invalid query/ID, `401`, `403`, `404` |
| `GET /offices/{office}/students?status=HOLD` | Staff/Admin | Optional `status=HOLD|CLEARED` | `200 {"office":{...},"students":[...]}` | `400` invalid status, `403` wrong office, `404` office |
| `POST /clearance/{student_number}/{office}/signoff` | Assigned staff | `{"reason":"Verified with office records"}` | `200 {"status":"CLEARED",...}` | `400`, `401`, `403`, `404` |
| `POST /clearance/{student_number}/{office}/hold` | Assigned staff | `{"reason":"Outstanding item"}` | `200 {"status":"HOLD",...}` | `400`, `401`, `403`, `404` |
| `GET /deadline` | Any signed-in user | — | `200 {"start_date":"...","deadline":"...","working_days":15,"skipped_days":[...]}` | `401`, `502` holiday API issue |
| `GET /reports/clearance?format=csv\|json\|xml` | Admin | `format` defaults to JSON | `200` with requested content type and masked identifiers | `400` unknown format, `403` |
| `GET /slips/me` | Student | — | `200` with the student's unique signed short code, QR SVG, legacy signed token, current office statuses and progress; repeated requests reuse the same unexpired slip (30 days) | `401`, `404` student record missing |
| `POST /slips/verify` | Staff/Admin | `{"code":"ECH-..."}` or `{"token":"..."}` | `200` with signature result, exact student number for the authenticated verifier, current overall status, office-by-office status and progress | `400` malformed input; `200 {"verified":false,...}` unknown/invalid/expired code |
| `POST /cards/register` | Admin | `{"card_id":"...","student_number":"..."}` | `201` new card linked to an active Registrar student; `200` when replacing the student's current card | `400` invalid input, `403` not Admin, `404` student missing, `409` inactive student or card assigned elsewhere |
| `POST /cards/verify` | Staff/Admin | `{"card_id":"..."}` | `200` with linked student and current clearance; non-Registrar staff receive only their assigned office | `400` invalid card ID, `403`, `404` unregistered card, `409` inactive student |
| `GET /audit` | Admin | — | `200 {"entries":[...]}` with actor, action, target, safe details and reason | `401`, `403` |
| `GET /imports` | Admin | — | `200 {"batches":[...],"rejections":[...]}` | `401`, `403` |
| `POST /admin/import` | Admin | `multipart/form-data`: `file` (XML/CSV), `manifest` (JSON sidecar) | `200` import counts/status | `400` rejected/invalid file, `401`, `403` |
| `POST /admin/sync-registrar` | Admin | `{}` | `200 {"synchronized":40}`; unreviewed active students remain pending Registrar review and staff-entered decisions are preserved | `401`, `403`, `502/503` Registrar failure/config |
| `GET /admin/hold-summary` | Admin | — | `200 {"holds":[...]}` | `401`, `403` |
| `GET /admin/users` | Admin | — | `200 {"users":[...],"offices":[...],"students":[...]}`; `students` contains active Registrar records for account assignment | `401`, `403` |
| `POST /admin/users` | Admin | `{"username":"...","password":"...","role":"staff","office_code":"library"}` (student role requires an existing active `student_number`) | `201 {"id":12,"message":"User account created."}` | `400` invalid fields/assignment, `401`, `403`, `409` duplicate login or student |
| `PUT /admin/users/{user_id}` | Admin | Username, role, active flag, and role-specific profile/assignment fields | `200` with `session_revoked` set to true or false | `400` invalid input/self-demotion/deactivation/last-admin, `401`, `403`, `404`, `409` conflict |
| `POST /admin/users/{user_id}/password` | Admin | `{"password":"new password (12+ characters)"}` | `200` password updated and target sessions revoked | `400` invalid password, `401`, `403`, `404` |

`GET /offices/{office}/students` and the HOLD-summary route are read-only. Staff may access only the queue for their assigned office; administrators may inspect every office. Student-ID and registered-card lookups return current status, not signed-slip verification; slip verification still requires the signed short code or token. Admins can register one card per active student, replacing the previous card when needed. Student accounts may view only their own status and cannot sign themselves off. The `POST /admin/import` endpoint requires both the source file and its signed manifest in the multipart request.

## Example login and student status

```http
POST /api/auth/login
Content-Type: application/json

{"username":"demo.student","password":"<local DEMO_PASSWORD>"}
```

```http
GET /api/students/me/clearance
Authorization: Bearer <token>
```

```json
{
  "student": {
    "student_number": "DEMO-0001",
    "full_name": "Alex Rivera",
    "program": "BSIT",
    "year_level": 3
  },
  "overall": "CLEARED",
  "offices": [
    {
      "office": "Registrar",
      "office_code": "registrar",
      "status": "CLEARED",
      "reason": "Active in Registrar masterlist; awaiting manual review.",
      "updated_at": "..."
    }
  ]
}
```

## Implementation notes

- Tokens are random, expire after eight hours, and are stored only as SHA-256 hashes.
- Public registration creates student-role accounts only and requires an active student number/full-name match (extra whitespace in the name is ignored). Staff and admin accounts must be provisioned by an administrator. If the Registrar API key is missing or still a placeholder, registration explains that configuration is required. The roster check is not an independent identity-verification process.
- Admin account-management operations are recorded in `audit_logs`; passwords and password hashes are never included in account-list or audit responses. Changing a role/assignment, deactivating an account, or resetting its password revokes its active sessions.
- The runtime account audit actions and constraints are defined in `database/schema.sqlite.sql`. The original MySQL schema and migration script are not used by the SQLite runtime.
- A staff account can only change records for its assigned office; admin is read-only for office queue views.
- A slip's signed payload expires after 30 days and is reused for that student until expiry or revocation. The public short code is a server-side lookup key; verification still validates the stored HMAC signature and expiry.
- The slip response includes a locally generated SVG QR that encodes the exact same `public_code` short code displayed on the slip. The legacy signed token remains available in the response for compatibility; no student data or tokens are sent to a third-party QR service.
- Registrar and holiday API error details are surfaced as service errors. The API does not silently substitute sample data.
