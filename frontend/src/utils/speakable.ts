/**
 * 回答里哪些是能点着听的英文(components/tutor/SpeakableText 和「听全部英文」共用一份切法,2026-10-27)。
 * 按「连着的英文单词」切: She goes 是一段;单个字母(选项 A / B)不算;书名号里的不算(文件名《Unit3练习卷.docx》不该念)。
 */
export const EN_RUN = /[A-Za-z][A-Za-z'’-]*(?: [A-Za-z][A-Za-z'’-]*)*/g;
export const TITLE = /《[^》]*》/g;

export type SpeakPart = { en: boolean; s: string };

export function speakParts(text: string): SpeakPart[] {
  const out: SpeakPart[] = [];
  const cut = (seg: string) => {
    let last = 0;
    for (const m of seg.matchAll(EN_RUN)) {
      const i = m.index ?? 0;
      if (i > last) out.push({ en: false, s: seg.slice(last, i) });
      out.push({ en: m[0].length >= 2, s: m[0] });
      last = i + m[0].length;
    }
    if (last < seg.length) out.push({ en: false, s: seg.slice(last) });
  };
  let last = 0;
  for (const m of text.matchAll(TITLE)) {
    const i = m.index ?? 0;
    cut(text.slice(last, i));
    out.push({ en: false, s: m[0] });
    last = i + m[0].length;
  }
  cut(text.slice(last));
  return out;
}

/** 「听全部英文」: 回答里的英文按顺序连起来(去重),最多 maxChars 个字符(发音接口一次最多 500) */
export function englishToRead(text: string, maxChars = 450): string[] {
  const runs: string[] = [];
  for (const p of speakParts(text)) {
    if (!p.en) continue;
    const s = p.s.trim();
    if (s && !runs.some((r) => r.toLowerCase() === s.toLowerCase())) runs.push(s);
  }
  const out: string[] = [];
  let len = 0;
  for (const r of runs) {
    if (len + r.length + 2 > maxChars) break;
    out.push(r);
    len += r.length + 2;
  }
  return out;
}
