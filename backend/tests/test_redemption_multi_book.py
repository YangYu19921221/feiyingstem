"""一码多书(按分组×学段批量开书)—— 2026-08-29。

原先一张兑换码只能开一本书(`redemption_codes.book_id` NOT NULL)。运营需要
「人教版·小学卡」这类一次开一批的卡,于是加了 `redemption_code_books` 明细表。

本测试钉住五件容易改坏的事:
1. **单书码行为与改造前完全一致**(存量 1133 张全是单书码,文案也不许变——
   学生和客服都习惯了"续期成功！…"那几句)
2. 多书码逐本发授权,判活逐本独立
3. **部分失败不整码作废**:14 本里 1 本已拥有,其余照发、码标 USED
4. **全部失败则不消耗码**:否则学生一张 14 本的卡因为都已拥有就白废
5. 学段归类:生产库里真实出现过的 18 种 grade_level 取值各自归到哪一档
"""
from datetime import datetime, timedelta

import pytest
from sqlalchemy import select

from app.models.learning import BookAssignment
from app.models.user import (
    RedemptionCode, RedemptionCodeBook, RedemptionCodeStatus, User,
)
from app.models.word import WordBook
from app.services import book_stage, subscription_service


async def _mk_admin_student(db, tag: str):
    admin = User(username=f"adm_{tag}", email=f"adm_{tag}@e.com", hashed_password="x",
                 role="admin", full_name="管理员", is_active=True)
    stu = User(username=f"stu_{tag}", email=f"stu_{tag}@e.com", hashed_password="x",
               role="student", full_name="学生", is_active=True)
    db.add_all([admin, stu])
    await db.flush()
    return admin, stu


async def _mk_books(db, specs: list[tuple[str, str | None]]) -> list[WordBook]:
    """specs = [(书名, grade_level), ...]"""
    books = [WordBook(name=n, grade_level=g, is_public=True) for n, g in specs]
    db.add_all(books)
    await db.flush()
    return books


# ---------------- 学段归类 ----------------

def test_stage_of_covers_all_production_values():
    """生产库里真实出现过的 18 种取值,归类必须符合预期。

    关键: 未知值(飞鹰校本教材/大学/空)归 other 而**不是**兜底成小学 ——
    兜底成小学会让运营发「小学卡」时把大学教材一起开出去。
    (services/pk/score.py 那份推导确实兜底成 primary,但它是计分用、语义不同,
     本次刻意不合并,见 book_stage 模块 docstring)
    """
    expect = {
        "一年级": "primary", "三年级": "primary", "六年级": "primary", "小学": "primary",
        "七年级": "junior", "九年级": "junior", "初中": "junior", "初二": "junior",
        "高一": "senior", "高三": "senior", "高中": "senior",
        "飞鹰": "other", "大学": "other", "": "other", " ": "other",
    }
    for val, want in expect.items():
        assert book_stage.stage_of(val) == want, f"{val!r} 应归 {want}"
    assert book_stage.stage_of(None) == "other"


def test_stage_labels_and_order():
    assert book_stage.stage_label("primary") == "小学"
    assert book_stage.stage_label("other") == "其他"
    # 其他档排最后(发码表单按这个顺序渲染)
    assert book_stage.STAGE_ORDER[-1] == "other"


# ---------------- 单书码:向后兼容的钉子 ----------------

@pytest.mark.asyncio
async def test_single_book_code_unchanged(db_session):
    """只传 book_id 的旧调用:1 行授权 + 文案与改造前一字不差。"""
    admin, stu = await _mk_admin_student(db_session, "single")
    (book,) = await _mk_books(db_session, [("三年级上", "三年级")])
    await db_session.commit()

    codes = await subscription_service.batch_generate_codes(
        db=db_session, admin_id=admin.id, count=1, book_id=book.id)
    assert len(codes) == 1
    # 单书码也写明细表(读取侧同构)
    detail = (await db_session.execute(
        select(RedemptionCodeBook.book_id)
        .where(RedemptionCodeBook.code_id == codes[0].id)
    )).scalars().all()
    assert detail == [book.id]
    assert codes[0].scope_kind == "book"

    res = await subscription_service.redeem_code(db_session, stu, codes[0].code)
    assert res["success"] is True
    # 改造前的原话
    assert res["message"] == f"兑换成功！已获得单词本《{book.name}》"
    assert res["book_name"] == book.name

    rows = (await db_session.execute(
        select(BookAssignment).where(BookAssignment.student_id == stu.id)
    )).scalars().all()
    assert len(rows) == 1 and rows[0].book_id == book.id


@pytest.mark.asyncio
async def test_single_book_already_owned_message_unchanged(db_session):
    """单书码重复兑换的拒绝文案也不许变。"""
    admin, stu = await _mk_admin_student(db_session, "dup")
    (book,) = await _mk_books(db_session, [("四年级上", "四年级")])
    await db_session.commit()

    c1 = (await subscription_service.batch_generate_codes(
        db=db_session, admin_id=admin.id, count=1, book_id=book.id))[0]
    await subscription_service.redeem_code(db_session, stu, c1.code)

    c2 = (await subscription_service.batch_generate_codes(
        db=db_session, admin_id=admin.id, count=1, book_id=book.id))[0]
    res = await subscription_service.redeem_code(db_session, stu, c2.code)
    assert res["success"] is False
    assert res["message"] == f"你已拥有单词本《{book.name}》，无需重复兑换"
    # 关键: 没成功就不能消耗这张码
    await db_session.refresh(c2)
    assert c2.status == RedemptionCodeStatus.UNUSED


# ---------------- 多书码 ----------------

@pytest.mark.asyncio
async def test_multi_book_code_grants_all(db_session):
    """一张「人教版·小学」卡开 4 本 → 4 行授权。"""
    admin, stu = await _mk_admin_student(db_session, "multi")
    books = await _mk_books(db_session, [
        ("三年级上", "三年级"), ("三年级下", "三年级"),
        ("四年级上", "四年级"), ("四年级下", "四年级"),
    ])
    await db_session.commit()
    ids = [b.id for b in books]

    codes = await subscription_service.batch_generate_codes(
        db=db_session, admin_id=admin.id, count=1, book_ids=ids,
        grant_type="period", grant_days=30,
        scope_series="人教版", scope_stage="primary")
    code = codes[0]
    assert code.scope_kind == "group"
    assert code.scope_series == "人教版" and code.scope_stage == "primary"
    assert code.book_id == ids[0]   # 主书仍写值,老查询不炸

    res = await subscription_service.redeem_code(db_session, stu, code.code)
    assert res["success"] is True, res
    assert "共开通 4 本" in res["message"], res["message"]
    assert len(res["books"]) == 4

    rows = (await db_session.execute(
        select(BookAssignment).where(BookAssignment.student_id == stu.id)
    )).scalars().all()
    assert sorted(r.book_id for r in rows) == sorted(ids)
    # 每行都带包月卡规格
    for r in rows:
        assert r.grant_type == "period" and r.expires_at is not None


@pytest.mark.asyncio
async def test_partial_failure_still_grants_rest(db_session):
    """4 本里 1 本已永久拥有 → 其余 3 本照发,码标 USED,并如实报 skipped。

    这是一码多书最关键的取舍:不能因为 1 本重复就让整张卡作废。
    """
    admin, stu = await _mk_admin_student(db_session, "partial")
    books = await _mk_books(db_session, [
        ("五上", "五年级"), ("五下", "五年级"), ("六上", "六年级"), ("六下", "六年级"),
    ])
    await db_session.commit()
    ids = [b.id for b in books]

    # 先用单书码把第 1 本永久拿下
    pre = (await subscription_service.batch_generate_codes(
        db=db_session, admin_id=admin.id, count=1, book_id=ids[0]))[0]
    await subscription_service.redeem_code(db_session, stu, pre.code)

    code = (await subscription_service.batch_generate_codes(
        db=db_session, admin_id=admin.id, count=1, book_ids=ids))[0]
    res = await subscription_service.redeem_code(db_session, stu, code.code)

    assert res["success"] is True, res
    assert len(res["granted"]) == 3
    assert len(res["skipped"]) == 1
    assert "另有 1 本已拥有未重复开通" in res["message"]
    await db_session.refresh(code)
    assert code.status == RedemptionCodeStatus.USED

    rows = (await db_session.execute(
        select(BookAssignment).where(BookAssignment.student_id == stu.id)
    )).scalars().all()
    assert len(rows) == 4     # 1 本原有 + 3 本新开


@pytest.mark.asyncio
async def test_all_owned_does_not_consume_code(db_session):
    """整批都已拥有 → 码保持 UNUSED,学生还能申诉/换用。"""
    admin, stu = await _mk_admin_student(db_session, "allowned")
    books = await _mk_books(db_session, [("七上", "七年级"), ("七下", "七年级")])
    await db_session.commit()
    ids = [b.id for b in books]

    first = (await subscription_service.batch_generate_codes(
        db=db_session, admin_id=admin.id, count=1, book_ids=ids))[0]
    await subscription_service.redeem_code(db_session, stu, first.code)

    second = (await subscription_service.batch_generate_codes(
        db=db_session, admin_id=admin.id, count=1, book_ids=ids))[0]
    res = await subscription_service.redeem_code(db_session, stu, second.code)

    assert res["success"] is False, res
    assert "都已拥有" in res["message"]
    await db_session.refresh(second)
    assert second.status == RedemptionCodeStatus.UNUSED

    # 也不能多出授权行
    rows = (await db_session.execute(
        select(BookAssignment).where(BookAssignment.student_id == stu.id)
    )).scalars().all()
    assert len(rows) == 2


@pytest.mark.asyncio
async def test_period_renewal_per_book_extends_each(db_session):
    """多书包月卡续期:每本各自从原到期日往后接,互不干扰。"""
    admin, stu = await _mk_admin_student(db_session, "renew")
    books = await _mk_books(db_session, [("八上", "八年级"), ("八下", "八年级")])
    await db_session.commit()
    ids = [b.id for b in books]

    c1 = (await subscription_service.batch_generate_codes(
        db=db_session, admin_id=admin.id, count=1, book_ids=ids,
        grant_type="period", grant_days=30))[0]
    await subscription_service.redeem_code(db_session, stu, c1.code)
    first_expiry = {
        r.book_id: r.expires_at for r in (await db_session.execute(
            select(BookAssignment).where(BookAssignment.student_id == stu.id)
        )).scalars().all()
    }

    c2 = (await subscription_service.batch_generate_codes(
        db=db_session, admin_id=admin.id, count=1, book_ids=ids,
        grant_type="period", grant_days=30))[0]
    res = await subscription_service.redeem_code(db_session, stu, c2.code)
    assert res["success"] is True
    assert len(res["renewed"]) == 2

    for r in (await db_session.execute(
        select(BookAssignment).where(BookAssignment.student_id == stu.id)
    )).scalars().all():
        delta = r.expires_at - first_expiry[r.book_id]
        assert 29 <= delta.days <= 30, f"应再延 30 天,实际 {delta}"


@pytest.mark.asyncio
async def test_cross_type_skips_only_that_book(db_session):
    """跨卡种冲突只跳过冲突那本,不影响同一张卡里的其他书。"""
    admin, stu = await _mk_admin_student(db_session, "cross")
    books = await _mk_books(db_session, [("九上", "九年级"), ("九下", "九年级")])
    await db_session.commit()
    ids = [b.id for b in books]

    # 第 1 本先拿次卡
    pre = (await subscription_service.batch_generate_codes(
        db=db_session, admin_id=admin.id, count=1, book_id=ids[0],
        grant_type="times", grant_times=5))[0]
    await subscription_service.redeem_code(db_session, stu, pre.code)

    # 再用包月的多书卡:第 1 本类型冲突跳过,第 2 本正常开
    code = (await subscription_service.batch_generate_codes(
        db=db_session, admin_id=admin.id, count=1, book_ids=ids,
        grant_type="period", grant_days=30))[0]
    res = await subscription_service.redeem_code(db_session, stu, code.code)

    assert res["success"] is True, res
    assert len(res["granted"]) == 1 and len(res["skipped"]) == 1
    assert "不能直接用" in res["skipped"][0]

    rows = {r.book_id: r for r in (await db_session.execute(
        select(BookAssignment).where(BookAssignment.student_id == stu.id)
    )).scalars().all()}
    assert rows[ids[0]].grant_type == "times"    # 没被覆盖
    assert rows[ids[1]].grant_type == "period"


@pytest.mark.asyncio
async def test_deleted_books_are_skipped_not_fatal(db_session):
    """卡里有书被删:剩下的照发;全被删才作废整码。"""
    admin, stu = await _mk_admin_student(db_session, "deleted")
    books = await _mk_books(db_session, [("在", "三年级"), ("将删", "三年级")])
    await db_session.commit()
    ids = [b.id for b in books]

    code = (await subscription_service.batch_generate_codes(
        db=db_session, admin_id=admin.id, count=1, book_ids=ids))[0]
    # 删掉第 2 本(明细行仍在 → 模拟书被删而码还挂着)
    await db_session.delete(books[1])
    await db_session.commit()

    res = await subscription_service.redeem_code(db_session, stu, code.code)
    assert res["success"] is True, res
    rows = (await db_session.execute(
        select(BookAssignment).where(BookAssignment.student_id == stu.id)
    )).scalars().all()
    assert len(rows) == 1 and rows[0].book_id == ids[0]


@pytest.mark.asyncio
async def test_multi_book_expiry_gates_each_book(db_session):
    """包月多书卡到期后,判活逐本为 False(闸门 scope_service 依赖这个)。"""
    admin, stu = await _mk_admin_student(db_session, "expire")
    books = await _mk_books(db_session, [("A", "三年级"), ("B", "三年级")])
    await db_session.commit()
    ids = [b.id for b in books]

    code = (await subscription_service.batch_generate_codes(
        db=db_session, admin_id=admin.id, count=1, book_ids=ids,
        grant_type="period", grant_days=30))[0]
    await subscription_service.redeem_code(db_session, stu, code.code)

    rows = (await db_session.execute(
        select(BookAssignment).where(BookAssignment.student_id == stu.id)
    )).scalars().all()
    assert all(subscription_service.is_assignment_active(r) for r in rows)

    # 把两本都改成已过期
    for r in rows:
        r.expires_at = datetime.utcnow() - timedelta(days=1)
    await db_session.commit()
    for r in rows:
        assert subscription_service.is_assignment_active(r) is False
