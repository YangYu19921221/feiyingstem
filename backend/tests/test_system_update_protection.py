import asyncio
import json

import pytest

from app.api.v1.admin import system_update


def test_parse_semver():
    assert system_update._parse_semver("1.6.3") == (1, 6, 3)
    assert system_update._parse_semver("v1.6.3") == (1, 6, 3)
    assert system_update._parse_semver("2.0") == (2, 0)
    assert system_update._parse_semver(None) is None
    assert system_update._parse_semver("abc") is None


def _fake_git(*, local_hash, remote_hash, remote_version, behind):
    """按命令关键字返回假的 git 输出,驱动 check-update 的判定分支。"""
    def _run(cmd, cwd=system_update.PROJECT_ROOT, timeout=120):
        if cmd.startswith("git fetch"):
            return (0, "")
        if cmd == "git rev-parse HEAD":
            return (0, local_hash)
        if cmd == "git rev-parse origin/main":
            return (0, remote_hash)
        if "version.json" in cmd:
            return (0, json.dumps({"version": remote_version})) if remote_version else (1, "")
        if "rev-list --count HEAD..origin/main" in cmd:
            return (0, str(behind))
        if cmd.startswith("git log"):
            return (0, "abc123 some commit")
        return (0, "")
    return _run


def _check(monkeypatch, *, local_version, local_hash, remote_hash, remote_version, behind):
    monkeypatch.setattr(system_update, "_get_version",
                        lambda: {"version": local_version, "build_date": "x"})
    monkeypatch.setattr(system_update, "_run_cmd",
                        _fake_git(local_hash=local_hash, remote_hash=remote_hash,
                                  remote_version=remote_version, behind=behind))
    return asyncio.run(system_update.check_for_update(current_user=None))


def test_same_version_no_update(monkeypatch):
    # 本地与线上版本号一样 → 不提示更新(即便 commit 哈希不同也不误报)
    r = _check(monkeypatch, local_version="1.6.3", local_hash="aaa", remote_hash="bbb",
               remote_version="1.6.3", behind=5)
    assert r["has_update"] is False


def test_remote_newer_has_update(monkeypatch):
    r = _check(monkeypatch, local_version="1.6.3", local_hash="aaa", remote_hash="bbb",
               remote_version="1.7.0", behind=3)
    assert r["has_update"] is True
    assert r["remote_version"] == "1.7.0"


def test_local_ahead_no_update(monkeypatch):
    # 本地版本比线上高(开发机领先)→ 绝不提示"需要更新"
    r = _check(monkeypatch, local_version="1.7.0", local_hash="aaa", remote_hash="bbb",
               remote_version="1.6.3", behind=0)
    assert r["has_update"] is False


def test_equal_version_falls_back_to_commit_count(monkeypatch):
    # 版本号都缺失/相等时回退看提交数:origin 领先才算有更新
    r = _check(monkeypatch, local_version="1.6.3", local_hash="aaa", remote_hash="bbb",
               remote_version=None, behind=2)
    assert r["has_update"] is True
    r2 = _check(monkeypatch, local_version="1.6.3", local_hash="aaa", remote_hash="aaa",
                remote_version=None, behind=0)
    assert r2["has_update"] is False


def test_local_worktree_changes_keeps_source_and_ignores_runtime(monkeypatch):
    status = "\n".join(
        [
            " M frontend/src/App.tsx",
            "?? frontend/src/components/student/StudentMobileNav.tsx",
            "?? frontend/dist/assets/app.js",
            "?? backend/uploads/generated/cover.png",
        ]
    )
    monkeypatch.setattr(system_update, "_run_cmd", lambda *args, **kwargs: (0, status))

    assert system_update._local_worktree_changes() == [
        "frontend/src/App.tsx",
        "frontend/src/components/student/StudentMobileNav.tsx",
    ]


def test_local_worktree_changes_fails_closed(monkeypatch):
    monkeypatch.setattr(system_update, "_run_cmd", lambda *args, **kwargs: (128, "not a git repository"))

    try:
        system_update._local_worktree_changes()
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 500
    else:
        raise AssertionError("git 状态读取失败时必须阻止更新")
