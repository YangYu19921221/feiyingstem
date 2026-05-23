-- Migration: 011
-- Date: 2026-05-23
-- Description: 去掉 words.word 的 UNIQUE 约束(改为普通索引),
--              为「教师在单元里编辑单词时 fork 出独立副本」铺路。
-- 保留:difficulty CHECK 约束,idx_words_difficulty 索引。
-- 不保留:created_by FOREIGN KEY(模型层已经声明不使用)。
-- 回滚提示:回滚到 010 前需要先去重 (DELETE 重复 word) 否则恢复 UNIQUE 会失败。

BEGIN TRANSACTION;

CREATE TABLE words_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word VARCHAR(100) NOT NULL,
    phonetic VARCHAR(100),
    syllables VARCHAR(200),
    tts_text VARCHAR(200),
    difficulty INTEGER CHECK(difficulty BETWEEN 1 AND 5) DEFAULT 3,
    grade_level VARCHAR(20),
    audio_url VARCHAR(255),
    image_url VARCHAR(255),
    created_by INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO words_new (id, word, phonetic, syllables, tts_text, difficulty, grade_level, audio_url, image_url, created_by, created_at, updated_at)
SELECT id, word, phonetic, syllables, tts_text, difficulty, grade_level, audio_url, image_url, created_by, created_at, updated_at FROM words;

DROP TABLE words;
ALTER TABLE words_new RENAME TO words;

CREATE INDEX IF NOT EXISTS idx_words_word ON words(word);
CREATE INDEX IF NOT EXISTS idx_words_difficulty ON words(difficulty);

COMMIT;
