/**
 * AI 学情周报卡片 — 家长端与教师端共用。
 * 把冷冰冰的学习数据翻译成一段"人话"报告：总体评价 + 进步点 + 待加强 + 3 条建议。
 */
export interface WeeklyReportData {
  student_id: number;
  week_start: string;
  summary: string;
  highlights: string[];
  focus_areas: string[];
  suggestions: string[];
  stats_snapshot: Record<string, any>;
  generated_at: string | null;
}

interface Props {
  report: WeeklyReportData | null;
  loading: boolean;
  regenerating?: boolean;
  onRegenerate: () => void;
  error?: string | null;
}

function formatGeneratedAt(iso: string | null): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', {
      month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export default function WeeklyReportCard({ report, loading, regenerating, onRegenerate, error }: Props) {
  return (
    <section className="bg-white rounded-2xl p-6 mb-6 shadow-sm border border-orange-100">
      {/* 头部 */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-2xl">📝</span>
          <div>
            <h3 className="text-lg font-semibold text-gray-800">本周 AI 学情报告</h3>
            {report?.week_start && (
              <p className="text-xs text-gray-400">
                {report.week_start} 这一周
                {report.generated_at && ` · 生成于 ${formatGeneratedAt(report.generated_at)}`}
              </p>
            )}
          </div>
        </div>
        <button
          onClick={onRegenerate}
          disabled={loading || regenerating}
          className="text-sm px-3 py-1.5 rounded-full bg-orange-50 text-orange-600 hover:bg-orange-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {regenerating ? '重新生成中…' : '🔄 重新生成'}
        </button>
      </div>

      {/* 加载态 */}
      {loading && !report && (
        <div className="py-8 text-center text-gray-400">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-orange-400 mb-3"></div>
          <p className="text-sm">AI 正在分析本周学习情况…</p>
        </div>
      )}

      {/* 错误态 */}
      {error && !loading && (
        <div className="py-6 text-center text-gray-500">
          <p className="text-sm">{error}</p>
          <button onClick={onRegenerate} className="mt-2 text-sm text-orange-600 hover:underline">
            点击重试
          </button>
        </div>
      )}

      {/* 内容 */}
      {report && !loading && (
        <div className="space-y-5">
          {/* 总体评价 */}
          <p className="text-gray-700 leading-relaxed bg-orange-50/60 rounded-xl p-4">
            {report.summary}
          </p>

          {/* 进步点 */}
          {report.highlights.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-green-600 mb-2">✅ 本周进步</p>
              <ul className="space-y-1.5">
                {report.highlights.map((h, i) => (
                  <li key={i} className="text-sm text-gray-600 flex gap-2">
                    <span className="text-green-400 shrink-0">·</span>
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 待加强 */}
          {report.focus_areas.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-amber-600 mb-2">📌 需要加强</p>
              <ul className="space-y-1.5">
                {report.focus_areas.map((f, i) => (
                  <li key={i} className="text-sm text-gray-600 flex gap-2">
                    <span className="text-amber-400 shrink-0">·</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 具体建议 */}
          {report.suggestions.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-blue-600 mb-2">💡 给家长的建议</p>
              <ol className="space-y-1.5">
                {report.suggestions.map((s, i) => (
                  <li key={i} className="text-sm text-gray-600 flex gap-2">
                    <span className="text-blue-400 font-semibold shrink-0">{i + 1}.</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
