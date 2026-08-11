"""传说宝可梦的领养门槛与独立队伍格。

两条入队路径必须同口径：领养(adopt_pet)与对战收服(_settle_pet_capture)。
只堵一条,另一条就是后门 —— 学了 300 词的孩子打赢一场把别人的梦幻抱走,门槛形同虚设。
"""
import pytest
import pytest_asyncio
from jose import jwt

from app.core.config import settings
from app.models.learning import LearningRecord
from app.models.organization import Organization
from app.models.pet import UserPet
from app.models.user import User
from app.models.word import Word


@pytest_asyncio.fixture
async def legend_student(db_session):
    """带真实机构的学生 token。

    不用 conftest 的 auth_student_token:它建的用户 org_id 为空,而 get_current_student
    会对学生查 check_org_active(空机构=未激活)→ 全站 402。生产 users.org_id 是 NOT NULL,
    所以这里补一个 active 机构才符合真实形态。
    """
    org = Organization(name="传说测试机构", code="LGD001", status="active")
    db_session.add(org)
    await db_session.commit()
    await db_session.refresh(org)

    user = User(
        username="stu_legend",
        email="stu_legend@example.com",
        hashed_password="x",
        role="student",
        full_name="传说测试学生",
        is_active=True,
        org_id=org.id,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    from datetime import datetime, timedelta
    token = jwt.encode(
        {"sub": str(user.id), "sv": user.session_ver or 0,
         "exp": datetime.utcnow() + timedelta(hours=1)},
        settings.SECRET_KEY, algorithm="HS256",
    )
    return token, user.id


async def _give_learned_words(db_session, user_id: int, count: int) -> None:
    """造出 count 个不同单词的学习记录。

    学词数口径是 distinct(LearningRecord.word_id)(见 student/pet.get_learned_word_count),
    所以每个单词只需一条记录。
    """
    for index in range(count):
        word = Word(word=f"legendword{index}", difficulty=1)
        db_session.add(word)
        await db_session.flush()
        db_session.add(LearningRecord(
            user_id=user_id,
            word_id=word.id,
            learning_mode="quiz",
            is_correct=True,
        ))
    await db_session.commit()


@pytest.mark.asyncio
async def test_legend_adoption_rejected_below_threshold(client, legend_student, db_session):
    token, user_id = legend_student
    headers = {"Authorization": f"Bearer {token}"}

    response = await client.post(
        "/api/v1/student/pet",
        json={"species": "mew", "name": "小梦"},
        headers=headers,
    )
    assert response.status_code == 400
    detail = response.json()["detail"]
    # 报错必须带上门槛与差额，孩子才知道要努力到哪
    assert "5000" in detail and "还差" in detail


@pytest.mark.asyncio
async def test_semi_legend_unlocks_at_2500_and_does_not_consume_normal_slots(
    client, legend_student, db_session
):
    token, user_id = legend_student
    headers = {"Authorization": f"Bearer {token}"}

    # 先用掉普通名额：0 词只开 1 格普通
    first = await client.post(
        "/api/v1/student/pet", json={"species": "pikachu", "name": "皮皮"}, headers=headers
    )
    assert first.status_code == 200
    blocked = await client.post(
        "/api/v1/student/pet", json={"species": "eevee", "name": "布布"}, headers=headers
    )
    assert blocked.status_code == 400  # 普通格已满

    await _give_learned_words(db_session, user_id, 2500)

    # 顶级传说仍差 2500 词
    top = await client.post(
        "/api/v1/student/pet", json={"species": "mewtwo", "name": "超超"}, headers=headers
    )
    assert top.status_code == 400

    # 准传说达标，且不受"普通格已满"影响 —— 这正是独立专属格的意义
    semi = await client.post(
        "/api/v1/student/pet", json={"species": "articuno", "name": "冰冰"}, headers=headers
    )
    assert semi.status_code == 200
    assert semi.json()["evolution_stage_name"] == "传说之卵"

    collection = (await client.get("/api/v1/student/pet/collection", headers=headers)).json()
    assert collection["legend_used_slots"] == 1
    assert collection["legend_unlocked_slots"] == 1
    assert collection["next_legend_slot_words"] == 5000
    # 普通格计数不含传说：2500 词开 2 格普通，皮卡丘占 1 格
    assert collection["used_slots"] == 1
    assert collection["unlocked_slots"] == 2

    # 第二只传说需要 5000 词，此时传说格只开了 1 个
    second_legend = await client.post(
        "/api/v1/student/pet", json={"species": "zapdos", "name": "电电"}, headers=headers
    )
    assert second_legend.status_code == 400
    assert "5000" in second_legend.json()["detail"]


@pytest.mark.asyncio
async def test_collection_counts_stay_separate_when_legend_sits_mid_roster(
    client, legend_student, db_session
):
    """传说夹在领养顺序中间时,两套计数都不能串。

    pets 列表是混装且按 is_active/created_at 排的,传说完全可能排在普通宠物之间。
    前端曾按下标直取 pets[index] 画普通格,导致传说被画进普通格、还顶掉最后一只普通宠物。
    这里锁住后端契约:used_slots 只数普通、legend_used_slots 只数传说,两者相加=总数。
    """
    token, user_id = legend_student
    headers = {"Authorization": f"Bearer {token}"}

    await _give_learned_words(db_session, user_id, 2500)

    # 领养顺序:普通 → 传说 → 普通,让传说落在中间
    for species, name in (("pikachu", "皮皮"), ("articuno", "冰冰"), ("eevee", "布布")):
        response = await client.post(
            "/api/v1/student/pet", json={"species": species, "name": name}, headers=headers
        )
        assert response.status_code == 200, response.text

    collection = (await client.get("/api/v1/student/pet/collection", headers=headers)).json()
    assert len(collection["pets"]) == 3
    assert collection["used_slots"] == 2          # 皮卡丘 + 伊布
    assert collection["legend_used_slots"] == 1   # 急冻鸟
    assert collection["used_slots"] + collection["legend_used_slots"] == len(collection["pets"])
    # 2500 词只开 2 格普通,已被两只普通占满 —— 但传说格照旧独立
    assert collection["unlocked_slots"] == 2
    assert collection["legend_unlocked_slots"] == 1


@pytest.mark.asyncio
async def test_capture_applies_the_same_legend_gate(db_session):
    """收服路径复用同一套门槛：学词不够就拿不走对手的传说。"""
    from app.models.pet_battle import PetBattle
    from app.models.user import User
    from app.services.pet_battle_service import _settle_pet_capture

    winner = User(username="cap_w", email="cap_w@e.com", hashed_password="x",
                  role="student", is_active=True)
    loser = User(username="cap_l", email="cap_l@e.com", hashed_password="x",
                 role="student", is_active=True)
    db_session.add_all([winner, loser])
    await db_session.commit()
    await db_session.refresh(winner)
    await db_session.refresh(loser)

    winner_pet = UserPet(user_id=winner.id, name="赢家伙伴", species="pikachu", is_active=True)
    loser_pet = UserPet(user_id=loser.id, name="梦幻", species="mew", is_active=True)
    db_session.add_all([winner_pet, loser_pet])
    await db_session.commit()
    await db_session.refresh(winner_pet)
    await db_session.refresh(loser_pet)

    battle = PetBattle(
        player1_id=winner.id, player2_id=loser.id,
        player1_pet_id=winner_pet.id, player2_pet_id=loser_pet.id,
        is_ai_battle=False, status="finished",
    )
    db_session.add(battle)
    await db_session.commit()

    result = await _settle_pet_capture(db_session, battle, winner.id)
    assert result["reason"] == "legend_words_locked"
    assert result["required_words"] == 5000
    assert result["success"] is False
    # 宠物没易主
    await db_session.refresh(loser_pet)
    assert loser_pet.user_id == loser.id
