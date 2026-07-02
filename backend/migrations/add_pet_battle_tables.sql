-- ========================================
-- 宠物回合制对战系统 - 数据库表
-- ========================================

-- 对战记录表
CREATE TABLE IF NOT EXISTS pet_battles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    -- 对战双方
    player1_id INTEGER NOT NULL,
    player2_id INTEGER NOT NULL,
    player1_pet_id INTEGER NOT NULL,
    player2_pet_id INTEGER NOT NULL,

    -- 对战配置
    wordbook_id INTEGER,  -- 单词本(为空则随机)
    mode VARCHAR(20) DEFAULT 'casual',  -- casual(休闲)/ranked(排位)
    max_rounds INTEGER DEFAULT 10,
    time_per_question INTEGER DEFAULT 15,  -- 每题答题时间(秒)

    -- 对战状态
    status VARCHAR(20) DEFAULT 'pending',  -- pending(邀请中)/active(进行中)/finished(已结束)/cancelled(已取消)
    current_round INTEGER DEFAULT 0,

    -- 初始属性
    player1_initial_hp INTEGER DEFAULT 120,
    player2_initial_hp INTEGER DEFAULT 100,

    -- 实时属性
    player1_hp INTEGER DEFAULT 120,
    player2_hp INTEGER DEFAULT 100,
    player1_combo INTEGER DEFAULT 0,
    player2_combo INTEGER DEFAULT 0,
    player1_ultimate_charges INTEGER DEFAULT 0,  -- 必杀技充能数
    player2_ultimate_charges INTEGER DEFAULT 0,

    -- 战斗数据
    questions_data TEXT,  -- JSON: 题目列表

    -- 胜负
    winner_id INTEGER,
    player1_total_correct INTEGER DEFAULT 0,
    player2_total_correct INTEGER DEFAULT 0,
    player1_total_damage INTEGER DEFAULT 0,
    player2_total_damage INTEGER DEFAULT 0,

    -- 时间戳
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP,
    finished_at TIMESTAMP,
    expires_at TIMESTAMP,  -- 邀请过期时间

    FOREIGN KEY (player1_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (player2_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (player1_pet_id) REFERENCES user_pets(id),
    FOREIGN KEY (player2_pet_id) REFERENCES user_pets(id),
    FOREIGN KEY (wordbook_id) REFERENCES word_books(id) ON DELETE SET NULL,
    FOREIGN KEY (winner_id) REFERENCES users(id)
);

-- 回合记录表
CREATE TABLE IF NOT EXISTS pet_battle_rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    battle_id INTEGER NOT NULL,
    round_number INTEGER NOT NULL,

    -- 题目
    question_word_id INTEGER NOT NULL,
    question_text TEXT NOT NULL,
    options TEXT NOT NULL,  -- JSON: ["A. 快乐的", "B. 悲伤的", ...]
    correct_answer VARCHAR(1) NOT NULL,  -- A/B/C/D

    -- 玩家1答题
    player1_answer VARCHAR(1),
    player1_correct BOOLEAN DEFAULT 0,
    player1_submit_time TIMESTAMP,
    player1_time_ms INTEGER,  -- 答题用时(毫秒)
    player1_damage INTEGER DEFAULT 0,
    player1_used_ultimate BOOLEAN DEFAULT 0,

    -- 玩家2答题
    player2_answer VARCHAR(1),
    player2_correct BOOLEAN DEFAULT 0,
    player2_submit_time TIMESTAMP,
    player2_time_ms INTEGER,
    player2_damage INTEGER DEFAULT 0,
    player2_used_ultimate BOOLEAN DEFAULT 0,

    -- 回合结果
    player1_hp_after INTEGER,
    player2_hp_after INTEGER,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (battle_id) REFERENCES pet_battles(id) ON DELETE CASCADE,
    FOREIGN KEY (question_word_id) REFERENCES words(id)
);

-- 对战统计表(用户维度)
CREATE TABLE IF NOT EXISTS pet_battle_stats (
    user_id INTEGER PRIMARY KEY,

    -- 基础统计
    total_battles INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    draws INTEGER DEFAULT 0,

    -- 连胜
    current_win_streak INTEGER DEFAULT 0,
    max_win_streak INTEGER DEFAULT 0,
    current_lose_streak INTEGER DEFAULT 0,

    -- 战斗数据
    total_damage_dealt INTEGER DEFAULT 0,
    total_damage_taken INTEGER DEFAULT 0,
    total_correct_answers INTEGER DEFAULT 0,
    total_wrong_answers INTEGER DEFAULT 0,

    -- 必杀技
    ultimates_used INTEGER DEFAULT 0,
    ultimates_landed INTEGER DEFAULT 0,  -- 成功命中

    -- 特殊成就
    perfect_wins INTEGER DEFAULT 0,  -- 满血胜利
    comeback_wins INTEGER DEFAULT 0,  -- 劣势翻盘(HP<30%时逆转)

    -- 排位分(如果有排位赛)
    rating INTEGER DEFAULT 1000,
    peak_rating INTEGER DEFAULT 1000,

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 索引优化
CREATE INDEX IF NOT EXISTS idx_pet_battles_player1 ON pet_battles(player1_id);
CREATE INDEX IF NOT EXISTS idx_pet_battles_player2 ON pet_battles(player2_id);
CREATE INDEX IF NOT EXISTS idx_pet_battles_status ON pet_battles(status);
CREATE INDEX IF NOT EXISTS idx_pet_battle_rounds_battle ON pet_battle_rounds(battle_id);
CREATE INDEX IF NOT EXISTS idx_pet_battle_stats_rating ON pet_battle_stats(rating DESC);

-- 触发器: 自动初始化统计数据
CREATE TRIGGER IF NOT EXISTS init_battle_stats_on_user_create
AFTER INSERT ON users
BEGIN
    INSERT INTO pet_battle_stats (user_id) VALUES (NEW.id);
END;
