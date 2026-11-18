// Área: conversa (ao fechar o app, as conversas avulsas ficam na lista, pausadas; plano 3.5)
// Antes, fechar o app tirava toda conversa avulsa da lista. Agora ela fica, marcada como
// pausada, e um clique a traz de volta de onde parou. A opção nas Configurações mantém o
// jeito antigo para quem quiser.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { pastaTemporaria } = require('../temporarias');
const { abrirApp } = require('./app');

const lerLog = (arq) => { try { return fs.readFileSync(arq, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const LATERAL = "[...document.querySelectorAll('.item-conversa')].map((i) => ({ titulo: i.querySelector('.titulo-conversa').innerText, linha: i.querySelector('.pasta-conversa').innerText.replace(/\\s+/g, ' ').trim() }))";
const config = (app) => JSON.parse(app.ler('.config/orq-app/config.json'));

test('fechar e abrir o app: as conversas avulsas ficam pausadas e voltam de onde pararam', async (t) => {
  const log = path.join(pastaTemporaria('orq-claude-falso-'), 'log.jsonl');
  process.env.CLAUDE_FALSO_LOG = log;
  t.after(() => { delete process.env.CLAUDE_FALSO_LOG; });
  const app = await abrirApp({ config: { mostrarBichinho: false } });
  let aberto = app;
  t.after(() => aberto.fechar());
  await app.esperar('!!window.__orqTeste && !!window.orqAnteriores');
  const casa = app.casa;
  let sessao;

  await t.test('preparo: uma conversa avulsa que já conversou e outra que nem começou', async () => {
    const id = await app.avaliar('window.orq.conversa.nova().then((i) => window.__orqTeste.trocar(i).then(() => i))');
    await app.avaliar(`window.orq.conversa.mandar(${JSON.stringify(id)}, 'ajusta o botão de exportar')`);
    await app.esperar("[...document.querySelectorAll('#mensagens .msg-voce')].some((m) => /ajusta o botão/.test(m.innerText))", 8000);
    await app.esperar("document.getElementById('parar').hidden", 8000);
    await app.avaliar('window.orq.conversa.nova()');
    await app.esperar("document.querySelectorAll('.item-conversa').length === 3", 8000);
    for (let i = 0; i < 60 && !sessao; i++) { sessao = (JSON.parse(app.ler('.cache/orq-app/conversas-teste.json')).find((c) => c.id === id) || {}).sessao; if (!sessao) await new Promise((r) => setTimeout(r, 100)); }
    assert.ok(sessao, 'a conversa não ganhou uma sessão');
  });

  await t.test('depois de fechar e abrir o app, a que já conversou está na lista como pausada; a que nem começou saiu', async () => {
    await app.fechar();
    const app2 = await abrirApp({ casa });
    aberto = app2;
    await app2.esperar('!!window.__orqTeste && !!window.orqAnteriores');
    await app2.esperar("document.querySelectorAll('.item-conversa').length >= 1", 8000);
    const l = await app2.avaliar(LATERAL);
    assert.deepStrictEqual(l.map((x) => x.titulo), ['Orquestrador', 'ajusta o botão de exportar']);
    assert.strictEqual(l[1].linha, '~ · pausada');
    assert.strictEqual(await app2.avaliar('window.orqConversa.ativa()'), 'orquestrador', 'o app abriu numa conversa avulsa');
  });

  await t.test('um clique na conversa pausada traz ela de volta, retomando a mesma sessão', async () => {
    const app2 = aberto;
    const antes = lerLog(log).filter((x) => Array.isArray(x.args)).length;
    await app2.avaliar("[...document.querySelectorAll('.item-conversa')][1].querySelector('.abrir-conversa').click()");
    await app2.esperar("window.orqConversa.ativa() !== 'orquestrador'", 8000);
    for (let i = 0; i < 80 && lerLog(log).filter((x) => Array.isArray(x.args)).length === antes; i++) await new Promise((r) => setTimeout(r, 100));
    const args = lerLog(log).filter((x) => Array.isArray(x.args)).pop().args;
    assert.strictEqual(args[args.indexOf('--resume') + 1], sessao);
    await app2.esperar(`/^~ · (pronta|trabalhando)$/.test((${LATERAL})[1].linha)`, 8000);
  });

  await t.test('a opção fica em Configurações › Orquestração e, trocada para "Saem da lista", vale no próximo fechamento', async () => {
    const app2 = aberto;
    await app2.avaliar("document.getElementById('abrir-config').click()");
    await app2.avaliar("document.querySelector('[data-secao-config=\"orquestracao\"]').click()");
    assert.strictEqual(await app2.visivel('#config-ao-fechar'), 'ok');
    assert.deepStrictEqual(await app2.avaliar("[...document.querySelectorAll('#config-ao-fechar button')].map((b) => [b.innerText, b.getAttribute('aria-pressed')])"), [['Ficam pausadas', 'true'], ['Saem da lista', 'false']]);
    await app2.avaliar("document.querySelector('#config-ao-fechar [data-v=saem]').click()");
    await app2.esperar("document.querySelector('#config-ao-fechar [data-v=saem]').getAttribute('aria-pressed') === 'true'", 4000);
    for (let i = 0; i < 40 && config(app2).conversasAoFechar !== 'saem'; i++) await new Promise((r) => setTimeout(r, 100));
    assert.strictEqual(config(app2).conversasAoFechar, 'saem');
    await app2.avaliar("document.getElementById('fechar-config').click()");
    await app2.fechar();
    const app3 = await abrirApp({ casa });
    aberto = app3;
    await app3.esperar('!!window.__orqTeste && !!window.orqAnteriores');
    await app3.esperar("document.querySelectorAll('.item-conversa').length >= 1", 8000);
    await new Promise((r) => setTimeout(r, 400));
    assert.deepStrictEqual((await app3.avaliar(LATERAL)).map((x) => x.titulo), ['Orquestrador']);
    assert.deepStrictEqual(app3.erros, []);
  });
});

test('a opção de fechar o app em inglês', async (t) => {
  const app = await abrirApp({ config: { idioma: 'en', mostrarBichinho: false } });
  t.after(() => app.fechar());
  await app.esperar('!!window.__orqTeste');
  await app.avaliar("document.getElementById('abrir-config').click()");
  await app.avaliar("document.querySelector('[data-secao-config=\"orquestracao\"]').click()");
  assert.deepStrictEqual(await app.avaliar("[...document.querySelectorAll('#config-ao-fechar button')].map((b) => b.innerText)"), ['Stay paused', 'Leave the list']);
  assert.match(await app.avaliar("document.getElementById('config-ao-fechar').closest('.config-linha').querySelector('strong').innerText"), /^When the app closes, the side conversations…$/);
  assert.deepStrictEqual(app.erros, []);
});
