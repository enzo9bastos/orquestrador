// Área: conversa (motor da conversa na tela: modelo, esforço e /clear; 0.B1 e 0.B5)
// Com o Claude falso de tests/unit/claude-falso.js: trocar modelo e esforço
// pelo menu não reinicia o Claude (o log mostra uma única subida), o modelo
// novo aparece quando o Claude confirma, o esforço vai por apply_flag_settings
// (sem balão; nunca "/effort") e o
// /clear deixa só a divisória "Conversa limpa". Casa temporária, nada real.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { abrirApp } = require('./app');

const CLAUDE_FALSO = path.join(__dirname, '..', 'unit', 'claude-falso.js');

async function abrirComFalso(config = {}) {
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'orq-motor-')), 'log.jsonl');
  process.env.CLAUDE_FALSO_LOG = log;
  const app = await abrirApp({ config: { iasCaminhos: { claude: CLAUDE_FALSO }, ...config } });
  const linhas = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { app, linhas };
}

test('motor da conversa na tela', async (t) => {
  const { app, linhas } = await abrirComFalso();
  t.after(() => app.fechar());
  await app.esperar('!!window.__orqTeste');
  const subidas = () => linhas().filter((x) => x.args).length;
  const baloes = () => app.avaliar("document.querySelectorAll('#mensagens .msg-voce').length");

  await app.avaliar("window.orq.conversa.mandar('orquestrador', 'começa tarefa de fundo')");
  await app.esperar("[...document.querySelectorAll('#mensagens .md')].some((e) => e.textContent.includes('tarefa de fundo começou'))", 10000);
  const tarefa = linhas().find((x) => x.tarefa).tarefa;

  await t.test('o menu não diz mais que a conversa reinicia', async () => {
    await app.avaliar("document.getElementById('botao-modelo').click()");
    await app.esperar("!document.getElementById('menu-modelo').hidden");
    const nota = await app.avaliar("document.querySelector('#menu-modelo .menu-nota').textContent");
    assert.doesNotMatch(nota, /conversa reinicia/);
    assert.match(nota, /sem reiniciar/);
    assert.match(nota, /só o esforço Máximo reinicia/, 'avisa antes do clique que o Máximo reinicia');
    await app.avaliar("document.body.click()");
  });

  await t.test('trocar o modelo pelo menu: set_model, o Claude não reinicia e o chip mostra o modelo confirmado', async () => {
    await app.avaliar("document.getElementById('botao-modelo').click()");
    await app.avaliar("document.querySelector('#opcoes-modelo [data-modelo=sonnet]').click()");
    await app.esperar("document.getElementById('info-modelo').textContent === 'Sonnet 5.5'", 5000);
    assert.ok(linhas().some((x) => x.type === 'control_request' && x.request.subtype === 'set_model' && x.request.model === 'claude-sonnet-5-5'));
    assert.strictEqual(subidas(), 1, 'uma subida só: nada de reinício');
    assert.doesNotThrow(() => process.kill(tarefa, 0), 'a tarefa de fundo continua viva');
  });

  await t.test('trocar o esforço pelo menu: apply_flag_settings (nunca "/effort"), sem balão e sem reinício', async () => {
    const antes = await baloes();
    await app.avaliar("document.getElementById('botao-modelo').click()");
    await app.avaliar("document.querySelector('#opcoes-esforco [data-esforco=high]').click()");
    const pedido = () => linhas().find((x) => x.type === 'control_request' && x.request.subtype === 'apply_flag_settings');
    for (let i = 0; i < 50 && !pedido(); i++) await app.espera(100);
    assert.deepStrictEqual(pedido().request.settings, { effortLevel: 'high' });
    assert.ok(!linhas().some((x) => x.type === 'user' && /^\/effort/.test(x.message.content)), 'nunca manda /effort');
    await app.espera(400);
    assert.strictEqual(await baloes(), antes, 'nenhum balão novo');
    assert.strictEqual(await app.avaliar("document.querySelectorAll('#mensagens .saida-comando').length"), 0, 'nem a saída do comando');
    assert.strictEqual(await app.avaliar("document.getElementById('trabalhando').hidden"), true, 'não fica "trabalhando"');
    assert.match(await app.avaliar("document.getElementById('info-esforco').textContent"), /Alto/);
    assert.strictEqual(subidas(), 1);
  });

  await t.test('/clear limpa a tela e deixa a divisória "Conversa limpa"', async () => {
    await app.avaliar("window.orq.conversa.mandar('orquestrador', '/clear')");
    await app.esperar("!!document.querySelector('#mensagens .conversa-limpa')", 5000);
    assert.strictEqual(await app.avaliar("document.querySelector('#mensagens .conversa-limpa').textContent.trim()"), 'Conversa limpa');
    assert.strictEqual(await app.avaliar("document.querySelectorAll('#mensagens .md, #mensagens .msg-voce').length"), 0, 'o que veio antes saiu da tela');
    // A conversa segue depois da divisória.
    await app.avaliar("window.orq.conversa.mandar('orquestrador', 'depois do clear')");
    await app.esperar("[...document.querySelectorAll('#mensagens .msg-voce')].length === 1", 5000);
    assert.strictEqual(await app.avaliar("document.querySelector('#mensagens > *:not(.boas-vindas)').className"), 'conversa-limpa', 'a divisória fica em cima');
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});

test('motor da conversa em inglês: divisória e nota do menu traduzidas', async (t) => {
  const { app } = await abrirComFalso({ idioma: 'en' });
  t.after(() => app.fechar());
  await app.esperar("window.orqI18n && window.orqI18n.idioma() === 'en' && !!window.__orqTeste", 15000);
  await app.avaliar("window.orq.conversa.mandar('orquestrador', '/clear')");
  await app.esperar("!!document.querySelector('#mensagens .conversa-limpa')", 8000);
  await app.esperar("document.querySelector('#mensagens .conversa-limpa').textContent.trim() === 'Conversation cleared'", 3000);
  assert.match(await app.avaliar("document.querySelector('#menu-modelo .menu-nota').textContent"), /without restarting/);
  assert.deepStrictEqual(app.erros, []);
});
