"""数据库迁移 - 添加宠物对战系统表"""
import asyncio
import sqlite3
from pathlib import Path


async def migrate():
    """执行数据库迁移"""
    # 数据库文件路径
    db_path = Path(__file__).parent.parent / "english_helper.db"

    if not db_path.exists():
        print(f"❌ 数据库文件不存在: {db_path}")
        return False

    print(f"📦 开始迁移数据库: {db_path}")

    # 读取SQL文件
    sql_file = Path(__file__).parent / "add_pet_battle_tables.sql"
    if not sql_file.exists():
        print(f"❌ SQL文件不存在: {sql_file}")
        return False

    with open(sql_file, "r", encoding="utf-8") as f:
        sql_script = f.read()

    # 执行迁移
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # 使用executescript执行整个脚本
        try:
            cursor.executescript(sql_script)
            print("✅ 所有SQL语句执行完成")
        except sqlite3.OperationalError as e:
            if "already exists" in str(e):
                print(f"⚠️  部分表已存在,跳过")
            else:
                raise

        conn.commit()
        conn.close()

        print("✅ 数据库迁移完成!")
        return True

    except Exception as e:
        print(f"❌ 迁移失败: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    success = asyncio.run(migrate())
    exit(0 if success else 1)
