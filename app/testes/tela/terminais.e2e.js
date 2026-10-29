// Área: terminais
const test = require('node:test');
const assert = require('node:assert');
const { abrirApp } = require('./app');

test('terminais', async (t) => {
  const app = await abrirApp();
  t.after(() => app.fechar());
  await app.avaliar("document.querySelector('[data-aba=aba-terminal]').click()");
  await app.esperar("document.querySelectorAll('.painel-terminal').length === 1");
  await app.avaliar("document.getElementById('novo-terminal').click()");
  await app.esperar("document.querySelectorAll('.painel-terminal').length === 2");
  await app.avaliar("document.getElementById('novo-terminal').click()");
  await app.esperar("document.querySelectorAll('.painel-terminal').length === 3");

  // Regressão 2026-10-28: a regra CSS antiga .terminal (position:absolute)
  // pegava o xterm e cobria a grade inteira.
  await t.test('regressão: os 3 terminais ficam em grade, sem se sobrepor', async () => {
    const r = await app.avaliar(`[...document.querySelectorAll('.painel-terminal')].map((p) => { const b = p.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; })`);
    const cruza = (a, b) => a[0] < b[2] - 1 && b[0] < a[2] - 1 && a[1] < b[3] - 1 && b[1] < a[3] - 1;
    for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) assert.ok(!cruza(r[i], r[j]), `terminais ${i} e ${j} se sobrepõem`);
    const xterm = await app.avaliar("[...document.querySelectorAll('.xterm')].every((x) => getComputedStyle(x).position !== 'absolute')");
    assert.ok(xterm, 'nenhum xterm com position:absolute');
  });

  // Regressão 2026-10-29: não dava para copiar texto do terminal.
  await t.test('regressão: Ctrl+Shift+C copia a seleção do terminal', async () => {
    await app.esperar("[...document.querySelectorAll('.xterm-rows')].some((r) => r.textContent.trim().length > 0)", 8000);
    // Guarda a área de transferência de quem roda o teste, para devolver no fim.
    const antes = await app.avaliar('navigator.clipboard.readText().catch(() => "")');
    await app.avaliar("document.querySelector('.painel-terminal .xterm-helper-textarea').focus()");
    await app.texto('echo copiar-isto-agora');
    await app.tecla('Enter', 'Enter', 13);
    await app.espera(600);
    // seleciona tudo pelo menu do botão direito e copia com o atalho
    await app.avaliar("document.querySelector('.painel-terminal').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 300, clientY: 300 }))");
    await app.avaliar("document.querySelector('.menu-terminal [data-f=\"tudo\"]').click()");
    await app.avaliar("document.querySelector('.painel-terminal .xterm-helper-textarea').focus()");
    await app.avaliar("document.querySelector('.painel-terminal .xterm-helper-textarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'C', code: 'KeyC', ctrlKey: true, shiftKey: true, bubbles: true }))");
    await app.espera(300);
    const copiado = await app.avaliar('navigator.clipboard.readText()');
    // Devolve o que a pessoa tinha copiado antes do teste.
    await app.avaliar(`navigator.clipboard.writeText(${JSON.stringify(antes)})`);
    assert.match(copiado, /copiar-isto-agora/);
  });

  await t.test('no máximo 4 terminais', async () => {
    await app.avaliar("document.getElementById('novo-terminal').click()");
    await app.esperar("document.querySelectorAll('.painel-terminal').length === 4");
    assert.ok(await app.avaliar("document.getElementById('novo-terminal').disabled"));
  });
});
