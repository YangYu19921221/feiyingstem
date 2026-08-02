/**
 * 音标学习 — 学生端
 *
 * 音标是英语的基础(拼读、听写、背单词全建立在它上面),所以这个页面的定位是
 * 「先把音标看明白」:顶部一句话说清为什么重要,下面按 入门→元音→辅音 分组列视频。
 *
 * 播放走鉴权串流端点(见 api/phonetics.playableUrl):<video> 带不了请求头,
 * 所以 token 放 query 上。
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  phoneticsApi, playableUrl, CATEGORY_LABELS,
  type PhoneticVideo, type PhoneticCategory,
} from '../api/phonetics';
import { getErrorMessage } from '../utils/errorMessage';

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

export default function PhoneticsHub() {
  const navigate = useNavigate();
  const [videos, setVideos] = useState<PhoneticVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [keyword, setKeyword] = useState('');
  const [playing, setPlaying] = useState<PhoneticVideo | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

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

  // 搜索在前端做:音标视频量级是几十个,一次取回后本地过滤最快,不用每次敲字都打后端
  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return videos;
    return videos.filter((v) =>
      v.title.toLowerCase().includes(kw)
      || (v.phonetic_symbol || '').toLowerCase().includes(kw)
      || (v.description || '').toLowerCase().includes(kw));
  }, [videos, keyword]);

  const groups = useMemo(() => {
    return GROUP_ORDER
      .map((c) => ({ category: c, items: filtered.filter((v) => v.category === c) }))
      .filter((g) => g.items.length > 0);
  }, [filtered]);

  const openVideo = async (v: PhoneticVideo) => {
    setPlaying(v);
    // 记一次观看(失败不影响播放)
    try { await phoneticsApi.detail(v.id); } catch { /* 计数失败无所谓 */ }
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

        {!loading && !error && videos.length > 0 && filtered.length === 0 && (
          <div className="card-soft rounded-3xl px-6 py-12 text-center text-ink-mute">
            <p>没有找到「{keyword}」相关的视频，换个词试试。</p>
            <button
              type="button"
              onClick={() => setKeyword('')}
              className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-orange-50 px-5 text-sm font-semibold text-accent-warm transition hover:bg-orange-100"
            >
              清空搜索
            </button>
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
                        <span className="absolute left-2 top-2 rounded-lg bg-white/90 px-2 py-0.5 font-mono text-sm font-bold text-primary shadow-sm">
                          {v.phonetic_symbol}
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

      {/* 播放弹层 */}
      <AnimatePresence>
        {playing && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
            onClick={() => setPlaying(null)}
          >
            <motion.div
              initial={{ scale: 0.94, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.94, opacity: 0 }}
              className="w-full max-w-3xl overflow-hidden rounded-2xl bg-slate-900 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <p className="min-w-0 truncate font-semibold text-white">{playing.title}</p>
                <button
                  onClick={() => setPlaying(null)}
                  aria-label="关闭视频"
                  className="shrink-0 rounded-lg bg-white/10 px-3 py-1 text-sm text-white hover:bg-white/20"
                >
                  ✕ 关闭
                </button>
              </div>
              <video
                key={playing.id}
                src={playableUrl(playing)}
                controls
                autoPlay
                controlsList="nodownload"
                className="max-h-[70vh] w-full bg-black"
              >
                你的浏览器不支持视频播放,请换用 Chrome 或 Safari
              </video>
              {playing.description && (
                <p className="px-4 py-3 text-sm leading-relaxed text-slate-300">{playing.description}</p>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
