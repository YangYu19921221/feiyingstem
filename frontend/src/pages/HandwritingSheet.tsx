/**
 * 打印默写纸(四线三格)
 *
 * 两种模板:
 * - 听写版:只有序号 + 四线三格,配合「纸笔听写」的 App 报词使用
 * - 自默版:序号 + 中文释义 + 四线三格,看中文默写英文(家长报词也适用)
 *
 * 纯前端 window.print(),不产生任何服务端文件。
 * 词序与「纸笔听写」页同源(startLearning 按 order_index),写完拍照即可回 App 批改。
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Printer } from 'lucide-react';
import useGoBack from '../hooks/useGoBack';
import { startLearning } from '../api/progress';
import type { StartLearningResponse } from '../api/progress';
import { getErrorMessage } from '../utils/errorMessage';

type Template = 'blank' | 'cn';

/** 英语四线三格:一、四线虚,二、三线实(书写主区) */
const FourLineGrid = () => (
  <div className="relative h-11 flex-1 min-w-0">
    <div className="absolute inset-x-0 top-0 border-t border-dashed border-slate-300" />
    <div className="absolute inset-x-0 top-1/3 border-t border-slate-400" />
    <div className="absolute inset-x-0 top-2/3 border-t border-slate-400" />
    <div className="absolute inset-x-0 bottom-0 border-t border-dashed border-slate-300" />
  </div>
);

export default function HandwritingSheet() {
  const { unitId } = useParams<{ unitId: string }>();
  const navigate = useNavigate();
  const goBack = useGoBack('/student/dashboard');
  const [searchParams, setSearchParams] = useSearchParams();
  const template: Template = searchParams.get('t') === 'cn' ? 'cn' : 'blank';

  const [learningData, setLearningData] = useState<StartLearningResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!unitId) return;
    (async () => {
      try {
        const data = await startLearning({ unit_id: parseInt(unitId), learning_mode: 'handwriting' });
        if (!data.words.length) setError(data.message || '该单元暂时没有单词');
        else setLearningData(data);
      } catch (e: unknown) {
        setError(getErrorMessage(e, '加载失败'));
      } finally {
        setLoading(false);
      }
    })();
  }, [unitId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center">
        <p className="text-gray-500">加载默写纸...</p>
      </div>
    );
  }

  if (error || !learningData) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center">
        <div className="text-center px-6">
          <span className="text-6xl mb-4 block">😞</span>
          <p className="text-gray-500">{error || '加载失败'}</p>
          <button onClick={() => goBack()} className="mt-4 min-h-11 rounded-xl bg-primary px-5 font-semibold text-white">
            返回
          </button>
        </div>
      </div>
    );
  }

  const words = learningData.words;

  return (
    <div className="min-h-screen bg-paper print:bg-white">
      {/* 屏幕控制条,打印时隐藏 */}
      <nav className="bg-white/95 border-b border-slate-200/80 sticky top-0 z-10 print:hidden">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => goBack()}
            className="flex h-11 w-11 items-center justify-center rounded-xl transition hover:bg-orange-50"
            aria-label="返回"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-gray-800 truncate">🖨️ 打印默写纸</h1>
            <p className="text-xs text-gray-500 truncate">{learningData.unit_info.name} · {words.length} 个单词</p>
          </div>
          <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm shrink-0">
            <button
              onClick={() => setSearchParams({ t: 'blank' }, { replace: true })}
              className={`px-3 py-2 font-medium transition ${template === 'blank' ? 'bg-primary text-white' : 'text-gray-600 hover:bg-slate-50'}`}
            >
              听写版
            </button>
            <button
              onClick={() => setSearchParams({ t: 'cn' }, { replace: true })}
              className={`px-3 py-2 font-medium transition ${template === 'cn' ? 'bg-primary text-white' : 'text-gray-600 hover:bg-slate-50'}`}
            >
              自默版
            </button>
          </div>
          <button
            onClick={() => window.print()}
            className="shrink-0 min-h-11 rounded-xl bg-primary px-4 font-semibold text-white flex items-center gap-2 hover:opacity-90 transition"
          >
            <Printer className="w-4 h-4" />
            <span className="hidden sm:inline">打印</span>
          </button>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-4 py-4 print:hidden">
        <p className="text-xs text-gray-500 bg-white rounded-xl border border-slate-200 px-4 py-3">
          💡 {template === 'blank'
            ? '听写版:打印后回到「纸笔听写」,App 按同样顺序报词,写完拍照 AI 批改。'
            : '自默版:看中文默写英文,写完在「纸笔听写」里拍照批改(App 报词顺序与本纸一致,可直接跳到拍照)。'}
        </p>
      </div>

      {/* 打印区 */}
      <div className="max-w-3xl mx-auto px-4 pb-10 print:max-w-none print:px-0 print:pb-0">
        <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-10 print:border-0 print:rounded-none print:p-0">
          {/* 页眉 */}
          <div className="mb-6">
            <h2 className="text-center text-xl font-bold text-gray-900 mb-1">英语听写默写纸</h2>
            <p className="text-center text-sm text-gray-500 mb-4">{learningData.unit_info.name}</p>
            <div className="flex justify-between text-sm text-gray-600 border-b-2 border-gray-800 pb-2">
              <span>姓名:____________</span>
              <span>日期:____________</span>
              <span>得分:____________</span>
            </div>
          </div>

          {/* 题目行 */}
          <div className="space-y-4">
            {words.map((w, i) => (
              <div key={w.id} className="flex items-end gap-3" style={{ breakInside: 'avoid' }}>
                <span className="w-7 shrink-0 text-right font-mono text-sm text-gray-500 pb-2">{i + 1}.</span>
                {template === 'cn' && (
                  <span className="w-36 shrink-0 text-sm text-gray-700 pb-2 leading-tight">
                    {w.part_of_speech && <span className="text-gray-400 mr-1">{w.part_of_speech}</span>}
                    {w.meaning || ''}
                  </span>
                )}
                <FourLineGrid />
              </div>
            ))}
          </div>

          {/* 页脚提示 */}
          <p className="mt-8 text-center text-xs text-gray-400">
            写完后用「纸笔听写」拍照,AI 自动批改 · 共 {words.length} 题
          </p>
        </div>
      </div>
    </div>
  );
}
