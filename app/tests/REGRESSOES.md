# Regressões: cada bug vira um teste

Regra: todo bug consertado ganha um teste que falha com o bug e passa com o
conserto, e entra nesta tabela. `npm test` roda tudo; `npm test -- <área>`
roda só uma área (`config`, `coletor`, `notas`, `permissoes`, `limpeza`,
`janela`, `terminais`, `conversa`).

| Data | Bug | Teste |
|---|---|---|
| 2026-10-28 | Título do pane com lixo do protocolo kitty (`Gi=31,…;AAAA`) virava o nome do agente | `unit/coletor.test.js` › regressão: nome do agente |
| 2026-10-28 | Topo inteiro arrastável: no Wayland o X e o Exit não recebiam clique | `e2e/janela.e2e.js` › regressão: nenhum botão do topo… |
| 2026-10-28 | Regra CSS antiga `.terminal` cobria a grade de terminais | `e2e/terminais.e2e.js` › regressão: os 3 terminais… |
| 2026-10-28 | Eco do Claude do comando mandado virava um segundo balão | `e2e/conversa.e2e.js` › regressão: eco… |
| 2026-10-28 | Classe `.resposta` do painel desenhava caixa em volta do texto do Claude | `e2e/conversa.e2e.js` › regressão: texto do Claude sem caixa |
| 2026-10-29 | Com 4 opções, 3 ficavam numa linha e 1 sobrava embaixo | `e2e/conversa.e2e.js` › regressão: opções uma por linha |
| 2026-10-29 | Escrever em "Outra resposta" deixava a opção marcada (duas respostas na tela) | `e2e/conversa.e2e.js` › regressão: escrever em Outra… |
| 2026-10-29 | Abas do painel quebravam em duas linhas em janela estreita | `e2e/janela.e2e.js` › regressão: abas nunca quebram |
| 2026-10-29 | Gancho de teste usava `pedidos` antes de existir e derrubava o script da conversa (só no modo de teste) | `e2e/janela.e2e.js` › a tela abre sem nenhum erro de script |
| 2026-10-29 | Não dava para copiar texto do terminal | `e2e/terminais.e2e.js` › regressão: Ctrl+Shift+C copia |
| 2026-10-29 | Não dava para mandar imagem na conversa | `e2e/conversa.e2e.js` › regressão: imagem colada… |
| 2026-10-29 | Agente trabalhando aparecia como "espera você" (só "esc to interrupt" contava) | `unit/coletor.test.js` › regressão: estado pela tela… |
| 2026-10-29 | Botão Desligar sumia depois de mexer na engrenagem (resposta parcial trocava a configuração inteira) | `e2e/conversa.e2e.js` › regressão: botão Desligar continua… |
| 2026-10-29 | Imagem colada sumia em silêncio quando a ponte do app era antiga (só o texto ia) | `e2e/conversa.e2e.js` › regressão: imagem colada… (envio com ponte nova) |
| 2026-10-29 | Menu de modelo abria por baixo da conversa (a barra cortava o que saía dela) | `e2e/menus.e2e.js` › regressão: menu de modelo… |
| 2026-10-29 | Chip da pasta mostrava o caminho embaralhado (direction: rtl) | `e2e/menus.e2e.js` › regressão: chip da pasta… |
| 2026-10-29 | Bichinho ficava por cima da lista de comandos (/) | `e2e/menus.e2e.js` › lista de comandos aparece inteira |
| 2026-10-29 | Não dava para responder uma pergunta com print | `e2e/conversa.e2e.js` › regressão: print colada na pergunta… |
| 2026-10-29 | Ctrl+Shift+V no terminal colava duas vezes | `e2e/terminais.e2e.js` › regressão: Ctrl+Shift+V não cola duas vezes |
| 2026-10-29 | Menu / das notas não rolava junto com as setas do teclado | `e2e/notas.e2e.js` › regressão: menu / rola junto… |
| 2026-10-29 | Agente trabalhando aparecia como parado quando a dica do Claude empurrava o contador para fora da leitura | `unit/coletor.test.js` › regressão: contador com dica embaixo… |
| 2026-10-30 | Bichinho virado (espelhado) olhava para o lado oposto ao do mouse | `e2e/pet.e2e.js` › regressão: virado, os olhos continuam indo para o lado certo |
| 2026-10-30 | Bloco de código com linha comprida: os botões Copiar/▶ Terminal rolavam junto e ficavam em cima do texto | `e2e/conversa.e2e.js` › regressão: botões do bloco de código ficam no canto, sem rolagem lateral |
| 2026-10-30 | Bichinho "voando" acima da caixa de escrever (o chão era o fim da área de mensagens) | `e2e/pet.e2e.js` › regressão: pisa em cima da caixa de escrever, sem flutuar |
| 2026-11-10 | Ajudante fora do app: quem voa caía para o chão quando a conversa ou a pergunta fechava, e esperava a 60 px do chão, no mesmo lugar de quem anda | `e2e/pet.e2e.js` › fantasma: depois que a conversa fecha, continua voando onde estava; fantasma/nuvem/passarinho: … espera voando, alto (não no chão) |
| 2026-11-11 | Nome de arquivo sem o caminho inteiro (ex.: o vídeo "em Downloads") não era clicável na conversa | `e2e/conversa.e2e.js` › nome de arquivo sem caminho vira clicável e é achado |
| 2026-11-12 | Demanda no cartão resumido não tinha como ser concluída pelo próprio cartão (só abrindo a nota) | `e2e/demandas.e2e.js` › ✓ no cartão conclui em dois cliques, avisa o que falta e não abre a nota |
| 2026-11-12 | Agente sumia da lista "Agentes" enquanto o orquestrador digitava uma demanda longa na caixa dele (o fim da tela virava só o texto) e voltava quando começava a trabalhar | `unit/coletor.test.js` › regressão: agente não some enquanto a demanda é digitada na caixa dele |
| 2026-11-12 | Menu do Codex ("› 1. Trust and continue") aparecia como agente esperando, e não pedindo a resposta do usuário | `unit/coletor.test.js` › regressão: menu do Codex conta como pedindo resposta |
| 2026-11-12 | Pedido: relógio de intervalo só no expediente (janela de/até, dias úteis) e diário que passou com o PC desligado rodando ao abrir | `unit/workflows.test.js` › relógio de intervalo respeita a janela do expediente…; diário que passou com o PC desligado roda ao abrir… |
| 2026-11-12 | Pedido: passo "Perguntar a uma IA" pela assinatura (Claude ou Codex só leitura) ou pela API (Anthropic com o SDK, OpenAI), com a chave mascarada; passo antigo continua no Claude | `unit/workflows.test.js` › Perguntar a uma IA…(4 testes); `e2e/workflows.e2e.js` › ajustes novos… |
| 2026-11-12 | Pedido: passo "Requisição HTTP" com credencial em $VARIAVEL, que nunca aparece na saída guardada | `unit/workflows.test.js` › Requisição HTTP…; `e2e/workflows.e2e.js` › ajustes novos… |
