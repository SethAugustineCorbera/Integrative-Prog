/* Hub API client. The front end talks to the Hub REST API only (R8): no direct database access. */
const HUB_API_BASE = "http://localhost:8000/api";

async function hubRequest(method, path, body) {
  const token = sessionStorage.getItem("token");
  const res = await fetch(HUB_API_BASE + path, {
    method,
    headers: Object.assign({ "Content-Type": "application/json" }, token ? { Authorization: "Bearer " + token } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error("Hub API error " + res.status);
  return res.json();
}

/* Ready for the API developer's endpoints. Not called yet; pages show sample data. */
const HubApi = {
  login: (credentials) => hubRequest("POST", "/auth/login", credentials),
  myStatus: () => hubRequest("GET", "/clearance/me"),
  mySlip: () => hubRequest("GET", "/slips/me"),
  deadline: () => hubRequest("GET", "/deadline"),
  officeQueue: (office) => hubRequest("GET", "/offices/" + office + "/students"),
  holdSummary: (office) => hubRequest("GET", "/offices/" + office + "/holds/summary"),
  imports: () => hubRequest("GET", "/imports"),
  auditLog: () => hubRequest("GET", "/audit-log"),
  report: (format) => hubRequest("GET", "/reports/clearance?format=" + format)
};
