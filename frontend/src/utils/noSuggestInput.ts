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

/**
 * 「防输入法联想」答题框属性集(比 noSuggestInputProps 更狠,专治搜狗等系统级 IME)
 *
 * 痛点:搜狗/微软拼音等系统输入法的候选栏在浏览器之外,HTML 的 autoComplete/
 * spellCheck 等属性管不到——学生在中文态打英文字母,搜狗直接补全出整词(打
 * app 联想出 apple),等于把答案递手上。
 *
 * 解法:DOM 层设 type="password" —— 所有输入法遇到密码框都自动关联想/切英文;
 * 再用 CSS -webkit-text-security:none 把默认的小圆点还原成明文,学生照常看得见
 * 自己拼的字母。输入法读 type(不联想),CSS 管显示(可见),两不误。
 *
 * 局限:-webkit-text-security 仅 Blink/WebKit(Chrome/Edge/Safari/360/QQ,覆盖
 * K12 绝大多数)。Firefox 不认→会显示成圆点(占比极低);隐藏输入框(opacity-0
 * + 格子展示)不受此限,任意浏览器都零影响。
 *
 * 用法:可见框 <input {...imeSafeInputProps()} />(勿再单独写 type=);
 *       隐藏框(格子展示层)用 imeSafeInputProps({ visible:false }) 省掉明文样式。
 */
export const imeSafeInputProps = (opts: { visible?: boolean } = {}) => {
  const { visible = true } = opts;
  return {
    ...noSuggestInputProps(),
    type: 'password' as const,
    // 明文显示(隐藏框本就不可见,不加样式避免多余覆盖)
    ...(visible ? { style: { WebkitTextSecurity: 'none' } as Record<string, string> } : {}),
  };
};
