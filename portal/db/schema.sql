-- ZXPkg portal schema (MariaDB). Applied on worker start (idempotent).

CREATE TABLE IF NOT EXISTS repos (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source_url      VARCHAR(512) NOT NULL UNIQUE,
  host            VARCHAR(64)  NOT NULL DEFAULT 'git',
  owner_handle    VARCHAR(128) NULL,
  claim_token     VARCHAR(64)  NULL,
  claim_state     ENUM('unclaimed','claimed') NOT NULL DEFAULT 'unclaimed',
  last_commit_sha CHAR(40)     NULL,
  last_crawled_at DATETIME     NULL,
  status          ENUM('pending','active','errored') NOT NULL DEFAULT 'pending',
  error_message   TEXT         NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS packages (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  repo_id     INT UNSIGNED NULL,                 -- NULL = repo-less (uploaded binary)
  name        VARCHAR(64)  NOT NULL UNIQUE,
  description VARCHAR(255) NULL,
  homepage    VARCHAR(512) NULL,
  license     VARCHAR(64)  NULL,
  author      VARCHAR(128) NULL,
  category    VARCHAR(64)  NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pkg_repo FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS versions (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  package_id    INT UNSIGNED NOT NULL,
  version       VARCHAR(32)  NOT NULL,
  type          VARCHAR(24)  NOT NULL DEFAULT 'dot',
  machine       ENUM('16k','48k','128k','next') NOT NULL,
  os_csv        VARCHAR(64)  NOT NULL DEFAULT '',
  needs_csv     VARCHAR(128) NOT NULL DEFAULT '',
  min_core      VARCHAR(16)  NULL,
  commit_sha    CHAR(40)     NOT NULL,
  manifest_json LONGTEXT     NOT NULL,
  is_latest     TINYINT(1)   NOT NULL DEFAULT 0,
  retrieved_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pkg_ver (package_id, version),
  CONSTRAINT fk_ver_pkg FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS artifacts (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  version_id INT UNSIGNED NOT NULL,
  command    VARCHAR(16)  NOT NULL,
  file_path  VARCHAR(512) NOT NULL,
  sig_path   VARCHAR(512) NOT NULL,
  crc32c     INT UNSIGNED NOT NULL,
  size       INT UNSIGNED NOT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_artifact_crc (crc32c),
  CONSTRAINT fk_art_ver FOREIGN KEY (version_id) REFERENCES versions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Admin-entered manifests for repos that don't carry a .zxpkg.toml (authors
-- unreachable, etc.). When present for a repo, these are used instead of the file.
-- Multiple rows per repo = multiple packages from one repo.
CREATE TABLE IF NOT EXISTS manual_manifests (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  repo_id       INT UNSIGNED NOT NULL,
  name          VARCHAR(64)  NOT NULL UNIQUE,
  manifest_json LONGTEXT     NOT NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_manual_repo FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS crawl_queue (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  repo_id      INT UNSIGNED NOT NULL,
  status       ENUM('pending','done','error') NOT NULL DEFAULT 'pending',
  requested_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_queue_status (status),
  CONSTRAINT fk_queue_repo FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Migrations for pre-existing databases (idempotent; MariaDB ADD COLUMN IF NOT EXISTS).
-- New columns added after the initial release go here so existing DBs are upgraded.
ALTER TABLE versions ADD COLUMN IF NOT EXISTS type VARCHAR(24) NOT NULL DEFAULT 'dot' AFTER version;
-- Allow repo-less (uploaded) packages on databases created before this was nullable.
ALTER TABLE packages MODIFY repo_id INT UNSIGNED NULL;
