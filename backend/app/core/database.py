from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from sqlalchemy import text
from app.core.config import settings
import os

# 创建异步引擎
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    future=True
)

# 创建会话工厂
AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False
)

Base = declarative_base()

async def init_db():
    """初始化数据库"""
    from sqlalchemy import text
    # 导入所有模型以确保它们被注册到Base.metadata
    from app.models import user, word, learning, pet, assessment
    from app.models import organization  # 多租户: 机构(租户)表
    from app.models import coin  # 金币系统: 余额 + 流水
    try:
        from app.models import competition
    except Exception:
        pass
    try:
        from app.models import sentence  # 句子背诵
    except Exception:
        pass

    # 使用SQLAlchemy的create_all创建所有表
    async with engine.begin() as conn:
        def create_tables(sync_conn):
            # 创建所有在Base.metadata中定义的表
            Base.metadata.create_all(sync_conn)

        await conn.run_sync(create_tables)

        # 迁移: 为 user_scores 表添加段位字段
        try:
            await conn.execute(text(
                "ALTER TABLE user_scores ADD COLUMN rank_tier VARCHAR(20) DEFAULT 'bronze'"
            ))
        except Exception:
            pass
        try:
            await conn.execute(text(
                "ALTER TABLE user_scores ADD COLUMN rank_points INTEGER DEFAULT 0"
            ))
        except Exception:
            pass

        # 迁移: 为 user_pets 表添加 food_balance 字段
        try:
            await conn.execute(text(
                "ALTER TABLE user_pets ADD COLUMN food_balance INTEGER DEFAULT 10"
            ))
        except Exception:
            pass

        # 迁移: 为 word_mastery 表添加 review_stage 字段
        try:
            await conn.execute(text(
                "ALTER TABLE word_mastery ADD COLUMN review_stage INTEGER NOT NULL DEFAULT 0"
            ))
        except Exception:
            pass
        # 回填已有的 NULL 值
        try:
            await conn.execute(text(
                "UPDATE word_mastery SET review_stage = 0 WHERE review_stage IS NULL"
            ))
        except Exception:
            pass
        # 添加索引加速复习查询
        try:
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS idx_word_mastery_user_review ON word_mastery(user_id, next_review_at)"
            ))
        except Exception:
            pass

        # 迁移: 重建 exam_questions 表去掉 question_type 的 CHECK 约束（支持新题型）
        try:
            # 检查是否需要迁移（如果旧约束存在）
            check_result = await conn.execute(text(
                "SELECT sql FROM sqlite_master WHERE name='exam_questions'"
            ))
            row = check_result.fetchone()
            if row and 'CHECK' in (row[0] or ''):
                await conn.execute(text(
                    "CREATE TABLE IF NOT EXISTS exam_questions_new ("
                    "id INTEGER PRIMARY KEY AUTOINCREMENT,"
                    "paper_id INTEGER NOT NULL,"
                    "question_type VARCHAR(20),"
                    "word_id INTEGER,"
                    "question_text TEXT NOT NULL,"
                    "options TEXT,"
                    "correct_answer TEXT NOT NULL,"
                    "score INTEGER DEFAULT 5,"
                    "order_index INTEGER DEFAULT 0,"
                    "FOREIGN KEY (paper_id) REFERENCES exam_papers(id) ON DELETE CASCADE,"
                    "FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE SET NULL)"
                ))
                await conn.execute(text(
                    "INSERT OR IGNORE INTO exam_questions_new SELECT * FROM exam_questions"
                ))
                await conn.execute(text("DROP TABLE exam_questions"))
                await conn.execute(text("ALTER TABLE exam_questions_new RENAME TO exam_questions"))
        except Exception:
            pass

        # 迁移: 为 users 表添加 phone 字段
        try:
            await conn.execute(text(
                "ALTER TABLE users ADD COLUMN phone VARCHAR(20) UNIQUE"
            ))
        except Exception:
            pass

        # 迁移: 为 units 表添加 group_size 字段
        try:
            await conn.execute(text(
                "ALTER TABLE units ADD COLUMN group_size INTEGER DEFAULT 0"
            ))
        except Exception:
            pass

        # 迁移: 重建 learning_records 表去掉 learning_mode 的 CHECK 约束
        try:
            check_result = await conn.execute(text(
                "SELECT sql FROM sqlite_master WHERE name='learning_records'"
            ))
            row = check_result.fetchone()
            if row and 'CHECK' in (row[0] or ''):
                await conn.execute(text(
                    "CREATE TABLE IF NOT EXISTS learning_records_new ("
                    "id INTEGER PRIMARY KEY AUTOINCREMENT,"
                    "user_id INTEGER NOT NULL,"
                    "word_id INTEGER NOT NULL,"
                    "learning_mode VARCHAR(20),"
                    "is_correct BOOLEAN,"
                    "time_spent INTEGER,"
                    "user_answer VARCHAR(100),"
                    "created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,"
                    "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,"
                    "FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE)"
                ))
                # 注: SELECT * 依赖两表列序一致;此重建仅在老库(带CHECK约束、尚无
                # user_answer 列)上触发,重建后下方 ALTER 才加 user_answer——
                # 但重建DDL已含该列,故 ALTER 会因列已存在被 except 吞掉,状态自洽
                await conn.execute(text(
                    "INSERT OR IGNORE INTO learning_records_new "
                    "(id, user_id, word_id, learning_mode, is_correct, time_spent, created_at) "
                    "SELECT id, user_id, word_id, learning_mode, is_correct, time_spent, created_at "
                    "FROM learning_records"
                ))
                await conn.execute(text("DROP TABLE learning_records"))
                await conn.execute(text("ALTER TABLE learning_records_new RENAME TO learning_records"))
                await conn.execute(text(
                    "CREATE INDEX IF NOT EXISTS idx_learning_records_user ON learning_records(user_id)"
                ))
                await conn.execute(text(
                    "CREATE INDEX IF NOT EXISTS idx_learning_records_created ON learning_records(created_at)"
                ))
        except Exception:
            pass

        # 迁移: 为 words 表添加 tts_text 字段
        try:
            await conn.execute(text(
                "ALTER TABLE words ADD COLUMN tts_text VARCHAR(200)"
            ))
        except Exception:
            pass

        # 迁移: 创建 challenge_reviews 表（错题闯关复习）
        try:
            await conn.execute(text("""
                CREATE TABLE IF NOT EXISTS challenge_reviews (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    word_id INTEGER NOT NULL,
                    clear_count INTEGER DEFAULT 1,
                    last_cleared_at DATETIME NOT NULL,
                    next_review_at DATETIME NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                    FOREIGN KEY (word_id) REFERENCES words(id) ON DELETE CASCADE,
                    UNIQUE(user_id, word_id)
                )
            """))
        except Exception:
            pass
        try:
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS idx_challenge_reviews_user_review ON challenge_reviews(user_id, next_review_at)"
            ))
        except Exception:
            pass

        # 迁移: 创建 system_settings 表（管理员系统设置 key-value 存储）
        try:
            await conn.execute(text("""
                CREATE TABLE IF NOT EXISTS system_settings (
                    key VARCHAR(50) PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            """))
        except Exception:
            pass

        # 迁移: 为 exam_submissions 添加 unit_id（单元考试历史按单元归类）
        try:
            await conn.execute(text(
                "ALTER TABLE exam_submissions ADD COLUMN unit_id INTEGER"
            ))
        except Exception:
            pass

        # 迁移: group_exam_records 索引（表本身由 create_all 建）
        try:
            await conn.execute(text(
                "CREATE INDEX IF NOT EXISTS idx_group_exam_user_created ON group_exam_records(user_id, created_at)"
            ))
        except Exception:
            pass

        # ===== 多租户 P1: organizations + 锚点表 org_id(幂等迁移) =====
        # 直营机构(org_id=1),现有数据全部归属它
        try:
            await conn.execute(text(
                "INSERT OR IGNORE INTO organizations (id, name, code, plan, student_quota, status) "
                "VALUES (1, '雪域飞鹰(直营)', 'HQ001', 'headquarters', 999999, 'active')"
            ))
        except Exception:
            pass
        # 9 张锚点表加 org_id:
        # - 用户/班级/房间/线索/快照: NOT NULL DEFAULT 1(SQLite 对存量行直接生效)
        # - 内容表(word_books等): 可空,NULL=平台共享库;私有(is_public=0)回填到直营
        #   注: 回填每次启动都跑,兼做 P1 期间新建私有内容未设 org 的兜底,P2 写入侧补齐后自然空转
        for _sql in [
            "ALTER TABLE users ADD COLUMN org_id INTEGER NOT NULL DEFAULT 1",
            "ALTER TABLE classes ADD COLUMN org_id INTEGER NOT NULL DEFAULT 1",
            "ALTER TABLE pk_rooms ADD COLUMN org_id INTEGER NOT NULL DEFAULT 1",
            "ALTER TABLE assessment_leads ADD COLUMN org_id INTEGER NOT NULL DEFAULT 1",
            "ALTER TABLE leaderboard_snapshots ADD COLUMN org_id INTEGER NOT NULL DEFAULT 1",
            "ALTER TABLE word_books ADD COLUMN org_id INTEGER",
            "ALTER TABLE sentence_books ADD COLUMN org_id INTEGER",
            "ALTER TABLE reading_passages ADD COLUMN org_id INTEGER",
            "ALTER TABLE competition_question_sets ADD COLUMN org_id INTEGER",
            "UPDATE word_books SET org_id = 1 WHERE org_id IS NULL AND (is_public = 0 OR is_public IS NULL)",
            "UPDATE sentence_books SET org_id = 1 WHERE org_id IS NULL AND (is_public = 0 OR is_public IS NULL)",
            "UPDATE reading_passages SET org_id = 1 WHERE org_id IS NULL AND (is_public = 0 OR is_public IS NULL)",
            "UPDATE competition_question_sets SET org_id = 1 WHERE org_id IS NULL AND (is_public = 0 OR is_public IS NULL)",
            "CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id)",
            "CREATE INDEX IF NOT EXISTS idx_classes_org ON classes(org_id)",
            "CREATE INDEX IF NOT EXISTS idx_word_books_org ON word_books(org_id)",
            "CREATE INDEX IF NOT EXISTS idx_sentence_books_org ON sentence_books(org_id)",
            "CREATE INDEX IF NOT EXISTS idx_reading_passages_org ON reading_passages(org_id)",
            "CREATE INDEX IF NOT EXISTS idx_assessment_leads_org ON assessment_leads(org_id)",
            "CREATE INDEX IF NOT EXISTS idx_pk_rooms_org ON pk_rooms(org_id)",
            "CREATE INDEX IF NOT EXISTS idx_leaderboard_snapshots_org ON leaderboard_snapshots(org_id)",
            "CREATE INDEX IF NOT EXISTS idx_competition_question_sets_org ON competition_question_sets(org_id)",
            "ALTER TABLE organizations ADD COLUMN logo_url VARCHAR(500)",
            # 学习效率功能: AI记忆钩子缓存列 + 学生实际输入(拼写诊断数据地基)
            "ALTER TABLE words ADD COLUMN memory_hook TEXT",
            "ALTER TABLE learning_records ADD COLUMN user_answer VARCHAR(100)",
            # 测评线索渠道来源: 直播/推广链接带 ?src=douyin|shipinhao|referral,下播看分渠道战报
            "ALTER TABLE assessment_leads ADD COLUMN source VARCHAR(30)",
            # 教材版本分类: 单词本归属的教材系列(人教版/苏教版/机构自定义),选项表 book_series 由 create_all 建
            "ALTER TABLE word_books ADD COLUMN series VARCHAR(30)",
        ]:
            try:
                await conn.execute(text(_sql))
            except Exception:
                pass

        # ===== 教材版本分类: 预置选项 + 存量回填(均幂等) =====
        # 预置仅当表空时插入(机构后续自定义/排序不被启动覆盖)
        try:
            has_series = (await conn.execute(text("SELECT COUNT(*) FROM book_series"))).scalar()
            if not has_series:
                for i, name in enumerate(["人教版", "苏教版", "外研版", "牛津译林版", "北师大版", "课外读物", "校本教材"]):
                    await conn.execute(text(
                        "INSERT INTO book_series (name, org_id, sort_order) VALUES (:n, NULL, :s)"
                    ), {"n": name, "s": i})
        except Exception:
            pass
        # 存量回填: 按书名关键词打标,只动 series IS NULL 的行(老师手动改过的不覆盖);
        # 识别不出的留空,由教师端编辑补
        for kw, series_name in [
            ("%人教%", "人教版"), ("%苏教%", "苏教版"), ("%外研%", "外研版"),
            ("%牛津%", "牛津译林版"), ("%译林%", "牛津译林版"), ("%北师大%", "北师大版"),
            ("%飞鹰%", "校本教材"),
        ]:
            try:
                await conn.execute(text(
                    "UPDATE word_books SET series = :s WHERE series IS NULL AND name LIKE :kw"
                ), {"s": series_name, "kw": kw})
            except Exception:
                pass

        # ===== word_mastery 唯一约束修复(幂等) =====
        # create_all 建的库缺 UNIQUE(user_id, word_id),并发首插会产生重复行。
        # 先清历史重复(保留每组最早一行,计数合并),再补唯一索引。
        try:
            await conn.execute(text(
                "DELETE FROM word_mastery WHERE id NOT IN ("
                "SELECT MIN(id) FROM word_mastery GROUP BY user_id, word_id)"
            ))
        except Exception:
            pass
        try:
            await conn.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_word_mastery_user_word "
                "ON word_mastery(user_id, word_id)"
            ))
        except Exception:
            pass

        # 注册租户锚点模型(全局过滤安全网,TENANCY_ENFORCE 控制是否生效)
        from app.core.tenancy import register_tenant_models
        register_tenant_models()

        print("✅ 数据库初始化完成")

    # 开启 WAL(提高读写并发,持久化到库文件)。PRAGMA journal_mode 不能在事务内执行,
    # 必须走 AUTOCOMMIT 连接,故放在上面 engine.begin() 事务块之外
    try:
        async with engine.execution_options(isolation_level="AUTOCOMMIT").connect() as wal_conn:
            await wal_conn.exec_driver_sql("PRAGMA journal_mode=WAL")
    except Exception:
        pass

async def get_db() -> AsyncSession:
    """获取数据库会话"""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
