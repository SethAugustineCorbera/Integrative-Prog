const HOME = {
  student: "../student/clearance-status/clearance-status.html",
  staff: "../staff/office-queue/office-queue.html",
  admin: "../admin/import-monitor/import-monitor.html"
};
const LOGIN_SCRIPT_URL = document.currentScript ? document.currentScript.src : location.href;
const manifest = document.createElement("link");
manifest.rel = "manifest";
manifest.href = new URL("../../manifest.webmanifest", LOGIN_SCRIPT_URL).href;
document.head.appendChild(manifest);
const loginPanel = document.getElementById("login-panel");
const registerPanel = document.getElementById("register-panel");
const registerSwitch = document.getElementById("register-switch");
const loginSwitch = document.getElementById("login-switch");
const loginNotice = sessionStorage.getItem("loginNotice");
if (loginNotice) {
  const message = document.getElementById("login-error");
  message.textContent = loginNotice;
  message.classList.remove("error");
  sessionStorage.removeItem("loginNotice");
}

function showLogin() {
  loginPanel.hidden = false;
  registerPanel.hidden = true;
  registerSwitch.hidden = false;
  loginSwitch.hidden = true;
  document.getElementById("login-username").focus();
}

function showRegistration() {
  loginPanel.hidden = true;
  registerPanel.hidden = false;
  registerSwitch.hidden = true;
  loginSwitch.hidden = false;
  document.getElementById("register-student-number").focus();
}

document.getElementById("show-register").addEventListener("click", showRegistration);
document.getElementById("show-login").addEventListener("click", showLogin);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker
    .register(new URL("../../service-worker.js", LOGIN_SCRIPT_URL))
    .catch(error => console.error("Service worker registration failed:", error));
}

document.getElementById("login-form").addEventListener("submit", async function (event) {
  event.preventDefault();
  const button = document.getElementById("login-btn");
  const message = document.getElementById("login-error");
  button.disabled = true;
  message.textContent = "";
  message.classList.remove("error");
  try {
    const result = await HubApi.login({
      username: document.getElementById("login-username").value.trim(),
      password: document.getElementById("login-password").value
    });
    sessionStorage.setItem("token", result.token);
    sessionStorage.setItem("role", result.user.role);
    sessionStorage.setItem("user", JSON.stringify(result.user));
    location.href = HOME[result.user.role] || "../auth/login.html";
  } catch (error) {
    message.textContent = error.message || "Unable to sign in. Check the Hub API and try again.";
    message.classList.add("error");
  } finally {
    button.disabled = false;
  }
});

document.getElementById("register-form").addEventListener("submit", async function (event) {
  event.preventDefault();
  const button = document.getElementById("register-btn");
  const message = document.getElementById("register-message");
  const username = document.getElementById("register-username").value.trim();
  const password = document.getElementById("register-password").value;
  const confirmation = document.getElementById("register-password-confirm").value;
  button.disabled = true;
  message.textContent = "";
  message.classList.remove("error");
  try {
    if (password !== confirmation) {
      throw new Error("The password and confirmation do not match.");
    }
    const result = await HubApi.register({
      username: username,
      password: password,
      student_number: document.getElementById("register-student-number").value.trim(),
      full_name: document.getElementById("register-full-name").value.trim()
    });
    document.getElementById("login-username").value = username;
    document.getElementById("login-password").value = "";
    document.getElementById("register-form").reset();
    showLogin();
    const loginMessage = document.getElementById("login-error");
    loginMessage.classList.remove("error");
    loginMessage.textContent = result.message || "Account created. You can now sign in.";
  } catch (error) {
    message.textContent = error.message || "Unable to register. Check your student details and try again.";
    message.classList.add("error");
  } finally {
    button.disabled = false;
  }
});
