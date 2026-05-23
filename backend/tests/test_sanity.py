"""验证 pytest 异步 fixture 工作。"""
from sqlalchemy import select
from app.models.word import Word


async def test_db_session_works(db_session):
    db_session.add(Word(word="hello"))
    await db_session.commit()
    result = await db_session.execute(select(Word).where(Word.word == "hello"))
    assert result.scalar_one().word == "hello"


async def test_client_works(client):
    response = await client.get("/")
    assert response.status_code == 200


async def test_word_no_longer_unique(db_session):
    """模型层允许同一拼写多行(支持 fork-on-edit)。"""
    from sqlalchemy import select, func
    db_session.add(Word(word="who"))
    db_session.add(Word(word="who"))
    await db_session.commit()
    n = (await db_session.execute(
        select(func.count()).select_from(Word).where(Word.word == "who")
    )).scalar()
    assert n == 2
