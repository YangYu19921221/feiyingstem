"""执行 011 迁移:去掉 words.word UNIQUE 约束。
运行方式: python run_migration_011.py
"""
import sqlite3
from pathlib import Path


def run():
    db_path = Path(__file__).parent / "english_helper.db"
    sql_path = Path(__file__).parent / "migrations" / "011_drop_word_unique.sql"

    if not db_path.exists():
        print(f"❌ 数据库不存在: {db_path}")
        return False
    if not sql_path.exists():
        print(f"❌ 迁移文件不存在: {sql_path}")
        return False

    sql = sql_path.read_text(encoding="utf-8")

    conn = sqlite3.connect(db_path)
    try:
        # 整段一次性执行,因为是单事务
        conn.executescript(sql)
        conn.commit()
        print("✅ 011 迁移执行成功")

        # 校验
        cur = conn.cursor()
        cur.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='words'")
        table_sql = cur.fetchone()[0]
        if "UNIQUE" in table_sql.upper().split("(", 1)[0] or "word VARCHAR(100) UNIQUE" in table_sql:
            print(f"⚠️  仍能在表 DDL 中看到 UNIQUE:\n{table_sql}")
            return False
        print(f"📋 当前 words 表 DDL:\n{table_sql}")
        return True
    except sqlite3.Error as e:
        print(f"❌ 迁移失败: {e}")
        conn.rollback()
        return False
    finally:
        conn.close()


if __name__ == "__main__":
    print("🚀 开始执行 011 迁移...")
    ok = run()
    print("✨ 成功" if ok else "💥 失败")
