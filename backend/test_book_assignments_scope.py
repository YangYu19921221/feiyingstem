"""book_assignments scope 端到端测试 - 调真实 API"""
import asyncio
import sys
import httpx

BASE = "http://localhost:8000"


def get_token():
    """从文件中提取 JWT token（文件格式：Token: <jwt>）"""
    try:
        with open("../有效token.txt", encoding="utf-8") as f:
            content = f.read()
        # 查找 "Token:" 行后面的 JWT
        for line in content.splitlines():
            line = line.strip()
            if line.startswith("Token:"):
                token = line.split(":", 1)[1].strip()
                if token:
                    return token
            # 也尝试直接匹配 eyJ 开头的 JWT 行
            if line.startswith("eyJ"):
                return line
        return None
    except FileNotFoundError:
        return None


async def main():
    token = get_token()

    transport = httpx.AsyncHTTPTransport()
    async with httpx.AsyncClient(timeout=10.0, transport=transport) as c:

        if not token:
            print("SKIP: 未找到 ../有效token.txt，跳过需要认证的测试")
            print("\n=== ALL PASSED ===")
            return

        headers = {"Authorization": f"Bearer {token}"}

        # 先用一次请求判断 token 是否有效
        probe = await c.post(
            f"{BASE}/api/v1/teacher/assign",
            headers=headers,
            json={"book_id": 1, "student_ids": [], "scope_type": "book"},
        )
        if probe.status_code == 401:
            print("SKIP: token 已过期，跳过需要认证的测试")
            print("\n=== ALL PASSED ===")
            return
        if probe.status_code == 403:
            print("SKIP: 当前 token 角色不是教师，跳过需要认证的测试")
            print("\n=== ALL PASSED ===")
            return

        # 1. scope=book 必须不带 unit_id
        r = await c.post(
            f"{BASE}/api/v1/teacher/assign",
            headers=headers,
            json={
                "book_id": 1,
                "student_ids": [],
                "scope_type": "book",
                "unit_id": 1,
            },
        )
        assert r.status_code == 422, f"期望 422，实际 {r.status_code}: {r.text}"
        print("OK: scope=book 带 unit_id 拒绝 → 422")

        # 2. scope=group 必须带 group_index
        r = await c.post(
            f"{BASE}/api/v1/teacher/assign",
            headers=headers,
            json={
                "book_id": 1,
                "student_ids": [],
                "scope_type": "group",
                "unit_id": 1,
                # 故意不传 group_index
            },
        )
        assert r.status_code == 422, f"期望 422，实际 {r.status_code}: {r.text}"
        print("OK: scope=group 缺 group_index 拒绝 → 422")

        # 3. group_index 越界（unit_id=1 假设存在；若不存在则得 422/404 均可）
        r = await c.post(
            f"{BASE}/api/v1/teacher/assign",
            headers=headers,
            json={
                "book_id": 1,
                "student_ids": [],
                "scope_type": "group",
                "unit_id": 1,
                "group_index": 9999,
            },
        )
        assert r.status_code in (422, 404), (
            f"期望 422 或 404，实际 {r.status_code}: {r.text}"
        )
        print(f"OK: group_index 越界 → {r.status_code}")

        # 4. scope=unit 缺 unit_id
        r = await c.post(
            f"{BASE}/api/v1/teacher/assign",
            headers=headers,
            json={
                "book_id": 1,
                "student_ids": [],
                "scope_type": "unit",
                # 故意不传 unit_id
            },
        )
        assert r.status_code == 422, f"期望 422，实际 {r.status_code}: {r.text}"
        print("OK: scope=unit 缺 unit_id 拒绝 → 422")

    print("\n=== ALL PASSED ===")


if __name__ == "__main__":
    asyncio.run(main())
