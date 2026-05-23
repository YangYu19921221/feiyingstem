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
    assert response.status_code in (200, 404)  # 看 main.py 是否暴露根路径
