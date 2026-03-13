"""
简单的WebSocket测试 - 不使用代理
"""
import asyncio
import websockets
import json

async def test_connection():
    token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIiwidXNlcm5hbWUiOiJzdHVkZW50IiwiZXhwIjoxNzY0MzA1NTMwfQ.v_7jK49pWneQsia0zi6bhOLowDM2hlKkSdTsNq1BdIQ"
    uri = f"ws://127.0.0.1:8000/api/v1/competition/ws/competition?token={token}&season_id=1"

    print(f"连接: {uri}")

    try:
        async with websockets.connect(uri) as ws:
            print("✅ 连接成功!")

            # 接收消息
            msg = await asyncio.wait_for(ws.recv(), timeout=5)
            print(f"收到: {msg}")

            data = json.loads(msg)
            print(f"类型: {data.get('type')}")

    except asyncio.TimeoutError:
        print("❌ 超时")
    except Exception as e:
        print(f"❌ 错误: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_connection())
