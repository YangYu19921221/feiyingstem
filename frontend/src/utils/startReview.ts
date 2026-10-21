/**
 * 开始一次复习: 把要复习的词塞进 sessionStorage,跳 classify 复习流程(unit 0)。
 * 首页「开始复习」和复习页共用这一份 —— 两处各写一遍,字段漏一个复习页就读不出释义。
 */
import type { NavigateFunction } from 'react-router-dom';
import type { ReviewWord } from '../api/memoryCurve';
import { initStagesIfMissing } from './reviewTier';

export function startReviewSession(words: ReviewWord[], navigate: NavigateFunction) {
  if (words.length === 0) return;
  // 没有 localStorage 档位记录的词按 mastery_level 定起点,答对从正确档位升而不是总从 0 开始
  initStagesIfMissing(words.map((w) => ({ id: w.word_id, mastery_level: w.mastery_level })));
  const wordData = words.map((w, index) => ({
    id: w.word_id,
    word: w.word,
    phonetic: w.phonetic || '',
    meaning: w.meaning || '',
    part_of_speech: w.part_of_speech || '',
    example_sentence: w.example_sentence || '',
    example_translation: w.example_translation || '',
    difficulty: w.difficulty,
    syllables: w.syllables || '',
    audio_url: '',
    image_url: '',
    tags: [],
    definitions: w.meaning ? [{
      id: 0,
      part_of_speech: w.part_of_speech || '',
      meaning: w.meaning,
      example_sentence: w.example_sentence || '',
      example_translation: w.example_translation || '',
      is_primary: true,
    }] : [],
    order_index: index,
  }));
  sessionStorage.setItem('review_practice_words', JSON.stringify(wordData));
  sessionStorage.setItem('is_review_practice', 'true');
  // 复习前快照: 背完回复习页时对比,给「刚复习 N 个、X 个记得更牢」的正反馈
  sessionStorage.setItem('review_snapshot', JSON.stringify(
    words.map((w) => ({ id: w.word_id, level: w.mastery_level })),
  ));
  navigate('/student/units/0/classify');
}
