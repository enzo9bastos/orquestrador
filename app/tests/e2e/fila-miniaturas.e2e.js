// Área: conversa (fila da caixa: prints da mensagem que espera aparecem como miniaturas)
// Pedido do usuário em 17/11/2026: a mensagem na fila mostrava um símbolo de imagem com a
// contagem ("🖼 1") no lugar das prints. Agora mostra as miniaturas, quantas forem, e o
// clique amplia, como no balão já enviado.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pastaTemporaria } = require('../temporarias');
const { abrirApp } = require('./app');

// PNG de 1 x 1 ponto.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test('prints da mensagem que está na fila', async (t) => {
  process.env.CLAUDE_FALSO_LOG = path.join(pastaTemporaria('orq-claude-falso-'), 'log.jsonl');
  const app = await abrirApp({ config: { mostrarBichinho: false } });
  t.after(() => { delete process.env.CLAUDE_FALSO_LOG; return app.fechar(); });
  await app.esperar('!!window.__orqTeste');
  const img = { tipo: 'image/png', dados: PNG };
  const daCaixa = (texto, imagens) => app.avaliar(`window.orq.conversa.daCaixa('orquestrador', ${JSON.stringify(texto)}, ${JSON.stringify(imagens)}, null, {})`);
  // O que cada balão da fila mostra: o texto e, de cada miniatura, se é imagem carregada.
  const fila = () => app.avaliar("[...document.querySelectorAll('#mensagens .msg-fila')].map((d) => ({ texto: d.querySelector('.balao').innerText.trim(), miniaturas: [...d.querySelectorAll('.fila-miniaturas img')].map((i) => i.complete && i.naturalWidth > 0 && i.src.startsWith('data:image/png;base64,')), outros: d.querySelectorAll('.fila-miniaturas > :not(img)').length }))");

  await app.avaliar("window.orq.conversa.mandar('orquestrador', 'trabalha até parar')");
  await app.esperar("!document.getElementById('parar').hidden", 8000);

  await t.test('uma print: a miniatura aparece no balão da fila, sem símbolo nem contagem', async () => {
    await daCaixa('olha esta print', [img]);
    await app.esperar("document.querySelectorAll('#mensagens .msg-fila .fila-miniaturas img').length === 1", 8000);
    await app.esperar("[...document.querySelectorAll('#mensagens .msg-fila .fila-miniaturas img')].every((i) => i.complete && i.naturalWidth > 0)", 8000);
    assert.deepStrictEqual(await fila(), [{ texto: 'olha esta print', miniaturas: [true], outros: 0 }]);
    assert.ok(!(await app.avaliar("document.querySelector('#mensagens .msg-fila').innerText")).includes('🖼'));
    const tam = await app.avaliar("(() => { const b = document.querySelector('#mensagens .msg-fila .fila-miniaturas img').getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; })()");
    assert.deepStrictEqual(tam, [96, 72]);
  });

  await t.test('várias prints: uma miniatura para cada; mensagem só com prints também', async () => {
    await daCaixa('e estas três', [img, img, img]);
    await daCaixa('', [img, img]);
    await app.esperar("document.querySelectorAll('#mensagens .msg-fila .fila-miniaturas img').length === 6", 8000);
    await app.esperar("[...document.querySelectorAll('#mensagens .msg-fila .fila-miniaturas img')].every((i) => i.complete && i.naturalWidth > 0)", 8000);
    assert.deepStrictEqual(await fila(), [{ texto: 'olha esta print', miniaturas: [true], outros: 0 }, { texto: 'e estas três', miniaturas: [true, true, true], outros: 0 }, { texto: '', miniaturas: [true, true], outros: 0 }]);
  });

  await t.test('a fila redesenhada (outra mensagem entra) continua com as miniaturas', async () => {
    await daCaixa('sem print nenhuma', []);
    await app.esperar("document.querySelectorAll('#mensagens .msg-fila').length === 4", 8000);
    await app.esperar("document.querySelectorAll('#mensagens .msg-fila .fila-miniaturas img').length === 6", 8000);
    assert.strictEqual((await fila())[3].miniaturas.length, 0);
    assert.strictEqual(await app.avaliar("document.querySelectorAll('#mensagens .msg-fila')[3].querySelectorAll('.fila-miniaturas').length"), 0, 'mensagem sem print não ganha a área das miniaturas');
  });

  await t.test('clicar na miniatura amplia a imagem', async () => {
    await app.avaliar("document.querySelector('#mensagens .msg-fila .fila-miniaturas img').click()");
    await app.esperar("!!document.getElementById('visor-imagem') && !document.getElementById('visor-imagem').hidden", 6000);
    await app.tecla('Escape', 'Escape', 27);
    await app.esperar("document.getElementById('visor-imagem').hidden", 6000);
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
