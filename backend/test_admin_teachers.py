"""管理员端 API 端到端 - 仅当 ADMIN_TOKEN 环境变量存在时执行"""
import asyncio
import os
import httpx

BASE = "http://localhost:8000"


async def main():
    token = os.environ.get("ADMIN_TOKEN", "")
    if not token:
        print("SKIP: 设置 ADMIN_TOKEN 环境变量后再跑")
        return
    headers = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.get(f"{BASE}/api/v1/admin/teachers", headers=headers)
        assert r.status_code == 200, f"got {r.status_code}: {r.text}"
        data = r.json()
        assert isinstance(data, list)
        print(f"OK: GET /admin/teachers → {len(data)} 教师")

        r = await c.get(f"{BASE}/api/v1/admin/classes", headers=headers)
        assert r.status_code == 200, f"got {r.status_code}: {r.text}"
        print(f"OK: GET /admin/classes → {len(r.json())} 班级")
    print("\n=== ALL PASSED ===")


if __name__ == "__main__":
    asyncio.run(main())
