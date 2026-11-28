/* Admin portal: all four offices in one table, imports, accounts, reports, audit log, slip check and API reference.
   Talks to the Hub API only (R8). */
"use strict";

const LOGIN_URL = "../../index.html#login";
const OFFICES = [["library", "Library"], ["student-affairs", "Student Affairs"], ["accounting", "Accounting"], ["registrar", "Registrar"]];
const TABS = ["queue", "imports", "users", "reports", "holds", "audit", "verify", "api"];
const messageBox = document.getElementById("api-message");
const navigation = document.getElementById("main-navigation");
const menuToggle = document.getElementById("menu-toggle");
const loaded = {};
let currentUser = null;

/* ---------- Helpers ---------- */
function showMessage(text, isError) {
    messageBox.textContent = text;
    messageBox.className = isError ? "msg error" : "msg";
    messageBox.hidden = !text;
}

function goToLogin() {
    sessionStorage.clear();
    location.href = LOGIN_URL;
}

function handleError(error) {
    if (error.status === 401) {
        goToLogin();
        return;
    }
    showMessage(error.message || "Unable to load Hub data.", true);
}

function addCell(row, value) {
    const td = row.insertCell();
    td.textContent = value === null || value === undefined ? "" : String(value);
    return td;
}

function badge(value) {
    const span = document.createElement("span");
    span.className = "badge " + String(value).toLowerCase().replace(/\s+/g, "-");
    span.textContent = value;
    return span;
}

function badgeCell(row, value) {
    row.insertCell().appendChild(badge(value));
}

function emptyRow(body, columns, text) {
    const td = body.insertRow().insertCell();
    td.colSpan = columns;
    td.textContent = text;
}

function actionButton(label, callback) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-sm";
    button.textContent = label;
    button.addEventListener("click", callback);
    return button;
}

function formatDate(value) {
    if (!value) return "";
    const date = new Date(String(value).replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(value)) ? "" : "Z"));
    return isNaN(date) ? String(value) : date.toLocaleString();
}

/* Office reasons are stored as text; make the structured ones readable. */
function reasonLines(reason) {
    return String(reason || "").split(/;\s*(?![^()]*\))/).map(function (part) {
        let m;
        if ((m = /^Book:\s*(.*?)\s*\((?:due (\d{4}-\d{2}-\d{2})|no due date)\)$/i.exec(part))) return "Unreturned book: " + m[1] + (m[2] ? " (due " + m[2] + ")" : "");
        if ((m = /^Fine:\s*(.*?)\s*\((PHP [\d.,]+)\)$/i.exec(part))) return "Unpaid fine: " + m[1] + ", " + m[2];
        return part.trim();
    }).filter(Boolean);
}

/* ---------- Office queue: one row per student, one column per office ---------- */
let people = [];
const studentDialog = document.getElementById("student-dialog");

async function loadQueue() {
    const results = await Promise.all(OFFICES.map(function (entry) { return HubApi.officeQueue(entry[0], ""); }));
    const byNumber = new Map();
    results.forEach(function (result, index) {
        result.students.forEach(function (row) {
            if (!byNumber.has(row.student_number)) {
                byNumber.set(row.student_number, { number: row.student_number, name: row.full_name, program: row.program, offices: {} });
            }
            byNumber.get(row.student_number).offices[OFFICES[index][0]] = row;
        });
    });
    people = Array.from(byNumber.values()).sort(function (a, b) { return a.number < b.number ? -1 : 1; });
    people.forEach(function (person) {
        person.cleared = OFFICES.every(function (entry) { return person.offices[entry[0]] && person.offices[entry[0]].status === "CLEARED"; });
    });
    renderQueue();
}

function renderQueue() {
    const search = document.getElementById("queue-search").value.trim().toLowerCase();
    const filter = document.getElementById("queue-filter").value;
    const body = document.getElementById("queue-body");
    body.replaceChildren();
    document.getElementById("count-all").textContent = people.length;
    document.getElementById("count-clear").textContent = people.filter(function (p) { return p.cleared; }).length;
    document.getElementById("count-hold").textContent = people.filter(function (p) { return !p.cleared; }).length;
    const rows = people.filter(function (person) {
        const text = (person.number + " " + person.name + " " + (person.program || "")).toLowerCase();
        return (!search || text.indexOf(search) !== -1)
            && (!filter || (filter === "CLEARED") === person.cleared);
    });
    rows.forEach(function (person) {
        const row = body.insertRow();
        row.className = "clickable";
        row.tabIndex = 0;
        row.title = "Show the reason from each office";
        row.addEventListener("click", function () { openStudent(person); });
        row.addEventListener("keydown", function (event) {
            if (event.key === "Enter" && event.target === row) {
                event.preventDefault();
                openStudent(person);
            }
        });
        addCell(row, person.number);
        addCell(row, person.name);
        OFFICES.forEach(function (entry) {
            const record = person.offices[entry[0]];
            badgeCell(row, record ? record.status : "HOLD");
        });
        badgeCell(row, person.cleared ? "CLEARED" : "HOLD");
    });
    if (!rows.length) emptyRow(body, 7, people.length ? "No matching students." : "No students are on the Hub yet.");
}

function openStudent(person) {
    document.getElementById("sd-name").textContent = person.name;
    document.getElementById("sd-meta").textContent = person.number + (person.program ? " · " + person.program : "");
    document.getElementById("sd-overall").replaceChildren(badge(person.cleared ? "CLEARED" : "HOLD"));
    const list = document.getElementById("sd-offices");
    list.replaceChildren();
    OFFICES.forEach(function (entry) {
        const record = person.offices[entry[0]] || { status: "HOLD", reason: "Awaiting office review." };
        const li = document.createElement("li");
        const head = document.createElement("div");
        head.className = "office-head";
        const name = document.createElement("strong");
        name.textContent = entry[1];
        head.append(name, badge(record.status));
        li.appendChild(head);
        reasonLines(record.reason).forEach(function (line) {
            const p = document.createElement("p");
            p.textContent = line;
            li.appendChild(p);
        });
        if (record.updated_at) {
            const when = document.createElement("p");
            when.className = "muted";
            when.textContent = "Updated " + formatDate(record.updated_at);
            li.appendChild(when);
        }
        list.appendChild(li);
    });
    studentDialog.showModal();
    document.getElementById("sd-close").focus();
}

document.getElementById("sd-close").addEventListener("click", function () { studentDialog.close(); });
studentDialog.addEventListener("click", function (event) { if (event.target === studentDialog) studentDialog.close(); });
document.getElementById("queue-search").addEventListener("input", renderQueue);
document.getElementById("queue-filter").addEventListener("change", renderQueue);
document.getElementById("queue-refresh").addEventListener("click", async function () {
    try {
        await loadQueue();
        showMessage("Office queue refreshed.", false);
    } catch (error) { handleError(error); }
});

/* ---------- Imports ---------- */
async function loadImports() {
    const result = await HubApi.imports();
    const batches = document.getElementById("batch-body");
    batches.replaceChildren();
    result.batches.forEach(function (batch) {
        const row = batches.insertRow();
        addCell(row, batch.file_name);
        addCell(row, batch.source);
        badgeCell(row, batch.manifest_verified ? "VERIFIED" : "REJECTED");
        addCell(row, batch.imported_count);
        addCell(row, batch.rejected_count);
    });
    if (!result.batches.length) emptyRow(batches, 5, "No imports have been processed.");
    const rejects = document.getElementById("reject-body");
    rejects.replaceChildren();
    result.rejections.forEach(function (item) {
        const row = rejects.insertRow();
        addCell(row, item.batch_id);
        addCell(row, item.row_reference);
        addCell(row, item.reason);
    });
    if (!result.rejections.length) emptyRow(rejects, 3, "No rejected records.");
}

document.getElementById("import-form").addEventListener("submit", async function (event) {
    event.preventDefault();
    const file = document.getElementById("import-file").files[0];
    const manifest = document.getElementById("import-manifest").files[0];
    if (!file || !manifest) {
        showMessage("Select both the data file and its signed manifest.", true);
        return;
    }
    const button = document.getElementById("import-btn");
    button.disabled = true;
    try {
        const result = await HubApi.uploadImport(file, manifest);
        showMessage("Import " + result.status.toLowerCase() + ": " + result.imported + " imported, " + result.rejected + " rejected.", false);
        event.target.reset();
        loaded.queue = false;
    } catch (error) {
        showMessage(error.message, true);
    } finally {
        button.disabled = false;
    }
    try { await loadImports(); } catch (error) { handleError(error); }
});

document.getElementById("sync-registrar").addEventListener("click", async function () {
    const button = document.getElementById("sync-registrar");
    button.disabled = true;
    try {
        const result = await HubApi.syncRegistrar();
        showMessage("Synchronized " + result.synchronized + " Registrar records.", false);
        loaded.queue = false;
    } catch (error) {
        handleError(error);
    } finally {
        button.disabled = false;
    }
});

/* ---------- Users ---------- */
const ROLES = ["student", "staff", "admin"];
let accounts = { users: [], offices: [], students: [] };
const accountDialog = document.getElementById("account-dialog");
const passwordDialog = document.getElementById("password-dialog");
let editing = null; // null while creating

function roleLabel(role) {
    return ROLES.indexOf(role) !== -1 ? { student: "Student", staff: "Office staff", admin: "Admin" }[role] : "Needs role";
}

async function loadUsers() {
    const result = await HubApi.adminUsers();
    accounts = { users: result.users || [], offices: result.offices || [], students: result.students || [] };
    renderUsers();
}

function renderUsers() {
    const query = document.getElementById("user-search").value.trim().toLowerCase();
    const roleFilter = document.getElementById("user-role-filter").value;
    const statusFilter = document.getElementById("user-status-filter").value;
    const body = document.getElementById("users-body");
    body.replaceChildren();
    const rows = accounts.users.filter(function (item) {
        const role = ROLES.indexOf(item.role) !== -1 ? item.role : "unassigned";
        const text = [item.username, item.role, item.full_name, item.student_number, item.office_name].filter(Boolean).join(" ").toLowerCase();
        return (!query || text.indexOf(query) !== -1) && (!roleFilter || role === roleFilter)
            && (!statusFilter || (item.active ? "active" : "inactive") === statusFilter);
    });
    rows.forEach(function (item) {
        const row = body.insertRow();
        addCell(row, item.username);
        addCell(row, roleLabel(item.role));
        addCell(row, item.full_name || item.office_name || "");
        addCell(row, item.student_number || "");
        badgeCell(row, item.active ? "ACTIVE" : "INACTIVE");
        const actions = row.insertCell();
        actions.className = "actions-cell";
        actions.append(
            actionButton("Edit", function () { openAccount(item); }),
            actionButton("Set password", function () { openPassword(item); })
        );
    });
    if (!rows.length) emptyRow(body, 6, accounts.users.length ? "No accounts match these filters." : "No user accounts have been created.");
}

function fillSelect(select, placeholder, entries) {
    select.replaceChildren();
    const first = document.createElement("option");
    first.value = "";
    first.textContent = placeholder;
    select.appendChild(first);
    entries.forEach(function (entry) {
        const option = document.createElement("option");
        option.value = entry[0];
        option.textContent = entry[1];
        select.appendChild(option);
    });
}

function accountError(text) {
    const box = document.getElementById("acc-error");
    box.textContent = text;
    box.hidden = !text;
}

function syncAccountFields() {
    const role = document.getElementById("acc-role").value;
    document.getElementById("acc-student").hidden = role !== "student";
    document.getElementById("acc-staff").hidden = role !== "staff";
    document.getElementById("acc-profile").hidden = !(role === "student" && editing);
}

function openAccount(item) {
    editing = item || null;
    accountError("");
    document.getElementById("account-form").reset();
    document.getElementById("acc-title").textContent = item ? "Edit account" : "New account";
    document.getElementById("acc-sub").textContent = item
        ? "Update the login, role, assignment or status. Passwords are changed with Set password."
        : "Passwords are stored as salted hashes. Share the initial password through a private channel.";
    const options = accounts.students.map(function (s) { return [s.student_number, s.full_name + " (" + s.student_number + ")"]; });
    if (item && item.student_number && !options.some(function (o) { return o[0] === item.student_number; })) {
        options.unshift([item.student_number, (item.full_name || "Student") + " (" + item.student_number + ")"]);
    }
    fillSelect(document.getElementById("acc-student-number"), "Select an active Registrar record", options);
    fillSelect(document.getElementById("acc-office"), "Select an office", accounts.offices.map(function (o) { return [o.code, o.name]; }));
    document.getElementById("acc-student-help").hidden = options.length > 0;
    document.getElementById("acc-passwords").hidden = Boolean(item);
    document.getElementById("acc-active-row").hidden = !item;
    const self = item && item.id === currentUser.id;
    if (item) {
        document.getElementById("acc-username").value = item.username;
        document.getElementById("acc-role").value = ROLES.indexOf(item.role) !== -1 ? item.role : "";
        document.getElementById("acc-student-number").value = item.student_number || "";
        document.getElementById("acc-full-name").value = item.full_name || "";
        document.getElementById("acc-email").value = item.email || "";
        document.getElementById("acc-office").value = item.office_code || "";
        document.getElementById("acc-active").checked = Boolean(item.active);
    }
    document.getElementById("acc-role").disabled = Boolean(self);
    document.getElementById("acc-active").disabled = Boolean(self);
    syncAccountFields();
    accountDialog.showModal();
    document.getElementById("acc-username").focus();
}

document.getElementById("acc-role").addEventListener("change", syncAccountFields);
document.getElementById("new-user").addEventListener("click", function () { openAccount(null); });
document.getElementById("acc-cancel").addEventListener("click", function () { accountDialog.close(); });
["user-search", "user-role-filter", "user-status-filter"].forEach(function (id) {
    document.getElementById(id).addEventListener(id === "user-search" ? "input" : "change", renderUsers);
});

document.getElementById("account-form").addEventListener("submit", async function (event) {
    event.preventDefault();
    const username = document.getElementById("acc-username").value.trim();
    const role = document.getElementById("acc-role").value;
    const details = { username: username, role: role };
    if (username.length < 3) return accountError("Enter a login of at least 3 characters.");
    if (!role) return accountError("Select a role.");
    if (role === "student") {
        details.student_number = document.getElementById("acc-student-number").value.trim();
        if (!details.student_number) return accountError("Select the student's Registrar record.");
        if (editing) {
            details.full_name = document.getElementById("acc-full-name").value.trim();
            details.email = document.getElementById("acc-email").value.trim();
        }
    } else if (role === "staff") {
        details.office_code = document.getElementById("acc-office").value;
        if (!details.office_code) return accountError("Select the office this staff member works in.");
    }
    if (editing) {
        details.active = document.getElementById("acc-active").checked;
    } else {
        const password = document.getElementById("acc-password").value;
        if (password.length < 12) return accountError("The password must be at least 12 characters.");
        if (password !== document.getElementById("acc-password2").value) return accountError("The passwords do not match.");
        details.password = password;
    }
    const save = document.getElementById("acc-save");
    save.disabled = true;
    try {
        const result = editing ? await HubApi.updateAdminUser(editing.id, details) : await HubApi.createAdminUser(details);
        accountDialog.close();
        await loadUsers();
        showMessage(editing ? (result.message || "User account updated.") : "Account created. Share the initial password through an approved private channel.", false);
    } catch (error) {
        if (error.status === 401) goToLogin();
        else accountError(error.message);
    } finally {
        save.disabled = false;
    }
});

let passwordTarget = null;
function openPassword(item) {
    passwordTarget = item;
    document.getElementById("password-form").reset();
    document.getElementById("pw-error").hidden = true;
    document.getElementById("pw-sub").textContent = "New password for " + item.username + ". This signs the account out of existing sessions.";
    passwordDialog.showModal();
    document.getElementById("pw-new").focus();
}

document.getElementById("pw-cancel").addEventListener("click", function () { passwordDialog.close(); });
document.getElementById("password-form").addEventListener("submit", async function (event) {
    event.preventDefault();
    const box = document.getElementById("pw-error");
    const password = document.getElementById("pw-new").value;
    const fail = function (text) { box.textContent = text; box.hidden = false; };
    if (password.length < 12) return fail("The password must be at least 12 characters.");
    if (password !== document.getElementById("pw-new2").value) return fail("The passwords do not match.");
    const save = document.getElementById("pw-save");
    save.disabled = true;
    try {
        const response = await HubApi.resetAdminUserPassword(passwordTarget.id, password);
        passwordDialog.close();
        if (Number(passwordTarget.id) === Number(currentUser.id)) {
            sessionStorage.clear();
            sessionStorage.setItem("loginNotice", response.message);
            location.href = LOGIN_URL;
            return;
        }
        showMessage(response.message + " Share the new password through an approved private channel.", false);
    } catch (error) {
        if (error.status === 401) goToLogin();
        else fail(error.message);
    } finally {
        save.disabled = false;
    }
});

/* ---------- Reports ---------- */
async function loadReport() {
    const result = await HubApi.report("json");
    const body = document.getElementById("report-body");
    body.replaceChildren();
    result.students.forEach(function (student) {
        const row = body.insertRow();
        addCell(row, student.student_id);
        addCell(row, student.program);
        badgeCell(row, student.overall);
    });
    if (!result.students.length) emptyRow(body, 3, "No students are available for the report.");
}

document.querySelectorAll("[data-export]").forEach(function (button) {
    button.addEventListener("click", async function () {
        button.disabled = true;
        try {
            await HubApi.downloadReport(button.dataset.export);
        } catch (error) {
            showMessage(error.message, true);
        } finally {
            button.disabled = false;
        }
    });
});

/* ---------- Audit log ---------- */
let auditRows = [];

function auditDetails(entry) {
    const details = entry.details || {};
    const parts = Object.entries(details)
        .filter(function (item) { return !/(password|hash|secret|token|code)/i.test(item[0]); })
        .map(function (item) {
            const value = item[1] !== null && typeof item[1] === "object" ? JSON.stringify(item[1]) : String(item[1]);
            return item[0].replace(/_/g, " ") + ": " + value;
        });
    if (entry.reason) parts.push("Reason: " + entry.reason);
    return parts.join("; ");
}

async function loadAudit() {
    const result = await HubApi.auditLog();
    auditRows = result.entries.map(function (entry) {
        const details = entry.details || {};
        return {
            when: formatDate(entry.created_at),
            actor: entry.username || "System",
            action: entry.action,
            target: entry.student_number || entry.office_name || details.username_after || details.username || details.username_before || "",
            details: auditDetails(entry)
        };
    });
    renderAudit();
}

function renderAudit() {
    const query = document.getElementById("audit-search").value.trim().toLowerCase();
    const body = document.getElementById("audit-body");
    body.replaceChildren();
    const rows = auditRows.filter(function (item) {
        return !query || (item.actor + " " + item.action + " " + item.target + " " + item.details).toLowerCase().indexOf(query) !== -1;
    });
    rows.forEach(function (item) {
        const row = body.insertRow();
        addCell(row, item.when);
        addCell(row, item.actor);
        addCell(row, item.action);
        addCell(row, item.target);
        addCell(row, item.details);
    });
    if (!rows.length) emptyRow(body, 5, auditRows.length ? "No events match this search." : "No audit events have been recorded.");
}

document.getElementById("audit-search").addEventListener("input", renderAudit);
document.getElementById("audit-refresh").addEventListener("click", async function () {
    try { await loadAudit(); } catch (error) { handleError(error); }
});

/* ---------- Hold summary ---------- */
let holdRows = [];

async function loadHolds() {
    const result = await HubApi.holdSummary();
    holdRows = result.holds || [];
    const select = document.getElementById("hold-office");
    const chosen = select.value;
    const offices = [];
    holdRows.forEach(function (row) { if (!offices.some(function (o) { return o.code === row.office_code; })) offices.push({ code: row.office_code, name: row.office }); });
    select.replaceChildren(new Option("All offices", ""));
    offices.forEach(function (o) { select.appendChild(new Option(o.name, o.code)); });
    select.value = offices.some(function (o) { return o.code === chosen; }) ? chosen : "";
    renderHolds();
}

function renderHolds() {
    const office = document.getElementById("hold-office").value;
    const query = document.getElementById("hold-search").value.trim().toLowerCase();
    const cards = document.getElementById("hold-cards");
    cards.replaceChildren();
    OFFICES.forEach(function (item) {
        const count = holdRows.filter(function (row) { return row.office_code === item[0]; }).length;
        const card = document.createElement("div");
        card.className = "card";
        const title = document.createElement("h3");
        title.textContent = item[1];
        const big = document.createElement("div");
        big.className = "big";
        big.textContent = count + (count === 1 ? " hold" : " holds");
        card.append(title, big);
        cards.appendChild(card);
    });
    const body = document.getElementById("hold-body");
    body.replaceChildren();
    const rows = holdRows.filter(function (row) {
        return (!office || row.office_code === office)
            && (!query || (row.student_number + " " + row.full_name + " " + row.reason).toLowerCase().indexOf(query) !== -1);
    });
    rows.forEach(function (row) {
        const tr = body.insertRow();
        addCell(tr, row.office);
        addCell(tr, row.student_number);
        addCell(tr, row.full_name);
        addCell(tr, row.reason);
    });
    if (!rows.length) emptyRow(body, 4, holdRows.length ? "No holds match this filter." : "No students are on hold.");
}

function csvCell(value) {
    let text = String(value == null ? "" : value);
    if (/^[=+\-@]/.test(text)) text = "'" + text; // stop spreadsheet formula injection
    return '"' + text.replace(/"/g, '""') + '"';
}

document.getElementById("hold-office").addEventListener("change", renderHolds);
document.getElementById("hold-search").addEventListener("input", renderHolds);
document.getElementById("hold-refresh").addEventListener("click", async function () {
    try { await loadHolds(); } catch (error) { handleError(error); }
});
document.getElementById("hold-download").addEventListener("click", function () {
    const office = document.getElementById("hold-office").value;
    const rows = holdRows.filter(function (row) { return !office || row.office_code === office; });
    const lines = [["office", "student_number", "full_name", "reason"].join(",")].concat(rows.map(function (row) {
        return [row.office, row.student_number, row.full_name, row.reason].map(csvCell).join(",");
    }));
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([lines.join("\r\n")], { type: "text/csv" }));
    link.download = "hold-summary-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 2000);
});

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
    const scanInput = document.getElementById("scan-input");
    const scanValue = scanInput.value.trim();
    let studentNumber = "";
    let code = "";
    let token = "";
    if (scanValue) {
        if (/^[A-Za-z0-9_-]+\.[a-fA-F0-9]{64}$/.test(scanValue)) token = scanValue;
        else if (/^ECH-[A-Z0-9]{6,12}$/i.test(scanValue)) code = scanValue;
        else studentNumber = scanValue;
    } else {
        studentNumber = document.getElementById("student-number-input").value.trim();
        code = document.getElementById("slip-code-input").value.trim();
        token = document.getElementById("slip-token-input").value.trim();
    }
    if ([studentNumber, code, token].filter(Boolean).length !== 1) {
        showMessage("Enter exactly one student ID, signed short code, or signed token.", true);
        return;
    }
    const button = document.getElementById("verify-btn");
    button.disabled = true;
    showMessage("", false);
    let completed = false;
    try {
        if (studentNumber) {
            const result = scanValue
                ? await HubApi.scanStudentOrCard(studentNumber)
                : await HubApi.studentClearance(studentNumber);
            const pairs = [
                ["Lookup", result.match_type === "registered_card"
                    ? "Registered card matched; this shows current status, not a signed QR slip."
                    : "Current clearance status only; this does not verify a signed slip."],
                ["Student", result.student.full_name + " (" + result.student.student_number + ")"],
                ["Overall", badge(result.overall)]
            ];
            result.offices.forEach(function (item) {
                pairs.push([item.office, badge(item.status)]);
                pairs.push([item.office + " reason", item.reason]);
            });
            showResult(pairs);
            completed = true;
        } else {
            const result = await HubApi.verifySlip(token ? { token: token } : { code: code });
            const pairs = [["Signature", badge(result.verified ? "VERIFIED" : "NOT VERIFIED")]];
            if (result.verified) {
                pairs.push(["Student", result.student.full_name + " (" + result.student.student_number + ")"]);
                pairs.push(["Overall", badge(result.overall)]);
                (result.offices || []).forEach(function (item) {
                    pairs.push([item.office, badge(item.status)]);
                });
                if (result.expires_at) pairs.push(["Expires", new Date(result.expires_at).toLocaleString()]);
                pairs.push(["Result", "Valid signed clearance slip."]);
            } else {
                pairs.push(["Result", result.reason || "Slip could not be verified."]);
            }
            showResult(pairs);
            completed = result.verified;
        }
    } catch (error) {
        handleError(error);
    } finally {
        button.disabled = false;
        if (completed && scanValue) {
            scanInput.value = "";
            scanInput.focus();
        }
    }
});

document.getElementById("card-register-form").addEventListener("submit", async function (event) {
    event.preventDefault();
    const cardInput = document.getElementById("card-id-input");
    const studentInput = document.getElementById("card-student-number-input");
    const button = document.getElementById("register-card-btn");
    const message = document.getElementById("card-registration-message");
    button.disabled = true;
    message.textContent = "";
    message.hidden = false;
    message.classList.remove("error");
    try {
        const result = await HubApi.registerStudentCard(
            cardInput.value.trim(),
            studentInput.value.trim()
        );
        message.textContent = result.message + (result.replaced_previous_card
            ? " The student's previous card is no longer active."
            : "");
        cardInput.value = "";
        studentInput.value = "";
        cardInput.focus();
    } catch (error) {
        message.textContent = error.message || "Unable to register this card.";
        message.classList.add("error");
    } finally {
        button.disabled = false;
    }
});

/* ---------- API reference ---------- */
const API_ROWS = [
    ["GET", "/health", "Check API and database availability", "Public", "200, 500"],
    ["POST", "/auth/register", "Create student account from active roster details", "Public; student only", "201, 400, 409"],
    ["POST", "/auth/login", "Authenticate and issue a token", "Public", "200, 400, 401, 403"],
    ["GET", "/auth/me", "Get current signed-in user", "Authenticated", "200, 401"],
    ["POST", "/auth/logout", "Invalidate current session", "Authenticated", "200, 401"],
    ["GET", "/students/me/clearance", "Own status per office and overall", "Student", "200, 401"],
    ["GET", "/offices/{office}/students?status=HOLD", "List students for an office", "Staff, Admin", "200, 401, 403"],
    ["POST", "/clearance/{student_number}/{office}/signoff", "Sign off a student", "Assigned staff", "200, 400, 403, 404"],
    ["POST", "/clearance/{student_number}/{office}/hold", "Put a student on hold with a reason", "Assigned staff", "200, 400, 403, 404"],
    ["GET", "/deadline", "Computed clearance deadline", "Authenticated", "200, 401"],
    ["GET", "/reports/clearance?format=csv|json|xml", "Export clearance data with masked IDs", "Admin, Registrar staff", "200, 400, 403"],
    ["GET", "/slips/me", "Get own signed slip QR and short code", "Student", "200, 401"],
    ["POST", "/slips/verify", "Verify a signed slip token or short code", "Staff, Admin", "200, 400, 401"],
    ["POST", "/cards/register", "Register or replace an Admin-managed student card", "Admin", "200, 201, 400, 403, 404, 409"],
    ["POST", "/cards/verify", "Match a registered card and return current clearance", "Staff, Admin", "200, 400, 401, 403, 404, 409"],
    ["GET", "/audit", "View sign-off and hold history", "Admin", "200, 403"],
    ["GET", "/imports", "View imports and reject log", "Admin", "200, 403"],
    ["POST", "/admin/import", "Upload source file and signed manifest", "Admin", "200, 400, 403"],
    ["POST", "/admin/sync-registrar", "Sync student masterlist", "Admin", "200, 403, 502, 503"],
    ["GET", "/admin/hold-summary", "View unresolved clearance holds (staff see their own office)", "Admin, Staff", "200, 403"],
    ["GET", "/admin/users", "List user accounts and offices for administration", "Admin", "200, 403"],
    ["POST", "/admin/users", "Create student, staff, or admin account", "Admin", "201, 400, 403, 409"],
    ["PUT", "/admin/users/{user_id}", "Update login ID, role, assignment, profile, or status", "Admin", "200, 400, 403, 404, 409"],
    ["POST", "/admin/users/{user_id}/password", "Set a new password and revoke sessions", "Admin", "200, 400, 403, 404"]
];

function renderApi() {
    const query = document.getElementById("api-search").value.trim().toLowerCase();
    const body = document.getElementById("api-body");
    body.replaceChildren();
    const rows = API_ROWS.filter(function (item) { return !query || item.join(" ").toLowerCase().indexOf(query) !== -1; });
    rows.forEach(function (item) {
        const row = body.insertRow();
        item.forEach(function (value, index) {
            const td = addCell(row, value);
            if (index === 1) td.className = "mono";
        });
    });
    if (!rows.length) emptyRow(body, 5, "No endpoints match.");
}

document.getElementById("api-search").addEventListener("input", renderApi);

/* ---------- Tabs ---------- */
const LOADERS = { queue: loadQueue, imports: loadImports, users: loadUsers, reports: loadReport, holds: loadHolds, audit: loadAudit, api: renderApi };

async function showTab(name) {
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
    if (name === "verify") document.getElementById("scan-input").focus();
    if (!LOADERS[name] || loaded[name]) return;
    loaded[name] = true;
    try {
        await LOADERS[name]();
    } catch (error) {
        loaded[name] = false;
        handleError(error);
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
    try { await HubApi.logout(); } catch (error) { /* the session may already be gone */ }
    goToLogin();
});

/* ---------- Start: only a signed-in admin may stay ---------- */
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
        currentUser = result.user;
        sessionStorage.setItem("role", currentUser.role);
        sessionStorage.setItem("user", JSON.stringify(currentUser));
        if (currentUser.role !== "admin") {
            location.href = homeFor(currentUser, "../../");
            return;
        }
        document.getElementById("role-label").textContent = "Signed in as: " + currentUser.username;
        await showTab(location.hash.replace("#", ""));
    } catch (error) {
        handleError(error);
    }
})();
