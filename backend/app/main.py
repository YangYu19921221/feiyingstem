from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from app.core.config import settings
from app.core.database import init_db
from app.api.v1 import auth, words, learning, exams, ai, competition, achievements, analytics
from app.api.v1.teacher import units as teacher_units, competition_questions as teacher_competition, analytics as teacher_analytics, reading as teacher_reading, book_assignments as teacher_assignments, homework as teacher_homework, dashboard as teacher_dashboard, exam_generator as teacher_exam_generator
from app.api.v1.student import progress as student_progress, learning_records as student_learning_records, mistake_book as student_mistake_book, reading as student_reading, assignments as student_assignments, homework as student_homework, dashboard as student_dashboard, pet as student_pet, unit_exam as student_unit_exam
from app.api.v1.admin import users as admin_users, content as admin_content, statistics as admin_statistics, ai_config as admin_ai_config, subscriptions as admin_subscriptions
from app.api.v1 import subscription, pronunciation

@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动时初始化数据库
    await init_db()
    yield
    # 关闭时清理资源
    pass

app = FastAPI(
    title=settings.APP_NAME,
    description="中小学生英语学习系统API",
    version="1.0.0",
    lifespan=lifespan
)

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
app.include_router(teacher_dashboard.router, prefix="/api/v1/teacher", tags=["教师端-仪表板"])
app.include_router(teacher_exam_generator.router, prefix="/api/v1/teacher", tags=["教师端-AI试卷生成"])
app.include_router(student_progress.router, prefix="/api/v1/student", tags=["学生端-学习进度"])
app.include_router(student_learning_records.router, prefix="/api/v1/student", tags=["学生端-学习记录"])
app.include_router(student_mistake_book.router, prefix="/api/v1/student", tags=["学生端-错题集"])
app.include_router(student_reading.router, prefix="/api/v1/student", tags=["学生端-阅读理解"])
app.include_router(student_assignments.router, prefix="/api/v1/student", tags=["学生端-我的作业"])
app.include_router(student_homework.router, prefix="/api/v1/student", tags=["学生端-作业完成"])
app.include_router(student_dashboard.router, prefix="/api/v1/student", tags=["学生端-仪表板"])
app.include_router(student_pet.router, prefix="/api/v1/student", tags=["学生端-宠物养成"])
app.include_router(student_unit_exam.router, prefix="/api/v1/student/exam", tags=["学生端-单元考试"])
app.include_router(admin_users.router, prefix="/api/v1/admin", tags=["管理员-用户管理"])
app.include_router(admin_content.router, prefix="/api/v1/admin/content", tags=["管理员-内容管理"])
app.include_router(admin_statistics.router, prefix="/api/v1/admin", tags=["管理员-统计数据"])
app.include_router(admin_ai_config.router, prefix="/api/v1/admin/ai", tags=["管理员-AI配置"])
app.include_router(admin_subscriptions.router, prefix="/api/v1/admin/subscriptions", tags=["管理员-订阅管理"])
app.include_router(subscription.router, prefix="/api/v1/subscription", tags=["订阅兑换"])
app.include_router(pronunciation.router, prefix="/api/v1/pronunciation", tags=["语音评测"])

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
