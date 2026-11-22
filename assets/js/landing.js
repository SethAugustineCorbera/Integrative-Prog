/* Landing page: opens the log in modal and handles log in and registration through the Hub API. */
const modal = document.getElementById("login-modal");
const openButton = document.getElementById("open-login");
const closeButton = document.getElementById("lm-close");
const loginPanel = document.getElementById("login-panel");
const registerPanel = document.getElementById("register-panel");
let lastFocus = null;

function openModal() {
    lastFocus = document.activeElement;
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");
    setTimeout(function () {
        const field = loginPanel.hidden ? "register-student-number" : "login-username";
        document.getElementById(field).focus();
    }, 350);
}

function closeModal() {
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
    if (lastFocus) lastFocus.focus();
}

function showLogin() {
    loginPanel.hidden = false;
    registerPanel.hidden = true;
    document.getElementById("login-username").focus();
}

function showRegistration() {
    loginPanel.hidden = true;
    registerPanel.hidden = false;
    document.getElementById("register-student-number").focus();
}

openButton.addEventListener("click", function (event) {
    event.preventDefault();
    openModal();
});
closeButton.addEventListener("click", closeModal);
modal.addEventListener("click", function (event) {
    if (event.target === modal) closeModal();
});
document.addEventListener("keydown", function (event) {
    if (!modal.classList.contains("is-open")) return;
    if (event.key === "Escape") {
        closeModal();
        return;
    }
    if (event.key === "Tab") {
        const items = modal.querySelectorAll("button, input, a[href]");
        const visible = Array.prototype.filter.call(items, function (el) {
            return el.offsetParent !== null && !el.disabled;
        });
        if (!visible.length) return;
        const first = visible[0];
        const last = visible[visible.length - 1];
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }
});
document.getElementById("show-register").addEventListener("click", showRegistration);
document.getElementById("show-login").addEventListener("click", showLogin);

const notice = sessionStorage.getItem("loginNotice");
if (notice) {
    document.getElementById("login-error").textContent = notice;
    sessionStorage.removeItem("loginNotice");
}
if (location.hash === "#login") openModal();

if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("service-worker.js").catch(function (error) {
        console.error("Service worker registration failed:", error);
    });
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
        if (result.user.role === "staff" && !OFFICE_PAGES[result.user.office_code]) {
            throw new Error("This staff account is not assigned to an office. Ask an administrator to assign one.");
        }
        location.href = homeFor(result.user, "");
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
        document.getElementById("login-error").textContent = result.message || "Account created. You can now sign in.";
    } catch (error) {
        message.textContent = error.message || "Unable to register. Check your student details and try again.";
        message.classList.add("error");
    } finally {
        button.disabled = false;
    }
});


document.addEventListener("DOMContentLoaded", () => {
    const nav = document.querySelector("#site-nav");
    const navLinks = document.querySelectorAll(".nav-link");
    const menuToggle = document.querySelector("#menu-toggle");
    const navigation = document.querySelector("#main-navigation");

    const sections = [
        "home",
        "about",
        "developers",
        "contact"
    ]
    .map(id => document.getElementById(id))
    .filter(Boolean);

    // Hamburger menu
    menuToggle.addEventListener("click", () => {
        const isOpen = navigation.classList.toggle("show");

        menuToggle.classList.toggle("open", isOpen);
        menuToggle.setAttribute("aria-expanded", isOpen);
        menuToggle.setAttribute(
            "aria-label",
            isOpen ? "Close navigation menu" : "Open navigation menu"
        );
    });

    // Close menu after selecting a link
    navLinks.forEach(link => {
        link.addEventListener("click", () => {
            navigation.classList.remove("show");
            menuToggle.classList.remove("open");

            menuToggle.setAttribute("aria-expanded", "false");
            menuToggle.setAttribute("aria-label", "Open navigation menu");
        });
    });

    // Update active navigation link while scrolling
    function updateActiveLink() {
        const navHeight = nav.offsetHeight;
        const scrollPosition = window.scrollY + navHeight + 80;

        let currentSection = sections[0];

        // Ensure Contact activates when reaching the bottom
        const atPageBottom =
            window.innerHeight + window.scrollY >=
            document.documentElement.scrollHeight - 5;

        if (atPageBottom) {
            currentSection = sections[sections.length - 1];
        } else {
            sections.forEach(section => {
                if (section.offsetTop <= scrollPosition) {
                    currentSection = section;
                }
            });
        }

        navLinks.forEach(link => {
            const isActive =
                link.getAttribute("href") === `#${currentSection.id}`;

            link.classList.toggle("active", isActive);
        });
    }

    window.addEventListener("scroll", updateActiveLink, {
        passive: true
    });

    window.addEventListener("resize", updateActiveLink);

    updateActiveLink();

    
});
