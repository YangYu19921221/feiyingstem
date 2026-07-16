/** 拼写错误模式诊断卡 — 聚类学生真实错误输入,指出系统性混淆(如 ei/ie 不分)
 *  数据积累自 2026-07 起(答错时记录实际输入),不足 5 条错误样本时不展示。 */
import { useEffect, useState } from 'react';
import client from '../api/client';

interface Pattern {
  expected: string;
  got: string;
  count: number;
  examples: string[];
  tip: string;
}
interface Diagnosis {
  analyzed_mistakes: number;
  patterns: Pattern[];
  enough_data: boolean;
}

export default function SpellingDiagnosisCard() {
  const [diag, setDiag] = useState<Diagnosis | null>(null);

  useEffect(() => {
    client.get<Diagnosis>('/student/spelling-diagnosis').then(setDiag).catch(() => {});
  }, []);

  // 数据不足或无模式时静默不占版面
  if (!diag || !diag.enough_data || diag.patterns.length === 0) return null;

  return (
    <div className="bg-white rounded-2xl p-6 shadow-md mb-8">
      <h3 className="font-bold text-gray-800 mb-1">🔍 拼写诊断</h3>
      <p className="text-xs text-gray-400 mb-4">从你最近 {diag.analyzed_mistakes} 次拼写错误里找到的规律</p>
      <div className="space-y-3">
        {diag.patterns.map(p => (
          <div key={`${p.expected}-${p.got}`} className="flex items-start gap-3 bg-red-50 rounded-xl px-4 py-3">
            <span className="text-lg">✏️</span>
            <div className="flex-1">
              <div className="text-sm text-gray-700">
                该写 <b className="text-green-600">{p.expected}</b> 时写成了
                <b className="text-red-500"> {p.got}</b>
                <span className="text-gray-400">(错了 {p.count} 次)</span>
              </div>
              {p.examples.length > 0 && (
                <div className="text-xs text-gray-400 mt-1">出错的词: {p.examples.join('、')}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
