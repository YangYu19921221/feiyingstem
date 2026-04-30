"""学生监控 API 端到端"""
import asyncio, httpx, os
# 清除代理环境变量避免 SOCKS 代理干扰本地测试
for _k in ("ALL_PROXY", "all_proxy", "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"):
    os.environ.pop(_k, None)
BASE = "http://localhost:8000"

def get_token():
    try:
        with open("../有效token.txt") as f: return f.read().strip().split()[0]
    except FileNotFoundError:
        return ""

async def main():
    token = get_token()
    if not token:
        print("SKIP: no token file")
        return
    headers = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.get(f"{BASE}/api/v1/teacher/students/99999999/groups",
                        headers=headers)
        assert r.status_code in (403, 404, 401), f"got {r.status_code}: {r.text}"
        print(f"OK: 非本班/无效学生 returned {r.status_code}")
    print("\n=== ALL PASSED ===")

if __name__ == "__main__":
    asyncio.run(main())
