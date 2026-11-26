/**
 * 拍批改过的卷子(学校考试 · 丢分分析,老师和孩子共用)。
 * 一页一张,最多 maxPages 张;每张先在浏览器里压成长边 2000 的 JPEG(手机原图十几 MB,HEIC 也转成 JPEG)。
 * 手机「拍一页」走系统相机;电脑 / 平板「打开摄像头」在网页里拍;都能「从相册选」(可以一次选好几张)。
 */
import { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, LoaderCircle, Send, Video, X } from 'lucide-react';
import CameraCapture from '../homework/CameraCapture';
import { compressImage } from '../../utils/compressImage';
import { toast } from '../Toast';

interface Props {
  maxPages: number;
  sending: boolean;
  onSend: (photos: Blob[]) => Promise<boolean>;
  tone?: 'student' | 'teacher';
}

interface Shot { blob: Blob; url: string }

export default function SheetPhotoPicker({ maxPages, sending, onSend, tone = 'student' }: Props) {
  const [shots, setShots] = useState<Shot[]>([]);
  const [camera, setCamera] = useState(false);
  const [working, setWorking] = useState(false);
  const shotsRef = useRef<Shot[]>([]);
  const camInput = useRef<HTMLInputElement>(null);
  const pickInput = useRef<HTMLInputElement>(null);

  useEffect(() => { shotsRef.current = shots; }, [shots]);
  useEffect(() => () => shotsRef.current.forEach((s) => URL.revokeObjectURL(s.url)), []);

  const add = async (files: Array<Blob | File>) => {
    const room = maxPages - shots.length;
    if (room <= 0) {
      toast.error(`一次最多 ${maxPages} 页`);
      return;
    }
    if (files.length > room) toast.error(`一次最多 ${maxPages} 页,多的没加进来`);
    setWorking(true);
    const out: Shot[] = [];
    for (const f of files.slice(0, room)) {
      try {
        const blob = await compressImage(f as File, 2000, 0.88);
        out.push({ blob, url: URL.createObjectURL(blob) });
      } catch {
        toast.error('有一张照片打不开,换一张试试');
      }
    }
    setShots((old) => [...old, ...out]);
    setWorking(false);
  };

  const remove = (i: number) => setShots((old) => {
    URL.revokeObjectURL(old[i].url);
    return old.filter((_, j) => j !== i);
  });

  const send = async () => {
    if (!shots.length || sending) return;
    // 传成功了才清掉(传失败照片还在,不用重拍)
    if (await onSend(shots.map((s) => s.blob))) {
      setShots((old) => { old.forEach((s) => URL.revokeObjectURL(s.url)); return []; });
    }
  };

  const btn = tone === 'student'
    ? 'inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-ink ring-1 ring-orange-200 hover:bg-orange-50'
    : 'inline-flex min-h-10 items-center gap-2 rounded-lg bg-white px-3 text-sm text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={`${btn} sm:hidden`} onClick={() => camInput.current?.click()} disabled={working || sending}>
          <Camera className="h-4 w-4" /> 拍一页
        </button>
        <button type="button" className={`${btn} hidden sm:inline-flex`} onClick={() => setCamera(true)} disabled={working || sending}>
          <Video className="h-4 w-4" /> 打开摄像头
        </button>
        <button type="button" className={btn} onClick={() => pickInput.current?.click()} disabled={working || sending}>
          <ImagePlus className="h-4 w-4" /> 从相册选
        </button>
        <input ref={camInput} type="file" accept="image/*" capture="environment" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void add([f]); }} />
        <input ref={pickInput} type="file" accept="image/*" multiple className="hidden"
          onChange={(e) => { const fs = Array.from(e.target.files || []); e.target.value = ''; if (fs.length) void add(fs); }} />
      </div>
      {(shots.length > 0 || working) && (
        <div className="flex flex-wrap gap-2">
          {shots.map((s, i) => (
            <div key={s.url} className="relative">
              <img src={s.url} alt={`第 ${i + 1} 页`} className="h-28 w-20 rounded-lg object-cover ring-1 ring-slate-200" />
              <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 text-xs text-white">{i + 1}</span>
              <button type="button" aria-label={`去掉第 ${i + 1} 页`} onClick={() => remove(i)} disabled={sending}
                className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-slate-800 text-white shadow">
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
          {working && <div className="flex h-28 w-20 items-center justify-center rounded-lg bg-slate-100"><LoaderCircle className="h-5 w-5 animate-spin text-slate-400" /></div>}
        </div>
      )}
      {shots.length > 0 && (
        <button type="button" onClick={() => void send()} disabled={sending || working}
          className={tone === 'student'
            ? 'inline-flex min-h-12 items-center gap-2 rounded-xl bg-[#FF6B35] px-6 font-semibold text-white disabled:bg-slate-300'
            : 'inline-flex min-h-10 items-center gap-2 rounded-lg bg-slate-800 px-4 text-sm font-semibold text-white disabled:bg-slate-300'}>
          {sending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          {sending ? '正在传…' : `传这 ${shots.length} 页`}
        </button>
      )}
      {camera && (
        <CameraCapture onClose={() => setCamera(false)} onCapture={(b) => { setCamera(false); void add([b]); }} />
      )}
    </div>
  );
}
