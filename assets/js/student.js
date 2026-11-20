/* Student page: status, clearance slip and deadline in one page. Talks to the Hub API only (R8). */
"use strict";

const LOGIN_URL = "../../index.html#login";
const OTHER_HOMES = {
    staff: "../staff/office-queue/office-queue.html",
    admin: "../admin/import-monitor/import-monitor.html"
};
const TABS = ["status", "deadline"]; // old #slip links fall back to the status tab
const loaded = { status: false, deadline: false };

const messageBox = document.getElementById("api-message");
const navigation = document.getElementById("main-navigation");
const menuToggle = document.getElementById("menu-toggle");

function showMessage(text, isError) {
    messageBox.textContent = text;
    messageBox.className = isError ? "msg error" : "msg";
    messageBox.hidden = !text;
}

function goToLogin() {
    sessionStorage.clear();
    location.href = LOGIN_URL;
}

function addCell(row, value) {
    const cell = row.insertCell();
    cell.textContent = value === null || value === undefined ? "" : String(value);
    return cell;
}

function addBadgeCell(row, value) {
    const cell = row.insertCell();
    const badge = document.createElement("span");
    badge.className = "badge " + String(value).toLowerCase();
    badge.textContent = value;
    cell.appendChild(badge);
}

function emptyRow(body, columns, text) {
    const cell = body.insertRow().insertCell();
    cell.colSpan = columns;
    cell.textContent = text;
}

/* ---------- Status ---------- */
async function loadStatus() {
    const data = await HubApi.myStatus();
    const badge = document.getElementById("overall-badge");
    badge.className = "badge " + data.overall.toLowerCase();
    badge.textContent = data.overall;
    document.getElementById("student-name").textContent = data.student.full_name;
    document.getElementById("student-meta").textContent = data.student.program + ", year " + data.student.year_level;
    document.getElementById("welcome-title").textContent = "Hello, " + data.student.full_name.trim().split(/\s+/)[0] + "!";
    document.getElementById("welcome-sub").textContent = data.overall === "CLEARED"
        ? "Every office has cleared you."
        : "Some offices still need your attention.";
    const body = document.getElementById("status-body");
    body.replaceChildren();
    data.offices.forEach(function (item) {
        const row = body.insertRow();
        addCell(row, item.office);
        addBadgeCell(row, item.status);
        addCell(row, item.reason);
    });
    if (!data.offices.length) emptyRow(body, 3, "No offices are configured yet.");
}

/* ---------- Slip ---------- */
async function loadSlip() {
    const qr = document.getElementById("qr");
    const code = document.getElementById("slip-code");
    const note = document.getElementById("slip-note");
    try {
        const data = await HubApi.mySlip();
        if (typeof data.qr_svg !== "string" || !data.qr_svg.includes("<svg")) {
            throw new Error("The Hub returned an invalid QR code. Refresh the page or contact an administrator.");
        }
        document.getElementById("slip-name").textContent = data.student.full_name;
        document.getElementById("slip-id").textContent = "ID: " + data.student.student_number;
        if (qr.dataset.imageUrl) URL.revokeObjectURL(qr.dataset.imageUrl);
        const imageUrl = URL.createObjectURL(new Blob([data.qr_svg], { type: "image/svg+xml" }));
        const image = document.createElement("img");
        image.alt = "QR code containing the signed clearance token";
        image.src = imageUrl;
        qr.dataset.imageUrl = imageUrl;
        qr.replaceChildren(image);
        qr.hidden = false;
        code.textContent = data.public_code;
        code.hidden = false;
        note.textContent = "Show the QR code or signed short code to office staff. It expires "
            + new Date(data.expires_at).toLocaleString() + ".";
    } catch (error) {
        if (error.status === 401) throw error;
        qr.hidden = true;
        code.hidden = true;
        // 409 = still on HOLD: not an error in the page, just no slip yet.
        note.textContent = error.status === 409
            ? "Your slip is not available yet. " + error.message
            : error.message;
    }
}

/* ---------- Deadline calendar ---------- */
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const cal = { view: null, selected: null, start: null, deadline: null, skipped: new Map(), total: 0 };

function dateKey(d) {
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function parseKey(key) {
    const parts = key.split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
}

function longDate(key) {
    return parseKey(key).toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

function isHoliday(key) {
    const reason = cal.skipped.get(key);
    return reason !== undefined && reason !== "Weekend";
}

function inWindow(key) {
    return key > cal.start && key <= cal.deadline;
}

/* Which working day of the window is this date? (skipped days are not counted) */
function workingDayNumber(key) {
    let count = 0;
    for (let d = parseKey(cal.start); ; ) {
        d.setDate(d.getDate() + 1);
        const k = dateKey(d);
        if (k > key) return 0;
        if (!cal.skipped.has(k)) count += 1;
        if (k === key) return count;
    }
}

function describeDay(key) {
    const weekend = [0, 6].indexOf(parseKey(key).getDay()) !== -1;
    if (key === cal.deadline) return "Your clearance deadline. Everything must be cleared by the end of this day.";
    if (isHoliday(key)) return "Holiday: " + cal.skipped.get(key) + ". Not counted as a working day.";
    if (weekend) return "Weekend. Not counted as a working day.";
    if (key === cal.start) return "Today. Your working days start counting from tomorrow.";
    if (key < cal.start) return "This date has already passed.";
    if (inWindow(key)) return "Working day " + workingDayNumber(key) + " of " + cal.total + " in your clearance window.";
    return "After your deadline.";
}

function selectDay(key, keepView) {
    cal.selected = key;
    const date = parseKey(key);
    if (!keepView && (date.getFullYear() !== cal.view.y || date.getMonth() !== cal.view.m)) {
        cal.view = { y: date.getFullYear(), m: date.getMonth() };
    }
    renderCalendar();
    document.getElementById("day-info-date").textContent = longDate(key);
    document.getElementById("day-info-text").textContent = describeDay(key);
}

function renderCalendar() {
    const grid = document.getElementById("cal-grid");
    document.getElementById("cal-title").textContent = MONTHS[cal.view.m] + " " + cal.view.y;
    grid.replaceChildren();
    const first = new Date(cal.view.y, cal.view.m, 1);
    const cursor = new Date(cal.view.y, cal.view.m, 1 - first.getDay());
    const today = dateKey(new Date());
    for (let i = 0; i < 42; i += 1) {
        const key = dateKey(cursor);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "cal-day";
        button.textContent = String(cursor.getDate());
        if (cursor.getMonth() !== cal.view.m) button.classList.add("out");
        if ([0, 6].indexOf(cursor.getDay()) !== -1) button.classList.add("weekend");
        if (inWindow(key) && !cal.skipped.has(key)) button.classList.add("range");
        if (isHoliday(key)) button.classList.add("holiday");
        if (key === today) button.classList.add("today");
        if (key === cal.deadline) button.classList.add("deadline");
        if (key === cal.selected) {
            button.classList.add("selected");
            button.setAttribute("aria-pressed", "true");
        }
        button.setAttribute("aria-label", longDate(key) + ". " + describeDay(key));
        button.title = describeDay(key);
        button.addEventListener("click", function () { selectDay(key); });
        grid.appendChild(button);
        cursor.setDate(cursor.getDate() + 1);
    }
}

function moveMonth(step) {
    const next = new Date(cal.view.y, cal.view.m + step, 1);
    cal.view = { y: next.getFullYear(), m: next.getMonth() };
    renderCalendar();
}

async function loadDeadline() {
    const data = await HubApi.deadline();
    cal.deadline = data.deadline;
    cal.start = data.start_date || dateKey(new Date());
    cal.total = data.working_days;
    cal.skipped = new Map(data.skipped_days.map(function (item) { return [item.date, item.reason]; }));

    document.getElementById("deadline-date").textContent = longDate(data.deadline);
    document.getElementById("deadline-days").textContent = data.working_days;
    const daysLeft = Math.round((parseKey(data.deadline) - parseKey(dateKey(new Date()))) / 86400000);
    document.getElementById("deadline-left").textContent = daysLeft > 0
        ? daysLeft + " calendar day" + (daysLeft === 1 ? "" : "s") + " left"
        : daysLeft === 0 ? "Due today" : "Deadline has passed";

    const list = document.getElementById("skipped-list");
    list.replaceChildren();
    data.skipped_days.forEach(function (item) {
        const li = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = parseKey(item.date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
        button.addEventListener("click", function () { selectDay(item.date); });
        const reason = document.createElement("span");
        reason.textContent = item.reason;
        li.append(button, reason);
        list.appendChild(li);
    });
    if (!data.skipped_days.length) {
        const li = document.createElement("li");
        li.textContent = "No weekends or holidays fell in this range.";
        list.appendChild(li);
    }

    const now = new Date();
    cal.view = { y: now.getFullYear(), m: now.getMonth() };
    selectDay(data.deadline, true);
}

document.getElementById("cal-prev").addEventListener("click", function () { if (cal.view) moveMonth(-1); });
document.getElementById("cal-next").addEventListener("click", function () { if (cal.view) moveMonth(1); });
document.getElementById("cal-today").addEventListener("click", function () {
    if (cal.view) selectDay(dateKey(new Date()));
});

const LOADERS = {
    status: function () { return Promise.all([loadStatus(), loadSlip()]); },
    deadline: loadDeadline
};

/* ---------- Tabs ---------- */
async function showTab(name) {
    if (TABS.indexOf(name) === -1) name = "status";
    TABS.forEach(function (tab) {
        document.getElementById("tab-" + tab).hidden = tab !== name;
    });
    document.querySelectorAll(".nav-link").forEach(function (link) {
        const active = link.dataset.tab === name;
        link.classList.toggle("active", active);
        if (active) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
    });
    navigation.classList.remove("show");
    menuToggle.classList.remove("open");
    menuToggle.setAttribute("aria-expanded", "false");
    showMessage("", false);
    if (loaded[name]) return;
    loaded[name] = true;
    try {
        await LOADERS[name]();
    } catch (error) {
        loaded[name] = false;
        if (error.status === 401) {
            goToLogin();
            return;
        }
        showMessage(error.message || "Unable to load Hub data.", true);
    }
}

function currentTab() {
    return location.hash.replace("#", "");
}

window.addEventListener("hashchange", function () { showTab(currentTab()); });

menuToggle.addEventListener("click", function () {
    const open = navigation.classList.toggle("show");
    menuToggle.classList.toggle("open", open);
    menuToggle.setAttribute("aria-expanded", String(open));
    menuToggle.setAttribute("aria-label", open ? "Close navigation menu" : "Open navigation menu");
});

document.getElementById("logout-btn").addEventListener("click", async function () {
    try { await HubApi.logout(); } catch (error) { /* session may already be gone */ }
    goToLogin();
});

/* ---------- Start: only a signed-in student may stay ---------- */
(async function () {
    if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("../../service-worker.js").catch(function () {});
    }
    if (!sessionStorage.getItem("token")) {
        goToLogin();
        return;
    }
    try {
        const result = await HubApi.me();
        const user = result.user;
        sessionStorage.setItem("role", user.role);
        sessionStorage.setItem("user", JSON.stringify(user));
        if (user.role !== "student") {
            location.href = OTHER_HOMES[user.role] || LOGIN_URL;
            return;
        }
        document.getElementById("role-label").textContent = "Signed in as: " + user.username;
        await showTab(currentTab());
    } catch (error) {
        if (error.status === 401) {
            goToLogin();
            return;
        }
        showMessage(error.message || "Unable to load Hub data.", true);
    }
})();
