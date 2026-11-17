// Área: conversa (menu de modelo completo do P1: opusplan, Outros recolhido, esforço em uma linha, modo rápido)
// Plano 2.1 e 2.4. Conferido na documentação do Claude Code (model-config e
// fast-mode, 17/11/2026): os apelidos opusplan, fable e default existem; os
// modelos atuais já têm contexto de 1 milhão (o sufixo [1m] não muda nada,
// por isso o menu não tem esse interruptor); o modo rápido só existe em Opus e
// Fable e é cobrado à parte, em créditos de uso.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pastaTemporaria } = require('../temporarias');
const { abrirApp } = require('./app');

const linhas = (arq) => { try { return fs.readFileSync(arq, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };

test('menu de modelo completo', async (t) => {
  const log = path.join(pastaTemporaria('orq-claude-falso-'), 'log.jsonl');
  process.env.CLAUDE_FALSO_LOG = log;
  const app = await abrirApp({ config: { mostrarBichinho: false } });
  t.after(() => { delete process.env.CLAUDE_FALSO_LOG; return app.fechar(); });
  await app.esperar('!!window.__orqTeste');
  await app.avaliar("window.orq.conversa.mandar('orquestrador', 'oi')");
  await app.esperar("[...document.querySelectorAll('#mensagens .texto-claude')].length > 0", 10000);
  const controles = (sub) => linhas(log).filter((o) => o.type === 'control_request' && o.request && o.request.subtype === sub).map((o) => o.request);
  const abrir = async () => { if (await app.avaliar("document.getElementById('menu-modelo').hidden")) await app.avaliar("document.getElementById('botao-modelo').click()"); await app.esperar("!document.getElementById('menu-modelo').hidden"); };
  const fechar = () => app.avaliar("document.getElementById('mensagens').click()");
  const modeloNoChip = () => app.avaliar("document.getElementById('info-modelo').textContent");
  const tecla = (key, vk) => app.tecla(key, key, vk);
  const escondido = (sel) => app.avaliar(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !e || e.hidden || e.offsetParent === null; })()`);

  await t.test('os quatro principais à vista, com o nome técnico; "Outros modelos" começa recolhido', async () => {
    await abrir();
    assert.deepStrictEqual(await app.avaliar("[...document.querySelectorAll('#opcoes-modelo [data-modelo]')].map((b) => [b.dataset.modelo, b.querySelector('.nome-tecnico').textContent])"),
      [['opus', 'opus'], ['sonnet', 'sonnet'], ['haiku', 'haiku'], ['opusplan', 'opusplan']]);
    assert.match(await app.avaliar("document.querySelector('#opcoes-modelo [data-modelo=opusplan]').innerText"), /Opus planeja, Sonnet executa/);
    assert.strictEqual(await app.avaliar("document.querySelector('#menu-modelo .menu-outros').open"), false);
    assert.deepStrictEqual(await app.avaliar("[...document.querySelectorAll('#menu-modelo .menu-outros [data-modelo]')].map((b) => b.dataset.modelo)"), ['fable', '']);
    assert.ok(await app.avaliar("!document.querySelector('#menu-modelo [data-chave=\"1m\"]')"), 'sem interruptor de 1M: os modelos atuais já têm');
  });

  await t.test('"Opus planeja, Sonnet executa" troca por set_model com opusplan, sem reiniciar', async () => {
    const subidas = linhas(log).filter((o) => o.args).length;
    await app.avaliar("document.querySelector('#opcoes-modelo [data-modelo=opusplan]').click()");
    await app.esperar("document.getElementById('info-modelo').textContent === 'Opus + Sonnet'", 8000);
    assert.strictEqual(controles('set_model').at(-1).model, 'opusplan');
    assert.strictEqual(linhas(log).filter((o) => o.args).length, subidas, 'nada de reinício');
    await abrir();
    assert.strictEqual(await app.avaliar("document.querySelector('#opcoes-modelo [data-modelo=opusplan]').getAttribute('aria-checked')"), 'true');
  });

  await t.test('Outros modelos: Fable 5.2 pelo id atual; "Padrão da conta" tira a escolha (set_model sem modelo)', async () => {
    await app.avaliar("document.querySelector('#menu-modelo .menu-outros summary').click()");
    await app.avaliar("document.querySelector('#menu-modelo .menu-outros [data-modelo=fable]').click()");
    await app.esperar("document.getElementById('info-modelo').textContent === 'Fable 5.2'", 8000);
    assert.strictEqual(controles('set_model').at(-1).model, 'claude-fable-5-2');
    await abrir();
    assert.strictEqual(await app.avaliar("document.querySelector('#menu-modelo .menu-outros').open"), true, 'com um modelo de lá escolhido, "Outros" já abre');
    const n = controles('set_model').length;
    await app.avaliar("document.querySelector('#menu-modelo .menu-outros [data-modelo=\"\"]').click()");
    for (let i = 0; i < 50 && controles('set_model').length === n; i++) await app.espera(100);
    assert.strictEqual(controles('set_model').at(-1).model, undefined, 'sem modelo no pedido: volta ao padrão');
  });

  await t.test('esforço numa linha: ◂ ▸ e as setas ← → mudam um nível; clicar numa barrinha vai direto', async () => {
    await abrir();
    await app.avaliar("document.querySelector('#opcoes-esforco [data-esforco=medium]').click()");
    await app.esperar("/Médio/.test(document.getElementById('info-esforco').textContent)", 8000);
    await abrir();
    await tecla('ArrowRight', 39);
    await app.esperar("/Alto/.test(document.getElementById('info-esforco').textContent)", 8000);
    assert.ok(await app.avaliar("!document.getElementById('menu-modelo').hidden"), 'as setas não fecham o menu');
    await app.avaliar("document.querySelector('#opcoes-esforco [data-passo=\"-1\"]').click()");
    await app.esperar("/Médio/.test(document.getElementById('info-esforco').textContent)", 8000);
    await tecla('ArrowLeft', 37);
    await app.esperar("/Baixo/.test(document.getElementById('info-esforco').textContent)", 8000);
    assert.ok(await app.avaliar("document.querySelector('#opcoes-esforco [data-passo=\"-1\"]').disabled"), 'no mais baixo, o ◂ fica desligado');
    assert.deepStrictEqual(controles('apply_flag_settings').map((r) => r.settings.effortLevel).filter(Boolean), ['medium', 'high', 'medium', 'low']);
    await fechar();
  });

  await t.test('modo rápido: interruptor só em modelo que tem (Opus, Fable); liga ao vivo e o chip ganha o selo', async () => {
    await abrir();
    await app.avaliar("document.querySelector('#opcoes-modelo [data-modelo=sonnet]').click()");
    await app.esperar("document.getElementById('info-modelo').textContent === 'Sonnet 5.5'", 8000);
    await abrir();
    assert.ok(await escondido('#menu-modelo [data-chave=rapido]'), 'Sonnet não tem modo rápido');
    await app.avaliar("document.querySelector('#opcoes-modelo [data-modelo=opus]').click()");
    await app.esperar("document.getElementById('info-modelo').textContent === 'Opus 5.5'", 8000);
    await abrir();
    assert.strictEqual(await app.visivel('#menu-modelo [data-chave=rapido]'), 'ok');
    assert.match(await app.avaliar("document.querySelector('#menu-modelo [data-chave=rapido]').innerText"), /cobrado à parte, em créditos de uso/);
    assert.ok(await escondido('#selo-rapido'));
    await app.avaliar("document.querySelector('#menu-modelo [data-chave=rapido]').click()");
    await app.esperar("!document.getElementById('selo-rapido').hidden", 8000);
    assert.deepStrictEqual(controles('apply_flag_settings').at(-1).settings, { fastMode: true });
    await abrir();
    assert.strictEqual(await app.avaliar("document.querySelector('#menu-modelo [data-chave=rapido]').getAttribute('aria-checked')"), 'true');
    await app.avaliar("document.querySelector('#menu-modelo [data-chave=rapido]').click()");
    await app.esperar("document.getElementById('selo-rapido').hidden", 8000);
    assert.deepStrictEqual(controles('apply_flag_settings').at(-1).settings, { fastMode: false });
    await fechar();
  });

  await t.test('as setas ↑ ↓ andam pelas opções do menu', async () => {
    await abrir();
    await tecla('ArrowDown', 40);
    const a = await app.avaliar("document.activeElement && document.activeElement.dataset.modelo");
    await tecla('ArrowDown', 40);
    const b = await app.avaliar("document.activeElement && document.activeElement.dataset.modelo");
    assert.ok(a != null && b != null && a !== b, `${a} → ${b}`);
    await fechar();
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
