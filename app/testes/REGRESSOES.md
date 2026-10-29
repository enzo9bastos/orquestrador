# Regressões: cada bug vira um teste

Regra: todo bug consertado ganha um teste que falha com o bug e passa com o
conserto, e entra nesta tabela. `npm test` roda tudo; `npm test -- <área>`
roda só uma área (`config`, `coletor`, `notas`, `permissoes`, `limpeza`,
`janela`, `terminais`, `conversa`).

| Data | Bug | Teste |
|---|---|---|
| 2026-10-28 | Título do pane com lixo do protocolo kitty (`Gi=31,…;AAAA`) virava o nome do agente | `unidade/coletor.test.js` › regressão: nome do agente |
| 2026-10-28 | Topo inteiro arrastável: no Wayland o X e o Exit não recebiam clique | `tela/janela.e2e.js` › regressão: nenhum botão do topo… |
| 2026-10-28 | Regra CSS antiga `.terminal` cobria a grade de terminais | `tela/terminais.e2e.js` › regressão: os 3 terminais… |
| 2026-10-28 | Eco do Claude do comando mandado virava um segundo balão | `tela/conversa.e2e.js` › regressão: eco… |
| 2026-10-28 | Classe `.resposta` do painel desenhava caixa em volta do texto do Claude | `tela/conversa.e2e.js` › regressão: texto do Claude sem caixa |
| 2026-10-29 | Com 4 opções, 3 ficavam numa linha e 1 sobrava embaixo | `tela/conversa.e2e.js` › regressão: opções uma por linha |
| 2026-10-29 | Escrever em "Outra resposta" deixava a opção marcada (duas respostas na tela) | `tela/conversa.e2e.js` › regressão: escrever em Outra… |
| 2026-10-29 | Abas do painel quebravam em duas linhas em janela estreita | `tela/janela.e2e.js` › regressão: abas nunca quebram |
| 2026-10-29 | Gancho de teste usava `pedidos` antes de existir e derrubava o script da conversa (só no modo de teste) | `tela/janela.e2e.js` › a tela abre sem nenhum erro de script |
| 2026-10-29 | Não dava para copiar texto do terminal | `tela/terminais.e2e.js` › regressão: Ctrl+Shift+C copia |
| 2026-10-29 | Não dava para mandar imagem na conversa | `tela/conversa.e2e.js` › regressão: imagem colada… |
| 2026-10-29 | Agente trabalhando aparecia como "espera você" (só "esc to interrupt" contava) | `unidade/coletor.test.js` › regressão: estado pela tela… |
| 2026-10-29 | Botão Desligar sumia depois de mexer na engrenagem (resposta parcial trocava a configuração inteira) | `tela/conversa.e2e.js` › regressão: botão Desligar continua… |
| 2026-10-29 | Imagem colada sumia em silêncio quando a ponte do app era antiga (só o texto ia) | `tela/conversa.e2e.js` › regressão: imagem colada… (envio com ponte nova) |
| 2026-10-29 | Menu de modelo abria por baixo da conversa (a barra cortava o que saía dela) | `tela/menus.e2e.js` › regressão: menu de modelo… |
| 2026-10-29 | Chip da pasta mostrava o caminho embaralhado (direction: rtl) | `tela/menus.e2e.js` › regressão: chip da pasta… |
| 2026-10-29 | Bichinho ficava por cima da lista de comandos (/) | `tela/menus.e2e.js` › lista de comandos aparece inteira |
