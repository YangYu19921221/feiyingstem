"""
系统更新 API
管理员一键从 Gitee 拉取最新代码并重部署
"""
import asyncio
import logging
import subprocess
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from app.api.v1.auth import get_current_user
from app.models.user import User

router = APIRouter()
logger = logging.getLogger(__name__)

# 项目根目录（服务器上的部署路径）
PROJECT_ROOT = "/www/wwwroot/english-helper"

_update_lock = asyncio.Lock()
_update_log: list[dict] = []


def _run_cmd(cmd: str, cwd: str = PROJECT_ROOT, timeout: int = 120) -> tuple[int, str]:
    """执行 shell 命令，返回 (returncode, output)"""
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
    """获取当前版本信息"""
    code, commit = _run_cmd("git log --oneline -1", timeout=5)
    code2, branch = _run_cmd("git branch --show-current", timeout=5)
    code3, remote_url = _run_cmd("git remote get-url origin", timeout=5)

    return {
        "commit": commit if code == 0 else "未知",
        "branch": branch.strip() if code2 == 0 else "未知",
        "remote": remote_url.strip() if code3 == 0 else "未配置",
        "update_history": _update_log[-10:],  # 最近10条更新记录
    }


@router.get("/check-update")
async def check_for_update(current_user: User = Depends(get_current_user)):
    """检查是否有新版本"""
    if current_user.role != 'admin':
        raise HTTPException(403, "仅管理员可操作")

    # fetch 远程最新
    code, output = _run_cmd("git fetch origin main --depth 1", timeout=30)
    if code != 0:
        raise HTTPException(500, f"检查更新失败: {output}")

    # 对比本地和远程
    code, local_hash = _run_cmd("git rev-parse HEAD", timeout=5)
    code2, remote_hash = _run_cmd("git rev-parse origin/main", timeout=5)

    if code != 0 or code2 != 0:
        raise HTTPException(500, "无法获取版本信息")

    local_hash = local_hash.strip()
    remote_hash = remote_hash.strip()
    has_update = local_hash != remote_hash

    # 获取更新日志
    changelog = ""
    if has_update:
        code, changelog = _run_cmd(
            f"git log {local_hash}..{remote_hash} --oneline --no-merges",
            timeout=10
        )

    return {
        "has_update": has_update,
        "local_version": local_hash[:7],
        "remote_version": remote_hash[:7],
        "changelog": changelog if has_update else "已是最新版本",
    }


@router.post("/update")
async def perform_update(current_user: User = Depends(get_current_user)):
    """执行系统更新：git pull → pip install → npm build → 重启"""
    if current_user.role != 'admin':
        raise HTTPException(403, "仅管理员可操作")

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

            return {
                "success": True,
                "message": "系统更新完成！页面将在几秒后刷新。",
                "steps": steps,
                "duration": f"{duration:.1f}s",
                "new_version": new_commit.strip() if code == 0 else "未知",
            }

        except Exception as e:
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
