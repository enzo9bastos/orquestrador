// Área: recados (canal entre orquestradores de computadores diferentes)
const test = require('node:test');
const assert = require('node:assert');
const { abrirApp } = require('./app');

const agora = Date.now();
const log = [
  { id: 'e1', ts: agora - 9000, canal: true, canalId: 'n1', de: { tipo: 'externo', nome: 'Bruno' }, para: { tipo: 'orquestrador' }, tipo: 'externo', texto: 'o deploy de vocês pode ser hoje?', titulo: 'Deploy', estado: 'entregue', motivo: null },
  { id: 'e2', ts: agora - 5000, canal: true, de: { tipo: 'orquestrador' }, para: { tipo: 'externo', nome: 'Bruno', caixa: 'para-bruno' }, tipo: 'externo', texto: 'pode, às 17h', titulo: 'Re: Deploy', estado: 'aguardando', motivo: 'vai sair deste computador: espera você aprovar' },
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
    await app.esperar("document.querySelectorAll('#recados-linha .recado').length === 2");
    const l = await app.avaliar("[...document.querySelectorAll('#recados-linha .recado')].map((li) => ({ id: li.dataset.id, de: li.querySelector('.recado-de').textContent, para: li.querySelector('.recado-para').textContent, tipo: li.querySelector('.recado-selo-tipo').textContent, decidir: !!li.querySelector('[data-rc-decidir]'), texto: li.innerText }))");
    assert.deepStrictEqual(l.map((x) => [x.id, x.de, x.para, x.tipo, x.decidir]), [['e2', 'Orquestrador', 'Bruno', 'de outro computador', true], ['e1', 'Bruno', 'Orquestrador', 'de outro computador', false]]);
    assert.match(l[0].texto, /Sai deste computador para Bruno \(caixa para-bruno\) se você aprovar/);
    assert.match(l[1].texto, /Deploy/);
    assert.strictEqual(await app.avaliar("document.getElementById('n-recados-atencao').textContent"), '1');
  });

  await t.test('aprovar põe na fila; sem servidor configurado, o motivo aparece', async () => {
    await app.avaliar("document.querySelector('[data-rc-decidir=\"e2\"][data-aprovar=\"1\"]').click()");
    await app.esperar("!document.querySelector('[data-rc-decidir=\"e2\"]')");
    await app.esperar("/canal sem configuração/.test((document.querySelector('[data-id=\"e2\"] .recado-motivo') || {}).textContent || '')", 15000);
    assert.strictEqual(await app.avaliar("document.querySelector('[data-id=\"e2\"] .recado-selo-estado').textContent"), 'na fila');
  });

  await t.test('Configurações mostra o que falta para o canal ligar', async () => {
    await app.avaliar("document.getElementById('abrir-config').click()");
    await app.avaliar("document.getElementById('config-aba-orquestracao').click()");
    await app.esperar("/Falta configurar: falta o endereço do servidor/.test(document.getElementById('config-canal-estado').textContent)", 10000);
    assert.strictEqual(await app.avaliar("document.querySelector('[data-cfg=\"canalContatos\"]').value"), 'Bruno: para-bruno');
    assert.strictEqual(await app.avaliar("document.querySelector('[data-cfg=\"canalAprovarEnvio\"]').checked"), true);
  });

  await t.test('na conversa, o recado de fora aparece por trás, não como balão seu', async () => {
    const msg = '<orq-recado id="e1" de="Bruno" tipo="externo" canal="externo">\nRecado de fora, de Bruno:\no deploy pode ser hoje?\n</orq-recado>';
    await app.avaliar(`window.__orqTeste.desenharEvento(${JSON.stringify({ tipo: 'user', local: true, message: { role: 'user', content: msg } })})`);
    assert.match(await app.avaliar("[...document.querySelectorAll('#mensagens .msg-bastidor-externo summary')].pop().textContent"), /Recado de fora: Bruno/);
    assert.ok(!(await app.avaliar("[...document.querySelectorAll('#mensagens .msg-voce')].some((b) => b.innerText.includes('deploy pode'))")));
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
