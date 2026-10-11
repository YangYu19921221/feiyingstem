/** 过关检测出题(纯函数,单独成文件便于单测) */
import type { LearnSentence } from '../../api/sentences';
import { makeCloze, shuffleChunks } from '../../utils/sentenceCheck';

export type QType = 'arrange' | 'cloze' | 'choice' | 'dictation';
export interface Question { sentence: LearnSentence; type: QType }

/** 出题: 打乱句序,题型轮流分配;挖不出关键词的句子不出填空,组里不到 3 句不出选择(选项太少) */
export function buildQuestions(items: LearnSentence[], rand: () => number = Math.random): Question[] {
  const order = shuffleChunks(items, rand);
  const cycle: QType[] = ['arrange', 'cloze', 'choice', 'dictation'];
  const offset = Math.floor(rand() * cycle.length);
  return order.map((s, i) => {
    let type = cycle[(i + offset) % cycle.length];
    if (type === 'cloze' && !makeCloze(s.english, s.key_word)) type = 'dictation';
    if (type === 'choice' && items.length < 3) type = 'arrange';
    return { sentence: s, type };
  });
}
