"""数据库迁移 - 添加宠物治疗系统"""
import asyncio
import sqlite3
from pathlib import Path


async def migrate():
    """执行数据库迁移"""
    db_path = Path(__file__).parent.parent / "english_helper.db"

    if not db_path.exists():
        print(f"❌ 数据库文件不存在: {db_path}")
        return False

    print(f"📦 开始迁移数据库: {db_path}")

    # 读取SQL文件
    sql_file = Path(__file__).parent / "add_pet_healing_system.sql"
    if not sql_file.exists():
        print(f"❌ SQL文件不存在: {sql_file}")
        return False

    with open(sql_file, "r", encoding="utf-8") as f:
        sql_script = f.read()

    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        # 检查字段是否已存在
        cursor.execute("PRAGMA table_info(user_pets);")
        columns = [row[1] for row in cursor.fetchall()]

        if 'current_hp' in columns:
            print("⚠️  current_hp 字段已存在，跳过迁移")
            conn.close()
            return True

        try:
            cursor.executescript(sql_script)
            print("✅ SQL脚本执行完成")
        except sqlite3.OperationalError as e:
            if "duplicate column" in str(e).lower():
                print(f"⚠️  字段已存在，跳过: {e}")
            else:
                raise

        conn.commit()
        conn.close()

        print("✅ 宠物治疗系统迁移完成!")
        return True

    except Exception as e:
        print(f"❌ 迁移失败: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    success = asyncio.run(migrate())
    exit(0 if success else 1)
