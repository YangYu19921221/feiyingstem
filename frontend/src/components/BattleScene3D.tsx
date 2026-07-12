import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Text, useTexture } from '@react-three/drei';
import * as THREE from 'three';
import { useRef, useState, useEffect, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// ==============================
// 3D 宠物 Sprite - PNG 立绘做成永远面向相机的广告牌(宝可梦经典风格)
// ==============================
function PetSprite({
  imageUrl,
  position,
  scale = 1,
  isHit = false,
  label,
  hp,
  maxHp,
  facingLeft = false,
}: {
  imageUrl: string;
  position: [number, number, number];
  scale?: number;
  isHit?: boolean;
  label?: string;
  hp: number;
  maxHp: number;
  facingLeft?: boolean;
}) {
  const texture = useTexture(imageUrl);
  const groupRef = useRef<THREE.Group>(null);
  const spriteRef = useRef<THREE.Sprite>(null);
  const [entranceDone, setEntranceDone] = useState(false);

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
          map={texture}
          transparent
          alphaTest={0.05}
          color={isHit ? new THREE.Color(2.5, 0.6, 0.6) : new THREE.Color(1, 1, 1)}
        />
      </sprite>

      {/* 椭圆地面投影 */}
      <mesh position={[0, -1.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[scale * 0.95, 32]} />
        <meshBasicMaterial color="#14532d" transparent opacity={0.35} />
      </mesh>

      {/* 名字标签 */}
      {label && (
        <Text
          position={[0, scale * 1.75 + 0.55, 0]}
          fontSize={0.34}
          color="#ffffff"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.045}
          outlineColor="#1e3a5f"
          fontWeight={700}
        >
          {label}
        </Text>
      )}

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
  damagePlayer,
  damageValue,
  typeText,
}: {
  myPetImage: string;
  opponentPetImage: string;
  myPetName: string;
  opponentPetName: string;
  myHp: number;
  myMaxHp: number;
  opponentHp: number;
  opponentMaxHp: number;
  damagePlayer: 1 | 2 | null;
  damageValue?: number | null;
  typeText?: string;
}) {
  return (
    <div className="relative w-full h-[460px] rounded-3xl overflow-hidden shadow-2xl border-4 border-white/60">
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

        {/* 战场 */}
        <BattleArena />

        {/* 宠物(纹理挂 Suspense,加载期间场景其余部分先渲染) */}
        <Suspense fallback={null}>
          {/* 我方 - 左前近景 */}
          <PetSprite
            imageUrl={myPetImage}
            position={[-2.6, 0, 2.2]}
            scale={1.25}
            isHit={damagePlayer === 1}
            label={myPetName}
            hp={myHp}
            maxHp={myMaxHp}
          />
          {/* 对方 - 右后远景 */}
          <PetSprite
            imageUrl={opponentPetImage}
            position={[2.6, 0.1, -2.2]}
            scale={0.95}
            isHit={damagePlayer === 2}
            label={opponentPetName}
            hp={opponentHp}
            maxHp={opponentMaxHp}
            facingLeft
          />
        </Suspense>

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

      {/* 伤害数字(2D overlay,信息更清晰) */}
      <AnimatePresence>
        {damagePlayer && damageValue ? (
          <motion.div
            key={`dmg-${damagePlayer}-${damageValue}`}
            className={`absolute pointer-events-none z-10 ${
              damagePlayer === 1 ? 'left-[24%] bottom-[38%]' : 'right-[26%] top-[22%]'
            }`}
            initial={{ opacity: 1, scale: 0.4, y: 0 }}
            animate={{ opacity: 0, scale: 1.9, y: -70 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.25, ease: [0.16, 1, 0.3, 1] }}
          >
            <div
              className="text-6xl font-black text-red-600"
              style={{
                textShadow: '0 3px 10px rgba(0,0,0,0.55), 0 0 26px rgba(255,60,60,0.95)',
                WebkitTextStroke: '3px white',
              }}
            >
              -{damageValue}
            </div>
            {typeText && (
              <div
                className="text-lg font-bold text-yellow-300 text-center mt-0.5"
                style={{ textShadow: '0 2px 6px rgba(0,0,0,0.8)' }}
              >
                {typeText}
              </div>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
