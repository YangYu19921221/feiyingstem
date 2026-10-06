/**
 * 比赛提示横幅(2026-10-06):今天单词王只比作业里的单词,学生从书本进了作业范围外的
 * 单元时,在学习页顶部说清「这里背的不计入单词王」。
 *
 * 数据来自 startLearning 广播的 CONTEST_NOTICE_EVENT(后端 contest_notice,与评选同源)。
 * 只在当前路由仍是那个单元的学习页时显示;离开单元页自动收起。可手动关掉,
 * 同一天同一单元关过就不再弹(sessionStorage,换天/换单元重新提示)。
 *
 * 手机上横幅会盖住学习页顶栏的「退出」(实测 375 宽时横幅高 107px、退出在 y=30),
 * 所以 8 秒后自动收起(不记已读,下次进来还提示),点横幅任意处也立即收起。
 */
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { CONTEST_NOTICE_EVENT } from '../api/progress';

const AUTO_HIDE_MS = 8000;

const dismissKey = (unitId: number) =>
  `contest-notice-dismissed:${new Date().toDateString()}:${unitId}`;

export default function ContestNoticeBanner() {
  const location = useLocation();
  const [state, setState] = useState<{ unitId: number; notice: string } | null>(null);

  useEffect(() => {
    const onNotice = (e: Event) => {
      const { unitId, notice } = (e as CustomEvent<{ unitId: number; notice: string | null }>).detail;
      if (!notice || sessionStorage.getItem(dismissKey(unitId))) {
        setState(null);
        return;
      }
      setState({ unitId, notice });
    };
    window.addEventListener(CONTEST_NOTICE_EVENT, onNotice);
    return () => window.removeEventListener(CONTEST_NOTICE_EVENT, onNotice);
  }, []);

  // 只在那个单元的学习页上显示(路由形如 /student/units/:unitId/<mode>)
  const onUnitPage = state != null && location.pathname.startsWith(`/student/units/${state.unitId}/`);

  useEffect(() => {
    if (!state || !onUnitPage) return;
    const t = window.setTimeout(() => setState(null), AUTO_HIDE_MS);
    return () => window.clearTimeout(t);
  }, [state, onUnitPage]);

  if (!state || !onUnitPage) return null;

  const dismiss = () => {
    sessionStorage.setItem(dismissKey(state.unitId), '1');
    setState(null);
  };

  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-[75] flex justify-center px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pointer-events-none"
    >
      <div
        onClick={() => setState(null)}
        className="pointer-events-auto flex max-w-2xl cursor-pointer items-start gap-2 rounded-xl border border-amber-300 bg-amber-50/95 px-4 py-2.5 text-sm text-amber-900 shadow-md backdrop-blur"
      >
        <span aria-hidden="true">👑</span>
        <p className="flex-1 leading-snug">{state.notice}</p>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); dismiss(); }}
          className="-mr-1 shrink-0 rounded-md px-2 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-100"
          aria-label="知道了,关闭提示"
        >
          知道了
        </button>
      </div>
    </div>
  );
}
