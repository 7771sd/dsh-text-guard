# dsh-text-guard

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that neutralizes configured code-point sequences in tool results and in the messages entering a step, **before the session log records them**.

[中文说明](README.zh.md)

## The problem it solves

The official DeepSeek API rejects a whole request with `400 INVALID_REQUEST (Content Exists Risk)` when it carries certain text. For the sequence observed in practice — the regional-indicator pair U+1F1F9 followed by U+1F1FC, which composes one flag emoji — character-level bisection showed the pair rejects the request while either character alone, the reversed pair, and other combinations are accepted.

Because every turn resends the stored history, a sequence that reaches the session log rejects **every following turn of that session**. The session becomes unusable: retrying does not help, restarting the app does not help, and the only way out is a new session. The usual way such a sequence arrives is not the user typing it, but fetched pages, file contents, or command output passing through a tool result.

## What it does

It rewrites the configured sequences where content enters the log:

| Hook | Content covered |
|---|---|
| `tools/post-execute` | an accepted tool result — web fetches, file reads, command output, subagent and workflow results |
| `tools/ptc-dispatch-log` | the durable log copy of one `run_code` sub-dispatch outcome |
| `agent/pre-step` | the messages entering the step, including text a user pasted |

Content without a match passes through untouched and keeps its original object identity, so an unaffected dispatch costs one regular-expression probe. The rewrite happens before the append, which is what keeps `Session` replay, fork, and every later request consistent — and it never puts the sequence back, because the replacement is pure ASCII.

## Install

With the Harness CLI:

```sh
dsh plugin --profile <profile> add github:7771sd/dsh-text-guard
```

Or through the Plugin Manager's install field, using the same spec. The plugin has no dependencies and no build step.

## Configuration

The shipped bundle patch mounts it with the wide mode. Every field can be overridden in your profile's `cordis.patch.yml`:

```yaml
- id: text-guard
  config:
    mode: exact
    sequences: [[0x1F1F9, 0x1F1FC]]
    replacement: '[flag U+{codepoints}]'
    toolResults: true
    userMessages: true
    log: true
```

| Field | Default | Meaning |
|---|---|---|
| `mode` | `regional-pairs` | `regional-pairs` matches any two consecutive regional indicators (U+1F1E6–U+1F1FF); `exact` matches the configured `sequences` only. |
| `sequences` | `[[0x1F1F9, 0x1F1FC]]` | Code-point sequences `mode: exact` neutralizes; each entry is matched consecutively. |
| `replacement` | `[flag U+{codepoints}]` | Replacement template; every `{codepoints}` becomes the matched code points, for example `U+1F1F9 U+1F1FC`. |
| `toolResults` | `true` | Neutralize accepted tool results and `run_code` dispatch logs. |
| `userMessages` | `true` | Neutralize the messages entering a step. |
| `log` | `true` | Log one summary line per affected dispatch, naming the count and never the matched text. |

Configuration changes are not hot: re-mount the bundle (disable and enable it) after editing the patch.

## Why it hooks the log entry points

`dsh-agent-loop` deep-freezes request messages and documents that `agent/request` listeners cannot change request messages; the Harness rule is that everything the model sees must be reconstructable from the session log. A rewrite after the append would break that reconstruction, so the neutralizer runs where content enters the log instead of at the wire.

## Verified

- `node test/text-guard.test.mjs` — nine offline checks: content and value-form rewriting, block decisions passing through, a clean result returning the identical reference, message rewriting that preserves identity and `startsRequestSeries`, no mutation of inputs, both surfaces disabling cleanly, pair matching, and lone indicators passing through.
- End to end in a live profile: with the plugin configured to neutralize an ASCII probe, a command whose output contained the probe reached the model already rewritten.

Not verified: the plugin has never been sent a real flag emoji by its author, because the experiment that proves the filter rejects one also destroys the session it runs in.

## Limitations

- Text that reaches a request through a system-prompt section — a skill file or an instruction file that itself contains a sequence — does not pass these entry points.
- A rewritten user message is logged in its neutralized form while the chat client keeps displaying the text you sent, so the two views disagree about that message.
- The rewrite is lossy by design. Do not mount it when the original text matters verbatim to the task.

## License

MIT
