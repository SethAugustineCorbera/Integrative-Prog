/* Office pages (library, accounting, registrar, student-affairs). One shared script; the page says which office it is
   with <body data-office="...">. Talks to the Hub API only (R8). */
"use strict";

const LOGIN_URL = "../../index.html#login";
const OFFICE = document.body.dataset.office;
const messageBox = document.getElementById("api-message");
const navigation = document.getElementById("main-navigation");
const menuToggle = document.getElementById("menu-toggle");
const dialog = document.getElementById("reason-dialog");
let office = null;      // { code, name }
let students = [];      // full queue for this office

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

function badge(value) {
    const span = document.createElement("span");
    span.className = "badge " + String(value).toLowerCase().replace(/\s+/g, "-");
    span.textContent = value;
    return span;
}

function emptyRow(body, columns, text) {
    const cell = body.insertRow().insertCell();
    cell.colSpan = columns;
    cell.className = "empty";
    cell.textContent = text;
}

function handleError(error) {
    if (error.status === 401) {
        goToLogin();
        return;
    }
    showMessage(error.message || "Unable to load Hub data.", true);
}

/* ---------- What each office checks before it signs a student off ---------- */
/* The office exports (and Student Affairs entries) store their findings in the clearance reason text, so the page
   reads that text to show the outstanding items. Each check is { label, ok, detail, short }. */
function peso(text) { return "PHP " + text; }

function segments(reason) {
    return String(reason || "").split(/;\s*/).map(function (part) {
        const match = /^(Organization membership|Borrowed equipment):\s*(.+)$/i.exec(part.trim());
        if (match) return { type: /^org/i.test(match[1]) ? "Organization membership" : "Borrowed equipment", detail: match[2].trim() };
        return { type: "Other", detail: part.trim() };
    }).filter(function (item) { return item.detail && item.detail !== "Awaiting office review."; });
}

function openHold(item, known) {
    // A HOLD whose text the page does not recognise is still an outstanding item.
    if (item.status !== "HOLD" || known || String(item.reason || "").trim() === PENDING_REASON) return null;
    return { label: "Open HOLD on record", ok: false, detail: item.reason, short: "HOLD" };
}

/* ---------- Library: loans and automatic fines ---------- */
const FINE_PER_DAY = 5; // PHP per overdue day, per book. Change here to match library policy.
const DAY_MS = 86400000;

function todayKey() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function daysOverdue(due) {
    if (!due) return 0;
    const a = due.split("-").map(Number);
    const b = todayKey().split("-").map(Number);
    const days = Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / DAY_MS);
    return days > 0 ? days : 0;
}

function accrued(book) { return daysOverdue(book.due) * FINE_PER_DAY; }

/* One record per student per office, so the loans live in the reason text:
   "Book: Database Systems (due 2026-12-01); Fine: Networks (PHP 50.00)". Old imports
   ("2 unreturned book(s); unpaid fine of PHP 150.00") are still understood. */
function libraryOf(item) {
    const state = { books: [], fines: [], other: [] };
    String(item.reason || "").split(/;\s*/).forEach(function (raw) {
        const part = raw.trim();
        let m;
        if (!part || part === "Awaiting office review.") return;
        if ((m = /^Book:\s*(.*?)\s*\((?:due (\d{4}-\d{2}-\d{2})|no due date)\)$/i.exec(part))) state.books.push({ title: m[1], due: m[2] || null });
        else if ((m = /^Fine:\s*(.*?)\s*\(PHP\s*([\d,]+(?:\.\d+)?)\)$/i.exec(part))) state.fines.push({ title: m[1], amount: parseMoney(m[2]) });
        else if ((m = /^(\d+)\s+unreturned book/i.exec(part))) {
            for (let i = 0; i < Number(m[1]); i += 1) state.books.push({ title: "Unreturned book", due: null });
        } else if ((m = /fine of PHP\s*([\d,]+(?:\.\d+)?)/i.exec(part))) state.fines.push({ title: "Imported fine", amount: parseMoney(m[1]) });
        else if (item.status === "HOLD") state.other.push(part);
    });
    return state;
}

function encodeLibrary(state) {
    return state.books.map(function (b) { return "Book: " + b.title + " (" + (b.due ? "due " + b.due : "no due date") + ")"; })
        .concat(state.fines.map(function (f) { return "Fine: " + f.title + " (" + money(f.amount).replace(/,/g, "") + ")"; }))
        .concat(state.other).join("; ");
}

function finesDue(state) {
    return state.fines.reduce(function (s, f) { return s + f.amount; }, 0)
        + state.books.reduce(function (s, b) { return s + accrued(b); }, 0);
}

function bookText(book) {
    const late = daysOverdue(book.due);
    return book.title + (book.due ? " · due " + book.due : "") + (late ? " · " + late + " day" + (late === 1 ? "" : "s") + " late" : "");
}

/* ---------- Student Affairs: equipment loans and organization memberships ---------- */
const ORGS = ["Codex", "SERT", "DNSC SEA"];
const ORG_FEES = {}; // optional membership fees in PHP, e.g. { Codex: 100, SERT: 150, "DNSC SEA": 100 }

function orgText(org) { return org.name + " (" + (org.paid ? "paid" : "unpaid") + ")"; }
function orgFee(name) { return ORG_FEES[name] ? " \u00b7 " + money(ORG_FEES[name]) : ""; }

/* One clearance record per student per office, so everything is kept in its reason text:
   "Borrowed equipment: Projector; Organization membership: Codex (unpaid)". */
function affairsOf(item) {
    const state = { equipment: [], orgs: [], other: [] };
    segments(item.reason).forEach(function (part) {
        if (part.type === "Borrowed equipment") state.equipment.push(part.detail);
        else if (part.type === "Organization membership") {
            const match = /^(.*?)\s*\((paid|unpaid)\)$/i.exec(part.detail);
            state.orgs.push({ name: match ? match[1] : part.detail, paid: Boolean(match) && match[2].toLowerCase() === "paid" });
        } else if (item.status === "HOLD") state.other.push(part.detail);
    });
    return state;
}

function encodeAffairs(state) {
    return state.equipment.map(function (name) { return "Borrowed equipment: " + name; })
        .concat(state.orgs.map(function (org) { return "Organization membership: " + orgText(org); }))
        .concat(state.other).join("; ");
}

/* ---------- Accounting: amounts and fee breakdown ---------- */
function parseMoney(text) { return parseFloat(String(text).replace(/,/g, "")); }
function money(value) {
    return "PHP " + value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function balanceOf(item) {
    if (item.status !== "HOLD") return 0;
    const match = /balance of PHP\s*([\d,]+(?:\.\d+)?)/i.exec(item.reason);
    return match ? parseMoney(match[1]) : 0;
}

/* The export stores one total. When a record also carries "(tuition PHP x; fees PHP y; fines PHP z)" the card itemizes it. */
function breakdownOf(item) {
    const total = balanceOf(item);
    const result = { total: total, tuition: null, fees: null, fines: null, itemized: false, matches: true };
    const group = /\(([^)]*)\)/.exec(item.reason || "");
    if (!group) return result;
    group[1].split(/;\s*/).forEach(function (part) {
        const match = /^\s*(tuition|fees?|other fines?|fines?)\b\D*([\d,]+(?:\.\d+)?)/i.exec(part);
        if (!match) return;
        const key = /^tuition/i.test(match[1]) ? "tuition" : /^fee/i.test(match[1]) ? "fees" : "fines";
        result[key] = (result[key] || 0) + parseMoney(match[2]);
    });
    result.itemized = result.tuition !== null || result.fees !== null || result.fines !== null;
    const sum = (result.tuition || 0) + (result.fees || 0) + (result.fines || 0);
    result.matches = !result.itemized || Math.abs(sum - total) < 0.005;
    return result;
}

/* ---------- Registrar: sign-offs of the other offices (read-only) ---------- */
const OTHER_OFFICES = [["library", "Library"], ["accounting", "Accounting"], ["student-affairs", "Student Affairs"]];
let others = {};      // student number -> { library: row, accounting: row, "student-affairs": row }
let othersOk = false;

function officeIssue(code, record) {
    if (!record) return "No record yet.";
    const failing = PROFILES[code].analyse(record).filter(function (check) { return !check.ok; });
    return failing.length ? failing.map(function (check) { return check.label + ": " + check.detail; }).join("; ") : record.reason;
}

function missingOffices(item) {
    return OTHER_OFFICES.filter(function (entry) {
        const record = (others[item.student_number] || {})[entry[0]];
        return !record || record.status !== "CLEARED";
    }).map(function (entry) { return entry[1]; });
}

async function loadOthers() {
    try {
        const results = await Promise.all(OTHER_OFFICES.map(function (entry) { return HubApi.officeQueue(entry[0], ""); }));
        others = {};
        results.forEach(function (result, index) {
            result.students.forEach(function (row) {
                (others[row.student_number] = others[row.student_number] || {})[OTHER_OFFICES[index][0]] = row;
            });
        });
        othersOk = true;
    } catch (error) {
        othersOk = false;
        if (error.status === 401) throw error;
        showMessage("Could not read the other offices' sign-offs: " + (error.message || "unknown error"), true);
    }
}

const PROFILES = {
    library: {
        columns: [["Student ID", "number"], ["Name", "name"], ["Unreturned books", "check:0"], ["Fines", "check:1"], ["Status", "status"]],
        holdCard: "With issues", clearCard: "Clear", detail: "library", library: true,
        filterHold: "Has unreturned books or fines", filterClear: "Clear",
        override: "I confirmed at the desk that these books and fines are settled.",
        clearReason: "No unreturned books or fines.",
        analyse: function (item) {
            const state = libraryOf(item);
            const due = finesDue(state);
            const late = state.books.filter(function (b) { return daysOverdue(b.due); }).length;
            const checks = [
                { label: "Unreturned books", ok: !state.books.length,
                  detail: state.books.length ? state.books.map(bookText).join("; ") : "None on record",
                  short: state.books.length ? state.books.length + " book" + (state.books.length === 1 ? "" : "s") + (late ? " (" + late + " overdue)" : "") : "None" },
                { label: "Library fines", ok: due === 0,
                  detail: due ? money(due) + " unpaid" + (state.books.some(function (b) { return accrued(b); }) ? " (includes fines still growing on overdue books)" : "") : "None on record",
                  short: due ? money(due) : "None" }
            ];
            if (state.other.length) checks.push({ label: "Open HOLD on record", ok: false, detail: state.other.join("; "), short: "HOLD" });
            return checks;
        }
    },
    accounting: {
        columns: [["Student ID", "number"], ["Name", "name"], ["Tuition / fee balance", "check:0"], ["Status", "status"]],
        holdCard: "Unsettled", clearCard: "Settled", detail: "fees",
        cards: function (list) {
            const total = list.reduce(function (sum, item) { return sum + balanceOf(item); }, 0);
            const unsettled = list.filter(function (item) { return item.status === "HOLD"; }).length;
            return [["Total outstanding", money(total)], ["Students with a balance", unsettled]];
        },
        filterHold: "Unsettled balance", filterClear: "Settled",
        override: "I confirmed at the cashier that this balance is settled.",
        clearReason: "No outstanding tuition or fee balance.",
        analyse: function (item) {
            const balance = /balance of PHP\s*([\d,]+(?:\.\d+)?)/i.exec(item.reason);
            const checks = [
                { label: "Tuition and fee balance", ok: !(balance && item.status === "HOLD"), detail: balance ? peso(balance[1]) + " unsettled" : "Fully settled", short: balance ? peso(balance[1]) : "Settled" }
            ];
            const extra = openHold(item, balance);
            if (extra) checks.push(extra);
            return checks;
        }
    },
    registrar: {
        columns: [["Student ID", "number"], ["Name", "name"], ["Program", "program"], ["Standing", "status"], ["Missing sign-offs", "missing"]],
        holdCard: "Not in good standing", clearCard: "In good standing", totalCard: "On masterlist", detail: "registrar", others: true,
        filterHold: "Not in good standing", filterClear: "In good standing",
        override: "I confirmed this student's enrollment record at the Registrar.",
        clearReason: "Enrolled and signed off by every office.",
        analyse: function (item) {
            const standing = { label: "Masterlist standing", ok: item.status === "CLEARED", detail: item.status === "CLEARED" ? "Enrolled and active on the official masterlist" : item.reason, short: item.status === "CLEARED" ? "Active" : "Inactive" };
            const checks = [standing];
            if (!othersOk) {
                checks.push({ label: "Other offices", ok: false, hard: true, detail: "Their sign-offs could not be read. Reload the page." });
                return checks;
            }
            OTHER_OFFICES.forEach(function (entry) {
                const record = (others[item.student_number] || {})[entry[0]];
                const ok = Boolean(record) && record.status === "CLEARED";
                checks.push({ label: entry[1], ok: ok, hard: true, detail: ok ? "Signed off" : "Missing sign-off. " + officeIssue(entry[0], record) });
            });
            return checks;
        }
    },
    "student-affairs": {
        columns: [["Student ID", "number"], ["Name", "name"], ["Organization", "check:0"], ["Equipment", "check:1"], ["Status", "status"]],
        holdCard: "With obligations", clearCard: "No obligations", detail: "affairs", affairs: true,
        filterHold: "Has obligations", filterClear: "No obligations",
        override: "I confirmed at the office that these obligations are settled.",
        clearReason: "No organization or equipment obligations.",
        analyse: function (item) {
            const state = affairsOf(item);
            const unpaid = state.orgs.filter(function (org) { return !org.paid; });
            const checks = [
                { label: "Organization membership fees", ok: !unpaid.length,
                  detail: state.orgs.length ? state.orgs.map(orgText).join(", ") : "Not in any organization",
                  short: state.orgs.length ? state.orgs.map(orgText).join(", ") : "None" },
                { label: "Borrowed equipment", ok: !state.equipment.length,
                  detail: state.equipment.length ? state.equipment.join(", ") : "Nothing borrowed",
                  short: state.equipment.length ? state.equipment.join(", ") : "None" }
            ];
            if (state.other.length) checks.push({ label: "Open HOLD on record", ok: false, detail: state.other.join("; "), short: "HOLD" });
            else if (item.status === "HOLD" && item.reason !== PENDING_REASON && !unpaid.length && !state.equipment.length) checks.push({ label: "Open HOLD on record", ok: false, detail: item.reason, short: "HOLD" });
            return checks;
        }
    }
};
const PROFILE = PROFILES[OFFICE];

/* Each office only lists the students who have something on record there. The full list stays loaded in `students`
   because the lend and organization forms look students up by number. */
/* A manual HOLD with its own reason must stay visible so staff can still release it. */
function manualHold(item) {
    return item.status === "HOLD" && String(item.reason || "").trim() !== PENDING_REASON;
}
PROFILES.library.relevant = function (item) {
    const state = libraryOf(item);
    return state.books.length > 0 || finesDue(state) > 0 || manualHold(item);
};
PROFILES.library.emptyText = "No students with unreturned books or fines.";
PROFILES.accounting.relevant = function (item) {
    const info = breakdownOf(item);
    return info.total > 0 || (info.tuition || 0) + (info.fees || 0) + (info.fines || 0) > 0 || manualHold(item);
};
PROFILES.accounting.emptyText = "No students with a tuition, fee or fine balance.";
PROFILES["student-affairs"].relevant = function (item) {
    const state = affairsOf(item);
    return state.orgs.length > 0 || state.equipment.length > 0 || manualHold(item);
};
PROFILES["student-affairs"].emptyText = "No students with an organization or borrowed equipment.";

function shown() {
    return PROFILE.relevant ? students.filter(PROFILE.relevant) : students;
}

function failing(item) {
    return PROFILE.analyse(item).filter(function (check) { return !check.ok; });
}

/* ---------- Queue + hold summary ---------- */
function formatDate(value) {
    if (!value) return "";
    const date = new Date(String(value).replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(value)) ? "" : "Z"));
    return isNaN(date) ? String(value) : date.toLocaleDateString();
}

function setupHead() {
    const head = document.getElementById("queue-head");
    head.replaceChildren();
    PROFILE.columns.concat([["Actions", "actions"]]).forEach(function (column) {
        const th = document.createElement("th");
        th.textContent = column[0];
        head.appendChild(th);
    });
    document.getElementById("filter-hold").textContent = PROFILE.filterHold;
    document.getElementById("filter-clear").textContent = PROFILE.filterClear;
    document.getElementById("card-a-label").textContent = PROFILE.totalCard || PROFILE.holdCard;
    document.getElementById("card-b-label").textContent = PROFILE.totalCard ? PROFILE.holdCard : PROFILE.clearCard;
}

function renderQueue() {
    const search = document.getElementById("queue-search").value.trim().toLowerCase();
    const filter = document.getElementById("queue-filter").value;
    const body = document.getElementById("queue-body");
    body.replaceChildren();
    const rows = shown().filter(function (item) {
        const text = (item.student_number + " " + item.full_name + " " + (item.program || "")).toLowerCase();
        return (!search || text.indexOf(search) !== -1) && (!filter || item.status === filter);
    });
    rows.forEach(function (item) {
        const row = body.insertRow();
        if (PROFILE.detail) {
            row.className = "clickable";
            row.tabIndex = 0;
            row.title = { fees: "Show fee breakdown", affairs: "Show equipment and memberships", library: "Show unreturned books and fines", registrar: "Show which offices have signed" }[PROFILE.detail];
            const open = function () { ({ fees: openDetail, affairs: openAffairs, library: openLibrary, registrar: openRegistrar })[PROFILE.detail](item); };
            row.addEventListener("click", function (event) {
                if (!event.target.closest("button")) open();
            });
            row.addEventListener("keydown", function (event) {
                if (event.key === "Enter" && event.target === row) {
                    event.preventDefault(); // otherwise this same keypress would hit the dialog's Close button
                    open();
                }
            });
        }
        const checks = PROFILE.analyse(item);
        PROFILE.columns.forEach(function (column) {
            const kind = column[1];
            if (kind === "number") addCell(row, item.student_number);
            else if (kind === "name") addCell(row, item.full_name);
            else if (kind === "program") addCell(row, item.program);
            else if (kind === "missing") addCell(row, !othersOk ? "\u2014" : missingOffices(item).join(", ") || "None");
            else if (kind === "updated") addCell(row, formatDate(item.updated_at));
            else if (kind === "status") row.insertCell().appendChild(badge(item.status));
            else {
                const check = checks[Number(kind.split(":")[1])];
                const cell = addCell(row, check.short);
                if (!check.ok) cell.className = "bad";
            }
        });
        const actions = row.insertCell();
        actions.className = "actions-cell";
        if (PROFILE.library) {
            const state = libraryOf(item);
            const returned = document.createElement("button");
            returned.type = "button";
            returned.className = "btn btn-sm";
            returned.textContent = "Book returned";
            returned.disabled = !state.books.length;
            returned.addEventListener("click", function () { openLibPicker("book", item); });
            const paid = document.createElement("button");
            paid.type = "button";
            paid.className = "btn btn-sm";
            paid.textContent = "Fee paid";
            paid.disabled = !state.fines.length;
            paid.addEventListener("click", function () { openLibPicker("fine", item); });
            actions.append(returned, paid);
        } else if (PROFILE.affairs) {
            const state = affairsOf(item);
            const returned = document.createElement("button");
            returned.type = "button";
            returned.className = "btn btn-sm";
            returned.textContent = "Equipment returned";
            returned.disabled = !state.equipment.length;
            returned.addEventListener("click", function () { openPicker("equipment", item); });
            const paid = document.createElement("button");
            paid.type = "button";
            paid.className = "btn btn-sm";
            paid.textContent = "Membership paid";
            paid.disabled = !state.orgs.some(function (org) { return !org.paid; });
            paid.addEventListener("click", function () { openPicker("org", item); });
            actions.append(returned, paid);
        } else {
            const signOff = document.createElement("button");
            signOff.type = "button";
            signOff.className = "btn btn-sm";
            signOff.textContent = "Sign off";
            signOff.addEventListener("click", function () { askReason("signoff", item); });
            const hold = document.createElement("button");
            hold.type = "button";
            hold.className = "btn btn-sm btn-hold";
            hold.textContent = "HOLD";
            hold.addEventListener("click", function () { askReason("hold", item); });
            actions.append(signOff, hold);
        }
    });
    if (!rows.length) emptyRow(body, PROFILE.columns.length + 1, shown().length ? "No matching students." : (PROFILE.emptyText || "No students in this office yet."));
}

function renderHolds() {
    const list = shown();
    const holds = list.filter(function (item) { return item.status === "HOLD"; });
    const cards = PROFILE.cards ? PROFILE.cards(list)
        : PROFILE.totalCard ? [[PROFILE.totalCard, list.length], [PROFILE.holdCard, holds.length]]
        : [[PROFILE.holdCard, holds.length], [PROFILE.clearCard, list.length - holds.length]];
    document.getElementById("card-a-label").textContent = cards[0][0];
    document.getElementById("count-hold").textContent = cards[0][1];
    document.getElementById("card-b-label").textContent = cards[1][0];
    document.getElementById("count-cleared").textContent = cards[1][1];
    const body = document.getElementById("hold-body");
    body.replaceChildren();
    holds.forEach(function (item) {
        const row = body.insertRow();
        const who = row.insertCell();
        who.textContent = item.full_name;
        const number = document.createElement("div");
        number.className = "muted";
        number.textContent = item.student_number;
        who.appendChild(number);
        addCell(row, item.reason);
    });
    if (!holds.length) emptyRow(body, 2, "Nothing outstanding.");
}

/* A student the office has not reviewed yet ("Awaiting office review.") who has no obligations here
   is signed off automatically. Real HOLDs and Registrar standing are never touched. */
const PENDING_REASON = "Awaiting office review.";
let autoRunning = false;

async function autoSignOff() {
    if (autoRunning || PROFILE.others) return 0;
    autoRunning = true;
    let done = 0;
    try {
        const waiting = students.filter(function (item) {
            return item.status === "HOLD" && String(item.reason || "").trim() === PENDING_REASON
                && PROFILE.analyse(item).every(function (check) { return check.ok; });
        });
        for (const item of waiting) {
            await HubApi.signOff(item.student_number, office.code, "Automatically signed off: " + PROFILE.clearReason);
            done += 1;
        }
    } catch (error) {
        if (error.status === 401) throw error;
        showMessage("Automatic sign-off stopped: " + (error.message || "unknown error"), true);
    } finally {
        autoRunning = false;
    }
    return done;
}

async function loadQueue() {
    let result = await HubApi.officeQueue(office.code, "");
    students = result.students;
    const signed = await autoSignOff();
    if (signed) {
        result = await HubApi.officeQueue(office.code, "");
        students = result.students;
        showMessage(signed + " student" + (signed === 1 ? "" : "s") + " with no obligations signed off automatically.", false);
    }
    if (PROFILE.others) await loadOthers();
    fillSignNames();
    renderQueue();
    renderHolds();
}

/* ---------- Sign off / HOLD dialog, with the office's check list ---------- */
let pending = null;

function updateSave() {
    const blocked = pending && pending.kind === "signoff" && pending.problems.length > 0
        && (pending.locked || !document.getElementById("override-box").checked);
    document.getElementById("reason-save").disabled = Boolean(blocked);
}

function checkItem(check) {
    const li = document.createElement("li");
    li.className = check.ok ? "pass" : "fail";
    const mark = document.createElement("span");
    mark.className = "mark";
    mark.textContent = check.ok ? "\u2713" : "\u2717";
    mark.setAttribute("aria-label", check.ok ? "Passed" : "Outstanding");
    const text = document.createElement("span");
    const strong = document.createElement("strong");
    strong.textContent = check.label + ": ";
    text.append(strong, document.createTextNode(check.detail));
    li.append(mark, text);
    return li;
}

function askReason(kind, item) {
    const checks = PROFILE.analyse(item);
    const problems = checks.filter(function (check) { return !check.ok; });
    pending = { kind: kind, item: item, problems: problems, locked: problems.some(function (check) { return check.hard; }) };
    document.getElementById("reason-title").textContent = kind === "signoff" ? "Review and sign off" : "Place HOLD";
    document.getElementById("reason-student").textContent = item.full_name + " (" + item.student_number + ") at " + office.name;
    const list = document.getElementById("check-list");
    list.replaceChildren();
    checks.forEach(function (check) {
        const li = document.createElement("li");
        li.className = check.ok ? "pass" : "fail";
        const mark = document.createElement("span");
        mark.className = "mark";
        mark.textContent = check.ok ? "✓" : "✗";
        mark.setAttribute("aria-label", check.ok ? "Passed" : "Outstanding");
        const text = document.createElement("span");
        const strong = document.createElement("strong");
        strong.textContent = check.label + ": ";
        text.append(strong, document.createTextNode(check.detail));
        li.append(mark, text);
        list.appendChild(li);
    });
    const override = document.getElementById("override-row");
    const box = document.getElementById("override-box");
    box.checked = false;
    override.hidden = !(kind === "signoff" && problems.length) || pending.locked;
    document.getElementById("override-text").textContent = PROFILE.override;
    const reason = document.getElementById("reason-input");
    if (kind === "signoff") {
        reason.value = problems.length
            ? "Confirmed settled at the desk: " + problems.map(function (p) { return p.detail; }).join("; ")
            : PROFILE.clearReason;
    } else {
        reason.value = "";
    }
    updateSave();
    dialog.showModal();
    reason.focus();
}

document.getElementById("override-box").addEventListener("change", updateSave);
document.getElementById("reason-cancel").addEventListener("click", function () { dialog.close(); });
document.getElementById("reason-form").addEventListener("submit", async function (event) {
    event.preventDefault();
    const reason = document.getElementById("reason-input").value.trim();
    if (!reason || !pending) return;
    if (pending.kind === "signoff" && pending.problems.length && (pending.locked || !document.getElementById("override-box").checked)) return;
    const save = document.getElementById("reason-save");
    save.disabled = true;
    const done = pending;
    try {
        if (done.kind === "signoff") await HubApi.signOff(done.item.student_number, office.code, reason);
        else await HubApi.placeHold(done.item.student_number, office.code, reason);
        dialog.close();
        showMessage(done.kind === "signoff" ? "Student signed off." : "HOLD saved.", false);
        await loadQueue();
    } catch (error) {
        dialog.close();
        handleError(error);
    } finally {
        pending = null;
        save.disabled = false;
    }
});

document.getElementById("queue-search").addEventListener("input", renderQueue);
document.getElementById("queue-filter").addEventListener("change", renderQueue);

/* ---------- Accounting: fee breakdown card ---------- */
const detailDialog = document.getElementById("detail-dialog");
let detailItem = null;

function openDetail(item) {
    detailItem = item;
    const info = breakdownOf(item);
    document.getElementById("detail-name").textContent = item.full_name;
    document.getElementById("detail-meta").textContent = item.student_number + (item.program ? " \u00b7 " + item.program : "");
    const status = document.getElementById("detail-status");
    status.replaceChildren(badge(item.status));
    const body = document.getElementById("fee-body");
    body.replaceChildren();
    [["Tuition", info.tuition], ["Fees", info.fees], ["Other fines", info.fines]].forEach(function (line) {
        const row = body.insertRow();
        addCell(row, line[0]);
        const cell = addCell(row, line[1] === null ? "\u2014" : money(line[1]));
        cell.className = "amount";
    });
    const total = document.getElementById("fee-total");
    total.textContent = money(info.total);
    total.className = info.total > 0 ? "amount bad" : "amount";
    const note = document.getElementById("fee-note");
    if (info.total === 0) note.textContent = "Fully settled. Nothing is owed.";
    else if (!info.itemized) note.textContent = "The Accounting export only provides the total balance for this student, so the tuition, fee and fine amounts are not itemized.";
    else if (!info.matches) note.textContent = "The itemized amounts do not add up to the total balance. Check with the cashier.";
    else note.textContent = "Itemized from the latest Accounting export.";
    document.getElementById("detail-signoff").hidden = false;
    detailDialog.showModal();
    document.getElementById("detail-close").focus();
}

if (detailDialog) {
    document.getElementById("detail-close").addEventListener("click", function () { detailDialog.close(); });
    document.getElementById("detail-signoff").addEventListener("click", function () {
        const item = detailItem;
        detailDialog.close();
        if (item) askReason("signoff", item);
    });
    detailDialog.addEventListener("click", function (event) {
        if (event.target === detailDialog) detailDialog.close();
    });
}

/* ---------- Verify slip ---------- */
function showResult(pairs) {
    const list = document.getElementById("verify-list");
    list.replaceChildren();
    pairs.forEach(function (pair) {
        const dt = document.createElement("dt");
        dt.textContent = pair[0];
        const dd = document.createElement("dd");
        if (pair[1] instanceof Node) dd.appendChild(pair[1]);
        else dd.textContent = pair[1];
        list.append(dt, dd);
    });
    list.hidden = false;
    document.getElementById("verify-empty").hidden = true;
}

document.getElementById("verify-form").addEventListener("submit", async function (event) {
    event.preventDefault();
    const code = document.getElementById("slip-code-input").value.trim();
    const token = document.getElementById("slip-token-input").value.trim();
    if (!code && !token) {
        showMessage("Enter a short code or a signed token.", true);
        return;
    }
    const button = document.getElementById("verify-btn");
    button.disabled = true;
    showMessage("", false);
    try {
        const result = await HubApi.verifySlip(token ? { token: token } : { code: code });
        const pairs = [["Signature", badge(result.verified ? "VERIFIED" : "NOT VERIFIED")]];
        if (result.verified) {
            pairs.push(["Student", result.student.full_name + " (" + result.student.student_number + ")"]);
            pairs.push(["Overall", badge(result.overall)]);
            if (result.expires_at) pairs.push(["Expires", new Date(result.expires_at).toLocaleString()]);
            pairs.push(["Result", "Valid signed clearance slip."]);
        } else {
            pairs.push(["Result", result.reason || "Slip could not be verified."]);
        }
        showResult(pairs);
    } catch (error) {
        if (error.status === 401) goToLogin();
        else showMessage(error.message, true);
    } finally {
        button.disabled = false;
    }
});

/* ---------- Registrar: report export (masked IDs) ---------- */
function reportError(error) {
    if (error.status === 401) { goToLogin(); return; }
    const body = document.getElementById("report-body");
    body.replaceChildren();
    emptyRow(body, 4, "Reports are not available to this account.");
    showMessage(error.status === 403 ? "Only the Registrar office and administrators can export reports. If you are the Registrar and see this, restart the Hub server so it loads the latest hub.py." : error.message, true);
}

async function loadReport() {
    const body = document.getElementById("report-body");
    if (!body) return;
    try {
        const result = await HubApi.report("json");
        body.replaceChildren();
        result.students.forEach(function (item) {
            const row = body.insertRow();
            addCell(row, item.student_id);
            addCell(row, item.program);
            addCell(row, item.year_level);
            row.insertCell().appendChild(badge(item.overall));
        });
        if (!result.students.length) emptyRow(body, 4, "No students to report.");
    } catch (error) {
        opened.reports = false;
        reportError(error);
    }
}

document.querySelectorAll("[data-export]").forEach(function (button) {
    button.addEventListener("click", async function () {
        button.disabled = true;
        try {
            await HubApi.downloadReport(button.dataset.export);
            showMessage("Report downloaded.", false);
        } catch (error) {
            showMessage(/40[13]/.test(error.message) ? "Only the Registrar office and administrators can export reports. If you are the Registrar and see this, restart the Hub server so it loads the latest hub.py." : error.message, true);
        } finally {
            button.disabled = false;
        }
    });
});

/* ---------- Student Affairs: student card, picker, lend and organization forms ---------- */
const affairsDialog = document.getElementById("sa-detail-dialog");
const pickDialog = document.getElementById("pick-dialog");
let affairsItem = null;
let picking = null;

function stateFor(number) {
    const found = students.filter(function (item) { return item.student_number === number; })[0];
    return found ? affairsOf(found) : { equipment: [], orgs: [], other: [] };
}

/* Saves the whole record: still outstanding -> HOLD, nothing left -> cleared (paid memberships stay listed). */
async function saveAffairs(number, state) {
    const reason = encodeAffairs(state);
    if (reason.length > 255) throw new Error("Too many items for one student record. Mark something returned or paid first.");
    const outstanding = state.equipment.length > 0 || state.orgs.some(function (org) { return !org.paid; }) || state.other.length > 0;
    if (outstanding) await HubApi.placeHold(number, office.code, reason);
    else await HubApi.signOff(number, office.code, reason || "No organization or equipment obligations.");
    await loadQueue();
}

function fillList(list, entries, emptyText) {
    list.replaceChildren();
    entries.forEach(function (entry) {
        const li = document.createElement("li");
        const name = document.createElement("span");
        name.textContent = entry.text;
        li.appendChild(name);
        if (entry.badge) li.appendChild(badge(entry.badge));
        list.appendChild(li);
    });
    if (!entries.length) {
        const li = document.createElement("li");
        li.className = "empty-item";
        li.textContent = emptyText;
        list.appendChild(li);
    }
}

function openAffairs(item) {
    affairsItem = item;
    const state = affairsOf(item);
    document.getElementById("sa-name").textContent = item.full_name;
    document.getElementById("sa-meta").textContent = item.student_number + (item.program ? " \u00b7 " + item.program : "");
    document.getElementById("sa-status").replaceChildren(badge(item.status));
    fillList(document.getElementById("sa-equipment"), state.equipment.map(function (name) { return { text: name, badge: "NOT RETURNED" }; }), "Nothing borrowed.");
    fillList(document.getElementById("sa-orgs"), state.orgs.map(function (org) {
        return { text: org.name + orgFee(org.name) + " (membership fee)", badge: org.paid ? "PAID" : "UNPAID" };
    }), "Not a member of any organization.");
    document.getElementById("sa-return").disabled = !state.equipment.length;
    document.getElementById("sa-paid").disabled = !state.orgs.some(function (org) { return !org.paid; });
    affairsDialog.showModal();
    document.getElementById("sa-close").focus();
}

function openPicker(kind, item) {
    const state = affairsOf(item);
    const entries = kind === "equipment"
        ? state.equipment.map(function (name, index) { return { index: index, text: name }; })
        : state.orgs.map(function (org, index) { return { index: index, text: org.name + orgFee(org.name), org: org }; })
            .filter(function (entry) { return !entry.org.paid; });
    if (!entries.length) return;
    picking = { kind: kind, item: item, entries: entries };
    document.getElementById("pick-title").textContent = kind === "equipment" ? "Confirm equipment returned" : "Confirm membership paid";
    document.getElementById("pick-student").textContent = item.full_name + " (" + item.student_number + ")";
    const list = document.getElementById("pick-list");
    list.replaceChildren();
    entries.forEach(function (entry, position) {
        const li = document.createElement("li");
        const label = document.createElement("label");
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = true;
        box.dataset.position = String(position);
        box.addEventListener("change", updatePick);
        label.append(box, document.createTextNode(" " + entry.text));
        li.appendChild(label);
        list.appendChild(li);
    });
    updatePick();
    pickDialog.showModal();
    document.getElementById("pick-save").focus();
}

function updatePick() {
    const anyChecked = document.querySelectorAll("#pick-list input:checked").length > 0;
    document.getElementById("pick-save").disabled = !anyChecked;
}

if (affairsDialog) {
    document.getElementById("sa-close").addEventListener("click", function () { affairsDialog.close(); });
    affairsDialog.addEventListener("click", function (event) { if (event.target === affairsDialog) affairsDialog.close(); });
    document.getElementById("sa-return").addEventListener("click", function () {
        const item = affairsItem;
        affairsDialog.close();
        if (item) openPicker("equipment", item);
    });
    document.getElementById("sa-paid").addEventListener("click", function () {
        const item = affairsItem;
        affairsDialog.close();
        if (item) openPicker("org", item);
    });
    document.getElementById("pick-cancel").addEventListener("click", function () { pickDialog.close(); });
    document.getElementById("pick-form").addEventListener("submit", async function (event) {
        event.preventDefault();
        if (!picking) return;
        const chosen = Array.prototype.map.call(document.querySelectorAll("#pick-list input:checked"), function (box) {
            return picking.entries[Number(box.dataset.position)].index;
        });
        const done = picking;
        const state = affairsOf(done.item);
        if (done.kind === "equipment") state.equipment = state.equipment.filter(function (name, index) { return chosen.indexOf(index) === -1; });
        else state.orgs.forEach(function (org, index) { if (chosen.indexOf(index) !== -1) org.paid = true; });
        const save = document.getElementById("pick-save");
        save.disabled = true;
        try {
            await saveAffairs(done.item.student_number, state);
            pickDialog.close();
            showMessage(done.kind === "equipment" ? "Equipment marked as returned." : "Membership marked as paid.", false);
        } catch (error) {
            pickDialog.close();
            handleError(error);
        } finally {
            picking = null;
            save.disabled = false;
        }
    });
}

function cleanName(text) {
    return text.replace(/[;()]/g, " ").replace(/\s+/g, " ").trim();
}

const lendForm = document.getElementById("lend-form");
if (lendForm) {
    lendForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        const number = document.getElementById("lend-student").value.trim();
        const equipment = cleanName(document.getElementById("lend-equipment").value);
        if (!number || !equipment) {
            showMessage("Enter the student ID and the equipment borrowed.", true);
            return;
        }
        const button = document.getElementById("lend-btn");
        button.disabled = true;
        showMessage("", false);
        try {
            const state = stateFor(number);
            if (state.equipment.some(function (name) { return name.toLowerCase() === equipment.toLowerCase(); })) {
                throw new Error(equipment + " is already recorded as borrowed by this student.");
            }
            state.equipment.push(equipment);
            await saveAffairs(number, state);
            lendForm.reset();
            showMessage(equipment + " recorded as borrowed by " + number + ".", false);
        } catch (error) {
            handleError(error);
        } finally {
            button.disabled = false;
        }
    });
}

const orgForm = document.getElementById("org-form");
if (orgForm) {
    orgForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        const number = document.getElementById("org-student").value.trim();
        const name = document.getElementById("org-name").value;
        const paid = document.getElementById("org-paid").checked;
        if (!number) {
            showMessage("Enter the student ID.", true);
            return;
        }
        const button = document.getElementById("org-btn");
        button.disabled = true;
        showMessage("", false);
        try {
            const state = stateFor(number);
            if (state.orgs.some(function (org) { return org.name === name; })) {
                throw new Error("This student is already registered in " + name + ".");
            }
            state.orgs.push({ name: name, paid: paid });
            await saveAffairs(number, state);
            orgForm.reset();
            showMessage(number + " added to " + name + (paid ? " (fee paid)." : " (fee unpaid)."), false);
        } catch (error) {
            handleError(error);
        } finally {
            button.disabled = false;
        }
    });
}

/* ---------- Library: student card, picker and lend form ---------- */
const libDialog = document.getElementById("lib-detail-dialog");
const lpickDialog = document.getElementById("lpick-dialog");
let libItem = null;
let lpicking = null;

function libStateFor(number) {
    const found = students.filter(function (item) { return item.student_number === number; })[0];
    return found ? libraryOf(found) : { books: [], fines: [], other: [] };
}

async function saveLibrary(number, state) {
    const reason = encodeLibrary(state);
    if (reason.length > 255) throw new Error("Too many items for one student record. Mark a book returned or a fine paid first.");
    if (state.books.length || state.fines.length || state.other.length) await HubApi.placeHold(number, office.code, reason);
    else await HubApi.signOff(number, office.code, "No unreturned books or fines.");
    await loadQueue();
}

function openLibrary(item) {
    libItem = item;
    const state = libraryOf(item);
    document.getElementById("lib-name").textContent = item.full_name;
    document.getElementById("lib-meta").textContent = item.student_number + (item.program ? " · " + item.program : "");
    document.getElementById("lib-status").replaceChildren(badge(item.status));
    fillList(document.getElementById("lib-books"), state.books.map(function (book) {
        const late = daysOverdue(book.due);
        return { text: bookText(book) + (late ? " · fine so far " + money(accrued(book)) : ""), badge: late ? "OVERDUE" : "ON LOAN" };
    }), "No unreturned books.");
    fillList(document.getElementById("lib-fines"), state.fines.map(function (fine) {
        return { text: fine.title + " · " + money(fine.amount), badge: "UNPAID" };
    }), "No fines.");
    const due = finesDue(state);
    document.getElementById("lib-total").textContent = due ? "Total fines: " + money(due) + " (" + money(FINE_PER_DAY) + " per day per overdue book)." : "No fines owed.";
    document.getElementById("lib-return").disabled = !state.books.length;
    document.getElementById("lib-paid").disabled = !state.fines.length;
    libDialog.showModal();
    document.getElementById("lib-close").focus();
}

function openLibPicker(kind, item) {
    const state = libraryOf(item);
    const entries = kind === "book"
        ? state.books.map(function (b, index) { const f = accrued(b); return { index: index, text: bookText(b) + (f ? " · fine on return " + money(f) : "") }; })
        : state.fines.map(function (f, index) { return { index: index, text: f.title + " · " + money(f.amount) }; });
    if (!entries.length) return;
    lpicking = { kind: kind, item: item, entries: entries };
    document.getElementById("lpick-title").textContent = kind === "book" ? "Confirm book returned" : "Confirm fee paid";
    document.getElementById("lpick-student").textContent = item.full_name + " (" + item.student_number + ")";
    const list = document.getElementById("lpick-list");
    list.replaceChildren();
    entries.forEach(function (entry, position) {
        const li = document.createElement("li");
        const label = document.createElement("label");
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = true;
        box.dataset.position = String(position);
        box.addEventListener("change", function () {
            document.getElementById("lpick-save").disabled = !document.querySelectorAll("#lpick-list input:checked").length;
        });
        label.append(box, document.createTextNode(" " + entry.text));
        li.appendChild(label);
        list.appendChild(li);
    });
    document.getElementById("lpick-save").disabled = false;
    lpickDialog.showModal();
    document.getElementById("lpick-save").focus();
}

if (libDialog) {
    document.getElementById("fine-rule").textContent = "Fine: " + money(FINE_PER_DAY) + " for each day a book is overdue, counted from the day after the due date until it is returned.";
    document.getElementById("book-due").min = todayKey();
    document.getElementById("lib-close").addEventListener("click", function () { libDialog.close(); });
    libDialog.addEventListener("click", function (event) { if (event.target === libDialog) libDialog.close(); });
    document.getElementById("lib-return").addEventListener("click", function () { const i = libItem; libDialog.close(); if (i) openLibPicker("book", i); });
    document.getElementById("lib-paid").addEventListener("click", function () { const i = libItem; libDialog.close(); if (i) openLibPicker("fine", i); });
    document.getElementById("lpick-cancel").addEventListener("click", function () { lpickDialog.close(); });
    document.getElementById("lpick-form").addEventListener("submit", async function (event) {
        event.preventDefault();
        if (!lpicking) return;
        const chosen = Array.prototype.map.call(document.querySelectorAll("#lpick-list input:checked"), function (box) {
            return lpicking.entries[Number(box.dataset.position)].index;
        });
        const done = lpicking;
        const state = libraryOf(done.item);
        if (done.kind === "book") {
            // an overdue book turns its accrued fine into a fixed, unpaid fine when it comes back
            state.books.forEach(function (book, index) {
                if (chosen.indexOf(index) !== -1 && accrued(book)) state.fines.push({ title: book.title, amount: accrued(book) });
            });
            state.books = state.books.filter(function (book, index) { return chosen.indexOf(index) === -1; });
        } else {
            state.fines = state.fines.filter(function (fine, index) { return chosen.indexOf(index) === -1; });
        }
        const save = document.getElementById("lpick-save");
        save.disabled = true;
        try {
            await saveLibrary(done.item.student_number, state);
            lpickDialog.close();
            showMessage(done.kind === "book" ? "Book marked as returned." : "Fee marked as paid.", false);
        } catch (error) {
            lpickDialog.close();
            handleError(error);
        } finally {
            lpicking = null;
        }
    });
}

const bookForm = document.getElementById("book-form");
if (bookForm) {
    bookForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        const number = document.getElementById("book-student").value.trim();
        const title = cleanName(document.getElementById("book-title").value);
        const due = document.getElementById("book-due").value;
        if (!number || !title || !due) {
            showMessage("Enter the student ID, the book title and the due date.", true);
            return;
        }
        if (due < todayKey()) {
            showMessage("The due date cannot be in the past.", true);
            return;
        }
        const button = document.getElementById("book-btn");
        button.disabled = true;
        showMessage("", false);
        try {
            const state = libStateFor(number);
            if (state.books.some(function (b) { return b.title.toLowerCase() === title.toLowerCase(); })) {
                throw new Error(title + " is already recorded as borrowed by this student.");
            }
            state.books.push({ title: title, due: due });
            await saveLibrary(number, state);
            bookForm.reset();
            showMessage(title + " recorded as borrowed by " + number + ", due " + due + ".", false);
        } catch (error) {
            handleError(error);
        } finally {
            button.disabled = false;
        }
    });
}

/* ---------- Accounting: assign fees ---------- */
const feeForm = document.getElementById("fee-form");
if (feeForm) {
    const FEE_LABEL = { tuition: "tuition", fees: "fee", fines: "other fine" };
    feeForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        const number = document.getElementById("fee-student").value.trim();
        const key = document.getElementById("fee-category").value;
        const amount = Math.round(parseFloat(document.getElementById("fee-amount").value) * 100) / 100;
        if (!number || !FEE_LABEL[key] || !(amount > 0)) {
            showMessage("Enter the student ID, the type of charge and an amount greater than zero.", true);
            return;
        }
        const button = document.getElementById("fee-btn");
        button.disabled = true;
        showMessage("", false);
        try {
            const found = students.filter(function (item) { return item.student_number === number; })[0];
            const info = found ? breakdownOf(found) : { total: 0, tuition: null, fees: null, fines: null, itemized: false };
            const parts = { tuition: info.tuition || 0, fees: info.fees || 0, fines: info.fines || 0 };
            /* An export that only gave a total keeps that amount, filed under fees. */
            const itemSum = parts.tuition + parts.fees + parts.fines;
            if (info.total > itemSum + 0.005) parts.fees += info.total - itemSum;
            parts[key] += amount;
            const total = parts.tuition + parts.fees + parts.fines;
            const fmt = function (v) { return money(v); };
            const reason = "Outstanding balance of " + fmt(total) + " (tuition " + fmt(parts.tuition) + "; fees " + fmt(parts.fees) + "; fines " + fmt(parts.fines) + ")";
            if (reason.length > 255) throw new Error("The amounts are too large to record.");
            await HubApi.placeHold(number, office.code, reason);
            await loadQueue();
            feeForm.reset();
            showMessage(money(amount) + " " + FEE_LABEL[key] + " assigned to " + number + ". New balance: " + money(total) + ".", false);
        } catch (error) {
            handleError(error);
        } finally {
            button.disabled = false;
        }
    });
}

/* ---------- Registrar: which offices have signed ---------- */
const regDialog = document.getElementById("reg-detail-dialog");
let regItem = null;

async function openRegistrar(item) {
    regItem = item;
    await loadOthers();
    document.getElementById("reg-name").textContent = item.full_name;
    document.getElementById("reg-meta").textContent = item.student_number + (item.program ? " · " + item.program : "");
    document.getElementById("reg-status").replaceChildren(badge(item.status));
    const list = document.getElementById("reg-checks");
    list.replaceChildren();
    PROFILE.analyse(item).forEach(function (check) { list.appendChild(checkItem(check)); });
    const missing = othersOk ? missingOffices(item) : [];
    document.getElementById("reg-summary").textContent = !othersOk ? "The other offices' sign-offs could not be read."
        : missing.length ? "Missing sign-off from: " + missing.join(", ") + "."
        : item.status === "CLEARED" ? "Every office has signed and the student is enrolled."
        : "Every office has signed, but the student is not in good standing at the Registrar.";
    document.getElementById("reg-signoff").disabled = item.status === "CLEARED" && !missing.length && false;
    regDialog.showModal();
    document.getElementById("reg-close").focus();
}

if (regDialog) {
    document.getElementById("reg-close").addEventListener("click", function () { regDialog.close(); });
    regDialog.addEventListener("click", function (event) { if (event.target === regDialog) regDialog.close(); });
    document.getElementById("reg-signoff").addEventListener("click", function () {
        const item = regItem;
        regDialog.close();
        if (item) askReason("signoff", item);
    });
}

/* ---------- Clearance Signing: check obligations, then sign off ---------- */
const signForm = document.getElementById("sign-form");

function findStudent(query) {
    const q = query.trim().toLowerCase();
    const exact = students.filter(function (item) { return item.student_number.toLowerCase() === q || item.full_name.toLowerCase() === q; });
    const found = exact.length ? exact : students.filter(function (item) { return item.full_name.toLowerCase().indexOf(q) !== -1; });
    if (!found.length) throw new Error("No student matches “" + query.trim() + "”.");
    if (found.length > 1) throw new Error("Several students match. Enter the full name or the student ID.");
    return found[0];
}

function signReason(item) {
    return PROFILE.affairs ? (encodeAffairs(affairsOf(item)) || PROFILE.clearReason) : PROFILE.clearReason;
}

function fillSignNames() {
    const list = document.getElementById("sign-names");
    if (!list) return;
    list.replaceChildren();
    students.forEach(function (item) {
        const option = document.createElement("option");
        option.value = item.full_name;
        option.label = item.student_number;
        list.appendChild(option);
    });
}

async function renderSign(item, codeText) {
    const box = document.getElementById("sign-result");
    const checks = PROFILE.analyse(item);
    let note = "No slip code entered. Checked against the office records only.";
    if (codeText) {
        if (!/^ECH-[A-Z0-9]{6,12}$/i.test(codeText)) {
            checks.push({ label: "Slip code", ok: false, detail: "The code format is not valid (expected ECH- followed by letters and numbers)." });
            note = "";
        } else {
            try {
                const slip = await HubApi.verifySlip({ code: codeText.toUpperCase() });
                if (!slip.verified) checks.push({ label: "Slip code", ok: false, detail: slip.reason || "The slip could not be verified." });
                else if (slip.student.full_name.trim().toLowerCase() !== item.full_name.trim().toLowerCase()) checks.push({ label: "Slip code", ok: false, detail: "This slip belongs to " + slip.student.full_name + ", not " + item.full_name + "." });
                else checks.push({ label: "Slip code", ok: true, detail: "Valid slip for " + slip.student.full_name + "." });
                note = "";
            } catch (error) {
                if (error.status === 401) throw error;
                checks.push({ label: "Slip code", ok: false, detail: error.message || "The slip could not be checked." });
                note = "";
            }
        }
    }
    const ready = checks.every(function (check) { return check.ok; });
    box.replaceChildren();
    const title = document.createElement("h3");
    title.textContent = item.full_name;
    const meta = document.createElement("p");
    meta.className = "muted";
    meta.textContent = item.student_number + (item.program ? " · " + item.program : "") + " · " + office.name;
    const verdict = document.createElement("div");
    verdict.className = "verdict " + (ready ? "ready" : "blocked");
    verdict.id = "sign-verdict";
    const alreadySigned = ready && item.status === "CLEARED";
    verdict.textContent = alreadySigned ? "Already signed off. Nothing to settle."
        : ready ? (PROFILE.others ? "Ready for final sign-off" : "Ready to be signed off")
        : (PROFILE.others ? "Not ready: sign-offs or standing still missing" : "Has obligations to settle");
    const list = document.createElement("ul");
    list.className = "check-list";
    checks.forEach(function (check) { list.appendChild(checkItem(check)); });
    box.append(title, meta, verdict, list);
    if (note) {
        const p = document.createElement("p");
        p.className = "muted";
        p.textContent = note;
        box.appendChild(p);
    }
    if (ready && !alreadySigned) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "btn";
        button.id = "sign-now";
        button.textContent = "Sign off now";
        button.addEventListener("click", async function () {
            button.disabled = true;
            try {
                await HubApi.signOff(item.student_number, office.code, signReason(item));
                await loadQueue();
                fillSignNames();
                showMessage(item.full_name + " signed off by " + office.name + ".", false);
                await renderSign(students.filter(function (s) { return s.student_number === item.student_number; })[0] || item, codeText);
            } catch (error) {
                button.disabled = false;
                handleError(error);
            }
        });
        box.appendChild(button);
    }
}

if (signForm) {
    signForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        const button = document.getElementById("sign-check");
        button.disabled = true;
        showMessage("", false);
        try {
            const item = findStudent(document.getElementById("sign-name").value);
            if (PROFILE.others) await loadOthers();
            await renderSign(item, document.getElementById("sign-code").value.trim());
        } catch (error) {
            document.getElementById("sign-result").replaceChildren();
            handleError(error);
        } finally {
            button.disabled = false;
        }
    });
}

/* ---------- Tabs ---------- */
const TABS = Array.prototype.map.call(document.querySelectorAll(".nav-link"), function (link) { return link.dataset.tab; });
const opened = {};

function showTab(name) {
    if (TABS.indexOf(name) === -1) name = "queue";
    TABS.forEach(function (tab) { document.getElementById("tab-" + tab).hidden = tab !== name; });
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
    if (name === "reports" && !opened.reports) {
        opened.reports = true;
        loadReport();
    }
}

window.addEventListener("hashchange", function () { showTab(location.hash.replace("#", "")); });

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

/* ---------- Start: only signed-in office staff may stay ---------- */
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
        if (user.role !== "staff" || user.office_code !== OFFICE) {
            location.href = homeFor(user, "../../");
            return;
        }
        document.getElementById("role-label").textContent = "Signed in as: " + user.username;
        showTab(location.hash.replace("#", ""));
        office = { code: user.office_code, name: user.office_code };
        const queue = await HubApi.officeQueue(office.code, "");
        office = queue.office;
        students = queue.students;
        document.getElementById("office-title").textContent = office.name;
        document.getElementById("office-sub").textContent = document.body.dataset.source || "";
        setupHead();
        await loadQueue(); // also signs off students with no obligations and reads the other offices (Registrar)
    } catch (error) {
        handleError(error);
    }
})();
