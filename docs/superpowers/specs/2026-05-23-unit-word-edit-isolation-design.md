# 教师端编辑单词的单元隔离

## 背景与问题

教师在「单元管理」里编辑一个单词(例如 `Unit 1` 的 `who`),改完之后所有引用 `who` 的单元都跟着变了。常见踩雷场景:

- 老师把 `Unit 1: 疑问词` 的 `who` 音标改成 `/huː/`,`Unit 5: 关系代词` 的 `who` 也被改了。
- 同一个拼写在不同单元的释义/例句往往不同,但目前共享一份。
- 老师以为只在改本单元,实际上是在全局改。

根因:`words.word` 全局唯一(`UNIQUE`),`unit_words` 多个单元只通过 `word_id` 共享同一行 `Word` + 同一组 `WordDefinition`。

## 目标

教师在「某个单元的某个单词」上做的编辑,**只影响该单元**,不传染到引用同一拼写的其他单元;读取路径(错题本、进度、试卷、AI 等所有现存功能)零改动。

## 非目标

- 不改单词本(`word_books` / `book_words`)的语义。单词本视图保持现状。
- 不引入"覆盖层 / override"机制,不在 `unit_words` 上加可空字段。
- 不实现「恢复默认」按钮(老师如果想还原,从单元里删除再添加即可)。

## 方案:Fork-on-edit

### 核心思路

1. 去掉 `words.word` 的全局 `UNIQUE` 约束,改成普通索引。允许库里同时存在多行 `who` / `WHO`。
2. 教师调用「编辑单元里某单词」时,先看该 `word_id` 被几个单元引用:
   - **只被 1 个单元引用** → 直接 in-place 修改 `Word` + `WordDefinition`(行为同现在,无副作用)。
   - **被多个单元引用** → 在事务里 fork:复制一份 `Word` + 它的 `WordDefinition` + `WordTag`,把当前单元的 `unit_words` 行指向新 `word_id`,再把编辑写到新副本。其他单元仍指向原 `word_id`,不受影响。
3. 读取路径不变:每个 `word_id` 仍唯一对应一组释义,所有 `JOIN word_definitions ON word_id` 的代码无需修改。

### 为什么不选「单元级 override 字段」(方案 B)

调研后发现 13 个文件直接 `JOIN word_definitions ON word_id`(错题本 / 学习记录 / 进度 / AI / 试卷生成器 / 学情分析 等)。如果走 override:

- 学生在 `Unit 1` 做错题 → 错题本里以 `word_id` 为键拉数据 → 拿到的是全局默认释义,不是 `Unit 1` 的 override。
- 要修复需要在错题本/进度/学情/AI 全部加 `unit_id` 上下文,改面广,且每加新功能都要记得带 `unit_id`,长期容易漏。

Fork-on-edit 把"哪个单元拿到哪份数据"的语义沉到 `word_id` 这个主键里,所有按 `word_id` 走的现存代码自动正确。

### 学生进度处理

老师对 `Unit 1` 的某词触发 fork → 该单元的 `unit_words` 指向新 `word_id` → 学生在 `Unit 1` 这个词的进度从零开始(`user_word_progress` 表里没有新 `word_id` 的记录,自动按"未学"处理)。这符合直觉:**老师改了内容,学生该重新熟悉**;且不需要迁移 `user_word_progress` / `mistake_book_items` / `learning_records`,避免跨表迁移雷区。

学生在其他单元学这个词的历史进度不动(还挂在原 `word_id` 上)。

### 字符串查重的处理

去掉 `UNIQUE` 之后,以下 5 处按字符串查 `Word` 的代码会从「至多一行」变成「可能多行」,需调整:

| 文件 | 用途 | 调整方式 |
|---|---|---|
| `app/api/v1/pronunciation.py:130` | 取 `tts_text` 用于 TTS | `scalar_one_or_none` → `scalars().first()`(任一行均可,`tts_text` 通常一致) |
| `app/api/v1/words.py:288` | `POST /words` 创建时查重 | 同上,有任一同拼写即视为重复 |
| `app/api/v1/words.py:373` | `LIKE` 搜索 | 在结果里按 `word` 字符串去重(同名只显示一行) |
| `app/api/v1/words.py:533` | `batch-import` 查重 | 同 288 |
| `app/api/v1/teacher/exam_generator.py:287` | 按拼写找 `word_id` 用于试卷 | `scalars().first()`(试卷生成器随机抽词,任一行可用) |

### 单词本(`word_books`)语义

`book_words.word_id` 在 fork 时**不动**——单词本是"全局教材级"的资源,跟单元独立。一个 fork 出来的新 `Word` 不会自动加进任何单词本。这与"单词本继续看到老 `who`"的预期一致。

## 数据模型变更

### Migration `011_drop_word_unique.sql`

SQLite 不支持 `ALTER TABLE DROP CONSTRAINT`,要重建表:

```sql
BEGIN;
CREATE TABLE words_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word VARCHAR(100) NOT NULL,
    phonetic VARCHAR(100),
    syllables VARCHAR(200),
    tts_text VARCHAR(200),
    difficulty INTEGER DEFAULT 3,
    grade_level VARCHAR(20),
    audio_url VARCHAR(255),
    image_url VARCHAR(255),
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO words_new SELECT * FROM words;
DROP TABLE words;
ALTER TABLE words_new RENAME TO words;
CREATE INDEX idx_words_word ON words(word);
COMMIT;
```

`models/word.py` 同步去掉 `unique=True`,改用 `index=True`。

外键引用:`word_definitions`、`word_tags`、`book_words`、`unit_words`、`user_word_progress`、错题本表等都按 `id` 引用,重建后 `id` 不变,引用安全。

## API 变更

### `PUT /api/v1/teacher/units/{unit_id}/words/{word_id}`

`backend/app/api/v1/teacher/units.py:396` 改写。伪代码:

```python
# 1. 验证 (unit_id, word_id) 关系存在
uw_row = SELECT * FROM unit_words WHERE unit_id=? AND word_id=?
if not uw_row: 404

# 2. 看 word_id 被几个单元引用
ref_count = SELECT COUNT(*) FROM unit_words WHERE word_id=?

# 3. 如果 > 1,fork
if ref_count > 1:
    new_word = clone(Word, where id=word_id)  # 复制全字段(除 id),flush 取 new_id
    for d in word_definitions where word_id=old: clone(d, word_id=new_id)
    for t in word_tags where word_id=old: clone(t, word_id=new_id)
    UPDATE unit_words SET word_id=new_id WHERE id=uw_row.id
    target_word_id = new_id
else:
    target_word_id = word_id

# 4. 在 target_word_id 上应用编辑(逻辑同现在)
apply_edits(target_word_id, word_data)
commit
```

整段在一个事务里。返回值在原本 `{"message": "更新成功"}` 基础上加 `{"word_id": target_word_id, "forked": bool}`,前端可用 `forked` 给老师一个轻量提示("已为本单元创建独立副本")。

### 现有 Word/Definition 读取路径

不变。所有 `JOIN word_definitions ON word_id` 的查询拿到的就是该单元当前指向的 `word_id` 的释义,自动正确。

## 前端变更

`frontend/src/pages/TeacherUnitManagement.tsx:252` 处保存编辑后:

- 读响应 `{forked, word_id}`。
- 若 `forked === true`,`toast.success('保存成功,已为本单元生成独立副本')`,否则保持现有 toast。
- 保存完照旧 `getUnitDetail()` 重拉单元(返回的 `words[*].id` 已经是新 `word_id`),前端列表会自然刷新。

`frontend/src/api/teacher.ts:170` 的 `updateWordInUnit` 返回类型补 `{forked, word_id}`。

## 影响面 / 回归点

需要回归测试的场景:

1. 教师编辑某单元唯一引用的单词 → 不 fork,行为同今天。
2. 教师编辑被多单元引用的单词 → fork,本单元变,其他单元不变。
3. fork 后,学生在该单元的发音、TTS 与新音标一致。
4. fork 后,学生在该单元做题进入错题本,错题本展示的是新释义/新例句。
5. fork 后,该单元的"试卷生成"使用新数据。
6. fork 后,该单元的进度从零开始;其他单元的进度不变。
7. 单词本视图(`book_words`)继续看到原始 `Word`。
8. `POST /words` 创建一个已存在拼写的单词 → 仍然报"已存在"(查重逻辑还在,只是改用 `first()`)。
9. `batch-import` 重复拼写 → 仍归为已存在,不会重复创建。
10. `LIKE` 搜索 → 同拼写只显示一条(去重)。

## 失败模式与回滚

- **fork 中途失败**:整个写在事务里,失败回滚,无脏数据。
- **数据库回滚**:`words` 表去掉 UNIQUE 之后若回滚到旧版,出现重复拼写会插不回 UNIQUE。回滚需要先 `DELETE FROM words WHERE id NOT IN (SELECT MIN(id) FROM words GROUP BY word)` 之类清理。这点写在 migration 注释里。

## 已知限制

前端发音(`frontend/src/hooks/useAudio.ts:13`)和大部分调用点(`FlashCard`、`classify/*` 等)按 `word` 字符串调用 `/pronunciation/edge-tts`,且前端按 `word.toLowerCase()` 缓存 blob(`useAudio.ts:23`)。后端 `pronunciation.py:130` 按字符串查 `Word` 取 `tts_text`。fork 之后:

- **拼写不同**(例如 fork 出 `WHO` 与原 `who`)→ cache key 不同,音频独立。无雷。
- **拼写相同 + `tts_text` 相同**(老师只改了音标/释义/例句,没碰 `word` 和 `tts_text`)→ 两个副本的实际发音本来就该一样(Edge TTS 按 `tts_text` 或 `word` 合成,与音标显示无关),共享缓存正确。无雷。
- **拼写相同 + `tts_text` 不同**(老师 fork 后只改了 `tts_text`)→ 后端按字符串查可能拿到任一副本的 `tts_text`,前端按字符串缓存也会撞 key,发音可能不准。属于罕见用法。

这一项作为**已知限制**记录,不在本期修复。如果未来要彻底解决,把发音 API 改成 `word_id` 优先(`pronunciation.py` 已经接受 `word_id` 参数,`UnitExam.tsx:125` 已经走的是 word_id),把 `useAudio` 改成按 `word_id` 缓存即可,但前端调用点较多,与本期"编辑隔离"是独立的事。

- **并发编辑竞态(单一进程下罕见,记录一笔)**:两个老师同时对同一 `(unit_id, word_id)` 触发 fork,会各自创建一份新 Word/Definition/Tag,最后只有一份被 `unit_words` 指向,另一份成为孤行(数据正确但有少量垃圾)。修复方案是在 `select(UnitWord)` 之前对该行加锁(SQLite `BEGIN IMMEDIATE`,Postgres `FOR UPDATE`),本期不实现。

## 不在本期范围

- 给老师一个"将本单元的副本合并回主词"的反向操作。
- `word_books` 内部的"全局编辑"是否也要 fork(目前没有这个入口,老师只在单元里编辑)。
- 把所有前端发音调用从 `word` 字符串迁到 `word_id`(见上一节)。

如未来需要,可在此基础上扩展。
