/**
 * 「句子积木」(语法小课)在工作台上的入口: 地址,和「这个账号放不放入口」。
 * 放不放由后端说了算(课表接口的 entry,规则见 backend/app/services/grammar_course.py 的 show_staff_entry):
 * 平台管理员一直有;样课阶段老师只有直营的有。卡片本身在 GrammarTrialCard.tsx。
 */
import { useEffect, useState } from 'react';
import { grammarApi } from '../../api/grammar';

export const GRAMMAR_HOME = '/student/grammar';

/** 这个账号的工作台上放不放入口。还没问到 / 问不到 = 不放 */
export function useGrammarEntry(): boolean {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let alive = true;
    grammarApi.lessons()
      .then((d) => { if (alive) setShow(d.enabled && d.entry); })
      .catch(() => { /* 问不到就不放,不打扰工作台 */ });
    return () => { alive = false; };
  }, []);
  return show;
}
