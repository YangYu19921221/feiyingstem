"""分类卡单词配图(2026-11-06)

图里画着单词拼写,所以只能给分类卡: 听写 / 拼写拿到它等于拿到答案。
锁住四件事: 取词接口只在分类模式下发图;老师改了拼写图就不给;导入只配那几本书的词、
dry-run 不写;已有别的图的词不覆盖。
"""
import json
import os

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.core import tenancy
from app.core.timeutil import local_today
from app.models.learning import BookAssignment
from app.models.organization import Organization
from app.models.user import User, Class, ClassStudent, DailyCheckin
from app.models.word import WordBook, Unit, UnitWord, Word, WordDefinition
from app.services import word_art
from tests.conftest import _make_token


def _h(uid):
    return {"Authorization": f"Bearer {_make_token(uid)}"}


def test_visible_url_only_for_classify_and_matching_spelling():
    url = "/api/v1/files/word-art/a_red_panda.jpg?v=12345678"
    assert word_art.visible_url("a red panda", url, "classify") == url
    for mode in ("dictation", "spelling", "fillblank", "quiz", "exam", "handwriting", None):
        assert word_art.visible_url("a red panda", url, mode) is None, mode
    # 老师把拼写改了,图上画的还是旧拼写 → 不给
    assert word_art.visible_url("a red pandas", url, "classify") is None
    # 不是配图的老图原样(生产目前 0 行,留着兼容)
    assert word_art.visible_url("cat", "https://x/cat.png", "dictation") == "https://x/cat.png"
    assert word_art.visible_url("cat", None, "classify") is None


@pytest.fixture
async def art_unit(db_session):
    tenancy._org_cache.clear()
    org = Organization(name="配图机构", code="WART01", status="active")
    db_session.add(org)
    await db_session.flush()
    teacher = User(username="wart_t", email="wart_t@e.com", hashed_password="x",
                   role="teacher", full_name="王老师", is_active=True, org_id=org.id)
    stu = User(username="wart_s", email="wart_s@e.com", hashed_password="x",
               role="student", full_name="学生甲", is_active=True, org_id=org.id)
    db_session.add_all([teacher, stu])
    await db_session.flush()
    db_session.add(DailyCheckin(user_id=stu.id, checkin_date=local_today()))
    cls = Class(name="三年级1班", teacher_id=teacher.id, org_id=org.id)
    db_session.add(cls)
    await db_session.flush()
    db_session.add(ClassStudent(class_id=cls.id, student_id=stu.id, is_active=True))

    book = WordBook(name="人教版三上", is_public=True, grade_level="三年级")
    other = WordBook(name="别的书", is_public=True)
    db_session.add_all([book, other])
    await db_session.flush()
    unit = Unit(book_id=book.id, unit_number=1, name="Unit 1")
    ounit = Unit(book_id=other.id, unit_number=1, name="Unit 1")
    db_session.add_all([unit, ounit])
    await db_session.flush()
    words = {}
    for i, text in enumerate(["apple", "a red panda", "zebra"]):
        w = Word(word=text)
        db_session.add(w)
        await db_session.flush()
        db_session.add(WordDefinition(word_id=w.id, meaning=f"释义{i}", is_primary=True))
        db_session.add(UnitWord(unit_id=unit.id, word_id=w.id, order_index=i))
        words[text] = w
    # 别的书里同拼写的另一条词(可能是另一个意思),不该被顺手配上
    w2 = Word(word="apple")
    db_session.add(w2)
    await db_session.flush()
    db_session.add(UnitWord(unit_id=ounit.id, word_id=w2.id, order_index=0))
    words["other_apple"] = w2
    # zebra 已经有老师传的别的图
    words["zebra"].image_url = "https://x/zebra.png"
    db_session.add(BookAssignment(student_id=stu.id, book_id=book.id,
                                  scope_type="book", teacher_id=teacher.id))
    await db_session.commit()
    return stu, book, unit, words


def _make_src(tmp_path):
    src = tmp_path / "src"
    src.mkdir()
    res = {}
    for text in ["apple", "a red panda", "zebra", "lion"]:
        s = word_art.slug(text)
        (src / f"{s}.jpg").write_bytes(f"img-{s}".encode())
        res[text] = {"slug": s, "status": "ok"}
    res["broken"] = {"slug": "broken", "status": "failed"}
    (src / "broken.jpg").write_bytes(b"x")
    (src / "results.json").write_text(json.dumps(res), encoding="utf-8")
    return src


async def test_import_dry_run_then_real(db_session, art_unit, tmp_path):
    _stu, book, _unit, words = art_unit
    src = _make_src(tmp_path)
    up = tmp_path / "uploads"

    rep = await word_art.import_from_dir(db_session, str(src), [book.id], str(up), dry_run=True)
    assert (rep.matched, rep.filled, rep.kept_other) == (3, 2, 1)
    assert rep.unused_images == ["lion"]          # failed 的那张不算
    assert not up.exists()                         # dry-run 不拷图
    await db_session.refresh(words["apple"])
    assert words["apple"].image_url is None        # 也不写库

    rep = await word_art.import_from_dir(db_session, str(src), [book.id], str(up), dry_run=False)
    assert (rep.filled, rep.copied) == (2, 2)
    for k in ("apple", "a red panda", "zebra", "other_apple"):
        await db_session.refresh(words[k])
    assert words["apple"].image_url.startswith("/api/v1/files/word-art/apple.jpg?v=")
    assert words["a red panda"].image_url.startswith("/api/v1/files/word-art/a_red_panda.jpg?v=")
    assert words["zebra"].image_url == "https://x/zebra.png"   # 别的图不覆盖
    assert words["other_apple"].image_url is None              # 别的书不动
    assert os.path.isfile(up / "word-art" / "apple.jpg")
    assert not os.path.exists(up / "word-art" / "lion.jpg")    # 书里没这个词就不拷

    # 再导一次: 都是同一张图,不重写不重拷
    rep = await word_art.import_from_dir(db_session, str(src), [book.id], str(up), dry_run=False)
    assert (rep.filled, rep.unchanged, rep.copied) == (0, 2, 0)


async def test_start_learning_gives_art_only_in_classify(client: AsyncClient, db_session, art_unit, tmp_path):
    stu, book, unit, _words = art_unit
    await word_art.import_from_dir(db_session, str(_make_src(tmp_path)), [book.id],
                                   str(tmp_path / "uploads"), dry_run=False)

    r = await client.post(f"/api/v1/student/units/{unit.id}/start",
                          json={"learning_mode": "classify"}, headers=_h(stu.id))
    assert r.status_code == 200, r.text
    got = {w["word"]: w["image_url"] for w in r.json()["words"]}
    assert got["apple"].startswith("/api/v1/files/word-art/apple.jpg?v=")
    assert got["zebra"] == "https://x/zebra.png"

    for mode in ("dictation", "spelling"):
        r = await client.post(f"/api/v1/student/units/{unit.id}/start",
                              json={"learning_mode": mode}, headers=_h(stu.id))
        assert r.status_code == 200, r.text
        got = {w["word"]: w["image_url"] for w in r.json()["words"]}
        assert got["apple"] is None and got["a red panda"] is None, mode


async def test_renamed_word_loses_art(client: AsyncClient, db_session, art_unit, tmp_path):
    stu, book, unit, words = art_unit
    await word_art.import_from_dir(db_session, str(_make_src(tmp_path)), [book.id],
                                   str(tmp_path / "uploads"), dry_run=False)
    w = (await db_session.execute(select(Word).where(Word.id == words["apple"].id))).scalar_one()
    w.word = "apples"          # 老师改了拼写,图上还是 apple
    await db_session.commit()
    r = await client.post(f"/api/v1/student/units/{unit.id}/start",
                          json={"learning_mode": "classify"}, headers=_h(stu.id))
    got = {x["word"]: x["image_url"] for x in r.json()["words"]}
    assert got["apples"] is None


async def test_color_file_preferred_and_meaning_mismatch_skipped(db_session, art_unit, tmp_path):
    """全库那批: color/ 里的彩色图优先;同拼写别的书里意思不一样的不配"""
    _stu, book, _unit, words = art_unit
    other_book = (await db_session.execute(
        select(WordBook).where(WordBook.name == "别的书"))).scalar_one()
    # 别的书那条 apple 的释义改成和图不一样的意思
    db_session.add(WordDefinition(word_id=words["other_apple"].id, meaning="n. 苹果公司的股票", is_primary=True))
    await db_session.commit()
    src = tmp_path / "src"
    (src / "color").mkdir(parents=True)
    (src / "apple.jpg").write_bytes(b"dark")
    (src / "color" / "apple.jpg").write_bytes(b"colored")
    (src / "results.json").write_text(json.dumps({"apple": {"slug": "apple", "status": "ok", "meaning": "释义0"}}),
                                      encoding="utf-8")
    up = tmp_path / "uploads"
    rep = await word_art.import_from_dir(db_session, str(src), [book.id, other_book.id], str(up), dry_run=False)
    assert rep.filled == 1 and len(rep.meaning_mismatch) == 1
    assert (up / "word-art" / "apple.jpg").read_bytes() == b"colored"
    await db_session.refresh(words["apple"]); await db_session.refresh(words["other_apple"])
    assert words["apple"].image_url.startswith("/api/v1/files/word-art/apple.jpg?v=")
    assert words["other_apple"].image_url is None


def test_meaning_matches():
    m = word_art.meaning_matches
    assert m("n. 银行", "n.银行；存款处") and not m("n. 银行", "n. 河岸，堤")
    assert m("书", "n. 书；书籍") and not m("n. 书", "v. 预订")
    assert m("", "随便")                       # 三上那批没记释义,不比
    assert m("1. 蟑螂 2. 大麻卷烟的烟蒂", "n. 蟑螂")  # 只看第一个意思
