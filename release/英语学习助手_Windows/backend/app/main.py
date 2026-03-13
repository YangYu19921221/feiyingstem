from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse
from contextlib import asynccontextmanager
from pathlib import Path
import os

from app.core.config import settings
from app.core.database import init_db
from app.api.v1 import auth, words, learning, exams, ai, competition, achievements, analytics
from app.api.v1.teacher import units as teacher_units, competition_questions as teacher_competition, analytics as teacher_analytics, reading as teacher_reading, book_assignments as teacher_assignments, homework as teacher_homework, dashboard as teacher_dashboard, exam_generator as teacher_exam_generator
from app.api.v1.student import progress as student_progress, learning_records as student_learning_records, mistake_book as student_mistake_book, reading as student_reading, assignments as student_assignments, homework as student_homework, dashboard as student_dashboard
from app.api.v1.admin import users as admin_users, content as admin_content, statistics as admin_statistics, ai_config as admin_ai_config

# 获取前端静态文件目录
BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR.parent / "frontend" / "dist"

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
    allow_origins=["*"],  # 允许所有来源
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册API路由
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
app.include_router(admin_users.router, prefix="/api/v1/admin", tags=["管理员-用户管理"])
app.include_router(admin_content.router, prefix="/api/v1/admin/content", tags=["管理员-内容管理"])
app.include_router(admin_statistics.router, prefix="/api/v1/admin", tags=["管理员-统计数据"])
app.include_router(admin_ai_config.router, prefix="/api/v1/admin/ai", tags=["管理员-AI配置"])

# 检查前端目录是否存在
if FRONTEND_DIR.exists():
    # 挂载静态资源目录
    assets_dir = FRONTEND_DIR / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

# 前端路由 - 放在最后，作为catch-all
@app.get("/{full_path:path}")
async def serve_frontend(full_path: str, request: Request):
    """
    提供前端静态文件服务
    所有非API路由都返回index.html，支持前端路由
    """
    # API路由直接返回404
    if full_path.startswith("api/"):
        return {"detail": "Not Found"}

    # 检查是否请求静态文件
    if FRONTEND_DIR.exists():
        # 尝试提供静态文件
        file_path = FRONTEND_DIR / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(file_path)

        # 对于所有其他路径，返回index.html（支持前端路由）
        index_path = FRONTEND_DIR / "index.html"
        if index_path.exists():
            return FileResponse(index_path)

    # 如果没有前端文件，返回简单的欢迎页面
    return HTMLResponse(content="""
    <!DOCTYPE html>
    <html>
    <head>
        <title>英语学习助手</title>
        <meta charset="utf-8">
        <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
            h1 { color: #FF6B35; }
            a { color: #00D9FF; }
        </style>
    </head>
    <body>
        <h1>🎓 英语学习助手</h1>
        <p>后端服务已启动!</p>
        <p><a href="/docs">查看API文档</a></p>
    </body>
    </html>
    """)
