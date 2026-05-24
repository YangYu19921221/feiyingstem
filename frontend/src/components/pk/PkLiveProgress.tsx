interface Props {
  phase: string;
  currentIdx: number;
  totalQuestions: number;
}

const PHASE_LABEL: Record<string, string> = {
  classify: '分类阶段',
  speech: '语音阶段',
  dictation: '听写阶段',
  exam: '过关阶段',
  summary: '总结',
};

export default function PkLiveProgress({ phase, currentIdx, totalQuestions }: Props) {
  return (
    <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center gap-4">
      <span className="font-semibold">{PHASE_LABEL[phase] || phase}</span>
      <span className="text-sm text-gray-500">
        第 {Math.min(currentIdx + 1, totalQuestions)} / {totalQuestions} 题
      </span>
    </div>
  );
}
