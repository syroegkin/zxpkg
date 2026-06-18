-- ZXPkg portal schema (MariaDB). Applied on worker start (idempotent).

CREATE TABLE IF NOT EXISTS repos (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source_url      VARCHAR(512) NOT NULL UNIQUE,
  host            VARCHAR(64)  NOT NULL DEFAULT 'git',
  vcs             ENUM('git','svn') NOT NULL DEFAULT 'git',  -- version-control type (git or Subversion)
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
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  repo_id       INT UNSIGNED NULL,                 -- NULL = repo-less (uploaded binary)
  name          VARCHAR(64)  NOT NULL,             -- NOT globally unique; see uq_name_owner
  owner         VARCHAR(64)  NOT NULL DEFAULT 'community', -- publisher slug; (name,owner) is the identity
  preferred     TINYINT(1)   NOT NULL DEFAULT 0,   -- default pick when same name collides on a platform
  description   VARCHAR(255) NULL,
  homepage      VARCHAR(512) NULL,
  license       VARCHAR(64)  NULL,
  redistributable TINYINT(1) NOT NULL DEFAULT 1,    -- false => portal mirrors link-only (paid/restricted)
  author        VARCHAR(128) NULL,
  category      VARCHAR(64)  NULL,
  readme        LONGTEXT     NULL,                 -- long markdown body (web page only; never in device index)
  -- listed = public; hidden = unlisted (review); removed = tombstone (files deleted,
  -- row kept so it can't be silently re-archived). Public catalog/index = listed only.
  archive_state ENUM('listed','hidden','removed') NOT NULL DEFAULT 'listed',
  archived_at   DATETIME     NULL,                 -- when set to hidden/removed
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_name_owner (name, owner),
  CONSTRAINT fk_pkg_repo FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS versions (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  package_id    INT UNSIGNED NOT NULL,
  version       VARCHAR(32)  NOT NULL,
  type          VARCHAR(24)  NOT NULL DEFAULT 'dot',
  machine_csv   VARCHAR(64)  NOT NULL DEFAULT '',   -- known-good set (CSV), e.g. '48k,128k,next'
  os_csv        VARCHAR(64)  NOT NULL DEFAULT '',
  needs_csv     VARCHAR(128) NOT NULL DEFAULT '',
  min_core      VARCHAR(16)  NULL,
  os_version    VARCHAR(48)  NULL,                  -- specific target OS release, e.g. "esxdos 0.8.7" / "nextzxos 2.09"
  bundled_in    VARCHAR(255) NULL,                  -- provenance: OS/distro release it shipped in
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

-- Admin per-field overrides layered ON TOP of a package's base data (seed / crawled
-- TOML / upload). NULL column = inherit the base; non-NULL = the override wins at read
-- time (site, search, device index.dat + gopher). The crawler never touches this table,
-- so admin edits survive every re-crawl; "drop override" = delete the row (or NULL a
-- column) and the underlying source re-surfaces. One row per package (package_id).
CREATE TABLE IF NOT EXISTS package_overrides (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  package_id      INT UNSIGNED NOT NULL UNIQUE,
  -- package-level fields (mirror `packages`)
  description     VARCHAR(255) NULL,
  readme          LONGTEXT     NULL,
  os_version      VARCHAR(48)  NULL,
  homepage        VARCHAR(512) NULL,
  license         VARCHAR(64)  NULL,
  author          VARCHAR(128) NULL,
  redistributable TINYINT(1)   NULL,
  -- version-level fields (mirror the latest `versions` row; applied package-wide)
  type            VARCHAR(24)  NULL,
  machine_csv     VARCHAR(64)  NULL,
  os_csv          VARCHAR(64)  NULL,
  needs_csv       VARCHAR(128) NULL,
  bundled_in      VARCHAR(255) NULL,
  note            VARCHAR(255) NULL,                  -- admin note: why this was overridden
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_override_pkg FOREIGN KEY (package_id) REFERENCES packages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Non-installable, download-only companion files preserved for a version (e.g. the
-- author's original source/binary zip). Never signed, never put in the device index
-- (index.dat is built from `artifacts` only) — a zip can't leak into the on-device flow.
-- file_path NULL = link-only (mirror failed / over size cap); rely on original_url.
CREATE TABLE IF NOT EXISTS source_bundles (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  version_id   INT UNSIGNED NOT NULL,
  label        VARCHAR(128) NULL,
  file_path    VARCHAR(512) NULL,                  -- local mirror; NULL = link-only
  original_url VARCHAR(512) NULL,                  -- upstream source URL
  sha256       CHAR(64)     NULL,                  -- identity of the mirrored file
  size         INT UNSIGNED NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_srcbundle_ver (version_id),
  CONSTRAINT fk_srcbundle_ver FOREIGN KEY (version_id) REFERENCES versions(id) ON DELETE CASCADE
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
-- Git-less archive sources (blog posts, orphaned uploads) have no commit.
ALTER TABLE versions MODIFY commit_sha CHAR(40) NULL;
-- Takedown/visibility state for preserved third-party packages.
ALTER TABLE packages ADD COLUMN IF NOT EXISTS archive_state ENUM('listed','hidden','removed') NOT NULL DEFAULT 'listed';
ALTER TABLE packages ADD COLUMN IF NOT EXISTS archived_at DATETIME NULL;
-- Compat redesign (2026-06-16): `machine` becomes a known-good SET (CSV), not a single enum.
-- The old single-value `machine` column is dropped (no backfill — prod is being reset; existing
-- rows had one model, which would just become a one-element set).
ALTER TABLE versions ADD COLUMN IF NOT EXISTS machine_csv VARCHAR(64) NOT NULL DEFAULT '' AFTER type;
ALTER TABLE versions DROP COLUMN IF EXISTS machine;
-- Provenance: OS/distro release a command originally shipped in (display-only).
ALTER TABLE versions ADD COLUMN IF NOT EXISTS bundled_in VARCHAR(255) NULL;
ALTER TABLE versions MODIFY bundled_in VARCHAR(255) NULL;  -- widen if it pre-existed as VARCHAR(64)
-- Redistribution flag: false => portal mirrors link-only (paid/permission-restricted artifacts).
ALTER TABLE packages ADD COLUMN IF NOT EXISTS redistributable TINYINT(1) NOT NULL DEFAULT 1;
-- Duplicate model (2026-06-16): identity is (name, owner), not name alone. Same name is
-- allowed across owners (cross-platform variants); `preferred` resolves a same-platform clash.
ALTER TABLE packages ADD COLUMN IF NOT EXISTS owner VARCHAR(64) NOT NULL DEFAULT 'community';
ALTER TABLE packages ADD COLUMN IF NOT EXISTS preferred TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE packages DROP INDEX IF EXISTS name;             -- old global-unique on name
ALTER TABLE packages ADD UNIQUE INDEX IF NOT EXISTS uq_name_owner (name, owner);
-- Rich markdown body for the package web page (2026-06): short `description` stays the
-- device/card summary; `readme` holds the long markdown (screenshots, formatted text).
ALTER TABLE packages ADD COLUMN IF NOT EXISTS readme LONGTEXT NULL;
ALTER TABLE package_overrides ADD COLUMN IF NOT EXISTS readme LONGTEXT NULL;
-- Specific target OS release (e.g. "esxdos 0.8.7") (2026-06).
ALTER TABLE versions ADD COLUMN IF NOT EXISTS os_version VARCHAR(48) NULL;
ALTER TABLE package_overrides ADD COLUMN IF NOT EXISTS os_version VARCHAR(48) NULL;
-- Subversion repo support (2026-06): mirror/store SVN repos alongside git.
ALTER TABLE repos ADD COLUMN IF NOT EXISTS vcs ENUM('git','svn') NOT NULL DEFAULT 'git';
