# DESIGN

> 由 `frontend/src/index.css` + `tailwind.config.js` + 现有页面归纳的设计系统事实。
> 改 UI 时优先复用这里的 token / 工具类，不要新造平行体系。

## Color（暖橙色系，OKLCH，避开 AI 淡紫）

主调来自 tailwind + 自定义工具类：

| 角色 | 值 | 用法 |
|---|---|---|
| primary 活力橙 | `#FF6B35` | 品牌主色 |
| secondary 阳光黄 | `#FFD23F` | 辅助、点睛 |
| accent 天空蓝 | `#00D9FF` | 强调 |
| success 草绿 | `#5FD35F` | 成功 / 答对 |
| error 珊瑚红 | `#FF5757` | 错误 / 答错 |
| accent-warm | `oklch(0.62 0.19 40)` 文字 / `oklch(0.68 0.185 40)` 底 | 主要交互、当前选中、关键数字 |
| paper 背景 | `oklch(0.985 0.008 55)` | 整页暖米白底（`.bg-paper`） |
| ink / ink-soft / ink-mute | `oklch(0.22 / 0.52 / 0.72 …015 55)` | 正文 / 次要 / 弱文字 |

颜色策略：**Restrained 为底 + 庆祝时刻可 Committed**。日常界面暖中性 + 单一 accent-warm；
光荣榜 / 答对 / 解锁这类「时刻」允许金银铜满铺、暖光张扬。

金银铜段位系统（光荣榜冠军用，见 StudentLeaderboard.tsx TIER_THEME）：
- gold frame `oklch(0.78 0.15 80)` / silver `oklch(0.80 0.02 250)` / bronze `oklch(0.65 0.13 45)`。

## Typography

- `.font-display`: Inter Display, Inter, system-ui, PingFang SC… `letter-spacing:-0.015em`。标题用。
- `.font-numeric`: tabular-nums。所有名次 / 分数 / 计数必用，防跳动。
- 正文系统字体栈。中文为主。

## Elevation & Surfaces

- `.card-soft`: 白卡 + 极浅暖描边 `oklch(0.68 0.185 40 / 0.08)` + 软阴影；hover 上浮 2px、阴影加深、`.tile-image` 内图 scale 1.06 / rotate -2deg。**这是默认卡片，不要自造阴影。**
- `.btn-glow`: 主按钮，135° 暖橙渐变 + 多层暖色光晕，hover 上浮 / active 收缩。
- `.page-warm-glow`: 整页顶部极弱径向暖光，作页面温度。
- `.text-glow-warm`: 大数字 text-shadow 暖光（**不是** gradient text）。
- `.progress-gold`: 100% 完成进度条金色流光；`.progress-striped`: 进行中条纹动。

## Motion

- 统一缓动 `cubic-bezier(0.16, 1, 0.3, 1)`（ease-out-expo），Framer Motion 里同值 `[0.16,1,0.3,1]`。
- 时长：交互 200-220ms；入场 350-500ms。无 bounce / elastic。
- 列表 / 切换用 `AnimatePresence`；不要 animate 布局属性。

## Components / 约定

- emoji 作图标语言一部分；`PictureFallback` 处理立绘 / 封面加载失败。
- `.no-select` 包学习核心区，防划词翻译；输入框内重新允许选中。
- 全局隐藏滚动条（`::-webkit-scrollbar` 宽 0），需要时用 `.custom-scrollbar`。
- Toast: `components/Toast` 的 `toast.error/success`。
- 移动优先，Tailwind `sm: md: lg:` 响应式，320px 起。

## Bans（项目特定，叠加在 impeccable 通用禁令上）

- 不用淡紫 / 冷紫渐变、不用玻璃拟态做默认卡。
- 排行榜不出现「垫底 / 倒数第 N」这类打击性文案。
