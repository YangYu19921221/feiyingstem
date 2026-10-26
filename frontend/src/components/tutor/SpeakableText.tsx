/**
 * 回答里的英文可以点着听(用全站同一个 Edge TTS 英式女声,不退浏览器朗读)。
 * 提示词里也告诉了模型「点一下回答里的英文就能听标准音」,两边要一致。
 *
 * 按「连着的英文单词」切: She goes 是一段,中文和标点不切进去;单个字母(选项 A / B)不做成可点的。
 */
import { memo, useMemo } from 'react';

const EN_RUN = /[A-Za-z][A-Za-z'’-]*(?: [A-Za-z][A-Za-z'’-]*)*/g;

function SpeakableText({ text, onSpeak }: { text: string; onSpeak: (s: string) => void }) {
  const parts = useMemo(() => {
    const out: Array<{ en: boolean; s: string }> = [];
    let last = 0;
    for (const m of text.matchAll(EN_RUN)) {
      const i = m.index ?? 0;
      if (i > last) out.push({ en: false, s: text.slice(last, i) });
      out.push({ en: m[0].length >= 2, s: m[0] });
      last = i + m[0].length;
    }
    if (last < text.length) out.push({ en: false, s: text.slice(last) });
    return out;
  }, [text]);

  return (
    <>
      {parts.map((p, i) => (p.en ? (
        <button
          key={i}
          type="button"
          onClick={() => onSpeak(p.s)}
          className="rounded px-0.5 text-left text-sky-800 underline decoration-sky-300 decoration-dotted underline-offset-4 hover:bg-sky-50"
          title="点一下听发音"
        >
          {p.s}
        </button>
      ) : (
        <span key={i}>{p.s}</span>
      )))}
    </>
  );
}

export default memo(SpeakableText);
