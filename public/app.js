import { STORAGE_KEY, restoreState, startRound, recordAnswer, advanceRound, toggleFavorite, roundSummary } from './engine.js?v=7';

const app = document.querySelector('#app');
const notice = document.querySelector('#notice');
const dialog = document.querySelector('#install-dialog');
const backdrop = document.querySelector('#install-backdrop');
let installTrigger;

function openInstall() {
  installTrigger = document.activeElement;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else {
    // Safari before 15.4 has no native dialog support.
    dialog.classList.add('fallback-dialog');
    dialog.setAttribute('open', '');
    backdrop.hidden = false;
    app.setAttribute('aria-hidden', 'true');
    dialog.querySelector('.close').focus();
  }
}
function closeInstall() {
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
  dialog.classList.remove('fallback-dialog');
  backdrop.hidden = true;
  app.removeAttribute('aria-hidden');
  installTrigger?.focus();
}
const names = { sequential: '顺序练习', random: '随机练习', wrong: '错题重刷', single: '单选专项', multiple: '多选专项', boolean: '判断专项', favorites: '收藏练习', retry: '本组错题重练' };
const types = { single: '单选题', multiple: '多选题', boolean: '判断题' };
let questions, state, selected = [], view = 'home', offlineReady = false;
function updateViewport() { document.documentElement.style.setProperty('--viewport-height', `${window.innerHeight}px`); }
updateViewport();
window.addEventListener('resize', updateViewport);
const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

function flash(message) { notice.textContent = message; notice.classList.add('show'); clearTimeout(flash.timer); flash.timer = setTimeout(() => notice.classList.remove('show'), 5000); }
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch { flash('进度未能保存，请检查浏览器是否允许存储，暂时不要关闭页面。'); }
}
function wrongCount() { return Object.values(state.records).filter(r => !r.correct).length; }
function header(back = false) {
  return `<header>${back ? `<button class="back" data-action="${back === 'resume' ? 'resume' : 'home'}" aria-label="${back === 'resume' ? '返回当前练习' : '返回首页'}">←</button>` : '<span class="brand-icon">C3</span>'}<div class="brand"><strong>通勤刷题</strong><small>安全员 C3 · 专属题库</small></div><button class="status ${offlineReady ? 'ready' : ''}" data-action="install">${offlineReady ? '● 离线可用' : '添加到主屏幕 ↗'}</button></header>`;
}
function favoriteButton(id) {
  const favorite = state.favorites.includes(id);
  return `<button class="favorite ${favorite ? 'is-favorite' : ''}" data-action="favorite" data-id="${id}" aria-pressed="${favorite}" aria-label="${favorite ? '取消收藏' : '收藏题目'}">${favorite ? '★ 已收藏' : '☆ 收藏'}</button>`;
}
function pending(mode) { return state.session?.mode === mode ? state.session : state.paused[mode]; }
function practiceDetail(mode, fallback) {
  const round = pending(mode);
  return round ? `${state.session === round ? '正在练' : '继续'} · 第 ${round.index + 1} / ${round.ids.length} 题` : fallback;
}
function more() {
  const back = view === 'quiz' ? 'resume' : true;
  view = 'more'; app.className = 'more-view';
  const details = { sequential: state.cursor >= questions.length ? '题库已刷完，可开始新一轮' : `从原题 ${questions[state.cursor].id} 开始`, random: '全部原题 · 随机出题', wrong: `${wrongCount()} 道错题 · 答对后移出`, favorites: `${state.favorites.length} 道收藏 · 答对后仍保留`, retry: '继续上次未完成的错题重练' };
  const modes = ['sequential', 'random', 'wrong', 'single', 'multiple', 'boolean', 'favorites'];
  if (pending('retry')) modes.push('retry');
  app.innerHTML = `${header(back)}<section class="page-intro"><h1>切换练习</h1><p>每种模式单独保存，切回来接着答。</p></section><div class="practice-list">${modes.map(mode => `<button class="practice-row ${state.session?.mode === mode ? 'current-practice' : ''}" data-action="start" data-mode="${mode}" ${state.session?.mode === mode ? 'aria-current="true"' : ''}><span><strong>${names[mode]}</strong><small>${practiceDetail(mode, details[mode] || `${questions.filter(q => q.type === mode).length} 道原题 · 随机出题`)}</small></span><span class="arrow-symbol">${pending(mode) ? '继续' : '→'}</span></button>`).join('')}${state.lastRound ? '<button class="practice-row" data-action="review"><span><strong>上一组错题回顾</strong><small>查看你的选择和题库原答案</small></span><span class="arrow-symbol">→</span></button>' : ''}</div><p class="hint">已答题目和多选草稿都会保留，未完成的一组不会重新抽题。</p>`;
  window.scrollTo(0, 0);
}
function review() {
  if (!state.lastRound) return more();
  view = 'review'; app.className = 'review-view';
  const round = state.lastRound;
  const wrong = round.ids.filter(id => !round.answers[id].correct);
  const optionText = (q, keys) => keys.map(key => `${key}. ${q.options.find(o => o.key === key).text}`).join('；');
  app.innerHTML = `${header(true)}<section class="page-intro"><h1>本组错题回顾</h1><p>${names[round.mode]} · ${wrong.length ? `${wrong.length} 道错题，再看一次加深记忆。` : '这一组全对，没有错题。'}</p></section><div class="review-content">${wrong.map(id => {
    const q = questions.find(q => q.id === id);
    return `<article class="review-card"><div class="review-meta"><span class="tag">${types[q.type]} · 原题 ${q.id}</span>${favoriteButton(q.id)}</div><h2>${esc(q.text)}</h2><p class="review-selected">你的选择：${esc(optionText(q, round.answers[id].selected))}</p><p class="review-answer">题库答案：${esc(optionText(q, q.answer))}</p>${q.note ? `<p class="muted">${esc(q.note)}</p>` : ''}<small class="muted">PDF 第 ${q.pages.join('、')} 页</small></article>`;
  }).join('') || '<p class="empty-state">这一组全部拿下，继续保持！</p>'}</div><div class="review-actions">${wrong.length || pending('retry') ? `<button class="primary" data-action="start" data-mode="retry">${pending('retry') ? '继续上次错题重练' : '重练本组错题'}<span>→</span></button>` : ''}<button class="secondary" data-action="last-result">返回本组结果</button></div>`;
  window.scrollTo(0, 0);
}
function home() {
  view = 'home';
  app.className = 'home-view';
  const resume = state.session || state.paused.sequential || Object.values(state.paused)[0];
  const learned = Object.keys(state.records).length;
  const mastered = Object.values(state.records).filter(r => r.correct).length;
  const progress = Math.round(learned / questions.length * 100);
  app.innerHTML = `${header()}<section class="intro"><h1>今天，再练十题<span class="accent">。</span></h1><p>利用一点通勤时间，慢慢把题库变熟悉。</p></section>
    <section class="progress-card"><div class="row"><strong>你的题库足迹</strong><span>${progress}%</span></div><div class="track" role="progressbar" aria-label="题库已练进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><i style="width:${progress}%"></i></div><div class="stats"><div><b>${learned}<small> / ${questions.length}</small></b><span>已练题目</span></div><div><b>${mastered}</b><span>最近答对</span></div><div><b class="orange">${wrongCount()}</b><span>待复习错题</span></div></div></section>
    <section class="start-card"><div class="row"><h2>${resume ? '继续上次练习' : '顺序练习'}</h2><span class="muted">10 题 · 约 5 分钟</span></div><p>${resume ? `${names[resume.mode]} · 第 ${resume.index + 1} / ${resume.ids.length} 题` : `${state.cursor >= questions.length ? '题库已刷完，开始新一轮' : `从原题 ${questions[state.cursor].id} 开始`}`}</p><button class="primary" data-action="start" data-mode="${resume?.mode || 'sequential'}">${resume ? '继续上次练习' : '开始 10 题练习'}<span>→</span></button></section>
    <div class="mode-grid"><button class="mode-card" data-action="start" data-mode="random"><span class="mode-icon">⇄</span><strong>随机练习</strong><small>${practiceDetail('random', '换个顺序，检验记忆')}</small><span class="arrow">↗</span></button><button class="mode-card" data-action="start" data-mode="wrong"><span class="mode-icon orange">↻</span><strong>错题重刷 <em>${wrongCount()}</em></strong><small>${practiceDetail('wrong', '答对后移出错题本')}</small><span class="arrow">↗</span></button></div>
    <footer><span>${questions.length} 道原题 · 2025 年 7 月题库</span><div class="footer-actions"><button class="more-link" data-action="more">更多练习 ↗</button><button data-action="install">安装与离线使用说明 ↗</button></div></footer>`;
}
function quiz({ picked = null, reveal = false } = {}) {
  const previousQuestion = app.querySelector('.quiz-content')?.dataset.question;
  const previousProgress = app.querySelector('.quiz-view > .track i')?.style.width || '0%';
  view = 'quiz';
  app.className = 'quiz-view';
  const s = state.session;
  if (!s) return home();
  const q = questions.find(q => q.id === s.ids[s.index]);
  const previousContent = app.querySelector('.quiz-content');
  const scrollTop = previousContent?.dataset.question === String(q.id) ? previousContent.scrollTop : 0;
  const answer = s.answers[q.id];
  selected = [...(answer ? answer.selected : s.draft)];
  const options = q.options.map(o => {
    const checked = selected.includes(o.key);
    const correct = answer && q.answer.includes(o.key);
    const wrong = answer && checked && !correct;
    return `<button class="option ${checked ? 'selected' : ''} ${correct ? 'correct' : ''} ${wrong ? 'incorrect' : ''}" data-action="option" data-key="${esc(o.key)}" aria-pressed="${checked}" ${answer ? 'disabled' : ''}><span class="option-key">${esc(o.key)}</span><span>${esc(o.text)}</span><span class="option-mark">${correct ? '✓' : wrong ? '×' : checked ? '✓' : ''}</span></button>`;
  }).join('');
  app.innerHTML = `${header(true)}<div class="quiz-heading"><button class="switch-practice" data-action="more" aria-label="切换练习">${names[s.mode]}<span>⇄ 切换</span></button><strong>${s.index + 1}<small> / ${s.ids.length}</small></strong></div><div class="track"><i style="width:${(s.index + (answer ? 1 : 0)) / s.ids.length * 100}%"></i></div><div class="quiz-content" data-question="${q.id}"><section class="question"><div class="question-meta"><span class="tag">${types[q.type]}</span><span>原题 ${q.id} · PDF 第 ${q.pages.join('、')} 页</span>${favoriteButton(q.id)}</div><h1>${esc(q.text)}</h1><p class="hint">${q.type === 'multiple' ? '选择所有正确选项，再提交答案' : '点击选项，立即查看答案'}</p><div class="options">${options}</div></section></div>${answer ? `<section class="feedback ${answer.correct ? 'good' : 'bad'}" role="status"><strong>${answer.correct ? '✓ 答对了，继续保持' : '再记一次，下次就会了'}</strong><p>题库答案：<b>${esc(q.answer.join('、'))}</b>${answer.correct ? '' : `　你的选择：${esc(answer.selected.join('、'))}`}</p>${q.note ? `<p class="source-note">${esc(q.note)}</p>` : ''}<small>${answer.correct ? '已记录这次练习' : '已加入错题本，答对后自动移出'}</small></section>` : ''}<div class="quiz-actions">${answer ? `<button class="primary" data-action="next">${s.index + 1 === s.ids.length ? '查看本组结果' : '下一题'}<span>→</span></button>` : q.type === 'multiple' ? `<button class="primary" data-action="submit" ${selected.length ? '' : 'disabled'}>提交答案<span>→</span></button>` : '<p class="muted centered">点击选项即可作答</p>'}</div>`;
  app.querySelector('.quiz-content').scrollTop = scrollTop;
  if (previousQuestion !== String(q.id)) app.querySelector('.question').classList.add('question-enter');
  if (picked) app.querySelector(`button[data-key="${picked}"]`).classList.add('option-tap');
  if (reveal) {
    app.querySelector('.feedback').classList.add('feedback-enter');
    if (!answer.correct) app.querySelector('.feedback strong').classList.add('answer-shake');
    else app.querySelectorAll('.option.correct .option-mark').forEach(mark => mark.classList.add('check-pop'));
  }
  const bar = app.querySelector('.quiz-view > .track i');
  if (bar.style.width !== previousProgress) {
    bar.style.setProperty('--previous-progress', previousProgress);
    bar.classList.add('progress-fill');
  }
}
function result(summary, celebrate = true) {
  view = 'result';
  app.className = 'result-view';
  app.innerHTML = `${header(true)}<section class="result"><span class="result-icon">✓</span><span class="eyebrow">${names[summary.mode]} · 本组完成</span><h1>又向前走了一小步<span class="accent">。</span></h1><div class="score">${summary.correct}<small> / ${summary.total}</small></div><p>答对 ${summary.correct} 题${summary.total === summary.correct ? '，这一组全部拿下。' : `，${summary.total - summary.correct} 道错题已收进错题本。`}</p><button class="primary" data-action="start" data-mode="${summary.mode}">再练一组<span>→</span></button><button class="secondary" data-action="home">今天先到这里</button></section>`;
  const again = app.querySelector('.result .primary');
  if (summary.mode === 'retry') { again.dataset.mode = 'wrong'; again.innerHTML = '继续练错题<span>→</span>'; }
  const reviewButton = document.createElement('button');
  reviewButton.className = 'secondary'; reviewButton.dataset.action = 'review';
  reviewButton.textContent = `查看本组错题（${summary.total - summary.correct}）`;
  again.after(reviewButton);
  if (celebrate && summary.correct === summary.total && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const celebration = document.createElement('div');
    celebration.className = 'celebration';
    celebration.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 12; i++) {
      const piece = document.createElement('i');
      const angle = Math.PI * 2 * i / 12;
      piece.style.setProperty('--x', `${Math.cos(angle) * 105}px`);
      piece.style.setProperty('--y', `${Math.sin(angle) * 80}px`);
      piece.style.setProperty('--turn', `${i * 70}deg`);
      celebration.appendChild(piece);
    }
    celebration.addEventListener('animationend', () => celebration.remove(), { once: true });
    app.querySelector('.result-icon').appendChild(celebration);
  }
}

app.addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const { action, mode, key } = button.dataset;
  if (action === 'home') { selected = []; window.scrollTo(0, 0); return home(); }
  if (action === 'more') return more();
  if (action === 'resume') return quiz();
  if (action === 'review') return review();
  if (action === 'last-result') return result(roundSummary(state.lastRound), false);
  if (action === 'favorite') {
    const favorite = toggleFavorite(state, questions, Number(button.dataset.id));
    button.classList.toggle('is-favorite', favorite); button.setAttribute('aria-pressed', String(favorite));
    button.setAttribute('aria-label', favorite ? '取消收藏' : '收藏题目');
    button.textContent = favorite ? '★ 已收藏' : '☆ 收藏';
    save(); return;
  }
  if (action === 'install') return openInstall();
  if (action === 'start') {
    if (!startRound(state, questions, mode)) return flash(mode === 'favorites' ? '还没有收藏，在答题时点击 ☆ 收藏试试。' : mode === 'retry' ? '这一组没有错题，去练一组新题吧。' : '现在没有错题，去练一组新题吧。');
    selected = []; save(); window.scrollTo(0, 0); return quiz();
  }
  if (action === 'option') {
    const q = questions.find(q => q.id === state.session.ids[state.session.index]);
    if (state.session.answers[q.id]) return;
    if (q.type === 'multiple') {
      selected = selected.includes(key) ? selected.filter(k => k !== key) : [...selected, key];
      state.session.draft = [...selected]; save(); quiz({ picked: key });
      app.querySelector(`button[data-key="${key}"]`)?.focus({ preventScroll: true });
      return;
    }
    selected = [key]; recordAnswer(state, questions, selected); save(); return quiz({ picked: key, reveal: true });
  }
  if (action === 'submit') { recordAnswer(state, questions, selected); save(); return quiz({ reveal: true }); }
  if (action === 'next') { const summary = advanceRound(state); selected = []; save(); window.scrollTo(0, 0); return summary ? result(summary) : quiz(); }
});
dialog.addEventListener('click', event => { if (event.target.closest('.close, .close-dialog') || event.target === dialog) closeInstall(); });
backdrop.addEventListener('click', closeInstall);
dialog.addEventListener('keydown', event => {
  if (!dialog.classList.contains('fallback-dialog')) return;
  if (event.key === 'Escape') { event.preventDefault(); closeInstall(); }
  if (event.key === 'Tab') {
    const buttons = [...dialog.querySelectorAll('button')];
    const first = buttons[0], last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});

async function prepareOffline() {
  if (!('serviceWorker' in navigator)) return;
  try {
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
// Safari 14 supports async functions, but cannot parse top-level await.
async function initialize() {
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
}
initialize();
