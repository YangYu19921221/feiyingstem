/**
 * 音标视频管理 — 教师端
 *
 * 上传 + 增删改查 + 搜索 + 分页。视频存服务器私有目录,学生登录后才能看。
 * 上传时**不填标题 → 自动取文件名(去扩展名)**,老师传完可再改。
 * 大文件必须有进度条,否则老师以为页面卡死会反复点。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  phoneticsApi, CATEGORY_LABELS, formatSize, NO_LECTURER,
  type PhoneticVideo, type PhoneticCategory, type LecturerStat,
} from '../api/phonetics';
import { toast } from '../components/Toast';
import { getErrorMessage } from '../utils/errorMessage';
import { Upload, Volume2 } from 'lucide-react';
import StaffWorkspaceHeader from '../components/staff/StaffWorkspaceHeader';
import MaterialManagerDialog from '../components/phonetics/MaterialManagerDialog';

const PAGE_SIZE = 10;
const CATEGORIES = Object.entries(CATEGORY_LABELS) as [PhoneticCategory, string][];
/** 分类默认封面(与学生端同一套图与版本号,老师看到的缩略图就是学生看到的) */
const COVER_V = 2;   // 换图时同步 PhoneticsHub 的 COVER_V,否则缓存里是旧图
const CATEGORY_COVER: Record<string, string> = {
  basic: `/phonics-basic.jpeg?v=${COVER_V}`,
  vowel: `/phonics-vowel.jpeg?v=${COVER_V}`,
  consonant: `/phonics-consonant.jpeg?v=${COVER_V}`,
  other: `/phonics-other.jpeg?v=${COVER_V}`,
};

export default function TeacherPhonetics() {
  const fileRef = useRef<HTMLInputElement>(null);

  const [items, setItems] = useState<PhoneticVideo[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [search, setSearch] = useState('');       // 真正提交给后端的关键词
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);   // 当前这个文件的百分比
  // 批量进度:第几个/共几个 + 当前文件名。null = 不在批量上传中
  const [batch, setBatch] = useState<{ done: number; total: number; name: string } | null>(null);

  // 编辑中的行
  const [editing, setEditing] = useState<PhoneticVideo | null>(null);
  const [editForm, setEditForm] = useState({ title: '', phonetic_symbol: '', category: 'basic', lecturer: '', description: '' });

  /**
   * 讲师名单(由现有视频聚合,不是教师账号列表)。用于:
   * ①上传前填「这批课是谁讲的」的自动补全 ②编辑弹层的候选 ③批量设讲师
   */
  const [lecturers, setLecturers] = useState<LecturerStat[]>([]);
  /** 上传时给整批视频指定的讲师。一次传的通常就是同一位老师的一套课 */
  const [uploadLecturer, setUploadLecturer] = useState('');
  /** 批量设讲师弹层里输入的名字。null = 弹层没开 */
  const [batchLecturer, setBatchLecturer] = useState<string | null>(null);
  /** 讲师筛选(走后端,因为列表是分页的)。'' = 全部,NO_LECTURER = 只看未指定的 */
  const [lecturerFilter, setLecturerFilter] = useState('');

  const loadLecturers = useCallback(async () => {
    try {
      setLecturers(await phoneticsApi.lecturers());
    } catch {
      // 名单只是自动补全的便利,取不到不该妨碍上传(照旧能手敲名字)
      setLecturers([]);
    }
  }, []);

  // 正在管理课件的视频。关弹层时刷新列表,让「讲义 N」跟着变
  const [materialFor, setMaterialFor] = useState<PhoneticVideo | null>(null);

  // 批量删除:勾选的 id。翻页/搜索后清空,避免删掉看不见的条目
  const [selected, setSelected] = useState<Set<number>>(new Set());
  /**
   * 本页**可操作**的行(平台预置对机构只读)。
   *
   * 「全选本页」只勾这些 —— 预置也勾上的话,批量设讲师/批量删除会被后端**整批 403**
   * (整批拒是有意的:改了一半不说更糟),于是老师得在 10 行里肉眼认出哪几条是预置
   * 再逐个取消勾选,而「未指定讲师 → 全选 → 设讲师」这条补归属主路径正好最容易撞上
   * (预置视频的讲师也是空的)。
   *
   * ⚠️ 必须声明在 allChecked 之前:const 有 TDZ,顺序反了是渲染即 ReferenceError
   */
  const selectableItems = items.filter((v) => v.can_edit !== false);
  // 全选态按**可操作的行**算:一页全是预置视频时勾选框不该显示成"已全选"
  const allChecked = selectableItems.length > 0
    && selectableItems.every((v) => selected.has(v.id));
  const toggleOne = (id: number) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const toggleAll = () => setSelected((s) => {
    // 只全选/取消当前这一页 —— 跨页全选会让老师删掉屏幕上看不到的东西
    const n = new Set(s);
    if (selectableItems.every((v) => n.has(v.id))) selectableItems.forEach((v) => n.delete(v.id));
    else selectableItems.forEach((v) => n.add(v.id));
    return n;
  });

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));


  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 响应拦截器已拆 data,这里拿到的就是分页对象本身。
      // 讲师筛选走**后端**而不是前端过滤:列表是分页的,前端只拿到当前 10 条,
      // 在本页里筛等于"筛了但翻页还是乱的"
      const data = await phoneticsApi.teacherList({
        q: search || undefined,
        lecturer: lecturerFilter || undefined,
        page, page_size: PAGE_SIZE,
      });
      // 页码超界就夹回去并重取:批量设讲师/删除之后这些行可能已不属于当前筛选集
      // (在「未指定讲师」下设完讲师,它们立刻从结果里消失)→ total 变小、page 还停在原处
      // → offset 超界 → 空列表 + 分页条写「3 / 2」,而空状态文案是「还没有音标视频」,
      // 老师会以为刚才的操作把视频弄没了。在这里夹(而不是用 effect 夹)是因为
      // 项目 lint 禁止在 effect 里同步 setState
      const maxPage = Math.max(1, Math.ceil((data.total || 0) / PAGE_SIZE));
      if (page > maxPage) { setPage(maxPage); return; }   // setPage 会触发重取
      setItems(data.items);
      setTotal(data.total);
      setSelected(new Set());  // 换页/换搜索词后旧勾选已不可见,清掉防误删
    } catch (e) {
      toast.error(getErrorMessage(e, '列表加载失败'));
    } finally {
      setLoading(false);
    }
  }, [search, page, lecturerFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { void loadLecturers(); }, [loadLecturers]);

  // 搜索防抖:老师边打字边搜,不必每个字都打一次后端
  useEffect(() => {
    const t = window.setTimeout(() => { setSearch(keyword.trim()); setPage(1); }, 350);
    return () => window.clearTimeout(t);
  }, [keyword]);

  /**
   * 批量上传:一次选多个,前端**排队逐个**调单文件端点。
   *
   * 为什么不做成"一个请求传多个文件":8 个 50MB 就是单请求 400MB,会撞 nginx
   * client_max_body_size(现 220m),而且中途断网整批都得重来、进度条也只能显示总体。
   * 逐个传则单个失败不影响其他,失败的能明确报出是哪个文件。
   */
  const onPickFiles = async (fileList?: FileList | null) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setUploading(true);
    setBatch({ done: 0, total: files.length, name: '' });
    const failed: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      setBatch({ done: i, total: files.length, name: f.name });
      setProgress(0);
      try {
        // 不传 title:后端会用文件名(去扩展名)作标题。
        // 讲师对整批用同一个值 —— 一次传的通常就是同一位老师的一套课
        await phoneticsApi.upload(
          f, { category: 'basic', lecturer: uploadLecturer }, setProgress);
      } catch (e) {
        failed.push(f.name);
        console.error('上传失败:', f.name, e);
      }
    }
    const ok = files.length - failed.length;
    if (failed.length === 0) {
      toast.success(`${ok} 个视频上传成功,标题已用文件名`);
    } else if (ok > 0) {
      toast.warning(`${ok} 个成功,${failed.length} 个失败:${failed.slice(0, 3).join('、')}${failed.length > 3 ? '…' : ''}`);
    } else {
      toast.error(`上传失败:${failed.slice(0, 3).join('、')}${failed.length > 3 ? '…' : ''}`);
    }
    setUploading(false);
    setProgress(0);
    setBatch(null);
    if (fileRef.current) fileRef.current.value = '';
    // 回到第一页看新传的,并**清掉所有筛选** —— 传完必须让老师看见刚传的那几条。
    // ⚠️ lecturerFilter 也要清:老师常是点着「未指定讲师」在补归属,顺手又传了几个
    // 带讲师的视频,新传的不满足 lecturer IS NULL → 列表毫无变化,而 toast 说
    // 「5 个视频上传成功」→ 老师以为没传上去,再传一遍造成重复视频
    setPage(1);
    setSearch('');
    setKeyword('');
    setLecturerFilter('');
    await load();
    // 这批可能带来一位新讲师,名单要跟着更新(否则下次上传的自动补全里没有他)
    await loadLecturers();
  };

  const startEdit = (v: PhoneticVideo) => {
    setEditing(v);
    setEditForm({
      title: v.title,
      phonetic_symbol: v.phonetic_symbol || '',
      category: v.category,
      lecturer: v.lecturer || '',
      description: v.description || '',
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    try {
      await phoneticsApi.update(editing.id, {
        title: editForm.title.trim(),
        phonetic_symbol: editForm.phonetic_symbol,
        category: editForm.category,
        // 留空 = 取消归属改回「全校通用」。**必须原样传空串**:
        // 后端按「传了就改」判(见 VideoUpdate.lecturer 注释),这里若像其它字段
        // 那样过滤掉空值,老师就永远没法把归属清掉
        lecturer: editForm.lecturer.trim(),
        description: editForm.description,
      });
      toast.success('已保存');
      setEditing(null);
      await load();
      await loadLecturers();
    } catch (e) {
      toast.error(getErrorMessage(e, '保存失败'));
    }
  };

  /** 批量设讲师:存量视频靠这个补归属,不然要逐个点「编辑」改几十遍 */
  const submitBatchLecturer = async () => {
    const ids = [...selected];
    if (ids.length === 0 || batchLecturer === null) return;
    const name = batchLecturer.trim();
    try {
      const r = await phoneticsApi.batchSetLecturer(ids, name);
      // ⚠️ HTTP 200 但 updated=0 是**一条都没改**(选中的行已被别人删掉、
      // 或 id 不属于本机构)。照旧弹绿色成功 = 骗老师,他会以为归属改好了。
      // 另外 r.lecturer 可能是 null(改回全校通用/一条没改),不能直接插进模板 ——
      // 会把字面量「null」显示给老师(2026-09-17 实测复现两者)
      if (r.updated === 0) {
        toast.warning('一条都没改成:选中的视频可能已被删除或不属于本机构,请刷新后重试');
      } else {
        const shown = r.lecturer || name;   // 服务端可能靠拢到已有写法,优先显示它
        toast.success(shown
          ? `已把 ${r.updated} 个视频归到「${shown}」`
          : `已把 ${r.updated} 个视频改回「全校通用」`);
      }
      setBatchLecturer(null);
      setSelected(new Set());
      await load();
      await loadLecturers();
    } catch (e) {
      toast.error(getErrorMessage(e, '批量设讲师失败'));
    }
  };

  const toggleActive = async (v: PhoneticVideo) => {
    try {
      await phoneticsApi.update(v.id, { is_active: !v.is_active });
      await load();
    } catch (e) {
      toast.error(getErrorMessage(e, '操作失败'));
    }
  };

  const batchRemove = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!window.confirm(`确定删除选中的 ${ids.length} 个视频?视频文件会一起删掉,此操作不可撤销。`)) return;
    try {
      const r = await phoneticsApi.batchRemove(ids);
      toast.success(`已删除 ${r.deleted} 个视频`);
      setSelected(new Set());
      // 整页被删空时往前翻一页,避免停在空页
      if (r.deleted >= items.length && page > 1) setPage(page - 1);
      else await load();
      // 删完可能让某位讲师名下清零,名单要跟着更新 —— 否则筛选条上还挂着
      // 「李老师 1」,点进去是空页(而空页文案会说"还没有音标视频")
      await loadLecturers();
    } catch (e) {
      toast.error(getErrorMessage(e, '批量删除失败'));
    }
  };

  const remove = async (v: PhoneticVideo) => {
    if (!window.confirm(`删除「${v.title}」?视频文件也会一起删掉,此操作不可撤销。`)) return;
    try {
      await phoneticsApi.remove(v.id);
      toast.success('已删除');
      // 删掉当页最后一条时往前翻一页,避免停在空页
      if (items.length === 1 && page > 1) setPage(page - 1);
      else await load();
      await loadLecturers();   // 理由同批量删除:残留的讲师 chip 点进去是空页
    } catch (e) {
      toast.error(getErrorMessage(e, '删除失败'));
    }
  };

  return (
    <div className="staff-legacy-page min-h-screen bg-paper">
      <StaffWorkspaceHeader
        role="teacher"
        title="音标视频管理"
        subtitle="上传、整理并发布音标视频"
        icon={Volume2}
      />
      <main className="teacher-workspace-main">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-[#173047]"><Volume2 className="h-5 w-5 text-[#2f8791]" />音标视频管理</h1>
            <p className="mt-1 text-xs text-ink-mute">
              音标是英语的基础,学生首页有独立入口。上传的视频只有登录的学生能看。
              可一次选多个视频批量上传,标题自动取文件名。
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            {/* 讲师:**上传前先填**,整批用同一个值。
                放在上传按钮左边而不是弹层里 —— 老师的动作是"选文件就传",
                多一步弹层确认会被跳过,而讲师是学生端分类的依据,漏填就归不了类。
                自由文本 + datalist 自动补全:讲课的常是没有系统账号的外聘老师,
                所以不是从教师账号里选。补全让同一个人不至于被敲成几种写法 */}
            <div>
              <label htmlFor="up-lecturer" className="mb-1 block text-xs text-ink-soft">
                讲师(学生按这个挑老师)
              </label>
              <input
                id="up-lecturer"
                list="lecturer-options"
                value={uploadLecturer}
                onChange={(e) => setUploadLecturer(e.target.value)}
                placeholder="如 王老师;留空=全校通用"
                maxLength={50}
                disabled={uploading}
                className="min-h-11 w-56 rounded-xl border border-gray-200 bg-white px-3 text-sm focus:border-primary focus:outline-none disabled:opacity-60"
              />
            </div>
            {/* ⚠️ option 里**不能写 children**:Chrome 把它当副标题显示在 value 旁边,
                而 Firefox 用 text content **取代** value —— 下拉里只剩「3 个视频」
                看不到讲师名,输入「王」也匹配不上,老师只能凭记忆手敲,敲成
                「王老師」就新建出第二位讲师。只给 value,视频数在下面的 chip 上显示 */}
            <datalist id="lecturer-options">
              {lecturers.map((l) => (
                <option key={l.name} value={l.name} />
              ))}
            </datalist>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="btn-glow min-h-11 rounded-xl px-4 text-sm font-semibold text-white disabled:opacity-60"
            >
              {uploading
                ? (batch && batch.total > 1
                    ? `上传中 ${batch.done + 1}/${batch.total} · ${progress}%`
                    : `上传中 ${progress}%`)
                : <><Upload className="mr-1 inline h-4 w-4" />上传视频</>}
            </button>
            <input
              ref={fileRef} type="file" accept="video/mp4,video/webm,video/quicktime"
              multiple
              className="hidden" onChange={(e) => onPickFiles(e.target.files)}
            />
          </div>
        </div>

        {/* 上传进度条:大文件没有进度条老师会以为卡死 */}
        {uploading && (
          <div className="mb-4">
            <div className="h-2 overflow-hidden rounded-full bg-gray-200">
              <motion.div className="h-full bg-primary" animate={{ width: `${progress}%` }} />
            </div>
            <p className="mt-1 truncate text-xs text-ink-mute">
              {batch && batch.total > 1
                ? `正在上传第 ${batch.done + 1}/${batch.total} 个:${batch.name} — ${progress}%`
                : `正在上传,请不要关闭页面…${progress}%`}
            </p>
            {batch && batch.total > 1 && (
              /* 批量总进度:已完成个数占比,和单文件进度条分开显示,
                 否则老师只看到进度条反复从 0 涨到 100,不知道整批还剩多少 */
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-gray-100">
                <motion.div className="h-full bg-emerald-500"
                  animate={{ width: `${Math.round((batch.done / batch.total) * 100)}%` }} />
              </div>
            )}
            <p className="mt-1 text-[11px] text-ink-mute">上传期间请不要关闭页面</p>
          </div>
        )}

        {/* 搜索 */}
        <input
          type="search" value={keyword} onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索标题 / 音标 / 描述 / 讲师" aria-label="搜索视频"
          className="mb-3 w-full rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm focus:border-primary focus:outline-none sm:max-w-xs"
        />

        {/* 讲师筛选条。「未指定讲师」那个 chip 是整件事的入口 ——
            点它 → 得到还没归属的那批 → 全选 → 设讲师,一次补完。
            没有它,老师得在几十条里用肉眼找哪些是空的 */}
        {(lecturers.length > 0 || lecturerFilter) && (
          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-ink-mute">讲师</span>
            <button
              type="button"
              onClick={() => { setLecturerFilter(''); setPage(1); }}
              aria-pressed={lecturerFilter === ''}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                lecturerFilter === '' ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              全部
            </button>
            {lecturers.map((l) => (
              <button
                type="button"
                key={l.name}
                onClick={() => {
                  setLecturerFilter(lecturerFilter === l.name ? '' : l.name);
                  setPage(1);   // 换筛选必须回第一页,否则可能停在空页
                }}
                aria-pressed={lecturerFilter === l.name}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                  lecturerFilter === l.name ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {l.name}
                <span className="ml-1 font-numeric opacity-70">{l.video_count}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setLecturerFilter(lecturerFilter === NO_LECTURER ? '' : NO_LECTURER);
                setPage(1);
              }}
              aria-pressed={lecturerFilter === NO_LECTURER}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${
                lecturerFilter === NO_LECTURER
                  ? 'bg-amber-600 text-white'
                  : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
              }`}
            >
              未指定讲师
            </button>
          </div>
        )}

        {/* 列表 */}
        <div className="card-soft overflow-hidden rounded-2xl">
          {loading ? (
            <p className="py-14 text-center text-sm text-ink-mute">加载中…</p>
          ) : items.length === 0 ? (
            /* 空状态必须说清是**哪个条件**筛空的。只判 search 的话:老师把最后几个
               未归属视频都设好讲师、再点「未指定讲师」复核时,会看到「还没有音标视频/
               点右上『上传视频』开始」—— 而那正是补完归属的成功状态,他会以为
               刚才的批量操作把视频弄没了 */
            <div className="py-14 text-center">
              <p className="text-3xl">{lecturerFilter === NO_LECTURER && !search ? '✅' : '🎬'}</p>
              <p className="mt-2 font-semibold text-ink">
                {search
                  ? `没有「${search}」相关的视频`
                  : lecturerFilter === NO_LECTURER
                    ? '所有视频都指定了讲师'
                    : lecturerFilter
                      ? `「${lecturerFilter}」名下还没有视频`
                      : '还没有音标视频'}
              </p>
              <p className="mt-1 text-xs text-ink-mute">
                {search
                  ? '换个关键词试试'
                  : lecturerFilter
                    ? '点上面的「全部」看所有视频'
                    : '点右上「上传视频」开始'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {/* 全选条:勾选后出现批量删除按钮 */}
              <div className="flex items-center gap-3 bg-gray-50/80 px-4 py-2.5">
                <input
                  type="checkbox" checked={allChecked} onChange={toggleAll}
                  aria-label="全选本页视频"
                  className="h-4 w-4 shrink-0 accent-primary"
                />
                <span className="text-xs text-ink-mute">
                  {selected.size > 0 ? `已选 ${selected.size} 个` : '全选本页'}
                  {/* 本页有预置视频时说明一句它们被跳过了 —— 不说的话老师会数不对
                      («全选» 之后只勾上 6 个而屏幕上有 10 行) */}
                  {selectableItems.length < items.length && (
                    <span className="ml-1 text-amber-600">
                      (平台预置的 {items.length - selectableItems.length} 条不可改,已跳过)
                    </span>
                  )}
                </span>
                {selected.size > 0 && (
                  <div className="ml-auto flex items-center gap-1.5">
                    {/* 批量设讲师排在删除左边:存量视频补归属是这里最常做的事,
                        而删除是危险动作,不该挨着高频按钮 */}
                    <button
                      onClick={() => setBatchLecturer('')}
                      className="rounded-lg bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-700 hover:bg-teal-100"
                    >
                      👤 设讲师({selected.size})
                    </button>
                    <button
                      onClick={batchRemove}
                      className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100"
                    >
                      🗑 批量删除({selected.size})
                    </button>
                  </div>
                )}
              </div>
              {items.map((v) => (
                <div key={v.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${selected.has(v.id) ? 'bg-orange-50/60' : ''}`}>
                  {/* 预置视频的勾选框直接禁用:勾上只会让整批操作吃 403
                      (与同一行的编辑/下架/删除按钮同口径 —— 置灰而不是隐藏) */}
                  <input
                    type="checkbox" checked={selected.has(v.id)} onChange={() => toggleOne(v.id)}
                    disabled={v.can_edit === false}
                    title={v.can_edit === false ? '平台预置视频,机构不可修改' : undefined}
                    aria-label={`选择 ${v.title}`}
                    className="h-4 w-4 shrink-0 accent-primary disabled:cursor-not-allowed disabled:opacity-40"
                  />
                  {/* 缩略图:老师核对"顺序对不对"时看图比看标题快 */}
                  <img
                    src={v.cover_image || CATEGORY_COVER[v.category] || CATEGORY_COVER.other}
                    alt="" loading="lazy"
                    className="h-10 w-16 shrink-0 rounded-md object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      {v.phonetic_symbol && (
                        <span className="shrink-0 rounded bg-orange-100 px-1.5 py-0.5 font-mono text-xs font-bold text-primary">
                          {v.phonetic_symbol}
                        </span>
                      )}
                      <p className={`truncate font-semibold ${v.is_active ? 'text-ink' : 'text-ink-mute line-through'}`} title={v.title}>
                        {v.title}
                      </p>
                    </div>
                    <p className="mt-0.5 text-xs text-ink-mute">
                      {/* 讲师放这一行第一位:老师核对"归属对不对"比看分类更频繁。
                          没归属的**明确写出来**而不是留空 —— 留空看不出是"全校通用"
                          还是"忘了填",而这正是要老师去补的那批 */}
                      {v.lecturer
                        ? <span className="font-medium text-teal-700">{v.lecturer}</span>
                        : <span className="text-amber-600">未指定讲师</span>}
                      {' · '}
                      {CATEGORY_LABELS[v.category] || v.category}
                      {v.file_size ? ` · ${formatSize(v.file_size)}` : ''}
                      {` · 观看 ${v.view_count}`}
                      {!v.is_active && ' · 已下架'}
                      {/* 配过讲义的要看得出来,否则老师分不清哪个视频还缺课件 */}
                      {!!v.material_count && (
                        <span className="text-orange-500">{` · 讲义 ${v.material_count}`}</span>
                      )}
                      {v.is_preset && ' · 平台预置'}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      onClick={() => setMaterialFor(v)}
                      className="rounded-lg bg-gray-100 px-2.5 py-1.5 text-xs text-ink-soft hover:bg-orange-100"
                    >
                      课件{v.material_count ? ` ${v.material_count}` : ''}
                    </button>
                    {/* 平台预置对机构只读:置灰而不是隐藏 —— 隐藏了老师会以为功能坏了 */}
                    <button
                      onClick={() => startEdit(v)}
                      disabled={v.can_edit === false}
                      title={v.can_edit === false ? '平台预置视频,机构不可修改' : undefined}
                      className="rounded-lg bg-gray-100 px-2.5 py-1.5 text-xs text-ink-soft hover:bg-orange-100
                                 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-gray-100"
                    >编辑</button>
                    <button
                      onClick={() => toggleActive(v)}
                      disabled={v.can_edit === false}
                      title={v.can_edit === false ? '平台预置视频,机构不可修改' : undefined}
                      className="rounded-lg bg-gray-100 px-2.5 py-1.5 text-xs text-ink-soft hover:bg-orange-100
                                 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-gray-100"
                    >
                      {v.is_active ? '下架' : '上架'}
                    </button>
                    <button
                      onClick={() => remove(v)}
                      disabled={v.can_edit === false}
                      title={v.can_edit === false ? '平台预置视频,机构不可删除' : undefined}
                      className="rounded-lg px-2.5 py-1.5 text-xs text-red-500 hover:bg-red-50
                                 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                    >删除</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 分页 */}
        {total > PAGE_SIZE && (
          <div className="mt-4 flex items-center justify-center gap-3">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
              className="rounded-xl bg-gray-100 px-3 py-1.5 text-sm text-ink-soft disabled:opacity-40"
            >
              上一页
            </button>
            <span className="font-numeric text-sm text-ink-soft">{page} / {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
              className="rounded-xl bg-gray-100 px-3 py-1.5 text-sm text-ink-soft disabled:opacity-40"
            >
              下一页
            </button>
            <span className="text-xs text-ink-mute">共 {total} 个</span>
          </div>
        )}
      </main>

      {/* 编辑弹层 */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditing(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <p className="mb-4 font-display text-lg font-bold text-ink">编辑视频信息</p>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-ink-soft">标题</label>
                <input
                  value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-ink-soft">音标</label>
                  <input
                    value={editForm.phonetic_symbol} onChange={(e) => setEditForm({ ...editForm, phonetic_symbol: e.target.value })}
                    placeholder="如 /æ/"
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-ink-soft">分类</label>
                  <select
                    value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:outline-none"
                  >
                    {CATEGORIES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="edit-lecturer" className="mb-1 block text-xs text-ink-soft">
                  讲师(学生按这个挑老师,留空=全校通用)
                </label>
                <input
                  id="edit-lecturer"
                  list="lecturer-options"
                  value={editForm.lecturer}
                  onChange={(e) => setEditForm({ ...editForm, lecturer: e.target.value })}
                  placeholder="如 王老师"
                  maxLength={50}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-ink-soft">简介(学生可见)</label>
                <textarea
                  value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  rows={3}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:outline-none"
                />
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={saveEdit} className="btn-glow flex-1 rounded-xl py-2.5 text-sm font-semibold text-white">保存</button>
              <button onClick={() => setEditing(null)} className="rounded-xl bg-gray-100 px-4 py-2.5 text-sm text-ink-soft">取消</button>
            </div>
          </div>
        </div>
      )}

      {/* 批量设讲师弹层。存量视频(讲师全是空的)靠这个补归属 */}
      {batchLecturer !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setBatchLecturer(null)}
          role="dialog" aria-modal="true" aria-label="批量设讲师"
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <p className="mb-1 font-display text-lg font-bold text-ink">
              给选中的 {selected.size} 个视频设讲师
            </p>
            <p className="mb-4 text-xs leading-relaxed text-ink-soft">
              学生在音标页顶部按讲师挑“自己的老师”。讲师是随手填的名字，
              不用是系统里的教师账号（外聘老师、助教都可以）。
            </p>
            <label htmlFor="batch-lecturer" className="mb-1 block text-xs text-ink-soft">讲师姓名</label>
            <input
              id="batch-lecturer"
              list="lecturer-options"
              value={batchLecturer}
              onChange={(e) => setBatchLecturer(e.target.value)}
              placeholder="如 王老师"
              maxLength={50}
              autoFocus
              /* 回车直接提交:补归属是重复劳动,少一次鼠标移动 */
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submitBatchLecturer(); }}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-primary focus:outline-none"
            />
            {/* 已有讲师做快捷键:补归属时敲字不如点一下,而且点已有的绝不会写错 */}
            {lecturers.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {lecturers.map((l) => (
                  <button
                    key={l.name}
                    type="button"
                    onClick={() => setBatchLecturer(l.name)}
                    className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-ink-soft transition hover:bg-teal-100"
                  >
                    {l.name}
                  </button>
                ))}
              </div>
            )}
            <p className="mt-3 rounded-xl bg-blue-50 px-3 py-2 text-xs leading-relaxed text-blue-700">
              留空点“保存”= 改回「全校通用」，所有学生都能看到。
            </p>
            <div className="mt-4 flex gap-2">
              <button
                onClick={submitBatchLecturer}
                className="btn-glow flex-1 rounded-xl py-2.5 text-sm font-semibold text-white"
              >
                保存
              </button>
              <button
                onClick={() => setBatchLecturer(null)}
                className="rounded-xl bg-gray-100 px-4 py-2.5 text-sm text-ink-soft"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 配套课件弹层。关掉时刷新列表,让行上的「讲义 N」跟着变 */}
      {materialFor && (
        <MaterialManagerDialog
          videoId={materialFor.id}
          videoTitle={materialFor.title}
          readOnly={materialFor.can_edit === false}
          onClose={() => { setMaterialFor(null); void load(); }}
        />
      )}
    </div>
  );
}
