const NAV = {
    staff: [["Office queue", "office-queue"], ["Hold summary", "hold-summary"], ["Verify slip", "verify-slip"]],
    admin: [["Import monitor", "import-monitor"], ["Reports", "reports"], ["Users", "users"], ["Audit log", "audit-log"], ["API reference", "api-reference"],
            ["Office queue", "office-queue"], ["Hold summary", "hold-summary"], ["Verify slip", "verify-slip"]]
};
const ROLE_NAMES = { student: "Student", staff: "Office staff", admin: "Admin" };
const HUB_SCRIPT_URL = document.currentScript ? document.currentScript.src : location.href;

function setupPwa() {
    const manifest = document.createElement("link");
    manifest.rel = "manifest";
    manifest.href = new URL("../../manifest.webmanifest", HUB_SCRIPT_URL).href;
    document.head.appendChild(manifest);
    if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register(new URL("../../service-worker.js", HUB_SCRIPT_URL)).catch(function () {
            showMessage("Offline app-shell registration failed; online Hub use is still available.", true);
        });
    }
}

function showMessage(message, isError) {
    let target = document.getElementById("api-message");
    if (!target) {
        target = document.createElement("p");
        target.id = "api-message";
        target.setAttribute("role", "status");
        target.setAttribute("aria-live", "polite");
        document.querySelector(".content").prepend(target);
    }
    target.className = isError ? "form-message error" : "form-message";
    target.textContent = message;
}

function cell(row, value) {
    const item = document.createElement("td");
    item.textContent = value === null || value === undefined ? "" : String(value);
    row.appendChild(item);
    return item;
}

function statusCell(row, value) {
    const item = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = "badge " + String(value).toLowerCase();
    badge.textContent = value;
    item.appendChild(badge);
    row.appendChild(item);
}

function clearRows(tableBody) {
    if (tableBody) tableBody.replaceChildren();
    return tableBody;
}

function showEmpty(tableBody, columnCount, message) {
    const row = tableBody.insertRow();
    const item = row.insertCell();
    item.colSpan = columnCount;
    item.textContent = message;
}

function createActionButton(label, callback) {
    const button = document.createElement("button");
    button.className = "btn btn-outline table-action";
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", callback);
    return button;
}

async function loadOfficeQueue(user, page, status) {
    const office = user.role === "staff" ? user.office_code : "library";
    if (!office) throw new Error("This staff account is not assigned to an office.");
    const result = await HubApi.officeQueue(office, status);
    const officeLabel = document.querySelector(".content strong");
    if (officeLabel && officeLabel.parentElement) officeLabel.parentElement.textContent = "Office: " + result.office.name;
    const table = document.querySelector(".content table");
    const head = table.querySelector("thead tr");
    if (user.role === "staff" && head.lastElementChild.textContent !== "Actions") {
        const heading = document.createElement("th");
        heading.textContent = "Actions";
        head.appendChild(heading);
    }
    const body = clearRows(table.querySelector("tbody"));
    result.students.forEach(function (student) {
        const row = body.insertRow();
        cell(row, student.student_number);
        cell(row, student.full_name);
        statusCell(row, student.status);
        cell(row, student.reason);
        if (user.role === "staff") {
            const actions = document.createElement("td");
            actions.appendChild(createActionButton("Sign off", async function () {
                const reason = window.prompt("Enter the sign-off reason:");
                if (!reason || !reason.trim()) return;
                try {
                    await HubApi.signOff(student.student_number, office, reason.trim());
                    await loadOfficeQueue(user, page, status);
                    showMessage("Student signed off.", false);
                } catch (error) {
                    showMessage(error.message, true);
                }
            }));
            actions.appendChild(createActionButton("Place HOLD", async function () {
                const reason = window.prompt("Enter the hold reason:");
                if (!reason || !reason.trim()) return;
                try {
                    await HubApi.placeHold(student.student_number, office, reason.trim());
                    await loadOfficeQueue(user, page, status);
                    showMessage("HOLD saved.", false);
                } catch (error) {
                    showMessage(error.message, true);
                }
            }));
            row.appendChild(actions);
        }
    });
    if (!result.students.length) showEmpty(body, user.role === "staff" ? 5 : 4, "No matching students.");
}

async function loadHoldSummary(user) {
    let rows;
    if (user.role === "admin") {
        rows = (await HubApi.holdSummary()).holds;
    } else {
        const result = await HubApi.officeQueue(user.office_code, "HOLD");
        rows = result.students.map(function (item) {
            return { office: result.office.name, student_number: item.student_number, full_name: item.full_name, reason: item.reason };
        });
    }
    const table = document.querySelector(".content table");
    const head = table.querySelector("thead tr");
    if (user.role === "admin" && head.children.length === 3) {
        const officeHeading = document.createElement("th");
        officeHeading.textContent = "Office";
        head.insertBefore(officeHeading, head.firstChild);
    }
    const body = clearRows(table.querySelector("tbody"));
    rows.forEach(function (item) {
        const row = body.insertRow();
        if (user.role === "admin") cell(row, item.office);
        cell(row, item.student_number);
        cell(row, item.full_name);
        cell(row, item.reason);
    });
    if (!rows.length) showEmpty(body, user.role === "admin" ? 4 : 3, "No students are on HOLD.");
}

async function loadImports() {
    const result = await HubApi.imports();
    const tables = document.querySelectorAll(".content table");
    const batchesBody = clearRows(tables[0].querySelector("tbody"));
    result.batches.forEach(function (batch) {
        const row = batchesBody.insertRow();
        cell(row, batch.file_name);
        cell(row, batch.source);
        statusCell(row, batch.manifest_verified ? "VERIFIED" : "REJECTED");
        cell(row, batch.imported_count);
        cell(row, batch.rejected_count);
    });
    if (!result.batches.length) showEmpty(batchesBody, 5, "No imports have been processed.");
    const rejectBody = clearRows(tables[1].querySelector("tbody"));
    result.rejections.forEach(function (reject) {
        const row = rejectBody.insertRow();
        cell(row, reject.batch_id);
        cell(row, reject.row_reference);
        cell(row, reject.reason);
    });
    if (!result.rejections.length) showEmpty(rejectBody, 3, "No rejected records.");
}

async function loadReport() {
    const result = await HubApi.report("json");
    const body = clearRows(document.querySelector("table tbody"));
    result.students.forEach(function (student) {
        const row = body.insertRow();
        cell(row, student.student_id);
        cell(row, student.program);
        statusCell(row, student.overall);
    });
    if (!result.students.length) showEmpty(body, 3, "No students are available for the report.");
}

async function loadAudit() {
    const result = await HubApi.auditLog();
    const body = clearRows(document.querySelector("#audit-table tbody"));
    result.entries.forEach(function (entry) {
        const row = body.insertRow();
        cell(row, entry.created_at);
        cell(row, entry.username || "System");
        cell(row, entry.action);
        const details = entry.details || {};
        cell(row, entry.student_number || entry.office_name
            || details.username_after || details.username || details.username_before || "");
        const detailParts = Object.entries(details)
            .filter(function (item) {
                return !/(password|hash|secret|token|code)/i.test(item[0]);
            })
            .map(function (item) {
                const value = item[1] !== null && typeof item[1] === "object"
                    ? JSON.stringify(item[1])
                    : String(item[1]);
                return item[0].replace(/_/g, " ") + ": " + value;
            });
        if (entry.reason) detailParts.push("Reason: " + entry.reason);
        cell(row, detailParts.join("; "));
    });
    if (!result.entries.length) showEmpty(body, 5, "No audit events have been recorded.");
}

function setAccountRoleFields(role, studentFields, staffFields, studentNumber, officeCode) {
    const isStudent = role === "student";
    const isStaff = role === "staff";
    studentFields.hidden = !isStudent;
    staffFields.hidden = !isStaff;
    studentNumber.required = isStudent;
    officeCode.required = isStaff;
}

function populateOfficeOptions(select, offices) {
    select.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select an office";
    select.appendChild(placeholder);
    offices.forEach(function (office) {
        const option = document.createElement("option");
        option.value = office.code;
        option.textContent = office.name;
        select.appendChild(option);
    });
}

function populateStudentOptions(select, students) {
    select.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Select an active Registrar record";
    select.appendChild(placeholder);
    students.forEach(function (student) {
        const option = document.createElement("option");
        option.value = student.student_number;
        option.textContent = student.full_name + " (" + student.student_number + ")";
        select.appendChild(option);
    });
}

async function loadAdminUsers(currentUser) {
    const result = await HubApi.adminUsers();
    const students = result.students || [];
    const createForm = document.getElementById("create-user-form");
    const createRole = createForm.elements.role;
    const createStudentFields = document.getElementById("create-student-fields");
    const createStaffFields = document.getElementById("create-staff-fields");
    const createStudentNumber = createForm.elements.student_number;
    const createOfficeCode = createForm.elements.office_code;
    populateStudentOptions(createStudentNumber, students);
    populateOfficeOptions(createOfficeCode, result.offices);
    document.getElementById("create-student-help").hidden = students.length > 0;
    document.getElementById("edit-student-help").hidden = students.length > 0;
    createRole.onchange = function () {
        setAccountRoleFields(
            createRole.value,
            createStudentFields,
            createStaffFields,
            createStudentNumber,
            createOfficeCode
        );
    };
    createForm.onreset = function () {
        window.setTimeout(createRole.onchange, 0);
    };
    createForm.onsubmit = async function (event) {
        event.preventDefault();
        const password = createForm.elements.password.value;
        if (password !== createForm.elements.password_confirm.value) {
            showMessage("The new account passwords do not match.", true);
            return;
        }
        const details = {
            username: createForm.elements.username.value.trim(),
            password: password,
            role: createRole.value
        };
        if (createRole.value === "student") {
            if (!students.length) {
                showMessage(
                    "No active Registrar students are loaded. Configure the Registrar API and sync the official masterlist before creating student accounts.",
                    true
                );
                return;
            }
            details.student_number = createStudentNumber.value.trim();
        } else if (createRole.value === "staff") {
            details.office_code = createOfficeCode.value;
        }
        const submit = createForm.querySelector('[type="submit"]');
        submit.disabled = true;
        try {
            await HubApi.createAdminUser(details);
            createForm.reset();
            await loadAdminUsers(currentUser);
            showMessage("Account created. Share the initial password through an approved private channel.", false);
        } catch (error) {
            showMessage(error.message, true);
        } finally {
            submit.disabled = false;
        }
    };

    const search = document.getElementById("user-search");
    const roleFilter = document.getElementById("user-role-filter");
    const statusFilter = document.getElementById("user-status-filter");
    function renderUsers() {
        const body = clearRows(document.querySelector("#users-table tbody"));
        const query = search.value.trim().toLowerCase();
        const selectedRole = roleFilter.value;
        const selectedStatus = statusFilter.value;
        const filteredUsers = result.users.filter(function (item) {
            const role = ["student", "staff", "admin"].includes(item.role) ? item.role : "unassigned";
            const searchable = [
                item.username, item.role, item.full_name, item.student_number, item.office_name
            ].filter(Boolean).join(" ").toLowerCase();
            return (!query || searchable.includes(query))
                && (!selectedRole || role === selectedRole)
                && (!selectedStatus || (item.active ? "active" : "inactive") === selectedStatus);
        });
        filteredUsers.forEach(function (item) {
            const row = body.insertRow();
            cell(row, item.username);
            cell(row, ["student", "staff", "admin"].includes(item.role) ? item.role : "Needs role assignment");
            cell(row, item.full_name || item.office_name || "");
            cell(row, item.student_number || "");
            statusCell(row, item.active ? "ACTIVE" : "INACTIVE");
            const actions = row.insertCell();
            actions.appendChild(createActionButton("Edit", function () {
                const form = document.getElementById("user-form");
                const role = form.elements.role;
                const studentFields = document.getElementById("edit-student-fields");
                const staffFields = document.getElementById("edit-staff-fields");
                const studentNumber = form.elements.student_number;
                const officeCode = form.elements.office_code;
                form.reset();
                populateStudentOptions(studentNumber, students);
                form.elements.user_id.value = item.id;
                form.elements.username.value = item.username;
                form.elements.active.checked = Boolean(item.active);
                form.elements.active.disabled = item.id === currentUser.id;
                role.value = ["student", "staff", "admin"].includes(item.role) ? item.role : "";
                role.disabled = item.id === currentUser.id;
                form.elements.student_number.value = item.student_number || "";
                form.elements.full_name.value = item.full_name || "";
                form.elements.email.value = item.email || "";
                populateOfficeOptions(officeCode, result.offices);
                officeCode.value = item.office_code || "";
                role.onchange = function () {
                    setAccountRoleFields(role.value, studentFields, staffFields, studentNumber, officeCode);
                };
                role.onchange();
                form.hidden = false;
                document.getElementById("password-form").hidden = true;
                document.getElementById("edit-username").focus();
                form.scrollIntoView({ behavior: "smooth", block: "start" });
            }));
            actions.appendChild(createActionButton("Set password", function () {
                const form = document.getElementById("password-form");
                form.reset();
                form.elements.user_id.value = item.id;
                document.getElementById("password-target").textContent =
                    "Set a new password for " + item.username + ". This signs that account out of existing sessions.";
                form.hidden = false;
                document.getElementById("user-form").hidden = true;
                document.getElementById("new-password").focus();
                form.scrollIntoView({ behavior: "smooth", block: "start" });
            }));
        });
        if (!filteredUsers.length) {
            showEmpty(body, 6, result.users.length ? "No accounts match these filters." : "No user accounts have been created.");
        }
    }

    search.oninput = renderUsers;
    roleFilter.onchange = renderUsers;
    statusFilter.onchange = renderUsers;
    renderUsers();

    const form = document.getElementById("user-form");
    form.onsubmit = async function (event) {
        event.preventDefault();
        const userId = form.elements.user_id.value;
        const selected = result.users.find(function (item) {
            return String(item.id) === userId;
        });
        if (!selected) {
            showMessage("Select a user account to edit.", true);
            return;
        }
        const role = form.elements.role.value;
        const details = {
            username: form.elements.username.value.trim(),
            active: form.elements.active.checked,
            role: role
        };
        if (role === "student") {
            details.student_number = form.elements.student_number.value.trim();
            details.full_name = form.elements.full_name.value.trim();
            details.email = form.elements.email.value.trim();
        } else if (role === "staff") {
            details.office_code = form.elements.office_code.value;
        }
        const saveButton = form.querySelector('[type="submit"]');
        saveButton.disabled = true;
        try {
            const update = await HubApi.updateAdminUser(userId, details);
            form.hidden = true;
            await loadAdminUsers(currentUser);
            showMessage(update.message || "User account updated.", false);
        } catch (error) {
            showMessage(error.message, true);
        } finally {
            saveButton.disabled = false;
        }
    };
    document.getElementById("cancel-user-edit").onclick = function () {
        form.hidden = true;
        form.reset();
    };

    const passwordForm = document.getElementById("password-form");
    passwordForm.onsubmit = async function (event) {
        event.preventDefault();
        const userId = passwordForm.elements.user_id.value;
        const password = passwordForm.elements.password.value;
        if (password !== passwordForm.elements.password_confirm.value) {
            showMessage("The new passwords do not match.", true);
            return;
        }
        const target = result.users.find(function (item) {
            return String(item.id) === userId;
        });
        if (!target) {
            showMessage("Select an account before setting a password.", true);
            return;
        }
        const submit = passwordForm.querySelector('[type="submit"]');
        submit.disabled = true;
        try {
            const response = await HubApi.resetAdminUserPassword(userId, password);
            passwordForm.hidden = true;
            passwordForm.reset();
            if (Number(userId) === Number(currentUser.id)) {
                sessionStorage.removeItem("token");
                sessionStorage.removeItem("role");
                sessionStorage.removeItem("user");
                sessionStorage.setItem("loginNotice", response.message);
                location.href = "../../../index.html#login";
                return;
            }
            await loadAdminUsers(currentUser);
            showMessage(response.message + " Share the new password through an approved private channel.", false);
        } catch (error) {
            showMessage(error.message, true);
        } finally {
            submit.disabled = false;
        }
    };
    document.getElementById("cancel-password-reset").onclick = function () {
        passwordForm.hidden = true;
        passwordForm.reset();
    };
}

async function loadVerifyForm() {
    const form = document.getElementById("verify-form");
    form.addEventListener("submit", async function (event) {
        event.preventDefault();
        const code = document.getElementById("slip-code-input").value.trim();
        const token = document.getElementById("slip-token-input").value.trim();
        try {
            const result = await HubApi.verifySlip(token ? { token: token } : { code: code });
            const body = clearRows(document.querySelector(".content table tbody"));
            const rows = [
                ["Signature", result.verified ? "VERIFIED" : "NOT VERIFIED"],
                ["Student", result.student ? result.student.full_name + " (" + result.student.student_number + ")" : ""],
                ["Overall status", result.overall || ""],
                ["Clearance progress", result.progress
                    ? result.progress.cleared + " of " + result.progress.total + " required offices cleared (" + result.progress.percent + "%)"
                    : ""],
                ["Result", result.reason || "Valid signed clearance slip."]
            ];
            rows.forEach(function (item) {
                const row = body.insertRow();
                cell(row, item[0]);
                if (item[0] === "Signature" || item[0] === "Overall status") statusCell(row, item[1]);
                else cell(row, item[1]);
            });
            (result.offices || []).forEach(function (office) {
                const row = body.insertRow();
                cell(row, office.office);
                statusCell(row, office.status);
            });
            showMessage(
                result.verified ? "Signed student QR is valid. Clearance progress is shown below." : result.reason,
                !result.verified
            );
        } catch (error) {
            showMessage(error.message, true);
        }
    });
}

function bindImportForm() {
    const form = document.getElementById("import-form");
    if (form) {
        form.addEventListener("submit", async function (event) {
            event.preventDefault();
            const file = document.getElementById("import-file").files[0];
            const manifest = document.getElementById("import-manifest").files[0];
            if (!file || !manifest) {
                showMessage("Select both the data file and its signed manifest.", true);
                return;
            }
            try {
                const result = await HubApi.uploadImport(file, manifest);
                showMessage("Import " + result.status.toLowerCase() + ": " + result.imported + " imported, " + result.rejected + " rejected.", false);
                await loadImports();
                form.reset();
            } catch (error) {
                showMessage(error.message, true);
                await loadImports();
            }
        });
    }
    const syncButton = document.getElementById("sync-registrar");
    if (syncButton) {
        syncButton.addEventListener("click", async function () {
            try {
                const result = await HubApi.syncRegistrar();
                showMessage("Synchronized " + result.synchronized + " Registrar records.", false);
            } catch (error) {
                showMessage(error.message, true);
            }
        });
    }
}

function bindReportDownloads() {
    document.querySelectorAll("[data-report-format]").forEach(function (button) {
        button.addEventListener("click", async function () {
            try {
                await HubApi.downloadReport(button.dataset.reportFormat);
            } catch (error) {
                showMessage(error.message, true);
            }
        });
    });
}

async function loadPage(user) {
    const folder = location.pathname.split("/").slice(-2, -1)[0];
    if (folder === "office-queue") return loadOfficeQueue(user, folder, "");
    if (folder === "hold-summary") return loadHoldSummary(user);
    if (folder === "import-monitor") {
        bindImportForm();
        return loadImports();
    }
    if (folder === "reports") {
        bindReportDownloads();
        return loadReport();
    }
    if (folder === "audit-log") return loadAudit();
    if (folder === "users" && user.role === "admin") return loadAdminUsers(user);
    if (folder === "verify-slip") return loadVerifyForm();
}

(async function () {
    setupPwa();
    const token = sessionStorage.getItem("token");
    if (!token) {
        location.href = "../../../index.html#login";
        return;
    }
    try {
        const result = await HubApi.me();
        const user = result.user;
        sessionStorage.setItem("role", user.role);
        sessionStorage.setItem("user", JSON.stringify(user));
        const parts = location.pathname.split("/");
        const currentFolder = parts[parts.length - 2];
        const currentRole = parts[parts.length - 3];
        const links = (NAV[user.role] || []).map(function (item) {
            const active = item[1] === currentFolder && user.role === currentRole ? ' class="active"' : "";
            return '<a href="../../' + user.role + "/" + item[1] + "/" + item[1] + '.html"' + active + ">" + item[0] + "</a>";
        }).join("");
        document.getElementById("sidebar").innerHTML = '<div class="brand">DNSC e-Clearance Hub</div>' + links;
        document.getElementById("role-label").textContent = "Signed in as: " + ROLE_NAMES[user.role] + " (" + user.username + ")";
        document.querySelector(".topbar a.btn-outline").addEventListener("click", async function (event) {
            event.preventDefault();
            try { await HubApi.logout(); } catch (error) { showMessage(error.message, true); }
            sessionStorage.clear();
            location.href = "../../../index.html#login";
        });
        if (currentRole !== user.role && !(user.role === "admin" && currentRole === "staff")) {
            location.href = homeFor(user, "../../../");
            return;
        }
        await loadPage(user);
    } catch (error) {
        showMessage(error.message || "Unable to load Hub data.", true);
        if (error.status === 401) {
            sessionStorage.clear();
            location.href = "../../../index.html#login";
        }
    }
})();
