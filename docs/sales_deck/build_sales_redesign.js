#!/usr/bin/env node
const pptxgen = require('pptxgenjs');
const path = require('path');

const pptx = new pptxgen();
pptx.layout = 'LAYOUT_WIDE';
pptx.author = '飞鹰英语';
pptx.subject = '加盟销售端重设计：自研发音判断 × B端增长 × C端留存';
pptx.title = '飞鹰英语｜加盟销售端重设计';
pptx.company = '飞鹰英语';
pptx.lang = 'zh-CN';
pptx.theme = {
  headFontFace: 'Microsoft YaHei',
  bodyFontFace: 'Microsoft YaHei',
  lang: 'zh-CN'
};

const W = 13.333, H = 7.5;
const C = {
  navy: '0B1220', ink: '14213D', cream: 'F7F8FC', white: 'FFFFFF',
  coral: 'FF6B35', yellow: 'FFD166', mint: '43D19B', cyan: '55D5E8',
  lilac: '8D7CF6', gray: '687386', line: 'E6EAF0', pale: 'EEF3F7',
  peach: 'FFF0E8', greenPale: 'E9FBF4', bluePale: 'E8F8FC'
};
const ROOT = __dirname;
const IMG = p => path.join(ROOT, 'images', p);

function rect(s, x, y, w, h, fill, radius=0) {
  s.addShape(radius ? pptx.ShapeType.roundRect : pptx.ShapeType.rect, {
    x, y, w, h, rectRadius: radius, fill: {color: fill}, line: {color: fill}
  });
}
function line(s, x1, y1, x2, y2, color=C.line, width=1, dash='solid') {
  s.addShape(pptx.ShapeType.line, {x:x1, y:y1, w:x2-x1, h:y2-y1, line:{color, width, dashType:dash, beginArrowType:'none', endArrowType:'none'}});
}
function text(s, txt, x, y, w, h, opts={}) {
  s.addText(txt, {x, y, w, h, margin:0, breakLine:false, fit:'shrink',
    fontFace:'Microsoft YaHei', fontSize:opts.size||16, color:opts.color||C.ink,
    bold:opts.bold||false, align:opts.align||'left', valign:opts.valign||'mid',
    paraSpaceAfterPt:opts.after||0, charSpacing:opts.charSpacing||0,
    isTextBox:true, transparency:opts.transparency, italic:opts.italic||false,
    bullet:opts.bullet});
}
function addImg(s, file, x, y, w, h, opts={}) {
  if (!require('fs').existsSync(file)) return;
  s.addImage({path:file, x, y, w, h, transparency:opts.transparency||0});
}
function pill(s, txt, x, y, w, fill, color=C.ink, size=10) {
  rect(s,x,y,w,0.32,fill,0.16); text(s,txt,x,y+0.01,w,0.28,{size,color,bold:true,align:'center'});
}
function title(s, kicker, head, sub='') {
  rect(s,0,0,W,0.12,C.coral);
  text(s,kicker.toUpperCase(),0.65,0.38,12,0.28,{size:11,color:C.coral,bold:true,charSpacing:1.2});
  text(s,head,0.65,0.72,12,0.62,{size:27,color:C.ink,bold:true});
  if (sub) text(s,sub,0.66,1.36,12,0.35,{size:12,color:C.gray});
}
function footer(s, n, dark=false) {
  const col = dark ? 'B8C3D4' : C.gray;
  line(s,0.65,7.06,12.7,7.06,dark?'27344A':C.line,0.8);
  text(s,'飞鹰英语 · 智能学习系统',0.65,7.12,4,0.2,{size:8,color:col});
  text(s,String(n).padStart(2,'0'),12.2,7.12,0.5,0.2,{size:8,color:col,align:'right'});
}
function card(s,x,y,w,h,fill=C.white,accent=C.coral) {
  rect(s,x,y,w,h,fill,0.08); rect(s,x,y,0.08,h,accent,0.04);
}
function dot(s,x,y,r,fill) { s.addShape(pptx.ShapeType.ellipse,{x,y,w:r,h:r,fill:{color:fill},line:{color:fill}}); }
function arrow(s,x1,y1,x2,y2,color=C.coral) {
  s.addShape(pptx.ShapeType.line,{x:x1,y:y1,w:x2-x1,h:y2-y1,line:{color,width:2,endArrowType:'triangle'}});
}

// 01 Cover
{
  const s = pptx.addSlide(); rect(s,0,0,W,H,C.navy);
  addImg(s,IMG('redesign_hero.png'),6.25,0,7.08,H);
  rect(s,0,0,6.9,H,C.navy);
  rect(s,0,0,0.16,H,C.coral);
  pill(s,'加盟销售端 · 重设计',0.78,0.72,1.85,C.coral,C.white,10);
  text(s,'让发音\n变成看得见的进步',0.78,1.55,5.35,1.55,{size:31,color:C.white,bold:true});
  text(s,'自研发音判断 × B 端增长 × C 端留存',0.82,3.45,5.45,0.38,{size:16,color:C.yellow,bold:true});
  text(s,'不是一个打分工具，而是一条从“第一次开口”到“持续学习、家长续费、机构增长”的完整证据链。',0.82,4.12,5.15,0.9,{size:14,color:'D5DCE8'});
  line(s,0.82,5.38,1.82,5.38,C.yellow,3);
  text(s,'销售讲清楚价值，运营跑出结果，分成自然发生。',0.82,5.62,5.4,0.4,{size:14,color:C.white,bold:true});
  footer(s,1,true);
}

// 02 Pain points
{
  const s = pptx.addSlide(); rect(s,0,0,W,H,C.cream);
  title(s,'01 · 先讲结果','三种人，三种焦虑；我们用一套系统同时接住','销售开场不要先报功能，先把对方正在承担的风险说出来。');
  const items = [
    {x:0.7, label:'B 端 · 校长/加盟商', head:'“招生活动做了，\n为什么还不能稳定续费？”', body:'缺的不是一个 App，而是可复制的招生入口、教学交付和续费证据。', fill:C.peach, ac:C.coral},
    {x:4.55, label:'B 端 · 老师', head:'“每个孩子都不一样，\n我怎么带得动？”', body:'需要把教研、组卷、批改和学情提醒沉到系统里，减少对个人经验的依赖。', fill:C.bluePale, ac:C.cyan},
    {x:8.4, label:'C 端 · 家长/孩子', head:'“孩子说学了，\n我怎么看见真的变好了？”', body:'孩子要即时反馈和成就感，家长要一份能复述、能对比的进步证据。', fill:C.greenPale, ac:C.mint}
  ];
  for (const it of items) {
    card(s,it.x,2.05,3.55,3.7,it.fill,it.ac);
    pill(s,it.label,it.x+0.3,2.35,2.1,it.ac,C.white,9);
    text(s,it.head,it.x+0.3,2.95,2.95,1.0,{size:20,color:C.ink,bold:true});
    text(s,it.body,it.x+0.3,4.32,2.95,0.85,{size:12.5,color:C.gray});
    text(s,'→',it.x+2.85,5.23,0.35,0.35,{size:20,color:it.ac,bold:true,align:'right'});
  }
  footer(s,2);
}

// 03 Value chain
{
  const s = pptx.addSlide(); rect(s,0,0,W,H,C.navy);
  text(s,'02 · 一句话定位',0.7,0.52,12,0.28,{size:11,color:C.cyan,bold:true,charSpacing:1.2});
  text(s,'一次开口，串起三件事',0.7,0.88,12,0.62,{size:30,color:C.white,bold:true});
  text(s,'把发音判断变成招生入口，把学习过程变成续费证据，把系统能力变成加盟商的经营杠杆。',0.7,1.55,11.7,0.4,{size:13,color:'C3CBD8'});
  const steps = [
    ['01','引流','免费读 6 个词','低门槛、可传播'],
    ['02','判断','自研发音模型','输出可解释反馈'],
    ['03','运营','每日任务 + PK + 周报','孩子愿意回来'],
    ['04','转化','家长看见变化','续费 / 转介绍发生']
  ];
  let x=0.78;
  for (let i=0;i<steps.length;i++) {
    const [no,head,body,sub] = steps[i];
    rect(s,x,2.65,2.65,2.62,'172238',0.1);
    pill(s,no,x+0.25,2.92,0.48,i===1?C.yellow:C.coral,i===1?C.ink:C.white,10);
    text(s,head,x+0.25,3.5,2.1,0.35,{size:17,color:C.white,bold:true});
    text(s,body,x+0.25,4.03,2.1,0.48,{size:14,color:i===1?C.yellow:C.cyan,bold:true});
    text(s,sub,x+0.25,4.72,2.1,0.32,{size:11,color:'B8C3D4'});
    if (i<steps.length-1) arrow(s,x+2.68,3.98,x+3.05,3.98,C.coral);
    x += 3.05;
  }
  text(s,'销售记忆点：我们卖的不是“一个分数”，而是“从开口到续费”的增长链路。',0.8,6.0,11.7,0.4,{size:17,color:C.yellow,bold:true,align:'center'});
  footer(s,3,true);
}

// 04 Self-developed pronunciation model
{
  const s = pptx.addSlide(); rect(s,0,0,W,H,C.cream);
  title(s,'03 · 技术可信度','自研发音判断：不是只给一个分数','用“判断 → 解释 → 复练”替代黑盒打分，销售才有底气，老师才敢使用。');
  card(s,0.7,1.95,7.05,4.72,C.white,C.coral);
  const flow = [
    ['01','采集语音','孩子读词 / 读句，保留真实语速'],
    ['02','模型判断','在本节候选词中做闭集音素比对'],
    ['03','生成反馈','读对 / 近音 / 没听到 / 无法判断'],
    ['04','回到练习','针对薄弱音位再次跟读与对比']
  ];
  let y=2.3;
  for (let i=0;i<flow.length;i++) {
    const [no,head,body]=flow[i];
    pill(s,no,1.05,y,0.55,i===1?C.yellow:C.coral,i===1?C.ink:C.white,10);
    text(s,head,1.85,y-0.02,2.0,0.34,{size:15,color:C.ink,bold:true});
    text(s,body,3.7,y-0.01,3.45,0.38,{size:11.5,color:C.gray});
    if(i<flow.length-1) line(s,1.32,y+0.42,1.32,y+0.82,C.line,1.5);
    y += 0.94;
  }
  line(s,1.05,6.02,7.15,6.02,C.line,1);
  text(s,'销售可说：模型不是为了“判孩子错”，而是为了让下一次练习更准确。',1.05,6.18,6.2,0.32,{size:12.5,color:C.coral,bold:true});
  rect(s,8.05,1.95,4.55,4.72,C.navy,0.08);
  addImg(s,IMG('feat_pronunciation.png'),8.28,2.2,4.1,3.2);
  pill(s,'模型输出',8.35,5.55,1.1,C.cyan,C.ink,9);
  text(s,'目标词  ·  近音词  ·  判定结果  ·  下一步练习',8.35,5.98,3.9,0.32,{size:11.5,color:C.white,bold:true});
  text(s,'* 对外宣传时请以实际模型版本、评测集与合规材料为准。',8.35,6.42,3.9,0.23,{size:8.5,color:'AEB8C8'});
  footer(s,4);
}

// 05 Evidence report
{
  const s = pptx.addSlide(); rect(s,0,0,W,H,C.cream);
  title(s,'04 · 进步证据','让家长相信，不靠口号，靠一张看得懂的报告','报告要回答三个问题：孩子哪里变好了？下一步练什么？家长能做什么？');
  card(s,0.7,1.95,5.1,4.85,C.navy,C.yellow);
  text(s,'AI 发音成长报告',1.05,2.28,4.2,0.3,{size:14,color:C.cyan,bold:true});
  text(s,'从“不会读”到“敢开口”',1.05,2.72,4.2,0.5,{size:23,color:C.white,bold:true});
  const rows=[['目标词','bad','读对 / 通过'],['听到近音','bed','提醒重读元音'],['下一步','/æ/','进入纠音任务']];
  let ry=3.65;
  for (const [a,b,c] of rows) {
    line(s,1.05,ry-0.15,5.4,ry-0.15,'2B3A52',0.8);
    text(s,a,1.05,ry,1.2,0.3,{size:11,color:'B8C3D4'});
    text(s,b,2.35,ry-0.04,1.8,0.35,{size:18,color:C.white,bold:true});
    text(s,c,4.0,ry,1.4,0.28,{size:10.5,color:C.mint,bold:true,align:'right'});
    ry += 0.7;
  }
  text(s,'示例数据 · 仅用于演示报告结构',1.05,6.2,4.3,0.24,{size:9,color:'8795AA'});
  card(s,6.15,1.95,6.45,4.85,C.white,C.mint);
  text(s,'把一次测评变成四次触达',6.52,2.28,5.5,0.32,{size:16,color:C.ink,bold:true});
  const touch=[['测评当天','发报告 + 解释薄弱点'],['第 2 天','推一个 3 分钟纠音任务'],['第 7 天','发周报 + 对比变化'],['第 30 天','邀请参加进步挑战 / 续费沟通']];
  let ty=2.92;
  for(let i=0;i<touch.length;i++){
    dot(s,6.58,ty+0.1,0.16,[C.coral,C.cyan,C.mint,C.yellow][i]);
    if(i<touch.length-1) line(s,6.66,ty+0.28,6.66,ty+0.72,C.line,1.3);
    text(s,touch[i][0],7.02,ty,1.2,0.3,{size:11,color:C.coral,bold:true});
    text(s,touch[i][1],8.35,ty,3.7,0.3,{size:12.5,color:C.ink,bold:true});
    ty+=0.83;
  }
  text(s,'家长拿到的是“下一步方案”，不是一张看完就忘的分数单。',6.52,6.25,5.4,0.28,{size:12,color:C.mint,bold:true});
  footer(s,5);
}

// 06 B2B value
{
  const s = pptx.addSlide(); rect(s,0,0,W,H,C.cream);
  title(s,'05 · B 端价值','校长买的是增长确定性，不是功能数量','把复杂系统翻译成三张经营报表：招生、交付、续费。');
  addImg(s,IMG('feat_classroom.png'),8.0,1.75,4.55,4.95);
  const data=[
    ['01','招生可量化','每个测评链接、渠道和机构码都可归因','线索从哪里来，一眼看清',C.coral],
    ['02','教学可复制','AI 组卷、自动批改、实时学情让新老师也能上手','不靠某个老师“会不会带”',C.cyan],
    ['03','续费可解释','周报、前后对比、薄弱点复练形成证据链','家长问效果时，有数据可讲',C.mint]
  ];
  let y=2.0;
  for(const [no,head,body,tag,col] of data){
    card(s,0.7,y,6.8,1.32,C.white,col);
    pill(s,no,1.0,y+0.28,0.52,col,col===C.yellow?C.ink:C.white,10);
    text(s,head,1.78,y+0.18,2.0,0.3,{size:16,color:C.ink,bold:true});
    text(s,body,1.78,y+0.55,4.9,0.32,{size:11.5,color:C.gray});
    text(s,tag,1.78,y+0.92,4.9,0.24,{size:10,color:col,bold:true});
    y+=1.48;
  }
  text(s,'销售话术：您买的不是“多几个功能”，而是把招生、教学、续费三笔账，放进同一个看板。',0.78,6.55,11.6,0.32,{size:13,color:C.coral,bold:true});
  footer(s,6);
}

// 07 B2B operation cadence
{
  const s = pptx.addSlide(); rect(s,0,0,W,H,C.navy);
  text(s,'06 · B 端运营','加盟商拿到系统后，第一月怎么跑？',0.7,0.52,12,0.35,{size:11,color:C.cyan,bold:true,charSpacing:1.1});
  text(s,'四周跑出第一条“结果链”',0.7,0.92,12,0.6,{size:29,color:C.white,bold:true});
  text(s,'总部给模板与数据看板，门店照节奏执行；销售不只签约，还要陪跑到第一份报告和第一次续费沟通。',0.7,1.58,11.5,0.4,{size:13,color:'C3CBD8'});
  const weeks=[
    ['W1','装起来','开机构 / 导入词库 / 绑定老师','目标：首个班开通',C.coral],
    ['W2','跑起来','免费测评 + 体验课 + 首次作业','目标：首批真实数据',C.cyan],
    ['W3','看得见','AI 周报 + 家长沟通 + 纠音任务','目标：家长收到证据',C.mint],
    ['W4','转起来','进步挑战 + 兑奖日 + 续费面谈','目标：复购 / 转介绍',C.yellow]
  ];
  let x=0.72;
  for(let i=0;i<weeks.length;i++){
    const [wk,head,body,goal,col]=weeks[i];
    rect(s,x,2.75,2.78,2.72,'172238',0.1);
    pill(s,wk,x+0.24,3.02,0.54,col,col===C.yellow?C.ink:C.white,10);
    text(s,head,x+0.24,3.55,2.2,0.34,{size:17,color:C.white,bold:true});
    text(s,body,x+0.24,4.1,2.24,0.72,{size:12,color:'D3DBE7'});
    line(s,x+0.24,5.14,x+2.45,5.14,'314159',0.8);
    text(s,goal,x+0.24,5.34,2.2,0.3,{size:10.5,color:col,bold:true});
    if(i<3) arrow(s,x+2.8,4.1,x+3.03,4.1,C.coral);
    x+=3.07;
  }
  text(s,'经营纪律：每周只盯 3 个数 —— 新增线索、活跃学生、家长触达。',0.78,6.18,11.8,0.35,{size:16,color:C.yellow,bold:true,align:'center'});
  footer(s,7,true);
}

// 08 B2C experience
{
  const s = pptx.addSlide(); rect(s,0,0,W,H,C.cream);
  title(s,'07 · C 端体验','孩子愿意用，家长愿意续','C 端不是“被动使用者”，而是每天把增长链路跑起来的人。');
  addImg(s,IMG('feat_parent.png'),8.05,1.72,4.45,4.98);
  const cols=[
    {x:0.72, head:'孩子的 5 分钟', ac:C.coral, fill:C.peach, items:['读 6 个词，马上知道哪里需要改','完成纠音任务，获得宠物 / 段位反馈','参加 PK 与进步挑战，形成下一次回来的理由']},
    {x:4.45, head:'家长的 30 秒', ac:C.mint, fill:C.greenPale, items:['看懂目标词、近音词和纠音建议','知道孩子下一步该练什么，而不是只看分数','收到可转发的进步报告，愿意带来同学']}
  ];
  for(const col of cols){
    card(s,col.x,2.02,3.25,4.45,col.fill,col.ac);
    text(s,col.head,col.x+0.3,2.35,2.6,0.36,{size:18,color:C.ink,bold:true});
    let iy=3.15;
    for(let i=0;i<col.items.length;i++){
      pill(s,String(i+1).padStart(2,'0'),col.x+0.3,iy,0.44,col.ac,col.ac===C.yellow?C.ink:C.white,9);
      text(s,col.items[i],col.x+0.92,iy-0.02,1.95,0.58,{size:11.5,color:C.gray});
      iy+=0.98;
    }
  }
  footer(s,8);
}

// 09 Promotion playbook
{
  const s = pptx.addSlide(); rect(s,0,0,W,H,C.navy);
  text(s,'08 · 推广打法',0.7,0.52,12,0.28,{size:11,color:C.cyan,bold:true,charSpacing:1.2});
  text(s,'推广不靠撒传单，靠可传播的结果',0.7,0.9,12,0.62,{size:29,color:C.white,bold:true});
  text(s,'每个渠道都导向同一个动作：免费读 6 个词 → 出报告 → 留线索 → 进入 7 天体验。',0.7,1.56,11.5,0.38,{size:13,color:'C3CBD8'});
  addImg(s,IMG('divider_franchise.png'),7.65,2.25,5.0,3.9);
  const channels=[
    ['地推 / 家长会','一句话：让孩子读 6 个词，一分钟出发音报告。',C.coral],
    ['短视频 / 朋友圈','展示前后对比，不展示空泛的“AI 很强”。',C.cyan],
    ['体验课 / 公开课','现场测评 + 默写 + PK，让家长看到完整闭环。',C.mint],
    ['老带新 / 社群','发进步海报与挑战赛，奖励给孩子，不靠硬推销。',C.yellow]
  ];
  let y=2.35;
  for(const [head,body,col] of channels){
    dot(s,0.88,y+0.1,0.18,col);
    text(s,head,1.25,y,2.0,0.3,{size:14,color:C.white,bold:true});
    text(s,body,3.0,y,4.2,0.46,{size:11.5,color:'D3DBE7'});
    y+=0.86;
  }
  text(s,'渠道 KPI 不看“发了多少张海报”，只看：测评完成率、报告打开率、7 天体验转化率。',0.8,6.35,11.6,0.33,{size:14,color:C.yellow,bold:true});
  footer(s,9,true);
}

// 10 Sales script
{
  const s = pptx.addSlide(); rect(s,0,0,W,H,C.cream);
  title(s,'09 · 销售话术','让对方心动的不是“我们很先进”，而是“这件事我能马上做”','以下三段可以直接照着讲，再根据客户类型替换案例。');
  const scripts=[
    ['对校长 / 加盟商','“您现在缺的不是又一个学习工具，而是一套能把招生、教学、续费串起来的经营系统。我们先用一次免费发音测评拿到真实线索，再用周报把变化交给家长看。”',C.coral],
    ['对老师','“您不用记住每个孩子的全部问题。系统会把发音薄弱点、错词和下一步任务整理出来，您只需要按提醒做跟进。”',C.cyan],
    ['对家长','“我们不只告诉您孩子得了多少分，还会告诉您哪几个音没读准、这周练了几次、下周该怎么练。您能看到变化，也知道怎么帮。”',C.mint]
  ];
  let y=1.95;
  for(const [who,quote,col] of scripts){
    card(s,0.72,y,7.35,1.25,C.white,col);
    text(s,who,1.02,y+0.18,1.65,0.28,{size:13,color:col,bold:true});
    text(s,quote,2.65,y+0.12,5.0,0.74,{size:12,color:C.ink,bold:true});
    y+=1.46;
  }
  rect(s,8.42,1.95,4.18,4.42,C.navy,0.08);
  text(s,'常见异议',8.78,2.28,3.1,0.28,{size:15,color:C.yellow,bold:true});
  text(s,'“我们已经有教务系统了。”',8.78,2.82,3.2,0.26,{size:11,color:C.white,bold:true});
  text(s,'→ 教务系统管排课，我们管“学了什么、有没有变好、家长为什么续”。',8.78,3.15,3.15,0.62,{size:11,color:'D3DBE7'});
  text(s,'“AI 打分准吗？”',8.78,4.08,3.2,0.26,{size:11,color:C.white,bold:true});
  text(s,'→ 先看模型怎么解释与复练，再用 7 天前后对比验证，不要求您先相信口号。',8.78,4.4,3.15,0.62,{size:11,color:'D3DBE7'});
  text(s,'“我怕开通后没人用。”',8.78,5.33,3.2,0.26,{size:11,color:C.white,bold:true});
  text(s,'→ 我们给首月运营节奏，陪跑到第一份周报和第一次家长沟通。',8.78,5.65,3.15,0.52,{size:11,color:'D3DBE7'});
  footer(s,10);
}

// 11 Commission
{
  const s = pptx.addSlide(); rect(s,0,0,W,H,C.cream);
  title(s,'10 · 合作激励','销售端 50% 分成：让每一次成交都值得','高分成不是噱头，关键是把“归因、回款、结算”三件事写清楚。');
  rect(s,0.72,1.95,4.4,4.85,C.navy,0.08);
  pill(s,'销售端成交奖励',1.08,2.35,1.65,C.cyan,C.ink,10);
  text(s,'50%',1.02,2.92,3.5,0.9,{size:58,color:C.yellow,bold:true});
  text(s,'按加盟实收净额核算',1.08,4.05,3.25,0.35,{size:18,color:C.white,bold:true});
  text(s,'签约 · 回款 · 可追踪',1.08,4.52,3.25,0.28,{size:12,color:'C7D0DE'});
  pill(s,'规则清晰',1.08,5.35,1.35,C.coral,C.white,10);
  pill(s,'多劳多得',2.58,5.35,1.35,C.mint,C.ink,10);
  text(s,'示例：县级独家 ¥98,000 → 销售端 ¥49,000',1.08,6.08,3.65,0.32,{size:11.5,color:C.yellow,bold:true});
  card(s,5.55,1.95,7.05,4.85,C.white,C.coral);
  text(s,'合作前先把 4 个口径写进协议',5.95,2.35,5.9,0.35,{size:17,color:C.ink,bold:true});
  const rules=[['01','谁归因','渠道码 / 机构码 / CRM 录入'],['02','怎么算','实收净额、退款与折扣如何处理'],['03','何时结','回款后几日结算，月结还是单结'],['04','谁负责','总部交付、培训与售后边界']];
  let ry=2.98;
  for(const [no,head,body] of rules){
    pill(s,no,5.95,ry,0.5,C.coral,C.white,9);
    text(s,head,6.7,ry-0.02,1.0,0.28,{size:13,color:C.coral,bold:true});
    text(s,body,7.75,ry-0.02,4.3,0.28,{size:12,color:C.gray});
    ry+=0.73;
  }
  line(s,5.95,5.97,12.1,5.97,C.line,0.8);
  text(s,'销售承诺：你负责找到对的人，我们负责把交付跑通。',5.95,6.23,5.95,0.28,{size:13,color:C.greenPale==='x'?C.mint:C.mint,bold:true});
  footer(s,11);
}

// 12 30-day plan
{
  const s = pptx.addSlide(); rect(s,0,0,W,H,C.navy);
  text(s,'11 · 交付计划',0.7,0.52,12,0.28,{size:11,color:C.cyan,bold:true,charSpacing:1.2});
  text(s,'签约之后 30 天，照表执行',0.7,0.9,12,0.62,{size:29,color:C.white,bold:true});
  text(s,'把“希望有效果”变成“每周有动作、每周有证据、每周有人负责”。',0.7,1.56,11.5,0.4,{size:13,color:'C3CBD8'});
  const plan=[
    ['D1–3','配置','机构 / 品牌 / 账号 / 词库','总部 + 店长'],
    ['D4–7','首班','免费测评 + 体验课 + 首次作业','店长 + 老师'],
    ['W2','运营','纠音任务 + PK + 家长绑定','老师'],
    ['W3','证据','周报 + 前后对比 + 进步海报','老师 + 销售'],
    ['W4','转化','进步挑战 + 续费面谈 + 转介绍','店长 + 销售']
  ];
  let y=2.45;
  for(let i=0;i<plan.length;i++){
    const [when,head,body,owner]=plan[i];
    const col=[C.coral,C.cyan,C.mint,C.yellow,C.lilac][i];
    pill(s,when,0.85,y,0.84,col,col===C.yellow?C.ink:C.white,10);
    text(s,head,2.05,y-0.02,1.2,0.3,{size:15,color:C.white,bold:true});
    text(s,body,3.5,y-0.02,4.6,0.3,{size:12.5,color:'D3DBE7'});
    pill(s,owner,9.4,y,2.2,'172238',col,9);
    if(i<plan.length-1) line(s,1.27,y+0.35,1.27,y+0.77,'334258',1.2);
    y+=0.76;
  }
  text(s,'验收不是“系统上线”，而是“第一份报告发出去、第一次续费沟通完成”。',0.8,6.42,11.6,0.35,{size:15,color:C.yellow,bold:true,align:'center'});
  footer(s,12,true);
}

// 13 Closing
{
  const s = pptx.addSlide(); rect(s,0,0,W,H,C.navy);
  addImg(s,IMG('closing.png'),6.2,0,7.13,H);
  rect(s,0,0,7.2,H,C.navy);
  rect(s,0,0,0.16,H,C.coral);
  text(s,'先跑 1 个班，\n7 天看见第一份变化',0.82,1.55,5.4,1.35,{size:30,color:C.white,bold:true});
  text(s,'让孩子敢开口，让家长看见变化，让校长算得清账。',0.84,3.48,5.25,0.4,{size:16,color:C.yellow,bold:true});
  line(s,0.84,4.32,1.84,4.32,C.cyan,3);
  text(s,'合作入口：免费发音测评 → 首班试点 → 7 天复盘',0.84,4.7,5.45,0.38,{size:14,color:'D3DBE7'});
  pill(s,'预约演示 / 加盟咨询',0.84,5.55,1.95,C.coral,C.white,11);
  text(s,'联系方式：__________________',0.84,6.15,4.6,0.28,{size:12,color:C.white});
  footer(s,13,true);
}

pptx.writeFile({ fileName: path.join(ROOT, '加盟销售PPT_重设计.pptx') });
