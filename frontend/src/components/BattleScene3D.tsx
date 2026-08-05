import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, useTexture } from '@react-three/drei';
import * as THREE from 'three';
import { useRef, useState, useEffect, useMemo, Suspense, type CSSProperties } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  getPetDefinition,
  getSkillVfxRecipe,
  PARTICLE_IMAGE,
  type PetElement,
  type SkillVfxRecipe,
} from '../config/petSpecies';

type BattleVisualEffect = {
  id: string;
  attacker: 1 | 2;
  target: 1 | 2;
  damage: number;
  species: string;
  typeText?: string;
  ultimate?: {
    species: string;
    name: string;
    cutInImage?: string;
  };
};

// ==============================
// 大招演出时间轴(秒)——cut-in → 骨架特效 → 命中
// 伤害数字/白闪/震屏都对齐 IMPACT_AT,改节奏只动这里
// ==============================
const CUTIN_DURATION = 0.85;
const SKELETON_AT = 0.8;
const IMPACT_AT = 1.35;

const ELEMENT_VFX: Record<PetElement, { color: string; mode: 'strike' | 'burst' | 'projectile' }> = {
  normal: { color: '#f9a8d4', mode: 'burst' },
  fire: { color: '#fb923c', mode: 'projectile' },
  water: { color: '#22d3ee', mode: 'burst' },
  grass: { color: '#84cc16', mode: 'burst' },
  electric: { color: '#38bdf8', mode: 'strike' },
  ice: { color: '#a5f3fc', mode: 'burst' },
  fighting: { color: '#ef4444', mode: 'projectile' },
  poison: { color: '#c084fc', mode: 'burst' },
  ground: { color: '#d97706', mode: 'projectile' },
  flying: { color: '#bae6fd', mode: 'burst' },
  psychic: { color: '#e879f9', mode: 'burst' },
  bug: { color: '#a3e635', mode: 'projectile' },
  rock: { color: '#a16207', mode: 'projectile' },
  ghost: { color: '#a78bfa', mode: 'burst' },
  dragon: { color: '#818cf8', mode: 'projectile' },
  dark: { color: '#64748b', mode: 'burst' },
  steel: { color: '#cbd5e1', mode: 'strike' },
  fairy: { color: '#f9a8d4', mode: 'burst' },
};

function getAttackVfx(species: string) {
  const definition = getPetDefinition(species);
  return ELEMENT_VFX[definition.element];
}

// ==============================
// 3D 宠物 Sprite - PNG 立绘做成永远面向相机的广告牌(宝可梦经典风格)
// ==============================
function PetSprite({
  imageUrl,
  position,
  scale = 1,
  isHit = false,
  hp,
  maxHp,
  isGem = false,
  isBackFacingFallback = false,
}: {
  imageUrl: string;
  position: [number, number, number];
  scale?: number;
  isHit?: boolean;
  hp: number;
  maxHp: number;
  isGem?: boolean;
  isBackFacingFallback?: boolean;
}) {
  const texture = useTexture(imageUrl);
  const displayTexture = useMemo(() => {
    if (!isBackFacingFallback) return texture;
    const image = texture.image as HTMLImageElement;
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width || 256;
    canvas.height = image.naturalHeight || image.height || 256;
    const context = canvas.getContext('2d');
    if (!context) return texture;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    context.globalCompositeOperation = 'source-in';
    context.fillStyle = '#475569';
    context.fillRect(0, 0, canvas.width, canvas.height);
    return new THREE.CanvasTexture(canvas);
  }, [isBackFacingFallback, texture]);
  const groupRef = useRef<THREE.Group>(null);
  const spriteRef = useRef<THREE.Sprite>(null);
  const gemAuraRef = useRef<THREE.Mesh>(null);
  const [entranceDone, setEntranceDone] = useState(false);

  useEffect(() => {
    displayTexture.magFilter = THREE.NearestFilter;
    displayTexture.minFilter = THREE.NearestFilter;
    displayTexture.colorSpace = THREE.SRGBColorSpace;
    displayTexture.needsUpdate = true;
    return () => {
      if (displayTexture !== texture) displayTexture.dispose();
    };
  }, [displayTexture, texture]);

  // 入场动画完成标记
  useEffect(() => {
    const t = setTimeout(() => setEntranceDone(true), 900);
    return () => clearTimeout(t);
  }, []);

  // 悬浮呼吸 + 受击抖动 + 入场缩放
  useFrame((state, delta) => {
    const g = groupRef.current;
    const s = spriteRef.current;
    if (!g || !s) return;
    if (gemAuraRef.current) {
      gemAuraRef.current.rotation.z = state.clock.elapsedTime * 0.7;
      const pulse = 1 + Math.sin(state.clock.elapsedTime * 2.4) * 0.08;
      gemAuraRef.current.scale.setScalar(pulse);
    }

    // 入场:从 0 缩放弹出
    const targetScale = scale * 2.6;
    const cur = s.scale.x;
    if (!entranceDone && cur < targetScale) {
      const next = Math.min(targetScale, cur + delta * targetScale * 3);
      s.scale.set(next, next, 1);
    } else {
      s.scale.set(targetScale, targetScale, 1);
    }

    if (isHit) {
      // 受击:快速左右抖动
      g.position.x = position[0] + Math.sin(state.clock.elapsedTime * 60) * 0.12;
      g.position.y = position[1];
    } else {
      // 待机:上下漂浮呼吸
      g.position.x = position[0];
      g.position.y = position[1] + Math.sin(state.clock.elapsedTime * 1.4 + position[0]) * 0.12;
    }
  });

  const hpPercent = Math.max(0, hp / maxHp);
  const hpColor = hpPercent > 0.5 ? '#4ade80' : hpPercent > 0.2 ? '#fbbf24' : '#ef4444';
  const barW = 1.7;

  return (
    <group ref={groupRef} position={position}>
      {/* 宠物立绘 Sprite(永远面向相机) */}
      <sprite ref={spriteRef} scale={[0.01, 0.01, 1]} position={[0, 0.3, 0]}>
        <spriteMaterial
          map={displayTexture}
          transparent
          alphaTest={0.05}
          color={isHit
            ? new THREE.Color(2.5, 0.6, 0.6)
            : new THREE.Color(1, 1, 1)}
        />
      </sprite>

      {isGem && (
        <>
          <mesh ref={gemAuraRef} position={[0, 0.3, -0.08]}>
            <torusGeometry args={[scale * 1.55, 0.07, 12, 6]} />
            <meshBasicMaterial color="#67e8f9" transparent opacity={0.78} blending={THREE.AdditiveBlending} />
          </mesh>
          <pointLight position={[0, 0.5, 1]} color="#22d3ee" intensity={2.1} distance={5} />
        </>
      )}

      {/* 椭圆地面投影 */}
      <mesh position={[0, -1.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[scale * 0.95, 32]} />
        <meshBasicMaterial color="#14532d" transparent opacity={0.35} />
      </mesh>

      {/* 3D HP 条 */}
      <group position={[0, scale * 1.75 + 0.15, 0]}>
        <mesh>
          <planeGeometry args={[barW + 0.08, 0.24]} />
          <meshBasicMaterial color="#1f2937" transparent opacity={0.85} />
        </mesh>
        <mesh position={[(-barW / 2) * (1 - hpPercent), 0, 0.01]}>
          <planeGeometry args={[Math.max(0.02, barW * hpPercent), 0.16]} />
          <meshBasicMaterial color={hpColor} />
        </mesh>
      </group>
    </group>
  );
}

// ==============================
// 宝可梦风格战场:草地圆台 + 对战白圈 + 天空
// ==============================
function BattleArena() {
  return (
    <group>
      {/* 大草地 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.12, 0]} receiveShadow>
        <circleGeometry args={[14, 48]} />
        <meshStandardMaterial color="#5cb85c" />
      </mesh>

      {/* 深绿草地渐变圈 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.11, 0]}>
        <ringGeometry args={[8, 14, 48]} />
        <meshStandardMaterial color="#3d8b3d" />
      </mesh>

      {/* 对战场白色外圈(宝可梦竞技场经典标线) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.09, 0]}>
        <ringGeometry args={[6.1, 6.35, 64]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.85} />
      </mesh>

      {/* 中线 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.09, 0]}>
        <planeGeometry args={[0.22, 12.4]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.6} />
      </mesh>

      {/* 中央圆圈 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.09, 0]}>
        <ringGeometry args={[1.4, 1.62, 48]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.7} />
      </mesh>

      {/* 我方站位圈(左前) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-2.6, -1.08, 2.2]}>
        <ringGeometry args={[1.5, 1.7, 48]} />
        <meshBasicMaterial color="#3b82f6" transparent opacity={0.55} />
      </mesh>

      {/* 对方站位圈(右后) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[2.6, -1.08, -2.2]}>
        <ringGeometry args={[1.2, 1.38, 48]} />
        <meshBasicMaterial color="#ef4444" transparent opacity={0.55} />
      </mesh>

      {/* 远处装饰树(低多边形圆锥) */}
      {[[-9, -6], [9, -5], [-7, -9], [7.5, -8.5], [0, -10.5]].map(([x, z], i) => (
        <group key={i} position={[x, -1.1, z]}>
          <mesh position={[0, 1.1, 0]} castShadow>
            <coneGeometry args={[0.9, 2.2, 8]} />
            <meshStandardMaterial color="#2d7a2d" />
          </mesh>
          <mesh position={[0, 0.2, 0]}>
            <cylinderGeometry args={[0.16, 0.2, 0.5, 8]} />
            <meshStandardMaterial color="#8b5a2b" />
          </mesh>
        </group>
      ))}

      {/* 漂浮云朵(白色扁球) */}
      {[[-6, 4.5, -8], [5, 5.2, -9], [0, 6, -11]].map(([x, y, z], i) => (
        <group key={`c${i}`} position={[x, y, z]}>
          <mesh>
            <sphereGeometry args={[1.1, 16, 12]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.92} />
          </mesh>
          <mesh position={[0.9, -0.15, 0]}>
            <sphereGeometry args={[0.75, 16, 12]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.92} />
          </mesh>
          <mesh position={[-0.9, -0.2, 0]}>
            <sphereGeometry args={[0.7, 16, 12]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={0.92} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function AdaptiveCamera() {
  const { camera, size } = useThree();

  useEffect(() => {
    const perspective = camera as THREE.PerspectiveCamera;
    const compact = size.width < 640;
    perspective.position.set(0, compact ? 2.25 : 2.6, compact ? 10.6 : 8.5);
    perspective.fov = compact ? 50 : 46;
    perspective.lookAt(0, 0.15, 0);
    perspective.updateProjectionMatrix();
  }, [camera, size.width]);

  return null;
}

function BattleActors({
  myPetImage,
  opponentPetImage,
  myHp,
  myMaxHp,
  opponentHp,
  opponentMaxHp,
  hitPlayers,
  myPetIsGem,
  opponentPetIsGem,
  myPetUsesBackFallback,
}: {
  myPetImage: string;
  opponentPetImage: string;
  myHp: number;
  myMaxHp: number;
  opponentHp: number;
  opponentMaxHp: number;
  hitPlayers: Set<1 | 2>;
  myPetIsGem: boolean;
  opponentPetIsGem: boolean;
  myPetUsesBackFallback: boolean;
}) {
  const compact = useThree((state) => state.size.width < 640);

  return (
    <Suspense fallback={null}>
      <PetSprite
        imageUrl={myPetImage}
        position={compact ? [-2.05, -0.05, 1.7] : [-2.6, 0, 2.2]}
        scale={compact ? 1.02 : 1.25}
        isHit={hitPlayers.has(1)}
        hp={myHp}
        maxHp={myMaxHp}
        isGem={myPetIsGem}
        isBackFacingFallback={myPetUsesBackFallback}
      />
      <PetSprite
        imageUrl={opponentPetImage}
        position={compact ? [2.05, 0.05, -1.7] : [2.6, 0.1, -2.2]}
        scale={compact ? 0.84 : 0.95}
        isHit={hitPlayers.has(2)}
        hp={opponentHp}
        maxHp={opponentMaxHp}
        isGem={opponentPetIsGem}
      />
    </Suspense>
  );
}

// ==============================
// 大招演出:cut-in(暗转+立绘切入+技能名横幅)→ 属性骨架特效 → 命中(白闪+震屏)
// 骨架全部纯代码绘制,配方在 petSpecies.getSkillVfxRecipe,一只宠物一行
// ==============================

// 战场锚点(容器百分比坐标,与 3D 场景宠物站位对齐)
const ANCHOR_LEFT = { x: 27, y: 62 };
const ANCHOR_RIGHT = { x: 73, y: 37 };
const anchorOf = (side: 1 | 2) => (side === 1 ? ANCHOR_LEFT : ANCHOR_RIGHT);

type SkeletonProps = { attacker: 1 | 2; target: 1 | 2; recipe: SkillVfxRecipe };

// 命中爆点:中心闪光 + 双扩散环 + 12 向粒子,所有骨架共用
// particle 有配就迸散实物贴图(火舌/水滴/电花…,黑底走 screen 混合),否则纯色圆点
function ImpactBurst({ x, y, color, core, delay, big = false, particle }: {
  x: number; y: number; color: string; core: string; delay: number; big?: boolean;
  particle?: keyof typeof PARTICLE_IMAGE;
}) {
  const particleSrc = particle ? PARTICLE_IMAGE[particle] : null;
  return (
    <div className="pointer-events-none absolute z-[8]" style={{ left: `${x}%`, top: `${y}%` }}>
      <motion.div
        className={`absolute left-1/2 top-1/2 aspect-square rounded-full ${big ? 'w-24 sm:w-40' : 'w-14 sm:w-24'}`}
        style={{
          background: `radial-gradient(circle, ${core} 0%, ${color} 45%, transparent 72%)`,
          boxShadow: `0 0 42px 14px ${color}`,
        }}
        initial={{ opacity: 0, scale: 0.15, x: '-50%', y: '-50%' }}
        animate={{ opacity: [0, 1, 0], scale: [0.15, 1.25, 1.75], x: '-50%', y: '-50%' }}
        transition={{ delay, duration: 0.5, ease: 'easeOut' }}
      />
      {[0, 0.09].map((extra, i) => (
        <motion.div
          key={i}
          className="absolute left-1/2 top-1/2 aspect-square w-20 rounded-full border-4 sm:w-32"
          style={{ borderColor: i === 0 ? core : color, boxShadow: `0 0 26px ${color}` }}
          initial={{ opacity: 0, scale: 0.15, x: '-50%', y: '-50%' }}
          animate={{ opacity: [0, 0.95, 0], scale: [0.15, 1.6 + i * 0.7, 2.4 + i * 0.9], x: '-50%', y: '-50%' }}
          transition={{ delay: delay + extra, duration: 0.62, ease: 'easeOut' }}
        />
      ))}
      {Array.from({ length: 12 }).map((_, index) => {
        const angle = (Math.PI * 2 * index) / 12;
        const dist = (index % 2 ? 62 : 92) * (big ? 1.25 : 1);
        const spin = (index % 2 ? 1 : -1) * (110 + index * 24);
        return particleSrc ? (
          <motion.img
            key={index}
            src={particleSrc}
            alt=""
            aria-hidden="true"
            className={`absolute left-1/2 top-1/2 select-none mix-blend-screen ${
              big ? 'w-14 sm:w-20' : 'w-10 sm:w-14'
            }`}
            initial={{ opacity: 0, x: '-50%', y: '-50%', scale: 0.25, rotate: 0 }}
            animate={{
              opacity: [0, 1, 0],
              x: ['-50%', `calc(-50% + ${Math.cos(angle) * dist}px)`],
              y: ['-50%', `calc(-50% + ${Math.sin(angle) * dist}px)`],
              scale: [0.25, 1, 0.55],
              rotate: [0, spin],
            }}
            transition={{ delay, duration: 0.72, ease: 'easeOut' }}
          />
        ) : (
          <motion.span
            key={index}
            className="absolute left-1/2 top-1/2 h-2 w-2 rounded-full sm:h-3 sm:w-3"
            style={{ backgroundColor: index % 3 ? color : core, boxShadow: `0 0 10px ${color}` }}
            initial={{ opacity: 0, x: 0, y: 0, scale: 0.2 }}
            animate={{
              opacity: [0, 1, 0],
              x: [0, Math.cos(angle) * dist],
              y: [0, Math.sin(angle) * dist],
              scale: [0.2, 1, 0.2],
            }}
            transition={{ delay, duration: 0.66, ease: 'easeOut' }}
          />
        );
      })}
    </div>
  );
}

// beam 光束:嘴边聚气 → 三层光柱(外辉/中层/白芯)射向目标
function BeamFx({ attacker, target, recipe }: SkeletonProps) {
  const a = anchorOf(attacker);
  const t = anchorOf(target);
  const core = recipe.core || '#ffffff';
  return (
    <>
      <motion.div
        className="pointer-events-none absolute z-[7] aspect-square w-10 rounded-full sm:w-16"
        style={{
          left: `${a.x}%`,
          top: `${a.y - 6}%`,
          background: `radial-gradient(circle, ${core} 0%, ${recipe.color} 55%, transparent 78%)`,
          boxShadow: `0 0 24px ${recipe.color}`,
        }}
        initial={{ opacity: 0, scale: 0.2, x: '-50%', y: '-50%' }}
        animate={{ opacity: [0, 1, 1, 0], scale: [0.2, 1.15, 0.9, 1.4], x: '-50%', y: '-50%' }}
        transition={{ delay: SKELETON_AT, duration: IMPACT_AT - SKELETON_AT + 0.3, times: [0, 0.35, 0.75, 1] }}
      />
      <svg
        className="pointer-events-none absolute inset-0 z-[7] h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        {[
          { w: 22, c: recipe.color, o: 0.4 },
          { w: 12, c: recipe.color, o: 0.85 },
          { w: 5, c: core, o: 1 },
        ].map((layer, i) => (
          <motion.line
            key={i}
            x1={a.x}
            y1={a.y - 6}
            x2={t.x}
            y2={t.y}
            stroke={layer.c}
            strokeOpacity={layer.o}
            strokeWidth={layer.w}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: [0, 1, 1, 1], opacity: [0, 1, 1, 0] }}
            transition={{
              delay: SKELETON_AT + 0.16,
              duration: IMPACT_AT - SKELETON_AT + 0.15,
              times: [0, 0.22, 0.8, 1],
            }}
          />
        ))}
      </svg>
      {/* 束流沿途的粒子:让光柱里跑着实物元素(火舌/水花/电花) */}
      {recipe.particle && Array.from({ length: 5 }).map((_, i) => {
        const p = 0.24 + i * 0.19;
        return (
          <motion.img
            key={i}
            src={PARTICLE_IMAGE[recipe.particle!]}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute z-[8] w-9 select-none mix-blend-screen sm:w-14"
            style={{ left: `${a.x + (t.x - a.x) * p}%`, top: `${(a.y - 6) + (t.y - (a.y - 6)) * p}%` }}
            initial={{ opacity: 0, scale: 0.3, x: '-50%', y: '-50%', rotate: i * 40 }}
            animate={{ opacity: [0, 1, 0], scale: [0.3, 1.05, 0.6], x: '-50%', y: '-50%', rotate: i * 40 + 120 }}
            transition={{ delay: SKELETON_AT + 0.2 + i * 0.05, duration: 0.55, ease: 'easeOut' }}
          />
        );
      })}
      <ImpactBurst x={t.x} y={t.y} color={recipe.color} core={core} delay={IMPACT_AT} big particle={recipe.particle} />
    </>
  );
}

// pillar 天雷/地涌:垂直光柱两段闪烁 + 两道错位副柱
function PillarFx({ target, recipe }: SkeletonProps) {
  const t = anchorOf(target);
  const core = recipe.core || '#ffffff';
  const fromGround = recipe.from === 'ground';
  const columnStyle: CSSProperties = fromGround
    ? { top: `${t.y}%`, height: `${100 - t.y}%`, transformOrigin: 'bottom' }
    : { top: 0, height: `${t.y + 3}%`, transformOrigin: 'top' };
  return (
    <>
      <motion.div
        className="pointer-events-none absolute z-[7] w-7 sm:w-12"
        style={{
          left: `${t.x}%`,
          ...columnStyle,
          background: `linear-gradient(to right, transparent, ${recipe.color} 22%, ${core} 50%, ${recipe.color} 78%, transparent)`,
          boxShadow: `0 0 34px 6px ${recipe.color}`,
        }}
        initial={{ opacity: 0, scaleY: 0, x: '-50%' }}
        animate={{ opacity: [0, 1, 0.35, 1, 0.9, 0], scaleY: [0, 1, 1, 1, 1, 1], x: '-50%' }}
        transition={{ delay: SKELETON_AT + 0.25, duration: 0.75, times: [0, 0.14, 0.3, 0.45, 0.8, 1] }}
      />
      {[-1, 1].map((dir) => (
        <motion.div
          key={dir}
          className="pointer-events-none absolute z-[6] w-2.5 sm:w-4"
          style={{
            left: `${t.x + dir * 4}%`,
            ...columnStyle,
            background: `linear-gradient(to right, transparent, ${recipe.color}, transparent)`,
            filter: 'blur(1px)',
          }}
          initial={{ opacity: 0, scaleY: 0, x: '-50%' }}
          animate={{ opacity: [0, 0.9, 0], scaleY: [0, 1, 1], x: '-50%' }}
          transition={{ delay: SKELETON_AT + 0.36, duration: 0.5 }}
        />
      ))}
      <ImpactBurst x={t.x} y={t.y} color={recipe.color} core={core} delay={IMPACT_AT} big particle={recipe.particle} />
    </>
  );
}

// slash 斩击:三道交错刀光 + 残光
function SlashFx({ target, recipe }: SkeletonProps) {
  const t = anchorOf(target);
  const core = recipe.core || '#ffffff';
  const slashes = [
    { angle: -36, stagger: 0 },
    { angle: 28, stagger: 0.12 },
    { angle: -78, stagger: 0.24 },
  ];
  return (
    <>
      <div className="pointer-events-none absolute z-[7]" style={{ left: `${t.x}%`, top: `${t.y}%` }}>
        {slashes.map((slash, i) => (
          <motion.div
            key={i}
            className="absolute left-1/2 top-1/2 h-2 w-44 rounded-full sm:h-3 sm:w-72"
            style={{
              rotate: `${slash.angle}deg`,
              background: `linear-gradient(90deg, transparent, ${core} 35%, ${recipe.color} 65%, transparent)`,
              boxShadow: `0 0 18px ${recipe.color}`,
            }}
            initial={{ opacity: 0, scaleX: 0.1, x: '-50%', y: '-50%' }}
            animate={{ opacity: [0, 1, 1, 0], scaleX: [0.1, 1.15, 1, 1.05], x: '-50%', y: '-50%' }}
            transition={{ delay: SKELETON_AT + 0.18 + slash.stagger, duration: 0.4, times: [0, 0.3, 0.75, 1] }}
          />
        ))}
      </div>
      <ImpactBurst x={t.x} y={t.y} color={recipe.color} core={core} delay={IMPACT_AT} particle={recipe.particle} />
    </>
  );
}

// aura 蓄力爆发:施法者聚气 → 全屏色浪压向目标
function AuraFx({ attacker, target, recipe }: SkeletonProps) {
  const a = anchorOf(attacker);
  const t = anchorOf(target);
  const core = recipe.core || '#ffffff';
  return (
    <>
      <motion.div
        className="pointer-events-none absolute z-[7] aspect-square w-28 rounded-full sm:w-44"
        style={{
          left: `${a.x}%`,
          top: `${a.y}%`,
          background: `radial-gradient(circle, ${core} 0%, ${recipe.color} 40%, transparent 70%)`,
        }}
        initial={{ opacity: 0, scale: 0.3, x: '-50%', y: '-50%' }}
        animate={{ opacity: [0, 0.9, 0.7, 0], scale: [0.3, 1.1, 1.35, 1.7], x: '-50%', y: '-50%' }}
        transition={{ delay: SKELETON_AT, duration: 0.55 }}
      />
      <motion.div
        className="pointer-events-none absolute inset-0 z-[6]"
        style={{ background: `radial-gradient(circle at ${t.x}% ${t.y}%, ${recipe.color} 0%, transparent 55%)` }}
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0.5, 0] }}
        transition={{ delay: IMPACT_AT - 0.12, duration: 0.5 }}
      />
      {Array.from({ length: 8 }).map((_, index) => (
        <motion.span
          key={index}
          className="pointer-events-none absolute z-[8] h-2 w-2 rounded-full sm:h-3 sm:w-3"
          style={{
            left: `${t.x + (index - 3.5) * 3.2}%`,
            top: `${t.y + 8}%`,
            backgroundColor: index % 3 ? recipe.color : core,
            boxShadow: `0 0 12px ${recipe.color}`,
          }}
          initial={{ opacity: 0, y: 0, scale: 0.3 }}
          animate={{ opacity: [0, 1, 0], y: [0, -(46 + (index % 3) * 26)], scale: [0.3, 1, 0.3] }}
          transition={{ delay: IMPACT_AT + index * 0.03, duration: 0.7, ease: 'easeOut' }}
        />
      ))}
      <ImpactBurst x={t.x} y={t.y} color={recipe.color} core={core} delay={IMPACT_AT} big particle={recipe.particle} />
    </>
  );
}

// projectile 弹道:能量球抛物线飞向目标
function ProjectileFx({ attacker, target, recipe }: SkeletonProps) {
  const a = anchorOf(attacker);
  const t = anchorOf(target);
  const core = recipe.core || '#ffffff';
  return (
    <>
      <motion.div
        className="pointer-events-none absolute z-[7] aspect-square w-8 rounded-full sm:w-14"
        style={{
          background: `radial-gradient(circle, ${core} 0%, ${recipe.color} 50%, transparent 76%)`,
          boxShadow: `0 0 24px 9px ${recipe.color}`,
        }}
        initial={{ left: `${a.x}%`, top: `${a.y - 5}%`, opacity: 0, scale: 0.3, x: '-50%', y: '-50%' }}
        animate={{
          left: [`${a.x}%`, `${a.x}%`, `${t.x}%`],
          top: [`${a.y - 5}%`, `${a.y - 10}%`, `${t.y}%`],
          opacity: [0, 1, 1],
          scale: [0.3, 1.35, 1],
          x: '-50%',
          y: '-50%',
        }}
        transition={{
          delay: SKELETON_AT + 0.08,
          duration: IMPACT_AT - SKELETON_AT - 0.08,
          times: [0, 0.4, 1],
          ease: [0.5, 0, 0.85, 0.5],
        }}
      />

      {/* 弹头贴图:让飞行中的弹体也有实物质感(黑底走 screen) */}
      {recipe.particle && (
        <motion.img
          src={PARTICLE_IMAGE[recipe.particle]}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute z-[8] w-12 select-none mix-blend-screen sm:w-20"
          initial={{ left: `${a.x}%`, top: `${a.y - 5}%`, opacity: 0, scale: 0.4, rotate: 0, x: '-50%', y: '-50%' }}
          animate={{
            left: [`${a.x}%`, `${a.x}%`, `${t.x}%`],
            top: [`${a.y - 5}%`, `${a.y - 10}%`, `${t.y}%`],
            opacity: [0, 1, 1],
            scale: [0.4, 1.1, 0.95],
            rotate: [0, 190],
            x: '-50%',
            y: '-50%',
          }}
          transition={{
            delay: SKELETON_AT + 0.08,
            duration: IMPACT_AT - SKELETON_AT - 0.08,
            times: [0, 0.4, 1],
            ease: [0.5, 0, 0.85, 0.5],
          }}
        />
      )}
      <ImpactBurst x={t.x} y={t.y} color={recipe.color} core={core} delay={IMPACT_AT} big particle={recipe.particle} />
    </>
  );
}

// burst 爆发:目标脚下预兆光圈收缩 → 大爆炸
function BurstFx({ target, recipe }: SkeletonProps) {
  const t = anchorOf(target);
  const core = recipe.core || '#ffffff';
  return (
    <>
      <motion.div
        className="pointer-events-none absolute z-[6] aspect-square w-24 rounded-full border-4 sm:w-40"
        style={{ left: `${t.x}%`, top: `${t.y}%`, borderColor: recipe.color, boxShadow: `0 0 22px ${recipe.color}` }}
        initial={{ opacity: 0, scale: 1.7, x: '-50%', y: '-50%' }}
        animate={{ opacity: [0, 0.9, 0.9], scale: [1.7, 0.5, 0.3], x: '-50%', y: '-50%' }}
        transition={{ delay: SKELETON_AT + 0.12, duration: IMPACT_AT - SKELETON_AT - 0.15, ease: 'easeIn' }}
      />
      <ImpactBurst x={t.x} y={t.y} color={recipe.color} core={core} delay={IMPACT_AT - 0.05} big particle={recipe.particle} />
    </>
  );
}

// cut-in:暗转 + 速度线 + 施法宠物立绘切入 + 技能名横幅
function CutIn({ effect, recipe }: { effect: BattleVisualEffect; recipe: SkillVfxRecipe }) {
  const attackerLeft = effect.attacker === 1;
  const ultimate = effect.ultimate!;
  const image = ultimate.cutInImage || getPetDefinition(ultimate.species).ultimate.image;
  return (
    <>
      <motion.div
        className="pointer-events-none absolute inset-0 z-[10] bg-slate-950"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0.74, 0.74, 0] }}
        transition={{ duration: CUTIN_DURATION + 0.2, times: [0, 0.16, 0.82, 1] }}
      />
      <motion.div
        className="pointer-events-none absolute inset-[-20%] z-[10]"
        style={{
          background: `repeating-linear-gradient(${attackerLeft ? -14 : 194}deg, transparent 0px, transparent 26px, rgba(255,255,255,0.35) 28px, transparent 32px)`,
        }}
        initial={{ opacity: 0, x: attackerLeft ? -80 : 80 }}
        animate={{ opacity: [0, 0.55, 0.55, 0], x: attackerLeft ? [-80, 130] : [80, -130] }}
        transition={{ duration: CUTIN_DURATION, ease: 'linear' }}
      />
      <motion.img
        src={image}
        alt=""
        aria-hidden="true"
        className={`pointer-events-none absolute bottom-[12%] z-[11] h-[64%] w-auto max-w-none select-none ${
          attackerLeft ? 'left-[4%]' : 'right-[4%]'
        }`}
        style={{ filter: `drop-shadow(0 0 28px ${recipe.color}) drop-shadow(0 6px 14px rgba(0,0,0,0.5))` }}
        initial={{ opacity: 0, scale: 0.7, x: attackerLeft ? -90 : 90 }}
        animate={{ opacity: [0, 1, 1, 0], scale: [0.7, 1.06, 1, 0.96], x: [attackerLeft ? -90 : 90, 0, 0, attackerLeft ? -30 : 30] }}
        transition={{ duration: CUTIN_DURATION + 0.15, times: [0, 0.25, 0.8, 1], ease: [0.16, 1, 0.3, 1] }}
      />
      <div className="pointer-events-none absolute inset-x-0 top-[34%] z-[12]" style={{ transform: 'rotate(-5deg)' }}>
        <motion.div
          className="w-full overflow-hidden py-1.5 text-center sm:py-2.5"
          style={{
            background: 'linear-gradient(90deg, transparent, rgba(2,6,23,0.88) 18%, rgba(2,6,23,0.88) 82%, transparent)',
            borderTop: `2px solid ${recipe.color}`,
            borderBottom: `2px solid ${recipe.color}`,
          }}
          initial={{ x: attackerLeft ? '-110%' : '110%' }}
          animate={{ x: [attackerLeft ? '-110%' : '110%', '0%', '0%', attackerLeft ? '110%' : '-110%'] }}
          transition={{ duration: CUTIN_DURATION + 0.15, times: [0, 0.22, 0.8, 1], ease: [0.16, 1, 0.3, 1] }}
        >
          <span
            className="font-display text-2xl font-black italic tracking-widest text-white sm:text-4xl"
            style={{ textShadow: `0 0 18px ${recipe.color}, 0 0 36px ${recipe.color}, 0 3px 6px rgba(0,0,0,0.8)` }}
          >
            {ultimate.name}
          </span>
        </motion.div>
      </div>
    </>
  );
}

function UltimateOverlay({ effect }: { effect: BattleVisualEffect }) {
  if (!effect.ultimate) return null;

  const recipe = getSkillVfxRecipe(effect.ultimate.species);
  const skeletonProps: SkeletonProps = { attacker: effect.attacker, target: effect.target, recipe };

  return (
    <>
      <CutIn effect={effect} recipe={recipe} />
      {recipe.skeleton === 'beam' && <BeamFx {...skeletonProps} />}
      {recipe.skeleton === 'pillar' && <PillarFx {...skeletonProps} />}
      {recipe.skeleton === 'slash' && <SlashFx {...skeletonProps} />}
      {recipe.skeleton === 'aura' && <AuraFx {...skeletonProps} />}
      {recipe.skeleton === 'projectile' && <ProjectileFx {...skeletonProps} />}
      {recipe.skeleton === 'burst' && <BurstFx {...skeletonProps} />}

      {/* 命中白闪:短促强闪,配合震屏做出顿帧打击感 */}
      <motion.div
        className="pointer-events-none absolute inset-0 z-[9] bg-white mix-blend-screen"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0.9, 0] }}
        transition={{ delay: IMPACT_AT, duration: 0.26, times: [0, 0.25, 1] }}
      />
    </>
  );
}

function NormalAttackEffectOverlay({ effect }: { effect: BattleVisualEffect }) {
  if (effect.ultimate) return null;

  const attack = getAttackVfx(effect.species);
  const startsLeft = effect.attacker === 1;
  const targetLeft = effect.target === 1;
  const start = startsLeft ? '27%' : '73%';
  const target = targetLeft ? '27%' : '73%';
  const startTop = startsLeft ? '64%' : '36%';
  const targetTop = targetLeft ? '64%' : '36%';
  const isStrike = attack.mode === 'strike';

  return (
    <div className="pointer-events-none absolute inset-0 z-[7] overflow-hidden">
      <motion.div
        className="absolute h-4 w-4 rounded-full sm:h-6 sm:w-6"
        style={{
          background: `radial-gradient(circle, #fff 0%, ${attack.color} 44%, transparent 72%)`,
          boxShadow: `0 0 12px 5px ${attack.color}, 0 0 30px 8px ${attack.color}`,
          transform: 'translate(-50%, -50%)',
        }}
        initial={{ left: start, top: startTop, opacity: 0, scale: 0.3 }}
        animate={{
          left: [start, start, target],
          top: [startTop, startTop, targetTop],
          opacity: [0, 1, 1, 0],
          scale: [0.3, 1.25, 0.9, 0.2],
        }}
        transition={{ duration: 0.66, times: [0, 0.16, 0.78, 1], ease: [0.3, 0, 0.15, 1] }}
      >
        <motion.div
          className="absolute left-1/2 top-1/2 h-2 w-20 rounded-full sm:w-28"
          style={{
            background: `linear-gradient(${startsLeft ? 90 : 270}deg, ${attack.color}, transparent)`,
            transform: `translate(${startsLeft ? '-100%' : '0'}, -50%)`,
            filter: 'blur(2px)',
          }}
          animate={{ opacity: [0, 0.9, 0] }}
          transition={{ duration: 0.66 }}
        />
      </motion.div>

      <div
        className="absolute"
        style={{ left: target, top: targetTop, transform: 'translate(-50%, -50%)' }}
      >
        {isStrike && (
          <motion.div
            className="absolute left-1/2 top-1/2 h-24 w-3 rounded-full sm:h-32 sm:w-4"
            style={{
              background: `linear-gradient(to bottom, transparent, #fff 35%, ${attack.color} 68%, transparent)`,
              boxShadow: `0 0 18px ${attack.color}`,
              rotate: targetLeft ? '-38deg' : '38deg',
            }}
            initial={{ opacity: 0, scaleY: 0.15, x: '-50%', y: '-50%' }}
            animate={{ opacity: [0, 1, 0], scaleY: [0.15, 1, 1.2], x: '-50%', y: '-50%' }}
            transition={{ delay: 0.38, duration: 0.48 }}
          />
        )}

        <motion.div
          className="absolute left-1/2 top-1/2 aspect-square w-12 rounded-full border-4 sm:w-20"
          style={{ borderColor: attack.color, boxShadow: `0 0 24px ${attack.color}` }}
          initial={{ opacity: 0, scale: 0.15, x: '-50%', y: '-50%' }}
          animate={{ opacity: [0, 0.95, 0], scale: [0.15, 0.7, 2.1], x: '-50%', y: '-50%' }}
          transition={{ delay: 0.39, duration: 0.65, ease: 'easeOut' }}
        />

        {Array.from({ length: 8 }).map((_, index) => {
          const angle = (Math.PI * 2 * index) / 8;
          return (
            <motion.span
              key={index}
              className="absolute left-1/2 top-1/2 h-2 w-2 rounded-full sm:h-3 sm:w-3"
              style={{ backgroundColor: attack.color, boxShadow: `0 0 10px ${attack.color}` }}
              initial={{ opacity: 0, x: 0, y: 0, scale: 0.2 }}
              animate={{
                opacity: [0, 1, 0],
                x: [0, Math.cos(angle) * (index % 2 ? 48 : 68)],
                y: [0, Math.sin(angle) * (index % 2 ? 48 : 68)],
                scale: [0.2, 1, 0.25],
              }}
              transition={{ delay: 0.4, duration: 0.62, ease: 'easeOut' }}
            />
          );
        })}
      </div>
    </div>
  );
}

function PetHud({
  name,
  hp,
  maxHp,
  side,
}: {
  name: string;
  hp: number;
  maxHp: number;
  side: 'left' | 'right';
}) {
  const percent = Math.max(0, Math.min(100, (hp / maxHp) * 100));
  const color = percent > 50 ? '#4ade80' : percent > 20 ? '#fbbf24' : '#ef4444';

  return (
    <div className={`absolute top-2 z-[4] w-[42%] max-w-64 rounded-md border border-white/30 bg-slate-950/70 px-2 py-1.5 text-white shadow-lg backdrop-blur-sm sm:top-4 sm:px-3 sm:py-2 ${
      side === 'left' ? 'left-2 sm:left-4' : 'right-2 sm:right-4'
    }`}>
      <div className="mb-1 flex items-center justify-between gap-2 text-[10px] font-bold sm:text-sm">
        <span className="min-w-0 truncate">{name}</span>
        <span className="shrink-0 tabular-nums">{hp}/{maxHp}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/25 sm:h-2">
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: color }}
          animate={{ width: `${percent}%` }}
          transition={{ duration: 0.55, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}

// ==============================
// 主场景
// ==============================
export default function BattleScene3D({
  myPetImage,
  opponentPetImage,
  myPetName,
  opponentPetName,
  myHp,
  myMaxHp,
  opponentHp,
  opponentMaxHp,
  myPetIsGem = false,
  opponentPetIsGem = false,
  myPetUsesBackFallback = false,
  effects,
}: {
  myPetImage: string;
  opponentPetImage: string;
  myPetName: string;
  opponentPetName: string;
  myHp: number;
  myMaxHp: number;
  opponentHp: number;
  opponentMaxHp: number;
  myPetIsGem?: boolean;
  opponentPetIsGem?: boolean;
  myPetUsesBackFallback?: boolean;
  effects: BattleVisualEffect[];
}) {
  const hitPlayers = new Set(effects.map((effect) => effect.target));
  const ultimateEffect = effects.find((effect) => effect.ultimate);
  const shakeLevel = ultimateEffect
    ? getSkillVfxRecipe(ultimateEffect.ultimate!.species).shake || 'medium'
    : null;
  const shakeAmp = shakeLevel === 'heavy' ? 13 : shakeLevel === 'light' ? 4 : 8;

  return (
    <div className="relative h-[clamp(260px,72vw,460px)] w-full overflow-hidden rounded-xl border-2 border-white/60 shadow-lg sm:h-[360px] sm:rounded-2xl sm:border-4 lg:h-[460px] lg:rounded-3xl lg:shadow-2xl">
      {/* 震屏层:大招命中时整个战场(含3D画面)一起抖 */}
      <motion.div
        key={ultimateEffect?.id || 'battle-steady'}
        className="absolute inset-0"
        animate={
          ultimateEffect
            ? {
                x: [0, -shakeAmp, shakeAmp, -shakeAmp * 0.6, shakeAmp * 0.5, 0],
                y: [0, shakeAmp * 0.5, -shakeAmp * 0.5, shakeAmp * 0.3, 0, 0],
              }
            : { x: 0, y: 0 }
        }
        transition={
          ultimateEffect
            ? { delay: IMPACT_AT, duration: 0.42, ease: 'easeOut' }
            : { duration: 0 }
        }
      >
      <Canvas
        camera={{ position: [0, 2.6, 8.5], fov: 46 }}
        shadows
        gl={{ antialias: true }}
      >
        {/* 天空色 + 远景雾 */}
        <color attach="background" args={['#7ec8f2']} />
        <fog attach="fog" args={['#a5d8f5', 14, 30]} />

        {/* 光照 */}
        <ambientLight intensity={0.85} />
        <directionalLight position={[6, 10, 6]} intensity={1.4} castShadow />
        <hemisphereLight args={['#bfe3ff', '#3d8b3d', 0.5]} />

        <AdaptiveCamera />

        {/* 战场 */}
        <BattleArena />

        <BattleActors
          myPetImage={myPetImage}
          opponentPetImage={opponentPetImage}
          myHp={myHp}
          myMaxHp={myMaxHp}
          opponentHp={opponentHp}
          opponentMaxHp={opponentMaxHp}
          hitPlayers={hitPlayers}
          myPetIsGem={myPetIsGem}
          opponentPetIsGem={opponentPetIsGem}
          myPetUsesBackFallback={myPetUsesBackFallback}
        />

        {/* 视角:限制在小范围内可拖动,保持宝可梦式镜头 */}
        <OrbitControls
          enablePan={false}
          enableZoom={false}
          minPolarAngle={Math.PI / 3.2}
          maxPolarAngle={Math.PI / 2.35}
          minAzimuthAngle={-Math.PI / 7}
          maxAzimuthAngle={Math.PI / 7}
          target={[0, 0.2, 0]}
        />
      </Canvas>

      <PetHud name={myPetName} hp={myHp} maxHp={myMaxHp} side="left" />
      <PetHud name={opponentPetName} hp={opponentHp} maxHp={opponentMaxHp} side="right" />

      <AnimatePresence>
        {effects.map((effect) => (
          <UltimateOverlay key={`skill-${effect.id}`} effect={effect} />
        ))}
      </AnimatePresence>

      <AnimatePresence>
        {effects.map((effect) => (
          <NormalAttackEffectOverlay key={`normal-${effect.id}`} effect={effect} />
        ))}
      </AnimatePresence>

      <AnimatePresence>
        {effects.map((effect) => (
          <motion.div
            key={`damage-${effect.id}`}
            className={`absolute pointer-events-none z-10 ${
              effect.target === 1 ? 'left-[22%] bottom-[34%]' : 'right-[22%] top-[24%]'
            }`}
            initial={{ opacity: 1, scale: 0.4, y: 0 }}
            animate={{ opacity: [0, 1, 1, 0], scale: [0.4, 1.1, 1.45, 1.8], y: [0, -8, -36, -66] }}
            exit={{ opacity: 0 }}
            transition={{ delay: effect.ultimate ? IMPACT_AT + 0.06 : 0.38, duration: 1.25, ease: [0.16, 1, 0.3, 1] }}
          >
            <div
              className="text-3xl font-black text-red-600 sm:text-6xl"
              style={{
                textShadow: '0 3px 10px rgba(0,0,0,0.55), 0 0 26px rgba(255,60,60,0.95)',
                WebkitTextStroke: '2px white',
              }}
            >
              -{effect.damage}
            </div>
            {effect.typeText && (
              <div
                className="mt-0.5 whitespace-nowrap text-center text-xs font-bold text-yellow-300 sm:text-lg"
                style={{ textShadow: '0 2px 6px rgba(0,0,0,0.8)' }}
              >
                {effect.typeText}
              </div>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
      </motion.div>
    </div>
  );
}
