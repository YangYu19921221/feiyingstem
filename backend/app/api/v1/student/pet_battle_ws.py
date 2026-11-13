"""宠物对战系统 - WebSocket 实时对战"""
import json
import asyncio
import time
from datetime import datetime
from typing import Dict, Optional, Set
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal, get_db
from app.models.user import User
from app.models.pet_battle import PetBattle
from app.services import battle_moves, pet_battle_service
from app.core.pet_formulas import round_fx_counts, round_gap_seconds
from app.services.ai_opponent_service import (
    ai_should_answer_correctly,
    generate_ai_answer_time,
    generate_ai_wrong_answer,
    calculate_ai_ultimate_usage_chance,
)
from app.schemas.pet_battle import (
    WSBattleStart,
    WSNewRound,
    WSAnswerReceived,
    WSRoundResult,
    WSBattleEnd,
    WSError,
    QuestionData,
    RoundQuestionData,
    RoundResult,
)

router = APIRouter()

# AI 答题、答题通道各开自己的数据库会话(不和对战主连接共用)。测试里换成测试库的会话工厂
session_factory = AsyncSessionLocal

# 开打前的倒计时(秒)。测试里调小
COUNTDOWN_SECONDS = 3

# 驱动循环出了意外: 给还连着的页面发这一条,页面收到会自己重新连上来接着打
DRIVER_CRASHED = {"type": "error", "code": "driver_crashed", "message": "对战出了点问题,正在重新接上…"}


class BattleConnectionManager:
    """对战连接管理器"""

    def __init__(self):
        # battle_id -> {player_id: websocket}
        self.active_connections: Dict[int, Dict[int, WebSocket]] = {}
        # battle_id -> {player_id: answer_data}
        self.round_answers: Dict[int, Dict[int, dict]] = {}
        # battle_id -> asyncio.Lock
        self.battle_locks: Dict[int, asyncio.Lock] = {}
        # 只允许在回合结果展示期间切换宠物
        self.switch_windows: Set[int] = set()
        # 正在被回合循环驱动的对战:同一场只允许一条驱动循环。
        # 否则玩家刷新页面会再起一条循环,血量归零结束后旧题目还在继续推送。
        self.driver_battles: Set[int] = set()
        # 在飞的 AI 答题任务。asyncio 对 create_task 出来的任务只留弱引用,不自己拿着的话可能半路被回收
        self.ai_tasks: Set[asyncio.Task] = set()
        # 每场对战当前这一回合、给每个玩家**第一次**发题的时刻(time.monotonic): battle_id → (回合, {玩家: 时刻})。
        # 服务端靠它自己掐答题用时(见 pet_battle_service.fair_time_ms)。**断线重连、补发题目不重新掐** ——
        # 不然断一下再连上就能把表归零(想多久都算秒答)。所以它不跟着连接清,对战打完才清
        self.round_clock: Dict[int, tuple] = {}

    async def connect(self, battle_id: int, player_id: int, websocket: WebSocket):
        """玩家连接"""
        await websocket.accept()

        if battle_id not in self.active_connections:
            self.active_connections[battle_id] = {}
            # setdefault: 驱动循环断过重新连上来时,孩子这一回合交过的答案还留在这儿,别清掉
            self.round_answers.setdefault(battle_id, {})
            self.battle_locks.setdefault(battle_id, asyncio.Lock())

        self.active_connections[battle_id][player_id] = websocket

    def disconnect(self, battle_id: int, player_id: int, keep_answers: bool = False):
        """玩家断开。keep_answers: 驱动循环是出意外退出的 —— 这一回合已经交上来的答案留着,
        页面重新连上来接着打时还用得上(不让孩子白丢一题)。留下的那一小份等这场打完正常断开时清掉"""
        if battle_id in self.active_connections:
            self.active_connections[battle_id].pop(player_id, None)

            if not self.active_connections[battle_id]:
                # 无人在线,清理
                self.active_connections.pop(battle_id, None)
                if not keep_answers:
                    self.round_answers.pop(battle_id, None)
                self.battle_locks.pop(battle_id, None)
                self.switch_windows.discard(battle_id)

    async def broadcast(self, battle_id: int, message: dict):
        """向对战双方广播消息"""
        if battle_id not in self.active_connections:
            print(f"❌ 广播失败: battle_id={battle_id} 不在active_connections中")
            return

        print(f"📡 广播消息: battle_id={battle_id}, type={message.get('type', '?')}, 连接数={len(self.active_connections[battle_id])}")
        disconnected = []
        for player_id, ws in self.active_connections[battle_id].items():
            try:
                await ws.send_json(message)
                print(f"  ✓ 发送给玩家 {player_id}")
            except Exception as e:
                print(f"  ✗ 发送失败给玩家 {player_id}: {e}")
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

    def both_connected(self, battle_id: int, is_ai_battle: bool = False) -> bool:
        """检查双方是否都已连接"""
        if is_ai_battle:
            # AI对战只需要一个真人连接
            return battle_id in self.active_connections and len(
                self.active_connections[battle_id]
            ) >= 1
        return battle_id in self.active_connections and len(
            self.active_connections[battle_id]
        ) == 2

    def store_answer(self, battle_id: int, player_id: int, answer_data: dict):
        """存储玩家答案(顺手记下收到的时刻,服务端掐用时用;页面自己带的同名键不认)"""
        if battle_id not in self.round_answers:
            self.round_answers[battle_id] = {}
        if isinstance(answer_data, dict):
            answer_data = {**answer_data, "_recv_at": time.monotonic()}
        self.round_answers[battle_id][player_id] = answer_data

    @staticmethod
    def _for_round(answer: dict, round_number: int) -> bool:
        """这份答案是不是交给这一回合的。答案里带着回合号(页面交的、AI 交的都带);
        回合号对不上的(上一回合晚到的)不能算到这一回合头上"""
        try:
            return int(answer.get("round_number")) == round_number
        except (TypeError, ValueError):
            return False

    def get_answers(self, battle_id: int, round_number: int = None) -> Dict[int, dict]:
        """获取本回合双方答案(给了回合号就只要这一回合的)"""
        answers = self.round_answers.get(battle_id, {})
        if round_number is None:
            return answers
        return {pid: a for pid, a in answers.items() if self._for_round(a, round_number)}

    def clear_answers(self, battle_id: int):
        """清空本回合答案"""
        if battle_id in self.round_answers:
            self.round_answers[battle_id] = {}

    def begin_round(self, battle_id: int, round_number: int):
        """新一回合开始: 别的回合的答案清掉,**这一回合已经交上来的留着**。
        正常打的时候留下来的一定是空的;驱动循环断过、重新接上再走到这一回合时,孩子交过的答案还在"""
        self.round_answers[battle_id] = self.get_answers(battle_id, round_number)

    def both_answered(self, battle_id: int, player1_id: int, player2_id: int, round_number: int = None) -> bool:
        """检查双方是否都已答题"""
        answers = self.get_answers(battle_id, round_number)
        return player1_id in answers and player2_id in answers

    def mark_sent(self, battle_id: int, round_number: int, player_id: int) -> None:
        """记下给这个玩家发这一回合题目的时刻。这一回合已经记过的(重连补发)不动"""
        rnd, sent = self.round_clock.get(battle_id, (None, None))
        if rnd != round_number:
            sent = {}
            self.round_clock[battle_id] = (round_number, sent)
            if len(self.round_clock) > 2000:      # 兜底: 打到一半没人回来的对战,别让这张表一直涨
                for old in list(self.round_clock)[:500]:
                    if old != battle_id:
                        self.round_clock.pop(old, None)
        sent.setdefault(player_id, time.monotonic())

    def server_ms(self, battle_id: int, round_number: int, player_id: int, answer) -> Optional[float]:
        """服务端掐的用时(毫秒): 这个玩家的答案收到的时刻 − 第一次给他发这一题的时刻。掐不到给 None"""
        rnd, sent = self.round_clock.get(battle_id, (None, None))
        if rnd != round_number or not isinstance(answer, dict):
            return None
        sent_at, recv_at = sent.get(player_id), answer.get("_recv_at")
        if sent_at is None or recv_at is None:
            return None
        return max(0.0, (recv_at - sent_at) * 1000.0)

    def spawn_ai(self, coro) -> asyncio.Task:
        """起一个 AI 答题任务,并拿着它直到跑完"""
        task = asyncio.create_task(coro)
        self.ai_tasks.add(task)
        task.add_done_callback(self.ai_tasks.discard)
        return task

    def open_switch_window(self, battle_id: int):
        self.switch_windows.add(battle_id)

    def close_switch_window(self, battle_id: int):
        self.switch_windows.discard(battle_id)

    def can_switch(self, battle_id: int) -> bool:
        return battle_id in self.switch_windows

    def try_claim_driver(self, battle_id: int) -> bool:
        """尝试成为该对战的回合驱动者;已有驱动循环在跑则失败。"""
        if battle_id in self.driver_battles:
            return False
        self.driver_battles.add(battle_id)
        return True

    def release_driver(self, battle_id: int):
        self.driver_battles.discard(battle_id)


manager = BattleConnectionManager()


async def verify_token_ws(token: str, db: AsyncSession) -> User:
    """WebSocket Token验证"""
    from app.api.v1.auth import _authenticate_token
    from sqlalchemy import select

    try:
        user = await _authenticate_token(token, db)
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

    # 已结束的对战不允许重新开打(此前重连会从第1回合重放,血量0也继续)
    if battle.status in ("finished", "cancelled"):
        await websocket.close(code=4005, reason="对战已结束")
        return

    # 整场不变的几个数先取成局部变量,下面(尤其是等答案的那个轮询、出错后的收尾)不再读 ORM 对象的属性。
    # 2026-11-12 查到的卡死: 轮询里每 0.1 秒读一次 battle.player1_id,而 AI 的答题任务以前和这里共用一个会话,
    # 它 refresh(battle) 的那几毫秒里对象是「过期」的 —— 这时读属性 = 在协程外面触发懒加载 → MissingGreenlet,
    # 驱动循环当场死掉,孩子的页面永远停在「等待对手答题」。线上 35 天的日志里有 37 次。
    user_id = current_user.id
    player1_id, player2_id = battle.player1_id, battle.player2_id
    is_ai_battle = bool(battle.is_ai_battle)
    ai_player_id = (player2_id if player1_id > 0 else player1_id) if is_ai_battle else None

    # 连接
    await manager.connect(battle_id, user_id, websocket)

    is_driver = False
    crashed = False
    try:
        # AI对战直接开始，不等待对手连接
        if not is_ai_battle:
            # 等待双方都连接（仅非AI对战）
            if not manager.both_connected(battle_id, is_ai_battle):
                await websocket.send_json(
                    {"type": "waiting", "message": "等待对手连接..."}
                )

                # 等待最多30秒
                for _ in range(30):
                    await asyncio.sleep(1)
                    if manager.both_connected(battle_id, is_ai_battle):
                        break
                else:
                    await websocket.send_json(
                        WSError(message="对手未连接,对战取消").model_dump(mode="json")
                    )
                    return

        # 同一场对战只允许一条回合驱动循环:玩家1首连时认领;
        # 玩家2、以及任何一方断线重连,都只做被动接收(广播照收,不重开回合)。
        # 驱动循环出意外退出后会放掉驱动权,玩家1重新连上来就在这里重新认领、从没打完的那一回合接着打。
        if user_id == player1_id:
            is_driver = manager.try_claim_driver(battle_id)

        if not is_driver:
            # 先补发一份当前战局快照,断线重连的页面才能立刻恢复血量/回合显示
            if battle.status == "active":
                from app.api.v1.student.pet_battle import build_battle_response

                snapshot = await build_battle_response(battle, db)
                await manager.send_to_player(
                    battle_id,
                    user_id,
                    WSBattleStart(battle=snapshot).model_dump(mode="json"),
                )
            # 被动接收广播;对战结束或超时(兜底 30 分钟)退出
            for _ in range(7200):
                await asyncio.sleep(0.25)
                await db.refresh(battle)
                if battle.status != "active" and battle.status != "pending":
                    return
            return

        # 双方都连接了,开始倒计时
        await manager.broadcast(
            battle_id, {"type": "countdown", "seconds": 3}
        )
        await asyncio.sleep(COUNTDOWN_SECONDS)

        # 重新查询battle对象（避免session过期）
        battle = await db.get(PetBattle, battle_id)
        if not battle:
            await websocket.send_json(WSError(message="对战不存在").model_dump(mode="json"))
            return

        # 开始对战
        print(f"开始对战: battle_id={battle_id}, is_ai={is_ai_battle}")
        try:
            questions_data = json.loads(battle.questions_data)
            print(f"题目数据已加载: {len(questions_data)} 题")
        except Exception as e:
            print(f"❌ 加载题目失败: {e}")
            raise
        max_rounds = battle.max_rounds
        time_limit = battle.time_per_question
        try:
            ai_config = json.loads(battle.ai_config) if battle.ai_config else {}
        except (TypeError, ValueError):
            ai_config = {}

        print("准备广播战斗开始")
        # 广播战斗开始
        try:
            from app.api.v1.student.pet_battle import build_battle_response

            battle_response = await build_battle_response(battle, db)
            print(f"battle_response已构建")
            await manager.broadcast(
                battle_id,
                WSBattleStart(battle=battle_response).model_dump(mode="json"),
            )
            print(f"战斗开始已广播")
        except Exception as e:
            print(f"❌ 广播战斗开始失败: {e}")
            import traceback
            traceback.print_exc()
            raise

        # 进行回合(从 current_round+1 起:驱动循环意外中断后重连续打,不重放已结算回合)
        for round_num in range(battle.current_round + 1, max_rounds + 1):
            manager.close_switch_window(battle_id)
            await db.refresh(battle)
            # 别的回合的答案清掉;这一回合已经交上来的留着(只有断过重新接上才会有)
            manager.begin_round(battle_id, round_num)

            # 每回合开局兜底:对战被判负/结束、任一方血量已归零、或题目用尽
            # (存量旧对战题目数可能少于回合数),立刻停止发题
            if (
                battle.status != "active"
                or battle.player1_hp <= 0
                or battle.player2_hp <= 0
                or round_num > len(questions_data)
            ):
                break

            print(f"第{round_num}回合开始")
            question = questions_data[round_num - 1]

            # 这一回合库里已经记下的答案(驱动循环断过、重新接上才会有): 算已经答了 ——
            # 不让那一方再答一遍,也不会被处理第二遍
            on_record = await pet_battle_service.recorded_answers(db, battle_id, round_num)
            for pid in on_record:
                manager.store_answer(battle_id, pid, {"round_number": round_num, "recorded": True})

            # 发送新回合题目。**每个人收自己的一份**: 放大招要拼的咒语每个孩子不一样(真人对战时不能让对手看到)。
            # 发给孩子之前都过 public_question(在 new_round_question 里): 「看中文选英文」的单词、
            # 题目里给每个人备的咒语词都是答案,出题时不能带
            round_limit = pet_battle_service.round_time_limit(battle, question, round_num)
            for pid in (player1_id, player2_id):
                if pid <= 0:
                    continue
                manager.mark_sent(battle_id, round_num, pid)      # 服务端从这一刻起掐他的用时(补发不重掐)
                await manager.send_to_player(
                    battle_id, pid,
                    WSNewRound(
                        round_number=round_num,
                        question=QuestionData(
                            **pet_battle_service.new_round_question(battle, question, round_num, pid)
                        ),
                        time_limit=round_limit,
                    ).dict(),
                )

            # 如果是AI对战，启动AI答题任务(它用自己的数据库会话,不碰这里的 db)
            if is_ai_battle and ai_player_id not in on_record:
                manager.spawn_ai(
                    schedule_ai_answer(
                        battle_id=battle_id,
                        round_number=round_num,
                        question=question,
                        ai_player_id=ai_player_id,
                        ai_config=ai_config,
                        manager=manager,
                    )
                )

            # 等待答题(这一回合的时限 + 1秒缓冲;有人要拼咒语的回合时限已经多了 10 秒)
            timeout = round_limit + 1
            start_time = datetime.utcnow()

            # 接收答案。⚠️ 这个轮询里只用上面取好的局部变量,不读任何 ORM 对象的属性(原因见函数开头)
            while True:
                elapsed = (datetime.utcnow() - start_time).total_seconds()
                if elapsed > timeout:
                    break

                # 检查是否双方都答了
                if manager.both_answered(battle_id, player1_id, player2_id, round_num):
                    break

                await asyncio.sleep(0.1)

            # 处理答案
            answers = manager.get_answers(battle_id, round_num)
            for pid, label in ((player1_id, "玩家1"), (player2_id, "玩家2")):
                ans = answers.get(pid)
                if ans and ans.get("recorded"):
                    continue    # 库里已经记下了(AI 自己记的,或者断线前处理过的)
                answer, time_ms, use_ultimate = _read_answer(ans, timeout * 1000)
                if pid > 0 and ans is not None:
                    # 用时不全信页面报的: 和服务端自己掐的(减 1.5 秒宽限)取大的那个
                    time_ms = pet_battle_service.fair_time_ms(
                        time_ms, manager.server_ms(battle_id, round_num, pid, ans), timeout * 1000,
                    )
                try:
                    await pet_battle_service.process_round_answer(
                        db=db,
                        battle_id=battle_id,
                        player_id=pid,
                        round_number=round_num,
                        answer=answer,
                        time_ms=time_ms,
                        use_ultimate=use_ultimate,
                        # 出招 / 咒语: 老页面不带这两个键 = 普通出招、不拼(规则见 services/battle_moves)
                        stance=ans.get("stance") if isinstance(ans, dict) else None,
                        spell=ans.get("spell") if isinstance(ans, dict) else None,
                        # 新页面交答案都带 "v": 2;没带 = 还没刷新的老页面,点大招照老规矩直接放
                        legacy_client=battle_moves.is_legacy_client(ans.get("v") if isinstance(ans, dict) else None),
                    )
                except Exception as e:
                    # 常见的是「已经答过题了」(AI 的答案刚好在这之前记上了),不碍事
                    print(f"处理{label}答案失败: {e}")

            # 结算回合(对战中途被判负/结束时会拒绝结算,直接收尾)
            try:
                battle, round_obj = await pet_battle_service.finalize_round(
                    db, battle_id, round_num
                )
            except ValueError:
                break

            battle_has_ended = (
                battle.player1_hp <= 0
                or battle.player2_hp <= 0
                or battle.current_round >= battle.max_rounds
            )
            next_in = None
            if not battle_has_ended:
                manager.open_switch_window(battle_id)
                # 隔多久发下一题: 招式演完 + 看答案的时间;有人能换宠物才留满 8 秒(core/pet_formulas.round_gap_seconds)
                n_normal, n_ult = round_fx_counts(
                    round_obj.player1_damage or 0, round_obj.player2_damage or 0,
                    bool(round_obj.player1_used_ultimate), bool(round_obj.player2_used_ultimate),
                )
                next_in = round_gap_seconds(
                    n_normal, n_ult, can_switch=await pet_battle_service.anyone_can_switch(db, battle),
                )

            # 广播回合结果
            await manager.broadcast(
                battle_id,
                WSRoundResult(
                    next_in=next_in,
                    result=RoundResult(
                        round_number=round_num,
                        question=RoundQuestionData(**pet_battle_service.result_question(question)),
                        player1_answer=round_obj.player1_answer,
                        player1_correct=round_obj.player1_correct,
                        player1_time_ms=round_obj.player1_time_ms,
                        player1_damage=round_obj.player1_damage,
                        player1_used_ultimate=round_obj.player1_used_ultimate,
                        player1_type_multiplier=round_obj.player1_type_multiplier or 1.0,
                        player1_type_text=round_obj.player1_type_text,
                        player1_hp_after=round_obj.player1_hp_after,
                        player1_combo=battle.player1_combo,
                        player1_ultimate_charges=battle.player1_ultimate_charges,
                        player2_answer=round_obj.player2_answer,
                        player2_correct=round_obj.player2_correct,
                        player2_time_ms=round_obj.player2_time_ms,
                        player2_damage=round_obj.player2_damage,
                        player2_used_ultimate=round_obj.player2_used_ultimate,
                        player2_type_multiplier=round_obj.player2_type_multiplier or 1.0,
                        player2_type_text=round_obj.player2_type_text,
                        player2_hp_after=round_obj.player2_hp_after,
                        player2_combo=battle.player2_combo,
                        player2_ultimate_charges=battle.player2_ultimate_charges,
                        # 两边的出招、挨的打有没有被防守减过、咒语拼得怎么样(结算了才给答案)
                        **pet_battle_service.round_moves(round_obj),
                    )
                ).dict(),
            )

            # 检查是否结束
            if battle_has_ended:
                break

            # 等这一回合的招式演完(有人能换宠物时至少 8 秒);新题发出前会关掉换宠窗口。
            await asyncio.sleep(next_in or 0)

        # 结算奖励
        winner_id = await pet_battle_service.check_battle_end(battle)
        rewards = await pet_battle_service.finish_battle(db, battle_id, winner_id)
        if rewards.get("_superseded"):
            # 这场被另一个页面新开的对战作废了(一人同时只打一场),不发奖励
            await manager.broadcast(battle_id, WSError(
                message="你在另一个页面开始了新的对战,这一场已结束(不计奖励)。",
                code="superseded",
            ).model_dump(mode="json"))
            return

        # 获取胜者名字
        winner_name = None
        if winner_id:
            # AI 赢了的话要绕开租户过滤才取得到它(见 pet_battle_service.load_player)
            winner = await pet_battle_service.load_player(db, winner_id)
            winner_name = winner.username if winner else None

        # 广播战斗结束
        await manager.broadcast(
            battle_id,
            WSBattleEnd(
                winner_id=winner_id,
                winner_name=winner_name,
                food_earned=rewards.get(user_id, {}).get("food", 0),
                xp_earned=rewards.get(user_id, {}).get("xp", 0),
                rating_change=rewards.get(user_id, {}).get("rating_change", 0),
                player1_reward=rewards.get(player1_id),
                player2_reward=rewards.get(player2_id),
                capture=rewards.get("_capture"),
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
                review=await pet_battle_service.battle_review(db, battle_id),
                # 闯关: 这一场几星、是不是第一次通过、下一关是第几关(不是闯关就是 None)
                trial=rewards.get("_trial"),
                healed=bool(rewards.get("_healed")),
            ).dict(),
        )
        manager.round_clock.pop(battle_id, None)      # 打完了,掐时间的那份不用留了

    except WebSocketDisconnect:
        manager.disconnect(battle_id, user_id)
        # 通知对手
        await manager.broadcast(
            battle_id,
            WSError(message="对手已断开连接", code="opponent_disconnected").model_dump(mode="json"),
        )

    except Exception as e:
        import traceback
        print(f"对战WebSocket错误: battle_id={battle_id} {e}")
        traceback.print_exc()
        crashed = is_driver
        # 先放掉驱动权再通知: 页面收到这条马上重连,重连进来要能重新认领驱动、从没打完的那一回合接着打。
        # 不把报错原文发给孩子(以前发的是「服务器错误: greenlet_spawn has not been called…」)
        if is_driver:
            manager.release_driver(battle_id)
        try:
            await manager.broadcast(battle_id, DRIVER_CRASHED)
        except Exception:
            pass

    finally:
        if is_driver:
            manager.release_driver(battle_id)
        manager.close_switch_window(battle_id)
        # 驱动循环是出意外退出的: 这一回合孩子已经交上来的答案留着,重连接着打时还用
        manager.disconnect(battle_id, user_id, keep_answers=crashed)


def _read_answer(ans, timeout_ms: int):
    """把交上来的答案读成 (选项, 用时毫秒, 用不用大招)。没交 / 交的东西不成样子 → 按超时没答算(选项 X)。
    以前直接 ans["answer"] / ans["time_ms"],少一个键就是 KeyError,两边都没记上答案的话后面结算会找不到回合"""
    if not isinstance(ans, dict):
        return "X", timeout_ms, False
    answer = str(ans.get("answer") or "X").strip().upper()[:1] or "X"
    try:
        time_ms = int(ans.get("time_ms"))
    except (TypeError, ValueError):
        time_ms = timeout_ms
    time_ms = max(0, min(timeout_ms, time_ms))
    return answer, time_ms, bool(ans.get("use_ultimate", False))


@router.websocket("/battle/ws/{battle_id}/answer")
async def answer_websocket(
    websocket: WebSocket,
    battle_id: int,
    token: str = Query(...),
):
    """答题WebSocket(单独通道,避免阻塞主WS)"""
    await websocket.accept()

    try:
        # 这条通道用自己的会话。以前是 `async for db in get_db(): ...; break` 半路跳出来,
        # 那个会话要等垃圾回收才关;现在整个通道包在 async with 里,断开就关
        async with session_factory() as db:
            current_user = await verify_token_ws(token, db)
            user_id = current_user.id

            battle = await db.get(PetBattle, battle_id)
            if not battle or user_id not in (battle.player1_id, battle.player2_id):
                await websocket.close(code=4003, reason="无权加入此对战")
                return
            # 查完就把这个会话的读事务收掉: 这条通道一开好几分钟,读事务一直挂着会拖住 SQLite 的 WAL 回收
            await db.commit()

            while True:
                data = await websocket.receive_json()
                if not isinstance(data, dict):
                    await websocket.send_json({"type": "answer_error", "message": "未知操作"})
                    continue

                message_type = data.get("type", "submit_answer")
                if message_type == "switch_pet":
                    if not manager.can_switch(battle_id):
                        await websocket.send_json({
                            "type": "switch_error",
                            "message": "只能在回合结算时更换宠物",
                        })
                        continue

                    try:
                        lock = manager.battle_locks.setdefault(battle_id, asyncio.Lock())
                        async with lock:
                            switched_battle = await pet_battle_service.switch_battle_pet(
                                db=db,
                                battle_id=battle_id,
                                player_id=user_id,
                                pet_id=int(data["pet_id"]),
                            )
                            from app.api.v1.student.pet_battle import build_battle_response
                            battle_response = await build_battle_response(switched_battle, db)
                        await manager.broadcast(battle_id, {
                            "type": "pet_switched",
                            "player_id": user_id,
                            "battle": battle_response.model_dump(mode="json"),
                        })
                        await websocket.send_json({
                            "type": "switch_accepted",
                            "pet_id": int(data["pet_id"]),
                        })
                    except (KeyError, TypeError, ValueError) as exc:
                        await websocket.send_json({
                            "type": "switch_error",
                            "message": str(exc) or "换宠失败",
                        })
                    continue

                if message_type != "submit_answer":
                    await websocket.send_json({"type": "answer_error", "message": "未知操作"})
                    continue

                # 答案要带回合号: 驱动循环按回合号认这是哪一回合的答案
                try:
                    round_number = int(data["round_number"])
                except (KeyError, TypeError, ValueError):
                    await websocket.send_json({"type": "answer_error", "message": "答案里没有回合号"})
                    continue

                # 存储答案(只进内存,不碰库;处理在驱动循环里)
                manager.store_answer(battle_id, user_id, data)

                # 通知对手"已收到答案"
                await manager.broadcast(
                    battle_id,
                    WSAnswerReceived(
                        player_id=user_id,
                        round_number=round_number,
                    ).model_dump(mode="json"),
                )

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"答题WS错误: {e}")


async def schedule_ai_answer(
    battle_id: int,
    round_number: int,
    question: dict,
    ai_player_id: int,
    ai_config: dict,
    manager: BattleConnectionManager,
):
    """AI自动答题任务。

    ⚠️ **用自己的数据库会话**(session_factory),不和对战主连接的驱动循环共用。
    它是另起的一个 asyncio 任务;以前直接拿驱动循环的 db 用 —— 一个会话被两个任务同时用:
    这里 refresh(battle) 的那几毫秒,驱动循环那边读同一个 battle 对象的属性就会 MissingGreenlet,
    整场对战卡死(线上 35 天 37 次)。所以这里只收几个普通的值,不收 ORM 对象、不收别人的会话。

    不管记没记上,最后都报一声「AI 答完了」: 不报的话驱动循环要干等到超时(16 秒)。
    """
    # 生成AI答题时间
    answer_time_ms = generate_ai_answer_time(
        ai_config.get('speed_min_ms', 3000),
        ai_config.get('speed_max_ms', 8000)
    )

    # 等待AI思考时间
    await asyncio.sleep(answer_time_ms / 1000.0)

    recorded = False
    try:
        # 判断AI是否答对
        is_correct = ai_should_answer_correctly(ai_config.get('accuracy', 0.7))

        # 生成答案
        if is_correct:
            answer = question['correct_answer']
        else:
            answer = generate_ai_wrong_answer(
                question['correct_answer'],
                question['options']
            )

        async with session_factory() as db:
            battle = await db.get(PetBattle, battle_id)
            if battle is None or battle.status != "active":
                return      # 这场已经结束 / 被作废了,不用答了
            is_p2 = ai_player_id == battle.player2_id
            combo = battle.player2_combo if is_p2 else battle.player1_combo
            ultimate_charges = battle.player2_ultimate_charges if is_p2 else battle.player1_ultimate_charges

            # 判断是否使用必杀技
            use_ultimate = calculate_ai_ultimate_usage_chance(combo, ultimate_charges)

            # 提交AI答案
            await pet_battle_service.process_round_answer(
                db=db,
                battle_id=battle_id,
                player_id=ai_player_id,
                round_number=round_number,
                answer=answer,
                time_ms=answer_time_ms,
                use_ultimate=use_ultimate,
            )
        recorded = True
    except Exception as e:
        # 「已经答过题了」= 这一回合它的答案早就记上了(断过重新接上的那一回合),不是真出错
        print(f'AI答题失败: {e}')
    finally:
        # 记上了: 驱动循环不用再处理它;没记上: 驱动循环按「超时没答」给它补一条(已经记过的话那一步会被拒,不碍事)。
        # 这场已经没人连着、答案那份也清掉了的话就不存了(孩子中途走了,AI 的任务后醒来)
        if battle_id in manager.round_answers:
            manager.store_answer(battle_id, ai_player_id, {"round_number": round_number, "recorded": recorded})

    if recorded:
        # 通知答题接收
        try:
            await manager.broadcast(
                battle_id,
                WSAnswerReceived(player_id=ai_player_id, round_number=round_number).model_dump(mode="json"),
            )
        except Exception:
            pass
