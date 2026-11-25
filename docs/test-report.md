# Appendix G — Test Report

Run the API and import/security tests from the repository root with:

```powershell
python -m unittest discover -s tests -v
```

The suite uses temporary SQLite databases for isolation. The application uses
the migrated SQLite database outside Apache's document root. Run the separate
API/browser checks in [frontend-test-plan.md](./frontend-test-plan.md).

## Latest automated run

| Run date | Environment | Cases | Passed | Failed | Evidence |
|---|---|---:|---:|---:|---|
| 2026-11-25 | Project Python environment, temporary SQLite test database | 91 | 91 | 0 | `python -m unittest discover -s tests -v`; exit code 0. |

The input/scenario is the named test and fixture in `tests/test_hub.py`.
“Assertions passed” is the observed actual result: the test runner reported
`ok` for that case, and its expected-behavior assertions completed. The
individual test method contains the concrete fixture values and requests.

## Individual automated cases

### Passwords and scheduled automation

| Test case / input scenario | Expected result | Actual result | Status |
|---|---|---|---|
| `test_hash_verifies_correct_password` — correct password and its stored hash | Password verification succeeds. | Assertions passed. | PASS |
| `test_password_hashes_use_independent_salts` — hash the same password twice | Salts/hashes differ while both verify. | Assertions passed. | PASS |
| `test_wrong_password_is_rejected` — correct hash with a different password | Verification fails. | Assertions passed. | PASS |
| `test_malformed_password_hash_is_rejected` — malformed stored hash | Verification fails safely. | Assertions passed. | PASS |
| `test_schedule_installer_registers_daily_jobs_in_order` — valid daily task times | Registrar, importer, and summary tasks are registered in order. | Assertions passed. | PASS |
| `test_schedule_installer_rejects_invalid_time_before_creating_tasks` — invalid schedule time | Validation fails before any task is created. | Assertions passed. | PASS |
| `test_tls_is_disabled_when_certificates_are_not_configured` — no TLS paths | Local HTTP mode remains available. | Assertions passed. | PASS |
| `test_tls_accepts_existing_certificate_and_key` — existing cert/key paths | TLS configuration returns both paths. | Assertions passed. | PASS |
| `test_tls_requires_both_certificate_and_key` — only one TLS path | Configuration fails with a clear error. | Assertions passed. | PASS |
| `test_tls_rejects_missing_certificate_files` — missing cert/key files | Configuration fails instead of starting with invalid paths. | Assertions passed. | PASS |

### Signed files and data mapping

| Test case / input scenario | Expected result | Actual result | Status |
|---|---|---|---|
| `test_valid_signed_manifest_passes` — valid file and HMAC manifest | Manifest verification succeeds. | Assertions passed. | PASS |
| `test_changed_source_file_fails_digest_check` — file bytes changed after signing | Digest verification rejects the file. | Assertions passed. | PASS |
| `test_changed_manifest_field_fails_signature_check` — signed metadata changed | HMAC verification rejects the manifest. | Assertions passed. | PASS |
| `test_missing_manifest_field_is_rejected` — required manifest field omitted | Manifest is rejected. | Assertions passed. | PASS |
| `test_invalid_source_type_is_rejected` — unsupported source value | Manifest is rejected. | Assertions passed. | PASS |
| `test_wrong_extension_is_rejected` — source and file extension disagree | Manifest/file is rejected before import. | Assertions passed. | PASS |
| `test_stale_manifest_is_rejected` — timestamp outside allowed window | Manifest is rejected. | Assertions passed. | PASS |
| `test_import_operational_error_leaves_source_and_manifest_in_drop_folder` — database operational failure | Source and manifest remain available for retry. | Assertions passed. | PASS |
| `test_library_xml_records_are_extracted` — valid Library XML | Borrower rows are parsed. | Assertions passed. | PASS |
| `test_malformed_library_xml_is_rejected` — invalid XML bytes | Parser reports a rejection; no valid import is claimed. | Assertions passed. | PASS |
| `test_library_issues_map_to_hold` — positive Library issues | Clearance maps to HOLD with a reason. | Assertions passed. | PASS |
| `test_zero_library_issues_map_to_cleared` — zero books/fines | Clearance maps to CLEARED. | Assertions passed. | PASS |
| `test_accounting_thousands_separator_is_parsed` — CSV balance with grouping separator | Balance parses as a number. | Assertions passed. | PASS |
| `test_negative_accounting_balance_is_rejected` — negative amount | Row is rejected by allow-list/business validation. | Assertions passed. | PASS |
| `test_import_applies_valid_rows_and_records_unknown_student` — valid row plus unknown student | Valid row applies; unknown-student row is logged as rejected. | Assertions passed. | PASS |
| `test_import_replay_nonce_is_rejected` — previously used manifest nonce | Replay is rejected. | Assertions passed. | PASS |
| `test_tampered_import_file_is_rejected_before_mapping` — modified signed source file | File is rejected before row mapping or application. | Assertions passed. | PASS |

### Registrar and holiday integrations

| Test case / input scenario | Expected result | Actual result | Status |
|---|---|---|---|
| `test_registrar_json_maps_student_aliases` — supported Registrar JSON aliases | Student fields map to the Hub schema. | Assertions passed. | PASS |
| `test_registrar_bad_json_shape_is_reported` — malformed response shape | Integration error is surfaced. | Assertions passed. | PASS |
| `test_registrar_bad_student_field_is_reported` — invalid required student field | Integration error identifies invalid data. | Assertions passed. | PASS |
| `test_starter_kit_registrar_fields_are_mapped` — bundled mock field names | Starter-kit records map to the Hub schema. | Assertions passed. | PASS |
| `test_starter_kit_has_next_metadata_is_followed` — starter pagination with `has_next` | Client requests the next page. | Assertions passed. | PASS |
| `test_registrar_next_page_metadata_is_followed` — alternate next-page metadata | Client follows the next page. | Assertions passed. | PASS |
| `test_holiday_query_rejects_invalid_country` — invalid country code | Invalid query is rejected. | Assertions passed. | PASS |

### Hub API, identity, roles, and office workflows

| Test case / input scenario | Expected result | Actual result | Status |
|---|---|---|---|
| `test_health_endpoint_checks_database` — health request with test database | API reports database health. | Assertions passed. | PASS |
| `test_protected_route_rejects_missing_token` — protected request without bearer token | Request is unauthorized. | Assertions passed. | PASS |
| `test_login_rejects_unknown_credentials` — unknown username/password | Login is rejected. | Assertions passed. | PASS |
| `test_login_rejects_sql_injection_username` — SQL-injection-shaped username | Login is rejected without changing/querying unrelated records. | Assertions passed. | PASS |
| `test_login_rejects_unknown_fields` — login JSON with unexpected field | Input is rejected by the allow-list. | Assertions passed. | PASS |
| `test_student_registration_creates_account_that_can_log_in` — active matching roster record | Student account is created and can authenticate. | Assertions passed. | PASS |
| `test_student_registration_rejects_mismatched_student_details` — student number/name mismatch | Registration is rejected and no account is created. | Assertions passed. | PASS |
| `test_student_registration_explains_when_roster_is_empty` — no active roster records | Clear registration-block reason is returned. | Assertions passed. | PASS |
| `test_student_registration_explains_when_configured_roster_is_empty` — configured but empty Registrar roster | Clear registration-block reason is returned. | Assertions passed. | PASS |
| `test_student_registration_cannot_choose_staff_or_admin_role` — submitted privileged role | Public registration cannot create staff/admin. | Assertions passed. | PASS |
| `test_student_registration_requires_a_strong_password` — password below policy | Registration is rejected. | Assertions passed. | PASS |
| `test_student_gets_only_linked_clearance` — student requests own clearance | Response contains only the linked student's status. | Assertions passed. | PASS |
| `test_student_cannot_read_office_queue` — student requests staff queue | Role guard denies access. | Assertions passed. | PASS |
| `test_staff_reads_assigned_office_queue` — staff requests own office | Assigned-office queue is returned. | Assertions passed. | PASS |
| `test_staff_cannot_read_another_office` — staff requests different office | Office guard denies access. | Assertions passed. | PASS |
| `test_invalid_office_status_query_is_rejected` — unsupported status filter | Query parameter is rejected. | Assertions passed. | PASS |
| `test_staff_signoff_updates_record_and_audit` — authorized sign-off with reason | Clearance changes and audit event is recorded. | Assertions passed. | PASS |
| `test_staff_signoff_requires_a_reason` — sign-off without reason | Request is rejected. | Assertions passed. | PASS |
| `test_expired_bearer_session_is_rejected` — expired session token | Protected request is unauthorized. | Assertions passed. | PASS |
| `test_student_affairs_staff_can_record_office_hold` — assigned Student Affairs staff hold | Office action is accepted and recorded. | Assertions passed. | PASS |
| `test_hold_summaries_include_pending_office_reviews` — active pending office review | Daily summary includes unresolved review. | Assertions passed. | PASS |
| `test_hold_requires_a_reason` — HOLD request without reason | Request is rejected. | Assertions passed. | PASS |
| `test_staff_can_place_hold_with_reason` — assigned staff HOLD with reason | HOLD is recorded with its reason. | Assertions passed. | PASS |

### Clearance slips, reports, audit, and account administration

| Test case / input scenario | Expected result | Actual result | Status |
|---|---|---|---|
| `test_student_on_hold_cannot_request_slip` — student with unresolved HOLD | Slip issuance is denied. | Assertions passed. | PASS |
| `test_cleared_student_can_issue_and_verify_short_code` — cleared student and staff verification | Slip is issued and short code verifies. | Assertions passed. | PASS |
| `test_slip_response_generates_qr_from_signed_token` — issued slip response | QR renderer receives the exact signed token and its SVG is returned. | Assertions passed. | PASS |
| `test_slip_qr_renderer_returns_valid_svg` — signed-token QR generation | QR renderer returns parseable SVG with path data. | Assertions passed. | PASS |
| `test_changed_slip_token_fails_signature` — modified signed token | Verification reports invalid signature. | Assertions passed. | PASS |
| `test_expired_slip_is_not_verified` — expired slip | Verification reports invalid/expired. | Assertions passed. | PASS |
| `test_public_json_report_masks_student_numbers` — public JSON report | Student numbers are masked. | Assertions passed. | PASS |
| `test_report_supports_csv_and_xml` — CSV and XML formats requested | Both formats are returned successfully. | Assertions passed. | PASS |
| `test_report_rejects_unsupported_format` — unsupported report format | Request is rejected. | Assertions passed. | PASS |
| `test_admin_only_audit_route_rejects_staff` — staff requests audit log | Role guard denies access. | Assertions passed. | PASS |
| `test_audit_details_exclude_sensitive_fields` — audit response with sensitive event data | Passwords, hashes, secrets, tokens, and slip codes are excluded. | Assertions passed. | PASS |
| `test_admin_can_list_users_without_password_hashes` — admin user list | Account list is returned without password hashes. | Assertions passed. | PASS |
| `test_cors_preflight_allows_admin_user_updates` — browser preflight for account update | Configured origin/method is allowed. | Assertions passed. | PASS |
| `test_staff_cannot_list_or_update_users` — staff attempts user management | Role guard denies both actions. | Assertions passed. | PASS |
| `test_admin_can_create_staff_with_email_login_and_assignment` — valid staff account and office | Staff account is created with assignment. | Assertions passed. | PASS |
| `test_admin_can_create_admin_account` — valid admin account | Admin account is created. | Assertions passed. | PASS |
| `test_admin_can_create_student_only_for_existing_active_record` — active Registrar student | Linked student Hub account is created. | Assertions passed. | PASS |
| `test_admin_create_rejects_missing_office_and_short_password` — invalid staff assignment/password | Account creation is rejected. | Assertions passed. | PASS |
| `test_admin_can_reset_password_and_revoke_existing_sessions` — admin password reset | New password is stored and old sessions are revoked. | Assertions passed. | PASS |
| `test_admin_can_change_role_assignment_and_revoke_old_session` — role/assignment update | Account is updated and affected session is revoked. | Assertions passed. | PASS |
| `test_admin_can_repair_account_with_unassigned_legacy_role` — valid repair of old account | Role/office assignment is repaired. | Assertions passed. | PASS |
| `test_admin_cannot_demote_own_account` — self-demotion request | Request is rejected. | Assertions passed. | PASS |
| `test_admin_can_update_student_profile_and_account` — linked student profile/account update | Valid profile and account fields are updated. | Assertions passed. | PASS |
| `test_admin_can_change_staff_office` — staff office reassignment | Office is updated and the old session is revoked as required. | Assertions passed. | PASS |
| `test_admin_user_update_rejects_duplicate_username_and_self_deactivation` — duplicate login/self-deactivation | Both prohibited updates are rejected. | Assertions passed. | PASS |
| `test_logout_invalidates_token` — logout followed by reuse of token | Session is invalidated and protected access is denied. | Assertions passed. | PASS |

## SQLite migration and runtime verification (2026-11-25)

The November 25 backup (`dnsc_clearance_hub-20261125-204832.sql`) was parsed as
data, not executed as SQLite SQL. Counts and every stored column value were
compared against the destination after loading:

| Table | Backup rows | SQLite rows |
|---|---:|---:|
| `offices` | 4 | 4 |
| `students` | 43 | 43 |
| `users` | 9 | 9 |
| `auth_sessions` | 13 | 13 |
| `clearance_records` | 55 | 55 |
| `audit_logs` | 31 | 31 |
| `import_batches` | 0 | 0 |
| `import_rejections` | 0 | 0 |
| `clearance_slips` | 12 | 12 |
| `holidays` | 36 | 36 |

The SQLite destination passed `PRAGMA integrity_check` (`ok`) and
`PRAGMA foreign_key_check` (no rows). JSON fields, source/destination values,
office seed rows, auto-increment next values, timestamp triggers, and foreign
key enforcement were also checked. The backup SHA-256 remained
`B347EB1EB1D8F3D507F29E8EF0B8EDBC6CBE88D87DB4F1F114747559A1FA05D6`.

The Flask server was started against the migrated database and its health
endpoint returned HTTP 200 with `database=connected`. An isolated copy of that
database passed login, admin/staff/student role checks, signed CSV import,
clearance HOLD/sign-off, audit event, and slip issue/verification smoke checks.
The live SQLite database was not changed by those workflow checks.

The prior MySQL-era smoke evidence remains historical only: the Registrar mock
and scheduled jobs were previously exercised with the MySQL runtime. XAMPP
MySQL was left running to avoid affecting other local services, so a stopped-
MySQL test was not performed. The runtime has no MySQL/PyMySQL connection path.

## Manual SQLite/browser checklist

The separate browser checklist is maintained in
[frontend-test-plan.md](./frontend-test-plan.md). It is not marked complete by
the automated suite or API smoke checks. Record the date, browser, test role,
actual result, and evidence location for each manual check. Capture only
synthetic data.

