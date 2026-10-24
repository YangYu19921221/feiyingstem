"""发音组件夜间自检(services/tts_guard.py)

外部动作(合成 / 临时环境 / pip / 重启 / 接口验证)全部替换掉,只测判定分支:
正常不动、白天不升级、新版能出声才升级、升级后不行就退回、同版本能出声不升级。
"""
from datetime import datetime

import pytest

from app.services import tts_guard
from app.models.user import User
from tests.conftest import _make_token

NIGHT = datetime(2026, 10, 25, 3, 37, tzinfo=tts_guard._BJ)
DAY = datetime(2026, 10, 25, 10, 0, tzinfo=tts_guard._BJ)


@pytest.fixture
def env(monkeypatch, tmp_path):
    """可控的假环境: probe 按调用顺序返回结果,记录 pip / 重启调用"""
    state = {"probes": [], "pip": [], "restarts": 0, "version": "7.2.8",
             "temp": ("7.3.1", True, ""), "http_ok": True}
    monkeypatch.setattr(tts_guard, "STATUS_FILE", tmp_path / "status.json")

    def fake_probe(python):
        ok = state["probes"].pop(0)
        return ok, "" if ok else "403, message='Invalid response status'"

    def fake_pip(python, spec):
        state["pip"].append(spec)
        state["version"] = spec.split("==")[1]
        return True, ""

    def fake_restart():
        state["restarts"] += 1
        return True, ""

    monkeypatch.setattr(tts_guard, "probe", fake_probe)
    monkeypatch.setattr(tts_guard, "installed_version", lambda python: state["version"])
    monkeypatch.setattr(tts_guard, "pip_install", fake_pip)
    monkeypatch.setattr(tts_guard, "try_latest_in_temp", lambda: state["temp"])
    monkeypatch.setattr(tts_guard, "restart_service", fake_restart)
    monkeypatch.setattr(tts_guard, "http_ok", lambda wait_seconds=60: state["http_ok"])
    return state


def test_healthy_does_nothing(env):
    env["probes"] = [True]
    e = tts_guard.run_check(now=NIGHT)
    assert e["ok"] and e["action"] == "none"
    assert env["pip"] == [] and env["restarts"] == 0
    assert tts_guard.read_status()["message"].startswith("发音正常")


def test_daytime_failure_only_records(env):
    # 白天坏了也不升级不重启(会断开正在上的课)
    env["probes"] = [False]
    e = tts_guard.run_check(now=DAY)
    assert not e["ok"] and e["action"] == "skipped_daytime"
    assert env["pip"] == [] and env["restarts"] == 0


def test_night_failure_upgrades_when_latest_works(env):
    env["probes"] = [False, True]
    e = tts_guard.run_check(now=NIGHT)
    assert e["ok"] and e["action"] == "upgraded"
    assert env["pip"] == ["edge-tts==7.3.1"] and env["restarts"] == 1
    assert e["version_before"] == "7.2.8" and e["version_after"] == "7.3.1"
    st = tts_guard.read_status()
    assert st["recent_upgrade"]["version_after"] == "7.3.1"


def test_latest_also_broken_leaves_prod_alone(env):
    # 最新版在临时环境里也出不了声 = 不是版本问题,线上不动
    env["probes"] = [False]
    env["temp"] = ("7.3.1", False, "network unreachable")
    e = tts_guard.run_check(now=NIGHT)
    assert not e["ok"] and e["action"] == "failed"
    assert env["pip"] == [] and env["restarts"] == 0


def test_same_version_works_in_temp_does_not_upgrade(env):
    env["probes"] = [False]
    env["temp"] = ("7.2.8", True, "")
    e = tts_guard.run_check(now=NIGHT)
    assert not e["ok"] and e["action"] == "failed"
    assert env["pip"] == [] and env["restarts"] == 0


def test_upgrade_still_broken_rolls_back_without_restart(env):
    env["probes"] = [False, False]
    e = tts_guard.run_check(now=NIGHT)
    assert not e["ok"] and e["action"] == "failed"
    assert env["pip"] == ["edge-tts==7.3.1", "edge-tts==7.2.8"]
    assert env["restarts"] == 0


def test_history_capped_and_newest_first(env):
    env["probes"] = [True] * (tts_guard.HISTORY_KEEP + 5)
    for _ in range(tts_guard.HISTORY_KEEP + 5):
        tts_guard.run_check(now=NIGHT)
    assert len(tts_guard.read_history()) == tts_guard.HISTORY_KEEP


def test_is_night_window():
    assert tts_guard.is_night(datetime(2026, 10, 25, 23, 5, tzinfo=tts_guard._BJ))
    assert tts_guard.is_night(datetime(2026, 10, 25, 6, 59, tzinfo=tts_guard._BJ))
    assert not tts_guard.is_night(datetime(2026, 10, 25, 7, 0, tzinfo=tts_guard._BJ))
    assert not tts_guard.is_night(datetime(2026, 10, 25, 15, 0, tzinfo=tts_guard._BJ))


@pytest.mark.asyncio
async def test_status_endpoint_admin_only(client, db_session, teacher_token, monkeypatch, tmp_path):
    monkeypatch.setattr(tts_guard, "STATUS_FILE", tmp_path / "status.json")
    url = "/api/v1/admin/system/tts-status"
    r = await client.get(url, headers={"Authorization": f"Bearer {teacher_token}"})
    assert r.status_code == 403

    admin = User(username="adminttsguard", email="adminttsguard@example.com", hashed_password="x",
                 role="admin", full_name="Admin", is_active=True)
    db_session.add(admin)
    await db_session.commit()
    await db_session.refresh(admin)
    h = {"Authorization": f"Bearer {_make_token(admin.id)}"}
    r = await client.get(url, headers=h)
    assert r.status_code == 200 and r.json() == {"status": None}

    tts_guard._save({"checked_at": "2026-10-25T03:37:00+08:00", "ok": True, "action": "none",
                     "message": "发音正常(edge-tts 7.3.1)", "version_before": "7.3.1",
                     "version_after": "7.3.1", "detail": ""})
    r = await client.get(url, headers=h)
    assert r.json()["status"]["message"].startswith("发音正常")
