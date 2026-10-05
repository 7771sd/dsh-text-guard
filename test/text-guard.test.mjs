/**
 * Offline checks for dsh-text-guard. Every assertion compares booleans, counts,
 * or ASCII fragments: a failing check must never print the matched text, because
 * printing it into a terminal would put the sequence back into model context.
 */
import assert from 'node:assert/strict';
import { apply } from '../index.js';

const PAIR = String.fromCodePoint(0x1f1f9, 0x1f1fc);
const PROBE = 'ZZQ';
const CONFIG = {
	mode: 'exact',
	sequences: [[0x5a, 0x5a, 0x51], [0x1f1f9, 0x1f1fc]],
	replacement: '<TG-{codepoints}>',
};

/** Build a plugin context that records handlers and log lines. */
function harness(config) {
	const handlers = new Map();
	const logs = [];
	apply({
		on: (name, handler) => handlers.set(name, handler),
		logger: { info: (line) => logs.push(line) },
	}, config);
	return { handlers, logs };
}

const accept = async () => ({ kind: 'accept' });

{
	const { handlers, logs } = harness(CONFIG);
	const text = `langs: ${PROBE} | flag ${PAIR}`;
	const result = { isError: false, content: [{ type: 'text', text }], value: { note: PROBE } };
	const out = await handlers.get('tools/post-execute')({ name: 'pwsh' }, result, accept);
	const rewritten = out.content[0].text;
	assert.equal(out.kind, 'accept');
	assert.equal(rewritten.includes(PROBE), false, 'probe survived content rewrite');
	assert.equal(rewritten.includes(PAIR), false, 'sequence survived content rewrite');
	assert.equal(rewritten.startsWith('langs: <TG-'), true, 'replacement marker missing');
	assert.equal(rewritten.includes('U+005A U+005A U+0051'), true, 'codepoints not named');
	assert.equal(Object.hasOwn(out, 'value'), false, 'content rewrite must not supply value too');
	assert.equal(logs.length, 1, 'expected exactly one neutralization log line');
	console.log('ok 1  tool result content rewritten; 2 matches; 1 log line');
}

{
	const { handlers, logs } = harness(CONFIG);
	const decision = { kind: 'accept', value: { note: PROBE, keep: 7 } };
	const out = await handlers.get('tools/post-execute')({ name: 'read' }, { isError: false, content: [] }, async () => decision);
	assert.equal(Object.hasOwn(out, 'content'), false, 'value decision must not gain content');
	assert.equal(out.value.note.includes(PROBE), false, 'probe survived value rewrite');
	assert.equal(out.value.keep, 7, 'value rewrite dropped a sibling field');
	assert.equal(logs.length, 1);
	console.log('ok 2  value-form accept decision rewritten in place of content');
}

{
	const { handlers, logs } = harness(CONFIG);
	const blocked = { kind: 'block', feedback: [{ type: 'text', text: `no ${PROBE}` }] };
	const out = await handlers.get('tools/post-execute')({ name: 'read' }, { isError: false, content: [] }, async () => blocked);
	assert.equal(out, blocked, 'block decision must pass through untouched');
	assert.equal(logs.length, 0);
	console.log('ok 3  block decision untouched');
}

{
	const { handlers, logs } = harness(CONFIG);
	const decision = { kind: 'accept' };
	const result = { isError: false, content: [{ type: 'text', text: 'nothing to do here' }] };
	const out = await handlers.get('tools/post-execute')({ name: 'read' }, result, async () => decision);
	assert.equal(out, decision, 'clean result must return the identical decision');
	assert.equal(logs.length, 0, 'clean result must not log');
	console.log('ok 4  clean result returns the identical reference and logs nothing');
}

{
	const { handlers, logs } = harness(CONFIG);
	const message = { role: 'user', id: 'm1', content: [{ type: 'text', text: `paste: ${PROBE}` }] };
	const decision = { kind: 'enter', messages: [message], startsRequestSeries: true };
	const out = await handlers.get('agent/pre-step')({ agent: { id: 'a' }, messages: [message], turn: 1, step: 1 }, async () => decision);
	assert.equal(out.startsRequestSeries, true, 'pre-step rewrite dropped startsRequestSeries');
	assert.equal(out.messages[0].content[0].text.includes(PROBE), false, 'probe survived pre-step rewrite');
	assert.equal(out.messages[0].id, 'm1', 'pre-step rewrite dropped the message identity');
	assert.equal(message.content[0].text.includes(PROBE), true, 'input message must not be mutated');
	console.log('ok 5  entering user message rewritten; identity and flags preserved');
}

{
	const { handlers, logs } = harness(CONFIG);
	const decision = { kind: 'reject' };
	const out = await handlers.get('agent/pre-step')({ agent: { id: 'a' }, messages: [], turn: 1, step: 1 }, async () => decision);
	assert.equal(out, decision, 'reject decision must pass through untouched');
	console.log('ok 6  reject decision untouched');
}

{
	const { handlers, logs } = harness({ ...CONFIG, userMessages: false, toolResults: false });
	assert.equal(handlers.size, 0, 'disabled surfaces must register no handlers');
	console.log('ok 7  both surfaces disabled registers no handlers');
}

{
	const { handlers, logs } = harness({ mode: 'regional-pairs', replacement: '[flag U+{codepoints}]' });
	const other = String.fromCodePoint(0x1f1e9, 0x1f1ea);
	const result = { isError: false, content: [{ type: 'text', text: `lang ${other} ok` }] };
	const out = await handlers.get('tools/post-execute')({ name: 'web_fetch' }, result, accept);
	assert.equal(out.content[0].text.includes(other), false, 'a regional pair survived regional-pairs mode');
	assert.equal(out.content[0].text.includes('U+1F1E9 U+1F1EA'), true, 'codepoints not named');
	assert.equal(logs.length, 1);
	console.log('ok 8  regional-pairs mode neutralizes any pair and names its codepoints');
}

{
	const { handlers, logs } = harness({ mode: 'regional-pairs', replacement: '[flag U+{codepoints}]' });
	const lone = String.fromCodePoint(0x1f1e9);
	const result = { isError: false, content: [{ type: 'text', text: `lone ${lone} indicator` }] };
	const decision = { kind: 'accept' };
	const out = await handlers.get('tools/post-execute')({ name: 'web_fetch' }, result, async () => decision);
	assert.equal(out, decision, 'a lone regional indicator must return the identical decision');
	assert.equal(result.content[0].text.includes(lone), true, 'the dispatch result must not be mutated');
	assert.equal(logs.length, 0, 'a lone regional indicator must not log');
	console.log('ok 9  regional-pairs mode leaves a lone regional indicator untouched');
}

console.log('all local checks passed');
