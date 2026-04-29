# 教师/管理员的分配粒度与监控增强 设计文档

- 日期：2026-04-29
- 状态：Draft（待用户复核）
- 作者：协作设计（用户 + Cascade）

## 1. 背景与目标

当前系统中：
- 教师只能将"整本单词本"分配给学生，颗粒太粗，无法贴合"按单元/按组讲解"的真实教学节奏。
- 教师没有以"班级"为边界的权限隔离；现有 `analytics.py` 直接查询全量学生（bug）。
- 教师监控页缺少学生搜索；没有"按组成绩"视图；班级维度的完成数据缺失。
- 管理员没有按"教师/班级"钻取的能力，也没有跨教师转班等干预手段。

本次目标：让教师能在"单词本 / 单元 / 单元内某一组"三种粒度上分配学习内容与作业；
让教师只看自己班级的学生与数据；新增按组的成绩监控与下钻；扩展管理员的教师 / 班级监控与干预能力。

## 2. 关键决策汇总

| 维度 | 决策 |
|------|------|
| 分配粒度 | Book / Unit / Group（系统按 `Unit.group_size` 自动切组） |
| 适用场景 | 单词本分配（`BookAssignment`）+ 作业分配（`HomeworkAssignment`）双线支持 |
| 班级归属 | 一个学生同一时刻只能属于一个班级（active）；保留历史记录 |
| 成绩展示 | 两层：组聚合 + 单词级明细下钻；复用现有 `WordMastery` / `LearningRecord`，不建新表 |
| 管理员能力 | 只读监控 + 干预（创建 / 禁用教师，跨教师转班等） |
| 教师搜索 | 班级内按姓名 / 用户名模糊搜索 |
| "组" 是否独立实体 | 不建 `WordGroup` 表；通过 `(unit_id, group_index)` + `group_size` 派生 |
| 默认 group_size | 当 `Unit.group_size = 0` 时使用 `DEFAULT_GROUP_SIZE = 10` |

## 3. 架构总览

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Scope 服务（services/scope_service.py，新增）            │
│    get_scope_words / get_unit_groups / get_group_words      │
├─────────────────────────────────────────────────────────────┤
│ 2. 班级权限 helper（api/v1/teacher/_permissions.py，新增）  │
│    get_my_class_student_ids / assert_student_in_my_class    │
├─────────────────────────────────────────────────────────────┤
│ 3. 教师端                                                    │
│    book_assignments / homework / classes / analytics（修+扩）│
├─────────────────────────────────────────────────────────────┤
│ 4. 管理员端                                                  │
│    admin/teachers.py（新）+ admin/classes.py（新）           │
├─────────────────────────────────────────────────────────────┤
│ 5. 前端                                                      │
│    ScopeSelector + StudentMonitor + 管理员页                 │
└─────────────────────────────────────────────────────────────┘
```

## 4. 数据模型变更

### 4.1 `class_students` 添加 `is_active` 与 `left_at`

```python
class ClassStudent(Base):
    __tablename__ = "class_students"
    id         = Column(Integer, primary_key=True)
    class_id   = Column(Integer, ForeignKey('classes.id', ondelete='CASCADE'), nullable=False)
    student_id = Column(Integer, ForeignKey('users.id', ondelete='CASCADE'), nullable=False)
    is_active  = Column(Boolean, default=True, nullable=False)        # 新增
    joined_at  = Column(DateTime, server_default=func.now())
    left_at    = Column(DateTime, nullable=True)                       # 新增
```

迁移 SQL（节选）：
```sql
ALTER TABLE class_students ADD COLUMN is_active BOOLEAN DEFAULT 1 NOT NULL;
ALTER TABLE class_students ADD COLUMN left_at DATETIME;
CREATE UNIQUE INDEX uq_active_student
  ON class_students(student_id) WHERE is_active = 1;
```

转班语义：旧记录设 `is_active=False, left_at=now()`；插入新 active 行。

### 4.2 `book_assignments` 三级分配粒度

```python
class BookAssignment(Base):
    # 现有字段保留
    scope_type  = Column(String(10), nullable=False, default='book')  # 新增
    unit_id     = Column(Integer, ForeignKey("units.id", ondelete="SET NULL"), nullable=True)
    group_index = Column(Integer, nullable=True)
```

约束（应用层校验）：
- `scope_type='book'`  → `unit_id IS NULL AND group_index IS NULL`
- `scope_type='unit'`  → `unit_id NOT NULL AND group_index IS NULL`
- `scope_type='group'` → `unit_id NOT NULL AND group_index NOT NULL`

唯一约束需要重建（SQLite 无法直接修改约束）：
```sql
-- 旧表存在 UNIQUE(book_id, student_id)，与新粒度冲突，必须重建
CREATE TABLE book_assignments_new (
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
INSERT INTO book_assignments_new (id, book_id, student_id, teacher_id,
        scope_type, unit_id, group_index, assigned_at, deadline, is_completed)
  SELECT id, book_id, student_id, teacher_id,
         'book', NULL, NULL, assigned_at, deadline, is_completed
  FROM book_assignments;
DROP TABLE book_assignments;
ALTER TABLE book_assignments_new RENAME TO book_assignments;
-- 重建索引
CREATE INDEX idx_book_assignments_student ON book_assignments(student_id);
CREATE INDEX idx_book_assignments_teacher ON book_assignments(teacher_id);
CREATE INDEX idx_book_assignments_book    ON book_assignments(book_id);
```

### 4.3 `homework_assignments` 添加 `group_index`

```python
class HomeworkAssignment(Base):
    # 现有字段保留；unit_id 仍 NOT NULL
    group_index = Column(Integer, nullable=True)   # null = 整单元
```

迁移：
```sql
ALTER TABLE homework_assignments ADD COLUMN group_index INTEGER;
```

防重复仅在应用层校验，不增加唯一约束（保持迁移简单）。

### 4.4 不变更的表（明确列出避免误改）

`Word`, `WordBook`, `Unit`, `UnitWord`, `WordMastery`, `LearningRecord`,
`StudySession`, `HomeworkStudentAssignment`, `HomeworkAttemptRecord`,
`User`, `Class`。

不新增 `WordGroup` 表。

### 4.5 迁移机制

- 项目使用手写 SQL 脚本（不使用 Alembic）；`init_db()` 仅 `create_all`，不会修改已存在表的字段。
- 新建 `backend/migrations/00X_assignment_scope_and_class_active.sql`（编号按现有递增）。
- 同步更新 `database_schema.sql` 与 `app/models/*.py`。
- 迁移必须**幂等**（重复运行不报错）；`english_helper.db` 备份后执行。
- 现有数据已核查：`class_students` 无"一学生在多班"的脏数据，无需特殊清理。

## 5. 服务层

### 5.1 `services/scope_service.py`（新）

```python
DEFAULT_GROUP_SIZE = 10

async def get_unit_groups(db, unit_id: int) -> list[dict]:
    """返回 [{index:1, word_ids:[...], word_count:n}, ...]"""

async def get_group_words(db, unit_id: int, group_index: int) -> list[Word]:
    """按 unit_words.order_index 切片；越界抛 ValueError"""

async def get_scope_words(db, scope_type, book_id, unit_id, group_index) -> list[Word]:
    """统一入口：根据 scope_type 派发到 book/unit/group 三种分支"""

def validate_scope(scope_type, unit_id, group_index) -> None:
    """422 校验：book→unit/group 必须 NULL；group→两者必须非空"""
```

### 5.2 `api/v1/teacher/_permissions.py`（新）

```python
async def get_my_class_student_ids(db, teacher_id) -> set[int]
async def assert_student_in_my_class(db, teacher_id, student_id)  # 不在则 403
```

## 6. API 设计

### 6.1 教师端 — 单词本分配

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/teacher/books/{book_id}/units` | 单元列表 + 每单元分组数 |
| GET | `/api/v1/teacher/units/{unit_id}/groups` | 该单元的分组（每组 word_ids 预览） |
| POST | `/api/v1/teacher/book-assignments/assign` | body 加 `scope_type/unit_id/group_index` |
| GET | `/api/v1/teacher/book-assignments` | 列表，`?student_id=&class_id=&scope_type=` |
| DELETE | `/api/v1/teacher/book-assignments/{id}` | 撤销 |

请求体示例：
```json
{
  "scope_type": "group",
  "book_id": 12,
  "unit_id": 45,
  "group_index": 2,
  "student_ids": [101, 102, 103],
  "deadline": "2026-05-15"
}
```

### 6.2 教师端 — 作业

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/teacher/homework` | body 加 `group_index`（null=整单元） |
| GET | `/api/v1/teacher/homework` | 现有，列表 |
| GET | `/api/v1/teacher/homework/{id}/progress` | 完成情况 |

### 6.3 教师端 — 班级与学生监控

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/teacher/classes` | 本教师班级 |
| GET | `/api/v1/teacher/classes/{id}/students?q=` | 班级学生 + 模糊搜索 |
| POST | `/api/v1/teacher/classes/{id}/students` | 加入（学生须无 active 班级，否则 409） |
| DELETE | `/api/v1/teacher/classes/{id}/students/{sid}` | 移出（is_active=False） |
| GET | `/api/v1/teacher/students/{id}/groups` | 学生所有已学组聚合成绩 |
| GET | `/api/v1/teacher/students/{id}/groups/{unit_id}/{group_index}/words` | 组内单词对错明细 |

`/students/{id}/groups` 响应示例：
```json
[{
  "unit_id": 45, "unit_name": "Unit 3: Animals",
  "group_index": 1, "word_count": 10,
  "learned_count": 10, "mastered_count": 8,
  "accuracy": 0.85, "last_studied_at": "2026-04-28T10:00:00"
}]
```

### 6.4 教师端 — 班级数据分析

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/teacher/analytics/class/overview` | **修 bug**：按当前教师的班级学生过滤 |
| GET | `/api/v1/teacher/classes/{id}/overview` | 单班聚合 |
| GET | `/api/v1/teacher/classes/{id}/assignments-progress` | 本班所有分配 / 作业完成度 |
| GET | `/api/v1/teacher/classes/{id}/word-completion` | 每单词被多少学生掌握 |

### 6.5 管理员端

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/admin/teachers` | 教师列表 + 概况 |
| GET | `/api/v1/admin/teachers/{id}` | 教师详情 + 名下班级 |
| GET | `/api/v1/admin/teachers/{id}/classes` | 教师的班级 |
| GET | `/api/v1/admin/classes` | 全平台班级（可筛 `teacher_id`） |
| GET | `/api/v1/admin/classes/{id}/overview` | 任意班级聚合 |
| POST | `/api/v1/admin/students/{id}/transfer` | 跨教师转班；body `{new_class_id}`，事务 |
| POST | `/api/v1/admin/teachers` | 创建教师 |
| PATCH | `/api/v1/admin/teachers/{id}` | 改 / 禁用 / 启用 |
| POST | `/api/v1/admin/teachers/{id}/reset-password` | 重置密码 |

新增文件：`app/api/v1/admin/teachers.py`、`app/api/v1/admin/classes.py`。

### 6.6 错误码

| 场景 | 状态码 | 信息 |
|------|--------|------|
| 教师操作非自己班级学生 | 403 | "无权操作该学生" |
| 学生已在某班再加入新班 | 409 | "学生已在班级 X 中，请先转班" |
| scope 参数不合法 | 422 | "scope_type=group 时 group_index 必填" |
| group_index 越界 | 422 | "组序号超出范围（单元共 N 组）" |
| 转班目标班级不存在 | 404 | "目标班级不存在" |

## 7. 前端设计

### 7.1 新组件

- `components/teacher/ScopeSelector.tsx`：三步级联（Book → Unit → Group）；输出 `{scope_type, book_id, unit_id?, group_index?}`，被分配页与作业页复用。
- `components/admin/TransferStudentDialog.tsx`：选目标班级 + 确认转班。

### 7.2 教师端页面

- `pages/teacher/AssignBook.tsx`：嵌 ScopeSelector + 选学生 + 截止日期。
- `pages/teacher/CreateHomework.tsx`：嵌 ScopeSelector（隐藏 Book 粒度选项）。
- `pages/teacher/ClassDetail.tsx`：班级信息 + 学生列表 + **搜索框**。
- `pages/teacher/StudentMonitor.tsx`（新）：学生概览卡 + 按组成绩列表，点击展开调用单词明细 API。
- `pages/teacher/ClassAnalytics.tsx`：替换为按 class_id 的新接口；新增"班级单词完成"图表与"作业完成进度"表。

### 7.3 管理员端页面（新）

- `pages/admin/TeacherList.tsx`：表格 + 创建 / 禁用。
- `pages/admin/TeacherDetail.tsx`：教师信息 + 名下班级。
- `pages/admin/ClassDetail.tsx`：复用教师端展示组件。

### 7.4 API 客户端

`frontend/src/api/`：
- `teacherAssignments.ts`、`teacherMonitor.ts`、`admin.ts`。

## 8. 测试策略

### 8.1 后端（pytest + httpx）

| 文件 | 关键用例 |
|------|---------|
| `test_scope_service.py` | 切组正确；group_size=0 走默认；越界抛错 |
| `test_class_membership.py` | 一学生不能加两班；转班保留历史；唯一索引生效 |
| `test_book_assignments.py` | 三种 scope；scope=group 时 group_index 必填；非本班 403 |
| `test_homework_assignments.py` | group_index 校验；越界 422 |
| `test_teacher_monitor.py` | q= 搜索；非本班学生 403；按组聚合数值 |
| `test_admin_teachers.py` | 列表 / 详情 / 转班事务原子性；非 admin 403 |

### 8.2 前端

本期手动测试为主（项目尚无前端测试基础设施）。手动用例记录在本 spec 附录 A。

### 8.3 迁移验证

- 迁移幂等；提供 `verify_migration.sql` 检查字段、约束、旧数据条数。
- 备份 `english_helper.db` 后执行；本地通过再合并。

### 8.4 回归

- 旧 `BookAssignment`（迁移后 `scope_type='book'`）行为完全等同迁移前；
- 旧 `homework_assignments.group_index=NULL` 等同"整单元作业"。

## 9. 实施顺序建议（供 writing-plans 参考）

1. 数据迁移脚本 + 模型字段
2. `scope_service.py` + 单元测试
3. `_permissions.py` + 修复 `analytics.py` 的 teacher_id 过滤
4. 改造 `book_assignments` API（含三级粒度）
5. 改造 `homework` API
6. 教师班级 / 学生监控 API（搜索、按组成绩、下钻）
7. 班级数据分析 API（含修 bug 与新增）
8. 管理员 API（teachers + classes + 转班）
9. 前端：ScopeSelector → 分配页 → 作业页
10. 前端：班级管理 / 学生监控 / 班级分析改造
11. 前端：管理员页
12. 端到端联调与回归

## 10. 风险与缓解

| 风险 | 缓解 |
|------|------|
| SQLite 重建 `book_assignments` 期间崩溃 | 迁移在事务中执行；执行前手动备份 db 文件 |
| `Unit.group_size` 后期被改动导致旧分配的 `group_index` 失效 | 校验：`group_index` 必须在当前 `get_unit_groups()` 范围内；越界时学生侧降级显示并提醒教师重新分配 |
| 教师误操作把学生移出班级 | 软删除（is_active=False），可由教师 / 管理员恢复 |
| 多教师同时分配给同一学生 | 由唯一约束 `(book_id, student_id, scope_type, unit_id, group_index)` 阻止重复 |

## 附录 A — 前端手动测试用例（节选）

1. ScopeSelector：选 Book → 单元下拉显示；选 Unit → 组下拉显示；切换 Book 时下游清空。
2. 分配 group 后未填 group_index → 前端禁用提交按钮并提示。
3. 学生监控：搜索框输入两个字符即触发；清空恢复全量。
4. 学生组成绩：点击行展开下钻，加载中显示骨架屏；接口失败显示重试。
5. 管理员转班：列表内点"转班"→ 选目标班级 → 确认；成功后该学生从原班列表消失。
