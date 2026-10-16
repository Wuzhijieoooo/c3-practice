import { STORAGE_KEY, restoreState, startRound, recordAnswer, advanceRound, toggleFavorite, roundSummary, EXAM_RULES, startExam, examSeconds, setExamAnswer, goExamQuestion, examSummary, finishExam } from './engine.js?v=11';

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
let questions, state, selected = [], view = 'home', offlineReady = false, reviewIndex = null;
const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

function flash(message) { notice.textContent = message; notice.classList.add('show'); clearTimeout(flash.timer); flash.timer = setTimeout(() => notice.classList.remove('show'), 5000); }
function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch { flash('进度未能保存，请检查浏览器是否允许存储，暂时不要关闭页面。'); }
}
function wrongCount() { return Object.values(state.records).filter(r => !r.correct).length; }
function icon(name) {
  const paths = { back: 'M19 12H5m7 7-7-7 7-7', practice: 'M14 3H6v18h12V7l-4-4Zm0 0v5h4M9 12h6m-6 4h4', wrong: 'M7 7h10M7 11h6M7 15h3M5 3h12l3 3v6M5 3v18h7m9-4a4 4 0 1 1-1-3m1-3v3h-3', exam: 'M7 3h10v4H7zM5 5H3v16h9M19 9V5h-2m4 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm-4-2v2l1 1', favorite: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z', settings: 'M4 7h16M4 17h16M8 4v6m8 4v6' };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="${paths[name]}"/></svg>`;
}
function backButton(action = 'home', label = '返回首页') { return `<button class="back" data-action="${action}" aria-label="${label}">${icon('back')}</button>`; }
function header(back = false) {
  return `<header>${back ? backButton(back === 'resume' ? 'resume' : 'home', back === 'resume' ? '返回当前练习' : '返回首页') : '<span class="brand-icon">C3</span>'}<div class="brand"><strong>通勤刷题</strong><small>安全员 C3 · 专属题库</small></div><button class="status ${offlineReady ? 'ready' : ''}" data-action="install">${offlineReady ? '● 离线可用' : '添加到主屏幕 ↗'}</button></header>`;
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
  app.innerHTML = `${header(back)}<section class="page-intro"><h1>切换练习</h1><p>每种模式单独保存，切回来接着答。</p></section><div class="practice-list"><button class="practice-row" data-action="exam-setup"><span><strong>模拟考试</strong><small>${state.exam ? `已答 ${Object.keys(state.exam.answers).length} / ${EXAM_RULES.total} 题 · 继续考试` : `${EXAM_RULES.total} 题 · ${EXAM_RULES.minutes} 分钟 · 交卷后评分`}</small></span><span class="arrow-symbol">→</span></button>${modes.map(mode => `<button class="practice-row ${state.session?.mode === mode ? 'current-practice' : ''}" data-action="start" data-mode="${mode}" ${state.session?.mode === mode ? 'aria-current="true"' : ''}><span><strong>${names[mode]}</strong><small>${practiceDetail(mode, details[mode] || `${questions.filter(q => q.type === mode).length} 道原题 · 随机出题`)}</small></span><span class="arrow-symbol">${pending(mode) ? '继续' : '→'}</span></button>`).join('')}${state.lastRound ? '<button class="practice-row" data-action="review"><span><strong>上一组错题回顾</strong><small>查看你的选择和题库原答案</small></span><span class="arrow-symbol">→</span></button>' : ''}</div><p class="hint">已答题目和多选草稿都会保留，未完成的一组不会重新抽题。</p>`;
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
function settings() {
  view = 'settings'; app.className = 'more-view settings-view';
  const large = document.documentElement.dataset.textSize === 'large';
  app.innerHTML = `${header(true)}<section class="page-intro"><h1>设置</h1><p>调整阅读方式，了解安装与离线使用。</p></section><div class="exam-panel"><section class="settings-card"><h2>答题字号</h2><p>同时应用于练习、考试与错题回顾。</p><div class="font-options"><button data-action="text-size" data-size="normal" aria-pressed="${!large}">标准</button><button data-action="text-size" data-size="large" aria-pressed="${large}">大字</button></div></section><button class="practice-row" data-action="install"><span><strong>安装与离线使用说明</strong><small>添加到主屏幕，通勤时离线刷题</small></span><span class="arrow-symbol">›</span></button><p class="hint">答题进度保存在当前设备。清除网站数据会删除进度。</p></div>`;
}
function home() {
  view = 'home'; reviewIndex = null;
  app.className = 'home-view';
  const resume = state.session || state.paused.sequential || Object.values(state.paused)[0];
  const learned = Object.keys(state.records).length;
  const progress = Math.round(learned / questions.length * 100);
  app.innerHTML = `${header()}<div class="home-content"><section class="intro"><h1>今天，再练十题<span class="accent">。</span></h1><p>利用通勤时间，慢慢把题库变熟悉。</p></section>
    <section class="progress-card"><div class="row"><strong>题库进度</strong><span>${progress}%</span></div><div class="track" role="progressbar" aria-label="题库已练进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><i style="width:${progress}%"></i></div><div class="stats"><div><span>已练题目</span><b>${learned}<small> / ${questions.length}</small></b></div><div><span>待复习</span><b class="orange">${wrongCount()}</b></div></div></section>
    <section class="start-card"><span class="eyebrow">${resume ? names[resume.mode] : '顺序练习'}</span><h2>${resume ? '继续上次练习' : '从十题开始'}</h2><p>${resume ? `已完成 ${Object.keys(resume.answers).length} / ${resume.ids.length} 题` : state.cursor >= questions.length ? '题库已刷完，开始新一轮' : `从原题 ${questions[state.cursor].id} 开始 · 每组 10 题`}</p><button class="primary" data-action="start" data-mode="${resume?.mode || 'sequential'}">${resume ? '继续答题' : '开始 10 题练习'}<span>→</span></button></section>
    <div class="home-entries"><button class="home-entry mode-card" data-action="more" aria-label="专项练习与更多练习"><span class="entry-icon">${icon('practice')}</span><span><strong>专项练习</strong><small>单选、多选、判断 · 更多练习</small></span><span class="entry-arrow">›</span></button><button class="home-entry mode-card" data-action="start" data-mode="wrong"><span class="entry-icon">${icon('wrong')}</span><span><strong>错题复习${wrongCount() ? ` <em>${wrongCount()}</em>` : ''}</strong><small>${practiceDetail('wrong', '先把不熟的题练一遍')}</small></span><span class="entry-arrow">›</span></button><button class="home-entry mode-card" data-action="exam-setup" aria-label="模拟考试"><span class="entry-icon">${icon('exam')}</span><span><strong>模拟考试</strong><small>${state.exam ? `已答 ${Object.keys(state.exam.answers).length} / ${EXAM_RULES.total} 题 · 继续考试` : `${EXAM_RULES.total} 题 · ${EXAM_RULES.minutes} 分钟`}</small></span><span class="entry-arrow">›</span></button></div>
    <div class="home-utilities"><button data-action="start" data-mode="favorites">${icon('favorite')}<span>收藏练习</span><span>›</span></button><button data-action="settings" aria-label="设置">${icon('settings')}<span>设置</span><span>›</span></button></div><footer>${questions.length} 道原题 · 2025 年 7 月题库</footer></div>`;
}
function quiz({ picked = null, reveal = false } = {}) {
  const previousQuestion = app.querySelector('.quiz-content')?.dataset.question;
  const previousProgress = app.querySelector('.quiz-view > .track i')?.style.width || '0%';
  view = 'quiz';
  app.className = 'quiz-view';
  const s = state.session;
  if (!s) return home();
  const index = reviewIndex ?? s.index;
  const q = questions.find(q => q.id === s.ids[index]);
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
  const choice = keys => keys.map(key => `${key}. ${q.options.find(o => o.key === key).text}`).join('；');
  const missing = answer ? q.answer.filter(key => !answer.selected.includes(key)) : [];
  const extra = answer ? answer.selected.filter(key => !q.answer.includes(key)) : [];
  app.innerHTML = `<header class="quiz-toolbar">${backButton()}<div class="quiz-heading"><span>${names[s.mode]}</span><strong>${index + 1}<small> / ${s.ids.length}</small></strong></div><button class="switch-practice" data-action="more" aria-label="切换练习">⇄ 切换</button></header><div class="track"><i style="width:${Object.keys(s.answers).length / s.ids.length * 100}%"></i></div><div class="quiz-content" data-question="${q.id}"><section class="question"><div class="question-meta"><span class="tag">${types[q.type]}</span><span>原题 ${q.id}</span>${favoriteButton(q.id)}</div><h1>${esc(q.text)}</h1><p class="hint">${reviewIndex !== null ? '回看已答题目 · 原选择与得分保持不变' : q.type === 'multiple' ? '选择所有正确选项，再提交答案' : '点击选项，立即查看答案'}</p><div class="options">${options}</div><details class="question-source"><summary>题目来源</summary><p>原题 ${q.id} · PDF 第 ${q.pages.join('、')} 页</p></details></section></div>${answer ? `<section class="feedback ${answer.correct ? 'good' : 'bad'}" role="status" tabindex="0" aria-label="答题反馈"><strong>${answer.correct ? '✓ 答对了，继续保持' : '再记一次，下次就会了'}</strong><p>题库答案：<b>${esc(choice(q.answer))}</b></p>${answer.correct ? '' : `<p>你的选择：${esc(choice(answer.selected))}</p>`}${q.type === 'multiple' && !answer.correct ? `<p class="answer-diff">${extra.length ? `错选：${esc(extra.join('、'))}` : ''}${extra.length && missing.length ? '　' : ''}${missing.length ? `漏选：${esc(missing.join('、'))}` : ''}</p>` : ''}${q.note ? `<p class="source-note">${esc(q.note)}</p>` : ''}</section>` : ''}<div class="quiz-actions practice-navigation"><button class="secondary" data-action="previous" ${index > 0 ? '' : 'disabled'}>上一题</button>${answer ? `<button class="primary" data-action="next">${reviewIndex === null && s.index + 1 === s.ids.length ? '查看本组结果' : '下一题'}<span>→</span></button>` : q.type === 'multiple' ? `<button class="primary" data-action="submit" ${selected.length ? '' : 'disabled'}>提交答案<span>→</span></button>` : '<button class="primary" data-action="next" disabled>下一题<span>→</span></button>'}</div>`;
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

function examClock() { return '<span class="exam-clock" aria-label="考试剩余时间"></span>'; }
function examSetup() {
  view = 'exam-setup'; app.className = 'more-view';
  app.innerHTML = `${header(true)}<section class="page-intro"><h1>模拟考试</h1><p>应用自测规则 · 整卷作答，交卷后统一评分。</p></section><section class="exam-panel"><div class="exam-rules"><strong>${EXAM_RULES.total} 题 · ${EXAM_RULES.minutes} 分钟</strong><p>单选 ${EXAM_RULES.counts.single} 题 · 多选 ${EXAM_RULES.counts.multiple} 题 · 判断 ${EXAM_RULES.counts.boolean} 题</p><p>每题 1 分，满分 ${EXAM_RULES.total} 分，${EXAM_RULES.passScore} 分达标。</p><p>多选须全部选对才得分，未答题计 0 分。</p><p>考试中可改答案、用答题卡跳题；交卷后，错题和未答题加入错题本。</p><p>切换练习或关闭页面，倒计时继续。时间到自动交卷，重新打开时结算。</p></div>${state.exam ? `<p class="exam-resume">已答 ${Object.keys(state.exam.answers).length} / ${EXAM_RULES.total} 题 · 剩余 ${examClock()}</p>` : ''}<button class="primary" data-action="exam-start">${state.exam ? '继续考试' : '开始模拟考试'}<span>→</span></button>${state.lastExam ? '<button class="secondary" data-action="exam-result">查看上次考试结果</button>' : ''}</section>`;
  updateExamClock(); window.scrollTo(0, 0);
}
function updateExamClock() {
  if (!state.exam) return;
  const seconds = examSeconds(state.exam);
  const text = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  app.querySelectorAll('.exam-clock').forEach(el => { el.textContent = text; el.classList.toggle('time-low', seconds <= 300); });
}
function checkExamTime(now = Date.now()) {
  if (!state?.exam) return false;
  if (examSeconds(state.exam, now) > 0) { updateExamClock(); return false; }
  finishExam(state, questions, now); save();
  if (view.startsWith('exam')) examResult();
  else { if (view === 'home') home(); flash('模拟考试时间到，已自动交卷。可在「模拟考试」查看成绩。'); }
  return true;
}
function examPage() {
  if (!state.exam) return examSetup();
  const exam = state.exam;
  const q = questions.find(q => q.id === exam.ids[exam.index]);
  const previous = app.querySelector('.quiz-content');
  const scrollTop = previous?.dataset.question === `exam-${q.id}` ? previous.scrollTop : 0;
  const chosen = exam.answers[q.id] || [];
  view = 'exam'; app.className = 'quiz-view exam-view';
  app.innerHTML = `${header(true)}<div class="quiz-heading"><span>模拟考试 · ${examClock()}</span><strong>${exam.index + 1}<small> / ${EXAM_RULES.total}</small></strong></div><div class="exam-toolbar"><span>已答 ${Object.keys(exam.answers).length} 题</span><button data-action="exam-card">答题卡</button><button data-action="exam-confirm">交卷</button></div><div class="quiz-content" data-question="exam-${q.id}"><section class="question"><div class="question-meta"><span class="tag">${types[q.type]}</span><span>原题 ${q.id}</span>${favoriteButton(q.id)}</div><h1>${esc(q.text)}</h1><p class="hint">${q.type === 'multiple' ? '选择所有正确选项' : '选择一个选项'} · 可修改，交卷后查看答案</p><div class="options">${q.options.map(o => `<button class="option ${chosen.includes(o.key) ? 'selected' : ''}" data-action="exam-option" data-key="${esc(o.key)}" aria-pressed="${chosen.includes(o.key)}"><span class="option-key">${esc(o.key)}</span><span>${esc(o.text)}</span><span class="option-mark">${chosen.includes(o.key) ? '✓' : ''}</span></button>`).join('')}</div></section></div><div class="quiz-actions exam-navigation"><button class="secondary" data-action="exam-prev" ${exam.index === 0 ? 'disabled' : ''}>上一题</button><button class="primary" data-action="${exam.index === exam.ids.length - 1 ? 'exam-confirm' : 'exam-next'}">${exam.index === exam.ids.length - 1 ? '检查并交卷' : '下一题'}<span>→</span></button></div>`;
  app.querySelector('.quiz-content').scrollTop = scrollTop;
  updateExamClock();
}
function examCard() {
  const exam = state.exam;
  if (!exam) return examSetup();
  view = 'exam-card'; app.className = 'more-view exam-card-view';
  app.innerHTML = `${header(true)}<section class="page-intro"><h1>答题卡</h1><p>已答 ${Object.keys(exam.answers).length} / ${EXAM_RULES.total} 题 · ${examClock()}</p><p>绿色已答，白色未答；点击题号跳转。</p></section><div class="exam-card-grid">${exam.ids.map((id, index) => `<button data-action="exam-jump" data-index="${index}" class="${exam.answers[id] ? 'is-answered' : ''} ${index === exam.index ? 'is-current' : ''}" aria-label="第 ${index + 1} 题，${exam.answers[id] ? '已答' : '未答'}">${index + 1}</button>`).join('')}</div><div class="exam-card-actions"><button class="primary" data-action="exam-confirm">检查并交卷</button><button class="secondary" data-action="exam-resume">返回当前题</button></div>`;
  updateExamClock();
}
function examConfirm() {
  if (!state.exam) return examSetup();
  const answered = Object.keys(state.exam.answers).length;
  view = 'exam-confirm'; app.className = 'more-view';
  app.innerHTML = `${header(true)}<section class="page-intro"><h1>准备交卷</h1><p>剩余 ${examClock()}</p></section><section class="exam-panel"><div class="exam-rules"><strong>已答 ${answered} / ${EXAM_RULES.total} 题</strong><p>${answered === EXAM_RULES.total ? '已完成全部题目，交卷后查看成绩与错题。' : `还有 ${EXAM_RULES.total - answered} 题未答，交卷后计 0 分。`}</p><p>交卷后不能修改本次答案。</p></div><button class="primary" data-action="exam-submit">确认交卷</button><button class="secondary" data-action="exam-card">返回答题卡检查</button><button class="secondary" data-action="exam-resume">继续答题</button></section>`;
  updateExamClock();
}
function examResult() {
  if (!state.lastExam) return examSetup();
  view = 'exam-result'; app.className = 'result-view exam-result-view';
  const exam = state.lastExam;
  const summary = examSummary(exam, questions);
  app.innerHTML = `${header(true)}<section class="result"><span class="result-icon">${summary.passed ? '✓' : '↻'}</span><span class="eyebrow">模拟考试 · ${exam.submittedAt >= exam.deadline ? '超时自动交卷' : '已交卷'}</span><h1>${summary.passed ? '达到自测目标' : '再练一练，继续进步'}</h1><div class="score">${summary.score}<small> / ${EXAM_RULES.total}</small></div><p>答对 ${summary.correct} 题 · 答错 ${summary.answered - summary.correct} 题 · 未答 ${summary.unanswered} 题<br>${EXAM_RULES.passScore} 分达标 · 错题和未答题已收进错题本</p><button class="primary" data-action="exam-review">查看考试错题（${summary.wrongIds.length}）<span>→</span></button><button class="secondary" data-action="exam-setup">${state.exam ? '继续正在进行的考试' : '再考一场'}</button><button class="secondary" data-action="home">返回首页</button></section>`;
  window.scrollTo(0, 0);
}
function examReview() {
  if (!state.lastExam) return examSetup();
  const exam = state.lastExam;
  const summary = examSummary(exam, questions);
  const choice = (q, keys) => keys?.length ? keys.map(key => `${key}. ${q.options.find(o => o.key === key).text}`).join('；') : '未作答';
  view = 'exam-review'; app.className = 'review-view';
  app.innerHTML = `${header(true)}<section class="page-intro"><h1>考试错题回顾</h1><p>答错与未答共 ${summary.wrongIds.length} 题 · 题库原答案</p></section><div class="review-content">${summary.wrongIds.map(id => {
    const q = questions.find(q => q.id === id);
    return `<article class="review-card"><div class="review-meta"><span class="tag">第 ${exam.ids.indexOf(id) + 1} 题 · ${types[q.type]}</span>${favoriteButton(id)}</div><h2>${esc(q.text)}</h2><p class="review-selected">你的选择：${esc(choice(q, exam.answers[id]))}</p><p class="review-answer">题库答案：${esc(choice(q, q.answer))}</p>${q.note ? `<p class="muted">${esc(q.note)}</p>` : ''}<small class="muted">原题 ${id} · PDF 第 ${q.pages.join('、')} 页</small></article>`;
  }).join('') || '<p class="empty-state">全部答对，没有错题！</p>'}</div><div class="review-actions"><button class="primary" data-action="start" data-mode="wrong">进入错题练习<span>→</span></button><button class="secondary" data-action="exam-result">返回考试结果</button></div>`;
}

app.addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const { action, mode, key } = button.dataset;
  const now = Date.now();
  if (action.startsWith('exam-') && checkExamTime(now)) return;
  if (action === 'exam-setup') return examSetup();
  if (action === 'exam-start') { startExam(state, questions); save(); return examPage(); }
  if (action === 'exam-resume') return examPage();
  if (action === 'exam-card') return examCard();
  if (action === 'exam-confirm') return examConfirm();
  if (action === 'exam-result') return examResult();
  if (action === 'exam-review') return examReview();
  if (action === 'exam-submit') { if (finishExam(state, questions)) save(); return examResult(); }
  if (action === 'exam-jump' || action === 'exam-prev' || action === 'exam-next') {
    const index = action === 'exam-jump' ? Number(button.dataset.index) : state.exam.index + (action === 'exam-prev' ? -1 : 1);
    goExamQuestion(state, index); save(); return examPage();
  }
  if (action === 'exam-option') {
    const exam = state.exam;
    const q = questions.find(q => q.id === exam.ids[exam.index]);
    const chosen = exam.answers[q.id] || [];
    const next = q.type === 'multiple' ? chosen.includes(key) ? chosen.filter(k => k !== key) : [...chosen, key] : chosen.includes(key) ? [] : [key];
    setExamAnswer(state, questions, next, now); save(); return examPage();
  }
  if (action === 'home') { reviewIndex = null; selected = []; window.scrollTo(0, 0); return home(); }
  if (action === 'more') return more();
  if (action === 'resume') { reviewIndex = null; return quiz(); }
  if (action === 'settings') return settings();
  if (action === 'text-size') {
    const size = button.dataset.size === 'large' ? 'large' : 'normal';
    document.documentElement.dataset.textSize = size;
    try { localStorage.setItem('c3-text-size', size); } catch { flash('字号暂时无法保存，本次仍然生效。'); }
    return settings();
  }
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
    reviewIndex = null; selected = []; save(); window.scrollTo(0, 0); return quiz();
  }
  if (reviewIndex !== null && (action === 'option' || action === 'submit')) return;
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
  if (action === 'previous') {
    const index = reviewIndex ?? state.session.index;
    if (index > 0) { reviewIndex = index - 1; return quiz(); }
    return;
  }
  if (action === 'next' && reviewIndex !== null) {
    reviewIndex = reviewIndex + 1 < state.session.index ? reviewIndex + 1 : null;
    return quiz();
  }
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
    try { document.documentElement.dataset.textSize = localStorage.getItem('c3-text-size') === 'large' ? 'large' : 'normal'; } catch {}
    if (state.exam && !examSeconds(state.exam)) { finishExam(state, questions); save(); }
    home(); prepareOffline();
    setInterval(checkExamTime, 1000);
    document.addEventListener('visibilitychange', () => checkExamTime());
  } catch {
    app.innerHTML = '<div class="loading"><span class="brand-icon">C3</span><h2>题库还没准备好</h2><p>请联网后重试；首次使用需要下载完整题库。</p><button class="primary" id="retry">重新加载</button></div>';
    document.querySelector('#retry').addEventListener('click', () => location.reload());
  }
}
initialize();
