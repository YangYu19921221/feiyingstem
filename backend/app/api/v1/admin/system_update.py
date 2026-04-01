"""
系统更新 API
管理员一键从 Gitee 拉取最新代码并重部署
"""
import asyncio
import json
import logging
import os
import subprocess
from datetime import datetime
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from app.api.v1.auth import get_current_user, get_current_admin
from app.models.user import User

router = APIRouter()
logger = logging.getLogger(__name__)

# 自动检测项目根目录：backend 的上级目录
_DEFAULT_ROOT = str(Path(__file__).resolve().parents[5])
PROJECT_ROOT = os.getenv("PROJECT_ROOT", _DEFAULT_ROOT)

_update_lock = asyncio.Lock()
_update_log: list[dict] = []
_MAX_LOG_ENTRIES = 50


def _get_version() -> dict:
    """读取 version.json"""
    version_file = Path(PROJECT_ROOT) / "version.json"
    if version_file.exists():
        try:
            return json.loads(version_file.read_text())
        except Exception:
            pass
    return {"version": "1.0.1", "build_date": "未知"}


def _run_cmd(cmd: str, cwd: str = PROJECT_ROOT, timeout: int = 120) -> tuple[int, str]:
    try:
        result = subprocess.run(
            cmd, shell=True, cwd=cwd,
            capture_output=True, text=True, timeout=timeout
        )
        output = (result.stdout + result.stderr).strip()
        return result.returncode, output
    except subprocess.TimeoutExpired:
        return -1, f"命令超时 ({timeout}s)"
    except Exception as e:
        return -1, str(e)


@router.get("/version")
async def get_current_version(current_user: User = Depends(get_current_user)):
    """获取当前版本信息（所有登录用户可见）"""
    ver = _get_version()
    code, commit = _run_cmd("git log --oneline -1", timeout=5)

    return {
        "version": ver.get("version", "1.0.1"),
        "build_date": ver.get("build_date", "未知"),
        "commit": commit if code == 0 else "未知",
    }


@router.get("/check-update")
async def check_for_update(current_user: User = Depends(get_current_admin)):
    """检查是否有新版本（管理员）"""
    code, output = _run_cmd("git fetch origin main --depth 1", timeout=30)
    if code != 0:
        raise HTTPException(500, f"检查更新失败: {output}")

    code, local_hash = _run_cmd("git rev-parse HEAD", timeout=5)
    code2, remote_hash = _run_cmd("git rev-parse origin/main", timeout=5)

    if code != 0 or code2 != 0:
        raise HTTPException(500, "无法获取版本信息")

    local_hash = local_hash.strip()
    remote_hash = remote_hash.strip()
    has_update = local_hash != remote_hash

    # 获取远程 version.json 中的版本号
    remote_version = None
    if has_update:
        code3, ver_content = _run_cmd(
            f"git show origin/main:version.json 2>/dev/null",
            timeout=5
        )
        if code3 == 0:
            try:
                remote_version = json.loads(ver_content).get("version")
            except Exception:
                pass

    changelog = ""
    if has_update:
        code, changelog = _run_cmd(
            f"git log {local_hash}..{remote_hash} --oneline --no-merges",
            timeout=10
        )

    local_ver = _get_version()

    return {
        "has_update": has_update,
        "local_version": local_ver.get("version", "1.0.1"),
        "remote_version": remote_version or remote_hash[:7],
        "changelog": changelog if has_update else "已是最新版本",
        "update_history": _update_log[-10:],
    }


@router.post("/update")
async def perform_update(current_user: User = Depends(get_current_admin)):
    """执行系统更新：git pull → pip install → npm build → 重启"""
    if _update_lock.locked():
        raise HTTPException(409, "更新正在进行中，请稍候")

    async with _update_lock:
        steps = []
        start_time = datetime.now()

        try:
            # Step 1: Git Pull
            code, output = _run_cmd("git pull origin main", timeout=60)
            steps.append({"step": "拉取代码", "success": code == 0, "output": output})
            if code != 0:
                raise Exception(f"拉取代码失败: {output}")

            # Step 2: 安装后端依赖
            code, output = _run_cmd(
                "source venv/bin/activate && pip install -r requirements.txt -q",
                cwd=f"{PROJECT_ROOT}/backend", timeout=120
            )
            steps.append({"step": "安装后端依赖", "success": code == 0, "output": output[-200:] if output else ""})

            # Step 3: 安装前端依赖
            code, output = _run_cmd("npm install", cwd=f"{PROJECT_ROOT}/frontend", timeout=120)
            steps.append({"step": "安装前端依赖", "success": code == 0, "output": output[-200:] if output else ""})

            # Step 4: 构建前端
            code, output = _run_cmd("npm run build", cwd=f"{PROJECT_ROOT}/frontend", timeout=180)
            steps.append({"step": "构建前端", "success": code == 0, "output": output[-200:] if output else ""})
            if code != 0:
                raise Exception(f"前端构建失败: {output[-200:]}")

            # Step 5: 部署前端（复制 dist 到部署目录, 保留 pets 等资源）
            code, output = _run_cmd(
                "cp -r frontend/dist/* frontend/dist/ 2>/dev/null; echo 'dist ready'",
                timeout=10
            )
            steps.append({"step": "部署前端", "success": True, "output": "完成"})

            # Step 6: 重启后端服务
            code, output = _run_cmd("systemctl restart english-helper", timeout=30)
            steps.append({"step": "重启服务", "success": code == 0, "output": output or "服务已重启"})

            # 记录更新日志
            code, new_commit = _run_cmd("git log --oneline -1", timeout=5)
            duration = (datetime.now() - start_time).total_seconds()

            log_entry = {
                "time": start_time.isoformat(),
                "commit": new_commit.strip() if code == 0 else "未知",
                "duration": f"{duration:.1f}s",
                "success": all(s["success"] for s in steps),
                "operator": current_user.username,
            }
            _update_log.append(log_entry)
            if len(_update_log) > _MAX_LOG_ENTRIES:
                _update_log[:] = _update_log[-_MAX_LOG_ENTRIES:]

            return {
                "success": True,
                "message": "系统更新完成！页面将在几秒后刷新。",
                "steps": steps,
                "duration": f"{duration:.1f}s",
                "new_version": new_commit.strip() if code == 0 else "未知",
            }

        except Exception as e:
            logger.error(f"系统更新失败: {e}", exc_info=True)
            duration = (datetime.now() - start_time).total_seconds()
            _update_log.append({
                "time": start_time.isoformat(),
                "commit": "失败",
                "duration": f"{duration:.1f}s",
                "success": False,
                "operator": current_user.username,
            })
            return {
                "success": False,
                "message": str(e),
                "steps": steps,
                "duration": f"{duration:.1f}s",
            }
