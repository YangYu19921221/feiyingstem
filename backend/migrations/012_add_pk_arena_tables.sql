-- ========================================
-- PK 竞技场 表(房间归档 / 玩家成绩 / 答题流水)
-- ========================================

CREATE TABLE IF NOT EXISTS pk_rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invite_code VARCHAR(6) UNIQUE NOT NULL,
    host_id INTEGER NOT NULL,
    unit_id INTEGER NOT NULL,
    max_players INTEGER NOT NULL DEFAULT 4 CHECK(max_players BETWEEN 2 AND 6),
    status VARCHAR(10) NOT NULL,  -- waiting/playing/finished/abandoned
    word_ids TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP,
    finished_at TIMESTAMP,
    FOREIGN KEY (host_id) REFERENCES users(id),
    FOREIGN KEY (unit_id) REFERENCES units(id)
);
CREATE INDEX IF NOT EXISTS idx_pk_rooms_invite ON pk_rooms(invite_code);
CREATE INDEX IF NOT EXISTS idx_pk_rooms_status ON pk_rooms(status);

CREATE TABLE IF NOT EXISTS pk_room_players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    rank INTEGER,
    accuracy DECIMAL(5,2),
    total_time_ms INTEGER,
    correct_count INTEGER,
    wrong_count INTEGER,
    final_score INTEGER,
    is_disconnected BOOLEAN DEFAULT 0,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(room_id, user_id),
    FOREIGN KEY (room_id) REFERENCES pk_rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS pk_answer_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    word_id INTEGER NOT NULL,
    phase VARCHAR(20) NOT NULL,
    is_correct BOOLEAN,
    time_spent_ms INTEGER,
    answered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES pk_rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (word_id) REFERENCES words(id)
);
CREATE INDEX IF NOT EXISTS idx_pk_records_room ON pk_answer_records(room_id);
