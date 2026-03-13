-- 竞赛题库系统数据库迁移
-- 创建时间: 2025-11-23

-- 1. 竞赛题库表
CREATE TABLE IF NOT EXISTS competition_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    -- 基本信息
    question_type VARCHAR(20) NOT NULL, -- choice, fill_blank, spelling, reading
    title TEXT,  -- 题目标题(阅读理解用)
    content TEXT NOT NULL,  -- 题目内容/题干
    passage TEXT,  -- 阅读理解文章

    -- 答案相关
    correct_answer TEXT NOT NULL,  -- 正确答案(JSON格式)
    answer_explanation TEXT,  -- 答案解析

    -- 元数据
    difficulty VARCHAR(20) DEFAULT 'medium',  -- easy, medium, hard
    word_id INTEGER,  -- 关联单词ID(如果基于单词)
    unit_id INTEGER,  -- 关联单元ID
    tags VARCHAR(255),  -- 标签(逗号分隔)

    -- 创建信息
    created_by INTEGER NOT NULL,  -- 创建者ID(教师)
    source VARCHAR(20) DEFAULT 'manual',  -- manual(手动), ai(AI生成)
    is_active BOOLEAN DEFAULT TRUE,  -- 是否启用

    -- 统计
    use_count INTEGER DEFAULT 0,  -- 使用次数
    correct_count INTEGER DEFAULT 0,  -- 答对次数
    total_attempts INTEGER DEFAULT 0,  -- 总答题次数
    avg_time INTEGER DEFAULT 0,  -- 平均答题时间(秒)

    -- 时间戳
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE SET NULL,
    FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,

    CHECK(question_type IN ('choice', 'fill_blank', 'spelling', 'reading')),
    CHECK(difficulty IN ('easy', 'medium', 'hard')),
    CHECK(source IN ('manual', 'ai'))
);

-- 2. 题目选项表
CREATE TABLE IF NOT EXISTS competition_question_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id INTEGER NOT NULL,
    option_key VARCHAR(10) NOT NULL,  -- A, B, C, D
    option_text TEXT NOT NULL,
    is_correct BOOLEAN DEFAULT FALSE,
    display_order INTEGER DEFAULT 0,

    FOREIGN KEY (question_id) REFERENCES competition_questions(id) ON DELETE CASCADE
);

-- 3. 题目集合表
CREATE TABLE IF NOT EXISTS competition_question_sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    created_by INTEGER NOT NULL,
    total_questions INTEGER DEFAULT 0,
    is_public BOOLEAN DEFAULT FALSE,  -- 是否公开
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

-- 4. 题目集合关联表
CREATE TABLE IF NOT EXISTS question_set_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    set_id INTEGER NOT NULL,
    question_id INTEGER NOT NULL,
    display_order INTEGER DEFAULT 0,

    FOREIGN KEY (set_id) REFERENCES competition_question_sets(id) ON DELETE CASCADE,
    FOREIGN KEY (question_id) REFERENCES competition_questions(id) ON DELETE CASCADE,

    UNIQUE(set_id, question_id)
);

-- 5. 创建索引
CREATE INDEX IF NOT EXISTS idx_competition_questions_type ON competition_questions(question_type);
CREATE INDEX IF NOT EXISTS idx_competition_questions_difficulty ON competition_questions(difficulty);
CREATE INDEX IF NOT EXISTS idx_competition_questions_word ON competition_questions(word_id);
CREATE INDEX IF NOT EXISTS idx_competition_questions_unit ON competition_questions(unit_id);
CREATE INDEX IF NOT EXISTS idx_competition_questions_active ON competition_questions(is_active);
CREATE INDEX IF NOT EXISTS idx_competition_questions_created_by ON competition_questions(created_by);

CREATE INDEX IF NOT EXISTS idx_question_options_question ON competition_question_options(question_id);
CREATE INDEX IF NOT EXISTS idx_question_set_items_set ON question_set_items(set_id);
CREATE INDEX IF NOT EXISTS idx_question_set_items_question ON question_set_items(question_id);

-- 6. 更新answer_records表(如果字段不存在)
-- ALTER TABLE answer_records ADD COLUMN question_id INTEGER;
-- 注意: SQLite不支持ADD CONSTRAINT,需要在应用层处理外键关系

-- 7. 插入示例数据
INSERT INTO competition_questions (
    question_type, content, correct_answer, difficulty,
    created_by, source, answer_explanation
) VALUES
(
    'choice',
    'The word "happy" means ___',
    '{"answer": "A"}',
    'easy',
    2,  -- 假设教师ID为2
    'manual',
    '"happy" 表示快乐的、幸福的。'
);

-- 获取刚插入的题目ID
INSERT INTO competition_question_options (question_id, option_key, option_text, is_correct, display_order)
VALUES
    ((SELECT last_insert_rowid()), 'A', '快乐的', 1, 1),
    ((SELECT last_insert_rowid()), 'B', '悲伤的', 0, 2),
    ((SELECT last_insert_rowid()), 'C', '生气的', 0, 3),
    ((SELECT last_insert_rowid()), 'D', '害怕的', 0, 4);
