import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshState, restoreState, isCorrect, startRound, recordAnswer, advanceRound, toggleFavorite, roundSummary } from '../public/engine.js';

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
  assert.throws(() => startRound(state, questions, 'random'));
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
