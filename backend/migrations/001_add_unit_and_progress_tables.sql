-- Migration: Add Unit, LearningProgress, and Reading Comprehension tables
-- Date: 2025-11-21
-- Description: 添加单元、学习进度、阅读理解相关表

-- ============================================
-- 1. 单元表 (Unit)
-- ============================================
CREATE TABLE IF NOT EXISTS units (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER NOT NULL,
    unit_number INTEGER NOT NULL,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    order_index INTEGER DEFAULT 0,
    word_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (book_id) REFERENCES word_books(id) ON DELETE CASCADE,
    UNIQUE(book_id, unit_number)
);

-- ============================================
-- 2. 单元-单词关联表 (UnitWord)
-- ============================================
CREATE TABLE IF NOT EXISTS unit_words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    unit_id INTEGER NOT NULL,
    word_id INTEGER NOT NULL,
    order_index INTEGER DEFAULT 0,
    FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE CASCADE,
    FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE,
    UNIQUE(unit_id, word_id)
);

CREATE INDEX IF NOT EXISTS idx_unit_words_unit_id ON unit_words(unit_id);
CREATE INDEX IF NOT EXISTS idx_unit_words_word_id ON unit_words(word_id);

-- ============================================
-- 3. 学习进度表 (LearningProgress)
-- ============================================
CREATE TABLE IF NOT EXISTS learning_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    book_id INTEGER NOT NULL,
    unit_id INTEGER,
    learning_mode VARCHAR(20) NOT NULL,
    current_word_id INTEGER,
    current_word_index INTEGER DEFAULT 0,
    completed_words INTEGER DEFAULT 0,
    total_words INTEGER DEFAULT 0,
    is_completed BOOLEAN DEFAULT 0,
    last_studied_at TIMESTAMP,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (book_id) REFERENCES word_books(id) ON DELETE CASCADE,
    FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE CASCADE,
    FOREIGN KEY (current_word_id) REFERENCES words(id),
    UNIQUE(user_id, unit_id, learning_mode)
);

CREATE INDEX IF NOT EXISTS idx_learning_progress_user_id ON learning_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_learning_progress_unit_id ON learning_progress(unit_id);

-- ============================================
-- 4. 学习会话表 (StudySession)
-- ============================================
CREATE TABLE IF NOT EXISTS study_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    book_id INTEGER NOT NULL,
    unit_id INTEGER,
    learning_mode VARCHAR(20),
    words_studied INTEGER DEFAULT 0,
    correct_count INTEGER DEFAULT 0,
    wrong_count INTEGER DEFAULT 0,
    time_spent INTEGER DEFAULT 0,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (book_id) REFERENCES word_books(id) ON DELETE CASCADE,
    FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_study_sessions_user_id ON study_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_study_sessions_unit_id ON study_sessions(unit_id);

-- ============================================
-- 5. 阅读文章表 (ReadingPassage)
-- ============================================
CREATE TABLE IF NOT EXISTS reading_passages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title VARCHAR(200) NOT NULL,
    content TEXT NOT NULL,
    content_translation TEXT,
    difficulty INTEGER DEFAULT 3,
    grade_level VARCHAR(20),
    word_count INTEGER,
    topic VARCHAR(100),
    tags TEXT,
    source VARCHAR(20) DEFAULT 'manual',
    ai_prompt TEXT,
    created_by INTEGER,
    is_public BOOLEAN DEFAULT 0,
    cover_image VARCHAR(255),
    view_count INTEGER DEFAULT 0,
    completion_count INTEGER DEFAULT 0,
    avg_score REAL DEFAULT 0.0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_reading_passages_created_by ON reading_passages(created_by);
CREATE INDEX IF NOT EXISTS idx_reading_passages_difficulty ON reading_passages(difficulty);
CREATE INDEX IF NOT EXISTS idx_reading_passages_topic ON reading_passages(topic);

-- ============================================
-- 6. 阅读词汇注释表 (ReadingVocabulary)
-- ============================================
CREATE TABLE IF NOT EXISTS reading_vocabulary (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    passage_id INTEGER NOT NULL,
    word VARCHAR(100) NOT NULL,
    meaning VARCHAR(255),
    phonetic VARCHAR(100),
    context TEXT,
    position INTEGER,
    is_key_vocabulary BOOLEAN DEFAULT 0,
    FOREIGN KEY (passage_id) REFERENCES reading_passages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reading_vocabulary_passage_id ON reading_vocabulary(passage_id);

-- ============================================
-- 7. 阅读题目表 (ReadingQuestion)
-- ============================================
CREATE TABLE IF NOT EXISTS reading_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    passage_id INTEGER NOT NULL,
    question_type VARCHAR(20) NOT NULL,
    question_text TEXT NOT NULL,
    order_index INTEGER DEFAULT 0,
    points INTEGER DEFAULT 1,
    source VARCHAR(20) DEFAULT 'manual',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (passage_id) REFERENCES reading_passages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reading_questions_passage_id ON reading_questions(passage_id);

-- ============================================
-- 8. 题目选项表 (QuestionOption)
-- ============================================
CREATE TABLE IF NOT EXISTS question_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id INTEGER NOT NULL,
    option_text TEXT NOT NULL,
    option_label VARCHAR(5),
    is_correct BOOLEAN DEFAULT 0,
    order_index INTEGER DEFAULT 0,
    FOREIGN KEY (question_id) REFERENCES reading_questions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_question_options_question_id ON question_options(question_id);

-- ============================================
-- 9. 题目答案表 (QuestionAnswer)
-- ============================================
CREATE TABLE IF NOT EXISTS question_answers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id INTEGER NOT NULL,
    answer_text TEXT NOT NULL,
    answer_explanation TEXT,
    is_primary BOOLEAN DEFAULT 1,
    accept_alternatives TEXT,
    FOREIGN KEY (question_id) REFERENCES reading_questions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_question_answers_question_id ON question_answers(question_id);

-- ============================================
-- 10. 阅读作业分配表 (ReadingAssignment)
-- ============================================
CREATE TABLE IF NOT EXISTS reading_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    passage_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    teacher_id INTEGER NOT NULL,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deadline TIMESTAMP,
    is_completed BOOLEAN DEFAULT 0,
    min_score INTEGER,
    max_attempts INTEGER DEFAULT 3,
    FOREIGN KEY (passage_id) REFERENCES reading_passages(id) ON DELETE CASCADE,
    FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reading_assignments_student_id ON reading_assignments(student_id);
CREATE INDEX IF NOT EXISTS idx_reading_assignments_passage_id ON reading_assignments(passage_id);

-- ============================================
-- 11. 阅读答题记录表 (ReadingAttempt)
-- ============================================
CREATE TABLE IF NOT EXISTS reading_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    passage_id INTEGER NOT NULL,
    assignment_id INTEGER,
    attempt_number INTEGER DEFAULT 1,
    score INTEGER DEFAULT 0,
    total_points INTEGER,
    percentage REAL,
    time_spent INTEGER,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    submitted_at TIMESTAMP,
    answers TEXT,
    is_passed BOOLEAN DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (passage_id) REFERENCES reading_passages(id) ON DELETE CASCADE,
    FOREIGN KEY (assignment_id) REFERENCES reading_assignments(id)
);

CREATE INDEX IF NOT EXISTS idx_reading_attempts_user_id ON reading_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_reading_attempts_passage_id ON reading_attempts(passage_id);

-- ============================================
-- 12. 阅读进度表 (ReadingProgress)
-- ============================================
CREATE TABLE IF NOT EXISTS reading_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    passage_id INTEGER NOT NULL,
    last_position INTEGER DEFAULT 0,
    progress_percentage REAL DEFAULT 0.0,
    highlights TEXT,
    notes TEXT,
    last_read_at TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (passage_id) REFERENCES reading_passages(id) ON DELETE CASCADE,
    UNIQUE(user_id, passage_id)
);

CREATE INDEX IF NOT EXISTS idx_reading_progress_user_id ON reading_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_reading_progress_passage_id ON reading_progress(passage_id);

-- ============================================
-- Migration Complete
-- ============================================
