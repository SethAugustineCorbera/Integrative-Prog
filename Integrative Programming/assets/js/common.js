/* Shared layout: builds the sidebar for the current role and marks the active page. */
const NAV = {
    student: [["Clearance status", "clearance-status"], ["Clearance slip", "clearance-slip"], ["Deadline", "deadline"]],
    staff: [["Office queue", "office-queue"], ["Hold summary", "hold-summary"], ["Verify slip", "verify-slip"]],
    admin: [["Import monitor", "import-monitor"], ["Reports", "reports"], ["Audit log", "audit-log"], ["API reference", "api-reference"],
            ["Office queue", "office-queue"], ["Hold summary", "hold-summary"], ["Verify slip", "verify-slip"]]
};
const ROLE_NAMES = { student: "Student", staff: "Office staff", admin: "Admin" };

(function () {
    const role = sessionStorage.getItem("role") || "student";
    const parts = location.pathname.split("/");
    const currentFolder = parts[parts.length - 2];
    const currentRole = parts[parts.length - 3];
    const links = NAV[role].map(function (item) {
        const active = item[1] === currentFolder && role === currentRole ? ' class="active"' : "";
        return '<a href="../../' + role + "/" + item[1] + "/" + item[1] + '.html"' + active + ">" + item[0] + "</a>";
    }).join("");
    document.getElementById("sidebar").innerHTML = '<div class="brand">DNSC e-Clearance Hub</div>' + links;
    document.getElementById("role-label").textContent = "Signed in as: " + ROLE_NAMES[role];
})();
