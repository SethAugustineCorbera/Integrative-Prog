/* Student page: status, clearance slip and deadline in one page. Talks to the Hub API only (R8). */
"use strict";

const LOGIN_URL = "../../index.html#login";
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
    studentInfo = data.student;
    renderProgress(data.offices);
}

/* The four offices, in the order students visit them. */
const OFFICE_ORDER = ["library", "accounting", "student-affairs", "registrar"];
const OFFICE_HINT = {
    "library": "Return any borrowed books and pay any fines at the Library, then wait for the Library to sign you off.",
    "accounting": "Settle your tuition, fees and fines at the Accounting office. The balance clears once Accounting confirms payment.",
    "student-affairs": "Return borrowed equipment and pay any organization membership fee at Student Affairs.",
    "registrar": "Visit the Registrar to fix your enrollment record. The Registrar signs you off last."
};
let officeRows = [];

function orderedOffices(offices) {
    return offices.slice().sort(function (a, b) {
        const x = OFFICE_ORDER.indexOf(a.office_code), y = OFFICE_ORDER.indexOf(b.office_code);
        return (x < 0 ? 99 : x) - (y < 0 ? 99 : y);
    });
}

/* Offices keep their findings as text; turn the structured ones into readable lines. */
function reasonLines(item) {
    const today = dateKey(new Date());
    const lines = [];
    String(item.reason || "").split(/;\s*(?![^()]*\))/).forEach(function (raw) {
        const part = raw.trim();
        let m;
        if (!part) return;
        if ((m = /^Outstanding balance of (PHP [\d.,]+)\s*\((.*)\)$/i.exec(part))) {
            lines.push("Outstanding balance: " + m[1]);
            m[2].split(/;\s*/).forEach(function (piece) { lines.push(piece.charAt(0).toUpperCase() + piece.slice(1)); });
        } else if ((m = /^Book:\s*(.*?)\s*\((?:due (\d{4}-\d{2}-\d{2})|no due date)\)$/i.exec(part))) {
            const late = m[2] && m[2] < today ? Math.round((parseKey(today) - parseKey(m[2])) / 86400000) : 0;
            lines.push("Unreturned book: " + m[1] + (m[2] ? ", due " + m[2] : "") + (late ? " (" + late + " day" + (late === 1 ? "" : "s") + " overdue, fine is growing)" : ""));
        } else if ((m = /^Fine:\s*(.*?)\s*\((PHP [\d.,]+)\)$/i.exec(part))) {
            lines.push("Unpaid library fine: " + m[2] + " for " + m[1]);
        } else if ((m = /^Organization membership:\s*(.*?)\s*\((paid|unpaid)\)$/i.exec(part))) {
            lines.push("Membership fee, " + m[1] + ": " + m[2]);
        } else if ((m = /^Borrowed equipment:\s*(.+)$/i.exec(part))) {
            lines.push("Borrowed equipment not returned: " + m[1]);
        } else if (part !== "Awaiting office review.") {
            lines.push(part);
        }
    });
    if (!lines.length) lines.push(item.status === "CLEARED" ? "Nothing outstanding. This office has signed you off." : "This office has not reviewed your record yet.");
    return lines;
}

function iconFor(code) {
    return "../../assets/icons/" + (OFFICE_ORDER.indexOf(code) >= 0 ? code : "clearance") + ".svg";
}

/* Progress tracker (one labelled segment per office) and the clickable checklist. */
function renderProgress(offices) {
    officeRows = orderedOffices(offices);
    const total = officeRows.length;
    const cleared = officeRows.filter(function (item) { return item.status === "CLEARED"; });
    const percent = total ? Math.round((cleared.length / total) * 100) : 0;
    document.getElementById("progress-text").textContent = total
        ? cleared.length + " of " + total + " offices cleared"
        : "No offices are configured yet.";
    document.getElementById("progress-percent").textContent = percent + "%";
    const track = document.getElementById("progress-track");
    track.setAttribute("aria-valuenow", String(percent));
    track.replaceChildren();
    officeRows.forEach(function (item) {
        const cell = document.createElement("div");
        cell.className = "segment-cell";
        const segment = document.createElement("span");
        segment.className = "segment " + (item.status === "CLEARED" ? "done" : "open");
        segment.title = item.office + ": " + item.status;
        const label = document.createElement("small");
        label.textContent = item.office;
        cell.append(segment, label);
        track.appendChild(cell);
    });
    const pending = officeRows.filter(function (item) { return item.status !== "CLEARED"; });
    document.getElementById("progress-next").textContent = !total ? ""
        : pending.length ? "Still needed: " + pending.map(function (item) { return item.office; }).join(", ") + "."
        : "You are fully cleared. Show your slip at the Registrar.";

    const list = document.getElementById("checklist");
    list.replaceChildren();
    officeRows.forEach(function (item) {
        const done = item.status === "CLEARED";
        const li = document.createElement("li");
        li.className = (done ? "done" : "open") + " clickable";
        li.tabIndex = 0;
        li.setAttribute("role", "button");
        li.setAttribute("aria-label", item.office + ": " + item.status + ". Show details.");
        const icon = document.createElement("img");
        icon.src = iconFor(item.office_code);
        icon.alt = "";
        icon.width = 34;
        icon.height = 34;
        const text = document.createElement("div");
        text.className = "check-text";
        const name = document.createElement("strong");
        name.textContent = item.office;
        const summary = document.createElement("span");
        summary.textContent = done ? "Signed off" : "On hold. Click to see why.";
        text.append(name, summary);
        const state = document.createElement("span");
        state.className = "badge " + item.status.toLowerCase();
        state.textContent = item.status;
        li.append(icon, text, state);
        li.addEventListener("click", function () { openOffice(item); });
        li.addEventListener("keydown", function (event) {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openOffice(item);
            }
        });
        list.appendChild(li);
    });
}

const officeDialog = document.getElementById("office-dialog");

function openOffice(item) {
    const done = item.status === "CLEARED";
    document.getElementById("od-icon").src = iconFor(item.office_code);
    document.getElementById("od-name").textContent = item.office;
    document.getElementById("od-updated").textContent = item.updated_at
        ? "Updated " + new Date(String(item.updated_at).replace(" ", "T") + "Z").toLocaleString() : "";
    const badge = document.createElement("span");
    badge.className = "badge " + item.status.toLowerCase();
    badge.textContent = item.status;
    document.getElementById("od-status").replaceChildren(badge);
    document.getElementById("od-why-title").textContent = done ? "Status" : "Why you are on hold";
    const list = document.getElementById("od-reasons");
    list.replaceChildren();
    reasonLines(item).forEach(function (line) {
        const li = document.createElement("li");
        li.textContent = line;
        list.appendChild(li);
    });
    document.getElementById("od-next-title").hidden = done;
    document.getElementById("od-next").hidden = done;
    document.getElementById("od-next").textContent = OFFICE_HINT[item.office_code] || "Contact this office to settle the item above.";
    officeDialog.showModal();
    document.getElementById("od-close").focus();
}

document.getElementById("od-close").addEventListener("click", function () { officeDialog.close(); });
officeDialog.addEventListener("click", function (event) { if (event.target === officeDialog) officeDialog.close(); });

/* ---------- Slip ---------- */
let slipData = null;
let studentInfo = null;

function loadImage(url) {
    return new Promise(function (resolve, reject) {
        const image = new Image();
        image.onload = function () { resolve(image); };
        image.onerror = function () { reject(new Error("The QR code could not be prepared for download.")); };
        image.src = url;
    });
}

function wrapText(ctx, text, maxWidth) {
    const words = String(text).split(/\s+/);
    const lines = [];
    let line = "";
    words.forEach(function (word) {
        const attempt = line ? line + " " + word : word;
        if (ctx.measureText(attempt).width > maxWidth && line) { lines.push(line); line = word; } else { line = attempt; }
    });
    if (line) lines.push(line);
    return lines;
}

/* Draws the slip on an A4 canvas (150 dpi). */
async function drawSlip() {
    const W = 1240, H = 1754, M = 100;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    const INK = "#12354F", SKY = "#87CEFA", SKY2 = "#B5E8FF", BUTTER = "#FBFABA", MUTED = "#3D5F78", LINE = "#D3DEE6";
    const font = function (size, weight) { return (weight || 400) + " " + size + "px Inter, 'Segoe UI', Arial, sans-serif"; };
    ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, W, H);
    const band = ctx.createLinearGradient(0, 0, W, 0);
    band.addColorStop(0, "#0E2B42"); band.addColorStop(1, "#1B4B70");
    ctx.fillStyle = band; ctx.fillRect(0, 0, W, 220);
    ctx.fillStyle = SKY; ctx.fillRect(0, 220, W, 10);
    ctx.fillStyle = "#F4F4F2"; ctx.textBaseline = "alphabetic";
    ctx.font = font(30, 600); ctx.fillText("DNSC e-Clearance Hub", M, 95);
    ctx.font = font(62, 800); ctx.fillText("Clearance Slip", M, 168);

    const info = studentInfo || {};
    ctx.fillStyle = INK; ctx.font = font(50, 800);
    ctx.fillText(slipData.student.full_name, M, 330);
    ctx.fillStyle = MUTED; ctx.font = font(28, 500);
    ctx.fillText("Student ID: " + slipData.student.student_number, M, 378);
    if (info.program) ctx.fillText(info.program + ", year " + info.year_level, M, 420);

    /* Office table */
    let y = 480;
    ctx.fillStyle = INK; ctx.font = font(24, 700);
    ctx.fillText("OFFICE", M + 20, y + 40); ctx.fillText("STATUS", 620, y + 40); ctx.fillText("DATE", 880, y + 40);
    ctx.fillStyle = SKY2; ctx.fillRect(M, y, W - 2 * M, 64);
    ctx.fillStyle = INK; ctx.font = font(24, 700);
    ctx.fillText("OFFICE", M + 20, y + 41); ctx.fillText("STATUS", 620, y + 41); ctx.fillText("DATE", 880, y + 41);
    y += 64;
    officeRows.forEach(function (row, index) {
        ctx.fillStyle = index % 2 ? "#F4F4F2" : "#FFFFFF"; ctx.fillRect(M, y, W - 2 * M, 72);
        ctx.fillStyle = INK; ctx.font = font(28, 600); ctx.fillText(row.office, M + 20, y + 46);
        const cleared = row.status === "CLEARED";
        ctx.fillStyle = cleared ? SKY : BUTTER;
        ctx.beginPath(); ctx.roundRect(620, y + 14, 190, 44, 22); ctx.fill();
        if (!cleared) { ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.stroke(); }
        ctx.fillStyle = INK; ctx.font = font(22, 700); ctx.textAlign = "center";
        ctx.fillText(row.status, 715, y + 45); ctx.textAlign = "left";
        ctx.fillStyle = MUTED; ctx.font = font(24, 400);
        ctx.fillText(row.updated_at ? new Date(row.updated_at).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" }) : "-", 880, y + 45);
        y += 72;
    });
    ctx.strokeStyle = LINE; ctx.lineWidth = 2; ctx.strokeRect(M, 480, W - 2 * M, y - 480);

    /* Overall result */
    y += 60;
    ctx.fillStyle = INK; ctx.font = font(30, 700);
    ctx.fillText("Overall result: " + slipData.status, M, y);
    y += 45;
    ctx.font = font(26, 600);
    ctx.fillText(
        "Progress: " + slipData.progress.cleared + " of " + slipData.progress.total
            + " required offices cleared (" + slipData.progress.percent + "%)",
        M,
        y
    );

    /* QR + code */
    y += 50;
    const svgUrl = URL.createObjectURL(new Blob([slipData.qr_svg], { type: "image/svg+xml" }));
    try {
        const qr = await loadImage(svgUrl);
        const size = 420, qx = (W - size) / 2;
        ctx.fillStyle = "#FFFFFF"; ctx.fillRect(qx - 20, y - 20, size + 40, size + 40);
        ctx.strokeStyle = LINE; ctx.strokeRect(qx - 20, y - 20, size + 40, size + 40);
        ctx.drawImage(qr, qx, y, size, size);
        y += size + 90;
    } finally { URL.revokeObjectURL(svgUrl); }
    ctx.textAlign = "center";
    ctx.fillStyle = INK; ctx.font = "700 44px Consolas, 'Courier New', monospace";
    ctx.fillText(slipData.public_code, W / 2, y);
    ctx.fillStyle = MUTED; ctx.font = font(24, 400);
    y += 50;
    wrapText(ctx, "Show this signed QR code or short code to office staff. Verification shows your latest status. It expires " + new Date(slipData.expires_at).toLocaleString() + ".", W - 2 * M - 80).forEach(function (line) { ctx.fillText(line, W / 2, y); y += 36; });
    ctx.fillStyle = SKY; ctx.fillRect(0, H - 90, W, 6);
    ctx.fillStyle = MUTED; ctx.font = font(22, 400);
    ctx.fillText("Generated " + new Date().toLocaleString() + " by the DNSC e-Clearance Hub", W / 2, H - 40);
    ctx.textAlign = "left";
    return canvas;
}

/* Wraps a JPEG in a one-page A4 PDF (no libraries). */
function pdfFromJpeg(jpegBytes, width, height) {
    const encoder = new TextEncoder();
    const parts = [];
    const offsets = [];
    let length = 0;
    function push(chunk) { const bytes = typeof chunk === "string" ? encoder.encode(chunk) : chunk; parts.push(bytes); length += bytes.length; }
    function object(number, body) { offsets[number] = length; push(number + " 0 obj\n" + body + "\nendobj\n"); }
    push("%PDF-1.4\n");
    object(1, "<< /Type /Catalog /Pages 2 0 R >>");
    object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
    object(3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>");
    offsets[4] = length;
    push("4 0 obj\n<< /Type /XObject /Subtype /Image /Width " + width + " /Height " + height + " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + jpegBytes.length + " >>\nstream\n");
    push(jpegBytes);
    push("\nendstream\nendobj\n");
    const content = "q 595 0 0 842 0 0 cm /Im0 Do Q";
    object(5, "<< /Length " + content.length + " >>\nstream\n" + content + "\nendstream");
    const xref = length;
    let table = "xref\n0 6\n0000000000 65535 f \n";
    for (let i = 1; i <= 5; i++) table += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
    push(table + "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF");
    return new Blob(parts, { type: "application/pdf" });
}

document.getElementById("slip-download").addEventListener("click", async function () {
    const button = this;
    if (!slipData) return;
    button.disabled = true;
    try {
        const canvas = await drawSlip();
        const jpeg = await new Promise(function (resolve) { canvas.toBlob(resolve, "image/jpeg", 0.92); });
        const bytes = new Uint8Array(await jpeg.arrayBuffer());
        const pdf = pdfFromJpeg(bytes, canvas.width, canvas.height);
        const link = document.createElement("a");
        link.href = URL.createObjectURL(pdf);
        link.download = "clearance-slip-" + slipData.student.full_name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + ".pdf";
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () { URL.revokeObjectURL(link.href); }, 2000);
    } catch (error) {
        document.getElementById("slip-note").textContent = error.message || "The slip could not be downloaded.";
    } finally {
        button.disabled = false;
    }
});
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
        image.alt = "QR code containing the signed clearance short code";
        image.src = imageUrl;
        qr.dataset.imageUrl = imageUrl;
        qr.replaceChildren(image);
        qr.hidden = false;
        code.textContent = data.public_code;
        code.hidden = false;
        slipData = data;
        document.getElementById("slip-download").hidden = false;
        note.textContent = "The QR and printed short code are the same signed value. This unique code stays the same until it expires. Current progress: " + data.progress.cleared + " of "
            + data.progress.total + " required offices cleared (" + data.progress.percent
            + "%). Staff verification shows your latest progress. It expires "
            + new Date(data.expires_at).toLocaleString() + ".";
    } catch (error) {
        if (error.status === 401) throw error;
        qr.hidden = true;
        code.hidden = true;
        slipData = null;
        document.getElementById("slip-download").hidden = true;
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
            location.href = homeFor(user, "../../");
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
