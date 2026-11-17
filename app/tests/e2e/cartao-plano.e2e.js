// Área: conversa (cartão do plano; plano 2.3, protótipo P2 aprovado em 17/11/2026)
// O plano aparece como texto formatado (não como dado cru), com três saídas: aprovar e
// seguir em Auto, aprovar e perguntar a cada mudança, continuar planejando. Dá para
// editar o plano antes de aprovar. Respondido, recolhe numa linha com "Ver o plano".
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pastaTemporaria } = require('../temporarias');
const { abrirApp } = require('./app');

const linhas = (arq) => { try { return fs.readFileSync(arq, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };

test('cartão do plano', async (t) => {
  const log = path.join(pastaTemporaria('orq-claude-falso-'), 'log.jsonl');
  process.env.CLAUDE_FALSO_LOG = log;
  const app = await abrirApp({ config: { mostrarBichinho: false } });
  t.after(() => { delete process.env.CLAUDE_FALSO_LOG; return app.fechar(); });
  await app.esperar('!!window.__orqTeste');
  const respostas = () => linhas(log).filter((o) => o.type === 'control_response' && /^perm-/.test(o.response.request_id)).map((o) => o.response.response);
  const aberto = "document.querySelector('#mensagens .cartao-plano:not(.respondido)')";
  const pedir = async () => {
    await app.esperar("document.getElementById('parar').hidden", 10000);
    await app.avaliar("window.orq.conversa.mandar('orquestrador', 'pede para sair do plano')");
    await app.esperar(`!!${aberto}`, 8000);
  };
  const clicar = (acao) => app.avaliar(`${aberto}.querySelector('[data-plano="${acao}"]').click()`);
  const fechado = "[...document.querySelectorAll('#mensagens .cartao-plano.respondido')].pop()";
  const esperarResposta = async (n) => { for (let i = 0; i < 50 && respostas().length < n; i++) await app.espera(100); assert.strictEqual(respostas().length, n); return respostas()[n - 1]; };

  await t.test('o plano aparece formatado, sem dado cru, com as três saídas e o Editar', async () => {
    await pedir();
    const v = await app.avaliar(`(() => { const c = ${aberto}; return { texto: c.innerText, titulos: c.querySelectorAll('.plano-texto h1, .plano-texto h2').length, negrito: !!c.querySelector('.plano-texto strong'), codigo: !!c.querySelector('.plano-texto code'), botoes: [...c.querySelectorAll('.saidas-plano [data-plano]')].map((b) => b.dataset.plano), editar: !!c.querySelector('[data-plano="editar"]') }; })()`);
    assert.match(v.texto, /terminou o plano/);
    assert.ok(v.titulos >= 2 && v.negrito && v.codigo, JSON.stringify(v));
    assert.ok(!/"plan"|ExitPlanMode|\\n/.test(v.texto), 'sem JSON cru nem nome de ferramenta');
    assert.deepStrictEqual(v.botoes, ['auto', 'perguntar', 'continuar']);
    assert.strictEqual(v.editar, true);
  });

  await t.test('aprovar e seguir em Auto: a resposta leva o modo; o cartão recolhe e "Ver o plano" abre o plano', async () => {
    await clicar('auto');
    const r = await esperarResposta(1);
    assert.deepStrictEqual([r.behavior, r.updatedPermissions], ['allow', [{ type: 'setMode', mode: 'auto', destination: 'session' }]]);
    assert.match(await app.avaliar(`${fechado}.innerText`), /Plano aprovado[\s\S]*Auto/);
    assert.strictEqual(await app.avaliar(`${fechado}.querySelector('.plano-texto').hidden`), true);
    await app.avaliar(`${fechado}.querySelector('[data-ver-plano]').click()`);
    assert.strictEqual(await app.avaliar(`${fechado}.querySelector('.plano-texto').hidden`), false);
    assert.match(await app.avaliar(`${fechado}.querySelector('.plano-texto').innerText`), /exportar em CSV/);
  });

  await t.test('editar o plano e aprovar perguntando: vai o plano editado e o modo de perguntar', async () => {
    await pedir();
    await clicar('editar');
    assert.ok(await app.avaliar(`${aberto}.querySelector('.plano-editor').value.startsWith('# Plano: exportar em CSV')`), 'o editor traz o Markdown do plano');
    await app.avaliar(`(() => { const e = ${aberto}.querySelector('.plano-editor'); e.value = '# Plano curto\\n\\nSó a função, sem botão.'; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await clicar('perguntar');
    const r = await esperarResposta(2);
    assert.deepStrictEqual([r.updatedInput.plan, r.updatedPermissions[0].mode], ['# Plano curto\n\nSó a função, sem botão.', 'default']);
    const texto = await app.avaliar(`${fechado}.innerText`);
    assert.match(texto, /Plano editado por você e aprovado/);
    assert.match(texto, /pergunta antes de cada mudança/);
    await app.avaliar(`${fechado}.querySelector('[data-ver-plano]').click()`);
    assert.match(await app.avaliar(`${fechado}.querySelector('.plano-texto').innerText`), /Plano curto/, 'o plano guardado é o editado');
  });

  await t.test('"Editar" duas vezes descarta a edição', async () => {
    await pedir();
    await clicar('editar');
    await app.avaliar(`(() => { const e = ${aberto}.querySelector('.plano-editor'); e.value = 'rascunho'; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await clicar('editar');
    assert.ok(!(await app.avaliar(`!!${aberto}.querySelector('.plano-editor')`)));
    await app.avaliar(`${aberto}.focus()`);
    await app.tecla('1', 'Digit1', 49);
    const r = await esperarResposta(3);
    assert.match(r.updatedInput.plan, /^# Plano: exportar em CSV/, 'aprovou o plano original');
  });

  await t.test('continuar planejando leva o ajuste pedido; o cartão diz o que foi pedido', async () => {
    await pedir();
    await app.avaliar(`${aberto}.focus()`);
    await app.tecla('3', 'Digit3', 51);
    await app.esperar(`!!${aberto}.querySelector('.campo-negar')`);
    await app.avaliar(`${aberto}.querySelector('.campo-negar').focus()`);
    await app.texto('ponha no menu 3 pontos');
    assert.strictEqual(respostas().length, 3, 'o número digitado no campo não respondeu');
    await clicar('mandar-ajuste');
    const r = await esperarResposta(4);
    assert.strictEqual(r.behavior, 'deny');
    assert.match(r.message, /continuar planejando[\s\S]*ponha no menu 3 pontos/);
    assert.match(await app.avaliar(`${fechado}.innerText`), /Continua planejando[\s\S]*ponha no menu 3 pontos/);
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
