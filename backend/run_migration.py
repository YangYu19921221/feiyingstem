"""
数据库迁移脚本
运行方式: python run_migration.py
"""
import sqlite3
import os
from pathlib import Path

def run_migration():
    # 数据库文件路径
    db_path = Path(__file__).parent / "english_helper.db"

    # 迁移文件路径
    migration_file = Path(__file__).parent / "migrations" / "001_add_unit_and_progress_tables.sql"

    print(f"📊 数据库路径: {db_path}")
    print(f"📄 迁移文件: {migration_file}")

    if not migration_file.exists():
        print(f"❌ 迁移文件不存在: {migration_file}")
        return False

    # 读取迁移SQL
    with open(migration_file, 'r', encoding='utf-8') as f:
        migration_sql = f.read()

    try:
        # 连接数据库
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()

        print("\n开始执行迁移...")
        print("=" * 60)

        # 分割并执行SQL语句
        statements = [s.strip() for s in migration_sql.split(';') if s.strip()]

        for i, statement in enumerate(statements, 1):
            # 跳过注释
            if statement.startswith('--') or not statement:
                continue

            try:
                cursor.execute(statement)

                # 提取表名用于显示
                if 'CREATE TABLE' in statement.upper():
                    table_name = statement.split('CREATE TABLE IF NOT EXISTS')[1].split('(')[0].strip()
                    print(f"✅ [{i}/{len(statements)}] 创建表: {table_name}")
                elif 'CREATE INDEX' in statement.upper():
                    index_name = statement.split('CREATE INDEX IF NOT EXISTS')[1].split('ON')[0].strip()
                    print(f"✅ [{i}/{len(statements)}] 创建索引: {index_name}")
                else:
                    print(f"✅ [{i}/{len(statements)}] 执行成功")

            except sqlite3.Error as e:
                print(f"⚠️  [{i}/{len(statements)}] 执行出错 (可能表已存在): {e}")

        # 提交更改
        conn.commit()
        print("=" * 60)
        print("\n✅ 迁移完成!")

        # 显示所有表
        print("\n📋 当前数据库表列表:")
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        tables = cursor.fetchall()
        for table in tables:
            print(f"  - {table[0]}")

        print(f"\n📊 总共 {len(tables)} 个表")

        # 关闭连接
        conn.close()
        return True

    except Exception as e:
        print(f"\n❌ 迁移失败: {e}")
        if conn:
            conn.close()
        return False

if __name__ == "__main__":
    print("🚀 开始数据库迁移...")
    print()

    success = run_migration()

    if success:
        print("\n✨ 迁移成功完成!")
        print("\n接下来可以:")
        print("  1. 启动后端服务: uvicorn app.main:app --reload")
        print("  2. 测试新增的表")
    else:
        print("\n❌ 迁移失败,请检查错误信息")
