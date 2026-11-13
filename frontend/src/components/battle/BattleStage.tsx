/**
 * 宠物对战 · 战场外壳(2026-11-11)
 *
 * 3D 画面在 BattleScene3D(懒加载,three.js 不进主包)。这一层是盖在画面上的网页元素和调度:
 * - 两只宠物头顶的名字牌 + 血条。**血条在招式打中的那一刻才掉**(以前结果一到就掉,招式还没飞到)
 * - 伤害数字、「属性克制 / 答错被反击」那行字
 * - 大招的切入画面(暗场 + 立绘 + 招式名)
 * - 声音: 和画面走同一条时间线(components/battle/fx.ts)
 * - 起不来 3D 的电脑(老显卡 / 被禁用 WebGL): 换成平面战场 —— 同一张场地图、同一条时间线,
 *   只是用网页动画演。以前这种电脑整页报错
 *
 * 血量从哪来: props 里的 hp 是服务端这一回合**结算后**的数。演出期间这里按时间线自己显示
 * 「打中之前是多少、打中之后是多少」,演完再跟回 props。
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ARENA_AMBIENCE, ARENA_NAME, arenaIdOf, fxCues, type BattleFx, type Side } from './fx';
import { playBattleSfx } from '../../utils/battleSfx';

const BattleScene3D = lazy(() => import('../BattleScene3D'));

export interface StagePet {
  name: string;
  level: number;
  /** 画在战场上的图(我方用朝右的那张) */
  image: string;
  hp: number;
  maxHp: number;
  gem: boolean;
  /** 属性的图标和名字,显示在名字牌上 */
  typeIcon: string;
  typeName: string;
  combo: number;
}

interface Props {
  arenaUrl: string;
  arenaName: string;
  my: StagePet;
  opp: StagePet;
  /** 这一回合的招式时间线;换一组(数组换了)就从头演。新一题发下来时传空数组 */
  fx: BattleFx[];
  finale: { loser: Side | null; winner: Side | null } | null;
  calm: boolean;
  /** 一记招式打中: 对战页据此更新连击 / 技能充能等 */
  onImpact?: (fx: BattleFx) => void;
}

function hpTone(ratio: number) {
  if (ratio > 0.5) return '#5FD35F';
  if (ratio > 0.2) return '#FFD23F';
  return '#FF5757';
}

function Plate({
  pet, shownHp, side, hit,
}: { pet: StagePet; shownHp: number; side: Side; hit: boolean }) {
  const ratio = Math.max(0, Math.min(1, shownHp / Math.max(1, pet.maxHp)));
  // 名字牌固定在顶部角落(我方左上,对手右上),不挡宠物。pos 留给伤害数字用
  const style = side === 1
    ? { left: '4%', top: '6%' }
    : { right: '4%', top: '6%' };
  return (
    <div className="pointer-events-none absolute z-[6] w-[min(46%,15rem)]" style={style}>
      <motion.div
        animate={hit ? { x: [0, -5, 5, -3, 2, 0] } : { x: 0 }}
        transition={{ duration: 0.3 }}
        className="rounded-xl border border-white/25 bg-[#1b1410]/80 px-2.5 py-1.5 text-white shadow-[0_6px_18px_rgba(0,0,0,0.35)] sm:px-3 sm:py-2"
      >
        <div className="flex items-center gap-1.5 text-[11px] font-bold leading-4 sm:text-sm">
          <span aria-hidden="true">{pet.typeIcon}</span>
          <span className="min-w-0 flex-1 truncate">{pet.name}</span>
          <span className="shrink-0 font-numeric text-[10px] font-semibold text-white/75 sm:text-xs">Lv.{pet.level}</span>
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/20 sm:h-2.5">
          <motion.div
            className="h-full rounded-full"
            initial={false}
            animate={{ width: `${ratio * 100}%`, backgroundColor: hpTone(ratio) }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          />
        </div>
        <div className="mt-0.5 flex items-center justify-between text-[10px] leading-4 text-white/80 sm:text-xs">
          <span className="font-numeric tabular-nums">{Math.max(0, Math.round(shownHp))} / {pet.maxHp}</span>
          {pet.combo >= 2 && <span className="font-bold text-[#FFD23F]">{pet.combo} 连对</span>}
        </div>
      </motion.div>
    </div>
  );
}

/** 大招的切入画面: 暗场、速度线、立绘从出招的一侧冲进来、招式名 */
function CutIn({ fx }: { fx: BattleFx }) {
  const left = fx.attacker === 1;
  return (
    <motion.div
      className="pointer-events-none absolute inset-0 z-[8] overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 1, 1, 0] }}
      exit={{ opacity: 0 }}
      transition={{ duration: 1.5, times: [0, 0.12, 0.8, 1] }}
    >
      <div className="absolute inset-0 bg-[#0d0906]/70" />
      <motion.div
        className="absolute inset-[-25%]"
        style={{ background: `repeating-linear-gradient(${left ? -12 : 192}deg, transparent 0 30px, ${fx.color}55 31px, transparent 35px)` }}
        initial={{ x: left ? -120 : 120 }}
        animate={{ x: left ? 160 : -160 }}
        transition={{ duration: 1.5, ease: 'linear' }}
      />
      {fx.cutIn && (
        <motion.img
          src={fx.cutIn}
          alt=""
          aria-hidden="true"
          draggable={false}
          className={`absolute bottom-[4%] h-[82%] w-auto max-w-none select-none ${left ? 'left-[3%]' : 'right-[3%] -scale-x-100'}`}
          style={{ filter: `drop-shadow(0 0 26px ${fx.color}) drop-shadow(0 8px 16px rgba(0,0,0,0.55))` }}
          initial={{ opacity: 0, x: left ? -140 : 140 }}
          animate={{ opacity: [0, 1, 1, 0], x: [left ? -140 : 140, 0, left ? 14 : -14, left ? 40 : -40] }}
          transition={{ duration: 1.5, times: [0, 0.2, 0.78, 1], ease: [0.16, 1, 0.3, 1] }}
        />
      )}
      <motion.div
        className={`absolute top-[18%] max-w-[62%] ${left ? 'right-[5%] text-right' : 'left-[5%] text-left'}`}
        initial={{ opacity: 0, x: left ? 60 : -60 }}
        animate={{ opacity: [0, 1, 1, 0], x: [left ? 60 : -60, 0, 0, left ? -30 : 30] }}
        transition={{ duration: 1.5, times: [0, 0.22, 0.8, 1], ease: [0.16, 1, 0.3, 1] }}
      >
        <div
          className="font-display text-3xl font-black italic leading-tight tracking-wide text-white sm:text-5xl"
          style={{ textShadow: `0 0 22px ${fx.color}, 0 3px 0 rgba(0,0,0,0.55)` }}
        >
          {fx.skillName}
        </div>
        <div className="mt-1.5 inline-block h-1 w-24 rounded-full sm:w-36" style={{ background: fx.color }} />
      </motion.div>
    </motion.div>
  );
}

interface Popup { id: string; side: Side; damage: number; text?: string; big: boolean }

/** 起不来 3D 时的平面战场: 同一张场地图,两只宠物用网页动画演 */
function FlatScene({
  arenaUrl, my, opp, fx, active, hit, finale, calm,
}: {
  arenaUrl: string; my: StagePet; opp: StagePet; fx: BattleFx[]; active: BattleFx | null;
  hit: Record<Side, number>; finale: Props['finale']; calm: boolean;
}) {
  const pet = (side: Side) => {
    const p = side === 1 ? my : opp;
    const attacking = active?.attacker === side;
    const down = finale?.loser === side;
    const won = finale?.winner === side;
    const dir = side === 1 ? 1 : -1;
    return (
      <motion.div
        key={side}
        className={`absolute ${side === 1 ? 'bottom-[6%] left-[10%] w-[30%]' : 'bottom-[30%] right-[12%] w-[22%]'}`}
        animate={
          down ? { rotate: -dir * 72, y: '12%', opacity: 0.55 }
            : won ? { y: ['0%', '-14%', '0%', '-8%', '0%'] }
              : attacking && !calm ? { x: [`0%`, `${dir * -8}%`, `${dir * (active!.kind === 'ultimate' ? 30 : 46)}%`, '0%'] }
                : { x: '0%', y: '0%', rotate: 0, opacity: 1 }
        }
        transition={down ? { duration: 0.8 } : won ? { duration: 1.2, repeat: 2 } : { duration: 0.7, times: [0, 0.2, 0.62, 1] }}
        style={{ transformOrigin: '50% 100%' }}
      >
        <motion.img
          key={hit[side]}
          src={p.image}
          alt=""
          draggable={false}
          className="block w-full select-none drop-shadow-[0_10px_10px_rgba(0,0,0,0.35)]"
          initial={hit[side] ? { filter: 'brightness(2.6) saturate(0.4)', x: -dir * 14 } : false}
          animate={{ filter: 'brightness(1) saturate(1)', x: 0 }}
          transition={{ duration: 0.4 }}
        />
      </motion.div>
    );
  };
  return (
    <div className="absolute inset-0 overflow-hidden bg-[#0b1420]">
      <img src={arenaUrl} alt="" draggable={false} className="absolute inset-0 h-full w-full select-none object-cover" />
      {pet(2)}
      {pet(1)}
      <AnimatePresence>
        {fx.filter((f) => hit[f.target] && active?.id === f.id).map((f) => (
          <motion.div
            key={`${f.id}-${hit[f.target]}`}
            className="pointer-events-none absolute aspect-square w-[22%] rounded-full"
            style={{
              left: f.target === 1 ? '25%' : '77%', top: f.target === 1 ? '70%' : '50%',
              background: `radial-gradient(circle, #fff 0%, ${f.color} 40%, transparent 70%)`,
            }}
            initial={{ opacity: 0.95, scale: 0.2, x: '-50%', y: '-50%' }}
            animate={{ opacity: 0, scale: f.kind === 'ultimate' ? 2.6 : 1.5, x: '-50%', y: '-50%' }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

export default function BattleStage({
  arenaUrl, arenaName, my, opp, fx, finale, calm, onImpact,
}: Props) {
  const [flat, setFlat] = useState(false);
  const [ready, setReady] = useState(false);
  const [anchors, setAnchors] = useState<{ my: [number, number]; opp: [number, number] } | null>(null);
  const [popups, setPopups] = useState<Popup[]>([]);
  const [cutIn, setCutIn] = useState<BattleFx | null>(null);
  const [hitTick, setHitTick] = useState<Record<Side, number>>({ 1: 0, 2: 0 });
  const [active, setActive] = useState<BattleFx | null>(null);
  // 「3 连对!」: 连对数涨了就在我的宠物头上跳一下(名字牌上那行小字孩子注意不到)
  const [streak, setStreak] = useState<{ id: number; n: number } | null>(null);
  const comboSeen = useRef(my.combo);
  useEffect(() => {
    const grew = my.combo > comboSeen.current && my.combo >= 2;
    comboSeen.current = my.combo;
    if (!grew) return undefined;
    setStreak({ id: Date.now(), n: my.combo });
    const id = window.setTimeout(() => setStreak(null), 1300);
    return () => window.clearTimeout(id);
  }, [my.combo]);

  // 演出期间显示的血量。null = 跟着 props 走
  const [shown, setShown] = useState<Record<Side, number> | null>(null);
  const propsHp = useRef({ 1: my.hp, 2: opp.hp });
  const shownBefore = useRef({ 1: my.hp, 2: opp.hp });

  // 新一组招式到了: 血量先停在「打之前」,等打中再掉。
  // ⚠️ 依赖是 fx 这个数组本身。11-12 之前依赖的是外面传的「第几回合」—— 同一回合里先是空数组(出题)、
  // 后是招式(结算),回合号没变,这段就不重跑: 没挨打的一方血条显示成 0、招式的声音一个都不响、
  // 起不来 3D 的电脑上整场没有动作。
  useEffect(() => {
    if (!fx.length) {
      shownBefore.current = { 1: my.hp, 2: opp.hp };
      setShown(null);
      return;
    }
    const before: Record<Side, number> = { 1: propsHp.current[1], 2: propsHp.current[2] };
    // 这一回合没挨打的一方,血量直接是现在的数
    ([1, 2] as Side[]).forEach((side) => {
      if (!fx.some((f) => f.target === side)) before[side] = side === 1 ? my.hp : opp.hp;
    });
    setShown(before);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fx]);
  // 回合中间换了宠物: 血条马上跟到新的那只(上一回合演到一半的数不要了)
  useEffect(() => {
    propsHp.current = { 1: my.hp, 2: opp.hp };
    setShown(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [my.image, opp.image]);
  useEffect(() => {
    // 记下「这一回合开演之前」的血量: 下一回合的招式到时,用它当起点
    if (!fx.length) propsHp.current = { 1: my.hp, 2: opp.hp };
  }, [my.hp, opp.hp, fx.length]);

  const anchorsAt = useRef(0);
  const handleAnchors = useCallback((a: { my: [number, number]; opp: [number, number] }) => {
    // 镜头一直在缓缓漂,每帧都 setState 太费;一秒更新十几次,名字牌用 CSS 过渡补间
    const now = performance.now();
    if (now - anchorsAt.current < 70) return;
    anchorsAt.current = now;
    setAnchors(a);
  }, []);

  const impact = useCallback((f: BattleFx) => {
    setShown((prev) => ({ ...(prev ?? { 1: 0, 2: 0 }), [f.target]: f.hpAfter } as Record<Side, number>));
    setHitTick((prev) => ({ ...prev, [f.target]: prev[f.target] + 1 }));
    setPopups((prev) => [...prev, { id: `${f.id}-${Date.now()}`, side: f.target, damage: f.damage, text: f.text, big: f.kind === 'ultimate' }]);
    propsHp.current = { ...propsHp.current, [f.target]: f.hpAfter };
    onImpact?.(f);
  }, [onImpact]);

  const fxStart = useCallback((f: BattleFx) => {
    setActive(f);
    if (f.kind === 'ultimate') setCutIn(f);
  }, []);

  // 声音 + (平面版的)起手 / 打中: 都按同一条时间线排定时器
  useEffect(() => {
    if (!fx.length) {
      setActive(null);
      return undefined;
    }
    const timers: number[] = [];
    fx.forEach((f) => {
      fxCues(f).forEach((cue) => {
        timers.push(window.setTimeout(() => playBattleSfx(cue.name), (f.start + cue.at) * 1000));
      });
      if (f.ko) timers.push(window.setTimeout(() => playBattleSfx('ko'), (f.impact + 0.25) * 1000));
      if (flat) {
        timers.push(window.setTimeout(() => fxStart(f), f.start * 1000));
        timers.push(window.setTimeout(() => impact(f), f.impact * 1000));
      }
    });
    return () => timers.forEach((id) => window.clearTimeout(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fx, flat]);

  // 伤害数字 1.2 秒后收走;切入画面 1.5 秒后收走
  useEffect(() => {
    if (!popups.length) return undefined;
    const id = window.setTimeout(() => setPopups((prev) => prev.slice(1)), 1200);
    return () => window.clearTimeout(id);
  }, [popups]);
  useEffect(() => {
    if (!cutIn) return undefined;
    const id = window.setTimeout(() => setCutIn(null), 1500);
    return () => window.clearTimeout(id);
  }, [cutIn]);

  const scene = useMemo(() => ({ arenaUrl, myImage: my.image, oppImage: opp.image }), [arenaUrl, my.image, opp.image]);
  // 对战页只传了场地图的地址: 是哪块场地、场地里飘什么、叫什么名字,从地址认
  const arenaId = useMemo(() => arenaIdOf(arenaUrl), [arenaUrl]);
  const ambience = arenaId ? ARENA_AMBIENCE[arenaId] : null;
  const arenaLabel = arenaName || (arenaId ? ARENA_NAME[arenaId] : '');
  const myHp = shown ? shown[1] : my.hp;
  const oppHp = shown ? shown[2] : opp.hp;

  return (
    <div
      className="relative h-full w-full touch-pan-y overflow-hidden rounded-2xl bg-[#0b1420] shadow-[0_18px_40px_-18px_rgba(60,30,10,0.55)] ring-1 ring-black/10"
      role="img"
      aria-label={`对战场地 ${arenaLabel}。我的 ${my.name} 还有 ${Math.max(0, Math.round(myHp))} 点生命,对手的 ${opp.name} 还有 ${Math.max(0, Math.round(oppHp))} 点生命。`}
    >
      {flat ? (
        <FlatScene arenaUrl={arenaUrl} my={my} opp={opp} fx={fx} active={active} hit={hitTick} finale={finale} calm={calm} />
      ) : (
        <Suspense fallback={null}>
          <BattleScene3D
            {...scene}
            ambience={ambience}
            myGem={my.gem}
            oppGem={opp.gem}
            fx={fx}
            onImpact={impact}
            onFxStart={fxStart}
            onAnchors={handleAnchors}
            finale={finale}
            calm={calm}
            onReady={() => setReady(true)}
            onUnsupported={() => setFlat(true)}
          />
        </Suspense>
      )}

      {/* 3D 还在加载时先垫一张场地图,不留黑块 */}
      {!flat && !ready && (
        <img src={arenaUrl} alt="" draggable={false} className="absolute inset-0 h-full w-full select-none object-cover opacity-70" />
      )}

      {/* 四周压暗一点,把眼睛往中间收;大招命中时闪一下 */}
      <div className="pointer-events-none absolute inset-0 z-[3]" style={{ background: 'radial-gradient(120% 90% at 50% 45%, transparent 55%, rgba(10,6,3,0.42) 100%)' }} />
      <AnimatePresence>
        {popups.filter((p) => p.big).slice(-1).map((p) => (
          <motion.div
            key={`flash-${p.id}`}
            className="pointer-events-none absolute inset-0 z-[7] bg-white"
            initial={{ opacity: calm ? 0.25 : 0.7 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.38, ease: 'easeOut' }}
          />
        ))}
      </AnimatePresence>

      <div className="absolute inset-0 z-[5] [&>div]:transition-[left,top] [&>div]:duration-150 [&>div]:ease-linear">
        <Plate pet={opp} shownHp={oppHp} side={2} hit={hitTick[2] > 0 && active?.target === 2} />
        <Plate pet={my} shownHp={myHp} side={1} hit={hitTick[1] > 0 && active?.target === 1} />
      </div>

      <AnimatePresence>{cutIn && <CutIn key={cutIn.id} fx={cutIn} />}</AnimatePresence>

      {/* 连对 */}
      <AnimatePresence>
        {streak && (
          <motion.div
            key={streak.id}
            className="pointer-events-none absolute z-[9] whitespace-nowrap font-display text-2xl font-black italic text-[#FFD23F] sm:text-4xl"
            style={{
              left: `${((!flat && anchors ? anchors.my[0] : 0.27)) * 100}%`,
              top: `${((!flat && anchors ? anchors.my[1] : 0.4) + 0.02) * 100}%`,
              WebkitTextStroke: '1.5px #7a3d00',
              textShadow: '0 3px 0 #7a3d00, 0 6px 14px rgba(0,0,0,0.4)',
            }}
            initial={{ opacity: 0, scale: 0.3, x: '-50%', y: '0%', rotate: -8 }}
            animate={{ opacity: [0, 1, 1, 0], scale: [0.3, 1.25, 1, 1], y: ['0%', '-60%', '-80%', '-120%'], x: '-50%', rotate: [-8, 3, 0, 0] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.25, times: [0, 0.18, 0.75, 1], ease: [0.16, 1, 0.3, 1] }}
          >
            {streak.n} 连对!
          </motion.div>
        )}
      </AnimatePresence>

      {/* 伤害数字: 从挨打的宠物身上弹出来 */}
      <AnimatePresence>
        {popups.map((p) => {
          const pos = (!flat && anchors ? (p.side === 1 ? anchors.my : anchors.opp) : null) ?? (p.side === 1 ? [0.27, 0.5] : [0.74, 0.3]);
          return (
            <motion.div
              key={p.id}
              className="pointer-events-none absolute z-[9] text-center"
              style={{ left: `${pos[0] * 100}%`, top: `${(pos[1] + 0.2) * 100}%` }}
              initial={{ opacity: 0, scale: 0.4, x: '-50%', y: '-50%' }}
              animate={{ opacity: [0, 1, 1, 0], scale: [0.4, p.big ? 1.5 : 1.2, p.big ? 1.3 : 1.05, 1], y: ['-50%', '-95%', '-125%', '-165%'], x: '-50%' }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.15, times: [0, 0.16, 0.7, 1], ease: [0.16, 1, 0.3, 1] }}
            >
              <div
                className={`font-display font-black leading-none text-white ${p.big ? 'text-5xl sm:text-7xl' : 'text-3xl sm:text-5xl'}`}
                style={{ WebkitTextStroke: '2px #7a1f0c', textShadow: '0 4px 0 #7a1f0c, 0 8px 18px rgba(0,0,0,0.45)' }}
              >
                -{p.damage}
              </div>
              {p.text && (
                <div className="mt-1 inline-block whitespace-nowrap rounded-full bg-[#1b1410]/85 px-2.5 py-0.5 text-[11px] font-bold text-[#FFD23F] sm:text-sm">
                  {p.text}
                </div>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>

      {arenaLabel && (
        <div className="pointer-events-none absolute bottom-2 right-3 z-[4] rounded-full bg-black/35 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white/75 sm:text-xs">
          {arenaLabel}
        </div>
      )}
    </div>
  );
}
