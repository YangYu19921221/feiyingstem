/**
 * 音标学习 — 学生端
 *
 * 音标是英语的基础(拼读、听写、背单词全建立在它上面),所以这个页面的定位是
 * 「先把音标看明白」:顶部一句话说清为什么重要,下面按 入门→元音→辅音 分组列视频。
 *
 * 播放走鉴权串流端点:<video> 带不了请求头,凭证只能放 URL 上 —— 但放的是
 * 只能播这一个视频的两小时票据(api/phonetics.fetchVideoTicket),不是整站会话 token。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText } from 'lucide-react';
import {
  phoneticsApi, CATEGORY_LABELS, listVideoMaterials, NO_LECTURER,
  type PhoneticVideo, type PhoneticCategory, type StudentMaterial,
} from '../api/phonetics';
import { getErrorMessage } from '../utils/errorMessage';
import { segmentIpa } from '../utils/ipaPhonemes';
import LessonStage from '../components/phonetics/LessonStage';

const GROUP_ORDER: PhoneticCategory[] = ['basic', 'vowel', 'consonant', 'other'];
const GROUP_ICON: Record<PhoneticCategory, string> = {
  basic: '🌱', vowel: '🅰️', consonant: '🔤', other: '📦',
};
/**
 * 分类默认封面(老师没单独设封面时用)。四张主体/形状/色温都不同:
 * 元音=暖橙圆形太阳、辅音=冷蓝尖角鼓,缩略图尺寸下也能一眼区分。
 *
 * ?v= 版本号是必须的:这些图**文件名固定**(不像 js 有 Vite 内容哈希),
 * 而 nginx 给静态图发的是 `max-age=2592000, immutable` —— 换了图不带版本号,
 * 老用户一个月内看到的还是旧图,硬刷新都不一定管用。换图时把 v 加 1。
 */
const COVER_V = 2;
const CATEGORY_COVER: Record<PhoneticCategory, string> = {
  basic: `/phonics-basic.jpeg?v=${COVER_V}`,
  vowel: `/phonics-vowel.jpeg?v=${COVER_V}`,
  consonant: `/phonics-consonant.jpeg?v=${COVER_V}`,
  other: `/phonics-other.jpeg?v=${COVER_V}`,
};

function formatDuration(sec?: number | null): string {
  if (!sec || sec <= 0) return '';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * 「我跟哪位老师上课」记在本地,**按用户 id 分键**。
 *
 * 不存服务端:这是个纯展示偏好,存后端要加表加端点,而它错了的代价只是
 * 顶部少点一下。按 id 分键是必须的 —— 机构里常见一台平板几个孩子轮着用,
 * 共用一个键会让后一个孩子进来看到前一个孩子的老师。
 */
function lecturerKey(): string {
  let uid = 'anon';
  try {
    const raw = JSON.parse(localStorage.getItem('user') || 'null');
    if (raw?.id) uid = String(raw.id);
  } catch { /* 读不出来就当匿名,不影响功能 */ }
  return `phonetics.lecturer.${uid}`;
}

function readSavedLecturer(): string | null {
  try { return localStorage.getItem(lecturerKey()); } catch { return null; }
}

function saveLecturer(v: string) {
  try { localStorage.setItem(lecturerKey(), v); } catch { /* 隐私模式下写不了,忽略 */ }
}

export default function PhoneticsHub() {
  const navigate = useNavigate();
  const [videos, setVideos] = useState<PhoneticVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [keyword, setKeyword] = useState('');
  const [playing, setPlaying] = useState<PhoneticVideo | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  /**
   * 当前选中的讲师。'' = 全部,NO_LECTURER = 全校通用,其它 = 讲师姓名。
   * 初值从 localStorage 读(上次选的那位),读不到就是 ''。
   */
  const [lecturer, setLecturer] = useState<string>(() => readSavedLecturer() || '');
  /** 第一次进来还没选过老师 → 弹一次「你是跟哪位老师上课?」 */
  const [askLecturer, setAskLecturer] = useState(false);
  /** 上次选的老师已经不在了(改名/视频删空),已自动落回「全部」,要告诉学生一句 */
  const [lecturerGone, setLecturerGone] = useState(false);
  /** 当前视频的配套讲义(老师上传的 PPT/PDF,渲染成图给学生看) */
  const [materials, setMaterials] = useState<StudentMaterial[]>([]);
  /** 正在看的那份讲义。null = 只看视频 */
  const [viewing, setViewing] = useState<StudentMaterial | null>(null);
  /** 播放面板 DOM:全屏时把它整个送进 requestFullscreen */
  const panelRef = useRef<HTMLDivElement>(null);

  /**
   * 选老师弹层的 Esc = 「先都看看」(与屏幕上那个按钮同一个动作)。
   *
   * 弹层刻意不给关闭 X(叉掉了就再也不知道这里能选老师),但**键盘用户必须有退路** ——
   * aria-modal 之下没有 Esc 就是把键盘用户困住。走 pickLecturer('') 而不是单纯关闭:
   * 否则下次进来又弹,等于没退出。
   */
  useEffect(() => {
    if (!askLecturer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') pickLecturer('');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [askLecturer]);

  // Esc:先收讲义,再关播放器 —— 两层各退一步,不要一下全关。
  // 浏览器全屏中按 Esc 由 UA 先退全屏(不触发 keydown),不与这里打架
  useEffect(() => {
    if (!playing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (viewing) setViewing(null);
      else setPlaying(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playing, viewing]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError('');
        // client.ts 的响应拦截器已把 response.data 拆出来,这里直接就是数组
        const data = await phoneticsApi.list();
        if (alive) setVideos(data);
      } catch (e) {
        if (alive) setError(getErrorMessage(e, '视频加载失败,请下拉刷新重试'));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [reloadKey]);

  /**
   * 讲师选项:从**全量视频**聚合,不受搜索影响 —— 边打字边让顶部的老师条
   * 重排或消失,手指会点错。
   * 「全校通用」(讲师为空)单独一个 chip 排在最后:那是所有人都该看的内容,
   * 不属于某一位老师。
   */
  const lecturerOptions = useMemo(() => {
    const counts = new Map<string, number>();
    let shared = 0;
    for (const v of videos) {
      const name = (v.lecturer || '').trim();
      if (!name) { shared += 1; continue; }
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    const named = [...counts.entries()]
      .map(([name, count]) => ({ value: name, label: name, count }))
      // 视频多的排前面(常讲课的那位),同数按姓名稳定排序
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh'));
    return shared > 0
      ? [...named, { value: NO_LECTURER, label: '全校通用', count: shared }]
      : named;
  }, [videos]);

  /**
   * 存下来的老师可能已经不在了(老师改了讲师名 / 他的视频被删光了)。
   * 这时**必须自动落回「全部」并说明原因** —— 否则学生进来看到一片空白,
   * 而空白是最没法自我解释的状态:他分不清是没网、老师没传、还是被筛掉了。
   */
  useEffect(() => {
    if (loading || videos.length === 0 || !lecturer) return;
    if (lecturerOptions.some((o) => o.value === lecturer)) return;
    setLecturer('');
    saveLecturer('');
    setLecturerGone(true);
  }, [loading, videos, lecturer, lecturerOptions]);

  /**
   * 第一次进来问一次「你是跟哪位老师上课?」,之后记住不再问。
   * 只有两位以上讲师才问 —— 没得选还要点一下是纯粹的打扰。
   *
   * 不必躲新功能公告(它是 z-[80] 会盖住这里):WhatsNewNudge 的 QUIET_PATTERNS
   * 已含 '/phonetics',公告在本页**根本不弹**,回首页才弹。改那个列表时要想到这里。
   */
  useEffect(() => {
    if (loading || videos.length === 0) return;
    // 注意用 !== null:选过「全部」存的是空串,那也是选过了,不能再问
    if (readSavedLecturer() !== null) return;
    if (lecturerOptions.filter((o) => o.value !== NO_LECTURER).length < 2) return;
    setAskLecturer(true);
  }, [loading, videos, lecturerOptions]);

  const pickLecturer = (v: string) => {
    setLecturer(v);
    saveLecturer(v);
    setLecturerGone(false);
    setAskLecturer(false);
  };

  // 搜索在前端做:音标视频量级是几十个,一次取回后本地过滤最快,不用每次敲字都打后端。
  // 讲师筛选与搜索**叠加**(选了王老师再搜「元音」= 王老师的元音课)
  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return videos.filter((v) => {
      if (lecturer) {
        const name = (v.lecturer || '').trim();
        const hit = lecturer === NO_LECTURER ? !name : name === lecturer;
        if (!hit) return false;
      }
      if (!kw) return true;
      return v.title.toLowerCase().includes(kw)
        || (v.phonetic_symbol || '').toLowerCase().includes(kw)
        // 讲师也要能搜:卡片上就印着「王老师」,搜它却搜不到会让孩子以为视频没了
        // (后端 phonetics.py 的搜索也加了 lecturer,两边口径必须一致 ——
        //  这里是前端本地过滤,后端那条对学生列表其实用不上,但两处口径漂移
        //  迟早会在别的调用方上咬人)
        || (v.lecturer || '').toLowerCase().includes(kw)
        || (v.description || '').toLowerCase().includes(kw);
    });
  }, [videos, keyword, lecturer]);

  const groups = useMemo(() => {
    return GROUP_ORDER
      .map((c) => ({ category: c, items: filtered.filter((v) => v.category === c) }))
      .filter((g) => g.items.length > 0);
  }, [filtered]);

  const openVideo = async (v: PhoneticVideo) => {
    setPlaying(v);
    setMaterials([]);           // 先清空:否则会短暂显示上一个视频的讲义
    setViewing(null);
    // 记一次观看(失败不影响播放)
    try { await phoneticsApi.detail(v.id); } catch { /* 计数失败无所谓 */ }
    // 配套讲义:取不到就当没有,**不能因此打断看视频**
    try { setMaterials(await listVideoMaterials(v.id)); } catch { setMaterials([]); }
  };

  return (
    <div className="min-h-screen bg-paper">
      {/* 顶部:强调「这是英语的基础」 */}
      <div className="relative overflow-hidden bg-[#bd5227]">
        {/* 背景图压到 10% 并盖一层暗色:原来 20% 时插画的高饱和橙黄会把白字糊掉,
            标题读不清。文字可读性优先于装饰 */}
        <div className="absolute inset-0 opacity-10">
          <img src={`/phonics-hero.jpeg?v=${COVER_V}`} alt="" className="h-full w-full object-cover" />
        </div>
        <div className="absolute inset-0 bg-black/10" />
        <div className="relative mx-auto max-w-5xl px-5 py-7 sm:py-10">
          <button
            type="button"
            onClick={() => navigate('/student/dashboard')}
            className="mb-3 inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-medium text-white/90 transition hover:bg-white/10 hover:text-white"
          >
            ← 返回首页
          </button>
          <div className="flex items-center gap-4">
            <img
              src={`/phonics-hero.jpeg?v=${COVER_V}`} alt=""
              className="hidden h-20 w-32 shrink-0 rounded-2xl object-cover shadow-lg ring-2 ring-white/40 sm:block"
            />
            <div className="min-w-0">
              <h1 className="font-display text-2xl font-bold text-white sm:text-3xl">
                🔊 音标学习
              </h1>
              <p className="mt-1.5 text-sm leading-relaxed text-white/95 sm:text-base">
                看懂音标，就能自己拼读，听写更稳，背词也更快。建议先从“入门”开始。
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-5 py-6">
        {/* 教材练习入口:放在搜索之上、视频列表之前 —— 练习比看视频更该被看见。
            CLAUDE.md 硬性要求「至少一个一眼能看到的入口,不能只藏在二级页面」 */}
        <button
          onClick={() => navigate('/student/phonetics/textbook')}
          className="mb-5 flex w-full items-center gap-4 rounded-2xl bg-gradient-to-r
                     from-orange-500 to-amber-500 p-4 text-left text-white shadow-lg
                     transition active:scale-[0.99]"
        >
          <span className="text-3xl">📖</span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-lg font-bold">音标练习 · 专用教材第1册</span>
            <span className="mt-0.5 block text-sm text-white/90">
              48 节 · 看音标读出来 + 卡片写音标
            </span>
          </span>
          <span className="shrink-0 text-xl">→</span>
        </button>

        {/* 老师筛选条:选自己的老师听他讲的课。
            只有一位讲师时整条不显示 —— 没得选的筛选器只是噪音。
            min-h-11 是触摸目标下限(44px),手机上一排 chip 最容易点错 */}
        {lecturerOptions.length >= 2 && (
          <div className="mb-4">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="text-xs font-semibold text-ink-soft">选老师</span>
              {lecturer && (
                <span className="text-[11px] text-ink-mute">已记住,下次进来还是这位</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => pickLecturer('')}
                aria-pressed={lecturer === ''}
                className={`min-h-11 rounded-full px-4 py-2 text-xs font-medium transition ${
                  lecturer === '' ? 'bg-accent-warm text-white' : 'bg-black/5 text-ink-soft hover:bg-black/10'
                }`}
              >
                全部
              </button>
              {lecturerOptions.map((o) => (
                <button
                  type="button"
                  key={o.value}
                  /* 点已选中的那个不清空:老师是"我跟谁上课"的身份选择,
                     不是可有可无的筛选标签 —— 误触清空会让孩子莫名看到别人的课。
                     要看全部有专门的「全部」chip */
                  onClick={() => pickLecturer(o.value)}
                  aria-pressed={lecturer === o.value}
                  className={`min-h-11 rounded-full px-4 py-2 text-xs font-medium transition ${
                    lecturer === o.value ? 'bg-accent-warm text-white' : 'bg-black/5 text-ink-soft hover:bg-black/10'
                  }`}
                >
                  {o.label}
                  <span className="ml-1.5 font-numeric opacity-70">{o.count}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 存的老师不在了 → 已自动落回全部。不说这一句,学生只会看到"内容变多了"莫名其妙。
            **故意放在筛选条外面**:老师被删光时选项可能不足 2 个、筛选条整条不渲染,
            而恰恰那时候最需要这句解释 */}
        {lecturerGone && (
          <p className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
            你之前选的老师现在没有视频了，已经先给你显示全部。可以在上面重新挑一位。
          </p>
        )}

        {/* 搜索 */}
        {videos.length > 0 && (
          <div className="mb-5">
            <input
              type="search"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索音标或视频标题,如 /æ/、元音"
              aria-label="搜索音标视频"
              className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm focus:border-primary focus:outline-none"
            />
          </div>
        )}

        {loading && (
          <div className="py-16 text-center text-ink-mute">加载中…</div>
        )}

        {!loading && error && (
          <div className="card-soft rounded-2xl px-5 py-8 text-center" role="alert">
            <p className="font-semibold text-ink">音标视频暂时没打开</p>
            <p className="mt-2 text-sm text-ink-soft">{error}</p>
            <button
              type="button"
              onClick={() => setReloadKey((key) => key + 1)}
              className="btn-glow mt-5 inline-flex min-h-11 items-center justify-center rounded-xl px-5 text-sm font-semibold text-white"
            >
              再试一次
            </button>
          </div>
        )}

        {!loading && !error && videos.length === 0 && (
          <div className="card-soft rounded-3xl px-6 py-14 text-center">
            <p className="text-4xl">🎬</p>
            <p className="mt-3 font-display text-lg font-semibold text-ink">老师还没上传音标视频</p>
            <p className="mt-1 text-sm text-ink-mute">新视频发布后会显示在这里，现在可以先回书架学习。</p>
            <button
              type="button"
              onClick={() => navigate('/student/dashboard')}
              className="btn-glow mt-5 inline-flex min-h-11 items-center justify-center rounded-xl px-5 text-sm font-semibold text-white"
            >
              返回我的书架
            </button>
          </div>
        )}

        {/* 空结果:必须说清是**哪个**条件筛空的,并给出对应的那一个出口。
            加了老师筛选后,"没有视频"多了一个原因 —— 一律说成"换个词试试"
            会让选了老师却没搜索的学生对着一句不相干的提示发呆 */}
        {!loading && !error && videos.length > 0 && filtered.length === 0 && (
          <div className="card-soft rounded-3xl px-6 py-12 text-center text-ink-mute">
            {keyword && lecturer ? (
              <>
                <p>
                  {lecturer === NO_LECTURER ? '「全校通用」' : `${lecturer}的课里`}
                  没有「{keyword}」相关的视频。
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => setKeyword('')}
                    className="inline-flex min-h-11 items-center justify-center rounded-xl bg-orange-50 px-5 text-sm font-semibold text-accent-warm transition hover:bg-orange-100"
                  >
                    清空搜索
                  </button>
                  <button
                    type="button"
                    onClick={() => pickLecturer('')}
                    className="inline-flex min-h-11 items-center justify-center rounded-xl bg-black/5 px-5 text-sm font-semibold text-ink-soft transition hover:bg-black/10"
                  >
                    搜全部老师的课
                  </button>
                </div>
              </>
            ) : keyword ? (
              <>
                <p>没有找到「{keyword}」相关的视频，换个词试试。</p>
                <button
                  type="button"
                  onClick={() => setKeyword('')}
                  className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-orange-50 px-5 text-sm font-semibold text-accent-warm transition hover:bg-orange-100"
                >
                  清空搜索
                </button>
              </>
            ) : (
              <>
                <p>
                  {lecturer === NO_LECTURER ? '「全校通用」还没有视频。' : `${lecturer}还没有上传视频。`}
                </p>
                <button
                  type="button"
                  onClick={() => pickLecturer('')}
                  className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-orange-50 px-5 text-sm font-semibold text-accent-warm transition hover:bg-orange-100"
                >
                  先看看全部
                </button>
              </>
            )}
          </div>
        )}

        <div className="space-y-7">
          {groups.map((g) => (
            <section key={g.category} aria-labelledby={`grp-${g.category}`}>
              <h2 id={`grp-${g.category}`} className="mb-3 flex items-center gap-2 font-display text-lg font-bold text-ink">
                <span>{GROUP_ICON[g.category]}</span>
                {CATEGORY_LABELS[g.category]}
                <span className="text-xs font-normal text-ink-mute">{g.items.length} 个视频</span>
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {g.items.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => openVideo(v)}
                    className="group card-soft overflow-hidden rounded-2xl text-left transition hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <div className="relative h-32 overflow-hidden">
                      {/* 没有自定义封面时按**分类**取图(元音/辅音/入门/其他 各一张),
                          不用同一张 hero 图 —— 一屏十几张一样的图等于没有信息。
                          分类图 + 左上角音标标签,既好看又能一眼区分。 */}
                      <img
                        src={v.cover_image || CATEGORY_COVER[v.category] || CATEGORY_COVER.other}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                      />
                      {/* 播放按钮放左下角:正中会盖住配图主体和音标标签 */}
                      <span className="absolute bottom-2 left-2 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-sm text-white backdrop-blur-sm transition group-hover:bg-primary">
                        ▶
                      </span>
                      {v.phonetic_symbol && (
                        <span className="absolute left-2 top-2 rounded-lg bg-white/90 px-2 py-0.5 font-mono text-sm shadow-sm">
                          {/* 元音橙色加粗、辅音蓝色 —— 与 ColoredPhonetic(单词卡/分类各阶段)
                              和答题格同一套口径:元音是拼读的教学点,一眼要能挑出来。
                              这里不用 ColoredPhonetic:它按音节铺底色气泡,而角标通常只有
                              一两个音素,气泡壳子比音标本身还大 */}
                          {segmentIpa(v.phonetic_symbol).map((seg, i) => (
                            <span
                              key={i}
                              className={
                                seg.kind === 'vowel'
                                  ? 'font-extrabold text-orange-600'
                                  : seg.kind === 'consonant'
                                    ? 'font-semibold text-sky-600'
                                    : 'text-gray-400'
                              }
                            >
                              {seg.text}
                            </span>
                          ))}
                        </span>
                      )}
                      {formatDuration(v.duration_seconds) && (
                        <span className="absolute bottom-2 right-2 rounded bg-black/60 px-1.5 py-0.5 font-numeric text-[11px] text-white">
                          {formatDuration(v.duration_seconds)}
                        </span>
                      )}
                    </div>
                    <div className="p-3.5">
                      <p className="truncate font-semibold text-ink" title={v.title}>{v.title}</p>
                      {/* 讲师:**只在没筛老师时显示** —— 选定了王老师之后,每张卡都写
                          「王老师」是纯重复。没筛时它是关键信息:一屏混着几位老师的课,
                          分不清谁讲的就等于没分类 */}
                      {!lecturer && v.lecturer && (
                        <p className="mt-1 truncate text-xs font-medium text-accent-warm">
                          {v.lecturer}
                        </p>
                      )}
                      {v.description && (
                        <p className="mt-1 line-clamp-2 text-xs text-ink-mute">{v.description}</p>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      {/* 第一次进来问一次「你是跟哪位老师上课?」,选完记住不再问。
          z-[70] 同播放弹层:要盖过底部导航(z-60)与宠物浮标(z-50)。
          **不给关闭 X** —— 但给「先都看看」这个明确出口(它也算选过,存空串):
          一个能被右上角叉掉的问句,孩子叉了就再也不知道这里能选老师 */}
      <AnimatePresence>
        {askLecturer && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-4 sm:items-center"
            role="dialog" aria-modal="true" aria-label="选择老师"
          >
            <motion.div
              initial={{ y: 24, scale: 0.96 }} animate={{ y: 0, scale: 1 }} exit={{ y: 24, opacity: 0 }}
              /* ⚠️ 必须是「限高 + 内层滚动 + 页脚 shrink-0」的三段式,不能整块自由长高:
                 讲师 4 位时面板要 464px,而横屏手机(iPhone SE 667×375)可用高只有 343px。
                 而 `sm:` 按**宽度**命中 → 横屏走 items-center → 上下同时溢出,
                 「先都看看」和前几位讲师一起被切到视口外。而这个弹层是刻意全封闭的
                 (backdrop 不可点、无关闭 X),出口正是那两样东西 —— 溢出就等于把学生
                 锁在音标页外面,重开还会再弹一次同样的死弹层。
                 页脚放在滚动区外面,不管几位讲师它都在屏幕上。
                 同款三段式见 components/WhatsNewNudge.tsx 与 MaterialManagerDialog */
              className="flex max-h-[88dvh] w-full max-w-md flex-col overflow-hidden rounded-3xl bg-white p-5 shadow-2xl"
            >
              <p className="shrink-0 font-display text-lg font-bold text-ink">你是跟哪位老师上课？</p>
              <p className="mt-1 shrink-0 text-sm text-ink-soft">
                选一位，以后进来就直接看他的课。随时可以在顶部换。
              </p>
              <div className="mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto">
                {lecturerOptions.filter((o) => o.value !== NO_LECTURER).map((o) => (
                  <button
                    type="button"
                    key={o.value}
                    onClick={() => pickLecturer(o.value)}
                    className="flex min-h-11 w-full items-center gap-3 rounded-2xl border border-gray-200 px-4 py-3
                               text-left transition hover:border-accent-warm hover:bg-orange-50 active:scale-[0.99]"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-warm/15 text-base font-bold text-accent-warm">
                      {o.label.slice(0, 1)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-ink">{o.label}</span>
                      <span className="text-xs text-ink-mute">{o.count} 个视频</span>
                    </span>
                    <span className="shrink-0 text-ink-mute">→</span>
                  </button>
                ))}
              </div>
              {/* 页脚 shrink-0 且在滚动区**外面**:讲师再多它也不会被挤出屏幕。
                  这是本弹层唯一的"不选"出口,丢了它就等于把学生锁死 */}
              <button
                type="button"
                onClick={() => pickLecturer('')}
                className="mt-3 min-h-11 w-full shrink-0 rounded-2xl bg-black/5 px-4 text-sm font-semibold text-ink-soft transition hover:bg-black/10"
              >
                先都看看
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 播放弹层。
          z-[70]:要盖过学生端底部导航(z-60)和宠物浮标(z-50),否则竖屏手机上
          讲义的翻页条会被底部导航压住。
          讲义打开时视频**不暂停、不被盖住** —— 老师讲到哪页、学生手边翻到哪页,
          两样是一起看的;横屏/桌面左右分栏,竖屏手机视频钉顶、讲义占下方 */}
      <AnimatePresence>
        {playing && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-2 sm:p-4"
            onClick={() => setPlaying(null)}
          >
            <motion.div
              ref={panelRef}
              initial={{ scale: 0.94, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.94, opacity: 0 }}
              className={viewing
                // 讲义打开:面板撑到近全屏、固定高度 —— 讲义要铺满整个舞台才看得清字。
                // 宽度别卡 max-w-6xl(1152):1366 的屏就浪费了 200 多像素
                ? 'flex h-[min(96vh,calc(100dvh-0.75rem))] w-[min(98vw,1600px)] flex-col overflow-hidden rounded-2xl bg-slate-900 shadow-2xl'
                : 'w-full max-w-3xl overflow-hidden rounded-2xl bg-slate-900 shadow-2xl'}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3">
                <p className="min-w-0 truncate font-semibold text-white">{playing.title}</p>
                <button
                  onClick={() => setPlaying(null)}
                  aria-label="关闭视频"
                  className="shrink-0 rounded-lg bg-white/10 px-3 py-1 text-sm text-white hover:bg-white/20"
                >
                  ✕ 关闭
                </button>
              </div>

              {/* 舞台:<video> 住在这里,不管有没有讲义都是同一个元素 */}
              <LessonStage
                video={playing}
                materials={materials}
                viewing={viewing}
                onViewing={setViewing}
                panelRef={panelRef}
              />

              {!viewing && (
                <>
                  {playing.description && (
                    <p className="px-4 py-3 text-sm leading-relaxed text-slate-300">{playing.description}</p>
                  )}

                  {/* 配套讲义:老师上传的 PPT/PDF,渲染成图。没有讲义时整块不出现,
                      不摆一个"暂无讲义"的空状态占地方 */}
                  {materials.length > 0 && (
                    <div className="border-t border-white/10 px-4 py-3">
                      <p className="mb-2 text-xs text-slate-400">老师的讲义 · 点开后讲义铺满、视频缩到角上,一起看</p>
                      <div className="flex flex-wrap gap-2">
                        {materials.map((m) => (
                          <button
                            key={m.id}
                            onClick={() => setViewing(m)}
                            className="flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-left
                                       text-sm text-white transition hover:bg-white/20 active:scale-[0.98]"
                          >
                            <FileText className="h-4 w-4 shrink-0 text-orange-300" />
                            <span className="min-w-0 truncate">{m.title}</span>
                            <span className="shrink-0 text-xs text-slate-400">{m.page_count} 页</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
