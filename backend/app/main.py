import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.responses import Response
from contextlib import asynccontextmanager
from app.core.config import settings
from app.core.database import init_db
from app.api.v1 import auth, words, learning, exams, ai, competition, achievements, analytics, parent
from app.api.v1.teacher import units as teacher_units, competition_questions as teacher_competition, analytics as teacher_analytics, reading as teacher_reading, book_assignments as teacher_assignments, homework as teacher_homework, dashboard as teacher_dashboard, exam_generator as teacher_exam_generator, classes as teacher_classes, student_monitor as teacher_student_monitor, coins as teacher_coins
from app.api.v1.student import progress as student_progress, learning_records as student_learning_records, mistake_book as student_mistake_book, reading as student_reading, assignments as student_assignments, homework as student_homework, dashboard as student_dashboard, pet as student_pet, unit_exam as student_unit_exam, leaderboard as student_leaderboard, class_join as student_class_join, pet_battle as student_pet_battle, pet_battle_ws as student_pet_battle_ws, pet_healing as student_pet_healing, coins as student_coins
from app.api.v1.admin import users as admin_users, content as admin_content, statistics as admin_statistics, ai_config as admin_ai_config, subscriptions as admin_subscriptions, system_update as admin_system_update
from app.api.v1.admin import teachers as admin_teachers, classes as admin_classes, settings as admin_settings
from app.api.v1.admin import class_analytics as admin_class_analytics, competition as admin_competition
from app.api.v1.admin import student_books as admin_student_books
from app.api.v1.admin import organizations as admin_organizations  # 多租户: 平台管理端-机构管理
from app.api.v1 import org_admin  # 多租户: 机构管理端(加盟商)
from app.api.v1 import subscription, pronunciation, assessment, sentences, pk_routes, pk_websocket
from app.api.v1 import pk_tournament_routes
from app.api.v1 import presence
from app.api.v1 import checkin

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动时初始化数据库
    await init_db()
    # 金币每日自动结算(北京 00:35 结算前一天单词王/作业币,不依赖老师打开页面)
    import asyncio
    from app.services.coin_scheduler import daily_settle_loop
    settle_task = asyncio.create_task(daily_settle_loop())
    yield
    # 关闭时清理资源
    settle_task.cancel()

app = FastAPI(
    title=settings.APP_NAME,
    description="中小学生英语学习系统API",
    version="1.0.0",
    lifespan=lifespan
)

# 上传文件静态服务(机构Logo等): 挂在 /api/v1/files 下,nginx 的 /api/ 代理天然覆盖。
# ⚠️ 红线: 此目录整体公开无鉴权,任何敏感文件(导出报表/试卷/录音)禁止写入 UPLOAD_DIR。
class _ImmutableStatic(StaticFiles):
    """URL 已带 ?v=版本号,可放心长缓存——否则每次渲染都发条件请求穿透到 Python 换 304"""
    def file_response(self, *args, **kwargs) -> Response:
        resp = super().file_response(*args, **kwargs)
        resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return resp

os.makedirs(os.path.join(settings.UPLOAD_DIR, "org-logos"), exist_ok=True)
app.mount("/api/v1/files", _ImmutableStatic(directory=settings.UPLOAD_DIR), name="files")

# CORS配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由
app.include_router(auth.router, prefix="/api/v1/auth", tags=["认证"])
app.include_router(words.router, prefix="/api/v1/words", tags=["单词管理"])
app.include_router(learning.router, prefix="/api/v1/learning", tags=["学习模块"])
app.include_router(exams.router, prefix="/api/v1/exams", tags=["试卷系统"])
app.include_router(ai.router, prefix="/api/v1/ai", tags=["AI功能"])
app.include_router(competition.router, prefix="/api/v1/competition", tags=["竞赛系统"])
app.include_router(achievements.router, prefix="/api/v1/achievements", tags=["成就系统"])
app.include_router(analytics.router, prefix="/api/v1/analytics", tags=["数据分析"])
app.include_router(teacher_units.router, prefix="/api/v1/teacher", tags=["教师端-单元管理"])
app.include_router(teacher_competition.router, prefix="/api/v1/teacher", tags=["教师端-竞赛题库"])
app.include_router(teacher_analytics.router, prefix="/api/v1/teacher/analytics", tags=["教师端-数据分析"])
app.include_router(teacher_reading.router, prefix="/api/v1/teacher", tags=["教师端-阅读理解"])
app.include_router(teacher_assignments.router, prefix="/api/v1/teacher", tags=["教师端-单词本分配"])
app.include_router(teacher_homework.router, prefix="/api/v1/teacher", tags=["教师端-作业管理"])
app.include_router(teacher_coins.router, prefix="/api/v1/teacher", tags=["教师端-金币管理"])
app.include_router(teacher_dashboard.router, prefix="/api/v1/teacher", tags=["教师端-仪表板"])
app.include_router(teacher_exam_generator.router, prefix="/api/v1/teacher", tags=["教师端-AI试卷生成"])
app.include_router(teacher_classes.router, prefix="/api/v1/teacher", tags=["教师端-班级管理"])
app.include_router(teacher_student_monitor.router, prefix="/api/v1/teacher", tags=["教师-学生监控"])
app.include_router(presence.router, prefix="/api/v1", tags=["实时课堂"])
app.include_router(checkin.router, prefix="/api/v1", tags=["每日签到"])
app.include_router(student_progress.router, prefix="/api/v1/student", tags=["学生端-学习进度"])
app.include_router(student_learning_records.router, prefix="/api/v1/student", tags=["学生端-学习记录"])
app.include_router(student_mistake_book.router, prefix="/api/v1/student", tags=["学生端-错题集"])
app.include_router(student_reading.router, prefix="/api/v1/student", tags=["学生端-阅读理解"])
app.include_router(student_assignments.router, prefix="/api/v1/student", tags=["学生端-我的作业"])
app.include_router(student_homework.router, prefix="/api/v1/student", tags=["学生端-作业完成"])
app.include_router(student_dashboard.router, prefix="/api/v1/student", tags=["学生端-仪表板"])
app.include_router(student_coins.router, prefix="/api/v1/student", tags=["学生端-我的金币"])
app.include_router(student_pet.router, prefix="/api/v1/student", tags=["学生端-宠物养成"])
app.include_router(student_pet_battle.router, prefix="/api/v1/student", tags=["学生端-宠物对战"])
app.include_router(student_pet_battle_ws.router, prefix="/api/v1/student", tags=["学生端-宠物对战WS"])
app.include_router(student_pet_healing.router, prefix="/api/v1/student", tags=["学生端-宠物治疗"])
app.include_router(student_unit_exam.router, prefix="/api/v1/student/exam", tags=["学生端-单元考试"])
app.include_router(student_leaderboard.router, prefix="/api/v1/student", tags=["学生端-光荣榜"])
app.include_router(student_class_join.router, prefix="/api/v1/student", tags=["学生端-加入班级"])
app.include_router(parent.router, prefix="/api/v1", tags=["家长端"])
app.include_router(admin_users.router, prefix="/api/v1/admin", tags=["管理员-用户管理"])
app.include_router(admin_organizations.router, prefix="/api/v1/admin", tags=["管理员-机构管理"])
app.include_router(org_admin.router, prefix="/api/v1/org", tags=["机构管理端"])
app.include_router(admin_content.router, prefix="/api/v1/admin/content", tags=["管理员-内容管理"])
app.include_router(admin_statistics.router, prefix="/api/v1/admin", tags=["管理员-统计数据"])
app.include_router(admin_ai_config.router, prefix="/api/v1/admin/ai", tags=["管理员-AI配置"])
app.include_router(admin_subscriptions.router, prefix="/api/v1/admin/subscriptions", tags=["管理员-订阅管理"])
app.include_router(admin_system_update.router, prefix="/api/v1/admin/system", tags=["管理员-系统更新"])
app.include_router(admin_teachers.router, prefix="/api/v1/admin", tags=["管理员-教师"])
app.include_router(admin_classes.router, prefix="/api/v1/admin", tags=["管理员-班级"])
app.include_router(admin_settings.router, prefix="/api/v1/admin", tags=["管理员-系统设置"])
app.include_router(admin_class_analytics.router, prefix="/api/v1/admin", tags=["管理员-班级学习统计"])
app.include_router(admin_competition.router, prefix="/api/v1/admin", tags=["管理员-单词比赛"])
app.include_router(admin_student_books.router, prefix="/api/v1/admin", tags=["管理员-学生书本与成绩"])
app.include_router(subscription.router, prefix="/api/v1/subscription", tags=["订阅兑换"])
app.include_router(pronunciation.router, prefix="/api/v1/pronunciation", tags=["语音评测"])
app.include_router(assessment.router, prefix="/api/v1/assessment", tags=["测评漏斗"])
app.include_router(sentences.router, prefix="/api/v1/sentences", tags=["句子背诵"])
app.include_router(pk_routes.router, prefix="/api/v1/pk", tags=["PK竞技场"])
app.include_router(pk_websocket.router, prefix="/api/v1/pk", tags=["PK竞技场-WS"])
app.include_router(pk_tournament_routes.router, prefix="/api/v1/pk", tags=["PK晋级赛"])

@app.get("/")
async def root():
    return {
        "message": "欢迎使用英语学习助手 API",
        "version": "1.0.0",
        "docs": "/docs"
    }

@app.get("/health")
async def health_check():
    return {"status": "healthy"}
