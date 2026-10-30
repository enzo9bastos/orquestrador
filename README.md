<div align="center">

# Orquestrador

**A desktop cockpit for running many Claude Code agents at once.**

Chat with an orchestrator Claude, watch every agent at a glance, answer what needs you from one queue,<br>
automate your machine with visual workflows — and meet the little pixel helper that lives on your desktop.

![Electron](https://img.shields.io/badge/Electron-45-47848F?logo=electron&logoColor=white)
![Platform](https://img.shields.io/badge/platform-Linux-FCC624?logo=linux&logoColor=black)
![Claude Code](https://img.shields.io/badge/built%20for-Claude%20Code-D97757)
![License](https://img.shields.io/badge/license-MIT-22a06b)
![Status](https://img.shields.io/badge/status-daily--driver%20prototype-8b5cf6)

<img src="docs/images/conversation.png" alt="The orchestrator conversation, with agents on the left and the pixel helper in the corner" width="900">

</div>

> [!NOTE]
> The interface is in **Portuguese** for now (it is used daily by a Portuguese-speaking team).
> The code, the configuration keys and the file names follow the same language. Contributions
> towards i18n are welcome.

## Why

Running several [Claude Code](https://claude.com/claude-code) agents in parallel quickly turns into
a wall of terminals. Orquestrador keeps the agents exactly where they already work — `tmux` sessions,
ideally inside devcontainers — and puts a calm shell on top: one place to talk to the orchestrator,
see who is doing what, and act on whatever is waiting for you. Closing the app never stops an agent.

## Features

| | |
|---|---|
| 💬 **Orchestrator chat** | Claude runs headless (`stream-json`, the Agent SDK protocol): bubbles, Markdown, collapsible tool calls, question cards, Allow/Deny for permissions, `/command` autocomplete, model and effort switcher. A **Start** button opens a round; **Shut down** closes it safely. |
| 🧭 **Agents at a glance** | Every agent with its state (working, waiting, asking permission), current task, progress and model. A queue gathers permissions and requests in one place. |
| 🖥️ **Terminals** | Up to 4 in a grid, including attached to an agent's own `tmux` session. |
| 📝 **Notes** | Notion-style Markdown editor (blocks, `/` menu, tasks, tables) over the folders you choose; autosaves and keeps versions. |
| 🧰 **Skill library** | Finds the skills, commands, sub-agents and prompts you created across Claude Code, Codex, Gemini CLI, OpenCode, Windsurf and Cursor. `//name` in the chat uses any of them. |
| 🌐 **Browser** | Up to 4 side-by-side windows, each as Chrome, Firefox, Edge or a phone (iPhone, Android). The orchestrator drives the same windows through `orq-nav` (open, read, click, type, screenshot) while you watch. |
| ⚡ **Workflows** | n8n-style visual automations — see below. |
| 👾 **Desktop helper** | The orchestrator as a pixel pet — see below. |
| 🎨 **Looks** | Light and dark themes, accent color of your choice. |

### ⚡ Workflows

<img src="docs/images/workflow-editor.png" alt="Workflow editor: a folder trigger feeding a command, Claude, and file and notification steps" width="900">

Draw automations as connected steps. The output of one step is the input of the next (`{{entrada}}`).

- **Triggers:** a clock (every N minutes, or daily at a time, weekdays only if you want), a manual button,
  or **a new file in a folder** (e.g. `*.pdf` in `~/Downloads`).
- **Steps:** send a message to the orchestrator (in the background, never as if you typed it), ask a
  separate Claude (Sonnet, Haiku or Opus), run a shell command, read / move / copy / write files,
  branch on a condition, show a desktop notification.
- **Credentials by reference only:** the app stores *where* a secret lives (a Bitwarden item, a file,
  an environment variable), never its value. It is read at run time, handed to the command as an
  environment variable and masked as `••••` in any saved output.
- **Safe with your files:** file steps never overwrite — an existing name gets `-2`, `-3`…
- **Canvas like n8n / Maestri:** middle-drag to pan, Ctrl+wheel to zoom, rubber-band selection,
  right-click menus, Ctrl+A / Ctrl+D / Delete, double-click a step to edit it.
- Every run is kept with each step's output; mention a workflow in the chat with `@workflow:name`.

<img src="docs/images/workflows-list.png" alt="Workflows, Credentials and Executions lists" width="900">

### 👾 The desktop helper

<img src="docs/images/wardrobe.png" alt="The wardrobe: 30 items and 8 colors" width="900">

The orchestrator in person: a pixel pet that thinks, types, gives orders to the agents, naps when you
are idle, dances, follows your mouse with its eyes and can be thrown around. It stands on top of
the things on screen (the input box, attachments, agent cards).

- **Leaves the app and walks your desktop** (a transparent X11 window, so it can move freely even on
  Wayland). It lives on every workspace and, when you switch, walks in from the side you came from.
- **Comes to tell you** when something new needs you and the app is not focused — after checking
  again that it is still pending.
- **Call it from anywhere** with <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Space</kbd> (`orq-pet`): chat
  right there, or **📷 crop a piece of your screen** and ask about it. Answers land in an "Ajudante"
  conversation in the app.
- **Wardrobe:** 30 items across 6 slots (hats, glasses, moustaches, ties, capes, a coffee mug…) and
  8 colors.

## Getting started

**Requirements:** Linux, Node.js 20+, `tmux`, and Claude Code (`claude`) on your `PATH`.

```bash
git clone https://github.com/enzo9bastos/orquestrador.git
cd orquestrador/app
npm install
npm run rebuild     # rebuilds node-pty for Electron
npm start
```

Optional command-line helpers live in `app/bin/` — link them somewhere on your `PATH`:

| Command | What it does |
|---|---|
| `orq-nav` | Lets the orchestrator (or you) drive the app's browser windows: `orq-nav abrir <url>`, `texto`, `elementos`, `clicar`, `digitar`, `print`… |
| `orq-pet` | Calls the desktop helper: `orq-pet chamar`, `print`, `passear`, `voltar`. Bind it to a key (the wardrobe can create the GNOME shortcut for you). |

## Configuration

Everything is optional and lives in `~/.config/orq-app/config.json`. Start from
[`examples/config.example.json`](examples/config.example.json); every key is explained in
[`examples/CONFIGURATION.md`](examples/CONFIGURATION.md).

| Key | Purpose |
|---|---|
| `raizProjetos`, `niveis` | Where your projects are: `<root>/<project>` or `<root>/<group>/<project>` |
| `pastasNotas` | Folders the notes editor opens: `[{"nome": "…", "caminho": "~/…"}]` |
| `comandoInicial`, `comandoDesligar` | Commands sent by the **Start** and **Shut down** buttons (e.g. your own skills) |
| `linhaTarefa`, `comandoOrdem` | Regular expressions that tell the app what each agent is working on |
| `ambiente` | Extra environment variables for the app's conversations and terminals |

### Signal hook (optional)

[`hooks/orq-evento.sh`](hooks/orq-evento.sh) is a Claude Code hook that records an agent's events in
`<project>/.orq/eventos/` and, while the app is open, routes permission prompts to the app's buttons
(with the app closed, the prompt stays in the terminal as usual). To enable it in a project, copy it
to `<project>/.orq/bin/` and register `SessionStart`, `UserPromptSubmit`, `PostToolUse`,
`Notification`, `Stop`, `SessionEnd` (timeout 10) and `PermissionRequest` (timeout 330) in the
project's `.claude/settings.json` with the command `"$CLAUDE_PROJECT_DIR"/.orq/bin/orq-evento.sh`.
Add `.orq/` to `.gitignore`.

## Project structure

```text
orquestrador/
├── app/                  Electron app
│   ├── main.js           main process: windows, IPC, notifications
│   ├── conversa.js       headless Claude conversations (stream-json)
│   ├── coletor.js        reads agent state from tmux and the signal hook
│   ├── workflows.js      workflow engine, clock, folder watcher, credentials
│   ├── navegador.js      browser windows and the orq-nav control server
│   ├── ajudante.js       bridge to the desktop helper process
│   ├── renderer/         the app's UI (HTML, CSS, one script per tab)
│   ├── pet/              the desktop helper's own window (separate X11 process)
│   ├── bin/              orq-nav and orq-pet command-line helpers
│   ├── icons/
│   └── tests/            unit/ (node:test) and e2e/ (drives the real app)
├── docs/images/          screenshots for this README
├── examples/             sample configuration and its guide
├── hooks/                optional Claude Code signal hook
└── scripts/              repository hygiene checks
```

## Tests

```bash
cd app
npm test                  # everything: unit + end-to-end
npm test -- workflows     # one area only (each test file declares its area)
npm test -- --so-unidade  # unit tests only, without opening the app
```

End-to-end tests launch the real app hidden, with a throwaway home directory, and talk to it through
the DevTools protocol — your real files are never touched. Every bug that was fixed gets a regression
test, listed in [`app/tests/REGRESSOES.md`](app/tests/REGRESSOES.md).

## Credits

- Colors inspired by the public brand guide of [Alethe](https://github.com/Kc1t/alethe-agents)
  (color values only; no code).
- Built with Electron, xterm.js, node-pty, marked, Tiptap and ProseMirror (MIT — the notes editor is
  bundled in `app/renderer/editor.bundle.js`), DOMPurify (Apache 2.0 / MPL 2.0) and the Inter font (OFL).
- Claude and Claude Code are trademarks of Anthropic. This project is not affiliated with Anthropic;
  the pixel helper is an original drawing.

## License

[MIT](LICENSE) © 2026 Enzo Bastos
