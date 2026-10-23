/** 体验卡几张列表共用的分页条: 「共 N 条 · 第 x/y 页」+ 上一页 / 下一页。只有一页时不显示 */
interface Props {
  page: number;
  size: number;
  total: number;
  onChange: (page: number) => void;
}

export default function Pager({ page, size, total, onChange }: Props) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (total <= size) return null;
  return (
    <nav className="flex items-center justify-end gap-2 text-sm text-slate-600" aria-label="分页">
      <span>共 {total} 条 · 第 {page}/{pages} 页</span>
      <button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)}
        className="min-h-9 rounded-lg border border-slate-200 bg-white px-3 font-semibold disabled:opacity-40">
        上一页
      </button>
      <button type="button" disabled={page >= pages} onClick={() => onChange(page + 1)}
        className="min-h-9 rounded-lg border border-slate-200 bg-white px-3 font-semibold disabled:opacity-40">
        下一页
      </button>
    </nav>
  );
}
