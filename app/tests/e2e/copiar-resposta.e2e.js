// Área: conversa (botão de copiar a resposta; plano 1.3)
// Cada resposta do Claude tem um botão que copia o texto dela em Markdown, como o
// Claude escreveu, sem as linhas de ferramenta. Na última resposta o botão fica
// sempre à vista; nas outras, aparece ao passar o mouse.
const test = require('node:test');
const assert = require('node:assert');
const { abrirApp } = require('./app');

test('copiar a resposta', async (t) => {
  const app = await abrirApp({ config: { mostrarBichinho: false } });
  t.after(() => app.fechar());
  await app.esperar('!!window.__orqTeste');
  await app.avaliar("window.__copiado = []; Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: async (x) => { window.__copiado.push(x); } })");
  const desenhar = (ev) => app.avaliar(`window.__orqTeste.desenharEvento(${JSON.stringify(ev)})`);
  const usuario = (texto) => desenhar({ tipo: 'user', local: true, message: { role: 'user', content: texto } });
  const PRIMEIRA = 'Primeira resposta, **curta**.';
  const PARTE_1 = 'Vou ajustar o botão:\n\n```js\nconst cor = "azul";\n```';
  const PARTE_2 = 'Pronto. Mudei **1 arquivo** e os testes passam.';
  await usuario('oi');
  await desenhar({ tipo: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: PRIMEIRA }] } });
  await usuario('troca o botão para azul');
  await desenhar({ tipo: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: PARTE_1 }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } }] } });
  await desenhar({ tipo: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok 12 testes' }] } });
  await desenhar({ tipo: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: PARTE_2 }] } });
  const grupos = "[...document.querySelectorAll('#mensagens .msg-claude')]";

  await t.test('cada resposta tem o botão; o clique copia o Markdown sem as linhas de ferramenta', async () => {
    assert.strictEqual(await app.avaliar(`${grupos}.every((g) => !!g.querySelector('.copiar-resposta'))`), true);
    await app.avaliar(`${grupos}.pop().querySelector('.copiar-resposta').click()`);
    await app.esperar('window.__copiado.length === 1');
    assert.strictEqual(await app.avaliar('window.__copiado[0]'), `${PARTE_1}\n\n${PARTE_2}`);
    assert.ok(!(await app.avaliar('window.__copiado[0]')).includes('npm test'), 'a linha da ferramenta não vai junto');
  });

  await t.test('o botão diz que copiou e depois volta ao normal', async () => {
    assert.strictEqual(await app.avaliar(`${grupos}.pop().querySelector('.copiar-resposta').classList.contains('copiado')`), true);
    await app.esperar(`!${grupos}.pop().querySelector('.copiar-resposta').classList.contains('copiado')`, 4000);
  });

  await t.test('na última resposta fica sempre à vista; nas outras, só com o mouse em cima', async () => {
    // O ponteiro vai para cima da caixa de texto: com vários apps de teste na mesma tela
    // virtual ele podia estar sobre uma resposta, e o botão dela aparece (falhou assim uma vez).
    const caixa = await app.avaliar("(() => { const b = document.getElementById('entrada').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()");
    const opacidade = (g) => app.avaliar(`getComputedStyle(${grupos}[${g}].querySelector('.copiar-resposta')).opacity`);
    const n = await app.avaliar(`${grupos}.length`);
    assert.strictEqual(await opacidade(n - 1), '1');
    // Levar o ponteiro para a caixa uma vez não bastou: outra janela de teste que abre ou fecha
    // por cima faz o ponteiro de verdade "entrar" de novo nesta e cair sobre uma resposta
    // (reprovou assim na cópia de teste da v0.8.0). Leva o ponteiro para a caixa e mede; repete
    // por até 4 s, até a primeira resposta ficar sem o mouse em cima.
    let primeira = '';
    for (let i = 0; i < 20 && primeira !== '0'; i++) {
      await app.mouse('mouseMoved', caixa.x, caixa.y);
      await app.espera(200);
      primeira = await opacidade(0);
    }
    assert.strictEqual(primeira, '0');
  });

  await t.test('/copy copia o mesmo Markdown; /copy 2 copia a resposta anterior', async () => {
    const enviar = async (texto) => {
      await app.avaliar(`(() => { const e = document.getElementById('entrada'); e.focus(); e.value = ${JSON.stringify(texto)}; e.dispatchEvent(new Event('input')); })()`);
      await app.tecla('Escape', 'Escape', 27);
      await app.avaliar("document.getElementById('compositor').requestSubmit()");
    };
    await enviar('/copy');
    await app.esperar('window.__copiado.length === 2');
    assert.strictEqual(await app.avaliar('window.__copiado[1]'), `${PARTE_1}\n\n${PARTE_2}`);
    await enviar('/copy 2');
    await app.esperar('window.__copiado.length === 3');
    assert.strictEqual(await app.avaliar('window.__copiado[2]'), PRIMEIRA);
  });

  await t.test('resposta que ainda está chegando não tem o que copiar: o botão não aparece', async () => {
    await usuario('mais uma');
    await app.avaliar("window.__orqTeste.desenharParcial ? window.__orqTeste.desenharParcial('chegando…') : null");
    const temRascunho = await app.avaliar("!!document.querySelector('#mensagens .texto-claude.rascunho')");
    if (!temRascunho) return t.skip('o arnês não desenha rascunho');
    assert.strictEqual(await app.avaliar(`getComputedStyle(${grupos}.pop().querySelector('.copiar-resposta')).display`), 'none');
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
