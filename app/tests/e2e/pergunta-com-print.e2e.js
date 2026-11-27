// Área: conversa (responder uma pergunta do Claude com print)
// Pedido de 27/11 (com print): a resposta dizia "(a print segue na próxima mensagem)" e a imagem
// aparecia num balão solto embaixo, com "Print da minha resposta à pergunta ...". "Pode ser que ele de
// fato mande assim, mas no app podia ficar só a imagem anexada ali na resposta da pergunta dele."
// Para o Claude nada muda (a pergunta só aceita texto, então a print vai na mensagem seguinte); na
// tela, a print fica dentro do cartão "Respondido".
const test = require('node:test');
const assert = require('node:assert');
const { abrirApp } = require('./app');

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('pergunta respondida com print: a imagem fica no cartão "Respondido", não num balão solto', async (t) => {
  const app = await abrirApp();
  t.after(() => app.fechar());
  await app.esperar('!!window.__orqTeste');
  const injetar = (ev) => app.avaliar(`window.__orqTeste.desenharEvento(${JSON.stringify(ev)})`);
  const pergunta = { id: 'pp1', ferramenta: 'AskUserQuestion', entrada: { questions: [{ header: 'Central', question: 'A prévia está como você queria?', multiSelect: false, options: [{ label: 'Sim' }, { label: 'Não' }] }] } };
  await app.avaliar(`window.__orqTeste.pedidos.set('pp1', ${JSON.stringify(pergunta)}); window.__orqTeste.cartaoPedido(${JSON.stringify(pergunta)})`);
  const C = "document.querySelector('[data-pedido=\"pp1\"]')";
  const baloesComImagem = () => app.avaliar("document.querySelectorAll('#mensagens .msg-voce .balao-imagens').length");

  await t.test('a resposta mostra o texto sem o "(a print segue…)" e a print dentro dela', async () => {
    await app.avaliar(`(() => { const b = Uint8Array.from(atob('${PNG}'), (c) => c.charCodeAt(0)); const dt = new DataTransfer(); dt.items.add(new File([b], 'p.png', { type: 'image/png' }));
      ${C}.querySelector('.outra').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
    await app.esperar(`${C}.querySelectorAll('.anexos-pergunta img').length === 1`);
    await app.avaliar(`(() => { const o = ${C}.querySelector('.outra'); o.value = 'não mudou nada'; o.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
    await app.esperar(`${C}.classList.contains('respondido')`, 5000);
    const r = await app.avaliar(`(() => { const d = ${C}.querySelector('.resposta-dada'); return { texto: d.querySelector('p') ? d.querySelector('p').textContent : '', imgs: [...d.querySelectorAll('.resposta-prints img')].map((i) => i.src.slice(-12)) }; })()`);
    assert.deepStrictEqual(r, { texto: 'não mudou nada', imgs: [PNG.slice(-12)] });
    await app.espera(600);
    assert.strictEqual(await baloesComImagem(), 0, 'nenhum balão solto com a print');
  });

  await t.test('a mensagem da print que o Claude recebe não vira balão (ao vivo nem ao reabrir com o cartão na tela)', async () => {
    await injetar({ tipo: 'user', local: true, message: { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } }, { type: 'text', text: 'Print da minha resposta à pergunta "Central".' }] } });
    await app.espera(300);
    assert.strictEqual(await baloesComImagem(), 0);
    assert.ok(!(await app.avaliar("[...document.querySelectorAll('#mensagens .msg-voce[data-texto]')].some((b) => b.dataset.texto.startsWith('Print da minha resposta'))")));
  });

  await t.test('clicar na print do cartão abre em tela cheia', async () => {
    await app.avaliar(`${C}.querySelector('.resposta-prints img').click()`);
    assert.strictEqual(await app.avaliar('window.orqVisor.estado().aberto'), true);
    await app.avaliar("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  });

  await t.test('print de uma pergunta sem cartão na tela (conversa antiga): continua aparecendo como antes', async () => {
    await injetar({ tipo: 'user', antigo: true, message: { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } }, { type: 'text', text: 'Print da minha resposta à pergunta "Outra".' }] } });
    assert.strictEqual(await baloesComImagem(), 1, 'sem o cartão, a imagem não some');
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
