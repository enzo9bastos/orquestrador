// Área: conversa (ordem das mensagens quando o Claude começa um turno sozinho)
// Visto pelo usuário em 17/11/2026: ele mandou uma mensagem enquanto o Claude escrevia a
// passada automática (um turno que o próprio Claude começou, sem o app mandar nada) e o balão
// dele apareceu no meio da resposta. Agora esse turno conta como "trabalhando": o Enter põe
// a mensagem na fila, ela só vai quando o Claude termina, e aí ele responde a ela.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pastaTemporaria } = require('../temporarias');
const { abrirApp } = require('./app');

const linhas = (arq) => { try { return fs.readFileSync(arq, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };

test('mensagem mandada enquanto o Claude responde por conta própria', async (t) => {
  const log = path.join(pastaTemporaria('orq-claude-falso-'), 'log.jsonl');
  Object.assign(process.env, { CLAUDE_FALSO_LOG: log, CLAUDE_FALSO_TURNO_SOZINHO_MS: '2500' });
  const app = await abrirApp({ config: { mostrarBichinho: false } });
  t.after(() => { delete process.env.CLAUDE_FALSO_LOG; delete process.env.CLAUDE_FALSO_TURNO_SOZINHO_MS; return app.fechar(); });
  await app.esperar('!!window.__orqTeste');
  const digitar = (txt) => app.avaliar(`(() => { const e = document.getElementById('entrada'); e.focus(); e.value = ${JSON.stringify(txt)}; e.dispatchEvent(new Event('input')); })()`);
  const enter = () => app.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }).then(() => app.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }));
  const ocupado = "!document.getElementById('parar').hidden";
  const baloes = () => app.avaliar("[...document.querySelectorAll('#mensagens .msg-voce[data-texto]')].map((b) => b.dataset.texto)");
  const naFila = () => app.avaliar("[...document.querySelectorAll('#mensagens .msg-fila .balao')].map((b) => b.innerText.trim())");
  // A conversa de cima para baixo: os balões do usuário e os textos do Claude, na ordem da tela.
  const ordem = () => app.avaliar("[...document.querySelectorAll('#mensagens .msg-voce[data-texto], #mensagens .texto-claude')].map((e) => (e.matches('.msg-voce') ? 'você: ' + e.dataset.texto : 'claude: ' + e.innerText.trim()))");

  await digitar('depois começa um turno sozinho'); await enter();
  await app.esperar("[...document.querySelectorAll('#mensagens .texto-claude')].some((e) => e.innerText.trim() === 'combinado')", 8000);
  await app.esperar(`!(${ocupado})`, 8000);

  await t.test('o turno que o Claude começa sozinho aparece como "trabalhando" (com o Parar)', async () => {
    await app.esperar(ocupado, 8000);
    assert.strictEqual(await app.avaliar("document.getElementById('entrada').placeholder"), 'Trabalhando: Enter põe na fila · Ctrl+Enter corrige o rumo agora');
  });

  await t.test('a mensagem mandada no meio entra na fila: sem balão no meio da resposta, e o Claude ainda não a recebeu', async () => {
    await digitar('pergunta no meio da passada'); await enter();
    await app.esperar("document.querySelectorAll('#mensagens .msg-fila').length === 1", 8000);
    assert.deepStrictEqual(await naFila(), ['pergunta no meio da passada']);
    assert.deepStrictEqual(await baloes(), ['depois começa um turno sozinho']);
    assert.ok(!linhas(log).some((o) => o.type === 'user' && o.message.content === 'pergunta no meio da passada'), 'nada foi ao Claude ainda');
  });

  await t.test('o Claude termina a resposta dele; só depois a mensagem aparece, e aí ele responde a ela', async () => {
    await app.esperar("[...document.querySelectorAll('#mensagens .msg-voce[data-texto]')].some((b) => b.dataset.texto === 'pergunta no meio da passada')", 12000);
    await app.esperar("[...document.querySelectorAll('#mensagens .texto-claude')].pop().innerText.trim() === 'ok'", 8000);
    assert.deepStrictEqual(await ordem(), ['você: depois começa um turno sozinho', 'claude: combinado', 'claude: Nada novo desde a última passada.', 'você: pergunta no meio da passada', 'claude: ok']);
    assert.deepStrictEqual(await naFila(), []);
    // O Claude recebeu a mensagem depois de terminar a passada.
    const l = linhas(log);
    assert.ok(l.findIndex((o) => o.type === 'user' && o.message.content === 'pergunta no meio da passada') > l.findIndex((o) => o.turnoSozinho === 'fim'));
    await app.esperar(`!(${ocupado})`, 8000);
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
