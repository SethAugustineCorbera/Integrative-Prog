# Final Documentation Source

This Markdown source organizes the project narrative required by the IT312 briefing. Complete the bracketed school/team details, update test results, and combine it with the real evaluation evidence into the required final PDF.

## Required final-PDF format and checkpoints

- Use short bond paper with one-inch margins.
- Include a title page, abstract of no more than 250 words, Chapters 1–5,
  references, and Appendices A–I in the course-prescribed order.
- Week 15: present the solution design. Week 16: demonstrate the importers,
  Registrar client, and at least three Hub API endpoints. Week 17: code freeze
  and record at least 10 completed external ratings. Week 18: final presentation
  and submission. Confirm exact dates and evidence requirements with the
  instructor/LMS.
- This repository supplies the software and documentation source, not a
  completed submission PDF. Fill all team, evaluation, screenshot, and
  contribution evidence from real project activity.

## Title page

**DNSC e-Clearance Hub**  
Track A — DNSC e-Clearance Hub  
Team/set: [complete]  
Members and roles: [complete]  
Instructor: [complete]  
Submission date: [complete]

## Abstract

The DNSC e-Clearance Hub is an integration system intended to replace repeated paper-based clearance visits with one authenticated view of student obligations. The Python service consumes the Registrar masterlist and Philippine holiday API, and accepts signed Library XML and Accounting CSV exports. Data is normalized to a shared student/office clearance schema in a local SQLite database stored outside Apache's document root. Students may register only against an active Registrar roster record, then use a browser client to check office-by-office status and receive a verifiable signed QR slip and short code after all required offices clear them; roster matching is not independent identity verification. Assigned office staff can update their own office's clearance records, while administrators process imports, review audit events, and export reports with masked student numbers. Passwords are stored as salted PBKDF2 hashes; session tokens, role checks, parameterized SQL, manifest HMAC verification, replay detection, and signed slip expiry protect the integration. A mobile-friendly installable PWA and locally generated QR slip are the two selected emerging-technology components; clearance data is not cached offline. The shared status view reduces repeated student visits while allowing offices to keep their existing systems. Test evidence is in Appendix G. User evaluation, including signed sheets and consented photos, must be collected and compiled separately in Appendices A–D before final submission.

## Chapter 1 — Introduction

### Problem and stakeholders

Students currently visit multiple offices that keep separate records and data formats. Lost forms, holiday closures, and end-of-term queues cause delays. Students, Registrar staff, Library staff, Accounting/Cashier staff, Student Affairs staff, and administrators are the intended stakeholders.

### Objectives

1. Consolidate office clearance results against a Registrar masterlist.
2. Reduce repeated visits by showing current status and actionable reasons.
3. Validate and audit cross-system data imports and staff decisions.
4. Provide a mobile-friendly student client and a verifiable slip.
5. Protect student data with role enforcement and masked public reports.

### Scope and limitations

The code includes a local Flask API, SQLite schema, browser client, the bundled synthetic Registrar mock/starter files, Registrar and holiday API clients, signed file importer, report exports, audit history, and test suite. The official live Registrar service, team details, evidence that scheduled tasks executed successfully, and the 30-person evaluation are team responsibilities. Use synthetic data unless the institution authorizes otherwise.

## Chapter 2 — Solution Design

See [solution-design.md](./solution-design.md) for the architecture, data flow, emerging-technology justification, security controls, and R1–R18 implementation traceability.

## Chapter 3 — Implementation

- **Automation:** `python.py run-imports`, `python.py hold-summary`, timestamped logs, and archive.
- **External APIs:** Registrar paging/error handling and Nager.Date holiday calendar.
- **Hub API/client:** Flask API documented in [api-spec.md](./api-spec.md); web screens use REST only.
- **Data mapping:** CSV/XML field aliases and rejects are specified in [data-mapping.md](./data-mapping.md).
- **Database:** SQLite tables are defined in `database/schema.sqlite.sql`; the runtime database is stored outside the web root.
- **Emerging technology (R4):** mobile-friendly PWA plus a real, locally generated QR clearance slip encoding the signed token.
- **Security:** PBKDF2, bearer sessions, role/office guards, parameterized SQL, environment secrets, HMAC files, signed slips, masking, and audit events.

## Chapter 4 — Testing and Evaluation

The automated evidence and SQLite migration checks are recorded in [test-report.md](./test-report.md). The suite uses temporary SQLite for isolation; run and record the separate SQLite/browser smoke checks before printing the final report.

The actual 30-rater evaluation is not included in this repository. Complete Appendix A's statistical summary from real sheets, then insert the signed sheets, consented photos, and official masterlist in Appendices B–D. Do not fill ratings on behalf of participants.

## Chapter 5 — Conclusion and Recommendations

The system provides an integration path from independent source systems to a single clearance API and client. Before deployment, the team should test with the supplied Registrar mock/data bundle, verify scheduled Windows task executions, review the actual source export formats, and obtain institutional approval for production data, hosting, retention, and access policy. Revise recommendations after analyzing real rater feedback.

## References

- IT312 Final Project Briefing, Davao del Norte State College, 1st Semester SY 2026–2027.
- IT312 Final Project: DNSC e-Clearance Hub project guide.
- IT312 Final Project Rating Sheet.
- Nager.Date Public Holidays API: <https://date.nager.at/>.
- Flask documentation: <https://flask.palletsprojects.com/>.

## Appendices

| Appendix | Required content | Source/status |
|---|---|---|
| A | Rating means and verbal interpretation | Complete only after collecting and analyzing all 30 official sheets. |
| B | 30 signed rating sheets | Attach original participant-completed sheets in the required group order. |
| C | 30 captioned photos | Obtain consent and use actual photos; do not generate or edit evidence. |
| D | Rater masterlist | Complete using the official course form and matching sheet/photo numbers. |
| E | API specification | [api-spec.md](./api-spec.md) |
| F | Data mapping specification | [data-mapping.md](./data-mapping.md) |
| G | Test report | [test-report.md](./test-report.md), updated with actual results |
| H | User guide | [user-guide.md](./user-guide.md); add screenshots from the actual system. |
| I | Team contributions and commits | Complete with actual members, requirement ownership, and Git commit evidence. |
