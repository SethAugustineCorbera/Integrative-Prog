/* Front-end only: no credential check yet. The chosen role decides which pages open. */
const HOME = { student: "../student/clearance-status/clearance-status.html", staff: "../staff/office-queue/office-queue.html", admin: "../admin/import-monitor/import-monitor.html" };

document.getElementById("login-btn").addEventListener("click", function () {
  const role = document.querySelector('input[name="role"]:checked').value;
  sessionStorage.setItem("role", role);
  location.href = HOME[role];
});
