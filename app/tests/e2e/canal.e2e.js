// Área: recados (canal entre orquestradores de computadores diferentes)
const test = require('node:test');
const assert = require('node:assert');
const { abrirApp } = require('./app');

const agora = Date.now();
const log = [
  { id: 'e1', ts: agora - 9000, canal: true, canalId: 'n1', de: { tipo: 'externo', nome: 'Bruno' }, para: { tipo: 'orquestrador' }, tipo: 'externo', texto: 'o deploy de vocês pode ser hoje?', titulo: 'Deploy', estado: 'entregue', motivo: null },
  { id: 'e2', ts: agora - 5000, canal: true, de: { tipo: 'orquestrador' }, para: { tipo: 'externo', nome: 'Bruno', caixa: 'para-bruno' }, tipo: 'externo', texto: 'pode, às 17h', titulo: 'Re: Deploy', classe: 'decisao', estado: 'aguardando', motivo: 'vai sair deste computador: espera você aprovar' },
  { id: 'e3', ts: agora - 4000, canal: true, de: { tipo: 'orquestrador' }, para: { tipo: 'externo', nome: 'Bruno', caixa: 'para-bruno' }, tipo: 'externo', texto: 'o Enzo topa sexta', classe: 'decisao', estado: 'aguardando', motivo: 'vai sair deste computador; decisão: espera você aprovar' },
].map((r) => JSON.stringify(r)).join('\n') + '\n';

test('canal entre orquestradores', async (t) => {
  const app = await abrirApp({
    config: { canalContatos: [{ nome: 'Bruno', caixa: 'para-bruno' }] },
    arquivos: { '.local/share/orq-app/recados/recados.jsonl': log },
  });
  t.after(() => app.fechar());
  await app.esperar('!!window.__orqRecados');

  await t.test('o envio para fora espera você, dizendo para quem sai', async () => {
    await app.avaliar("document.querySelector('[data-aba=\"aba-recados\"]').click()");
    await app.esperar("document.querySelectorAll('#recados-aprovar-linha .recado, #recados-linha .recado').length === 3");
    const l = await app.avaliar("[...document.querySelectorAll('#recados-aprovar-linha .recado, #recados-linha .recado')].map((li) => ({ id: li.dataset.id, de: li.querySelector('.recado-de').textContent, para: li.querySelector('.recado-para').textContent, tipo: li.querySelector('.recado-selo-tipo').textContent, decidir: !!li.querySelector('[data-rc-decidir]'), texto: li.innerText }))");
    assert.deepStrictEqual(l.map((x) => [x.id, x.de, x.para, x.tipo, x.decidir]), [['e3', 'Orquestrador', 'Bruno', 'de outro computador', true], ['e2', 'Orquestrador', 'Bruno', 'de outro computador', true], ['e1', 'Bruno', 'Orquestrador', 'de outro computador', false]]);
    l.shift();
    assert.match(l[0].texto, /vai sair deste computador[\s\S]*espera você aprovar/);
    assert.strictEqual(await app.avaliar("document.querySelector('[data-id=\"e2\"] .recado-para').title"), 'para-bruno', 'a caixa fica na dica do nome');
    assert.match(l[1].texto, /Deploy/);
    assert.strictEqual(await app.avaliar("document.getElementById('n-recados-atencao').textContent"), '2');
    assert.deepStrictEqual(await app.avaliar("[...document.querySelectorAll('#recados-aprovar-linha .recado')].map((li) => li.dataset.id)"), ['e3', 'e2'], 'o envio que espera você fica em Para aprovar');
    assert.strictEqual(await app.avaliar("document.querySelector('[data-id=\"e2\"] .recado-selo-classe').textContent"), 'decisão');
  });

  // 0.A4 (M2): quem mandou vem de uma etiqueta que qualquer um que escreve na
  // caixa pode pôr: o recado de fora mostra o selo "não verificado".
  await t.test('o recado de fora mostra o selo "não verificado"; o que sai daqui não', async () => {
    assert.strictEqual(await app.avaliar("(document.querySelector('[data-id=\"e1\"] .recado-selo-nao-verificado') || {}).textContent"), 'não verificado');
    assert.match(await app.avaliar("document.querySelector('[data-id=\"e1\"] .recado-selo-nao-verificado').title"), /qualquer um que escreve na sua caixa/);
    assert.strictEqual(await app.avaliar("!!document.querySelector('[data-id=\"e2\"] .recado-selo-nao-verificado')"), false);
  });

  // Pedido de 2026-11-13: o que espera aprovação aparece também na conversa
  // do orquestrador, como um cartão igual ao de pergunta.
  await t.test('na conversa do orquestrador, o recado vem como cartão de pergunta (Aprovar / Negar)', async () => {
    await app.avaliar("document.querySelector('[data-aba=\"aba-orquestrador\"]').click()");
    await app.esperar("!!document.querySelector('#mensagens .cartao-aprovacao[data-aprovacao=\"e2\"]')", 10000);
    const c = await app.avaliar("(() => { const x = document.querySelector('#mensagens .cartao-aprovacao'); return { texto: x.innerText, opcoes: [...x.querySelectorAll('.opcao strong')].map((o) => o.textContent), pergunta: !!x.querySelector('fieldset.pergunta .etiqueta'), outra: !!x.querySelector('textarea.outra') }; })()");
    assert.deepStrictEqual(c.opcoes, ['Aprovar', 'Negar']);
    assert.ok(c.pergunta && c.outra, 'mesma estrutura do cartão de pergunta');
    assert.match(c.texto, /Recado para Bruno — Re: Deploy[\s\S]*pode, às 17h[\s\S]*Sai agora para Bruno/);
    // Negar no próprio cartão, com motivo: grava como na aba Recados.
    await app.avaliar("(() => { const x = document.querySelector('#mensagens [data-aprovacao=\"e3\"]'); x.querySelector('textarea').value = 'não fala por mim'; x.querySelector('[data-decidir=\"0\"]').click(); })()");
    await app.esperar("document.querySelector('#mensagens [data-aprovacao=\"e3\"]').classList.contains('respondido')", 10000);
    assert.match(await app.avaliar("document.querySelector('#mensagens [data-aprovacao=\"e3\"]').textContent"), /Negado/);
    assert.match(app.ler('.local/share/orq-app/recados/recados.jsonl'), /"id":"e3","mudanca":\{"estado":"negado","motivo":null,"nota":"não fala por mim"/);
    await app.avaliar("document.querySelector('[data-aba=\"aba-recados\"]').click()");
  });

  await t.test('aprovar põe na fila; sem servidor configurado, o motivo aparece; o cartão sai da conversa', async () => {
    await app.avaliar("document.querySelector('[data-rc-decidir=\"e2\"][data-aprovar=\"1\"]').click()");
    await app.esperar("!document.querySelector('[data-rc-decidir=\"e2\"]')");
    await app.esperar("/canal sem configuração/.test((document.querySelector('[data-id=\"e2\"] .recado-motivo') || {}).textContent || '')", 15000);
    assert.strictEqual(await app.avaliar("document.querySelector('[data-id=\"e2\"] .recado-selo-estado').textContent"), 'na fila');
    await app.esperar("(document.querySelector('#mensagens [data-aprovacao=\"e2\"]') || {}).classList?.contains('respondido')", 10000);
    assert.match(await app.avaliar("document.querySelector('#mensagens [data-aprovacao=\"e2\"]').textContent"), /Decidido na aba Recados/);
  });

  await t.test('Configurações mostra o que falta para o canal ligar', async () => {
    await app.avaliar("document.getElementById('abrir-config').click()");
    await app.avaliar("document.getElementById('config-aba-orquestracao').click()");
    await app.esperar("/Falta configurar: falta o endereço do servidor/.test(document.getElementById('config-canal-estado').textContent)", 10000);
    assert.strictEqual(await app.avaliar("document.querySelector('[data-cfg=\"canalContatos\"]').value"), 'Bruno: para-bruno');
    assert.strictEqual(await app.avaliar("document.querySelector('[data-cfg=\"canalAprovarEnvio\"]').checked"), true);
    assert.deepStrictEqual(await app.avaliar("['canalSemAprovarCiente', 'canalSemAprovarInformacao'].map((k) => document.querySelector(`[data-cfg=\"${k}\"]`).checked)"), [false, false], 'por padrão, tudo espera você');
  });

  await t.test('na conversa, o recado de fora aparece por trás, não como balão seu', async () => {
    const msg = '<orq-recado id="e1" de="Bruno" tipo="externo" canal="externo">\nRecado de fora, de Bruno:\no deploy pode ser hoje?\n</orq-recado>';
    await app.avaliar(`window.__orqTeste.desenharEvento(${JSON.stringify({ tipo: 'user', local: true, message: { role: 'user', content: msg } })})`);
    assert.match(await app.avaliar("[...document.querySelectorAll('#mensagens .msg-bastidor-externo summary')].pop().textContent"), /Recado de fora: Bruno/);
    assert.ok(!(await app.avaliar("[...document.querySelectorAll('#mensagens .msg-voce')].some((b) => b.innerText.includes('deploy pode'))")));
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});

// Regressão 2026-11-15: com a interface em inglês, o cartão de aprovação na
// conversa dizia "Recado para Bruno" (a linha inteira estava fora da tradução).
test('canal entre orquestradores: o cartão de aprovação em inglês', async (t) => {
  const app = await abrirApp({ config: { idioma: 'en', canalContatos: [{ nome: 'Bruno', caixa: 'para-bruno' }] }, arquivos: { '.local/share/orq-app/recados/recados.jsonl': log } });
  t.after(() => app.fechar());
  await app.esperar("window.orqI18n && window.orqI18n.idioma() === 'en'", 15000);
  await app.esperar("!!document.querySelector('#mensagens .cartao-aprovacao[data-aprovacao=\"e2\"] legend')", 15000);
  await app.esperar("/Message to Bruno — Re: Deploy/.test(document.querySelector('#mensagens [data-aprovacao=\"e2\"] legend').textContent)", 10000);
  assert.deepStrictEqual(await app.avaliar("[...document.querySelectorAll('#mensagens [data-aprovacao=\"e2\"] .opcao strong')].map((o) => o.textContent)"), ['Approve', 'Deny']);
  assert.match(await app.avaliar("document.querySelector('#mensagens [data-aprovacao=\"e2\"] .opcao span').textContent"), /^Goes out now to Bruno$/);
  // A aba Messages também em inglês: rótulos traduzidos, nomes como estão.
  await app.avaliar("document.querySelector('[data-aba=\"aba-recados\"]').click()");
  await app.esperar("document.querySelectorAll('#recados-linha .recado').length === 1", 10000);
  const e1 = await app.avaliar("(() => { const li = document.querySelector('[data-id=\"e1\"]'); return [li.querySelector('.recado-de').textContent, li.querySelector('.recado-para').textContent, li.querySelector('.recado-selo-tipo').textContent, li.querySelector('.recado-selo-estado').textContent]; })()");
  assert.deepStrictEqual(e1, ['Bruno', 'Orchestrator', 'from another computer', 'delivered']);
  // E o motivo de o canal não estar pronto, em Settings.
  await app.avaliar("document.getElementById('abrir-config').click()");
  await app.avaliar("document.getElementById('config-aba-orquestracao').click()");
  await app.esperar("/^Needs setup: the server address is missing/.test(document.getElementById('config-canal-estado').textContent)", 10000);
});
