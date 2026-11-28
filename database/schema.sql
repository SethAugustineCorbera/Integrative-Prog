CREATE DATABASE IF NOT EXISTS dnsc_clearance_hub
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
USE dnsc_clearance_hub;

CREATE TABLE IF NOT EXISTS offices (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    code VARCHAR(40) NOT NULL,
    name VARCHAR(120) NOT NULL,
    required_for_clearance TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_offices_code (code),
    UNIQUE KEY uq_offices_name (name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS students (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    student_number VARCHAR(40) NOT NULL,
    full_name VARCHAR(160) NOT NULL,
    program VARCHAR(80) NOT NULL,
    year_level TINYINT UNSIGNED NOT NULL,
    email VARCHAR(254) NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_students_number (student_number),
    KEY ix_students_name (full_name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    username VARCHAR(80) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('student', 'staff', 'admin') NOT NULL,
    student_id BIGINT UNSIGNED NULL,
    office_id BIGINT UNSIGNED NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_username (username),
    UNIQUE KEY uq_users_student (student_id),
    KEY ix_users_office (office_id),
    CONSTRAINT fk_users_student FOREIGN KEY (student_id) REFERENCES students(id),
    CONSTRAINT fk_users_office FOREIGN KEY (office_id) REFERENCES offices(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash CHAR(64) NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (token_hash),
    KEY ix_sessions_expiry (expires_at),
    CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS clearance_records (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    student_id BIGINT UNSIGNED NOT NULL,
    office_id BIGINT UNSIGNED NOT NULL,
    status ENUM('CLEARED', 'HOLD') NOT NULL,
    reason VARCHAR(500) NOT NULL,
    source VARCHAR(40) NOT NULL DEFAULT 'staff',
    updated_by BIGINT UNSIGNED NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_clearance_student_office (student_id, office_id),
    KEY ix_clearance_status_office (office_id, status),
    CONSTRAINT fk_clearance_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
    CONSTRAINT fk_clearance_office FOREIGN KEY (office_id) REFERENCES offices(id),
    CONSTRAINT fk_clearance_user FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    actor_user_id BIGINT UNSIGNED NULL,
    action ENUM(
        'SIGN_OFF', 'HOLD', 'IMPORT', 'SLIP_ISSUED', 'SLIP_VERIFIED',
        'USER_CREATED', 'USER_UPDATED', 'PASSWORD_RESET'
    ) NOT NULL,
    student_id BIGINT UNSIGNED NULL,
    office_id BIGINT UNSIGNED NULL,
    reason VARCHAR(500) NULL,
    details_json JSON NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY ix_audit_created (created_at),
    KEY ix_audit_student (student_id),
    CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_audit_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL,
    CONSTRAINT fk_audit_office FOREIGN KEY (office_id) REFERENCES offices(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS import_batches (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    file_name VARCHAR(255) NOT NULL,
    source VARCHAR(40) NOT NULL,
    file_sha256 CHAR(64) NULL,
    nonce VARCHAR(120) NULL,
    manifest_verified TINYINT(1) NOT NULL DEFAULT 0,
    status ENUM('COMPLETED', 'PARTIAL', 'REJECTED') NOT NULL,
    imported_count INT UNSIGNED NOT NULL DEFAULT 0,
    rejected_count INT UNSIGNED NOT NULL DEFAULT 0,
    created_by BIGINT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_import_nonce (nonce),
    KEY ix_import_created (created_at),
    CONSTRAINT fk_import_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS import_rejections (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    batch_id BIGINT UNSIGNED NOT NULL,
    row_reference VARCHAR(120) NOT NULL,
    reason VARCHAR(500) NOT NULL,
    record_json JSON NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY ix_rejections_batch (batch_id),
    CONSTRAINT fk_rejection_batch FOREIGN KEY (batch_id) REFERENCES import_batches(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS clearance_slips (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    public_code VARCHAR(24) NOT NULL,
    token_hash CHAR(64) NOT NULL,
    payload_json JSON NOT NULL,
    signature CHAR(64) NOT NULL,
    student_id BIGINT UNSIGNED NOT NULL,
    issued_at DATETIME NOT NULL,
    expires_at DATETIME NOT NULL,
    revoked_at DATETIME NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_slips_code (public_code),
    UNIQUE KEY uq_slips_token_hash (token_hash),
    KEY ix_slips_student (student_id, expires_at),
    CONSTRAINT fk_slips_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS student_cards (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    card_id VARCHAR(128) NOT NULL,
    student_id BIGINT UNSIGNED NOT NULL,
    registered_by BIGINT UNSIGNED NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_student_cards_card_id (card_id),
    UNIQUE KEY uq_student_cards_student_id (student_id),
    CONSTRAINT fk_student_cards_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
    CONSTRAINT fk_student_cards_user FOREIGN KEY (registered_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS holidays (
    holiday_date DATE NOT NULL,
    local_name VARCHAR(160) NOT NULL,
    english_name VARCHAR(160) NOT NULL,
    country_code CHAR(2) NOT NULL DEFAULT 'PH',
    fetched_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (holiday_date, country_code)
) ENGINE=InnoDB;

INSERT IGNORE INTO offices (code, name, required_for_clearance) VALUES
    ('registrar', 'Registrar', 1),
    ('library', 'Library', 1),
    ('accounting', 'Accounting / Cashier', 1),
    ('student-affairs', 'Student Affairs', 1);
