// Área: conversa (resposta secreta do Codex na tela)
// 0.A3 da Etapa 0: a pergunta com isSecret vira campo de senha; depois de
// responder, o valor não fica no DOM (o cartão mostra •••). Duas perguntas com
// o mesmo texto recebem cada uma a sua resposta (casadas pelo id).
const test = require('node:test');
const { pastaTemporaria } = require('../temporarias');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { abrirApp } = require('./app');

const FALSO = path.join(__dirname, '..', 'unit', 'codex-falso.js');
const SEGREDO = 'S3nh4-da-tela-7713';

test('resposta secreta do Codex', async (t) => {
  const LOG = path.join(pastaTemporaria('orq-codex-falso-'), 'log.jsonl');
  process.env.CODEX_FALSO_LOG = LOG;
  process.env.CODEX_FALSO_PERGUNTAS = JSON.stringify([
    { id: 'qa', header: 'Acesso', question: 'Qual a senha?', isSecret: true, isOther: true, options: null },
    { id: 'qb', header: 'Outra', question: 'Qual a senha?', isSecret: false, isOther: true, options: null },
  ]);
  const app = await abrirApp({ config: { iaOrquestrador: 'codex', iasCaminhos: { codex: FALSO } } });
  t.after(() => { delete process.env.CODEX_FALSO_PERGUNTAS; return app.fechar(); });
  await app.esperar('!!window.__orqTeste');
  await app.avaliar("window.orq.conversa.mandar('orquestrador', 'oi')");
  await app.esperar("document.querySelectorAll('#mensagens .cartao-pedido .pergunta').length === 2", 10000);

  await t.test('a pergunta secreta vira campo de senha; a outra continua texto', async () => {
    const tipos = await app.avaliar("[...document.querySelectorAll('#mensagens .cartao-pedido .pergunta')].map((f) => { const c = f.querySelector('.outra'); return c ? (c.type || c.tagName) : null; })");
    assert.deepStrictEqual(tipos, ['password', 'textarea']);
    assert.match(await app.avaliar("document.querySelector('#mensagens .cartao-pedido').innerText"), /resposta secreta/i);
  });

  await t.test('respondida, o valor não fica no DOM e cada pergunta leva a sua resposta', async () => {
    await app.avaliar("document.querySelector('#mensagens .cartao-pedido .pergunta[data-i=\"0\"] .outra').focus()");
    await app.texto(SEGREDO);
    await app.avaliar("document.querySelector('#mensagens .cartao-pedido .pergunta[data-i=\"1\"] .outra').focus()");
    await app.texto('publico');
    await app.avaliar("document.querySelector('#mensagens .cartao-pedido [data-enviar-resposta]').click()");
    await app.esperar("!!document.querySelector('#mensagens .cartao-pedido.respondido')", 10000);
    const html = await app.avaliar('document.body.innerHTML');
    assert.ok(!html.includes(SEGREDO), 'o segredo não está no DOM');
    assert.match(await app.avaliar("document.querySelector('#mensagens .cartao-pedido.respondido').innerText"), /•••[\s\S]*publico/);
    let resposta = null;
    for (let i = 0; i < 50 && !resposta; i++) {
      await app.espera(100);
      resposta = fs.readFileSync(LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).find((x) => x.id === 99 && !x.method);
    }
    assert.deepStrictEqual(resposta.result, { answers: { qa: { answers: [SEGREDO] }, qb: { answers: ['publico'] } } });
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
