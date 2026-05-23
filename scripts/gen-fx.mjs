#!/usr/bin/env node
// 错题闯关 / 整本完成 / 成就解锁 — 3 张通关 FX 立绘
// 风格：日系少年漫扉页彩页，少年英雄帅气热血。统一画风、不同原型、不同必杀技。
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';

const API = 'https://pikachu.claudecode.love/v1/images/generations';
const KEY = 'sk-54936f745ee385e62e6f6b304c988928faead2a727dc4cd8bcbc2fc45912533f';

// 统一锚点：日系少年漫扉页彩页风格，确保三张是"同一个世界观"
const STYLE = (
  'Japanese shounen manga color splash page illustration, clean confident line art with cel-shading ' +
  'and sharp highlights, dynamic action composition (NOT a static standing pose). ' +
  'Handsome cool teenage male hero around 14 years old, original character not based on any existing IP, ' +
  'sharp facial features, fierce determined expression, slim athletic build. ' +
  'Cinematic 16:9 widescreen, subject in lower-center with sky/atmosphere above leaving room for overlay text. ' +
  'NO text, NO watermark, NO logo, NO speech bubbles, NO signature. ' +
  'NOT chibi, NOT super-deformed, NOT western cartoon, NOT 3D render, NOT pixar style. ' +
  'High detail, vivid saturated colors, professional manga magazine cover quality.'
);

const SCENES = {
  // 错题满分 — 爆气型英雄（超赛悟空原型）
  victory:
    'A teenage male warrior hero in a powerful low-stance pose, both fists slammed downward to the ground ' +
    'unleashing an explosive burst of golden ki energy mixed with crackling blue lightning. ' +
    'Spiky upright golden hair glowing with energy, fierce blue eyes, white-and-orange martial arts gi with belt sash. ' +
    'Beneath his fists: shattered glowing "X" marks (wrong-answers) bursting into golden light shards. ' +
    'Background: explosive orange-gold radial energy lines, blue electric arcs, scattered torn paper fragments flying. ' +
    'Color palette: vivid orange, gold, electric blue, white. ' +
    'Mood: explosive heroic power-up moment, mistakes destroyed. ',

  // 整本通关 — 守护者型英雄（水门原型）
  book:
    'A teenage male hero standing tall with windswept golden short hair and piercing deep blue eyes, ' +
    'wearing a long flowing white cape with red flame-pattern trim along the bottom edge that billows dramatically in the wind. ' +
    'In front of him floats a massive glowing ancient scroll/tome unfurled in mid-air, golden runes and letters spiraling out of it ' +
    'into the starry night sky. He holds his right hand calmly raised toward the floating book. ' +
    'Background: deep blue starry night sky with a soft galaxy, full moon, distant mountain silhouettes, ' +
    'golden particles drifting upward from the scroll. ' +
    'Color palette: blue night, white cape, red flame trim, warm golden book glow. ' +
    'Mood: composed, mastered all knowledge, guardian of wisdom. ',

  // 成就解锁 — 觉醒型英雄（佐助原型）
  achievement:
    'A teenage male hero in a cool side-three-quarter view, dark messy spiky black-purple hair, ' +
    'sharp cold expression, heterochromatic eyes (one silver-white, one glowing gold). ' +
    'Wearing a high-collar dark purple-black cape flaring up dramatically. ' +
    'His left hand raised holding up a glowing emerald-green hexagonal medal/orb wrapped in crackling purple lightning, ' +
    'his right hand at his side trailing electric sparks. ' +
    'Background: dark purple-black storm clouds, jagged golden lightning bolts splitting the sky, ' +
    'floating ancient runes and symbols scattering around him. ' +
    'Color palette: deep purple-black, electric gold lightning, emerald green orb, silver. ' +
    'Mood: cool awakening moment, new power obtained. ',
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
  // sips 压成 jpeg q=88 长边 1600
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
