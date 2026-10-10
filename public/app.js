import { STORAGE_KEY, restoreState, startRound, recordAnswer, advanceRound } from './engine.js';

const app = document.querySelector('#app');
const notice = document.querySelector('#notice');
const dialog = document.querySelector('#install-dialog');
const names = { sequential: '顺序练习', random: '随机练习', wrong: '错题重刷' };
const types = { single: '单选题', multiple: '多选题', boolean: '判断题' };
let questions, state, selected = [], view = 'home', offlineReady = false;
const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

function flash(message) { notice.textContent = message; notice.classList.add('show'); clearTimeout(flash.timer); flash.timer = setTimeout(() => notice.classList.remove('show'), 5000); }
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch { flash('进度未能保存，请检查浏览器是否允许存储，暂时不要关闭页面。'); }
}
function wrongCount() { return Object.values(state.records).filter(r => !r.correct).length; }
function header(back = false) {
  return `<header>${back ? '<button class="back" data-action="home" aria-label="返回首页">←</button>' : '<span class="brand-icon">C3</span>'}<div class="brand"><strong>通勤刷题</strong><small>安全员 C3 · 专属题库</small></div><button class="status ${offlineReady ? 'ready' : ''}" data-action="install">${offlineReady ? '● 离线可用' : '添加到主屏幕 ↗'}</button></header>`;
}
function home() {
  view = 'home';
  const learned = Object.keys(state.records).length;
  const mastered = Object.values(state.records).filter(r => r.correct).length;
  const progress = Math.round(learned / questions.length * 100);
  app.innerHTML = `${header()}<section class="intro"><span class="eyebrow">把通勤时间，变成一点点进步</span><h1>每天十题，<br>稳稳记住<span class="accent">。</span></h1><p>不必一次学很多。今天，也从一小组开始。</p></section>
    <section class="progress-card"><div class="row"><strong>你的题库足迹</strong><span>${progress}%</span></div><div class="track" role="progressbar" aria-label="题库已练进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><i style="width:${progress}%"></i></div><div class="stats"><div><b>${learned}<small> / ${questions.length}</small></b><span>已练题目</span></div><div><b>${mastered}</b><span>最近答对</span></div><div><b class="orange">${wrongCount()}</b><span>待复习错题</span></div></div></section>
    <section class="start-card"><div class="row"><span class="tag">${state.session ? '上次的练习还在' : '每日一小组'}</span><span class="muted">约 5 分钟</span></div><h2>${state.session ? '接着上次，继续进步' : '下一站，再学会十题'}</h2><p>${state.session ? `${names[state.session.mode]} · 第 ${state.session.index + 1} / ${state.session.ids.length} 题` : `顺序练习 · ${state.cursor >= questions.length ? '题库已刷完，开始新一轮' : `从原题 ${questions[state.cursor].id} 开始`}`}</p><button class="primary" data-action="${state.session ? 'resume' : 'start'}" data-mode="sequential">${state.session ? '继续上次练习' : '开始 10 题练习'}<span>→</span></button></section>
    <div class="mode-grid"><button class="mode-card" data-action="start" data-mode="random"><span class="mode-icon">⇄</span><strong>随机练习</strong><small>换个顺序，检验记忆</small><span class="arrow">↗</span></button><button class="mode-card" data-action="start" data-mode="wrong"><span class="mode-icon orange">↻</span><strong>错题重刷 <em>${wrongCount()}</em></strong><small>答对后移出错题本</small><span class="arrow">↗</span></button></div>
    <footer><span>${questions.length} 道原题 · 单选 / 多选 / 判断</span><span>题库版本：2025 年 7 月</span><button data-action="install">安装与离线使用说明 ↗</button></footer>`;
}
function quiz() {
  view = 'quiz';
  const s = state.session;
  if (!s) return home();
  const q = questions.find(q => q.id === s.ids[s.index]);
  const answer = s.answers[q.id];
  selected = [...(answer ? answer.selected : s.draft)];
  const options = q.options.map(o => {
    const checked = selected.includes(o.key);
    const correct = answer && q.answer.includes(o.key);
    const wrong = answer && checked && !correct;
    return `<button class="option ${checked ? 'selected' : ''} ${correct ? 'correct' : ''} ${wrong ? 'incorrect' : ''}" data-action="option" data-key="${esc(o.key)}" aria-pressed="${checked}" ${answer ? 'disabled' : ''}><span class="option-key">${esc(o.key)}</span><span>${esc(o.text)}</span><span class="option-mark">${correct ? '✓' : wrong ? '×' : checked ? '✓' : ''}</span></button>`;
  }).join('');
  app.innerHTML = `${header(true)}<div class="quiz-heading"><span>${names[s.mode]}</span><strong>${s.index + 1}<small> / ${s.ids.length}</small></strong></div><div class="track"><i style="width:${(s.index + (answer ? 1 : 0)) / s.ids.length * 100}%"></i></div><section class="question"><div class="question-meta"><span class="tag">${types[q.type]}</span><span>原题 ${q.id} · PDF 第 ${q.pages.join('、')} 页</span></div><h1>${esc(q.text)}</h1><p class="hint">${q.type === 'multiple' ? '选择所有正确选项，再提交答案' : '点击选项，立即查看答案'}</p><div class="options">${options}</div></section>${answer ? `<section class="feedback ${answer.correct ? 'good' : 'bad'}" role="status"><strong>${answer.correct ? '✓ 答对了，继续保持' : '再记一次，下次就会了'}</strong><p>题库答案：<b>${esc(q.answer.join('、'))}</b>${answer.correct ? '' : `　你的选择：${esc(answer.selected.join('、'))}`}</p>${q.note ? `<p class="source-note">${esc(q.note)}</p>` : ''}<small>${answer.correct ? '已记录这次练习' : '已加入错题本，答对后自动移出'}</small></section>` : ''}<div class="quiz-actions">${answer ? `<button class="primary" data-action="next">${s.index + 1 === s.ids.length ? '查看本组结果' : '下一题'}<span>→</span></button>` : q.type === 'multiple' ? `<button class="primary" data-action="submit" ${selected.length ? '' : 'disabled'}>提交答案<span>→</span></button>` : '<p class="muted centered">一步一步，把题库变熟悉。</p>'}</div>`;
}
function result(summary) {
  view = 'result';
  app.innerHTML = `${header(true)}<section class="result"><span class="result-icon">✓</span><span class="eyebrow">${names[summary.mode]} · 本组完成</span><h1>又向前走了一小步<span class="accent">。</span></h1><div class="score">${summary.correct}<small> / ${summary.total}</small></div><p>答对 ${summary.correct} 题${summary.total === summary.correct ? '，这一组全部拿下。' : `，${summary.total - summary.correct} 道错题已收进错题本。`}</p><button class="primary" data-action="start" data-mode="${summary.mode}">再练一组<span>→</span></button><button class="secondary" data-action="home">今天先到这里</button></section>`;
}

app.addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const { action, mode, key } = button.dataset;
  if (action === 'home') { selected = []; window.scrollTo(0, 0); return home(); }
  if (action === 'install') return dialog.showModal();
  if (action === 'resume') { selected = []; window.scrollTo(0, 0); return quiz(); }
  if (action === 'start') {
    if (state.session) { flash('已为你保留上次练习，请先完成这一组。'); selected = []; return quiz(); }
    if (!startRound(state, questions, mode)) return flash('现在没有错题，去练一组新题吧。');
    selected = []; save(); window.scrollTo(0, 0); return quiz();
  }
  if (action === 'option') {
    const q = questions.find(q => q.id === state.session.ids[state.session.index]);
    if (state.session.answers[q.id]) return;
    if (q.type === 'multiple') {
      selected = selected.includes(key) ? selected.filter(k => k !== key) : [...selected, key];
      state.session.draft = [...selected]; save(); quiz();
      app.querySelector(`button[data-key="${key}"]`)?.focus({ preventScroll: true });
      return;
    }
    selected = [key]; recordAnswer(state, questions, selected); save(); return quiz();
  }
  if (action === 'submit') { recordAnswer(state, questions, selected); save(); return quiz(); }
  if (action === 'next') { const summary = advanceRound(state); selected = []; save(); window.scrollTo(0, 0); return summary ? result(summary) : quiz(); }
});
dialog.addEventListener('click', event => { if (event.target.closest('.close, .close-dialog') || event.target === dialog) dialog.close(); });

async function prepareOffline() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('./sw.js');
    const registration = await navigator.serviceWorker.ready;
    const channel = new MessageChannel();
    channel.port1.onmessage = event => {
      if (event.data?.ready) {
        offlineReady = true;
        if (view === 'home') home();
        else { const status = app.querySelector('.status'); if (status) { status.textContent = '● 离线可用'; status.classList.add('ready'); } }
      }
    };
    (navigator.serviceWorker.controller || registration.active)?.postMessage({ type: 'CACHE_STATUS' }, [channel.port2]);
  } catch { flash('离线缓存暂未准备好，请保持联网后重新打开。'); }
}
try {
  const response = await fetch('./questions.json');
  if (!response.ok) throw new Error('题库加载失败');
  const data = await response.json();
  questions = data.questions;
  if (!questions?.length) throw new Error('题库为空');
  let stored = null;
  try { stored = localStorage.getItem(STORAGE_KEY); } catch { flash('浏览器不允许保存进度，当前练习仍可进行。'); }
  state = restoreState(stored, questions);
  home(); prepareOffline();
} catch {
  app.innerHTML = '<div class="loading"><span class="brand-icon">C3</span><h2>题库还没准备好</h2><p>请联网后重试；首次使用需要下载完整题库。</p><button class="primary" id="retry">重新加载</button></div>';
  document.querySelector('#retry').addEventListener('click', () => location.reload());
}
