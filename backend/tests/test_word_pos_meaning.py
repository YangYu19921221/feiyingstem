"""词性 + 释义合在一起显示 / 上传一列「释义」(2026-11-08)

用户「分类中所有模块词性和释义都要显示,而且要显示一起,并且上传文档也需要改」。
规则在前端 frontend/src/utils/wordMeaning.ts(显示和 Excel 解析共用一份),
这里用前端自带的 esbuild 把它和 excelWords.parseWordRows 打成一个小脚本,丢给 node 跑。
没有 node / esbuild 的机器自动跳过。

锁住的几件事:
1. 库里三种写法都显示成「词性 释义」,释义里本来带词性的不再拼一遍(不能出现「n. n.书房」)
2. 「a good friend」这种以 a 开头的中文释义 / 短语不能被当成词性 a.
3. 新模板一列「释义」写「n. 苹果」→ 拆成 n. + 苹果;多词性整段留着不拆(拆了会丢第二个词性)
4. 老模板「词性」「释义」两列照样认
5. 导出 → 再导入,显示出来的文字不变
"""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

FRONT = Path(__file__).resolve().parents[2] / "frontend"
ESBUILD = FRONT / "node_modules" / ".bin" / "esbuild"

SCRIPT = r"""
import * as XLSX from 'xlsx';
import { parseWordRows } from '__F__/src/utils/excelWords';
import { posMeaning, posMeaningParts, splitPosMeaning, meaningHasPos } from '__F__/src/utils/wordMeaning';

const sheet = (rows: object[]) => XLSX.utils.sheet_to_json<Record<string, unknown>>(XLSX.utils.json_to_sheet(rows), { defval: '' });
const parsed = (rows: object[]) => {
  const r: any = parseWordRows(sheet(rows) as any);
  return (r.words || r).map((w: any) => [w.part_of_speech || '', w.meaning || '']);
};

const display = [
  { part_of_speech: 'n.', meaning: '英语' },
  { part_of_speech: '', meaning: 'n.书房；学习 v.学习；研究' },
  { part_of_speech: 'n.', meaning: 'n. 苹果' },
  { part_of_speech: '', meaning: '在周末' },
  { part_of_speech: '短语', meaning: '在周末' },
  { part_of_speech: 'v.', meaning: 'adj./adv. 快的；快地' },
  { part_of_speech: 'phr.', meaning: 'a good friend 好朋友' },
  { part_of_speech: '', meaning: 'modal v. 能；可以' },
  { part_of_speech: '', meaning: '' },
].map(w => posMeaning(w));

const parts = [
  posMeaningParts({ part_of_speech: 'n.', meaning: '英语' }),
  posMeaningParts({ part_of_speech: '', meaning: 'n.书房；学习 v.学习' }),
  posMeaningParts({ part_of_speech: '', meaning: '在周末' }),
];

const roundtrip = [
  { part_of_speech: 'n.', meaning: '英语' },
  { part_of_speech: '', meaning: 'n.书房；学习 v.学习' },
  { part_of_speech: '', meaning: '在周末' },
  { part_of_speech: 'v.', meaning: 'v. 去' },
  { part_of_speech: 'adj.', meaning: 'a. 好的' },
].map(w => { const out = posMeaning(w); return [out, posMeaning(splitPosMeaning(out))]; });

console.log(JSON.stringify({
  display,
  parts,
  hasPos: ['a good friend', 'n.书房', 'ad. 快地', 'vt.& vi. 学习', '在周末', 'a lot of 许多'].map(meaningHasPos),
  newTemplate: parsed([
    { '单词': 'apple', '释义': 'n. 苹果' },
    { '单词': 'study', '释义': 'n. 书房；学习  v. 学习；研究' },
    { '单词': 'at the weekend', '释义': '在周末' },
    { '单词': 'quick', '释义': 'adj./adv. 快的；快地' },
  ]),
  oldTemplate: parsed([
    { '单词': 'apple', '词性': 'n.', '释义': '苹果' },
    { '单词': 'go', '词性': '', '释义': 'v. 去' },
  ]),
  roundtrip,
}));
"""


@pytest.fixture(scope="module")
def result(tmp_path_factory):
    if not shutil.which("node") or not ESBUILD.exists():
        pytest.skip("没有 node 或前端 esbuild")
    d = tmp_path_factory.mktemp("wordmeaning")
    src = d / "t.ts"
    src.write_text(SCRIPT.replace("__F__", str(FRONT)), encoding="utf-8")
    out = d / "t.cjs"
    subprocess.run(
        [str(ESBUILD), str(src), "--bundle", "--platform=node", f"--outfile={out}",
         "--log-level=error", f"--alias:xlsx={FRONT / 'node_modules' / 'xlsx'}"],
        check=True, cwd=FRONT, timeout=120,
    )
    run = subprocess.run(["node", str(out)], check=True, capture_output=True, text=True, timeout=60)
    return json.loads(run.stdout)


def test_display_joins_pos_and_meaning_without_doubling(result):
    assert result["display"] == [
        "n. 英语",
        "n.书房；学习 v.学习；研究",
        "n. 苹果",            # 释义里已有 n. 不再拼一次
        "在周末",
        "在周末",             # 词性写「短语」的不显示「短语」两个字
        "adj./adv. 快的；快地",
        "phr. a good friend 好朋友",
        "modal v. 能；可以",
        "",
    ]


def test_parts_split_first_pos_for_light_style(result):
    assert result["parts"] == [
        {"pos": "n.", "text": "英语"},
        {"pos": "n.", "text": "书房；学习 v.学习"},
        {"pos": "", "text": "在周末"},
    ]


def test_has_pos_requires_dot(result):
    # 「a good friend」「a lot of」开头的 a 不是词性 a.
    assert result["hasPos"] == [False, True, True, True, False, False]


def test_new_template_single_meaning_column(result):
    assert result["newTemplate"] == [
        ["n.", "苹果"],
        ["", "n. 书房；学习  v. 学习；研究"],  # 多词性不拆
        ["", "在周末"],
        ["adj./adv.", "快的；快地"],
    ]


def test_old_template_two_columns_still_work(result):
    # 词性列有值就用它;词性列空着、释义里写了词性也照样拆出来
    assert result["oldTemplate"] == [["n.", "苹果"], ["v.", "去"]]


def test_export_then_import_keeps_display(result):
    for exported, back in result["roundtrip"]:
        assert exported == back, (exported, back)
