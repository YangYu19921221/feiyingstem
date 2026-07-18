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
  const [serverV, setServerV] = useState('');

  useEffect(() => {
    let stopped = false;
    const check = async () => {
      try {
        const resp = await fetch(`/version.json?_=${Date.now()}`, { cache: 'no-store' });
        if (!resp.ok) return;
        const data = await resp.json();
        if (stopped || !data?.v || data.v === __BUILD_TS__) return;
        // 防死循环:若已为这个服务器版本号刷新过一次(sessionStorage 记录)仍对不上,
        // 说明服务器 bundle 与 version.json 不一致(部署混装事故),再弹也没用,静默。
        // 实测踩坑:混装部署后提示条对全员永远弹,点了刷新也消不掉。
        if (sessionStorage.getItem('nudge_reloaded_for') === data.v) return;
        setServerV(data.v);
        setHasNew(true);
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
          onClick={() => {
            try { sessionStorage.setItem('nudge_reloaded_for', serverV); } catch { /* 隐私模式忽略 */ }
            window.location.reload();
          }}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[70] flex items-center gap-2 px-5 py-2.5 rounded-full bg-gray-900/90 text-white text-sm font-medium shadow-xl backdrop-blur hover:bg-gray-900"
        >
          ✨ 系统更新啦 · 点一下用新版
        </motion.button>
      )}
    </AnimatePresence>
  );
}
