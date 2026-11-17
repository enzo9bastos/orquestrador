// Área: conversa ("!" da caixa: rodar um comando seu; plano 4.2)
// "!comando" digitado na caixa e enviado com o Enter de verdade roda no computador,
// na pasta da conversa, e aparece como "Você rodou". O mesmo texto que chega por
// qualquer outro caminho (envio feito por código, recado, pedido do app) vai ao
// motor como texto comum e não roda nada. Comando com várias linhas pede confirmação.
// O recurso vem DESLIGADO: sem ligar em Configurações › Avançado, um texto começando com
// "!" é só uma mensagem, como sempre foi.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pastaTemporaria } = require('../temporarias');
const { abrirApp } = require('./app');

const linhas = (arq) => { try { return fs.readFileSync(arq, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };

test('"!" da caixa', async (t) => {
  const log = path.join(pastaTemporaria('orq-claude-falso-'), 'log.jsonl');
  process.env.CLAUDE_FALSO_LOG = log;
  const app = await abrirApp({ config: { mostrarBichinho: false, comandoNaCaixa: true } });
  t.after(() => { delete process.env.CLAUDE_FALSO_LOG; return app.fechar(); });
  await app.esperar('!!window.__orqTeste');
  const aoClaude = () => linhas(log).filter((o) => o.type === 'user').map((o) => (typeof o.message.content === 'string' ? o.message.content : JSON.stringify(o.message.content)));
  const existe = (nome) => fs.existsSync(path.join(app.casa, nome));
  // Digitado de verdade (o app só aceita o "!" que a própria pessoa pôs na caixa).
  const digitar = async (texto) => {
    await app.avaliar("(() => { const e = document.getElementById('entrada'); e.focus(); e.value = ''; e.setSelectionRange(0, 0); e.dispatchEvent(new Event('input', { bubbles: true })); })()");
    if (texto) await app.texto(texto);
  };
  // Posto na caixa por código, como faz um atalho ou o repertório.
  const porCodigo = (texto) => app.avaliar(`(() => { const e = document.getElementById('entrada'); e.focus(); e.value = ${JSON.stringify(texto)}; e.setSelectionRange(e.value.length, e.value.length); e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const enter = () => app.tecla('Enter', 'Enter', 13); // tecla de verdade (confiável)
  const blocos = "[...document.querySelectorAll('#mensagens .msg-shell')]";
  const ultimo = `${blocos}.pop()`;
  const clicarDeVerdade = async (seletor) => {
    const r = await app.avaliar(`(() => { const b = document.querySelector(${JSON.stringify(seletor)}).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
    await app.mouse('mousePressed', r.x, r.y); await app.mouse('mouseReleased', r.x, r.y);
  };
  await app.avaliar("window.orq.conversa.mandar('orquestrador', 'oi')");
  await app.esperar("[...document.querySelectorAll('#mensagens .texto-claude')].length > 0 && document.getElementById('parar').hidden", 10000);

  await t.test('"!" no começo põe a caixa no modo de comando e a dica diz onde ele roda', async () => {
    assert.match(await app.avaliar("document.getElementById('dicas-caixa').innerText"), /! rodar comando/, 'ligado, a dica do "!" aparece sob a caixa');
    await digitar('!echo oi');
    assert.strictEqual(await app.avaliar("document.querySelector('.caixa-entrada').classList.contains('modo-shell')"), true);
    assert.match(await app.avaliar("document.getElementById('dica-enter').innerText"), /roda no seu computador/);
    await digitar('echo oi');
    assert.strictEqual(await app.avaliar("document.querySelector('.caixa-entrada').classList.contains('modo-shell')"), false);
  });

  await t.test('Enter de verdade roda: bloco "Você rodou" com o comando e a saída; nada vai ao Claude', async () => {
    const antes = aoClaude().length;
    await digitar('!echo linha-de-saida; echo ok > marca-shell.txt');
    await enter();
    await app.esperar(`${blocos}.length === 1 && ${ultimo}.dataset.estado === 'fim'`, 8000);
    const texto = await app.avaliar(`${ultimo}.innerText`);
    assert.match(texto, /Você rodou/);
    assert.match(texto, /echo linha-de-saida; echo ok > marca-shell\.txt/);
    assert.match(texto, /linha-de-saida/);
    assert.ok(existe('marca-shell.txt'), 'rodou na pasta da conversa');
    assert.strictEqual(await app.avaliar("document.getElementById('entrada').value"), '', 'a caixa esvazia');
    await app.espera(300);
    assert.strictEqual(aoClaude().length, antes, 'o Claude não recebeu nada');
    assert.strictEqual(await app.avaliar("document.querySelectorAll('#mensagens .msg-voce').length"), 1, 'sem balão de mensagem para o comando');
  });

  await t.test('a saída vai ao Claude junto com a próxima mensagem; o balão mostra só o que foi escrito', async () => {
    await digitar('e agora?');
    await enter();
    await app.esperar("[...document.querySelectorAll('#mensagens .msg-voce .balao')].some((b) => b.textContent === 'e agora?')", 8000);
    for (let i = 0; i < 40 && !aoClaude().some((x) => x.endsWith('e agora?')); i++) await app.espera(100);
    const foi = aoClaude().find((x) => x.endsWith('e agora?'));
    assert.match(foi, /^<bash-input>echo linha-de-saida; echo ok > marca-shell\.txt<\/bash-input>\n<bash-stdout>linha-de-saida<\/bash-stdout>/);
    await app.esperar("document.getElementById('parar').hidden", 8000);
  });

  await t.test('texto que não foi a pessoa que pôs na caixa (atalho, repertório) não vira comando, nem com o Enter dela', async () => {
    await porCodigo('!echo x > nao-pode-0.txt');
    assert.strictEqual(await app.avaliar("document.querySelector('.caixa-entrada').classList.contains('modo-shell')"), false, 'a caixa não entra no modo de comando');
    await enter();
    for (let i = 0; i < 40 && !aoClaude().includes('!echo x > nao-pode-0.txt'); i++) await app.espera(100);
    assert.ok(aoClaude().includes('!echo x > nao-pode-0.txt'), 'foi ao Claude como texto');
    await app.espera(300);
    assert.ok(!existe('nao-pode-0.txt'));
    await app.esperar("document.getElementById('parar').hidden", 8000);
    // Atalho com tecla que escreve na caixa: mesmo caminho.
    await app.avaliar("window.orqConversa.inserir('!echo x > nao-pode-4.txt')");
    await enter();
    for (let i = 0; i < 40 && !aoClaude().some((x) => x.includes('nao-pode-4.txt')); i++) await app.espera(100);
    await app.espera(300);
    assert.ok(!existe('nao-pode-4.txt'));
    await app.esperar("document.getElementById('parar').hidden", 8000);
  });

  await t.test('seta para cima traz de volta um comando que a pessoa já rodou, e ele roda de novo', async () => {
    await digitar('');
    // Sobe pelos textos já enviados (os últimos foram mensagens comuns) até chegar no comando.
    let naCaixa = '';
    for (let i = 0; i < 8 && !naCaixa.startsWith('!echo linha-de-saida'); i++) {
      await app.tecla('ArrowUp', 'ArrowUp', 38);
      naCaixa = await app.avaliar("document.getElementById('entrada').value");
      // Um "!texto" que foi como mensagem (não rodou) volta como texto, sem o modo de comando.
      if (naCaixa.includes('nao-pode')) assert.strictEqual(await app.avaliar("document.querySelector('.caixa-entrada').classList.contains('modo-shell')"), false, naCaixa);
    }
    assert.strictEqual(naCaixa, '!echo linha-de-saida; echo ok > marca-shell.txt');
    assert.strictEqual(await app.avaliar("document.querySelector('.caixa-entrada').classList.contains('modo-shell')"), true);
    fs.renameSync(path.join(app.casa, 'marca-shell.txt'), path.join(app.casa, 'marca-shell-antiga.txt'));
    const antes = await app.avaliar(`${blocos}.length`);
    await enter();
    await app.esperar(`${blocos}.length === ${antes} + 1 && ${ultimo}.dataset.estado === 'fim'`, 8000);
    assert.ok(existe('marca-shell.txt'), 'rodou de novo');
  });

  await t.test('o mesmo texto enviado por código (sem o Enter de verdade) vai como texto e não roda', async () => {
    await digitar('!echo x > nao-pode-1.txt');
    await app.avaliar("document.getElementById('compositor').requestSubmit()");
    // (Vai com a saída do comando rodado logo antes na frente: por isso "termina com".)
    for (let i = 0; i < 40 && !aoClaude().some((x) => x.endsWith('!echo x > nao-pode-1.txt')); i++) await app.espera(100);
    assert.ok(aoClaude().some((x) => x.endsWith('!echo x > nao-pode-1.txt')), 'foi ao Claude como texto');
    await app.esperar("document.getElementById('parar').hidden", 8000);
    await app.avaliar("window.orq.conversa.mandar('orquestrador', '!echo x > nao-pode-2.txt')");
    for (let i = 0; i < 40 && !aoClaude().includes('!echo x > nao-pode-2.txt'); i++) await app.espera(100);
    await app.avaliar("window.orq.conversa.daCaixa('orquestrador', '!echo x > nao-pode-3.txt')");
    for (let i = 0; i < 40 && !aoClaude().includes('!echo x > nao-pode-3.txt'); i++) await app.espera(100);
    await app.espera(400);
    assert.deepStrictEqual([existe('nao-pode-1.txt'), existe('nao-pode-2.txt'), existe('nao-pode-3.txt')], [false, false, false]);
    assert.strictEqual(await app.avaliar(`${blocos}.length`), 2, 'nenhum bloco novo de comando');
    await app.esperar("document.getElementById('parar').hidden", 8000);
  });

  await t.test('comando com várias linhas pede confirmação: Cancelar não roda, Rodar roda', async () => {
    await digitar('!echo um > varias-1.txt\necho dois > varias-2.txt');
    await enter();
    await app.esperar("!!document.querySelector('#mensagens .confirma-shell')", 4000);
    assert.match(await app.avaliar("document.querySelector('#mensagens .confirma-shell').innerText"), /2 linhas/);
    assert.ok(!existe('varias-1.txt'), 'ainda não rodou');
    await clicarDeVerdade('#mensagens .confirma-shell [data-cancelar]');
    await app.esperar("!document.querySelector('#mensagens .confirma-shell')", 4000);
    await app.espera(300);
    assert.ok(!existe('varias-1.txt'));
    assert.strictEqual(await app.avaliar("document.getElementById('entrada').value"), '!echo um > varias-1.txt\necho dois > varias-2.txt', 'o texto volta para a caixa');
    await enter();
    await app.esperar("!!document.querySelector('#mensagens .confirma-shell')", 4000);
    // Clique feito por código não vale; só o clique de verdade.
    await app.avaliar("document.querySelector('#mensagens .confirma-shell [data-rodar]').click()");
    await app.espera(400);
    assert.ok(!existe('varias-1.txt'), 'clique por código não roda');
    await clicarDeVerdade('#mensagens .confirma-shell [data-rodar]');
    await app.esperar(`${blocos}.length === 3 && ${ultimo}.dataset.estado === 'fim'`, 8000);
    assert.ok(existe('varias-1.txt') && existe('varias-2.txt'));
  });

  await t.test('código de saída diferente de zero aparece; "Parar" encerra um comando demorado', async () => {
    await digitar('!echo falhou >&2; exit 3');
    await enter();
    await app.esperar(`${blocos}.length === 4 && ${ultimo}.dataset.estado === 'fim'`, 8000);
    assert.match(await app.avaliar(`${ultimo}.innerText`), /falhou[\s\S]*código 3|código 3[\s\S]*falhou/);
    await digitar('!echo comecei; sleep 30');
    await enter();
    await app.esperar(`${blocos}.length === 5 && ${ultimo}.dataset.estado === 'rodando'`, 8000);
    await app.esperar(`!!${ultimo}.querySelector('[data-parar-shell]')`, 4000);
    await app.avaliar(`${ultimo}.querySelector('[data-parar-shell]').click()`);
    await app.esperar(`${ultimo}.dataset.estado === 'fim'`, 8000);
    assert.match(await app.avaliar(`${ultimo}.innerText`), /parado/i);
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});

test('"!" da caixa vem desligado: sem a opção, é só uma mensagem', async (t) => {
  const log = path.join(pastaTemporaria('orq-claude-falso-'), 'log.jsonl');
  process.env.CLAUDE_FALSO_LOG = log;
  const app = await abrirApp({ config: { mostrarBichinho: false } });
  t.after(() => { delete process.env.CLAUDE_FALSO_LOG; return app.fechar(); });
  await app.esperar('!!window.__orqTeste');
  const aoClaude = () => linhas(log).filter((o) => o.type === 'user').map((o) => (typeof o.message.content === 'string' ? o.message.content : JSON.stringify(o.message.content)));
  const existe = (nome) => fs.existsSync(path.join(app.casa, nome));
  await app.avaliar("window.orq.conversa.mandar('orquestrador', 'oi')");
  await app.esperar("[...document.querySelectorAll('#mensagens .texto-claude')].length > 0 && document.getElementById('parar').hidden", 10000);

  await t.test('a caixa não muda, a dica do "!" não aparece e o Enter manda o texto ao Claude', async () => {
    assert.ok(!/rodar comando/.test(await app.avaliar("document.getElementById('dicas-caixa').innerText")));
    await app.avaliar("(() => { const e = document.getElementById('entrada'); e.focus(); e.value = ''; e.setSelectionRange(0, 0); })()");
    await app.texto('!echo x > desligado.txt');
    assert.strictEqual(await app.avaliar("document.querySelector('.caixa-entrada').classList.contains('modo-shell')"), false);
    assert.match(await app.avaliar("document.getElementById('dica-enter').innerText"), /Enter\s*envia/);
    await app.tecla('Enter', 'Enter', 13);
    for (let i = 0; i < 40 && !aoClaude().includes('!echo x > desligado.txt'); i++) await app.espera(100);
    assert.ok(aoClaude().includes('!echo x > desligado.txt'), 'foi ao Claude como mensagem');
    await app.espera(300);
    assert.ok(!existe('desligado.txt'), 'nada rodou');
    assert.strictEqual(await app.avaliar("document.querySelectorAll('#mensagens .msg-shell').length"), 0);
  });

  await t.test('o caminho que roda comando recusa com a opção desligada, mesmo se for pedido direto', async () => {
    const r = await app.avaliar("window.orq.conversa.shell('orquestrador', 'echo x > desligado-2.txt')");
    assert.match(r.erro, /desligado nas Configurações/);
    await app.espera(300);
    assert.ok(!existe('desligado-2.txt'));
  });

  await t.test('ligar em Configurações › Avançado vale na hora', async () => {
    await app.avaliar("document.getElementById('abrir-config').click()");
    await app.esperar("!document.getElementById('config').hidden");
    await app.avaliar("document.querySelector('[data-secao-config=\"avancado\"]').click()");
    assert.strictEqual(await app.avaliar("document.querySelector('[data-cfg=\"comandoNaCaixa\"]').checked"), false, 'vem desligado');
    await app.avaliar("document.querySelector('[data-cfg=\"comandoNaCaixa\"]').click()");
    await app.esperar("/rodar comando/.test(document.getElementById('dicas-caixa').innerText)", 4000);
    await app.avaliar("document.getElementById('fechar-config').click()");
    await app.esperar("document.getElementById('config').hidden", 4000);
    await app.esperar("document.getElementById('parar').hidden", 8000);
    await app.avaliar("(() => { const e = document.getElementById('entrada'); e.focus(); e.value = ''; e.setSelectionRange(0, 0); })()");
    await app.texto('!echo x > ligado.txt');
    assert.strictEqual(await app.avaliar("document.querySelector('.caixa-entrada').classList.contains('modo-shell')"), true);
    await app.tecla('Enter', 'Enter', 13);
    await app.esperar("!!document.querySelector('#mensagens .msg-shell[data-estado=fim]')", 8000);
    assert.ok(existe('ligado.txt'));
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
