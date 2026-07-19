/**
 * 拼写/听写/填空答题输入框的「禁联想」属性集
 *
 * 背景:学生背单词时,手机/平板输入法会在候选栏直接联想出正在拼的英文单词,
 * 等于把答案递到手上,相当于作弊。散落各处的输入框此前属性给得参差不齐。
 *
 * 组合原理(经 iOS Safari / Android Gboard 实测):
 * - autoCorrect/autoCapitalize/spellCheck 关闭 → iOS QuickType 预测栏消失
 * - autoComplete="off" + 随机 name → 关浏览器自动填充 & 历史候选
 *   (标准字段名如 "username" 会触发填充,故用随机 name 规避)
 * - data-* → 屏蔽 1Password/LastPass 等密码管理器插入图标
 * - inputMode="text" → 用普通文本键盘,不强制数字/邮箱布局
 *
 * 用法:<input {...noSuggestInputProps()} ... /> ;name 每次调用随机,避免同页多框共享历史。
 */
export const noSuggestInputProps = () => ({
  autoComplete: 'off' as const,
  autoCorrect: 'off',
  autoCapitalize: 'off',
  spellCheck: false,
  inputMode: 'text' as const,
  name: `ans-${Math.random().toString(36).slice(2, 10)}`,
  'data-lpignore': 'true',
  'data-form-type': 'other',
  'data-1p-ignore': 'true',
});
