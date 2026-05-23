#!/usr/bin/env node
// 错题闯关 / 整本完成 / 成就解锁 — 3 张通关 FX 立绘，统一原创英雄风格
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';

const API = 'https://pikachu.claudecode.love/v1/images/generations';
const KEY = 'sk-54936f745ee385e62e6f6b304c988928faead2a727dc4cd8bcbc2fc45912533f';

const STYLE = (
  'Low-poly paper-craft RPG hero illustration, soft cinematic rim light, ' +
  'painterly clean shading. Friendly young hero, original character not based on any existing IP. ' +
  'NO text, NO watermark, NO logo, NOT chibi, NOT anime, NOT cartoon Saturday-morning. ' +
  'Cinematic widescreen feel, sharp details, high quality. ' +
  '16:9 widescreen composition optimized for fullscreen overlay backgrounds (cover-fit).'
);

const SCENES = {
  // 错题闯关满分 — 主视觉：英雄高举一把剑刺穿"错题怪"，胜利瞬间
  victory:
    'A heroic young scholar-warrior standing atop crumbling glowing "X" marks shaped like ' +
    'stone shards (representing mistakes vanquished), arms raised high in triumph, ' +
    'holding a shining sword skyward emitting golden rays. Behind: warm golden sunrise breaking ' +
    'through low-poly clouds, ribbons and floating paper letters drifting upward. ' +
    'Vivid amber and orange palette, gold laurel wreath on head, dynamic windswept cape. ' +
    'Triumphant "conquered the mistakes" moment. ',

  // 整本完成 — 主视觉：英雄打开一本巨大发光的书，星辰从书中涌出
  book:
    'A young scholar hero kneeling before a massive open glowing book floating mid-air, ' +
    'pages fluttering, golden letters and constellations of stars rising from its pages into the night sky. ' +
    'Hero gazes upward in wonder, hand reaching toward the light. ' +
    'Deep blue night sky with a galaxy, warm golden book glow, low-poly mountains in distance. ' +
    'Magical "knowledge unlocked" moment, cinematic. ',

  // 成就解锁 — 主视觉：英雄站姿手举刚获得的奖章/徽章，背后金色光环爆发
  achievement:
    'A young scholar hero standing center, proudly holding up a glowing emerald medal pendant, ' +
    'huge radiant golden halo and explosive light rays bursting behind them, ' +
    'floating origami cranes and warm golden particles surround. ' +
    'Sense of grand reward, accomplishment unlocked. Warm amber + emerald + cream palette. ',
};

async function genOne(name, prompt, outDir) {
  const body = { model: 'gpt-image-2', prompt: prompt + STYLE, size: '1792x1024', n: 1 };
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${name}: ${res.status} ${await res.text()}`);
  const url = (await res.json())?.data?.[0]?.url;
  if (!url) throw new Error(`${name}: no url`);
  const img = await fetch(url);
  const buf = Buffer.from(await img.arrayBuffer());
  const pngPath = path.join(outDir, `fx-${name}.png`);
  await fs.writeFile(pngPath, buf);
  // cwebp 不存在，改用 sips 压成 jpeg q=88 长边 1600（错题页背景）
  await new Promise((resolve, reject) => {
    execFile(
      'sips',
      ['-s', 'format', 'jpeg', '-s', 'formatOptions', '88', '-Z', '1600', pngPath, '--out', path.join(outDir, `fx-${name}.jpeg`)],
      (err) => err ? reject(err) : resolve()
    );
  });
  await fs.unlink(pngPath);
  const stat = await fs.stat(path.join(outDir, `fx-${name}.jpeg`));
  return { name, kb: (stat.size / 1024).toFixed(0) };
}

async function main() {
  const outDir = path.resolve('frontend/public');
  for (const [name, scene] of Object.entries(SCENES)) {
    console.log(`[gen] ${name} ...`);
    const r = await genOne(name, scene, outDir);
    console.log(`     ✓ fx-${r.name}.jpeg (${r.kb} KB)`);
  }
  console.log('\n done: 3/3');
}

main().catch(err => { console.error(err); process.exit(1); });
