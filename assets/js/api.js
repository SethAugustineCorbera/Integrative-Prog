/* The front end talks to the Hub API only; it never connects to MySQL (R8). */
const HUB_API_BASE = "http://127.0.0.1:8000/api";

async function hubRequest(method, path, body) {
  const token = sessionStorage.getItem("token");
  const headers = token ? { Authorization: "Bearer " + token } : {};
  const options = {
    method,
    headers: headers
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(HUB_API_BASE + path, options);
  } catch (error) {
    throw new Error(
      "The Hub API request could not be completed. Confirm the API is running, that FRONTEND_ORIGINS includes this site's origin, and reload the page."
    );
  }
  if (!res.ok) {
    let message = "Hub API error " + res.status;
    try {
      const error = await res.json();
      if (error.error) message = error.error;
    } catch (parseError) {
      message = "Hub API error " + res.status;
    }
    const apiError = new Error(message);
    apiError.status = res.status;
    throw apiError;
  }
  if (res.status === 204) return null;
  return res.json();
}

const HubApi = {
  login: (credentials) => hubRequest("POST", "/auth/login", credentials),
  register: (details) => hubRequest("POST", "/auth/register", details),
  me: () => hubRequest("GET", "/auth/me"),
  logout: () => hubRequest("POST", "/auth/logout", {}),
  myStatus: () => hubRequest("GET", "/students/me/clearance"),
  mySlip: () => hubRequest("GET", "/slips/me"),
  deadline: () => hubRequest("GET", "/deadline"),
  officeQueue: (office, status) => hubRequest("GET", "/offices/" + encodeURIComponent(office) + "/students" + (status ? "?status=" + encodeURIComponent(status) : "")),
  signOff: (studentId, office, reason) => hubRequest("POST", "/clearance/" + encodeURIComponent(studentId) + "/" + encodeURIComponent(office) + "/signoff", { reason }),
  placeHold: (studentId, office, reason) => hubRequest("POST", "/clearance/" + encodeURIComponent(studentId) + "/" + encodeURIComponent(office) + "/hold", { reason }),
  holdSummary: () => hubRequest("GET", "/admin/hold-summary"),
  imports: () => hubRequest("GET", "/imports"),
  auditLog: () => hubRequest("GET", "/audit"),
  adminUsers: () => hubRequest("GET", "/admin/users"),
  createAdminUser: (details) => hubRequest("POST", "/admin/users", details),
  updateAdminUser: (userId, details) => hubRequest("PUT", "/admin/users/" + encodeURIComponent(userId), details),
  resetAdminUserPassword: (userId, password) => hubRequest("POST", "/admin/users/" + encodeURIComponent(userId) + "/password", { password }),
  report: (format) => hubRequest("GET", "/reports/clearance?format=" + encodeURIComponent(format)),
  downloadReport: async (format) => {
    const token = sessionStorage.getItem("token");
    const res = await fetch(HUB_API_BASE + "/reports/clearance?format=" + encodeURIComponent(format), {
      headers: token ? { Authorization: "Bearer " + token } : {}
    });
    if (!res.ok) throw new Error("Report download failed with status " + res.status);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "clearance-report." + format;
    link.click();
    URL.revokeObjectURL(url);
  },
  verifySlip: (values) => hubRequest("POST", "/slips/verify", values),
  syncRegistrar: () => hubRequest("POST", "/admin/sync-registrar", {}),
  uploadImport: async (file, manifest) => {
    const token = sessionStorage.getItem("token");
    const headers = token ? { Authorization: "Bearer " + token } : {};
    const data = new FormData();
    data.append("file", file);
    data.append("manifest", manifest);
    const res = await fetch(HUB_API_BASE + "/admin/import", { method: "POST", headers: headers, body: data });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || "Import request failed with status " + res.status);
    return result;
  }
};

/* Where each signed-in user lands. `root` is the path from the current page back to the project root. */
const OFFICE_PAGES = { library: "library", accounting: "accounting", registrar: "registrar", "student-affairs": "student-affairs" };
function homeFor(user, root) {
  if (user.role === "student") return root + "modules/student/student.html";
  if (user.role === "admin") return root + "modules/admin/admin.html";
  const page = user.role === "staff" ? OFFICE_PAGES[user.office_code] : undefined;
  return page ? root + "modules/" + page + "/" + page + ".html" : root + "index.html#login";
}
