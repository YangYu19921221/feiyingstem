/**
 * 句子导入 Excel 模板(2026-10-11 重做: 加高频词 # 标记)。
 *
 * 三张表: 「句子(在这里填)」是导入的那张,必须放第一个(导入只读第一张表);
 * 「填写说明」「常见错误」只给老师看,导入不读。
 * 示例取自生产三上句子第 1 单元,老师一眼能对上课本。
 * 浏览器里用 SheetJS 生成,不走后端(与音标模板同套路)。
 */
import * as XLSX from 'xlsx';

const HEADER = ['english', 'chinese', 'phonetic', 'difficulty', 'topic', 'grammar_focus'];
const HEADER_ZH = ['英文句子(必填)', '中文翻译(必填)', '音标(可空)', '难度1-5(可空,默认3)', '主题(可空)', '语法点(可空)'];

/** 示例: 标法覆盖 单个词 / 短语 / 一句标多处 / 对话一问一答 / 不标 */
const SAMPLES: (string | number)[][] = [
  ['Hello! I am Mike Black.', '你好！我是迈克·布莱克。', '', 1, '打招呼', ''],
  ['#Nice to meet you#.', '见到你很高兴。', '', 1, '打招呼', ''],
  ['I #like# red and #pink#.', '我喜欢红色和粉色。', '', 2, '颜色', 'like + 名词'],
  ['—#What colour# is it?', '它是什么颜色？', '', 2, '颜色', '特殊疑问句'],
  ["—It's #orange#.", '是橙色的。', '', 1, '颜色', ''],
  ['We #can# #water# the flowers.', '我们可以给花浇水。', '', 3, '植物', 'can + 动词原形'],
];

const HOW_TO: string[][] = [
  ['句子导入填写说明'],
  [''],
  ['一、只填第一张表「句子(在这里填)」'],
  ['  第 1 行表头不要改、不要删;第 2 行是中文提示,导入时会自动跳过,可以删也可以留着。'],
  ['  english(英文)和 chinese(中文)必填,其余几列可以空着。'],
  ['  一行一句,从第 3 行开始填。示例那几行可以直接删掉换成你的句子。'],
  [''],
  ['二、高频词怎么标: 用两个 # 把词包起来'],
  ['  学生学习时,# 里的词会换成橙色加粗显示;过关检测的「填空题」也会优先考它。'],
  ['  # 本身不会显示给学生,也不影响默写判分(学生不用打 #)。'],
  [''],
  ['  你填的                              学生看到的(加粗 = 橙色)'],
  ['  I #like# red and #pink#.           I 【like】 red and 【pink】.'],
  ['  #Nice to meet you#.                【Nice to meet you】.        ← 整个短语一起标'],
  ['  We #can# #water# the flowers.      We 【can】 【water】 the flowers.  ← 一句可以标好几处'],
  ['  Hello! I am Mike Black.            Hello! I am Mike Black.      ← 不想标就不写 #'],
  [''],
  ['  写 #like# 或 ##like## 都可以,系统当成一样的。# 里面前后多打了空格也没关系。'],
  [''],
  ['三、对话怎么填'],
  ['  一问一答各占一行,句首加破折号「—」,两行挨着放:'],
  ['    —What colour is it?'],
  ['    —It\'s orange.'],
  ['  系统会把挨着的对话放在同一组练,开口背时由系统说问句、学生说答句。'],
  ['  破折号学生默写时不用打。'],
  [''],
  ['四、难度、主题、语法点'],
  ['  难度填 1 到 5 的数字,不填默认 3。主题、语法点给自己看的,学生端不显示。'],
  [''],
  ['五、上传'],
  ['  在「句子集详情」左边选好单元 → 右上角「批量导入(CSV / Excel)」→ 选这个文件。'],
  ['  同一个单元里已经有的句子(英文一样)会自动跳过,不会重复。'],
];

const MISTAKES: string[][] = [
  ['常见错误', '会怎样', '正确写法'],
  ['I #like apples.', '# 只有一个,这一行会被跳过,导入结果里写明第几行', 'I #like# apples.'],
  ['I ## apples.', '一对 # 中间是空的,这一行会被跳过', 'I #like# apples.'],
  ['I #like# #apples.', '# 一共 3 个,不成对,这一行会被跳过', 'I #like# #apples#.'],
  ['I ＃like＃ apples.', '全角 ＃ 不认,当成普通字符显示给学生', '用英文输入法打半角 #'],
  ['（中文写在 english 列）', '学生端会把中文当英文去默写', 'english 列只写英文,中文写在 chinese 列'],
];

export function downloadSentenceTemplate(): void {
  const wb = XLSX.utils.book_new();

  const ws = XLSX.utils.aoa_to_sheet([HEADER, HEADER_ZH, ...SAMPLES]);
  ws['!cols'] = [{ wch: 34 }, { wch: 22 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, ws, '句子(在这里填)');

  const how = XLSX.utils.aoa_to_sheet(HOW_TO);
  how['!cols'] = [{ wch: 90 }];
  XLSX.utils.book_append_sheet(wb, how, '填写说明');

  const mis = XLSX.utils.aoa_to_sheet(MISTAKES);
  mis['!cols'] = [{ wch: 26 }, { wch: 46 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, mis, '常见错误');

  XLSX.writeFile(wb, '句子导入模板(含高频词标记).xlsx');
}

/** 模板第 2 行是中文提示,导入前要去掉,否则会被当成一句「英文句子(必填)」导进去 */
export const TEMPLATE_HINT_ROW_FIRST_CELL = HEADER_ZH[0];
