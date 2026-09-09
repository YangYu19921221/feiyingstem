/**
 * 音标音素表 + 分词 + 写法归一
 *
 * 为什么答案要存 token 数组而不是字符串:同一个音在三处写法不同 ——
 *   音标视频教的   [ei] [i:] [əu] [ɔ]      (老式 DJ 写法)
 *   纸质教材印的   [eɪ] [i:]               (混用)
 *   词库里存的     /eɪ/ /iː/ /əʊ/ /ɒ/      (现代 IPA)
 * 学生点键盘产出的是音素 token,判分是数组比数组,这些分歧从根上不存在。
 * 只有导入老师的 Excel 时才需要归一(normalizeIpa),那是唯一的入口。
 */

/** 键盘分组 = 音标视频的分组。学生刚看完「爆破音 [p][b]」,键盘上那一区就是刚学的 */
export const PHONEME_GROUPS: { label: string; keys: string[] }[] = [
  { label: '爆破音', keys: ['p', 'b', 't', 'd', 'k', 'ɡ'] },
  { label: '摩擦音', keys: ['f', 'v', 's', 'z', 'θ', 'ð', 'ʃ', 'ʒ'] },
  { label: '双辅音', keys: ['ts', 'dz', 'tr', 'dr', 'tʃ', 'dʒ'] },
  { label: '鼻音', keys: ['m', 'n', 'ŋ'] },
  { label: '似拼音', keys: ['h', 'r', 'l'] },
  { label: '单元音', keys: ['iː', 'ɪ', 'i', 'e', 'æ', 'ɑː', 'ʌ', 'ɒ', 'ɔː', 'ʊ', 'uː', 'ɜː', 'ə'] },
  { label: '双元音', keys: ['eɪ', 'aɪ', 'ɔɪ', 'əʊ', 'aʊ', 'ɪə', 'eə', 'ʊə'] },
  { label: '半元音', keys: ['w', 'j'] },
  { label: '重音', keys: ['ˈ'] },
];

/** 全部合法音素。分词时必须**先长后短**匹配,否则 tʃ 会被切成 t + ʃ */
export const ALL_PHONEMES: string[] = PHONEME_GROUPS.flatMap(g => g.keys);
const BY_LEN_DESC = [...ALL_PHONEMES].sort((a, b) => b.length - a.length);

export const isVowel = (p: string): boolean =>
  PHONEME_GROUPS.some(g => (g.label === '单元音' || g.label === '双元音') && g.keys.includes(p));

/**
 * 把各种写法统一成本表的音素。只在导入时调用。
 * 顺序要紧:先处理长音符与双字符,再处理单字符,否则 ɔː 会被误改成 ɒː。
 */
export function normalizeIpa(raw: string): string {
  let s = (raw || '').trim().replace(/^[/[]|[/\]]$/g, '');
  s = s.replace(/:/g, 'ː');              // 半角冒号 → 长音符(教材里 fee [fi:] 就是这种)
  s = s.replace(/g/g, 'ɡ');              // 拉丁 g → IPA ɡ(U+0261)
  s = s.replace(/ə(?=ː)/g, 'ɜ');         // ə: → ɜː
  // 老式双元音写法 → 现代。ɔɪ 要先于单独的 ɔ 处理
  const DIPH: [RegExp, string][] = [
    [/ei/g, 'eɪ'], [/ai/g, 'aɪ'], [/ɔi/g, 'ɔɪ'], [/əu/g, 'əʊ'],
    [/au/g, 'aʊ'], [/iə/g, 'ɪə'], [/ɛə/g, 'eə'], [/uə/g, 'ʊə'],
    [/oʊ/g, 'əʊ'],                       // 美音写法(wav2vec2 那类模型会输出这个)
  ];
  for (const [re, to] of DIPH) s = s.replace(re, to);
  s = s.replace(/ɔ(?![ːɪ])/g, 'ɒ');      // 单独的 ɔ → ɒ,但 ɔː / ɔɪ 保留
  s = s.replace(/ɹ/g, 'r');              // 美音 r
  return s.replace(/[ˌ\s]/g, '');        // 次重音和空格丢掉:小学阶段不考
}

/** 归一后切成 token。返回 unknown 时说明表里没有这个符号,导入应报错而不是静默放过 */
export function tokenizeIpa(raw: string): { tokens: string[]; unknown: string[] } {
  const s = normalizeIpa(raw);
  const tokens: string[] = [];
  const unknown: string[] = [];
  let i = 0;
  while (i < s.length) {
    const hit = BY_LEN_DESC.find(p => s.startsWith(p, i));
    if (hit) {
      tokens.push(hit);
      i += hit.length;
    } else {
      unknown.push(s[i]);
      i += 1;
    }
  }
  return { tokens, unknown };
}

/**
 * 按位置切段,给**展示上色**用(音标视频卡的角标等)。
 *
 * 与 tokenizeIpa 的区别,别混用:
 * - tokenizeIpa 先 normalizeIpa 再切,认不出的字符单独扔进 unknown(丢了位置)——
 *   它是**导入判分**用的,归一是必须的。
 * - segmentIpa **不归一、不丢字符**,原样保留老师填的写法并保住顺序。
 *   角标里归一是错的:老师写 g,归一后显示成 ɡ,标签就跟他填的不一样了;
 *   而空格/斜杠被 normalizeIpa 抹掉会把「æ / e」并成一段。
 */
export function segmentIpa(raw: string): { text: string; kind: 'vowel' | 'consonant' | 'other' }[] {
  // 只脱掉最外层的定界符,中间的原样留着
  const s = (raw || '').trim().replace(/^[/[]|[/\]]$/g, '');
  const out: { text: string; kind: 'vowel' | 'consonant' | 'other' }[] = [];
  let i = 0;
  while (i < s.length) {
    // 先长后短:否则 tʃ 会被切成 t + ʃ、iː 会被切成 i + ː
    const hit = BY_LEN_DESC.find(p => s.startsWith(p, i));
    if (hit) {
      out.push({ text: hit, kind: isVowel(hit) ? 'vowel' : 'consonant' });
      i += hit.length;
      continue;
    }
    const ch = s[i];
    // 显示不归一,但**判类可以**:老师在角标里打的是键盘上的拉丁 g(表里是 IPA ɡ U+0261)、
    // 半角冒号(表里是长音符 ː)—— 不认的话这些字符会灰掉,而它们恰恰是最常被打出来的。
    // 只拿单字符去归一:多字符归一会改长度(ə: → ɜː),位置就对不上了
    const norm = normalizeIpa(ch);
    if (norm && norm !== ch && ALL_PHONEMES.includes(norm)) {
      out.push({ text: ch, kind: isVowel(norm) ? 'vowel' : 'consonant' });
      i += 1;
      continue;
    }
    // 长音符/半角冒号跟着前一个元音走:单独灰掉会把 [i:] 显示成「彩色 i + 灰冒号」
    const prev = out[out.length - 1];
    if ((ch === ':' || ch === 'ː') && prev && prev.kind === 'vowel') {
      prev.text += ch;
      i += 1;
      continue;
    }
    // 其余表里没有的字符(空格、斜杠、连字符…)原样过,不吞掉
    if (prev && prev.kind === 'other') prev.text += ch;
    else out.push({ text: ch, kind: 'other' });
    i += 1;
  }
  return out;
}

/** token 数组 → 展示串。纸书用方括号,跟教材保持一致 */
export const tokensToDisplay = (t: string[]): string => `[${t.join('')}]`;

/** 元音下标 = 第二遍要挖的格。元音是拼读的教学点,辅音是送分的 */
export const vowelIndexes = (tokens: string[]): number[] =>
  tokens.map((t, i) => (isVowel(t) ? i : -1)).filter(i => i >= 0);
