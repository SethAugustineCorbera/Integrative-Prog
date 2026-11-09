# Front-end test plan (starter for R17)

| # | Test | Expected result |
|---|------|-----------------|
| 1 | Open main.html | Login page opens |
| 2 | Log in as Student | Clearance status page opens |
| 3 | Log in as Office staff | Office queue page opens |
| 4 | Log in as Admin | Import monitor page opens |
| 5 | Student sidebar | Shows only Clearance status, Clearance slip, Deadline |
| 6 | Staff sidebar | Shows only Office queue, HOLD summary, Verify slip |
| 7 | Admin sidebar | Shows admin pages plus staff pages |
| 8 | Status page: View clearance slip | Slip page opens |
| 9 | Status page: View deadline | Deadline page opens |
| 10 | Slip page: Back to status | Status page opens |
| 11 | Log out on any page | Login page opens |
| 12 | Resize to phone width | Sidebar stacks on top, tables scroll sideways |

Add API, mapping and security tests with the other members to reach 20+ cases for a group.
