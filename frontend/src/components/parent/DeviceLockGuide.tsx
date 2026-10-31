/**
 * 家长端教程: 做作业时把手机 / 平板锁在学习页面上(系统自带的「引导式访问 / 屏幕固定」)。
 * 网页管不了别的应用,想让孩子做作业时玩不了游戏,这是最省事的办法: 免费、不用装软件、家长设一次。
 */
import { useState } from 'react';

const IOS = [
  '打开「设置 → 辅助功能 → 引导式访问」,打开开关;点「密码设置 → 设置引导式访问密码」,设一个孩子不知道的密码。',
  '在 Safari(或微信)里打开孩子的学习页面,连按三下侧边按钮(有圆形主屏幕按钮的机型按它),点右上角「开始」。',
  '现在孩子退不出这个页面,也打不开别的应用。做完作业后,连按三下同一个按钮,输入密码,点左上角「结束」。',
];

const ANDROID = [
  '在「设置」最上面的搜索框里搜「屏幕固定」或「应用固定」(各品牌放的位置不一样),打开它;同时打开「取消固定时需要输入密码」。',
  '打开孩子的学习页面,进入最近任务(多任务)界面,点浏览器卡片上方的图标或长按卡片,选「固定」。',
  '取消固定一般是同时按住「返回」和「最近任务」键,或者从屏幕底部上滑并停住,再输入锁屏密码(按手机上的提示来)。',
];

export default function DeviceLockGuide() {
  const [open, setOpen] = useState(false);
  return (
    <section className="card-soft mb-6 rounded-2xl p-5">
      <button type="button" onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-3 text-left" aria-expanded={open}>
        <span className="text-2xl" aria-hidden>🔒</span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-ink">做作业时,让手机只能用学习页面</span>
          <span className="mt-0.5 block text-xs text-ink-mute">手机、平板自带的功能,不用装软件。设好之后孩子切不出去玩游戏</span>
        </span>
        <span className="shrink-0 text-sm text-accent-warm">{open ? '收起' : '怎么设'}</span>
      </button>
      {open && (
        <div className="mt-4 grid gap-4 border-t border-black/[0.06] pt-4 md:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold text-ink">iPhone / iPad: 引导式访问</h3>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-6 text-ink-soft">
              {IOS.map(t => <li key={t}>{t}</li>)}
            </ol>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-ink">安卓手机 / 平板: 屏幕固定</h3>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-6 text-ink-soft">
              {ANDROID.map(t => <li key={t}>{t}</li>)}
            </ol>
          </div>
          <p className="text-xs leading-5 text-ink-mute md:col-span-2">
            电脑上没有这样的设置,可以让孩子在客厅这类大人看得到的地方用电脑做作业。
            不管用哪种设备,孩子切出学习页面几次、离开多久,上面「今天」里都看得到。
          </p>
        </div>
      )}
    </section>
  );
}
