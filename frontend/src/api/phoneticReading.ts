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
  /** 老师指定的发音(cede 读 seed)。「听标准音」按它读;没指定 = 按单词读 */
  tts_text?: string | null;
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
   * 判定真源 backend/app/services/phoneme_closed_set.judge(2026-10-30 起先过两道门):
   *   拦 —— not_close  读得不像这个音标(乱读 / 说中文 / 只「啊」一声)
   *         wrong_word 明显读成了本节另一个词(heard 是那个词)
   *   放 —— pass       读对了
   *         confused   过了门槛,但另一个词更像一点(只当提示,不拦)
   *         uncertain  判不准
   * 另有两种不来自模型:silent=前端 VAD 没听到人声 / off=判定服务不可用(放过)。
   * not_speech 是 10-30 之前的旧值,新判定不再发,留着只为页面没刷新时也认。
   *
   * 刻意没有分数:分数会被当成评价,而这个判定只够决定「要不要变绿」。
   */
  verdict: 'pass' | 'confused' | 'not_close' | 'wrong_word' | 'not_speech' | 'silent' | 'uncertain' | 'off';
  /** 闭集里得分最高的词。wrong_word / confused 时就是孩子实际念成的那个 */
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
  /**
   * 格子颜色(2026-10-31): green 读对了 / yellow 接近 / red 差得多。只管颜色,过不过关看 verdict。
   * 没声音 / 没判出来时为空(不改颜色)。真源 backend services/phoneme_closed_set.grade
   */
  grade?: 'green' | 'yellow' | 'red' | null;
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
  // 本地判不清时服务器还会请讯飞再判一次(约 2 秒),默认 10 秒不够兜住两段都慢的时候
  return api.post('/phonetic-practice/readings/judge', fd, { timeout: 15000 }) as unknown as Promise<JudgeResult>;
};

/** 孩子读了几次没过,自己点了「我读对了」—— 记在他最后那条录音上(门槛是不是太严的信号) */
export const markSelfPass = (readingId: number): Promise<{ ok: boolean }> =>
  api.post(`/phonetic-practice/readings/${readingId}/self-pass`) as unknown as Promise<{ ok: boolean }>;

/** 录音回放地址。<audio> 带不了请求头,所以走 query token(与音标视频串流同套路) */
export const readingAudioUrl = (readingId: number): string => {
  // key 是 access_token,不是 token —— 全项目统一用这个
  const token = localStorage.getItem('access_token') ?? '';
  return `${API_BASE_URL}/phonetic-practice/readings/${readingId}/audio?token=${encodeURIComponent(token)}`;
};
