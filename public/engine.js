export const STORAGE_KEY = 'c3-practice-v1';
const MODES = ['sequential', 'random', 'wrong', 'single', 'multiple', 'boolean', 'favorites', 'retry'];

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
  return { cursor: 0, records: {}, favorites: [], session: null, lastRound: null };
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
    const restored = restoreRound(parsed.session, questions);
    const s = parsed.session;
    if (restored && Number.isInteger(s.index) && s.index >= 0 && s.index < s.ids.length) {
      let valid = true;
      if (s.ids.slice(0, s.index).some(id => !s.answers[id])) valid = false;
      if (s.ids.slice(s.index + 1).some(id => s.answers[id])) valid = false;
      const current = questions.find(q => q.id === s.ids[s.index]);
      s.draft = Array.isArray(s.draft) && new Set(s.draft).size === s.draft.length && s.draft.every(key => current.options.some(o => o.key === key)) ? s.draft : [];
      if (valid) state.session = { ...restored, index: s.index, draft: s.draft };
    }
    return state;
  } catch { return freshState(); }
}

export function isCorrect(question, selected) {
  return selected.length === question.answer.length && new Set(selected).size === selected.length && question.answer.every(key => selected.includes(key));
}

export function startRound(state, questions, mode, random = Math.random) {
  if (state.session) throw new Error('请先完成当前练习');
  let pool;
  if (mode === 'sequential') {
    if (state.cursor >= questions.length) state.cursor = 0;
    pool = questions.slice(state.cursor, state.cursor + 10);
  } else if (MODES.includes(mode)) {
    const retryIds = state.lastRound?.ids.filter(id => !state.lastRound.answers[id].correct) || [];
    pool = questions.filter(q => mode === 'random' || q.type === mode || (mode === 'wrong' && state.records[q.id]?.correct === false) || (mode === 'favorites' && state.favorites.includes(q.id)) || (mode === 'retry' && retryIds.includes(q.id)));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    pool = pool.slice(0, 10);
  } else { throw new Error('未知练习模式'); }
  if (!pool.length) return null;
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
