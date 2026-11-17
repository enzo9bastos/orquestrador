// Área: conversa (pergunta rápida, o /btw: gaveta por cima da coluna da direita; plano 6.2)
// A pergunta rápida é uma pergunta sobre a conversa que o Claude responde sem entrar nela
// e sem parar o que está fazendo. Antes a resposta virava um cartão no meio da conversa,
// sem continuação e sem histórico. Agora mora numa gaveta sobre a coluna da direita: dá
// para perguntar de novo (o Claude relê as anteriores), parar, copiar e limpar; o que o
// Claude devolve como "sucesso" sem ser resposta (synthetic) aparece como erro.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { pastaTemporaria } = require('../temporarias');
const { abrirApp } = require('./app');

const CODEX_FALSO = path.join(__dirname, '..', 'unit', 'codex-falso.js');
const lerLog = (arq) => { try { return fs.readFileSync(arq, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const G = "document.getElementById('gaveta-lado')";
const ABERTA = `(() => { const g = ${G}; return !g.hidden && getComputedStyle(g).display !== 'none' && g.getClientRects().length > 0; })()`;
const TROCAS = `[...document.querySelectorAll('#gaveta-lado .troca')].map((a) => ({ pergunta: a.querySelector('.troca-pergunta').innerText, resposta: a.querySelector('.troca-resposta') ? a.querySelector('.troca-resposta').innerText.trim() : null, erro: a.dataset.erro || null, pendente: a.classList.contains('pendente') }))`;
const FOCO_NA_GAVETA = "document.activeElement === document.getElementById('gaveta-lado-texto')";
const FOCO_NA_CAIXA = "document.activeElement === document.getElementById('entrada')";
const caixaDe = (sel) => `(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.round(r.left), l: Math.round(r.width), y: Math.round(r.top), a: Math.round(r.height) }; })()`;

// Envia pela caixa da conversa, como quem digita e aperta Enter.
async function daCaixa(app, texto) {
  await app.avaliar(`(() => { const e = document.getElementById('entrada'); e.focus(); e.value = ${JSON.stringify(texto)}; e.dispatchEvent(new Event('input')); })()`);
  await app.tecla('Escape', 'Escape', 27); // fecha as sugestões do "/"
  await app.avaliar("document.getElementById('compositor').requestSubmit()");
}
// Escreve no campo da gaveta e aperta Enter de verdade.
async function naGaveta(app, texto) {
  await app.avaliar(`(() => { const e = document.getElementById('gaveta-lado-texto'); e.focus(); e.value = ${JSON.stringify(texto)}; e.dispatchEvent(new Event('input')); })()`);
  await app.tecla('Enter', 'Enter', 13);
}

test('pergunta rápida (/btw) na gaveta', async (t) => {
  const log = path.join(pastaTemporaria('orq-claude-falso-'), 'log.jsonl');
  process.env.CLAUDE_FALSO_LOG = log;
  const app = await abrirApp({ config: { mostrarBichinho: false } });
  t.after(() => { delete process.env.CLAUDE_FALSO_LOG; return app.fechar(); });
  await app.esperar('!!window.__orqTeste && !!window.orqLado');
  await app.avaliar("window.__copiado = []; Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async (x) => { window.__copiado.push(x); } })");
  const linhas = () => lerLog(log);
  const pedidos = () => linhas().filter((o) => o.type === 'control_request' && o.request && o.request.subtype === 'side_question');
  const trocas = () => app.avaliar(TROCAS);
  const respondidas = async () => (await trocas()).filter((x) => x.resposta).length;
  let painelAntes;

  await t.test('fechada no começo: não ocupa lugar nem aparece', async () => {
    assert.strictEqual(await app.avaliar(ABERTA), false);
    assert.strictEqual(await app.avaliar(`getComputedStyle(${G}).display`), 'none');
    assert.strictEqual(await app.avaliar("document.body.classList.contains('com-gaveta-lado')"), false);
    painelAntes = await app.avaliar(caixaDe('main.painel'));
  });

  await t.test('/btw com a pergunta: abre a gaveta e a resposta aparece nela, não na conversa', async () => {
    await daCaixa(app, '/btw qual o arquivo?');
    await app.esperar(ABERTA, 8000);
    await app.esperar(`(${TROCAS}).some((x) => x.resposta === 'resposta de lado para: qual o arquivo?')`, 8000);
    assert.deepStrictEqual(await trocas(), [{ pergunta: 'qual o arquivo?', resposta: 'resposta de lado para: qual o arquivo?', erro: null, pendente: false }]);
    assert.deepStrictEqual(pedidos().map((p) => p.request), [{ subtype: 'side_question', question: 'qual o arquivo?', history: [] }]);
    assert.ok(!linhas().some((o) => o.type === 'user'), 'a pergunta foi ao Claude como mensagem da conversa');
    assert.strictEqual(await app.avaliar("/qual o arquivo|resposta de lado/.test(document.getElementById('mensagens').innerText)"), false, 'a pergunta ou a resposta apareceu no meio da conversa');
    assert.strictEqual(await app.avaliar("document.getElementById('entrada').value"), '', 'o comando ficou na caixa');
    assert.ok(await app.avaliar(FOCO_NA_GAVETA), 'o teclado vai para o campo da gaveta, para continuar perguntando');
    assert.strictEqual(await app.avaliar("document.getElementById('gaveta-lado-conversa').textContent"), 'Orquestrador');
  });

  await t.test('a gaveta fica por cima da coluna da direita, com a mesma largura; a conversa não muda de tamanho', async () => {
    const g = await app.avaliar(caixaDe('#gaveta-lado'));
    const col = await app.avaliar(caixaDe('#coluna-demandas'));
    assert.deepStrictEqual(g, col);
    assert.ok(g.l >= 250, `largura ${g.l}`);
    assert.ok(await app.avaliar(`(() => { const r = ${G}.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!e && !!e.closest('#gaveta-lado'); })()`), 'a coluna ficou por cima da gaveta');
    assert.deepStrictEqual(await app.avaliar(caixaDe('main.painel')), painelAntes);
    // Nada passa da borda nem fica escondido atrás da nota.
    assert.ok(await app.avaliar(`${G}.scrollWidth <= ${G}.clientWidth`), 'a gaveta rola para o lado');
    assert.strictEqual(await app.visivel('#gaveta-lado-texto'), 'ok');
    assert.strictEqual(await app.visivel('#gaveta-lado-enviar'), 'ok');
    assert.strictEqual(await app.visivel('#gaveta-lado-fechar'), 'ok');
  });

  await t.test('pergunta seguinte, escrita na gaveta: o Claude recebe a anterior junto', async () => {
    await naGaveta(app, 'e a pasta?');
    await app.esperar(`(${TROCAS}).filter((x) => x.resposta).length === 2`, 8000);
    assert.strictEqual((await trocas())[1].resposta, 'resposta de lado para: e a pasta? (com 1 anterior)');
    assert.deepStrictEqual(pedidos()[1].request.history, [{ question: 'qual o arquivo?', response: 'resposta de lado para: qual o arquivo?' }]);
    assert.strictEqual(await app.avaliar("document.getElementById('gaveta-lado-texto').value"), '');
    assert.ok(await app.avaliar(FOCO_NA_GAVETA));
  });

  await t.test('resposta com marcação é desenhada (código, lista) e o Copiar leva o texto original', async () => {
    await naGaveta(app, 'responde com marcação');
    await app.esperar("!!document.querySelector('#gaveta-lado .troca:last-child .troca-resposta pre code')", 8000);
    assert.strictEqual(await app.avaliar("document.querySelectorAll('#gaveta-lado .troca:last-child .troca-resposta li').length"), 2);
    await app.avaliar("document.querySelector('#gaveta-lado .troca:last-child [data-copiar]').click()");
    await app.esperar('window.__copiado.length === 1');
    assert.strictEqual(await app.avaliar('window.__copiado[0]'), 'O arquivo é `config.json`.\n\n- fica na **raiz**\n- tem 3 chaves\n\n```sh\ncat config.json\n```');
    assert.strictEqual(await app.avaliar("document.querySelector('#gaveta-lado .troca:last-child [data-copiar]').textContent"), 'Copiado');
  });

  await t.test('aviso do Claude que volta como "sucesso" (sem ser resposta) aparece como erro, com o detalhe', async () => {
    await naGaveta(app, 'pergunta sintética');
    await app.esperar("!!document.querySelector('#gaveta-lado .troca[data-erro=sintetica]')", 8000);
    const ultima = (await trocas()).pop();
    assert.deepStrictEqual(ultima, { pergunta: 'pergunta sintética', resposta: null, erro: 'sintetica', pendente: false });
    const texto = await app.avaliar("document.querySelector('#gaveta-lado .troca[data-erro=sintetica] .troca-erro').innerText");
    assert.match(texto, /O Claude não respondeu a esta pergunta\./);
    assert.match(texto, /API error: Not logged in/);
    assert.strictEqual(await app.avaliar("document.querySelectorAll('#gaveta-lado .troca[data-erro=sintetica] [data-copiar]').length"), 0);
    // "Perguntar de novo" devolve a pergunta ao campo (não manda sozinho).
    await app.avaliar("document.querySelector('#gaveta-lado .troca[data-erro=sintetica] [data-de-novo]').click()");
    assert.strictEqual(await app.avaliar("document.getElementById('gaveta-lado-texto').value"), 'pergunta sintética');
    assert.strictEqual(pedidos().length, 4);
    await app.avaliar("(() => { const e = document.getElementById('gaveta-lado-texto'); e.value = ''; e.dispatchEvent(new Event('input')); })()");
  });

  await t.test('com o Claude trabalhando: a pergunta é respondida na hora, sem fila e sem interromper', async () => {
    await app.avaliar("window.orq.conversa.mandar('orquestrador', 'trabalha até parar')");
    await app.esperar("!document.getElementById('parar').hidden", 8000);
    const antes = await respondidas();
    await naGaveta(app, 'e agora?');
    await app.esperar(`(${TROCAS}).filter((x) => x.resposta).length === ${antes + 1}`, 8000);
    assert.strictEqual(await app.avaliar("document.getElementById('parar').hidden"), false, 'o Claude parou de trabalhar por causa da pergunta');
    assert.strictEqual(await app.avaliar("document.querySelectorAll('#mensagens .msg-fila').length"), 0, 'a pergunta foi para a fila de mensagens');
    assert.ok(!linhas().some((o) => o.type === 'control_request' && o.request.subtype === 'interrupt'));
  });

  await t.test('pergunta esperando: mostra "Pensando…", segura a próxima e o Parar desiste dela', async () => {
    await naGaveta(app, 'esta demora');
    await app.esperar("!!document.querySelector('#gaveta-lado .troca.pendente [data-parar]')", 8000);
    assert.match(await app.avaliar("document.querySelector('#gaveta-lado .troca.pendente .troca-estado').innerText"), /Pensando…/);
    assert.strictEqual(await app.avaliar("document.getElementById('gaveta-lado-enviar').disabled"), true);
    const n = pedidos().length;
    await naGaveta(app, 'outra no meio');
    await app.esperar("!document.getElementById('gaveta-lado-aviso').hidden");
    assert.strictEqual(await app.avaliar("document.getElementById('gaveta-lado-aviso').innerText"), 'Espere a resposta da pergunta anterior, ou pare ela.');
    assert.strictEqual(await app.avaliar("document.getElementById('gaveta-lado-texto').value"), 'outra no meio', 'o texto que não foi mandado sumiu do campo');
    assert.strictEqual(pedidos().length, n);
    await app.avaliar("document.querySelector('#gaveta-lado .troca.pendente [data-parar]').click()");
    await app.esperar("!!document.querySelector('#gaveta-lado .troca[data-erro=parada]')", 8000);
    assert.match(await app.avaliar("document.querySelector('#gaveta-lado .troca[data-erro=parada] .troca-erro').innerText"), /Você parou esta pergunta\./);
    const cancelou = linhas().filter((o) => o.type === 'control_cancel_request');
    assert.strictEqual(cancelou.length, 1);
    assert.strictEqual(cancelou[0].request_id, pedidos().pop().request_id);
    assert.strictEqual(await app.avaliar("document.getElementById('gaveta-lado-enviar').disabled"), false);
    await app.avaliar("(() => { const e = document.getElementById('gaveta-lado-texto'); e.value = ''; e.dispatchEvent(new Event('input')); })()");
  });

  await t.test('Esc com o teclado na gaveta fecha a gaveta e NÃO para o Claude; na caixa da conversa, o Esc continua parando', async () => {
    await app.avaliar("document.getElementById('gaveta-lado-texto').focus()");
    await app.tecla('Escape', 'Escape', 27);
    await app.esperar(`!(${ABERTA})`);
    assert.strictEqual(await app.avaliar(`getComputedStyle(${G}).display`), 'none');
    assert.ok(await app.avaliar(FOCO_NA_CAIXA), 'o teclado volta para a caixa da conversa');
    assert.strictEqual(await app.avaliar("document.getElementById('parar').hidden"), false, 'o Esc da gaveta parou o Claude');
    assert.ok(!linhas().some((o) => o.type === 'control_request' && o.request.subtype === 'interrupt'));
    // Reaberta, com o teclado de volta na caixa da conversa: o Esc é da conversa.
    await daCaixa(app, '/btw');
    await app.esperar(ABERTA);
    await app.avaliar("document.getElementById('entrada').focus()");
    await app.tecla('Escape', 'Escape', 27);
    await app.esperar("document.getElementById('parar').hidden", 8000);
    assert.ok(linhas().some((o) => o.type === 'control_request' && o.request.subtype === 'interrupt'));
    assert.strictEqual(await app.avaliar(ABERTA), true, 'a gaveta fechou com o Esc dado na conversa');
  });

  await t.test('/btw sozinho reabre a gaveta com as perguntas anteriores; o ✕ fecha', async () => {
    assert.strictEqual(await respondidas(), 4);
    assert.ok(await app.avaliar(`${G}.querySelector('.gaveta-vazio') === null`));
    await app.avaliar("document.getElementById('gaveta-lado-fechar').click()");
    await app.esperar(`!(${ABERTA})`);
    assert.ok(await app.avaliar(FOCO_NA_CAIXA));
    await daCaixa(app, '/btw');
    await app.esperar(ABERTA);
    await app.esperar(`(${TROCAS}).length === 6`);
    assert.ok(await app.avaliar(FOCO_NA_GAVETA));
    assert.ok(!linhas().some((o) => o.type === 'user' && /btw/.test(JSON.stringify(o.message.content))), 'o /btw foi ao Claude como mensagem');
    await app.avaliar("document.getElementById('gaveta-lado-fechar').click()");
  });

  await t.test('⋯ › Pergunta rápida abre a gaveta, com o teclado no campo dela', async () => {
    await app.avaliar("document.getElementById('chip-mais').click()");
    await app.esperar("!document.getElementById('menu-mais').hidden");
    await app.avaliar("document.querySelector('#menu-mais [data-acao=btw]').click()");
    await app.esperar(ABERTA);
    assert.ok(await app.avaliar(FOCO_NA_GAVETA));
    assert.strictEqual(await app.avaliar("document.getElementById('entrada').value"), '');
  });

  await t.test('outra conversa: a gaveta mostra as perguntas dela; voltando, as da primeira estão lá', async () => {
    const outra = await app.avaliar('window.orq.conversa.nova().then((id) => window.__orqTeste.trocar(id).then(() => id))');
    await app.esperar(`${G}.querySelector('.gaveta-vazio') !== null`);
    assert.deepStrictEqual(await trocas(), []);
    assert.match(await app.avaliar("document.getElementById('gaveta-lado-conversa').textContent"), /^Conversa \d+$/);
    assert.strictEqual(await app.avaliar("document.getElementById('gaveta-lado-limpar').hidden"), true);
    await naGaveta(app, 'só desta conversa');
    await app.esperar(`(${TROCAS}).some((x) => x.resposta === 'resposta de lado para: só desta conversa')`, 8000);
    await app.avaliar("window.__orqTeste.trocar('orquestrador')");
    await app.esperar(`(${TROCAS}).length === 6`);
    assert.ok(!(await trocas()).some((x) => /só desta conversa/.test(x.pergunta)));
    assert.strictEqual(await app.avaliar("document.getElementById('gaveta-lado-conversa').textContent"), 'Orquestrador');
    await app.avaliar(`window.orq.conversa.fechar(${JSON.stringify(outra)})`);
  });

  await t.test('Limpar pede confirmação no segundo clique; depois a pergunta nova vai sem as antigas', async () => {
    assert.strictEqual(await app.visivel('#gaveta-lado-limpar'), 'ok');
    await app.avaliar("document.getElementById('gaveta-lado-limpar').click()");
    assert.strictEqual(await app.avaliar("document.getElementById('gaveta-lado-limpar').textContent"), 'Limpar mesmo?');
    assert.strictEqual((await trocas()).length, 6, 'o primeiro clique já limpou');
    await app.avaliar("document.getElementById('gaveta-lado-limpar').click()");
    await app.esperar(`${G}.querySelector('.gaveta-vazio') !== null`);
    assert.deepStrictEqual(await trocas(), []);
    assert.strictEqual(await app.avaliar("document.getElementById('gaveta-lado-limpar').hidden"), true);
    assert.strictEqual(await app.avaliar("getComputedStyle(document.getElementById('gaveta-lado-limpar')).display"), 'none');
    await naGaveta(app, 'depois de limpar');
    await app.esperar(`(${TROCAS}).some((x) => x.resposta === 'resposta de lado para: depois de limpar')`, 8000);
    assert.deepStrictEqual(pedidos().pop().request.history, []);
  });

  await t.test('coluna da direita recolhida: a gaveta aberta guarda o lugar da coluna; fechada, o lugar volta para a conversa', async () => {
    const aberto = await app.avaliar(caixaDe('#gaveta-lado'));
    await app.avaliar("window.orqColunas.definir('demandas', false)");
    await app.esperar("document.body.classList.contains('sem-demandas')");
    await app.esperar(`(${caixaDe('#gaveta-lado')}).l === ${aberto.l}`, 3000);
    assert.strictEqual(await app.visivel('#gaveta-lado-texto'), 'ok');
    // A coluna some um instante depois de recolhida (a transição dela) e continua sumida debaixo da gaveta.
    await app.esperar("getComputedStyle(document.getElementById('coluna-demandas')).visibility === 'hidden'", 3000);
    const comGaveta = await app.avaliar(caixaDe('main.painel'));
    await app.avaliar("document.getElementById('gaveta-lado-fechar').click()");
    // A conversa ganha de volta a largura da coluna (1 px de folga: as larguras são frações de ponto).
    await app.esperar(`Math.abs((${caixaDe('main.painel')}).l - ${comGaveta.l + aberto.l}) <= 1`, 3000);
    assert.strictEqual(await app.avaliar(`getComputedStyle(${G}).display`), 'none');
    await app.avaliar("window.orqColunas.definir('demandas', true)");
    await app.esperar("!document.body.classList.contains('sem-demandas')");
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});

test('pergunta rápida em inglês', async (t) => {
  process.env.CLAUDE_FALSO_LOG = path.join(pastaTemporaria('orq-claude-falso-'), 'log.jsonl');
  const app = await abrirApp({ config: { idioma: 'en', mostrarBichinho: false } });
  t.after(() => { delete process.env.CLAUDE_FALSO_LOG; return app.fechar(); });
  await app.esperar('!!window.__orqTeste && !!window.orqLado');

  await t.test('a gaveta vem em inglês; a pergunta e a resposta ficam como vieram', async () => {
    await daCaixa(app, '/btw pergunta sintética');
    await app.esperar(ABERTA, 8000);
    await app.esperar("!!document.querySelector('#gaveta-lado .troca[data-erro=sintetica]')", 8000);
    assert.strictEqual(await app.avaliar("document.querySelector('#gaveta-lado .gaveta-cabeca strong').innerText"), 'Quick question');
    assert.match(await app.avaliar("document.getElementById('gaveta-lado-nota').innerText"), /^Ask about this conversation without interrupting Claude\./);
    assert.strictEqual(await app.avaliar("document.getElementById('gaveta-lado-texto').placeholder"), 'Ask without interrupting…');
    assert.strictEqual(await app.avaliar("document.getElementById('gaveta-lado-enviar').innerText"), 'Ask');
    assert.match(await app.avaliar("document.querySelector('#gaveta-lado .troca-erro').innerText"), /Claude did not answer this question\./);
    assert.strictEqual(await app.avaliar("document.querySelector('#gaveta-lado [data-de-novo]').innerText"), 'Ask again');
    assert.strictEqual(await app.avaliar("document.querySelector('#gaveta-lado .troca-pergunta').innerText"), 'pergunta sintética');
    await naGaveta(app, 'qual o arquivo?');
    await app.esperar(`(${TROCAS}).some((x) => x.resposta === 'resposta de lado para: qual o arquivo?')`, 8000);
    assert.strictEqual(await app.avaliar("document.querySelector('#gaveta-lado [data-copiar]').innerText"), 'Copy');
    assert.strictEqual(await app.avaliar("document.getElementById('gaveta-lado-limpar').innerText"), 'Clear');
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});

test('pergunta rápida numa conversa do Codex: o comando continua sendo o do Codex', async (t) => {
  process.env.CODEX_FALSO_LOG = path.join(pastaTemporaria('orq-codex-falso-'), 'log.jsonl');
  const app = await abrirApp({ config: { iaOrquestrador: 'codex', iasCaminhos: { codex: CODEX_FALSO }, mostrarBichinho: false } });
  t.after(() => { delete process.env.CODEX_FALSO_LOG; return app.fechar(); });
  await app.esperar('!!window.__orqTeste && !!window.orqLado');

  await t.test('⋯ › Pergunta rápida deixa o /btw pronto na caixa (como antes) e a gaveta do Claude não abre', async () => {
    await app.avaliar("document.getElementById('chip-mais').click()");
    await app.esperar("!document.getElementById('menu-mais').hidden");
    await app.avaliar("document.querySelector('#menu-mais [data-acao=btw]').click()");
    assert.strictEqual(await app.avaliar("document.getElementById('entrada').value"), '/btw ');
    assert.ok(await app.avaliar(FOCO_NA_CAIXA));
    assert.strictEqual(await app.avaliar(ABERTA), false);
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
