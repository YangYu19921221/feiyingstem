/**
 * 音标视频管理 — 教师端
 *
 * 上传 + 增删改查 + 搜索 + 分页。视频存服务器私有目录,学生登录后才能看。
 * 上传时**不填标题 → 自动取文件名(去扩展名)**,老师传完可再改。
 * 大文件必须有进度条,否则老师以为页面卡死会反复点。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  phoneticsApi, CATEGORY_LABELS, formatSize,
  type PhoneticVideo, type PhoneticCategory,
} from '../api/phonetics';
import { toast } from '../components/Toast';
import { getErrorMessage } from '../utils/errorMessage';

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
  const navigate = useNavigate();
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
  const [editForm, setEditForm] = useState({ title: '', phonetic_symbol: '', category: 'basic', description: '' });

  // 批量删除:勾选的 id。翻页/搜索后清空,避免删掉看不见的条目
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const allChecked = items.length > 0 && items.every((v) => selected.has(v.id));
  const toggleOne = (id: number) => setSelected((s) => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const toggleAll = () => setSelected((s) => {
    // 只全选/取消当前这一页 —— 跨页全选会让老师删掉屏幕上看不到的东西
    const n = new Set(s);
    if (items.every((v) => n.has(v.id))) items.forEach((v) => n.delete(v.id));
    else items.forEach((v) => n.add(v.id));
    return n;
  });

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 响应拦截器已拆 data,这里拿到的就是分页对象本身
      const data = await phoneticsApi.teacherList({ q: search || undefined, page, page_size: PAGE_SIZE });
      setItems(data.items);
      setTotal(data.total);
      setSelected(new Set());  // 换页/换搜索词后旧勾选已不可见,清掉防误删
    } catch (e) {
      toast.error(getErrorMessage(e, '列表加载失败'));
    } finally {
      setLoading(false);
    }
  }, [search, page]);

  useEffect(() => { load(); }, [load]);

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
        // 不传 title:后端会用文件名(去扩展名)作标题
        await phoneticsApi.upload(f, { category: 'basic' }, setProgress);
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
    // 回到第一页看新传的(新条目按 id 倒序在前)
    setPage(1);
    setSearch('');
    setKeyword('');
    await load();
  };

  const startEdit = (v: PhoneticVideo) => {
    setEditing(v);
    setEditForm({
      title: v.title,
      phonetic_symbol: v.phonetic_symbol || '',
      category: v.category,
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
        description: editForm.description,
      });
      toast.success('已保存');
      setEditing(null);
      await load();
    } catch (e) {
      toast.error(getErrorMessage(e, '保存失败'));
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
    } catch (e) {
      toast.error(getErrorMessage(e, '删除失败'));
    }
  };

  return (
    <div className="min-h-screen bg-paper">
      <div className="mx-auto max-w-6xl px-5 py-6">
        <button onClick={() => navigate('/teacher/dashboard')} className="mb-3 text-sm text-ink-mute hover:text-ink">
          ← 返回工作台
        </button>

        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-bold text-ink">🔊 音标视频管理</h1>
            <p className="mt-1 text-xs text-ink-mute">
              音标是英语的基础,学生首页有独立入口。上传的视频只有登录的学生能看。
              可一次选多个视频批量上传,标题自动取文件名。
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="btn-glow rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {uploading
                ? (batch && batch.total > 1
                    ? `上传中 ${batch.done + 1}/${batch.total} · ${progress}%`
                    : `上传中 ${progress}%`)
                : '⬆️ 上传视频'}
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
          placeholder="搜索标题 / 音标 / 描述" aria-label="搜索视频"
          className="mb-4 w-full rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm focus:border-primary focus:outline-none sm:max-w-xs"
        />

        {/* 列表 */}
        <div className="card-soft overflow-hidden rounded-2xl">
          {loading ? (
            <p className="py-14 text-center text-sm text-ink-mute">加载中…</p>
          ) : items.length === 0 ? (
            <div className="py-14 text-center">
              <p className="text-3xl">🎬</p>
              <p className="mt-2 font-semibold text-ink">{search ? `没有「${search}」相关的视频` : '还没有音标视频'}</p>
              <p className="mt-1 text-xs text-ink-mute">{search ? '换个关键词试试' : '点右上「上传视频」开始'}</p>
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
                </span>
                {selected.size > 0 && (
                  <button
                    onClick={batchRemove}
                    className="ml-auto rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100"
                  >
                    🗑 批量删除({selected.size})
                  </button>
                )}
              </div>
              {items.map((v) => (
                <div key={v.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${selected.has(v.id) ? 'bg-orange-50/60' : ''}`}>
                  <input
                    type="checkbox" checked={selected.has(v.id)} onChange={() => toggleOne(v.id)}
                    aria-label={`选择 ${v.title}`}
                    className="h-4 w-4 shrink-0 accent-primary"
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
                      {CATEGORY_LABELS[v.category] || v.category}
                      {v.file_size ? ` · ${formatSize(v.file_size)}` : ''}
                      {` · 观看 ${v.view_count}`}
                      {!v.is_active && ' · 已下架'}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button onClick={() => startEdit(v)} className="rounded-lg bg-gray-100 px-2.5 py-1.5 text-xs text-ink-soft hover:bg-orange-100">编辑</button>
                    <button onClick={() => toggleActive(v)} className="rounded-lg bg-gray-100 px-2.5 py-1.5 text-xs text-ink-soft hover:bg-orange-100">
                      {v.is_active ? '下架' : '上架'}
                    </button>
                    <button onClick={() => remove(v)} className="rounded-lg px-2.5 py-1.5 text-xs text-red-500 hover:bg-red-50">删除</button>
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
      </div>

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
    </div>
  );
}
