from pydantic_settings import BaseSettings
from typing import List

# PK 房间人数上限(Python 侧唯一真源)。
# schemas/pk.py 的 Field(le=)、models/pk.py 的 CheckConstraint、core/database.py 的
# 建表 CHECK 全部引用这里,改一处即可 —— 三处各写字面量必然漂,而漂的后果是
# 对局打完才在落库时被 CHECK 拦下,整场成绩丢失。
# database_schema.sql / 前端 MAX_PLAYERS 跨语言无法共享,只能靠注释互相注明。
# 天花板不是 CPU 而是带宽:实时榜已改合并推送+按人裁剪,200 人单房约占 12M 的 30%。
PK_MAX_PLAYERS = 200


class Settings(BaseSettings):
    # 应用配置
    APP_NAME: str = "英语学习助手"
    DEBUG: bool = True

    # 多租户: P2 起默认开启强制隔离(全局过滤器注入 org 条件)。排查问题可临时置 False 回观察模式
    TENANCY_ENFORCE: bool = True

    # 数据库
    DATABASE_URL: str = "sqlite+aiosqlite:///./english_helper.db"

    # JWT
    SECRET_KEY: str = "your-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 10080  # 7天

    # CORS - 使用逗号分隔的字符串
    CORS_ORIGINS: str = "http://localhost:3000,http://localhost:5173,http://localhost:5174"

    # AI配置
    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = "gpt-4-turbo-preview"

    ANTHROPIC_API_KEY: str = ""
    ANTHROPIC_MODEL: str = "claude-3-sonnet-20240229"

    # 图片生成（gpt-image-2 OpenAI 兼容代理）
    IMAGE_API_URL: str = "https://pikachu.claudecode.love/v1/images/generations"
    IMAGE_API_KEY: str = ""
    IMAGE_MODEL: str = "gpt-image-2"

    # 腾讯云短信配置
    TENCENT_SMS_SECRET_ID: str = ""
    TENCENT_SMS_SECRET_KEY: str = ""
    TENCENT_SMS_APP_ID: str = ""
    TENCENT_SMS_SIGN_NAME: str = ""
    TENCENT_SMS_TEMPLATE_ID: str = ""

    # 文件上传
    MAX_UPLOAD_SIZE: int = 5242880  # 5MB
    UPLOAD_DIR: str = "./uploads"

    # 音标教学视频目录。**刻意与 UPLOAD_DIR 分开**:UPLOAD_DIR 整体经
    # /api/v1/files 公开无鉴权(见 main.py),只准放公开图片;视频要求登录才能看,
    # 所以落在这个私有目录,只经 /phonetics/videos/{id}/stream 鉴权后串流。
    PHONETIC_VIDEO_DIR: str = "./private_media/phonetics"
    # 单个视频上限(字节)。注意还受 nginx client_max_body_size 限制,
    # 两边要一起放开,否则大文件在 nginx 层就被拒(413),压根到不了应用
    MAX_VIDEO_SIZE: int = 200 * 1024 * 1024  # 200MB

    @property
    def cors_origins_list(self) -> List[str]:
        """将CORS字符串转换为列表"""
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",")]

    class Config:
        env_file = ".env"
        case_sensitive = True
        extra = "ignore"  # 忽略额外的环境变量

settings = Settings()
