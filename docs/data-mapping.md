# Data Mapping Specification

All sources map to `students` and `clearance_records`. Student identity is accepted only when the student number exists in the Registrar masterlist. Input data is not allowed to create a new student. Fields not listed below are ignored.

## Registrar REST JSON

| Source field | Target | Transformation | Reject condition |
|---|---|---|---|
| `student_number`, `student_id`, or `id` | `students.student_number` | Convert to trimmed text; preserve letters, digits, dot, slash, and dash. | Missing/empty or outside the identifier allow-list. |
| `full_name` or `name`; or `first_name`, optional `middle_initial`, and `last_name` | `students.full_name` | Trim; for name components assemble `First M. Last`. | Missing, empty, or not text. |
| `program`, `program_code`, or `program_name` | `students.program` | Trim surrounding whitespace. | Missing, empty, or not text. |
| `year_level` or `year` | `students.year_level` | Integer 1–8. | Not a valid integer or outside range. |
| `email` | `students.email` | Preserve valid text; otherwise null. | Optional field. |
| `status` | `students.active` and Registrar clearance | `LOA`/`INACTIVE` becomes inactive and HOLD; other valid students become active and CLEARED. | Bad JSON, missing required response array, or invalid required record fields fails the sync. |

The client supports the starter kit's `page`/`size`, `data`, and `has_next`
contract (as well as `students`, `next_page`, and `has_more` response variants),
sends `X-API-Key`, caps paging at 100 pages, retries network/5xx failures, and
reports 4xx responses and malformed JSON as integration errors. The starter
API is read-only and its 40 sample records are synthetic.

## Library XML export

The file is UTF-8 XML. A borrower row is an element with a student identifier and at least one issue field. Namespaces are ignored; child tag names are compared case-insensitively after punctuation is removed.

| Source aliases | Target | Transformation | Reject condition |
|---|---|---|---|
| `student_number`, `student_id`, `student_no`, `student_num`, `id` | Match `students.student_number` | Trim text; match exact Registrar identifier. | Missing or unknown student. |
| `unreturned_books`, `unreturned_book_count`, `books_unreturned`, `book_count` | `clearance_records.status/reason` | Non-negative numeric count. A count above zero produces HOLD. | Not numeric or negative. |
| `fine`, `fines`, `fine_amount`, `library_fine` | `clearance_records.status/reason` | Parse non-negative decimal; optional `PHP`, `php`, `₱`, and thousands separators accepted. A positive amount produces HOLD. | Not numeric or negative. |

The row is CLEARED only when the book count and fine are both zero. Missing values default to zero. A valid row with no issues is explicitly marked CLEARED.

## Accounting CSV export

The file is UTF-8/UTF-8-BOM CSV and includes one header row.

| Source aliases | Target | Transformation | Reject condition |
|---|---|---|---|
| `student_number`, `student_id`, `student_no`, `student_num`, `id` | Match `students.student_number` | Trim text; exact match against the Registrar masterlist. | Missing or unknown student. |
| `balance`, `amount_due`, `tuition_balance`, `outstanding_balance`, `amount` | `clearance_records.status/reason` | Non-negative decimal; optional PHP marker and thousands separators accepted. Positive amount becomes HOLD; zero becomes CLEARED. | Not numeric or negative. |

## Staff entry

Staff actions use `POST /api/clearance/{student_number}/{office}/signoff` or `/hold`. A staff account is bound to one office. The API validates the student and office, restricts staff to that office, stores status/reason, and records the actor and timestamp in `audit_logs`.

## Student Affairs web form

Student Affairs staff select an active student and enter organization membership/obligation details, borrowed-equipment review, a CLEARED/HOLD decision, and an assessment. Staff choose the decision according to office policy; membership or equipment text does not automatically determine it. The form combines the checked details and decision reason into the clearance record and audit event. The Hub does not edit an external Student Affairs system.

## Signed manifest and rejection handling

Each import file has a sidecar named `<file-name>.manifest.json`:

```json
{
  "file": "library_export.xml",
  "source": "library",
  "generated_at": "<current ISO-8601 UTC timestamp>",
  "nonce": "replace-with-a-unique-url-safe-value",
  "sha256": "64-character-hex-sha256-digest",
  "hmac_sha256": "64-character-hex-hmac-sha256"
}
```

The HMAC covers the UTF-8 JSON object with sorted keys and compact separators after excluding `hmac_sha256` and `signature`. Verification checks source/file extension, filename, SHA-256, 24-hour timestamp window, HMAC, and nonce uniqueness before parsing data. An invalid manifest rejects the complete batch. A verified batch may be PARTIAL: valid rows are applied, while invalid rows are recorded by row number and reason. Original row contents and student identifiers are not written to the rejection log.

The `python.py sign-manifest` helper is for locally generated synthetic files only. In production, the source office (or its trusted export service) must sign the manifest with the shared key.
