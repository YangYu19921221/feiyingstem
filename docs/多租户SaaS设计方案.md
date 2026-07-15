# 多租户 SaaS 改造设计方案

> 目标:把单机构系统改造成多租户 SaaS 平台,每个加盟机构 = 一个租户(organization),
> 数据强隔离、配额可计费、平台可运营。
> 设计基线:2026-07-15,本地代码已与线上对齐(线上热修已拉回)。

---

## 0. 设计总原则

1. **单库 + org_id 行级隔离**(不搞每租户一库):平台词库要全租户共享、管理后台要跨租户统计、SQLite 单文件不适合分裂。
2. **最少加列**:69 张表里只给 ~9 张"锚点表"加 org_id,其余全部经 `users.org_id` 或创建者链路推导隔离。
3. **不改 JWT、不强制重登**:现有 token 只有 `{sub, username}`,且 `_authenticate_token` 每请求都回库加载 User(auth.py:24)——org 上下文直接从 `user.org_id` 取,现网用户无感。
4. **迁移零停机**:沿用 `init_db()` 的幂等 try/except ALTER TABLE 模式(core/database.py),先发兼容代码,回填默认机构,再开隔离开关。
5. **隔离是默认,共享是例外**:排行榜、PK、词库可见性默认机构内;跨机构联赛留作平台级增值功能。

---

## 1. 租户模型

### 1.1 organizations 表(新)

```sql
CREATE TABLE IF NOT EXISTS organizations (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          VARCHAR(100) NOT NULL,           -- 机构名称
    code          VARCHAR(16) UNIQUE NOT NULL,     -- 机构码(注册/测评链接用,如 KM001)
    plan          VARCHAR(20) DEFAULT 'standard',  -- trial/standard/county/city(对应加盟档位)
    student_quota INTEGER DEFAULT 100,             -- 学生账号配额(加盟方案:标准档100)
    ai_quota_json TEXT,                            -- AI限额覆盖配置(NULL=用全局默认)
    contact_name  VARCHAR(50),
    contact_phone VARCHAR(20),
    status        VARCHAR(20) DEFAULT 'active',    -- active/suspended/expired
    expires_at    DATETIME,                        -- 年费到期时间,过期→suspended
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

- **org_id = 1 固定为「直营(雪域飞鹰)」**,现有全部数据回填到它,散户学生也归它。
- `status != 'active'` 时:该机构老师/学生登录提示"机构服务已到期",只读不可学(给续费缓冲,不删数据)。

### 1.2 用户归属规则

- `users.org_id INTEGER DEFAULT 1`(新列,NOT NULL 语义,默认直营)。
- **学生**:公开注册时归直营(org=1);通过**班级邀请码**入班时,若学生仍是"未被认领"状态(org=1 且在直营无活跃班级),自动转入老师所属机构。已属其他机构的学生不能加入别家班级(报错,走教师端转移流程)。
- **老师**:由机构管理员或平台 admin 创建,创建时带 org_id;不开放老师自注册。
- **家长**:绑定孩子时继承孩子的 org_id。
- **角色扩展**:`UserRole` 增加 `org_admin`(机构管理员,管本机构的老师/学生/统计);
  原 `admin` = 平台管理员,`org_id=1` 但拥有跨租户权限(见 §3)。

---

## 2. 69 张表的隔离策略(全量分类)

### A 类:加 org_id 列(9 张锚点表)

| 表 | org_id 语义 | 说明 |
|---|---|---|
| `users` | 用户归属机构 | **核心锚点**,一切用户数据经它隔离 |
| `word_books` | NULL=平台共享词库,非NULL=机构自建 | 可见性 = 平台库 ∪ 本机构库 |
| `sentence_books` | 同上 | 句子本 |
| `reading_passages` | 同上 | 阅读文章 |
| `competition_question_sets` | 同上 | 竞赛题库(competition_questions 经 set_id 推导) |
| `assessment_leads` | 线索归属机构 | **现在无归属字段,全机构混池,必须加**(models/assessment.py) |
| `classes` | 冗余自 teacher.org_id | 高频查询降 JOIN + 防跨机构挂班 |
| `pk_rooms` | 房间归属机构 | 大厅列表/匹配按机构圈 |
| `leaderboard_snapshots` | 榜单快照按机构分 | 快照键加 org 维度 |

### B 类:经 users.org_id 推导,不加列(用户行为数据,~40 张)

`user_achievements, daily_checkins, study_calendar, study_sessions, learning_records,
learning_progress, word_mastery, challenge_reviews, challenge_rankings, user_pets,
pet_battles, pet_battle_rounds, pet_battle_stats, pet_event_logs, user_scores,
weekly_reports, answer_records, ai_quiz_records, group_exam_records, exam_submissions,
exam_answers, parent_student_links, parent_bind_codes, reading_attempts, reading_progress,
question_answers, pk_answer_records, pk_room_players, pk_tournament_players, unit_challenges...`

这些表全部有 user_id(或经房间/比赛挂到用户),现有代码本来就按"当前用户"查,
天然隔离。**不加列、不改查询**。

### C 类:经创建者/父表推导,不加列(教学内容子表,~15 张)

`units, unit_words, book_words, book_assignments, redemption_codes, class_students,
class_invite_codes, homework_assignments, homework_student_assignments,
homework_attempt_records, exam_papers, exam_questions, sentence_units, sentences,
reading_questions, reading_vocabulary, reading_assignments, competition_questions,
competition_question_options, question_options, question_set_items, pk_tournaments,
pk_tournament_matches, competition_seasons`

经 `word_books.org_id` / `classes.org_id` / `teacher.org_id` 链路隔离。
教师端接口已有"只能操作自己的班/本"的权限检查(`_permissions.py`),继续复用。

### D 类:全局共享,永不隔离(~7 张)

`words, word_definitions, word_tags`(词条本体,被各机构单词本引用)、
`achievements`(成就定义)、`ai_providers`、`system_configs`、`ai_cache`。

---

## 3. 租户上下文与强制隔离

### 3.1 请求链路

```python
# auth.py 新增依赖(在 _authenticate_token 之上,零额外查询)
class OrgContext:
    org_id: int          # 当前用户机构
    is_platform_admin: bool  # 平台admin可跨租户

async def get_org_context(user: User = Depends(get_current_user)) -> OrgContext:
    if user.role == "admin":                    # 平台管理员
        return OrgContext(org_id=user.org_id, is_platform_admin=True)
    org = await get_org_cached(user.org_id)     # 进程内缓存,5分钟TTL
    if org.status != "active":
        raise HTTPException(402, "机构服务已到期,请联系管理员续费")
    return OrgContext(org_id=user.org_id, is_platform_admin=False)
```

### 3.2 全局安全网(防漏最关键的一步)

用 SQLAlchemy `do_orm_execute` 事件 + `with_loader_criteria`,对 A 类 9 个模型
自动注入 `WHERE org_id = :current`(经 ContextVar 传递当前请求的 org_id):

```python
# core/tenancy.py(新)
current_org_id: ContextVar[int | None] = ContextVar("current_org_id", default=None)

@event.listens_for(AsyncSessionLocal.sync_session_class, "do_orm_execute")
def _add_tenant_filter(execute_state):
    org_id = current_org_id.get()
    if org_id is None or execute_state.is_column_load or execute_state.is_relationship_load:
        return  # admin跨租户/系统任务不注入
    for model in TENANT_MODELS:  # users/word_books/... 9个
        execute_state.statement = execute_state.statement.options(
            with_loader_criteria(model, lambda cls: or_(
                cls.org_id == org_id,
                cls.org_id.is_(None) if cls in SHARED_NULLABLE else false()
            ), include_aliases=True))
```

- 中间件在认证后 `current_org_id.set(ctx.org_id)`,平台 admin 设 None(不过滤)。
- 这样即使某个接口忘了手写过滤,**默认也漏不出去**;手写过滤照写(双保险+可读性)。
- 词库类(word_books 等)的准入是 `org_id == 当前 OR org_id IS NULL`(平台共享库)。

### 3.3 写入侧防串

- 创建 word_books/classes/线索等时,org_id 一律从 OrgContext 取,**不信任请求体**。
- 跨表引用校验:入班(student.org == class.org)、分配单词本(book.org in {NULL, teacher.org})、
  家长绑定(parent.org := student.org)。

---

## 4. 逐功能改造点(精确到位置)

| 功能 | 现状 | 改法 |
|---|---|---|
| 排行榜 | `_resolve_scope` global 返回 `allowed=None`=全平台(student/leaderboard.py:64) | `None` → 本机构全部学生 id 集(或三个 `_rows` 查询 JOIN users 加 org 过滤);"全平台榜"改名"全机构榜" |
| 词库列表 | `WordBook.is_public == True` 一刀切(words.py:135);progress.py:609 无条件全查 | 改为 `(org_id IS NULL AND is_public) OR org_id = ctx.org` |
| PK 大厅/匹配 | 房间全局可见可加入 | pk_rooms.org_id,大厅列表/加入校验按机构;邀请码加入也校验同机构 |
| 晋级赛 | 教师建赛圈自己学生 | 天然隔离,仅加"参赛者必须同机构"断言 |
| 宠物对战 | 对手是算法生成 + 好友对战 | 好友对战限同机构;AI 对战不涉及 |
| 招生测评 | 线索无归属(assessment.py) | 测评链接带机构码 `/assess?org=KM001` → 线索落对应机构;无码归直营。教师端线索列表按 org 过滤 |
| 教师端全部 | `_permissions.py` 按班级圈学生 | 保持,叠加 org 断言(防止历史脏数据跨机构) |
| 管理后台 | 单视角统计(admin/statistics.py) | 平台 admin:机构列表+每机构学生数/活跃/AI用量/配额水位;新增机构 CRUD、开户、续费、停复用 |
| 机构管理员(新) | 无 | org_admin 角色:管本机构老师账号、看本机构统计、领机构码;复用教师端页面框架 |
| 注册/入班 | 公开注册→散户;班级邀请码入班 | 注册可选填机构码直接归属;入班时未认领学生自动转入老师机构 |
| 周报/学情 | 按学生/班级 | 天然隔离,不动 |

---

## 5. 配额与计费(对接加盟方案)

### 5.1 学生配额

- 计费口径:**机构内活跃学生数**(有活跃班级关系的学生,`class_students.is_active`)。
- 入班时校验:`当前活跃学生数 >= org.student_quota` → 提示"机构学生名额已满,请联系机构管理员扩容"(对应加盟方案"超出 ¥60/生/年",线下收费后 admin 调大 quota,起步期不做在线支付)。
- 平台 admin 后台可看每机构配额水位,做续费提醒。

### 5.2 AI 限额(与加盟方案承诺的额度一致)

新表 `ai_usage(id, org_id, user_id, feature, tokens, created_at)` + 计数查询(带索引)。
默认限额(org.ai_quota_json 可按机构覆盖):

| 功能 | 限额 | 挡点位置 |
|---|---|---|
| explain_mistake 错因讲解 | 每生每日 20 次 | ai_service 入口 |
| generate_personalized_exam 组卷 | 每师每日 10 份 | 同上 |
| generate_competition_question | 每师每月 200 题 | 同上 |
| 测评深度报告 | 每机构每月 500 份 | assessment 提交处 |
| 周报 | 每生每周 1 份(已有缓存,补挡板) | weekly_report |

超限返回 429 + 友好文案。**这同时补上了系统当前 AI 零限流的洞。**

---

## 6. 迁移与上线(零停机)

### P1 地基(先发,现网零行为变化)

1. `init_db()` 追加幂等迁移(沿用现有 try/except 模式):
   ```sql
   CREATE TABLE IF NOT EXISTS organizations (...);
   INSERT OR IGNORE INTO organizations(id,name,code,student_quota) VALUES (1,'雪域飞鹰(直营)','HQ001',999999);
   ALTER TABLE users ADD COLUMN org_id INTEGER DEFAULT 1;          -- 其余8张同理
   UPDATE users SET org_id = 1 WHERE org_id IS NULL;
   CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);
   ```
2. OrgContext 依赖 + ContextVar 中间件上线,但**过滤器只记日志不拦截**(观察一周,确认没有误伤)。
3. 同步线上:整包 rsync backend/app(基线已对齐,不再走 anchor patch)+ `systemctl restart english-helper`。

### P2 隔离生效

- 打开全局过滤器拦截;改造 §4 列表里的 6 个查询点;写入侧校验上线。
- 验收:建测试机构 org=2,造老师+学生,验证两机构互相看不见(排行榜/词库/线索/PK)。

### P3 商业化

- organizations CRUD 后台页 + org_admin 角色 + 机构码注册/测评链接;
- 配额校验 + ai_usage 限额 + 用量报表。

### 风险与对策

| 风险 | 对策 |
|---|---|
| SQLite 写并发随租户数上升 | 开 WAL(`PRAGMA journal_mode=WAL`,现在没开);>20 机构或写冲突显著时迁 PostgreSQL(SQLAlchemy 语法零改动,数据迁移一次性) |
| 全局过滤器误伤系统任务/定时任务 | ContextVar 默认 None=不过滤;所有后台任务显式设置 org 或跳过 |
| 历史脏数据(孤儿 unit_words 等)跨机构串 | P2 验收专项:跑一遍跨机构数据审计 SQL |
| 老前端缓存(UpdateNudge 已有) | 前端改动走既有 UpdateNudge 提示刷新 |

---

## 7. 前端改动清单(概要)

- **平台 admin**:机构管理页(列表/新建/配额/续费/停用)、机构维度统计切换
- **机构管理员**:老师账号管理、本机构统计、机构码/测评链接领取
- **注册页**:可选"机构码"输入框
- **排行榜**:"全平台" 文案改 "全机构"
- **测评页**:URL 带 org 参数透传
- 学生/老师日常页面:**零改动**(隔离都在后端)
