"""测试竞赛题目API"""
import requests
import json

BASE_URL = "http://localhost:8000"

# 1. 登录获取token
print("=== 1. 登录 ===")
login_response = requests.post(
    f"{BASE_URL}/api/v1/auth/login/json",
    json={"username": "test_teacher", "password": "teacher123"}
)
login_data = login_response.json()
token = login_data["access_token"]
print(f"登录成功! Token: {token[:50]}...")

headers = {"Authorization": f"Bearer {token}"}

# 2. 创建题目
print("\n=== 2. 创建竞赛题目 ===")
create_data = {
    "question_type": "choice",
    "title": "选择题测试",
    "content": "The word 'happy' means ___",
    "correct_answer": '{"answer": "A"}',
    "answer_explanation": "happy表示快乐的",
    "difficulty": "easy",
    "source": "manual",
    "options": [
        {"option_key": "A", "option_text": "快乐的", "is_correct": True, "display_order": 1},
        {"option_key": "B", "option_text": "悲伤的", "is_correct": False, "display_order": 2},
        {"option_key": "C", "option_text": "生气的", "is_correct": False, "display_order": 3},
        {"option_key": "D", "option_text": "害怕的", "is_correct": False, "display_order": 4}
    ]
}

create_response = requests.post(
    f"{BASE_URL}/api/v1/teacher/competition-questions",
    headers=headers,
    json=create_data
)
print(f"状态码: {create_response.status_code}")
if create_response.status_code == 200:
    question = create_response.json()
    question_id = question["id"]
    print(f"创建成功! 题目ID: {question_id}")
    print(json.dumps(question, ensure_ascii=False, indent=2))
else:
    print(f"创建失败: {create_response.text}")
    exit(1)

# 3. 获取题目列表
print("\n=== 3. 获取题目列表 ===")
list_response = requests.get(
    f"{BASE_URL}/api/v1/teacher/competition-questions",
    headers=headers
)
print(f"状态码: {list_response.status_code}")
if list_response.status_code == 200:
    list_data = list_response.json()
    print(f"总题目数: {list_data['total']}")
    print(f"返回题目数: {len(list_data['questions'])}")
else:
    print(f"获取失败: {list_response.text}")

# 4. 获取单个题目详情
print(f"\n=== 4. 获取题目详情 (ID: {question_id}) ===")
detail_response = requests.get(
    f"{BASE_URL}/api/v1/teacher/competition-questions/{question_id}",
    headers=headers
)
print(f"状态码: {detail_response.status_code}")
if detail_response.status_code == 200:
    detail = detail_response.json()
    print(json.dumps(detail, ensure_ascii=False, indent=2))
else:
    print(f"获取失败: {detail_response.text}")

# 5. 获取统计信息
print("\n=== 5. 获取统计信息 ===")
stats_response = requests.get(
    f"{BASE_URL}/api/v1/teacher/competition-questions/statistics/overview",
    headers=headers
)
print(f"状态码: {stats_response.status_code}")
if stats_response.status_code == 200:
    stats = stats_response.json()
    print(json.dumps(stats, ensure_ascii=False, indent=2))
else:
    print(f"获取失败: {stats_response.text}")

print("\n=== 测试完成 ===")
