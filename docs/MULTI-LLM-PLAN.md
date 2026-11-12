# Multi-LLM plan: Orchestrator and agents on any AI CLI

Goal: the app becomes "agents and orchestrators built on the AIs connected
through their CLIs". Today everything that *runs* is Claude Code; this document
says what has to change, per part of the code, to also drive Codex CLI,
Gemini CLI, OpenCode, Cursor CLI, Aider and Qwen Code.

Status legend used below: **verified** = checked in this repo or with
`--help` on this machine; **to verify** = from public docs/memory, must be
checked against the installed CLI before coding against it.

Machine where this was written (2026-10-30): only `claude` is installed
(`2.1.314 (Claude Code)`, `~/.local/bin/claude`). None of `codex`, `gemini`,
`opencode`, `cursor-agent`, `aider`, `qwen` is on the PATH, so **every
non-Claude flag in this document is "to verify"**.

---

## 1. What the code does today (all Claude-specific)

| Part | File | How it talks to Claude | Claude-only assumptions |
|---|---|---|---|
| Orchestrator chat + side chats | `app/conversa.js` | `spawn('claude', ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-prompt-tool', 'stdio', '--permission-mode', 'auto', ...])`, one long-lived process per chat, JSON lines both ways | Event types `system/init`, `stream_event`, `assistant`, `user`, `result`, `rate_limit_event`, `control_request` (`can_use_tool`) answered with `control_response`; interrupt = `control_request {subtype: interrupt}`; resume = `--resume <session_id>`; model/effort only at spawn (`--model`, `--effort`), so changing them restarts with `--resume`; history re-read from `~/.claude/projects/<cwd>/<session>.jsonl`; slash-command list from `init.slash_commands`; env scrub list `HERDADAS` (`CLAUDECODE`, `CLAUDE_CODE_*`, ...) |
| Agents in tmux | `app/coletor.js` | Reads tmux panes (`list-panes`, `capture-pane`), keeps panes whose screen matches `TELA_CLAUDE` (`│ >`, `esc to interrupt`, `⏵⏵`, `auto mode`...) | Screen regexes are Claude's TUI; state from hook events (`UserPromptSubmit`, `PostToolUse`, `PermissionRequest`, `Stop`, `SessionEnd`...); model from `docker exec ... grep '"model":"claude-…"'` in `~/.claude/projects` |
| Agent signals | `hooks/orq-evento.sh` | Claude Code hook: reads hook JSON on stdin, appends to `<project>/.orq/eventos/<session>.jsonl`; on `PermissionRequest` waits for `.orq/permissoes/<id>.resposta` and prints `hookSpecificOutput.decision` | Hook input/output schema is Claude's |
| Workflow step "Ask an AI" | `app/workflows.js` (`claude` step, field `via`) | `via: claude` → `processo('claude', ['-p', '--model', c.modelo], { entrada: prompt })`; `via: codex` → `codex exec --sandbox read-only -o <file> -` in an empty temp folder; `via: anthropic` → official SDK (`@anthropic-ai/sdk`); `via: openai` → Responses API over HTTP. One shot, plain text out | Model list `sonnet/haiku/opus` only for `via: claude` |
| Library | `app/repertorio.js` | Already multi-tool: Claude skills/commands/agents, `~/.agents/skills`, Codex prompts/skills, Gemini TOML commands, OpenCode commands/agents, Windsurf workflows, Cursor commands. A skill the current chat's Claude doesn't know is sent **with its content inline** | Only the "send as `/name`" shortcut is Claude-specific |
| Settings | `app/ias.js` + "IAs conectadas (CLI)" panel (**phase 1, done**) | Detects the 7 CLIs on the app's PATH (`--version`, no shell, 5 s timeout, only the version number kept); config keys `iaOrquestrador` / `iaAgentes` (default `claude`); anything not supported falls back to `claude` with a visible notice | `suportado: true` only for `claude` |

---

## 2. The adapter interface

One module per CLI under `app/ias/` (e.g. `ias/claude.js`, `ias/codex.js`),
all exporting the same shape. `conversa.js` keeps its `Conversa` class but
delegates every CLI-specific line to `this.adaptador`. The UI events
(`conversa:evento`, `conversa:parcial`, `conversa:pedido`, `conversa:info`)
stay exactly as they are, so `conversa-tela.js` does not change.

```js
// app/ias/<id>.js
module.exports = {
  id: 'codex', nome: 'Codex CLI', comando: 'codex',
  capacidades: {            // what the UI may offer for this CLI
    streaming: true,        // partial text while answering
    permissoes: 'stdio',    // 'stdio' (asks the app) | 'politica' (fixed mode only) | 'nenhuma'
    interromper: true, retomar: true, imagens: false,
    trocaModeloSemReiniciar: false, uso: 'tokens',  // 'tokens' | 'janela' | null
  },
  modelos: () => [...],     // [{ id, nome }] for the model button
  esforcos: [...],          // [] when the CLI has no effort knob
  ambiente(envBase) {},     // scrub the CLI's own child-process variables
  argumentos({ sessao, modelo, esforco, modoPermissao }) {},  // argv for spawn
  // stdin protocol
  mensagem({ texto, imagens }) {},   // -> line(s) to write, or null if one-shot
  resposta(pedido, decisao) {},      // permission/question answer -> line
  interrupcao() {},                  // -> line, or 'SIGINT'
  // stdout protocol: one parsed line -> zero or more normalized events
  traduzir(linha) {},  // [{ tipo: 'init'|'parcial'|'assistente'|'ferramenta'|
                       //    'resultadoFerramenta'|'pedido'|'fim-turno'|'uso'|'erro', ... }]
  historico(sessao, pasta) {},       // past turns for --resume, or []
  versao: (saida) => '...',          // already in ias.js
};
```

Normalized events (what `Conversa.tratar` switches on instead of Claude's raw
`d.type`):

| Event | Fields | Claude source today |
|---|---|---|
| `init` | `sessao`, `modelo`, `pasta`, `comandos[]` | `system/init` |
| `parcial` | `texto` or `null` (new message) | `stream_event` `content_block_delta` / `message_start` |
| `assistente` | `message` (Anthropic-style content blocks) | `assistant` |
| `usuario` | tool results | `user` |
| `pedido` | `id`, `ferramenta`, `entrada`, `motivo` | `control_request can_use_tool` |
| `uso` | `contexto`, `janela`, `uso5h`, `uso7d` (any may be null) | `assistant.usage`, `result.modelUsage`, `rate_limit_event` |
| `fim-turno` | `erro`, `duracao`, `texto` | `result` |

Rule: the UI shows a control only when the adapter's `capacidades` says it
works (no "Interrupt" button for a one-shot CLI, no effort menu for a CLI
without effort).

---

## 3. What each CLI offers for non-interactive / streaming use

Everything outside the Claude row is **to verify** (not installed here).

| CLI (binary) | Headless mode | Streaming format | Multi-turn over stdin | Permissions from the app | Interrupt | Resume | Model / effort | Usage info |
|---|---|---|---|---|---|---|---|---|
| Claude Code (`claude`) **verified** | `-p` | `--output-format stream-json` + `--include-partial-messages` | yes, `--input-format stream-json` | yes: `control_request can_use_tool` ↔ `control_response` (`--permission-prompt-tool stdio`) | `control_request interrupt` | `--resume <id>`, `--fork-session` | `--model`, `--effort low…max` | tokens per message, context window, 5 h / 7 d utilization |
| Codex CLI (`codex`) | `codex exec` | `--json` JSONL (thread/turn/item events) | no in `exec` (one turn per process; next turn = `codex exec resume <id>`); long-lived option: `codex app-server` / `codex mcp-server` JSON-RPC | `exec`: approval policy is fixed up front (`--sandbox`, `--ask-for-approval`, `--full-auto`); interactive approvals only via app-server protocol | kill process (exec) / JSON-RPC interrupt (app-server) | `codex exec resume <id>` / `--last`; sessions in `~/.codex/sessions/*.jsonl` | `-m`, `-c model_reasoning_effort=…` | `turn.completed.usage` tokens |
| Gemini CLI (`gemini`) | `-p` / piped stdin | `--output-format stream-json` (and `json`) | no in `-p`; long-lived option: ACP (`--experimental-acp`, JSON-RPC over stdio) | `-p`: `--approval-mode` / `--yolo` fixed up front; ACP has `session/request_permission` | ACP `session/cancel`; else kill | `--resume` (recent versions); chats under `~/.gemini/tmp/` | `-m`; thinking budget via settings | stats in final `result` event |
| OpenCode (`opencode`) | `opencode run "msg"` | `--format json` | long-lived option: `opencode serve` (HTTP + SSE events, official SDK); also `opencode acp` | permission rules in config (`ask`/`allow`/`deny`); `ask` surfaces as server events answerable over HTTP | HTTP abort endpoint | `--session <id>`, `--continue` | `-m provider/model`; effort per provider | tokens/cost in message metadata |
| Cursor CLI (`cursor-agent`) | `-p` | `--output-format stream-json` (`--stream-partial-output`) | no (one turn per process) | `--force` or fixed rules in `~/.cursor/cli-config.json`; no per-call approval in `-p` | kill | `--resume <chatId>`, `ls` | `-m` | to verify |
| Aider (`aider`) | `--message "…"` (`-m`) | none structured (plain text) | no; Python scripting API instead | `--yes-always` or nothing; edits files and commits by default (`--no-auto-commits`) | kill | `--restore-chat-history` (per repo `.aider.chat.history.md`) | `--model`, `--reasoning-effort` | printed text only |
| Qwen Code (`qwen`) | `-p` (Gemini CLI fork) | `--output-format stream-json` | ACP (`--experimental-acp`) | `--approval-mode`, `--yolo` | ACP cancel / kill | `--resume` | `-m` | stats in `result` |

Consequences:

- **Orchestrator candidates** need a long-lived, multi-turn process with
  per-call permission prompts: Claude (today), then Codex via `app-server`,
  Gemini / Qwen / OpenCode via ACP or `serve`. One-shot CLIs (Cursor, Aider)
  can orchestrate only by "one process per turn + resume", and only with a
  fixed permission policy — offer them as agents and workflow steps first.
- **ACP (Agent Client Protocol)** is the most promising common denominator:
  Gemini, Qwen and OpenCode speak it natively and community adapters exist for
  Claude Code and Codex. Writing one `ias/acp.js` adapter could cover three
  CLIs at once. **To verify:** maturity, permission round-trip, streaming
  granularity, resume.

---

## 4. Agents in tmux, per CLI

`coletor.js` finds agents by screen regex and reads state from hook events.
Plan: a per-CLI **profile** in the adapter, and `coletor.estado()` tries each
profile on each pane.

| CLI | Pane detection | Live state | Model shown | Permission answered from the app |
|---|---|---|---|---|
| Claude | `TELA_CLAUDE` regex (**verified**) + `#{pane_current_command}` = `claude` | hook `orq-evento.sh` → `.orq/eventos` (**verified**) | transcript grep (**verified**) | yes, `PermissionRequest` hook (**verified**) |
| Codex | `pane_current_command` = `codex`; TUI regex to capture | `notify` program in `~/.codex/config.toml` (turn complete) → write the same `.orq/eventos` line; hooks to verify | `~/.codex/sessions/*.jsonl` | to verify (screen only for now) |
| Gemini / Qwen | process is `node`: use the pane's child process cmdline (`ps -o args --ppid`); TUI regex to capture | hooks (recent Gemini CLI, to verify) → same file | session files under `~/.gemini` / `~/.qwen` (to verify) | to verify |
| OpenCode | `pane_current_command` = `opencode` | plugin (JS) subscribed to session/permission events → same file | from plugin event | plugin can answer permission events (to verify) |
| Cursor | `cursor-agent` | `hooks.json` (to verify) | to verify | to verify |
| Aider | `aider` (python) via cmdline | `--notifications-command` on "waiting for input" | `--model` from cmdline | no (y/n prompt on screen only) |

Key point: keep **one event file format** (`.orq/eventos/<session>.jsonl`,
same field names) and write a small bridge per CLI (`hooks/orq-evento-codex.sh`,
an OpenCode plugin, …) that maps that CLI's events to it. `coletor.js` stays
format-agnostic; `estadoPeloSinal` gains a few names. Screen-only detection
(`estadoPelaTela`) remains the fallback, with one regex set per CLI captured
from real screenshots (`tests/` fixtures).

---

## 5. Workflow step "Ask an AI"

Today: step type `claude` → `claude -p --model <m>` with the prompt on stdin.

Change:

- New step type `ia` ("Perguntar a uma IA"), fields: `ia` (select filled from
  `ias:listar`, only installed ones), `modelo` (from the adapter's `modelos()`),
  `prompt`. Keep type `claude` as an alias so saved workflows keep running.
- Adapter method `umaVez({ prompt, modelo })` → argv + stdin for a one-shot,
  **read-only** answer:

  | CLI | One-shot command (to verify except Claude) |
  |---|---|
  | Claude | `claude -p --model <m>` (stdin) **verified** |
  | Codex | `codex exec --sandbox read-only -m <m> -` |
  | Gemini | `gemini -p "<prompt>" -m <m>` (or stdin) |
  | OpenCode | `opencode run -m <p/m> "<prompt>"` |
  | Cursor | `cursor-agent -p -m <m> "<prompt>"` |
  | Aider | not offered (edits and commits files by design) |
  | Qwen | `qwen -p "<prompt>" -m <m>` |

- Same limits as today (`limite: 600000`, `ambienteLimpo()`), prompt via
  stdin when the CLI accepts it (avoids argv size limits and `ps` exposure).

---

## 6. Library (Repertório)

Already multi-tool (`repertorio.js` `FERRAMENTAS`). Remaining work:

- Add Qwen (`~/.qwen/commands`, TOML like Gemini — to verify) and Aider (none).
- The "send as `/name`" shortcut must ask the adapter whether the current
  chat's CLI knows that item (`adaptador.conhece(item)`); otherwise send the
  content inline, as is already done for other tools' skills.
- Shared `~/.agents/skills` stays the recommended place for skills meant for
  every CLI.

---

## 7. Phased roadmap

| Phase | Scope | Done when |
|---|---|---|
| **1 (done)** | `ias.js` detection, settings panel "IAs conectadas (CLI)", config keys `iaOrquestrador` / `iaAgentes`, fallback to Claude with a notice, tests `tests/unit/ias.test.js`, `tests/e2e/ias.e2e.js` | Panel lists the 7 CLIs with version/path; nothing else changes |
| 2 | Extract `ias/claude.js` from `conversa.js` behind the adapter interface; no behaviour change | Every existing `conversa` test passes untouched; `Conversa` has no `claude` string left |
| 3 | Workflow step `ia` with per-CLI one-shot (read-only) | A workflow can ask Codex/Gemini/OpenCode/Cursor/Qwen; old `claude` steps still run |
| 4 | First second orchestrator: an ACP adapter (Gemini/Qwen/OpenCode) **or** Codex `app-server`, whichever passes the permission round-trip check first; mark `suportado: true` | Orchestrator chat works with permissions, interrupt, resume, model switch |
| 5 | tmux agents per CLI: detection profiles + event bridges into `.orq/eventos` | Agents of each CLI appear with correct state; screen fallback for the rest |
| 6 | "Agentes novos usam" actually used when the orchestrator opens an agent (the `comandoInicial` round command and project scripts receive the chosen CLI) | A new agent starts on the configured CLI |

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Headless modes without per-call approval: an orchestrator that can run shell commands with no way to ask | Only mark `suportado` when the adapter has `permissoes: 'stdio'`; otherwise the CLI is limited to read-only sandbox / workflow steps |
| Protocol churn (flags and JSON shapes change between versions) | Adapter declares the minimum version it was tested with; `ias.js` already reads the version; fixtures recorded per version |
| Credentials: each CLI keeps its own login (API keys, OAuth files) | The app never reads, copies or prints them; detection only runs `--version` and keeps only the number (tested); env scrubbing per adapter |
| Orchestrator instructions are Claude slash commands/skills (`/orquestrar`, `/desligar`) | Ship the same instructions as `~/.agents/skills` + per-CLI equivalents (Codex prompts, Gemini/Qwen TOML commands, OpenCode commands); the Library already reads all of them |
| Transcripts/history in different places and formats | `historico()` per adapter; missing history = start fresh with a visible note, never fail |
| Aider edits and commits by default | Never offered as orchestrator or workflow step; agent mode only with explicit flags |
| Usage/limits not comparable (5 h / 7 d windows exist only for Claude) | UI hides what the adapter cannot report (`capacidades.uso`) |
| Parallel CLIs fighting for the same repo | Unchanged rule: one agent per project folder / worktree |

---

## 9. Tests

- **Unit, per adapter** (`tests/unit/ia-<id>.test.js`): feed recorded JSONL
  fixtures through `traduzir()` and assert the normalized events; assert
  `argumentos()` for new/resume/model/effort; assert `resposta()` and
  `interrupcao()` lines.
- **Contract test** shared by all adapters: same scenario (init → partial
  text → tool permission asked → allowed → turn end → resume) run against a
  fake CLI script that replays the fixture, exactly like `ias.test.js` fakes
  binaries on the PATH. A new adapter is "supported" only when it passes it.
- **E2E**: extend `tests/e2e/ias.e2e.js` pattern — fake CLIs first on PATH,
  `abrirApp({ config: { iaOrquestrador: '<id>' } })`, the chat shows partial
  text, a permission card, and `app.erros` stays `[]`.
- **tmux detection**: screen fixtures per CLI for `estadoPelaTela`, and event
  bridge scripts tested with sample hook payloads (like `orq-evento.sh`).
- **Manual smoke** (not in `npm test`): `ORQ_IA_REAL=codex npm test -- ia-real`
  runs one real turn against an installed CLI, opt-in only.
- Never touch real user files: temp homes (`casaTemporaria`, `abrirApp`) as today.

---

## 10. Open points to verify before phase 3/4

1. Codex: `exec --json` event names; `app-server` approval messages; resume with JSON output.
2. Gemini / Qwen: `stream-json` event names; ACP flag name and permission flow in the installed version; `--resume` availability.
3. OpenCode: `serve` permission events and how to answer them; `run --format json` shape.
4. Cursor CLI: approval behaviour in `-p`; usage fields in stream-json; hooks.
5. Aider: whether `--notifications-command` is enough for tmux state.
6. Which CLIs read prompts from stdin in headless mode (to keep prompts out of argv).
