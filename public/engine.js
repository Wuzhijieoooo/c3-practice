export const STORAGE_KEY = 'c3-practice-v1';
const MODES = ['sequential', 'random', 'wrong', 'single', 'multiple', 'boolean', 'favorites', 'retry'];
export const EXAM_RULES = { counts: { single: 40, multiple: 20, boolean: 40 }, total: 100, minutes: 60, passScore: 60 };

function shuffle(pool, random) {
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

function validAnswer(question, answer) {
  return question && Array.isArray(answer?.selected) && answer.selected.length > 0 && new Set(answer.selected).size === answer.selected.length && answer.selected.every(key => question.options.some(o => o.key === key)) && (question.type === 'multiple' || answer.selected.length === 1);
}

function restoreRound(round, questions) {
  if (!round || !MODES.includes(round.mode) || !Array.isArray(round.ids) || !round.ids.length || round.ids.length > 10 || new Set(round.ids).size !== round.ids.length || !round.answers || typeof round.answers !== 'object') return null;
  const ids = new Set(questions.map(q => q.id));
  if (!round.ids.every(id => ids.has(id))) return null;
  const answers = {};
  for (const [id, answer] of Object.entries(round.answers)) {
    const q = questions.find(q => q.id === Number(id));
    if (!round.ids.includes(Number(id)) || !validAnswer(q, answer)) return null;
    answers[id] = { selected: [...answer.selected], correct: isCorrect(q, answer.selected) };
  }
  return { mode: round.mode, ids: [...round.ids], answers };
}

export function freshState() {
  return { cursor: 0, records: {}, favorites: [], session: null, paused: {}, lastRound: null, exam: null, lastExam: null };
}

function restoreSession(session, questions) {
  const restored = restoreRound(session, questions);
  if (!restored || !Number.isInteger(session.index) || session.index < 0 || session.index >= session.ids.length) return null;
  if (session.ids.slice(0, session.index).some(id => !restored.answers[id]) || session.ids.slice(session.index + 1).some(id => restored.answers[id])) return null;
  const current = questions.find(q => q.id === session.ids[session.index]);
  const draft = Array.isArray(session.draft) && new Set(session.draft).size === session.draft.length && session.draft.every(key => current.options.some(o => o.key === key)) ? session.draft : [];
  return { ...restored, index: session.index, draft };
}

export function restoreState(raw, questions) {
  try {
    const parsed = JSON.parse(raw);
    const ids = new Set(questions.map(q => q.id));
    const state = freshState();
    if (!parsed || typeof parsed !== 'object') return state;
    state.cursor = Number.isInteger(parsed.cursor) ? Math.max(0, Math.min(questions.length, parsed.cursor)) : 0;
    if (Array.isArray(parsed.favorites)) state.favorites = [...new Set(parsed.favorites.filter(id => ids.has(id)))];
    for (const [id, record] of Object.entries(parsed.records || {})) {
      if (ids.has(Number(id)) && record && typeof record.correct === 'boolean') {
        state.records[id] = { correct: record.correct, attempts: Math.max(1, Number(record.attempts) || 1) };
      }
    }
    const lastRound = restoreRound(parsed.lastRound, questions);
    if (lastRound && lastRound.ids.every(id => lastRound.answers[id])) state.lastRound = lastRound;
    state.session = restoreSession(parsed.session, questions);
    for (const mode of MODES) {
      const paused = restoreSession(parsed.paused?.[mode], questions);
      if (paused?.mode === mode && state.session?.mode !== mode) state.paused[mode] = paused;
    }
    state.exam = restoreExam(parsed.exam, questions);
    state.lastExam = restoreExam(parsed.lastExam, questions, true);
    return state;
  } catch { return freshState(); }
}

export function isCorrect(question, selected) {
  return selected.length === question.answer.length && new Set(selected).size === selected.length && question.answer.every(key => selected.includes(key));
}

export function startRound(state, questions, mode, random = Math.random) {
  if (!MODES.includes(mode)) throw new Error('未知练习模式');
  if (state.session?.mode === mode) return state.session;
  const paused = state.paused[mode];
  if (paused) {
    if (state.session) state.paused[state.session.mode] = state.session;
    state.session = paused;
    delete state.paused[mode];
    return state.session;
  }
  let pool;
  if (mode === 'sequential') {
    if (state.cursor >= questions.length) state.cursor = 0;
    pool = questions.slice(state.cursor, state.cursor + 10);
  } else if (MODES.includes(mode)) {
    const retryIds = state.lastRound?.ids.filter(id => !state.lastRound.answers[id].correct) || [];
    pool = questions.filter(q => mode === 'random' || q.type === mode || (mode === 'wrong' && state.records[q.id]?.correct === false) || (mode === 'favorites' && state.favorites.includes(q.id)) || (mode === 'retry' && retryIds.includes(q.id)));
    shuffle(pool, random);
    pool = pool.slice(0, 10);
  } else { throw new Error('未知练习模式'); }
  if (!pool.length) return null;
  if (state.session) state.paused[state.session.mode] = state.session;
  state.session = { mode, ids: pool.map(q => q.id), index: 0, answers: {}, draft: [] };
  return state.session;
}

export function toggleFavorite(state, questions, id) {
  if (!questions.some(q => q.id === id)) throw new Error('题目不存在');
  const exists = state.favorites.includes(id);
  state.favorites = exists ? state.favorites.filter(value => value !== id) : [...state.favorites, id];
  return !exists;
}

export function roundSummary(round) {
  return { mode: round.mode, total: round.ids.length, correct: round.ids.filter(id => round.answers[id]?.correct).length };
}

export function recordAnswer(state, questions, selected) {
  const s = state.session;
  if (!s) throw new Error('没有正在进行的练习');
  const id = s.ids[s.index];
  const q = questions.find(q => q.id === id);
  if (s.answers[id]) return s.answers[id];
  if (!selected.length || new Set(selected).size !== selected.length || !selected.every(key => q.options.some(o => o.key === key)) || (q.type !== 'multiple' && selected.length !== 1)) throw new Error('请选择有效选项');
  const answer = { selected: [...selected].sort(), correct: isCorrect(q, selected) };
  s.answers[id] = answer;
  state.records[id] = { correct: answer.correct, attempts: (state.records[id]?.attempts || 0) + 1 };
  if (s.mode === 'sequential') state.cursor = questions.findIndex(q => q.id === id) + 1;
  return answer;
}

export function advanceRound(state) {
  const s = state.session;
  if (!s || !s.answers[s.ids[s.index]]) throw new Error('请先作答');
  if (s.index + 1 < s.ids.length) { s.index++; s.draft = []; return null; }
  state.lastRound = { mode: s.mode, ids: [...s.ids], answers: JSON.parse(JSON.stringify(s.answers)) };
  const result = roundSummary(state.lastRound);
  state.session = null;
  return result;
}

function restoreExam(raw, questions, finished = false) {
  if (!raw || !Array.isArray(raw.ids) || raw.ids.length !== EXAM_RULES.total || new Set(raw.ids).size !== raw.ids.length || !Number.isInteger(raw.index) || raw.index < 0 || raw.index >= raw.ids.length || !Number.isSafeInteger(raw.startedAt) || raw.startedAt <= 0 || raw.deadline !== raw.startedAt + EXAM_RULES.minutes * 60000 || !raw.answers || typeof raw.answers !== 'object' || Array.isArray(raw.answers)) return null;
  if (finished && (!Number.isSafeInteger(raw.submittedAt) || raw.submittedAt < raw.startedAt)) return null;
  const counts = {};
  for (const id of raw.ids) {
    const q = questions.find(q => q.id === id);
    if (!q) return null;
    counts[q.type] = (counts[q.type] || 0) + 1;
  }
  if (!Object.entries(EXAM_RULES.counts).every(([type, count]) => counts[type] === count)) return null;
  const answers = {};
  for (const [id, selected] of Object.entries(raw.answers)) {
    const q = questions.find(q => q.id === Number(id));
    if (!raw.ids.includes(Number(id)) || !validAnswer(q, { selected })) return null;
    answers[id] = [...selected];
  }
  return { ids: [...raw.ids], index: raw.index, answers, startedAt: raw.startedAt, deadline: raw.deadline, ...(finished ? { submittedAt: raw.submittedAt } : {}) };
}

export function startExam(state, questions, now = Date.now(), random = Math.random) {
  if (state.exam) return state.exam;
  const ids = [];
  for (const [type, count] of Object.entries(EXAM_RULES.counts)) {
    const pool = shuffle(questions.filter(q => q.type === type), random);
    if (pool.length < count) throw new Error('题库数量不足，无法组卷');
    ids.push(...pool.slice(0, count).map(q => q.id));
  }
  state.exam = { ids, index: 0, answers: {}, startedAt: now, deadline: now + EXAM_RULES.minutes * 60000 };
  return state.exam;
}

export function examSeconds(exam, now = Date.now()) {
  return Math.max(0, Math.ceil((exam.deadline - now) / 1000));
}

export function setExamAnswer(state, questions, selected, now = Date.now()) {
  const exam = state.exam;
  if (!exam) throw new Error('没有正在进行的考试');
  if (!examSeconds(exam, now)) throw new Error('考试时间已到');
  const id = exam.ids[exam.index];
  const q = questions.find(q => q.id === id);
  if (!Array.isArray(selected) || (selected.length && !validAnswer(q, { selected }))) throw new Error('请选择有效选项');
  if (selected.length) exam.answers[id] = [...selected].sort();
  else delete exam.answers[id];
}

export function goExamQuestion(state, index) {
  if (!state.exam || !Number.isInteger(index) || index < 0 || index >= state.exam.ids.length) throw new Error('题号无效');
  state.exam.index = index;
}

export function examSummary(exam, questions) {
  const wrongIds = exam.ids.filter(id => !isCorrect(questions.find(q => q.id === id), exam.answers[id] || []));
  const correct = exam.ids.length - wrongIds.length;
  return { total: exam.ids.length, correct, score: correct, passed: correct >= EXAM_RULES.passScore, answered: Object.keys(exam.answers).length, unanswered: exam.ids.length - Object.keys(exam.answers).length, wrongIds };
}

export function finishExam(state, questions, now = Date.now()) {
  if (!state.exam) return null;
  const exam = state.exam;
  const summary = examSummary(exam, questions);
  for (const id of exam.ids) {
    state.records[id] = { correct: !summary.wrongIds.includes(id), attempts: (state.records[id]?.attempts || 0) + 1 };
  }
  state.lastExam = { ...exam, ids: [...exam.ids], answers: JSON.parse(JSON.stringify(exam.answers)), submittedAt: now };
  state.exam = null;
  return summary;
}
