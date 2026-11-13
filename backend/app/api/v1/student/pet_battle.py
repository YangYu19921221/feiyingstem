"""宠物对战系统 - HTTP API"""
from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, and_, desc
from typing import List
from datetime import datetime, timedelta

from app.core.database import get_db
from app.models.user import User
from app.models.pet import UserPet
from app.models.pet_battle import PetBattle, PetBattleStats
from app.schemas.pet_battle import (
    BattleCreateRequest,
    BattleResponse,
    BattleListItem,
    BattleStatsResponse,
    PetBattleInfo,
    BattlePetOption,
)
from app.services import pet_battle_service
from app.api.v1.student.pet import apply_natural_heal
from app.services.ai_opponent_service import generate_ai_opponent
from app.api.v1.auth import get_current_student, get_current_admin
from app.services import battle_moves, battle_tickets
from app.services import class_boss, pet_shadow, pet_trial
from app.core.pet_formulas import calculate_max_hp
import json

router = APIRouter()


async def build_battle_response(battle: PetBattle, db: AsyncSession) -> BattleResponse:
    """构建对战响应"""
    # 查询用户信息(AI 账号要绕开租户过滤才取得到,见 pet_battle_service.load_player)
    player1 = await pet_battle_service.load_player(db, battle.player1_id)
    player2 = await pet_battle_service.load_player(db, battle.player2_id)
    pet1 = await db.get(UserPet, battle.player1_pet_id)
    pet2 = await db.get(UserPet, battle.player2_pet_id)

    hp_data = pet_battle_service.get_battle_pet_hp_data(battle)

    async def build_roster(player_id: int, current_pet_id: int, hp: int):
        if player_id <= 0:
            # AI 一方只有场上这一只: AI 账号名下是「每场一只」的一大堆行,不是它的队伍,不能按账号列。
            # 血量上限用这一场记的(闯关的守关比公式多),不按公式重算
            pet = pet1 if current_pet_id == pet1.id else pet2
            max_hp = battle.player1_initial_hp if current_pet_id == pet1.id else battle.player2_initial_hp
            return [BattlePetOption(
                pet_id=pet.id, name=pet.name, species=pet.species, level=pet.level,
                evolution_stage=pet.evolution_stage, hp=max(0, hp), max_hp=max_hp,
                is_current=True, can_switch=False,
            )]
        result = await db.execute(
            select(UserPet)
            .where(UserPet.user_id == player_id)
            .order_by(UserPet.is_active.desc(), UserPet.level.desc(), UserPet.id)
        )
        roster = []
        for pet in result.scalars().all():
            pet_max_hp = calculate_max_hp(pet.level, pet.evolution_stage, pet.species)
            if pet.id == current_pet_id:
                # 场上这一只的上限用这一场记的数(「今天学满 30 个词」的增益会让它比公式多一成),
                # 不然队伍列表里它的血量会比上面那条血条少一截
                pet_max_hp = max(pet_max_hp, battle.player1_initial_hp if player_id == battle.player1_id
                                 else battle.player2_initial_hp)
            pet_hp = (
                hp if pet.id == current_pet_id
                else hp_data.get(str(pet.id), pet_battle_service.get_pet_current_hp(pet))
            )
            pet_hp = min(pet_max_hp, max(0, pet_hp))
            roster.append(BattlePetOption(
                pet_id=pet.id,
                name=pet.name,
                species=pet.species,
                level=pet.level,
                evolution_stage=pet.evolution_stage,
                hp=pet_hp,
                max_hp=pet_max_hp,
                is_current=pet.id == current_pet_id,
                can_switch=(
                    pet.id != current_pet_id
                    and not pet.is_injured
                    and pet_hp > 0
                    and hp > 0
                ),
            ))
        return roster

    player1_roster = await build_roster(
        battle.player1_id, pet1.id, battle.player1_hp
    )
    player2_roster = await build_roster(
        battle.player2_id, pet2.id, battle.player2_hp
    )

    return BattleResponse(
        id=battle.id,
        status=battle.status,
        mode=battle.mode,
        current_round=battle.current_round,
        max_rounds=battle.max_rounds,
        player1_id=battle.player1_id,
        player1_username=player1.username,
        player1_pet=PetBattleInfo(
            pet_id=pet1.id,
            name=pet1.name,
            species=pet1.species,
            level=pet1.level,
            evolution_stage=pet1.evolution_stage,
            hp=battle.player1_hp,
            max_hp=battle.player1_initial_hp,
            combo=battle.player1_combo,
            ultimate_charges=battle.player1_ultimate_charges,
        ),
        player1_roster=player1_roster,
        player1_total_correct=battle.player1_total_correct,
        player1_total_damage=battle.player1_total_damage,
        player2_id=battle.player2_id,
        player2_username=player2.username,
        player2_pet=PetBattleInfo(
            pet_id=pet2.id,
            name=pet2.name,
            species=pet2.species,
            level=pet2.level,
            evolution_stage=pet2.evolution_stage,
            hp=battle.player2_hp,
            max_hp=battle.player2_initial_hp,
            combo=battle.player2_combo,
            ultimate_charges=battle.player2_ultimate_charges,
        ),
        player2_roster=player2_roster,
        player2_total_correct=battle.player2_total_correct,
        player2_total_damage=battle.player2_total_damage,
        winner_id=battle.winner_id,
        created_at=battle.created_at,
        started_at=battle.started_at,
        finished_at=battle.finished_at,
        expires_at=battle.expires_at,
        trial=pet_trial.trial_of(battle),
        buffs={
            "player1": battle_moves.battle_buffs(battle, battle.player1_id),
            "player2": battle_moves.battle_buffs(battle, battle.player2_id),
        },
        play=battle_moves.battle_play(battle),
        shadow=pet_shadow.shadow_public(battle),
    )


@router.get("/battle/search-opponents")
async def search_opponents(
    q: str = Query("", max_length=50),
    limit: int = Query(20, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """可挑战对手列表(需已有宠物)。q 为空时按最近活跃排序返回默认列表,否则按用户名/昵称过滤。

    范围:**同机构**内的学生。User 是租户锚点模型、全局过滤器已按 org 罩住,
    这里再显式加一条 org_id 条件做双保险 —— 这个接口会把真实姓名返回给学生端,
    一旦过滤器被 skip_tenant_filter 或配置误关,就是跨机构姓名泄露。
    """
    conditions = [
        User.id != current_user.id,
        User.id > 0,  # 排除AI训练师等系统账号
        User.role == "student",
        User.org_id == current_user.org_id,
    ]

    q = q.strip()
    if q:
        pattern = f"%{q}%"
        conditions.append(
            or_(
                User.username.ilike(pattern),
                User.full_name.ilike(pattern),
            )
        )

    stmt = (
        select(User, UserPet)
        .join(UserPet, UserPet.user_id == User.id)
        .where(and_(*conditions), UserPet.is_active.is_(True))
        .order_by(desc(User.last_login))
        .limit(limit)
    )
    result = await db.execute(stmt)
    rows = result.all()

    return [
        {
            "user_id": user.id,
            "username": user.username,
            "full_name": user.full_name,
            "avatar_url": user.avatar_url,
            "pet_name": pet.name,
            "pet_species": pet.species,
            "pet_level": pet.level,
            "pet_evolution_stage": pet.evolution_stage,
        }
        for user, pet in rows
    ]


async def _fighting_pet(db: AsyncSession, current_user: User, *, structured: bool = False) -> UserPet:
    """开打前共用的两道门: 有没有宠物、是不是还伤着。返回出战的那只。
    structured=True 时报错给 {code, message}(新接口用);练习赛沿用原来的一句话。"""
    def deny(code: str, message: str) -> HTTPException:
        return HTTPException(status_code=400, detail={"code": code, "message": message} if structured else message)

    my_pet = (await db.execute(
        select(UserPet).where(UserPet.user_id == current_user.id, UserPet.is_active.is_(True))
    )).scalar_one_or_none()
    if not my_pet:
        raise deny("no_pet", "你还没有宠物")
    # 受伤会随时间自己好: 判受伤之前先按时间回血,休息够了的不该被挡在门外
    if await apply_natural_heal(db, my_pet):
        await db.commit()
    if my_pet.is_injured:
        raise deny("pet_injured", "🩹 宠物受伤了，先去「宠物治疗」恢复才能出战哦！")
    return my_pet


async def _open_ai_battle(
    db: AsyncSession,
    current_user: User,
    ai_config: dict,
    *,
    mode: str,
    wordbook_id: int | None = None,
    opponent_max_hp: int | None = None,
    weak_share: float = 0.6,
    stats: dict | None = None,
) -> PetBattle:
    """开一场打 AI 的对战(练习赛和闯关共用),开出来就是进行中。

    这一场有自己的一只 AI 宠物(一场一行),不再去改 AI 账号名下那只公用的 ——
    以前所有孩子共用一行,B 一开打就把 A 正在打的对手改成了另一只。
    """
    await pet_battle_service.ensure_ai_user(db)
    ai_pet = await pet_battle_service.spawn_ai_pet(
        db, name=ai_config["name"], species=ai_config["species"], level=ai_config["level"],
        max_hp=opponent_max_hp,
    )
    try:
        battle = await pet_battle_service.create_battle(
            db=db,
            player1_id=current_user.id,
            player2_id=pet_battle_service.AI_USER_ID,
            wordbook_id=wordbook_id,
            mode=mode,
            max_rounds=10,
            pet2=ai_pet,
            pet2_max_hp=opponent_max_hp,
            weak_share=weak_share,
            stats=stats,
        )
    except ValueError as e:
        # 没开成(比如库里一个能出题的词都没有): 刚建的那只 AI 宠物别留着;以前这里没接住,直接 500
        await db.delete(ai_pet)
        await db.commit()
        raise HTTPException(status_code=400, detail={"code": "battle_unavailable", "message": str(e)})

    # 标记为AI对战并保存配置;AI 对战立即开始(不需要接受)
    battle.is_ai_battle = True
    battle.ai_config = json.dumps(ai_config, ensure_ascii=False)
    battle.status = 'active'
    battle.started_at = datetime.utcnow()
    await db.commit()
    # 一人同时只打一场:这场开打后作废自己其它进行中的对战(多开标签刷经验的根因)
    if not await pet_battle_service.claim_exclusive_battle(db, battle):
        raise HTTPException(status_code=409, detail="你在另一个页面开了新的对战,请回到那个页面继续")
    await db.refresh(battle)
    return battle


@router.get("/battle/trial")
async def get_trial(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """闯关地图: 现在这一圈的 8 个区域 40 关,每关的对手、几星、通过没有、能不能打(规则见 services/pet_trial)。
    对手的等级跟着孩子出战宠物的等级算;还没宠物按 1 级显示。"""
    my_pet = (await db.execute(
        select(UserPet).where(UserPet.user_id == current_user.id, UserPet.is_active.is_(True))
    )).scalar_one_or_none()
    return await pet_trial.overview(db, current_user.id, my_pet.level if my_pet else 1)


@router.post("/battle/trial/{stage}/start", response_model=BattleResponse)
async def start_trial(
    stage: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """开打闯关的第 stage 关。闸门的顺序: 没宠物 → 宠物受伤 → 这一关还没解锁 → 今天没有对战场数。"""
    my_pet = await _fighting_pet(db, current_user, structured=True)
    await pet_trial.check_unlocked(db, current_user.id, stage)
    await battle_tickets.require_ticket(db, current_user)

    p = pet_trial.plan(stage, my_pet.level)
    stats: dict = {}
    battle = await _open_ai_battle(
        db, current_user, pet_trial.ai_config_from(p), mode="trial",
        # 闯关每一关的对手血量都是 plan 算的(比公式厚,一场才打得够长;规则见 services/pet_trial 第 5 条)
        opponent_max_hp=p["max_hp"],
        # 守关专考他自己错过的词: 薄弱词能占满 10 题(平时最多六成),不够再照旧补
        weak_share=pet_trial.BOSS_WEAK_SHARE if p["boss"] else 0.6,
        stats=stats,
    )
    # 这一场 10 题里有几道是他的薄弱词: 记进 trial 那一段,前端写「这一关有 N 个是你错过的词」
    battle.ai_config = pet_trial.with_weak_words(battle.ai_config, int(stats.get("weak_words") or 0))
    await db.commit()
    await db.refresh(battle)
    return await build_battle_response(battle, db)


# ---------------------------------------------------------------- 挑战同学的影子(规则见 services/pet_shadow)

@router.get("/battle/shadows")
async def list_shadows(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """对战大厅「同学的影子」: 同班有宠物的同学(最多 30 个)、我的影子守住 / 被打败几次、有几条战报没看。
    平台关了 → {enabled: false, items: []}"""
    if not (await battle_tickets.get_settings(db)).get("shadows"):
        return {"enabled": False, "items": []}
    return await pet_shadow.list_view(db, current_user)


@router.get("/battle/shadow-logs")
async def shadow_logs(
    mark: int = Query(0, ge=0, le=1),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """我的影子最近 20 条战报(谁来挑战、守住没有)。mark=1 顺手把没看过的标成看过。"""
    return await pet_shadow.logs_view(db, current_user.id, mark=bool(mark))


@router.post("/battle/shadow/{user_id}/start", response_model=BattleResponse)
async def start_shadow(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """挑战这位同学的影子。闸门的顺序: 平台关了 → 没宠物 → 宠物受伤 → 这个人不能挑战 → 今天已经挑战过他 → 今天没有对战场数。"""
    if not (await battle_tickets.get_settings(db)).get("shadows"):
        raise HTTPException(status_code=403, detail={"code": "shadow_off", "message": "「挑战同学的影子」现在没有开放。"})
    my_pet = await _fighting_pet(db, current_user, structured=True)
    owner, owner_pet = await pet_shadow.check_target(db, current_user, user_id)
    await pet_shadow.check_not_done_today(db, current_user, owner)
    await battle_tickets.require_ticket(db, current_user)

    skill = (await pet_shadow.skills_of(db, [owner.id])).get(owner.id) or pet_shadow.skill_from([])
    ai_config = pet_shadow.plan(owner, owner_pet, my_pet.level, skill)
    # 血量和闯关普通关同一档(比公式厚,一场才打得够长;规则见 services/pet_shadow 第 3 条);薄弱词照练习赛的六成
    battle = await _open_ai_battle(db, current_user, ai_config, mode=pet_shadow.MODE,
                                   opponent_max_hp=pet_shadow.shadow_max_hp(ai_config["level"]))
    return await build_battle_response(battle, db)


# ---------------------------------------------------------------- 全班打大怪(规则见 services/class_boss)

@router.get("/battle/class-boss")
async def get_class_boss(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """这一周全班的大怪: 血量、我打了多少、今天还能怎么打、能不能领奖。平台关了 → {enabled: false}"""
    return await class_boss.overview(db, current_user)


@router.post("/battle/class-boss/claim")
async def claim_class_boss(
    week: str = Query("this", pattern="^(this|last)$"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """领大怪的奖励(week=this 这一周 / last 上一周,上一周的只能在周一到周三领)。领不了 409 {code, message}"""
    return await class_boss.claim(db, current_user, week)


# ---------------------------------------------------------------- 没刷新的老页面
# 上线那一刻(以及之后好几天)有孩子的页面还是老的。老页面把这三个老接口(练习赛 / 发起挑战 / 接受挑战)报错里的
# detail **直接当一句话显示**(setBattleMsg(detail) / toast.error(detail)): detail 是 {code, message} 这种对象时,
# 页面不是显示一句话,而是整页进错误页 —— 「今天没场数了」本来是天天都会碰到的正常提示。
# 所以这三个接口: 请求里带 X-EH-Battle 头(新页面发的)才给对象,没带的只给那句中文。
# 新加的接口(闯关 / 影子 / 大怪)只有新页面会调,不用管。
NEW_PAGE_HEADER = "x-eh-battle"


def _plain_for_old_pages(request: Request, exc: HTTPException) -> HTTPException:
    if isinstance(exc.detail, dict) and not request.headers.get(NEW_PAGE_HEADER):
        return HTTPException(
            status_code=exc.status_code,
            detail=str(exc.detail.get("message") or "操作没成功,请稍后再试"),
            headers=exc.headers,
        )
    return exc


@router.post("/battle/create", response_model=BattleResponse)
async def create_battle(
    request: Request,
    data: BattleCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """创建对战邀请"""
    try:
        return await _create_battle(data, db, current_user)
    except HTTPException as e:
        raise _plain_for_old_pages(request, e)


async def _create_battle(data: BattleCreateRequest, db: AsyncSession, current_user: User):
    # AI 这类系统账号(负数 id)不会来接受挑战: 以前传 -1 能建出一场永远没人接的挑战
    if data.opponent_id <= 0:
        raise HTTPException(status_code=400, detail={
            "code": "bad_opponent",
            "message": "只能向同学发起挑战。想和电脑打,回宠物页点「对战」,或者去闯关。",
        })
    # 检查对手存在
    opponent = await db.get(User, data.opponent_id)
    if not opponent:
        raise HTTPException(status_code=404, detail="对手不存在")

    if data.opponent_id == current_user.id:
        raise HTTPException(status_code=400, detail="不能和自己对战")

    # 检查自己的宠物
    my_pet_result = await db.execute(
        select(UserPet).where(UserPet.user_id == current_user.id, UserPet.is_active.is_(True))
    )
    my_pet = my_pet_result.scalar_one_or_none()
    if not my_pet:
        raise HTTPException(status_code=400, detail="你还没有宠物")
    # 受伤会随时间自己好: 判受伤之前先按时间回血,休息够了的不该被挡在门外
    if await apply_natural_heal(db, my_pet):
        await db.commit()
    if my_pet.is_injured:
        raise HTTPException(status_code=400, detail="🩹 宠物受伤了，先去「宠物治疗」恢复才能出战哦！")
    # 今天还有没有对战场数(规则见 services/battle_tickets)。发挑战时就拦: 没场数的人发出去,对方接了他也进不来
    await battle_tickets.require_ticket(db, current_user)

    # 检查对手的宠物
    opponent_pet_result = await db.execute(
        select(UserPet).where(UserPet.user_id == data.opponent_id, UserPet.is_active.is_(True))
    )
    opponent_pet = opponent_pet_result.scalar_one_or_none()
    if not opponent_pet:
        raise HTTPException(status_code=400, detail="对手还没有宠物")

    # 创建对战
    try:
        battle = await pet_battle_service.create_battle(
            db=db,
            player1_id=current_user.id,
            player2_id=data.opponent_id,
            wordbook_id=data.wordbook_id,
            mode=data.mode,
            max_rounds=data.max_rounds,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return await build_battle_response(battle, db)


@router.post("/battle/{battle_id}/accept", response_model=BattleResponse)
async def accept_battle(
    request: Request,
    battle_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """接受对战邀请"""
    try:
        return await _accept_battle(battle_id, db, current_user)
    except HTTPException as e:
        raise _plain_for_old_pages(request, e)


async def _accept_battle(battle_id: int, db: AsyncSession, current_user: User):
    battle = await db.get(PetBattle, battle_id)
    if not battle:
        raise HTTPException(status_code=404, detail="对战不存在")

    if battle.player2_id != current_user.id:
        raise HTTPException(status_code=403, detail="这不是发给你的邀请")

    # 受伤门：受伤宠物不能应战
    accept_pet = (await db.execute(
        select(UserPet).where(UserPet.user_id == current_user.id, UserPet.is_active.is_(True))
    )).scalar_one_or_none()
    if accept_pet and await apply_natural_heal(db, accept_pet):
        await db.commit()
    if accept_pet and accept_pet.is_injured:
        raise HTTPException(status_code=400, detail="🩹 宠物受伤了，先去「宠物治疗」恢复才能应战哦！")
    await battle_tickets.require_ticket(db, current_user)

    try:
        battle = await pet_battle_service.accept_battle(db, battle_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return await build_battle_response(battle, db)


@router.post("/battle/{battle_id}/cancel")
async def cancel_battle(
    battle_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """取消对战邀请"""
    battle = await db.get(PetBattle, battle_id)
    if not battle:
        raise HTTPException(status_code=404, detail="对战不存在")

    if battle.player1_id != current_user.id:
        raise HTTPException(status_code=403, detail="只有发起者可以取消")

    if battle.status != "pending":
        raise HTTPException(status_code=400, detail="对战已开始,无法取消")

    battle.status = "cancelled"
    await db.commit()

    return {"message": "已取消对战邀请"}


@router.post("/battle/{battle_id}/forfeit")
async def forfeit_battle_endpoint(
    battle_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """逃跑判负：对战进行中主动退出 = 判负 + 额外掉分 + 奖励归零（对手判胜）。"""
    battle = await db.get(PetBattle, battle_id)
    if not battle:
        raise HTTPException(status_code=404, detail="对战不存在")
    if current_user.id not in (battle.player1_id, battle.player2_id):
        raise HTTPException(status_code=403, detail="你不在这场对战里")
    # 未开打(pending)直接取消，不算逃跑
    if battle.status == "pending":
        battle.status = "cancelled"
        await db.commit()
        return {"forfeited": False, "message": "对战未开始，已取消"}
    if battle.status == "finished":
        return {"forfeited": False, "message": "对战已结束"}

    result = await pet_battle_service.forfeit_battle(db, battle_id, current_user.id)
    if result is None:
        return {"forfeited": False, "message": "无法判负"}
    return {"forfeited": True, "message": "已判负（逃跑）", **result}


@router.get("/battle/{battle_id}", response_model=BattleResponse)
async def get_battle(
    battle_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """获取对战详情"""
    battle = await db.get(PetBattle, battle_id)
    if not battle:
        raise HTTPException(status_code=404, detail="对战不存在")

    # 检查权限
    if battle.player1_id != current_user.id and battle.player2_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权查看此对战")

    return await build_battle_response(battle, db)


@router.get("/battles/my", response_model=List[BattleListItem])
async def get_my_battles(
    status: str = None,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """获取我的对战列表"""
    stmt = select(PetBattle).where(
        or_(
            PetBattle.player1_id == current_user.id,
            PetBattle.player2_id == current_user.id,
        )
    )

    if status:
        stmt = stmt.where(PetBattle.status == status)

    stmt = stmt.order_by(desc(PetBattle.created_at)).limit(limit)

    result = await db.execute(stmt)
    battles = result.scalars().all()

    items = []
    for battle in battles:
        # 确定对手
        is_player1 = battle.player1_id == current_user.id
        opponent_id = battle.player2_id if is_player1 else battle.player1_id

        opponent = await pet_battle_service.load_player(db, opponent_id)
        opponent_pet_id = battle.player2_pet_id if is_player1 else battle.player1_pet_id
        opponent_pet = await db.get(UserPet, opponent_pet_id)

        # 确定结果
        result_text = None
        if battle.status == "finished":
            if battle.winner_id == current_user.id:
                result_text = "win"
            elif battle.winner_id is None:
                result_text = "draw"
            else:
                result_text = "lose"

        items.append(
            BattleListItem(
                id=battle.id,
                opponent_username=opponent.username if opponent else "对手",
                opponent_pet_name=opponent_pet.name if opponent_pet else "伙伴",
                status=battle.status,
                mode=battle.mode,
                result=result_text,
                created_at=battle.created_at,
            )
        )

    return items


@router.get("/battles/invites", response_model=List[BattleResponse])
async def get_pending_invites(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """获取待接受的邀请(只给还没过期的: 过期的点「接受」也只会报错,列着是误导)"""
    stmt = (
        select(PetBattle)
        .where(
            and_(
                PetBattle.player2_id == current_user.id,
                PetBattle.status == "pending",
                or_(PetBattle.expires_at.is_(None), PetBattle.expires_at > datetime.utcnow()),
            )
        )
        .order_by(desc(PetBattle.created_at))
    )

    result = await db.execute(stmt)
    battles = result.scalars().all()

    return [await build_battle_response(b, db) for b in battles]


@router.get("/battles/ready")
async def get_ready_battle(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """我发出的挑战**刚被接受**、对手正在等我进场 → 返回这场的 id;没有就 battle_id=null。

    为什么要有这个(2026-10-20 查出来的,真人对战九成打不起来的根因):
    接受方点「接受」直接跳进对战页,而**发起方根本不知道** —— 大厅只轮询「别人发给我的邀请」,
    发起方的页面停在原地。接受方在对战页等 30 秒「对手未连接」后被踢出,这场就变成「开了没打」。
    生产 9 月以来 104 场被接受的真人对战,56 场一个回合都没打。对战大厅每 3 秒问一次这里,
    有就自动进场。只看 started_at 在 30 秒内的(与 WS 端等待对手的时长一致),再晚接受方已经走了
    """
    since = datetime.utcnow() - timedelta(seconds=30)
    battle = (await db.execute(
        select(PetBattle).where(
            PetBattle.player1_id == current_user.id,
            PetBattle.status == "active",
            PetBattle.is_ai_battle.is_not(True),
            PetBattle.current_round == 0,
            PetBattle.started_at >= since,
        ).order_by(desc(PetBattle.id)).limit(1)
    )).scalar_one_or_none()
    if battle is None:
        return {"battle_id": None}
    opponent = await db.get(User, battle.player2_id)
    return {
        "battle_id": battle.id,
        "opponent_name": (opponent.full_name or opponent.username) if opponent else "",
    }


@router.get("/battles/buffs")
async def get_battle_buffs(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """现在开一场对战会带哪些学习增益、哪些还没拿到、怎么拿(规则见 services/battle_moves)。
    {enabled, items: [{key, label, detail, got, how, route}]};平台关了这一项 enabled=false、items 为空"""
    settings = await battle_tickets.get_settings(db)
    return await battle_moves.buff_overview(db, current_user, bool(settings.get("study_buffs")))


@router.get("/battles/tickets")
async def get_battle_tickets(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """今天的对战场数: 挣了几场、打了几场、还剩几场、每一项怎么来的(规则见 services/battle_tickets)"""
    return await battle_tickets.status(db, current_user.id)


async def _ticket_settings_view(db: AsyncSession) -> dict:
    return {"options": battle_tickets.OPTIONS, "values": await battle_tickets.get_settings(db),
            "defaults": battle_tickets.OPTION_DEFAULTS}


@router.get("/battles/ticket-settings")
async def get_ticket_settings(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_admin),
):
    """对战场数的规则和当前设置(仅平台管理员)。每一条的「会怎样 / 风险」都在 options 里,页面原样显示"""
    return await _ticket_settings_view(db)


@router.put("/battles/ticket-settings")
async def put_ticket_settings(
    request: Request,
    data: dict = Body(...),
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(get_current_admin),
):
    """改对战场数的规则(仅平台管理员)。{"reset": true} = 全部恢复默认;否则只改交上来的那几项"""
    from app.services import audit_log
    before = await battle_tickets.get_settings(db)
    if data.get("reset") is True:
        values = dict(battle_tickets.OPTION_DEFAULTS)
    else:
        try:
            values = {**before, **battle_tickets.check_options(data)}
        except ValueError as e:
            raise HTTPException(status_code=400, detail={"code": "bad_option", "message": str(e)})
    after = await battle_tickets.save_settings(db, values)
    changed = {k: [before[k], after[k]] for k in after if before[k] != after[k]}
    if changed:
        labels = {o["key"]: o["label"] for o in battle_tickets.OPTIONS}
        audit_log.record(
            db, request, admin, "pet.battle_tickets",
            "改了宠物对战场数规则: " + ";".join(f"{labels[k]} {a} → {b}" for k, (a, b) in changed.items()),
            detail={"before": before, "after": after},
        )
    await db.commit()
    return await _ticket_settings_view(db)


@router.get("/battles/stats", response_model=BattleStatsResponse)
async def get_battle_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """获取对战统计"""
    result = await db.execute(
        select(PetBattleStats).where(PetBattleStats.user_id == current_user.id)
    )
    stats = result.scalar_one_or_none()

    if not stats:
        # 初始化统计
        stats = PetBattleStats(user_id=current_user.id)
        db.add(stats)
        await db.commit()
        await db.refresh(stats)

    # 计算衍生数据
    win_rate = stats.wins / stats.total_battles * 100 if stats.total_battles > 0 else 0
    avg_damage = (
        stats.total_damage_dealt / stats.total_battles if stats.total_battles > 0 else 0
    )
    total_answers = stats.total_correct_answers + stats.total_wrong_answers
    accuracy = (
        stats.total_correct_answers / total_answers * 100 if total_answers > 0 else 0
    )

    return BattleStatsResponse(
        total_battles=stats.total_battles,
        wins=stats.wins,
        losses=stats.losses,
        draws=stats.draws,
        win_rate=round(win_rate, 1),
        current_win_streak=stats.current_win_streak,
        max_win_streak=stats.max_win_streak,
        total_damage_dealt=stats.total_damage_dealt,
        total_damage_taken=stats.total_damage_taken,
        avg_damage_per_battle=round(avg_damage, 1),
        accuracy=round(accuracy, 1),
        ultimates_used=stats.ultimates_used,
        ultimates_landed=stats.ultimates_landed,
        perfect_wins=stats.perfect_wins,
        comeback_wins=stats.comeback_wins,
        rating=stats.rating,
        peak_rating=stats.peak_rating,
    )


@router.post("/battle/quick-match", response_model=BattleResponse)
async def quick_match_battle(
    request: Request,
    wordbook_id: int = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """
    快速对战 - 自动匹配AI对手
    
    优先匹配真人玩家（3秒），无真人则生成AI对手
    """
    try:
        return await _quick_match(wordbook_id, db, current_user)
    except HTTPException as e:
        raise _plain_for_old_pages(request, e)


async def _quick_match(wordbook_id, db: AsyncSession, current_user: User):
    my_pet = await _fighting_pet(db, current_user)
    await battle_tickets.require_ticket(db, current_user)

    # 生成AI对手配置(随机一只、等级在自己上下 2 级;想一关一关往前打的走闯关 /battle/trial)
    ai_config = generate_ai_opponent(
        player_level=my_pet.level,
        player_pet_species=my_pet.species
    )
    battle = await _open_ai_battle(db, current_user, ai_config, mode='ai', wordbook_id=wordbook_id)

    print(f"快速对战创建成功: battle_id={battle.id}, status={battle.status}, is_ai={battle.is_ai_battle}")
    return await build_battle_response(battle, db)
