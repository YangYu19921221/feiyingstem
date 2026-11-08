/**
 * 词性 + 释义合在一起显示(2026-11-08,用户「分类中所有模块词性和释义都要显示,而且要显示一起」)
 *
 * 库里三种写法并存(11-08 生产 14 万条释义):
 *   ① 词性写在释义里  meaning="n.书房；学习  v.学习；研究"、part_of_speech=""       约 9.3 万条
 *   ② 词性单独一栏    meaning="英语"、part_of_speech="n."                            约 2 万条
 *   ③ 没有词性        meaning="在周末"(多是短语)                                     约 2.9 万条
 * 一律显示成「词性 释义」;释义开头本来就带词性的(①)不再拼一次,免得出现「n. n.书房」。
 *
 * 上传时老师可以在「释义」一栏直接写「n. 苹果」,splitPosMeaning 拆出词性存进 part_of_speech。
 */

// 常见词性缩写,**必须带点**(「a.」是词性,「a good friend」不是);
// 也认词表里出现过的老写法: a.(=adj.)、ad.(=adv.)、vr.、nphr.(名词短语)、prefix./pref.、exclam.、vbl.、ini.
// modal v. / aux. v. 这类两段的整体算一个
const POS_TOKEN = String.raw`(?:(?:modal|aux)\.?\s*v\.|(?:n|v|vt|vi|vr|adj|adv|ad|a|prep|pron|conj|int|interj|exclam|ini|num|art|aux|abbr|det|phr|nphr|prefix|pref|vbl|pl|sing)\.)`;
const POS_HEAD = new RegExp(String.raw`^\s*${POS_TOKEN}(?:\s*(?:[&＆/,，、]|and)?\s*${POS_TOKEN})*(?=[\s一-鿿（(…\[—]|$)`, 'i');

/** 释义开头是不是已经写了词性(「n.书房」「adj./adv. 快地」「v. & n. 记录」) */
export function meaningHasPos(meaning: string | null | undefined): boolean {
  const m = (meaning || '').trim();
  if (!m) return false;
  if (m.startsWith('短语')) return true;
  return POS_HEAD.test(m);
}

/** 统一的「词性 释义」文字;两样都没有返回空串 */
export function posMeaning(word: { part_of_speech?: string | null; meaning?: string | null } | null | undefined): string {
  if (!word) return '';
  const meaning = (word.meaning || '').trim();
  const pos = (word.part_of_speech || '').trim();
  if (!pos || pos === '短语' || meaningHasPos(meaning)) return meaning;
  if (!meaning) return pos;
  return `${pos} ${meaning}`;
}

/** 拆成两段: 词性(可能为空)和后面的中文,给需要把词性做浅色的地方用 */
export function posMeaningParts(word: { part_of_speech?: string | null; meaning?: string | null } | null | undefined): { pos: string; text: string } {
  if (!word) return { pos: '', text: '' };
  const meaning = (word.meaning || '').trim();
  const pos = (word.part_of_speech || '').trim();
  if (meaningHasPos(meaning)) {
    const m = meaning.match(POS_HEAD);
    // 多词性(n.书房 v.学习)只把开头那个提出来,后面的原样跟在文字里
    return m ? { pos: m[0].trim(), text: meaning.slice(m[0].length).trim() } : { pos: '', text: meaning };
  }
  if (!pos || pos === '短语') return { pos: '', text: meaning };
  return { pos, text: meaning };
}

/**
 * 上传用: 「释义」一栏老师写的「n. 苹果」→ { part_of_speech: 'n.', meaning: '苹果' }。
 * 多词性(「n.书房 v.学习」)整段留在 meaning 里、part_of_speech 留空 —— 拆开会丢掉第二个词性。
 * 写了单独的「词性」列(老模板)就用那一列,释义原样。
 */
export function splitPosMeaning(meaning: string, posColumn?: string): { part_of_speech: string; meaning: string } {
  const m = (meaning || '').trim();
  const col = (posColumn || '').trim();
  if (col) return { part_of_speech: col, meaning: m };
  const head = m.match(POS_HEAD);
  if (!head) return { part_of_speech: '', meaning: m };
  const rest = m.slice(head[0].length).trim();
  // 后面还有别的词性 = 多词性,不拆
  if (new RegExp(String.raw`(^|[\s；;，,｜|])${POS_TOKEN}(?=[\s一-鿿]|$)`, 'i').test(rest)) {
    return { part_of_speech: '', meaning: m };
  }
  return { part_of_speech: head[0].trim(), meaning: rest || m };
}
