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
import { Volume2 } from 'lucide-react';
import {
  getBattleTickets,
  quickMatchBattle,
  type Battle,
  type BattleEndData,
  type BattleTickets,
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
  result, battle, isPlayer1, onBack, onSpeak,
}: {
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
    }))
    .filter((r) => !r.correct && r.word);
  const total = review.length;
  const right = total - review.filter((r) => !(isPlayer1 ? r.player1_correct : r.player2_correct)).length;

  // 今天还能打几场(打完这一场要重取)
  const { data: tickets } = useQuery<BattleTickets>({
    queryKey: BATTLE_TICKETS_QUERY_KEY,
    queryFn: getBattleTickets,
    refetchOnMount: 'always',
  });
  const blockReason = ticketBlockReason(tickets);
  const [starting, setStarting] = useState(false);
  const [againError, setAgainError] = useState('');
  const again = async () => {
    if (starting) return;
    setAgainError('');
    setStarting(true);
    try {
      const next = await quickMatchBattle();
      // 换一场要整页重来: 对战页的状态(回合、血量、连接)都跟着这一场
      window.location.href = `/student/pet/battle/${next.id}`;
    } catch (error) {
      setAgainError(getErrorMessage(error, '没匹配上,稍后再试'));
      setStarting(false);
    }
  };

  const title = isDraw ? '平局' : isWinner ? '胜利!' : '这一场没赢';
  const sub = isDraw
    ? '两边打成平手'
    : isWinner ? `${myPet.name} 赢下了这一场` : `${myPet.name} 尽力了,下一场再来`;

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
            <p className="mt-1 break-words text-sm text-ink-soft sm:text-base">{sub}</p>
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
                    学过的词答错了,会排进你后面的「今日复习」。点一下能听。
                  </p>
                  <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                    {missed.map((r) => (
                      <li key={r.round}>
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
                          {!r.answered && (
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

          {againError && (
            <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{againError}</p>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            {battle.mode === 'ai' && (
              <button
                type="button"
                onClick={again}
                disabled={starting || !!blockReason}
                className="btn-glow min-h-12 flex-1 rounded-xl px-5 text-base font-bold text-white"
              >
                {starting ? '正在找对手…' : blockReason ? '今天的场数用完了' : '再打一场'}
              </button>
            )}
            <button
              type="button"
              onClick={onBack}
              className={`min-h-12 flex-1 rounded-xl px-5 text-base font-bold transition ${
                battle.mode === 'ai'
                  ? 'bg-[#f1e7dc] text-ink hover:bg-[#eadccd]'
                  : 'btn-glow text-white'
              }`}
            >
              返回宠物页面
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
