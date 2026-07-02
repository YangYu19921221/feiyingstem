#!/bin/bash

# 宠物对战系统 - 快速测试脚本
# 用法: ./test_pet_battle.sh

echo "🎮 宠物对战系统 - 快速测试"
echo "================================"

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 切换到项目根目录
cd "$(dirname "$0")"

echo ""
echo "${YELLOW}📦 步骤1: 检查数据库迁移${NC}"
echo "================================"

if [ -f "backend/english_helper.db" ]; then
    echo "${GREEN}✓ 数据库文件存在${NC}"

    # 检查是否已迁移
    sqlite3 backend/english_helper.db "SELECT name FROM sqlite_master WHERE type='table' AND name='pet_battles';" > /tmp/check_result.txt

    if grep -q "pet_battles" /tmp/check_result.txt; then
        echo "${GREEN}✓ 对战表已存在${NC}"
    else
        echo "${YELLOW}⚠ 需要执行数据库迁移...${NC}"
        cd backend
        python3 migrations/migrate_pet_battle.py
        cd ..
        echo "${GREEN}✓ 数据库迁移完成${NC}"
    fi
else
    echo "${RED}✗ 数据库文件不存在，请先初始化数据库${NC}"
    exit 1
fi

echo ""
echo "${YELLOW}📦 步骤2: 检查测试用户${NC}"
echo "================================"

# 查询是否有测试用户
USER_COUNT=$(sqlite3 backend/english_helper.db "SELECT COUNT(*) FROM users WHERE username IN ('student1', 'student2');")

if [ "$USER_COUNT" -ge 2 ]; then
    echo "${GREEN}✓ 测试用户已存在 (student1, student2)${NC}"
else
    echo "${YELLOW}⚠ 创建测试用户...${NC}"

    # 创建测试用户SQL
    sqlite3 backend/english_helper.db <<EOF
INSERT OR IGNORE INTO users (username, hashed_password, role, nickname) VALUES
('student1', '\$2b\$12\$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5ztQjL4jUxQoS', 'student', '学生1'),
('student2', '\$2b\$12\$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5ztQjL4jUxQoS', 'student', '学生2');
EOF

    # 为测试用户创建宠物
    sqlite3 backend/english_helper.db <<EOF
INSERT OR IGNORE INTO user_pets (user_id, name, species, level, experience, happiness, hunger, evolution_stage, food_balance)
SELECT id, '皮卡丘', 'pikachu', 10, 500, 80, 70, 2, 50 FROM users WHERE username = 'student1';

INSERT OR IGNORE INTO user_pets (user_id, name, species, level, experience, happiness, hunger, evolution_stage, food_balance)
SELECT id, '杰尼龟', 'squirtle', 8, 300, 75, 65, 1, 40 FROM users WHERE username = 'student2';
EOF

    echo "${GREEN}✓ 测试用户创建完成${NC}"
fi

# 获取用户ID
STUDENT1_ID=$(sqlite3 backend/english_helper.db "SELECT id FROM users WHERE username='student1';")
STUDENT2_ID=$(sqlite3 backend/english_helper.db "SELECT id FROM users WHERE username='student2';")

echo ""
echo "${GREEN}测试账号信息:${NC}"
echo "  学生1: username=student1, password=123456, ID=$STUDENT1_ID"
echo "  学生2: username=student2, password=123456, ID=$STUDENT2_ID"

echo ""
echo "${YELLOW}📦 步骤3: 准备测试单词数据${NC}"
echo "================================"

# 检查是否有足够的单词
WORD_COUNT=$(sqlite3 backend/english_helper.db "SELECT COUNT(*) FROM words;")

if [ "$WORD_COUNT" -ge 10 ]; then
    echo "${GREEN}✓ 单词数据充足 ($WORD_COUNT 个)${NC}"
else
    echo "${RED}✗ 单词数据不足，需要至少10个单词才能进行对战${NC}"
    echo "  请运行: cd backend && python seed_data.py"
    exit 1
fi

echo ""
echo "${YELLOW}🚀 步骤4: 启动说明${NC}"
echo "================================"

echo ""
echo "${GREEN}现在你可以:${NC}"
echo ""
echo "1️⃣  启动后端服务:"
echo "   ${YELLOW}cd backend && uvicorn app.main:app --reload${NC}"
echo ""
echo "2️⃣  启动前端服务 (新终端):"
echo "   ${YELLOW}cd frontend && npm run dev${NC}"
echo ""
echo "3️⃣  打开两个浏览器窗口测试对战:"
echo ""
echo "   ${GREEN}浏览器1 (学生1):${NC}"
echo "   - 访问 http://localhost:5173"
echo "   - 登录: student1 / 123456"
echo "   - 进入"我的宠物" → 点击"⚔️ 对战""
echo "   - 发起挑战,输入对手ID: ${YELLOW}$STUDENT2_ID${NC}"
echo ""
echo "   ${GREEN}浏览器2 (学生2):${NC}"
echo "   - 访问 http://localhost:5173 (无痕模式)"
echo "   - 登录: student2 / 123456"
echo "   - 进入"我的宠物" → 点击"⚔️ 对战""
echo "   - 接受挑战,开始对战！"
echo ""
echo "${GREEN}🎮 对战玩法:${NC}"
echo "  - 每回合15秒答题"
echo "  - 答对攻击对手,答错扣自己血"
echo "  - 连续答对3题解锁必杀技"
echo "  - 10回合结束或HP归零"
echo "  - 获得粮食和经验奖励"
echo ""
echo "${YELLOW}📚 更多文档: docs/宠物对战系统-Phase1-完成.md${NC}"
echo ""
