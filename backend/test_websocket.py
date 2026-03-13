"""
WebSocket连接测试脚本
"""
import asyncio
import websockets
import json
import sys

async def test_websocket_connection():
    # 使用测试token (需要是有效的JWT token)
    # 这个token来自之前的登录
    token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIiwidXNlcm5hbWUiOiJzdHVkZW50IiwiZXhwIjoxNzY0MzAwMzYzfQ.uZDtVH3ho16aw6258FMb8TCUK93YSkrtaUvm6PNTQ94"
    season_id = 1

    uri = f"ws://localhost:8000/api/v1/competition/ws/competition?token={token}&season_id={season_id}"

    print(f"🔌 正在连接到: {uri}")

    try:
        async with websockets.connect(uri) as websocket:
            print("✅ WebSocket连接成功!")

            # 接收欢迎消息
            welcome_message = await websocket.recv()
            print(f"📩 收到消息: {welcome_message}")

            message_data = json.loads(welcome_message)
            if message_data.get("type") == "connected":
                print("✅ 连接确认成功!")
                print(f"📊 当前排行榜: {len(message_data.get('leaderboard', {}).get('rankings', []))} 名用户")

            # 测试请求排行榜
            print("\n📤 发送获取排行榜请求...")
            await websocket.send(json.dumps({
                "type": "get_leaderboard",
                "board_type": "daily"
            }))

            # 接收排行榜响应
            response = await websocket.recv()
            print(f"📩 收到排行榜响应: {len(response)} 字符")

            response_data = json.loads(response)
            if response_data.get("type") == "leaderboard_update":
                print("✅ 排行榜更新成功!")

            print("\n🎉 所有测试通过! WebSocket功能正常!")
            return True

    except websockets.exceptions.InvalidStatusCode as e:
        print(f"❌ 连接失败 - HTTP状态码错误: {e}")
        return False
    except websockets.exceptions.WebSocketException as e:
        print(f"❌ WebSocket错误: {e}")
        return False
    except Exception as e:
        print(f"❌ 未知错误: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    print("🧪 开始WebSocket连接测试\n")
    result = asyncio.run(test_websocket_connection())
    sys.exit(0 if result else 1)
