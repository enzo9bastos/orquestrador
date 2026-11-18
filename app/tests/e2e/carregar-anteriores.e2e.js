// Área: conversa (conversa reaberta: a faixa "carregar as anteriores"; plano 3.4)
// A conversa reaberta mostra só as últimas 600 mensagens. Antes não havia aviso nem como ver as
// de antes. Agora uma faixa no topo diz que há mensagens mais antigas e as traz, e a tela fica
// onde a pessoa estava lendo.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { pastaTemporaria } = require('../temporarias');
const { abrirApp } = require('./app');

// Uma conversa guardada com N mensagens ("mensagem 1" … "mensagem N").
function guardar(casa, quantas) {
  const sessao = 'sessao-comprida-de-tela-01';
  const dir = path.join(casa, '.claude', 'projects', casa.replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  const linhas = [];
  for (let i = 1; i <= quantas; i++) {
    linhas.push(i % 2 ? JSON.stringify({ type: 'user', message: { role: 'user', content: `mensagem ${i}` }, cwd: casa })
      : JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: `mensagem ${i}` }] } }));
  }
  fs.writeFileSync(path.join(dir, `${sessao}.jsonl`), `${linhas.join('\n')}\n`);
  return sessao;
}
const TEM = (n) => `new RegExp('(^|\\\\D)mensagem ${n}(\\\\D|$)').test(document.getElementById('mensagens').innerText)`;
const FAIXA = "document.querySelector('#mensagens .carregar-anteriores')";

for (const idioma of ['pt-BR', 'en']) {
  test(`conversa reaberta: carregar as mensagens anteriores (${idioma})`, async (t) => {
    process.env.CLAUDE_FALSO_LOG = path.join(pastaTemporaria('orq-claude-falso-'), 'log.jsonl');
    const app = await abrirApp({ config: { mostrarBichinho: false, idioma } });
    t.after(() => { delete process.env.CLAUDE_FALSO_LOG; return app.fechar(); });
    await app.esperar('!!window.__orqTeste && !!window.orqAnteriores');
    const sessao = guardar(app.casa, 700);
    const en = idioma === 'en';

    await t.test('reaberta, a conversa mostra as mais recentes e a faixa no topo avisa que há mais antigas', async () => {
      await app.avaliar(`window.orq.anteriores.reabrir(${JSON.stringify(sessao)}).then((r) => window.__orqTeste.trocar(r.id))`);
      await app.esperar(TEM(700), 10000);
      assert.strictEqual(await app.avaliar(TEM(101)), true);
      assert.strictEqual(await app.avaliar(TEM(100)), false, 'a mensagem 100 não devia estar na tela antes de carregar');
      assert.strictEqual(await app.avaliar(`${FAIXA} !== null && ${FAIXA} === document.getElementById('mensagens').firstElementChild`), true, 'a faixa não está no topo da conversa');
      assert.strictEqual(await app.avaliar(`${FAIXA}.querySelector('span').innerText`), en ? 'This conversation has older messages that are not on screen.' : 'Esta conversa tem mensagens mais antigas, que não estão na tela.');
      assert.strictEqual(await app.avaliar(`${FAIXA}.querySelector('button').innerText`), en ? 'Load the earlier ones' : 'Carregar as anteriores');
    });

    await t.test('carregar traz as de antes para cima, em ordem, e a tela fica onde a pessoa estava lendo', async () => {
      // Sobe até o topo (onde fica a faixa) e guarda onde estava a primeira mensagem.
      await app.avaliar("document.getElementById('mensagens').scrollTop = 0");
      const antes = await app.avaliar("(() => { const c = document.getElementById('mensagens'); const m = [...c.querySelectorAll('.msg-voce')].find((x) => /mensagem 101$/.test(x.innerText.trim())); return { topo: Math.round(m.getBoundingClientRect().top), doFim: c.scrollHeight - c.scrollTop }; })()");
      await app.avaliar(`${FAIXA}.querySelector('[data-carregar-anteriores]').click()`);
      await app.esperar(TEM(1), 10000);
      assert.strictEqual(await app.avaliar(TEM(100)), true);
      assert.strictEqual(await app.avaliar(TEM(700)), true);
      const ordem = await app.avaliar("(() => { const t = document.getElementById('mensagens').innerText; return [t.indexOf('mensagem 1\\n') >= 0 || /mensagem 1(\\D|$)/.test(t), t.search(/mensagem 99(\\D|$)/) < t.search(/mensagem 101(\\D|$)/), t.search(/mensagem 101(\\D|$)/) < t.search(/mensagem 700(\\D|$)/)]; })()");
      assert.deepStrictEqual(ordem, [true, true, true]);
      const depois = await app.avaliar("(() => { const c = document.getElementById('mensagens'); const m = [...c.querySelectorAll('.msg-voce')].find((x) => /mensagem 101$/.test(x.innerText.trim())); return { topo: Math.round(m.getBoundingClientRect().top), rolou: c.scrollTop > 0 }; })()");
      assert.ok(Math.abs(depois.topo - antes.topo) <= 40, `a tela pulou: a mensagem 101 estava em ${antes.topo} px e foi para ${depois.topo} px`);
      assert.strictEqual(depois.rolou, true, 'a tela foi para o topo em vez de ficar onde estava');
      // Não havia mais nada antes: a faixa vira a marca de início, sem botão.
      assert.strictEqual(await app.avaliar(`${FAIXA}.innerText.trim()`), en ? 'Start of the conversation' : 'Início da conversa');
      assert.strictEqual(await app.avaliar(`${FAIXA}.querySelector('button')`), null);
    });

    await t.test('conversa nova não tem a faixa; sem erros na tela', async () => {
      await app.avaliar('window.orq.conversa.nova().then((i) => window.__orqTeste.trocar(i))');
      await app.esperar("!!document.querySelector('#mensagens .boas-vindas')", 8000);
      assert.strictEqual(await app.avaliar(`${FAIXA}`), null);
      assert.deepStrictEqual(app.erros, []);
    });
  });
}
