import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Check, CheckCircle2, CircleAlert, Clipboard, Clock3, Eye, Flag, LoaderCircle, MonitorCog, PlugZap, RotateCcw, Swords, Trophy, UserRound, Users } from 'lucide-react';
import { usePkSocket, type PkServerEvent } from '../hooks/usePkSocket';
import {
  pkApi,
  type PkFinalRankItem,
  type PkRoomSnapshot,
  type PkLiveRankItem,
  type PkTeamRankItem,
} from '../api/pk';
import ClassificationPhase from '../components/classify/ClassificationPhase';
import DictationSingle from '../components/classify/DictationSingle';
import PkExamCard, { type PkExamType } from '../components/pk/PkExamCard';
import PkPhaseStepper from '../components/pk/PkPhaseStepper';
import PkLiveRanking from '../components/pk/PkLiveRanking';
import PkResultBoard from '../components/pk/PkResultBoard';
import PkTeacherLiveBoard from '../components/pk/PkTeacherLiveBoard';
import PkTeacherResultBoard from '../components/pk/PkTeacherResultBoard';
import { teamLabel, topMembersByTeam } from '../utils/pkTeam';

interface CurrentQuestion {
  q_seq: number;           // 服务端下发的题号(提交时回显,幂等校验)
  stage: string;           // classify / dictation / exam
  word: { id: number; word: string; translation: string };
  points?: number;         // 本题分值(按该词学段)
  group_idx?: number;
  group_total?: number;
  exam_type?: PkExamType;  // 过关阶段题型(服务端权威),仅 stage==='exam' 时有
  options?: string[];      // 过关选择题选项(en_to_cn/cn_to_en)
  copies_left?: number;    // 听写抄写态:还需抄对几遍
}

function getMeId(): number {
  // JWT sub is canonical: server uses it for auth, so we use it for "我" identity.
  // localStorage user/user_id can drift between tabs; don't trust it.
  const token = localStorage.getItem('access_token') || '';
  try {
    const payload = JSON.parse(atob(token.split('.')[1] || ''));
    const fromJwt = Number(payload.sub);
    if (fromJwt) return fromJwt;
  } catch {
    // fall through — invalid/missing token. Auth guard will handle navigation.
  }
  return 0;
}

const noOp = () => {};
const noOpAudio: (w: string) => void = () => {};

/** 从房间快照推导初始榜单(开局/重连时 live_ranking 还没来) */
function rankingFromSnapshot(snap: PkRoomSnapshot): PkLiveRankItem[] {
  const items = snap.players.map((p) => ({
    user_id: p.user_id,
    nickname: p.nickname,
    points: p.points ?? 0,
    correct: p.correct,
    wrong: p.wrong,
    streak: p.streak ?? 0,
    total_time_ms: p.total_time_ms,
    online: p.online,
    stage: p.stage ?? 'classify',
    group_idx: p.group_idx ?? 0,
    group_total: p.group_total ?? 0,
    progress: p.progress ?? 0,
    finished: p.finished,
    team: p.team,
    rank: 0,
  }));
  // 掌握赛:完成者优先(按进度),再按进度降序;开局无进度时保持稳定
  items.sort((a, b) => (Number(b.finished) - Number(a.finished)) || ((b.progress ?? 0) - (a.progress ?? 0)) || (a.total_time_ms - b.total_time_ms));
  items.forEach((it, i) => { it.rank = i + 1; });
  return items;
}

export default function PkArena() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const meId = getMeId();
  const token = localStorage.getItem('access_token') || '';

  const [snapshot, setSnapshot] = useState<PkRoomSnapshot | null>(null);
  const [currentQ, setCurrentQ] = useState<CurrentQuestion | null>(null);
  const questionStartedAtRef = useRef<number>(0);
  const [submitting, setSubmitting] = useState(false);  // 提交中防重复(并行竞速无"等其他人")
  const [liveRanking, setLiveRanking] = useState<PkLiveRankItem[] | null>(null);
  const [totalPlayers, setTotalPlayers] = useState(0);
  const [teamRanking, setTeamRanking] = useState<PkTeamRankItem[] | null>(null);
  const [lastGains, setLastGains] = useState<Record<string, number>>({});
  const [settleSeq, setSettleSeq] = useState(0);
  const [ranking, setRanking] = useState<PkFinalRankItem[] | null>(null);
  const [teamFinal, setTeamFinal] = useState<PkTeamRankItem[] | null>(null);
  const [playerFinished, setPlayerFinished] = useState(false);
  const [errorBanner, setErrorBanner] = useState('');
  const [copied, setCopied] = useState(false);

  const handleEvent = useCallback(
    (event: PkServerEvent) => {
      switch (event.type) {
        case 'room_state': {
          const room = event.room as PkRoomSnapshot;
          setSnapshot(room);
          setLiveRanking((cur) => cur ?? rankingFromSnapshot(room));
          setTotalPlayers(room.players.length);
          setPlayerFinished((finished) => finished || Boolean(room.players.find((player) => player.user_id === meId)?.finished));
          setErrorBanner('');
          break;
        }
        case 'question_pushed':
          // 并行竞速:服务端只推「我自己的下一题」(带 target_user_id)。教师控制台会镜像收到
          // 每个学生的题,但教师不答题,忽略即可(靠 live_ranking 看多人进度)。
          if (event.target_user_id != null && event.target_user_id !== meId) break;
          setCurrentQ({
            q_seq: event.q_seq,
            stage: event.stage as string,
            word: event.word,
            points: event.points,
            group_idx: event.group_idx,
            group_total: event.group_total,
            exam_type: event.exam_type as PkExamType | undefined,
            options: event.options as string[] | undefined,
            copies_left: event.copies_left as number | undefined,
          });
          questionStartedAtRef.current = Date.now();
          setPlayerFinished(false);
          setSubmitting(false);   // 新题到,解禁答题
          setErrorBanner('');
          break;
        case 'question_settled': {
          // 「我这题」的即时回执(仅自己):驱动 +分浮动动画
          if (event.target_user_id != null && event.target_user_id !== meId) break;
          const gains: Record<string, number> = {};
          const results = (event.results ?? {}) as Record<string, { points_gained?: number }>;
          for (const [uid, r] of Object.entries(results)) {
            gains[uid] = r?.points_gained ?? 0;
          }
          setLastGains(gains);
          setSettleSeq((s) => s + 1);
          break;
        }
        case 'live_ranking':
          setLiveRanking(event.ranking as PkLiveRankItem[]);
          setTotalPlayers(Number(event.total_players) || (event.ranking as PkLiveRankItem[]).length);
          if ((event.ranking as PkLiveRankItem[]).some((item) => item.user_id === meId && item.finished)) {
            setPlayerFinished(true);
          }
          if (event.team_ranking) setTeamRanking(event.team_ranking as PkTeamRankItem[]);
          setErrorBanner('');
          break;
        case 'player_finished':
          // 我跑完整套流程:切到「完成」态卡片(等结算)
          if (event.target_user_id == null || event.target_user_id === meId) {
            setCurrentQ((q) => (q ? { ...q, stage: 'done' } : q));
            setPlayerFinished(true);
            setSubmitting(false);
          }
          break;
        case 'game_finished':
          setRanking(event.ranking as PkFinalRankItem[]);
          if (event.team_ranking) setTeamFinal(event.team_ranking as PkTeamRankItem[]);
          break;
        case 'room_closed':
          setErrorBanner(event.message || '房间已解散');
          window.setTimeout(() => navigate('/pk/lobby'), 1600);
          break;
        case 'error':
          setErrorBanner(event.message || event.code || 'Error');
          // 观众断线后服务端会立即移除:收到 ROOM_NOT_FOUND 时自动重新登记观战,
          // 配合 socket 的自动重连即可无感恢复
          if (event.code === 'ROOM_NOT_FOUND') {
            setSnapshot((snap) => {
              const wasSpectator = snap && !snap.players.some((pl) => pl.user_id === meId);
              if (wasSpectator && snap?.invite_code) {
                pkApi.spectateByCode(snap.invite_code).catch(() => {});
              }
              return snap;
            });
          }
          break;
        default:
          // player_disconnected / reconnected / kicked / host_changed:
          // server follows up with room_state for visible UI changes
          break;
      }
    },
    [meId, navigate]
  );

  const { send, connected, failed, retry } = usePkSocket({
    roomId: Number(roomId),
    token,
    onEvent: handleEvent,
    onClose: () => setErrorBanner('连接已断开,正在重连…'),
  });

  const submit = useCallback(
    (payload: object, timeSpentMs: number) => {
      if (!currentQ || submitting) return;
      if (!connected) {
        setErrorBanner('实时连接暂时中断，恢复后请重新提交本题。');
        return;
      }
      setSubmitting(true);   // 防重复提交;下一题(question_pushed)到达时解禁
      send({
        type: 'submit_answer',
        word_idx: currentQ.q_seq,   // 后端 submit_answer 复用 word_idx 形参承载 q_seq
        phase: currentQ.stage,      // 复用 phase 形参承载 stage
        payload,
        time_spent_ms: timeSpentMs,
      });
    },
    [connected, send, currentQ, submitting]
  );

  const copyInvite = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard 可能被拒绝,忽略
    }
  };

  // 教师控制台(组织者):我是房主且房主不下场
  const isHostConsole = !!snapshot && snapshot.host_id === meId && snapshot.host_is_player === false;
  const isTeamMode = snapshot?.mode === 'team';
  // 我在哪队(分组赛柱状图高亮自己那根柱)
  const myTeam = snapshot?.players?.find((p) => p.user_id === meId)?.team ?? null;
  // 队号 → 队名(= 班级名)。分组赛按班级自动分队,界面一律显示班级名
  const teamNames = snapshot?.team_names;
  // 教师建的全部组(含还没人选的空组),学生选组/教师改组都从这里列
  const allTeams = useMemo(() => {
    return Object.entries(teamNames ?? {})
      .map(([t, name]) => [Number(t), name] as [number, string])
      .sort((a, b) => a[0] - b[0]);
  }, [teamNames]);
  // 每组当前人数:学生选组前想知道哪组人少
  const teamSizes = useMemo(() => {
    const n = new Map<number, number>();
    for (const p of snapshot?.players ?? []) {
      if (p.team) n.set(p.team, (n.get(p.team) ?? 0) + 1);
    }
    return n;
  }, [snapshot?.players]);

  // 学生自己选组:只能给自己选,所以不带 user_id
  const pickTeam = useCallback((team: number) => {
    send({ type: 'pick_team', team });
  }, [send]);

  const setTeam = useCallback((userId: number, team: number) => {
    send({ type: 'set_team', user_id: userId, team });
  }, [send]);

  const kickPlayer = useCallback((userId: number) => {
    send({ type: 'kick_player', user_id: userId });
  }, [send]);

  const closeRoom = useCallback(() => {
    send({ type: 'close_room' });
    navigate('/teacher/dashboard');
  }, [send, navigate]);

  const leaveRoom = useCallback(() => {
    send({ type: 'leave_room' });
    window.setTimeout(() => navigate('/pk/lobby'), 80);
  }, [navigate, send]);

  const startGame = useCallback(() => {
    if (isHostConsole && !document.fullscreenElement && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
    send({ type: 'start_game' });
  }, [isHostConsole, send]);

  const finishGame = useCallback(() => {
    send({ type: 'finish_game' });
  }, [send]);

  const exitArena = useCallback(() => {
    if (isHostConsole && document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    navigate(isHostConsole ? '/teacher/dashboard' : '/student/dashboard');
  }, [isHostConsole, navigate]);

  // 终局 → 结算榜
  if (ranking) {
    if (isHostConsole) {
      return (
        <PkTeacherResultBoard
          ranking={ranking}
          teamRanking={teamFinal}
          onExit={exitArena}
        />
      );
    }
    return (
      <PkResultBoard
        ranking={ranking}
        meId={meId}
        teamRanking={teamFinal}
        onExit={exitArena}
        onAgain={() => navigate('/pk/lobby')}
      />
    );
  }

  // 连接/加载中。⚠️ 连不上时必须给出口:重连预算耗尽后转成错误态,
  // 不能继续转圈 —— 转圈对学生等于"卡死",对老师等于"这几个人进不来"。
  if (!snapshot) {
    if (failed) {
      return (
        <div className="min-h-screen bg-paper flex items-center justify-center p-5">
          <div className="card-soft rounded-3xl p-7 max-w-sm w-full text-center">
            <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-50 text-accent-warm">
              <PlugZap className="h-7 w-7" aria-hidden="true" />
            </span>
            <p className="text-lg font-bold text-ink mb-1.5">连不上比赛房间</p>
            <p className="text-sm text-ink-soft mb-1">
              网络或浏览器挡住了实时连接。请确认用的是
              <span className="font-semibold text-ink"> https 域名 </span>
              打开的网址,再点重试。
            </p>
            <p className="text-[11px] text-ink-mute mb-5">若仍进不去,把手机/电脑连的网络换一个再试</p>
            <button
              onClick={retry}
              className="btn-glow inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl font-semibold text-white"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              重试连接
            </button>
            <button
              onClick={() => navigate('/pk/lobby')}
              className="mt-2 min-h-11 w-full rounded-xl bg-gray-100 font-medium text-ink-soft transition hover:bg-gray-200"
            >
              返回大厅
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center">
        <div className="text-center">
          <LoaderCircle className="mx-auto mb-3 h-9 w-9 animate-spin text-accent-warm motion-reduce:animate-none" aria-hidden="true" />
          <p className="text-ink-soft">{connected ? '加载中…' : '连接中…'}</p>
        </div>
      </div>
    );
  }

  // 等待室(房主未开局)
  if (snapshot.status === 'waiting') {
    // 房主下场时才算「玩家房主」;教师组织房的房主是控制台,不在 players 里
    const isPlayerHost = snapshot.host_id === meId && snapshot.host_is_player;
    // 观战 = 既不是玩家、也不是教师控制台
    const isSpectator = !isHostConsole && !snapshot.players.some((p) => p.user_id === meId);
    const canStart = isPlayerHost || isHostConsole;
    const onlineCount = snapshot.players.filter((p) => p.online).length;
    const specCount = snapshot.spectators?.length ?? 0;
    const emptySlotCount = Math.max(0, snapshot.max_players - snapshot.players.length);
    const teamColors = ['bg-blue-50 ring-blue-200', 'bg-rose-50 ring-rose-200', 'bg-emerald-50 ring-emerald-200', 'bg-amber-50 ring-amber-200'];
    return (
      <div className="min-h-screen bg-paper">
        <div className="mx-auto max-w-2xl p-4 sm:py-8">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="flex items-center gap-2 font-display text-2xl font-semibold text-ink sm:text-3xl">
              {isHostConsole ? <MonitorCog className="h-6 w-6 text-accent-warm" aria-hidden="true" /> : isSpectator ? <Eye className="h-6 w-6 text-accent-warm" aria-hidden="true" /> : <Swords className="h-6 w-6 text-accent-warm" aria-hidden="true" />}
              {isHostConsole ? '组织者控制台' : isSpectator ? '观战 · 等待开始' : '等待开始'}
            </h2>
            <span className="inline-flex min-h-9 w-fit items-center gap-1.5 rounded-lg bg-orange-50 px-3 text-xs font-medium text-accent-warm sm:text-sm">
              {isTeamMode ? <Users className="h-4 w-4" aria-hidden="true" /> : <UserRound className="h-4 w-4" aria-hidden="true" />}
              {isTeamMode ? `${allTeams.length} 组` : '个人赛'} · 最多 {snapshot.word_count} 词
            </span>
          </div>

          {/* 邀请码大卡 */}
          <div className="card-soft mb-5 rounded-2xl px-5 py-5 text-center sm:px-6 sm:py-7">
              <p className="mb-2 text-sm text-ink-mute">邀请码 · 发给同学一起 PK</p>
              <p className="select-all font-numeric text-4xl font-semibold tracking-[0.22em] text-accent-warm sm:text-6xl sm:tracking-[0.28em]">
                {snapshot.invite_code}
              </p>
              <button
                onClick={() => copyInvite(snapshot.invite_code)}
                className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-lg bg-orange-50 px-4 text-sm font-medium text-accent-warm transition hover:bg-orange-100"
              >
                {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Clipboard className="h-4 w-4" aria-hidden="true" />}
                {copied ? '已复制' : '复制邀请码'}
              </button>
          </div>

          {/* 学生选组(分组赛):教师建好组,学生自己点一个加入 */}
          {isTeamMode && !isHostConsole && !isSpectator && allTeams.length > 0 && (
            <div className={`card-soft mb-5 rounded-2xl p-5 sm:p-6 ${myTeam ? '' : 'ring-2 ring-primary/35'}`}>
              <div className="mb-1 flex items-center justify-between gap-3">
                <h3 className="font-semibold text-ink">选择你的小组</h3>
                {myTeam ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />已加入</span>
                ) : (
                  <span className="text-xs text-primary font-medium">请先选组</span>
                )}
              </div>
              <p className="text-[11px] text-ink-mute mb-3">
                {myTeam ? '想换组直接点别的组名' : '开局前必须选一个组,不然老师开不了赛'}
              </p>
              <div className="grid grid-cols-2 gap-2.5">
                {allTeams.map(([t, name]) => {
                  const mine = myTeam === t;
                  return (
                    <button
                      key={t}
                      onClick={() => pickTeam(t)}
                      disabled={!connected}
                      aria-pressed={mine}
                      className={`min-h-14 rounded-xl px-3 py-3 text-sm font-semibold transition ${
                        mine
                          ? 'bg-primary text-white shadow-sm'
                          : 'bg-gray-100 text-ink-soft hover:bg-orange-100'
                      }`}
                    >
                      <span className="block truncate">{name}</span>
                      <span className={`block text-[10px] font-normal ${mine ? 'text-white/80' : 'text-ink-mute'}`}>
                        {teamSizes.get(t) ?? 0} 人{mine ? ' · 我在这组' : ''}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 玩家网格 */}
            <div className="card-soft mb-5 rounded-2xl p-5 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-ink">玩家</h3>
              <div className="flex items-center gap-3">
                <span className="font-numeric text-ink-soft">
                  {onlineCount}/{snapshot.players.length} 人在线
                </span>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
              <AnimatePresence>
                {snapshot.players.map((p) => (
                  <motion.div
                    key={p.user_id}
                    initial={reduceMotion ? false : { y: 8, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={reduceMotion ? undefined : { opacity: 0 }}
                    transition={{ duration: reduceMotion ? 0 : 0.3, ease: [0.16, 1, 0.3, 1] }}
                    className={`flex min-w-0 items-center gap-2.5 rounded-xl px-3 py-3 ${
                      p.user_id === meId ? 'bg-orange-50 ring-2 ring-primary/40'
                        : isTeamMode && p.team ? `${teamColors[(p.team - 1) % teamColors.length]} ring-2` : 'bg-gray-50'
                    } ${!p.online ? 'opacity-50' : ''}`}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-ink-mute">
                      <UserRound className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink truncate">{p.nickname}</p>
                      <p className="text-[11px] text-ink-mute truncate">
                        {isTeamMode
                          ? (p.team ? teamLabel(p.team, teamNames) : '未选组')
                          : '玩家'}
                        {p.user_id === meId ? ' · 我' : ''}
                        {!p.online ? ' · 掉线' : ''}
                      </p>
                    </div>
                    {/* 教师控制台:调队 / 踢人 */}
                    {isHostConsole && (
                      <div className="flex flex-col gap-1 shrink-0">
                        {/* 学生自己选组;老师也能代选(有人没带手机/点不明白时) */}
                        {isTeamMode && allTeams.length > 0 && (
                          <select
                            value={p.team ?? ''}
                            onChange={(e) => setTeam(p.user_id, Number(e.target.value))}
                            disabled={!connected}
                            aria-label={`为 ${p.nickname} 指定小组`}
                            className="min-h-11 max-w-[7rem] rounded-lg border border-gray-200 bg-white px-2 text-xs text-ink-soft"
                          >
                            <option value="" disabled>未选组</option>
                            {allTeams.map(([t, name]) => (
                              <option key={t} value={t}>{name}</option>
                            ))}
                          </select>
                        )}
                        <button
                          onClick={() => kickPlayer(p.user_id)}
                          disabled={!connected}
                          className="min-h-11 rounded-lg px-2 text-xs text-red-500 transition hover:bg-red-50 hover:text-red-600"
                        >
                          移出
                        </button>
                      </div>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
              {/* 空位只汇总展示，避免大房间在手机上铺出一长串重复占位。 */}
              {emptySlotCount > 0 && (
                <div
                  className="flex min-h-14 items-center justify-center rounded-xl border border-dashed border-orange-200 px-3 py-3 text-xs text-ink-mute sm:col-span-2 md:col-span-3"
                >
                  还可加入 {emptySlotCount} 人
                </div>
              )}
            </div>

            {/* 观战名单:点名字,不只报人数。
                房满/迟到/开局后进来的学生都落在这里 —— 老师得知道「进不去的是谁」,
                光显示「👀 4 人观战」等于让老师自己去猜是哪四个孩子。 */}
            {specCount > 0 && (
              <div className="mt-4 pt-4 border-t border-dashed border-orange-200">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="flex items-center gap-1.5 text-sm font-semibold text-ink"><Eye className="h-4 w-4 text-accent-warm" aria-hidden="true" />观战</h4>
                  <span className="text-xs text-ink-mute">{specCount} 人 · 没进场比赛</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(snapshot.spectators ?? []).map((s) => (
                    <span
                      key={s.user_id}
                      className={`text-xs px-2.5 py-1 rounded-full bg-gray-100 text-ink-soft ${
                        s.user_id === meId ? 'ring-1 ring-primary/40 text-primary' : ''
                      }`}
                    >
                      {s.nickname}{s.user_id === meId ? ' · 我' : ''}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {canStart ? (
            <>
              <button
                onClick={startGame}
                disabled={onlineCount < 2 || !connected}
                className="btn-glow inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-xl text-lg font-semibold text-white"
              >
                <Swords className="h-5 w-5" aria-hidden="true" />
                {!connected ? '等待连接恢复' : onlineCount < 2 ? '至少需要 2 名在线玩家' : `开始 PK（${onlineCount} 人在线）`}
              </button>
              {isHostConsole && (
                <button
                  onClick={closeRoom}
                  className="w-full py-3 mt-2.5 rounded-2xl font-medium text-base bg-gray-100 hover:bg-red-50 hover:text-red-500 text-ink-soft transition"
                >
                  解散房间
                </button>
              )}
            </>
          ) : (
            <p className="flex items-center justify-center gap-2 py-4 text-center text-ink-soft">
              <Clock3 className="h-4 w-4" aria-hidden="true" />
              等待老师开始…
            </p>
          )}

          {!isHostConsole && (
            <button
              type="button"
              onClick={leaveRoom}
              disabled={!connected}
              className="mt-2.5 min-h-11 w-full rounded-xl bg-gray-100 px-4 text-sm font-medium text-ink-soft transition hover:bg-orange-50 hover:text-accent-warm disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSpectator ? '退出观战' : '退出房间'}
            </button>
          )}

          <p className="text-xs text-ink-mute text-center mt-4">
            {isHostConsole
              ? '你是组织者,开局后进大屏监控台看战况,不下场答题'
              : '每人各考自己背过的词(题量全场统一),走分类→听写→过关全流程,掌握得越多越快分越高'}
          </p>

          {(errorBanner || !connected) && (
            <motion.p
              initial={reduceMotion ? false : { opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              role="alert"
              className="mt-4 flex flex-wrap items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-error"
            >
              <CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">{errorBanner || '实时连接中断，正在自动重连…'}</span>
              {failed && (
                <button type="button" onClick={retry} className="min-h-11 rounded-lg bg-white px-3 font-semibold text-error transition hover:bg-red-100">
                  重新连接
                </button>
              )}
            </motion.p>
          )}
        </div>
      </div>
    );
  }

  // 对局中(掌握赛):进度反映「我自己」跑完整套分类记忆法流程的进度。
  const me = snapshot.players.find((p) => p.user_id === meId);
  const liveMe = liveRanking?.find((player) => player.user_id === meId);
  const isFinished = playerFinished || currentQ?.stage === 'done' || liveMe?.finished || me?.finished;
  const stage = isFinished ? 'done' : currentQ?.stage ?? liveMe?.stage ?? me?.stage ?? 'classify';
  const groupIdx = currentQ?.group_idx ?? liveMe?.group_idx ?? me?.group_idx ?? 0;
  const groupTotal = currentQ?.group_total ?? liveMe?.group_total ?? me?.group_total ?? 1;
  const myProgress = isFinished ? 1 : liveMe?.progress ?? me?.progress ?? 0;
  // 教师控制台是监控视角(非玩家、非普通观众);普通观众才走脱敏只读题卡
  const isSpectator = !isHostConsole && !snapshot.players.some((p) => p.user_id === meId);
  // 只有真正的参赛玩家才渲染答题卡(教师控制台虽 isSpectator=false,但不下场答题)
  const isPlayer = !isHostConsole && !isSpectator;
  const specCount = snapshot.spectators?.length ?? 0;
  const wordDataStub = currentQ
    ? {
        id: currentQ.word.id,
        word: currentQ.word.word,
        translation: currentQ.word.translation,
      }
    : null;

  if (isHostConsole) {
    return (
      <PkTeacherLiveBoard
        items={liveRanking ?? rankingFromSnapshot(snapshot)}
        teams={teamRanking}
        teamNames={teamNames}
        mode={snapshot.mode}
        deadlineAt={snapshot.deadline_at}
        spectatorCount={specCount}
        error={errorBanner}
        onFinish={finishGame}
      />
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-paper">
      {isSpectator ? (
        <section className="border-b border-orange-100 bg-white px-4 py-3" aria-label="观战状态">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-accent-warm">
                <Eye className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="font-display text-sm font-semibold text-ink sm:text-base">观战模式</p>
                <p className="text-xs text-ink-mute"><span className="sm:hidden">查看实时排名</span><span className="hidden sm:inline">每位选手题目不同，排名按实时总分更新</span></p>
              </div>
            </div>
            <span className="font-numeric shrink-0 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-ink-soft">
              {Math.max(totalPlayers, snapshot.players.length)} 人参赛
            </span>
          </div>
        </section>
      ) : (
        <PkPhaseStepper
          stage={stage}
          groupIdx={groupIdx}
          groupTotal={groupTotal}
          progress={myProgress}
          currentPoints={currentQ?.points}
        />
      )}
      {snapshot.deadline_at && <CountdownBar deadlineIso={snapshot.deadline_at} />}
      <div className="mx-auto grid w-full max-w-5xl flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        {isPlayer && liveMe && (
          <section className="card-soft grid grid-cols-3 divide-x divide-black/[0.06] overflow-hidden rounded-xl lg:hidden" aria-label="我的实时战况">
            {[
              { label: '当前排名', value: `#${liveMe.rank}` },
              { label: '当前总分', value: (liveMe.points ?? 0).toLocaleString('zh-CN') },
              { label: '掌握进度', value: `${Math.round(myProgress * 100)}%` },
            ].map((item) => (
              <div key={item.label} className="px-2 py-3 text-center">
                <p className="font-numeric text-base font-semibold text-ink">{item.value}</p>
                <p className="mt-0.5 text-[10px] text-ink-mute">{item.label}</p>
              </div>
            ))}
          </section>
        )}
        <main className="relative min-w-0">
          {(errorBanner || !connected) && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-red-50 px-3.5 py-3 text-sm text-error" role="alert">
              <CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1">{errorBanner || '实时连接中断，正在自动重连…'}</span>
              {failed && (
                <button type="button" onClick={retry} className="min-h-11 rounded-lg bg-white px-3 font-semibold text-error transition hover:bg-red-100">
                  重新连接
                </button>
              )}
            </div>
          )}
          {/* 观众:并行竞速下无统一题目,看右侧实时榜 */}
          {isSpectator && (
            <div className="card-soft flex items-center justify-center gap-2 rounded-2xl p-8 text-center text-ink-mute">
              <Eye className="h-5 w-5 shrink-0" aria-hidden="true" />
              观战中 · 各人各答各的词，请看实时榜
            </div>
          )}
          {/* 分类:标 熟悉/学过/陌生;夹生+陌生循环重来直到全熟(服务端状态机驱动) */}
          {isPlayer && currentQ && wordDataStub && currentQ.stage === 'classify' && (
            <ClassificationPhase
              key={`classify-${currentQ.q_seq}`}
              words={[]}
              onComplete={noOp}
              playAudio={noOpAudio}
              mode="pk"
              pkCurrentWord={wordDataStub}
              pkOnAnswer={(category, ms) => submit({ category }, ms)}
              pkDisabled={submitting || !connected}
            />
          )}
          {/* 听写:听音拼写;拼错进入抄写态(copies_left),抄对 N 遍才过 */}
          {isPlayer && currentQ && wordDataStub && currentQ.stage === 'dictation' && (
            <DictationSingle
              key={`dictation-${currentQ.q_seq}`}
              word={wordDataStub}
              onAnswer={(text, ms) => submit({ text }, ms)}
              disabled={submitting || !connected}
              timeoutMs={60_000}
              copiesLeft={currentQ.copies_left ?? 0}
            />
          )}
          {/* 过关:4 题型(英译中/中译英/听音/拼写),服务端权威判分,≥60% 过关 */}
          {isPlayer && currentQ && wordDataStub && currentQ.stage === 'exam' && (
            <PkExamCard
              key={`exam-${currentQ.q_seq}`}
              word={wordDataStub}
              examType={currentQ.exam_type ?? 'spelling'}
              options={currentQ.options}
              onSelect={(selected, ms) => submit({ selected }, ms)}
              onText={(text, ms) => submit({ text }, ms)}
              disabled={submitting}
              offline={!connected}
              timeoutMs={30_000}
            />
          )}
          {/* 完成:全部组过关,等其他人/结算 */}
          {isPlayer && isFinished && (
            <div className="card-soft rounded-2xl p-7 text-center sm:p-9">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-700">
                <Trophy className="h-7 w-7" aria-hidden="true" />
              </div>
              <p className="font-display text-xl font-semibold text-ink">本局题目已完成</p>
              <p className="mt-2 text-sm leading-6 text-ink-soft">正在等待其他同学完成或倒计时结束，成绩会自动公布。</p>
            </div>
          )}
          {isPlayer && !currentQ && !isFinished && (
            <div className="card-soft rounded-2xl p-8 text-center text-ink-mute" role="status">
              <LoaderCircle className="mx-auto mb-3 h-6 w-6 animate-spin text-accent-warm motion-reduce:animate-none" aria-hidden="true" />
              正在准备第一题…
            </div>
          )}
        </main>

        <aside className="space-y-3 lg:sticky lg:top-24" aria-label="实时排名">
          {specCount > 0 && (
            <p className="flex items-center justify-end gap-1.5 text-xs text-ink-mute"><Eye className="h-3.5 w-3.5" aria-hidden="true" />{specCount} 人观战</p>
          )}
          {isTeamMode && teamRanking && <TeamRankingPanel items={teamRanking} members={liveRanking} meId={meId} />}
          {liveRanking && (
            <PkLiveRanking
              items={liveRanking}
              meId={meId}
              totalPlayers={totalPlayers}
              gains={lastGains}
              settleSeq={settleSeq}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

const TEAM_DOT = ['bg-sky-500', 'bg-rose-500', 'bg-emerald-500', 'bg-amber-500', 'bg-cyan-500', 'bg-orange-500'];

/** 全场倒计时条:每秒刷新,剩余时间越少越红。到 0 显示"结算中"(服务端会推 game_finished)。 */
function CountdownBar({ deadlineIso }: { deadlineIso: string }) {
  const deadline = new Date(deadlineIso).getTime();
  const [now, setNow] = useState(0);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setNow(Date.now()));
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.cancelAnimationFrame(frame);
      clearInterval(t);
    };
  }, []);
  const left = now === 0 ? 0 : Math.max(0, Math.floor((deadline - now) / 1000));
  const mm = String(Math.floor(left / 60)).padStart(2, '0');
  const ss = String(left % 60).padStart(2, '0');
  const urgent = left <= 30;
  return (
    <div className={`flex items-center justify-center gap-2 py-1.5 text-sm font-semibold ${
      urgent ? 'text-red-500' : 'text-ink-soft'
    }`}>
      <Clock3 className="h-4 w-4" aria-hidden="true" />
      <span className="font-numeric tabular-nums">{now === 0 ? '--:--' : left > 0 ? `${mm}:${ss}` : '结算中…'}</span>
      {left > 0 && <span className="text-xs font-normal text-ink-mute">全场倒计时</span>}
    </div>
  );
}

/** 分组赛队伍榜：按人均分排名，每队展开队内前三，和学生端暖色学习界面保持一致。 */
function TeamRankingPanel({ items, members, meId }: {
  items: PkTeamRankItem[];
  members: PkLiveRankItem[] | null;
  meId: number;
}) {
  const topByTeam = topMembersByTeam(members);
  return (
    <section className="card-soft overflow-hidden rounded-2xl" aria-labelledby="pk-team-ranking-title">
      <div className="flex items-center justify-between gap-3 border-b border-black/[0.06] px-4 py-3.5">
        <div className="flex items-center gap-2">
          <Flag className="h-4 w-4 text-accent-warm" aria-hidden="true" />
          <h2 id="pk-team-ranking-title" className="font-display text-base font-semibold text-ink">队伍排名</h2>
        </div>
        <span className="text-xs text-ink-mute">按人均分</span>
      </div>
      <div className="divide-y divide-black/[0.05]">
        {items.map((it) => {
          const isLeader = it.rank === 1 && it.points > 0;
          const progress = Math.min(100, Math.max(0, Math.round((it.avg_progress ?? 0) * 100)));
          const top = topByTeam.get(it.team) ?? [];
          return (
            <div
              key={it.team}
              className={`px-3 py-3 ${isLeader ? 'bg-amber-50/70' : 'bg-white'}`}
            >
              <div className="flex items-center gap-2.5">
                <span className={`font-numeric flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold ${isLeader ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-ink-soft'}`}>
                  {isLeader ? <Trophy className="h-4 w-4" aria-label="第 1 名" /> : `#${it.rank}`}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className={`inline-block h-2.5 w-2.5 rounded-full ${TEAM_DOT[(it.team - 1) % TEAM_DOT.length]}`} />
                    <span className="truncate text-sm font-semibold text-ink">
                      {teamLabel(it.team, undefined, it.team_name)}
                    </span>
                    <span className="shrink-0 text-[10px] text-ink-mute">{it.online_count}/{it.member_count} 人在线</span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className={`h-full rounded-full ${TEAM_DOT[(it.team - 1) % TEAM_DOT.length]}`} style={{ width: `${progress}%` }} />
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <span className="font-numeric block text-base font-semibold leading-none text-ink">{it.avg_points}</span>
                  <span className="mt-1 block text-[10px] text-ink-mute">人均分</span>
                </div>
              </div>
              {top.length > 0 && (
                <ol
                  className="mt-2 space-y-1 pl-[46px]"
                  aria-label={`${teamLabel(it.team, undefined, it.team_name)}前三名`}
                >
                  {top.map((m, i) => (
                    <li key={m.user_id} className="flex items-center gap-2 text-xs">
                      <span className={`font-numeric w-4 shrink-0 text-center font-bold ${i === 0 ? 'text-amber-700' : 'text-ink-mute'}`}>
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-ink-soft">
                        {m.nickname}
                        {m.user_id === meId && (
                          <span className="ml-1.5 rounded bg-accent-warm px-1 py-px text-[10px] font-semibold text-white">我</span>
                        )}
                      </span>
                      <span className="font-numeric shrink-0 font-semibold text-ink">{m.points}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
