/**
 * 宠物对战 · 3D 战场(2026-11-11 重做)
 *
 * 以前: 一块绿色圆盘 + 5 棵圆锥树,宠物是原地漂浮的图片,招式是贴在屏幕上的平面动画。
 * 现在(思路是「立体绘本」: 宠物是平面的画,那就让它们像纸偶一样站进一个真的立体布景里):
 * - **场地是一张画出来的图**(public/battle-arena/*.jpg,地平线在图的正中),**从镜头平时站的位置「投」到布景上**
 *   (远处一面墙 + 脚下一块地,见 PROJ_FRAG): 镜头不动时看到的就是原画,一点不糊;镜头一动,地面、宠物、
 *   远山各走各的,纵深就出来了。11-12 之前是把下半张图直接铺在地上 —— 画里本来就带透视,再被镜头透视一次,
 *   近处拉成了一片糊的。
 * - 镜头会跟着鼠标 / 手指 / 手机的倾斜偏一点(看得出前后);开场从高处摇下来。
 * - 场地里一直飘着东西(雪、火星、雨点、萤火虫 …,components/battle/fx.ts 的 ARENA_AMBIENCE),近大远小。
 * - 宠物脚下有站位圈(我方蓝、对手红)、贴地的影子、照着轮廓投出去的影子。
 * - 宠物有动作: 入场落地、待机呼吸、蓄力后仰、冲过去撞、被打后退闪白、血空了倒下、赢了跳。
 * - 招式是场景里真的粒子(GPU 点精灵,加色混合),从出招的宠物飞向挨打的宠物;命中有冲击波、火花、光。
 * - 镜头: 出招时偏向挨打的一方、大招推近并绕一点、命中震动(震的是镜头不是整个网页)。
 * - 亮的地方会发光(泛光后期);低配机 / 省电模式自动关掉,粒子也减半。
 *
 * 时间全部来自 props.fx(components/battle/fx.ts 排好的时间线)+ config/petSpecies 的常量,
 * 这个文件不自己定「什么时候打中」。打中那一刻回调 onImpact,血条和伤害数字由外面的对战页更新。
 *
 * 不处理: 声音(BattleStage 按同一条时间线播)、文字和按钮(都是网页元素,盖在画布上面)。
 */
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { EFFECT_STEP_NORMAL, EFFECT_STEP_ULTIMATE, FX_TAIL, PARTICLE_IMAGE, type SkillParticle } from '../config/petSpecies';
import type { Ambience, BattleFx, Side } from './battle/fx';

export interface SceneProps {
  arenaUrl: string;
  /** 场地里一直飘着的东西(雪 / 火星 / 雨 …);不传就没有 */
  ambience?: Ambience | null;
  myImage: string;
  oppImage: string;
  myGem?: boolean;
  oppGem?: boolean;
  /** 这一回合的招式时间线;换一组(数组引用变了)就从头演 */
  fx: BattleFx[];
  /** 一记招式打中的那一刻 */
  onImpact: (fx: BattleFx) => void;
  /** 一记招式起手的那一刻(大招用它出切入画面) */
  onFxStart?: (fx: BattleFx) => void;
  /** 每帧报两只宠物头顶在画布里的位置(0–1),外面的名字牌跟着走 */
  onAnchors?: (a: { my: [number, number]; opp: [number, number] }) => void;
  finale?: { loser: Side | null; winner: Side | null } | null;
  /** 系统开了「减少动态效果」: 不震镜头、不推镜头、粒子减半 */
  calm?: boolean;
  /** 场地图和两只宠物的图都加载好、画出第一帧 */
  onReady?: () => void;
  /** 浏览器起不来 WebGL(老电脑 / 显卡驱动被禁): 外面换成平面战场 */
  onUnsupported?: () => void;
}

// ---------------------------------------------------------------- 小工具

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeIn = (t: number) => t * t * t;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
/** t 落在 [a, b] 里的进度 0–1 */
const span = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));

function hash(n: number) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** 站位。我在左前方(离镜头近、画得大),对手在右后方 */
const SPOT: Record<Side, { x: number; z: number; h: number }> = {
  1: { x: -2.3, z: 2.0, h: 2.9 },
  2: { x: 2.2, z: -2.3, h: 2.5 },
};
const facing = (side: Side) => (side === 1 ? 1 : -1);
/** 站位圈的颜色: 我方蓝、对手红(孩子一眼分得清哪只是自己的) */
const SPOT_COLOR: Record<Side, string> = { 1: '#4fb6ff', 2: '#ff6a5a' };

/** 开场: 镜头从高出这么多、退后这么多的地方摇下来(退得再多,画面底边会看到画以外的地面) */
const INTRO_RISE = 2.0;
const INTRO_BACK = 1.2;
const INTRO_SECONDS = 1.5;
/** 镜头跟着鼠标 / 手指 / 手机倾斜最多偏多少(世界单位) */
const SWAY_X = 0.85;
const SWAY_Y = 0.22;

// ---------------------------------------------------------------- 贴图

function loadTexture(url: string, onLoad: (t: THREE.Texture) => void, onError: () => void) {
  const loader = new THREE.TextureLoader();
  return loader.load(url, (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    onLoad(t);
  }, undefined, onError);
}

/** 宠物立绘是调色板 PNG,透明处的颜色是黑的: 线性放大时边缘会带一圈黑。
 *  画到画布上按不透明度预乘,再用预乘混合,边就是干净的(以前靠「最近邻」躲这个问题,所以有锯齿)。 */
function petTextureFrom(image: HTMLImageElement): { tex: THREE.Texture; foot: number } {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(image, 0, 0, size, size);
  const data = g.getImageData(0, 0, size, size);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3] / 255;
    px[i] *= a;
    px[i + 1] *= a;
    px[i + 2] *= a;
  }
  g.putImageData(data, 0, 0);
  // 立绘在方框里是居中的,脚底下空着 0–25%(351 张量过: 中位 9%,扁的那几只最多)。
  // 量出来,摆的时候往下挪这么多 —— 不然扁的宠物悬在半空
  let foot = 0;
  scan: for (let row = size - 1; row >= 0; row -= 1) {
    for (let col = 0; col < size; col += 2) {
      if (px[(row * size + col) * 4 + 3] > 24) {
        foot = (size - 1 - row) / size;
        break scan;
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.premultiplyAlpha = false; // 像素已经自己乘过了,别让浏览器上传时再乘一遍
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  return { tex, foot: Math.min(0.3, foot) };
}

function softDotTexture(): THREE.Texture {
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.22, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.28)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function ringTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, size * 0.28, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.62, 'rgba(255,255,255,0.12)');
  grad.addColorStop(0.84, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function shadowTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(0,0,0,0.62)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.3)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

// ---------------------------------------------------------------- 场地(把画投到立体的布景上)

/** 布景: 远处一面墙(立在 BACKDROP_Z)+ 脚下一块地,在墙根接上 */
const BACKDROP_Z = -17;
const SET_W = 96;
const WALL_H = 44;
const GROUND_NEAR = 15;
/** 场地图都是 1774 × 887 */
const IMAGE_ASPECT = 2;

/**
 * 画是从「镜头平时站的位置」(uEye)平视着投出去的: 布景上每一点该是画里的哪一点,
 * 就看从 uEye 望过去它在哪个方向。uTan = 画的半张开角的正切(横 / 竖)。
 * 逐像素算(不靠顶点上的贴图坐标): 地面是斜着看的,靠顶点插值近处会歪。
 */
const PROJ_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
const PROJ_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uEye;
  uniform vec2 uTan;
  uniform float uGain;
  varying vec3 vWorld;
  void main() {
    vec3 d = vWorld - uEye;
    float depth = max(0.001, -d.z);
    vec2 uv = vec2(0.5 + d.x / depth / (2.0 * uTan.x), 0.5 + d.y / depth / (2.0 * uTan.y));
    vec4 t = texture2D(uMap, clamp(uv, 0.002, 0.998));
    gl_FragColor = vec4(t.rgb * uGain, 1.0);
    #include <colorspace_fragment>
  }
`;

function makeArenaMaterial(map: THREE.Texture) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: map },
      uEye: { value: new THREE.Vector3(0, 2.25, 10.4) },
      uTan: { value: new THREE.Vector2(1.28, 0.64) },
      uGain: { value: 1 },
    },
    vertexShader: PROJ_VERT,
    fragmentShader: PROJ_FRAG,
    depthWrite: false,
    toneMapped: false,
  });
}

function Arena({ material }: { material: THREE.ShaderMaterial }) {
  return (
    <group>
      <mesh position={[0, WALL_H / 2, BACKDROP_Z]} renderOrder={-10} material={material}>
        <planeGeometry args={[SET_W, WALL_H]} />
      </mesh>
      <mesh
        position={[0, 0, (BACKDROP_Z + GROUND_NEAR) / 2]}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={-9}
        material={material}
      >
        <planeGeometry args={[SET_W, GROUND_NEAR - BACKDROP_Z]} />
      </mesh>
    </group>
  );
}

/** 宠物的那张「纸」: 以脚底为轴(整张往上挪半个身高),后仰、倒下都绕着脚。
 *  ⚠️ 别写成 <planeGeometry onUpdate={(g) => g.translate(...)}>: 这个 3D 库挂载时会把 onUpdate 调两遍,
 *  纸就被挪了一整个身高 —— 宠物飘在离地半个身子的地方,影子留在脚下老远(11-12 查到的,打包后也一样)。 */
function standingQuad(h: number, foot: number) {
  const g = new THREE.PlaneGeometry(h, h);
  // foot = 图里脚底下空着的那一截(占图高的几成): 多往下挪这么多,脚正好踩在地上
  g.translate(0, h / 2 - foot * h, 0);
  return g;
}

/** 照着宠物轮廓投在地上的影子: 一张贴着地、朝镜头这边斜出去的四边形,用宠物自己的图当形状 */
function castShadowQuad(h: number, foot: number) {
  const len = h * 0.5;
  const skew = h * 0.3;
  const w = h / 2;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    -w, 0, 0, w, 0, 0, -w + skew, 0, len, w + skew, 0, len,
  ], 3));
  // 影子从脚开始(图里脚底下空着的那截不要)
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, foot, 1, foot, 0, 1, 1, 1], 2));
  // 从上往下看是正面(法线朝上)
  g.setIndex([0, 2, 1, 1, 2, 3]);
  return g;
}

// ---------------------------------------------------------------- 粒子(GPU 点精灵)

const POINT_VERT = /* glsl */ `
  attribute float aSize;
  attribute vec4 aColor;
  attribute float aRot;
  varying vec4 vColor;
  varying float vRot;
  uniform float uScale;
  uniform float uMaxPx;
  void main() {
    vColor = aColor;
    vRot = aRot;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = min(uMaxPx, aSize * uScale / max(0.1, -mv.z));
  }
`;
const POINT_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  varying vec4 vColor;
  varying float vRot;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float s = sin(vRot);
    float co = cos(vRot);
    vec2 uv = vec2(co * c.x - s * c.y, s * c.x + co * c.y) + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
    vec4 t = texture2D(uMap, uv);
    // 贴图是黑底的(火舌 / 水花 / 电光),加色混合后黑色自己消失;aColor.a 管淡入淡出
    gl_FragColor = vec4(t.rgb * vColor.rgb * vColor.a, 1.0);
  }
`;

interface Particle {
  life: number;
  max: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  gravity: number;
  drag: number;
  size: number;
  grow: number;
  rot: number;
  spin: number;
  r: number; g: number; b: number;
  alpha: number;
}

class ParticlePool {
  readonly cap: number;
  readonly items: Particle[];
  readonly geometry: THREE.BufferGeometry;
  readonly material: THREE.ShaderMaterial;
  readonly points: THREE.Points;
  private cursor = 0;
  private positions: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;
  private rots: Float32Array;

  constructor(cap: number, map: THREE.Texture) {
    this.cap = cap;
    this.items = Array.from({ length: cap }, () => ({
      life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, gravity: 0, drag: 0,
      size: 1, grow: 0, rot: 0, spin: 0, r: 1, g: 1, b: 1, alpha: 1,
    }));
    this.positions = new Float32Array(cap * 3);
    this.colors = new Float32Array(cap * 4);
    this.sizes = new Float32Array(cap);
    this.rots = new Float32Array(cap);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aRot', new THREE.BufferAttribute(this.rots, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 80);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: map }, uScale: { value: 400 }, uMaxPx: { value: 64 } },
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 30;
  }

  spawn(init: Partial<Particle> & { max: number }) {
    const p = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.cap;
    p.x = 0; p.y = 0; p.z = 0; p.vx = 0; p.vy = 0; p.vz = 0;
    p.gravity = 0; p.drag = 0; p.size = 1; p.grow = 0; p.rot = 0; p.spin = 0;
    p.r = 1; p.g = 1; p.b = 1; p.alpha = 1;
    Object.assign(p, init);
    p.life = p.max;
  }

  update(dt: number) {
    let n = 0;
    for (let i = 0; i < this.cap; i += 1) {
      const p = this.items[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) continue;
      const k = Math.max(0, 1 - p.drag * dt);
      p.vx *= k; p.vy *= k; p.vz *= k;
      p.vy -= p.gravity * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.rot += p.spin * dt;
      const age = 1 - p.life / p.max;
      // 一出现就亮,后七成慢慢淡掉
      const fade = age < 0.12 ? age / 0.12 : 1 - span(age, 0.3, 1) ** 1.6;
      this.positions[n * 3] = p.x;
      this.positions[n * 3 + 1] = p.y;
      this.positions[n * 3 + 2] = p.z;
      this.colors[n * 4] = p.r;
      this.colors[n * 4 + 1] = p.g;
      this.colors[n * 4 + 2] = p.b;
      this.colors[n * 4 + 3] = p.alpha * fade;
      this.sizes[n] = p.size * (1 + p.grow * age);
      this.rots[n] = p.rot;
      n += 1;
    }
    this.geometry.setDrawRange(0, n);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aColor.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
    this.geometry.attributes.aRot.needsUpdate = true;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

// ---------------------------------------------------------------- 泛光(亮的地方发光)

function Bloom({ strength }: { strength: number }) {
  const { gl, scene, camera, size } = useThree();
  const composer = useMemo(() => {
    const c = new EffectComposer(gl);
    c.addPass(new RenderPass(scene, camera));
    c.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), strength, 0.55, 0.9));
    c.addPass(new OutputPass());
    return c;
  }, [gl, scene, camera, strength]);
  useEffect(() => {
    composer.setPixelRatio(gl.getPixelRatio());
    composer.setSize(size.width, size.height);
  }, [composer, gl, size.width, size.height]);
  useEffect(() => () => composer.dispose(), [composer]);
  // 优先级 1: 接管渲染(不写这个,默认的渲染和这里的会各画一遍)
  useFrame(() => composer.render(), 1);
  return null;
}

// ---------------------------------------------------------------- 一只宠物的状态

interface PetRig {
  group: THREE.Group;
  body: THREE.Mesh;
  bodyMaterial: THREE.MeshBasicMaterial;
  flash: THREE.Mesh;
  flashMaterial: THREE.MeshBasicMaterial;
  shadow: THREE.Mesh;
  /** 照着轮廓投在地上的影子 */
  cast: THREE.Mesh;
  aura: THREE.Mesh | null;
  /** 受击闪白还剩多少(0–1) */
  hitFlash: number;
  /** 被打后往后退的量(世界单位),自己弹回来 */
  recoil: number;
  /** 倒下的进度 0–1 */
  down: number;
  phase: number;
}

// ---------------------------------------------------------------- 场景主体

interface Loaded {
  arena: THREE.Texture;
  my: THREE.Texture;
  opp: THREE.Texture;
  /** 两只宠物的图里,脚底下各空了多少(占图高的几成) */
  myFoot: number;
  oppFoot: number;
  particles: Partial<Record<SkillParticle, THREE.Texture>>;
}

function Stage({
  loaded, props, low,
}: { loaded: Loaded; props: SceneProps; low: boolean }) {
  const { camera, size, gl } = useThree();
  const propsRef = useRef(props);
  propsRef.current = props;

  const dot = useMemo(softDotTexture, []);
  const ring = useMemo(ringTexture, []);
  const shadowMap = useMemo(shadowTexture, []);
  useEffect(() => () => {
    dot.dispose();
    ring.dispose();
    shadowMap.dispose();
  }, [dot, ring, shadowMap]);

  // 粒子池: 一个画柔光点(拖尾 / 火花 / 尘土),每种实物贴图(火舌 / 水花 / 电光 …)各一个
  const pools = useMemo(() => {
    const cap = low ? 220 : 520;
    const map: Record<string, ParticlePool> = { dot: new ParticlePool(cap, dot) };
    (Object.keys(loaded.particles) as SkillParticle[]).forEach((key) => {
      const tex = loaded.particles[key];
      if (tex) map[key] = new ParticlePool(low ? 90 : 200, tex);
    });
    return map;
  }, [low, dot, loaded.particles]);
  useEffect(() => () => Object.values(pools).forEach((p) => p.dispose()), [pools]);

  // 布景的材质(墙和地共用一个)、两只宠物的「纸」和影子的形状
  const arenaMaterial = useMemo(() => makeArenaMaterial(loaded.arena), [loaded.arena]);
  useEffect(() => () => arenaMaterial.dispose(), [arenaMaterial]);
  const quads = useMemo(() => ({
    1: { body: standingQuad(SPOT[1].h, loaded.myFoot), cast: castShadowQuad(SPOT[1].h, loaded.myFoot) },
    2: { body: standingQuad(SPOT[2].h, loaded.oppFoot), cast: castShadowQuad(SPOT[2].h, loaded.oppFoot) },
  }), [loaded.myFoot, loaded.oppFoot]);
  useEffect(() => () => {
    ([1, 2] as Side[]).forEach((side) => {
      quads[side].body.dispose();
      quads[side].cast.dispose();
    });
  }, [quads]);

  const rigs = useRef<Record<Side, PetRig | null>>({ 1: null, 2: null });
  const groupRefs = { 1: useRef<THREE.Group>(null), 2: useRef<THREE.Group>(null) };
  const bodyRefs = { 1: useRef<THREE.Mesh>(null), 2: useRef<THREE.Mesh>(null) };
  const flashRefs = { 1: useRef<THREE.Mesh>(null), 2: useRef<THREE.Mesh>(null) };
  const shadowRefs = { 1: useRef<THREE.Mesh>(null), 2: useRef<THREE.Mesh>(null) };
  const castRefs = { 1: useRef<THREE.Mesh>(null), 2: useRef<THREE.Mesh>(null) };
  const spotRefs = { 1: useRef<THREE.Mesh>(null), 2: useRef<THREE.Mesh>(null) };
  // 防守: 挨打那一下身前亮一面护盾(各自从被打那一刻起过了几秒;9 = 没在亮)
  const shieldRefs = { 1: useRef<THREE.Mesh>(null), 2: useRef<THREE.Mesh>(null) };
  const shields = useRef<Record<Side, number>>({ 1: 9, 2: 9 });
  const auraRefs = { 1: useRef<THREE.Mesh>(null), 2: useRef<THREE.Mesh>(null) };
  const ringRefs = [useRef<THREE.Mesh>(null), useRef<THREE.Mesh>(null), useRef<THREE.Mesh>(null)];
  const glowRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);

  // 时间线
  const clock = useRef({ t: 0, fxRef: props.fx as BattleFx[], fired: new Set<string>(), started: new Set<string>(), born: 0 });
  const shake = useRef(0);
  const rings = useRef<Array<{ t: number; dur: number; x: number; z: number; max: number; r: number; g: number; b: number }>>([]);
  const glow = useRef({ t: 9, x: 0, y: 0, z: 0, r: 1, g: 1, b: 1, size: 3 });
  const finaleAt = useRef<number | null>(null);
  const camPos = useRef(new THREE.Vector3());
  const camLook = useRef(new THREE.Vector3());
  const tmpColor = useMemo(() => new THREE.Color(), []);
  const tmpVec = useMemo(() => new THREE.Vector3(), []);
  const tmpLook = useMemo(() => new THREE.Vector3(), []);
  // 鼠标 / 手指 / 手机倾斜 → 镜头偏多少(-1 … 1)
  const sway = useRef({ x: 0, y: 0, touching: false, gyro: 0, gyroBase: null as number | null, gyroAt: 0, sx: 0, sy: 0 });
  // 场地里飘的东西攒到够一个再出;雷暴的闪电
  const ambient = useRef({ owed: 0, flash: 0, nextFlash: 4 + Math.random() * 4 });

  useLayoutEffect(() => {
    ([1, 2] as Side[]).forEach((side) => {
      const group = groupRefs[side].current!;
      const body = bodyRefs[side].current!;
      const flash = flashRefs[side].current!;
      rigs.current[side] = {
        group, body, flash,
        bodyMaterial: body.material as THREE.MeshBasicMaterial,
        flashMaterial: flash.material as THREE.MeshBasicMaterial,
        shadow: shadowRefs[side].current!,
        cast: castRefs[side].current!,
        aura: auraRefs[side].current,
        hitFlash: 0, recoil: 0, down: 0, phase: side * 1.7,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 镜头按战场的宽高比摆: 越窄(电脑上战场在左半边、接近方的;手机竖着拿)视角越宽、退得越远,
  // 保证左前方那只宠物连同它后仰 / 被打退的余量都在画面里。11-12 之前只分「窄 / 不窄」两档,
  // 方一点的战场上我方宠物有一半在画面外
  const view = useMemo(() => {
    const aspect = size.width / Math.max(1, size.height);
    const fov = aspect >= 1.9 ? 40 : aspect <= 1.2 ? 54 : lerp(54, 40, (aspect - 1.2) / 0.7);
    const tanH = Math.tan((fov * Math.PI) / 360) * aspect;
    // 我方宠物左边缘(站位 + 半个身宽 + 余量)要落在画面里
    const reach = Math.abs(SPOT[1].x) + SPOT[1].h / 2 + 0.95;
    const camZ = Math.min(15.5, Math.max(9.4, SPOT[1].z + reach / tanH));
    // 镜头放低、少往下看(差不多平视): 地平线落在画面上面四成的地方,天空和远山露得出来。
    // 11-12 之前镜头高 3.15、往下看 10 度,画面里八成是地,极光 / 雪山 / 云都被切在画面外
    const pos = new THREE.Vector3(0, 2.25 + (fov - 40) * 0.02, camZ);
    const look = new THREE.Vector3(0, 1.75, -1.4);
    // 画要张开多大才盖得住镜头看得到的地方: 往下要盖到画面底边那一线地面,
    // 往两边要比画面再多出几度(大招时镜头会转向一侧)。张得越大,画在屏幕上越小、越清楚。
    const halfV = (fov * Math.PI) / 360;
    const pitch = Math.atan2(pos.y - look.y, pos.z - look.z);
    const halfH = Math.atan(Math.tan(halfV) * aspect);
    const tanV = Math.max(Math.tan(pitch + halfV) + 0.06, Math.tan(Math.min(1.45, halfH + 0.13)) / IMAGE_ASPECT);
    return { fov, pos, look, tanV };
  }, [size.width, size.height]);

  // 第一帧把镜头直接摆到开场的位置(高处),之后才是慢慢跟。放在每帧里做而不是这里:
  // 开发环境下这段会跑两遍,第二遍就把开场的位置冲掉了
  const camSnapped = useRef(false);
  useLayoutEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    cam.fov = view.fov;
    cam.near = 0.1;
    cam.far = 140;
    cam.position.copy(view.pos);
    cam.lookAt(view.look);
    cam.updateProjectionMatrix();
    camPos.current.copy(view.pos);
    camLook.current.copy(view.look);
  }, [camera, view]);

  useLayoutEffect(() => {
    arenaMaterial.uniforms.uEye.value.copy(view.pos);
    arenaMaterial.uniforms.uTan.value.set(view.tanV * IMAGE_ASPECT, view.tanV);
  }, [arenaMaterial, view]);

  useLayoutEffect(() => {
    Object.values(pools).forEach((p) => {
      p.material.uniforms.uScale.value = (size.height * gl.getPixelRatio()) / (2 * Math.tan((view.fov * Math.PI) / 360));
      // 一个粒子在屏幕上最大占画面高度的 12%
      p.material.uniforms.uMaxPx.value = size.height * gl.getPixelRatio() * 0.12;
    });
  }, [view.fov, pools, size.height, gl]);

  // 鼠标在哪 / 手指按着战场往哪拖 / 手机往哪边歪 → 镜头跟着偏一点
  useEffect(() => {
    const el = gl.domElement;
    const s = sway.current;
    const locate = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return {
        x: Math.max(-1, Math.min(1, ((e.clientX - r.left) / Math.max(1, r.width) - 0.5) * 2)),
        y: Math.max(-1, Math.min(1, ((e.clientY - r.top) / Math.max(1, r.height) - 0.5) * 2)),
        inside: e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom,
      };
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' && !s.touching) return;
      const p = locate(e);
      s.x = p.x;
      s.y = p.y;
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      const p = locate(e);
      if (!p.inside) return;
      s.touching = true;
      s.x = p.x;
      s.y = p.y;
    };
    const release = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      s.touching = false;
      s.x = 0;
      s.y = 0;
    };
    const onLeave = () => {
      s.x = 0;
      s.y = 0;
    };
    // 手机倾斜: 只在不用弹权限框的浏览器上用(iPhone 要先弹框问,不值得为这个打断孩子)
    const Orientation = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: unknown } }).DeviceOrientationEvent;
    const useGyro = !!Orientation && typeof Orientation.requestPermission !== 'function';
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      const angle = window.screen?.orientation?.angle ?? 0;
      s.gyro = angle === 90 ? e.beta : angle === 270 ? -e.beta : e.gamma;
      s.gyroAt = performance.now();
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('pointerup', release, { passive: true });
    window.addEventListener('pointercancel', release, { passive: true });
    document.documentElement.addEventListener('mouseleave', onLeave);
    if (useGyro) window.addEventListener('deviceorientation', onOrient, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      document.documentElement.removeEventListener('mouseleave', onLeave);
      if (useGyro) window.removeEventListener('deviceorientation', onOrient);
    };
  }, [gl]);

  useEffect(() => {
    propsRef.current.onReady?.();
  }, []);

  // ---- 发射器 ----
  const emitDot = (init: Partial<Particle> & { max: number }) => pools.dot.spawn(init);
  const emitArt = (key: SkillParticle | undefined, init: Partial<Particle> & { max: number }) => {
    const pool = key ? pools[key] : undefined;
    if (pool) pool.spawn(init);
    else pools.dot.spawn(init);
  };
  const density = low ? 0.5 : 1;

  // near = 打在我方(离镜头近)身上: 同样大的粒子在屏幕上大一倍,会把自己的宠物盖成一团白 → 粒子收小;
  // soft = 被护盾挡住: 实物粒子(冰晶 / 火舌 …)只出三成
  const burst = (fx: BattleFx, at: THREE.Vector3, big: boolean, near = false, soft = false) => {
    tmpColor.set(fx.color);
    const { r, g, b } = tmpColor;
    const k = near ? 0.6 : 1;
    const n = Math.round((big ? 46 : 22) * density);
    for (let i = 0; i < n; i += 1) {
      const a = hash(i * 3.1 + fx.start) * Math.PI * 2;
      const up = hash(i * 7.7 + 1) * 0.9 + 0.1;
      const speed = (big ? 7.5 : 4.6) * (0.45 + hash(i * 1.9 + 4));
      emitDot({
        max: 0.5 + hash(i + 9) * 0.5, x: at.x, y: at.y, z: at.z,
        vx: Math.cos(a) * speed, vy: up * speed * 0.9, vz: Math.sin(a) * speed * 0.6,
        gravity: 7, drag: 2.2, size: (big ? 0.26 : 0.17) * (0.6 + hash(i * 5.3)) * k,
        r: lerp(r, 1, 0.3), g: lerp(g, 1, 0.3), b: lerp(b, 1, 0.3), alpha: 0.95,
      });
    }
    const m = Math.round((big ? 14 : 6) * density * (soft ? 0.3 : 1));
    for (let i = 0; i < m; i += 1) {
      const a = hash(i * 9.3 + fx.start * 2) * Math.PI * 2;
      const speed = (big ? 4.2 : 2.6) * (0.5 + hash(i * 2.7));
      emitArt(fx.particle, {
        max: 0.55 + hash(i * 4.1) * 0.45, x: at.x, y: at.y, z: at.z,
        vx: Math.cos(a) * speed, vy: Math.abs(Math.sin(a)) * speed + 1, vz: Math.sin(a) * speed * 0.4,
        gravity: 3.2, drag: 1.4, size: (big ? 1.1 : 0.7) * (0.7 + hash(i * 6.1) * 0.6) * k,
        rot: hash(i) * 6.28, spin: (hash(i * 3) - 0.5) * 7, r: 1, g: 1, b: 1, alpha: 0.95,
      });
    }
    rings.current.push({ t: 0, dur: big ? 0.6 : 0.42, x: at.x, z: at.z, max: big ? 6.5 : 3.6, r, g, b });
    if (big) rings.current.push({ t: -0.09, dur: 0.75, x: at.x, z: at.z, max: 9.5, r: 1, g: 1, b: 1 });
    glow.current = { t: 0, x: at.x, y: at.y, z: at.z + 0.2, r, g, b, size: big ? 5.2 : 2.6 };
  };

  const dust = (x: number, z: number, n: number) => {
    for (let i = 0; i < Math.round(n * density); i += 1) {
      const a = hash(i * 2.3 + x) * Math.PI * 2;
      emitDot({
        max: 0.5 + hash(i) * 0.35, x: x + Math.cos(a) * 0.3, y: 0.08, z: z + Math.sin(a) * 0.2,
        vx: Math.cos(a) * 1.6, vy: 0.5 + hash(i * 3) * 0.7, vz: Math.sin(a) * 0.8,
        gravity: 0.6, drag: 2.4, size: 0.7 + hash(i * 5) * 0.5, grow: 1.2,
        r: 0.5, g: 0.46, b: 0.4, alpha: 0.16,
      });
    }
  };

  // ---- 每帧 ----
  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05); // 切到别的页面再回来时不要一步跨过去
    const c = clock.current;
    const p = propsRef.current;
    const calm = !!p.calm;
    c.born += dt;

    if (c.fxRef !== p.fx) {
      c.fxRef = p.fx;
      c.t = 0;
      c.fired = new Set();
      c.started = new Set();
    }
    c.t += dt;
    const t = c.t;

    // 起手 / 打中 的回调
    p.fx.forEach((fx) => {
      if (!c.started.has(fx.id) && t >= fx.start) {
        c.started.add(fx.id);
        p.onFxStart?.(fx);
      }
      if (!c.fired.has(fx.id) && t >= fx.impact) {
        c.fired.add(fx.id);
        const target = rigs.current[fx.target];
        const big = fx.kind === 'ultimate';
        if (target) {
          target.hitFlash = (fx.guarded ? 0.4 : 1) * (fx.target === 1 ? 0.6 : 1);
          target.recoil = (big ? 0.95 : fx.kind === 'backfire' ? 0.35 : fx.heavy ? 0.8 : 0.55) * (fx.guarded ? 0.45 : 1);
        }
        if (fx.guarded) shields.current[fx.target] = 0;
        const spot = SPOT[fx.target];
        tmpVec.set(spot.x, spot.h * 0.45, spot.z);
        // 重击: 命中用大的那一套(多一圈冲击波、火花多)
        burst(fx, tmpVec, big || !!fx.heavy, fx.target === 1, !!fx.guarded);
        // 命中的那团光: 我方离镜头近,同样大的光会把自己的宠物整个盖白 —— 收小;
        // 被护盾挡住的那一下再收一半、换成护盾的蓝(孩子要看得见「挡住了」,不是又一团白)
        if (fx.target === 1) glow.current.size *= 0.7;
        if (fx.guarded) {
          glow.current.size *= 0.55;
          glow.current.r = 0.56;
          glow.current.g = 0.89;
          glow.current.b = 1;
        }
        shake.current = Math.max(shake.current, calm ? 0 : fx.shake === 'heavy' ? 1 : fx.shake === 'medium' ? 0.7 : 0.38);
        p.onImpact(fx);
      }
    });

    // 这一刻正在演的那一记
    let active: BattleFx | null = null;
    for (const fx of p.fx) {
      const dur = (fx.kind === 'ultimate' ? EFFECT_STEP_ULTIMATE : EFFECT_STEP_NORMAL) + FX_TAIL;
      if (t >= fx.start && t < fx.start + dur) active = fx;
    }

    // ---- 招式在飞的那一段: 弹道 / 蓄力的粒子 ----
    if (active) {
      const fx = active;
      const lt = t - fx.start;
      const from = SPOT[fx.attacker];
      const to = SPOT[fx.target];
      const big = fx.kind === 'ultimate';
      tmpColor.set(fx.color);
      const { r, g, b } = tmpColor;
      const hitAt = fx.impact - fx.start;

      if (big) {
        // 蓄力: 粒子从四周往出招的宠物身上收
        if (lt > 0.55 && lt < 1.5) {
          const n = Math.round(3 * density);
          for (let i = 0; i < n; i += 1) {
            const a = Math.random() * Math.PI * 2;
            const rad = 2.6 + Math.random() * 1.4;
            const sx = from.x + Math.cos(a) * rad;
            const sy = from.h * 0.5 + Math.sin(a) * rad * 0.7;
            emitDot({
              max: 0.42, x: sx, y: Math.max(0.1, sy), z: from.z + (Math.random() - 0.5) * 0.6,
              vx: (from.x - sx) / 0.42, vy: (from.h * 0.5 - sy) / 0.42, vz: 0,
              size: 0.3 + Math.random() * 0.3, r, g, b, alpha: 0.9,
            });
          }
        }
        // 放出去: 按招式骨架
        const flyFrom = 1.5;
        if (lt >= flyFrom && lt < hitAt) {
          const k = span(lt, flyFrom, hitAt);
          const sk = fx.skeleton;
          if (sk === 'pillar') {
            // 天上砸下来的光柱
            for (let i = 0; i < Math.round(6 * density); i += 1) {
              emitDot({
                max: 0.3, x: to.x + (Math.random() - 0.5) * 0.5, y: 9 - k * 9 + Math.random() * 2.4, z: to.z,
                vy: -16, size: 0.3 + Math.random() * 0.3, r, g, b, alpha: 0.6,
              });
            }
            if (Math.random() < 0.6 * density) {
              emitArt(fx.particle, {
                max: 0.34, x: to.x + (Math.random() - 0.5) * 1.3, y: 7 - k * 6.5, z: to.z, vy: -12,
                size: 1.7, rot: Math.random() * 6.28, r: 1, g: 1, b: 1, alpha: 0.9,
              });
            }
          } else if (sk === 'slash') {
            // 三道斩击
            const which = Math.min(2, Math.floor(k * 3));
            const ang = [-0.7, 0.6, -1.5][which];
            const local = (k * 3) % 1;
            for (let i = 0; i < Math.round(8 * density); i += 1) {
              const along = (local + i * 0.035 - 0.5) * 3.6;
              emitDot({
                max: 0.22, x: to.x + Math.cos(ang) * along, y: to.h * 0.48 + Math.sin(ang) * along, z: to.z + 0.3,
                size: 0.5, r: lerp(r, 1, 0.5), g: lerp(g, 1, 0.5), b: lerp(b, 1, 0.5), alpha: 1,
              });
            }
          } else if (sk === 'aura' || sk === 'burst') {
            // 在对方脚下收紧的一圈
            const rad = lerp(3.4, 0.5, k);
            for (let i = 0; i < Math.round(10 * density); i += 1) {
              const a = Math.random() * Math.PI * 2;
              emitDot({
                max: 0.3, x: to.x + Math.cos(a) * rad, y: 0.25 + Math.random() * 1.6, z: to.z + Math.sin(a) * rad * 0.5,
                vy: 2.5, size: 0.42, r, g, b, alpha: 0.85,
              });
            }
          } else {
            // beam / projectile: 一道粗光束或一颗大光弹从出招的宠物射向对方
            const hx = lerp(from.x + facing(fx.attacker) * 0.9, to.x, sk === 'beam' ? 1 : easeIn(k));
            const hz = lerp(from.z, to.z, sk === 'beam' ? 1 : easeIn(k));
            const steps = sk === 'beam' ? Math.round(16 * density) : Math.round(7 * density);
            for (let i = 0; i < steps; i += 1) {
              const u = sk === 'beam' ? Math.random() * span(lt, flyFrom, flyFrom + 0.22) : 1 - i * 0.05;
              const px = lerp(from.x + facing(fx.attacker) * 0.9, hx, u);
              const pz = lerp(from.z, hz, u);
              emitDot({
                max: sk === 'beam' ? 0.2 : 0.34, x: px + (Math.random() - 0.5) * 0.25,
                y: lerp(from.h * 0.55, to.h * 0.45, u) + (Math.random() - 0.5) * 0.3, z: pz,
                size: sk === 'beam' ? 0.42 + Math.random() * 0.3 : 0.8 - i * 0.08,
                r: lerp(r, 1, 0.2), g: lerp(g, 1, 0.2), b: lerp(b, 1, 0.2), alpha: sk === 'beam' ? 0.6 : 0.85,
              });
            }
            if (Math.random() < 0.7 * density) {
              const u = Math.random();
              emitArt(fx.particle, {
                max: 0.4, x: lerp(from.x, hx, u), y: lerp(from.h * 0.55, to.h * 0.45, u), z: lerp(from.z, hz, u),
                vx: (Math.random() - 0.5) * 2, vy: Math.random() * 1.5, size: 1.3,
                rot: Math.random() * 6.28, spin: 4, r: 1, g: 1, b: 1, alpha: 0.9,
              });
            }
          }
        }
      } else if (fx.mode === 'shot' && lt >= 0.12 && lt < hitAt) {
        // 普通攻击 · 打出一发: 一颗带拖尾的光弹,略带弧线
        const k = span(lt, 0.12, hitAt);
        const px = lerp(from.x + facing(fx.attacker) * 0.8, to.x, k);
        const pz = lerp(from.z, to.z, k);
        const py = lerp(from.h * 0.55, to.h * 0.45, k) + Math.sin(k * Math.PI) * 0.9;
        for (let i = 0; i < Math.round(5 * density); i += 1) {
          emitDot({
            max: 0.26, x: px + (Math.random() - 0.5) * 0.18, y: py + (Math.random() - 0.5) * 0.18, z: pz,
            vx: -facing(fx.attacker) * 1.5, size: 0.62 - i * 0.07, r: lerp(r, 1, 0.3), g: lerp(g, 1, 0.3), b: lerp(b, 1, 0.3), alpha: 1,
          });
        }
        if (Math.random() < 0.5 * density) {
          emitArt(fx.particle, { max: 0.3, x: px, y: py, z: pz, size: 1.0, rot: Math.random() * 6.28, spin: 8, r: 1, g: 1, b: 1, alpha: 0.9 });
        }
      } else if (fx.mode === 'burst' && fx.kind !== 'backfire' && lt >= 0.1 && lt < hitAt) {
        const k = span(lt, 0.1, hitAt);
        const rad = lerp(2.2, 0.3, k);
        for (let i = 0; i < Math.round(6 * density); i += 1) {
          const a = Math.random() * Math.PI * 2;
          emitDot({
            max: 0.24, x: to.x + Math.cos(a) * rad, y: 0.3 + Math.random() * 1.2, z: to.z + Math.sin(a) * rad * 0.5,
            vy: 2, size: 0.36, r, g, b, alpha: 0.85,
          });
        }
      }
    }

    // ---- 两只宠物的动作 ----
    const finale = p.finale;
    if (finale && finaleAt.current === null) finaleAt.current = c.born;
    if (!finale) finaleAt.current = null;
    const finaleT = finaleAt.current === null ? -1 : c.born - finaleAt.current;

    ([1, 2] as Side[]).forEach((side) => {
      const rig = rigs.current[side];
      if (!rig) return;
      const spot = SPOT[side];
      const dir = facing(side);
      let x = spot.x;
      let y = 0;
      const z = spot.z;
      let sx = 1;
      let sy = 1;
      let tilt = 0;
      let tint = 0; // 0 正常,往 1 走变暗
      let glowAmt = 0;

      // 入场: 从上方落下,落地压扁一下,扬起一点尘土
      const enterAt = side === 1 ? 0.15 : 0.5;
      const e = span(c.born, enterAt, enterAt + 0.5);
      if (e < 1) {
        y += (1 - easeIn(e)) * 7;
        rig.body.visible = c.born >= enterAt;
        rig.shadow.visible = rig.body.visible;
      } else {
        rig.body.visible = true;
        rig.shadow.visible = true;
        const land = span(c.born, enterAt + 0.5, enterAt + 0.85);
        if (land < 1) {
          const squash = Math.sin(land * Math.PI) * 0.16;
          sy -= squash;
          sx += squash * 0.8;
        }
        if (c.born - dt < enterAt + 0.5) dust(spot.x, spot.z, 9);
      }

      // 待机: 呼吸
      const breathe = Math.sin(state.clock.elapsedTime * 2.1 + rig.phase);
      sy += breathe * 0.018;
      sx -= breathe * 0.012;
      y += (breathe * 0.5 + 0.5) * 0.035;

      // 出招的动作
      if (active && active.attacker === side) {
        const fx = active;
        const lt = t - fx.start;
        const hitAt = fx.impact - fx.start;
        const other = SPOT[fx.target];
        if (fx.kind === 'ultimate') {
          // 蓄力: 后仰、发亮、微微浮起;放出去的一刻往前一顶
          const charge = span(lt, 0.4, 1.5);
          const release = span(lt, 1.5, 1.8);
          const settle = span(lt, 1.8, 2.6);
          x -= dir * 0.5 * easeOut(charge) * (1 - release);
          x += dir * 0.9 * easeOut(release) * (1 - easeInOut(settle));
          y += 0.3 * easeOut(charge) * (1 - settle);
          tilt = dir * (-0.16 * charge * (1 - release) + 0.22 * release * (1 - settle));
          sx += 0.06 * charge * (1 - release);
          sy += 0.06 * charge * (1 - release) + 0.1 * Math.sin(release * Math.PI);
          glowAmt = Math.max(glowAmt, charge * (1 - settle));
        } else if (fx.mode === 'dash' || fx.kind === 'backfire') {
          // 冲过去撞: 后仰蓄一下 → 冲到对方面前 → 弹回原位
          const wind = span(lt, 0, 0.14);
          const go = span(lt, 0.14, hitAt);
          const back = span(lt, hitAt + 0.05, hitAt + 0.5);
          const reach = (other.x - spot.x) * 0.66;
          const reachZ = (other.z - spot.z) * 0.66;
          const fwd = easeIn(go) * (1 - easeInOut(back));
          x += -dir * 0.35 * Math.sin(wind * Math.PI) * (1 - go) + reach * fwd;
          rig.group.position.z = z + reachZ * fwd;
          y += Math.sin(go * Math.PI) * 0.55 * (1 - back);
          tilt = dir * (-0.12 * (1 - go) * wind + 0.3 * go * (1 - back));
          sx += 0.12 * go * (1 - back);
          sy -= 0.06 * go * (1 - back);
        } else {
          // 打出一发 / 原地发力: 后仰一下再往前一送
          const wind = span(lt, 0, 0.14);
          const push = span(lt, 0.14, 0.3);
          const back = span(lt, 0.3, 0.7);
          x += dir * (-0.3 * Math.sin(wind * Math.PI) + 0.4 * easeOut(push) * (1 - easeInOut(back)));
          tilt = dir * (-0.1 * wind * (1 - push) + 0.14 * push * (1 - back));
          sy += 0.07 * Math.sin(push * Math.PI);
        }
      }
      if (!(active && active.attacker === side && (active.mode === 'dash' || active.kind === 'backfire') && active.kind !== 'ultimate')) {
        rig.group.position.z = z;
      }

      // 挨打: 往后退、压扁、闪白,自己弹回来
      rig.recoil *= Math.exp(-dt * 7.5);
      rig.hitFlash = Math.max(0, rig.hitFlash - dt * 3.4);
      x -= dir * rig.recoil;
      tilt -= dir * rig.recoil * 0.34;
      sx -= rig.recoil * 0.1;
      sy += rig.recoil * 0.05;
      if (rig.hitFlash > 0.02 && !calm) x += Math.sin(c.born * 90) * 0.05 * rig.hitFlash;

      // 结尾: 输的倒下,赢的跳起来
      if (finale && finaleT >= 0) {
        if (finale.loser === side) {
          rig.down = Math.min(1, rig.down + dt / 0.85);
          const d = easeIn(rig.down);
          tilt -= dir * d * 1.25;
          y -= d * 0.25;
          sy -= d * 0.22;
          tint = d * 0.6;
          if (rig.down > 0.82 && rig.down - dt / 0.85 <= 0.82) {
            dust(spot.x - dir * 0.6, spot.z, 14);
            shake.current = Math.max(shake.current, calm ? 0 : 0.3);
          }
        } else if (finale.winner === side) {
          const j = span(finaleT, 0.75, 9);
          if (j > 0) {
            const hop = Math.abs(Math.sin((finaleT - 0.75) * 5.2)) * Math.exp(-(finaleT - 0.75) * 0.55);
            y += hop * 0.85;
            sy += hop * 0.1;
            glowAmt = Math.max(glowAmt, 0.35 * Math.exp(-(finaleT - 0.75) * 0.8));
            if (Math.random() < 0.5 * density && finaleT < 3.2) {
              emitDot({
                max: 0.9, x: spot.x + (Math.random() - 0.5) * 2.4, y: 0.4 + Math.random() * spot.h, z: spot.z + 0.2,
                vy: 1.4 + Math.random(), size: 0.13 + Math.random() * 0.14, r: 1, g: 0.8, b: 0.3, alpha: 0.9,
              });
            }
          }
        }
      }

      rig.group.position.x = x;
      rig.group.position.y = y;
      rig.body.rotation.z = tilt;
      rig.flash.rotation.z = tilt;
      rig.body.scale.set(sx, sy, 1);
      rig.flash.scale.set(sx, sy, 1);
      const shade = 1 - tint;
      rig.bodyMaterial.color.setRGB(shade, shade, shade);
      rig.bodyMaterial.opacity = 1;
      rig.flashMaterial.opacity = Math.min(1, rig.hitFlash * 0.9 + glowAmt * 0.45);
      if (rig.hitFlash > 0.02) rig.flashMaterial.color.setRGB(1, 0.92, 0.86);
      else if (active && active.attacker === side) rig.flashMaterial.color.set(active.color);
      else rig.flashMaterial.color.setRGB(1, 0.86, 0.4);
      // 影子: 留在地上(不跟着跳),但跟着宠物左右前后走;宠物离地越高越小越淡
      const lift = clamp01(y / 4);
      const gz = rig.group.position.z;
      rig.shadow.position.set(x, 0.04, gz + 0.15);
      rig.shadow.scale.setScalar(1 - lift * 0.55);
      (rig.shadow.material as THREE.MeshBasicMaterial).opacity = (0.5 - lift * 0.38) * (1 - rig.down * 0.3);
      // 照着轮廓投出去的那一片: 离地了就离脚远一点、淡一点;倒下了收掉(倒下的样子和站着的轮廓对不上)
      rig.cast.visible = rig.body.visible;
      rig.cast.position.set(x + lift * 0.9, 0.05, gz + 0.06 + lift * 1.4);
      rig.cast.scale.set(sx, 1, 1 - lift * 0.35);
      (rig.cast.material as THREE.MeshBasicMaterial).opacity = 0.3 * (1 - lift * 0.75) * (1 - rig.down);
      if (rig.aura) {
        rig.aura.rotation.z += dt * 0.5;
        (rig.aura.material as THREE.MeshBasicMaterial).opacity = (0.3 + Math.sin(c.born * 2.2) * 0.08) * (1 - rig.down);
      }
    });

    // ---- 冲击波 / 命中的光 ----
    rings.current = rings.current.filter((rg) => rg.t < rg.dur);
    ringRefs.forEach((ref, i) => {
      const mesh = ref.current;
      if (!mesh) return;
      const rg = rings.current[i];
      if (!rg) {
        mesh.visible = false;
        return;
      }
      rg.t += dt;
      if (rg.t < 0) {
        mesh.visible = false;
        return;
      }
      const k = clamp01(rg.t / rg.dur);
      mesh.visible = true;
      mesh.position.set(rg.x, 0.06, rg.z);
      mesh.scale.setScalar(lerp(0.4, rg.max, easeOut(k)));
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.color.setRGB(rg.r, rg.g, rg.b);
      mat.opacity = (1 - k) ** 1.5 * 0.9;
    });
    const gl0 = glow.current;
    gl0.t += dt;
    if (glowRef.current) {
      const k = clamp01(gl0.t / 0.42);
      const mesh = glowRef.current;
      mesh.visible = k < 1;
      mesh.position.set(gl0.x, gl0.y, gl0.z);
      mesh.scale.setScalar(gl0.size * lerp(0.35, 1.25, easeOut(k)));
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.color.setRGB(lerp(gl0.r, 1, 0.55), lerp(gl0.g, 1, 0.55), lerp(gl0.b, 1, 0.55));
      mat.opacity = (1 - k) ** 2;
    }
    if (lightRef.current) {
      const k = clamp01(gl0.t / 0.5);
      lightRef.current.intensity = (1 - k) * 9;
      lightRef.current.position.set(gl0.x, gl0.y + 0.6, gl0.z + 1.5);
      lightRef.current.color.setRGB(gl0.r, gl0.g, gl0.b);
    }

    // ---- 护盾: 被打的那一下亮起来、往外扩、淡掉 ----
    ([1, 2] as Side[]).forEach((side) => {
      const mesh = shieldRefs[side].current;
      if (!mesh) return;
      shields.current[side] += dt;
      const k = clamp01(shields.current[side] / 0.55);
      mesh.visible = k < 1;
      if (k >= 1) return;
      mesh.scale.setScalar(lerp(0.75, 1.2, easeOut(k)));
      (mesh.material as THREE.MeshBasicMaterial).opacity = (1 - k) ** 1.3 * 0.95;
    });

    // ---- 站位圈: 慢慢一明一暗 ----
    ([1, 2] as Side[]).forEach((side) => {
      const mesh = spotRefs[side].current;
      if (!mesh) return;
      const rig = rigs.current[side];
      const pulse = 0.5 + 0.5 * Math.sin(c.born * 1.6 + side * 2.1);
      (mesh.material as THREE.MeshBasicMaterial).opacity = (0.3 + pulse * 0.16) * (rig ? 1 - rig.down * 0.7 : 1) * clamp01(c.born - 0.4);
      mesh.rotation.z += dt * 0.25 * facing(side);
    });

    // ---- 场地里飘的东西 + 雷暴的闪电 ----
    const amb = p.ambience;
    const am = ambient.current;
    if (amb && !calm) {
      am.owed += amb.rate * density * dt;
      // 攒得太多(切到后台回来)就不补了
      if (am.owed > 6) am.owed = 6;
      tmpColor.set(amb.color);
      while (am.owed >= 1) {
        am.owed -= 1;
        // 飘在镜头和远处之间的一大块空间里: 离镜头近的自然就大,像镜头前的虚影
        const ax = (Math.random() - 0.5) * 22;
        const az = -8 + Math.random() * ((amb.maxZ ?? 6.5) + 8);
        const jitter = 0.6 + Math.random() * 0.8;
        const base = {
          max: amb.life * (0.7 + Math.random() * 0.6), x: ax, z: az, size: amb.size * jitter,
          r: tmpColor.r, g: tmpColor.g, b: tmpColor.b, alpha: 0.5 + Math.random() * 0.35,
        };
        if (amb.kind === 'fall') {
          emitDot({ ...base, y: 6 + Math.random() * 2.5, vy: -amb.speed * jitter, vx: -amb.speed * 0.22 });
        } else if (amb.kind === 'rise') {
          emitDot({ ...base, y: 0.1 + Math.random() * 0.8, vy: amb.speed * jitter, vx: (Math.random() - 0.5) * 0.5, gravity: -0.15 });
        } else if (amb.kind === 'drift') {
          emitDot({ ...base, x: ax - 4, y: 0.3 + Math.random() * 4.2, vx: amb.speed * jitter, vy: (Math.random() - 0.5) * 0.25 });
        } else {
          emitDot({
            ...base, y: 0.4 + Math.random() * 2.6,
            vx: (Math.random() - 0.5) * amb.speed * 2, vy: (Math.random() - 0.5) * amb.speed, vz: (Math.random() - 0.5) * amb.speed,
          });
        }
      }
      if (amb.lightning) {
        am.nextFlash -= dt;
        if (am.nextFlash <= 0) {
          am.flash = 1;
          am.nextFlash = 6 + Math.random() * 6;
        }
      }
    }
    am.flash *= Math.exp(-dt * 5.5);
    arenaMaterial.uniforms.uGain.value = 1 + (am.flash > 0.01 ? am.flash * 0.28 : 0);

    // ---- 镜头 ----
    const targetPos = tmpVec.copy(view.pos);
    const targetLook = tmpLook.copy(view.look);
    if (!calm) {
      // 开场从高处摇下来
      const intro = 1 - easeInOut(span(c.born, 0.05, INTRO_SECONDS));
      targetPos.y += INTRO_RISE * intro;
      targetPos.z += INTRO_BACK * intro;
      // 待机时很慢地左右漂一点: 近处和远处错开,画就有了纵深
      targetPos.x += Math.sin(state.clock.elapsedTime * 0.23) * 0.45;
      targetPos.y += Math.sin(state.clock.elapsedTime * 0.31) * 0.1;
      // 跟着鼠标 / 手指 / 手机倾斜偏一点。手机倾斜取「和刚才比歪了多少」: 孩子拿手机的角度各不相同,
      // 基准慢慢跟上现在的角度,所以一直歪着拿过一会儿画面就回正
      const sw = sway.current;
      let gyro = 0;
      if (sw.gyroAt && performance.now() - sw.gyroAt < 1000) {
        if (sw.gyroBase === null) sw.gyroBase = sw.gyro;
        sw.gyroBase += (sw.gyro - sw.gyroBase) * (1 - Math.exp(-dt * 0.5));
        gyro = Math.max(-1, Math.min(1, (sw.gyro - sw.gyroBase) / 12));
      }
      const wantX = Math.max(-1, Math.min(1, sw.x + gyro));
      const ease = 1 - Math.exp(-dt * 5);
      sw.sx += (wantX - sw.sx) * ease;
      sw.sy += (sw.y - sw.sy) * ease;
      targetPos.x += sw.sx * SWAY_X;
      targetPos.y -= sw.sy * SWAY_Y;
      targetLook.x += sw.sx * 0.18;
      if (active) {
        const lt = t - active.start;
        const from = SPOT[active.attacker];
        const to = SPOT[active.target];
        if (active.kind === 'ultimate') {
          const hitAt = active.impact - active.start;
          const charge = span(lt, 0.35, 1.5) * (1 - span(lt, 1.5, 1.85));
          const strike = span(lt, 1.5, hitAt) * (1 - span(lt, hitAt + 0.25, hitAt + 0.9));
          // 蓄力: 推近到出招的宠物;放出去: 甩向挨打的一方
          targetPos.x = lerp(targetPos.x, from.x * 0.55, charge);
          targetPos.z = lerp(targetPos.z, view.pos.z - 3.2, charge);
          targetPos.y = lerp(targetPos.y, view.pos.y - 0.7, charge);
          targetLook.x = lerp(targetLook.x, from.x * 0.8, charge);
          targetLook.z = lerp(targetLook.z, from.z, charge);
          targetPos.x = lerp(targetPos.x, to.x * 0.4, strike);
          targetPos.z = lerp(targetPos.z, view.pos.z - 1.6, strike);
          targetLook.x = lerp(targetLook.x, to.x * 0.75, strike);
          targetLook.z = lerp(targetLook.z, to.z, strike);
        } else {
          const lean = Math.sin(span(lt, 0, 0.95) * Math.PI);
          targetPos.x += to.x * 0.16 * lean;
          targetPos.z -= 0.75 * lean;
          targetLook.x += to.x * 0.2 * lean;
        }
      }
      if (finale && finaleT >= 0) {
        const focus = finale.winner ?? (finale.loser === 1 ? 2 : finale.loser === 2 ? 1 : null);
        if (focus) {
          const k = easeInOut(span(finaleT, 0.2, 1.6));
          targetPos.x = lerp(targetPos.x, SPOT[focus].x * 0.5, k);
          targetPos.z = lerp(targetPos.z, view.pos.z - 2.4, k);
          targetLook.x = lerp(targetLook.x, SPOT[focus].x * 0.8, k);
          targetLook.z = lerp(targetLook.z, SPOT[focus].z, k);
        }
      }
    }
    if (!camSnapped.current) {
      camSnapped.current = true;
      camPos.current.copy(targetPos);
      camLook.current.copy(targetLook);
    }
    const follow = 1 - Math.exp(-dt * 4.2);
    camPos.current.lerp(targetPos, follow);
    camLook.current.lerp(targetLook, follow);
    shake.current *= Math.exp(-dt * 9);
    const s = shake.current;
    camera.position.set(
      camPos.current.x + (s > 0.01 ? Math.sin(c.born * 61) * s * 0.34 : 0),
      camPos.current.y + (s > 0.01 ? Math.sin(c.born * 83 + 1.3) * s * 0.26 : 0),
      camPos.current.z,
    );
    camera.lookAt(camLook.current);

    Object.values(pools).forEach((pool) => pool.update(dt));

    // ---- 名字牌的位置 ----
    if (p.onAnchors) {
      const out: [number, number][] = [];
      ([1, 2] as Side[]).forEach((side) => {
        const spot = SPOT[side];
        tmpVec.set(spot.x, spot.h + 0.25, spot.z).project(camera);
        out.push([tmpVec.x * 0.5 + 0.5, 1 - (tmpVec.y * 0.5 + 0.5)]);
      });
      p.onAnchors({ my: out[0], opp: out[1] });
    }
  });

  const petMaterial = (map: THREE.Texture) => (
    <meshBasicMaterial
      map={map}
      transparent
      depthWrite={false}
      toneMapped={false}
      blending={THREE.CustomBlending}
      blendSrc={THREE.OneFactor}
      blendDst={THREE.OneMinusSrcAlphaFactor}
      blendSrcAlpha={THREE.OneFactor}
      blendDstAlpha={THREE.OneMinusSrcAlphaFactor}
    />
  );

  return (
    <>
      <Arena material={arenaMaterial} />

      {([1, 2] as Side[]).map((side) => {
        const spot = SPOT[side];
        const map = side === 1 ? loaded.my : loaded.opp;
        const gem = side === 1 ? props.myGem : props.oppGem;
        // 我方站得离镜头近: 后画(对手 5 / 6,我方 7 / 8),冲过去撞的时候才不会被对手盖住
        const order = side === 1 ? 7 : 5;
        return (
          <group key={side}>
            {/* 站位圈: 留在原地,宠物冲出去了它还在 */}
            <mesh ref={spotRefs[side]} position={[spot.x, 0.03, spot.z]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={0}>
              <planeGeometry args={[spot.h * 1.3, spot.h * 1.3]} />
              <meshBasicMaterial map={ring} color={SPOT_COLOR[side]} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
            </mesh>
            {/* 影子贴在地上,不跟着宠物跳(位置每帧跟着宠物左右前后走) */}
            <mesh ref={shadowRefs[side]} position={[spot.x, 0.04, spot.z + 0.15]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={1}>
              <planeGeometry args={[spot.h * 0.92, spot.h * 0.42]} />
              <meshBasicMaterial map={shadowMap} transparent depthWrite={false} toneMapped={false} />
            </mesh>
            {/* 照着轮廓投出去的影子: 同一张图,涂成黑的,贴着地 */}
            <mesh ref={castRefs[side]} geometry={quads[side].cast} position={[spot.x, 0.05, spot.z + 0.06]} renderOrder={2}>
              <meshBasicMaterial
                map={map}
                color="#000000"
                transparent
                opacity={0.3}
                depthWrite={false}
                toneMapped={false}
                side={THREE.DoubleSide}
                blending={THREE.CustomBlending}
                blendSrc={THREE.OneFactor}
                blendDst={THREE.OneMinusSrcAlphaFactor}
                blendSrcAlpha={THREE.OneFactor}
                blendDstAlpha={THREE.OneMinusSrcAlphaFactor}
              />
            </mesh>
            {/* 护盾: 立在宠物身前(朝对手那一侧),平时不显示 */}
            <mesh ref={shieldRefs[side]} position={[spot.x + facing(side) * spot.h * 0.28, spot.h * 0.5, spot.z + 0.35]} visible={false} renderOrder={order + 3}>
              <planeGeometry args={[spot.h * 1.25, spot.h * 1.25]} />
              <meshBasicMaterial map={ring} color="#8fe3ff" transparent opacity={0} depthWrite={false} depthTest={false} blending={THREE.AdditiveBlending} toneMapped={false} />
            </mesh>
            <group ref={groupRefs[side]} position={[spot.x, 0, spot.z]}>
              {gem && (
                <mesh ref={auraRefs[side]} position={[0, spot.h * 0.5, -0.05]} renderOrder={3}>
                  <planeGeometry args={[spot.h * 1.55, spot.h * 1.55]} />
                  <meshBasicMaterial map={ring} color="#7ae7ff" transparent opacity={0.3} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
                </mesh>
              )}
              {/* 身体: 以脚底为轴(standingQuad),后仰、倒下都绕着脚 */}
              <mesh ref={bodyRefs[side]} geometry={quads[side].body} renderOrder={order}>
                {petMaterial(map)}
              </mesh>
              {/* 同一张图再叠一层加色: 受击闪白、蓄力发亮 */}
              <mesh ref={flashRefs[side]} geometry={quads[side].body} position={[0, 0, 0.01]} renderOrder={order + 1}>
                <meshBasicMaterial map={map} transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
              </mesh>
            </group>
          </group>
        );
      })}

      {ringRefs.map((ref, i) => (
        <mesh key={i} ref={ref} rotation={[-Math.PI / 2, 0, 0]} visible={false} renderOrder={20}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial map={ring} transparent depthWrite={false} depthTest={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </mesh>
      ))}
      <mesh ref={glowRef} visible={false} renderOrder={21}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={dot} transparent depthWrite={false} depthTest={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      <pointLight ref={lightRef} intensity={0} distance={14} />

      {Object.entries(pools).map(([key, pool]) => <primitive key={key} object={pool.points} />)}

      {!low && <Bloom strength={0.5} />}
    </>
  );
}

// ---------------------------------------------------------------- 入口

/** 这个 3D 库(three r163 起)只认 WebGL2。只有老的 WebGL1 的设备(iOS 14 及以前的 iPad / iPhone、很老的安卓)
 *  要在这里就判成「起不来」,交给平面战场 —— 放它过去的话,建画布那一步直接抛错,整页进错误页。 */
function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!canvas.getContext('webgl2');
  } catch {
    return false;
  }
}

/** 低配: 核少 / 内存小 / 系统要求省流量 → 不开泛光、粒子减半、分辨率不超过 1 倍 */
function isLowPower(): boolean {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  if (nav.connection?.saveData) return true;
  if ((nav.hardwareConcurrency ?? 8) <= 4) return true;
  if ((nav.deviceMemory ?? 8) <= 3) return true;
  return false;
}

export default function BattleScene3D(props: SceneProps) {
  const { arenaUrl, myImage, oppImage, fx, onUnsupported } = props;
  const [supported] = useState(webglAvailable);
  const [low, setLow] = useState(() => isLowPower() || !!props.calm);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!supported || failed) onUnsupported?.();
  }, [supported, failed, onUnsupported]);

  // 这一回合用得到的粒子贴图(火舌 / 水花 …)先各取一张;以后回合换了宠物再补
  const particleKeys = useMemo(() => {
    const set = new Set<SkillParticle>();
    fx.forEach((f) => f.particle && set.add(f.particle));
    return Array.from(set).sort().join(',');
  }, [fx]);
  const particleCache = useRef<Partial<Record<SkillParticle, THREE.Texture>>>({});
  const [particleTick, setParticleTick] = useState(0);
  useEffect(() => {
    if (!supported) return;
    particleKeys.split(',').filter(Boolean).forEach((key) => {
      const k = key as SkillParticle;
      if (particleCache.current[k]) return;
      loadTexture(PARTICLE_IMAGE[k], (t) => {
        particleCache.current[k] = t;
        setParticleTick((n) => n + 1);
      }, () => {});
    });
  }, [particleKeys, supported]);

  useEffect(() => {
    if (!supported) return undefined;
    let alive = true;
    const made: THREE.Texture[] = [];
    const want = {
      arena: null as THREE.Texture | null, my: null as THREE.Texture | null, opp: null as THREE.Texture | null,
      myFoot: 0, oppFoot: 0,
    };
    const done = () => {
      if (alive && want.arena && want.my && want.opp) {
        setLoaded((prev) => ({
          arena: want.arena!, my: want.my!, opp: want.opp!, myFoot: want.myFoot, oppFoot: want.oppFoot,
          particles: prev?.particles ?? {},
        }));
      }
    };
    made.push(loadTexture(arenaUrl, (t) => {
      want.arena = t;
      done();
    }, () => alive && setFailed(true)));
    const loadPet = (url: string, key: 'my' | 'opp') => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        if (!alive) return;
        const { tex, foot } = petTextureFrom(img);
        made.push(tex);
        want[key] = tex;
        want[key === 'my' ? 'myFoot' : 'oppFoot'] = foot;
        done();
      };
      img.onerror = () => alive && setFailed(true);
      img.src = url;
    };
    loadPet(myImage, 'my');
    loadPet(oppImage, 'opp');
    return () => {
      alive = false;
      made.forEach((t) => t.dispose());
    };
  }, [arenaUrl, myImage, oppImage, supported]);

  useEffect(() => () => {
    Object.values(particleCache.current).forEach((t) => t?.dispose());
  }, []);

  const loadedWithParticles = useMemo(
    () => (loaded ? { ...loaded, particles: { ...particleCache.current } } : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loaded, particleTick],
  );

  if (!supported || failed) return null;

  return (
    <Canvas
      className="!absolute inset-0"
      dpr={low ? 1 : [1, 1.75]}
      gl={{ antialias: !low, alpha: false, powerPreference: 'high-performance' }}
      camera={{ fov: 40, position: [0, 2.25, 10.4] }}
      onCreated={({ gl }) => {
        gl.setClearColor('#0b1420');
        // 显卡上下文丢了(切到后台太久 / 显存紧张): 交给外面换平面战场,别留一块黑
        gl.domElement.addEventListener('webglcontextlost', () => setFailed(true), { once: true });
      }}
      // 掉帧了(连着低于约 40 帧)就关掉泛光、粒子减半
      performance={{ min: 0.5 }}
      aria-hidden="true"
    >
      {loadedWithParticles && (
        <>
          <Stage loaded={loadedWithParticles} props={props} low={low} />
          <FrameWatch onSlow={() => setLow(true)} enabled={!low} />
        </>
      )}
    </Canvas>
  );
}

/** 连着 2.5 秒平均不到 34 帧 → 降一档(只降不升,免得来回切) */
function FrameWatch({ onSlow, enabled }: { onSlow: () => void; enabled: boolean }) {
  const acc = useRef({ t: 0, n: 0, warm: 0 });
  useFrame((_, dt) => {
    if (!enabled) return;
    const a = acc.current;
    a.warm += dt;
    if (a.warm < 2) return; // 刚进来在加载图,不算
    a.t += dt;
    a.n += 1;
    if (a.t >= 2.5) {
      if (a.n / a.t < 34) onSlow();
      a.t = 0;
      a.n = 0;
    }
  });
  return null;
}
