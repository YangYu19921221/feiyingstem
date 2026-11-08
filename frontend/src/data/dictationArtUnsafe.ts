/**
 * 听写时不能露出来的配图(2026-11-08)
 *
 * 配图里画着单词,几乎都画在图片下面三成(全库 27,119 张用 OCR 量过),听写时只露出上面 62%。
 * 少数几张单词(或单词的一部分)画到了上半截 —— 露出来就是给答案,这些听写时不显示图,
 * 退回只有喇叭的声音台。名单由全库扫描生成,图换了要重扫(工具在 frontend/.impeccable/mocks/word-art/tools)。
 *
 * 键是图片文件名(不带 ?v= 版本号)。
 */
const UNSAFE = new Set<string>([
  'continuity.jpg',
  'cycloid.jpg',
  'five.jpg',
  'four.jpg',
  'hash.jpg',
  'jar.jpg',
  'long.jpg',
  'nine.jpg',
  'oblong.jpg',
  'plus.jpg',
  'seven.jpg',
  'ten.jpg',
  'three.jpg',
  'workflow.jpg',
  'zip.jpg',
]);

/** 这张配图听写时能不能露出上半截 */
export function isDictationArtSafe(url: string): boolean {
  const name = url.split('?')[0].split('/').pop() || '';
  return !UNSAFE.has(name);
}
