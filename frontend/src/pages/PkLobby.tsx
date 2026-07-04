import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { pkApi } from '../api/pk';
import PkInviteModal from '../components/pk/PkInviteModal';

const QUICK_COUNTS = [2, 4, 6, 10, 20];
const WORD_COUNTS = [5, 10, 15, 20];
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 20;

export default function PkLobby() {
  const navigate = useNavigate();
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [playersRaw, setPlayersRaw] = useState('4'); // 输入框原始文本,失焦时才 clamp
  const [wordCount, setWordCount] = useState(10);
  const [inviteCode, setInviteCode] = useState('');
  const [showInvite, setShowInvite] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const navTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (navTimer.current !== null) window.clearTimeout(navTimer.current);
  }, []);

  const clampPlayers = (n: number) =>
    Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, Math.floor(n) || MIN_PLAYERS));

  /** 统一设置人数(步进器/快捷档/输入框失焦共用),同步输入框显示 */
  const setPlayers = (n: number) => {
    const v = clampPlayers(n);
    setMaxPlayers(v);
    setPlayersRaw(String(v));
  };

  const handleCreate = async () => {
    setError('');
    setCreating(true);
    try {
      const data = await pkApi.createRoom(maxPlayers, wordCount);
      setShowInvite(data.invite_code);
      navTimer.current = window.setTimeout(() => navigate(`/pk/arena/${data.room_id}`), 1500);
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      setError(detail === 'USER_ALREADY_IN_ROOM' ? '你已在另一个 PK 房间中' : detail || e?.message || '创建失败');
      setCreating(false);
    }
  };

  const handleJoin = async () => {
    setError('');
    const code = inviteCode.trim().toUpperCase();
    if (code.length !== 6) {
      setError('邀请码必须是 6 位');
      return;
    }
    try {
      const data = await pkApi.joinRoomByCode(code);
      navigate(`/pk/arena/${data.room_id}`);
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      const errorMap: Record<string, string> = {
        ROOM_NOT_FOUND: '邀请码无效',
        ROOM_FINISHED: '该房间的 PK 已结束',
        ROOM_FULL: '房间已满——可以点「👀 观战」进去看比赛',
        ROOM_ALREADY_STARTED: '房间已开始——可以点「👀 观战」进去看比赛',
        USER_ALREADY_IN_ROOM: '你已在另一个 PK 房间中',
      };
      setError(errorMap[detail] || detail || e?.message || '加入失败');
    }
  };

  const handleSpectate = async () => {
    setError('');
    const code = inviteCode.trim().toUpperCase();
    if (code.length !== 6) {
      setError('邀请码必须是 6 位');
      return;
    }
    try {
      const data = await pkApi.spectateByCode(code);
      navigate(`/pk/arena/${data.room_id}`);
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      const errorMap: Record<string, string> = {
        ROOM_NOT_FOUND: '邀请码无效',
        ROOM_FINISHED: '该房间的 PK 已结束',
        SPECTATORS_FULL: '观众席满啦(30 人)',
      };
      setError(errorMap[detail] || detail || e?.message || '观战失败');
    }
  };

  return (
    <div className="min-h-screen bg-paper relative overflow-hidden">
      {/* 装饰光晕 */}
      <div className="pointer-events-none absolute -top-24 -right-24 w-96 h-96 rounded-full bg-secondary/20 blur-3xl" />
      <div className="pointer-events-none absolute top-1/2 -left-32 w-80 h-80 rounded-full bg-primary/10 blur-3xl" />

      <div className="relative max-w-4xl mx-auto px-5 py-6 sm:py-10">
        <button
          onClick={() => navigate('/student/dashboard')}
          className="text-sm text-ink-mute hover:text-ink mb-4"
        >
          ← 返回主页
        </button>

        {/* 大头图 */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-3xl bg-gradient-to-br from-primary via-orange-400 to-secondary p-6 sm:p-10 text-white shadow-xl mb-6 relative overflow-hidden"
        >
          <motion.span
            className="absolute right-6 top-4 text-6xl sm:text-8xl opacity-25 select-none"
            animate={{ rotate: [0, -8, 8, 0] }}
            transition={{ repeat: Infinity, duration: 4 }}
          >
            ⚔️
          </motion.span>
          <h1 className="font-display text-3xl sm:text-5xl font-bold">PK 竞技场</h1>
          <p className="text-sm sm:text-lg text-white/90 mt-2 max-w-md">
            和同学实时对战,四阶段闯关比拼单词功底
          </p>
          {/* 规则条 */}
          <div className="flex flex-wrap gap-2 mt-4 sm:mt-6">
            {['🧠 只考大家都背过的词', '⚡ 答对越快分越高', '🎓 高中词一题 150 分'].map((t) => (
              <span key={t} className="text-[11px] sm:text-sm bg-white/20 backdrop-blur px-3 py-1.5 rounded-full">
                {t}
              </span>
            ))}
          </div>
        </motion.div>

        {/* 创建 / 加入 双卡 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* 创建房间 */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 }}
            className="card-soft rounded-3xl p-6 sm:p-7"
          >
            <h2 className="font-display text-xl font-bold text-ink flex items-center gap-2 mb-1">
              🏠 创建房间
            </h2>
            <p className="text-xs text-ink-mute mb-5">开好房把邀请码发给同学</p>

            {/* 人数步进器 */}
            <label className="block text-sm font-medium text-ink-soft mb-2">
              房间人数 <span className="text-ink-mute font-normal">({MIN_PLAYERS}~{MAX_PLAYERS} 人)</span>
            </label>
            <div className="flex items-center gap-4 mb-2">
              <button
                onClick={() => setPlayers(maxPlayers - 1)}
                disabled={maxPlayers <= MIN_PLAYERS}
                className="w-12 h-12 rounded-2xl bg-orange-100 text-primary text-2xl font-bold disabled:opacity-40 active:scale-95 transition"
              >
                −
              </button>
              <div className="flex-1 text-center">
                <input
                  type="text"
                  inputMode="numeric"
                  value={playersRaw}
                  onChange={(e) => setPlayersRaw(e.target.value.replace(/\D/g, '').slice(0, 2))}
                  onBlur={() => setPlayers(Number(playersRaw))}
                  className="w-24 text-center text-4xl font-bold text-primary font-numeric bg-transparent focus:outline-none"
                />
                <span className="text-base text-ink-mute">人</span>
              </div>
              <button
                onClick={() => setPlayers(maxPlayers + 1)}
                disabled={maxPlayers >= MAX_PLAYERS}
                className="w-12 h-12 rounded-2xl bg-orange-100 text-primary text-2xl font-bold disabled:opacity-40 active:scale-95 transition"
              >
                +
              </button>
            </div>
            <div className="flex gap-2 mb-5">
              {QUICK_COUNTS.map((n) => (
                <button
                  key={n}
                  onClick={() => setPlayers(n)}
                  className={`flex-1 py-1.5 rounded-xl text-sm font-medium transition ${
                    maxPlayers === n
                      ? 'bg-primary text-white shadow-sm'
                      : 'bg-gray-100 text-ink-soft hover:bg-orange-100'
                  }`}
                >
                  {n}人
                </button>
              ))}
            </div>

            {/* 题量 */}
            <label className="block text-sm font-medium text-ink-soft mb-2">
              单词数量 <span className="text-ink-mute font-normal">(每词过 4 关 ≈ {wordCount * 4} 题)</span>
            </label>
            <div className="flex gap-2 mb-6">
              {WORD_COUNTS.map((n) => (
                <button
                  key={n}
                  onClick={() => setWordCount(n)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition ${
                    wordCount === n
                      ? 'bg-primary text-white shadow-sm'
                      : 'bg-gray-100 text-ink-soft hover:bg-orange-100'
                  }`}
                >
                  {n} 词
                </button>
              ))}
            </div>

            <button
              onClick={handleCreate}
              disabled={creating}
              className="btn-glow w-full py-3.5 text-white rounded-2xl font-semibold text-base"
            >
              {creating ? '创建中…' : '🚀 创建并获取邀请码'}
            </button>
            <p className="text-[11px] text-ink-mute mt-3 text-center">
              开局时自动从「所有人都背过的单词」里随机抽题,公平比拼
            </p>
          </motion.div>

          {/* 加入房间 */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.16 }}
            className="card-soft rounded-3xl p-6 sm:p-7 flex flex-col"
          >
            <h2 className="font-display text-xl font-bold text-ink flex items-center gap-2 mb-1">
              🎟️ 加入房间
            </h2>
            <p className="text-xs text-ink-mute mb-5">输入同学发你的 6 位邀请码</p>

            <div className="flex-1 flex flex-col justify-center">
              <input
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                className="w-full px-4 py-4 border-2 border-orange-200 rounded-2xl font-mono tracking-[0.45em] text-center text-3xl uppercase text-ink focus:outline-none focus:border-primary bg-white"
                maxLength={6}
                placeholder="ABC123"
              />
              <button
                onClick={handleJoin}
                className="btn-glow w-full py-3.5 mt-5 text-white rounded-2xl font-semibold text-base"
              >
                ⚔️ 加入对战
              </button>
              <button
                onClick={handleSpectate}
                className="w-full py-3 mt-2.5 rounded-2xl font-semibold text-base bg-gray-100 hover:bg-orange-100 text-ink-soft transition"
              >
                👀 观战(满员/已开局也能看)
              </button>
            </div>
            <p className="text-[11px] text-ink-mute mt-3 text-center">
              没有邀请码?让同学先创建房间,或自己开一个
            </p>
          </motion.div>
        </div>

        {error && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-4 text-sm text-error bg-red-50 rounded-2xl px-4 py-3"
          >
            ⚠️ {error}
          </motion.p>
        )}

        {showInvite && (
          <PkInviteModal inviteCode={showInvite} onClose={() => setShowInvite(null)} />
        )}
      </div>
    </div>
  );
}
