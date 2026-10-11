/**
 * 句子背诵各阶段共用的「错的放到本轮最后,一轮全对才结束」(与分类学习的听写/分类同口径)。
 *
 * - 每句只有**第一次**作答进 firstResults(上报掌握度用);重练轮只是练,不再记
 * - 做错的句子在本轮末尾再来一遍,直到某一轮没有错的
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import type { LearnSentence } from '../../api/sentences';

export interface FirstResult {
  sentence: LearnSentence;
  isCorrect: boolean;
  answer?: string;
}

export function useRoundQueue(items: LearnSentence[]) {
  const [queue, setQueue] = useState<LearnSentence[]>(items);
  const [pos, setPos] = useState(0);
  const [round, setRound] = useState(1);
  const wrongThisRound = useRef<LearnSentence[]>([]);
  const first = useRef<Map<number, FirstResult>>(new Map());
  const [done, setDone] = useState(items.length === 0);

  const current = queue[pos] as LearnSentence | undefined;

  /** 记这一句的结果并前进。返回 true = 整个阶段结束 */
  const answer = useCallback((isCorrect: boolean, userAnswer?: string): boolean => {
    const s = queue[pos];
    if (!s) return true;
    if (!first.current.has(s.id)) first.current.set(s.id, { sentence: s, isCorrect, answer: userAnswer });
    if (!isCorrect) wrongThisRound.current.push(s);
    if (pos + 1 < queue.length) { setPos(pos + 1); return false; }
    const again = wrongThisRound.current;
    if (again.length === 0) { setDone(true); return true; }
    wrongThisRound.current = [];
    setQueue(again);
    setPos(0);
    setRound(r => r + 1);
    return false;
  }, [queue, pos]);

  const firstResults = useMemo(() => () => [...first.current.values()], []);

  return { current, pos, total: queue.length, round, done, answer, firstResults };
}
