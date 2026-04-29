-- Migration: 010
-- Date: 2026-04-29
-- Description: Extend book_assignments with scope_type/unit_id/group_index (replacing old
--              single UNIQUE); add group_index to homework_assignments; add is_active/left_at
--              to class_students and a partial unique index per active student.

-- ========================================
-- 幂等性说明 (Idempotency Warning)
-- ========================================
-- 此脚本中的 ALTER TABLE ADD COLUMN 语句不是幂等的。
-- 在 SQLite 中，如果列已存在，ALTER TABLE ADD COLUMN 会报错。
-- 如果需要重新运行此迁移，请先恢复数据库备份，
-- 或手动检查并跳过已存在的列（参考 add_anti_cheat_fields.sql 说明）。
-- ========================================

BEGIN TRANSACTION;

-- 1. 重建 book_assignments（替换旧 UNIQUE(book_id,student_id) 约束）
CREATE TABLE IF NOT EXISTS book_assignments_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  teacher_id INTEGER NOT NULL,
  scope_type VARCHAR(10) NOT NULL DEFAULT 'book' CHECK(scope_type IN ('book','unit','group')),
  unit_id INTEGER,
  group_index INTEGER,
  assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  deadline DATETIME,
  is_completed BOOLEAN DEFAULT 0,
  FOREIGN KEY (book_id) REFERENCES word_books(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE SET NULL
);

INSERT INTO book_assignments_new
  (id, book_id, student_id, teacher_id, scope_type, unit_id, group_index,
   assigned_at, deadline, is_completed)
SELECT id, book_id, student_id, teacher_id,
       'book', NULL, NULL, assigned_at, deadline, is_completed
FROM book_assignments;

DROP TABLE book_assignments;
ALTER TABLE book_assignments_new RENAME TO book_assignments;

CREATE INDEX IF NOT EXISTS idx_book_assignments_student ON book_assignments(student_id);
CREATE INDEX IF NOT EXISTS idx_book_assignments_teacher ON book_assignments(teacher_id);
CREATE INDEX IF NOT EXISTS idx_book_assignments_book    ON book_assignments(book_id);

-- 部分唯一索引（每个 scope tier 一个），解决 NULL ≠ NULL 导致复合 UNIQUE 无法防重问题
CREATE UNIQUE INDEX IF NOT EXISTS uq_assign_book
  ON book_assignments(book_id, student_id) WHERE scope_type='book';
CREATE UNIQUE INDEX IF NOT EXISTS uq_assign_unit
  ON book_assignments(book_id, student_id, unit_id) WHERE scope_type='unit';
CREATE UNIQUE INDEX IF NOT EXISTS uq_assign_group
  ON book_assignments(book_id, student_id, unit_id, group_index) WHERE scope_type='group';

-- 2. homework_assignments: +group_index
ALTER TABLE homework_assignments ADD COLUMN group_index INTEGER;

-- 3. class_students: +is_active +left_at + 唯一索引
ALTER TABLE class_students ADD COLUMN is_active BOOLEAN DEFAULT 1 NOT NULL;
ALTER TABLE class_students ADD COLUMN left_at DATETIME;

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_student
  ON class_students(student_id) WHERE is_active = 1;

COMMIT;
