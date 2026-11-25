# Evaluation and Final Clearance Readiness

This checklist is a team workflow aid, not a substitute for the official rating sheets and forms on the course LMS.

## Group rubric and milestone cross-check

The group scope—not the optional individual scope—is used for this project:

| Grading category | Weight |
|---|---:|
| Security (R11–R16) | 20 points |
| API and client (R7–R8) | 15 points |
| Data mapping and formats (R9–R10) | 15 points |
| Solution design and emerging technology (R3–R4) | 12 points |
| External APIs (R5–R6) | 10 points |
| Testing, evaluation, and documentation (R17–R18) | 10 points |
| Presentation | 10 points |
| Automation (R1–R2) | 8 points |
| **Total** | **100 points** |

| Rubric area | Group evidence target | Current evidence / remaining action |
|---|---|---|
| R1–R2 automation | Import/archive/log automation plus scheduled daily per-office HOLD summaries | Automation and scheduler installer are present; confirm the registered tasks execute successfully and save logs/reports. |
| R3–R4 design/technology | Solution design, transformation impact, and two justified components | Design is documented; PWA and locally generated signed-token QR slip are implemented. |
| R5–R6 external APIs | Registrar error handling and Nager.Date working-day deadline | Clients and focused tests exist; capture final-environment smoke evidence. |
| R7–R8 API/client | At least eight endpoints and web views for each role | API spec lists 20+ routes; student, staff, and admin pages use the Hub API. Demonstrate role views. |
| R9–R10 data/formats | XML/CSV imports with reject log; CSV/JSON/XML reports | Import mapping and report exports are implemented and covered by tests. |
| R11–R16 security/exchange | Allowlists, salted hashes/RBAC, parameterized SQL, HMAC/replay protection, signed slips, masking, audit | Implementation and automated security cases exist; review with synthetic data and include final API/security test evidence. |
| R17 testing | At least 20 cases, including mapping, API, and security evidence | Latest automated run: 87/87 passed on 2026-11-24. Complete the manual XAMPP/browser checklist and include dated evidence. |
| R18 evaluation | 30 outside raters with required group distribution, signed sheets, and consented photos | Not complete in code; collect real evidence and analyze results. |

Course checkpoint targets: Week 15 design presentation; Week 16 progress demo
showing importers, Registrar client, and at least three API endpoints; Week 17
code freeze with at least 10 ratings logged; Week 18 final presentation and
submission. Confirm exact dates and forms with the instructor/LMS.

## R18 rater plan

The final project briefing requires 30 raters outside the team:

| Group | Count | Required evidence |
|---|---:|---|
| Students from the other three IT312 sets | 15 (5 from each set) | Independently completed and signed rating sheet; consented photo |
| DNSC instructors | 3 | Independently completed and signed rating sheet, including technical Part II; consented photo |
| Students from other year levels/institutes | 12 | Independently completed and signed rating sheet; consented photo |

For each participant, use a fresh official sheet, let them operate or observe the live demo, leave the rating entirely to them, obtain the sheet and photo consent, then record the matching sheet/photo number in the official masterlist. Do not create synthetic names, ratings, signatures, or photo records. If photo consent is declined, follow the course procedure and find another eligible rater.

## Rating analysis

After all sheets are collected, calculate mean score per item for each rater group and overall; calculate the overall weighted mean and verbal interpretation using the course's evaluation form instructions. Summarize comments without exposing personal data. Include scanned signed sheets, consented captioned photos, and the completed masterlist in the final PDF appendices.

## Final submission gate

- [ ] Confirm every R1–R17 implementation and test in the actual presentation environment.
- [ ] Verify the registered Windows tasks run daily, including import/archive/log output and dated per-office HOLD summaries.
- [ ] Confirm the Registrar mock API and Nager.Date service are reachable, or prepare the course-approved demo fallback.
- [x] Run the automated suite: 87 cases passed on 2026-11-24; keep the run output in Appendix G.
- [ ] Run and record the manual XAMPP/MySQL/browser checklist; automated SQLite tests are not a substitute.
- [ ] Add actual project title, set, instructor, member names/roles, dates, and contribution/commit evidence.
- [ ] Complete the required 30-person rating process and Appendix A–D using the official forms.
- [ ] Prepare final PDF, backup demo video, original signed sheets, and any peer-evaluation forms required by the instructor.

R18 and the final PDF evidence cannot be completed by source code alone. This repository deliberately leaves those real-person items unfilled.
