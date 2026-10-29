/* ══════════════════════════════════════════════════
   Muse Local · 原型交互逻辑 v0.6
   单台电脑 · 无图形桌面 · 画面默认不显示，点快照展开
   接管后可以直接操作窗口 · 分栏可拖动 · 画面可放大
   ══════════════════════════════════════════════════ */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clock = () => new Date().toLocaleTimeString('zh-CN', { hour12:false, hour:'2-digit', minute:'2-digit' });
const STAGE_W = 1024;
const DEFAULT_DOCK_W = 520;

/* ══════════════ 状态 ══════════════ */
const S = {
  view:'chat',
  screen:'none',        // none | chrome
  dockOpen:false,       // 画面面板是否展开
  running:false,
  aborted:false,
  takeover:false,
  resumeResolve:null,
  approvalResolve:null,
  tasks:TASKS.map(t => ({ ...t })),
  filter:'all'
};

const PAGE = {
  google:{ url:'www.google.com',       title:'Google' },
  hn:    { url:'news.ycombinator.com', title:'Hacker News' },
  blank: { url:'about:blank',          title:'正在加载…' }
};
const KEY2PAGE = { 'none':'none', 'chrome-loading':'blank', 'chrome-hn':'hn', 'chrome-google':'google' };

/* 被转播的浏览器状态，用户接管后会直接改它 */
const WEB = { page:'none', url:'', title:'', query:'', focus:false, article:null, hist:[], hi:-1 };

/* ══════════════ 窗口画面 ══════════════ */
function metaFor(page, st){
  if (page === 'results')
    return { url:'www.google.com/search?q=' + encodeURIComponent(st.query || ''), title:(st.query || '') + ' — Google 搜索' };
  if (page === 'article')
    return { url:(st.article && st.article.url) || 'example.com', title:(st.article && st.article.title) || '文章' };
  return PAGE[page] || { url:'', title:'' };
}

function noSignalHTML(){
  return `<div class="no-signal">
    <div class="ns-ico">🖥</div>
    <b>当前没有可显示的窗口</b>
    <span>这台电脑没有图形桌面。AI 需要操作浏览器时，<br>那个窗口的实时画面会出现在这里。</span>
  </div>`;
}

const HN_ROWS = [
  { r:1, t:'Anthropic 发布新的 Agent 沙箱隔离规范', ai:true,  p:412, c:186 },
  { r:2, t:'Show HN: 用 Rust 重写一个本地虚拟机管理器', ai:false, p:356, c:121 },
  { r:3, t:'关于提示注入攻击的最新研究综述', ai:true,  p:298, c:88 },
  { r:4, t:'Playwright 2.0 发布：原生支持视觉定位', ai:true, p:241, c:64 },
  { r:5, t:'轻量级 Linux 桌面在 AI Agent 场景下的取舍', ai:true, p:187, c:42 },
  { r:6, t:'Postgres 18 的查询计划缓存改进', ai:false, p:164, c:73 },
  { r:7, t:'为什么我们放弃了容器，改用虚拟机做隔离', ai:false, p:151, c:96 }
];

function googleLogoHTML(cls){
  return `<div class="${cls}"><span class="c1">G</span><span class="c2">o</span><span class="c3">o</span>`
       + `<span class="c4">g</span><span class="c5">l</span><span class="c6">e</span></div>`;
}

function bodyFor(page, st){
  if (page === 'blank')
    return `<div class="loading-page"><div class="lp-bar"><i></i></div></div>`;

  if (page === 'google'){
    const q = (st.query || '');
    return `<div class="gpage">
      <div class="g-top"><span data-act="web-login">Gmail</span><span data-act="web-login">图片</span><span class="g-login" data-act="web-login">登录</span></div>
      ${googleLogoHTML('g-logo')}
      <div class="g-search ${st.focus ? 'focus' : ''}" data-act="web-focus">
        <span class="ic">🔍</span>
        ${q ? `<span class="qs">${esc(q)}</span>` : '<span class="ph">搜索或输入网址</span>'}
        ${st.focus ? '<span class="caret"></span>' : ''}
        <span class="ic">🎤</span><span class="ic">📷</span>
        <span class="g-ai">AI 模式</span>
      </div>
      <div class="g-btns">
        <button data-act="web-search">Google 搜索</button>
        <button data-act="web-lucky">手气不错</button>
      </div>
      <div class="g-foot">
        <span>Google 提供：日本語</span><span>日本</span>
        <span style="margin-left:auto">关于 Google　隐私权　条款</span>
      </div>
    </div>`;
  }

  if (page === 'results'){
    const q = st.query || '';
    const items = [
      { u:'news.ycombinator.com', ti:`${q} — 最新讨论与整理`, d:'Anthropic 发布新的 Agent 沙箱隔离规范；关于提示注入攻击的最新研究综述；轻量级 Linux 桌面在 AI Agent 场景下的取舍。' },
      { u:'arxiv.org',            ti:`关于「${q}」的研究综述`, d:'本文梳理了近两年与提示注入、工具权限边界、沙箱隔离相关的主要工作，并给出了可复现的评测方法。' },
      { u:'docs.python.org',      ti:`${q} 入门：用 Python 处理网页数据`, d:'requests 抓取、lxml 解析、openpyxl 写出表格的完整示例，包含分页与限速的处理方式。' }
    ];
    return `<div class="res-page">
      <div class="res-head">${googleLogoHTML('lg')}
        <div class="res-box"><span style="color:#9aa0a6">🔍</span><span>${esc(q)}</span></div>
      </div>
      <div class="res-stat">找到约 1,240,000 条结果（用时 0.38 秒）</div>
      ${items.map(i => `<div class="res" data-act="web-result" data-title="${esc(i.ti)}" data-url="${esc(i.u)}">
        <div class="u">${esc(i.u)}</div>
        <div class="ti">${esc(i.ti)}</div>
        <div class="d">${esc(i.d)}</div>
      </div>`).join('')}
    </div>`;
  }

  if (page === 'hn'){
    return `<div class="hn">
      <div class="hn-head"><b>Y</b><span>Hacker News</span>
        <span style="font-size:14px">new | past | comments | ask | show | jobs</span></div>
      <div class="hn-body">
        ${HN_ROWS.map(x => `<div class="hn-row">
          <span class="rank">${x.r}.</span>
          <div>
            <div class="t${x.ai ? ' ai' : ''}" data-act="web-link"
                 data-title="${esc(x.t)}" data-url="news.ycombinator.com">${esc(x.t)}</div>
            <div class="sub">${x.p} points · 作者 muse · ${x.c} comments</div>
          </div>
        </div>`).join('')}
      </div>
      <div class="selection-box" style="left:14px;top:52px;right:14px;height:48px"></div>
    </div>`;
  }

  if (page === 'article'){
    const a = st.article || { title:'文章', url:'example.com' };
    return `<div class="art-page">
      <h1>${esc(a.title)}</h1>
      <div class="by">${esc(a.url)} · 3 分钟阅读</div>
      <div class="lead">这是一篇模拟出来的文章正文。真实运行时，这里是网页实际渲染出来的内容，你可以在这里滚动、选中文字。</div>
      <div class="ln"></div><div class="ln m"></div><div class="ln s"></div><div class="ln"></div>
      <div class="ln m"></div><div class="ln"></div><div class="ln s"></div><div class="ln m"></div>
      <div class="ln"></div><div class="ln s"></div>
    </div>`;
  }
  return '';
}

function windowHTMLFor(page, st){
  st = st || {};
  const m = metaFor(page, st);
  return `<div class="brw">
    <div class="brw-tabs">
      <div class="brw-tab"><span class="fav">🌐</span><span>${esc(m.title)}</span>
        <span class="x" data-act="web-close">✕</span></div>
      <div class="brw-plus" data-act="web-newtab">＋</div>
      <div class="brw-spacer"></div>
      <div class="brw-ctrl">– ▢ ✕</div>
    </div>
    <div class="brw-bar">
      <span class="nav" data-act="web-back">‹</span>
      <span class="nav" data-act="web-forward">›</span>
      <span class="nav" data-act="web-reload">⟳</span>
      <span class="url-pill"><span class="lock">🔒</span>${esc(m.url)}</span>
      <span class="nav">⋮</span>
    </div>
    <div class="brw-body">${bodyFor(page, st)}</div>
  </div>`;
}

/* ══════════════ 面板展开 / 折叠 ══════════════ */
function updateDockUI(){
  const has = S.screen !== 'none';
  const show = has && S.dockOpen;
  $('#dock').classList.toggle('hidden', !show);
  $('#splitter').classList.toggle('hidden', !show);
  $$('[data-act="takeover"]').forEach(b => { b.disabled = !has; });
  requestAnimationFrame(fitFrames);
}
function setDockOpen(on){
  S.dockOpen = !!on;
  updateDockUI();
}

function renderWindow(){
  const has = S.screen !== 'none';
  const html = has ? windowHTMLFor(WEB.page, WEB) : noSignalHTML();
  $$('.live-screen').forEach(el => { el.innerHTML = html; });
  const sub = $('#dockSub');
  if (sub) sub.textContent = has ? `当前窗口 · Chromium — ${WEB.title}` : '当前没有可显示的窗口';
  if (!has) S.dockOpen = false;          // 没有窗口就没什么可看的
  updateDockUI();
}

function setPage(page, opts){
  opts = opts || {};
  WEB.page = page;
  if ('query' in opts) WEB.query = opts.query;
  if ('article' in opts) WEB.article = opts.article || null;
  WEB.focus = false;
  const m = metaFor(page, WEB);
  WEB.url = m.url;
  WEB.title = m.title;
  S.screen = (page === 'none') ? 'none' : 'chrome';
  renderWindow();
}
function paintScreen(key){ setPage(KEY2PAGE[key] || 'none'); }

function pushHist(){
  WEB.hist = WEB.hist.slice(0, WEB.hi + 1);
  WEB.hist.push({ page:WEB.page, query:WEB.query, article:WEB.article });
  WEB.hi = WEB.hist.length - 1;
}
function goPage(page, opts){ setPage(page, opts); pushHist(); }
function nav(d){
  const i = WEB.hi + d;
  if (i < 0 || i >= WEB.hist.length) return;
  WEB.hi = i;
  const s = WEB.hist[i];
  setPage(s.page, { query:s.query, article:s.article });
}

/* ══════════════ 光标 ══════════════ */
function setCursorXY(x, y, instant){
  $$('.live-cursor').forEach(c => {
    c.classList.toggle('instant', !!instant);
    c.style.left = x + 'px';
    c.style.top  = y + 'px';
  });
}
function rippleCursor(){
  $$('.live-cursor').forEach(c => {
    c.classList.remove('click'); void c.offsetWidth; c.classList.add('click');
    setTimeout(() => c.classList.remove('click'), 520);
  });
}
function moveCursor(pos){
  if (!pos) return;
  setCursorXY(pos.x, pos.y, false);
  rippleCursor();
}

function fitFrames(){
  $$('.screen-frame').forEach(f => {
    const host = f.parentElement;
    if (!host) return;
    const cs = getComputedStyle(host);
    const fcs = getComputedStyle(f);
    const availW = host.clientWidth  - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
                   - parseFloat(fcs.marginLeft) - parseFloat(fcs.marginRight);
    const availH = host.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
                   - parseFloat(fcs.marginTop) - parseFloat(fcs.marginBottom);
    if (availW <= 20 || availH <= 20) return;
    let W = availW, H = W * 0.625;
    if (H > availH){ H = availH; W = H * 1.6; }
    W = Math.floor(W); H = Math.floor(H);
    f.style.width = W + 'px';
    f.style.height = H + 'px';
    const st = f.querySelector('.stage');
    if (st) st.style.transform = 'scale(' + (W / STAGE_W) + ')';
    const cur = f.querySelector('.cursor');
    if (cur) cur.style.transform = 'scale(' + (STAGE_W / W) + ')';
  });
}

/* ══════════════ 时间线 ══════════════ */
const TL = () => $('#timeline');

function addEvent(html, cls){
  const d = document.createElement('div');
  d.className = 'ev ' + (cls || '');
  d.innerHTML = html;
  TL().appendChild(d);
  TL().scrollTop = TL().scrollHeight;
  return d;
}
function note(text){ addEvent(`<div class="ev-note">${esc(text)}</div>`, ''); }

function argLine(args){
  return Object.entries(args || {}).map(([k, v]) => {
    const s = String(v);
    return k + '=' + (s.length > 46 ? s.slice(0, 46) + '…' : s);
  }).join('  ');
}
function kvHTML(args){
  return '<dl class="kv">' + Object.entries(args || {}).map(([k, v]) =>
    `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('') + '</dl>';
}
function toolCardHTML(step){
  return `<div class="tool-card">
    <div class="tool-head">
      <span class="t-dot"></span>
      <span class="tool-name">${esc(step.tool)}</span>
      <span class="tool-arg-inline">${esc(argLine(step.args))}</span>
      <span class="tool-status"><span class="spinner"></span></span>
    </div>
    <div class="tool-body">${kvHTML(step.args)}<div class="tool-result"></div></div>
  </div>`;
}
function execCardHTML(step){
  return `<div class="tool-card">
    <div class="tool-head">
      <span class="t-dot"></span>
      <span class="tool-name">${esc(step.tool)}</span>
      <span class="tool-arg-inline">${esc(step.cmd || '')}</span>
      <span class="tool-status"><span class="spinner"></span></span>
    </div>
    <div class="tool-body">
      <div class="term-block"><div class="tc">${esc(step.cmd || '')}</div><div class="to"></div></div>
    </div>
  </div>`;
}
/* 快照：点一下就能把右边那块实时画面打开 */
function snapFrameHTML(screenKey){
  const page = KEY2PAGE[screenKey] || 'google';
  return `<div class="snap-frame" data-act="open-dock" data-page="${page}">
    <div class="stage" style="transform:scale(${(460 / STAGE_W).toFixed(3)})">
      <div class="screen">${windowHTMLFor(page, {})}</div>
    </div>
    <div class="snap-open"><span>点击打开实时画面</span></div>
  </div>`;
}
function snapHTML(step){
  const page = KEY2PAGE[step.screen] || 'google';
  const open = S.screen !== 'none' && WEB.page === page;
  return `<div class="ev-snap">
    ${snapFrameHTML(step.screen)}
    <div class="cap">📷 ${esc(step.caption)} · ${open ? '点快照展开实时画面' : '点快照打开实时画面'}</div>
  </div>`;
}
function approvalHTML(step){
  const riskCls = step.risk === '高' ? 'high' : 'mid';
  return `<div class="approval">
    <div class="approval-head">
      <b style="font-size:12.5px">需要你的确认</b>
      <span class="risk ${riskCls}">风险：${esc(step.risk)}</span>
      <span class="tool-name" style="margin-left:auto">${esc(step.tool)}</span>
    </div>
    <div class="approval-body">
      <div class="approval-reason">${esc(step.reason)}</div>
      <div class="cmd">${esc(argLine(step.args))}</div>
      <div class="approval-actions">
        <button class="btn primary sm" data-dec="allow">本次允许</button>
        <button class="btn ghost sm" data-dec="always">本任务总是允许</button>
        <button class="btn danger sm" data-dec="deny">拒绝</button>
      </div>
    </div>
  </div>`;
}
/* 完成：默认只有一行，统计折叠在「详情」里 */
function summaryHTML(step){
  return `<div class="summary">
    <div class="summary-head">
      <span class="s-ico">✓</span><b>任务完成</b>
      <span class="hint">${clock()}</span>
      <button class="mini-btn" data-act="summary-toggle" style="margin-left:auto">详情 ⌄</button>
    </div>
    <div>${(step.artifacts || []).map(a => `
      <div class="artifact">
        <div class="ico">📊</div>
        <div><div class="nm">${esc(a.name)}</div><div class="pt">${esc(a.path)} · ${esc(a.size)}</div></div>
        <button class="btn ghost xs" style="margin-left:auto">导出到本机</button>
      </div>`).join('')}</div>
    <div class="summary-stats" hidden>
      <div>耗时<b>${esc(step.dur)}</b></div>
      <div>输入 Token<b>${(step.tokIn/1000).toFixed(1)}k</b></div>
      <div>输出 Token<b>${(step.tokOut/1000).toFixed(1)}k</b></div>
      <div>费用<b>${esc(step.cost)}</b></div>
    </div>
  </div>`;
}

/* ══════════════ 状态与提示 ══════════════ */
function setStatus(text, kind){
  $('#taskStatusPill').className = 'pill ' + (kind || 'idle');
  $('#taskStatusText').textContent = text;
}
function toast(text, kind){
  const d = document.createElement('div');
  d.className = 'toast ' + (kind || '');
  d.innerHTML = `<span>${kind === 'ok' ? '✓' : kind === 'warn' ? '⚠' : 'ℹ'}</span><span>${esc(text)}</span>`;
  $('#toastRoot').appendChild(d);
  setTimeout(() => { d.style.transition = '.25s'; d.style.opacity = '0'; setTimeout(() => d.remove(), 260); }, 2600);
}

/* ══════════════ 任务执行引擎 ══════════════ */
async function doAssistant(step){
  const wrap = addEvent(`<div class="ev-ai">
    <div class="text"><span class="thinking"><span class="shimmer"></span><span>思考中…</span></span></div></div>`);
  await sleep(step.think || 700);
  const box = wrap.querySelector('.text');
  box.innerHTML = '';
  const span = document.createElement('span');
  box.appendChild(span);
  const text = step.text;
  for (let i = 0; i < text.length && !S.aborted; i += 2){
    span.textContent = text.slice(0, i + 2);
    TL().scrollTop = TL().scrollHeight;
    await sleep(16);
  }
  span.textContent = text;
}

async function doTool(step){
  const wrap = addEvent(toolCardHTML(step));
  const card = wrap.querySelector('.tool-card');
  const status = card.querySelector('.tool-status');
  card.classList.add('running', 'open');
  await sleep(step.dur || 800);
  if (S.aborted){ status.innerHTML = '<span style="color:var(--fg3)">已中断</span>'; throw new Error('aborted'); }
  card.classList.remove('running');
  card.classList.add('done');
  if (step.result) card.querySelector('.tool-result').textContent = step.result;
  status.innerHTML = `<span class="tick">✓</span><span>${((step.dur || 800) / 1000).toFixed(1)}s</span>`;
  if (step.screen) paintScreen(step.screen);
  if (step.cursor) moveCursor(step.cursor);
  TL().scrollTop = TL().scrollHeight;
}

async function doExec(step){
  const wrap = addEvent(execCardHTML(step));
  const card = wrap.querySelector('.tool-card');
  const status = card.querySelector('.tool-status');
  const out = card.querySelector('.to');
  card.classList.add('running', 'open');
  await sleep(step.dur || 900);
  if (S.aborted){ status.innerHTML = '<span style="color:var(--fg3)">已中断</span>'; throw new Error('aborted'); }
  card.classList.remove('running');
  card.classList.add('done');
  out.textContent = step.out || '';
  status.innerHTML = `<span class="tick">✓</span><span>${((step.dur || 900) / 1000).toFixed(1)}s</span>`;
  TL().scrollTop = TL().scrollHeight;
}

function askApproval(step){
  return new Promise(resolve => {
    const wrap = addEvent(approvalHTML(step));
    const card = wrap.querySelector('.approval');
    S.approvalResolve = resolve;
    $$('[data-dec]', card).forEach(btn => {
      btn.onclick = () => {
        const dec = btn.dataset.dec;
        const label = dec === 'deny' ? '拒绝' : dec === 'always' ? '本任务总是允许' : '本次允许';
        S.approvalResolve = null;
        card.classList.add('done');
        card.querySelector('.approval-body').innerHTML =
          `<div class="decision">${dec === 'deny' ? '⛔' : '✓'} 你的决定：<b>${label}</b> · ${clock()}</div>`;
        setStatus(dec === 'deny' ? 'AI 正在调整方案' : '运行中', dec === 'deny' ? 'paused' : 'running');
        resolve(dec);
      };
    });
    setStatus('等待你的确认', 'waiting');
  });
}

function waitResume(){ return new Promise(r => { S.resumeResolve = r; }); }

async function runSteps(steps){
  for (const step of steps){
    if (S.aborted) throw new Error('aborted');
    if (S.takeover) await waitResume();
    switch (step.t){
      case 'assistant': await doAssistant(step); break;
      case 'tool':      await doTool(step); break;
      case 'exec':      await doExec(step); break;
      case 'snapshot':  addEvent(snapHTML(step)); break;
      case 'summary':   addEvent(summaryHTML(step)); break;
      case 'note':      note(step.text); break;
      case 'approval': {
        const dec = await askApproval(step);
        await runSteps(dec === 'deny' ? (step.onDeny || []) : (step.onAllow || []));
        break;
      }
    }
  }
}

async function runTask(prompt, script){
  if (S.running) return;
  script = script || DEMO;
  S.running = true; S.aborted = false;
  if (S.takeover) setTakeover(false);
  $('#btnStop').hidden = false;
  $('#btnSend').disabled = true;
  $('#taskTitle').textContent = script.title;
  TL().innerHTML = '';
  addEvent(`<div class="ev-user">
      <div class="bubble">${esc(prompt)}</div>
      <div class="meta">${clock()} · ${COMPUTER.name}</div></div>`, 'ev-user');
  setStatus('运行中', 'running');

  const started = Date.now();
  try {
    await runSteps(script.steps);
    if (!S.aborted) setStatus('已完成', 'done');
  } catch (e){
    if (e.message === 'aborted'){ note('任务已被你停止'); setStatus('已停止', 'idle'); }
  } finally {
    S.running = false;
    S.approvalResolve = null;
    S.resumeResolve = null;
    $('#btnStop').hidden = true;
    $('#btnSend').disabled = false;
    const secs = Math.round((Date.now() - started) / 1000);
    S.tasks.unshift({
      id:'t-' + (1044 + Math.floor(Math.random() * 90)),
      title:script.title, status:'done', model:'claude-fable-5-1',
      dur:Math.floor(secs / 60) + 'm ' + String(secs % 60).padStart(2,'0') + 's',
      tok:'48.2k', cost:'$0.42', when:'刚刚'
    });
    renderTasks();
  }
}

function stopTask(){
  if (!S.running) return;
  S.aborted = true;
  if (S.resumeResolve){ S.resumeResolve(); S.resumeResolve = null; }
  $$('.approval:not(.done)').forEach(card => {
    card.classList.add('done');
    card.querySelector('.approval-body').innerHTML = '<div class="decision">⛔ 任务已停止，审批已取消</div>';
  });
  if (S.approvalResolve){ const r = S.approvalResolve; S.approvalResolve = null; r('deny'); }
}

/* ══════════════ 接管窗口 ══════════════ */
function syncTakeoverUI(){
  $$('.screen-frame').forEach(f => f.classList.toggle('takeover', S.takeover));
  $$('.control-badge').forEach(b => { b.hidden = !S.takeover; });
  $$('[data-act="takeover"]').forEach(b => { b.hidden = S.takeover; });
  $$('[data-act="release"]').forEach(b => { b.hidden = !S.takeover; });
  const n = $('#dockNote');
  if (n) n.textContent = S.takeover
    ? '已接管：直接点击画面里的元素、输入文字、往下滚动。点「交还控制」还给 AI。'
    : '你看到的只是 AI 正在操作的那个应用窗口，不是整台电脑的桌面。';
}

function setTakeover(on){
  if (on && S.screen === 'none'){ toast('现在没有打开的窗口', 'warn'); return; }
  if (on && !S.dockOpen) setDockOpen(true);
  S.takeover = on;
  syncTakeoverUI();
  if (on){
    note('你已接管这个窗口，AI 暂停操作');
    setStatus('人工接管中', 'paused');
    WEB.focus = false;
    renderWindow();
  } else {
    note('控制权已交还，AI 继续');
    if (S.running) setStatus('运行中', 'running');
    if (S.resumeResolve){ S.resumeResolve(); S.resumeResolve = null; }
  }
}

/* ══════════════ 接管后：真正操作这个浏览器 ══════════════ */
function doSearch(){
  const q = WEB.query.trim();
  if (!q){ WEB.focus = true; renderWindow(); toast('先在搜索框里输入内容'); return; }
  goPage('results', { query:q });
}

const ACTIONS = {
  'web-close':   () => { setPage('none'); toast('窗口已关闭'); },
  'web-newtab':  () => { WEB.query = ''; goPage('google'); },
  'web-focus':   () => { WEB.focus = true; renderWindow(); },
  'web-search':  () => doSearch(),
  'web-lucky':   () => goPage('article', { article:{ title:(WEB.query.trim() || 'Google'), url:'www.google.com' } }),
  'web-login':   () => toast('原型演示：不会真的登录'),
  'web-back':    () => nav(-1),
  'web-forward': () => nav(1),
  'web-reload':  () => {
    if (WEB.page === 'none') return;
    const snap = { page:WEB.page, query:WEB.query, article:WEB.article };
    setPage('blank');
    setTimeout(() => setPage(snap.page, { query:snap.query, article:snap.article }), 460);
  },
  'web-result':  el => goPage('article', { article:{ title:el.dataset.title, url:el.dataset.url } }),
  'web-link':    el => goPage('article', { article:{ title:el.dataset.title, url:el.dataset.url } })
};

function onDocClick(e){
  const head = e.target.closest && e.target.closest('.tool-head');
  if (head){ head.parentElement.classList.toggle('open'); return; }

  const hit = e.target.closest && e.target.closest('[data-act]');
  const act = hit ? hit.dataset.act : null;

  if (act === 'summary-toggle'){
    const box = hit.closest('.summary').querySelector('.summary-stats');
    box.hidden = !box.hidden;
    hit.textContent = box.hidden ? '详情 ⌄' : '收起 ⌃';
    return;
  }
  if (act === 'open-dock'){
    const page = hit.dataset.page || 'google';
    if (S.screen === 'none' || WEB.page !== page) setPage(page);
    setDockOpen(true);
    requestAnimationFrame(() => setTimeout(() => { moveCursor({ x:512, y:320 }); }, 60));
    return;
  }
  if (act === 'collapse'){ setDockOpen(false); return; }
  if (act === 'zoom'){ fullscreenModal(); return; }
  if (act === 'takeover'){ setTakeover(true); return; }
  if (act === 'release'){ setTakeover(false); return; }

  const frame = e.target.closest && e.target.closest('.screen-frame');
  if (!frame) return;
  if (!S.takeover){
    if (act && act.indexOf('web-') === 0) toast('先点「接管窗口」，就能自己操作这个浏览器');
    return;
  }
  if (!act || act.indexOf('web-') !== 0) return;
  e.preventDefault();
  const fn = ACTIONS[act];
  if (fn) fn(hit);
}

function onDocKey(e){
  if (!S.takeover || !WEB.focus || WEB.page !== 'google') return;
  const t = e.target;
  if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return;
  if (e.key === 'Backspace'){ WEB.query = WEB.query.slice(0, -1); renderWindow(); e.preventDefault(); return; }
  if (e.key === 'Enter'){ doSearch(); e.preventDefault(); return; }
  if (e.key === 'Escape'){ WEB.focus = false; renderWindow(); return; }
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey){
    WEB.query += e.key; renderWindow(); e.preventDefault();
  }
}

function onDocMove(e){
  if (!S.takeover) return;
  const frame = e.target.closest && e.target.closest('.screen-frame');
  if (!frame) return;
  const st = frame.querySelector('.stage');
  if (!st) return;
  const r = st.getBoundingClientRect();
  const s = r.width / STAGE_W;
  if (s <= 0) return;
  setCursorXY((e.clientX - r.left) / s, (e.clientY - r.top) / s, true);
}

function onDocDown(e){
  if (!S.takeover) return;
  const frame = e.target.closest && e.target.closest('.screen-frame');
  if (frame) rippleCursor();
}

/* ══════════════ 分栏拖动 ══════════════ */
function initSplitter(){
  const sp = $('#splitter'), dock = $('#dock');
  if (!sp || !dock) return;
  const wrap = sp.parentElement;
  let dragging = false;

  const setW = w => {
    const max = Math.max(320, wrap.clientWidth - 400);
    w = Math.max(320, Math.min(max, w));
    dock.style.flexBasis = w + 'px';
    dock.style.width = w + 'px';
    requestAnimationFrame(fitFrames);
  };

  sp.addEventListener('mousedown', e => {
    dragging = true;
    sp.classList.add('drag');
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    e.preventDefault();
  });
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    const r = wrap.getBoundingClientRect();
    setW(r.right - e.clientX);
  });
  const stopDrag = () => {
    if (!dragging) return;
    dragging = false;
    sp.classList.remove('drag');
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  };
  window.addEventListener('mouseup', stopDrag);
  window.addEventListener('blur', stopDrag);
  sp.addEventListener('dblclick', () => setW(DEFAULT_DOCK_W));

  setW(DEFAULT_DOCK_W);
}

/* ══════════════ 视图 ══════════════ */
function setView(v){
  S.view = v;
  $$('.rail-btn[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  $$('.view').forEach(sec => sec.classList.toggle('active', sec.id === 'view-' + v));
  requestAnimationFrame(fitFrames);
}

function statusPill(st){
  const map = {
    running:['running','运行中'], waiting:['waiting','等待确认'],
    done:['done','已完成'], failed:['failed','失败'], paused:['paused','已暂停']
  };
  const [cls, txt] = map[st] || ['idle', st];
  return `<span class="pill ${cls}"><span class="dot"></span>${txt}</span>`;
}

function renderTaskStats(){
  $('#taskStats').innerHTML = TASK_STATS.map(s =>
    `<div class="stat"><div class="k">${s.k}</div><div class="v">${s.v}<small>${s.u}</small></div></div>`).join('');
}

function renderFilters(){
  const items = [['all','全部'],['running','运行中'],['waiting','等待确认'],['done','已完成'],['failed','失败']];
  $('#taskFilters').innerHTML = items.map(([k, t]) =>
    `<button class="filter-chip ${S.filter === k ? 'on' : ''}" data-f="${k}">${t}</button>`).join('');
  $$('#taskFilters .filter-chip').forEach(b => b.onclick = () => { S.filter = b.dataset.f; renderFilters(); renderTasks(); });
}

function renderTasks(){
  const list = S.tasks.filter(t => S.filter === 'all' || t.status === S.filter);
  $('#taskTableBody').innerHTML = list.map(t => `
    <tr>
      <td><div class="t-title">${esc(t.title)}</div><div class="t-id">${esc(t.id)} · ${esc(t.when)}</div></td>
      <td>${statusPill(t.status)}</td>
      <td class="mono">${esc(t.model)}</td>
      <td class="mono">${esc(t.dur)}</td>
      <td class="mono">${esc(t.tok)}</td>
      <td class="mono">${esc(t.cost)}</td>
      <td><div class="row-actions"><button class="link-btn" data-task="${t.id}">${t.status === 'running' ? '查看' : '重跑'}</button></div></td>
    </tr>`).join('')
    || '<tr><td colspan="7" style="text-align:center;color:var(--fg3);padding:26px">没有符合条件的任务</td></tr>';
  $$('[data-task]').forEach(b => b.onclick = () => {
    const t = S.tasks.find(x => x.id === b.dataset.task);
    if (!t) return;
    setView('chat');
    $('#taskTitle').textContent = t.title;
    if (t.status === 'done') setStatus('已完成', 'done');
    toast('已载入任务：' + t.title);
  });
}

function renderSettings(){
  $('#providerList').innerHTML = PROVIDERS.map(p => `
    <div class="provider">
      <div class="pv-logo">${p.short}</div>
      <div class="pv-main">
        <div class="pv-name">${esc(p.name)} <span class="hint">${esc(p.kind)}</span></div>
        <div class="pv-key">${p.key ? esc(p.key) : '未配置 API Key'}</div>
      </div>
      <select data-pv-model="${p.id}" style="width:180px">
        ${p.models.map(m => `<option>${esc(m)}</option>`).join('')}
      </select>
      <button class="btn ghost sm" data-pv-test="${p.id}">测试</button>
      <button class="btn ghost sm" data-pv-toggle="${p.id}">${p.on ? '已启用' : '未启用'}</button>
    </div>`).join('');

  $$('[data-pv-test]').forEach(b => b.onclick = async () => {
    b.textContent = '测试中…'; b.disabled = true;
    await sleep(750);
    b.disabled = false; b.textContent = '已连通';
    toast(PROVIDERS.find(p => p.id === b.dataset.pvTest).name + ' 连通正常 · 延迟 312 ms', 'ok');
  });
  $$('[data-pv-toggle]').forEach(b => b.onclick = () => {
    PROVIDERS.find(x => x.id === b.dataset.pvToggle).on ^= true;
    renderSettings();
  });

  $('#toolMatrix').innerHTML = TOOL_POLICY.map(t => `
    <div class="matrix-row">
      <span class="m-name">${esc(t.tool)}</span>
      <span class="m-desc">${esc(t.desc)}</span>
      <span class="seg">
        <button data-tool="${esc(t.tool)}" data-lv="allow" class="${t.lv === 'allow' ? 'on' : ''}">直接执行</button>
        <button data-tool="${esc(t.tool)}" data-lv="ask"   class="${t.lv === 'ask'   ? 'on' : ''}">需要确认</button>
        <button data-tool="${esc(t.tool)}" data-lv="deny"  class="${t.lv === 'deny'  ? 'on' : ''}">禁止</button>
      </span>
    </div>`).join('');
  $$('#toolMatrix .seg button').forEach(b => b.onclick = () => {
    TOOL_POLICY.find(x => x.tool === b.dataset.tool).lv = b.dataset.lv;
    $$('button', b.parentElement).forEach(x => x.classList.toggle('on', x === b));
  });

  renderDomains();
  renderSnapshots();
  bindSliders();
}

function renderSnapshots(){
  $('#snapshotList').innerHTML = SNAPSHOTS.length
    ? SNAPSHOTS.map(s => `
        <div class="snap-item">
          <div><div class="nm">${esc(s.name)}</div><div class="tm">${esc(s.tm)} · ${esc(s.kind)}</div></div>
          <button data-snap="${s.id}">恢复</button>
        </div>`).join('')
    : '<p class="hint">暂无快照</p>';
  $$('[data-snap]').forEach(b => b.onclick = () => toast('已恢复到快照（原型演示）', 'ok'));
}

function renderDomains(){
  $('#whitelist').innerHTML = DOMAINS.map(d =>
    `<span class="domain-chip">${esc(d)}<button data-rm="${esc(d)}">✕</button></span>`).join('');
  $$('[data-rm]').forEach(b => b.onclick = () => {
    DOMAINS.splice(DOMAINS.indexOf(b.dataset.rm), 1);
    renderDomains();
  });
}

function bindSliders(){
  const apply = () => {
    COMPUTER.spec.vcpu = +$('#rngVcpu').value;
    COMPUTER.spec.mem = +$('#rngMem').value;
    COMPUTER.spec.disk = +$('#rngDisk').value;
    $('#outVcpu').textContent = COMPUTER.spec.vcpu + ' 核';
    $('#outMem').textContent = COMPUTER.spec.mem + ' MB';
    $('#outDisk').textContent = COMPUTER.spec.disk + ' GB';
  };
  ['#rngVcpu','#rngMem','#rngDisk'].forEach(s => { $(s).oninput = apply; });
  apply();
}

/* ══════════════ 模态框 ══════════════ */
function openModal({ title, body, footer, wide, bodyClass }){
  const bd = document.createElement('div');
  bd.className = 'backdrop';
  bd.innerHTML = `<div class="modal ${wide ? 'wide' : ''}">
    <div class="modal-head"><h3>${esc(title)}</h3><button class="x-btn" data-close>✕</button></div>
    <div class="modal-body ${bodyClass || ''}">${body}</div>
    ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
  </div>`;
  $('#modalRoot').appendChild(bd);
  const close = () => bd.remove();
  bd.querySelector('[data-close]').onclick = close;
  bd.onclick = e => { if (e.target === bd) close(); };
  bd.close = close;
  return bd;
}

function infoModal(){
  const TABS = ['环境自检','已装软件','已连接服务'];
  const bd = openModal({
    wide:true, title:`这台电脑 · ${COMPUTER.name}`,
    body:`<div class="tabs">${TABS.map((t, i) =>
            `<button class="tab ${i === 0 ? 'on' : ''}" data-tab="${i}">${t}</button>`).join('')}</div>
          <div id="tabBody"></div>`,
    footer:`<button class="btn ghost sm" id="btnRecheck">重新检测</button>
            <button class="btn primary sm" id="btnEnvOk">知道了</button>`
  });

  const envHTML = () => ENV_CHECKS.map(c => `
    <div class="check ${c.st}">
      <div class="c-ico">${c.st === 'ok' ? '✓' : c.st === 'warn' ? '!' : '✕'}</div>
      <div class="c-main"><div class="c-name">${esc(c.name)}</div><div class="c-val">${esc(c.val)}</div></div>
      ${c.st === 'ok' ? '' : '<button class="btn ghost sm">修复</button>'}
    </div>`).join('');

  const softwareHTML = () => `
    <div class="grp"><h4>硬件与系统</h4><div class="kv2">
      ${MACHINE.sys.map(([k, v]) => `<div class="r"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join('')}
    </div></div>
    ${MACHINE.groups.map(g => `<div class="grp"><h4>${esc(g.g)}</h4>
      <div class="chip-cloud">${g.items.map(i => `<span>${esc(i)}</span>`).join('')}</div></div>`).join('')}
    <div class="grp"><h4>没有安装（需要时现装）</h4>
      <div class="chip-cloud warn">${MACHINE.missing.map(i => `<span>${esc(i)}</span>`).join('')}</div></div>`;

  const servicesHTML = () => `
    <div class="grp"><h4>已连接的服务 · ${MACHINE.services.length} 个</h4>
      <div class="chip-cloud">${MACHINE.services.map(s => `<span>${esc(s)}</span>`).join('')}</div></div>
    <div class="grp"><h4>内置技能 · ${MACHINE.skills.length} 个</h4>
      <div class="chip-cloud">${MACHINE.skills.map(s => `<span>${esc(s)}</span>`).join('')}</div></div>
    <p class="note">登录信息保存在电脑的密钥库里，AI 不会在对话里向你索要密码。</p>`;

  const draw = i => {
    $('#tabBody', bd).innerHTML = i === 0 ? envHTML() : i === 1 ? softwareHTML() : servicesHTML();
  };
  $$('.tab', bd).forEach(b => b.onclick = () => {
    $$('.tab', bd).forEach(x => x.classList.toggle('on', x === b));
    draw(+b.dataset.tab);
  });
  draw(0);

  $('#btnEnvOk', bd).onclick = bd.close;
  $('#btnRecheck', bd).onclick = async () => {
    const btn = $('#btnRecheck', bd);
    $$('.tab', bd).forEach((x, i) => x.classList.toggle('on', i === 0));
    btn.textContent = '检测中…'; btn.disabled = true;
    $('#tabBody', bd).style.opacity = '.4';
    await sleep(1100);
    draw(0);
    $('#tabBody', bd).style.opacity = '1';
    btn.textContent = '重新检测'; btn.disabled = false;
    toast('环境检测完成 · 6 项全部通过', 'ok');
  };
}

function fullscreenModal(){
  const bd = openModal({
    wide:true, bodyClass:'flush',
    title:`${COMPUTER.name} · 实时画面`,
    body:`<div class="fs-wrap"><div class="screen-frame">
        <div class="stage">
          <div class="screen live-screen"></div>
          <div class="cursor live-cursor"></div>
        </div>
        <div class="control-badge" hidden>你在控制 · 直接点击画面操作</div>
      </div></div>`,
    footer:`<button class="btn ghost sm" data-act="takeover">接管窗口</button>
            <button class="btn ghost sm" data-act="release" hidden>交还控制</button>
            <button class="btn primary sm" data-close>关闭</button>`
  });
  requestAnimationFrame(() => { syncTakeoverUI(); renderWindow(); fitFrames(); });
}

/* ══════════════ 事件绑定 ══════════════ */
function bind(){
  $$('.rail-btn[data-view]').forEach(b => b.onclick = () => setView(b.dataset.view));
  $('#btnRailEnv').onclick = infoModal;
  $('#btnSelfCheck').onclick = infoModal;
  $('#btnStop').onclick = stopTask;

  const input = $('#composerInput');
  const send = () => {
    const v = input.value.trim();
    if (!v || S.running) return;
    input.value = ''; input.style.height = 'auto';
    $('#suggests').innerHTML = '';
    runTask(v, DEMO);
  };
  $('#btnSend').onclick = send;
  input.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); send(); } };
  input.oninput = () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
  };
  $('#btnAttach').onclick = () => toast('可以把宿主文件拖进窗口，会先复制到电脑的工作区');
  $('#btnModelChip').onclick = () => toast('当前模型：claude-fable-5-1（在「设置 → 模型服务」中切换）');

  $('#btnSaveSettings').onclick = () => toast('设置已保存到本地', 'ok');
  $('#btnAddProvider').onclick = () => toast('原型演示：暂不展开新增流程');
  $('#btnNewSnapshot').onclick = () => {
    SNAPSHOTS.unshift({ id:'s' + Date.now(), name:'手动快照 ' + clock(), tm:'刚刚', kind:'冷快照' });
    renderSnapshots();
    toast('已创建冷快照', 'ok');
  };
  $('#btnAddDomain').onclick = () => {
    const v = $('#inputDomain').value.trim();
    if (!v) return;
    DOMAINS.push(v); $('#inputDomain').value = ''; renderDomains();
    toast('已加入白名单：' + v, 'ok');
  };
  $('#selAccel').onchange = e => {
    COMPUTER.spec.accel = e.target.value.startsWith('WHPX') ? 'WHPX' : 'TCG';
    toast('加速后端下次启动生效：' + COMPUTER.spec.accel);
  };

  document.addEventListener('click', onDocClick);
  document.addEventListener('mousemove', onDocMove);
  document.addEventListener('mousedown', onDocDown);
  document.addEventListener('keydown', onDocKey);

  window.addEventListener('resize', fitFrames);
  if (window.ResizeObserver) new ResizeObserver(fitFrames).observe(document.body);

  initSplitter();
}

/* ══════════════ 启动 ══════════════ */
function seedTimeline(){
  TL().innerHTML = '';
  note(`电脑 ${COMPUTER.name} 已就绪 · ${COMPUTER.base} · 没有图形桌面 · 启动于 ${COMPUTER.created}`);
  note('今天 09:41 · 上一个任务');
  addEvent(`<div class="ev-user">
      <div class="bubble">打开浏览器，看看 Google 首页能不能正常访问</div>
      <div class="meta">09:41 · ${COMPUTER.name}</div></div>`, 'ev-user');
  addEvent(`<div class="ev-ai"><div class="text">浏览器已经在电脑里打开了，停在 Google 首页，没有搜索、没有登录。地址是 www.google.com，页面标题就是 Google。要自己看看的话，点下面那张快照就能把实时画面展开。</div></div>`);
  addEvent(`<div class="ev-snap">
    ${snapFrameHTML('chrome-google')}
    <div class="cap">📷 浏览器窗口快照 · 点快照打开实时画面</div>
  </div>`);
  note('输入新任务，或在下方选一个示例开始');
}

function init(){
  renderTaskStats();
  renderFilters();
  renderTasks();
  renderSettings();
  $('#suggests').innerHTML = SUGGESTS.map(s => `<button class="suggest-chip">${esc(s)}</button>`).join('');
  $$('#suggests .suggest-chip').forEach((b, i) => b.onclick = () => {
    const chip = b.textContent.replace(/^▸\s*/, '');
    $('#suggests').innerHTML = '';
    runTask(chip, i === 0 ? DEMO_GOOGLE : DEMO);
  });
  seedTimeline();
  bind();
  paintScreen('none');
  setStatus('待命', 'idle');
  requestAnimationFrame(fitFrames);
  setTimeout(fitFrames, 120);
}

init();
