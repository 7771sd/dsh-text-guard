# dsh-text-guard

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件：在工具结果与进入步骤的消息**写入会话日志之前**，中和掉配置的码点序列。

[English](README.md)

## 它解决什么问题

官方 DeepSeek API 在请求携带某些文本时，会把整条请求判为 `400 INVALID_REQUEST (Content Exists Risk)`。对实测到的那一串——区域指示符 U+1F1F9 紧跟 U+1F1FC，即合成一面旗帜 emoji 的那一对——字符级二分显示：**这一对**会被拒收，而任一单字符、倒序、其他组合都正常。

由于每一轮都会重发已存历史，序列一旦进入会话日志，**该会话其后每一轮都会被拒收**。会话就此报废：重试无效，重启程序无效，只能新建。而这类序列通常不是用户敲进去的，而是抓取回来的网页、文件内容或命令输出经由工具结果带进来的。

## 它做什么

在内容进入日志的位置改写配置的序列：

| 挂钩点 | 覆盖内容 |
|---|---|
| `tools/post-execute` | 被接受的工具结果——联网抓取、读文件、命令输出、子代理与工作流结果 |
| `tools/ptc-dispatch-log` | 一次 `run_code` 子派发结果的持久日志副本 |
| `agent/pre-step` | 进入本步的消息，包括用户粘贴的文本 |

没有命中的内容原样通过并保留原有对象身份，因此未受影响的派发只付出一次正则探测的代价。改写发生在写入之前，这正是 `Session` 的重放、分叉以及其后每个请求保持一致的原因；替换文本是纯 ASCII，绝不会把该序列重新带回来。

## 安装

用 Harness 命令行：

```sh
dsh plugin --profile <profile> add github:7771sd/dsh-text-guard
```

或在 Plugin Manager 的安装框里填同一个 spec。本插件无依赖、无构建步骤。

## 配置

随附的组合包补丁以宽模式挂载。每个字段都可以在你自己 profile 的 `cordis.patch.yml` 里覆盖：

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

| 字段 | 默认值 | 含义 |
|---|---|---|
| `mode` | `regional-pairs` | `regional-pairs` 匹配任意两个连续的区域指示符（U+1F1E6–U+1F1FF）；`exact` 只匹配配置的 `sequences`。 |
| `sequences` | `[[0x1F1F9, 0x1F1FC]]` | `mode: exact` 要中和的码点序列；每一项按连续顺序匹配。 |
| `replacement` | `[flag U+{codepoints}]` | 替换模板；每个 `{codepoints}` 会替换为命中的码点，例如 `U+1F1F9 U+1F1FC`。 |
| `toolResults` | `true` | 中和被接受的工具结果与 `run_code` 派发日志。 |
| `userMessages` | `true` | 中和进入步骤的消息。 |
| `log` | `true` | 每个受影响的派发记录一行摘要，只记数量，绝不记命中的文本。 |

改配置不会热生效：改完补丁后需要重新挂载该组合包（先停用再启用）。

## 为什么挂在日志入口

`dsh-agent-loop` 会深冻结请求消息，并明确记录 `agent/request` 监听器不能修改请求消息；而 Harness 的规则是模型看到的一切都必须能从会话日志重建。在写入之后改写会破坏这种可重建性，因此中和器运行在内容进入日志的位置，而不是报文出口。

## 已验证

- `node test/text-guard.test.mjs` —— 九项离线检查：内容与 `value` 形式的改写、`block` 决策透传、干净结果返回同一引用、消息改写保留身份与 `startsRequestSeries`、不修改入参、两个作用面可干净关闭、成对匹配、单字符透传。
- 在真实 profile 里端到端跑通：把插件临时配置为中和一个 ASCII 探针后，输出含该探针的命令结果在到达模型时已被改写。

未验证：作者从未真的向它发过一面真旗帜 emoji —— 因为证明过滤器会拒收它的那个实验，同时也会毁掉跑实验的那个会话。

## 已知限制

- 经由系统提示段落抵达请求的文本——自带该序列的技能文件或指令文件——不经过这些入口。
- 被改写的用户消息以中和后的形式入日志，而聊天客户端仍显示你发出的原文，两处对同一条消息的呈现不一致。
- 改写在设计上是有损的。当原文对任务必须逐字保真时，不要挂载它。

## 许可

MIT
