-- 英语助手数据库设计 (SQLite)

-- ========================================
-- 1. 用户系统
-- ========================================

-- 用户表 (学生 + 老师)
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    nickname VARCHAR(50),
    role VARCHAR(10) CHECK(role IN ('student', 'teacher')) DEFAULT 'student',
    grade VARCHAR(20), -- 如: "小学3年级", "初中1年级"
    avatar_url VARCHAR(255),
    subscription_expires_at TIMESTAMP, -- 学生订阅到期时间
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP
);

-- ========================================
-- 2. 单词库管理
-- ========================================

-- 单词表 (老师录入)
CREATE TABLE words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word VARCHAR(100) UNIQUE NOT NULL, -- 英文单词
    phonetic VARCHAR(100), -- 音标 如: /ˈhæpi/
    difficulty INTEGER CHECK(difficulty BETWEEN 1 AND 5) DEFAULT 3, -- 难度1-5
    grade_level VARCHAR(20), -- 适合年级: "小学", "初中", "高中"
    audio_url VARCHAR(255), -- 发音音频链接
    image_url VARCHAR(255), -- 配图(可选,适合小学生)
    created_by INTEGER, -- 录入的老师ID
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- 单词释义表 (一词多义)
CREATE TABLE word_definitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word_id INTEGER NOT NULL,
    part_of_speech VARCHAR(20), -- 词性: n. v. adj. adv. 等
    meaning TEXT NOT NULL, -- 中文释义
    example_sentence TEXT, -- 例句(英文)
    example_translation TEXT, -- 例句翻译(中文)
    is_primary BOOLEAN DEFAULT 0, -- 是否主要释义
    FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE
);

-- 单词标签表 (方便分类)
CREATE TABLE word_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word_id INTEGER NOT NULL,
    tag VARCHAR(50) NOT NULL, -- 如: "动物", "食物", "日常用语", "考试重点"
    FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE
);

-- 单词本 (老师创建主题单词本)
CREATE TABLE word_books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(100) NOT NULL, -- 如: "小学三年级上册", "动物主题"
    description TEXT,
    grade_level VARCHAR(20),
    created_by INTEGER, -- 创建的老师ID
    is_public BOOLEAN DEFAULT 1, -- 是否公开
    cover_color VARCHAR(20) DEFAULT '#FF6B6B', -- 封面颜色
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- 单词本-单词关联表
CREATE TABLE book_words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER NOT NULL,
    word_id INTEGER NOT NULL,
    order_index INTEGER DEFAULT 0, -- 单词在单词本中的顺序
    FOREIGN KEY (book_id) REFERENCES word_books(id) ON DELETE CASCADE,
    FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE,
    UNIQUE(book_id, word_id)
);

-- ========================================
-- 3. 学习进度追踪
-- ========================================

-- 用户单词学习进度
CREATE TABLE user_word_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    word_id INTEGER NOT NULL,
    mastery_level INTEGER DEFAULT 0 CHECK(mastery_level BETWEEN 0 AND 100), -- 掌握度0-100
    review_count INTEGER DEFAULT 0, -- 复习次数
    correct_count INTEGER DEFAULT 0, -- 答对次数
    wrong_count INTEGER DEFAULT 0, -- 答错次数
    last_review_time TIMESTAMP, -- 最后复习时间
    next_review_time TIMESTAMP, -- 下次复习时间(间隔重复算法)
    is_mastered BOOLEAN DEFAULT 0, -- 是否已掌握
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE,
    UNIQUE(user_id, word_id)
);

-- 学习记录 (详细日志)
CREATE TABLE learning_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    word_id INTEGER NOT NULL,
    learning_mode VARCHAR(20) CHECK(learning_mode IN ('flashcard', 'choice', 'spelling', 'fill_blank')),
    is_correct BOOLEAN,
    time_spent INTEGER, -- 耗时(秒)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE
);

-- 学习会话 (每次学习的整体记录)
CREATE TABLE learning_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    book_id INTEGER,
    total_words INTEGER DEFAULT 0, -- 本次学习单词数
    correct_count INTEGER DEFAULT 0,
    wrong_count INTEGER DEFAULT 0,
    duration INTEGER, -- 总时长(秒)
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (book_id) REFERENCES word_books(id) ON DELETE SET NULL
);

-- ========================================
-- 4. 试卷系统
-- ========================================

-- 试卷表 (AI根据薄弱点生成)
CREATE TABLE exam_papers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL, -- 为哪个学生生成
    title VARCHAR(200) NOT NULL,
    description TEXT,
    total_score INTEGER DEFAULT 100,
    generated_by_ai BOOLEAN DEFAULT 0, -- 是否AI生成
    generation_strategy TEXT, -- AI生成策略(JSON格式,记录薄弱点)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 试卷题目表
CREATE TABLE exam_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    paper_id INTEGER NOT NULL,
    question_type VARCHAR(20) CHECK(question_type IN ('choice', 'fill_blank', 'spelling', 'translation')),
    word_id INTEGER, -- 关联的单词
    question_text TEXT NOT NULL, -- 题干
    options TEXT, -- 选项(JSON格式) 如: ["A. 快乐的", "B. 悲伤的"]
    correct_answer TEXT NOT NULL, -- 正确答案
    score INTEGER DEFAULT 5, -- 分值
    order_index INTEGER DEFAULT 0,
    FOREIGN KEY (paper_id) REFERENCES exam_papers(id) ON DELETE CASCADE,
    FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE SET NULL
);

-- 试卷答题记录
CREATE TABLE exam_submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    paper_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    score INTEGER, -- 得分
    total_score INTEGER,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (paper_id) REFERENCES exam_papers(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 答题详情
CREATE TABLE exam_answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    submission_id INTEGER NOT NULL,
    question_id INTEGER NOT NULL,
    user_answer TEXT, -- 用户答案
    is_correct BOOLEAN,
    time_spent INTEGER, -- 答题耗时(秒)
    FOREIGN KEY (submission_id) REFERENCES exam_submissions(id) ON DELETE CASCADE,
    FOREIGN KEY (question_id) REFERENCES exam_questions(id) ON DELETE CASCADE
);

-- ========================================
-- 5. 成就系统 (游戏化)
-- ========================================

-- 成就定义表
CREATE TABLE achievements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    icon VARCHAR(100), -- 图标名称或emoji
    condition_type VARCHAR(50), -- 如: "consecutive_days", "total_words", "accuracy_rate"
    condition_value INTEGER, -- 条件值
    reward_points INTEGER DEFAULT 10 -- 奖励积分
);

-- 用户成就
CREATE TABLE user_achievements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    achievement_id INTEGER NOT NULL,
    unlocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (achievement_id) REFERENCES achievements(id) ON DELETE CASCADE,
    UNIQUE(user_id, achievement_id)
);

-- 学习日历 (打卡记录)
CREATE TABLE study_calendar (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    study_date DATE NOT NULL,
    words_learned INTEGER DEFAULT 0,
    duration INTEGER DEFAULT 0, -- 学习时长(秒)
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, study_date)
);

-- ========================================
-- 6. AI缓存表 (减少API调用成本)
-- ========================================

-- AI生成内容缓存
CREATE TABLE ai_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cache_key VARCHAR(255) UNIQUE NOT NULL, -- 如: "example_sentence:word_id:123"
    content TEXT NOT NULL, -- AI生成的内容
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP -- 过期时间
);

-- ========================================
-- 索引优化
-- ========================================

CREATE INDEX idx_words_word ON words(word);
CREATE INDEX idx_words_difficulty ON words(difficulty);
CREATE INDEX idx_user_progress_user ON user_word_progress(user_id);
CREATE INDEX idx_user_progress_next_review ON user_word_progress(next_review_time);
CREATE INDEX idx_learning_records_user ON learning_records(user_id);
CREATE INDEX idx_learning_records_created ON learning_records(created_at);
CREATE INDEX idx_book_words_book ON book_words(book_id);
CREATE INDEX idx_exam_papers_user ON exam_papers(user_id);

-- ========================================
-- 9. 订阅兑换码
-- ========================================

CREATE TABLE redemption_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code VARCHAR(19) UNIQUE NOT NULL, -- XXXX-XXXX-XXXX-XXXX
    book_id INTEGER NOT NULL REFERENCES word_books(id), -- 绑定的单词本ID
    status VARCHAR(20) DEFAULT 'unused' CHECK(status IN ('unused', 'used', 'expired', 'disabled')),
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    code_expires_at TIMESTAMP NOT NULL, -- 兑换码本身过期时间
    used_by INTEGER REFERENCES users(id),
    used_at TIMESTAMP,
    batch_note VARCHAR(200)
);

CREATE INDEX idx_redemption_codes_code ON redemption_codes(code);
CREATE INDEX idx_redemption_codes_status ON redemption_codes(status);

-- ========================================
-- 初始数据 (示例成就)
-- ========================================

INSERT INTO achievements (name, description, icon, condition_type, condition_value, reward_points) VALUES
('初出茅庐', '学习第1个单词', '🌱', 'total_words', 1, 5),
('小有成就', '学习50个单词', '📚', 'total_words', 50, 20),
('单词大师', '学习200个单词', '🏆', 'total_words', 200, 50),
('每日一练', '连续打卡3天', '🔥', 'consecutive_days', 3, 15),
('坚持不懈', '连续打卡7天', '💪', 'consecutive_days', 7, 30),
('精准射手', '单次测试准确率达90%', '🎯', 'accuracy_rate', 90, 25),
('满分王者', '单次测试获得满分', '👑', 'perfect_score', 100, 50);

-- ========================================
-- 8. 宠物养成系统
-- ========================================

-- 用户宠物表
CREATE TABLE user_pets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    name VARCHAR(50) NOT NULL DEFAULT '小伙伴',
    species VARCHAR(20) NOT NULL DEFAULT 'cat',  -- cat/dog/rabbit/dragon
    level INTEGER DEFAULT 1,
    experience INTEGER DEFAULT 0,
    happiness INTEGER DEFAULT 80,       -- 0-100
    hunger INTEGER DEFAULT 80,          -- 0-100
    evolution_stage INTEGER DEFAULT 0,  -- 0=egg,1=baby,2=teen,3=adult,4=legendary
    food_balance INTEGER DEFAULT 10,    -- 宠物粮余额，新用户送10粮
    last_fed_at TIMESTAMP,
    last_interaction_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 宠物事件日志表
CREATE TABLE pet_event_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pet_id INTEGER NOT NULL,
    event_type VARCHAR(30) NOT NULL,  -- feed/evolve/adopt/happiness_decay
    detail TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (pet_id) REFERENCES user_pets(id) ON DELETE CASCADE
);

CREATE INDEX idx_user_pets_user_id ON user_pets(user_id);
CREATE INDEX idx_pet_event_logs_pet_id ON pet_event_logs(pet_id);
