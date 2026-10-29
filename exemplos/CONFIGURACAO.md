# Configuração

Arquivo: `~/.config/orq-app/config.json`. Tudo é opcional; o que faltar usa o
padrão de `app/config.js`.

- **`raizProjetos`** (padrão `~/projetos`) e **`niveis`** (1 ou 2): com 1, cada
  pasta de `raizProjetos` é um projeto; com 2, `<raiz>/<grupo>/<projeto>`.
- **`ignorar`**: expressão regular; pastas que casam ficam de fora.
- **`pastaNotas`**: pasta com `topicos.md` e `diario/AAAA-MM-DD.md`, lidos na
  aba "Tópicos e diário". `null` deixa a aba vazia.
- **`pastasNotas`**: lista de pastas que a aba Notas abre, cada uma
  `{ "nome": "Minhas notas", "caminho": "~/notas" }`. Vazia, usa a
  `pastaNotas`. O editor mostra só arquivos `.md`; cada gravação guarda a versão
  anterior em `~/.local/share/orq-app/versoes/`.
- **`comandoInicial`**: mandado ao orquestrador na primeira abertura de uma
  rodada (por exemplo, uma skill sua que conduz a rodada).
- **`comandoDesligar`**: o comando que encerra a rodada. O botão "Desligar" só
  aparece se ele existir; quando o comando termina, o app fecha aquela sessão e
  a próxima abertura começa uma rodada nova.
- **`linhaTarefa`**: expressão com os grupos nomeados `numero`, `alvo`
  (`<grupo>/<projeto>` ou `<projeto>`) e `tarefa`. A última linha do
  `topicos.md` que casar diz o que cada agente está fazendo.
- **`comandoOrdem`**: expressão com os grupos `acao` e `alvo`, aplicada aos
  comandos que o orquestrador roda; quando casa, o bichinho anuncia a ordem.
- **`rotuloContainer`** e **`pastaTranscript`**: como achar o devcontainer de
  um projeto e a pasta de transcripts dentro dele, para mostrar o modelo de
  cada agente.
- **`ambiente`**: variáveis extras para as conversas e terminais do app (por
  exemplo, avisar seus scripts de que estão rodando dentro do app).
