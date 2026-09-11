import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  getSubscriptionStats,
  generateCodes,
  listCodes,
  disableCode,
  deleteCode,
  getBookGroups,
  getCardPolicy,
  type BookGroup,
  type BookStage,
  type CardPolicy,
} from '../api/subscription';
import { Ban, Check, Clock3, Search, Ticket, Trash2, X } from 'lucide-react';
import StaffWorkspaceHeader from '../components/staff/StaffWorkspaceHeader';
import { toast } from '../components/Toast';
import { getErrorMessage } from '../utils/errorMessage';

interface Stats {
  total_codes: number;
  unused_codes: number;
  used_codes: number;
  expired_codes: number;
  disabled_codes: number;
  // 学习卡额度(仅机构下发;平台 admin 全为 null → 整块不显示)
  card_quota?: number | null;
  cards_used?: number | null;
  cards_left?: number | null;
  card_quota_explicit?: boolean | null;
  renewal_min?: number | null;
}

interface CodeItem {
  id: number;
  code: string;
  book_id: number;
  book_name?: string;
  status: string;
  created_by: number;
  created_at: string;
  code_expires_at: string;
  used_by: number | null;
  used_at: string | null;
  batch_note: string | null;
  created_by_name?: string | null;
  grant_type: string;
  grant_days?: number | null;
  grant_times?: number | null;
  // 一码多书
  scope_kind?: string;
  scope_series?: string | null;
  scope_stage?: BookStage | null;
  book_count?: number;
  books?: { id: number; name: string }[];
}

const STATUS_MAP: Record<string, { label: string; color: string }> = {
  unused: { label: '未使用', color: 'bg-green-100 text-green-700' },
  used: { label: '已使用', color: 'bg-blue-100 text-blue-700' },
  expired: { label: '已过期', color: 'bg-gray-100 text-gray-500' },
  disabled: { label: '已禁用', color: 'bg-red-100 text-red-600' },
};

// 包月常用档:运营 90% 的场景是这几个,免得每次手敲。
// 超过当前身份上限的档位会被过滤掉(机构只剩 30/90/180),别在这里写死两份。
const DAYS_PRESETS = [30, 90, 180, 365];

const DAYS_PRESET_LABELS: Record<number, string> = {
  30: '1个月', 90: '3个月', 180: '半年', 365: '1年',
};

const GRANT_TYPE_FALLBACK_LABELS: Record<string, string> = {
  permanent: '永久（一直可学）',
  period: '包月（按天计时）',
  times: '次卡（按学习天计次）',
};

/** 学段 key → 中文名的**兜底**表(2026-09-11 学段改成真字段后)。
 *
 * 优先用后端 book-groups 下发的 label(那才是真源,机构自建学段只有它认得);
 * 这张表只用于「列表里回看一张老码的 scope_stage」这种拿不到 label 的场合。
 * ⚠️ 不要往里加机构自建的学段名 —— 各机构自建的名字不同,写死一份必然错。 */
const LEGACY_STAGE_LABELS: Record<string, string> = {
  primary: '小学', junior: '初中', senior: '高中',
  other: '其他', unassigned: '未分类',
};

const AdminSubscriptions = () => {
  const [stats, setStats] = useState<Stats | null>(null);
  const [codes, setCodes] = useState<CodeItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filterStatus, setFilterStatus] = useState('');
  // 搜索:输入框即时回显 search,防抖后的 debouncedSearch 才触发请求
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [genCount, setGenCount] = useState(10);
  const [genNote, setGenNote] = useState('');
  const [genGrantType, setGenGrantType] = useState('permanent'); // 卡种: permanent/period/times
  const [genGrantDays, setGenGrantDays] = useState(30);  // 包月默认 30 天
  const [genGrantTimes, setGenGrantTimes] = useState(7); // 次卡默认 7 天
  // 能发什么卡由后端说(机构=只能包月、最长半年);policy 到达前先按最紧的假设
  // 渲染,免得机构管理员看到永久卡一闪而过
  const [policy, setPolicy] = useState<CardPolicy | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState<CodeItem[]>([]);
  const [copied, setCopied] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  // 选书:分组 → 学段 → 勾书(勾选是最终真源,分组/学段只是筛选器)
  const [groups, setGroups] = useState<BookGroup[]>([]);
  const [genSeries, setGenSeries] = useState<string>('');
  const [genStage, setGenStage] = useState<BookStage | ''>('');
  const [pickedIds, setPickedIds] = useState<number[]>([]);
  // 列表里展开看某张码开了哪些书
  const [expandedCode, setExpandedCode] = useState<number | null>(null);

  const fetchGroups = useCallback(async () => {
    try {
      const res: any = await getBookGroups();
      const gs: BookGroup[] = res.groups || [];
      setGroups(gs);
      // 默认落在第一个有书的分组,省一次点击
      if (gs.length > 0) setGenSeries(prev => (prev === '' ? gs[0].series : prev));
    } catch { toast.error('单词本分组加载失败，请刷新重试'); }
  }, []);

  // 当前分组下的学段档位
  const currentGroup = groups.find(g => g.series === genSeries);
  const stageList = currentGroup?.stages || [];
  // 当前「分组+学段」筛出来的候选书(学段留空=该分组全部)
  const candidateBooks = genStage
    ? (stageList.find(s => s.stage === genStage)?.books || [])
    : stageList.flatMap(s => s.books);

  // 切分组/学段时,把已勾选里不在候选中的剔掉 —— 否则会悄悄发出别的分组的书
  useEffect(() => {
    const allowed = new Set(candidateBooks.map(b => b.id));
    setPickedIds(prev => {
      const next = prev.filter(id => allowed.has(id));
      return next.length === prev.length ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genSeries, genStage, groups]);

  const togglePick = (id: number) =>
    setPickedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const pickAll = () => setPickedIds(candidateBooks.map(b => b.id));
  const pickNone = () => setPickedIds([]);
  // 「整段都勾上了」—— 用来把整段开卡的按钮切成已完成态。
  // 比长度相等更严:候选变了但数量恰好相同时(切学段)不能误判成已选
  const wholeStagePicked = candidateBooks.length > 0 &&
    candidateBooks.every(b => pickedIds.includes(b.id));

  const fetchPolicy = useCallback(async () => {
    try {
      const res = (await getCardPolicy()) as unknown as CardPolicy;
      setPolicy(res);
      // 当前选中的卡种若不在白名单里(机构默认落在永久卡上),换成第一个可用的,
      // 并把时长夹到上限内 —— 否则表单一打开就是个必被 403 的组合
      const allowed: string[] = res.allowed_grant_types || [];
      setGenGrantType(prev => (allowed.includes(prev) ? prev : allowed[0] || prev));
      setGenGrantDays(prev => Math.min(prev, res.max_grant_days ?? prev));
      if (res.max_grant_times != null) {
        setGenGrantTimes(prev => Math.min(prev, res.max_grant_times));
      }
      // 机构只有一种卡种时,默认落在协议口径的半年上(最常用的那一档)
      if (allowed.length === 1 && allowed[0] === 'period' && res.default_grant_days) {
        setGenGrantDays(res.default_grant_days);
      }
    } catch { /* 政策拿不到就沿用默认表单,发码时后端仍会拦 */ }
  }, []);

  const fetchStats = useCallback(async () => {
    try {
      const res: any = await getSubscriptionStats();
      setStats(res);
    } catch { toast.error('兑换码统计加载失败'); }
  }, []);

  const fetchCodes = useCallback(async () => {
    try {
      const params: any = { page, page_size: 20 };
      if (filterStatus) params.status = filterStatus;
      if (debouncedSearch) params.search = debouncedSearch;
      const res: any = await listCodes(params);
      setCodes(res.codes);
      setTotal(res.total);
    } catch { toast.error('兑换码列表加载失败，请刷新重试'); }
  }, [page, filterStatus, debouncedSearch]);

  // 输入防抖 300ms,别每敲一个字符打一次接口
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // 换关键词/换筛选后回到第 1 页,否则停在第 3 页会显示空列表让人以为没搜到
  useEffect(() => { setPage(1); }, [debouncedSearch, filterStatus]);

  useEffect(() => { fetchGroups(); fetchStats(); fetchPolicy(); }, [fetchGroups, fetchStats, fetchPolicy]);
  useEffect(() => { fetchCodes(); }, [fetchCodes]);

  const handleGenerate = async () => {
    if (pickedIds.length === 0) { toast.warning('请先勾选要开通的单词本'); return; }
    if (genCount < 1 || genCount > 100) { toast.warning('生成数量需在 1～100 之间'); return; }
    // 额度不够就当场说清差多少,别等后端 403 —— 后端仍然是权威(并发下额度可能刚被用掉)
    if (hasCardQuota && genCount > cardsLeft) {
      toast.warning(
        cardsLeft === 0
          ? `学习卡额度已用完（${cardsUsed}/${cardQuota} 张），请联系平台续卡`
          : `学习卡额度只剩 ${cardsLeft} 张，本次要发 ${genCount} 张。请减少数量或联系平台续卡`
      );
      return;
    }
    setGenerating(true);
    setGenResult([]);
    try {
      const payload: any = {
        count: genCount,
        book_ids: pickedIds,
        batch_note: genNote || undefined,
        grant_type: genGrantType,
      };
      if (genGrantType === 'period') payload.grant_days = genGrantDays;
      if (genGrantType === 'times') payload.grant_times = genGrantTimes;
      // 发码条件留痕(仅展示/追溯):只在按整档勾选时记,免得写个误导的条件
      if (genSeries) payload.scope_series = genSeries;
      if (genStage && pickedIds.length === candidateBooks.length) payload.scope_stage = genStage;
      const res: any = await generateCodes(payload);
      setGenResult(res);
      await Promise.all([fetchStats(), fetchCodes()]);
      toast.success(
        pickedIds.length > 1
          ? `已生成 ${res.length} 个兑换码，每个可开通 ${pickedIds.length} 本单词本`
          : `已生成 ${res.length} 个兑换码`
      );
    } catch (error) { toast.error(getErrorMessage(error, '生成兑换码失败，请检查参数后重试')); }
    finally { setGenerating(false); }
  };

  const handleDisable = async (codeId: number) => {
    if (!confirm('确定要禁用此兑换码吗？')) return;
    try {
      await disableCode(codeId);
      fetchCodes();
      fetchStats();
    } catch { toast.error('禁用兑换码失败，请重试'); }
  };

  const handleDelete = async (item: CodeItem) => {
    // 删除不可恢复,确认文案里带上码本身,避免点错行删掉别的码
    if (!confirm(`确定删除兑换码 ${item.code} 吗？\n\n删除后该码从列表彻底消失，不可恢复。\n如果只是想让它失效并留个记录，请用「禁用」。`)) return;
    try {
      await deleteCode(item.id);
      toast.success('兑换码已删除');
      fetchCodes();
      fetchStats();
    } catch (error) { toast.error(getErrorMessage(error, '删除兑换码失败，请重试')); }
  };

  const copyAllCodes = async () => {
    const text = genResult.map((c) => c.code).join('\n');
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { toast.warning('当前浏览器不允许复制，请手动选择兑换码'); }
  };

  const copySingleCode = async (code: string, id: number) => {
    try { await navigator.clipboard.writeText(code); setCopiedId(id); setTimeout(() => setCopiedId(null), 1500); }
    catch { toast.warning('当前浏览器不允许复制，请手动选择兑换码'); }
  };

  /** 学段 key → 显示名。优先用后端下发的 label(机构自建学段只有它认得),
   *  再落兜底表,最后原样显示 key —— 绝不在前端按 key 猜中文名。 */
  const stageLabelOf = (key: string): string => {
    for (const g of groups) {
      const hit = g.stages.find(s => s.stage === key);
      if (hit) return hit.label;
    }
    return LEGACY_STAGE_LABELS[key] || key;
  };

  /** 一张码开了什么:单书显示书名,多书显示「人教版·小学 14 本」 */
  const describeScope = (c: CodeItem) => {
    const n = c.book_count ?? 1;
    if (n <= 1) return c.book_name || c.books?.[0]?.name || `书#${c.book_id}`;
    const parts: string[] = [];
    if (c.scope_series) parts.push(c.scope_series);
    if (c.scope_stage) parts.push(stageLabelOf(c.scope_stage));
    const prefix = parts.join('·');
    return prefix ? `${prefix} ${n} 本` : `${n} 本单词本`;
  };

  // 卡额度: 只有机构才有(平台 admin 不限额,后端给 null → 整块不渲染)。
  // 判空用 != null 而不是真值判断 —— cards_left 为 0 是"用完了"这个最该显示的状态,
  // 用 `stats?.cards_left &&` 会把它当成假值整块藏起来
  const hasCardQuota = stats?.card_quota != null;
  const cardQuota = stats?.card_quota ?? 0;
  const cardsUsed = stats?.cards_used ?? 0;
  const cardsLeft = stats?.cards_left ?? 0;

  // 表单可选项一律从 policy 推导。policy 未到达时按「后端默认放行的全集」画,
  // 但机构会在 fetchPolicy 回来后立刻收窄(它拿到的 allowed 只有 period)
  const grantTypeOptions = policy?.allowed_grant_types?.length
    ? policy.allowed_grant_types
    : ['permanent', 'period', 'times'];
  const maxGrantDays = policy?.max_grant_days ?? 3650;
  const isOrgLimited = policy?.role === 'org_admin';
  const grantTypeLabel = (t: string) =>
    policy?.grant_type_labels?.[t] || GRANT_TYPE_FALLBACK_LABELS[t] || t;

  const formatGrantType = (c: CodeItem) => {
    if (!c.grant_type || c.grant_type === 'permanent') return '永久';
    if (c.grant_type === 'period') return `包月 ${c.grant_days || 0} 天`;
    if (c.grant_type === 'times') return `次卡 ${c.grant_times || 0} 天`;
    return c.grant_type;
  };

  const exportCSV = () => {
    const header = '兑换码,绑定书籍,本数,卡种,创建人,状态,创建时间,使用时间,备注';
    const rows = codes.map((c) =>
      [
        c.code,
        // CSV 里书名可能含逗号,整列加引号包住,否则列会错位
        `"${describeScope(c).replace(/"/g, '""')}"`,
        c.book_count ?? 1,
        formatGrantType(c),
        c.created_by_name || `#${c.created_by}`,
        STATUS_MAP[c.status]?.label || c.status,
        new Date(c.created_at).toLocaleDateString('zh-CN'),
        c.used_at ? new Date(c.used_at).toLocaleDateString('zh-CN') : '',
        c.batch_note || '',
      ].join(',')
    );
    const csv = '\uFEFF' + [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `兑换码_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalPages = Math.ceil(total / 20);

  return (
    <div className="admin-legacy-page min-h-screen">
      <StaffWorkspaceHeader role="admin" title="书籍兑换码管理" subtitle="生成兑换码，学生兑换后解锁对应单词本" icon={Ticket} />

      <main className="admin-workspace-main">

        {/* 学习卡额度(机构专属) —— 放在最上面:发码前先知道还剩几张。
            学习卡与学生名额是两笔账,这里只讲卡,免得机构把「发不出卡」当成「学生满了」 */}
        {hasCardQuota && (
          <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/70 p-4 sm:p-5">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold text-amber-900">学习卡额度</h2>
                <p className="mt-1 text-2xl font-bold text-amber-900">
                  已发 {cardsUsed} / {cardQuota} 张
                  <span className="ml-2 text-sm font-semibold text-amber-700">
                    还剩 {cardsLeft} 张
                  </span>
                </p>
              </div>
              <p className="max-w-md text-xs leading-relaxed text-amber-800">
                每张 = 一个学生的一份半年卡（{maxGrantDays} 天，从兑换那天算起）。
                同一个学生学满一年要两张：到期前再发一张给他兑换即可，有效期从原到期日往后接。
                {stats?.renewal_min
                  ? `额度用完请联系平台续卡（${stats.renewal_min} 张起，无需另签合同）。`
                  : '额度用完请联系平台续卡。'}
                生成错的批次删掉后额度会退回来。
              </p>
            </div>
            {/* 水位条:数字之外给个一眼可见的余量,快见底时变红 */}
            <div
              className="mt-3 h-2 w-full overflow-hidden rounded-full bg-amber-200/70"
              role="progressbar"
              aria-valuenow={cardsUsed}
              aria-valuemin={0}
              aria-valuemax={cardQuota}
              aria-label={`学习卡额度已发 ${cardsUsed} 张，共 ${cardQuota} 张`}
            >
              <div
                className={`h-full rounded-full transition-all ${
                  cardsLeft === 0 ? 'bg-red-500' : cardsLeft <= 10 ? 'bg-orange-500' : 'bg-amber-500'
                }`}
                style={{ width: `${cardQuota > 0 ? Math.min(100, (cardsUsed / cardQuota) * 100) : 0}%` }}
              />
            </div>
            {cardsLeft === 0 && (
              <p className="mt-2 text-xs font-semibold text-red-700">
                额度已用完，现在发不出新卡。已经发出去的卡不受影响，学生照常使用。
              </p>
            )}
          </div>
        )}

        {/* 统计卡片 */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {[
              { label: '未使用', value: stats.unused_codes, icon: Ticket, tone: 'green' },
              { label: '已使用', value: stats.used_codes, icon: Check, tone: 'blue' },
              { label: '已过期', value: stats.expired_codes, icon: Clock3, tone: 'orange' },
              { label: '已禁用', value: stats.disabled_codes, icon: Ban, tone: 'violet' },
            ].map((item) => (
              <div key={item.label} className="admin-stat-strip rounded-2xl p-4">
                <item.icon className={`mb-3 h-5 w-5 admin-tool-icon admin-tool-icon-${item.tone} rounded-lg p-1`} />
                <div className="text-2xl font-bold text-gray-800">{item.value}</div>
                <div className="text-sm text-gray-500">{item.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* 生成兑换码 */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 sm:p-6 mb-6">
          <h2 className="text-lg font-bold text-gray-800 mb-1">生成兑换码</h2>
          <p className="text-xs text-slate-500 mb-4">
            一张卡可以开一批书：先选单词本分组，再选学段，然后勾选要开通的书。
          </p>

          {/* ① 选书:分组 → 学段 → 勾书 */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 mb-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="min-w-[180px]">
                <label className="block text-sm text-gray-600 mb-1">单词本分组</label>
                <select
                  value={genSeries}
                  onChange={(e) => { setGenSeries(e.target.value); setGenStage(''); }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#3976a9]/30"
                >
                  {groups.length === 0 && <option value="">暂无单词本</option>}
                  {groups.map((g) => (
                    <option key={g.series || '__none__'} value={g.series}>
                      {g.series_label}（{g.total} 本）
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1">
                <label className="block text-sm text-gray-600 mb-1">学段</label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setGenStage('')}
                    className={`min-h-9 rounded-lg border px-3 text-sm ${
                      genStage === ''
                        ? 'border-[#3976a9] bg-[#3976a9] text-white'
                        : 'border-slate-300 bg-white text-slate-600 hover:border-[#3976a9]'
                    }`}
                  >
                    全部（{stageList.reduce((n, s) => n + s.count, 0)} 本）
                  </button>
                  {stageList.map((s) => (
                    <button
                      key={s.stage}
                      type="button"
                      onClick={() => setGenStage(s.stage)}
                      className={`min-h-9 rounded-lg border px-3 text-sm ${
                        genStage === s.stage
                          ? 'border-[#3976a9] bg-[#3976a9] text-white'
                          : 'border-slate-300 bg-white text-slate-600 hover:border-[#3976a9]'
                      }`}
                      title={s.stage === 'unassigned' || s.stage === 'other'
                        ? '还没设学段的书都在这里(课外书/总复习等),可以正常发码;要归类请去教师端单词本页设置学段'
                        : undefined}
                    >
                      {s.label}（{s.count} 本）
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 整段开卡:选了学段直接「开这一整段」,不必一本本勾。
                一张卡开一整段仍然只算 1 张额度(权益厚度不是名额,与一码多书同口径) */}
            {genStage && candidateBooks.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-[#3976a9]/25 bg-white px-3 py-2">
                <span className="text-sm text-slate-600">
                  要开整个<strong className="text-[#3976a9]">
                    {stageLabelOf(genStage)}
                  </strong>段？
                </span>
                <button
                  type="button"
                  onClick={pickAll}
                  disabled={wholeStagePicked}
                  className={`min-h-8 rounded-lg px-3 text-xs font-semibold ${
                    wholeStagePicked
                      ? 'cursor-default bg-green-50 text-green-700'
                      : 'bg-[#3976a9] text-white hover:bg-[#2e628f]'
                  }`}
                >
                  {wholeStagePicked
                    ? `✓ 已选整段 ${candidateBooks.length} 本`
                    : `开这一整段（${candidateBooks.length} 本）`}
                </button>
                <span className="text-xs text-slate-500">
                  一张卡开一整段，仍然只占 1 张学习卡额度
                </span>
              </div>
            )}

            {/* 勾书 */}
            <div className="mt-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm text-gray-600">
                  勾选要开通的书
                  <span className="ml-2 font-semibold text-[#3976a9]">
                    已选 {pickedIds.length} / {candidateBooks.length} 本
                  </span>
                </span>
                <span className="flex gap-2">
                  <button type="button" onClick={pickAll}
                    className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 hover:border-[#3976a9]">
                    全选
                  </button>
                  <button type="button" onClick={pickNone}
                    className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 hover:border-[#3976a9]">
                    清空
                  </button>
                </span>
              </div>
              {candidateBooks.length === 0 ? (
                <p className="rounded-lg bg-white px-3 py-4 text-center text-sm text-slate-400">
                  这个分组/学段下暂无单词本
                </p>
              ) : (
                <div className="grid max-h-52 grid-cols-1 gap-1.5 overflow-y-auto rounded-lg bg-white p-2 sm:grid-cols-2 lg:grid-cols-3">
                  {candidateBooks.map((b) => {
                    const on = pickedIds.includes(b.id);
                    return (
                      <label
                        key={b.id}
                        className={`flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-sm ${
                          on ? 'border-[#3976a9] bg-[#3976a9]/[0.06]' : 'border-transparent hover:bg-slate-50'
                        }`}
                      >
                        <input type="checkbox" checked={on} onChange={() => togglePick(b.id)}
                          className="h-4 w-4 accent-[#3976a9]" />
                        <span className="truncate text-slate-700" title={b.name}>{b.name}</span>
                        {b.grade_level && (
                          <span className="ml-auto shrink-0 text-[11px] text-slate-400">{b.grade_level}</span>
                        )}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ② 卡种与时长(可选项由后端政策决定,机构只有「包月·最长半年」) */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 mb-4">
            {isOrgLimited && (
              <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
                {policy?.note}
                <br />
                半年到了以后不用重新签合同：再发一张卡给同一个学生兑换即可，
                有效期<strong>从原来的到期日往后接</strong>，中间不断档。
              </p>
            )}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="min-w-[150px]">
                <label className="block text-sm text-gray-600 mb-1">卡种</label>
                {grantTypeOptions.length === 1 ? (
                  // 只有一种可选时不画下拉:下拉里只有一项会让人以为还有别的没加载出来
                  <p className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700">
                    {grantTypeLabel(grantTypeOptions[0])}
                  </p>
                ) : (
                  <select
                    value={genGrantType}
                    onChange={(e) => setGenGrantType(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#3976a9]/30"
                  >
                    {grantTypeOptions.map((t) => (
                      <option key={t} value={t}>{grantTypeLabel(t)}</option>
                    ))}
                  </select>
                )}
              </div>
              {genGrantType === 'period' && (
                <div className="flex-1">
                  <label className="block text-sm text-gray-600 mb-1">
                    使用时长（天）—— 从学生兑换那天开始算
                    {isOrgLimited && <span className="text-amber-700">，最长 {maxGrantDays} 天</span>}
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    {DAYS_PRESETS.filter((d) => d <= maxGrantDays).map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setGenGrantDays(d)}
                        className={`min-h-9 rounded-lg border px-3 text-sm ${
                          genGrantDays === d
                            ? 'border-[#3976a9] bg-[#3976a9] text-white'
                            : 'border-slate-300 bg-white text-slate-600 hover:border-[#3976a9]'
                        }`}
                      >
                        {DAYS_PRESET_LABELS[d] || `${d} 天`}
                      </button>
                    ))}
                    <input
                      type="number"
                      min={1} max={maxGrantDays}
                      value={genGrantDays}
                      onChange={(e) => setGenGrantDays(
                        // 上限就地夹住,别让人填了 365 点生成才吃 403
                        Math.min(maxGrantDays, Math.max(1, Number(e.target.value) || 1))
                      )}
                      className="w-24 px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#3976a9]/30"
                    />
                    <span className="text-sm text-slate-500">天</span>
                  </div>
                </div>
              )}
              {genGrantType === 'times' && (
                <div className="flex-1">
                  <label className="block text-sm text-gray-600 mb-1">
                    可用天数 —— 只在学习的那天扣 1 天，没进不扣
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    {[7, 15, 30, 60].map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setGenGrantTimes(d)}
                        className={`min-h-9 rounded-lg border px-3 text-sm ${
                          genGrantTimes === d
                            ? 'border-[#3976a9] bg-[#3976a9] text-white'
                            : 'border-slate-300 bg-white text-slate-600 hover:border-[#3976a9]'
                        }`}
                      >
                        {d} 天
                      </button>
                    ))}
                    <input
                      type="number"
                      min={1} max={1000}
                      value={genGrantTimes}
                      onChange={(e) => setGenGrantTimes(Math.max(1, Number(e.target.value) || 1))}
                      className="w-24 px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#3976a9]/30"
                    />
                    <span className="text-sm text-slate-500">天</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ③ 数量/备注/生成 */}
          <div className="flex flex-col sm:flex-row sm:flex-wrap gap-4 items-stretch sm:items-end">
            <div>
              <label className="block text-sm text-gray-600 mb-1">数量</label>
              <input
                type="number"
                min={1} max={100}
                value={genCount}
                onChange={(e) => setGenCount(Math.min(100, Math.max(1, Number(e.target.value) || 1)))}
                className="w-full sm:w-24 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3976a9]/30"
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="block text-sm text-gray-600 mb-1">备注</label>
              <input
                type="text"
                value={genNote}
                onChange={(e) => setGenNote(e.target.value)}
                placeholder="可选备注，如「秋季班·人教小学」"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3976a9]/30"
              />
            </div>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={handleGenerate}
              disabled={generating || pickedIds.length === 0}
              className={`px-6 py-2 rounded-lg font-medium text-white ${
                generating || pickedIds.length === 0 ? 'bg-gray-400' : 'bg-[#3976a9] hover:bg-[#2e628f]'
              }`}
            >
              {generating ? '生成中...'
                : pickedIds.length > 1 ? `生成（每张开 ${pickedIds.length} 本）`
                : '生成'}
            </motion.button>
          </div>

          {/* 生成结果 */}
          {genResult.length > 0 && (
            <div className="mt-4 p-4 bg-green-50 rounded-lg border border-green-200">
              <div className="flex items-center justify-between mb-2">
                <span className="text-green-700 font-medium">
                  已生成 {genResult.length} 个兑换码
                </span>
                <button
                  onClick={copyAllCodes}
                  className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700"
                >
                  {copied ? '已复制!' : '复制全部'}
                </button>
              </div>
              <div className="max-h-40 overflow-y-auto font-mono text-sm space-y-1">
                {genResult.map((c) => (
                  <div key={c.id} className="text-green-800">{c.code}</div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 兑换码列表 */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-gray-800">兑换码列表</h2>
            <div className="flex items-center gap-3">
              <button
                onClick={exportCSV}
                disabled={codes.length === 0}
                className="px-3 py-1.5 bg-[#3976a9] text-white rounded-lg text-sm hover:bg-[#2e628f] disabled:opacity-40"
              >
                导出CSV
              </button>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜兑换码或批次备注"
                  aria-label="搜索兑换码或批次备注"
                  className="w-52 rounded-lg border border-slate-300 py-1.5 pl-8 pr-8 text-sm focus:border-[#3976a9] focus:outline-none focus:ring-2 focus:ring-[#3976a9]/15"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    aria-label="清空搜索"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <select
                value={filterStatus}
                onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
                className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm bg-white"
              >
                <option value="">全部状态</option>
                <option value="unused">未使用</option>
                <option value="used">已使用</option>
                <option value="expired">已过期</option>
                <option value="disabled">已禁用</option>
              </select>
            </div>
          </div>

          {debouncedSearch && (
            <p className="mb-3 text-xs text-slate-500">
              搜索「{debouncedSearch}」匹配 {total} 个兑换码
            </p>
          )}

          <div className="overflow-x-auto">
            <div className="sm:hidden space-y-2 pb-3">
              {codes.length === 0 ? <div className="py-8 text-center text-sm text-slate-400">暂无兑换码</div> : codes.map((c) => (
                <article key={c.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-center justify-between gap-3"><code className="font-mono text-xs font-semibold text-slate-800">{c.code}</code><span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_MAP[c.status]?.color || ''}`}>{STATUS_MAP[c.status]?.label || c.status}</span></div>
                  <div className="mt-2 text-xs text-slate-500">{describeScope(c)} · {formatGrantType(c)} · {c.created_by_name || `#${c.created_by}`} · 创建于 {new Date(c.created_at).toLocaleDateString('zh-CN')}</div>
                  <div className="mt-3 flex gap-3 border-t border-slate-100 pt-2 text-xs font-semibold"><button onClick={() => copySingleCode(c.code, c.id)} className="text-[#3976a9]">{copiedId === c.id ? '已复制' : '复制'}</button>{c.status === 'unused' && <button onClick={() => handleDisable(c.id)} className="text-orange-600">禁用</button>}{c.status !== 'used' && <button onClick={() => handleDelete(c)} className="text-red-600">删除</button>}</div>
                </article>
              ))}
            </div>
            <div className="hidden sm:block">
            <table className="w-full min-w-[760px] whitespace-nowrap text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="pb-2 pr-4">兑换码</th>
                  <th className="pb-2 pr-4">绑定书籍</th>
                  <th className="pb-2 pr-4">卡种</th>
                  <th className="pb-2 pr-4">创建人</th>
                  <th className="pb-2 pr-4">状态</th>
                  <th className="pb-2 pr-4">创建时间</th>
                  <th className="pb-2 pr-4">使用时间</th>
                  <th className="pb-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {codes.map((c) => (
                  <tr key={c.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70">
                    <td className="py-2.5 pr-4 font-mono text-xs">{c.code}</td>
                    <td className="py-2.5 pr-4">
                      {(c.book_count ?? 1) > 1 ? (
                        <button
                          type="button"
                          onClick={() => setExpandedCode(expandedCode === c.id ? null : c.id)}
                          className="rounded bg-indigo-50 px-2 py-0.5 text-xs text-indigo-700 hover:bg-indigo-100"
                          title="点击查看这张卡开了哪些书"
                        >
                          {describeScope(c)} {expandedCode === c.id ? '▴' : '▾'}
                        </button>
                      ) : (
                        <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">
                          {describeScope(c)}
                        </span>
                      )}
                      {expandedCode === c.id && c.books && (
                        <div className="mt-1 whitespace-normal text-[11px] leading-relaxed text-slate-500">
                          {c.books.map(b => b.name).join('、')}
                          {(c.book_count ?? 0) > c.books.length &&
                            `… 等 ${c.book_count} 本`}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 text-gray-600 text-xs">
                      {formatGrantType(c)}
                    </td>
                    <td className="py-2.5 pr-4 text-gray-600 text-xs">
                      {c.created_by_name || `#${c.created_by}`}
                    </td>
                    <td className="py-2.5 pr-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_MAP[c.status]?.color || ''}`}>
                        {STATUS_MAP[c.status]?.label || c.status}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 text-gray-500">
                      {new Date(c.created_at).toLocaleDateString('zh-CN')}
                    </td>
                    <td className="py-2.5 pr-4 text-gray-500">
                      {c.used_at ? new Date(c.used_at).toLocaleDateString('zh-CN') : '-'}
                    </td>
                    <td className="py-2.5">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => copySingleCode(c.code, c.id)}
                          className="text-[#00D9FF] hover:text-blue-600 text-xs"
                        >
                          {copiedId === c.id ? '已复制' : '复制'}
                        </button>
                        {c.status === 'unused' && (
                          <button
                            onClick={() => handleDisable(c.id)}
                            className="text-orange-600 hover:text-orange-700 text-xs"
                            title="禁用后码失效但仍留在列表里"
                          >
                            禁用
                          </button>
                        )}
                        {/* 已使用的码不给删按钮:它是学生兑换记录的凭证(后端也会拒) */}
                        {c.status !== 'used' && (
                          <button
                            onClick={() => handleDelete(c)}
                            className="inline-flex items-center gap-1 text-xs text-red-500 hover:text-red-700"
                            title="彻底删除,不可恢复"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            删除
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {codes.length === 0 && (
                  <tr>
                    {/* 表头是 8 列,colSpan 必须跟着,否则空态文字不居中、右侧留白 */}
                    <td colSpan={8} className="py-8 text-center text-gray-400">
                      暂无兑换码
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
          </div>

          {/* 分页 */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-4">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1}
                className="px-3 py-1 rounded border text-sm disabled:opacity-40"
              >
                上一页
              </button>
              <span className="text-sm text-gray-500">{page} / {totalPages}</span>
              <button
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                disabled={page === totalPages}
                className="px-3 py-1 rounded border text-sm disabled:opacity-40"
              >
                下一页
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default AdminSubscriptions;
