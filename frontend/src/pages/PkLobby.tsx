import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { pkApi } from '../api/pk';
import PkInviteModal from '../components/pk/PkInviteModal';
import { tournamentApi, type MyMatch } from '../api/tournament';
import { toast } from '../components/Toast';

const QUICK_COUNTS = [2, 4, 6, 10, 20];
const WORD_COUNTS = [5, 10, 15, 20];
const TEAM_COUNTS = [2, 3, 4];
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 20;

/** 从 localStorage 读当前角色(教师=组织者建房;学生=凭码加入)。 */
function getRole(): string {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}').role || 'student';
  } catch {
    return 'student';
  }
}

export default function PkLobby() {
  const navigate = useNavigate();
  const role = getRole();
  const isTeacher = role === 'teacher' || role === 'admin';
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [playersRaw, setPlayersRaw] = useState('4'); // 输入框原始文本,失焦时才 clamp
  const [wordCount, setWordCount] = useState(10);
  const [mode, setMode] = useState<'individual' | 'team'>('individual');
  const [teamCount, setTeamCount] = useState(2);
  const [inviteCode, setInviteCode] = useState('');
  const [showInvite, setShowInvite] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [myMatches, setMyMatches] = useState<MyMatch[]>([]);
  const [entering, setEntering] = useState<number | null>(null);
  const navTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (navTimer.current !== null) window.clearTimeout(navTimer.current);
  }, []);

  // 晋级赛待打对局:仅学生需要(进大厅拉一次 + 每 20 秒刷,对手先开好房后能拿到 invite_code)
  useEffect(() => {
    if (isTeacher) return;
    const load = () => tournamentApi.myMatches().then(setMyMatches).catch(() => {});
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 20000);
    return () => clearInterval(t);
  }, [isTeacher]);

  const enterMatch = async (m: MyMatch) => {
    setEntering(m.match_id);
    try {
      const r = await tournamentApi.enterMatch(m.match_id);
      navigate(`/pk/arena/${r.room_id}`);
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      toast.error(detail === 'MATCH_ALREADY_FINISHED' ? '这场对局已结束' : detail || '进入对局失败');
      setEntering(null);
      tournamentApi.myMatches().then(setMyMatches).catch(() => {});
    }
  };

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
      const data = await pkApi.createRoom(maxPlayers, wordCount, mode, teamCount);
      setShowInvite(data.invite_code);
      navTimer.current = window.setTimeout(() => navigate(`/pk/arena/${data.room_id}`), 1500);
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      const msg = detail === 'USER_ALREADY_IN_ROOM'
        ? '你已开了一个 PK 房间,先结束它再开新的'
        : e?.response?.status === 403
          ? '只有教师可以创建 PK 房间'
          : detail || e?.message || '创建失败';
      setError(msg);
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
          onClick={() => navigate(isTeacher ? '/teacher/dashboard' : '/student/dashboard')}
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
            {isTeacher
              ? '你来组织,学生实时对战——四阶段闯关比拼单词功底'
              : '和同学实时对战,四阶段闯关比拼单词功底'}
          </p>
          {/* 规则条 */}
          <div className="flex flex-wrap gap-2 mt-4 sm:mt-6">
            {(isTeacher
              ? ['🎛️ 老师建房不下场', '🧠 只考大家都背过的词', '👥 可个人赛 / 分组赛']
              : ['🧠 只考大家都背过的词', '⚡ 答对越快分越高', '🎓 高中词一题 150 分']
            ).map((t) => (
              <span key={t} className="text-[11px] sm:text-sm bg-white/20 backdrop-blur px-3 py-1.5 rounded-full">
                {t}
              </span>
            ))}
          </div>
        </motion.div>

        {/* 晋级赛待打对局:老师办的正式赛事,置顶醒目 */}
        {myMatches.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 mb-6"
          >
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xl">🏆</span>
              <h2 className="font-bold text-amber-900">晋级赛 · 你有 {myMatches.length} 场对局要打</h2>
            </div>
            <div className="space-y-2">
              {myMatches.map((m) => (
                <div key={m.match_id} className="flex items-center gap-3 bg-white rounded-xl px-3 py-2.5 shadow-sm">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-ink truncate">{m.tournament_name}</p>
                    <p className="text-xs text-ink-mute">
                      {m.stage === 'group' ? `小组赛` : m.stage === 'ko' ? '淘汰赛' : '黑马组'}
                      {' · 对阵 '}<span className="font-medium text-ink">{m.opponent_name}</span>
                    </p>
                  </div>
                  <button
                    onClick={() => enterMatch(m)}
                    disabled={entering === m.match_id}
                    className="shrink-0 px-4 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-white text-sm font-semibold shadow disabled:opacity-50"
                  >
                    {entering === m.match_id ? '进入中…' : m.invite_code ? '⚔️ 对手在等你!' : '⚔️ 开打'}
                  </button>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* 创建(教师) / 加入(学生) */}
        <div className={`grid grid-cols-1 ${isTeacher ? 'md:grid-cols-2' : ''} gap-5`}>
          {/* 创建房间:仅教师(组织者)可见 */}
          {isTeacher && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 }}
            className="card-soft rounded-3xl p-6 sm:p-7"
          >
            <h2 className="font-display text-xl font-bold text-ink flex items-center gap-2 mb-1">
              🏠 创建房间
            </h2>
            <p className="text-xs text-ink-mute mb-4">你作为组织者建房、发码给学生,开局后监控战况(不下场答题)</p>

            {/* 模式切换:个人赛 / 分组赛 */}
            <label className="block text-sm font-medium text-ink-soft mb-2">对战模式</label>
            <div className="flex gap-2 mb-4">
              {([
                { k: 'individual', label: '👤 个人赛', desc: '各自排名' },
                { k: 'team', label: '👥 分组赛', desc: '按队伍比拼' },
              ] as const).map((m) => (
                <button
                  key={m.k}
                  onClick={() => setMode(m.k)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition ${
                    mode === m.k
                      ? 'bg-primary text-white shadow-sm'
                      : 'bg-gray-100 text-ink-soft hover:bg-orange-100'
                  }`}
                >
                  {m.label}
                  <span className={`block text-[10px] font-normal ${mode === m.k ? 'text-white/80' : 'text-ink-mute'}`}>{m.desc}</span>
                </button>
              ))}
            </div>

            {/* 分组赛:队伍数 */}
            {mode === 'team' && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-ink-soft mb-2">分几队</label>
                <div className="flex gap-2">
                  {TEAM_COUNTS.map((n) => (
                    <button
                      key={n}
                      onClick={() => setTeamCount(n)}
                      className={`flex-1 py-2 rounded-xl text-sm font-semibold transition ${
                        teamCount === n
                          ? 'bg-primary text-white shadow-sm'
                          : 'bg-gray-100 text-ink-soft hover:bg-orange-100'
                      }`}
                    >
                      {n} 队
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-ink-mute mt-2">学生进房自动均衡分队,开局前你可在竞技场调整</p>
              </div>
            )}

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
              开局时自动从「所有参赛学生都背过的单词」里随机抽题,不够时用学过的其余词补齐
            </p>
          </motion.div>
          )}

          {/* 加入房间:学生凭老师发的邀请码进场 */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.16 }}
            className="card-soft rounded-3xl p-6 sm:p-7 flex flex-col"
          >
            <h2 className="font-display text-xl font-bold text-ink flex items-center gap-2 mb-1">
              🎟️ 加入房间
            </h2>
            <p className="text-xs text-ink-mute mb-5">
              {isTeacher ? '也可以用邀请码进入别的老师开的房观战' : '输入老师发你的 6 位邀请码'}
            </p>

            <div className="flex-1 flex flex-col justify-center">
              <input
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                className="w-full px-4 py-4 border-2 border-orange-200 rounded-2xl font-mono tracking-[0.45em] text-center text-3xl uppercase text-ink focus:outline-none focus:border-primary bg-white"
                maxLength={6}
                placeholder="ABC123"
              />
              {!isTeacher && (
                <button
                  onClick={handleJoin}
                  className="btn-glow w-full py-3.5 mt-5 text-white rounded-2xl font-semibold text-base"
                >
                  ⚔️ 加入对战
                </button>
              )}
              <button
                onClick={handleSpectate}
                className={`w-full py-3 ${isTeacher ? 'mt-5' : 'mt-2.5'} rounded-2xl font-semibold text-base bg-gray-100 hover:bg-orange-100 text-ink-soft transition`}
              >
                👀 观战(满员/已开局也能看)
              </button>
            </div>
            <p className="text-[11px] text-ink-mute mt-3 text-center">
              {isTeacher ? '学生在自己的 PK 大厅输入邀请码即可加入你的房间' : '没有邀请码?等老师创建房间后发给你'}
            </p>
          </motion.div>
        </div>

        {/* 玩法说明:教师看「怎么组织」,学生看「怎么打」 */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.24 }}
          className="card-soft rounded-3xl p-6 sm:p-7 mt-5"
        >
          <h2 className="font-display text-lg font-bold text-ink flex items-center gap-2 mb-4">
            📖 玩法说明
          </h2>

          {isTeacher ? (
            <div className="space-y-4 text-sm text-ink-soft leading-relaxed">
              <div>
                <p className="font-semibold text-ink mb-1">① 建房(你是组织者,不下场答题)</p>
                <p>选「个人赛 / 分组赛」、房间人数、每局词数,点创建拿到 6 位邀请码,发给学生。</p>
              </div>
              <div>
                <p className="font-semibold text-ink mb-1">② 学生加入</p>
                <p>学生在自己的 PK 大厅输入邀请码进房。分组赛会自动把学生均衡分到各队,开局前你可在竞技场里手动调队、移出学生。</p>
              </div>
              <div>
                <p className="font-semibold text-ink mb-1">③ 你开局并监控</p>
                <p>至少 2 名学生在线即可开局(分组赛要求每队都有人)。开局后你看到实时题目、作答进度和排行榜,但不答题。随时可「结束本场对战」。</p>
              </div>
              <div>
                <p className="font-semibold text-ink mb-1">④ 出题与计分</p>
                <p>系统自动从「所有参赛学生都背过的单词」里随机抽题(不够时用学过的其余词补齐)。每个词闯 4 关:🗂️分类 → 🎤语音 → ✍️听写 → 🏁过关。答对得分,答得越快加成越高;单词按学段定分:小学 100 / 初中 120 / 高中 150。</p>
              </div>
              <div>
                <p className="font-semibold text-ink mb-1">⑤ 分组赛怎么比</p>
                <p>队伍榜按<span className="font-semibold text-ink">人均分</span>排名(人多的队不占便宜),终局展示胜队和每队人均/总分。</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4 text-sm text-ink-soft leading-relaxed">
              <div>
                <p className="font-semibold text-ink mb-1">① 加入老师的房间</p>
                <p>输入老师发你的 6 位邀请码,点「加入对战」。房满或已开局也能点「观战」看比赛。</p>
              </div>
              <div>
                <p className="font-semibold text-ink mb-1">② 每个词闯 4 关</p>
                <p>🗂️ <span className="font-medium text-ink">分类</span>:判断词的类别 → 🎤 <span className="font-medium text-ink">语音</span>:跟读单词 → ✍️ <span className="font-medium text-ink">听写</span>:听发音拼出来 → 🏁 <span className="font-medium text-ink">过关</span>:看中文拼出单词。所有人一起同步过关,答完等其他人。</p>
              </div>
              <div>
                <p className="font-semibold text-ink mb-1">③ 怎么得分</p>
                <p>答对才有分,<span className="font-semibold text-ink">答得越快加成越高</span>;答错或超时得 0 分,不倒扣。单词越难分越高:小学 100 / 初中 120 / 高中 150 分。连对会有连击 🔥。</p>
              </div>
              <div>
                <p className="font-semibold text-ink mb-1">④ 只考大家都背过的词</p>
                <p>题目只从「房间里所有人都背过的单词」里出,谁也不吃亏。想拿高分,平时多去学习流程背单词。</p>
              </div>
              <div>
                <p className="font-semibold text-ink mb-1">⑤ 分组赛</p>
                <p>老师开分组赛时你会被分到某个队,右侧「队伍榜」看哪个队领先——按<span className="font-semibold text-ink">人均分</span>算,和队友一起冲榜。</p>
              </div>
            </div>
          )}
        </motion.div>

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
