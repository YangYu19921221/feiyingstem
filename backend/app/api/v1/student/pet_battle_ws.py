"""宠物对战系统 - WebSocket 实时对战"""
import json
import asyncio
from datetime import datetime
from typing import Dict, Set
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.user import User
from app.models.pet_battle import PetBattle
from app.services import pet_battle_service
from app.schemas.pet_battle import (
    WSBattleStart,
    WSNewRound,
    WSAnswerReceived,
    WSRoundResult,
    WSBattleEnd,
    WSError,
    QuestionData,
    RoundResult,
)

router = APIRouter()


class BattleConnectionManager:
    """对战连接管理器"""

    def __init__(self):
        # battle_id -> {player_id: websocket}
        self.active_connections: Dict[int, Dict[int, WebSocket]] = {}
        # battle_id -> {player_id: answer_data}
        self.round_answers: Dict[int, Dict[int, dict]] = {}
        # battle_id -> asyncio.Lock
        self.battle_locks: Dict[int, asyncio.Lock] = {}

    async def connect(self, battle_id: int, player_id: int, websocket: WebSocket):
        """玩家连接"""
        await websocket.accept()

        if battle_id not in self.active_connections:
            self.active_connections[battle_id] = {}
            self.round_answers[battle_id] = {}
            self.battle_locks[battle_id] = asyncio.Lock()

        self.active_connections[battle_id][player_id] = websocket

    def disconnect(self, battle_id: int, player_id: int):
        """玩家断开"""
        if battle_id in self.active_connections:
            self.active_connections[battle_id].pop(player_id, None)

            if not self.active_connections[battle_id]:
                # 无人在线,清理
                self.active_connections.pop(battle_id, None)
                self.round_answers.pop(battle_id, None)
                self.battle_locks.pop(battle_id, None)

    async def broadcast(self, battle_id: int, message: dict):
        """向对战双方广播消息"""
        if battle_id not in self.active_connections:
            return

        disconnected = []
        for player_id, ws in self.active_connections[battle_id].items():
            try:
                await ws.send_json(message)
            except Exception:
                disconnected.append(player_id)

        # 清理断开的连接
        for player_id in disconnected:
            self.disconnect(battle_id, player_id)

    async def send_to_player(self, battle_id: int, player_id: int, message: dict):
        """向单个玩家发送消息"""
        if battle_id in self.active_connections:
            ws = self.active_connections[battle_id].get(player_id)
            if ws:
                try:
                    await ws.send_json(message)
                except Exception:
                    self.disconnect(battle_id, player_id)

    def both_connected(self, battle_id: int) -> bool:
        """检查双方是否都已连接"""
        return battle_id in self.active_connections and len(
            self.active_connections[battle_id]
        ) == 2

    def store_answer(self, battle_id: int, player_id: int, answer_data: dict):
        """存储玩家答案"""
        if battle_id not in self.round_answers:
            self.round_answers[battle_id] = {}
        self.round_answers[battle_id][player_id] = answer_data

    def get_answers(self, battle_id: int) -> Dict[int, dict]:
        """获取本回合双方答案"""
        return self.round_answers.get(battle_id, {})

    def clear_answers(self, battle_id: int):
        """清空本回合答案"""
        if battle_id in self.round_answers:
            self.round_answers[battle_id] = {}

    def both_answered(self, battle_id: int, player1_id: int, player2_id: int) -> bool:
        """检查双方是否都已答题"""
        answers = self.get_answers(battle_id)
        return player1_id in answers and player2_id in answers


manager = BattleConnectionManager()


async def verify_token_ws(token: str, db: AsyncSession) -> User:
    """WebSocket Token验证"""
    from app.api.v1.auth import verify_access_token

    try:
        user_id = verify_access_token(token)
        from sqlalchemy import select

        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if not user:
            raise ValueError("用户不存在")
        return user
    except Exception as e:
        raise ValueError(f"Token验证失败: {e}")


@router.websocket("/battle/ws/{battle_id}")
async def battle_websocket(
    websocket: WebSocket,
    battle_id: int,
    token: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """对战WebSocket连接"""

    # 验证Token
    try:
        current_user = await verify_token_ws(token, db)
    except ValueError as e:
        await websocket.close(code=4001, reason=str(e))
        return

    # 验证对战
    battle = await db.get(PetBattle, battle_id)
    if not battle:
        await websocket.close(code=4004, reason="对战不存在")
        return

    if current_user.id not in [battle.player1_id, battle.player2_id]:
        await websocket.close(code=4003, reason="无权加入此对战")
        return

    # 连接
    await manager.connect(battle_id, current_user.id, websocket)

    try:
        # 等待双方都连接
        if not manager.both_connected(battle_id):
            await websocket.send_json(
                {"type": "waiting", "message": "等待对手连接..."}
            )

            # 等待最多30秒
            for _ in range(30):
                await asyncio.sleep(1)
                if manager.both_connected(battle_id):
                    break
            else:
                await websocket.send_json(
                    WSError(message="对手未连接,对战取消").dict()
                )
                return

        # 双方都连接了,开始倒计时
        await manager.broadcast(
            battle_id, {"type": "countdown", "seconds": 3}
        )
        await asyncio.sleep(3)

        # 开始对战
        questions_data = json.loads(battle.questions_data)

        # 广播战斗开始
        from app.api.v1.student.pet_battle import build_battle_response

        battle_response = await build_battle_response(battle, db)
        await manager.broadcast(
            battle_id,
            WSBattleStart(battle=battle_response).dict(),
        )

        # 进行回合
        for round_num in range(1, battle.max_rounds + 1):
            manager.clear_answers(battle_id)

            # 发送新回合题目
            question = questions_data[round_num - 1]
            await manager.broadcast(
                battle_id,
                WSNewRound(
                    round_number=round_num,
                    question=QuestionData(**question),
                    time_limit=battle.time_per_question,
                ).dict(),
            )

            # 等待答题(超时时间 + 1秒缓冲)
            timeout = battle.time_per_question + 1
            start_time = datetime.utcnow()

            # 接收答案
            while True:
                elapsed = (datetime.utcnow() - start_time).total_seconds()
                if elapsed > timeout:
                    break

                # 检查是否双方都答了
                if manager.both_answered(
                    battle_id, battle.player1_id, battle.player2_id
                ):
                    break

                await asyncio.sleep(0.1)

            # 处理答案
            answers = manager.get_answers(battle_id)

            # 处理玩家1答案
            if battle.player1_id in answers:
                ans = answers[battle.player1_id]
                try:
                    await pet_battle_service.process_round_answer(
                        db=db,
                        battle_id=battle_id,
                        player_id=battle.player1_id,
                        round_number=round_num,
                        answer=ans["answer"],
                        time_ms=ans["time_ms"],
                        use_ultimate=ans.get("use_ultimate", False),
                    )
                except Exception as e:
                    print(f"处理玩家1答案失败: {e}")
            else:
                # 超时未答,算答错
                try:
                    await pet_battle_service.process_round_answer(
                        db=db,
                        battle_id=battle_id,
                        player_id=battle.player1_id,
                        round_number=round_num,
                        answer="X",  # 无效答案
                        time_ms=timeout * 1000,
                        use_ultimate=False,
                    )
                except Exception:
                    pass

            # 处理玩家2答案
            if battle.player2_id in answers:
                ans = answers[battle.player2_id]
                try:
                    await pet_battle_service.process_round_answer(
                        db=db,
                        battle_id=battle_id,
                        player_id=battle.player2_id,
                        round_number=round_num,
                        answer=ans["answer"],
                        time_ms=ans["time_ms"],
                        use_ultimate=ans.get("use_ultimate", False),
                    )
                except Exception as e:
                    print(f"处理玩家2答案失败: {e}")
            else:
                try:
                    await pet_battle_service.process_round_answer(
                        db=db,
                        battle_id=battle_id,
                        player_id=battle.player2_id,
                        round_number=round_num,
                        answer="X",
                        time_ms=timeout * 1000,
                        use_ultimate=False,
                    )
                except Exception:
                    pass

            # 结算回合
            battle, round_obj = await pet_battle_service.finalize_round(
                db, battle_id, round_num
            )

            # 广播回合结果
            await manager.broadcast(
                battle_id,
                WSRoundResult(
                    result=RoundResult(
                        round_number=round_num,
                        question=QuestionData(**question),
                        player1_answer=round_obj.player1_answer,
                        player1_correct=round_obj.player1_correct,
                        player1_time_ms=round_obj.player1_time_ms,
                        player1_damage=round_obj.player1_damage,
                        player1_used_ultimate=round_obj.player1_used_ultimate,
                        player1_hp_after=round_obj.player1_hp_after,
                        player2_answer=round_obj.player2_answer,
                        player2_correct=round_obj.player2_correct,
                        player2_time_ms=round_obj.player2_time_ms,
                        player2_damage=round_obj.player2_damage,
                        player2_used_ultimate=round_obj.player2_used_ultimate,
                        player2_hp_after=round_obj.player2_hp_after,
                    )
                ).dict(),
            )

            # 检查是否结束
            winner_id = await pet_battle_service.check_battle_end(battle)
            if winner_id is not None or battle.current_round >= battle.max_rounds:
                break

            # 回合间隔
            await asyncio.sleep(2)

        # 结算奖励
        winner_id = await pet_battle_service.check_battle_end(battle)
        rewards = await pet_battle_service.finish_battle(db, battle_id, winner_id)

        # 获取胜者名字
        winner_name = None
        if winner_id:
            winner = await db.get(User, winner_id)
            winner_name = winner.username if winner else None

        # 广播战斗结束
        await manager.broadcast(
            battle_id,
            WSBattleEnd(
                winner_id=winner_id,
                winner_name=winner_name,
                food_earned=rewards.get(current_user.id, {}).get("food", 0),
                xp_earned=rewards.get(current_user.id, {}).get("xp", 0),
                rating_change=rewards.get(current_user.id, {}).get("rating_change", 0),
                player1_final_stats={
                    "correct": battle.player1_total_correct,
                    "damage": battle.player1_total_damage,
                    "hp": battle.player1_hp,
                },
                player2_final_stats={
                    "correct": battle.player2_total_correct,
                    "damage": battle.player2_total_damage,
                    "hp": battle.player2_hp,
                },
            ).dict(),
        )

    except WebSocketDisconnect:
        manager.disconnect(battle_id, current_user.id)
        # 通知对手
        await manager.broadcast(
            battle_id,
            WSError(message="对手已断开连接", code="opponent_disconnected").dict(),
        )

    except Exception as e:
        print(f"对战WebSocket错误: {e}")
        await websocket.send_json(
            WSError(message=f"服务器错误: {e}").dict()
        )

    finally:
        manager.disconnect(battle_id, current_user.id)


@router.websocket("/battle/ws/{battle_id}/answer")
async def answer_websocket(
    websocket: WebSocket,
    battle_id: int,
    token: str = Query(...),
):
    """答题WebSocket(单独通道,避免阻塞主WS)"""
    await websocket.accept()

    try:
        # 验证Token
        from app.core.database import get_db

        async for db in get_db():
            current_user = await verify_token_ws(token, db)
            break

        while True:
            data = await websocket.receive_json()

            # 存储答案
            manager.store_answer(battle_id, current_user.id, data)

            # 通知对手"已收到答案"
            await manager.broadcast(
                battle_id,
                WSAnswerReceived(
                    player_id=current_user.id,
                    round_number=data["round_number"],
                ).dict(),
            )

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"答题WS错误: {e}")
