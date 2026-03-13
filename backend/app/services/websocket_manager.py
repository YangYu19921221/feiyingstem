"""
WebSocket连接管理器 - 实时推送排名变化
"""
from fastapi import WebSocket
from typing import Dict, List, Set
import json
import asyncio
from datetime import datetime


class ConnectionManager:
    """WebSocket连接管理"""

    def __init__(self):
        # 存储活跃连接: {user_id: WebSocket}
        self.active_connections: Dict[int, WebSocket] = {}

        # 按赛季分组的连接: {season_id: Set[user_id]}
        self.season_connections: Dict[int, Set[int]] = {}

        # 心跳任务
        self.heartbeat_tasks: Dict[int, asyncio.Task] = {}

    async def connect(self, websocket: WebSocket, user_id: int, season_id: int = 1):
        """建立WebSocket连接"""
        await websocket.accept()

        # 如果用户已有连接,先断开旧连接
        if user_id in self.active_connections:
            await self.disconnect(user_id)

        self.active_connections[user_id] = websocket

        # 加入赛季组
        if season_id not in self.season_connections:
            self.season_connections[season_id] = set()
        self.season_connections[season_id].add(user_id)

        # 启动心跳任务
        self.heartbeat_tasks[user_id] = asyncio.create_task(
            self._heartbeat(user_id, websocket)
        )

        print(f"✅ 用户 {user_id} 已连接 WebSocket (赛季 {season_id})")

    async def disconnect(self, user_id: int):
        """断开WebSocket连接"""
        if user_id in self.active_connections:
            # 取消心跳任务
            if user_id in self.heartbeat_tasks:
                self.heartbeat_tasks[user_id].cancel()
                del self.heartbeat_tasks[user_id]

            # 从所有赛季组中移除
            for season_id in self.season_connections:
                self.season_connections[season_id].discard(user_id)

            # 移除连接
            del self.active_connections[user_id]
            print(f"❌ 用户 {user_id} 已断开 WebSocket")

    async def send_personal_message(self, message: dict, user_id: int):
        """发送个人消息"""
        if user_id in self.active_connections:
            try:
                websocket = self.active_connections[user_id]
                await websocket.send_json(message)
            except Exception as e:
                print(f"发送消息失败给用户 {user_id}: {e}")
                await self.disconnect(user_id)

    async def broadcast(self, message: dict, season_id: int = 1, exclude_user: int = None):
        """向赛季内所有用户广播消息"""
        if season_id not in self.season_connections:
            return

        disconnected_users = []

        for user_id in self.season_connections[season_id]:
            # 排除指定用户
            if exclude_user and user_id == exclude_user:
                continue

            if user_id in self.active_connections:
                try:
                    await self.active_connections[user_id].send_json(message)
                except Exception as e:
                    print(f"广播消息失败给用户 {user_id}: {e}")
                    disconnected_users.append(user_id)

        # 清理断开的连接
        for user_id in disconnected_users:
            await self.disconnect(user_id)

    async def broadcast_rank_update(self, rank_data: dict, season_id: int = 1):
        """广播排名更新"""
        message = {
            "type": "rank_update",
            "data": rank_data,
            "timestamp": datetime.now().isoformat()
        }
        await self.broadcast(message, season_id)

    async def broadcast_leaderboard(self, leaderboard: list, season_id: int = 1):
        """广播完整排行榜"""
        message = {
            "type": "leaderboard_update",
            "data": {
                "rankings": leaderboard,
                "total": len(leaderboard)
            },
            "timestamp": datetime.now().isoformat()
        }
        await self.broadcast(message, season_id)

    async def notify_user_overtaken(self, overtaken_user_id: int, overtaker_name: str, new_rank: int):
        """通知用户被超越"""
        message = {
            "type": "overtaken",
            "data": {
                "overtaker_name": overtaker_name,
                "new_rank": new_rank,
                "message": f"你被 {overtaker_name} 超越了!当前排名 #{new_rank}"
            },
            "timestamp": datetime.now().isoformat()
        }
        await self.send_personal_message(message, overtaken_user_id)

    async def notify_user_overtake(self, user_id: int, overtaken_name: str, new_rank: int):
        """通知用户超越了别人"""
        message = {
            "type": "overtake",
            "data": {
                "overtaken_name": overtaken_name,
                "new_rank": new_rank,
                "message": f"🎉 你超越了 {overtaken_name}!当前排名 #{new_rank}"
            },
            "timestamp": datetime.now().isoformat()
        }
        await self.send_personal_message(message, user_id)

    async def notify_combo_milestone(self, user_id: int, combo: int, multiplier: float):
        """通知连击里程碑"""
        message = {
            "type": "combo_milestone",
            "data": {
                "combo": combo,
                "multiplier": multiplier,
                "message": f"🔥 {combo}连击达成!积分×{multiplier}倍!"
            },
            "timestamp": datetime.now().isoformat()
        }
        await self.send_personal_message(message, user_id)

    async def _heartbeat(self, user_id: int, websocket: WebSocket):
        """心跳检测,每30秒发送一次ping"""
        try:
            while True:
                await asyncio.sleep(30)
                if user_id in self.active_connections:
                    try:
                        await websocket.send_json({"type": "ping"})
                    except:
                        break
        except asyncio.CancelledError:
            pass

    def get_online_users_count(self, season_id: int = 1) -> int:
        """获取赛季在线人数"""
        if season_id not in self.season_connections:
            return 0
        return len(self.season_connections[season_id])

    def is_user_online(self, user_id: int) -> bool:
        """检查用户是否在线"""
        return user_id in self.active_connections


# 全局实例
websocket_manager = ConnectionManager()
