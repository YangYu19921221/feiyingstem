/**
 * 「以前的对话」抽屉(2026-10-27,用户「对话历史记录是不是要分 3 天 7 天一个月 可以删除 标题可以修改 可以搜索
 * 多久自动删除部分历史记录 你设计下」)。规则真源是后端 services/tutor_history.py,这里只负责画。
 *
 * - 分组: 收藏 / 今天 / 3 天内 / 7 天内 / 一个月内 / 更早(后端按北京日算好 group,这里照着分)
 * - 搜索: 标题和对话内容都搜,搜到内容的显示那一小段原话,命中的字标黄;输入停 0.3 秒才搜
 * - 每一行: 点标题打开;星星 = 收藏(收藏的不会自动清理);「⋯」展开改名 / 删掉
 * - 改名、删掉都在这一行里就地做,不弹窗(孩子在手机上点一个弹窗再点一个容易点错)
 * - 底部写明多久自动清理、删掉后老师还能看几天(数字读接口的 keep_days / deleted_keep_days,不写死)
 * - 讲解方式(年级 + 讲简单一点 / 正常 / 讲深一点)放在最下面,随时能改
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Loader2, MoreHorizontal, Pencil, Plus, Search, Star, Trash2, X } from 'lucide-react';
import {
  deleteConversation, HISTORY_GROUP_LABEL, listHistory, renameConversation, starConversation,
  type HistoryGroup, type HistoryItem,
} from '../../api/tutorHistory';
import { toast } from '../Toast';
import { getErrorMessage } from '../../utils/errorMessage';
import TutorLevelControl from './TutorLevelControl';

const TITLE_MAX = 30;
const GROUP_ORDER: HistoryGroup[] = ['starred', 'today', '3d', '7d', '30d', 'older'];
const BJ = 'Asia/Shanghai';
const EASE = [0.16, 1, 0.3, 1] as const;

const norm = (s: string) => s.trim().split(/\s+/).join(' ');

function whenLabel(iso: string | null, group: HistoryGroup): string {
  if (!iso) return '';
  const d = new Date(iso + 'Z');
  const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: BJ });
  if (group === 'today') return time;
  const day = d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', timeZone: BJ });
  return group === '3d' ? `${day} ${time}` : day;
}

/** 收藏的在前,其余按最后一次提问倒序(和后端同一个顺序;收藏 / 取消收藏后就地重排) */
const sortItems = (xs: HistoryItem[]) =>
  [...xs].sort((a, b) => Number(b.starred) - Number(a.starred)
    || (b.updated_at ?? '').localeCompare(a.updated_at ?? '') || b.id - a.id);

function Highlight({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded bg-amber-100 px-0.5 text-inherit">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

interface Props {
  open: boolean;
  currentId: number | null;
  onClose: () => void;
  onPick: (id: number) => void;
  onNew: () => void;
  /** 删掉的正好是现在打开的那段 */
  onDeletedCurrent: () => void;
  /** 从欢迎卡「按年级讲」点进来: 打开时直接展开讲解方式 */
  levelOpen?: boolean;
  /** 教师端自己的对话(api/tutorHistory TEACHER_HISTORY);不传 = 学生的。教师端不显示「讲解方式」 */
  base?: string;
}

export default function TutorHistoryDrawer({ open, currentId, onClose, onPick, onNew, onDeletedCurrent, levelOpen, base }: Props) {
  const reduce = useReducedMotion();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [keep, setKeep] = useState<{ days: number; deleted: number } | null>(null);
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<{ id: number; draft: string } | null>(null);
  const [confirmDel, setConfirmDel] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const seq = useRef(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // 输入停 0.3 秒再搜
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(norm(q)), 300);
    return () => window.clearTimeout(t);
  }, [q]);

  const load = useCallback(async (offset: number, keepOld: boolean) => {
    const my = ++seq.current;
    if (!keepOld) setError('');
    try {
      const r = await listHistory(query, offset, base);
      if (my !== seq.current) return;   // 搜别的了,这次的结果不要了
      setItems((old) => (keepOld && old ? [...old, ...r.items.filter((x) => !old.some((o) => o.id === x.id))] : r.items));
      setHasMore(r.has_more);
      setKeep({ days: r.keep_days, deleted: r.deleted_keep_days });
    } catch (e) {
      if (my !== seq.current) return;
      if (keepOld) toast.error(getErrorMessage(e, '没加载出来,再点一次'));
      else setError(getErrorMessage(e, '记录没加载出来'));
    }
  }, [query, base]);

  useEffect(() => {
    if (!open) return;
    setItems(null);
    setMenuFor(null);
    setRenaming(null);
    setConfirmDel(null);
    void load(0, false);
  }, [open, load]);

  // 关上再打开时从头来: 清掉上次的搜索
  useEffect(() => {
    if (open) return;
    setQ('');
    setQuery('');
  }, [open]);

  // 打开时: 电脑上直接把光标放进搜索框;手机上不放(会弹出键盘挡住列表)
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      if (window.matchMedia?.('(pointer: fine)').matches) searchRef.current?.focus();
      else panelRef.current?.focus();
    }, 60);
    return () => window.clearTimeout(t);
  }, [open]);

  // Esc: 先收改名框 / 删除确认 / 操作菜单,都没有才关抽屉
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (renaming) setRenaming(null);
      else if (confirmDel !== null) setConfirmDel(null);
      else if (menuFor !== null) setMenuFor(null);
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, renaming, confirmDel, menuFor, onClose]);

  const replace = (it: HistoryItem) => setItems((xs) => (xs ? sortItems(xs.map((x) => (x.id === it.id ? it : x))) : xs));

  const toggleStar = async (it: HistoryItem) => {
    setBusyId(it.id);
    try {
      replace(await starConversation(it.id, !it.starred, base));
      if (!it.starred) toast.success('收藏好了,这段对话会一直留着');
    } catch (e) {
      toast.error(getErrorMessage(e, '没收藏上,再点一次'));
    } finally {
      setBusyId(null);
    }
  };

  const saveTitle = async () => {
    if (!renaming) return;
    const title = norm(renaming.draft).slice(0, TITLE_MAX);
    const it = items?.find((x) => x.id === renaming.id);
    // 删空了 / 没改: 当作取消
    if (!title || !it || title === it.title) {
      setRenaming(null);
      return;
    }
    setBusyId(renaming.id);
    try {
      replace(await renameConversation(renaming.id, title, base));
      setRenaming(null);
      setMenuFor(null);
    } catch (e) {
      toast.error(getErrorMessage(e, '没改成,再试一次'));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: number) => {
    setBusyId(id);
    try {
      await deleteConversation(id, base);
      setItems((xs) => (xs ? xs.filter((x) => x.id !== id) : xs));
      setConfirmDel(null);
      setMenuFor(null);
      if (id === currentId) onDeletedCurrent();
    } catch (e) {
      toast.error(getErrorMessage(e, '没删掉,再试一次'));
    } finally {
      setBusyId(null);
    }
  };

  const loadMore = async () => {
    if (!items || loadingMore) return;
    setLoadingMore(true);
    await load(items.length, true);
    setLoadingMore(false);
  };

  const searching = query.length > 0;
  const groups = GROUP_ORDER
    .map((group) => ({ group, rows: (items ?? []).filter((x) => x.group === group) }))
    .filter((g) => g.rows.length > 0);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="tutor-history"
          className="fixed inset-0 z-[70] flex justify-end bg-black/30"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduce ? 0 : 0.2 }}
        >
          <motion.div
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="tutor-history-title"
            onClick={(e) => e.stopPropagation()}
            className="flex h-full w-full max-w-sm flex-col bg-white shadow-[-8px_0_24px_-12px_rgb(41_53_69/0.25)] outline-none"
            initial={reduce ? false : { x: '100%' }}
            animate={{ x: 0 }}
            exit={reduce ? { opacity: 0 } : { x: '100%' }}
            transition={{ duration: reduce ? 0 : 0.28, ease: EASE }}
          >
            {/* 顶部: 标题 + 关闭、新对话、搜索框(不跟着列表滚) */}
            <div className="shrink-0 border-b border-black/[0.06] px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
              <div className="flex items-center justify-between">
                <h2 id="tutor-history-title" className="font-display text-lg font-semibold text-ink">以前的对话</h2>
                <button type="button" onClick={onClose} aria-label="关闭"
                  className="flex h-11 w-11 items-center justify-center rounded-xl text-ink-soft hover:bg-black/5">
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
              <button type="button" onClick={onNew}
                className="mt-1 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-primary text-sm font-semibold text-white shadow-sm transition hover:brightness-105 active:scale-[0.99]">
                <Plus className="h-4 w-4" aria-hidden="true" /> 新对话
              </button>
              <label className="relative mt-3 block">
                <span className="sr-only">搜索以前的对话</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-mute" aria-hidden="true" />
                <input
                  ref={searchRef}
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  maxLength={40}
                  placeholder="搜一搜问过的问题,比如 apple"
                  className="tutor-history-search h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-10 text-base text-ink placeholder:text-ink-mute focus:border-orange-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-orange-100 sm:text-sm"
                />
                {q && (
                  <button type="button" onClick={() => { setQ(''); searchRef.current?.focus(); }} aria-label="清空搜索"
                    className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-ink-mute hover:text-ink">
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </label>
            </div>

            {/* 列表 */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-4">
              {error ? (
                <div className="px-2 py-10 text-center">
                  <p className="text-sm text-rose-700">{error}</p>
                  <button type="button" onClick={() => void load(0, false)}
                    className="mt-3 min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-medium text-ink hover:bg-slate-50">
                    再试一次
                  </button>
                </div>
              ) : items === null ? (
                <ul className="space-y-2 px-2 pt-4" aria-label="正在加载">
                  {[0, 1, 2, 3].map((i) => <li key={i} className="h-14 animate-pulse rounded-xl bg-slate-100" />)}
                </ul>
              ) : items.length === 0 ? (
                <div className="px-4 py-12 text-center">
                  {searching ? (
                    <>
                      <p className="text-sm font-medium text-ink">没找到「{query}」</p>
                      <p className="mt-1 text-xs text-ink-mute">换个词试试,中文英文都能搜</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-ink">还没有问过问题</p>
                      <p className="mt-1 text-xs text-ink-mute">问过的问题都会存在这里,随时能翻回来看</p>
                    </>
                  )}
                </div>
              ) : (
                groups.map(({ group, rows }) => (
                  <section key={group} aria-label={HISTORY_GROUP_LABEL[group]}>
                    <h3 className="sticky top-0 z-[1] bg-white/95 px-2 pb-1.5 pt-4 text-xs font-semibold text-ink-mute backdrop-blur-sm">
                      {group === 'starred' && <Star className="mr-1 inline h-3 w-3 -translate-y-px fill-amber-400 text-amber-400" aria-hidden="true" />}
                      {HISTORY_GROUP_LABEL[group]}
                    </h3>
                    <ul className="space-y-0.5">
                      {rows.map((it) => {
                        const isCur = it.id === currentId;
                        const isMenu = menuFor === it.id;
                        const isRen = renaming?.id === it.id;
                        const isDel = confirmDel === it.id;
                        const busy = busyId === it.id;
                        return (
                          <li key={it.id} className={`rounded-xl transition-colors ${isCur ? 'bg-orange-50' : isMenu ? 'bg-slate-50' : ''}`}>
                            {isRen ? (
                              <div className="flex items-center gap-2 px-2 py-2">
                                <input
                                  autoFocus
                                  value={renaming.draft}
                                  maxLength={TITLE_MAX}
                                  onChange={(e) => setRenaming({ id: it.id, draft: e.target.value })}
                                  onKeyDown={(e) => {
                                    // 中文输入法组字时的回车是选字,不是保存
                                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void saveTitle(); }
                                  }}
                                  aria-label="新标题"
                                  className="h-10 min-w-0 flex-1 rounded-lg border border-orange-300 bg-white px-3 text-base text-ink focus:outline-none focus:ring-2 focus:ring-orange-100 sm:text-sm"
                                />
                                <button type="button" onClick={() => void saveTitle()} disabled={busy}
                                  className="min-h-10 shrink-0 rounded-lg bg-primary px-3 text-sm font-semibold text-white disabled:opacity-60">
                                  {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-label="保存中" /> : '保存'}
                                </button>
                                <button type="button" onClick={() => setRenaming(null)}
                                  className="min-h-10 shrink-0 rounded-lg px-2 text-sm text-ink-soft hover:bg-black/5">
                                  取消
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center">
                                <button type="button" onClick={() => onPick(it.id)} aria-current={isCur ? 'true' : undefined}
                                  className="min-w-0 flex-1 rounded-xl px-2.5 py-2.5 text-left hover:bg-orange-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-300">
                                  <p className="truncate text-sm font-medium text-ink"><Highlight text={it.title} q={query} /></p>
                                  {it.snippet && (
                                    <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-ink-soft"><Highlight text={it.snippet} q={query} /></p>
                                  )}
                                  <p className="mt-0.5 text-xs text-ink-mute">
                                    {whenLabel(it.updated_at, it.group)}
                                    {it.questions > 0 && ` · 问了 ${it.questions} 次`}
                                    {isCur && <span className="ml-1 font-medium text-orange-700">· 正在看</span>}
                                  </p>
                                </button>
                                <button type="button" onClick={() => void toggleStar(it)} disabled={busy}
                                  aria-pressed={it.starred} aria-label={it.starred ? '取消收藏' : '收藏(不会被自动清理)'}
                                  className="flex h-11 w-10 shrink-0 items-center justify-center rounded-lg hover:bg-black/5 disabled:opacity-50">
                                  <Star className={`h-[18px] w-[18px] transition ${it.starred ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} aria-hidden="true" />
                                </button>
                                <button type="button" onClick={() => { setMenuFor(isMenu ? null : it.id); setConfirmDel(null); }}
                                  aria-expanded={isMenu} aria-label="改名或删掉"
                                  className="mr-1 flex h-11 w-10 shrink-0 items-center justify-center rounded-lg text-ink-mute hover:bg-black/5">
                                  <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
                                </button>
                              </div>
                            )}
                            {isMenu && !isRen && (
                              isDel ? (
                                <div className="px-3 pb-3 pt-0.5" role="alert">
                                  <p className="text-xs leading-5 text-ink-soft">
                                    删掉以后你这里就找不到了{keep ? `(老师 ${keep.deleted} 天内还能看到)` : ''}。
                                  </p>
                                  <div className="mt-2 flex gap-2">
                                    <button type="button" onClick={() => void remove(it.id)} disabled={busy}
                                      className="inline-flex min-h-10 items-center gap-1 rounded-lg bg-rose-600 px-3 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60">
                                      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
                                      删掉
                                    </button>
                                    <button type="button" onClick={() => setConfirmDel(null)}
                                      className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-ink hover:bg-slate-50">
                                      先不删
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex gap-2 px-2.5 pb-2.5">
                                  <button type="button" onClick={() => setRenaming({ id: it.id, draft: it.title })}
                                    className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white text-sm text-ink hover:bg-slate-50">
                                    <Pencil className="h-4 w-4" aria-hidden="true" /> 改名
                                  </button>
                                  <button type="button" onClick={() => setConfirmDel(it.id)}
                                    className="inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-rose-200 bg-white text-sm text-rose-700 hover:bg-rose-50">
                                    <Trash2 className="h-4 w-4" aria-hidden="true" /> 删掉
                                  </button>
                                </div>
                              )
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))
              )}
              {items && hasMore && (
                <div className="px-2 pt-3">
                  <button type="button" onClick={() => void loadMore()} disabled={loadingMore}
                    className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 text-sm text-ink-soft hover:bg-slate-50 disabled:opacity-60">
                    {loadingMore && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                    看更早的
                  </button>
                </div>
              )}
            </div>

            {/* 底部: 讲解方式 + 保存多久 */}
            <div className="max-h-[60dvh] shrink-0 space-y-3 overflow-y-auto overscroll-contain border-t border-black/[0.06] bg-slate-50/70 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
              {!base && <TutorLevelControl defaultOpen={levelOpen} />}
              {keep && (
                <p className="text-xs leading-5 text-ink-mute">
                  没收藏的对话 {keep.days} 天没再问会自动清理,点星星收藏的会一直留着。
                </p>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
