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

    # ---- 线上授课(直播)课件资料 ----
    # 同 PHONETIC_VIDEO_DIR 的理由:**必须与 UPLOAD_DIR 分开**。课件是"能看不能下"的
    # 受保护资料,原文件永不下发,学生只拿逐页渲染+烧水印的图。
    MATERIAL_DIR: str = "./private_media/materials"
    MAX_MATERIAL_SIZE: int = 100 * 1024 * 1024  # 100MB(nginx client_max_body_size 要同步放开)
    # 水印主文案。学生姓名/学号/时间由服务端按人拼在后面,不走配置
    WATERMARK_TEXT: str = "飞鹰教育"
    # 渲染页 DPI。144 够清晰又不至于让 100 页 PDF 撑爆磁盘
    MATERIAL_RENDER_DPI: int = 144

    # ---- 音标跟读录音 ----
    # 同 PHONETIC_VIDEO_DIR 的理由:**必须与 UPLOAD_DIR 分开**。
    # 这是**孩子的声音**,属于未成年人个人信息,绝不能落进公开无鉴权的目录;
    # 只经鉴权端点串流给本人和本班老师听。
    PHONETIC_AUDIO_DIR: str = "./private_media/phonetic_audio"
    # 单条跟读上限。一个单词最多录 5 秒,1MB 足够(webm/opus 约 20KB/秒)
    MAX_PHONETIC_AUDIO_SIZE: int = 1024 * 1024  # 1MB
    # 每个学生每节课最多留多少条录音:只留最近的,老的自动删。
    # 不设上限的话一个班一学期能堆出几十万条小文件
    PHONETIC_AUDIO_KEEP_PER_LESSON: int = 40

    # 跟读判定服务(独立进程)。空字符串 = 不启用,跟读退回纯对比回放模式。
    # 模型推理常驻约 2.6GB,而生产机可用内存只剩 4.6GB 且 uvicorn 单 worker
    # (PK 房间/限流是进程内状态),所以刻意跑在独立进程里,主应用只做 HTTP 调用。
    PHONEME_JUDGE_URL: str = ""

    # ---- 直播媒体平面 ----
    # SRS 源站。**媒体流量绝不走本服务**(本机出口带宽只有 12Mbps,是既有容量瓶颈),
    # 老师推到源站、学生从 CDN 拉,本服务只签发凭据。
    # 扩容路径:并行课变多→加源站节点按 live_sessions.origin_node 派发;
    # 要换云直播 SaaS 只改本组配置和签发逻辑,不动表结构。
    LIVE_ENABLED: bool = False           # 未配置源站时为 False,前端隐藏直播入口
    LIVE_ORIGIN_HOST: str = ""           # SRS 源站域名,如 live.feiyingsteam.com
    LIVE_PUSH_PATH: str = "/live"        # RTMP/WHIP 应用名
    # 协议。**生产必须 https**(浏览器只在安全上下文给 getUserMedia,WHIP 推流否则直接失败);
    # 本地 localhost 是特许安全上下文,可用 http 免证书调试
    LIVE_SCHEME: str = "https"
    # WHIP 端点所在的 host:port。生产留空 → 用 LIVE_ORIGIN_HOST(Nginx 443 反代到 1985);
    # 本地无 Nginx 要直连 SRS 的 HTTP-API 端口,填 localhost:1985
    LIVE_API_HOST: str = ""
    # RTMP 推流端口。**不能复用 LIVE_ORIGIN_HOST 里的 HTTP 端口** ——
    # RTMP 是独立协议独立端口,混用会给出连不上的地址(给 OBS 老师用)
    LIVE_RTMP_PORT: int = 1935
    LIVE_CDN_HOST: str = ""              # 播放走的 CDN 域名(留空则回退直连源站)
    # CDN 鉴权密钥(腾讯云/阿里云 TypeA 防盗链)。播放地址按人签发、几分钟过期,
    # 不设的话链接被转发到校外挡不住
    LIVE_CDN_AUTH_KEY: str = ""
    LIVE_PLAY_TOKEN_TTL: int = 300       # 播放票据有效期(秒)
    # 开播前踢残留推流者的开关。老师上次没干净停(关页面/断网,DTLS 没挥手)时,
    # SRS 那路 publish 要靠超时才回收,期间重开同一节课(stream_key 不变)会撞
    # RtcStreamBusy → 502。开播前先调 SRS API 踢掉同 stream 的残留 publisher 即可根治。
    # 留空 → 用 LIVE_API_HOST 或 LIVE_ORIGIN_HOST(经 Nginx 443 反代到 SRS 1985)。
    LIVE_SRS_API_HOST: str = ""
    LIVE_KICK_BEFORE_PUBLISH: bool = True

    @property
    def cors_origins_list(self) -> List[str]:
        """将CORS字符串转换为列表"""
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",")]

    class Config:
        env_file = ".env"
        case_sensitive = True
        extra = "ignore"  # 忽略额外的环境变量

settings = Settings()
