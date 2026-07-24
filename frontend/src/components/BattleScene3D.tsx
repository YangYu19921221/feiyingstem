import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, useTexture } from '@react-three/drei';
import * as THREE from 'three';
import { useRef, useState, useEffect, useMemo, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getPetDefinition, type PetElement } from '../config/petSpecies';

type BattleVisualEffect = {
  id: string;
  attacker: 1 | 2;
  target: 1 | 2;
  damage: number;
  typeText?: string;
  ultimate?: {
    species: string;
    name: string;
  };
};

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

function getSkillVfx(species: string) {
  const definition = getPetDefinition(species);
  return { image: definition.ultimate.image, ...ELEMENT_VFX[definition.element] };
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

function SkillEffectOverlay({ effect }: { effect: BattleVisualEffect }) {
  if (!effect.ultimate) return null;

  const skill = getSkillVfx(effect.ultimate.species);
  const targetLeft = effect.target === 1;
  const travelX = effect.attacker === 1 ? -260 : 260;
  const isProjectile = skill.mode === 'projectile';
  const initial = skill.mode === 'strike'
    ? { opacity: 1, scale: 0.45, y: -150 }
    : { opacity: 1, scale: 0.22, x: isProjectile ? travelX : travelX * 0.28, rotate: targetLeft ? 18 : -18 };
  const animate = skill.mode === 'strike'
    ? {
        opacity: [1, 1, 1, 0],
        scale: [0.45, 0.95, 1.15, 1.3],
        y: [-150, -10, 0, 16],
      }
    : {
        opacity: [1, 1, 1, 0],
        scale: [0.22, 0.72, 1.12, 1.34],
        x: [isProjectile ? travelX : travelX * 0.28, travelX * 0.2, 0, 0],
        rotate: [targetLeft ? 18 : -18, targetLeft ? -8 : 8, 0, targetLeft ? -6 : 6],
      };

  return (
    <>
      <motion.div
        className="absolute inset-0 z-[5] bg-white pointer-events-none mix-blend-screen"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0.34, 0.08, 0] }}
        transition={{ duration: 1.05, times: [0, 0.38, 0.7, 1] }}
      />

      <div
        className="absolute z-[7] pointer-events-none"
        style={{ left: targetLeft ? '25%' : '75%', top: '52%', transform: 'translate(-50%, -50%)' }}
      >
        <motion.div
          initial={initial}
          animate={animate}
          transition={{ duration: 2.25, times: [0, 0.18, 0.86, 1], ease: [0.16, 1, 0.3, 1] }}
        >
          <img
            src={skill.image}
            alt=""
            aria-hidden="true"
            className="h-auto w-[min(72vw,470px)] max-w-none select-none sm:w-[min(54vw,560px)]"
            style={{
              filter: `drop-shadow(0 0 24px ${skill.color})`,
              transform: isProjectile && targetLeft ? 'scaleX(-1)' : undefined,
            }}
          />
        </motion.div>

        <motion.div
          className="absolute left-1/2 top-1/2 aspect-square w-24 rounded-full border-4 sm:w-36"
          style={{ borderColor: skill.color, boxShadow: `0 0 30px ${skill.color}` }}
          initial={{ opacity: 0.9, scale: 0.2, x: '-50%', y: '-50%' }}
          animate={{ opacity: 0, scale: 2.35, x: '-50%', y: '-50%' }}
          transition={{ delay: 0.48, duration: 0.7, ease: 'easeOut' }}
        />
      </div>

      <motion.div
        className={`absolute bottom-2 z-[9] max-w-[45%] rounded-md border border-white/25 bg-slate-950/80 px-2.5 py-1 text-center text-xs font-black text-white shadow-lg backdrop-blur-sm sm:bottom-4 sm:px-4 sm:py-1.5 sm:text-base ${
          targetLeft ? 'left-2 sm:left-5' : 'right-2 sm:right-5'
        }`}
        initial={{ opacity: 0, y: -12, scale: 0.8 }}
        animate={{ opacity: [0, 1, 1, 0], y: [-12, 0, 0, -5], scale: [0.8, 1, 1, 0.95] }}
        transition={{ duration: 2.2, times: [0, 0.12, 0.84, 1] }}
      >
        {effect.ultimate.name}
      </motion.div>
    </>
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

  return (
    <div className="relative h-[clamp(260px,72vw,460px)] w-full overflow-hidden rounded-xl border-2 border-white/60 shadow-lg sm:h-[360px] sm:rounded-2xl sm:border-4 lg:h-[460px] lg:rounded-3xl lg:shadow-2xl">
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
          <SkillEffectOverlay key={`skill-${effect.id}`} effect={effect} />
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
            transition={{ delay: effect.ultimate ? 0.46 : 0, duration: 1.25, ease: [0.16, 1, 0.3, 1] }}
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
    </div>
  );
}
