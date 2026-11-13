/**
 * 宠物对战 · 结算页(2026-11-11)
 *
 * 比以前多的两块:
 * - 「这几个词再看一眼」: 这一场里我答错 / 没来得及答的词(服务端 battle_review 给的),点一下能听。
 *   答错的词服务端已经把它的复习往前排了(pet_battle_service.note_battle_miss),这里告诉孩子一声。
 * - 今天还能打几场 + 怎么再拿(规则在后端 services/battle_tickets,这里原样显示)。
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { Star, Volume2 } from 'lucide-react';
import {
  getBattleTickets,
  quickMatchBattle,
  type Battle,
  type BattleEndData,
  type BattleTickets,
  startTrialStage,
} from '../../api/petBattle';
import { getPetImage } from '../../config/petSpecies';
import { BATTLE_TICKETS_QUERY_KEY, ticketBlockReason } from '../../utils/battleTickets';
import { getErrorMessage } from '../../utils/errorMessage';
import BattleTicketsCard from '../pet/BattleTicketsCard';

function CaptureBall({ success }: { success: boolean }) {
  return (
    <motion.div
      aria-hidden="true"
      className="relative mx-auto h-14 w-14 overflow-hidden rounded-full border-[5px] border-gray-800 bg-white"
      animate={success
        ? { y: [0, -18, 0, -8, 0], rotate: [0, 180, 360, 520, 720] }
        : { x: [0, -9, 9, -7, 7, 0], rotate: [0, -12, 12, -8, 8, 0] }}
      transition={{ duration: success ? 1.25 : 0.8, ease: 'easeInOut' }}
    >
      <div className="h-1/2 bg-red-500" />
      <div className="absolute left-0 top-1/2 h-[6px] w-full -translate-y-1/2 bg-gray-800" />
      <div className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-gray-800 bg-white" />
    </motion.div>
  );
}

function captureStatus(result: BattleEndData, myPlayerId: number) {
  const capture = result.capture;
  if (!capture) return null;
  if (capture.success && capture.winner_id === myPlayerId) {
    return { tone: 'emerald', title: `收服成功!${capture.pet_name} 加入了你的队伍`, detail: '等级、进化阶段和培养状态全部保留。' };
  }
  if (capture.success && capture.loser_id === myPlayerId) {
    return {
      tone: 'red',
      title: `你的 ${capture.pet_name} 被对方收服了`,
      detail: capture.loser_has_no_pets
        ? '当前已经没有伙伴,再学习 2000 个不同单词即可重新领养。'
        : '系统已自动派出队伍中等级最高的伙伴。',
    };
  }
  if (capture.winner_id !== myPlayerId) return null;
  const need = capture.required_words?.toLocaleString() || '更多';
  switch (capture.reason) {
    case 'escaped':
      return { tone: 'amber', title: `${capture.pet_name} 挣脱了收服光环`, detail: `本次 ${capture.chance}% 收服判定未成功。` };
    case 'slot_locked':
      return { tone: 'gray', title: '收服光环暂时无法使用', detail: `先累计学习 ${need} 个不同单词,解锁新的队伍名额。` };
    case 'duplicate_species':
      return { tone: 'gray', title: '没有放出收服光环', detail: '你的队伍里已经有这个伙伴家族。' };
    case 'roster_full':
      return { tone: 'gray', title: '队伍已满', detail: '最多同时拥有 5 只普通伙伴,本次无法收服。' };
    // 传说三种拒绝: 没到学词门槛 / 传说格没开 / 传说格已满。分开说,孩子才知道差在哪
    case 'legend_words_locked':
      return { tone: 'gray', title: `${capture.pet_name} 是传说伙伴`, detail: `需要累计学会 ${need} 个不同单词才能收服它。` };
    case 'legend_slot_locked':
      return { tone: 'gray', title: '传说专属格还没开启', detail: `先累计学习 ${need} 个不同单词,解锁下一个传说名额。` };
    case 'legend_roster_full':
      return { tone: 'gray', title: '传说队伍已满', detail: '最多同时拥有 2 只传说伙伴,本次无法收服。' };
    default:
      return null;
  }
}

const TONE_CLASS: Record<string, string> = {
  emerald: 'border-emerald-200 bg-emerald-50',
  red: 'border-red-200 bg-red-50',
  amber: 'border-amber-200 bg-amber-50',
  gray: 'border-[#eadfd3] bg-[#f7f1ea]',
};

export default function BattleEnd({
  result, battle, isPlayer1, onBack, onSpeak, onHeal,
}: {
  /** 宠物打完受伤了(体力不到一半): 去恢复训练(答几个单词回血) */
  onHeal?: () => void;
  result: BattleEndData;
  battle: Battle;
  isPlayer1: boolean;
  onBack: () => void;
  /** 读一个词(走全站那一个发音) */
  onSpeak: (word: string, wordId: number) => void;
}) {
  const myId = isPlayer1 ? battle.player1_id : battle.player2_id;
  const isDraw = !result.winner_id;
  const isWinner = result.winner_id === myId;
  const myPet = isPlayer1 ? battle.player1_pet : battle.player2_pet;
  const myStats = isPlayer1 ? result.player1_final_stats : result.player2_final_stats;
  const status = captureStatus(result, myId);

  const review = result.review || [];
  const missed = review
    .map((r) => ({
      ...r,
      correct: isPlayer1 ? r.player1_correct : r.player2_correct,
      answered: isPlayer1 ? r.player1_answered : r.player2_answered,
      unsure: !!(isPlayer1 ? r.player1_unsure : r.player2_unsure),
    }))
    // 答错的、没来得及答的、咒语拼错的,加上「选了防守又答对」的(拿不准,多半是蒙的)
    .filter((r) => (!r.correct || r.unsure) && r.word);
  // 「答对几题」只数选择题: 念咒语拼错的词是另外一行(spell),不算一道题
  const asked = review.filter((r) => !r.spell);
  const total = asked.length;
  const right = total - asked.filter((r) => !(isPlayer1 ? r.player1_correct : r.player2_correct)).length;

  // 今天还能打几场(打完这一场要重取)
  const { data: tickets } = useQuery<BattleTickets>({
    queryKey: BATTLE_TICKETS_QUERY_KEY,
    queryFn: getBattleTickets,
    refetchOnMount: 'always',
  });
  const blockReason = ticketBlockReason(tickets);
  const [starting, setStarting] = useState(false);
  const [againError, setAgainError] = useState('');
  // 闯关: 赢了去下一关,没赢再挑战这一关;练习赛照旧随手再配一场
  const trial = result.trial ?? null;
  // 打同学的影子: 一个同学一天一次,没有「再打一场」,回大厅换一个人
  const shadow = battle.shadow ?? null;
  const trialTarget = trial ? (trial.won && trial.next_stage ? trial.next_stage : trial.stage) : null;
  const again = async () => {
    if (starting) return;
    setAgainError('');
    setStarting(true);
    try {
      const next = trialTarget ? await startTrialStage(trialTarget) : await quickMatchBattle();
      // 换一场要整页重来: 对战页的状态(回合、血量、连接)都跟着这一场
      window.location.href = `/student/pet/battle/${next.id}`;
    } catch (error) {
      setAgainError(getErrorMessage(error, '没匹配上,稍后再试'));
      setStarting(false);
    }
  };

  const title = trial
    ? (trial.won ? `第 ${trial.stage} 关 通过!` : `第 ${trial.stage} 关没过`)
    : shadow
      ? (isWinner ? `打败了 ${shadow.owner_name} 的影子!` : isDraw ? '和影子打成平手' : `${shadow.owner_name} 的影子守住了`)
      : isDraw ? '平局' : isWinner ? '胜利!' : '这一场没赢';
  const sub = trial
    ? (trial.won
      ? (trial.stars >= 3 ? '一个都没错,三颗星' : trial.stars === 2 ? '只错了一个,差一点三颗星' : '过关了。少错几个能拿更多星')
      : `${myPet.name} 尽力了。把下面这几个词看一眼再来`)
    : isDraw
      ? '两边打成平手'
      : isWinner ? `${myPet.name} 赢下了这一场` : `${myPet.name} 尽力了,下一场再来`;
  const isAi = !shadow && (battle.mode === 'ai' || !!battle.trial || !!trial);
  // 打完体力不到一半 = 受伤了(后端同一条线),再开一场会被拦。闯关赢了体力回满,不算
  // 闯关 / 影子打赢了体力回满(后端给 healed),那就不算受伤
  const healed = !!(result.healed ?? trial?.healed);
  const hurt = !healed && (myStats?.hp ?? myPet.max_hp) < myPet.max_hp * 0.5;
  const againLabel = trial
    ? (trial.won && trial.next_stage ? `下一关(第 ${trial.next_stage} 关)` : '再挑战一次')
    : '再打一场';

  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="mx-auto w-full max-w-2xl"
    >
      <div className="overflow-hidden rounded-2xl bg-[#fffaf3] text-ink">
        {/* 胜负 */}
        <div className={`flex items-center gap-4 px-5 py-5 sm:px-7 sm:py-6 ${
          isWinner ? 'bg-[#fff0c9]' : isDraw ? 'bg-[#ffe9d9]' : 'bg-[#eef1f5]'
        }`}>
          <motion.img
            src={getPetImage(myPet.species, myPet.evolution_stage)}
            alt=""
            draggable={false}
            className={`h-20 w-20 shrink-0 select-none object-contain sm:h-24 sm:w-24 ${!isWinner && !isDraw ? 'opacity-80 grayscale-[35%]' : ''}`}
            animate={isWinner ? { y: [0, -10, 0, -5, 0] } : undefined}
            transition={{ duration: 1.1, repeat: isWinner ? 2 : 0 }}
          />
          <div className="min-w-0">
            <h1 className="font-display text-3xl font-black leading-tight sm:text-4xl">{title}</h1>
            {trial?.won && (
              <div className="mt-1.5 flex items-center gap-1.5" aria-label={`${trial.stars} 颗星`}>
                {[1, 2, 3].map((i) => (
                  <motion.span
                    key={i}
                    aria-hidden="true"
                    initial={{ scale: 0, rotate: -40, opacity: 0 }}
                    animate={{ scale: 1, rotate: 0, opacity: 1 }}
                    transition={{ delay: 0.25 + i * 0.28, type: 'spring', stiffness: 380, damping: 14 }}
                  >
                    <Star className={`h-8 w-8 sm:h-9 sm:w-9 ${i <= trial.stars ? 'fill-[#FFD23F] text-[#d99a00]' : 'fill-transparent text-black/20'}`} />
                  </motion.span>
                ))}
              </div>
            )}
            <p className="mt-1 break-words text-sm text-ink-soft sm:text-base">{sub}</p>
            {healed && (
              <p className="mt-1 text-xs font-bold text-[#15803d] sm:text-sm">{trial ? '过关了' : '打赢了'},{myPet.name} 的体力回满了</p>
            )}
            {trial?.first_clear && trial.bonus && (trial.bonus.food > 0 || trial.bonus.xp > 0) && (
              <p className="mt-1 text-xs font-bold text-[#b45309] sm:text-sm">
                第一次通过,多给了 {trial.bonus.food} 粮食、{trial.bonus.xp} 经验(已经算在下面)
              </p>
            )}
          </div>
        </div>

        <div className="space-y-4 px-4 py-4 sm:px-7 sm:py-6">
          {/* 这一场拿到什么 */}
          <div className="grid grid-cols-3 gap-2 text-center sm:gap-3">
            {[
              { label: '答对', value: total ? `${right} / ${total}` : `${myStats?.correct ?? 0}` },
              { label: '粮食', value: `+${result.food_earned ?? 0}` },
              { label: '经验', value: `+${result.xp_earned ?? 0}` },
            ].map((item) => (
              <div key={item.label} className="rounded-xl bg-[#f7f1ea] px-2 py-3">
                <div className="font-numeric text-xl font-black text-accent-warm sm:text-2xl">{item.value}</div>
                <div className="mt-0.5 text-xs text-ink-soft sm:text-sm">{item.label}</div>
              </div>
            ))}
          </div>

          {status && (
            <div className={`rounded-xl border p-4 text-center ${TONE_CLASS[status.tone] ?? TONE_CLASS.gray}`}>
              <CaptureBall success={Boolean(result.capture?.success)} />
              <div className="mt-3 break-words text-base font-bold">{status.title}</div>
              <div className="mt-1 break-words text-sm leading-6 text-ink-soft">{status.detail}</div>
            </div>
          )}

          {/* 答错的词 */}
          {total > 0 && (
            <section aria-labelledby="battle-review-title">
              <h2 id="battle-review-title" className="text-base font-bold">
                {missed.length ? '这几个词再看一眼' : `这一场 ${total} 题全对`}
              </h2>
              {missed.length > 0 && (
                <>
                  <p className="mt-0.5 text-xs leading-5 text-ink-soft sm:text-sm">
                    学过的词答错了,会排进你后面的「今日复习」。{missed.some((r) => r.unsure && r.correct) ? '标着「拿不准」的是防守时答对的,也再看一眼。' : ''}点一下能听。
                  </p>
                  <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                    {missed.map((r) => (
                      <li key={`${r.round}-${r.spell ? 'spell' : 'q'}`}>
                        <button
                          type="button"
                          onClick={() => onSpeak(r.word, r.word_id)}
                          className="flex min-h-12 w-full items-center gap-2.5 rounded-xl border border-[#eadfd3] bg-white/95 px-3 py-2 text-left transition hover:border-accent-warm"
                          aria-label={`听 ${r.word}`}
                        >
                          <Volume2 className="h-4 w-4 shrink-0 text-accent-warm" aria-hidden="true" />
                          <span className="min-w-0 flex-1">
                            <span className="block break-words text-base font-bold leading-5">{r.word}</span>
                            <span className="block break-words text-xs leading-5 text-ink-soft sm:text-sm">{r.meaning}</span>
                          </span>
                          {r.spell ? (
                            <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">咒语拼错</span>
                          ) : r.unsure && r.correct ? (
                            <span className="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-800">拿不准</span>
                          ) : !r.answered && (
                            <span className="shrink-0 rounded-full bg-[#f7f1ea] px-2 py-0.5 text-[11px] text-ink-soft">没来得及答</span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}

          {/* 今天还能打几场 */}
          {tickets?.enabled && <BattleTicketsCard tickets={tickets} compact />}

          {hurt && onHeal && (
            <p className="rounded-xl bg-[#fff4e5] px-3 py-2 text-sm text-[#7c4a03]">
              体力不到一半,要先恢复才能再打。恢复训练是答几道学过的单词,答对就回血;不答的话它歇着也会慢慢好(每小时回一点,比较慢)。
            </p>
          )}

          {againError && (
            <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{againError}</p>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            {hurt && onHeal && (
              <button
                type="button"
                onClick={onHeal}
                className="btn-glow min-h-12 flex-1 rounded-xl px-5 text-base font-bold text-white"
              >
                {myPet.name} 受伤了,去恢复训练
              </button>
            )}
            {isAi && !(hurt && onHeal) && (
              <button
                type="button"
                onClick={again}
                disabled={starting || !!blockReason}
                className="btn-glow min-h-12 flex-1 rounded-xl px-5 text-base font-bold text-white"
              >
                {starting ? '正在进场…' : blockReason ? '今天的场数用完了' : againLabel}
              </button>
            )}
            <button
              type="button"
              onClick={onBack}
              className={`min-h-12 flex-1 rounded-xl px-5 text-base font-bold transition ${
                isAi
                  ? 'bg-[#f1e7dc] text-ink hover:bg-[#eadccd]'
                  : 'btn-glow text-white'
              }`}
            >
              {trial ? '回闯关地图' : shadow ? '回对战大厅,换一位同学' : '返回宠物页面'}
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
