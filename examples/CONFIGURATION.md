# Configuration

File: `~/.config/orq-app/config.json`. Everything is optional; anything missing falls back to the
defaults in [`app/config.js`](../app/config.js). Most of it can also be changed from the gear menu
inside the app. A starting point: [`config.example.json`](config.example.json).

> The keys are in Portuguese, like the rest of the app.

## Appearance

| Key | Default | Meaning |
|---|---|---|
| `idioma` | `"pt-BR"` | Interface language: `"en"` or `"pt-BR"` |
| `tema` | `"dark"` | `"dark"` or `"light"` |
| `destaque` | `#8b5cf6` | Accent color, as `#rrggbb` |
| `mostrarBichinho` | `true` | Show the pixel helper inside the app |

## Projects and agents

| Key | Default | Meaning |
|---|---|---|
| `raizProjetos` | `~/projetos` | Folder that holds your projects |
| `niveis` | `1` | `1`: every folder in `raizProjetos` is a project. `2`: `<root>/<group>/<project>` |
| `ignorar` | `^[_.-]` | Regular expression; matching folders are left out |
| `linhaTarefa` | — | Regex with the named groups `numero`, `alvo` (`<group>/<project>` or `<project>`) and `tarefa`. The last line of `topicos.md` that matches tells what each agent is working on |
| `comandoOrdem` | — | Regex with the groups `acao` and `alvo`, applied to the commands the orchestrator runs; when it matches, the pixel helper announces the order |
| `rotuloContainer`, `pastaTranscript` | `devcontainer.local_folder`, `-workspace-{projeto}` | How to find a project's devcontainer and the transcript folder inside it, to show each agent's model |

## Orchestration round

| Key | Default | Meaning |
|---|---|---|
| `comandoInicial` | — | Sent to the orchestrator by the **Start** button (e.g. a skill of yours that runs a round). Empty: no button |
| `comandoDesligar` | — | Sent by the **Shut down** button. When it finishes, the app closes that session and the next round starts fresh. Empty: no button |

## Notes

| Key | Default | Meaning |
|---|---|---|
| `pastaNotas` | — | Folder with `topicos.md` and `diario/YYYY-MM-DD.md` (the orchestration notes) |
| `pastasNotas` | — | Folders the notes editor opens: `[{ "nome": "My notes", "caminho": "~/notes" }]`. Only `.md` files are shown; every save keeps the previous version in `~/.local/share/orq-app/versoes/` |

## Browser

| Key | Default | Meaning |
|---|---|---|
| `navegadorControle` | `true` | Let the orchestrator drive the browser windows through `orq-nav` (local only, with a key that changes on every launch). Takes effect on the next launch |
| `navegadorPorta` | `0` | Port of the local control server (`0` = any free port) |

## Everything else

| Key | Default | Meaning |
|---|---|---|
| `notificacoes` | both on | `{ "pedidos": true, "respostas": true }` — desktop notifications for questions and for finished answers |
| `ambiente` | `{}` | Extra environment variables for the app's conversations and terminals (e.g. telling your scripts they run inside the app) |

## Files the app writes

| Path | What |
|---|---|
| `~/.config/orq-app/workflows.json` | Your workflows (previous versions in `~/.local/share/orq-app/versoes/workflows/`) |
| `~/.config/orq-app/credenciais.json` | Credential **references** only — never values (mode 600) |
| `~/.config/orq-app/pet.json` | The pixel helper's outfit and preferences |
| `~/.config/orq-app/repertorio.json` | Your shortcuts in the skill library |
| `~/.cache/orq-app/` | Conversation list, workflow runs, the helper's socket |
