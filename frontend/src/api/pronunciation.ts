import { API_BASE_URL } from '../config/env';

const getAuthHeaders = () => {
  const token = localStorage.getItem('access_token');
  return { Authorization: `Bearer ${token}` };
};

export interface PronunciationScore {
  success: boolean;
  total_score: number;
  accuracy: number;
  fluency: number;
  integrity: number;
}

export async function evaluatePronunciation(
  audioBlob: Blob,
  text: string,
  category: string = 'read_word',
): Promise<PronunciationScore> {
  const form = new FormData();
  form.append('audio', audioBlob, 'recording.webm');
  form.append('text', text);
  form.append('category', category);

  const res = await fetch(`${API_BASE_URL}/pronunciation/evaluate`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: form,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || '评测失败');
  }
  return res.json();
}

export async function checkPronunciationConfig(): Promise<boolean> {
  const res = await fetch(`${API_BASE_URL}/pronunciation/config-status`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) return false;
  const data = await res.json();
  return data.configured === true;
}

// Whisper 本地语音校验
export interface WordVerifyResult {
  matched: boolean;
  score: number;
  transcript: string;
  target: string;
  confidence: number;
}

export async function verifyWordPronunciation(
  audioBlob: Blob,
  word: string,
): Promise<WordVerifyResult> {
  const form = new FormData();
  form.append('audio', audioBlob, 'recording.webm');
  form.append('word', word);

  const res = await fetch(`${API_BASE_URL}/pronunciation/verify-word`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: form,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || '语音校验失败');
  }
  return res.json();
}

export async function checkWhisperAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/pronunciation/whisper-status`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data.available === true;
  } catch {
    return false;
  }
}
