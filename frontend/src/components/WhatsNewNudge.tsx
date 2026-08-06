/**
 * 新功能公告 —— 按角色弹一次,说清「在哪儿用」
 *
 * 与 UpdateNudge 的分工:UpdateNudge 说「代码更新了,刷新一下」,
 * 这里说「多了什么功能、在哪儿点」。两者互不替代——刷新完仍然不知道新功能在哪。
 *
 * 设计取舍:
 * - 学生正在学习页(全屏答题)时不弹,免得打断答题;回首页再弹
 * - 已读记录按 id 存 localStorage,永不重弹;老用户首次只看近 30 天的条目
 * - 一次最多显示 3 条,多了没人读
 */
import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, MapPin, Sparkles, X } from 'lucide-react';
import { WHATS_NEW, WHATS_NEW_GRACE_DAYS, type WhatsNewEntry } from '../data/whatsNew';

const SEEN_KEY = 'whats_new_seen_v1';
const INIT_KEY = 'whats_new_initialized_v1';
const MAX_SHOWN = 3;

/** 学习中的全屏页面不打断(答题、对战、考试、大屏) */
const QUIET_PATTERNS = [
  '/learn', '/dictation', '/spelling', '/quiz', '/fillblank', '/sentencefill',
  '/exam', '/handwriting', '/pk/arena', '/battle', '/bigscreen', '/competition',
  '/phonics', '/phonetics', '/reading/',
];

function readSeen(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((x) => typeof x === 'string') : [];
  } catch { return []; }
}

function writeSeen(ids: string[]) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(ids.slice(-200))); } catch { /* 隐私模式忽略 */ }
}

function currentRole(): string | null {
  try {
    const u = JSON.parse(localStorage.getItem('user') || 'null');
    return typeof u?.role === 'string' ? u.role : null;
  } catch { return null; }
}

/** 首次启用本机制:把 30 天前的老条目直接标记已读,避免老用户被历史功能糊一脸 */
function initializeSeenOnce() {
  try {
    if (localStorage.getItem(INIT_KEY)) return;
    const cutoff = Date.now() - WHATS_NEW_GRACE_DAYS * 86_400_000;
    const stale = WHATS_NEW
      .filter((e) => {
        const t = Date.parse(e.date);
        return Number.isFinite(t) && t < cutoff;
      })
      .map((e) => e.id);
    if (stale.length) writeSeen([...readSeen(), ...stale]);
    localStorage.setItem(INIT_KEY, '1');
  } catch { /* 隐私模式忽略 */ }
}

export default function WhatsNewNudge() {
  const navigate = useNavigate();
  const location = useLocation();
  const [seen, setSeen] = useState<string[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    initializeSeenOnce();
    setSeen(readSeen());
    setReady(true);
  }, []);

  const role = currentRole();
  const quiet = QUIET_PATTERNS.some((p) => location.pathname.includes(p));

  const pending = useMemo<WhatsNewEntry[]>(() => {
    if (!ready || !role) return [];
    return WHATS_NEW
      .filter((e) => e.roles.includes(role as WhatsNewEntry['roles'][number]))
      .filter((e) => !seen.includes(e.id))
      .slice(0, MAX_SHOWN);
  }, [ready, role, seen]);

  const dismiss = () => {
    const ids = [...seen, ...pending.map((e) => e.id)];
    writeSeen(ids);
    setSeen(ids);
  };

  const go = (entry: WhatsNewEntry) => {
    dismiss();
    if (entry.route) navigate(entry.route);
  };

  const open = pending.length > 0 && !quiet;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/45 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={dismiss}
          role="dialog"
          aria-modal="true"
          aria-labelledby="whats-new-title"
        >
          <motion.div
            initial={{ y: '4%', opacity: 0.7 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '3%', opacity: 0 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[88dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
          >
            <div className="flex items-start gap-3 border-b border-black/[0.06] px-5 py-4">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-warm/[0.12] text-accent-warm">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 id="whats-new-title" className="font-display text-lg font-semibold text-ink">
                  有新功能可以用了
                </h2>
                <p className="mt-0.5 text-xs text-ink-mute">
                  {pending.length > 1 ? `${pending.length} 项更新` : '看看在哪儿用'}
                </p>
              </div>
              <button
                type="button"
                onClick={dismiss}
                aria-label="关闭"
                className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-ink-mute transition hover:bg-black/5 hover:text-ink"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <div className="min-h-0 flex-1 divide-y divide-black/[0.06] overflow-y-auto">
              {pending.map((entry) => (
                <article key={entry.id} className="px-5 py-4">
                  <h3 className="font-semibold text-ink">{entry.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-ink-soft">{entry.desc}</p>
                  {/* 「在哪儿用」是公告最容易漏的一句,单独起一行给足视觉重量 */}
                  <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-black/[0.03] px-3 py-2 text-xs leading-relaxed text-ink-soft">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-warm" aria-hidden="true" />
                    <span><span className="font-medium text-ink">在哪儿用：</span>{entry.where}</span>
                  </p>
                  {entry.route && (
                    <button
                      type="button"
                      onClick={() => go(entry)}
                      className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-accent-warm px-4 text-sm font-semibold text-white transition hover:opacity-90 active:scale-95"
                    >
                      去看看
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </article>
              ))}
            </div>

            <div
              className="border-t border-black/[0.06] px-5 py-3"
              style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
            >
              <button
                type="button"
                onClick={dismiss}
                className="min-h-11 w-full rounded-xl bg-black/[0.05] text-sm font-medium text-ink-soft transition hover:bg-black/[0.08]"
              >
                知道了
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
