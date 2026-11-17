# Security

This app drives AI agents that can run commands on your machine. Read this before you install it.

## Reporting a problem

Please report security issues privately through GitHub's **Report a vulnerability** (Security tab) instead
of opening a public issue.

## What runs with which power

| Part | Runs as | What it can do |
|---|---|---|
| Orchestrator conversation | `claude` in `--permission-mode auto`, from your home folder | Reads, writes and runs commands; Claude Code's auto-mode classifier is the only gate. Anything it reads (web pages, files, workflow output, agent requests) can try to steer it |
| Orchestrator conversation on Codex | `codex app-server` **outside the Codex sandbox** (`sandbox: 'danger-full-access'`), approval policy `untrusted`, with Codex's automatic reviewer (`approvalsReviewer: 'auto_review'`) | The orchestrator needs `tmux` and `docker`, which the Codex sandbox blocks even for an approved command. Read-only commands run directly; the reviewer decides the rest by risk, and a denial shows up in the conversation. **Fails closed:** if Codex refuses to open the conversation with this policy (an organization can restrict the allowed policies), the app does not open it, says why, and never retries with a looser policy |
| Side request to Codex (`orq-recado pedir … --motor codex`) | `codex exec --dangerously-bypass-approvals-and-sandbox` **inside a throwaway container** | Codex's own sandbox does not work inside a container, so it runs without approvals or sandbox there. The limits come from Docker: the container is removed at the end (`--rm`), uses the dev container's firewall, and mounts the project read-only unless you approved writing |
| Side conversations and terminals | your user | Same as above for conversations; terminals are plain shells |
| Side conversation in "no questions" mode (Bypass) | `claude` with `bypassPermissions`, **only if you turn on the option** in Settings (off by default) and pick the mode in that conversation | Claude edits files and runs commands without asking. The mode is never offered in the orchestrator conversation nor to the desktop helper; the app confirms every time, keeps a red strip on screen while it is on, and a restart goes back to `auto`. The process only starts with `--allow-dangerously-skip-permissions` (which makes the mode selectable, not active) in side conversations and while the option is on |
| Agents | Claude Code in tmux, ideally inside a dev container | Whatever their own permission settings allow |
| Workflows | your user | `Command` steps run `bash -lc`; `Claude` steps run `claude -p`; folder triggers react to any file dropped in the watched folder |
| Your own command from the message box (`!command`), **off by default** (Settings › Advanced) | your user, in the conversation's folder, with the conversations' environment (vault session and registered credentials removed) | Runs what **you** typed, as a terminal would. It reaches the shell only when you typed or pasted the `!` at the start of the box and sent it with a real Enter (a multi-line command also asks for a real click on *Run*). The same text arriving any other way (an agent's request, a workflow, a shortcut, the helper, text the app put in the box, the model) is sent as plain text and runs nothing. One command at a time, two-minute limit, *Stop* ends the whole process group, each output capped at 30,000 characters. The output goes to the model with your next typed message, escaped so it cannot pose as markup. On a Codex conversation the command goes through `thread/shellCommand`: Codex runs it, outside its sandbox |
| Detecting installed AI CLIs (Settings → *Connected AIs*) | your user, no shell | Runs each known CLI found on `PATH` with `--version` only and keeps just the version number. The generic name `agent` (Cursor's main shortcut) is run **only** when the real file behind it is `cursor-agent` inside Cursor's own install folder (`~/.local/share/cursor-agent/versions/<version>/`), checked before anything runs; any other `agent` is never executed |
| Desktop helper | separate Electron process | Can take a screenshot of an area **you** select (saved locally under `~/.cache/orq-app/`); talks to the app over a local socket (mode 600) |

## Secrets

- **Credentials are stored by reference only** (vault item, file path or variable name), never by value.
  The value is read when a workflow step runs, handed to that step as an environment variable and masked
  as `••••` in saved output, including base64, hex and URL-encoded forms. Values shorter than 4 characters
  are not masked.
- **The vault session (`BW_SESSION`, `BW_CLIENTID`, `BW_CLIENTSECRET`, `BW_PASSWORD`) and the variables
  registered as "environment variable" credentials are removed** from the environment of every conversation,
  terminal and workflow step. Only the step that picked a credential receives it. If you unlock your vault
  in the shell that starts the app, the app itself can read the vault; the agents cannot.
- Output masking is a safety net, not a guarantee: a command that transforms a secret in another way
  (encrypts, splits, prints one character per line) can still leak it into the run history
  (`~/.cache/orq-app/workflows-execucoes.json`).

## Flags that turn off approvals

No flag that turns off approvals or the sandbox (`--dangerously-*`, `--yolo`, `--force`, `bypassPermissions`,
`danger-full-access`, approval policy `never`) goes in silently. A test
(`app/tests/unit/higiene-flags.test.js`) scans the code that builds the AI command lines and fails on any such
flag outside a named list, where each exception says why. Today the list has the three rows above: the Codex
orchestrator outside the sandbox with `auto_review`, the Codex side request inside its container, and the
"no questions" mode of a side conversation, which only exists behind a Settings option that is off by default.

## Known limits

- **Agent request bridge.** An agent can leave a script in `<project>/.orq/pedidos/` asking you to run it on
  the host. The app shows it to you and to the orchestrator; it never runs it on its own. Read it before
  running it: it comes from inside the container.
- **Permission hook (`hooks/orq-evento.sh`).** The app writes its answer to `<project>/.orq/respostas-perm/`.
  The hook only accepts it when that folder **and the hook file itself** are read-only for the agent (mount
  both read-only in the dev container, see the README); otherwise it ignores the app and the prompt stays in
  the terminal. This does not protect against an agent that can edit the project's `.claude/settings.json`:
  it could register a hook of its own that approves everything, app or no app. Mount that file read-only too.
  The request file in `<project>/.orq/permissoes/` is writable by the agent, so the hook keeps the hash of the
  request it made and the app answers with the hash of what it showed you (frozen at first read; the id comes from
  the file name). If they differ, the hook decides nothing and the prompt stays in the terminal. Copy the hook
  again after updating the app: an older copy does not check the hash.
- **Symbolic links in `.orq/`.** The agent can replace anything in `<project>/.orq/` with a symbolic link. Every
  write the app makes in a project folder stays inside the project's real path, refuses a link in any part of
  the path and opens files with `O_NOFOLLOW`; a refused message shows the reason in the Messages tab.
- **Live reload.** When a file in `app/renderer/` changes, the window reloads by itself **only if that folder
  matches the last git commit** (which is how a published update arrives). A file changed or dropped there
  without a commit does not run on its own; without git there is no automatic reload. Anyone who can commit
  to the install folder, or edit `app/main.js`, still controls the app: keep it writable only by you.
- **Version history.** Every save of settings, topics, workflows and credentials references keeps the
  previous version under `~/.local/share/orq-app/versoes/`. Nothing prunes it; delete old files there
  when you want them gone.
- **Signal hook log.** The hook writes prompts and replies to `<project>/.orq/eventos/`. Add `.orq/` to the
  project's `.gitignore` so it is never committed.

## What the app does not do

No telemetry, no network calls of its own (only the AI CLIs you connect), no automatic updates.
