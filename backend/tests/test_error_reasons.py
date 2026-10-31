"""出错时告诉用户为什么(2026-10-31,用户「下次如果出现这样的问题你要提示让用户知道这是什么原因」)

守四件事:
1. AI 失败翻成一句中文原因(欠费 / Key 失效 / 太忙 / 超时),不把上游英文报错甩给孩子
2. 记忆妙招失败: 给原因 + 退回今天的次数(孩子什么都没拿到)
3. 默认 AI 通道最近一次失败记下来给管理员看,成功一次就清掉
4. 作业 / 单元的书被删了: 开始作业、进学习页都说「书被删了,找老师换一份」,不只是 404
"""
import pytest
from sqlalchemy import text as sql_text

from app.core import tenancy
from app.core.timeutil import local_today
from app.models.learning import HomeworkAssignment, HomeworkStudentAssignment
from app.models.user import Class, ClassStudent, DailyCheckin, User
from app.models.word import Unit, UnitWord, Word, WordBook, WordDefinition
from app.services import ai_errors, ai_quota
from tests.conftest import _make_token

ARREARS = Exception("Error code: 400 - {'error': {'message': 'Access denied, please make sure your account is in "
                    "good standing. For details, see: https://help.aliyun.com/zh/model-studio/error-code#overdue-payment'}}")


def _h(uid):
    return {"Authorization": f"Bearer {_make_token(uid)}"}


class _E(Exception):
    def __init__(self, msg, status_code=None):
        super().__init__(msg)
        self.status_code = status_code


def test_classify_reasons():
    assert ai_errors.classify(ARREARS) == "ai_arrears"
    assert ai_errors.classify(Exception("Arrearage: Access denied")) == "ai_arrears"
    assert ai_errors.classify(_E("Incorrect API key provided", 401)) == "ai_key_invalid"
    assert ai_errors.classify(_E("Rate limit reached", 429)) == "ai_busy"
    assert ai_errors.classify(Exception("Request timed out.")) == "ai_timeout"
    assert ai_errors.classify(ValueError("未配置任何AI模型")) == "ai_not_configured"
    assert "欠费" in ai_errors.reason_of(ARREARS)


@pytest.fixture
async def stu(db_session):
    tenancy._org_cache.clear()
    await db_session.execute(sql_text(
        "INSERT OR IGNORE INTO organizations (id, name, code, status, access_mode) VALUES "
        "(1, '直营', 'HQ001', 'active', 'assigned')"))
    t = User(username="er_t", email="er_t@e.com", hashed_password="x", role="teacher", is_active=True, org_id=1)
    s = User(username="er_s", email="er_s@e.com", hashed_password="x", role="student", is_active=True, org_id=1)
    db_session.add_all([t, s])
    await db_session.flush()
    c = Class(name="班", teacher_id=t.id, org_id=1)
    db_session.add(c)
    await db_session.flush()
    db_session.add(ClassStudent(class_id=c.id, student_id=s.id, is_active=True))
    db_session.add(DailyCheckin(user_id=s.id, checkin_date=local_today()))
    book = WordBook(name="会被删的书", is_public=True)
    db_session.add(book)
    await db_session.flush()
    u = Unit(book_id=book.id, unit_number=1, name="Unit 1", order_index=1)
    db_session.add(u)
    await db_session.flush()
    w = Word(word="ernice")
    db_session.add(w)
    await db_session.flush()
    db_session.add(WordDefinition(word_id=w.id, meaning="好的", is_primary=True))
    db_session.add(UnitWord(unit_id=u.id, word_id=w.id, order_index=0))
    hw = HomeworkAssignment(title="作业", unit_id=u.id, teacher_id=t.id, learning_mode="flashcard",
                            target_score=80, max_attempts=3, is_closed=False)
    db_session.add(hw)
    await db_session.flush()
    sa = HomeworkStudentAssignment(homework_id=hw.id, student_id=s.id, status="pending",
                                   attempts_count=0, best_score=0, total_time_spent=0)
    db_session.add(sa)
    await db_session.commit()
    return {"s": s, "book": book, "u": u, "w": w, "sa": sa}


@pytest.mark.asyncio
async def test_memory_hook_failure_says_why_and_refunds(client, stu, monkeypatch):
    from app.services.ai_service import ai_service

    async def boom(*a, **k):
        raise ARREARS
    monkeypatch.setattr(ai_service, "generate_memory_hook", boom)
    sid = stu["s"].id
    r = await client.post(f"/api/v1/ai/memory-hook/{stu['w'].id}", headers=_h(sid))
    assert r.status_code == 503
    d = r.json()["detail"]
    assert d["code"] == "ai_arrears" and "欠费" in d["message"]
    assert "Access denied" not in d["message"], "上游英文报错不能给孩子看"
    assert await ai_quota.used(sid, "memory_hook") == 0, "没拿到妙招就退回次数"


@pytest.mark.asyncio
async def test_default_ai_failure_is_recorded_then_cleared(monkeypatch):
    await ai_errors.note_failure(ARREARS, "qwen3.8-max")
    last = await ai_errors.last_error()
    assert last["code"] == "ai_arrears" and last["model"] == "qwen3.8-max"
    await ai_errors.note_ok()
    assert await ai_errors.last_error() is None


@pytest.mark.asyncio
async def test_deleted_book_says_so(client, db_session, stu):
    await db_session.execute(sql_text("DELETE FROM word_books WHERE id=:b"), {"b": stu["book"].id})
    await db_session.commit()
    sid = stu["s"].id
    r = await client.post(f"/api/v1/student/homework/{stu['sa'].id}/start", headers=_h(sid))
    assert r.status_code == 404 and r.json()["detail"]["code"] == "book_deleted"
    assert "删" in r.json()["detail"]["message"]
    r = await client.post(f"/api/v1/student/units/{stu['u'].id}/start", json={"learning_mode": "flashcard"},
                          headers=_h(sid))
    assert r.status_code == 404 and r.json()["detail"]["code"] == "book_deleted"


# ---------------------------------------------------------------- 记忆妙招走 Claude(10-31)

def _relay_row(db_session):
    from app.api.v1.admin.ai_config import encrypt_api_key
    from app.models.system_config import AIProvider
    from app.services import tutor as tt
    db_session.add(AIProvider(provider_name=tt.PROVIDER_NAME, display_name="Claude(学习助手专用)",
                              api_key=encrypt_api_key("sk-relay"), base_url="https://relay.example",
                              model_name="claude-sonnet-5-5", enabled=True, is_default=False,
                              extra_config={"fallback_model": "claude-sonnet-4-6"}))


@pytest.fixture
def relay(monkeypatch):
    import httpx
    from app.services import tutor as tt
    state = {"status": 200, "calls": []}

    def handler(req: httpx.Request):
        import json as _j
        body = _j.loads(req.content)
        state["calls"].append(body["model"])
        if state["status"] != 200:
            return httpx.Response(state["status"], json={"error": {"message": state.get("msg", "boom")}})
        return httpx.Response(200, json={"content": [{"type": "text", "text": "**nice** 像「耐死」: 好到耐看死了"}],
                                         "usage": {"input_tokens": 80, "output_tokens": 30}})
    monkeypatch.setattr(tt, "new_client", lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    return state


@pytest.mark.asyncio
async def test_memory_hook_uses_claude_first(client, db_session, stu, relay, monkeypatch):
    from app.services.ai_service import ai_service
    from app.services import memory_hook as mh

    async def default_should_not_run(*a, **k):
        raise AssertionError("Claude 能用时不该走默认通道")
    monkeypatch.setattr(ai_service, "generate_memory_hook", default_should_not_run)
    _relay_row(db_session)
    await db_session.commit()
    r = await client.post(f"/api/v1/ai/memory-hook/{stu['w'].id}", headers=_h(stu["s"].id))
    assert r.status_code == 200, r.text
    assert r.json()["hook"] == "nice 像「耐死」: 好到耐看死了", "去掉 markdown"
    assert relay["calls"] == ["claude-sonnet-4-6"], "先用不开思考的备用模型"
    assert (await mh.usage(7))["generated"] == 1
    # 第二个孩子来看: 全平台缓存,不再调模型
    r = await client.post(f"/api/v1/ai/memory-hook/{stu['w'].id}", headers=_h(stu["s"].id))
    assert r.json()["cached"] is True and relay["calls"] == ["claude-sonnet-4-6"]


@pytest.mark.asyncio
async def test_memory_hook_falls_back_then_says_why(client, db_session, stu, relay, monkeypatch):
    from app.services.ai_service import ai_service
    wid, sid = stu["w"].id, stu["s"].id
    _relay_row(db_session)
    await db_session.commit()
    relay["status"], relay["msg"] = 401, "invalid x-api-key"

    async def default_ok(*a, **k):
        return "默认通道写的"
    monkeypatch.setattr(ai_service, "generate_memory_hook", default_ok)
    r = await client.post(f"/api/v1/ai/memory-hook/{wid}", headers=_h(sid))
    assert r.status_code == 200 and r.json()["hook"] == "默认通道写的", "Claude 不行退回默认通道"

    await db_session.execute(sql_text("UPDATE words SET memory_hook=NULL WHERE id=:w"), {"w": wid})
    await db_session.commit()
    db_session.expire_all()   # 测试和接口共用一个会话: 别拿缓存里那份已有妙招的词

    async def default_arrears(*a, **k):
        raise ARREARS
    monkeypatch.setattr(ai_service, "generate_memory_hook", default_arrears)
    r = await client.post(f"/api/v1/ai/memory-hook/{wid}", headers=_h(sid))
    assert r.status_code == 503
    assert r.json()["detail"]["code"] == "ai_key_invalid", "两条都不行: 报主通道(Claude)的原因"


def test_memory_hook_clean_keeps_inner_quotes():
    from app.services.memory_hook import clean
    assert clean('"耐死"都不变的好心情') == '"耐死"都不变的好心情', "不能削掉开头那个引号(生产 10-31 踩到)"
    assert clean('“像耐死一样好”') == "像耐死一样好"
    assert clean("**nice** 好") == "nice 好"
