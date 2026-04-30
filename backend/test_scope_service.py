"""scope_service 单元测试 - 直接对数据库执行"""
import asyncio
from app.core.database import AsyncSessionLocal as async_session_maker
from app.services.scope_service import (
    DEFAULT_GROUP_SIZE,
    get_unit_groups,
    get_group_words,
    validate_scope,
    get_scope_words,
)
from app.models.word import Unit, UnitWord
from sqlalchemy import select


async def find_test_unit(db):
    """找一个有词的单元用于测试"""
    result = await db.execute(
        select(Unit).join(UnitWord, UnitWord.unit_id == Unit.id).limit(1)
    )
    return result.scalars().first()


async def test_get_unit_groups_default_size():
    async with async_session_maker() as db:
        unit = await find_test_unit(db)
        if not unit:
            print("SKIP: 无含单词的单元测试数据")
            return
        groups = await get_unit_groups(db, unit.id)
        assert len(groups) > 0
        size = unit.group_size or DEFAULT_GROUP_SIZE
        for g in groups[:-1]:
            assert g["word_count"] == size, f"中间组应有 {size} 词，实际 {g['word_count']}"
        print(f"OK: unit {unit.id} 切成 {len(groups)} 组")


async def test_get_group_words_in_range():
    async with async_session_maker() as db:
        unit = await find_test_unit(db)
        if not unit:
            print("SKIP")
            return
        words = await get_group_words(db, unit.id, 1)
        assert isinstance(words, list)
        assert len(words) > 0
        print(f"OK: 第1组拿到 {len(words)} 词")


async def test_get_group_words_out_of_range():
    async with async_session_maker() as db:
        unit = await find_test_unit(db)
        if not unit:
            print("SKIP")
            return
        try:
            await get_group_words(db, unit.id, 999)
            assert False, "越界应抛 ValueError"
        except ValueError:
            print("OK: 越界正确抛 ValueError")


def test_validate_scope_book_ok():
    validate_scope("book", None, None)
    print("OK: scope=book 校验通过")

def test_validate_scope_book_fail():
    try:
        validate_scope("book", 1, None)
        assert False
    except ValueError:
        print("OK: scope=book 带 unit_id 拒绝")

def test_validate_scope_unit_ok():
    validate_scope("unit", 1, None)
    print("OK: scope=unit 校验通过")

def test_validate_scope_unit_fail_no_unit():
    try:
        validate_scope("unit", None, None)
        assert False
    except ValueError:
        print("OK: scope=unit 缺 unit_id 拒绝")

def test_validate_scope_group_ok():
    validate_scope("group", 1, 2)
    print("OK: scope=group 校验通过")

def test_validate_scope_group_fail_no_group():
    try:
        validate_scope("group", 1, None)
        assert False
    except ValueError:
        print("OK: scope=group 缺 group_index 拒绝")

def test_validate_scope_invalid_type():
    try:
        validate_scope("chapter", None, None)
        assert False
    except ValueError:
        print("OK: 非法 scope_type 拒绝")

def test_validate_scope_book_fail_group_index():
    try:
        validate_scope("book", None, 2)
        assert False
    except ValueError:
        print("OK: scope=book 带 group_index 拒绝")

def test_validate_scope_unit_fail_with_group_index():
    try:
        validate_scope("unit", 1, 1)
        assert False
    except ValueError:
        print("OK: scope=unit 带 group_index 拒绝")


async def main():
    test_validate_scope_book_ok()
    test_validate_scope_book_fail()
    test_validate_scope_unit_ok()
    test_validate_scope_unit_fail_no_unit()
    test_validate_scope_group_ok()
    test_validate_scope_group_fail_no_group()
    test_validate_scope_invalid_type()
    test_validate_scope_book_fail_group_index()
    test_validate_scope_unit_fail_with_group_index()
    await test_get_unit_groups_default_size()
    await test_get_group_words_in_range()
    await test_get_group_words_out_of_range()
    print("\n=== ALL PASSED ===")


if __name__ == "__main__":
    asyncio.run(main())
