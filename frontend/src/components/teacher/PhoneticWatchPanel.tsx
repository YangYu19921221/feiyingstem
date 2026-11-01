/**
 * 教师端学生详情:「音标视频」每节课看没看、看了多久(2026-11-01)
 *
 * 本机构一节音标视频都没有时整块不显示;有视频但孩子一节没看,照样显示(老师要知道)。
 */
import { useState } from 'react';
import { Video } from 'lucide-react';
import StudentVideoWatchList from '../phonetics/StudentVideoWatchList';

export default function PhoneticWatchPanel({ studentId }: { studentId: number }) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  return (
    <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <h2 className="mb-1 flex items-center gap-2 text-xl font-bold text-gray-800">
        <Video className="h-5 w-5 text-[#2f8791]" aria-hidden="true" />
        音标视频
      </h2>
      <p className="mb-3 text-xs leading-5 text-slate-500">
        「看完」= 看到了结尾附近,而且真看了六成以上的时长(直接拖到结尾不算)。
        全班的明细可以在「音标视频 → 学情总览 → 导出 Excel」下载。
      </p>
      <StudentVideoWatchList
        studentId={studentId}
        scrollList
        onLoaded={(d) => { if (d.videos.length === 0) setHidden(true); }}
      />
    </div>
  );
}
