#!/usr/bin/env node
// 通关立绘补 6 张：每档 2 个新场景，凑齐每档 3 张
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';

const API = 'https://pikachu.claudecode.love/v1/images/generations';
const KEY = 'sk-54936f745ee385e62e6f6b304c988928faead2a727dc4cd8bcbc2fc45912533f';

const STYLE = (
  'Low-poly paper-craft RPG hero illustration, soft cinematic rim light, ' +
  'painterly clean shading. Friendly young hero suitable for elementary school students. ' +
  'NO text, NO watermark, NO logo, NOT chibi, NOT anime, NOT cartoon Saturday-morning. ' +
  'Original character not based on any existing IP. Square 1:1, ' +
  'cinematic widescreen feel, sharp details, high quality, ' +
  'wide environment with hero at center-bottom third, plenty of sky/atmosphere above.'
);

// 已存在 perfect-1 = 金色日出 / great-1 = 黄昏花海 / retry-1 = 晨雾山峦
const SCENES = {
  // PERFECT 满分
  'perfect-2':
    'A heroic young scholar-warrior standing triumphantly on a high cliff, sword raised skyward, ' +
    'silver moon huge and luminous behind them in a deep night sky, low-poly clouds glowing softly, ' +
    'cool blue and silver palette with warm core highlights on the hero, gold laurel wreath, ' +
    'cape windswept. Moment of moonlit triumph. ',
  'perfect-3':
    'A young hero on a snowy mountain peak, arms spread wide, vivid AURORA borealis dancing in green ' +
    'and violet ribbons across the sky, low-poly snow crystals floating, gold laurel wreath, ' +
    'glowing footprints behind them. Cosmic celebration moment. ',

  // GREAT 良好
  'great-2':
    'A confident young hero walking through a golden wheat field at warm afternoon, hand brushing ' +
    'the wheat tops, gentle breeze, low-poly birds flying in distance, peach and amber palette, ' +
    'satisfied expression. Pastoral peaceful moment. ',
  'great-3':
    'A young hero standing barefoot on a wooden pier at ocean sunset, holding their sword resting ' +
    'on shoulder, low-poly waves and seabirds, soft turquoise and coral palette, calm smile, ' +
    'paper-craft seashells at their feet. Coastal accomplishment moment. ',

  // RETRY 待努力
  'retry-2':
    'A young hero standing alone in soft rain at dusk, shoulders slightly hunched but eyes forward, ' +
    'glowing energy gathering in their hand, low-poly raindrops, deep teal and warm amber lantern ' +
    'glow, determined expression. Quiet resolve in the rain. ',
  'retry-3':
    'A young hero kneeling in fresh snow at quiet dawn, breath visible in cold air, ' +
    'soft golden sunrise barely cresting distant low-poly mountains, hands gathering a glowing ' +
    'snowflake. Cool blue with warm sunrise core. Determination before the next attempt. ',
};

async function genOne(name, prompt, outDir) {
  const body = { model: 'gpt-image-2', prompt: prompt + STYLE, size: '1024x1024', n: 1 };
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
  const pngPath = path.join(outDir, `${name}.png`);
  await fs.writeFile(pngPath, buf);
  // cwebp -q 92 -resize 1280 0 → .webp，删除 .png
  await new Promise((resolve, reject) => {
    execFile('cwebp', ['-quiet', '-q', '92', '-resize', '1280', '0', pngPath, '-o', path.join(outDir, `${name}.webp`)],
      (err) => err ? reject(err) : resolve());
  });
  await fs.unlink(pngPath);
  const stat = await fs.stat(path.join(outDir, `${name}.webp`));
  return { name, kb: (stat.size / 1024).toFixed(0) };
}

async function main() {
  const outDir = path.resolve('frontend/public/victory');
  await fs.mkdir(outDir, { recursive: true });
  for (const [name, scene] of Object.entries(SCENES)) {
    console.log(`[gen] ${name} ...`);
    const r = await genOne(name, scene, outDir);
    console.log(`     ✓ ${r.name}.webp (${r.kb} KB)`);
  }
  console.log('\n done: 6/6');
}

main().catch(err => { console.error(err); process.exit(1); });
