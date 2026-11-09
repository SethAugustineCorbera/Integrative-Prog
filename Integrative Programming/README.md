# DNSC e-Clearance Hub: Front end (Track A)

Plain HTML, CSS and JavaScript. No build step.

## Run
Open `main.html` in a browser (or serve the folder with `python -m http.server`).
Log in with any username and password and pick a role. There is no credential check yet.

## Structure
```
main.html                  opens the login page
assets/
  css/  base.css  layout.css  components.css
  js/   api.js    common.js
modules/                   role folder > function folder > function.html (+ function.js where needed)
  auth/login.html
  student/  clearance-status  clearance-slip  deadline
  staff/    office-queue  hold-summary  verify-slip
  admin/    import-monitor  reports  audit-log  api-reference
            office-queue  hold-summary  verify-slip
docs/frontend-test-plan.md
```
Styles live only in `assets/css`. Scripts live only in `.js` files. HTML files have no inline CSS or JS.

## Role views
- Student: Clearance status, Clearance slip, Deadline
- Staff: Office queue, Hold summary, Verify slip
- Admin: Import monitor, Reports, Audit log, API reference, plus the staff pages

## Requirement coverage (front-end part)
| Req | Covered by |
|-----|-----------|
| R8 | Role views; `assets/js/api.js` is the only way the UI reaches data (Hub API, no database) |
| R2 | hold-summary |
| R6 | deadline |
| R7 | api-reference lists the endpoints |
| R9 | import-monitor reject log |
| R10 | reports lists CSV, JSON, XML |
| R12 | auth with 3 roles |
| R14 | import-monitor manifest status |
| R15 | clearance-slip and verify-slip |
| R16 | masked IDs in reports; audit-log |
| R17 | docs/frontend-test-plan.md |

R1, R3-R5, R11 and R13 are backend or document work for the other roles.

## Left out for now
Actions that need the backend: sign off, put a hold, verify a code, download a report, real login check.
`api.js` already has the call wrappers ready for the API developer.
