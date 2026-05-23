# 英雄通关 + 班级光荣榜 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把通关页 emoji 升级为按档随机抽取的原创英雄角色登场，并在学生 Dashboard 显眼位置新增班级光荣榜（满分王 / 速度之王 / 进步之星）。

**Architecture:**
- 8 张 2K 原创角色 PNG 由 `scripts/generate-heroes.py` 一次性调 image2 接口生成，提交进 git，运行时零调用
- 后端给 `users` 表加 `hero_id` 字段（init_db 幂等迁移），新增 `/api/v1/student/class/hall-of-fame` 实时聚合接口
- 前端 `src/utils/hero.ts` 集中管理角色池 + 抽取规则；`VictoryScreen` / `CompletionScreen` / `RewardReveal` / `LiveLeaderboard` 接入；新增 `HallOfFame` 组件挂到 `StudentDashboard_New`

**Tech Stack:** FastAPI + SQLAlchemy 异步 + SQLite · React 18 + TypeScript + Framer Motion + Tailwind · image2 (`https://pikachu.claudecode.love/v1/images/generations`, `model: gpt-image-2`)

**Spec:** [`docs/superpowers/specs/2026-05-23-hero-victory-hall-of-fame-design.md`](../specs/2026-05-23-hero-victory-hall-of-fame-design.md)

---

## File Structure

### 新建
- `scripts/generate-heroes.py` — image2 调用脚本，环境变量读 key，幂等
- `frontend/public/heroes/*.png` — 8 张 PNG（运行脚本后产物）
- `frontend/src/utils/hero.ts` — 角色池常量 + meta + `pickHeroByScore` / `getHeroById`
- `frontend/src/api/hallOfFame.ts` — 接口客户端
- `frontend/src/components/HallOfFame.tsx` — 班级光荣榜组件
- `backend/app/schemas/hall_of_fame.py` — 响应 schema
- `backend/app/services/hall_of_fame_service.py` — 聚合业务逻辑
- `backend/app/api/v1/student/hall_of_fame.py` — 接口路由
- `backend/test_hall_of_fame.py` — 后端聚合测试

### 修改
- `backend/app/models/user.py` — User 类加 `hero_id` Column
- `backend/app/schemas/user.py` — UserResponse 加 `hero_id`
- `backend/app/core/database.py` — `init_db()` 末尾加幂等 ALTER + 回填
- `backend/app/services/auth_service.py` — `create_user` 注册时分配 hero_id
- `backend/app/main.py` — 注册 `hall_of_fame.router`
- `frontend/src/components/classify/VictoryScreen.tsx` — 引入英雄立绘 + 招式特效层
- `frontend/src/pages/CompletionScreen.tsx` — 顶部 hero 横幅换成学生自己的角色
- `frontend/src/components/challenge-fx/RewardReveal.tsx` — 第三幕加角色背景
- `frontend/src/components/LiveLeaderboard.tsx` — 排名靠后段加鼓励位
- `frontend/src/pages/StudentDashboard_New.tsx` — 挂载 HallOfFame

### 不动
- 教师端 / 管理员端 任何文件
- `LiveLeaderboard` 上半部分（仅在底部加鼓励位）
- 现有 emoji / 配色 / 分数滚动 / 错题折叠 等已实现逻辑

---

## Phase 1：后端基础（hero_id 字段 + 注册时分配）

### Task 1: User 模型加 hero_id 字段

**Files:**
- Modify: `backend/app/models/user.py`（User 类，约 22-50 行）

- [ ] **Step 1: 加字段**

在 `User` 类的 `avatar_url = Column(String(255))` 之后加一行：

```python
    avatar_url = Column(String(255))
    hero_id = Column(String(32), nullable=True)  # 英雄角色 ID（注册时分配，用于通关画面与光荣榜立绘）

    # 等级和经验值系统
```

- [ ] **Step 2: 验证 import 不变**

```bash
python -c "from app.models.user import User; print('hero_id' in User.__table__.columns)"
```
（`cd backend` 后运行）
Expected: `True`

- [ ] **Step 3: Commit**

```bash
git add backend/app/models/user.py
git commit -m "feat(model): User 加 hero_id 字段"
```

---

### Task 2: init_db 幂等 ALTER + 回填

**Files:**
- Modify: `backend/app/core/database.py:118` 附近（在 phone 字段迁移之后插入）

- [ ] **Step 1: 在 phone 迁移之后追加 hero_id 迁移**

找到这段代码（约 117-122 行）：

```python
        # 迁移: 为 users 表添加 phone 字段
        try:
            await conn.execute(text(
                "ALTER TABLE users ADD COLUMN phone VARCHAR(20) UNIQUE"
            ))
        except Exception:
            pass
```

紧随其后插入：

```python
        # 迁移: 为 users 表添加 hero_id 字段（英雄角色，通关画面 + 光荣榜立绘）
        try:
            await conn.execute(text(
                "ALTER TABLE users ADD COLUMN hero_id VARCHAR(32)"
            ))
        except Exception:
            pass
        # 回填存量学生的 hero_id（按 id % 8 映射到 8 个角色，保证均匀且幂等）
        try:
            await conn.execute(text(
                "UPDATE users SET hero_id = "
                "CASE (id % 8) "
                "  WHEN 0 THEN 'hero_blaze' "
                "  WHEN 1 THEN 'hero_thunder' "
                "  WHEN 2 THEN 'hero_galaxy' "
                "  WHEN 3 THEN 'hero_sunny' "
                "  WHEN 4 THEN 'hero_wave' "
                "  WHEN 5 THEN 'hero_breeze' "
                "  WHEN 6 THEN 'hero_phoenix' "
                "  WHEN 7 THEN 'hero_dawn' "
                "END "
                "WHERE hero_id IS NULL AND role = 'student'"
            ))
        except Exception:
            pass
```

- [ ] **Step 2: 启动后端验证迁移落库**

```bash
cd backend
uvicorn app.main:app --port 8000 &
sleep 3
sqlite3 english_helper.db "PRAGMA table_info(users);" | grep hero_id
```
Expected: 输出包含 `hero_id|VARCHAR(32)|0||0`

```bash
sqlite3 english_helper.db "SELECT id, role, hero_id FROM users WHERE role='student' LIMIT 5;"
```
Expected: 5 行，每行 hero_id 是 `hero_blaze`/`hero_thunder`/... 之一，非空

```bash
kill %1
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/core/database.py
git commit -m "feat(db): users 表加 hero_id 字段 + 存量学生回填"
```

---

### Task 3: UserResponse schema 暴露 hero_id

**Files:**
- Modify: `backend/app/schemas/user.py:44-59`

- [ ] **Step 1: 加字段**

在 `UserResponse` 类中 `avatar_url: Optional[str] = None` 后面加：

```python
    avatar_url: Optional[str] = None
    hero_id: Optional[str] = None
    phone: Optional[str] = None
```

- [ ] **Step 2: 验证 schema 解析正常**

```bash
cd backend
python -c "from app.schemas.user import UserResponse; print(UserResponse.model_fields['hero_id'])"
```
Expected: 输出包含 `annotation=Optional[str]`

- [ ] **Step 3: Commit**

```bash
git add backend/app/schemas/user.py
git commit -m "feat(schema): UserResponse 暴露 hero_id"
```

---

### Task 4: 注册时随机分配 hero_id

**Files:**
- Modify: `backend/app/services/auth_service.py`（`create_user` 函数）

- [ ] **Step 1: 先打开文件确认 `create_user` 现有签名**

```bash
grep -n "def create_user\|hashed_password\|hero_id" backend/app/services/auth_service.py | head -10
```

- [ ] **Step 2: 在 auth_service.py 顶部加 import**

```python
import random
```
（如果已存在则跳过）

定义角色池常量（放在 import 之后、类/函数之前）：

```python
HERO_POOL = [
    'hero_blaze', 'hero_thunder', 'hero_galaxy',
    'hero_sunny', 'hero_wave', 'hero_breeze',
    'hero_phoenix', 'hero_dawn',
]
```

- [ ] **Step 3: 在 `create_user` 创建 User 实例的地方注入 hero_id**

找到 `User(...)` 实例化处，在参数末尾加：

```python
user = User(
    username=username,
    email=email,
    hashed_password=hashed_password,
    phone=phone,
    role=role,
    full_name=full_name,
    hero_id=random.choice(HERO_POOL) if role == "student" else None,
)
```

如果现有代码用关键字逐个赋值（`user.username = ...`），就在 `db.add(user)` 之前加：

```python
if role == "student" and not user.hero_id:
    user.hero_id = random.choice(HERO_POOL)
```

- [ ] **Step 4: 启动服务并注册一个新学生验证**

```bash
cd backend
uvicorn app.main:app --port 8000 &
sleep 3
curl -s -X POST http://localhost:8000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"hero_test_001","phone":"13800000001","password":"test123","code":""}' | python -m json.tool
```
Expected: 返回 JSON 中 `user.hero_id` 是 8 个角色之一（不为 null）

```bash
kill %1
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/auth_service.py
git commit -m "feat(auth): 注册时为学生随机分配 hero_id"
```

---

## Phase 2：image2 生成脚本 + 8 张 PNG 落地

### Task 5: 写 generate-heroes.py 脚本

**Files:**
- Create: `scripts/generate-heroes.py`

- [ ] **Step 1: 创建脚本**

```python
#!/usr/bin/env python3
"""
一次性生成 8 张 2K 英雄角色立绘并下载到 frontend/public/heroes/

用法：
    IMAGE2_API_KEY=sk-xxx python scripts/generate-heroes.py
    IMAGE2_API_KEY=sk-xxx python scripts/generate-heroes.py --force  # 强制覆盖

要求：API Key 走环境变量 IMAGE2_API_KEY，不写进代码、不入 git。
"""
import os
import sys
import json
import argparse
from pathlib import Path
from urllib.request import Request, urlopen

API_URL = "https://pikachu.claudecode.love/v1/images/generations"
MODEL = "gpt-image-2"
SIZE = "1024x1024"  # image2 当前固定输出 1024，前端 CSS 缩放到全屏
QUALITY = "high"

PROMPT_PREFIX = (
    "Anime-style heroic illustration, vibrant flat colors with soft gradients, "
    "Genshin Impact main visual aesthetic. Front 2/3 view, upper body portrait, "
    "centered composition, dynamic action pose. "
)
PROMPT_SUFFIX = (
    " Full background scene (not transparent), square 1:1 framing, "
    "no text, no logo, no signature, no watermark, "
    "completely original character with no resemblance to any known anime character."
)

HEROES = {
    "hero_blaze":   "Heroic young boy in red and orange battle robes, holding a flaming fist, fiery aura erupting behind him, golden eyes burning with determination, sunset-orange sky background.",
    "hero_thunder": "Heroic young girl in blue and silver armor, charging an electric longsword, lightning bolts circling her body, stormy purple sky background.",
    "hero_galaxy":  "Heroic warrior in purple and gold cape, holding a starlight staff, swirling galaxy and constellations behind, cosmic deep blue background.",
    "hero_sunny":   "Cheerful young student in yellow and orange sportswear, both thumbs up, beaming smile, sunbeam radiance, bright blue sky with clouds.",
    "hero_wave":    "Joyful young boy in blue and green outfit, holding up a golden trophy, water splash effect around him, cyan ocean wave background.",
    "hero_breeze":  "Sweet young girl in pink and white traditional Chinese-fusion outfit, scattering flower petals, cherry blossoms drifting, soft pastel pink background.",
    "hero_phoenix": "Determined young boy in red and gold robes, fist raised forward, ghostly phoenix silhouette flying behind him, eyes full of resolve, ember-glow background.",
    "hero_dawn":    "Warm-hearted young girl in soft amber and rose outfit, hand reaching out as if inviting forward, gentle dawn light rays behind her, sunrise gradient background.",
}


def call_image2(api_key: str, prompt: str) -> str:
    """调 image2 接口，返回图片 URL。失败抛异常。"""
    payload = {
        "model": MODEL,
        "prompt": prompt,
        "size": SIZE,
        "quality": QUALITY,
        "n": 1,
    }
    req = Request(
        API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urlopen(req, timeout=300) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    return body["data"][0]["url"]


def download(url: str, dest: Path) -> None:
    """下载图片到本地，原子写入（先 .tmp 再 rename）。"""
    tmp = dest.with_suffix(dest.suffix + ".tmp")
    with urlopen(url, timeout=120) as resp, open(tmp, "wb") as f:
        f.write(resp.read())
    tmp.rename(dest)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="强制覆盖已存在的图片")
    parser.add_argument("--only", help="只生成指定的 hero_id（逗号分隔）")
    args = parser.parse_args()

    api_key = os.environ.get("IMAGE2_API_KEY")
    if not api_key:
        print("ERROR: 必须设置环境变量 IMAGE2_API_KEY", file=sys.stderr)
        return 1

    repo_root = Path(__file__).resolve().parent.parent
    out_dir = repo_root / "frontend" / "public" / "heroes"
    out_dir.mkdir(parents=True, exist_ok=True)

    targets = HEROES.items()
    if args.only:
        only = set(args.only.split(","))
        targets = [(k, v) for k, v in targets if k in only]

    for hero_id, variant in targets:
        dest = out_dir / f"{hero_id}.png"
        if dest.exists() and not args.force:
            print(f"SKIP {hero_id} (已存在，加 --force 覆盖)")
            continue
        prompt = f"{PROMPT_PREFIX}{variant}{PROMPT_SUFFIX}"
        print(f"GEN  {hero_id} ...", flush=True)
        try:
            url = call_image2(api_key, prompt)
            download(url, dest)
            print(f"OK   {hero_id} -> {dest.relative_to(repo_root)}")
        except Exception as e:
            print(f"FAIL {hero_id}: {e}", file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: 设权限**

```bash
chmod +x scripts/generate-heroes.py
```

- [ ] **Step 3: 用一张图试跑（避免万一 prompt 出问题白烧 8 次）**

```bash
IMAGE2_API_KEY=sk-dc8e1200db582b743359e0c9bdbd348c7bd5ac02c2a9a21b9664782e2ad1b80b \
  python scripts/generate-heroes.py --only hero_blaze
```
Expected: 输出 `OK hero_blaze -> frontend/public/heroes/hero_blaze.png`，文件存在且 > 100KB

```bash
ls -lh frontend/public/heroes/hero_blaze.png
```

- [ ] **Step 4: 跑完剩余 7 张**

```bash
IMAGE2_API_KEY=sk-dc8e1200db582b743359e0c9bdbd348c7bd5ac02c2a9a21b9664782e2ad1b80b \
  python scripts/generate-heroes.py
```
Expected: 7 个 OK + 1 个 SKIP（hero_blaze 已存在）

```bash
ls frontend/public/heroes/
```
Expected: 8 个 .png 文件

- [ ] **Step 5: Commit 脚本 + 8 张 PNG**

```bash
git add scripts/generate-heroes.py frontend/public/heroes/
git commit -m "feat(assets): 8 张原创英雄角色立绘 + image2 生成脚本"
```

---

## Phase 3：前端工具层（角色池 / 抽取 / 元数据）

### Task 6: src/utils/hero.ts

**Files:**
- Create: `frontend/src/utils/hero.ts`

- [ ] **Step 1: 新建文件**

```typescript
/**
 * 英雄角色池 + meta + 抽取工具
 *
 * 8 个原创角色按通关档位分 3 池：
 *   - perfect (100 分)：烈焰 / 雷霆 / 星河
 *   - great   (80-99) ：晴空 / 潮汐 / 微风
 *   - retry   (<80)   ：凤凰 / 黎明
 *
 * 角色与档位的关系是"哪一档抽哪个池"；学生自己的 hero_id 是注册时分配的，
 * 用于光荣榜 / CompletionScreen / RewardReveal 立绘背景。
 */

export type HeroTier = 'perfect' | 'great' | 'retry';

export interface HeroMeta {
  id: string;
  name: string;            // 中文代号，UI 显示
  tier: HeroTier;
  imageUrl: string;        // /heroes/<id>.png
  accentColor: string;     // 主色（光环 / 按钮渐变锚点）
  taglineWin?: string;     // 满分/优秀档登场台词
  taglineEncourage?: string; // retry 池角色 / 排行榜尾段鼓励台词
}

export const HERO_META: Record<string, HeroMeta> = {
  hero_blaze:   { id: 'hero_blaze',   name: '烈焰', tier: 'perfect', imageUrl: '/heroes/hero_blaze.png',   accentColor: '#FF6B35', taglineWin: '炎之拳，所向披靡！' },
  hero_thunder: { id: 'hero_thunder', name: '雷霆', tier: 'perfect', imageUrl: '/heroes/hero_thunder.png', accentColor: '#00D9FF', taglineWin: '雷霆万钧，无人能挡！' },
  hero_galaxy:  { id: 'hero_galaxy',  name: '星河', tier: 'perfect', imageUrl: '/heroes/hero_galaxy.png',  accentColor: '#9B5DE5', taglineWin: '星河璀璨，胜负已定！' },
  hero_sunny:   { id: 'hero_sunny',   name: '晴空', tier: 'great',   imageUrl: '/heroes/hero_sunny.png',   accentColor: '#FFD23F', taglineWin: '今天的你，闪闪发光！' },
  hero_wave:    { id: 'hero_wave',    name: '潮汐', tier: 'great',   imageUrl: '/heroes/hero_wave.png',    accentColor: '#5FD3D3', taglineWin: '势不可挡，再接再厉！' },
  hero_breeze:  { id: 'hero_breeze',  name: '微风', tier: 'great',   imageUrl: '/heroes/hero_breeze.png',  accentColor: '#FF9EC7', taglineWin: '稳稳的进步，最美！' },
  hero_phoenix: { id: 'hero_phoenix', name: '凤凰', tier: 'retry',   imageUrl: '/heroes/hero_phoenix.png', accentColor: '#FF8A65', taglineEncourage: '凤凰浴火重生，你也可以！' },
  hero_dawn:    { id: 'hero_dawn',    name: '黎明', tier: 'retry',   imageUrl: '/heroes/hero_dawn.png',    accentColor: '#FFB088', taglineEncourage: '每个黎明都是新的开始。' },
};

export const PERFECT_POOL = ['hero_blaze', 'hero_thunder', 'hero_galaxy'] as const;
export const GREAT_POOL   = ['hero_sunny', 'hero_wave', 'hero_breeze'] as const;
export const RETRY_POOL   = ['hero_phoenix', 'hero_dawn'] as const;

const FALLBACK_HERO_ID = 'hero_sunny';

/** 按档位从对应池随机抽一个 */
export function pickHeroByScore(score: number): HeroMeta {
  const pool: readonly string[] =
    score >= 100 ? PERFECT_POOL :
    score >= 80  ? GREAT_POOL   :
    RETRY_POOL;
  const id = pool[Math.floor(Math.random() * pool.length)];
  return HERO_META[id];
}

/** 按 id 取 meta；null/未知 id 时返回 fallback */
export function getHeroById(id: string | null | undefined): HeroMeta {
  if (!id) return HERO_META[FALLBACK_HERO_ID];
  return HERO_META[id] ?? HERO_META[FALLBACK_HERO_ID];
}

/** 排行榜尾段鼓励位用：retry 池随机一个 */
export function pickEncourageHero(): HeroMeta {
  const id = RETRY_POOL[Math.floor(Math.random() * RETRY_POOL.length)];
  return HERO_META[id];
}

/** 通关档位到表情/标题的映射（保留 emoji 作为图片加载失败 fallback） */
export const TIER_FALLBACK_EMOJI: Record<HeroTier, string> = {
  perfect: '🏆',
  great:   '🌟',
  retry:   '💪',
};
```

- [ ] **Step 2: TypeScript 编译检查**

```bash
cd frontend
npx tsc --noEmit
```
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add frontend/src/utils/hero.ts
git commit -m "feat(frontend): 角色池 + meta + 抽取工具"
```

---

## Phase 4：通关三处接入（VictoryScreen / CompletionScreen / RewardReveal）

### Task 7: VictoryScreen 接入英雄立绘 + SVG 招式特效

**Files:**
- Modify: `frontend/src/components/classify/VictoryScreen.tsx`

- [ ] **Step 1: 顶部加 import**

在 `import ColoredWord from '../ColoredWord';` 之后加：

```typescript
import { pickHeroByScore, TIER_FALLBACK_EMOJI } from '../../utils/hero';
```

- [ ] **Step 2: 在 VictoryScreen 函数顶部抽角色**

在 `const theme = pickTheme(score);` 之后加：

```typescript
  const tier: 'perfect' | 'great' | 'retry' =
    score >= 100 ? 'perfect' : score >= 80 ? 'great' : 'retry';
  const hero = useMemo(() => pickHeroByScore(score), [score]);
  const [heroImgError, setHeroImgError] = useState(false);
```

注：`useMemo` / `useState` 已有 import，无需额外补。

- [ ] **Step 3: 在背景层渲染 hero（虚化作底）**

找到 `<div className="fixed inset-0 z-40 flex flex-col overflow-y-auto" style={{ background: theme.bgGradient }}>` 这行（约 293 行），在它的内部第一个子元素之前（即 `{!reducedMotion && (` 之前）插入：

```tsx
      {/* 英雄立绘背景层 - 虚化作沉浸底图，加载失败时静默隐藏 */}
      {!heroImgError && (
        <img
          src={hero.imageUrl}
          alt=""
          aria-hidden
          onError={() => setHeroImgError(true)}
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
          style={{ filter: 'blur(12px) saturate(1.3) brightness(0.85)', opacity: 0.35 }}
        />
      )}
```

- [ ] **Step 4: 替换主 emoji 块为英雄立绘**

找到这段（约 329-343 行）：

```tsx
        {/* 主 emoji */}
        <motion.div
          initial={{ scale: 0, y: -200, rotate: -30 }}
          animate={{ scale: 1, y: 0, rotate: 0 }}
          transition={{ type: 'spring', damping: 12, stiffness: 140, delay: 0.1 }}
          className="mb-2"
        >
          <motion.div
            animate={{ y: [0, -16, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            style={{ filter: theme.glow, fontSize: 'clamp(72px, 18vh, 160px)', lineHeight: 1 }}
          >
            {theme.emoji}
          </motion.div>
        </motion.div>
```

替换为：

```tsx
        {/* 英雄立绘登场（图片加载失败回退到 emoji） */}
        <motion.div
          initial={{ scale: 0, y: -200, rotate: -30 }}
          animate={{ scale: 1, y: 0, rotate: 0 }}
          transition={{ type: 'spring', damping: 12, stiffness: 140, delay: 0.1 }}
          className="mb-2 relative"
        >
          <motion.div
            animate={{ y: [0, -16, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            className="relative"
          >
            {!heroImgError ? (
              <img
                src={hero.imageUrl}
                alt={hero.name}
                onError={() => setHeroImgError(true)}
                style={{
                  width: 'clamp(180px, 32vh, 320px)',
                  height: 'clamp(180px, 32vh, 320px)',
                  objectFit: 'cover',
                  borderRadius: '24px',
                  border: `3px solid ${theme.ringColor}`,
                  filter: theme.glow,
                  boxShadow: `0 12px 60px ${theme.ringColor}80`,
                }}
              />
            ) : (
              <div style={{ filter: theme.glow, fontSize: 'clamp(72px, 18vh, 160px)', lineHeight: 1 }}>
                {TIER_FALLBACK_EMOJI[tier]}
              </div>
            )}
          </motion.div>
        </motion.div>
```

- [ ] **Step 5: retry 档加角色鼓励文案**

找到 `{theme.subtitle}` 那个 `<motion.p>`（约 358-365 行），替换为：

```tsx
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
          className="text-white/90 text-sm md:text-base mb-1 text-center px-4"
        >
          {tier === 'retry' && hero.taglineEncourage
            ? hero.taglineEncourage
            : tier !== 'retry' && hero.taglineWin
              ? hero.taglineWin
              : theme.subtitle}
        </motion.p>
```

- [ ] **Step 6: 启动前端，三档各跑一次目测**

```bash
cd frontend
npm run dev
```

手动制造三档（在浏览器开发者工具里改本地 state，或临时往 GroupExamPhase 里塞 `score=100/85/60`）。

Expected:
- 100 分：看到红/蓝/紫某个角色立绘 + 已有 SunRays/Lightning/Confetti
- 85 分：看到黄/绿/粉某个角色立绘 + Confetti
- 60 分：看到凤凰或黎明 + 鼓励台词替代 "再来一次 · 你能行"

- [ ] **Step 7: TypeScript 编译检查 + lint**

```bash
cd frontend
npx tsc --noEmit && npm run lint
```
Expected: 无错误

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/classify/VictoryScreen.tsx
git commit -m "feat(victory): VictoryScreen 接入英雄立绘 + retry 档鼓励台词"
```

---

### Task 8: CompletionScreen 顶部 hero 横幅换成学生自己的角色

**Files:**
- Modify: `frontend/src/pages/CompletionScreen.tsx:206-214`

- [ ] **Step 1: 顶部加 import**

在 `import { useAudio } from '../hooks/useAudio';` 之后加：

```typescript
import { getHeroById } from '../utils/hero';
```

- [ ] **Step 2: 读取学生 hero_id**

`CompletionScreen` 当前从 `localStorage` 拿 user 的方式：先 grep 一下确认。

```bash
grep -n "localStorage\|user_info\|access_token" frontend/src/pages/CompletionScreen.tsx
```

如果没有读 user，就在 `const data = location.state as CompletionData;` 之后加：

```typescript
  const userInfo = (() => {
    try { return JSON.parse(localStorage.getItem('user') || 'null'); }
    catch { return null; }
  })();
  const studentHero = getHeroById(userInfo?.hero_id);
  const [heroImgError, setHeroImgError] = useState(false);
```

注：`useState` 已 import 在第 1 行。`localStorage` 中存学生信息的 key 是 `'user'`（见 `Login.tsx:74`）。

- [ ] **Step 3: 替换 hero 横幅**

找到这段（约 206-214 行）：

```tsx
      <div className="relative overflow-hidden" style={{ height: 200 }}>
        <img src="/hero-completion.jpeg" alt="" className="absolute inset-0 w-full h-full object-cover object-top" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/50" />
        <div className="relative z-10 h-full flex flex-col items-center justify-center text-white">
          <div className="text-5xl mb-2">{isExcellent ? '🎉' : isGood ? '👏' : '💪'}</div>
          <h1 className="text-3xl font-bold drop-shadow-lg">{isExcellent ? '太棒了！' : isGood ? '做得不错！' : '继续加油！'}</h1>
          <p className="text-sm opacity-80 mt-1 drop-shadow">你已完成 {data.modeName} 学习</p>
        </div>
      </div>
```

替换为：

```tsx
      <div className="relative overflow-hidden" style={{ height: 200 }}>
        {!heroImgError ? (
          <img
            src={studentHero.imageUrl}
            alt={studentHero.name}
            onError={() => setHeroImgError(true)}
            className="absolute inset-0 w-full h-full object-cover object-top"
          />
        ) : (
          <img src="/hero-completion.jpeg" alt="" className="absolute inset-0 w-full h-full object-cover object-top" />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/60" />
        {isExcellent && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ boxShadow: `inset 0 0 120px ${studentHero.accentColor}` }}
          />
        )}
        <div className="relative z-10 h-full flex flex-col items-center justify-center text-white">
          <div className="text-5xl mb-2">{isExcellent ? '🎉' : isGood ? '👏' : '💪'}</div>
          <h1 className="text-3xl font-bold drop-shadow-lg">{isExcellent ? '太棒了！' : isGood ? '做得不错！' : '继续加油！'}</h1>
          <p className="text-sm opacity-80 mt-1 drop-shadow">{studentHero.name} · 你已完成 {data.modeName} 学习</p>
        </div>
      </div>
```

- [ ] **Step 4: 编译检查**

```bash
cd frontend
npx tsc --noEmit
```
Expected: 无错误

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/CompletionScreen.tsx
git commit -m "feat(completion): 顶部 hero 横幅换成学生自己的英雄角色"
```

---

### Task 9: RewardReveal 第三幕加角色背景

**Files:**
- Modify: `frontend/src/components/challenge-fx/RewardReveal.tsx`

- [ ] **Step 1: 顶部加 import**

在 `import { useChallengeSfx } from '../../hooks/useChallengeSfx';` 之后加：

```typescript
import { getHeroById } from '../../utils/hero';
```

- [ ] **Step 2: 在组件顶部读 hero**

`export default function RewardReveal({ tier, expGained, coinGained, onComplete }: Props) {` 这行之后、 `const { play } = useChallengeSfx();` 之前插入：

```typescript
  const userInfo = (() => {
    try { return JSON.parse(localStorage.getItem('user') || 'null'); }
    catch { return null; }
  })();
  const hero = getHeroById(userInfo?.hero_id);
  const [heroImgError, setHeroImgError] = useState(false);
```

注：`useState` 已 import 在第 2 行。`localStorage` user key 见 `Login.tsx:74`。

- [ ] **Step 3: 在最外层 div 的内部最前面加角色背景层**

找到 `<div className="fixed inset-0 z-[98] pointer-events-none flex flex-col items-center justify-center">`，把它改为下面的结构（外面包一个 flex 容器，里面 hero 作为绝对定位背景，奖励容器照旧）：

```tsx
    <div className="fixed inset-0 z-[98] pointer-events-none flex flex-col items-center justify-center">
      {/* 学生英雄立绘作为背景（虚化，加载失败静默隐藏） */}
      {!heroImgError && (
        <motion.img
          src={hero.imageUrl}
          alt=""
          aria-hidden
          onError={() => setHeroImgError(true)}
          initial={{ opacity: 0, scale: 1.1 }}
          animate={{ opacity: 0.4, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="absolute"
          style={{
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 'min(420px, 60vw)',
            height: 'min(420px, 60vw)',
            objectFit: 'cover',
            borderRadius: '32px',
            filter: `drop-shadow(0 0 40px ${tierColor})`,
          }}
        />
      )}

      <motion.div
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', damping: 14, stiffness: 200 }}
        className="bg-gradient-to-br from-gray-900/90 to-gray-800/90 backdrop-blur rounded-3xl px-10 py-6 border-2 relative z-10"
        style={{ borderColor: tierColor }}
      >
        ...（原有 EXP / 金币 内容保留）
```

注意：`tierColor` 在原代码 48 行已经定义在 return 之前，无需移动。直接使用即可。

- [ ] **Step 4: 编译检查**

```bash
cd frontend
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/challenge-fx/RewardReveal.tsx
git commit -m "feat(challenge): RewardReveal 第三幕加学生英雄背景"
```

---

## Phase 5：班级光荣榜（后端聚合 + 前端组件）

### Task 10: hall_of_fame schema

**Files:**
- Create: `backend/app/schemas/hall_of_fame.py`

- [ ] **Step 1: 新建文件**

```python
"""
班级光荣榜响应 schema
"""
from typing import Optional
from pydantic import BaseModel


class ChampionItem(BaseModel):
    """单个上榜学生条目"""
    user_id: int
    nickname: str
    hero_id: Optional[str]
    metric: int  # 数值（次数 / 秒数 / 分数差）
    metric_label: str  # 中文展示，如 "12 次满分通关"


class HallOfFameResponse(BaseModel):
    """班级光荣榜响应（任意一项可能为 null）"""
    class_id: Optional[int]
    class_name: Optional[str]
    period: str  # 如 "2026-05"
    champions: dict
    # champions 形如：
    # { "perfect_king": ChampionItem | None,
    #   "speed_king":   ChampionItem | None,
    #   "progress_star": ChampionItem | None }
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/schemas/hall_of_fame.py
git commit -m "feat(schema): hall_of_fame 响应 schema"
```

---

### Task 11: hall_of_fame_service 聚合逻辑

**Files:**
- Create: `backend/app/services/hall_of_fame_service.py`

- [ ] **Step 1: 新建文件**

```python
"""
班级光荣榜聚合逻辑

三类榜单（基于 StudySession + LearningProgress 数据）：
- perfect_king ：本月本班"满分会话"次数最多者
                 满分定义：correct_count == words_studied AND words_studied >= 5
- speed_king   ：本月本班"满分会话"中 time_spent 最短者
- progress_star：本月最近 3 次会话平均正确率 vs 上月最后 3 次平均正确率，
                 差值最大且 >= 10%

性能：单班级数据量小（几十人 * 几十次会话 / 月），直接 SQL 聚合即可。
"""
from datetime import datetime, timedelta
from typing import Optional, Dict
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User, Class, ClassStudent
from app.models.learning import StudySession


PROGRESS_MIN_DELTA = 10  # 进步之星：差值 >= 10% 才上榜


def _month_range(now: datetime) -> tuple[datetime, datetime]:
    """返回 (本月第一天 00:00, 下月第一天 00:00)"""
    first = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if first.month == 12:
        next_first = first.replace(year=first.year + 1, month=1)
    else:
        next_first = first.replace(month=first.month + 1)
    return first, next_first


async def get_student_class(db: AsyncSession, user_id: int) -> Optional[Class]:
    """查学生所在班级（取第一个 active 的）"""
    res = await db.execute(
        select(Class)
        .join(ClassStudent, ClassStudent.class_id == Class.id)
        .where(
            ClassStudent.student_id == user_id,
            ClassStudent.is_active.is_(True),
        )
        .limit(1)
    )
    return res.scalar_one_or_none()


async def get_class_student_ids(db: AsyncSession, class_id: int) -> list[int]:
    res = await db.execute(
        select(ClassStudent.student_id)
        .where(
            ClassStudent.class_id == class_id,
            ClassStudent.is_active.is_(True),
        )
    )
    return [r[0] for r in res.all()]


async def get_user_brief(db: AsyncSession, user_id: int) -> Optional[Dict]:
    res = await db.execute(
        select(User.id, User.full_name, User.username, User.hero_id)
        .where(User.id == user_id)
    )
    row = res.first()
    if not row:
        return None
    return {
        "user_id": row[0],
        "nickname": row[1] or row[2],
        "hero_id": row[3],
    }


async def compute_perfect_king(db: AsyncSession, student_ids: list[int], month_start, month_end):
    """本月满分会话次数最多的学生"""
    if not student_ids:
        return None
    res = await db.execute(
        select(
            StudySession.user_id,
            func.count(StudySession.id).label("perfect_count"),
        )
        .where(
            StudySession.user_id.in_(student_ids),
            StudySession.started_at >= month_start,
            StudySession.started_at < month_end,
            StudySession.words_studied >= 5,
            StudySession.correct_count == StudySession.words_studied,
        )
        .group_by(StudySession.user_id)
        .order_by(func.count(StudySession.id).desc())
        .limit(1)
    )
    row = res.first()
    if not row:
        return None
    user = await get_user_brief(db, row[0])
    if not user:
        return None
    return {
        **user,
        "metric": row[1],
        "metric_label": f"{row[1]} 次满分通关",
    }


async def compute_speed_king(db: AsyncSession, student_ids: list[int], month_start, month_end):
    """本月最快满分通关者"""
    if not student_ids:
        return None
    res = await db.execute(
        select(
            StudySession.user_id,
            func.min(StudySession.time_spent).label("min_time"),
        )
        .where(
            StudySession.user_id.in_(student_ids),
            StudySession.started_at >= month_start,
            StudySession.started_at < month_end,
            StudySession.words_studied >= 5,
            StudySession.correct_count == StudySession.words_studied,
            StudySession.time_spent > 0,
        )
        .group_by(StudySession.user_id)
        .order_by(func.min(StudySession.time_spent).asc())
        .limit(1)
    )
    row = res.first()
    if not row:
        return None
    user = await get_user_brief(db, row[0])
    if not user:
        return None
    return {
        **user,
        "metric": row[1],
        "metric_label": f"最快 {row[1]} 秒满分通关",
    }


async def compute_progress_star(db: AsyncSession, student_ids: list[int], month_start, month_end):
    """
    进步之星：本月最近 3 次会话平均正确率 vs 上月最后 3 次平均正确率，
    差值最大且 >= PROGRESS_MIN_DELTA 才上榜
    """
    if not student_ids:
        return None
    if month_start.month == 1:
        prev_start = month_start.replace(year=month_start.year - 1, month=12)
    else:
        prev_start = month_start.replace(month=month_start.month - 1)

    best_user_id = None
    best_delta = -999

    for uid in student_ids:
        # 本月最近 3 次
        cur_res = await db.execute(
            select(StudySession.correct_count, StudySession.words_studied)
            .where(
                StudySession.user_id == uid,
                StudySession.started_at >= month_start,
                StudySession.started_at < month_end,
                StudySession.words_studied > 0,
            )
            .order_by(StudySession.started_at.desc())
            .limit(3)
        )
        cur_rows = cur_res.all()
        if len(cur_rows) < 1:
            continue
        cur_acc = sum(r[0] / r[1] * 100 for r in cur_rows) / len(cur_rows)

        # 上月最后 3 次
        prev_res = await db.execute(
            select(StudySession.correct_count, StudySession.words_studied)
            .where(
                StudySession.user_id == uid,
                StudySession.started_at >= prev_start,
                StudySession.started_at < month_start,
                StudySession.words_studied > 0,
            )
            .order_by(StudySession.started_at.desc())
            .limit(3)
        )
        prev_rows = prev_res.all()
        if len(prev_rows) < 1:
            continue
        prev_acc = sum(r[0] / r[1] * 100 for r in prev_rows) / len(prev_rows)

        delta = cur_acc - prev_acc
        if delta > best_delta:
            best_delta = delta
            best_user_id = uid

    if best_user_id is None or best_delta < PROGRESS_MIN_DELTA:
        return None

    user = await get_user_brief(db, best_user_id)
    if not user:
        return None
    return {
        **user,
        "metric": int(round(best_delta)),
        "metric_label": f"本月进步 {int(round(best_delta))} 分",
    }


async def build_hall_of_fame(db: AsyncSession, student_user_id: int) -> Dict:
    now = datetime.utcnow()
    cls = await get_student_class(db, student_user_id)
    period = now.strftime("%Y-%m")

    if not cls:
        return {
            "class_id": None,
            "class_name": None,
            "period": period,
            "champions": {
                "perfect_king": None,
                "speed_king": None,
                "progress_star": None,
            },
        }

    student_ids = await get_class_student_ids(db, cls.id)
    month_start, month_end = _month_range(now)

    perfect = await compute_perfect_king(db, student_ids, month_start, month_end)
    speed = await compute_speed_king(db, student_ids, month_start, month_end)
    progress = await compute_progress_star(db, student_ids, month_start, month_end)

    return {
        "class_id": cls.id,
        "class_name": cls.name,
        "period": period,
        "champions": {
            "perfect_king": perfect,
            "speed_king": speed,
            "progress_star": progress,
        },
    }
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/services/hall_of_fame_service.py
git commit -m "feat(service): 班级光荣榜聚合逻辑（满分王/速度之王/进步之星）"
```

---

### Task 12: hall_of_fame 接口路由

**Files:**
- Create: `backend/app/api/v1/student/hall_of_fame.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: 新建路由文件**

```python
"""
学生端 - 班级光荣榜
"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.v1.auth import get_current_student
from app.models.user import User
from app.services.hall_of_fame_service import build_hall_of_fame

router = APIRouter()


@router.get("/class/hall-of-fame")
async def get_class_hall_of_fame(
    current_user: User = Depends(get_current_student),
    db: AsyncSession = Depends(get_db),
):
    """
    返回当前学生所在班级的本月光荣榜（满分王 / 速度之王 / 进步之星）

    若学生未加入班级，返回 class_id=null + 三项 champions=null
    """
    return await build_hall_of_fame(db, current_user.id)
```

- [ ] **Step 2: 在 main.py 注册路由**

打开 `backend/app/main.py`，找到 student 路由注册区（约 56-64 行），在 `from app.api.v1.student import progress as student_progress` 这种 import 块里加：

```python
from app.api.v1.student import hall_of_fame as student_hall_of_fame
```

注：先 grep 一下确认 import 块的写法：

```bash
grep -n "from app.api.v1.student import" backend/app/main.py
```

按现有写法补一行 import。然后在 `app.include_router(student_pet.router, ...)` 之后加：

```python
app.include_router(student_hall_of_fame.router, prefix="/api/v1/student", tags=["学生端-班级光荣榜"])
```

- [ ] **Step 3: 启动后端 + curl 验证**

```bash
cd backend
uvicorn app.main:app --port 8000 &
sleep 3

# 用一个真实学生账号登录拿 token
TOKEN=$(curl -s -X POST http://localhost:8000/api/v1/auth/login \
  -d "username=hero_test_001&password=test123" | python -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

curl -s http://localhost:8000/api/v1/student/class/hall-of-fame \
  -H "Authorization: Bearer $TOKEN" | python -m json.tool
```
Expected: 输出含 `class_id` / `class_name` / `period` / `champions` 4 个 key 的 JSON。学生未加班级时 class_id=null，champions 内三项可能 null。

```bash
kill %1
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/v1/student/hall_of_fame.py backend/app/main.py
git commit -m "feat(api): 新增 GET /api/v1/student/class/hall-of-fame 接口"
```

---

### Task 13: 后端聚合手测脚本

**Files:**
- Create: `backend/test_hall_of_fame.py`

- [ ] **Step 1: 新建测试脚本（按现有 `test_*.py` 风格，asyncio + 直接调 service）**

```python
"""光荣榜聚合 helper 测试（按 backend/test_*.py 现有风格）"""
import asyncio
from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.models.user import User, Class, ClassStudent
from app.services.hall_of_fame_service import build_hall_of_fame


async def find_student_with_class():
    async with AsyncSessionLocal() as db:
        res = await db.execute(
            select(ClassStudent.student_id, ClassStudent.class_id)
            .where(ClassStudent.is_active.is_(True))
            .limit(1)
        )
        row = res.first()
        return (row[0], row[1]) if row else (None, None)


async def find_student_without_class():
    async with AsyncSessionLocal() as db:
        # 一个 role=student 但不在 class_students 表里的
        res = await db.execute(
            select(User.id)
            .where(User.role == "student")
            .where(~User.id.in_(select(ClassStudent.student_id).where(ClassStudent.is_active.is_(True))))
            .limit(1)
        )
        row = res.first()
        return row[0] if row else None


async def test_with_class():
    student_id, class_id = await find_student_with_class()
    if not student_id:
        print("SKIP test_with_class: 无班级学生")
        return
    async with AsyncSessionLocal() as db:
        result = await build_hall_of_fame(db, student_id)
        assert result["class_id"] == class_id, f"班级 ID 不匹配：{result['class_id']} != {class_id}"
        assert "champions" in result
        assert set(result["champions"].keys()) == {"perfect_king", "speed_king", "progress_star"}
        print(f"OK test_with_class: 班级 {result['class_name']} period={result['period']}")
        print(f"  champions: {result['champions']}")


async def test_without_class():
    student_id = await find_student_without_class()
    if not student_id:
        print("SKIP test_without_class: 所有学生都有班级")
        return
    async with AsyncSessionLocal() as db:
        result = await build_hall_of_fame(db, student_id)
        assert result["class_id"] is None
        assert result["class_name"] is None
        assert all(v is None for v in result["champions"].values())
        print(f"OK test_without_class: 学生 {student_id} 无班级")


async def main():
    await test_with_class()
    await test_without_class()


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 2: 跑一遍**

```bash
cd backend
python test_hall_of_fame.py
```
Expected: 至少一条 OK 输出（数据库无班级学生时全 SKIP 也算正常通过，不报错）

- [ ] **Step 3: Commit**

```bash
git add backend/test_hall_of_fame.py
git commit -m "test(hall_of_fame): 聚合 helper 手测脚本"
```

---

### Task 14: 前端 API 客户端 hallOfFame.ts

**Files:**
- Create: `frontend/src/api/hallOfFame.ts`

- [ ] **Step 1: 新建文件**

```typescript
import client from './client';

export interface ChampionItem {
  user_id: number;
  nickname: string;
  hero_id: string | null;
  metric: number;
  metric_label: string;
}

export interface HallOfFameResponse {
  class_id: number | null;
  class_name: string | null;
  period: string;
  champions: {
    perfect_king: ChampionItem | null;
    speed_king: ChampionItem | null;
    progress_star: ChampionItem | null;
  };
}

export async function getClassHallOfFame(): Promise<HallOfFameResponse> {
  return client.get('/api/v1/student/class/hall-of-fame');
}
```

注：`client` 默认 export 还是 named export？快速确认：

```bash
grep -n "^export" frontend/src/api/client.ts
```

如果是 `export default instance`，上面写法 OK；如果是 `export { instance as default }` 或别的，按实际改。

- [ ] **Step 2: TS 编译检查**

```bash
cd frontend
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/hallOfFame.ts
git commit -m "feat(frontend): hallOfFame API 客户端"
```

---

### Task 15: HallOfFame 组件

**Files:**
- Create: `frontend/src/components/HallOfFame.tsx`

- [ ] **Step 1: 新建组件**

```tsx
/**
 * 班级光荣榜（学生 Dashboard 顶部）
 *
 * 横向 3 张英雄卡片：满分王 / 速度之王 / 进步之星
 * 移动端纵向 stack
 *
 * - 学生未加班级 → 显示空状态引导
 * - 某项空缺 → 显示灰色占位卡片 + 鼓励文案
 */
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { getClassHallOfFame, type HallOfFameResponse, type ChampionItem } from '../api/hallOfFame';
import { getHeroById, pickEncourageHero } from '../utils/hero';

const TIER_THEME = {
  perfect_king: {
    title: '满分王',
    icon: '👑',
    gradient: 'from-yellow-400 via-orange-400 to-red-500',
    border: 'border-yellow-400',
  },
  speed_king: {
    title: '速度之王',
    icon: '⚡',
    gradient: 'from-cyan-400 via-blue-500 to-indigo-600',
    border: 'border-cyan-400',
  },
  progress_star: {
    title: '进步之星',
    icon: '📈',
    gradient: 'from-pink-400 via-purple-500 to-indigo-500',
    border: 'border-pink-400',
  },
} as const;

type ChampionKey = keyof typeof TIER_THEME;

function ChampionCard({ kind, champion }: { kind: ChampionKey; champion: ChampionItem | null }) {
  const theme = TIER_THEME[kind];
  const [imgError, setImgError] = useState(false);
  const encourageHero = pickEncourageHero();

  if (!champion) {
    return (
      <div className={`relative rounded-2xl bg-white border-2 border-dashed ${theme.border} p-4 flex flex-col items-center text-center min-h-[220px] justify-center`}>
        <div className="text-3xl mb-2 opacity-40">{theme.icon}</div>
        <div className="font-bold text-gray-500 mb-1">{theme.title}</div>
        <div className="text-xs text-gray-400 px-2">本月空缺<br/>加油成为第一人！</div>
        {!imgError && (
          <img
            src={encourageHero.imageUrl}
            alt=""
            aria-hidden
            onError={() => setImgError(true)}
            className="absolute bottom-2 right-2 w-12 h-12 rounded-full object-cover opacity-50"
          />
        )}
      </div>
    );
  }

  const hero = getHeroById(champion.hero_id);
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.02 }}
      className={`relative rounded-2xl overflow-hidden shadow-lg border-2 ${theme.border} bg-white min-h-[220px]`}
    >
      <div className={`bg-gradient-to-r ${theme.gradient} px-3 py-2 text-white flex items-center gap-2`}>
        <span className="text-xl">{theme.icon}</span>
        <span className="font-bold text-sm">{theme.title}</span>
      </div>
      <div className="relative h-32 overflow-hidden bg-gray-100">
        {!imgError ? (
          <img
            src={hero.imageUrl}
            alt={hero.name}
            onError={() => setImgError(true)}
            className="w-full h-full object-cover object-top"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-5xl bg-gradient-to-br from-gray-200 to-gray-300">
            🏆
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
      </div>
      <div className="p-3">
        <div className="font-bold text-gray-800 truncate">{champion.nickname}</div>
        <div className="text-xs text-gray-500 mt-1">{champion.metric_label}</div>
      </div>
    </motion.div>
  );
}


export default function HallOfFame() {
  const [data, setData] = useState<HallOfFameResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    getClassHallOfFame()
      .then(d => { setData(d); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, []);

  if (loading) {
    return (
      <div className="rounded-2xl bg-white p-4 shadow animate-pulse h-[260px]" />
    );
  }
  if (error || !data) return null;

  if (!data.class_id) {
    return (
      <div className="rounded-2xl bg-gradient-to-r from-amber-50 to-orange-50 border border-orange-200 p-4 text-center text-gray-600">
        <div className="text-3xl mb-1">🏫</div>
        <div className="font-medium">你还没有加入班级哦</div>
        <div className="text-xs text-gray-500 mt-1">联系老师把你加进班级，就能看到光荣榜</div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl p-4 shadow-lg">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-bold text-gray-800">
          🏆 {data.class_name} · 本月光荣榜
        </h3>
        <span className="text-xs text-gray-400">{data.period}</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <ChampionCard kind="perfect_king" champion={data.champions.perfect_king} />
        <ChampionCard kind="speed_king" champion={data.champions.speed_king} />
        <ChampionCard kind="progress_star" champion={data.champions.progress_star} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TS 编译检查**

```bash
cd frontend
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/HallOfFame.tsx
git commit -m "feat(frontend): 班级光荣榜组件（含空状态/缺位/错误处理）"
```

---

### Task 16: 把 HallOfFame 挂到 StudentDashboard_New 顶部

**Files:**
- Modify: `frontend/src/pages/StudentDashboard_New.tsx`

- [ ] **Step 1: 顶部加 import**

```bash
grep -n "^import" frontend/src/pages/StudentDashboard_New.tsx | head -20
```

在最后一个 import 之后加：

```typescript
import HallOfFame from '../components/HallOfFame';
```

- [ ] **Step 2: 找到合适的挂载位置（欢迎语下方、统计卡片上方）**

```bash
grep -n "欢迎\|继续学习\|你好\|StatCard\|grid-cols-2.*grid-cols-4" frontend/src/pages/StudentDashboard_New.tsx | head -10
```

在欢迎区块（顶部 banner / 问候语）之后、第一组统计卡片之前的位置插入：

```tsx
        {/* 班级光荣榜 - 显眼位置 */}
        <div className="mb-6">
          <HallOfFame />
        </div>
```

容器的具体 margin/padding 按周围现有元素的风格匹配（例如周围都是 `mb-8` 就用 `mb-8`）。

- [ ] **Step 3: 启动前端目测**

```bash
cd frontend
npm run dev
```

用学生账号登录，看 Dashboard 顶部是否有「🏆 xx · 本月光荣榜」卡片。

Expected:
- 已加班级学生：3 张卡片（可能部分是缺位状态，灰色占位是预期行为）
- 未加班级学生：显示「你还没有加入班级哦」引导

- [ ] **Step 4: TS 编译 + lint**

```bash
cd frontend
npx tsc --noEmit && npm run lint
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/StudentDashboard_New.tsx
git commit -m "feat(dashboard): 在学生 Dashboard 顶部挂载光荣榜"
```

---

## Phase 6：LiveLeaderboard 排名靠后段加鼓励位

### Task 17: LiveLeaderboard 鼓励横幅

**Files:**
- Modify: `frontend/src/components/LiveLeaderboard.tsx`

- [ ] **Step 1: 顶部加 import**

```typescript
import { pickEncourageHero } from '../utils/hero';
```

- [ ] **Step 2: 在组件顶部生成鼓励角色（每 mount 抽一次）**

`const LiveLeaderboard: React.FC<LiveLeaderboardProps> = ({ token, seasonId = 1, className = '' }) => {` 之后、 `const [leaderboard, ...]` 之前插入：

```typescript
  // mount 时抽一次鼓励角色，避免 setLeaderboard 触发的重渲染都换人
  const [encourageHero] = useState(() => pickEncourageHero());
  const [encourageImgError, setEncourageImgError] = useState(false);
```

- [ ] **Step 3: 在底部信息条之前加鼓励横幅**

找到 `{/* 底部信息 */}` 那段（约 218-223 行），在它**之前**加：

```tsx
      {/* 鼓励位：排名 >= 10 或处于后 30% 时显示 */}
      {leaderboard.my_rank && (
        leaderboard.my_rank >= 10 ||
        (leaderboard.total_participants > 0 &&
         leaderboard.my_rank / leaderboard.total_participants >= 0.7)
      ) && (
        <div className="mx-3 my-2 rounded-xl bg-gradient-to-r from-amber-50 via-orange-50 to-pink-50 border border-orange-200 p-3 flex items-center gap-3">
          {!encourageImgError && (
            <img
              src={encourageHero.imageUrl}
              alt=""
              onError={() => setEncourageImgError(true)}
              className="w-14 h-14 rounded-full object-cover flex-shrink-0 border-2 border-orange-300"
            />
          )}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-orange-700">{encourageHero.name} 在为你加油</div>
            <div className="text-xs text-gray-600 mt-0.5">
              {encourageHero.taglineEncourage || '坚持就是胜利，下次见！'}
            </div>
          </div>
        </div>
      )}

      {/* 底部信息 */}
```

- [ ] **Step 4: TS 编译检查**

```bash
cd frontend
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/LiveLeaderboard.tsx
git commit -m "feat(leaderboard): 排名靠后段加鼓励位（凤凰/黎明）"
```

---

## Phase 7：最终验证

### Task 18: 端到端目测

- [ ] **Step 1: 启动前后端**

```bash
cd backend && uvicorn app.main:app --reload --port 8000 &
cd frontend && npm run dev
```

- [ ] **Step 2: 登录学生账号，按以下场景全部目测**

| # | 场景 | 期望表现 |
|---|---|---|
| 1 | 进 Dashboard | 顶部有班级光荣榜 3 张卡片或「未加入班级」提示 |
| 2 | 完成一组分类（满分） | VictoryScreen 显示 perfect 池角色 + 标题动画 + 撒花 |
| 3 | 完成一组分类（85 分） | 显示 great 池角色 + 蓝色调撒花 |
| 4 | 完成一组分类（60 分） | 显示 retry 池角色 + 鼓励台词替代默认副标题 |
| 5 | 完成 spelling 模式 | CompletionScreen 顶部 banner 是学生自己的 hero（注册时分配那个） |
| 6 | 完成错题挑战 | 第三幕奖励容器后面有半透明 hero 立绘 |
| 7 | 进竞赛排行榜，自己排名 >=10 | 底部出现「凤凰/黎明在为你加油」横幅 |
| 8 | 故意把 `/heroes/hero_blaze.png` 移走 | 满分场景仍能显示，emoji 🏆 兜底，不裂 |
| 9 | 浏览器开 prefers-reduced-motion | 粒子/闪光退化但 hero 立绘仍显示 |

- [ ] **Step 3: 把 #8 的图片放回**

```bash
git checkout frontend/public/heroes/hero_blaze.png
```

- [ ] **Step 4: 整体冒烟检查 lint + 编译**

```bash
cd frontend && npx tsc --noEmit && npm run lint && npm run build
```
Expected: 无错误，build 产出 `dist/`

```bash
cd backend && python -c "from app.main import app; print('OK', len(app.routes), 'routes')"
```
Expected: 输出 `OK <N> routes`，N 比之前多 1（新增 hall-of-fame）

- [ ] **Step 5: 这一步不 commit（仅验证）**

如果所有场景都过，到此结束。

---

## 后续手动步骤（不写在 commit 里）

- **运行 image2 脚本**只在首次开发期做一次。如果想换某个角色的形象，调整 `scripts/generate-heroes.py` 顶部的 `HEROES` 字典对应 prompt，跑 `python scripts/generate-heroes.py --only hero_blaze --force` 单独覆盖。
- **API Key 不入 git**：环境变量传，commit 前 `git status` 检查没有意外的密钥文件。
- **生产部署**：`init_db()` 启动时会自动 ALTER 加列 + 回填，无需手动迁移；新部署直接 `Base.metadata.create_all` 出新表。
