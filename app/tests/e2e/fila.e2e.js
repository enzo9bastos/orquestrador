// Área: conversa (fila visível do P1: Enter põe na fila, Ctrl+Enter corrige o rumo)
// Plano 4.1. Com o motor trabalhando, o que é mandado pela caixa espera numa
// fila do app, à vista no fim da conversa (balão tracejado, "Enviar já",
// "Tirar"), e vai quando o turno acaba. Ctrl+Enter interrompe e manda na frente.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pastaTemporaria } = require('../temporarias');
const { abrirApp } = require('./app');

const linhas = (arq) => { try { return fs.readFileSync(arq, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };

test('fila de mensagens da caixa', async (t) => {
  const log = path.join(pastaTemporaria('orq-claude-falso-'), 'log.jsonl');
  process.env.CLAUDE_FALSO_LOG = log;
  const app = await abrirApp({ config: { mostrarBichinho: false } });
  t.after(() => { delete process.env.CLAUDE_FALSO_LOG; return app.fechar(); });
  await app.esperar('!!window.__orqTeste');
  const mandadas = () => linhas(log).filter((o) => o.type === 'user').map((o) => (typeof o.message.content === 'string' ? o.message.content : (o.message.content.find((b) => b.type === 'text') || {}).text));
  const interrupcoes = () => linhas(log).filter((o) => o.type === 'control_request' && o.request && o.request.subtype === 'interrupt').length;
  const digitar = (txt) => app.avaliar(`(() => { const e = document.getElementById('entrada'); e.focus(); e.value = ${JSON.stringify(txt)}; e.dispatchEvent(new Event('input')); })()`);
  const enter = (mods = 0) => app.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: mods }).then(() => app.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, modifiers: mods }));
  const fila = () => app.avaliar("[...document.querySelectorAll('#mensagens .msg-fila')].map((d) => [d.querySelector('.balao').innerText.trim(), d.classList.contains('ja'), d.querySelector('.fila-acoes span').innerText.trim()])");
  const baloes = () => app.avaliar("[...document.querySelectorAll('#mensagens .msg-voce[data-texto]')].map((b) => b.dataset.texto)");
  const ocupado = "!document.getElementById('parar').hidden";

  await t.test('parado, o Enter manda na hora; trabalhando, a caixa avisa o que o Enter passa a fazer', async () => {
    await digitar('trabalha até parar'); await enter();
    await app.esperar(ocupado, 8000);
    assert.deepStrictEqual(await fila(), []);
    assert.strictEqual(await app.avaliar("document.getElementById('entrada').placeholder"), 'Trabalhando: Enter põe na fila · Ctrl+Enter corrige o rumo agora');
  });

  await t.test('trabalhando, o Enter põe na fila: balão tracejado no fim da conversa, "1 na fila" na faixa, nada vai ao motor', async () => {
    await digitar('e roda os testes de novo'); await enter();
    await app.esperar("document.querySelectorAll('#mensagens .msg-fila').length === 1", 8000);
    assert.deepStrictEqual(await fila(), [['e roda os testes de novo', false, 'na fila']]);
    assert.strictEqual(await app.avaliar("document.getElementById('faixa-fila').innerText.replace(/\\s+/g, ' ').trim()"), '1 na fila');
    assert.strictEqual(await app.avaliar("document.getElementById('entrada').value"), '', 'a caixa esvazia: a mensagem está na fila');
    assert.deepStrictEqual(mandadas(), ['trabalha até parar']);
    assert.deepStrictEqual(await baloes(), ['trabalha até parar'], 'o balão da fila não conta como mensagem enviada');
    assert.strictEqual(await app.avaliar("document.querySelector('#mensagens').lastElementChild.classList.contains('msg-fila')"), true, 'fica por último');
  });

  await t.test('"Tirar" tira da fila sem mandar', async () => {
    await digitar('esta eu vou tirar'); await enter();
    await app.esperar("document.querySelectorAll('#mensagens .msg-fila').length === 2", 8000);
    await app.avaliar("[...document.querySelectorAll('#mensagens .msg-fila')].find((d) => /vou tirar/.test(d.innerText)).querySelector('[data-fila-tirar]').click()");
    await app.esperar("document.querySelectorAll('#mensagens .msg-fila').length === 1", 8000);
    assert.deepStrictEqual((await fila()).map((x) => x[0]), ['e roda os testes de novo']);
  });

  await t.test('Ctrl+Enter corrige o rumo: interrompe, e a mensagem vai na frente da fila; depois a fila anda sozinha', async () => {
    await digitar('muda o rumo'); await enter(2);
    await app.esperar("document.querySelectorAll('#mensagens .msg-voce[data-texto]').length === 3", 10000);
    assert.strictEqual(interrupcoes(), 1);
    assert.deepStrictEqual(mandadas(), ['trabalha até parar', 'muda o rumo', 'e roda os testes de novo']);
    assert.deepStrictEqual(await baloes(), ['trabalha até parar', 'muda o rumo', 'e roda os testes de novo']);
    await app.esperar("document.querySelectorAll('#mensagens .msg-fila').length === 0 && document.getElementById('trabalhando').hidden", 8000);
    assert.ok(!(await app.avaliar("[...document.querySelectorAll('#mensagens .aviso-conversa')].some((e) => /Interrompido por você/.test(e.innerText))")), 'a parada foi para corrigir o rumo: sem o aviso de "interrompido por você"');
  });

  await t.test('o usuário para o motor (Esc): a fila fica parada e à vista; "Enviar já" manda', async () => {
    await digitar('trabalha até parar'); await enter();
    await app.esperar(ocupado, 8000);
    await digitar('não vá sozinha'); await enter();
    await app.esperar("document.querySelectorAll('#mensagens .msg-fila').length === 1", 8000);
    await app.avaliar("document.getElementById('entrada').focus()");
    await app.tecla('Escape', 'Escape', 27);
    await app.esperar(`!(${ocupado})`, 8000);
    await app.espera(400);
    assert.deepStrictEqual(await fila(), [['não vá sozinha', false, 'na fila, parada (o motor foi interrompido)']]);
    assert.strictEqual(await app.visivel('#faixa-fila'), 'ok', 'a faixa continua mostrando a fila com o motor parado');
    assert.strictEqual(mandadas().length, 4);
    await app.avaliar("document.querySelector('#mensagens .msg-fila [data-fila-ja]').click()");
    await app.esperar("document.querySelectorAll('#mensagens .msg-fila').length === 0", 8000);
    for (let i = 0; i < 50 && mandadas().length < 5; i++) await app.espera(100);
    assert.strictEqual(mandadas()[4], 'não vá sozinha');
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
