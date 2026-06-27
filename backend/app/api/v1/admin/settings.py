"""管理员 - 系统设置读写

设置以单行 JSON 存于 system_settings 表(key='global')。
GET 返回当前设置(与前端默认值合并,保证字段齐全);PUT 整体覆盖保存。
注意:本接口只负责"持久化设置值",部分开关(如自动备份/会话超时/邮箱验证)
当前后端尚无对应执行逻辑,存下来的值需配合后续功能开发才会真正生效。
"""
import json

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.user import User
from app.api.v1.auth import get_current_admin

router = APIRouter()

SETTINGS_KEY = "global"

# 系统设置默认值(与前端 AdminSettings 字段一一对应)
DEFAULT_SETTINGS = {
    "siteName": "英语学习助手",
    "allowRegistration": True,
    "requireEmailVerification": False,
    "enableAI": True,
    "aiProvider": "openai",
    "maxUploadSize": 10,
    "sessionTimeout": 30,
    "enableNotifications": True,
    "enableBackup": True,
    "backupInterval": 24,
}


class SettingsPayload(BaseModel):
    siteName: str
    allowRegistration: bool
    requireEmailVerification: bool
    enableAI: bool
    aiProvider: str
    maxUploadSize: int
    sessionTimeout: int
    enableNotifications: bool
    enableBackup: bool
    backupInterval: int


async def _read_settings(db: AsyncSession) -> dict:
    """读取设置,与默认值合并(新增字段时旧数据也能补齐)"""
    result = await db.execute(
        text("SELECT value FROM system_settings WHERE key = :k"),
        {"k": SETTINGS_KEY},
    )
    row = result.fetchone()
    merged = dict(DEFAULT_SETTINGS)
    if row and row[0]:
        try:
            stored = json.loads(row[0])
            if isinstance(stored, dict):
                merged.update({k: stored[k] for k in DEFAULT_SETTINGS if k in stored})
        except (ValueError, TypeError):
            pass
    return merged


@router.get("/settings")
async def get_settings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """获取系统设置"""
    return await _read_settings(db)


@router.put("/settings")
async def update_settings(
    payload: SettingsPayload,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin),
):
    """保存系统设置(整体覆盖)"""
    value = json.dumps(payload.model_dump(), ensure_ascii=False)
    # UPSERT: 有则更新,无则插入
    await db.execute(
        text(
            "INSERT INTO system_settings (key, value) VALUES (:k, :v) "
            "ON CONFLICT(key) DO UPDATE SET value = :v"
        ),
        {"k": SETTINGS_KEY, "v": value},
    )
    await db.commit()
    return await _read_settings(db)
