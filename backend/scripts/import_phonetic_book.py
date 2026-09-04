"""把审定过的音标教材 Excel 导入音标填空题库

用法:
    ./venv/bin/python scripts/import_phonetic_book.py <xlsx> --name "飞鹰英语专用教材第1册"

Excel 格式与整本导入一致(每个 sheet 一节,列:单词/音标/释义),
但**音标这一列是答案**而不是展示内容 —— 学生做题时括号是空的。

音标切成 token 数组存。三处写法不一致(视频教 [ei]、教材印 [eɪ]、词库存 /eɪ/)
在这里统一归一,是唯一的入口。切不出来的符号会报错中止,不静默放过。
"""
import argparse
import asyncio
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from openpyxl import load_workbook
from sqlalchemy import select, delete

from app.core.database import AsyncSessionLocal
# phonetic_lessons.video_id 外键指向 phonetic_videos,不 import 它
# SQLAlchemy 解析外键时找不到目标表会报 NoReferencedTableError
from app.models import phonetic  # noqa: F401
from app.models import user  # noqa: F401  (created_by → users.id)
from app.models.phonetic_practice import (
    PhoneticBook, PhoneticLesson, PhoneticItem,
)

# 音标切分逻辑在 app/services/phonetic_tokenize.py —— **唯一真源**,
# 教师端上传(api/v1/teacher/phonetic_books.py)与本脚本共用同一份。
# 曾经只有这里有一份,加教师端上传时抽了出去;不要在这里再复制一份,
# 两份归一规则漂移的后果是学生做不对的死题(切出键盘上没有的音素)。
from app.services.phonetic_tokenize import (  # noqa: E402
    VOWELS, check_item, lesson_highlight, normalize, tokenize,
)


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('xlsx')
    ap.add_argument('--name', required=True)
    ap.add_argument('--volume', default=None)
    ap.add_argument('--replace', action='store_true', help='同名教材先删掉再导')
    args = ap.parse_args()

    wb = load_workbook(args.xlsx, data_only=True)
    # 先全部解析并校验,有问题就中止 —— 不要导一半留个残缺的教材在库里
    parsed, errors = [], []
    for sheet in wb.sheetnames:
        ws = wb[sheet]
        hdr = [str(c.value or '').strip() for c in ws[1]]
        try:
            ci_w = hdr.index('单词')
            ci_p = hdr.index('音标')
        except ValueError:
            print(f"  跳过 sheet「{sheet}」:没有 单词/音标 列")
            continue
        ci_m = hdr.index('释义') if '释义' in hdr else None

        m = re.match(r'^([\d]+[—\-][\d]+)', sheet)
        code = m.group(1).replace('-', '—') if m else sheet
        rm = re.search(r'已剔(\d+)词', sheet)

        items = []
        for r in ws.iter_rows(min_row=2, values_only=True):
            if not r or not r[ci_w] or not r[ci_p]:
                continue
            word = str(r[ci_w]).strip()
            toks, unk = tokenize(str(r[ci_p]))
            if unk:
                errors.append(f"  {sheet} 的 {word} 音标含键盘上没有的符号 {unk} —— "
                              f"原文 {r[ci_p]!r}")
                continue
            if not toks:
                errors.append(f"  {sheet} 的 {word} 音标切不出音素:{r[ci_p]!r}")
                continue
            core = [i for i, t in enumerate(toks) if t in VOWELS]
            if not core:
                errors.append(f"  {sheet} 的 {word} 切不出元音,第二遍无法挖空:{toks}")
                continue
            items.append(dict(
                word=word,
                meaning=(str(r[ci_m]).strip() if ci_m is not None and r[ci_m] else None),
                answer=toks, core=core,
            ))
        if items:
            # 这一节教什么:出现 3 次以上的元音,给键盘做高亮
            from collections import Counter
            vc = Counter(t for it in items for t in it['answer'] if t in VOWELS)
            parsed.append(dict(
                code=code, title=sheet, items=items,
                removed=int(rm.group(1)) if rm else 0,
                highlight=[t for t, n in vc.most_common(4) if n >= 3],
            ))

    if errors:
        print(f"!! {len(errors)} 条有问题,已中止(没有写库):")
        for e in errors[:20]:
            print(e)
        sys.exit(1)
    if not parsed:
        print("!! 没解析出任何小节")
        sys.exit(1)

    total = sum(len(p['items']) for p in parsed)
    print(f"解析 {len(parsed)} 节 / {total} 题,音标全部切开且都有元音可挖")

    async with AsyncSessionLocal() as db:
        old = (await db.execute(
            select(PhoneticBook).where(PhoneticBook.name == args.name)
            .execution_options(skip_tenant_filter=True)
        )).scalar_one_or_none()
        if old:
            if not args.replace:
                print(f"!! 已存在同名教材(id={old.id}),要覆盖请加 --replace")
                sys.exit(1)
            ls_ids = [r[0] for r in await db.execute(
                select(PhoneticLesson.id).where(PhoneticLesson.book_id == old.id))]
            if ls_ids:
                await db.execute(delete(PhoneticItem).where(
                    PhoneticItem.lesson_id.in_(ls_ids)))
            await db.execute(delete(PhoneticLesson).where(
                PhoneticLesson.book_id == old.id))
            await db.delete(old)
            await db.flush()
            print(f"已删除旧的同名教材 id={old.id}")

        book = PhoneticBook(name=args.name, volume=args.volume, org_id=None)
        db.add(book)
        await db.flush()

        for n, p in enumerate(parsed, 1):
            ls = PhoneticLesson(
                book_id=book.id, code=p['code'], title=p['title'],
                lesson_number=n, removed_count=p['removed'],
                highlight_json=json.dumps(p['highlight'], ensure_ascii=False),
            )
            db.add(ls)
            await db.flush()
            for oi, it in enumerate(p['items']):
                db.add(PhoneticItem(
                    lesson_id=ls.id, word=it['word'], meaning=it['meaning'],
                    answer_json=json.dumps(it['answer'], ensure_ascii=False),
                    answer_display=f"[{''.join(it['answer'])}]",
                    core_indexes_json=json.dumps(it['core']),
                    order_index=oi,
                ))
        await db.commit()
        print(f"导入完成:book_id={book.id}  {len(parsed)} 节  {total} 题")


if __name__ == '__main__':
    asyncio.run(main())
