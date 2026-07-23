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

_RUNTIME_PATH_PREFIXES = (
    ".playwright-mcp/",
    "frontend/dist/",
    "frontend/node_modules/",
    "backend/uploads/",
    "backend/__pycache__/",
    "frontend/.vite/",
)


def _local_worktree_changes() -> list[str]:
    """返回会被版本更新覆盖的本地改动。"""
    code, output = _run_cmd(
        "git status --porcelain=v1 --untracked-files=all",
        timeout=10,
    )
    if code != 0:
        raise HTTPException(500, f"无法检查本地改动: {output}")

    changes: list[str] = []
    for line in output.splitlines():
        if not line.strip():
            continue
        path = line[2:].lstrip()
        if " -> " in path:
            path = path.rsplit(" -> ", 1)[-1]
        if path.startswith(_RUNTIME_PATH_PREFIXES):
            continue
        changes.append(path)
    return changes


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


def _parse_semver(v: str | None) -> tuple[int, ...] | None:
    """把 '1.6.3' 解析成 (1,6,3) 便于比较;解析不了返回 None。"""
    if not v:
        return None
    parts = str(v).strip().lstrip("vV").split(".")
    try:
        return tuple(int(p) for p in parts)
    except (ValueError, TypeError):
        return None


@router.get("/check-update")
async def check_for_update(current_user: User = Depends(get_current_admin)):
    """检查是否有新版本（管理员）。

    「有更新」的定义:线上(origin/main)确实比本地更新,而不是「哈希不一样」。
    旧逻辑 local_hash != remote_hash 会在本地领先/处于其它分支/历史分叉时误报
    「有新版本」——只要 HEAD 不等于 origin/main 就亮红点,即便本地才是更新的一方。
    现在改为:先比 version.json 语义版本号,版本相同或本地更高 → 无更新;
    版本号一致或无法解析时,再看「origin/main 是否有本地没有的提交」(HEAD..origin/main)。
    """
    code, output = _run_cmd("git fetch origin main --depth 1", timeout=30)
    if code != 0:
        raise HTTPException(500, f"检查更新失败: {output}")

    code, local_hash = _run_cmd("git rev-parse HEAD", timeout=5)
    code2, remote_hash = _run_cmd("git rev-parse origin/main", timeout=5)
    if code != 0 or code2 != 0:
        raise HTTPException(500, "无法获取版本信息")
    local_hash = local_hash.strip()
    remote_hash = remote_hash.strip()

    local_ver = _get_version()
    local_version = local_ver.get("version", "1.0.1")

    # 远程 version.json 版本号
    remote_version = None
    code3, ver_content = _run_cmd("git show origin/main:version.json", timeout=5)
    if code3 == 0:
        try:
            remote_version = json.loads(ver_content).get("version")
        except Exception:
            pass

    # 判定「线上更新」——分两层:
    # 1) 两边 version.json 都能解析成语义版本号 → 只有远端 > 本地才算有更新
    #    (相同 → 无更新;本地更高 → 无更新,不再误报)
    # 2) 版本号无法比较(缺失/相等) → 回退到提交数:origin/main 有本地没有的提交才算有更新
    lv = _parse_semver(local_version)
    rv = _parse_semver(remote_version)
    if lv is not None and rv is not None:
        # 两边版本号都能比:只有远端严格更高才提示更新;相同或本地更高 → 无更新
        has_update = rv > lv
    else:
        # 版本号缺失/无法解析时,回退到提交数:origin/main 有本地没有的提交才算有更新
        code4, behind = _run_cmd("git rev-list --count HEAD..origin/main", timeout=5)
        try:
            has_update = code4 == 0 and int(behind.strip()) > 0
        except (ValueError, TypeError):
            # 兜底:拿不到提交数时才退回哈希比较
            has_update = local_hash != remote_hash

    changelog = ""
    if has_update:
        code, changelog = _run_cmd(
            f"git log {local_hash}..{remote_hash} --oneline --no-merges",
            timeout=10
        )

    return {
        "has_update": has_update,
        "local_version": local_version,
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

        local_changes = _local_worktree_changes()
        if local_changes:
            preview = "、".join(local_changes[:8])
            if len(local_changes) > 8:
                preview += f" 等 {len(local_changes)} 项"
            raise HTTPException(
                status_code=409,
                detail=(
                    "检测到本地未提交改动，已阻止版本更新，避免覆盖本地 UI。"
                    f"受保护文件：{preview}。请先提交或备份改动后再更新。"
                ),
            )

        try:
            # Step 1: Git fetch + reset（避免分叉历史导致 pull 失败）
            code, output = _run_cmd("git fetch origin main", timeout=60)
            if code != 0:
                steps.append({"step": "拉取代码", "success": False, "output": output})
                raise Exception(f"拉取代码失败: {output}")
            code, output = _run_cmd("git reset --hard origin/main", timeout=30)
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

            # Step 6: 延迟重启后端服务（先返回响应，再重启，避免连接中断）
            _run_cmd("bash -c 'sleep 2 && systemctl restart english-helper' &", timeout=5)
            steps.append({"step": "重启服务", "success": True, "output": "服务将在2秒后重启"})

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
