// Área: conversa (Ctrl+F: buscar na conversa; plano 6.3)
// A busca olha só as mensagens da conversa (não a lateral nem as outras abas),
// marca tudo o que achou, anda com Enter e Shift+Enter, e o Esc fecha a barra
// sem interromper o motor.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pastaTemporaria } = require('../temporarias');
const { abrirApp } = require('./app');

const linhas = (arq) => { try { return fs.readFileSync(arq, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };

test('Ctrl+F: buscar na conversa', async (t) => {
  const log = path.join(pastaTemporaria('orq-claude-falso-'), 'log.jsonl');
  process.env.CLAUDE_FALSO_LOG = log;
  const app = await abrirApp({ config: { mostrarBichinho: false } });
  t.after(() => { delete process.env.CLAUDE_FALSO_LOG; return app.fechar(); });
  await app.esperar('!!window.__orqTeste');
  const interrupcoes = () => linhas(log).filter((o) => o.type === 'control_request' && o.request && o.request.subtype === 'interrupt').length;
  const ctrlF = async () => {
    for (const type of ['keyDown', 'keyUp']) await app.cdp('Input.dispatchKeyEvent', { type, key: 'f', code: 'KeyF', windowsVirtualKeyCode: 70, modifiers: 2 });
  };
  const enter = async (shift = false) => {
    for (const type of ['keyDown', 'keyUp']) await app.cdp('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: shift ? 8 : 0 });
  };
  const esc = () => app.tecla('Escape', 'Escape', 27);
  const barra = "document.getElementById('busca-conversa')";
  const conta = "document.getElementById('busca-conversa-conta').textContent";
  const marcadas = "(CSS.highlights.get('busca-conversa') || { size: 0 }).size";
  const buscar = async (texto) => {
    await app.avaliar(`(() => { const c = document.getElementById('busca-conversa-texto'); c.focus(); c.value = ${JSON.stringify(texto)}; c.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await app.espera(350);
  };
  // Três respostas do Claude com a palavra, uma do usuário sem ela, e a palavra também na lateral.
  const fala = (texto) => `window.__orqTeste.desenharEvento({ tipo: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: ${JSON.stringify(texto)} }] } })`;
  await app.avaliar(fala('Vou criar a função de exportar em CSV.'));
  await app.avaliar("window.__orqTeste.desenharEvento({ tipo: 'user', local: true, message: { role: 'user', content: 'e os acentos?' } })");
  await app.avaliar(fala('O teste do Exportar cobre acentos.'));
  await app.avaliar(fala('Pronto: exportar passou nos três casos.'));

  await t.test('Ctrl+F abre a barra com o foco no campo dela', async () => {
    assert.strictEqual(await app.avaliar(`${barra}.hidden`), true, 'começa fechada');
    await app.avaliar("document.getElementById('entrada').focus()");
    await ctrlF();
    await app.esperar(`!${barra}.hidden`);
    assert.strictEqual(await app.avaliar('document.activeElement.id'), 'busca-conversa-texto');
  });

  await t.test('acha nas mensagens, sem diferenciar maiúscula, e diz quantas', async () => {
    await buscar('exportar');
    assert.strictEqual(await app.avaliar(conta), '1/3');
    assert.strictEqual(await app.avaliar(marcadas), 3);
    assert.strictEqual(await app.avaliar("(CSS.highlights.get('busca-conversa-atual') || { size: 0 }).size"), 1);
  });

  await t.test('Enter vai para a próxima, Shift+Enter volta, e dá a volta no fim', async () => {
    await enter(); assert.strictEqual(await app.avaliar(conta), '2/3');
    await enter(); await enter(); assert.strictEqual(await app.avaliar(conta), '1/3', 'depois da última volta à primeira');
    await enter(true); assert.strictEqual(await app.avaliar(conta), '3/3');
    assert.strictEqual(await app.avaliar('document.activeElement.id'), 'busca-conversa-texto', 'o foco fica no campo');
  });

  await t.test('só a conversa: o que está na lateral ou na barra não conta', async () => {
    // "Terminais" é o nome de uma aba: está na página, mas fora das mensagens.
    assert.ok(await app.avaliar("document.body.textContent.includes('Terminais') && !document.getElementById('mensagens').textContent.includes('Terminais')"));
    await buscar('Terminais');
    assert.strictEqual(await app.avaliar(conta), 'Nada encontrado');
    assert.strictEqual(await app.avaliar(marcadas), 0);
  });

  await t.test('mensagem nova entra na busca sem digitar de novo', async () => {
    await buscar('acentos');
    assert.strictEqual(await app.avaliar(conta), '1/2');
    await app.avaliar(fala('Mais um caso de acentos.'));
    await app.esperar(`${conta}.endsWith('/3')`, 4000);
  });

  await t.test('Esc fecha a barra, tira as marcas e não interrompe o motor', async () => {
    await app.avaliar("window.orq.conversa.mandar('orquestrador', 'trabalha até parar')");
    await app.esperar("!document.getElementById('parar').hidden", 8000);
    await app.avaliar("document.getElementById('busca-conversa-texto').focus()");
    await esc();
    await app.esperar(`${barra}.hidden`);
    assert.strictEqual(await app.avaliar(marcadas), 0);
    assert.strictEqual(await app.avaliar('document.activeElement.id'), 'entrada', 'o foco volta para a caixa');
    await app.espera(300);
    assert.strictEqual(interrupcoes(), 0);
    // Barra aberta e o foco na caixa: o primeiro Esc fecha a barra; só o seguinte interrompe.
    await ctrlF();
    await app.esperar(`!${barra}.hidden`);
    await app.avaliar("document.getElementById('entrada').focus()");
    await esc();
    await app.esperar(`${barra}.hidden`);
    await app.espera(300);
    assert.strictEqual(interrupcoes(), 0, 'o Esc que fecha a barra não interrompe');
    await esc();
    for (let i = 0; i < 50 && interrupcoes() === 0; i++) await app.espera(100);
    assert.strictEqual(interrupcoes(), 1, 'sem nada aberto, o Esc interrompe');
  });

  await t.test('o painel de atalhos lista o Ctrl+F', async () => {
    await app.avaliar("document.getElementById('abrir-atalhos').click()");
    await app.esperar("!document.getElementById('popup').hidden");
    assert.match(await app.avaliar("document.getElementById('popup-corpo').innerText"), /Buscar nesta conversa[\s\S]*Ctrl\+F|Ctrl\+F[\s\S]*Buscar nesta conversa/);
    await app.avaliar("document.getElementById('fechar-popup').click()");
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
