#!/usr/bin/env node
// 3 张通关英雄立绘：perfect / great / retry
// 高清：1024x1024 PNG → cwebp -q 92 -resize 1024 0
import fs from 'node:fs/promises';
import path from 'node:path';

const API = 'https://pikachu.claudecode.love/v1/images/generations';
const KEY = 'sk-54936f745ee385e62e6f6b304c988928faead2a727dc4cd8bcbc2fc45912533f';

const STYLE = (
  'Low-poly paper-craft RPG hero illustration, soft cinematic rim light, ' +
  'painterly clean shading. Friendly young hero suitable for elementary school students. ' +
  'Warm cream paper background with subtle texture (oklch warm beige). ' +
  'NO text, NO watermark, NO logo, NOT chibi, NOT anime, NOT cartoon Saturday-morning. ' +
  'Original character not based on any existing IP. Square 1:1 composition, ' +
  'cinematic widescreen feel, sharp details, high quality. ' +
  'Wide environment with hero at center-bottom third, plenty of sky/atmosphere above for headline overlay.'
);

const SCENES = {
  perfect:
    'A heroic young scholar-warrior standing triumphantly on a cliff edge, ' +
    'arms raised high in victory, holding a glowing sword skyward. Behind: a brilliant golden sun ' +
    'breaking through layered low-poly clouds at sunrise, warm rays radiating outward. ' +
    'Crystal-clear gold and amber palette, gold laurel wreath on head, dynamic windswept cape. ' +
    'Heroic moment of total triumph. ',
  great:
    'A confident young hero smiling, sheathing a sword at their side, standing in a peaceful sunset ' +
    'meadow with low-poly origami flowers floating gently around them like petals. ' +
    'Warm peach and sky-blue palette, calm wind, satisfied expression. ' +
    'Moment of quiet accomplishment. ',
  retry:
    'A young hero kneeling on one knee in a quiet pre-dawn mist, gathering energy in their cupped ' +
    'hands forming a soft glowing orb of light. Determined focused expression. ' +
    'Cool grey-blue and soft warm core light palette, fog rolling at their feet. ' +
    'Moment of determination, before the next battle. ',
};

async function genOne(name, prompt, outDir) {
  const body = { model: 'gpt-image-2', prompt: prompt + STYLE, size: '1024x1024', n: 1 };
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${name}: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const url = data?.data?.[0]?.url;
  if (!url) throw new Error(`${name}: no url`);
  const img = await fetch(url);
  if (!img.ok) throw new Error(`download failed ${img.status}`);
  const buf = Buffer.from(await img.arrayBuffer());
  const outPath = path.join(outDir, `${name}.png`);
  await fs.writeFile(outPath, buf);
  return { name, bytes: buf.length, outPath };
}

async function main() {
  const outDir = path.resolve('frontend/public/victory');
  await fs.mkdir(outDir, { recursive: true });
  for (const [name, scene] of Object.entries(SCENES)) {
    console.log(`[gen] ${name} ...`);
    const r = await genOne(name, scene, outDir);
    console.log(`     ✓ ${r.outPath} (${(r.bytes / 1024).toFixed(0)} KB)`);
  }
  console.log('\n done: 3/3');
}

main().catch(err => { console.error(err); process.exit(1); });
