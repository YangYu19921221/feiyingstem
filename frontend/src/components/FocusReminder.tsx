/**
 * 专注力提醒(学习页用)
 * - nudge(30秒无操作): 底部橙色胶囊条,晃动提示,不挡操作
 * - block(60秒无操作,与计时暂停同步): 全屏遮罩 + 轻提示音 → 记一次"发呆"
 * - 切屏回来: 全屏大提示框(和发呆同级醒目) → 记一次"切屏"
 * 事件通过 /student/presence/focus-event 落库,教师端每日数据展示走神次数
 */
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { API_BASE_URL } from '../config/env';

interface Props {
  nudge: boolean;
  block: boolean;
}

/** 轻柔两音提示音(WebAudio 合成,无需音频资源;失败静默) */
const playChime = () => {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [660, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = now + i * 0.18;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.12, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.4);
    });
    setTimeout(() => ctx.close().catch(() => {}), 1500);
  } catch { /* 声音失败不影响提醒 */ }
};

/** 走神事件落库(静默失败) */
const reportFocusEvent = (kind: 'switch' | 'distracted') => {
  const token = localStorage.getItem('access_token');
  if (!token) return;
  fetch(`${API_BASE_URL}/student/presence/focus-event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ kind }),
    keepalive: true,
  }).catch(() => {});
};

export default function FocusReminder({ nudge, block }: Props) {
  // 发呆拦截:出现时响一声+记一次;并保证最短展示 1.5 秒 ——
  // 否则孩子恰好在临界点动了一下,全屏遮罩弹出即消失,看起来像"屏幕闪了一下"
  const [blockShown, setBlockShown] = useState(false);
  const blockShownAtRef = useRef(0);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (block) {
      clearTimeout(hideTimerRef.current);
      if (!blockShown) {
        // 切屏(document.hidden)引起的 isIdle 不算"发呆":那是切屏事件的范畴,
        // 由下面的 5 秒切屏逻辑单独判定和计数。这里只处理"页面还开着但 60 秒没动"
        // 的真·发呆,否则每次切标签都会既记一次 switch 又记一次 distracted,双重污染。
        if (document.hidden) return;
        blockShownAtRef.current = Date.now();
        setBlockShown(true);
        playChime();
        reportFocusEvent('distracted');
      }
    } else if (blockShown) {
      const shownFor = Date.now() - blockShownAtRef.current;
      const remain = Math.max(0, 1500 - shownFor);
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => setBlockShown(false), remain);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block]);
  useEffect(() => () => clearTimeout(hideTimerRef.current), []);

  // 切屏检测:离开满 5 秒才算真切屏(切回来弹全屏提示+计数)。
  // 输入法弹窗/瞬间切回这类 1-2 秒的假切屏不弹不计,免得误吓孩子、污染统计
  const [switchBack, setSwitchBack] = useState(false);
  const hiddenAtRef = useRef(0);
  const switchHideTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) {
        hiddenAtRef.current = Date.now();
      } else if (hiddenAtRef.current > 0) {
        const awayMs = Date.now() - hiddenAtRef.current;
        hiddenAtRef.current = 0;
        if (awayMs >= 5000) {
          reportFocusEvent('switch');
          setSwitchBack(true);
          playChime();
          clearTimeout(switchHideTimerRef.current);
          switchHideTimerRef.current = setTimeout(() => setSwitchBack(false), 3500);
        }
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      clearTimeout(switchHideTimerRef.current);
    };
  }, []);

  return (
    <>
      {/* 第一级:底部轻提醒 */}
      <AnimatePresence>
        {nudge && !blockShown && (
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            className="fixed bottom-6 left-0 right-0 z-40 flex justify-center pointer-events-none"
          >
            <motion.div
              animate={{ rotate: [0, -3, 3, -3, 3, 0] }}
              transition={{ duration: 0.6, repeat: Infinity, repeatDelay: 1.2 }}
              className="px-5 py-2.5 rounded-full bg-gradient-to-r from-orange-500 to-amber-400 text-white text-sm font-semibold shadow-lg"
            >
              🦅 还在吗?动一动继续学习哦~
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 第二级:发呆全屏拦截(与计时暂停同步;最短展示1.5秒防"闪屏"观感) */}
      <AnimatePresence>
        {blockShown && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-sm cursor-pointer"
          >
            <motion.div
              initial={{ scale: 0.8, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="mx-6 max-w-sm w-full bg-white rounded-3xl p-8 text-center shadow-2xl"
            >
              <motion.div
                animate={{ y: [0, -10, 0] }}
                transition={{ duration: 1.2, repeat: Infinity }}
                className="text-6xl mb-4"
              >
                ⏰
              </motion.div>
              <h3 className="text-2xl font-bold text-gray-800 mb-2">小眼睛回来啦~</h3>
              <p className="text-sm text-gray-500 mb-2">
                已暂停计时 · 走神的时间不算学习时长哦
              </p>
              <p className="text-xs text-orange-500 font-medium mb-6">
                👀 发呆次数老师是能看到的哦
              </p>
              <motion.div
                animate={{ scale: [1, 1.06, 1] }}
                transition={{ duration: 1, repeat: Infinity }}
                className="inline-block px-8 py-3 rounded-2xl bg-gradient-to-r from-orange-500 to-amber-400 text-white font-bold shadow-lg"
              >
                点任意位置继续背单词 🚀
              </motion.div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 第三级:切屏回来全屏大提示(离开≥5秒才触发) */}
      <AnimatePresence>
        {switchBack && !blockShown && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSwitchBack(false)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-sm cursor-pointer"
          >
            <motion.div
              initial={{ scale: 0.8, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="mx-6 max-w-sm w-full bg-white rounded-3xl p-8 text-center shadow-2xl border-2 border-red-200"
            >
              <motion.div
                animate={{ rotate: [0, -10, 10, -10, 10, 0] }}
                transition={{ duration: 0.7, repeat: Infinity, repeatDelay: 1 }}
                className="text-6xl mb-4"
              >
                🚨
              </motion.div>
              <h3 className="text-2xl font-bold text-gray-800 mb-2">刚才切出去了哦!</h3>
              <p className="text-sm text-gray-500 mb-2">
                离开学习页面的时间不算学习时长
              </p>
              <p className="text-xs text-red-500 font-semibold mb-4">
                👀 切屏次数老师和爸妈都能看到
              </p>
              <p className="text-sm font-bold text-orange-500">专心背完这组,马上就好 💪</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
