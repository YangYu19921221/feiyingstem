/**
 * Excel 单词行解析 - 单元内导入 / 整本导入 共用一套列名规则
 * 列名宽容匹配:去空格、转小写后比对,认多种常见写法,避免老师表头
 * 写成"发音 文本"/"读音"/"TTS"等导致整列读不到、静默丢数据。
 */

export interface ParsedWord {
  word: string;
  phonetic?: string;
  syllables?: string;
  tts_text?: string;
  part_of_speech?: string;
  meaning?: string;
  example_sentence?: string;
  example_translation?: string;
}

const norm = (s: string) => s.toString().replace(/\s+/g, '').toLowerCase();

export const TTS_ALIASES = ['发音文本', 'tts_text', 'tts', '读音', '发音'];

/** 在一行里按别名列表取第一个非空值 */
export const pickCell = (row: Record<string, unknown>, aliases: string[]): string => {
  const want = aliases.map(norm);
  for (const key of Object.keys(row)) {
    if (want.includes(norm(key))) {
      const v = row[key];
      if (v !== undefined && v !== null && String(v).trim() !== '') {
        return String(v).trim();
      }
    }
  }
  return '';
};

/**
 * 音节分隔符统一为 #。
 * 仅当音节串还没用 # 且单词本身不含连字符/空格(纯单词)时,
 * 才把录入的 - 当作音节分隔转成 #。
 * 连字符词(self-study)、短语(ice cream)、已用 # 的一律原样保留,
 * 避免把单词里的真连字符误当分隔符转掉。
 */
export function normalizeSyllables(syllables: string, word: string): string {
  const s = (syllables || '').trim();
  if (!s) return s;
  if (s.includes('#')) return s;
  if (word.includes('-') || word.includes(' ')) return s;
  return s.replace(/-/g, '#');
}

/** 解析 sheet_to_json 的行数组 → 单词列表;空"单词"列的行直接丢弃 */
export function parseWordRows(rows: Record<string, unknown>[]): { words: ParsedWord[]; hasTtsColumn: boolean } {
  const headerKeys = rows.length ? Object.keys(rows[0]).map(norm) : [];
  const ttsWanted = TTS_ALIASES.map(norm);
  const hasTtsColumn = headerKeys.some(k => ttsWanted.includes(k));

  // 截断到与后端 schema/数据库列宽一致(word 100/音标 100/音节 200/发音 200/词性 20),
  // 一格超长只损失尾巴,不会让整本导入被 422 拒掉
  const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s) || undefined;

  const words: ParsedWord[] = [];
  for (const row of rows) {
    const word = pickCell(row, ['单词', 'word']);
    if (!word) continue;
    words.push({
      word: word.slice(0, 100),
      phonetic: cut(pickCell(row, ['音标', 'phonetic']), 100),
      syllables: cut(normalizeSyllables(pickCell(row, ['音节', 'syllables', '音节划分']), word), 200),
      tts_text: cut(pickCell(row, TTS_ALIASES), 200),
      part_of_speech: cut(pickCell(row, ['词性', 'part_of_speech', '词类']), 20),
      meaning: pickCell(row, ['释义', 'meaning', '意思', '中文释义']) || undefined,
      example_sentence: pickCell(row, ['例句', 'example', 'example_sentence']) || undefined,
      example_translation: pickCell(row, ['例句翻译', 'translation', 'example_translation', '例句中文']) || undefined,
    });
  }
  return { words, hasTtsColumn };
}
