# 分类记忆法 PK 竞技场 — 设计文档

- 日期：2026-05-24
- 模块：学生端 · 分类记忆法 PK 系统
- 状态：设计稿（待批准）

## 1. 目标与范围

在现有"分类记忆法" 5 阶段流程（分类 → 语音 → 听写 → 过关 → 总结）的基础上，新增**邀请制多人房 + 全程实时 lock-step**的 PK 玩法。

### 范围（首版）

- 邀请制多人房：2-6 人，房主创建房、生成 6 位邀请码，玩家凭码加入；自然覆盖"同班"和"跨平台"两种对手来源。
- 题目级 lock-step：双方看到同一题，等齐双方答案后服务端推送下一题。
- 5 阶段全程 PK：分类 / 语音 / 听写 / 过关都纳入 PK，每阶段由统一同步引擎驱动。
- 评分排名：按 (准确率, 总用时) 排出 1-N 名，结算后落库归档。
- Dashboard 新增"PK 竞技场"独立入口。

### 不在首版范围

- 段位 / ELO / 实力分匹配（一期不做）
- 随机匹配队列（仅邀请制）
- 公开排行榜（一期只有自己的 PK 历史）
- 同步实时语音对战（语音校验前端识别后送结果，不传音频流）
- 进程崩溃恢复（活跃房间在内存，崩溃即丢，前端提示重开）

## 2. 整体架构

```
浏览器 ──WS──> FastAPI WebSocket 端点
              │
              ├──> pk_room_manager (内存 dict)
              ├──> pk_sync_engine (lock-step 状态机)
              └──> pk_score_calculator
                          │
                          └─结算后──> SQLite 归档
```

### 组件清单（每个独立可测）

后端：

- `pk_room_manager.py`：房间生命周期（创建 / 加入 / 退出 / 推进状态）。
- `pk_websocket.py`：WebSocket 端点，鉴权、连接、消息路由。
- `pk_sync_engine.py`：题目级 lock-step 引擎；下题、收答、结算、推进。
- `pk_score_calculator.py`：评分公式与排名。
- `pk_routes.py`：REST 端点（建房 / 入房查询 / 历史战绩）。
- `models/pk.py`：SQLAlchemy 模型。
- `schemas/pk.py`：Pydantic schemas。

前端：

- `pages/StudentDashboard.tsx`（已有，仅追加入口卡片）：跳转 `PkLobby`。
- `pages/PkLobby.tsx`：大厅、创建 / 加入 / 准备。
- `pages/PkArena.tsx`：PK 主页面，5 阶段状态机。
- `components/pk/PkPlayerList.tsx`：玩家列表 + 进度条。
- `components/pk/PkLiveProgress.tsx`：顶栏对手进度。
- `components/pk/PkResultBoard.tsx`：结算页。
- `components/pk/PkInviteModal.tsx`：邀请码弹窗。
- `hooks/usePkSocket.ts`：WS 封装（连接 / 心跳 / 重连 / 消息派发）。
- `api/pk.ts`：REST 客户端。

### 与现有代码的关系

- 不动 `WordClassifyLearning.tsx` 单人流程。
- 5 阶段子组件（`ClassificationPhase` / `SpeechVerifyCard` / `DictationPhase` / `GroupExamPhase`）增加可选 `mode?: 'solo' | 'pk'` 与受控接口。`solo` 模式行为零变化；`pk` 模式下由父组件传入 `currentWord` 并通过 `onAnswer` 回调上报。

### 设计决策

- **WebSocket** 选 FastAPI 原生而非 Socket.IO：不引新依赖，与项目"零外部通信库"风格一致，控制力更强。
- **房间状态在进程内存**而非 Redis：项目目前单进程 uvicorn 运行，远端虽有 Redis 容器但本项目未使用；内存方案零依赖、调试简单、内存占用极低（每房约几 KB）。后续若扩容多 worker 再升级 Redis，迁移点仅在 manager 层。
- **崩溃恢复不做**：PK 局只有几分钟，崩溃概率低，影响面是"那一局重开"，可接受。

## 3. 数据模型

### 3.1 SQLite 持久化（3 张新表）

加在 `database_schema.sql` 末尾，对应一份 migration 脚本（沿用 `run_migration.py` 模板）。

```sql
-- PK 房间归档
CREATE TABLE pk_rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invite_code VARCHAR(6) UNIQUE NOT NULL,
    host_id INTEGER NOT NULL REFERENCES users(id),
    unit_id INTEGER NOT NULL REFERENCES units(id),
    max_players INTEGER NOT NULL DEFAULT 4
        CHECK(max_players BETWEEN 2 AND 6),
    status VARCHAR(10) NOT NULL,  -- waiting/playing/finished/abandoned
    word_ids TEXT NOT NULL,        -- JSON 快照,防教师中途改 unit
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP,
    finished_at TIMESTAMP
);
CREATE INDEX idx_pk_rooms_invite ON pk_rooms(invite_code);
CREATE INDEX idx_pk_rooms_status ON pk_rooms(status);

-- 玩家最终成绩
CREATE TABLE pk_room_players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL REFERENCES pk_rooms(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    rank INTEGER,
    accuracy DECIMAL(5,2),
    total_time_ms INTEGER,
    correct_count INTEGER,
    wrong_count INTEGER,
    final_score INTEGER,
    is_disconnected BOOLEAN DEFAULT 0,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(room_id, user_id)
);

-- 每题答题流水(防作弊 + 复盘)
CREATE TABLE pk_answer_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL REFERENCES pk_rooms(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    word_id INTEGER NOT NULL REFERENCES words(id),
    phase VARCHAR(20) NOT NULL,
    is_correct BOOLEAN,
    time_spent_ms INTEGER,
    answered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_pk_records_room ON pk_answer_records(room_id);
```

### 3.2 进程内存状态

```python
@dataclass
class PlayerState:
    user_id: int
    nickname: str
    ws: WebSocket | None        # None = 掉线
    online: bool
    joined_at: datetime
    correct: int = 0
    wrong: int = 0
    total_time_ms: int = 0
    current_word_idx: int = 0   # 全局题号
    finished: bool = False

@dataclass
class RoomState:
    room_id: int
    invite_code: str
    host_id: int
    unit_id: int
    max_players: int
    status: Literal["waiting", "playing", "finished"]
    word_ids: list[int]
    current_phase: Literal[
        "classify", "speech", "dictation", "exam", "summary"]
    current_word_idx: int        # 全局题号(跨 phase 不重置)
    players: dict[int, PlayerState]
    answers: dict[int, dict[int, AnswerRecord]]  # word_idx -> {uid: ans}
    started_at: datetime | None

ROOMS: dict[int, RoomState] = {}
INVITE_INDEX: dict[str, int] = {}    # invite_code -> room_id
USER_ACTIVE: dict[int, int] = {}     # user_id -> room_id
```

### 3.3 关键规则

1. **开局快照 word_ids**：建房时冻结 unit 当前 word_id 列表存库。教师中途改 unit 不影响进行中 PK。
2. **PK 答题不计入个人 `word_mastery` / `learning_records`**：避免学生因 PK 紧张被惩罚日常掌握度。PK 战绩独立沉淀。
3. **同一学生只能在一房**：`USER_ACTIVE` 反查，进入新房前先检查；旧 WS 主动断开。
4. **结束才落库**：`waiting`/`playing` 全程在内存；状态变 `finished` 时一次性写入 3 张表。

## 4. 同步引擎与 WebSocket 协议

### 4.1 统一 lock-step 语义

5 阶段中只有"听写""过关"天然就是逐词答题；"分类"原本是把多个词拖到分类筐、"语音"逐词朗读。PK 模式下统一为"一题一锁步"：

每一个 (word, phase) 视为一个对局题目。引擎只关心三件事：

1. **下发题目**（`question_pushed` 广播给所有玩家）
2. **收齐答案**（每个玩家提交 `answer_submitted`，全员到齐 → 触发结算）
3. **结算并推进**（`question_settled` 广播每人对错+用时；推进 `current_word_idx`，重复 1）

每个 phase 提供一个适配器：

| Phase | 一题的内容 | 玩家提交什么 | 跳过策略 |
|---|---|---|---|
| `classify` | 一个词 | `familiar` / `semi` / `unknown` 之一 | 不可跳，超时记错 |
| `speech` | 一个词 | `pass` / `skip`（前端识别后送结果） | 跳过即记错 |
| `dictation` | 一个词 | 文本输入 | 不可跳，超时记错 |
| `exam` | 一道选择题 | 选项编号 | 不可跳，超时记错 |

phase 切换由引擎自动：当前 phase 全部词答完，自动推进到下一 phase（`phase_advanced` 广播）。

### 4.2 WebSocket 消息协议

客户端 → 服务端：

```json
{"type":"join_room","invite_code":"ABC123"}
{"type":"start_game"}
{"type":"kick_player","user_id":42}
{"type":"submit_answer","word_idx":3,"phase":"classify",
 "payload":{"category":"familiar"},"time_spent_ms":2400}
{"type":"heartbeat"}
{"type":"leave_room"}
```

服务端 → 客户端：

```json
{"type":"room_state","room":{...}}
{"type":"question_pushed","word_idx":3,"phase":"classify","word":{...}}
{"type":"player_answered","user_id":42,"word_idx":3}
{"type":"question_settled","word_idx":3,
 "results":{"42":{"is_correct":true,"time_spent_ms":2100},...}}
{"type":"phase_advanced","new_phase":"dictation"}
{"type":"player_disconnected","user_id":42}
{"type":"player_reconnected","user_id":42}
{"type":"player_kicked","user_id":42}
{"type":"host_changed","new_host_id":42}
{"type":"game_finished","ranking":[...]}
{"type":"error","code":"ROOM_FULL","message":"..."}
```

### 4.3 边界规则（已确认）

| 规则 | 取值 | 说明 |
|---|---|---|
| 逐题超时 | classify 20s / speech 25s / dictation 60s / exam 30s | 服务端定时器到期自动给未答玩家记错 + 等同时长 |
| 心跳 | 客户端 15s/次，服务端 30s 无心跳判离线 | UI 仅作提示，真实判定在服务端 |
| 重连窗口 | 90s | 超出则视为弃赛，已答题保留，未答题全部记错 |
| 同 user 多端 | 旧 WS 主动断开，新 WS 接管 | 防同账号双开作弊 |
| 重复提交 | `answers[word_idx][user_id]` 已存在则丢弃 | 防 race |
| 房主中途退 | 按加入顺序自动转移 | 全员退则房间废弃 |
| 房主权限 | 开始游戏 + 踢人 | 不提供"提前结束"（超时 + 弃赛已 cover）|
| 教师中途改 unit | 不影响进行中 PK | 开局 word_ids 已快照 |

### 4.4 评分公式

```
final_score = correct_count × 100 - total_time_ms / 100
```

每对一题 +100，每多用 100ms -1。准确率优先，速度次之。同分按总用时短者胜。`accuracy = correct / total_questions × 100`，仅展示用。

## 5. 前端集成

### 5.1 复用现有 5 阶段组件

不复制 PK 版组件。每个 5 阶段子组件加可选 `mode?: 'solo' | 'pk'` 与受控接口；`solo` 模式行为零变化。

| 组件 | 单人模式 | PK 模式新增 |
|---|---|---|
| `ClassificationPhase` | 内部维护当前词、批量提交 | 通过 prop 接受 `currentWord`，触发 `onAnswer(category)` |
| `SpeechVerifyCard` | 已是逐词组件 | 加 `disabled` prop（等对手时禁用按钮） |
| `DictationPhase` | 内部循环出题 | 拆出 `DictationSingle` 单题变体 |
| `GroupExamPhase` | 内部循环 | 拆出 `ExamSingle` 单题变体 |

### 5.2 状态机

`PkArena.tsx` 维护 PK 主状态：`idle → in_lobby → playing → settling → finished`。每个 WS 事件触发状态/UI 更新。`usePkSocket` 封装连接、心跳、重连、消息派发，UI 层只关心事件回调。

## 6. 错误处理

| 错误场景 | 处理 |
|---|---|
| 邀请码不存在 / 房间满 / 已开始 | REST 4xx + 错误码 |
| WS 鉴权失败 | 关 WS 并发 `error` 帧 |
| 玩家网络抖动 | 30s 无心跳标记 offline，90s 内重连恢复，超过 90s 弃赛 |
| 玩家关页面 | WS `onclose` 走掉线流程 |
| 提交超时 | 服务端定时器到期自动记错，触发结算 |
| 服务重启 | 内存房间清空，前端 WS 断开后显示"房间已关闭" |
| 同 user 多端 | 旧 WS 主动断开，新 WS 接管，前端给提示 |
| 重复提交 | 已存在则丢弃 |
| 教师中途改 unit | 不影响（开局快照） |

## 7. 测试策略

| 层 | 工具 | 重点 |
|---|---|---|
| 单元（后端） | pytest | sync engine 状态机、score calculator 排名、超时定时器边界、并发提交锁 |
| 集成（后端） | pytest + httpx + WS test client | 完整一局：建房 → 加入 → 开始 → 走完 5 阶段 → 落库 |
| 多人集成 | pytest 模拟 3 个 WS 连接 | lock-step 等齐、掉线重连、踢人 |
| 前端组件 | Vitest + RTL | 5 阶段组件 `mode='pk'` 受控行为 |
| E2E | 手动（首版）/ Playwright（二期） | 双浏览器开 PK |

优先级：sync engine + score calculator 必须有单元测试；一局完整流程必须有集成测试；前端测试覆盖受控接口；E2E 一期手动验证。

## 8. 部署影响

- 后端 `requirements.txt` 已有 `redis>=5.0.1`，本期不引新依赖。
- `database_schema.sql` 加 3 张表 + 一份 migration 脚本。
- nginx 需透传 `Upgrade` header（远端默认配置已支持，上线时验证）。
- uvicorn 仍单进程运行；后续多 worker 时 manager 层升级到 Redis。

## 9. 后续期次（不在首版）

- 段位 / ELO / 实力分匹配
- 随机匹配队列
- 公开排行榜 / 班级 PK 周榜
- 实时语音对战（传音频流）
- 多 worker 部署 + Redis Pub/Sub
- 防作弊增强（设备指纹、答题节奏分析）

## 10. 评审清单（落地前 self-check）

- [x] 占位符：无 TBD / TODO
- [x] 内部一致：组件清单、消息协议、表结构互相对应
- [x] 范围聚焦：单一实现 plan 覆盖；后续期次明确剥离
- [x] 歧义检查：超时数值、重连窗口、评分公式皆已具体化
