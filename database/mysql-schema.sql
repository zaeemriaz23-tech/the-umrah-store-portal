-- Reference only. The application creates and upgrades these tables itself on start-up
-- (CREATE TABLE IF NOT EXISTS / ADD COLUMN when missing). Do NOT run DROP or TRUNCATE on them:
-- crm_state holds the whole CRM (users, agents, suppliers, bookings, payments, ledgers, vouchers, settings).

CREATE TABLE IF NOT EXISTS crm_state (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  revision BIGINT UNSIGNED NOT NULL,
  payload LONGTEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- restore points. kind: initial | auto | daily | pre-migration | pre-restore | manual
CREATE TABLE IF NOT EXISTS crm_state_backups (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  revision BIGINT UNSIGNED NOT NULL,
  payload LONGTEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  kind VARCHAR(20) NOT NULL DEFAULT 'auto',
  note VARCHAR(255) NOT NULL DEFAULT '',
  size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  KEY idx_crm_state_backups_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- durable copy of uploaded files: receipts/, kyc/, promos/, brand/logo.*
CREATE TABLE IF NOT EXISTS crm_files (
  path VARCHAR(255) NOT NULL PRIMARY KEY,
  size_bytes BIGINT UNSIGNED NOT NULL,
  sha256 CHAR(64) NOT NULL,
  data LONGBLOB NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
