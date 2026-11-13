/**
 * 宠物对战 · 闯关地图(2026-11-12)
 *
 * 为什么要有: 以前每一场都是随手配的对手,打完没有「下一步」。现在一关一关往前走 ——
 * 8 个区域、每个区域 5 关,第 5 关是守关的大家伙;每关按答题表现记 1–3 颗星。
 * 规则(对手是谁、多强、怎么算星)全在后端 services/pet_trial,这里只管画和点。
 *
 * 场数照旧: 打一关吃一场对战场数(先做作业、做今日复习、学新词才有),这张图不绕开它 ——
 * 没场数时按钮上直接写原因。
 */
import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Crown, Lock, Star, Swords } from 'lucide-react';
import type { TrialOverview, TrialStage } from '../../api/petBattle';
import { getPetImage } from '../../config/petSpecies';

interface Props {
  data: TrialOverview;
  /** 正在开哪一关(按钮转圈);没有是 null */
  starting: number | null;
  /** 今天没场数了 / 宠物受伤了: 按钮上写的那句话;能打是 null */
  blockReason: string | null;
  error?: string;
  onStart: (stage: number) => void;
}

function Stars({ n, size = 'sm' }: { n: number; size?: 'sm' | 'lg' }) {
  const cls = size === 'lg' ? 'h-5 w-5' : 'h-3 w-3';
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${n} 颗星`}>
      {[1, 2, 3].map((i) => (
        <Star
          key={i}
          aria-hidden="true"
          className={`${cls} ${i <= n ? 'fill-[#FFD23F] text-[#e0a800]' : 'fill-transparent text-black/20'}`}
        />
      ))}
    </span>
  );
}

function StageNode({
  s, isNext, starting, disabled, onStart,
}: { s: TrialStage; isNext: boolean; starting: boolean; disabled: boolean; onStart: (stage: number) => void }) {
  const locked = !s.unlocked;
  const label = locked
    ? `第 ${s.stage} 关,还没开放`
    : `第 ${s.stage} 关${s.boss ? ',守关' : ''},对手 ${s.pet_name}${s.cleared ? `,已通过,${s.stars} 颗星` : ''}`;
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1">
      <button
        type="button"
        disabled={locked || disabled}
        onClick={() => onStart(s.stage)}
        aria-label={label}
        title={locked ? '先通过前一关' : s.pet_name}
        className={`relative flex items-center justify-center rounded-full border-2 font-display font-black transition-transform ${
          s.boss ? 'h-11 w-11 text-base' : 'h-10 w-10 text-sm'
        } ${
          locked
            ? 'border-black/10 bg-black/[0.04] text-black/30'
            : s.cleared
              ? 'border-[#e0a800] bg-[#FFE38A] text-[#6b4a00] hover:-translate-y-0.5'
              : 'border-[#d9480f] bg-[#FF6B35] text-white hover:-translate-y-0.5'
        } ${isNext && !disabled ? 'trial-next-pulse' : ''} disabled:cursor-not-allowed`}
      >
        {starting
          ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
          : locked
            ? <Lock className="h-4 w-4" aria-hidden="true" />
            : s.boss ? <Crown className="h-5 w-5" aria-hidden="true" /> : s.stage}
      </button>
      <div className="flex h-3 items-center">
        {s.cleared ? <Stars n={s.stars} /> : isNext ? <span className="text-[10px] font-bold leading-none text-[#c2410c]">这一关</span> : null}
      </div>
    </div>
  );
}

export default function TrialMap({ data, starting, blockReason, error, onStart }: Props) {
  const all = data.areas.flatMap((a) => a.stages);
  const next = all.find((s) => s.stage === data.next_stage) ?? null;
  const nextArea = data.areas.find((a) => a.stages.some((s) => s.stage === data.next_stage)) ?? data.areas[0];
  const maxStars = all.length * 3;
  const busy = starting !== null;

  // 进来时把「现在打到的那个区域」滚进视野(手机上 8 个区域是竖着排的)
  const currentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest' });
  }, [nextArea?.index]);

  return (
    <section aria-labelledby="trial-title" className="space-y-3">
      {/* 下一关 */}
      <div className="relative overflow-hidden rounded-2xl bg-[#2a1a12] text-white">
        {nextArea && (
          <img
            src={`/battle-arena/${nextArea.arena}.jpg`}
            alt=""
            draggable={false}
            className="absolute inset-0 h-full w-full select-none object-cover opacity-70"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-[#1b100a]/90 via-[#1b100a]/55 to-transparent" />
        <div className="relative flex items-center gap-3 p-4 sm:gap-5 sm:p-6">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-white/80 sm:text-sm">
              <span id="trial-title" className="font-display text-base font-black text-white sm:text-lg">闯关</span>
              <span>已通过 {data.cleared} 关</span>
              <span className="inline-flex items-center gap-1">
                <Star className="h-3.5 w-3.5 fill-[#FFD23F] text-[#FFD23F]" aria-hidden="true" />
                {data.total_stars} / {maxStars}
              </span>
              {data.lap > 0 && <span className="rounded-full bg-white/15 px-2 py-0.5">第 {data.lap + 1} 圈 · 对手更强了</span>}
            </div>
            {next ? (
              <>
                <h3 className="mt-2 font-display text-2xl font-black leading-tight sm:text-3xl">
                  {nextArea.name} · 第 {next.stage} 关
                </h3>
                <p className="mt-1 break-words text-sm text-white/85 sm:text-base">
                  对手: {next.pet_name}{next.level ? ` Lv.${next.level}` : ''}{next.boss ? '(打赢它,开下一个区域)' : ''}
                </p>
                {(next.attempts ?? 0) >= 2 && (
                  <p className="mt-1 text-xs font-semibold text-white/75 sm:text-sm">
                    这一关试过 {next.attempts} 次了。答得快(3 秒内)伤害更高,连对 3 题能放大招
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => onStart(next.stage)}
                  disabled={busy || !!blockReason}
                  className="btn-glow mt-3 inline-flex min-h-12 items-center gap-2 rounded-xl px-6 text-base font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Swords className="h-5 w-5" aria-hidden="true" />
                  {starting === next.stage ? '正在进场…' : blockReason ? '现在还不能打' : `挑战第 ${next.stage} 关`}
                </button>
                {blockReason && <p className="mt-2 text-sm font-semibold text-[#FFD23F]">{blockReason}</p>}
              </>
            ) : (
              <h3 className="mt-2 font-display text-2xl font-black">这一圈全部通过了</h3>
            )}
            {error && <p role="alert" className="mt-2 rounded-lg bg-red-600/85 px-3 py-1.5 text-sm font-semibold">{error}</p>}
          </div>
          {next && (
            <motion.img
              src={getPetImage(next.species, next.evolution_stage ?? 1)}
              alt=""
              draggable={false}
              className={`w-24 shrink-0 select-none drop-shadow-[0_8px_10px_rgba(0,0,0,0.5)] sm:w-36 ${next.boss ? 'sm:w-44' : ''}`}
              animate={{ y: [0, -6, 0] }}
              transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
            />
          )}
        </div>
      </div>

      {/* 8 个区域 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {data.areas.map((area) => {
          const open = area.stages.some((s) => s.unlocked);
          const done = area.stages.every((s) => s.cleared);
          const isCurrent = area.index === nextArea?.index;
          return (
            <div
              key={area.index}
              ref={isCurrent ? currentRef : undefined}
              className={`overflow-hidden rounded-2xl border bg-white ${isCurrent ? 'border-[#FF6B35]' : 'border-black/10'}`}
            >
              <div className="relative h-16">
                <img
                  src={`/battle-arena/${area.arena}.jpg`}
                  alt=""
                  loading="lazy"
                  draggable={false}
                  className={`h-full w-full select-none object-cover ${open ? '' : 'opacity-60 grayscale'}`}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/65 to-transparent" />
                <div className="absolute inset-x-3 bottom-1.5 flex items-center justify-between gap-2 text-white">
                  <span className="truncate font-display text-base font-black">{area.name}</span>
                  <span className="shrink-0 text-[11px] font-semibold text-white/90">
                    {done ? '全部通过' : open ? `${area.stages.filter((s) => s.cleared).length} / ${area.stages.length}` : (
                      <span className="inline-flex items-center gap-1"><Lock className="h-3 w-3" aria-hidden="true" />打赢上一个守关后开放</span>
                    )}
                  </span>
                </div>
              </div>
              <div className="flex items-start gap-1 px-2.5 pb-2.5 pt-3">
                {area.stages.map((s) => (
                  <StageNode
                    key={s.stage}
                    s={s}
                    isNext={s.stage === data.next_stage}
                    starting={starting === s.stage}
                    disabled={busy || !!blockReason}
                    onStart={onStart}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
