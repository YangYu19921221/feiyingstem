import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { ArrowLeft, RefreshCw, Swords, Volume2, VolumeX, WifiOff } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  BattleWebSocket,
  AnswerWebSocket,
  Battle,
  BattlePetOption,
  QuestionData,
  RoundResult,
  type BattleEndData,
  getBattle,
  type BattleBuff,
} from '../api/petBattle';
import {
  getPetDefinition,
  getPetImage,
  getPetBackImage,
  FINALE_KO_SECONDS,
  FINALE_PLAIN_SECONDS,
} from '../config/petSpecies';
import BattleStage from '../components/battle/BattleStage';
import { ARENA_IMAGE, buildRoundFx, pickArena, roundDuration, type ArenaId, type BattleFx } from '../components/battle/fx';
import { bindBattleSfxUnlock, isBattleSfxMuted, playBattleSfx, setBattleSfxMuted } from '../utils/battleSfx';
import BattleEnd from '../components/battle/BattleEnd';
import BattleActions, { type ActOptions } from '../components/battle/BattleActions';
import { useAudio } from '../hooks/useAudio';
import {
  getPetType,
  getEffectiveness,
  TYPE_ICONS,
  TYPE_NAMES
} from '../utils/typeEffectiveness';

type BattlePhase = 'waiting' | 'countdown' | 'question' | 'answering' | 'result' | 'end';

export default function PetBattlePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const reduceMotion = useReducedMotion();
  const { battleId } = useParams<{ battleId: string }>();
  const { playAudio } = useAudio();
  // WS 回调里要用最新的 playAudio(回调只挂一次)
  const playAudioRef = useRef(playAudio);
  playAudioRef.current = playAudio;
  // 这一题给了多少秒(画倒计时条用)
  const [timeLimit, setTimeLimit] = useState(15);
  // 卡住的保险: 该来的消息一直不来(服务端这场的回合循环停了),孩子不能永远对着「等待对手答题…」。
  // 出题后 时限 + 12 秒没有结果、或出了结果 25 秒没有下一题也没有结束 → 重新进一次这一页
  // (重新连上后服务端从上一个结算完的回合接着发题)。同一场最多自己重进 2 次,再不行就说清楚、让孩子回去重开
  const stallTimer = useRef<number | null>(null);
  const clearStall = () => {
    if (stallTimer.current) {
      window.clearTimeout(stallTimer.current);
      stallTimer.current = null;
    }
  };
  const recoverRef = useRef<() => void>(() => {});
  recoverRef.current = () => {
    if (battleEndedRef.current) return;
    const key = `battle_stall_${battleId}`;
    let tried = 0;
    try { tried = Number(sessionStorage.getItem(key) || 0); } catch { /* 隐私模式: 当成没试过 */ }
    if (tried < 2) {
      try { sessionStorage.setItem(key, String(tried + 1)); } catch { /* 存不了也照样重进一次 */ }
      window.location.reload();
      return;
    }
    setConnectionError('这场对战卡住了,接不上了。回宠物页面重新开一场。');
  };
  const armStall = (seconds: number) => {
    clearStall();
    stallTimer.current = window.setTimeout(() => recoverRef.current(), seconds * 1000);
  };
  const armStallRef = useRef(armStall);
  armStallRef.current = armStall;
  useEffect(() => () => clearStall(), []);

  // 每题的倒计时定时器(一题一个);对战音效静音(按设备记,电教室里一屋子人可以关掉)
  const roundTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (roundTimer.current) window.clearInterval(roundTimer.current);
  }, []);
  const [muted, setMuted] = useState(isBattleSfxMuted);
  // 正在念咒语: 四个选项收成只剩选中的那一个,给字母块让地方
  const [casting, setCasting] = useState(false);
  // 这一回合我出的是什么招(提交后显示)
  const [myMove, setMyMove] = useState('');
  // 听音题: 孩子点了「听不到声音?显示单词」(每题重置)
  const [showListenWord, setShowListenWord] = useState(false);

  const [phase, setPhase] = useState<BattlePhase>('waiting');
  const [battle, setBattle] = useState<Battle | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<QuestionData | null>(null);
  const [currentRound, setCurrentRound] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(15);
  const [myAnswer, setMyAnswer] = useState<string | null>(null);
  const [opponentAnswered, setOpponentAnswered] = useState(false);
  const [roundResult, setRoundResult] = useState<RoundResult | null>(null);
  const [countdown, setCountdown] = useState(3);
  const [endResult, setEndResult] = useState<BattleEndData | null>(null);
  // 当前回合的特效列表; 回合开始时清空
  const [battleFx, setBattleFx] = useState<BattleFx[]>([]);
  // 结算页是否已可见(等特效和终幕动画播完才打开)
  const [endVisible, setEndVisible] = useState(false);
  // 终幕(输的倒下、赢的跳)开始了没有;最后一回合的招式演到什么时候;结束阶段的定时器
  const [finaleOn, setFinaleOn] = useState(false);
  const lastFxEndsAt = useRef(0);
  const endTimers = useRef<number[]>([]);
  useEffect(() => () => endTimers.current.forEach((id) => window.clearTimeout(id)), []);
  const [switchingPetId, setSwitchingPetId] = useState<number | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState('');
  // 开打前那 3 秒: 服务端要等倒计时完才把这一场发过来(battle_start),这之前页面只有一个转圈的「准备战斗中」。
  // 先用普通接口把这一场取回来,倒计时的时候就能摆出「谁 对 谁、在哪儿打、第几关」
  const [preview, setPreview] = useState<Battle | null>(null);
  useEffect(() => {
    if (!battleId) return undefined;
    let alive = true;
    getBattle(Number(battleId)).then((b) => {
      if (alive && (b.status === 'active' || b.status === 'pending')) setPreview(b);
    }).catch(() => { /* 取不到就还是原来的等待页 */ });
    return () => { alive = false; };
  }, [battleId]);
  // 进来时这一场已经打完了(比如打完后刷新了页面): 不是网络问题,给回去的路
  const [endedElsewhere, setEndedElsewhere] = useState<{ trial: boolean } | null>(null);
  // 场地背景(battle_start 时按属性和对战编号固定)
  const arenaUrlRef = useRef<string>('/battle-arena/meadow.jpg');
  const [arenaUrl, setArenaUrl] = useState('/battle-arena/meadow.jpg');

  const battleWs = useRef<BattleWebSocket | null>(null);
  const answerWs = useRef<AnswerWebSocket | null>(null);
  const battleStateRef = useRef<Battle | null>(null);
  const fxClearTimer = useRef<number | null>(null);
  const questionStartTime = useRef<number>(0);
  // 战斗结束后忽略一切残留的回合消息,防止结算页被拉回答题界面
  const battleEndedRef = useRef(false);
  // 保存最后一回合结果里的 KO 信息,用于决定终幕等待时长
  const lastRoundKoRef = useRef(false);

  // 解锁 Web Audio(首次用户交互后激活,对战页每次点答案都算)
  useEffect(() => {
    const cleanup = bindBattleSfxUnlock();
    return cleanup;
  }, []);

  // 获取Token
  // 注意：全项目登录时存的是 access_token 和 user(对象)，
  // 这里必须用相同的 key，否则 token 读空 → WS 永不连接 → 卡在"准备战斗中"
  const token = localStorage.getItem('access_token') || '';
  const currentUserId = (() => {
    try {
      return Number(JSON.parse(localStorage.getItem('user') || '{}').id) || 0;
    } catch {
      return 0;
    }
  })();

  // 判断是玩家1还是玩家2
  const isPlayer1 = battle?.player1_id === currentUserId;
  const myPet = isPlayer1 ? battle?.player1_pet : battle?.player2_pet;
  const opponentPet = isPlayer1 ? battle?.player2_pet : battle?.player1_pet;
  const myRoster = (isPlayer1 ? battle?.player1_roster : battle?.player2_roster) || [];
  const mySkill = myPet ? getPetDefinition(myPet.species).ultimate : null;
  // 这一回合给我的咒语(手里有大招才有;真人对战时按玩家 id 各取各的)
  const mySpell = currentQuestion
    ? (currentQuestion.spell ?? currentQuestion.spells_public?.[String(currentUserId)] ?? null)
    : null;
  // 我这一场带着的学习增益
  const myBuffs = battle?.buffs ? (isPlayer1 ? battle.buffs.player1 : battle.buffs.player2) ?? [] : [];
  const skillProgress = myPet
    ? (myPet.ultimate_charges > 0 ? 3 : myPet.combo % 3)
    : 0;

  // 计算属性克制关系
  const myType = myPet ? getPetType(myPet.species) : 'normal';
  const opponentType = opponentPet ? getPetType(opponentPet.species) : 'normal';
  // 闯关里属性克制只帮你、不坑你(后端 services/pet_trial 第 7 条,伤害是服务端算的):
  // 你打对手最少按 1 倍,对手打你最多按 1 倍。这条提示要和实际伤害说的一样
  // 闯关和影子对战同一套(规则各在 pet_trial / pet_shadow,倍率都由后端给)
  const typeSrc = battle?.trial ?? battle?.shadow ?? null;
  const helpOnly = typeSrc?.type_rule === 'help_only';
  const rawMine = getEffectiveness(myType, opponentType);
  const rawTheirs = getEffectiveness(opponentType, myType);
  // 闯关里「你克制对手」的倍率由后端给(trial.type_mult,比平时的 2 倍小 —— 不然克制的区域几下就打完了)
  const helpMult = typeSrc?.type_mult ?? 2;
  const myEffectiveness = helpOnly ? (rawMine > 1 ? helpMult : 1) : rawMine;
  const opponentEffectiveness = helpOnly ? Math.min(1, rawTheirs) : rawTheirs;
  const myTypeIcon = TYPE_ICONS[myType];

  useEffect(() => {
    const species = new Set([myPet?.species, opponentPet?.species]);
    species.forEach((value) => {
      if (!value) return;
      const image = new Image();
      image.src = getPetDefinition(value).ultimate.image;
    });
  }, [myPet?.species, opponentPet?.species]);

  useEffect(() => {
    console.log('PetBattlePage mounted, battleId:', battleId, 'token:', token ? 'exists' : 'missing');

    if (!battleId || !token) {
      console.error('缺少battleId或token');
      setConnectionError('没有找到这场对战，请返回宠物页面重新进入。');
      return;
    }

    setConnectionError('');
    battleEndedRef.current = false;

    // 连接WebSocket
    console.log('正在连接WebSocket...');
    const ws = new BattleWebSocket(Number(battleId), token);
    const ansWs = new AnswerWebSocket(Number(battleId), token);

    battleWs.current = ws;
    answerWs.current = ansWs;

    // 连接
    Promise.all([ws.connect(), ansWs.connect()]).then(() => {
      console.log('✅ WebSocket连接成功');
    }).catch((error) => {
      console.error('❌ WebSocket连接失败:', error);
      // 连不上有两种: 网络真的不通,或者这一场已经打完了(打完的对战服务端不让再连)。
      // 后一种不能说「检查网络」—— 孩子会一直点重试
      getBattle(Number(battleId)).then((b) => {
        if (b.status === 'active' || b.status === 'pending') {
          setConnectionError('暂时没有连上对战服务器，请检查网络后重试。');
        } else {
          setEndedElsewhere({ trial: !!b.trial });
          setConnectionError('这场对战已经结束了,结果已经记下了。');
        }
      }).catch(() => setConnectionError('暂时没有连上对战服务器，请检查网络后重试。'));
    });

    // 监听事件
    ws.on('waiting', () => {
      setPhase('waiting');
    });

    ws.on('countdown', (data) => {
      setPhase('countdown');
      setCountdown(data.seconds);
      let count = data.seconds;
      playBattleSfx('beep');
      const interval = setInterval(() => {
        count--;
        setCountdown(count);
        playBattleSfx(count > 0 ? 'beep' : 'go');
        if (count <= 0) clearInterval(interval);
      }, 1000);
    });

    ws.on('battle_start', (data) => {
      battleStateRef.current = data.battle;
      setBattle(data.battle);
      // 场地按双方属性 + 对战编号固定,整场不变
      const b = data.battle;
      const myIsP1 = b.player1_id === currentUserId;
      const myEl = getPetDefinition(myIsP1 ? b.player1_pet.species : b.player2_pet.species).element;
      const oppEl = getPetDefinition(myIsP1 ? b.player2_pet.species : b.player1_pet.species).element;
      // 闯关: 在那一关所在的区域打;练习赛 / 真人对战按双方属性挑
      const trialArena = b.trial?.arena as ArenaId | undefined;
      const url = ARENA_IMAGE[trialArena && ARENA_IMAGE[trialArena] ? trialArena : pickArena(b.id, myEl, oppEl)];
      arenaUrlRef.current = url;
      setArenaUrl(url);
    });

    ws.on('new_round', (data) => {
      if (battleEndedRef.current) return;
      setPhase('question');
      setCurrentRound(data.round_number);
      setCurrentQuestion(data.question);
      setTimeLeft(data.time_limit);
      setTimeLimit(data.time_limit || 15);
      setShowListenWord(false);
      armStallRef.current((data.time_limit || 15) + 12);
      // 每一题把单词读一遍: 对战里也是「看到 + 听到」。看中文选英文的题不读(读了就是报答案),结算时再读
      try {
        if (data.question.kind !== 'zh2en' && data.question.word) {
          void playAudioRef.current(data.question.word, 1, data.question.word_id);
        }
      } catch { /* 读不出来不影响答题 */ }
      setSelectedAnswer(null);
      setMyAnswer(null);
      setOpponentAnswered(false);
      setRoundResult(null);
      setBattleFx([]);
      setSwitchingPetId(null);
      setSwitchError(null);
      if (fxClearTimer.current) {
        window.clearTimeout(fxClearTimer.current);
        fxClearTimer.current = null;
      }
      questionStartTime.current = Date.now();

      // 倒计时(最后 3 秒滴答响)
      if (roundTimer.current) window.clearInterval(roundTimer.current);
      let time = data.time_limit;
      roundTimer.current = window.setInterval(() => {
        time--;
        setTimeLeft(time);
        if (time > 0 && time <= 3 && !keyState.current.myAnswer) playBattleSfx('tick');
        if (time <= 0 && roundTimer.current) {
          window.clearInterval(roundTimer.current);
          roundTimer.current = null;
        }
      }, 1000);
    });

    ws.on('answer_received', (data) => {
      if (data.player_id !== currentUserId) {
        setOpponentAnswered(true);
      }
    });

    ws.on('round_result', (data) => {
      if (battleEndedRef.current) return;
      const result: RoundResult = data.result;
      setPhase('result');
      setRoundResult(result);
      if (roundTimer.current) {
        window.clearInterval(roundTimer.current);
        roundTimer.current = null;
      }
      // 出了结果: 25 秒内该有下一题或者结束(正常最长约 9 秒)
      armStallRef.current(25);
      // 看中文选英文的题: 答完把这个词读一遍(出题时没读)
      try {
        if (result.question.kind === 'zh2en' && result.question.word) {
          void playAudioRef.current(result.question.word, 1, result.question.word_id);
        }
      } catch { /* 读不出来不影响 */ }

      const currentBattle = battleStateRef.current;
      if (!currentBattle) return;

      const newBattle: Battle = {
        ...currentBattle,
        player1_pet: {
          ...currentBattle.player1_pet,
          hp: result.player1_hp_after,
          combo: result.player1_combo,
          ultimate_charges: result.player1_ultimate_charges,
        },
        player1_roster: (currentBattle.player1_roster || []).map((pet) => ({
          ...pet,
          hp: pet.pet_id === currentBattle.player1_pet.pet_id
            ? result.player1_hp_after
            : pet.hp,
        })),
        player2_pet: {
          ...currentBattle.player2_pet,
          hp: result.player2_hp_after,
          combo: result.player2_combo,
          ultimate_charges: result.player2_ultimate_charges,
        },
        player2_roster: (currentBattle.player2_roster || []).map((pet) => ({
          ...pet,
          hp: pet.pet_id === currentBattle.player2_pet.pet_id
            ? result.player2_hp_after
            : pet.hp,
        })),
      };
      battleStateRef.current = newBattle;
      setBattle(newBattle);

      // 用 fx.ts 的纯函数生成这一回合的特效时间轴
      const localIsPlayer1 = currentBattle.player1_id === currentUserId;
      playBattleSfx((localIsPlayer1 ? result.player1_correct : result.player2_correct) ? 'correct' : 'wrong');
      const chargesBefore = (localIsPlayer1 ? currentBattle.player1_pet : currentBattle.player2_pet).ultimate_charges;
      const chargesAfter = localIsPlayer1 ? result.player1_ultimate_charges : result.player2_ultimate_charges;
      if (chargesBefore < 1 && chargesAfter >= 1) window.setTimeout(() => playBattleSfx('ready'), 350);
      const fx = buildRoundFx(result, currentBattle, localIsPlayer1);
      setBattleFx(fx);
      // 这一回合的招式演到什么时候: 最后一回合的结束消息紧跟着就到,终幕要等招式演完再开始
      lastFxEndsAt.current = performance.now() + roundDuration(fx) * 1000;

      // 记录是否有 KO(血量归零),决定终幕等待时长
      const myIsP1 = currentBattle.player1_id === currentUserId;
      const myHpAfter = myIsP1 ? result.player1_hp_after : result.player2_hp_after;
      const oppHpAfter = myIsP1 ? result.player2_hp_after : result.player1_hp_after;
      lastRoundKoRef.current = myHpAfter <= 0 || oppHpAfter <= 0;

      if (fxClearTimer.current) window.clearTimeout(fxClearTimer.current);
      // fx 由 buildRoundFx 负责,旧的手工 effects 构建已移除

      // 结算等到特效播完再出现(由 BattleStage.onFinale 回调触发)
    });

    ws.on('pet_switched', (data) => {
      playBattleSfx('switch');
      battleStateRef.current = data.battle;
      setBattle(data.battle);
      setSwitchingPetId(null);
      setSwitchError(null);
    });

    ws.on('battle_end', (data: BattleEndData) => {
      battleEndedRef.current = true;
      ws.stopReconnect();
      if (stallTimer.current) {
        window.clearTimeout(stallTimer.current);
        stallTimer.current = null;
      }
      // 先保存结果,等 BattleStage 播完终幕动画后再显示结算页
      setEndResult(data);
      if (data.capture?.success) {
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: ['myPet'] }),
          queryClient.invalidateQueries({ queryKey: ['petCollection'] }),
          queryClient.invalidateQueries({ queryKey: ['petEvents'] }),
        ]);
      }
      // 服务端发完最后一回合的结果马上就发结束。先让最后那一记演完(血条掉完),
      // 再演终幕(输的倒下、赢的跳),终幕演完才出结算 —— 11-12 之前结算在最后一记打中之前就弹出来了
      const fxLeft = Math.max(0, lastFxEndsAt.current - performance.now());
      const finaleMs = (lastRoundKoRef.current ? FINALE_KO_SECONDS : FINALE_PLAIN_SECONDS) * 1000;
      endTimers.current.push(window.setTimeout(() => setFinaleOn(true), fxLeft));
      endTimers.current.push(window.setTimeout(() => {
        setPhase('end');
        setEndVisible(true);
        playBattleSfx(!data.winner_id ? 'draw' : data.winner_id === currentUserId ? 'victory' : 'defeat');
        // 闯关赢了体力回满: 战场上的血条也跟着涨满(不然结算写着「体力回满了」,血条还停在打完那一刻)
        const cur = battleStateRef.current;
        if ((data.healed ?? data.trial?.healed) && cur) {
          const mineIsP1 = cur.player1_id === currentUserId;
          const healed: Battle = mineIsP1
            ? { ...cur, player1_pet: { ...cur.player1_pet, hp: cur.player1_pet.max_hp } }
            : { ...cur, player2_pet: { ...cur.player2_pet, hp: cur.player2_pet.max_hp } };
          battleStateRef.current = healed;
          setBattle(healed);
          setBattleFx([]);
        }
      }, fxLeft + finaleMs));
    });

    ws.on('error', (data) => {
      // 服务端说这一场的回合循环出错停了: 重新进一次就能接着打,不用把孩子扔到报错页
      if (data.code === 'driver_crashed') {
        recoverRef.current();
        return;
      }
      if (stallTimer.current) {
        window.clearTimeout(stallTimer.current);
        stallTimer.current = null;
      }
      setConnectionError(data.message || '对战连接出现问题，请重试。');
    });

    ansWs.on('switch_error', (data) => {
      setSwitchingPetId(null);
      setSwitchError(data.message || '换宠失败');
    });

    ansWs.on('switch_accepted', () => {
      setSwitchingPetId(null);
    });

    return () => {
      if (fxClearTimer.current) window.clearTimeout(fxClearTimer.current);
      ws.close();
      ansWs.close();
    };
  }, [battleId, token, queryClient]);

  // 出招: 选好的答案 + 怎么打(重击 / 攻击 / 防守 / 大招带咒语)
  const submitAnswer = (answer: string, opts: ActOptions = {}) => {
    if (myAnswer) return; // 已答过

    const timeMs = Date.now() - questionStartTime.current;
    setMyAnswer(answer);
    setMyMove(opts.ultimate ? '大招' : opts.stance === 'heavy' ? '重击' : opts.stance === 'guard' ? '防守' : '攻击');
    setPhase('answering');
    playBattleSfx('arm');

    answerWs.current?.submitAnswer(currentRound, answer, timeMs, !!opts.ultimate, {
      stance: opts.ultimate ? undefined : opts.stance ?? 'normal',
      spell: opts.spell,
    });
  };

  // 键盘作答(电脑): 1–4 或 A–D 选答案,回车 = 普通攻击。监听挂 window、走 ref 拿最新状态;
  // 按住不放(e.repeat)不算 —— 上一回合按着的回车不能把这一回合也交了
  const keyState = useRef({ phase, myAnswer, selectedAnswer, options: 0 });
  keyState.current = { phase, myAnswer, selectedAnswer, options: currentQuestion?.options.length ?? 0 };
  const submitRef = useRef<(answer: string) => void>(() => {});
  submitRef.current = (answer) => submitAnswer(answer);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const st = keyState.current;
      if (st.phase !== 'question' || st.myAnswer || !st.options) return;
      const key = e.key.toLowerCase();
      const idx = ['1', '2', '3', '4'].indexOf(key) >= 0 ? Number(key) - 1 : ['a', 'b', 'c', 'd'].indexOf(key);
      if (idx >= 0 && idx < st.options) {
        e.preventDefault();
        playBattleSfx('tap');
        setSelectedAnswer('ABCD'[idx]);
        return;
      }
      if (key === 'enter' && st.selectedAnswer) {
        e.preventDefault();
        submitRef.current(st.selectedAnswer);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);


  const switchPet = (petId: number) => {
    if (phase !== 'result' || switchingPetId !== null) return;
    setSwitchError(null);
    setSwitchingPetId(petId);
    answerWs.current?.switchPet(petId);
  };

  if (!battle) {
    if (connectionError) {
      return (
        <main className="page-warm-glow flex min-h-screen items-center justify-center bg-paper px-4 py-10">
          <section className="card-soft w-full max-w-md rounded-2xl p-6 text-center sm:p-8" role="alert">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-50 text-accent-warm">
              <WifiOff className="h-8 w-8" aria-hidden="true" />
            </div>
            <h1 className="font-display text-xl font-semibold text-ink">{endedElsewhere ? '这场对战已经结束了' : '对战暂时没连上'}</h1>
            <p className="mt-2 text-sm leading-6 text-ink-soft">
              {endedElsewhere ? '结果已经记下了,可以接着打下一场。' : `${connectionError} 宠物状态不会受影响。`}
            </p>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
              {endedElsewhere ? (
                <button type="button" onClick={() => navigate('/student/pet/battle-hall')} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent-warm px-5 text-sm font-semibold text-white transition hover:opacity-90">
                  <Swords className="h-4 w-4" aria-hidden="true" />
                  {endedElsewhere.trial ? '回闯关地图' : '去对战大厅'}
                </button>
              ) : (
                <button type="button" onClick={() => window.location.reload()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-accent-warm px-5 text-sm font-semibold text-white transition hover:opacity-90">
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  再试一次
                </button>
              )}
              <button type="button" onClick={() => navigate('/student/pet')} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-black/[0.05] px-5 text-sm font-semibold text-ink transition hover:bg-black/[0.08]">
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                返回宠物页面
              </button>
            </div>
          </section>
        </main>
      );
    }

    if (preview) {
      const iAmP1 = preview.player1_id === currentUserId;
      const mine = iAmP1 ? preview.player1_pet : preview.player2_pet;
      const theirs = iAmP1 ? preview.player2_pet : preview.player1_pet;
      const trialArena = preview.trial?.arena as ArenaId | undefined;
      const arena = trialArena && ARENA_IMAGE[trialArena]
        ? trialArena
        : pickArena(preview.id, getPetDefinition(mine.species).element, getPetDefinition(theirs.species).element);
      return (
        <div className="min-h-screen bg-paper px-2.5 py-3 sm:px-4 sm:py-6">
          <div className="mx-auto max-w-7xl">
            <VsIntro
              arenaUrl={ARENA_IMAGE[arena]}
              title={battleTitle(preview)}
              mine={mine}
              theirs={theirs}
              countdown={phase === 'countdown' ? countdown : null}
              waiting={phase === 'waiting' && !vsComputer(preview)}
              calm={!!reduceMotion}
              buffs={(iAmP1 ? preview.buffs?.player1 : preview.buffs?.player2) ?? []}
              note={weakNote(preview.trial)}
            />
            <div className="mt-3 text-center">
              <button type="button" onClick={() => navigate('/student/pet')} className="inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold text-accent-warm transition hover:bg-orange-50">
                返回宠物页面
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="page-warm-glow flex min-h-screen items-center justify-center bg-paper px-5">
        <div className="text-center">
          <motion.div
            className="mb-4 text-6xl"
            animate={reduceMotion ? undefined : {
              rotate: [0, 10, -10, 0],
              scale: [1, 1.1, 1]
            }}
            transition={{
              repeat: Infinity,
              duration: 1.5
            }}
          >
            ⚔️
          </motion.div>
          <div className="mb-2 font-display text-xl font-bold text-ink">准备战斗中...</div>
          <div className="text-sm text-ink-soft">
            {phase === 'waiting' ? '等待对手连接...' : '加载战斗数据...'}
          </div>
          <div className="mx-auto mt-4 h-2 w-48 overflow-hidden rounded-full bg-orange-100">
            <motion.div
              className="h-full w-1/2 rounded-full bg-accent-warm"
              animate={reduceMotion ? undefined : { x: ['-100%', '200%'] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: 'linear' }}
            />
          </div>
          <button type="button" onClick={() => navigate('/student/pet')} className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold text-accent-warm transition hover:bg-orange-50">
            返回宠物页面
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-paper">
      {/* 顶部导航 */}
      <nav className="bg-white/80 backdrop-blur-md shadow-sm sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-3 py-2.5 sm:px-4 sm:py-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigate('/student/pet')}
            className="flex h-11 w-11 items-center justify-center rounded-xl transition-colors hover:bg-orange-50"
            aria-label="返回宠物页面"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div className="text-center">
            {battle.trial && (
              <div className="text-[11px] font-bold leading-4 text-orange-700 sm:text-xs">{battle.trial.title}</div>
            )}
            {battle.shadow && (
              <div className="max-w-[60vw] truncate text-[11px] font-bold leading-4 text-[#5b3fd1] sm:text-xs">{battle.shadow.owner_name} 的影子</div>
            )}
            <div className="text-lg font-bold leading-6 text-gray-800">
              回合 {currentRound}/{battle.max_rounds}
            </div>

          </div>
          <button
            type="button"
            onClick={() => {
              const next = !muted;
              setBattleSfxMuted(next);
              setMuted(next);
            }}
            aria-pressed={muted}
            aria-label={muted ? '打开对战音效' : '关掉对战音效'}
            title={muted ? '对战音效已关(单词读音照常)' : '关掉对战音效'}
            className="flex h-11 w-11 items-center justify-center rounded-xl text-gray-600 transition-colors hover:bg-orange-50"
          >
            {muted ? <VolumeX className="h-5 w-5" aria-hidden="true" /> : <Volume2 className="h-5 w-5" aria-hidden="true" />}
          </button>
        </div>
      </nav>

      {/* 主战场 */}
      <div className="max-w-7xl mx-auto px-2.5 py-2 sm:px-4 sm:py-4">
        {/* 进场: 谁 对 谁、在哪儿打、第几关 + 3-2-1(以前是一个沙漏和一个大数字) */}
        {(phase === 'waiting' || phase === 'countdown') && myPet && opponentPet && (
          <VsIntro
            arenaUrl={arenaUrl}
            title={battleTitle(battle)}
            mine={myPet}
            theirs={opponentPet}
            countdown={phase === 'countdown' ? countdown : null}
            waiting={phase === 'waiting' && !vsComputer(battle)}
            calm={!!reduceMotion}
            buffs={myBuffs}
            note={weakNote(battle.trial)}
          />
        )}

        {/* 战斗阶段: 电脑上战场在左、答题在右,一屏放下(以前上下排,1366×768 上选项和攻击按钮都在屏幕外,
            孩子每回合要往下滑才能答、答完又看不到上面的招式);手机上还是上下排,战场按屏幕高度收矮 */}
        {(phase === 'question' || phase === 'answering' || phase === 'result' || phase === 'end') && battle && myPet && opponentPet && (
          <div className="battle-board flex flex-col gap-2 sm:gap-3 lg:grid lg:grid-cols-[minmax(0,1fr)_clamp(340px,30vw,420px)] lg:grid-rows-[auto_minmax(0,1fr)] lg:gap-x-4 lg:gap-y-3">
            {/* 属性克制提示 */}
            {phase !== 'end' && (
              <div className="lg:col-start-2 lg:row-start-1">
                <TypeMatchupBanner
                  myTypeIcon={myTypeIcon}
                  opponentTypeIcon={TYPE_ICONS[opponentType]}
                  myEffectiveness={myEffectiveness}
                  opponentEffectiveness={opponentEffectiveness}
                />
              </div>
            )}

            {/* 3D 战场(BattleStage 自带懒加载降级,不需要再套 Suspense)。高度见 index.css 的 .battle-stage-box */}
            <div className="battle-stage-box w-full shrink-0 lg:col-start-1 lg:row-start-1 lg:row-span-2">
            <BattleStage
              arenaUrl={arenaUrl}
              arenaName=""
              my={{
                image: getPetBackImage(myPet.species, myPet.evolution_stage)
                  || getPetImage(myPet.species, myPet.evolution_stage),
                name: myPet.name,
                level: myPet.level,
                hp: myPet.hp,
                maxHp: myPet.max_hp,
                gem: myPet.evolution_stage >= 4,
                typeIcon: TYPE_ICONS[getPetType(myPet.species)] ?? '',
                typeName: TYPE_NAMES[getPetType(myPet.species)] ?? '',
                combo: myPet.combo,
              }}
              opp={{
                image: getPetImage(opponentPet.species, opponentPet.evolution_stage),
                name: opponentPet.name,
                level: opponentPet.level,
                hp: opponentPet.hp,
                maxHp: opponentPet.max_hp,
                gem: opponentPet.evolution_stage >= 4,
                typeIcon: TYPE_ICONS[getPetType(opponentPet.species)] ?? '',
                typeName: TYPE_NAMES[getPetType(opponentPet.species)] ?? '',
                combo: opponentPet.combo,
              }}
              fx={battleFx}
              finale={finaleOn && endResult ? (() => {
                const winnerId = endResult.winner_id;
                if (!winnerId) return { loser: null, winner: null };
                const winnerIsMe = winnerId === currentUserId;
                return { loser: winnerIsMe ? (2 as const) : (1 as const), winner: winnerIsMe ? (1 as const) : (2 as const) };
              })() : null}
              calm={!!reduceMotion}
            />
            </div>

            <div className={`min-w-0 space-y-2 sm:space-y-3 lg:col-start-2 lg:min-h-0 lg:overflow-y-auto lg:pr-0.5 ${phase === 'end' ? 'lg:row-start-1 lg:row-span-2' : 'lg:row-start-2'}`}>
            {/* 题目区域 */}
            {currentQuestion && phase !== 'result' && phase !== 'end' && (
              <div className="card-soft rounded-xl p-3 sm:rounded-2xl sm:p-4">
                <div className="mb-2.5 text-center sm:mb-3">
                  <div className="break-words text-xs font-semibold text-gray-500 sm:text-sm">
                    {currentQuestion.kind === 'zh2en'
                      ? '哪个单词是这个意思?'
                      : currentQuestion.kind === 'listen'
                        ? '听读音,选出它的意思'
                        : currentQuestion.question_text}
                  </div>
                  {currentQuestion.kind === 'listen' && !showListenWord ? (
                    <div className="mt-1 flex flex-col items-center gap-1">
                      <button
                        type="button"
                        onClick={() => void playAudio(currentQuestion.word, 1, currentQuestion.word_id)}
                        className="inline-flex min-h-12 items-center gap-2 rounded-full border-2 border-orange-300 bg-orange-50 px-5 font-display text-lg font-bold text-orange-700 transition-colors hover:bg-orange-100"
                      >
                        <Volume2 className="h-6 w-6" aria-hidden="true" />
                        再听一遍
                      </button>
                      {/* 没戴耳机 / 声音出不来的时候不能把孩子卡死在这一题 */}
                      <button
                        type="button"
                        onClick={() => setShowListenWord(true)}
                        className="min-h-8 px-2 text-xs font-semibold text-gray-500 underline decoration-dotted underline-offset-2 hover:text-gray-700"
                      >
                        听不到声音?显示单词
                      </button>
                    </div>
                  ) : (
                    <div className={`mt-0.5 break-words font-display font-bold leading-tight text-orange-500 ${
                      currentQuestion.kind === 'zh2en'
                        ? ((currentQuestion.display || '').length > 14 ? 'line-clamp-3 text-lg sm:text-xl' : 'text-2xl sm:text-3xl')
                        : 'text-3xl sm:text-4xl'
                    }`}>
                      {currentQuestion.kind === 'listen' ? currentQuestion.word : (currentQuestion.display || currentQuestion.word)}
                    </div>
                  )}
                </div>

                {myBuffs.length > 0 && currentRound <= 1 && (
                  <div className="mb-2 flex flex-wrap justify-center gap-1" aria-label="这一场带着的学习增益">
                    {myBuffs.map((b) => (
                      <span key={b.key} className="rounded-full bg-[#fff3c4] px-2 py-0.5 text-[10px] font-bold text-[#8a5a00] sm:text-[11px]">
                        {b.label} · {b.detail}
                      </span>
                    ))}
                  </div>
                )}
                <SpeedBar
                  key={`speed-${currentRound}`}
                  limit={timeLimit}
                  left={timeLeft}
                  stopped={!!myAnswer}
                />

                {/* 选项: 手机两列(省高度),电脑一列。键盘 1–4 / A–D 选,回车出招 */}
                <div className={`mb-2.5 grid gap-2 sm:mb-3 lg:grid-cols-1 ${casting ? 'grid-cols-1' : 'grid-cols-2'}`}>
                  {currentQuestion.options.map((option, index) => {
                    const letter = option[0]; // A/B/C/D
                    const isSelected = selectedAnswer === letter;
                    const isMyAnswer = myAnswer === letter;
                    // 念咒语时只留选中的那一个(答案已经选好了,不放了可以回来改)
                    if (casting && !myAnswer && !isSelected) return null;

                    return (
                      <motion.button
                        key={index}
                        whileTap={{ scale: myAnswer ? 1 : 0.98 }}
                        disabled={!!myAnswer}
                        onClick={() => { playBattleSfx('tap'); setSelectedAnswer(letter); }}
                        className={`flex min-h-[3.25rem] items-center rounded-lg border-2 px-3 py-1.5 text-left transition-colors lg:min-h-10 ${
                          isMyAnswer
                            ? 'border-orange-500 bg-orange-500 text-white'
                            : isSelected
                            ? 'border-orange-400 bg-orange-100 text-orange-800'
                            : 'border-gray-200 bg-gray-50 text-gray-800 hover:bg-gray-100'
                        }`}
                      >
                        <span className="break-words text-[13px] font-bold leading-snug sm:text-base lg:text-[15px]">{option}</span>
                      </motion.button>
                    );
                  })}
                </div>

                {/* 出招: 重击 / 攻击 / 防守,有大招时念咒语(components/battle/BattleActions) */}
                {!myAnswer && (
                  <BattleActions
                    key={`act-${currentRound}`}
                    selected={selectedAnswer}
                    charges={myPet?.ultimate_charges ?? 0}
                    skillName={mySkill?.name || '大招'}
                    skillProgress={skillProgress}
                    spell={mySpell}
                    stances={!!battle.play?.stances}
                    spellOn={!!battle.play?.spell_ultimate}
                    hints={battle.play?.hints}
                    spellBonus={battle.play?.spell_bonus}
                    onCastingChange={setCasting}
                    onAct={(opts) => selectedAnswer && submitAnswer(selectedAnswer, opts)}
                  />
                )}

                {/* 等待状态 */}
                {myAnswer && (
                  <div className="text-center py-4">
                    <div className="text-green-600 font-bold mb-2">✅ 已出招{myMove ? `: ${myMove}` : ''}</div>
                    {!opponentAnswered && (
                      <div className="text-gray-500 text-sm animate-pulse">
                        等待对手答题...
                      </div>
                    )}
                    {opponentAnswered && (
                      <div className="font-semibold text-orange-700">
                        对手已答题，计算结果中...
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 回合结果 */}
            {phase === 'result' && roundResult && (
              <>
                {myPet && myRoster.length > 1 && (
                  <PetSwitchPanel
                    roster={myRoster}
                    currentPetId={myPet.pet_id}
                    switchingPetId={switchingPetId}
                    error={switchError}
                    onSwitch={switchPet}
                  />
                )}
                <RoundResultPanel result={roundResult} isPlayer1={isPlayer1} />
              </>
            )}

            {/* 结束阶段 */}
            {phase === 'end' && endResult && endVisible && (
              <BattleEnd
                result={endResult}
                battle={battle}
                isPlayer1={isPlayer1}
                onBack={() => navigate(endResult.trial || battle.shadow ? '/student/pet/battle-hall' : '/student/pet')}
                onHeal={() => navigate('/student/pet/heal')}
                onSpeak={(word, wordId) => playAudio(word, 1, wordId)}
              />
            )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** 对手是电脑(练习赛 / 闯关 / 同学的影子): 不用等对手进场 */
function vsComputer(b: Battle): boolean {
  return b.mode === 'ai' || !!b.trial || !!b.shadow;
}

/** 进场画面最上面那行: 这一场是什么 */
function battleTitle(b: Battle): string {
  if (b.trial) return `${b.trial.title}${b.trial.boss ? ' · 打赢它,开下一个区域' : ''}`;
  if (b.shadow) return `挑战 ${b.shadow.owner_name} 的影子`;
  return b.mode === 'ai' ? '练习赛' : '对战';
}

/** 守关专考孩子自己错过的词: 开打前告诉他 */
function weakNote(trial: Battle['trial']): string | undefined {
  if (!trial?.boss || !trial.weak_words) return undefined;
  return `守关考的是你自己错过的词: 这一场有 ${trial.weak_words} 个`;
}

/** 开打前的进场画面: 场地当背景,两只宠物从两边进来,中间 VS,下面 3-2-1 */
function VsIntro({
  arenaUrl, title, mine, theirs, countdown, waiting, calm, buffs = [], note,
}: {
  /** 我这一场带着的学习增益(今天作业做完了 → 攻击 +10% …) */
  buffs?: BattleBuff[];
  /** 标题下面那行小字(守关: 这一关有几个是你错过的词) */
  note?: string;
  arenaUrl: string;
  title: string;
  mine: { name: string; level: number; species: string; evolution_stage: number };
  theirs: { name: string; level: number; species: string; evolution_stage: number };
  countdown: number | null;
  waiting: boolean;
  calm: boolean;
}) {
  const side = (pet: typeof mine, left: boolean) => (
    <motion.div
      className="flex min-w-0 flex-1 flex-col items-center"
      initial={calm ? false : { opacity: 0, x: left ? -90 : 90 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: left ? 0.05 : 0.2 }}
    >
      <img
        src={getPetImage(pet.species, pet.evolution_stage)}
        alt=""
        draggable={false}
        className={`h-28 w-28 select-none object-contain drop-shadow-[0_10px_12px_rgba(0,0,0,0.5)] sm:h-44 sm:w-44 ${left ? '' : '-scale-x-100'}`}
      />
      <div className="mt-2 max-w-full truncate font-display text-base font-black text-white sm:text-xl">{pet.name}</div>
      <div className="text-xs font-semibold text-white/75 sm:text-sm">Lv.{pet.level}</div>
    </motion.div>
  );
  return (
    <div className="battle-board relative flex min-h-[26rem] items-center justify-center overflow-hidden rounded-2xl bg-[#1b100a] px-4 py-8">
      <img src={arenaUrl} alt="" draggable={false} className="absolute inset-0 h-full w-full select-none object-cover opacity-60" />
      <div className="absolute inset-0 bg-[#1b100a]/45" />
      <div className="relative w-full max-w-2xl text-center">
        <div className="font-display text-sm font-bold tracking-wide text-[#FFD23F] sm:text-lg">{title}</div>
        {note && <div className="mt-1 text-xs font-semibold text-white/85 sm:text-sm">{note}</div>}
        <div className="mt-4 flex items-center justify-center gap-2 sm:gap-6">
          {side(mine, true)}
          <motion.div
            className="shrink-0 font-display text-4xl font-black italic text-white sm:text-6xl"
            style={{ textShadow: '0 4px 0 #7a1f0c, 0 0 24px rgba(255,107,53,0.8)' }}
            initial={calm ? false : { scale: 2.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.35, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
          >
            VS
          </motion.div>
          {side(theirs, false)}
        </div>
        {buffs.length > 0 && (
          <motion.ul
            className="mt-3 flex flex-wrap items-center justify-center gap-1.5"
            aria-label="今天的学习增益"
            initial={calm ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7, duration: 0.3 }}
          >
            {buffs.map((b) => (
              <li key={b.key} className="rounded-full border border-[#FFD23F]/70 bg-[#3a2a12]/85 px-2.5 py-1 text-[11px] font-bold text-[#FFE38A] sm:text-xs">
                {b.label} · {b.detail}
              </li>
            ))}
          </motion.ul>
        )}
        <div className="mt-4 h-20" aria-live="polite">
          {countdown !== null && countdown > 0 ? (
            <motion.div
              key={countdown}
              className="font-display text-7xl font-black leading-none text-white"
              initial={calm ? false : { scale: 0.3, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.3 }}
            >
              {countdown}
            </motion.div>
          ) : (
            <div className="pt-6 text-base font-bold text-white/85">{waiting ? '等对手进场…' : countdown === null ? '马上开打…' : '开始!'}</div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 倒计时条。服务端本来就有「答得快伤害高」(core 里 calculate_damage: 3 秒内答对 +10,5 秒内 +5),
 * 以前孩子看不到这条规则。条从右往左缩: 金色那一段还没缩完 = 现在答对 +10。
 * 答错照样扣自己的血、断连对,所以瞎蒙不划算。
 */
function SpeedBar({ limit, left, stopped }: { limit: number; left: number; stopped: boolean }) {
  const total = Math.max(1, limit);
  const elapsed = total - left;
  const bonus = elapsed < 3 ? 10 : elapsed < 5 ? 5 : 0;
  const gold = Math.min(100, (3 / total) * 100);
  const amber = Math.min(100, (5 / total) * 100);
  return (
    <div className="mb-2.5 sm:mb-3">
      <div className="relative h-2 overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
        {/* 整条是「橙 → 浅金 → 金」,从右往左被裁掉: 金色那截还在 = 现在答对 +10 */}
        <div
          className="battle-speed-fill absolute inset-0 rounded-full"
          style={{
            background: `linear-gradient(to right, #FF6B35 0%, #FF6B35 ${100 - amber}%, #ffbe3d ${100 - amber}%, #ffbe3d ${100 - gold}%, #FFD23F ${100 - gold}%, #ffe680 100%)`,
            animationDuration: `${total}s`,
            animationPlayState: stopped ? 'paused' : 'running',
          }}
        />
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px] font-semibold leading-4 text-gray-500">
        <span className="tabular-nums">还有 {Math.max(0, left)} 秒</span>
        <span className={bonus ? 'font-bold text-[#b45309]' : ''}>
          {stopped ? '已出招' : bonus === 10 ? '⚡ 现在答对 伤害 +10' : bonus === 5 ? '现在答对 伤害 +5' : '答对就能打中'}
        </span>
      </div>
    </div>
  );
}

function PetSwitchPanel({
  roster,
  currentPetId,
  switchingPetId,
  error,
  onSwitch,
}: {
  roster: BattlePetOption[];
  currentPetId: number;
  switchingPetId: number | null;
  error: string | null;
  onSwitch: (petId: number) => void;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-orange-100 bg-white/90 px-3 py-3 shadow-sm sm:px-4 sm:py-4"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-black text-slate-800 sm:text-base">回合间歇 · 更换宠物</div>
          <div className="text-xs font-semibold text-orange-700">生命 {roster.find((pet) => pet.pet_id === currentPetId)?.hp || 0} HP</div>
        </div>
        <RefreshCw className="h-5 w-5 text-accent-warm" aria-hidden="true" />
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1 sm:grid sm:grid-cols-5 sm:overflow-visible">
        {roster.map((pet) => {
          const isCurrent = pet.pet_id === currentPetId;
          const isSwitching = switchingPetId === pet.pet_id;
          const hpPercent = Math.max(0, Math.min(100, (pet.hp / pet.max_hp) * 100));
          const disabled = isCurrent || !pet.can_switch || switchingPetId !== null;
          return (
            <motion.button
              key={pet.pet_id}
              whileTap={{ scale: disabled ? 1 : 0.97 }}
              disabled={disabled}
              onClick={() => onSwitch(pet.pet_id)}
              aria-label={isCurrent ? `${pet.name}正在出战` : `切换为${pet.name}`}
              className={`relative min-w-[132px] rounded-lg border-2 p-2 text-left transition-colors sm:min-w-0 ${
                isCurrent
                  ? 'border-orange-400 bg-orange-50'
                  : pet.can_switch
                    ? 'border-slate-200 bg-white hover:border-emerald-400 hover:bg-emerald-50'
                    : 'border-slate-200 bg-slate-100 opacity-55'
              }`}
            >
              <div className="flex items-center gap-2">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center">
                  <img
                    src={getPetImage(pet.species, pet.evolution_stage)}
                    alt=""
                    className="h-full w-full object-contain"
                  />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-xs font-black text-slate-800">{pet.name}</div>
                  <div className="text-[10px] font-semibold text-slate-500">Lv.{pet.level}</div>
                  <div className={`mt-1 text-[10px] font-bold ${
                    isCurrent ? 'text-orange-700' : pet.can_switch ? 'text-emerald-700' : 'text-slate-500'
                  }`}>
                    {isSwitching ? '切换中...' : isCurrent ? '出战中' : pet.can_switch ? '可切换' : '不可出战'}
                  </div>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-1.5">
                <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className={`h-full rounded-full ${hpPercent > 50 ? 'bg-emerald-500' : hpPercent > 20 ? 'bg-amber-500' : 'bg-red-500'}`}
                    style={{ width: `${hpPercent}%` }}
                  />
                </div>
                <span className="shrink-0 text-[9px] font-bold tabular-nums text-slate-500">{pet.hp}/{pet.max_hp}</span>
              </div>
            </motion.button>
          );
        })}
      </div>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-2 text-xs font-bold text-red-600"
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}

// 属性克制提示横幅
function TypeMatchupBanner({
  myTypeIcon,
  opponentTypeIcon,
  myEffectiveness,
  opponentEffectiveness,
}: {
  myTypeIcon: string;
  opponentTypeIcon: string;
  myEffectiveness: number;
  opponentEffectiveness: number;
}) {
  // 倍率不一定是 2 / 0.5(闯关里克制是后端给的数),所以按「大于 1 / 小于 1」判,数字照实写
  const mult = (n: number) => `×${Number.isInteger(n) ? n.toFixed(1) : String(Math.round(n * 100) / 100)}`;
  const getMatchupText = () => {
    const up = myEffectiveness > 1;
    const down = myEffectiveness < 1;
    const oppUp = opponentEffectiveness > 1;
    const oppDown = opponentEffectiveness < 1;
    if (up && oppDown) return { text: '你占优势!', color: 'text-green-600', emoji: '💪' };
    if (down && oppUp) return { text: '对手占优势!', color: 'text-red-600', emoji: '⚠️' };
    if (up) return { text: `属性克制!你的攻击伤害 ${mult(myEffectiveness)}`, color: 'text-green-600', emoji: '💥' };
    if (oppUp) return { text: `被克制了!对手的攻击伤害 ${mult(opponentEffectiveness)}`, color: 'text-orange-600', emoji: '🛡️' };
    if (down) return { text: '你的攻击效果不好…', color: 'text-yellow-600', emoji: '🛡️' };
    if (oppDown) return { text: '对手攻击效果不好', color: 'text-emerald-700', emoji: '💪' };
    return { text: '势均力敌', color: 'text-gray-600', emoji: '⚖️' };
  };

  const matchup = getMatchupText();

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl bg-white/90 px-3 py-1.5 shadow-sm ring-1 ring-black/5"
    >
      <div className="flex items-center justify-center gap-2 sm:gap-3">
        <div className="text-xl leading-none" aria-hidden="true">{myTypeIcon}</div>
        <div className="flex min-w-0 flex-wrap items-baseline justify-center gap-x-2 text-center">
          <div className={`text-sm font-bold ${matchup.color}`}>
            {matchup.emoji} {matchup.text}
          </div>
          <div className="whitespace-nowrap text-[11px] text-gray-500">
            你 {mult(myEffectiveness)} | 对手 {mult(opponentEffectiveness)}
          </div>
        </div>
        <div className="text-xl leading-none" aria-hidden="true">{opponentTypeIcon}</div>
      </div>
    </motion.div>
  );
}

function RoundResultPanel({ result, isPlayer1 }: { result: RoundResult; isPlayer1: boolean }) {
  const myResult = isPlayer1
    ? {
        answer: result.player1_answer,
        correct: result.player1_correct,
        damage: result.player1_damage,
        ultimate: result.player1_used_ultimate,
        typeText: result.player1_type_text,
      }
    : {
        answer: result.player2_answer,
        correct: result.player2_correct,
        damage: result.player2_damage,
        ultimate: result.player2_used_ultimate,
        typeText: result.player2_type_text,
      };

  const opponentResult = isPlayer1
    ? {
        answer: result.player2_answer,
        correct: result.player2_correct,
        damage: result.player2_damage,
        ultimate: result.player2_used_ultimate,
        typeText: result.player2_type_text,
      }
    : {
        answer: result.player1_answer,
        correct: result.player1_correct,
        damage: result.player1_damage,
        ultimate: result.player1_used_ultimate,
        typeText: result.player1_type_text,
      };

  const mySpell = isPlayer1 ? result.player1_spell : result.player2_spell;
  const myStance = isPlayer1 ? result.player1_stance : result.player2_stance;
  const oppStance = isPlayer1 ? result.player2_stance : result.player1_stance;
  const stanceName = (st?: string | null) => (st === 'heavy' ? '重击' : st === 'guard' ? '防守' : '');

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="rounded-xl bg-white p-3 shadow-xl sm:rounded-3xl sm:p-6"
    >
      <div className="mb-3 text-center sm:mb-6">
        <div className="mb-1 text-xl font-bold text-gray-800 sm:mb-2 sm:text-3xl">回合结果</div>
        {result.question.word && (
          <div className="break-words font-display text-xl font-bold text-orange-600 sm:text-2xl">{result.question.word}</div>
        )}
        <div className="break-words text-sm text-gray-600 sm:text-base">
          正确答案: <span className="font-bold text-green-600">{result.question.options.find(opt => opt[0] === result.question.correct_answer)}</span>
        </div>
        {/* 咒语: 拼对了放出大招;拼错了把正确的拼法摆出来(这个词会排进后面的今日复习) */}
        {mySpell && (
          <div className={`mx-auto mt-2 max-w-sm rounded-lg px-3 py-1.5 text-sm ${mySpell.ok ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-800'}`}>
            {mySpell.ok ? (
              <span className="font-bold">咒语念对了: {mySpell.word}({mySpell.meaning})</span>
            ) : (
              <>
                <div className="font-bold">咒语没念对,这一下只是普通攻击,大招还留着</div>
                <div className="mt-0.5">
                  {mySpell.meaning} = <span className="font-display text-base font-black">{mySpell.word}</span>
                  {mySpell.typed ? <span className="ml-2 text-red-700/80 line-through">{mySpell.typed}</span> : null}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:gap-6">
        {/* 我的结果 */}
        <div className={`rounded-xl p-2 sm:p-4 ${myResult.correct ? 'bg-green-50 border-2 border-green-300' : 'bg-red-50 border-2 border-red-300'}`}>
          <div className="text-center">
            <div className="mb-1 text-2xl sm:mb-2 sm:text-4xl">{myResult.correct ? '✅' : '❌'}</div>
            <div className="break-words text-xs font-bold text-gray-700 sm:text-base">你的答案: {myResult.answer}</div>
            {myResult.ultimate && <div className="mt-1 text-xs font-bold text-amber-700 sm:text-base">⚡ 放出了大招</div>}
            {!myResult.ultimate && stanceName(myStance) && <div className="mt-1 text-xs font-bold text-slate-600 sm:text-sm">出招: {stanceName(myStance)}</div>}
            {myResult.damage > 0 && (
              <div className="mt-1 sm:mt-2">
                <div className="text-sm font-bold text-red-600 sm:text-2xl">
                  造成 {myResult.damage} 伤害!
                </div>
                {myResult.typeText && (
                  <div className="mt-1 text-xs font-bold text-yellow-600 sm:text-lg">
                    {myResult.typeText}
                  </div>
                )}
              </div>
            )}
            {myResult.damage < 0 && (
              <div className="mt-2 text-sm font-bold text-gray-600 sm:text-xl">
                受到 {Math.abs(myResult.damage)} 伤害
              </div>
            )}
          </div>
        </div>

        {/* 对手结果 */}
        <div className={`rounded-xl p-2 sm:p-4 ${opponentResult.correct ? 'bg-green-50 border-2 border-green-300' : 'bg-red-50 border-2 border-red-300'}`}>
          <div className="text-center">
            <div className="mb-1 text-2xl sm:mb-2 sm:text-4xl">{opponentResult.correct ? '✅' : '❌'}</div>
            <div className="break-words text-xs font-bold text-gray-700 sm:text-base">对手答案: {opponentResult.answer}</div>
            {opponentResult.ultimate && <div className="mt-1 text-xs font-bold text-amber-700 sm:text-base">⚡ 放出了大招</div>}
            {!opponentResult.ultimate && stanceName(oppStance) && <div className="mt-1 text-xs font-bold text-slate-600 sm:text-sm">出招: {stanceName(oppStance)}</div>}
            {opponentResult.damage > 0 && (
              <div className="mt-1 sm:mt-2">
                <div className="text-sm font-bold text-red-600 sm:text-2xl">
                  造成 {opponentResult.damage} 伤害!
                </div>
                {opponentResult.typeText && (
                  <div className="mt-1 text-xs font-bold text-yellow-600 sm:text-lg">
                    {opponentResult.typeText}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-3 text-center text-xs text-gray-500 sm:mt-6 sm:text-sm">
        下一回合即将开始...
      </div>
    </motion.div>
  );
}

