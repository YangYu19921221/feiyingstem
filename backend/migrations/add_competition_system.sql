-- ========================================
-- 实时排名竞赛系统数据库扩展
-- ========================================

-- 竞赛赛季表
CREATE TABLE IF NOT EXISTS competition_seasons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(100) NOT NULL,
    season_type VARCHAR(20) CHECK(season_type IN ('daily', 'weekly', 'monthly', 'special')) DEFAULT 'daily',
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    is_active BOOLEAN DEFAULT 1,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 用户积分表(按赛季隔离)
CREATE TABLE IF NOT EXISTS user_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    season_id INTEGER NOT NULL,
    total_score INTEGER DEFAULT 0,
    daily_score INTEGER DEFAULT 0,
    weekly_score INTEGER DEFAULT 0,
    monthly_score INTEGER DEFAULT 0,
    current_combo INTEGER DEFAULT 0,
    max_combo INTEGER DEFAULT 0,
    questions_answered INTEGER DEFAULT 0,
    correct_count INTEGER DEFAULT 0,
    accuracy_rate DECIMAL(5,2) DEFAULT 0.00,
    last_answer_time TIMESTAMP,
    rank_daily INTEGER,
    rank_weekly INTEGER,
    rank_overall INTEGER,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (season_id) REFERENCES competition_seasons(id) ON DELETE CASCADE,
    UNIQUE(user_id, season_id)
);

-- 答题记录(详细,用于积分计算)
CREATE TABLE IF NOT EXISTS answer_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    word_id INTEGER NOT NULL,
    season_id INTEGER NOT NULL,
    question_type VARCHAR(20) CHECK(question_type IN ('choice', 'spelling', 'fill_blank', 'listening')) DEFAULT 'choice',
    is_correct BOOLEAN NOT NULL,
    time_spent INTEGER NOT NULL,
    base_score INTEGER DEFAULT 10,
    difficulty_bonus INTEGER DEFAULT 0,
    speed_bonus INTEGER DEFAULT 0,
    combo_bonus INTEGER DEFAULT 0,
    first_time_bonus INTEGER DEFAULT 0,
    total_score INTEGER NOT NULL,
    combo_count INTEGER DEFAULT 0,
    is_first_correct BOOLEAN DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE,
    FOREIGN KEY (season_id) REFERENCES competition_seasons(id) ON DELETE CASCADE
);

-- 单元挑战赛表
CREATE TABLE IF NOT EXISTS unit_challenges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    unit_id INTEGER,
    name VARCHAR(100) NOT NULL,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    is_active BOOLEAN DEFAULT 1,
    max_participants INTEGER DEFAULT 1000,
    entry_fee INTEGER DEFAULT 0,
    reward_config TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 挑战赛排名表
CREATE TABLE IF NOT EXISTS challenge_rankings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    challenge_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    score INTEGER DEFAULT 0,
    rank INTEGER,
    questions_answered INTEGER DEFAULT 0,
    correct_count INTEGER DEFAULT 0,
    completion_time INTEGER,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_update TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (challenge_id) REFERENCES unit_challenges(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(challenge_id, user_id)
);

-- 排行榜快照表(用于历史记录)
CREATE TABLE IF NOT EXISTS leaderboard_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    season_id INTEGER NOT NULL,
    snapshot_type VARCHAR(20) CHECK(snapshot_type IN ('daily', 'weekly', 'monthly')) DEFAULT 'daily',
    snapshot_date DATE NOT NULL,
    rankings TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (season_id) REFERENCES competition_seasons(id) ON DELETE CASCADE
);

-- ========================================
-- 索引优化
-- ========================================

CREATE INDEX IF NOT EXISTS idx_user_scores_season ON user_scores(season_id);
CREATE INDEX IF NOT EXISTS idx_user_scores_daily ON user_scores(season_id, daily_score DESC);
CREATE INDEX IF NOT EXISTS idx_user_scores_weekly ON user_scores(season_id, weekly_score DESC);
CREATE INDEX IF NOT EXISTS idx_user_scores_overall ON user_scores(season_id, total_score DESC);
CREATE INDEX IF NOT EXISTS idx_user_scores_user ON user_scores(user_id);
CREATE INDEX IF NOT EXISTS idx_answer_records_user_time ON answer_records(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_answer_records_season ON answer_records(season_id);
CREATE INDEX IF NOT EXISTS idx_challenge_rankings_challenge ON challenge_rankings(challenge_id, score DESC);

-- ========================================
-- 初始化当前赛季
-- ========================================

INSERT INTO competition_seasons (name, season_type, start_time, end_time, is_active, description)
VALUES
('2025年度总赛季', 'special', '2025-01-01 00:00:00', '2025-12-31 23:59:59', 1, '全年竞赛赛季,所有学生实时排名');
