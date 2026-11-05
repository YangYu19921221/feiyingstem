/**
 * 音标听力 Excel —— 模板下载 + 读工作簿(2026-11-05)
 *
 * 一个工作表 = 一套听力(表名就是套名,如「听-1」),表里一行一题:
 *   单词 · 音标 · 提示 · 释义 · 发音(后三列可空)
 * 解析在浏览器里做(SheetJS 音标教材页已经在用),后端只收 JSON,校验口径和网页上一题一题填完全一样。
 *
 * 模板和解析放在同一个文件: 表头写法只在 COL 一处,模板写出去的表头读回来一定认得。
 */
import * as XLSX from 'xlsx';
import { PHONEME_GROUPS } from './ipaPhonemes';
import type { TeacherListeningItem } from '../api/phoneticListening';

/** 表头认哪些写法(与音标教材导入同口径,多了「提示」) */
const COL = {
  word: ['单词', 'word', 'Word'],
  phonetic: ['音标', 'phonetic', 'Phonetic', '音標'],
  hint: ['提示', '提示语', 'hint', 'Hint'],
  meaning: ['释义', '意思', '中文', 'meaning', 'Meaning'],
  tts: ['发音', '读音', '發音'],
};
const HEADER = ['单词', '音标', '提示', '释义', '发音'];

const pick = (row: Record<string, unknown>, names: string[]): string => {
  for (const n of names) {
    const v = row[n];
    if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
  }
  return '';
};

export interface ParsedListeningSet {
  title: string;
  items: TeacherListeningItem[];
  /** 只填了单词或只填了音标、被跳过的行(Excel 行号) */
  halfRows: number[];
}

/** 读一个工作簿 → 每个有「单词」「音标」两列的表一套;说明表这种没有这两列的跳过 */
export function parseListeningWorkbook(wb: XLSX.WorkBook): { sets: ParsedListeningSet[]; skipped: string[] } {
  const sets: ParsedListeningSet[] = [];
  const skipped: string[] = [];
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name], { defval: '' });
    const hasCols = rows.some(r => COL.word.some(c => c in r)) && rows.some(r => COL.phonetic.some(c => c in r));
    if (!hasCols) { skipped.push(name); continue; }
    const items: TeacherListeningItem[] = [];
    const halfRows: number[] = [];
    rows.forEach((r, i) => {
      const word = pick(r, COL.word);
      const phonetic = pick(r, COL.phonetic);
      if (!word && !phonetic) return;
      if (!word || !phonetic) { halfRows.push(i + 2); return; }     // +2: 表头占第 1 行
      items.push({
        word, phonetic,
        hint: pick(r, COL.hint) || null,
        meaning: pick(r, COL.meaning) || null,
        tts: pick(r, COL.tts) || null,
      });
    });
    if (items.length) sets.push({ title: name.trim().slice(0, 100), items, halfRows });
    else skipped.push(name);
  }
  return { sets, skipped };
}

/** 示例取自直营老师录的「听-1」「听-12」(《听力练习本》原题),老师一眼能对上纸书 */
const SAMPLE_1 = [
  ['dad', '[dæd]', '3—3', 'n. 爸爸', ''],
  ['face', '[feɪs]', '3—4 [s]不 尾+e', 'n. 脸;面孔', ''],
  ['bee', '[biː]', '2—3 元 2', 'n. 蜜蜂', ''],
  ['add', '[æd]', '2—3 尾 2', 'v. 增加', ''],
  ['bead', '[biːd]', '3—4 元+a', 'n. 珠子', ''],
  ['cede', '[siːd]', '3—4 [s]不 尾+e', 'v. 放弃', 'seed'],
];
const SAMPLE_2 = [
  ['cats', '[kæts]', '4—4', '猫(复数)', ''],
  ['boats', '[bəʊts]', '4—5 元+a', '船(复数)', ''],
  ['kids', '[kɪdz]', '4—4 [k]照抄', '孩子(复数)', ''],
  ['street', '[striːt]', '5—6 元 2', 'n. 街道', ''],
];

const HOW_TO: string[][] = [
  ['音标听力填写说明'],
  [''],
  ['一、一个工作表 = 一套听力(练习本上的一页)'],
  ['  表名就是这套的名字,写成「听-1」「听-2」这样,学生端照这个名字显示。'],
  ['  一个文件可以放很多个表,一次全部导进去;表名不能重复。'],
  ['  这张「填写说明」没有单词、音标两列,导入时自动跳过。'],
  [''],
  ['二、每个表的第一行是表头: 单词 / 音标 / 提示 / 释义 / 发音'],
  ['  单词、音标必填;提示、释义、发音可以空着。列的顺序无所谓,表头写对就行。'],
  ['  一行一题,一套最多 50 题。只填了单词或只填了音标的那一行会被跳过,导入前会告诉你是第几行。'],
  [''],
  ['三、提示照练习本写'],
  ['  比如「3—4 尾2」「4—5 [k]照抄 尾2」「3—4 [s]不 尾+e」,学生做题时能看到。最多 40 个字。'],
  [''],
  ['四、音标写法不用统一,但只能用下面那张表里的 48 个符号'],
  ['  [dæd]、/dæd/、dæd 都认;冒号会自动变成长音符(bi: → biː)。'],
  ['  学生用的是软键盘,键盘上没有的符号他永远打不出来。常见错法: 用字母 a 代替 æ、用 e: 代替 ɜː。'],
  [''],
  ['五、释义做完这题才给学生看;「发音」是系统读错时才填'],
  ['  学生听到的是系统按单词读的。生僻词读错长短音时,在「发音」填一个读音一样的常见词,比如 cede 填 seed。'],
  ['  只能填英文。想用自己的声音,导入后在网页上点那一题的「录音」。'],
  [''],
  ['六、整个文件要么全进要么全不进'],
  ['  有一题音标不合格,一套都不会导入,网页上会列出是哪个表的哪一题,改好再传。'],
  [''],
  ['七、表名和已有的一套重名时'],
  ['  导入前会提醒。勾上「覆盖同名的套」才会改: 同一个单词对上原来那一题,学生做过的记录和录音都留着;'],
  ['  新单词加进去,表里没有的题删掉。'],
  [''],
  ['———————— 可用音标总表(48 个,与学生软键盘完全一致)————————'],
];

export function downloadListeningTemplate(): void {
  const wb = XLSX.utils.book_new();
  const rows = [...HOW_TO];
  for (const g of PHONEME_GROUPS) rows.push([g.label, g.keys.join('  ')]);
  rows.push(['']);
  rows.push(['注: 重音符 ˈ 可以填,学生答题时不用填它。']);
  const ws0 = XLSX.utils.aoa_to_sheet(rows);
  ws0['!cols'] = [{ wch: 12 }, { wch: 70 }];
  XLSX.utils.book_append_sheet(wb, ws0, '填写说明');

  for (const [name, data] of [['听-1', SAMPLE_1], ['听-2', SAMPLE_2]] as [string, string[][]][]) {
    const ws = XLSX.utils.aoa_to_sheet([HEADER, ...data]);
    ws['!cols'] = [{ wch: 14 }, { wch: 16 }, { wch: 20 }, { wch: 20 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  XLSX.writeFile(wb, '音标听力模板.xlsx');
}
