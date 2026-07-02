"""宠物对战系统 - HTTP API"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, and_, desc
from typing import List

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
)
from app.services import pet_battle_service
from app.api.v1.auth import get_current_student

router = APIRouter()


async def build_battle_response(battle: PetBattle, db: AsyncSession) -> BattleResponse:
    """构建对战响应"""
    # 查询用户信息
    player1 = await db.get(User, battle.player1_id)
    player2 = await db.get(User, battle.player2_id)
    pet1 = await db.get(UserPet, battle.player1_pet_id)
    pet2 = await db.get(UserPet, battle.player2_pet_id)

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
        player2_total_correct=battle.player2_total_correct,
        player2_total_damage=battle.player2_total_damage,
        winner_id=battle.winner_id,
        created_at=battle.created_at,
        started_at=battle.started_at,
        finished_at=battle.finished_at,
        expires_at=battle.expires_at,
    )


@router.post("/battle/create", response_model=BattleResponse)
async def create_battle(
    data: BattleCreateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """创建对战邀请"""
    # 检查对手存在
    opponent = await db.get(User, data.opponent_id)
    if not opponent:
        raise HTTPException(status_code=404, detail="对手不存在")

    if data.opponent_id == current_user.id:
        raise HTTPException(status_code=400, detail="不能和自己对战")

    # 检查自己的宠物
    my_pet_result = await db.execute(
        select(UserPet).where(UserPet.user_id == current_user.id)
    )
    my_pet = my_pet_result.scalar_one_or_none()
    if not my_pet:
        raise HTTPException(status_code=400, detail="你还没有宠物")

    # 检查对手的宠物
    opponent_pet_result = await db.execute(
        select(UserPet).where(UserPet.user_id == data.opponent_id)
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
    battle_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """接受对战邀请"""
    battle = await db.get(PetBattle, battle_id)
    if not battle:
        raise HTTPException(status_code=404, detail="对战不存在")

    if battle.player2_id != current_user.id:
        raise HTTPException(status_code=403, detail="这不是发给你的邀请")

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

        opponent = await db.get(User, opponent_id)
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
                opponent_username=opponent.username,
                opponent_pet_name=opponent_pet.name,
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
    """获取待接受的邀请"""
    stmt = (
        select(PetBattle)
        .where(
            and_(
                PetBattle.player2_id == current_user.id,
                PetBattle.status == "pending",
            )
        )
        .order_by(desc(PetBattle.created_at))
    )

    result = await db.execute(stmt)
    battles = result.scalars().all()

    return [await build_battle_response(b, db) for b in battles]


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
