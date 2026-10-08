/**
 * 平台书定卡包档位(仅平台 admin,2026-10-08)。
 * 新书上架默认「未定档」= 不进任何卡;在这里定成「基础」后,
 * 有效期内的同范围学段卡/全通卡学生立刻自动拿到。
 */
import { useEffect, useMemo, useState } from 'react';
import { cardPackApi, type PackTier } from '../../api/cardPack';
import { toast } from '../Toast';
import { getErrorMessage } from '../../utils/errorMessage';

type Row = { id: number; name: string; series: string; stage_label: string; pack_tier: PackTier | null };

export default function PackBookTiers() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [tiers, setTiers] = useState<Record<string, string>>({});
  const [onlyUntiered, setOnlyUntiered] = useState(false);
  const [saving, setSaving] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    cardPackApi.books()
      .then(res => { const r = res as unknown as { books: Row[]; tiers: Record<string, string> }; setRows(r.books); setTiers(r.tiers); })
      .catch(() => toast.error('书单加载失败'));
  }, [open]);

  const untiered = rows.filter(r => !r.pack_tier).length;
  const shown = useMemo(() => onlyUntiered ? rows.filter(r => !r.pack_tier) : rows, [rows, onlyUntiered]);

  const change = async (row: Row, value: string) => {
    const next = (value || null) as PackTier | null;
    setSaving(row.id);
    try {
      const r = (await cardPackApi.setTier(row.id, next)) as unknown as { synced_students: number };
      setRows(prev => prev.map(x => x.id === row.id ? { ...x, pack_tier: next } : x));
      toast.success(r.synced_students > 0
        ? `已定档,并自动开给 ${r.synced_students} 名持学段卡/全通卡的学生`
        : '已定档');
    } catch (e) {
      toast.error(getErrorMessage(e, '定档失败'));
    } finally { setSaving(null); }
  };

  return (
    <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-gray-800">卡包书本档位(新政策)</h2>
          <p className="text-xs text-slate-500">
            新书默认「未定档」,不进任何卡。定成「基础」才进单册卡/学段卡/全通卡;「精品」只能发精品卡;「校本」不进卡包。
          </p>
        </div>
        <button type="button" onClick={() => setOpen(v => !v)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          {open ? '收起' : '查看 / 定档'}
        </button>
      </div>
      {open && (
        <div className="mt-4">
          <label className="mb-2 inline-flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={onlyUntiered} onChange={e => setOnlyUntiered(e.target.checked)} />
            只看未定档({untiered} 本)
          </label>
          <div className="max-h-[28rem] overflow-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
                <tr><th className="px-3 py-2">版本</th><th className="px-3 py-2">学段</th><th className="px-3 py-2">书</th><th className="px-3 py-2">档位</th></tr>
              </thead>
              <tbody>
                {shown.map(r => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="px-3 py-1.5 text-slate-500">{r.series || '未分组'}</td>
                    <td className="px-3 py-1.5 text-slate-500">{r.stage_label}</td>
                    <td className="px-3 py-1.5">{r.name}</td>
                    <td className="px-3 py-1.5">
                      <select aria-label={`${r.name} 的档位`} value={r.pack_tier ?? ''} disabled={saving === r.id}
                              onChange={e => change(r, e.target.value)}
                              className={`rounded border px-2 py-1 ${r.pack_tier ? 'border-slate-300' : 'border-amber-400 bg-amber-50'}`}>
                        <option value="">未定档(不进卡)</option>
                        {Object.entries(tiers).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
