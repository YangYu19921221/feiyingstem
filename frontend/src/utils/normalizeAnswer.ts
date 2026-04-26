/**
 * 比对单词/短语答案前的规范化：
 * - NFC 统一 Unicode 组合形式
 * - 移除零宽字符（U+200B-U+200D / U+FEFF）
 * - 不间断空格（U+00A0）/ 全角空格（U+3000）→ 普通空格
 * - 去前后空白 + 折叠中间多空白
 *
 * 用途：词库导入或复制粘贴常带入隐形字符，渲染相同但严格 === 会判错。
 * 短语内部空格仍严格校验（如 "many kinds of"）。
 */
export function normalizeAnswer(s: string): string {
  return s
    .normalize('NFC')
    .replace(/[​-‍﻿]/g, '')
    .replace(/[ 　]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
