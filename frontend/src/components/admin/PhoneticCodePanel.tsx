/**
 * 音标视频库兑换码面板(平台 admin + 机构管理员)。
 *
 * 单词本码按「书」开通,音标码开通的是**整个音标视频库**(库级,不绑任何书),
 * 所以它单独一张表、单独一套端点,不塞进 AdminSubscriptions 那套按书选的表单里 ——
 * 混在一起会让「选书」那半个界面对音标码毫无意义、还容易误发。
 *
 * 2026-10-02 起机构管理员也能发: 平台在「机构管理 → 音标码额度」给机构发放张数,
 * 机构在额度内生成,码只给本机构学生兑。卡种/时长照 card-policy(机构只能 ≤180 天包月),
 * 额度水位走 /phonetic-codes/quota(真源 org_service.phonetic_code_quota_status)。
 * 调用方必须等 policy 到了再挂(policy 为 null 时别渲染),见 AdminSubscriptions。
 *
 * 2026-10-16 起可发「指定几节」的码: 开通范围选「指定几节」再勾一节或多节,兑出来只开勾的那几节。
 * 与整库码共用同一份额度(一张码算一张,不按节数);列表「开通范围」列写的是发码时的视频标题快照。
 *
 * 2026-10-22 起: 生成即占额度,**禁用、删除都不退回**;删除改软删(状态「已删除」,列表默认不显示);
 * 码本身不过期,学生兑换那天才开始计时。机构生成前多一道确认(说清不退)。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, Check, Copy, Search, Trash2 } from 'lucide-react';
import {
  generatePhoneticCodes,
  listPhoneticCodes,
  disablePhoneticCode,
  deletePhoneticCode,
  getPhoneticCodeQuota,
  listPhoneticCodeVideos,
  type CardPolicy,
  type PhoneticCode,
  type PhoneticCodeQuota,
  type PhoneticCodeVideo,
} from '../../api/subscription';
import { toast } from '../Toast';
import { getErrorMessage } from '../../utils/errorMessage';

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  unused: { label: '未使用', color: 'bg-green-100 text-green-700' },
  used: { label: '已使用', color: 'bg-blue-100 text-blue-700' },
  expired: { label: '已过期', color: 'bg-gray-100 text-gray-500' },
  disabled: { label: '已禁用', color: 'bg-red-100 text-red-600' },
  deleted: { label: '已删除', color: 'bg-gray-100 text-gray-400' },
};

// 包月常用档。机构按 policy.max_grant_days 截掉超限的档
const DAYS_PRESETS = [30, 90, 180, 365];
const DAYS_PRESET_LABELS: Record<number, string> = {
  30: '1个月', 90: '3个月', 180: '半年', 365: '1年',
};

const PAGE_SIZE = 20;

export default function PhoneticCodePanel({ policy }: { policy: CardPolicy }) {
  const isOrg = policy.role === 'org_admin';
  const grantTypes = ['permanent', 'period', 'times'].filter((t) => policy.allowed_grant_types.includes(t));
  const dayPresets = DAYS_PRESETS.filter((d) => d <= policy.max_grant_days);
  const [quota, setQuota] = useState<PhoneticCodeQuota | null>(null);
  const [codes, setCodes] = useState<PhoneticCode[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filterStatus, setFilterStatus] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  const [genCount, setGenCount] = useState(10);
  const [genNote, setGenNote] = useState('');
  const [genGrantType, setGenGrantType] = useState(isOrg ? 'period' : 'permanent'); // permanent/period/times
  const [genGrantDays, setGenGrantDays] = useState(Math.min(180, policy.max_grant_days));  // 包月默认半年
  const [genGrantTimes, setGenGrantTimes] = useState(30); // 次卡默认 30 天
  // 开通范围: library = 整个音标视频库(默认,即原来的码);videos = 只开勾选的几节
  const [genScope, setGenScope] = useState<'library' | 'videos'>('library');
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [videos, setVideos] = useState<PhoneticCodeVideo[] | null>(null);
  const [videoKw, setVideoKw] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<PhoneticCode[]>([]);
  const [copied, setCopied] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const fetchCodes = useCallback(async () => {
    try {
      const res = await listPhoneticCodes({
        page, page_size: PAGE_SIZE,
        status: filterStatus || undefined,
        search: debouncedSearch || undefined,
      });
      // 删/禁用掉末页最后一条后,当前页已越界:夹回最后一页(effect 会按新页重取)。
      // 不夹的话列表空着、分页条也因只剩 1 页而消失,看着像码全没了
      const lastPage = Math.max(1, Math.ceil((res.total || 0) / PAGE_SIZE));
      if (page > lastPage) { setPage(lastPage); return; }
      setCodes(res.codes || []);
      setTotal(res.total || 0);
    } catch { toast.error('音标兑换码列表加载失败，请刷新重试'); }
  }, [page, filterStatus, debouncedSearch]);

  // 搜索防抖:输入即时回显,停 400ms 才请求;改搜索/筛选都回第 1 页
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => { setPage(1); }, [filterStatus]);
  useEffect(() => { fetchCodes(); }, [fetchCodes]);

  const fetchQuota = useCallback(async () => {
    if (!isOrg) return;
    try { setQuota(await getPhoneticCodeQuota()); } catch { /* 额度条拿不到不影响列表 */ }
  }, [isOrg]);
  useEffect(() => { fetchQuota(); }, [fetchQuota]);
  // 视频清单只在第一次切到「指定几节」时取(多数人只发整库码,不必每次进页面都拉)
  useEffect(() => {
    if (genScope !== 'videos' || videos !== null) return;
    listPhoneticCodeVideos()
      .then((rows) => setVideos(rows))
      .catch(() => { setVideos([]); toast.error('视频列表加载失败，请刷新重试'); });
  }, [genScope, videos]);
  const videoOptions = useMemo(() => {
    const kw = videoKw.trim().toLowerCase();
    if (!videos) return [];
    if (!kw) return videos;
    return videos.filter((v) => [v.title, v.phonetic_symbol, v.lecturer, v.org_name]
      .some((s) => (s || '').toLowerCase().includes(kw)));
  }, [videos, videoKw]);
  // 已勾的视频,按清单顺序(= 学生端顺序)排,发码时也按这个顺序传
  const pickedVideos = useMemo(
    () => (videos || []).filter((v) => picked.has(v.id)),
    [videos, picked],
  );
  // 一张码只能开同一个机构的视频(学生只属于一个机构;平台预置可以和任何一家混选)。
  // 只有平台 admin 看得到多家的视频,机构管理员这里恒为本机构或 null
  const pickedOrg = pickedVideos.find((v) => v.org_id !== null)?.org_id ?? null;
  const blockedByOrg = (v: PhoneticCodeVideo) =>
    v.org_id !== null && pickedOrg !== null && v.org_id !== pickedOrg;
  const groups = useMemo(() => {
    const labels = Array.from(new Set(videoOptions.map((v) => v.category_label)));
    return labels.map((label) => ({
      label, items: videoOptions.filter((v) => v.category_label === label),
    }));
  }, [videoOptions]);
  const togglePick = (id: number) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  // 「全选本组」只动当前搜索结果里、没被机构冲突挡住的那些;本组已全勾则全部取消
  const toggleGroup = (items: PhoneticCodeVideo[]) => setPicked((prev) => {
    const selectable = items.filter((v) => !blockedByOrg(v));
    const allOn = selectable.length > 0 && selectable.every((v) => prev.has(v.id));
    const next = new Set(prev);
    selectable.forEach((v) => (allOn ? next.delete(v.id) : next.add(v.id)));
    return next;
  });
  const videoMeta = (v: PhoneticCodeVideo) => [
    v.lecturer,
    v.org_name || (v.is_preset ? '平台预置' : null),
  ].filter(Boolean).join(' · ');

  const quotaTotal = quota?.phonetic_code_quota ?? 0;
  const quotaLeft = quota?.phonetic_codes_left ?? 0;
  // 机构没额度时整块生成区置灰并说清找谁,别让人填完点了才吃 403
  const noQuota = isOrg && quota !== null && quotaTotal <= 0;

  const handleGenerate = async () => {
    if (genCount < 1 || genCount > 100) { toast.warning('生成数量需在 1～100 之间'); return; }
    if (genGrantType === 'period' && (!genGrantDays || genGrantDays < 1)) {
      toast.warning('包月卡请填写有效天数'); return;
    }
    if (genGrantType === 'period' && genGrantDays > policy.max_grant_days) {
      toast.warning(`最长 ${policy.max_grant_days} 天`); return;
    }
    if (isOrg && quota && genCount > quotaLeft) {
      toast.warning(`音标码额度只剩 ${quotaLeft} 张，请联系平台追加`); return;
    }
    if (genGrantType === 'times' && (!genGrantTimes || genGrantTimes < 1)) {
      toast.warning('次卡请填写可用天数'); return;
    }
    if (genScope === 'videos' && pickedVideos.length === 0) {
      toast.warning('请先勾选这批码要开哪几节视频'); return;
    }
    if (isOrg && !confirm(
      `确定生成 ${genCount} 张音标兑换码吗？\n\n生成后立即占用 ${genCount} 张额度，之后禁用或删除都不退回。\n请先核对开通范围和卡种。`,
    )) return;
    setGenerating(true);
    setGenResult([]);
    try {
      const payload: Parameters<typeof generatePhoneticCodes>[0] = {
        count: genCount,
        batch_note: genNote || undefined,
        grant_type: genGrantType,
      };
      if (genGrantType === 'period') payload.grant_days = genGrantDays;
      if (genGrantType === 'times') payload.grant_times = genGrantTimes;
      if (genScope === 'videos') payload.video_ids = pickedVideos.map((v) => v.id);
      const res = await generatePhoneticCodes(payload);
      setGenResult(res);
      await fetchCodes();
      fetchQuota();
      toast.success(genScope === 'videos'
        ? `已生成 ${res.length} 个码（每张只开选中的 ${pickedVideos.length} 节）`
        : `已生成 ${res.length} 个音标兑换码（开整个音标视频库）`);
    } catch (error) { toast.error(getErrorMessage(error, '生成音标兑换码失败，请检查参数后重试')); }
    finally { setGenerating(false); }
  };

  const handleDisable = async (codeId: number) => {
    if (!confirm(isOrg ? '确定要禁用此音标兑换码吗？\n\n禁用后学生不能再兑换，额度不退回。' : '确定要禁用此音标兑换码吗？')) return;
    try { await disablePhoneticCode(codeId); fetchCodes(); fetchQuota(); }
    catch { toast.error('禁用兑换码失败，请重试'); }
  };

  const handleDelete = async (item: PhoneticCode) => {
    if (!confirm(`确定删除音标兑换码 ${item.code} 吗？\n\n删除后学生不能再兑换，不可恢复${isOrg ? '，额度不退回' : ''}。\n删掉的码在状态筛选「已删除」里还能查到。`)) return;
    try { await deletePhoneticCode(item.id); toast.success('兑换码已删除'); fetchCodes(); fetchQuota(); }
    catch (error) { toast.error(getErrorMessage(error, '删除兑换码失败，请重试')); }
  };

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(genResult.map((c) => c.code).join('\n'));
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    } catch { toast.warning('当前浏览器不允许复制，请手动选择兑换码'); }
  };
  const copyOne = async (code: string, id: number) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedId(id); setTimeout(() => setCopiedId(null), 1500);
    } catch { toast.warning('当前浏览器不允许复制，请手动选择兑换码'); }
  };

  const formatGrantType = (c: PhoneticCode) => {
    if (!c.grant_type || c.grant_type === 'permanent') return '永久';
    if (c.grant_type === 'period') return `包月 ${c.grant_days || 0} 天`;
    if (c.grant_type === 'times') return `次卡 ${c.grant_times || 0} 天`;
    return c.grant_type;
  };

  // 「开通范围」列: 整库 / 只开一节「x」/ 只开 N 节「a」「b」…(完整列表放 title 里悬停看)
  const scopeTitles = (c: PhoneticCode) => (c.videos || []).map((v) => `「${v.title || `#${v.id}`}」`);
  const formatScope = (c: PhoneticCode) => {
    if (c.scope !== 'videos') return '整个音标库';
    const ts = scopeTitles(c);
    if (ts.length === 0) return '指定的视频已全部删除';
    if (ts.length === 1) return `只开${ts[0]}`;
    return `只开 ${ts.length} 节：${ts.join('')}`;
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section className="mt-8 rounded-2xl border border-indigo-200 bg-indigo-50/40 p-5 sm:p-6">
      <div className="mb-1 flex items-center gap-2">
        <h2 className="text-lg font-bold text-gray-800">音标视频兑换码</h2>
        <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-700">{isOrg ? '本机构码' : '平台码'}</span>
      </div>
      {isOrg && quota && (
        <div className={`mb-3 rounded-xl px-4 py-3 text-sm ${noQuota ? 'bg-amber-50 text-amber-800' : 'bg-white text-gray-700 shadow-sm'}`}>
          {noQuota
            ? '平台还没有给本机构发放音标兑换码额度，暂时不能生成。请联系平台开通（开通后这里会显示可发张数）。'
            : <>音标码额度：已发 <strong>{quota.phonetic_codes_used ?? 0}</strong> / {quotaTotal} 张，剩 <strong className={quotaLeft === 0 ? 'text-red-600' : 'text-indigo-700'}>{quotaLeft}</strong> 张。<strong>生成即占额度，禁用或删除都不退回</strong>；码不过期，学生兑换那天才开始计时；这些码只有本机构学生能兑换。</>}
        </div>
      )}
      <p className="mb-4 text-xs leading-relaxed text-gray-500">
        一张码可以开<strong>整个音标视频库</strong>,也可以<strong>只开其中几节</strong>(下面「开通范围」里选「指定几节」再勾视频)。只对「音标开通方式 = 需兑换码」的机构有意义
        (在机构管理里切换);其余机构学生本就免费看音标。学生在音标页点锁着的那一节 →「去输入兑换码」,或首页「我的书架 → 兑换教材」里输入激活(两处是同一个兑换框,后端按码自动分流)。
      </p>

      {/* 生成区 */}
      <div className="rounded-xl bg-white p-4 shadow-sm">
        {/* 开通范围 */}
        <div className="mb-4">
          <label className="mb-1.5 block text-sm font-medium text-gray-700">开通范围</label>
          <div className="flex flex-wrap gap-2">
            {(['library', 'videos'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setGenScope(s)}
                aria-pressed={genScope === s}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                  genScope === s
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                {s === 'library' ? '整个音标视频库' : '指定几节'}
              </button>
            ))}
          </div>
          {genScope === 'videos' && (
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text" value={videoKw}
                  onChange={(e) => setVideoKw(e.target.value)}
                  placeholder="搜标题 / 音标 / 讲师"
                  aria-label="搜索视频"
                  className="w-full max-w-xs rounded-lg border border-gray-200 px-3 py-1.5 text-sm"
                />
                <span className="text-sm text-gray-600" aria-live="polite">
                  已选 <strong className="text-indigo-700">{pickedVideos.length}</strong> 节
                </span>
                {pickedVideos.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setPicked(new Set())}
                    className="text-xs font-medium text-gray-500 hover:text-gray-700 hover:underline"
                  >
                    清空
                  </button>
                )}
              </div>

              <div className="max-h-80 overflow-y-auto rounded-lg border border-gray-200">
                {videos === null ? (
                  <p className="px-3 py-6 text-center text-sm text-gray-400">加载中…</p>
                ) : groups.length === 0 ? (
                  <p className="px-3 py-6 text-center text-sm text-gray-400">
                    {videoKw.trim() ? '没有符合搜索的视频' : '没有可选的视频(只列已上架的)'}
                  </p>
                ) : groups.map((g) => {
                  const selectable = g.items.filter((v) => !blockedByOrg(v));
                  const allOn = selectable.length > 0 && selectable.every((v) => picked.has(v.id));
                  return (
                    <fieldset key={g.label} className="border-b border-gray-100 last:border-b-0">
                      <legend className="sr-only">{g.label}</legend>
                      <div className="sticky top-0 z-[1] flex items-center justify-between bg-gray-50 px-3 py-1.5">
                        <span className="text-xs font-semibold text-gray-600">
                          {g.label} · {g.items.length} 节
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleGroup(g.items)}
                          disabled={selectable.length === 0}
                          aria-label={`${allOn ? '取消全选' : '全选'}${g.label}`}
                          className="text-xs font-medium text-indigo-600 hover:underline disabled:cursor-not-allowed disabled:text-gray-300"
                        >
                          {allOn ? '取消本组' : '全选本组'}
                        </button>
                      </div>
                      {g.items.map((v) => {
                        const blocked = blockedByOrg(v);
                        const meta = videoMeta(v);
                        return (
                          <label
                            key={v.id}
                            title={blocked ? '已选了别的机构的视频,一张码只能开同一个机构的' : undefined}
                            className={`flex items-center gap-3 px-3 py-2 text-sm ${
                              blocked ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:bg-indigo-50/50'
                            } ${picked.has(v.id) ? 'bg-indigo-50/70' : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={picked.has(v.id)}
                              disabled={blocked}
                              onChange={() => togglePick(v.id)}
                              className="h-4 w-4 shrink-0 accent-indigo-600"
                            />
                            {v.phonetic_symbol && (
                              <span className="w-12 shrink-0 font-mono text-indigo-700">{v.phonetic_symbol}</span>
                            )}
                            <span className="min-w-0 flex-1 truncate text-gray-800">{v.title}</span>
                            {meta && <span className="shrink-0 text-xs text-gray-400">{meta}</span>}
                          </label>
                        );
                      })}
                    </fieldset>
                  );
                })}
              </div>
              <p className="text-xs text-gray-500">
                学生兑这批码只能看勾选的这几节,别的节照旧锁着。只列已上架的视频;某节被删除后,没用掉的码里会去掉那一节(全删光的码自动作废)。
                {!isOrg && ' 一张码只能开同一个机构的视频,平台预置的可以和任何一家混选。'}
              </p>
            </div>
          )}
        </div>

        {/* 卡种 */}
        <div className="mb-4">
          <label className="mb-1.5 block text-sm font-medium text-gray-700">卡种</label>
          <div className="flex flex-wrap gap-2">
            {grantTypes.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setGenGrantType(t)}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                  genGrantType === t
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                {t === 'permanent' ? '永久（一直可看）' : t === 'period' ? '包月（按天计时）' : '次卡（按学习天计次）'}
              </button>
            ))}
          </div>
          {genGrantType === 'period' && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {dayPresets.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setGenGrantDays(d)}
                  className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                    genGrantDays === d ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600'
                  }`}
                >
                  {DAYS_PRESET_LABELS[d]}
                </button>
              ))}
              <input
                type="number" min={1} max={policy.max_grant_days} value={genGrantDays}
                onChange={(e) => setGenGrantDays(Number(e.target.value))}
                className="w-24 rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
              />
              <span className="text-sm text-gray-500">天(从兑换那天算起)</span>
            </div>
          )}
          {genGrantType === 'times' && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                type="number" min={1} max={1000} value={genGrantTimes}
                onChange={(e) => setGenGrantTimes(Number(e.target.value))}
                className="w-24 rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
              />
              <span className="text-sm text-gray-500">个「学习天」(进去看的那天才扣一天,不看不扣)</span>
            </div>
          )}
        </div>

        {/* 数量 / 备注 / 生成 */}
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">生成数量</label>
            <input
              type="number" min={1} max={100} value={genCount}
              onChange={(e) => setGenCount(Number(e.target.value))}
              className="w-24 rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
          </div>
          <div className="min-w-[12rem] flex-1">
            <label className="mb-1.5 block text-sm font-medium text-gray-700">批次备注(可选)</label>
            <input
              type="text" maxLength={200} value={genNote}
              onChange={(e) => setGenNote(e.target.value)}
              placeholder="如:2026 秋季音标班"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
          </div>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating || noQuota}
            className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
          >
            {generating ? '生成中…' : '生成兑换码'}
          </button>
        </div>

        {/* 生成结果 */}
        {genResult.length > 0 && (
          <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50/60 p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-indigo-900">
                刚生成的 {genResult.length} 个码
                <span className="ml-1 font-normal text-indigo-700">· {genResult[0] ? formatScope(genResult[0]) : ''}</span>
              </p>
              <button
                type="button"
                onClick={copyAll}
                className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-indigo-700 shadow-sm transition hover:bg-indigo-50"
              >
                <Copy className="h-3.5 w-3.5" /> {copied ? '已复制' : '全部复制'}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {genResult.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => copyOne(c.code, c.id)}
                  className="rounded-lg bg-white px-2 py-1.5 text-center font-mono text-sm text-gray-700 shadow-sm transition hover:bg-indigo-50"
                  title="点击复制"
                >
                  {copiedId === c.id ? '✓ 已复制' : c.code}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 列表 */}
      <div className="mt-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-base font-bold text-gray-800">音标兑换码列表</h3>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text" value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜码片段/备注/视频名"
                className="w-48 rounded-lg border border-gray-200 py-1.5 pl-8 pr-2 text-sm"
              />
            </div>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
            >
              <option value="">全部状态</option>
              <option value="unused">未使用</option>
              <option value="used">已使用</option>
              <option value="disabled">已禁用</option>
              <option value="expired">已过期</option>
              <option value="deleted">已删除</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-gray-600">
                <th className="px-4 py-3">兑换码</th>
                <th className="px-4 py-3">开通范围</th>
                <th className="px-4 py-3">卡种</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">创建人</th>
                <th className="px-4 py-3">创建时间</th>
                <th className="px-4 py-3">备注</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {codes.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-gray-400">
                    {debouncedSearch || filterStatus ? '没有符合条件的兑换码' : '还没有生成任何音标兑换码'}
                  </td>
                </tr>
              ) : (
                codes.map((c) => (
                  <tr key={c.id} className="border-t border-gray-50">
                    <td className="px-4 py-3 font-mono">{c.code}</td>
                    <td className="max-w-[14rem] truncate px-4 py-3 text-gray-700" title={formatScope(c)}>{formatScope(c)}</td>
                    <td className="px-4 py-3">{formatGrantType(c)}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_MAP[c.status]?.color || 'bg-gray-100 text-gray-500'}`}>
                        {STATUS_MAP[c.status]?.label || c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{c.created_by_name || (c.created_by ? `#${c.created_by}` : '—')}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {c.created_at ? new Date(c.created_at).toLocaleDateString('zh-CN') : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{c.batch_note || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        {c.status === 'unused' && (
                          <button
                            type="button"
                            onClick={() => handleDisable(c.id)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-orange-600 hover:underline"
                          >
                            <Ban className="h-3.5 w-3.5" /> 禁用
                          </button>
                        )}
                        {/* 已使用的码不给删(是学生兑换凭证,后端也会拒) */}
                        {c.status !== 'used' && c.status !== 'deleted' && (
                          <button
                            type="button"
                            onClick={() => handleDelete(c)}
                            className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:underline"
                          >
                            <Trash2 className="h-3.5 w-3.5" /> 删除
                          </button>
                        )}
                        {c.status === 'used' && (
                          <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                            <Check className="h-3.5 w-3.5" /> 已兑换
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* 分页 */}
        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm disabled:opacity-50"
            >
              上一页
            </button>
            <span className="text-sm text-gray-600">{page} / {totalPages}</span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm disabled:opacity-50"
            >
              下一页
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
