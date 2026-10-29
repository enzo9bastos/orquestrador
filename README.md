# Orquestrador

Uma janela para conduzir vários agentes do [Claude Code](https://claude.com/claude-code)
ao mesmo tempo. Os agentes continuam onde já trabalham (sessões do `tmux`,
de preferência dentro de devcontainers). O Orquestrador é a casca por cima:
mostra o que cada um está fazendo, junta o que precisa de você num lugar só
e conversa com um Claude "orquestrador" que distribui o trabalho.

> **Estado:** protótipo em uso diário, testado só no Linux.

## O que tem

- **Conversa com o orquestrador**, sem tela de terminal: o Claude roda por
  trás (modo `stream-json`, o protocolo do Agent SDK). Balões, Markdown,
  ferramentas recolhidas, perguntas com botão, permissões com Permitir/Negar,
  autocompletar de `/comandos`, troca de modelo e esforço por um botão.
- **Várias conversas**: além do orquestrador, conversas avulsas na lateral.
- **Agentes na lateral**: estado (trabalhando, esperando, pedindo permissão),
  o que cada um está fazendo, o modelo que usa.
- **Precisa de você**: permissões e pedidos dos agentes numa fila com botão.
- **Terminais**: até 4 em grade, inclusive anexados à sessão de um agente.
- **Notas**: editor de Markdown no estilo Notion (blocos, `/` para inserir, tarefas,
  tabelas) sobre as pastas que você configurar; salva sozinho guardando versões.
- **O orquestrador em pessoa**: um bichinho em pixel art que pensa, trabalha,
  dá ordem aos agentes e pode ser arremessado com o mouse.
- Tema claro/escuro e cor de destaque configuráveis.

## Rodar

Precisa de Node.js 20+, `tmux` e o Claude Code (`claude`) no `PATH`.

```bash
cd app
npm install
npm run rebuild      # recompila o node-pty para o Electron
npm start
```

`ORQ_APP_TESTE=1 npm start` abre sem mandar o comando inicial ao orquestrador.

## Configurar

`~/.config/orq-app/config.json` (exemplo comentado em
[`exemplos/config-exemplo.json`](exemplos/config-exemplo.json) e
[`exemplos/CONFIGURACAO.md`](exemplos/CONFIGURACAO.md)):

| Chave | Para quê |
|---|---|
| `raizProjetos`, `niveis` | Onde estão os projetos: `<raiz>/<projeto>` ou `<raiz>/<grupo>/<projeto>` |
| `pastaNotas` | Pasta com `topicos.md` e `diario/AAAA-MM-DD.md` (notas da orquestração) |
| `pastasNotas` | Pastas que o editor de notas abre: `[{"nome": "…", "caminho": "~/…"}]` |
| `comandoInicial`, `comandoDesligar` | Comandos que abrem e encerram uma rodada (ex.: skills suas) |
| `linhaTarefa` | Expressão que acha, nos tópicos, o que cada agente está fazendo |
| `comandoOrdem` | Expressão que reconhece uma ordem dada a um agente |
| `ambiente` | Variáveis extras para as conversas e terminais do app |

## Hook de sinais (opcional)

`hooks/orq-evento.sh` é um hook do Claude Code que grava os eventos de um
agente em `<projeto>/.orq/eventos/` e, com o app aberto, leva o pedido de
permissão para o botão do app (app fechado: a pergunta fica no terminal, como
sempre). Para ligar num projeto, copie para `<projeto>/.orq/bin/` e registre
no `.claude/settings.json` do projeto os eventos `SessionStart`,
`UserPromptSubmit`, `PostToolUse`, `Notification`, `Stop`, `SessionEnd`
(timeout 10) e `PermissionRequest` (timeout 330) com o comando
`"$CLAUDE_PROJECT_DIR"/.orq/bin/orq-evento.sh`. Ponha `.orq/` no `.gitignore`.

## Créditos

- Cores inspiradas no guia de marca público do
  [Alethe](https://github.com/Kc1t/alethe-agents) (só os valores de cor;
  nenhum código).
- Electron, xterm.js, node-pty, marked, Tiptap e ProseMirror (MIT; o editor de notas
  é empacotado em `app/tela/editor.bundle.js`); DOMPurify (Apache 2.0 / MPL 2.0);
  fonte Inter (OFL).
- Claude e Claude Code são marcas da Anthropic. Este projeto não é afiliado a
  ela; o bichinho é um desenho próprio.

---

## English

**Orquestrador** is a desktop shell (Electron) for running several Claude Code
agents at once. Agents keep living in `tmux` (ideally inside devcontainers);
the app shows what each one is doing, gathers everything that needs you in one
queue, and gives you a chat with an "orchestrator" Claude that hands out the
work. UI is in Portuguese for now. MIT licensed.

## Licença

[MIT](LICENSE) © 2026 Enzo Bastos
