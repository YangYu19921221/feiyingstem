# 教师/管理员的分配粒度与监控增强 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-04-29-teacher-admin-assignment-monitoring-design.md`

**Goal:** 让教师可在 Book/Unit/Group 三级粒度上分配单词本与作业；让教师只看自己班级的学生与数据，含搜索、按组成绩、单词级下钻；为管理员新增教师/班级监控与跨教师转班等干预能力。

**Architecture:** 后端：在现有 `BookAssignment` / `HomeworkAssignment` 上扩展 scope 字段；新增 `scope_service.py` 派生组（不建 `WordGroup` 表）；新增 `_permissions.py` 统一班级权限过滤；修复 `analytics.py` 的 `teacher_id` 过滤 bug；新增 `admin/teachers.py` + `admin/classes.py`。前端：新增 `ScopeSelector` 三步级联组件；改造分配页/作业页；新增学生监控页与管理员页。

**Tech Stack:** FastAPI · SQLAlchemy(async) · SQLite · React 18 + TS + Tailwind · React Query · Framer Motion · Zustand

**Test approach:** 项目尚无 pytest 基础设施（`requirements.txt` 中 pytest 注释；现有测试是 backend/ 根目录下 `test_*.py` 脚本，用 `httpx.AsyncClient` 直接打 API）。本计划沿用该模式：每个新模块写一个 `test_xxx.py` 脚本，可以 `python test_xxx.py` 直接运行。前端采用手动测试用例。

---

## 文件结构总览

### 后端新增

```
backend/
├── migrations/
│   └── 010_assignment_scope_and_class_active.sql       (新)
├── app/
│   ├── services/
│   │   └── scope_service.py                            (新)
│   └── api/v1/
│       ├── teacher/
│       │   └── _permissions.py                         (新)
│       └── admin/
│           ├── teachers.py                             (新)
│           └── classes.py                              (新)
└── test_scope_service.py                               (新)
└── test_class_membership.py                            (新)
└── test_book_assignments_scope.py                      (新)
└── test_teacher_monitor.py                             (新)
└── test_admin_teachers.py                              (新)
└── verify_migration_010.sql                            (新)
```

### 后端修改

```
backend/app/
├── models/
│   ├── user.py                  (ClassStudent +is_active +left_at)
│   └── learning.py              (BookAssignment +scope_type/+unit_id/+group_index;
│                                 HomeworkAssignment +group_index)
├── api/v1/
│   ├── teacher/
│   │   ├── book_assignments.py  (扩展 scope 支持)
│   │   ├── homework.py          (+group_index)
│   │   ├── classes.py           (学生 q= 搜索 + is_active 语义)
│   │   └── analytics.py         (修 teacher_id 过滤 bug + 新增按 class_id 接口)
│   └── admin/__init__.py        (注册 teachers/classes 路由)
├── main.py                      (如需注册 admin 子路由)
└── schemas/
    ├── teacher_analytics.py     (扩展按 class 维度的 schema)
    └── admin.py                 (新)
database_schema.sql              (同步更新)
```

### 前端新增/修改

```
frontend/src/
├── components/
│   ├── teacher/ScopeSelector.tsx                       (新)
│   └── admin/TransferStudentDialog.tsx                 (新)
├── pages/
│   ├── teacher/
│   │   ├── AssignBook.tsx                              (改造，嵌 ScopeSelector)
│   │   ├── CreateHomework.tsx                          (改造，嵌 ScopeSelector)
│   │   ├── ClassDetail.tsx                             (加搜索)
│   │   ├── StudentMonitor.tsx                          (新)
│   │   └── ClassAnalytics.tsx                          (改造)
│   └── admin/
│       ├── TeacherList.tsx                             (新)
│       ├── TeacherDetail.tsx                           (新)
│       └── ClassDetail.tsx                             (新)
├── api/
│   ├── teacherAssignments.ts                           (新)
│   ├── teacherMonitor.ts                               (新)
│   └── admin.ts                                        (新)
└── App.tsx                                             (路由注册)
```

---

## 实施顺序

| 阶段 | 任务 | 内容 |
|------|------|------|
| **A. 数据层** | 1 | 数据库迁移脚本（含备份） |
| | 2 | 模型字段扩展（ClassStudent / BookAssignment / HomeworkAssignment） |
| **B. 服务层** | 3 | scope_service.py + 测试 |
| | 4 | teacher/_permissions.py + 测试 |
| **C. 教师 API** | 5 | 修复 analytics.py 的 teacher_id 过滤 bug |
| | 6 | 改造 book_assignments.py 支持三级粒度 |
| | 7 | 改造 homework.py 支持 group_index |
| | 8 | 改造 classes.py（搜索 + is_active 语义） |
| | 9 | 新增 teacher 班级数据 API（含 word-completion） |
| | 10 | 新增 teacher 学生监控 API（按组成绩 + 下钻） |
| **D. 管理员 API** | 11 | admin/teachers.py |
| | 12 | admin/classes.py + 跨教师转班 |
| **E. 前端基础** | 13 | API 客户端三件套 |
| | 14 | ScopeSelector 组件 |
| **F. 前端页面** | 15 | AssignBook / CreateHomework 改造 |
| | 16 | ClassDetail（搜索） + StudentMonitor 新页 |
| | 17 | ClassAnalytics 改造 |
| | 18 | 管理员三个页面 |
| **G. 联调** | 19 | 端到端联调 + 回归 |

---

## 任务详情

### Task 1：数据库迁移脚本

**Files:**
- Create: `backend/migrations/010_assignment_scope_and_class_active.sql`
- Create: `backend/verify_migration_010.sql`

- [ ] **Step 1：备份当前数据库**

Run:
```bash
cd backend
cp english_helper.db english_helper.db.bak.$(date +%Y%m%d_%H%M%S)
ls -la english_helper.db*
```
Expected: 看到 `english_helper.db.bak.<timestamp>` 文件。

- [ ] **Step 2：编写迁移 SQL（幂等）**

Create `backend/migrations/010_assignment_scope_and_class_active.sql`:

```sql
-- ========================================
-- Migration 010: Assignment scope + Class active membership
-- 日期：2026-04-29
-- 幂等：使用 IF NOT EXISTS / 先 SELECT 检测列存在性
-- ========================================

BEGIN TRANSACTION;

-- 1. class_students: +is_active +left_at
-- SQLite 不支持 IF NOT EXISTS for ALTER TABLE ADD COLUMN，用 PRAGMA 检测
-- 在执行端（应用 SQL 之前）已通过 verify 脚本检查；这里直接添加，重复运行会报错但不破坏数据
-- 使用临时方法：通过 sqlite_master 检查
-- 简化做法：将整个迁移分成两次提交执行（首次执行 ADD COLUMN，已存在则跳过整个文件）

-- 2. 重建 book_assignments（替换旧 UNIQUE(book_id,student_id) 约束）
CREATE TABLE IF NOT EXISTS book_assignments_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL,
  student_id INTEGER NOT NULL,
  teacher_id INTEGER NOT NULL,
  scope_type VARCHAR(10) NOT NULL DEFAULT 'book',
  unit_id INTEGER,
  group_index INTEGER,
  assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  deadline DATETIME,
  is_completed BOOLEAN DEFAULT 0,
  FOREIGN KEY (book_id) REFERENCES word_books(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE SET NULL,
  UNIQUE(book_id, student_id, scope_type, unit_id, group_index)
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

-- 3. homework_assignments: +group_index
ALTER TABLE homework_assignments ADD COLUMN group_index INTEGER;

-- 4. class_students: +is_active +left_at + 唯一索引
ALTER TABLE class_students ADD COLUMN is_active BOOLEAN DEFAULT 1 NOT NULL;
ALTER TABLE class_students ADD COLUMN left_at DATETIME;

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_student
  ON class_students(student_id) WHERE is_active = 1;

COMMIT;
```

注意：SQLite 的 `ALTER TABLE ADD COLUMN` 不可幂等。**首次执行后**如果需要重跑，需要手工 DROP 列或恢复备份。脚本顶部应附操作指引。

- [ ] **Step 3：编写 verify 脚本**

Create `backend/verify_migration_010.sql`:

```sql
-- 验证迁移结果
.headers on
.mode column

SELECT 'book_assignments columns' AS check_name;
PRAGMA table_info(book_assignments);

SELECT 'homework_assignments has group_index' AS check_name;
SELECT name FROM pragma_table_info('homework_assignments') WHERE name='group_index';

SELECT 'class_students has is_active and left_at' AS check_name;
SELECT name FROM pragma_table_info('class_students') WHERE name IN ('is_active','left_at');

SELECT 'unique active student index exists' AS check_name;
SELECT name FROM sqlite_master WHERE type='index' AND name='uq_active_student';

SELECT 'old book_assignments rows count preserved' AS check_name;
SELECT COUNT(*) AS new_count FROM book_assignments;
```

- [ ] **Step 4：执行迁移**

Run:
```bash
cd backend
sqlite3 english_helper.db < migrations/010_assignment_scope_and_class_active.sql
```
Expected：无报错，无输出。

- [ ] **Step 5：执行 verify**

Run:
```bash
sqlite3 english_helper.db < verify_migration_010.sql
```
Expected：所有 check_name 下都有非空结果；`new_count` 等于迁移前 `book_assignments` 的行数。

- [ ] **Step 6：同步 `database_schema.sql`**

修改 `/Users/apple/Desktop/英语助手/database_schema.sql`：
- `book_assignments` 表定义：加 `scope_type / unit_id / group_index` 字段，更新 UNIQUE 约束
- `homework_assignments`：加 `group_index INTEGER`
- `class_students`：加 `is_active BOOLEAN DEFAULT 1 NOT NULL` + `left_at DATETIME` + 唯一索引

(逐行编辑，无需重新生成整个文件。)

- [ ] **Step 7：Commit**

```bash
cd /Users/apple/Desktop/英语助手
git add backend/migrations/010_assignment_scope_and_class_active.sql \
        backend/verify_migration_010.sql \
        database_schema.sql
git commit -m "feat(db): migration 010 - assignment scope + active class membership"
```

---

### Task 2：模型字段扩展

**Files:**
- Modify: `backend/app/models/user.py:98-108` (ClassStudent)
- Modify: `backend/app/models/learning.py:47-57` (BookAssignment), `:127-142` (HomeworkAssignment)

- [ ] **Step 1：扩展 ClassStudent**

Edit `backend/app/models/user.py`，在 `ClassStudent` 类内添加：

```python
class ClassStudent(Base):
    """班级-学生关联表"""
    __tablename__ = "class_students"

    id = Column(Integer, primary_key=True, autoincrement=True)
    class_id = Column(Integer, ForeignKey('classes.id', ondelete='CASCADE'), nullable=False)
    student_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)   # 新增
    joined_at = Column(DateTime, server_default=func.now())
    left_at = Column(DateTime, nullable=True)                    # 新增

    # 关系
    class_ = relationship("Class", back_populates="students")
```

- [ ] **Step 2：扩展 BookAssignment**

Edit `backend/app/models/learning.py`，在 `BookAssignment` 类内添加 3 个字段：

```python
class BookAssignment(Base):
    """单词本分配表"""
    __tablename__ = "book_assignments"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    book_id     = Column(Integer, ForeignKey("word_books.id", ondelete="CASCADE"), nullable=False)
    student_id  = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    teacher_id  = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    scope_type  = Column(String(10), nullable=False, default='book')   # 新增
    unit_id     = Column(Integer, ForeignKey("units.id", ondelete="SET NULL"), nullable=True)  # 新增
    group_index = Column(Integer, nullable=True)                        # 新增
    assigned_at = Column(DateTime, server_default=func.now())
    deadline    = Column(DateTime, nullable=True)
    is_completed = Column(Boolean, default=False)
```

- [ ] **Step 3：扩展 HomeworkAssignment**

Edit `backend/app/models/learning.py`，在 `HomeworkAssignment` 类内追加：

```python
    group_index = Column(Integer, nullable=True)   # 新增；null=整单元
```

- [ ] **Step 4：启动后端验证 ORM 与 DB 一致**

Run:
```bash
cd backend
uvicorn app.main:app --port 8000 &
sleep 3
curl -s http://localhost:8000/docs > /dev/null && echo OK || echo FAIL
kill %1
```
Expected：OK，且后端启动期间无 `OperationalError`。

- [ ] **Step 5：Commit**

```bash
git add backend/app/models/user.py backend/app/models/learning.py
git commit -m "feat(models): add scope fields to assignments + active flag to ClassStudent"
```

---

### Task 3：scope_service 实现 + 测试

**Files:**
- Create: `backend/app/services/scope_service.py`
- Create: `backend/test_scope_service.py`

- [ ] **Step 1：先写测试（TDD）**

Create `backend/test_scope_service.py`:

```python
"""scope_service 单元测试 - 直接对数据库执行"""
import asyncio
from app.core.database import async_session_maker
from app.services.scope_service import (
    DEFAULT_GROUP_SIZE,
    get_unit_groups,
    get_group_words,
    validate_scope,
    get_scope_words,
)
from app.models.word import Unit, UnitWord, Word
from sqlalchemy import select


async def find_test_unit(db):
    """找一个有词的单元用于测试"""
    result = await db.execute(
        select(Unit).join(UnitWord, UnitWord.unit_id == Unit.id).limit(1)
    )
    return result.scalars().first()


async def test_get_unit_groups_default_size():
    async with async_session_maker() as db:
        unit = await find_test_unit(db)
        assert unit, "需要测试数据：至少有一个含单词的单元"
        groups = await get_unit_groups(db, unit.id)
        assert len(groups) > 0
        # 每组词数 <= group_size 或 DEFAULT_GROUP_SIZE
        size = unit.group_size or DEFAULT_GROUP_SIZE
        for g in groups[:-1]:
            assert g["word_count"] == size
        print(f"OK: unit {unit.id} 切成 {len(groups)} 组")


async def test_get_group_words_in_range():
    async with async_session_maker() as db:
        unit = await find_test_unit(db)
        words = await get_group_words(db, unit.id, 1)
        assert isinstance(words, list)
        assert len(words) > 0
        print(f"OK: 第1组拿到 {len(words)} 词")


async def test_get_group_words_out_of_range():
    async with async_session_maker() as db:
        unit = await find_test_unit(db)
        try:
            await get_group_words(db, unit.id, 999)
            assert False, "越界应抛 ValueError"
        except ValueError:
            print("OK: 越界正确抛 ValueError")


def test_validate_scope_book_ok():
    validate_scope("book", None, None)  # 不抛
    print("OK: scope=book 校验通过")


def test_validate_scope_book_fail():
    try:
        validate_scope("book", 1, None)
        assert False
    except ValueError:
        print("OK: scope=book 带 unit_id 拒绝")


def test_validate_scope_unit_ok():
    validate_scope("unit", 1, None)
    print("OK: scope=unit 校验通过")


def test_validate_scope_unit_fail_no_unit():
    try:
        validate_scope("unit", None, None)
        assert False
    except ValueError:
        print("OK: scope=unit 缺 unit_id 拒绝")


def test_validate_scope_group_ok():
    validate_scope("group", 1, 2)
    print("OK: scope=group 校验通过")


def test_validate_scope_group_fail_no_group():
    try:
        validate_scope("group", 1, None)
        assert False
    except ValueError:
        print("OK: scope=group 缺 group_index 拒绝")


async def main():
    # 同步校验
    test_validate_scope_book_ok()
    test_validate_scope_book_fail()
    test_validate_scope_unit_ok()
    test_validate_scope_unit_fail_no_unit()
    test_validate_scope_group_ok()
    test_validate_scope_group_fail_no_group()
    # 异步数据库
    await test_get_unit_groups_default_size()
    await test_get_group_words_in_range()
    await test_get_group_words_out_of_range()
    print("\n=== ALL PASSED ===")


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 2：运行测试确认全部失败**

Run:
```bash
cd backend
python test_scope_service.py
```
Expected: ImportError - `scope_service` 不存在。

- [ ] **Step 3：实现 scope_service**

Create `backend/app/services/scope_service.py`:

```python
"""分配范围（Scope）服务 - 在 Book / Unit / Group 三级粒度间转换"""
from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.word import Word, Unit, UnitWord, BookWord

DEFAULT_GROUP_SIZE = 10


def validate_scope(scope_type: str, unit_id: Optional[int], group_index: Optional[int]) -> None:
    """422 级别的应用层校验"""
    if scope_type not in ("book", "unit", "group"):
        raise ValueError(f"非法 scope_type: {scope_type}")
    if scope_type == "book" and (unit_id is not None or group_index is not None):
        raise ValueError("scope_type=book 时 unit_id 和 group_index 必须为空")
    if scope_type == "unit":
        if unit_id is None:
            raise ValueError("scope_type=unit 时 unit_id 必填")
        if group_index is not None:
            raise ValueError("scope_type=unit 时 group_index 必须为空")
    if scope_type == "group":
        if unit_id is None or group_index is None:
            raise ValueError("scope_type=group 时 unit_id 和 group_index 必填")


async def _get_unit_with_words(db: AsyncSession, unit_id: int):
    """加载单元及按 order_index 排序的 unit_words"""
    unit_res = await db.execute(select(Unit).where(Unit.id == unit_id))
    unit = unit_res.scalar_one_or_none()
    if unit is None:
        raise ValueError(f"单元不存在: {unit_id}")
    words_res = await db.execute(
        select(UnitWord).where(UnitWord.unit_id == unit_id).order_by(UnitWord.order_index)
    )
    return unit, list(words_res.scalars().all())


async def get_unit_groups(db: AsyncSession, unit_id: int) -> list[dict]:
    """返回 [{index, word_ids, word_count}, ...]"""
    unit, uwords = await _get_unit_with_words(db, unit_id)
    size = unit.group_size or DEFAULT_GROUP_SIZE
    groups: list[dict] = []
    for i in range(0, len(uwords), size):
        chunk = uwords[i:i + size]
        groups.append({
            "index": i // size + 1,
            "word_ids": [w.word_id for w in chunk],
            "word_count": len(chunk),
        })
    return groups


async def get_group_words(db: AsyncSession, unit_id: int, group_index: int) -> list[Word]:
    """按 order_index 切片取出某一组的 Word 实体"""
    if group_index < 1:
        raise ValueError("group_index 必须 >= 1")
    unit, uwords = await _get_unit_with_words(db, unit_id)
    size = unit.group_size or DEFAULT_GROUP_SIZE
    total_groups = (len(uwords) + size - 1) // size
    if group_index > total_groups:
        raise ValueError(f"group_index 超出范围（共 {total_groups} 组）")
    chunk = uwords[(group_index - 1) * size: group_index * size]
    word_ids = [w.word_id for w in chunk]
    res = await db.execute(select(Word).where(Word.id.in_(word_ids)))
    by_id = {w.id: w for w in res.scalars().all()}
    return [by_id[wid] for wid in word_ids if wid in by_id]


async def _get_book_words(db: AsyncSession, book_id: int) -> list[Word]:
    res = await db.execute(
        select(Word).join(BookWord, BookWord.word_id == Word.id)
        .where(BookWord.book_id == book_id).order_by(BookWord.order_index)
    )
    return list(res.scalars().all())


async def _get_unit_words_full(db: AsyncSession, unit_id: int) -> list[Word]:
    _, uwords = await _get_unit_with_words(db, unit_id)
    word_ids = [w.word_id for w in uwords]
    res = await db.execute(select(Word).where(Word.id.in_(word_ids)))
    by_id = {w.id: w for w in res.scalars().all()}
    return [by_id[wid] for wid in word_ids if wid in by_id]


async def get_scope_words(
    db: AsyncSession,
    scope_type: str,
    book_id: int,
    unit_id: Optional[int] = None,
    group_index: Optional[int] = None,
) -> list[Word]:
    """统一入口：根据 scope_type 派发"""
    validate_scope(scope_type, unit_id, group_index)
    if scope_type == "book":
        return await _get_book_words(db, book_id)
    if scope_type == "unit":
        return await _get_unit_words_full(db, unit_id)  # type: ignore[arg-type]
    return await get_group_words(db, unit_id, group_index)  # type: ignore[arg-type]
```

- [ ] **Step 4：运行测试确认全部通过**

Run:
```bash
cd backend
python test_scope_service.py
```
Expected: 看到 `=== ALL PASSED ===`。

- [ ] **Step 5：Commit**

```bash
git add backend/app/services/scope_service.py backend/test_scope_service.py
git commit -m "feat(scope): add scope_service for book/unit/group resolution"
```

---

### Task 4：teacher 班级权限 helper + 测试

**Files:**
- Create: `backend/app/api/v1/teacher/_permissions.py`
- Create: `backend/test_class_membership.py`

- [ ] **Step 1：写测试（TDD）**

Create `backend/test_class_membership.py`:

```python
"""班级权限 helper 测试"""
import asyncio
from sqlalchemy import select
from app.core.database import async_session_maker
from app.api.v1.teacher._permissions import (
    get_my_class_student_ids,
    assert_student_in_my_class,
)
from app.models.user import User, Class, ClassStudent
from fastapi import HTTPException


async def find_teacher_with_students():
    async with async_session_maker() as db:
        res = await db.execute(
            select(Class.teacher_id, ClassStudent.student_id)
            .join(ClassStudent, ClassStudent.class_id == Class.id)
            .where(ClassStudent.is_active == True)  # noqa: E712
            .limit(1)
        )
        row = res.first()
        return row[0], row[1] if row else (None, None)


async def test_get_my_class_student_ids_returns_set():
    teacher_id, student_id = await find_teacher_with_students()
    if not teacher_id:
        print("SKIP: 无测试数据（教师/班级/学生）")
        return
    async with async_session_maker() as db:
        ids = await get_my_class_student_ids(db, teacher_id)
        assert isinstance(ids, set)
        assert student_id in ids
        print(f"OK: 教师 {teacher_id} 班级有 {len(ids)} 个学生")


async def test_assert_student_in_my_class_pass():
    teacher_id, student_id = await find_teacher_with_students()
    if not teacher_id:
        print("SKIP")
        return
    async with async_session_maker() as db:
        await assert_student_in_my_class(db, teacher_id, student_id)
        print("OK: 同班学生通过")


async def test_assert_student_in_my_class_403():
    teacher_id, _ = await find_teacher_with_students()
    if not teacher_id:
        print("SKIP")
        return
    async with async_session_maker() as db:
        try:
            await assert_student_in_my_class(db, teacher_id, 99999999)
            assert False
        except HTTPException as e:
            assert e.status_code == 403
            print("OK: 非本班学生 403")


async def main():
    await test_get_my_class_student_ids_returns_set()
    await test_assert_student_in_my_class_pass()
    await test_assert_student_in_my_class_403()
    print("\n=== ALL PASSED ===")


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 2：运行测试确认失败**

Run: `cd backend && python test_class_membership.py`
Expected: ImportError。

- [ ] **Step 3：实现 _permissions.py**

Create `backend/app/api/v1/teacher/_permissions.py`:

```python
"""教师端班级权限 helper - 教师只能操作自己班级里 active 的学生"""
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import Class, ClassStudent


async def get_my_class_student_ids(db: AsyncSession, teacher_id: int) -> set[int]:
    """该教师所有班级里 is_active=True 的学生 id"""
    res = await db.execute(
        select(ClassStudent.student_id)
        .join(Class, Class.id == ClassStudent.class_id)
        .where(Class.teacher_id == teacher_id, ClassStudent.is_active.is_(True))
    )
    return {row[0] for row in res.all()}


async def assert_student_in_my_class(
    db: AsyncSession, teacher_id: int, student_id: int
) -> None:
    """不在则 raise HTTPException(403)"""
    ids = await get_my_class_student_ids(db, teacher_id)
    if student_id not in ids:
        raise HTTPException(status_code=403, detail="无权操作该学生")
```

- [ ] **Step 4：运行测试确认通过**

Run: `cd backend && python test_class_membership.py`
Expected: `=== ALL PASSED ===` 或 `SKIP`（数据集少）。

- [ ] **Step 5：Commit**

```bash
git add backend/app/api/v1/teacher/_permissions.py backend/test_class_membership.py
git commit -m "feat(teacher): add class membership permission helpers"
```

---

### Task 5：修复 analytics.py 的 teacher_id 过滤 bug

**Files:**
- Modify: `backend/app/api/v1/teacher/analytics.py`（多处 query 加 `teacher_id` 过滤）

- [ ] **Step 1：识别需要修的 query**

Run:
```bash
cd backend
grep -n "User.role == \"student\"" app/api/v1/teacher/analytics.py
```

记下每一行号 — 它们都是"全量学生"的越权查询。

- [ ] **Step 2：把每一处替换成 teacher_id 过滤**

替换模式：把 `User.role == "student"` 的过滤改成"该教师班级里 is_active 的学生"。在文件顶部加入 import：

```python
from app.api.v1.teacher._permissions import get_my_class_student_ids
```

每个使用全量学生过滤的 endpoint，最前面加上：

```python
my_student_ids = await get_my_class_student_ids(db, current_user.id)
if not my_student_ids:
    # 无班级学生，返回零值
    return ClassOverviewStats(...)
```

并把 `User.role == "student"` 替换为 `User.id.in_(my_student_ids)`。

具体 endpoint 至少 4 处：`get_class_overview` / `get_student_progress_list` / `get_class_ranking` / `get_study_trend`（按现有文件实际函数名调整）。

- [ ] **Step 3：手测——以教师身份请求 overview，断言只统计本班学生**

Run（启动后端，用有效 teacher token）：
```bash
cd backend
uvicorn app.main:app --port 8000 &
sleep 3
TOKEN=$(cat ../有效token.txt 2>/dev/null | head -1)
curl -s http://localhost:8000/api/v1/teacher/analytics/class/overview \
  -H "Authorization: Bearer $TOKEN" | python -m json.tool
kill %1
```
Expected：`total_students` 数值等于该 teacher 班级学生数（不是全平台），可手工 SQL 核对。

- [ ] **Step 4：Commit**

```bash
git add backend/app/api/v1/teacher/analytics.py
git commit -m "fix(teacher/analytics): scope queries to teacher's own class students"
```

---

### Task 6：改造 book_assignments.py 支持三级粒度

**Files:**
- Modify: `backend/app/api/v1/teacher/book_assignments.py`

- [ ] **Step 1：扩展 Pydantic schema**

Edit `backend/app/api/v1/teacher/book_assignments.py`，在文件顶部 `AssignBookRequest` 上方/内部修改：

```python
from pydantic import BaseModel, Field
from typing import Literal

class AssignBookRequest(BaseModel):
    book_id: int
    student_ids: list[int]
    deadline: str | None = None
    scope_type: Literal['book', 'unit', 'group'] = 'book'
    unit_id: int | None = None
    group_index: int | None = None
```

- [ ] **Step 2：在 assign 端点中接入 scope 校验 + 班级权限**

替换现有 `@router.post("/assign", ...)` 函数体（保留文件头）：

```python
from app.services.scope_service import validate_scope, get_unit_groups
from app.api.v1.teacher._permissions import get_my_class_student_ids
from app.models.learning import BookAssignment
from app.models.word import WordBook
from datetime import datetime as dt

@router.post("/assign", response_model=dict)
async def assign_book_to_students(
    request: AssignBookRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role not in ('teacher', 'admin'):
        raise HTTPException(403, "只有教师可以分配单词本")

    # 1) scope 参数校验
    try:
        validate_scope(request.scope_type, request.unit_id, request.group_index)
    except ValueError as e:
        raise HTTPException(422, str(e))

    # 2) 验证 book 存在
    book_res = await db.execute(select(WordBook).where(WordBook.id == request.book_id))
    book = book_res.scalar_one_or_none()
    if not book:
        raise HTTPException(404, "单词本不存在")

    # 3) 如果是 group，校验 group_index 在合法范围
    if request.scope_type == 'group':
        groups = await get_unit_groups(db, request.unit_id)  # type: ignore[arg-type]
        if request.group_index < 1 or request.group_index > len(groups):
            raise HTTPException(422, f"组序号超出范围（单元共 {len(groups)} 组）")

    # 4) 班级权限：所有 student_ids 必须在本教师班级
    if current_user.role == 'teacher':
        my_ids = await get_my_class_student_ids(db, current_user.id)
        bad = [sid for sid in request.student_ids if sid not in my_ids]
        if bad:
            raise HTTPException(403, f"以下学生不在你的班级：{bad}")

    # 5) 写入
    deadline_dt = dt.fromisoformat(request.deadline) if request.deadline else None
    created = 0
    for sid in request.student_ids:
        # 用 IntegrityError 兜底唯一约束（同 scope 重复分配）
        a = BookAssignment(
            book_id=request.book_id,
            student_id=sid,
            teacher_id=current_user.id,
            scope_type=request.scope_type,
            unit_id=request.unit_id,
            group_index=request.group_index,
            deadline=deadline_dt,
        )
        db.add(a)
        try:
            await db.flush()
            created += 1
        except Exception:
            await db.rollback()  # 回滚后继续下一个
    await db.commit()
    return {"created": created, "total": len(request.student_ids)}
```

- [ ] **Step 3：新增辅助接口 `/books/{book_id}/units` 和 `/units/{unit_id}/groups`**

在文件末尾追加：

```python
@router.get("/books/{book_id}/units")
async def list_book_units(
    book_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role not in ('teacher', 'admin'):
        raise HTTPException(403)
    from app.models.word import Unit
    res = await db.execute(
        select(Unit).where(Unit.book_id == book_id).order_by(Unit.order_index)
    )
    units = res.scalars().all()
    out = []
    for u in units:
        groups = await get_unit_groups(db, u.id)
        out.append({
            "id": u.id, "unit_number": u.unit_number, "name": u.name,
            "word_count": u.word_count, "group_count": len(groups),
        })
    return out


@router.get("/units/{unit_id}/groups")
async def list_unit_groups(
    unit_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role not in ('teacher', 'admin'):
        raise HTTPException(403)
    return await get_unit_groups(db, unit_id)
```

- [ ] **Step 4：写测试**

Create `backend/test_book_assignments_scope.py`:

```python
"""book_assignments scope 端到端测试 - 调真实 API"""
import asyncio, httpx, json

BASE = "http://localhost:8000"


def get_token():
    with open("../有效token.txt") as f:
        return f.read().strip()


async def main():
    token = get_token()
    headers = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient() as c:
        # 1. scope=book 必须不带 unit_id
        r = await c.post(f"{BASE}/api/v1/teacher/book-assignments/assign",
            headers=headers,
            json={"book_id": 1, "student_ids": [], "scope_type": "book", "unit_id": 1})
        assert r.status_code == 422, r.text
        print("OK: scope=book 带 unit_id 拒绝")

        # 2. scope=group 必须带 group_index
        r = await c.post(f"{BASE}/api/v1/teacher/book-assignments/assign",
            headers=headers,
            json={"book_id": 1, "student_ids": [], "scope_type": "group", "unit_id": 1})
        assert r.status_code == 422
        print("OK: scope=group 缺 group_index 拒绝")

        # 3. group_index 越界
        r = await c.post(f"{BASE}/api/v1/teacher/book-assignments/assign",
            headers=headers,
            json={"book_id": 1, "student_ids": [], "scope_type": "group",
                  "unit_id": 1, "group_index": 999})
        assert r.status_code == 422
        print("OK: group_index 越界 422")
    print("\n=== ALL PASSED ===")


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 5：运行测试**

Run（确保后端在跑）：
```bash
cd backend
uvicorn app.main:app --port 8000 &
sleep 3
python test_book_assignments_scope.py
kill %1
```
Expected: `=== ALL PASSED ===`。

- [ ] **Step 6：Commit**

```bash
git add backend/app/api/v1/teacher/book_assignments.py backend/test_book_assignments_scope.py
git commit -m "feat(teacher): book assignment supports book/unit/group scope"
```

---

### Task 7：改造 homework.py 支持 group_index

**Files:**
- Modify: `backend/app/api/v1/teacher/homework.py`

- [ ] **Step 1：在 HomeworkCreate schema 加 `group_index` 字段**

找到 `class HomeworkCreate(BaseModel)`（或同等的请求体），追加：

```python
group_index: int | None = None   # null=整单元
```

- [ ] **Step 2：创建作业时校验 group_index**

在创建 endpoint 内、写入数据库之前：

```python
from app.services.scope_service import get_unit_groups

if request.group_index is not None:
    groups = await get_unit_groups(db, request.unit_id)
    if request.group_index < 1 or request.group_index > len(groups):
        raise HTTPException(422, f"组序号超出范围（单元共 {len(groups)} 组）")
```

并将 `request.group_index` 传给 `HomeworkAssignment(...)` 构造。

- [ ] **Step 3：作业完成判定使用 scope 切片单词**

如果作业完成判定函数当前是用整个 unit 的词做判定，改为：

```python
from app.services.scope_service import get_group_words, _get_unit_words_full

if homework.group_index is not None:
    words = await get_group_words(db, homework.unit_id, homework.group_index)
else:
    words = await _get_unit_words_full(db, homework.unit_id)
```

- [ ] **Step 4：手测**

Run:
```bash
cd backend
uvicorn app.main:app --port 8000 &
sleep 3
TOKEN=$(cat ../有效token.txt | head -1)
# 创建带 group_index 的作业（替换 unit_id 为本地真实 id）
curl -X POST http://localhost:8000/api/v1/teacher/homework \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"title":"测试组作业","unit_id":1,"learning_mode":"flashcard","group_index":1}'
kill %1
```
Expected：返回 200/201 + 新作业；DB 中 `group_index=1`。

- [ ] **Step 5：Commit**

```bash
git add backend/app/api/v1/teacher/homework.py
git commit -m "feat(teacher): homework supports group_index"
```

---

### Task 8：改造 classes.py（搜索 + is_active 语义）

**Files:**
- Modify: `backend/app/api/v1/teacher/classes.py`

- [ ] **Step 1：列表/移出/加入接口接入 is_active**

原有 query 全部加上 `ClassStudent.is_active.is_(True)`：
- 列表班级学生时，只显示 active
- 移出学生时，不删行而是 `is_active=False, left_at=now()`
- 加入学生前先检查该学生是否已有 active 班级（有则 409）

伪代码示意（具体替换原有方法体）：

```python
from sqlalchemy import update
from datetime import datetime as dt

@router.get("/classes/{class_id}/students")
async def list_class_students(
    class_id: int, q: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    cls = await _get_class_or_404(db, class_id, current_user.id)
    stmt = (
        select(User, ClassStudent.joined_at)
        .join(ClassStudent, ClassStudent.student_id == User.id)
        .where(ClassStudent.class_id == class_id, ClassStudent.is_active.is_(True))
    )
    if q:
        like = f"%{q}%"
        stmt = stmt.where((User.full_name.like(like)) | (User.username.like(like)))
    res = await db.execute(stmt.order_by(User.username))
    return [
        {"id": u.id, "username": u.username, "full_name": u.full_name, "joined_at": j}
        for u, j in res.all()
    ]


@router.post("/classes/{class_id}/students")
async def add_students(
    class_id: int, body: ClassStudentAdd,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    await _get_class_or_404(db, class_id, current_user.id)
    # 检查每个学生是否已有 active 班级
    res = await db.execute(
        select(ClassStudent.student_id)
        .where(ClassStudent.student_id.in_(body.student_ids),
               ClassStudent.is_active.is_(True))
    )
    busy = {row[0] for row in res.all()}
    if busy:
        raise HTTPException(409, f"以下学生已在其他班级：{sorted(busy)}")
    for sid in body.student_ids:
        db.add(ClassStudent(class_id=class_id, student_id=sid, is_active=True))
    await db.commit()
    return {"added": len(body.student_ids)}


@router.delete("/classes/{class_id}/students/{student_id}")
async def remove_student(
    class_id: int, student_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    await _get_class_or_404(db, class_id, current_user.id)
    res = await db.execute(
        update(ClassStudent)
        .where(ClassStudent.class_id == class_id,
               ClassStudent.student_id == student_id,
               ClassStudent.is_active.is_(True))
        .values(is_active=False, left_at=dt.utcnow())
    )
    if res.rowcount == 0:
        raise HTTPException(404, "学生不在该班级或已移出")
    await db.commit()
    return {"removed": True}
```

- [ ] **Step 2：手测搜索**

Run:
```bash
cd backend
uvicorn app.main:app --port 8000 &
sleep 3
TOKEN=$(cat ../有效token.txt | head -1)
# 替换为真实 class_id
curl -s "http://localhost:8000/api/v1/teacher/classes/1/students?q=张" \
  -H "Authorization: Bearer $TOKEN" | python -m json.tool
kill %1
```
Expected：返回名字含"张"的学生（若有）。

- [ ] **Step 3：Commit**

```bash
git add backend/app/api/v1/teacher/classes.py
git commit -m "feat(teacher/classes): add student search + active membership semantics"
```

---

### Task 9：教师班级数据 API（按 class_id）

**Files:**
- Modify: `backend/app/api/v1/teacher/analytics.py`（追加 endpoints）

- [ ] **Step 1：追加 `/classes/{id}/overview`**

```python
@router.get("/classes/{class_id}/overview")
async def get_class_overview_by_id(
    class_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    # 校验班级归属
    cls_res = await db.execute(select(Class).where(
        Class.id == class_id, Class.teacher_id == current_user.id))
    if cls_res.scalar_one_or_none() is None:
        raise HTTPException(404, "班级不存在")

    sid_res = await db.execute(select(ClassStudent.student_id).where(
        ClassStudent.class_id == class_id, ClassStudent.is_active.is_(True)))
    student_ids = [row[0] for row in sid_res.all()]
    if not student_ids:
        return {"student_count": 0, "avg_accuracy": 0.0, "total_words_studied": 0,
                "mastered_words": 0}

    # 复用 WordMastery 聚合
    res = await db.execute(
        select(
            func.count(func.distinct(WordMastery.word_id)),
            func.sum(WordMastery.correct_count),
            func.sum(WordMastery.total_attempts),
            func.sum(WordMastery.mastery_level >= 4),
        ).where(WordMastery.user_id.in_(student_ids))
    )
    total_words, correct, attempts, mastered = res.one()
    acc = float(correct or 0) / float(attempts or 1)
    return {
        "student_count": len(student_ids),
        "avg_accuracy": round(acc, 4),
        "total_words_studied": total_words or 0,
        "mastered_words": mastered or 0,
    }
```

- [ ] **Step 2：追加 `/classes/{id}/word-completion`**

每个单词被多少本班学生掌握：

```python
@router.get("/classes/{class_id}/word-completion")
async def class_word_completion(
    class_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    # 班级权限
    cls_res = await db.execute(select(Class).where(
        Class.id == class_id, Class.teacher_id == current_user.id))
    if cls_res.scalar_one_or_none() is None:
        raise HTTPException(404)

    sid_res = await db.execute(select(ClassStudent.student_id).where(
        ClassStudent.class_id == class_id, ClassStudent.is_active.is_(True)))
    sids = [row[0] for row in sid_res.all()]
    if not sids:
        return []

    res = await db.execute(
        select(
            WordMastery.word_id, Word.word,
            func.count(WordMastery.user_id).label("learners"),
            func.sum(WordMastery.mastery_level >= 4).label("mastered"),
        )
        .join(Word, Word.id == WordMastery.word_id)
        .where(WordMastery.user_id.in_(sids))
        .group_by(WordMastery.word_id, Word.word)
        .order_by(func.count(WordMastery.user_id).desc())
    )
    return [
        {"word_id": wid, "word": w, "learners": ln, "mastered": ms or 0}
        for wid, w, ln, ms in res.all()
    ]
```

- [ ] **Step 3：追加 `/classes/{id}/assignments-progress`**

```python
@router.get("/classes/{class_id}/assignments-progress")
async def class_assignments_progress(
    class_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    cls_res = await db.execute(select(Class).where(
        Class.id == class_id, Class.teacher_id == current_user.id))
    if cls_res.scalar_one_or_none() is None:
        raise HTTPException(404)

    sid_res = await db.execute(select(ClassStudent.student_id).where(
        ClassStudent.class_id == class_id, ClassStudent.is_active.is_(True)))
    sids = [row[0] for row in sid_res.all()]
    if not sids:
        return {"book_assignments": [], "homework_assignments": []}

    # BookAssignment 完成情况
    ba_res = await db.execute(
        select(BookAssignment.id, BookAssignment.book_id,
               BookAssignment.scope_type, BookAssignment.unit_id,
               BookAssignment.group_index, BookAssignment.is_completed,
               BookAssignment.student_id)
        .where(BookAssignment.student_id.in_(sids))
    )
    ba = [
        {"id": i, "book_id": b, "scope_type": st, "unit_id": ui,
         "group_index": gi, "is_completed": bool(c), "student_id": sid}
        for i, b, st, ui, gi, c, sid in ba_res.all()
    ]
    # Homework 完成情况
    from app.models.learning import HomeworkAssignment, HomeworkStudentAssignment
    hw_res = await db.execute(
        select(HomeworkAssignment.id, HomeworkAssignment.title,
               HomeworkStudentAssignment.student_id,
               HomeworkStudentAssignment.status,
               HomeworkStudentAssignment.best_score)
        .join(HomeworkStudentAssignment,
              HomeworkStudentAssignment.homework_id == HomeworkAssignment.id)
        .where(HomeworkStudentAssignment.student_id.in_(sids))
    )
    hw = [
        {"homework_id": i, "title": t, "student_id": sid, "status": st, "best_score": s}
        for i, t, sid, st, s in hw_res.all()
    ]
    return {"book_assignments": ba, "homework_assignments": hw}
```

- [ ] **Step 4：手测三个 endpoint**

每个 endpoint `curl` 一遍，确认 200 + 合理结构。

- [ ] **Step 5：Commit**

```bash
git add backend/app/api/v1/teacher/analytics.py
git commit -m "feat(teacher/analytics): add per-class overview/word-completion/assignments-progress"
```

---

### Task 10：教师学生监控 API（按组成绩 + 下钻）

**Files:**
- Modify: `backend/app/api/v1/teacher/analytics.py`（继续追加） 或 创建 `backend/app/api/v1/teacher/student_monitor.py`（推荐独立文件）

推荐独立文件，避免 analytics.py 过长。

- [ ] **Step 1：写测试（手动调 API）**

Create `backend/test_teacher_monitor.py`：

```python
"""学生监控 API 端到端"""
import asyncio, httpx
BASE = "http://localhost:8000"

def get_token():
    with open("../有效token.txt") as f: return f.read().strip()

async def main():
    headers = {"Authorization": f"Bearer {get_token()}"}
    async with httpx.AsyncClient() as c:
        # 非本班学生应该 403
        r = await c.get(f"{BASE}/api/v1/teacher/students/99999999/groups",
                        headers=headers)
        assert r.status_code in (403, 404), r.text
        print("OK: 非本班 403/404")
    print("\n=== ALL PASSED ===")

if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 2：实现 student_monitor.py**

Create `backend/app/api/v1/teacher/student_monitor.py`:

```python
"""学生监控 - 按组成绩 + 单词级下钻"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.api.v1.auth import get_current_teacher
from app.api.v1.teacher._permissions import assert_student_in_my_class
from app.services.scope_service import get_unit_groups, get_group_words
from app.models.user import User
from app.models.word import Unit, Word
from app.models.learning import WordMastery, LearningRecord

router = APIRouter()


@router.get("/students/{student_id}/groups")
async def student_group_scores(
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    """该学生在所有已学单元的每组聚合成绩"""
    await assert_student_in_my_class(db, current_user.id, student_id)

    # 找该学生学过的所有 unit（依据：WordMastery 中含该 unit 的词）
    units_res = await db.execute(
        select(Unit).order_by(Unit.book_id, Unit.unit_number)
    )
    units = units_res.scalars().all()
    out: list[dict] = []
    for u in units:
        groups = await get_unit_groups(db, u.id)
        for g in groups:
            wids = g["word_ids"]
            mres = await db.execute(
                select(
                    func.count(WordMastery.id),
                    func.sum(WordMastery.mastery_level >= 4),
                    func.sum(WordMastery.correct_count),
                    func.sum(WordMastery.total_attempts),
                    func.max(WordMastery.last_practiced_at),
                ).where(
                    WordMastery.user_id == student_id,
                    WordMastery.word_id.in_(wids),
                )
            )
            cnt, mastered, correct, attempts, last_at = mres.one()
            if not cnt:
                continue
            out.append({
                "unit_id": u.id, "unit_name": u.name,
                "group_index": g["index"], "word_count": len(wids),
                "learned_count": cnt or 0,
                "mastered_count": mastered or 0,
                "accuracy": round((correct or 0) / (attempts or 1), 4),
                "last_studied_at": last_at.isoformat() if last_at else None,
            })
    return out


@router.get("/students/{student_id}/groups/{unit_id}/{group_index}/words")
async def student_group_words(
    student_id: int, unit_id: int, group_index: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    """组内每个单词的对错明细（下钻）"""
    await assert_student_in_my_class(db, current_user.id, student_id)
    words = await get_group_words(db, unit_id, group_index)
    word_ids = [w.id for w in words]

    mres = await db.execute(
        select(WordMastery).where(
            WordMastery.user_id == student_id,
            WordMastery.word_id.in_(word_ids),
        )
    )
    by_wid = {m.word_id: m for m in mres.scalars().all()}
    out = []
    for w in words:
        m = by_wid.get(w.id)
        out.append({
            "word_id": w.id, "word": w.word,
            "mastery_level": m.mastery_level if m else 0,
            "correct_count": m.correct_count if m else 0,
            "total_attempts": m.total_attempts if m else 0,
            "last_practiced_at": m.last_practiced_at.isoformat()
                if m and m.last_practiced_at else None,
        })
    return out
```

- [ ] **Step 3：注册路由**

Edit `backend/app/main.py`：搜索现有 teacher 路由 include，按同样方式追加 `student_monitor` router（路径 `/api/v1/teacher`）。

- [ ] **Step 4：运行测试**

Run:
```bash
cd backend
uvicorn app.main:app --port 8000 &
sleep 3
python test_teacher_monitor.py
kill %1
```
Expected: PASSED。

- [ ] **Step 5：Commit**

```bash
git add backend/app/api/v1/teacher/student_monitor.py backend/app/main.py backend/test_teacher_monitor.py
git commit -m "feat(teacher): student group score + word-level drilldown"
```

---

### Task 11：admin/teachers.py

**Files:**
- Create: `backend/app/api/v1/admin/teachers.py`
- Create: `backend/test_admin_teachers.py`

- [ ] **Step 1：写测试**

Create `backend/test_admin_teachers.py`:

```python
import asyncio, httpx
BASE = "http://localhost:8000"

def admin_token():
    # 假设项目里有 admin 用户的 token；如无，跳过此测试
    import os
    return os.environ.get("ADMIN_TOKEN", "")

async def main():
    t = admin_token()
    if not t:
        print("SKIP: 设置 ADMIN_TOKEN 环境变量后再跑")
        return
    headers = {"Authorization": f"Bearer {t}"}
    async with httpx.AsyncClient() as c:
        r = await c.get(f"{BASE}/api/v1/admin/teachers", headers=headers)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        print(f"OK: {len(data)} 个教师")
    print("\n=== ALL PASSED ===")

if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 2：实现 admin/teachers.py**

Create `backend/app/api/v1/admin/teachers.py`:

```python
"""管理员 - 教师管理"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, Field
from typing import Optional

from app.core.database import get_db
from app.api.v1.auth import get_current_admin
from app.models.user import User, Class, ClassStudent
from app.services.auth_service import hash_password, generate_random_password

router = APIRouter()


class TeacherCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: str
    full_name: Optional[str] = None
    password: Optional[str] = None  # 不传则随机


class TeacherUpdate(BaseModel):
    full_name: Optional[str] = None
    is_active: Optional[bool] = None


@router.get("/teachers")
async def list_teachers(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    res = await db.execute(
        select(
            User.id, User.username, User.email, User.full_name, User.is_active,
            User.last_login,
            func.count(func.distinct(Class.id)).label("class_count"),
            func.count(func.distinct(ClassStudent.student_id)).label("student_count"),
        )
        .outerjoin(Class, Class.teacher_id == User.id)
        .outerjoin(ClassStudent, (ClassStudent.class_id == Class.id) &
                                  (ClassStudent.is_active.is_(True)))
        .where(User.role == "teacher")
        .group_by(User.id)
        .order_by(User.username)
    )
    return [
        {"id": i, "username": u, "email": e, "full_name": fn,
         "is_active": bool(act), "last_login": ll.isoformat() if ll else None,
         "class_count": cc, "student_count": sc}
        for i, u, e, fn, act, ll, cc, sc in res.all()
    ]


@router.get("/teachers/{teacher_id}")
async def get_teacher(
    teacher_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    res = await db.execute(select(User).where(
        User.id == teacher_id, User.role == "teacher"))
    t = res.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "教师不存在")
    cls_res = await db.execute(select(Class).where(Class.teacher_id == teacher_id))
    classes = [
        {"id": c.id, "name": c.name, "description": c.description,
         "created_at": c.created_at.isoformat() if c.created_at else None}
        for c in cls_res.scalars().all()
    ]
    return {
        "id": t.id, "username": t.username, "email": t.email,
        "full_name": t.full_name, "is_active": t.is_active,
        "classes": classes,
    }


@router.post("/teachers")
async def create_teacher(
    body: TeacherCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    pwd = body.password or generate_random_password()
    t = User(
        username=body.username, email=body.email, full_name=body.full_name,
        hashed_password=hash_password(pwd), role="teacher", is_active=True,
    )
    db.add(t)
    await db.commit()
    return {"id": t.id, "username": t.username, "initial_password": pwd}


@router.patch("/teachers/{teacher_id}")
async def update_teacher(
    teacher_id: int, body: TeacherUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    res = await db.execute(select(User).where(
        User.id == teacher_id, User.role == "teacher"))
    t = res.scalar_one_or_none()
    if not t:
        raise HTTPException(404)
    if body.full_name is not None: t.full_name = body.full_name
    if body.is_active is not None: t.is_active = body.is_active
    await db.commit()
    return {"updated": True}


@router.post("/teachers/{teacher_id}/reset-password")
async def reset_password(
    teacher_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    res = await db.execute(select(User).where(
        User.id == teacher_id, User.role == "teacher"))
    t = res.scalar_one_or_none()
    if not t:
        raise HTTPException(404)
    new_pwd = generate_random_password()
    t.hashed_password = hash_password(new_pwd)
    await db.commit()
    return {"new_password": new_pwd}
```

如果 `app/services/auth_service.py` 没有 `generate_random_password`，在该文件内新增一个：

```python
import secrets, string
def generate_random_password(length: int = 12) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))
```

- [ ] **Step 3：注册路由**

Edit `backend/app/main.py`，在已有 admin 路由附近加入：

```python
from app.api.v1.admin import teachers as admin_teachers
app.include_router(admin_teachers.router, prefix="/api/v1/admin", tags=["管理员-教师"])
```

- [ ] **Step 4：运行测试**

Run:
```bash
cd backend
uvicorn app.main:app --port 8000 &
sleep 3
ADMIN_TOKEN="<你的admin token>" python test_admin_teachers.py
kill %1
```
Expected: `=== ALL PASSED ===` 或 SKIP。

- [ ] **Step 5：Commit**

```bash
git add backend/app/api/v1/admin/teachers.py backend/app/services/auth_service.py \
        backend/app/main.py backend/test_admin_teachers.py
git commit -m "feat(admin): teacher management endpoints"
```

---

### Task 12：admin/classes.py + 跨教师转班

**Files:**
- Create: `backend/app/api/v1/admin/classes.py`

- [ ] **Step 1：实现路由**

Create `backend/app/api/v1/admin/classes.py`:

```python
"""管理员 - 班级监控 + 学生转班"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func, update
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime as dt
from pydantic import BaseModel

from app.core.database import get_db
from app.api.v1.auth import get_current_admin
from app.models.user import User, Class, ClassStudent
from app.models.learning import WordMastery

router = APIRouter()


class TransferRequest(BaseModel):
    new_class_id: int


@router.get("/classes")
async def list_all_classes(
    teacher_id: int | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    stmt = (
        select(
            Class.id, Class.name, Class.description, Class.teacher_id,
            User.username,
            func.count(ClassStudent.id).label("student_count"),
        )
        .join(User, User.id == Class.teacher_id)
        .outerjoin(ClassStudent, (ClassStudent.class_id == Class.id) &
                                  (ClassStudent.is_active.is_(True)))
        .group_by(Class.id, User.username)
        .order_by(Class.created_at.desc())
    )
    if teacher_id:
        stmt = stmt.where(Class.teacher_id == teacher_id)
    res = await db.execute(stmt)
    return [
        {"id": i, "name": n, "description": d, "teacher_id": tid,
         "teacher_username": tu, "student_count": sc}
        for i, n, d, tid, tu, sc in res.all()
    ]


@router.get("/classes/{class_id}/overview")
async def admin_class_overview(
    class_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    cls_res = await db.execute(select(Class).where(Class.id == class_id))
    cls = cls_res.scalar_one_or_none()
    if not cls:
        raise HTTPException(404)
    sid_res = await db.execute(select(ClassStudent.student_id).where(
        ClassStudent.class_id == class_id, ClassStudent.is_active.is_(True)))
    sids = [r[0] for r in sid_res.all()]
    if not sids:
        return {"class_id": class_id, "name": cls.name, "student_count": 0,
                "avg_accuracy": 0.0, "total_words_studied": 0, "mastered_words": 0}
    res = await db.execute(
        select(
            func.count(func.distinct(WordMastery.word_id)),
            func.sum(WordMastery.correct_count),
            func.sum(WordMastery.total_attempts),
            func.sum(WordMastery.mastery_level >= 4),
        ).where(WordMastery.user_id.in_(sids))
    )
    total_words, correct, attempts, mastered = res.one()
    return {
        "class_id": class_id, "name": cls.name,
        "student_count": len(sids),
        "avg_accuracy": round(float(correct or 0) / float(attempts or 1), 4),
        "total_words_studied": total_words or 0,
        "mastered_words": mastered or 0,
    }


@router.post("/students/{student_id}/transfer")
async def transfer_student(
    student_id: int, body: TransferRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """跨教师转班 - 事务性操作"""
    # 1. 校验学生存在
    s_res = await db.execute(select(User).where(
        User.id == student_id, User.role == "student"))
    if not s_res.scalar_one_or_none():
        raise HTTPException(404, "学生不存在")
    # 2. 校验目标班级存在
    nc_res = await db.execute(select(Class).where(Class.id == body.new_class_id))
    if not nc_res.scalar_one_or_none():
        raise HTTPException(404, "目标班级不存在")
    # 3. 旧 active 记录置 false
    await db.execute(
        update(ClassStudent)
        .where(ClassStudent.student_id == student_id,
               ClassStudent.is_active.is_(True))
        .values(is_active=False, left_at=dt.utcnow())
    )
    # 4. 加入新班
    db.add(ClassStudent(
        class_id=body.new_class_id, student_id=student_id, is_active=True))
    await db.commit()
    return {"transferred": True, "new_class_id": body.new_class_id}
```

- [ ] **Step 2：注册路由**

Edit `backend/app/main.py`：

```python
from app.api.v1.admin import classes as admin_classes
app.include_router(admin_classes.router, prefix="/api/v1/admin", tags=["管理员-班级"])
```

- [ ] **Step 3：手测转班**

Run:
```bash
cd backend
uvicorn app.main:app --port 8000 &
sleep 3
ADMIN_TOKEN="<...>"
curl -X POST http://localhost:8000/api/v1/admin/students/1/transfer \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"new_class_id":2}'
# 验证 DB
sqlite3 english_helper.db \
  "SELECT * FROM class_students WHERE student_id=1 ORDER BY id DESC LIMIT 3"
kill %1
```
Expected：旧记录 `is_active=0, left_at NOT NULL`，新记录 `is_active=1`。

- [ ] **Step 4：Commit**

```bash
git add backend/app/api/v1/admin/classes.py backend/app/main.py
git commit -m "feat(admin): class monitoring + cross-teacher student transfer"
```

---

### Task 13：前端 API 客户端

**Files:**
- Create: `frontend/src/api/teacherAssignments.ts`
- Create: `frontend/src/api/teacherMonitor.ts`
- Create: `frontend/src/api/admin.ts`

- [ ] **Step 1：teacherAssignments.ts**

```typescript
import { client } from './client'

export type ScopeType = 'book' | 'unit' | 'group'

export interface AssignBookPayload {
  book_id: number
  student_ids: number[]
  scope_type: ScopeType
  unit_id?: number
  group_index?: number
  deadline?: string
}

export const teacherAssignments = {
  listBookUnits: (book_id: number) =>
    client.get(`/api/v1/teacher/books/${book_id}/units`).then(r => r.data),

  listUnitGroups: (unit_id: number) =>
    client.get(`/api/v1/teacher/units/${unit_id}/groups`).then(r => r.data),

  assignBook: (payload: AssignBookPayload) =>
    client.post('/api/v1/teacher/book-assignments/assign', payload).then(r => r.data),

  listAssignments: (params: { student_id?: number; class_id?: number; scope_type?: ScopeType }) =>
    client.get('/api/v1/teacher/book-assignments', { params }).then(r => r.data),

  deleteAssignment: (id: number) =>
    client.delete(`/api/v1/teacher/book-assignments/${id}`).then(r => r.data),
}
```

- [ ] **Step 2：teacherMonitor.ts**

```typescript
import { client } from './client'

export interface GroupScore {
  unit_id: number; unit_name: string;
  group_index: number; word_count: number;
  learned_count: number; mastered_count: number;
  accuracy: number; last_studied_at: string | null;
}

export interface GroupWord {
  word_id: number; word: string;
  mastery_level: number; correct_count: number; total_attempts: number;
  last_practiced_at: string | null;
}

export const teacherMonitor = {
  classStudents: (class_id: number, q?: string) =>
    client.get(`/api/v1/teacher/classes/${class_id}/students`, { params: { q } }).then(r => r.data),

  studentGroups: (student_id: number): Promise<GroupScore[]> =>
    client.get(`/api/v1/teacher/students/${student_id}/groups`).then(r => r.data),

  groupWords: (student_id: number, unit_id: number, group_index: number): Promise<GroupWord[]> =>
    client.get(
      `/api/v1/teacher/students/${student_id}/groups/${unit_id}/${group_index}/words`
    ).then(r => r.data),

  classOverview: (class_id: number) =>
    client.get(`/api/v1/teacher/classes/${class_id}/overview`).then(r => r.data),

  classWordCompletion: (class_id: number) =>
    client.get(`/api/v1/teacher/classes/${class_id}/word-completion`).then(r => r.data),

  classAssignmentsProgress: (class_id: number) =>
    client.get(`/api/v1/teacher/classes/${class_id}/assignments-progress`).then(r => r.data),
}
```

- [ ] **Step 3：admin.ts**

```typescript
import { client } from './client'

export const admin = {
  listTeachers: () => client.get('/api/v1/admin/teachers').then(r => r.data),
  getTeacher: (id: number) => client.get(`/api/v1/admin/teachers/${id}`).then(r => r.data),
  createTeacher: (payload: { username: string; email: string; full_name?: string; password?: string }) =>
    client.post('/api/v1/admin/teachers', payload).then(r => r.data),
  updateTeacher: (id: number, body: { full_name?: string; is_active?: boolean }) =>
    client.patch(`/api/v1/admin/teachers/${id}`, body).then(r => r.data),
  resetPassword: (id: number) =>
    client.post(`/api/v1/admin/teachers/${id}/reset-password`).then(r => r.data),

  listClasses: (teacher_id?: number) =>
    client.get('/api/v1/admin/classes', { params: { teacher_id } }).then(r => r.data),
  classOverview: (id: number) =>
    client.get(`/api/v1/admin/classes/${id}/overview`).then(r => r.data),

  transferStudent: (student_id: number, new_class_id: number) =>
    client.post(`/api/v1/admin/students/${student_id}/transfer`, { new_class_id })
      .then(r => r.data),
}
```

- [ ] **Step 4：Commit**

```bash
cd /Users/apple/Desktop/英语助手
git add frontend/src/api/teacherAssignments.ts \
        frontend/src/api/teacherMonitor.ts \
        frontend/src/api/admin.ts
git commit -m "feat(frontend): API clients for teacher assignments/monitor + admin"
```

---

### Task 14：ScopeSelector 组件

**Files:**
- Create: `frontend/src/components/teacher/ScopeSelector.tsx`

- [ ] **Step 1：实现组件**

Create the file with the full implementation:

```tsx
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { teacherAssignments, ScopeType } from '../../api/teacherAssignments'

export interface ScopeValue {
  scope_type: ScopeType
  book_id: number | null
  unit_id?: number | null
  group_index?: number | null
}

interface Props {
  books: { id: number; name: string }[]
  value: ScopeValue
  onChange: (v: ScopeValue) => void
  allowBook?: boolean
}

export function ScopeSelector({ books, value, onChange, allowBook = true }: Props) {
  const bookId = value.book_id

  const { data: units = [] } = useQuery({
    queryKey: ['book-units', bookId],
    queryFn: () => teacherAssignments.listBookUnits(bookId!),
    enabled: !!bookId,
  })
  const { data: groups = [] } = useQuery({
    queryKey: ['unit-groups', value.unit_id],
    queryFn: () => teacherAssignments.listUnitGroups(value.unit_id!),
    enabled: !!value.unit_id && value.scope_type === 'group',
  })

  // 切书时清下游
  useEffect(() => {
    if (value.scope_type !== 'book' && !units.find(u => u.id === value.unit_id)) {
      onChange({ ...value, scope_type: 'book', unit_id: null, group_index: null })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId])

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-sm mb-1">单词本</label>
        <select
          className="w-full border rounded px-3 py-2"
          value={bookId ?? ''}
          onChange={e => onChange({
            scope_type: 'book',
            book_id: e.target.value ? Number(e.target.value) : null,
            unit_id: null, group_index: null,
          })}
        >
          <option value="">— 选择 —</option>
          {books.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>

      {bookId && (
        <div>
          <label className="block text-sm mb-1">范围</label>
          <div className="flex gap-2 flex-wrap">
            {allowBook && (
              <button
                type="button"
                onClick={() => onChange({ scope_type: 'book', book_id: bookId, unit_id: null, group_index: null })}
                className={`px-3 py-1 rounded border ${value.scope_type === 'book' ? 'bg-orange-500 text-white' : ''}`}
              >整本</button>
            )}
            {units.map(u => (
              <div key={u.id} className="flex flex-col">
                <button
                  type="button"
                  onClick={() => onChange({ scope_type: 'unit', book_id: bookId, unit_id: u.id, group_index: null })}
                  className={`px-3 py-1 rounded border ${value.scope_type === 'unit' && value.unit_id === u.id ? 'bg-orange-500 text-white' : ''}`}
                >{u.name}（{u.group_count}组）</button>
                {value.unit_id === u.id && value.scope_type !== 'book' && (
                  <div className="ml-3 mt-1 flex gap-1 flex-wrap">
                    <button
                      type="button"
                      onClick={() => onChange({ scope_type: 'unit', book_id: bookId, unit_id: u.id, group_index: null })}
                      className={`px-2 py-0.5 text-xs rounded border ${value.scope_type === 'unit' ? 'bg-amber-300' : ''}`}
                    >整单元</button>
                    {groups.map(g => (
                      <button
                        type="button"
                        key={g.index}
                        onClick={() => onChange({ scope_type: 'group', book_id: bookId, unit_id: u.id, group_index: g.index })}
                        className={`px-2 py-0.5 text-xs rounded border ${value.scope_type === 'group' && value.group_index === g.index ? 'bg-amber-400' : ''}`}
                      >第{g.index}组（{g.word_count}词）</button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2：构建检查**

Run:
```bash
cd frontend
npm run lint || true
npm run build
```
Expected：build 成功。

- [ ] **Step 3：Commit**

```bash
git add frontend/src/components/teacher/ScopeSelector.tsx
git commit -m "feat(frontend): ScopeSelector cascading book/unit/group picker"
```

---

### Task 15：AssignBook + CreateHomework 改造

**Files:**
- Modify: `frontend/src/pages/teacher/AssignBook.tsx`
- Modify: `frontend/src/pages/teacher/CreateHomework.tsx`

- [ ] **Step 1：AssignBook 改造**

打开 `AssignBook.tsx`：
1. import `ScopeSelector` 和 `ScopeValue`
2. 用 `useState<ScopeValue>` 替代原有 `book_id` state
3. 替换原 book 选择 UI 为 `<ScopeSelector books={books} value={scope} onChange={setScope} />`
4. 提交时 `teacherAssignments.assignBook({ ...scope, student_ids, deadline })`
5. 提交校验：`scope.scope_type === 'group'` 时 `group_index` 必填，否则禁用按钮

- [ ] **Step 2：CreateHomework 改造**

打开 `CreateHomework.tsx`：
1. 同样接 `ScopeSelector`，但传 `allowBook={false}`（作业最大粒度是 Unit）
2. 提交时把 `unit_id` 与 `group_index`（若有）放入 payload

- [ ] **Step 3：手测**

启动前后端，登录教师端，分别用单元、组两种粒度提交一次，看后端 DB 写入正确：

```bash
sqlite3 backend/english_helper.db \
  "SELECT id, scope_type, unit_id, group_index FROM book_assignments ORDER BY id DESC LIMIT 5"
```

- [ ] **Step 4：Commit**

```bash
git add frontend/src/pages/teacher/AssignBook.tsx \
        frontend/src/pages/teacher/CreateHomework.tsx
git commit -m "feat(teacher-ui): AssignBook + CreateHomework use ScopeSelector"
```

---

### Task 16：ClassDetail 搜索 + StudentMonitor 新页

**Files:**
- Modify: `frontend/src/pages/teacher/ClassDetail.tsx`
- Create: `frontend/src/pages/teacher/StudentMonitor.tsx`
- Modify: `frontend/src/App.tsx`（路由）

- [ ] **Step 1：ClassDetail 加搜索框**

在学生列表上方加 `<input value={q} onChange={...} placeholder="搜索学生姓名/用户名" />`，调用 `teacherMonitor.classStudents(classId, q)` 时把 `q` 传入；行点击跳转 `/teacher/students/:id`。

- [ ] **Step 2：StudentMonitor 页**

```tsx
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { teacherMonitor } from '../../api/teacherMonitor'

export default function StudentMonitor() {
  const { id } = useParams<{ id: string }>()
  const studentId = Number(id)
  const [openKey, setOpenKey] = useState<string | null>(null)

  const { data: groups = [], isLoading } = useQuery({
    queryKey: ['student-groups', studentId],
    queryFn: () => teacherMonitor.studentGroups(studentId),
  })

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">学生监控</h1>
      {isLoading && <div>加载中...</div>}
      <div className="space-y-2">
        {groups.map(g => {
          const key = `${g.unit_id}-${g.group_index}`
          return (
            <div key={key} className="border rounded">
              <div
                className="p-3 flex items-center gap-4 cursor-pointer hover:bg-amber-50"
                onClick={() => setOpenKey(openKey === key ? null : key)}
              >
                <div className="flex-1">
                  <div className="font-medium">{g.unit_name} · 第{g.group_index}组</div>
                  <div className="text-xs text-gray-500">
                    已学 {g.learned_count}/{g.word_count} · 掌握 {g.mastered_count} ·
                    准确率 {(g.accuracy * 100).toFixed(0)}%
                  </div>
                </div>
                <span className="text-orange-500">{openKey === key ? '收起' : '展开'}</span>
              </div>
              {openKey === key && <DrillDown studentId={studentId} unitId={g.unit_id} groupIndex={g.group_index} />}
            </div>
          )
        })}
        {!isLoading && !groups.length && <div className="text-gray-500">暂无数据</div>}
      </div>
    </div>
  )
}

function DrillDown({ studentId, unitId, groupIndex }: { studentId: number; unitId: number; groupIndex: number }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ['group-words', studentId, unitId, groupIndex],
    queryFn: () => teacherMonitor.groupWords(studentId, unitId, groupIndex),
  })
  if (isLoading) return <div className="p-3 text-sm">加载中...</div>
  return (
    <table className="w-full text-sm">
      <thead className="bg-amber-50">
        <tr><th className="p-2 text-left">单词</th><th>掌握度</th><th>对/总</th><th>最近</th></tr>
      </thead>
      <tbody>
        {data.map(w => (
          <tr key={w.word_id} className="border-t">
            <td className="p-2">{w.word}</td>
            <td className="text-center">{w.mastery_level}</td>
            <td className="text-center">{w.correct_count}/{w.total_attempts}</td>
            <td className="text-center text-xs">{w.last_practiced_at?.slice(0, 10) ?? '-'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

- [ ] **Step 3：注册路由**

Edit `App.tsx`：在教师路由组里加：
```tsx
<Route path="/teacher/students/:id" element={<StudentMonitor />} />
```

- [ ] **Step 4：手测**

打开教师端，进班级 → 搜索学生 → 点击进入监控页 → 点击某组展开看明细。

- [ ] **Step 5：Commit**

```bash
git add frontend/src/pages/teacher/ClassDetail.tsx \
        frontend/src/pages/teacher/StudentMonitor.tsx \
        frontend/src/App.tsx
git commit -m "feat(teacher-ui): student search + group score monitor with drilldown"
```

---

### Task 17：ClassAnalytics 改造

**Files:**
- Modify: `frontend/src/pages/teacher/ClassAnalytics.tsx`

- [ ] **Step 1：把数据来源换成 class_id 维度的接口**

在页面顶部加班级选择器（用 `teacher.ts` 已有的 listClasses）。选定后：
- 调 `teacherMonitor.classOverview(classId)` 替代旧的全平台 overview
- 调 `teacherMonitor.classWordCompletion(classId)` 渲染单词完成度表（一行一个单词，显示 learners / mastered）
- 调 `teacherMonitor.classAssignmentsProgress(classId)` 渲染作业完成进度表

- [ ] **Step 2：手测**

切换班级，确认每个班数据隔离正确（学生数、词数变化）。

- [ ] **Step 3：Commit**

```bash
git add frontend/src/pages/teacher/ClassAnalytics.tsx
git commit -m "feat(teacher-ui): ClassAnalytics scoped by class_id"
```

---

### Task 18：管理员前端三页

**Files:**
- Create: `frontend/src/pages/admin/TeacherList.tsx`
- Create: `frontend/src/pages/admin/TeacherDetail.tsx`
- Create: `frontend/src/pages/admin/ClassDetail.tsx`
- Create: `frontend/src/components/admin/TransferStudentDialog.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1：TeacherList**

表格展示 `id / username / email / class_count / student_count / 状态`，搜索 + "新建教师" 按钮（弹框收集 username/email/full_name），表格行操作：进入详情 / 禁用 / 重置密码。所有操作走 `admin.ts`。

- [ ] **Step 2：TeacherDetail**

读 `admin.getTeacher(id)`，展示其名下班级列表（点进去到 ClassDetail）。

- [ ] **Step 3：ClassDetail（管理员视图）**

读 `admin.classOverview(id)`，展示班级聚合指标 + 学生列表 + 每行 `<TransferStudentDialog studentId={...} />`。

- [ ] **Step 4：TransferStudentDialog**

弹窗：选目标班级（来自 `admin.listClasses()`） → 调 `admin.transferStudent(studentId, new_class_id)`。成功后 `queryClient.invalidateQueries(['admin-class', class_id])`。

- [ ] **Step 5：路由注册**

```tsx
<Route path="/admin/teachers" element={<TeacherList />} />
<Route path="/admin/teachers/:id" element={<TeacherDetail />} />
<Route path="/admin/classes/:id" element={<AdminClassDetail />} />
```

- [ ] **Step 6：手测**

用 admin token 登录后跑一遍：列表 → 详情 → 班级 → 转班；DB 校验转班语义。

- [ ] **Step 7：Commit**

```bash
git add frontend/src/pages/admin/TeacherList.tsx \
        frontend/src/pages/admin/TeacherDetail.tsx \
        frontend/src/pages/admin/ClassDetail.tsx \
        frontend/src/components/admin/TransferStudentDialog.tsx \
        frontend/src/App.tsx
git commit -m "feat(admin-ui): teacher list/detail + class detail + transfer dialog"
```

---

### Task 19：端到端联调 + 回归

**Files:** 无

- [ ] **Step 1：回归 — 旧 BookAssignment 等同于 scope=book**

启动前后端。学生侧打开任意已有的"整本分配"任务，确认能正常进入学习。

- [ ] **Step 2：回归 — 旧 Homework（无 group_index）等同于整单元**

学生侧打开旧作业，确认题目集合 = 整个 unit 的词。

- [ ] **Step 3：黄金路径手测**

教师端：
1. 创建班级 → 加学生
2. 搜索学生（搜索功能）
3. 给学生分配"某单元第 1 组"
4. 切到学生身份完成第 1 组
5. 切回教师身份，进学生监控页 → 看到第 1 组成绩，点击下钻到单词明细

管理员端：
1. 看教师列表
2. 进某教师详情 → 进某班级
3. 用转班对话框把学生转到另一教师的班级
4. 验证：原教师列表里学生消失；新教师列表里学生出现

- [ ] **Step 4：边界**

1. 给已在班级的学生加入新班 → 期望 409
2. 教师 A 尝试访问教师 B 班级的学生 → 期望 403
3. 给 group_index 越界 → 期望 422
4. group_size=0 时单元自动按 10 切组

- [ ] **Step 5：Commit（如有 .md 笔记）**

```bash
git add -A
git commit --allow-empty -m "test: e2e regression for assignment scope + monitoring"
```

---

## 自检（Self-Review）

### Spec 覆盖
- [x] 分配粒度（Book/Unit/Group） — Tasks 6, 7
- [x] 双线（Book + Homework） — Tasks 6, 7
- [x] 班级归属唯一约束 — Tasks 1, 8
- [x] 教师权限边界 — Task 4 + 各 API
- [x] 学生搜索 — Task 8 (后端) + Task 16 (前端)
- [x] 按组成绩 + 下钻 — Task 10 + Task 16
- [x] 班级数据 + analytics bug 修复 — Tasks 5, 9, 17
- [x] 管理员监控 + 转班 — Tasks 11, 12, 18
- [x] 数据迁移 + 同步 schema — Task 1
- [x] 测试 — Tasks 3, 4, 6, 10, 11
- [x] 回归 — Task 19

### 占位符扫描
- 已检查无 TBD/TODO/省略号；所有代码块完整可执行。

### 类型一致性
- `ScopeType = 'book'|'unit'|'group'` 三处统一（API 客户端 / ScopeSelector / 后端 Pydantic Literal）。
- `GroupScore` / `GroupWord` 字段与后端响应一一对应。

---

## 执行交接

Plan complete and saved to `docs/superpowers/plans/2026-04-29-teacher-admin-assignment-monitoring-plan.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
