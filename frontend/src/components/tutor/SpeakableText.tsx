/**
 * 回答里的英文可以点着听(用全站同一个 Edge TTS 英式女声,不退浏览器朗读)。
 * 提示词里也告诉了模型「点一下回答里的英文就能听标准音」,两边要一致。
 *
 * 按「连着的英文单词」切: She goes 是一段,中文和标点不切进去;单个字母(选项 A / B)不做成可点的。
 *
 * 10-27 改样子(用户「返回可以读的单词,应该有个图标告诉用户可以点击发音」): 以前只是天蓝色虚线下划线,
 * 孩子看不出能点。现在每段英文是一个浅蓝底的小块,前面带小喇叭;点了喇叭跳动一下(知道在读了)。
 * 用 inline + box-decoration-clone,长句子跨行时每行都有底色,不会撑破气泡。
 * hint: 这条回答下面写一句「带小喇叭的英文点一下就能听」,孩子点过一次就不再写(按账号记)。
 * 书名号里的不切(10-27 发文件后): 回答第一行「我看了你发的《Unit3练习卷.docx》」,文件名里的 Unit / docx 不该念。
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Volume2 } from 'lucide-react';
import { speakParts } from '../../utils/speakable';

const SPEAK_MS = 1400;     // 读一个词 / 一句短话大概多久;喇叭跳这么久

function hintKey(): string {
  try {
    return `tutor_speak_hint_${JSON.parse(localStorage.getItem('user') || 'null')?.id ?? ''}`;
  } catch {
    return 'tutor_speak_hint_';
  }
}

function SpeakableText({ text, onSpeak, hint = false }: { text: string; onSpeak: (s: string) => void; hint?: boolean }) {
  const parts = useMemo(() => speakParts(text), [text]);

  const [speaking, setSpeaking] = useState<number | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const [seen, setSeen] = useState(() => {
    try { return localStorage.getItem(hintKey()) === '1'; } catch { return true; }
  });

  const say = (i: number, s: string) => {
    onSpeak(s);
    setSpeaking(i);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setSpeaking(null), SPEAK_MS);
    if (!seen) {
      setSeen(true);
      try { localStorage.setItem(hintKey(), '1'); } catch { /* 隐私模式 */ }
    }
  };

  const hasEn = parts.some((p) => p.en);
  return (
    <>
      {parts.map((p, i) => (p.en ? (
        <button
          key={i}
          type="button"
          onClick={() => say(i, p.s)}
          className={`tutor-speak ${speaking === i ? 'is-speaking' : ''}`}
          aria-label={`听 ${p.s}`}
        >
          <Volume2 className="tutor-speak-icon" aria-hidden="true" />
          {p.s}
        </button>
      ) : (
        <span key={i}>{p.s}</span>
      )))}
      {hint && hasEn && !seen && (
        <span className="mt-2 flex items-center gap-1 text-xs text-sky-700/80">
          <Volume2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          带小喇叭的英文,点一下就能听发音
        </span>
      )}
    </>
  );
}

export default memo(SpeakableText);
