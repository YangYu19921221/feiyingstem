/**
 * 纸笔听写:App 报词 → 学生在纸上手写 → 拍照 → AI 批改 → 确认保存成绩
 *
 * 判分是服务端「盲转写 + 代码比对」,前端只展示结果;
 * 保存走 submitReliably 的 /student/records(mode='handwriting'),
 * 掌握度/日历/成就与其他模式同源。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Camera, Printer, Volume2 } from 'lucide-react';
import useGoBack from '../hooks/useGoBack';
import { startLearning } from '../api/progress';
import type { StartLearningResponse } from '../api/progress';
import { updateProgress } from '../api/progress';
import { createLearningRecords } from '../api/learningRecords';
import { gradeHandwriting } from '../api/handwriting';
import type { HandwritingGradeResponse } from '../api/handwriting';
import { useAudio } from '../hooks/useAudio';
import { toast } from '../components/Toast';
import { getErrorMessage } from '../utils/errorMessage';
import { getGroupSize, splitIntoGroups } from '../utils/groupSize';

type Phase = 'intro' | 'dictate' | 'photo' | 'grading' | 'result' | 'saved';

// 单题作答计时封顶(与后端 time_spent 脏值封顶口径一致)
const PER_WORD_MS_CAP = 120_000;

/** 拍照原图可能十几 MB,压到长边 ≤1600px 的 JPEG 再上传(识别足够,流量省 10 倍) */
async function compressImage(file: File, maxDim = 1600, quality = 0.85): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('图片读取失败'));
      im.src = url;
    });
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', quality));
    if (!blob) throw new Error('图片处理失败');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function HandwritingDictation() {
  const { unitId } = useParams<{ unitId: string }>();
  const navigate = useNavigate();
  const goBack = useGoBack('/student/dashboard');
  const { playAudio } = useAudio();

  const [learningData, setLearningData] = useState<StartLearningResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [phase, setPhase] = useState<Phase>('intro');
  const [groupIndex, setGroupIndex] = useState(0);
  const [index, setIndex] = useState(0);
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [gradeResp, setGradeResp] = useState<HandwritingGradeResponse | null>(null);
  const [saving, setSaving] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  // 逐题作答毫秒数(word_id → ms),报下一题时结算
  const timesRef = useRef<Record<number, number>>({});
  const wordStartRef = useRef<number>(0);

  useEffect(() => {
    if (!unitId) return;
    (async () => {
      try {
        const data = await startLearning({ unit_id: parseInt(unitId), learning_mode: 'handwriting' });
        if (!data.words.length) {
          setError(data.message || '该单元暂时没有单词');
        } else {
          setLearningData(data);
        }
      } catch (e: unknown) {
        setError(getErrorMessage(e, '加载失败'));
      } finally {
        setLoading(false);
      }
    })();
  }, [unitId]);

  // 预览图 URL 生命周期
  useEffect(() => {
    return () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
    };
  }, [photoUrl]);

  // 必须分组:生产单元词数中位数 51-100、最大 147,一次听写整单元没有孩子做得完,
  // 而且后端单次批改上限 100 题(>100 词的单元会直接 422)。分组规则与分类学习同源。
  const groups = useMemo(() => {
    const all = learningData?.words ?? [];
    if (!all.length) return [];
    const size = getGroupSize(learningData?.unit_info.grade_level, learningData?.unit_info.group_size);
    return splitIntoGroups(all, size);
  }, [learningData]);

  const words = groups[groupIndex] ?? [];
  const current = words[index];
  // 本组第一题在整单元里的序号(打印纸与报词页共用同一套题号)
  const groupStartNo = useMemo(
    () => groups.slice(0, groupIndex).reduce((n, g) => n + g.length, 0),
    [groups, groupIndex],
  );

  const playCurrent = (rate = 1.0) => {
    if (current) playAudio(current.word, rate, current.id);
  };

  // 进入新题:自动报一遍 + 起计时
  useEffect(() => {
    if (phase !== 'dictate' || !current) return;
    wordStartRef.current = Date.now();
    playAudio(current.word, 1.0, current.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, index]);

  const settleCurrentTime = () => {
    if (!current) return;
    const ms = Math.min(Date.now() - wordStartRef.current, PER_WORD_MS_CAP);
    timesRef.current[current.id] = ms;
  };

  const handleNextWord = () => {
    settleCurrentTime();
    if (index < words.length - 1) {
      setIndex(index + 1);
    } else {
      setPhase('photo');
    }
  };

  const handlePickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 允许重选同一张
    if (!file) return;
    try {
      const blob = await compressImage(file);
      if (photoUrl) URL.revokeObjectURL(photoUrl);
      setPhotoBlob(blob);
      setPhotoUrl(URL.createObjectURL(blob));
    } catch {
      toast.error('照片处理失败,请重新拍一张');
    }
  };

  const handleGrade = async () => {
    if (!photoBlob) return;
    setPhase('grading');
    try {
      const resp = await gradeHandwriting(words.map((w) => w.id), photoBlob);
      setGradeResp(resp);
      setPhase('result');
    } catch (e: unknown) {
      toast.error(getErrorMessage(e, 'AI 批改失败,请重试'));
      setPhase('photo');
    }
  };

  // 确认成绩后才落库(重拍重批不会产生重复记录)
  const handleSave = async () => {
    if (!gradeResp || !unitId || saving) return;
    setSaving(true);
    try {
      const records = gradeResp.results.map((r) => ({
        word_id: r.word_id,
        is_correct: r.is_correct,
        time_spent: timesRef.current[r.word_id] ?? 5000,
        learning_mode: 'handwriting',
        user_answer: r.is_correct ? undefined : (r.written.slice(0, 80) || undefined),
      }));
      // 只累计本组耗时:timesRef 跨组累积,直接求和会把前几组的时间重复计入日历
      const sessionSeconds = Math.round(
        words.reduce((sum, w) => sum + (timesRef.current[w.id] ?? 0), 0) / 1000
      );
      await createLearningRecords({
        unit_id: parseInt(unitId),
        learning_mode: 'handwriting',
        records,
        session_seconds: sessionSeconds,
      });
      // 游标必须是整单元的全局下标(不是组内下标),否则断点续学永远回到第一组。
      // is_completed 只在最后一组交卷时才置 true。
      const isLastGroup = groupIndex >= groups.length - 1;
      updateProgress({
        unit_id: parseInt(unitId),
        learning_mode: 'handwriting',
        current_word_index: groupStartNo + words.length - 1,
        is_completed: isLastGroup,
      }).catch(() => {});
      setPhase('saved');
    } catch (e: unknown) {
      // submitReliably 已入队补交,这里只是提示;成绩不会丢
      toast.warning(getErrorMessage(e, '网络不稳,成绩已保存到本机,联网后自动上传'));
      setPhase('saved');
    } finally {
      setSaving(false);
    }
  };

  const clearPhoto = () => {
    setPhotoBlob(null);
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoUrl(null);
  };

  /** 重听本组 */
  const restart = () => {
    setIndex(0);
    setGradeResp(null);
    clearPhoto();
    setPhase('dictate');
  };

  /** 进入下一组(交完卷才可用) */
  const nextGroup = () => {
    setGroupIndex((g) => Math.min(g + 1, groups.length - 1));
    setIndex(0);
    setGradeResp(null);
    clearPhoto();
    setPhase('intro');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
          <p className="text-gray-500 mt-4">加载纸笔听写...</p>
        </div>
      </div>
    );
  }

  if (error || !learningData) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center">
        <div className="text-center px-6">
          <span className="text-6xl mb-4 block">😞</span>
          <p className="text-gray-500">{error || '加载失败'}</p>
          <button onClick={() => goBack()} className="mt-4 min-h-11 rounded-xl bg-primary px-5 font-semibold text-white">
            返回
          </button>
        </div>
      </div>
    );
  }

  const accuracy = gradeResp && gradeResp.total > 0
    ? Math.round((gradeResp.correct_count / gradeResp.total) * 100)
    : 0;
  const wrongResults = gradeResp?.results.filter((r) => !r.is_correct) ?? [];

  return (
    <div className="min-h-screen bg-paper">
      <nav className="bg-white/95 border-b border-slate-200/80 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-4">
          <button
            onClick={() => goBack()}
            className="flex h-11 w-11 items-center justify-center rounded-xl transition hover:bg-orange-50"
            aria-label="返回"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-gray-800">📝 纸笔听写</h1>
            <p className="text-xs text-gray-500">
              {learningData.unit_info.name}
              {groups.length > 1 && ` · 第 ${groupIndex + 1}/${groups.length} 组`}
              {' · '}{words.length} 个单词
            </p>
          </div>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-4 py-6">
        {/* 准备阶段 */}
        {phase === 'intro' && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 max-w-md mx-auto">
            <div className="text-5xl mb-4 text-center">✍️</div>
            <h2 className="text-xl font-bold text-gray-800 text-center mb-2">准备好纸和笔</h2>
            {groups.length > 1 && (
              <p className="mb-4 text-center text-sm text-gray-500">
                这个单元共 {learningData.words.length} 个词，分 {groups.length} 组听写。
                本组是第 <span className="font-semibold text-gray-700">{groupStartNo + 1}~{groupStartNo + words.length}</span> 题。
              </p>
            )}
            <ol className="text-sm text-gray-600 space-y-2 mb-6 list-decimal list-inside">
              <li>在纸上写好序号 {groupStartNo + 1}~{groupStartNo + words.length}(或打印答题纸)</li>
              <li>听发音,把单词写在对应序号后面</li>
              <li>写完把整页拍一张照,AI 自动批改</li>
            </ol>
            <button
              onClick={() => setPhase('dictate')}
              className="w-full py-3 bg-primary text-white font-bold rounded-xl hover:opacity-90 transition"
            >
              开始听写
            </button>
            <button
              onClick={() => navigate(`/student/units/${unitId}/handwriting-sheet`)}
              className="mt-3 w-full min-h-11 rounded-xl border border-slate-200 font-medium text-gray-600 hover:bg-slate-50 transition flex items-center justify-center gap-2"
            >
              <Printer className="w-4 h-4" /> 打印答题纸
            </button>
          </div>
        )}

        {/* 报词阶段:不显示单词,只出声音 */}
        {phase === 'dictate' && current && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-10 max-w-md mx-auto text-center">
            {/* 题号用整单元全局序号,与打印纸一致 —— 分组后若显示组内序号,
                第 2 组会又从「第 1 题」开始,和纸上的 21、22… 对不上 */}
            <p className="text-sm text-gray-400 mb-1">
              第 {groupStartNo + index + 1} 题 · 本组 {index + 1}/{words.length}
            </p>
            <div className="h-1.5 bg-gray-100 rounded-full mb-8 overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{ width: `${((index + 1) / words.length) * 100}%` }}
              />
            </div>
            <button
              onClick={() => playCurrent(1.0)}
              className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition active:scale-95"
              aria-label="重播发音"
            >
              <Volume2 className="w-10 h-10" />
            </button>
            <p className="text-gray-500 text-sm mt-4 mb-8">
              把听到的单词写在纸上第 <span className="font-bold text-gray-800">{groupStartNo + index + 1}</span> 题
              <br />
              <span className="text-xs text-gray-400">点喇叭可以再听一遍</span>
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => playCurrent(0.75)}
                className="flex-1 min-h-12 rounded-xl border border-slate-200 font-medium text-gray-600 hover:bg-slate-50 transition"
              >
                🐢 慢速
              </button>
              <button
                onClick={handleNextWord}
                className="flex-[2] min-h-12 rounded-xl bg-primary text-white font-bold hover:opacity-90 transition"
              >
                {index < words.length - 1 ? '写好了,下一题' : '写完了,去拍照'}
              </button>
            </div>
          </div>
        )}

        {/* 拍照阶段 */}
        {(phase === 'photo' || phase === 'grading') && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 max-w-md mx-auto text-center">
            <h2 className="text-xl font-bold text-gray-800 mb-2">拍下你的答题纸</h2>
            <p className="text-sm text-gray-500 mb-6">整页入镜、光线充足、字迹朝上不歪斜</p>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handlePickPhoto}
              className="hidden"
            />

            {photoUrl ? (
              <img
                src={photoUrl}
                alt="答题纸预览"
                className="w-full max-h-80 object-contain rounded-xl border border-slate-200 mb-6 bg-slate-50"
              />
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-48 rounded-xl border-2 border-dashed border-slate-300 flex flex-col items-center justify-center gap-2 text-gray-400 hover:border-primary hover:text-primary transition mb-6"
              >
                <Camera className="w-10 h-10" />
                <span className="font-medium">点这里拍照 / 选择照片</span>
              </button>
            )}

            {phase === 'grading' ? (
              <div className="py-3">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                <p className="text-gray-500 text-sm mt-3">AI 正在批改,大约 10 秒...</p>
              </div>
            ) : (
              <div className="flex gap-3">
                {photoUrl && (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex-1 min-h-12 rounded-xl border border-slate-200 font-medium text-gray-600 hover:bg-slate-50 transition"
                  >
                    重拍
                  </button>
                )}
                <button
                  onClick={handleGrade}
                  disabled={!photoBlob}
                  className="flex-[2] min-h-12 rounded-xl bg-primary text-white font-bold hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  开始批改
                </button>
              </div>
            )}
          </div>
        )}

        {/* 批改结果:确认后才保存,重拍不会产生重复记录 */}
        {phase === 'result' && gradeResp && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 max-w-md mx-auto">
            <div className="text-center mb-5">
              <div className="text-5xl mb-2">{accuracy >= 80 ? '🎉' : accuracy >= 60 ? '👍' : '💪'}</div>
              <div className={`text-4xl font-bold ${accuracy >= 80 ? 'text-green-500' : accuracy >= 60 ? 'text-blue-500' : 'text-orange-500'}`}>
                {accuracy}%
              </div>
              <p className="text-gray-500 text-sm mt-1">
                答对 {gradeResp.correct_count}/{gradeResp.total} 个单词
              </p>
            </div>

            <div className="max-h-72 overflow-y-auto mb-5 divide-y divide-gray-100">
              {gradeResp.results.map((r, i) => (
                <div key={r.word_id} className="flex items-center gap-3 py-2 text-sm">
                  <span className="w-7 shrink-0 text-right font-mono text-gray-400">{groupStartNo + i + 1}.</span>
                  <span className={r.is_correct ? 'text-green-500' : 'text-red-400'}>
                    {r.is_correct ? '✓' : '✗'}
                  </span>
                  <span className="font-semibold text-gray-800">{r.word}</span>
                  {!r.is_correct && (
                    <span className="ml-auto text-xs text-gray-400 truncate">
                      {r.written ? `你写的: ${r.written}` : '没写 / 没认出'}
                    </span>
                  )}
                </div>
              ))}
            </div>

            <p className="text-xs text-gray-400 text-center mb-4">
              AI 没认对?可以重拍一张再批改,确认后才计入成绩
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => { setGradeResp(null); setPhase('photo'); }}
                className="flex-1 min-h-12 rounded-xl border border-slate-200 font-medium text-gray-600 hover:bg-slate-50 transition"
              >
                重拍重批
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-[2] min-h-12 rounded-xl bg-primary text-white font-bold hover:opacity-90 transition disabled:opacity-50"
              >
                {saving ? '保存中...' : '确认,保存成绩'}
              </button>
            </div>
          </div>
        )}

        {/* 已保存 */}
        {phase === 'saved' && gradeResp && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 max-w-md mx-auto text-center">
            <div className="text-5xl mb-3">✅</div>
            <h2 className="text-2xl font-bold text-gray-800 mb-1">成绩已保存</h2>
            <p className="text-gray-500 text-sm mb-6">
              正确率 {accuracy}%,错的 {wrongResults.length} 个已进入薄弱词
            </p>
            {wrongResults.length > 0 && (
              <div className="text-left mb-6 max-h-40 overflow-y-auto bg-slate-50 rounded-xl p-3">
                <p className="text-xs font-medium text-gray-500 mb-2">错词回顾:</p>
                {wrongResults.map((r) => (
                  <div key={r.word_id} className="flex items-center gap-2 py-1 text-sm">
                    <span className="text-red-400">✗</span>
                    <span className="font-medium text-gray-800">{r.word}</span>
                    {r.written && <span className="text-xs text-gray-400">你写的: {r.written}</span>}
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-col gap-3">
              {groupIndex < groups.length - 1 && (
                <button
                  onClick={nextGroup}
                  className="w-full py-3 bg-primary text-white font-bold rounded-xl transition hover:opacity-90"
                >
                  继续下一组(第 {groupIndex + 2}/{groups.length} 组)
                </button>
              )}
              <button
                onClick={restart}
                className="min-h-12 w-full rounded-xl bg-sky-600 font-bold text-white transition hover:bg-sky-700"
              >
                重听本组
              </button>
              <button
                onClick={() => goBack()}
                className="min-h-12 w-full rounded-xl bg-gray-100 font-medium text-gray-600"
              >
                返回
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
