// Área: conversa (chip de modo de permissão do P1: troca ao vivo, confirmação no orquestrador, Bypass só com a opção)
// Plano 2.2. O chip lê o modo que o Claude confirma (system/status) e troca por
// set_permission_mode. No orquestrador, sair do Auto pede confirmação. O Bypass
// ("sem perguntas") só aparece com a opção das Configurações, só em conversa
// avulsa, confirma a cada vez e mostra a faixa vermelha.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pastaTemporaria } = require('../temporarias');
const { abrirApp } = require('./app');

const linhas = (arq) => { try { return fs.readFileSync(arq, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };

test('chip de modo de permissão', async (t) => {
  const log = path.join(pastaTemporaria('orq-claude-falso-'), 'log.jsonl');
  process.env.CLAUDE_FALSO_LOG = log;
  const app = await abrirApp({ config: { mostrarBichinho: false } });
  t.after(() => { delete process.env.CLAUDE_FALSO_LOG; return app.fechar(); });
  await app.esperar('!!window.__orqTeste');
  const modosPedidos = () => linhas(log).filter((o) => o.type === 'control_request' && o.request && o.request.subtype === 'set_permission_mode').map((o) => o.request.mode);
  const chip = () => app.avaliar("document.getElementById('chip-modo').innerText.replace(/\\s+/g, ' ').replace('▾', '').trim()");
  const abrirMenu = async () => { if (await app.avaliar("document.getElementById('menu-modo').hidden")) await app.avaliar("document.getElementById('chip-modo').click()"); await app.esperar("!document.getElementById('menu-modo').hidden"); };
  const escolher = (m) => app.avaliar(`document.querySelector('#menu-modo [data-modo="${m}"]').click()`);
  const confirmacao = "document.querySelector('#menu-modo .menu-confirma')";
  const ctrlShiftM = async () => {
    await app.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'M', code: 'KeyM', windowsVirtualKeyCode: 77, modifiers: 10 });
    await app.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'M', code: 'KeyM', windowsVirtualKeyCode: 77, modifiers: 10 });
  };
  const shiftTab = async () => {
    await app.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 8 });
    await app.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 8 });
  };
  const opcao = async (secao, chave) => {
    await app.avaliar("document.getElementById('abrir-config').click()");
    await app.esperar("!document.getElementById('config').hidden");
    await app.avaliar(`document.querySelector('[data-secao-config="${secao}"]').click()`);
    await app.avaliar(`document.querySelector('#config [data-cfg="${chave}"]').click()`);
    await app.espera(300);
    await app.avaliar("document.getElementById('fechar-config').click()");
  };

  await t.test('o chip mostra o modo da conversa, com ícone e nome: Auto no orquestrador', async () => {
    assert.strictEqual(await app.visivel('#chip-modo'), 'ok');
    assert.strictEqual(await chip(), 'Auto');
    assert.ok(await app.avaliar("document.getElementById('chip-modo').classList.contains('modo-auto') && !!document.querySelector('#chip-modo .ico-modo svg')"), 'cor e ícone, nunca só cor');
  });

  await t.test('o menu traz os quatro modos, cada um com a explicação; sem o Bypass', async () => {
    await abrirMenu();
    assert.strictEqual(await app.visivel('#menu-modo'), 'ok');
    assert.deepStrictEqual(await app.avaliar("[...document.querySelectorAll('#menu-modo [data-modo]')].map((b) => b.dataset.modo)"), ['default', 'acceptEdits', 'auto', 'plan']);
    const txt = (await app.avaliar("document.getElementById('menu-modo').innerText")).replace(/\s+/g, ' ');
    for (const frase of ['Perguntar sempre', 'pede antes de editar ou rodar', 'Aceitar edições', 'edita sozinho, pergunta antes de rodar', 'Auto', 'decide sozinho o que é seguro', 'Planejar', 'só lê e propõe um plano']) assert.ok(txt.includes(frase), frase);
    assert.strictEqual(await app.avaliar("document.querySelector('#menu-modo [data-modo=auto]').getAttribute('aria-checked')"), 'true');
  });

  await t.test('no orquestrador, sair do Auto pede confirmação; Cancelar não muda nada', async () => {
    await escolher('plan');
    await app.esperar(`!!${confirmacao}`);
    assert.match(await app.avaliar(`${confirmacao}.innerText`), /Fora do Auto, a rodada para a cada comando de tmux ou docker/);
    assert.deepStrictEqual(modosPedidos(), [], 'nada foi pedido ao Claude antes de confirmar');
    await app.avaliar(`${confirmacao}.querySelector('[data-cancelar]').click()`);
    assert.ok(await app.avaliar(`!${confirmacao}`));
    assert.strictEqual(await chip(), 'Auto');
  });

  await t.test('confirmando, o modo troca ao vivo e o chip mostra o que o Claude confirmou; voltar ao Auto não pergunta', async () => {
    await abrirMenu();
    await escolher('plan');
    await app.esperar(`!!${confirmacao}`);
    await app.avaliar(`${confirmacao}.querySelector('[data-confirmar]').click()`);
    await app.esperar("/Planejar/.test(document.getElementById('chip-modo').innerText)", 8000);
    assert.deepStrictEqual(modosPedidos(), ['plan']);
    assert.ok(await app.avaliar("document.getElementById('chip-modo').classList.contains('modo-plan') && document.getElementById('menu-modo').hidden"));
    await abrirMenu();
    await escolher('auto');
    await app.esperar("/Auto/.test(document.getElementById('chip-modo').innerText)", 8000);
    assert.deepStrictEqual(modosPedidos(), ['plan', 'auto']);
  });

  await t.test('Ctrl+Shift+M no orquestrador abre a confirmação em vez de trocar calado', async () => {
    await ctrlShiftM();
    await app.esperar(`!!${confirmacao}`);
    assert.strictEqual(await chip(), 'Auto');
    assert.deepStrictEqual(modosPedidos(), ['plan', 'auto']);
    await app.avaliar(`${confirmacao}.querySelector('[data-cancelar]').click()`);
    await app.avaliar("document.getElementById('mensagens').click()");
  });

  let avulsa;
  await t.test('conversa avulsa: escolher troca na hora; Ctrl+Shift+M anda pelos quatro modos', async () => {
    avulsa = await app.avaliar('window.orq.conversa.nova().then((id) => window.__orqTeste.trocar(id).then(() => id))');
    assert.strictEqual(await chip(), 'Auto');
    await abrirMenu();
    await escolher('acceptEdits');
    await app.esperar("/Aceitar edições/.test(document.getElementById('chip-modo').innerText)", 8000);
    assert.ok(await app.avaliar(`!${confirmacao}`), 'na avulsa não há confirmação');
    const vistos = [];
    for (let i = 0; i < 4; i++) { await ctrlShiftM(); await app.espera(350); vistos.push(await chip()); }
    assert.deepStrictEqual(vistos, ['Auto', 'Planejar', 'Perguntar', 'Aceitar edições'], 'o ciclo nunca passa pelo Bypass');
  });

  await t.test('Shift+Tab com a caixa vazia troca o modo; com texto na caixa, não; desligado nas Configurações, não', async () => {
    await app.avaliar("(() => { const e = document.getElementById('entrada'); e.value = ''; e.focus(); })()");
    await shiftTab();
    await app.esperar("/Auto/.test(document.getElementById('chip-modo').innerText)", 8000);
    await app.avaliar("(() => { const e = document.getElementById('entrada'); e.value = 'um texto'; e.focus(); })()");
    await shiftTab();
    await app.espera(350);
    assert.strictEqual(await chip(), 'Auto', 'com texto, o Shift+Tab não troca o modo');
    await opcao('atalhos', 'shiftTabTrocaModo');
    await app.avaliar("(() => { const e = document.getElementById('entrada'); e.value = ''; e.focus(); })()");
    await shiftTab();
    await app.espera(350);
    assert.strictEqual(await chip(), 'Auto', 'opção desligada: o Shift+Tab só navega');
    await ctrlShiftM();
    await app.esperar("/Planejar/.test(document.getElementById('chip-modo').innerText)", 8000);
  });

  await t.test('Bypass desligado (o padrão): não aparece no menu e nenhum caminho da tela liga', async () => {
    await abrirMenu();
    assert.ok(await app.avaliar("!document.querySelector('#menu-modo [data-modo=bypassPermissions]')"));
    await app.avaliar("document.getElementById('mensagens').click()");
    assert.match((await app.avaliar(`window.orq.conversa.modo(${JSON.stringify(avulsa)}, 'bypassPermissions')`)).erro, /desligado nas Configurações/);
    assert.match((await app.avaliar(`window.orq.comandos.controle(${JSON.stringify(avulsa)}, 'set_permission_mode', { mode: 'bypassPermissions' })`)).erro, /não liberado/);
    assert.ok(!modosPedidos().includes('bypassPermissions'));
  });

  await t.test('Bypass ligado nas Configurações: aparece só na avulsa, confirma, mostra a faixa vermelha e volta ao Auto', async () => {
    await opcao('avancado', 'mostrarBypass');
    await abrirMenu();
    await escolher('bypassPermissions');
    await app.esperar(`!!${confirmacao}`);
    assert.match(await app.avaliar(`${confirmacao}.innerText`), /sem pedir/);
    assert.ok(!modosPedidos().includes('bypassPermissions'), 'nada antes de confirmar');
    await app.avaliar(`${confirmacao}.querySelector('[data-confirmar]').click()`);
    await app.esperar("/Sem perguntas/.test(document.getElementById('chip-modo').innerText)", 10000);
    assert.strictEqual(await app.visivel('#faixa-bypass'), 'ok');
    assert.match(await app.avaliar("document.getElementById('faixa-bypass').innerText"), /roda tudo sem pedir/);
    assert.ok(linhas(log).some((o) => Array.isArray(o.args) && o.args.includes('--allow-dangerously-skip-permissions')), 'a conversa subiu com a permissão do Claude');
    await app.avaliar("document.getElementById('sair-bypass').click()");
    await app.esperar("/Auto/.test(document.getElementById('chip-modo').innerText)", 8000);
    assert.ok(await app.avaliar("document.getElementById('faixa-bypass').hidden"));
  });

  await t.test('no orquestrador o Bypass nunca aparece, mesmo com a opção ligada', async () => {
    await app.avaliar("window.__orqTeste.trocar('orquestrador')");
    await app.espera(300);
    await abrirMenu();
    assert.ok(await app.avaliar("!document.querySelector('#menu-modo [data-modo=bypassPermissions]')"));
    await app.avaliar("document.getElementById('mensagens').click()");
    assert.match((await app.avaliar("window.orq.conversa.modo('orquestrador', 'bypassPermissions')")).erro, /nunca vale para o orquestrador/);
  });

  await t.test('conversa Codex: o chip de modo não aparece (o modo ali é do Codex)', async () => {
    await app.avaliar("window.__orqTeste.desenharInfo({ motor: 'codex', pasta: '/casa', modelo: null })");
    assert.ok(await app.avaliar("document.getElementById('chip-modo').hidden"));
    await app.avaliar("window.__orqTeste.trocar('orquestrador')");
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
