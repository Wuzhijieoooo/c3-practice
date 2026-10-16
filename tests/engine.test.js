import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshState, restoreState, isCorrect, startRound, recordAnswer, advanceRound, toggleFavorite, roundSummary, EXAM_RULES, startExam, setExamAnswer, goExamQuestion, examSeconds, examSummary, finishExam } from '../public/engine.js';

const { source, questions } = JSON.parse(readFileSync(new URL('../public/questions.json', import.meta.url)));

test('题库完整、答案有效，保留原库异常', () => {
  assert.equal(questions.length, 2000);
  assert.deepEqual(questions.map(q => q.id), Array.from({ length: 2000 }, (_, i) => i + 1));
  const counts = {};
  for (const q of questions) {
    counts[q.type] = (counts[q.type] || 0) + 1;
    assert.ok(q.text.trim());
    assert.equal(q.options.length, { single: 4, multiple: 5, boolean: 2 }[q.type]);
    assert.equal(new Set(q.options.map(o => o.key)).size, q.options.length);
    assert.ok(q.options.every(o => o.text.trim()));
    assert.ok(q.answer.length && q.answer.every(key => q.options.some(o => o.key === key)));
    assert.ok(isCorrect(q, [...q.answer].reverse()));
    if (q.type !== 'multiple') assert.equal(q.answer.length, 1);
  }
  assert.deepEqual(counts, source.counts);
  assert.equal(questions.reduce((n,q) => n + q.answer.length, 0), 3058);
  assert.deepEqual(questions.filter(q => q.note).map(q => q.id), [1036,1038,1042,1103,1125,1160]);
});

test('10 题顺序练习、重载与下一组不重复，尾组不越界', () => {
  let state = freshState();
  startRound(state, questions, 'sequential');
  for (let index = 0; index < 10; index++) {
    const q = questions[index];
    recordAnswer(state, questions, q.answer);
    recordAnswer(state, questions, q.answer);
    state = restoreState(JSON.stringify(state), questions);
    assert.equal(state.session.index, index);
    assert.equal(state.records[q.id].attempts, 1);
    const summary = advanceRound(state);
    if (index === 9) assert.deepEqual(summary, { mode: 'sequential', total: 10, correct: 10 });
  }
  assert.equal(state.cursor, 10);
  assert.equal(startRound(state, questions, 'sequential').ids[0], 11);
  const sequential = state.session;
  startRound(state, questions, 'random');
  assert.equal(startRound(state, questions, 'sequential'), sequential);
  state.session = null; state.cursor = 1997;
  assert.deepEqual(startRound(state, questions, 'sequential').ids, [1998,1999,2000]);
  for (let i = 1997; i < 2000; i++) { recordAnswer(state, questions, questions[i].answer); advanceRound(state); }
  assert.equal(state.cursor, 2000);
  assert.equal(startRound(state, questions, 'sequential').ids[0], 1);
});

test('多选严格判分、草稿保留，错题答对后移出', () => {
  const q = questions[800];
  assert.equal(isCorrect(q, q.answer.slice(0, -1)), false);
  assert.equal(isCorrect(q, [...q.answer, 'B']), false);
  assert.equal(isCorrect(q, ['A','A','C','D']), false);
  let state = freshState(); state.cursor = 800;
  startRound(state, questions, 'sequential');
  state.session.draft = ['A','C'];
  state = restoreState(JSON.stringify(state), questions);
  assert.deepEqual(state.session.draft, ['A','C']);
  assert.throws(() => recordAnswer(state, questions, []));
  recordAnswer(state, questions, ['A']);
  assert.equal(state.records[q.id].correct, false);
  state.session = null;
  assert.deepEqual(startRound(state, questions, 'wrong').ids, [801]);
  recordAnswer(state, questions, q.answer);
  advanceRound(state);
  assert.equal(state.records[801].correct, true);
  assert.equal(startRound(state, questions, 'wrong'), null);
  assert.equal(state.cursor, 801);
});

test('随机无重复、损坏状态可恢复、不允许跳过未答题', () => {
  const state = freshState();
  startRound(state, questions, 'random', () => .37);
  assert.equal(new Set(state.session.ids).size, 10);
  assert.throws(() => advanceRound(state));
  assert.deepEqual(restoreState('{invalid', questions), freshState());
  assert.deepEqual(restoreState('null', questions), freshState());
  state.session.ids[0] = 9000;
  assert.equal(restoreState(JSON.stringify(state), questions).session, null);
  assert.equal(state.cursor, 0);
});

test('旧版进度升级、新题型专项与收藏恢复', () => {
  const old = { cursor: 20, records: { 1: { correct: true, attempts: 2 } }, session: { mode: 'sequential', ids: [21,22], index: 0, answers: {}, draft: [] } };
  const upgraded = restoreState(JSON.stringify(old), questions);
  assert.equal(upgraded.cursor, 20);
  assert.equal(upgraded.records[1].attempts, 2);
  assert.equal(upgraded.session.ids[0], 21);
  assert.deepEqual(upgraded.favorites, []);
  for (const type of ['single', 'multiple', 'boolean']) {
    let state = freshState();
    startRound(state, questions, type, () => .3);
    assert.equal(state.session.ids.length, 10);
    assert.ok(state.session.ids.every(id => questions[id - 1].type === type));
    state = restoreState(JSON.stringify(state), questions);
    assert.equal(state.session.mode, type);
    recordAnswer(state, questions, questions[state.session.ids[0] - 1].answer);
    assert.equal(state.cursor, 0);
  }
  let state = freshState();
  assert.equal(startRound(state, questions, 'favorites'), null);
  assert.equal(toggleFavorite(state, questions, 801), true);
  assert.equal(toggleFavorite(state, questions, 1201), true);
  state.favorites.push(801, 9000);
  state = restoreState(JSON.stringify(state), questions);
  assert.deepEqual(state.favorites, [801,1201]);
  startRound(state, questions, 'favorites');
  const id = state.session.ids[0];
  recordAnswer(state, questions, questions[id - 1].answer);
  assert.ok(state.favorites.includes(id));
  assert.equal(toggleFavorite(state, questions, id), false);
  assert.throws(() => toggleFavorite(state, questions, 9000));
});

test('本组答案快照保留、重练只取本组错题且不改变原选择', () => {
  let state = freshState();
  state.records[2000] = { correct: false, attempts: 1 };
  startRound(state, questions, 'sequential');
  for (let i=0; i<10; i++) {
    recordAnswer(state, questions, i === 0 ? ['A'] : questions[i].answer);
    advanceRound(state);
  }
  assert.deepEqual(roundSummary(state.lastRound), { mode: 'sequential', total: 10, correct: 9 });
  state = restoreState(JSON.stringify(state), questions);
  assert.deepEqual(state.lastRound.answers[1].selected, ['A']);
  assert.deepEqual(startRound(state, questions, 'retry').ids, [1]);
  recordAnswer(state, questions, ['D']);
  assert.equal(state.records[1].correct, true);
  assert.deepEqual(state.lastRound.answers[1].selected, ['A']);
  advanceRound(state);
  assert.equal(state.lastRound.mode, 'retry');
  assert.equal(startRound(state, questions, 'retry'), null);
  assert.equal(state.cursor, 10);
  const broken = freshState(); broken.lastRound = { mode:'single', ids:[1], answers:{1:{selected:['X']}} };
  assert.equal(restoreState(JSON.stringify(broken), questions).lastRound, null);
});

test('模式切换独立续练、保存多选草稿，空模式与无效模式不改变进度', () => {
  let state = freshState();
  startRound(state, questions, 'sequential');
  recordAnswer(state, questions, ['D']);
  advanceRound(state);
  const sequential = structuredClone(state.session);
  startRound(state, questions, 'multiple', () => .4);
  state.session.draft = ['A', 'C'];
  const multiple = structuredClone(state.session);
  const cursor = state.cursor;
  const before = JSON.stringify(state);
  assert.equal(startRound(state, questions, 'favorites'), null);
  assert.equal(startRound(state, questions, 'wrong'), null);
  assert.throws(() => startRound(state, questions, '__proto__'));
  assert.equal(JSON.stringify(state), before);
  state = restoreState(JSON.stringify(state), questions);
  assert.deepEqual(startRound(state, questions, 'sequential'), sequential);
  assert.deepEqual(startRound(state, questions, 'multiple'), multiple);
  assert.equal(startRound(state, questions, 'multiple', () => { throw new Error('不应重新抽题'); }), state.session);
  assert.equal(state.cursor, cursor);
  for (let i = 0; i < multiple.ids.length; i++) {
    recordAnswer(state, questions, questions[state.session.ids[state.session.index] - 1].answer);
    advanceRound(state);
  }
  state = restoreState(JSON.stringify(state), questions);
  assert.equal(state.session, null);
  assert.deepEqual(state.paused.sequential, sequential);
  assert.deepEqual(startRound(state, questions, 'sequential'), sequential);
  assert.equal(state.records[1].attempts, 1);
  assert.equal(state.lastRound.mode, 'multiple');
});

test('收藏与错题来源变化后仍续练原组，旧进度与部分损坏的暂停组可恢复', () => {
  let state = freshState();
  toggleFavorite(state, questions, 1);
  startRound(state, questions, 'favorites');
  const favorites = structuredClone(state.session);
  toggleFavorite(state, questions, 1);
  state.records[801] = { correct: false, attempts: 1 };
  startRound(state, questions, 'wrong');
  const wrong = structuredClone(state.session);
  startRound(state, questions, 'single');
  state.records[801].correct = true;
  state = restoreState(JSON.stringify(state), questions);
  assert.deepEqual(startRound(state, questions, 'favorites'), favorites);
  assert.deepEqual(startRound(state, questions, 'wrong'), wrong);
  recordAnswer(state, questions, questions[800].answer);
  advanceRound(state);
  assert.equal(state.paused.single.mode, 'single');
  const old = { cursor: 15, records: state.records, session: favorites };
  const upgraded = restoreState(JSON.stringify(old), questions);
  assert.deepEqual(upgraded.session, favorites);
  assert.deepEqual(upgraded.paused, {});
  state.paused.random = { ...favorites, mode: 'favorites' };
  state.paused.multiple = { mode: 'multiple', ids: [9000], index: 0, draft: [], answers: {} };
  state.paused.sequential = { mode: 'sequential', ids: [1,2], index: 0, draft: [], answers: { 2: { selected: ['A'] } } };
  state = restoreState(JSON.stringify(state), questions);
  assert.equal(state.paused.random, undefined);
  assert.equal(state.paused.multiple, undefined);
  assert.equal(state.paused.sequential, undefined);
  assert.deepEqual(state.paused.favorites, favorites);
  assert.ok(state.paused.single);
});

test('本组错题重练切换后保留原组，其他模式完成后仍可继续', () => {
  let state = freshState();
  state.lastRound = { mode: 'single', ids: [1], answers: { 1: { selected: ['A'], correct: false } } };
  startRound(state, questions, 'retry');
  const retry = structuredClone(state.session);
  startRound(state, questions, 'boolean');
  while (state.session) {
    recordAnswer(state, questions, questions[state.session.ids[state.session.index] - 1].answer);
    advanceRound(state);
  }
  state = restoreState(JSON.stringify(state), questions);
  assert.equal(state.lastRound.mode, 'boolean');
  assert.deepEqual(startRound(state, questions, 'retry'), retry);
  recordAnswer(state, questions, ['D']);
  assert.deepEqual(advanceRound(state), { mode: 'retry', total: 1, correct: 1 });
});

test('模拟卷题型配额、修改答案与跳题、断点恢复，不提前影响练习记录', () => {
  let state = freshState();
  startRound(state, questions, 'multiple', () => .4);
  state.session.draft = ['A', 'C'];
  const practice = structuredClone(state.session);
  const now = 1800000000000;
  const exam = startExam(state, questions, now, () => .3);
  assert.equal(exam.ids.length, EXAM_RULES.total);
  assert.equal(new Set(exam.ids).size, 100);
  const counts = {};
  exam.ids.forEach(id => { const type = questions[id - 1].type; counts[type] = (counts[type] || 0) + 1; });
  assert.deepEqual(counts, EXAM_RULES.counts);
  assert.equal(startExam(state, questions, now + 10000), exam);
  setExamAnswer(state, questions, ['A'], now + 1000);
  setExamAnswer(state, questions, ['B'], now + 2000);
  assert.deepEqual(exam.answers[exam.ids[0]], ['B']);
  assert.throws(() => setExamAnswer(state, questions, ['A', 'B'], now + 2000));
  assert.throws(() => goExamQuestion(state, 100));
  goExamQuestion(state, 40);
  setExamAnswer(state, questions, ['A', 'C'], now + 3000);
  assert.equal('correct' in exam.answers[exam.ids[40]], false);
  assert.deepEqual(state.records, {});
  assert.deepEqual(state.session, practice);
  assert.equal(state.cursor, 0);
  state = restoreState(JSON.stringify(state), questions);
  assert.equal(state.exam.index, 40);
  assert.equal(state.exam.deadline, now + 3600000);
  assert.deepEqual(state.exam.answers[state.exam.ids[40]], ['A', 'C']);
  setExamAnswer(state, questions, [], now + 4000);
  assert.equal(state.exam.answers[state.exam.ids[40]], undefined);
  assert.deepEqual(state.session, practice);
});

test('模拟考试统一评分、多选全对才得分、未答计错，交卷不重复记次数', () => {
  let state = freshState();
  const now = 1800000000000;
  const exam = startExam(state, questions, now, () => .37);
  for (let i = 0; i < 60; i++) {
    goExamQuestion(state, i);
    setExamAnswer(state, questions, questions[exam.ids[i] - 1].answer, now + 1000);
  }
  assert.equal(examSummary(exam, questions).score, 60);
  assert.equal(examSummary(exam, questions).passed, true);
  const multiIndex = exam.ids.findIndex(id => questions[id - 1].type === 'multiple' && questions[id - 1].answer.length > 1);
  goExamQuestion(state, multiIndex);
  setExamAnswer(state, questions, questions[exam.ids[multiIndex] - 1].answer.slice(0, -1), now + 2000);
  const summary = finishExam(state, questions, now + 3000);
  assert.equal(summary.score, 59);
  assert.equal(summary.passed, false);
  assert.equal(summary.unanswered, 40);
  assert.equal(summary.wrongIds.length, 41);
  assert.equal(state.exam, null);
  assert.equal(Object.keys(state.records).length, 100);
  assert.equal(state.records[exam.ids[99]].correct, false);
  assert.equal(state.records[exam.ids[0]].attempts, 1);
  const result = structuredClone(state.lastExam);
  assert.equal(finishExam(state, questions, now + 4000), null);
  assert.deepEqual(state.lastExam, result);
  assert.equal(state.records[exam.ids[0]].attempts, 1);
  state = restoreState(JSON.stringify(state), questions);
  assert.equal(examSummary(state.lastExam, questions).score, 59);
  assert.equal(state.lastExam.submittedAt, now + 3000);
  const perfect = freshState();
  startExam(perfect, questions, now);
  for (let i = 0; i < 100; i++) {
    goExamQuestion(perfect, i);
    setExamAnswer(perfect, questions, questions[perfect.exam.ids[i] - 1].answer, now + 1000);
  }
  const fullScore = finishExam(perfect, questions, now + 2000);
  assert.equal(fullScore.score, 100);
  assert.equal(fullScore.unanswered, 0);
  assert.deepEqual(fullScore.wrongIds, []);
});

test('考试截止时间离线恢复不重置，到期不能修改答案，损坏试卷不影响普通进度', () => {
  let state = freshState();
  state.cursor = 27;
  startRound(state, questions, 'sequential');
  const now = 1800000000000;
  startExam(state, questions, now, () => .4);
  setExamAnswer(state, questions, ['A'], now + 1000);
  state = restoreState(JSON.stringify(state), questions);
  assert.equal(examSeconds(state.exam, now + 3599999), 1);
  assert.equal(examSeconds(state.exam, now + 3600000), 0);
  const answers = structuredClone(state.exam.answers);
  assert.throws(() => setExamAnswer(state, questions, ['B'], now + 3600000));
  assert.deepEqual(state.exam.answers, answers);
  finishExam(state, questions, now + 3600000);
  assert.equal(state.lastExam.submittedAt, state.lastExam.deadline);
  assert.equal(state.cursor, 27);
  assert.equal(state.session.ids[0], 28);
  startExam(state, questions, now + 4000000);
  const valid = JSON.stringify(state);
  const corruptions = [
    e => { e.ids[1] = e.ids[0]; },
    e => { e.deadline += 1000; },
    e => { e.index = 100; },
    e => { e.answers[e.ids[0]] = ['X']; },
    e => { e.ids = Array.from({ length: 100 }, (_, i) => i + 1); }
  ];
  for (const corrupt of corruptions) {
    const raw = JSON.parse(valid); corrupt(raw.exam);
    const restored = restoreState(JSON.stringify(raw), questions);
    assert.equal(restored.exam, null);
    assert.equal(restored.cursor, 27);
    assert.equal(restored.session.ids[0], 28);
    assert.ok(restored.lastExam);
  }
});
