// Área: idioma
const test = require('node:test');
const assert = require('node:assert');
const { abrirApp } = require('./app');

// Pedido de 2026-10-30: opção de inglês e português na engrenagem.
test('idioma', async (t) => {
  const app = await abrirApp({ config: { idioma: 'en', comandoInicial: '/rodada', comandoDesligar: '/fim' } });
  t.after(() => app.fechar());
  const abas = () => app.avaliar("[...document.querySelectorAll('.sub-aba .rotulo-aba')].map((e) => e.textContent.trim())");

  await t.test('em inglês, as abas, os botões e as dicas aparecem em inglês', async () => {
    await app.esperar("window.orqI18n && window.orqI18n.idioma() === 'en' && document.querySelector('[data-aba=aba-orquestrador] .rotulo-aba').textContent.trim() === 'Orchestrator'", 15000);
    assert.deepStrictEqual(await abas(), ['Orchestrator', 'Terminals', 'Notes', 'Library', 'Workflows', 'Messages', 'Terminal']);
    assert.strictEqual(await app.avaliar("document.querySelector('#iniciar-rodada .rotulo-botao').textContent.trim()"), 'Start');
    assert.strictEqual(await app.avaliar('document.documentElement.lang'), 'en');
  });

  await t.test('o que aparece depois (lista de workflows) também vem traduzido', async () => {
    await app.avaliar("document.querySelector('[data-aba=aba-workflows]').click()");
    await app.esperar("document.querySelectorAll('[data-wf-aba]').length === 3");
    await app.esperar("[...document.querySelectorAll('[data-wf-aba]')].map((b) => b.textContent).join('|') === 'Workflows|Credentials|Runs'");
  });

  await t.test('conteúdo não é traduzido: o que a conversa mostra fica como veio', async () => {
    await app.avaliar("document.querySelector('[data-aba=aba-orquestrador]').click()");
    await app.avaliar("window.__orqTeste.desenharEvento({ tipo: 'assistant', message: { content: [{ type: 'text', text: 'Notas' }] } })");
    await app.espera(200);
    assert.strictEqual(await app.avaliar("[...document.querySelectorAll('#mensagens .md')].pop().textContent.trim()"), 'Notas');
  });

  await t.test('trocar para português na engrenagem recarrega em português', async () => {
    await app.avaliar("document.getElementById('abrir-config').click()");
    await app.avaliar("(() => { const s = document.querySelector('[data-cfg=idioma]'); s.value = 'pt-BR'; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
    await app.espera(1500);
    await app.esperar("!!document.querySelector('[data-aba=aba-orquestrador] .rotulo-aba') && document.querySelector('[data-aba=aba-orquestrador] .rotulo-aba').textContent.trim() === 'Orquestrador'", 10000);
    assert.strictEqual(JSON.parse(app.ler('.config/orq-app/config.json')).idioma, 'pt-BR');
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
