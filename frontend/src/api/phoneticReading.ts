/**
 * 音标跟读 API
 *
 * 第一期**不打分**:实测 whisper 判的是拼写相似度不是发音
 * (bad 的音频去验 bed 判 66 分通过,而 æ/e 正是本教材要教的对立),
 * 机器判错一次孩子就不敢开口。反馈靠对比回放 + 老师抽听。
 */
import api from './client';
import { API_BASE_URL } from '../config/env';

export interface ReadingItem {
  id: number;
  /** 显示给孩子看的音标,如 [bæd] —— 刻意不给拼写,读完才揭示 */
  phonetic: string;
  meaning?: string | null;
  /** 读完之后才显示的单词 */
  word_reveal: string;
}

export interface ReadingLesson {
  id: number;
  code: string;
  title: string;
  items: ReadingItem[];
}

export interface MyReading {
  id: number;
  item_id: number;
  phonetic: string;
  word: string;
  duration_ms?: number | null;
  teacher_mark?: string | null;
  created_at?: string | null;
}

// client.ts 的拦截器已 return response.data,这里不能再解构 { data }
export const fetchReadingLesson = (lessonId: string | number): Promise<ReadingLesson> =>
  api.get(`/phonetic-practice/lessons/${lessonId}/reading`) as unknown as Promise<ReadingLesson>;

export const fetchMyReadings = (lessonId: string | number): Promise<MyReading[]> =>
  api.get(`/phonetic-practice/lessons/${lessonId}/my-readings`) as unknown as Promise<MyReading[]>;

export const uploadReading = (
  itemId: number, blob: Blob, durationMs?: number,
): Promise<{ id: number }> => {
  const fd = new FormData();
  // 后端按内容探测容器,后缀只是装饰;但带对后缀便于人工排查
  const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
  fd.append('audio', blob, `reading.${ext}`);
  fd.append('item_id', String(itemId));
  if (durationMs) fd.append('duration_ms', String(durationMs));
  return api.post('/phonetic-practice/readings', fd) as unknown as Promise<{ id: number }>;
};

export interface JudgeResult {
  /**
   * 闭集判定(services/phoneme_closed_set.py)只出三种:
   *   pass       读对了 → 变绿跳下一个(含「差距太小按读对处理」那一档)
   *   confused   念成了本节另一个词 → 不变绿,明确告诉孩子念成了哪个
   *   not_speech 压根没在读词(静音/噪音/说中文/哼歌)→ 不变绿。
   *              这一档是绝对分数地板(SCORE_FLOOR)判的,专治「乱说也变绿」:
   *              实测非语音得分 -6.8~-7.6,真实读词 -0.1~-2.8,中间空 4 个单位。
   *   uncertain  判不准 → 放过(宁可漏纠,不可假拒绝)
   * 另有两种不来自模型:silent=前端 VAD 没听到人声 / off=判定服务不可用。
   *
   * ⚠️ 曾经写成 near_miss / mismatch,那是**旧 whisper 判定**的字符串,
   * 后端换成闭集打分后再没发过 —— 前端那个 `verdict === 'near_miss'` 分支
   * 于是成了永不触发的死代码,一切都静默按「读了就绿」处理。改这里要连带
   * 改 PhoneticReading.tsx 的分支,两边必须对齐。
   *
   * 刻意没有分数:分数会被当成评价,而这个判定只够决定「要不要变绿」。
   */
  verdict: 'pass' | 'confused' | 'not_speech' | 'silent' | 'uncertain' | 'off';
  /** 闭集里得分最高的词。confused 时就是孩子实际念成的那个 */
  heard?: string | null;
  /**
   * 具体错在哪。目前只有一种:extra_final_vowel = 词尾多带了一个元音
   * (普通话没有词尾塞音,中文母语者读 /bæd/ 容易读成「bei-de」两个音节)。
   *
   * 这比 heard(「更像哪个词」)有用得多 —— 孩子没想读 daff,
   * 他想读 bad 只是收音时拖了个尾巴。这个错能讲清、也能练掉。
   * 判据实测:真人录音 11/11 检出,Edge TTS 标准音 0/12 假阳性。
   * 给不出就是 null,那时才退回显示 heard。
   */
  error_code?: string | null;
  error_hint?: string | null;
  reason?: string | null;
  reading_id?: number | null;
}

/** 判「这个音标读对了没」+ 留档给老师抽听 */
export const judgeReading = (
  itemId: number, blob: Blob, durationMs?: number,
): Promise<JudgeResult> => {
  const fd = new FormData();
  const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
  fd.append('audio', blob, `reading.${ext}`);
  fd.append('item_id', String(itemId));
  if (durationMs) fd.append('duration_ms', String(durationMs));
  return api.post('/phonetic-practice/readings/judge', fd) as unknown as Promise<JudgeResult>;
};

/** 录音回放地址。<audio> 带不了请求头,所以走 query token(与音标视频串流同套路) */
export const readingAudioUrl = (readingId: number): string => {
  // key 是 access_token,不是 token —— 全项目统一用这个
  const token = localStorage.getItem('access_token') ?? '';
  return `${API_BASE_URL}/phonetic-practice/readings/${readingId}/audio?token=${encodeURIComponent(token)}`;
};
