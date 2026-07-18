/**
 * 追赶战报条 - 组末总结页的游戏化钩子
 * 组末记录落库后拉今日班级词量榜,告诉学生"身后的人还差几个词追上你":
 * 有人在追 → 不敢停;垫底 → 给向上目标;第一名 → 守擂话术。
 * 拉不到榜/不在班级/未上榜 → 静默不渲染,绝不打断学习流程。
 */
import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { getLeaderboard } from '../../api/leaderboard';
import { maskName, isLivePrivacyOn } from '../../utils/livePrivacy';
import apiClient from '../../api/client';

interface ChaseLine {
  emoji: string;
  text: string;
  hot: boolean;  // 差距≤2词的贴身肉搏,红色+跳动
}

interface ChaseInfo {
  lines: ChaseLine[];        // 向上(追上一名)+向下(身后追我)两条,存在则都显示
  className: string | null;  // 榜单所属班级(学生可能不知道自己在和谁比)
}

const ChaseBanner = () => {
  const [info, setInfo] = useState<ChaseInfo | null>(null);
  // 今日词数拆分:总数 + 史上首见新词(复习日新词=0 属正常,与教师端「新N」同口径)
  const [wordSplit, setWordSplit] = useState<{ today_words: number; new_words: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    // 组末记录是异步提交的,稍等再拉榜,词数才包含刚学完的这一组
    const t = setTimeout(async () => {
      // 今日词数拆分与榜单并行拉,词数拆分不依赖班级(没班级也能看到自己的新词数)
      apiClient.get<{ today_words: number; new_words: number }>('/student/today-words')
        .then(d => { if (!cancelled) setWordSplit(d); })
        .catch(() => {});
      try {
        const d = await getLeaderboard('vocabulary', 'today', 'class');
        const myRank = d.my_rank;
        if (cancelled || !d.has_class || myRank == null) return;
        // 投屏设备开了直播打码时,追赶文案里的名字一并掩码
        const dn = (full: string | null, user: string) => {
          const name = full || user;
          return isLivePrivacyOn() ? maskName(name) : name;
        };
        const behind = d.neighbors.find(n => n.rank === myRank + 1);
        const ahead = d.neighbors.find(n => n.rank === myRank - 1);
        const cls = d.class_name;
        // 向上+向下两条战线同时给:只给单向时,中游学生要么只见"追人"要么只见"被追",
        // 用户反馈"只看到距离上一名还差多少,没看到身后差多少追上我"即此因
        const lines: ChaseLine[] = [];
        if (ahead) {
          const gap = ahead.value - d.my_value;
          const name = dn(ahead.full_name, ahead.username);
          lines.push(gap > 0
            ? { emoji: '🎯', text: `再学 ${gap} 个词就追上 ${name},冲一组!`, hot: false }
            : { emoji: '🎯', text: `你和 ${name} 并驾齐驱,再来一组反超`, hot: false });
        }
        if (behind) {
          const gap = d.my_value - behind.value;
          const name = dn(behind.full_name, behind.username);
          if (gap <= 0) {
            lines.push({ emoji: '😱', text: `${name} 已经追平你!下一组直接反超`, hot: true });
          } else if (myRank === 1) {
            lines.push({ emoji: '👑', text: `今日第一!${name} 只差 ${gap} 个词就追上你,守住王座`, hot: gap <= 2 });
          } else {
            lines.push({ emoji: '⚡', text: `身后的 ${name} 只差 ${gap} 个词就追上你了,别停!`, hot: gap <= 2 });
          }
        }
        if (!lines.length && myRank === 1) {
          // 今天班里只有自己上榜(第一个开学的孩子):以前静默不显示,
          // 看起来像功能不存在;给先发占位话术,也让单人自测能看到横幅
          lines.push({ emoji: '🚀', text: `今日班级榜第一!已学 ${d.my_value} 个词,同学们还没追来`, hot: false });
        }
        if (lines.length) setInfo({ lines, className: cls });
      } catch { /* 榜挂了就不展示 */ }
    }, 1500);
    return () => { cancelled = true; clearTimeout(t); };
  }, []);

  if (!info && !wordSplit) return null;
  const anyHot = !!info && info.lines.some(l => l.hot);
  return (
    <motion.div
      initial={{ opacity: 0, y: -12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 22 }}
      className={`w-full max-w-md mx-auto mb-4 rounded-2xl px-5 py-3.5 shadow-sm border ${
        anyHot
          ? 'bg-gradient-to-r from-red-50 to-orange-50 border-red-200'
          : 'bg-gradient-to-r from-orange-50 to-yellow-50 border-orange-200'
      }`}
    >
      {/* 榜单归属:孩子(尤其多班/新转班的)要知道自己在和哪个班的同学比 */}
      {info?.className && (
        <p className="text-[10px] leading-tight text-gray-400 mb-1">
          {info.className} · 今日词量榜
        </p>
      )}
      {/* 今日词数拆分:让孩子知道今天"量"和"新"各是多少;复习日新词0不扎眼,量还在 */}
      {wordSplit && wordSplit.today_words > 0 && (
        <p className="text-xs text-gray-500 mb-1.5">
          📚 今天已学 <span className="font-bold text-orange-600">{wordSplit.today_words}</span> 个词
          {wordSplit.new_words > 0 ? (
            <> · 其中 <span className="font-bold text-emerald-600">{wordSplit.new_words}</span> 个是第一次学的新词 🌱</>
          ) : (
            <> · 都是复习巩固,越练越熟 💪</>
          )}
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        {(info?.lines ?? []).map((line, i) => (
          <div key={i} className="flex items-center gap-3">
            <motion.span
              className="text-2xl shrink-0"
              animate={line.hot ? { scale: [1, 1.3, 1] } : { rotate: [0, -8, 8, 0] }}
              transition={{ duration: line.hot ? 0.8 : 2.2, repeat: Infinity, repeatDelay: line.hot ? 0 : 1.5 }}
            >
              {line.emoji}
            </motion.span>
            <p className={`text-sm font-bold ${line.hot ? 'text-red-600' : 'text-orange-700'}`}>
              {line.text}
            </p>
          </div>
        ))}
      </div>
    </motion.div>
  );
};

export default ChaseBanner;
