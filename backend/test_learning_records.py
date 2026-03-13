#!/usr/bin/env python3
"""
测试学习记录API
"""
import requests
import json

BASE_URL = "http://localhost:8000"

def test_learning_records():
    print("=" * 60)
    print("测试学习记录API")
    print("=" * 60)

    # 1. 登录获取token
    print("\n1. 登录学生账号...")
    login_response = requests.post(
        f"{BASE_URL}/api/v1/auth/login/json",
        json={"username": "student", "password": "123456"}
    )
    if login_response.status_code != 200:
        print(f"❌ 登录失败: {login_response.text}")
        return

    token = login_response.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    print(f"✅ 登录成功,token: {token[:50]}...")

    # 2. 创建学习记录
    print("\n2. 创建学习记录...")
    records_data = {
        "unit_id": 1,
        "learning_mode": "flashcard",
        "records": [
            {"word_id": 1, "is_correct": True, "time_spent": 3000, "learning_mode": "flashcard"},
            {"word_id": 2, "is_correct": True, "time_spent": 2500, "learning_mode": "flashcard"},
            {"word_id": 3, "is_correct": False, "time_spent": 5000, "learning_mode": "flashcard"}
        ]
    }

    response = requests.post(
        f"{BASE_URL}/api/v1/student/records",
        json=records_data,
        headers=headers
    )
    if response.status_code == 200:
        result = response.json()
        print(f"✅ 学习记录创建成功:")
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(f"❌ 创建失败: {response.text}")
        return

    # 3. 创建学习会话
    print("\n3. 创建学习会话...")
    session_response = requests.post(
        f"{BASE_URL}/api/v1/student/sessions",
        json={"unit_id": 1, "learning_mode": "flashcard"},
        headers=headers
    )
    if session_response.status_code == 200:
        session = session_response.json()
        session_id = session["id"]
        print(f"✅ 学习会话创建成功, ID: {session_id}")
    else:
        print(f"❌ 创建会话失败: {session_response.text}")
        return

    # 4. 更新学习会话
    print("\n4. 更新学习会话...")
    update_response = requests.put(
        f"{BASE_URL}/api/v1/student/sessions/{session_id}",
        json={
            "session_id": session_id,
            "words_studied": 3,
            "correct_count": 2,
            "wrong_count": 1,
            "time_spent": 10
        },
        headers=headers
    )
    if update_response.status_code == 200:
        print(f"✅ 学习会话更新成功")
        print(json.dumps(update_response.json(), ensure_ascii=False, indent=2))
    else:
        print(f"❌ 更新会话失败: {update_response.text}")

    # 5. 查询单词掌握度
    print("\n5. 查询单词掌握度...")
    mastery_response = requests.get(
        f"{BASE_URL}/api/v1/student/mastery/1",
        headers=headers
    )
    if mastery_response.status_code == 200:
        print(f"✅ 单词掌握度查询成功:")
        print(json.dumps(mastery_response.json(), ensure_ascii=False, indent=2))
    else:
        print(f"❌ 查询掌握度失败: {mastery_response.text}")

    # 6. 查询薄弱单词
    print("\n6. 查询薄弱单词...")
    weak_response = requests.get(
        f"{BASE_URL}/api/v1/student/weak-words?limit=5",
        headers=headers
    )
    if weak_response.status_code == 200:
        weak_words = weak_response.json()
        print(f"✅ 查询到 {len(weak_words)} 个薄弱单词")
        for word in weak_words[:3]:
            print(f"  - 单词ID: {word['word_id']}, 掌握度: {word['mastery_level']}/5")
    else:
        print(f"❌ 查询薄弱单词失败: {weak_response.text}")

    print("\n" + "=" * 60)
    print("测试完成!")
    print("=" * 60)


if __name__ == "__main__":
    test_learning_records()
