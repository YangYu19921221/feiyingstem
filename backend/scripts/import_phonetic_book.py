"""把审定过的音标教材 Excel 导入音标填空题库

用法:
    ./venv/bin/python scripts/import_phonetic_book.py <xlsx> --name "飞鹰英语专用教材第1册"

Excel 格式与整本导入一致(每个 sheet 一节,列:单词/音标/释义),
但**音标这一列是答案**而不是展示内容 —— 学生做题时括号是空的。

音标切成 token 数组存。三处写法不一致(视频教 [ei]、教材印 [eɪ]、词库存 /eɪ/)
在这里统一归一,是唯一的入口。切不出来的符号会报错中止,不静默放过。

--replace(2026-11-05 起): 和网页导入同一套原地改(services/phonetic_book_write) ——
书 id、同编号的节、同一节里同一个单词的题 id 都不变,学生记录、挂在下面的听力和作业都还在;
Excel 里没有的节 / 题删掉。以前是整本删了重建,所有 id 全换。
先加 --dry-run 看会改什么,不写库。
"""
import argparse
import asyncio
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from openpyxl import load_workbook
from sqlalchemy import func, select

from app.core.database import AsyncSessionLocal
# phonetic_lessons.video_id 外键指向 phonetic_videos,不 import 它
# SQLAlchemy 解析外键时找不到目标表会报 NoReferencedTableError
from app.models import phonetic  # noqa: F401
from app.models import user  # noqa: F401  (created_by → users.id)
from app.models.phonetic_practice import (
    PhoneticBook, PhoneticLesson, PhoneticItem,
)
from app.services.phonetic_book_write import norm_word, write_book  # noqa: E402

# 音标切分逻辑在 app/services/phonetic_tokenize.py —— **唯一真源**,
# 教师端上传(api/v1/teacher/phonetic_books.py)与本脚本共用同一份。
# 曾经只有这里有一份,加教师端上传时抽了出去;不要在这里再复制一份,
# 两份归一规则漂移的后果是学生做不对的死题(切出键盘上没有的音素)。
from app.services.phonetic_tokenize import (  # noqa: E402
    VOWELS, check_item, check_tts_text, lesson_highlight, normalize, tokenize,
)


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('xlsx')
    ap.add_argument('--name', required=True)
    ap.add_argument('--volume', default=None)
    ap.add_argument('--replace', action='store_true',
                    help='同名教材按 Excel 原地改(题目 id、学生记录、听力都保留)')
    ap.add_argument('--dry-run', action='store_true', help='只看会改什么,不写库')
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
        # 「发音」列可选(2026-10-30): 标准音按它读,与网页上传同一个校验
        ci_t = hdr.index('发音') if '发音' in hdr else None

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
            tts, terr = check_tts_text(r[ci_t] if ci_t is not None else None)
            if terr:
                errors.append(f"  {sheet} 的 {word} {terr}")
                continue
            items.append(dict(
                word=word,
                meaning=(str(r[ci_m]).strip() if ci_m is not None and r[ci_m] else None),
                answer=toks, core=core, tts_text=tts,
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
        # 只认平台预置(org_id NULL)的同名书: 这个脚本导入的就是平台预置,机构自己的同名书不碰
        old = (await db.execute(
            select(PhoneticBook).where(PhoneticBook.name == args.name, PhoneticBook.org_id.is_(None))
            .execution_options(skip_tenant_filter=True)
        )).scalars().first()
        if old and not args.replace:
            print(f"!! 已存在同名教材(id={old.id}),要按 Excel 改它请加 --replace(先加 --dry-run 看看)")
            sys.exit(1)

        if old:
            # 先算会改什么,给人看清楚再写
            old_ls = {ls.code: ls for ls in (await db.execute(
                select(PhoneticLesson).where(PhoneticLesson.book_id == old.id))).scalars()}
            kept = changed = 0
            for p in parsed:
                ls = old_ls.get(p['code'])
                if ls is None:
                    continue
                words = [norm_word(w) for w in (await db.execute(
                    select(PhoneticItem.word).where(PhoneticItem.lesson_id == ls.id))).scalars()]
                pool = list(words)
                for it in p['items']:
                    k = norm_word(it['word'])
                    if k in pool:
                        pool.remove(k)
                        kept += 1
                    else:
                        changed += 1
            new_codes = [p['code'] for p in parsed if p['code'] not in old_ls]
            gone_codes = [c for c in old_ls if c not in {p['code'] for p in parsed}]
            n_old = (await db.execute(
                select(func.count(PhoneticItem.id)).join(PhoneticLesson, PhoneticLesson.id == PhoneticItem.lesson_id)
                .where(PhoneticLesson.book_id == old.id))).scalar() or 0
            print(f"覆盖 id={old.id}「{old.name}」: 原来 {len(old_ls)} 节 {n_old} 题")
            print(f"  保留原题(id 不变) {kept} 题;新加 {changed} 题;删掉 {n_old - kept} 题")
            print(f"  新加的节 {new_codes or '无'};删掉的节 {gone_codes or '无'}")

        if args.dry_run:
            print("--dry-run: 没有写库")
            return

        for p in parsed:
            p['items'] = [dict(it, id=None) for it in p['items']]
        book, total = await write_book(
            db, existing=old, name=args.name, volume=args.volume, description=None,
            org_id=None, created_by=None, lessons=parsed)
        await db.commit()
        print(f"{'覆盖' if old else '导入'}完成:book_id={book.id}  {len(parsed)} 节  {total} 题")

if __name__ == '__main__':
    asyncio.run(main())
