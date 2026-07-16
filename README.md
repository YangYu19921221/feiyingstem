# 🎓 飞鹰英语 - 中小学英语学习 SaaS 平台

专为中小学生设计的英语单词学习系统,支持**多机构加盟(多租户 SaaS)**,集成 AI 智能功能与深度游戏化。

[![GitHub](https://img.shields.io/badge/GitHub-feiyingstem-blue)](https://github.com/YangYu19921221/feiyingstem)
[![Python](https://img.shields.io/badge/Python-3.11+-green.svg)](https://www.python.org/)
[![React](https://img.shields.io/badge/React-18-blue.svg)](https://reactjs.org/)

生产环境: https://es.feiyingsteam.com

---

## 系统架构(四端)

```
平台管理端(总部) ──开机构/配额/有效期/兑换码─→ 机构管理端(加盟商)
                                                │ 建老师/看统计/招生链接
                                                ▼
                                            教师端 ──建班/邀请码/作业/实时课堂─→ 学生端/家长端
```

| 角色 | 登录后进入 | 核心能力 |
|---|---|---|
| `admin` 平台管理员 | 平台管理后台 | 机构开户、学生配额、服务有效期、跨机构统计、AI配置 |
| `org_admin` 机构管理员 | 机构管理端 | 管老师、看本机构统计、发兑换码(上限=学生配额)、招生链接、自定义名称/Logo |
| `teacher` 教师 | 教师端 | 班级/邀请码、词库、作业、实时课堂监控、大屏、竞赛/晋级赛 |
| `student` 学生 | 学生端 | 今日智能任务、多模式学习、宠物养成、PK对战、成就/排行榜 |
| `parent` 家长 | 家长端 | 绑定孩子、学习看板、周报 |

## 多租户(加盟)核心机制

- **数据隔离**: `core/tenancy.py` 全局过滤安全网(读侧 `do_orm_execute` 自动注入 org 条件 + 写侧 `before_flush` 自动打 org 戳),机构间互相不可见
- **学生配额**: 入班/建学生/兑换码发放三处强制,超额引导扩容(收费抓手)
- **服务有效期**: `expires_at` 到期自动停服(无定时任务,请求时判定),续费即时恢复
- **招生链接**: `/register?org=机构码` 注册即归属;`/assessment?org=机构码` 测评线索进机构客户池
- **AI 限流**: `services/ai_quota.py` 通用限额服务(按用户×功能×日)

## 学习效率引擎

- **今日智能任务**: 到期复习 → 错题闯关 → 新词,系统编排默认路径(`/student/daily-plan`)
- **记忆曲线复习**: SRS 间隔重复,毕业机制,"复习的魔力"保持率对比可视化
- **AI 记忆钩子**: 谐音/词根/联想记忆法,一词一次全平台缓存(`words.memory_hook`)
- **拼写错误诊断**: 聚类真实错误输入找系统性混淆(`learning_records.user_answer`)
- **连错消化卡**: 分类学习连错 3 个自动暂停消化
- **防划水**: 学习质量分、切屏监控、答题行为检测

## 游戏化

宠物养成/对战(算法对手,零AI成本)、实时多人 PK 竞技场(锁步引擎+观战)、全自动晋级赛(蛇形分组→循环→淘汰→冠军)、段位、成就、三榜排行(机构内)。

## 快速开始

```bash
# 后端 (http://localhost:8000, 文档 /docs)
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # 按需配置 AI Key,不配置也能跑
uvicorn app.main:app --reload

# 前端 (http://localhost:5173)
cd frontend && npm install && npm run dev
```

数据库 SQLite 自动初始化(`init_db()` 幂等迁移,含建表/加列/回填,无需手工建库)。

## 部署

- 后端: rsync `backend/app/` → 生产 → `systemctl restart english-helper`(启动时自动跑迁移)
- 前端: `npm run build` → rsync `dist/`(Vite 哈希级联,必须整份替换,不能单文件换)
- 开发规范与安全红线见 `CLAUDE.md`

## 文档

- **开发指南**: `CLAUDE.md`(架构、规范、安全红线)
- **多租户设计**: `docs/多租户SaaS设计方案.md`
- **加盟方案**: `docs/加盟合作手册.md`
- **数据库**: `database_schema.sql`
