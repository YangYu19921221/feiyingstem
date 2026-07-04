-- ========================================
-- PK 竞技场:房间人数上限 6 → 20
-- SQLite 无法直接改 CHECK 约束,重建 pk_rooms 表
-- ========================================

PRAGMA foreign_keys=OFF;

BEGIN TRANSACTION;

CREATE TABLE pk_rooms_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invite_code VARCHAR(6) UNIQUE NOT NULL,
    host_id INTEGER NOT NULL,
    unit_id INTEGER NOT NULL,
    max_players INTEGER NOT NULL DEFAULT 4 CHECK(max_players BETWEEN 2 AND 20),
    status VARCHAR(10) NOT NULL,  -- waiting/playing/finished/abandoned
    word_ids TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP,
    finished_at TIMESTAMP,
    FOREIGN KEY (host_id) REFERENCES users(id),
    FOREIGN KEY (unit_id) REFERENCES units(id)
);

INSERT INTO pk_rooms_new
    (id, invite_code, host_id, unit_id, max_players, status, word_ids, created_at, started_at, finished_at)
SELECT id, invite_code, host_id, unit_id, max_players, status, word_ids, created_at, started_at, finished_at
FROM pk_rooms;

DROP TABLE pk_rooms;
ALTER TABLE pk_rooms_new RENAME TO pk_rooms;

CREATE INDEX IF NOT EXISTS idx_pk_rooms_invite ON pk_rooms(invite_code);
CREATE INDEX IF NOT EXISTS idx_pk_rooms_status ON pk_rooms(status);

COMMIT;

PRAGMA foreign_keys=ON;
