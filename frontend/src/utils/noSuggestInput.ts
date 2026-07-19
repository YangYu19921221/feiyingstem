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
 * 「防输入法联想」答题框属性集
 *
 * 痛点:搜狗/微软拼音等系统输入法的候选栏在浏览器之外,HTML 属性管不到——
 * 学生在中文态打英文字母,搜狗直接补全出整词(打 app 联想 apple),等于给答案。
 *
 * 曾用 type="password" 强制输入法关联想,但代价是很多输入法在密码框直接禁用
 * 中文输入(用户实测"中文打不了了")——这俩是绑死的,不能兼得。已回退。
 *
 * 现方案:在 noSuggest 基础上加 onBeforeInput 拦截 `insertReplacementText`——
 * 用户从联想候选栏「点词上屏」时浏览器发的正是这个 inputType,直接 preventDefault
 * 挡掉;而逐字母打字(insertText)、中文组字(insertCompositionText)、粘贴
 * (insertFromPaste)都不受影响,中文输入正常。
 *
 * 局限:仅对「候选栏选词触发 insertReplacementText」的输入法有效(iOS QuickType
 * 走这条)。若某些输入法的英文补全走普通 insertText,前端无法与手打区分——
 * 那是系统输入法层的行为,网页碰不到,属技术天花板。visible 参数保留仅为兼容
 * 调用点,不再产生特殊样式。
 */
export const imeSafeInputProps = (_opts: { visible?: boolean } = {}) => ({
  ...noSuggestInputProps(),
  onBeforeInput: (e: { nativeEvent: Event; preventDefault: () => void }) => {
    // 联想候选「替换上屏」→ 拦掉;正常打字/组字/粘贴放行
    if ((e.nativeEvent as InputEvent).inputType === 'insertReplacementText') {
      e.preventDefault();
    }
  },
});
