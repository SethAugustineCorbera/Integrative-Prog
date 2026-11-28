PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS offices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(code) <= 40),
    name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(name) <= 120),
    required_for_clearance INTEGER NOT NULL DEFAULT 1
        CHECK (required_for_clearance IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_number TEXT NOT NULL COLLATE NOCASE UNIQUE
        CHECK (length(student_number) <= 40),
    full_name TEXT NOT NULL CHECK (length(full_name) <= 160),
    program TEXT NOT NULL CHECK (length(program) <= 80),
    year_level INTEGER NOT NULL CHECK (year_level BETWEEN 0 AND 255),
    email TEXT CHECK (email IS NULL OR length(email) <= 254),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_students_name ON students (full_name);

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(username) <= 80),
    password_hash TEXT NOT NULL CHECK (length(password_hash) <= 255),
    role TEXT NOT NULL COLLATE NOCASE
        CHECK (role IN ('student', 'staff', 'admin', '')),
    student_id INTEGER UNIQUE,
    office_id INTEGER,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_users_student FOREIGN KEY (student_id) REFERENCES students (id),
    CONSTRAINT fk_users_office FOREIGN KEY (office_id) REFERENCES offices (id)
);

CREATE INDEX IF NOT EXISTS ix_users_office ON users (office_id);

CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash TEXT NOT NULL PRIMARY KEY CHECK (length(token_hash) = 64),
    user_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_sessions_user FOREIGN KEY (user_id)
        REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ix_sessions_expiry ON auth_sessions (expires_at);

CREATE TABLE IF NOT EXISTS clearance_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    office_id INTEGER NOT NULL,
    status TEXT NOT NULL COLLATE NOCASE CHECK (status IN ('CLEARED', 'HOLD')),
    reason TEXT NOT NULL CHECK (length(reason) <= 500),
    source TEXT NOT NULL DEFAULT 'staff' CHECK (length(source) <= 40),
    updated_by INTEGER,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_clearance_student_office UNIQUE (student_id, office_id),
    CONSTRAINT fk_clearance_student FOREIGN KEY (student_id)
        REFERENCES students (id) ON DELETE CASCADE,
    CONSTRAINT fk_clearance_office FOREIGN KEY (office_id) REFERENCES offices (id),
    CONSTRAINT fk_clearance_user FOREIGN KEY (updated_by)
        REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS ix_clearance_status_office
    ON clearance_records (office_id, status);

CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_user_id INTEGER,
    action TEXT NOT NULL COLLATE NOCASE CHECK (
        action IN (
            'SIGN_OFF', 'HOLD', 'IMPORT', 'SLIP_ISSUED', 'SLIP_VERIFIED',
            'USER_CREATED', 'USER_UPDATED', 'PASSWORD_RESET'
        )
    ),
    student_id INTEGER,
    office_id INTEGER,
    reason TEXT CHECK (reason IS NULL OR length(reason) <= 500),
    details_json TEXT CHECK (
        details_json IS NULL OR json_valid(details_json)
    ),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id)
        REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT fk_audit_student FOREIGN KEY (student_id)
        REFERENCES students (id) ON DELETE SET NULL,
    CONSTRAINT fk_audit_office FOREIGN KEY (office_id)
        REFERENCES offices (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS ix_audit_created ON audit_logs (created_at);
CREATE INDEX IF NOT EXISTS ix_audit_student ON audit_logs (student_id);

CREATE TABLE IF NOT EXISTS import_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_name TEXT NOT NULL CHECK (length(file_name) <= 255),
    source TEXT NOT NULL CHECK (length(source) <= 40),
    file_sha256 TEXT CHECK (file_sha256 IS NULL OR length(file_sha256) = 64),
    nonce TEXT UNIQUE CHECK (nonce IS NULL OR length(nonce) <= 120),
    manifest_verified INTEGER NOT NULL DEFAULT 0
        CHECK (manifest_verified IN (0, 1)),
    status TEXT NOT NULL COLLATE NOCASE CHECK (status IN ('COMPLETED', 'PARTIAL', 'REJECTED')),
    imported_count INTEGER NOT NULL DEFAULT 0
        CHECK (imported_count BETWEEN 0 AND 4294967295),
    rejected_count INTEGER NOT NULL DEFAULT 0
        CHECK (rejected_count BETWEEN 0 AND 4294967295),
    created_by INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_import_user FOREIGN KEY (created_by)
        REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS ix_import_created ON import_batches (created_at);

CREATE TABLE IF NOT EXISTS import_rejections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL,
    row_reference TEXT NOT NULL CHECK (length(row_reference) <= 120),
    reason TEXT NOT NULL CHECK (length(reason) <= 500),
    record_json TEXT CHECK (record_json IS NULL OR json_valid(record_json)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_rejection_batch FOREIGN KEY (batch_id)
        REFERENCES import_batches (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ix_rejections_batch ON import_rejections (batch_id);

CREATE TABLE IF NOT EXISTS clearance_slips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_code TEXT NOT NULL UNIQUE CHECK (length(public_code) <= 24),
    token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    signature TEXT NOT NULL CHECK (length(signature) = 64),
    student_id INTEGER NOT NULL,
    issued_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    CONSTRAINT fk_slips_student FOREIGN KEY (student_id)
        REFERENCES students (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ix_slips_student
    ON clearance_slips (student_id, expires_at);

CREATE TABLE IF NOT EXISTS student_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id TEXT NOT NULL COLLATE NOCASE UNIQUE
        CHECK (length(card_id) BETWEEN 1 AND 128),
    student_id INTEGER NOT NULL UNIQUE,
    registered_by INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_student_cards_student FOREIGN KEY (student_id)
        REFERENCES students (id) ON DELETE CASCADE,
    CONSTRAINT fk_student_cards_user FOREIGN KEY (registered_by)
        REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS holidays (
    holiday_date TEXT NOT NULL,
    local_name TEXT NOT NULL CHECK (length(local_name) <= 160),
    english_name TEXT NOT NULL CHECK (length(english_name) <= 160),
    country_code TEXT NOT NULL DEFAULT 'PH' CHECK (length(country_code) = 2),
    fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (holiday_date, country_code)
);

CREATE TRIGGER IF NOT EXISTS trg_students_updated_at
AFTER UPDATE ON students
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
    AND (
        NEW.id IS NOT OLD.id
        OR NEW.student_number IS NOT OLD.student_number
        OR NEW.full_name IS NOT OLD.full_name
        OR NEW.program IS NOT OLD.program
        OR NEW.year_level IS NOT OLD.year_level
        OR NEW.email IS NOT OLD.email
        OR NEW.active IS NOT OLD.active
        OR NEW.created_at IS NOT OLD.created_at
    )
BEGIN
    UPDATE students SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_clearance_records_updated_at
AFTER UPDATE ON clearance_records
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
    AND (
        NEW.id IS NOT OLD.id
        OR NEW.student_id IS NOT OLD.student_id
        OR NEW.office_id IS NOT OLD.office_id
        OR NEW.status IS NOT OLD.status
        OR NEW.reason IS NOT OLD.reason
        OR NEW.source IS NOT OLD.source
        OR NEW.updated_by IS NOT OLD.updated_by
    )
BEGIN
    UPDATE clearance_records
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.id;
END;

INSERT INTO offices (code, name, required_for_clearance) VALUES
    ('registrar', 'Registrar', 1),
    ('library', 'Library', 1),
    ('accounting', 'Accounting / Cashier', 1),
    ('student-affairs', 'Student Affairs', 1)
ON CONFLICT DO NOTHING;
