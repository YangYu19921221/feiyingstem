/**
 * 新版本提示条
 * 每 5 分钟(及切回前台时)比对 /version.json 和当前 bundle 的构建号,
 * 服务器已更新 → 底部弹出提示条,点击刷新。
 *
 * 背景:学生端 SPA 一开就是一整天,每次部署后旧 bundle 继续跑,
 * 修掉的 bug 在旧页面上反复出现(复习模式 404、心跳缺失…都因为这个)。
 * 不自动刷新——正在学习中强刷会丢组内进度,让孩子自己点。
 */
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

declare const __BUILD_TS__: string;

const CHECK_MS = 5 * 60_000;

export default function UpdateNudge() {
  const [hasNew, setHasNew] = useState(false);

  useEffect(() => {
    let stopped = false;
    const check = async () => {
      try {
        const resp = await fetch(`/version.json?_=${Date.now()}`, { cache: 'no-store' });
        if (!resp.ok) return;
        const data = await resp.json();
        if (!stopped && data?.v && data.v !== __BUILD_TS__) setHasNew(true);
      } catch { /* 网络失败静默 */ }
    };
    const t = setInterval(() => { if (!document.hidden) check(); }, CHECK_MS);
    const onVis = () => { if (!document.hidden) check(); };
    document.addEventListener('visibilitychange', onVis);
    // 启动 30 秒后先查一次(避开首屏)
    const first = setTimeout(check, 30_000);
    return () => {
      stopped = true;
      clearInterval(t);
      clearTimeout(first);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  return (
    <AnimatePresence>
      {hasNew && (
        <motion.button
          initial={{ opacity: 0, y: 60 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 60 }}
          onClick={() => window.location.reload()}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[70] flex items-center gap-2 px-5 py-2.5 rounded-full bg-gray-900/90 text-white text-sm font-medium shadow-xl backdrop-blur hover:bg-gray-900"
        >
          ✨ 系统更新啦 · 点一下用新版
        </motion.button>
      )}
    </AnimatePresence>
  );
}
