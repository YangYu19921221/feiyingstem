-- 防划水功能数据库迁移
-- 执行时间: 2026-01-08
-- 功能: 为学习会话表添加质量分和连击奖励字段

-- ========================================
-- 1. 学习会话表增加防划水字段
-- ========================================

-- 添加学习质量分数字段 (0-100分)
ALTER TABLE study_sessions ADD COLUMN quality_score INTEGER DEFAULT 50;

-- 添加连击奖励积分字段
ALTER TABLE study_sessions ADD COLUMN combo_bonus INTEGER DEFAULT 0;

-- ========================================
-- 2. 学习记录表增加首字母验证字段 (可选)
-- ========================================

-- 如果需要记录首字母验证结果,取消下面这行的注释
-- ALTER TABLE learning_records ADD COLUMN first_letter_correct BOOLEAN DEFAULT 1;

-- ========================================
-- 执行说明
-- ========================================
--
-- 方法1: 使用sqlite3命令行
-- sqlite3 backend/english_helper.db < backend/migrations/add_anti_cheat_fields.sql
--
-- 方法2: 在Python中执行
-- import sqlite3
-- conn = sqlite3.connect('english_helper.db')
-- with open('migrations/add_anti_cheat_fields.sql') as f:
--     conn.executescript(f.read())
-- conn.close()
--
-- 注意: SQLite的ALTER TABLE不支持IF NOT EXISTS,
-- 如果字段已存在会报错,可以忽略该错误
