ALTER TABLE audit_logs
    MODIFY COLUMN action ENUM(
        'SIGN_OFF',
        'HOLD',
        'IMPORT',
        'SLIP_ISSUED',
        'SLIP_VERIFIED',
        'USER_CREATED',
        'USER_UPDATED',
        'PASSWORD_RESET'
    ) NOT NULL;
