# Security

This app drives AI agents that can run commands on your machine. Read this before you install it.

## Reporting a problem

Please report security issues privately through GitHub's **Report a vulnerability** (Security tab) instead
of opening a public issue.

## What runs with which power

| Part | Runs as | What it can do |
|---|---|---|
| Orchestrator conversation | `claude` in `--permission-mode auto`, from your home folder | Reads, writes and runs commands; Claude Code's auto-mode classifier is the only gate. Anything it reads (web pages, files, workflow output, agent requests) can try to steer it |
| Side conversations and terminals | your user | Same as above for conversations; terminals are plain shells |
| Agents | Claude Code in tmux, ideally inside a dev container | Whatever their own permission settings allow |
| Workflows | your user | `Command` steps run `bash -lc`; `Claude` steps run `claude -p`; folder triggers react to any file dropped in the watched folder |
| Desktop helper | separate Electron process | Can take a screenshot of an area **you** select (saved locally under `~/.cache/orq-app/`); talks to the app over a local socket (mode 600) |
| Browser tab | isolated `<webview>` partition, no preload, http/https only | A local control server on `127.0.0.1` with a random key (file mode 600) lets agents drive it |

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

## Known limits

- **Agent request bridge.** An agent can leave a script in `<project>/.orq/pedidos/` asking you to run it on
  the host. The app shows it to you and to the orchestrator; it never runs it on its own. Read it before
  running it: it comes from inside the container.
- **Permission hook (`hooks/orq-evento.sh`).** The app writes its answer to `<project>/.orq/respostas-perm/`.
  The hook only accepts it when that folder **and the hook file itself** are read-only for the agent (mount
  both read-only in the dev container, see the README); otherwise it ignores the app and the prompt stays in
  the terminal. This does not protect against an agent that can edit the project's `.claude/settings.json`:
  it could register a hook of its own that approves everything, app or no app. Mount that file read-only too.
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

No telemetry, no network calls of its own (only the AI CLIs you connect and the pages you open in the
Browser tab), no automatic updates.
