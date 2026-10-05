/**
 * Neutralize configured code-point sequences before they reach the session log.
 *
 * The regional-indicator pair U+1F1F9 U+1F1FC (the flag emoji it composes) makes
 * DeepSeek reject an entire request with `400 INVALID_REQUEST (Content Exists
 * Risk)`. Every turn resends the stored history, so a single stored occurrence
 * rejects every later turn of that session.
 *
 * The rewrite happens where content enters the log, not at the wire:
 * `dsh-agent-loop` deep-freezes request messages and documents that
 * `agent/request` listeners cannot change request messages.
 *
 * @module dsh-text-guard
 */

/** Plugin name used by Loader diagnostics. */
export const name = 'text-guard';

/** Regional-indicator code points as a `u`-flag character-class body. */
const RI_CLASS = '\\u{1F1E6}-\\u{1F1FF}';

/** Two consecutive regional indicators: one flag emoji. */
const RI_PAIR_SOURCE = `[${RI_CLASS}]{2}`;

/** Neutralized when no `sequences` are configured: U+1F1F9 U+1F1FC. */
const DEFAULT_SEQUENCES = [[0x1f1f9, 0x1f1fc]];

/** Default replacement; `{codepoints}` receives every matched code point. */
const DEFAULT_REPLACEMENT = '[flag U+{codepoints}]';

/**
 * Resolve one Loader row config into shared match and replacement state.
 * @param config - this plugin row's config.
 * @returns the resolved option set every listener shares.
 */
function resolveOptions(config) {
	const configured = Array.isArray(config.sequences) && config.sequences.length > 0;
	const sequences = configured ? config.sequences : DEFAULT_SEQUENCES;
	const source = config.mode === 'exact'
		? sequences
			.map((sequence) => sequence
				.map((point) => `\\u{${Number(point).toString(16).toUpperCase()}}`)
				.join(''))
			.join('|')
		: RI_PAIR_SOURCE;
	return {
		matcher: new RegExp(source, 'gu'),
		probe: new RegExp(source, 'u'),
		replacement: typeof config.replacement === 'string' ? config.replacement : DEFAULT_REPLACEMENT,
		toolResults: config.toolResults !== false,
		userMessages: config.userMessages !== false,
		log: config.log !== false,
	};
}

/**
 * Render the replacement for one matched sequence.
 * @param template - configured replacement template.
 * @param match - the matched text.
 * @returns replacement text naming every matched code point.
 */
function renderReplacement(template, match) {
	const codepoints = [...match]
		.map((character) => `U+${character.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`)
		.join(' ');
	return template.replaceAll('{codepoints}', codepoints);
}

/**
 * Neutralize matches in one string.
 * @param text - candidate string.
 * @param options - resolved option set.
 * @param stats - per-call match counter.
 * @returns the original string when nothing matched, otherwise a rewritten copy.
 */
function scrubText(text, options, stats) {
	if (text.length === 0 || !options.probe.test(text)) return text;
	return text.replace(options.matcher, (match) => {
		stats.count += 1;
		return renderReplacement(options.replacement, match);
	});
}

/**
 * Neutralize matches in every string of one JSON-like value without mutating it.
 * @param value - string, array, plain object, or any other value.
 * @param options - resolved option set.
 * @param stats - per-call match counter.
 * @returns the original reference when nothing matched, otherwise a rewritten copy.
 */
function scrubValue(value, options, stats) {
	if (typeof value === 'string') return scrubText(value, options, stats);
	if (Array.isArray(value)) {
		let changed = false;
		const next = value.map((entry) => {
			const scrubbed = scrubValue(entry, options, stats);
			if (scrubbed !== entry) changed = true;
			return scrubbed;
		});
		return changed ? next : value;
	}
	if (value === null || typeof value !== 'object') return value;
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) return value;
	let changed = false;
	const next = {};
	for (const [key, entry] of Object.entries(value)) {
		const scrubbed = scrubValue(entry, options, stats);
		if (scrubbed !== entry) changed = true;
		next[key] = scrubbed;
	}
	return changed ? next : value;
}

/**
 * Rewrite one accepted tool decision, preserving every field it already carries.
 * @param decision - the accepted decision returned by the downstream chain.
 * @param result - the dispatch outcome that decision accepts.
 * @param options - resolved option set.
 * @param stats - per-call match counter.
 * @returns the original decision when nothing matched, otherwise a rewritten copy.
 */
function neutralizeDecision(decision, result, options, stats) {
	if (Object.hasOwn(decision, 'value')) {
		if (result.isError) return decision;
		const value = scrubValue(decision.value, options, stats);
		return value === decision.value ? decision : { ...decision, value };
	}
	const content = decision.content ?? result.content;
	const scrubbed = scrubValue(content, options, stats);
	return scrubbed === content ? decision : { ...decision, content: scrubbed };
}

/**
 * Report one neutralization summary, naming the count and never the matched text.
 * @param ctx - plugin context that owns the logger.
 * @param options - resolved option set.
 * @param stats - per-call match counter.
 * @param where - short description of the rewritten content.
 */
function report(ctx, options, stats, where) {
	if (!options.log || stats.count === 0) return;
	ctx.logger.info(`text-guard: neutralized ${stats.count} sequence(s) in ${where}`);
}

/**
 * Install the neutralizers on the points where content enters the session log.
 * @param ctx - plugin context that owns the listeners.
 * @param config - this plugin row's config.
 */
export function apply(ctx, config) {
	const options = resolveOptions(config ?? {});

	if (options.toolResults) {
		ctx.on('tools/post-execute', async (exec, result, next) => {
			const decision = await next();
			if (decision.kind !== 'accept') return decision;
			const stats = { count: 0 };
			const scrubbed = neutralizeDecision(decision, result, options, stats);
			report(ctx, options, stats, `${exec.name} result`);
			return scrubbed;
		});
		ctx.on('tools/ptc-dispatch-log', async (dispatch, next) => {
			const content = await next();
			const stats = { count: 0 };
			const scrubbed = scrubValue(content, options, stats);
			report(ctx, options, stats, `${dispatch.name} dispatch`);
			return scrubbed;
		});
	}

	if (options.userMessages) {
		ctx.on('agent/pre-step', async (payload, next) => {
			const decision = await next();
			if (decision.kind !== 'enter') return decision;
			const stats = { count: 0 };
			const messages = scrubValue(decision.messages, options, stats);
			report(ctx, options, stats, 'step messages');
			return messages === decision.messages ? decision : { ...decision, messages };
		});
	}
}
