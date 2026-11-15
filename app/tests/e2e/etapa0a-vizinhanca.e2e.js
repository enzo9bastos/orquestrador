// Área: conversa
// Etapa 0.A (segurança), testador independente: a vizinhança na tela, com um
// Claude falso (anota tudo o que recebe e manda o que cada teste precisa).
// Nada de Claude real: o app roda numa casa temporária.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { abrirApp } = require('./app');

// Claude falso (stream-json): init com slash_commands; a mensagem com
// PERGUNTA vira AskUserQuestion; ELICIT vira um pedido de controle que o app
// não conhece; o resto termina o turno. Grava cada linha recebida no log.
function claudeFalso() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-cf-0a-'));
  const log = path.join(d, 'log.jsonl');
  const bin = path.join(d, 'claude');
  fs.writeFileSync(bin, `#!${process.execPath}
const fs = require('fs');
const LOG = ${JSON.stringify(log)};
if (process.argv[2] === '--version') { console.log('9.9.9 (Claude Code)'); process.exit(0); }
fs.appendFileSync(LOG, JSON.stringify({ args: process.argv.slice(2) }) + '\\n');
const sai = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
sai({ type: 'system', subtype: 'init', session_id: 'S-cf', model: 'claude-falso', cwd: '/', slash_commands: ['compact', 'agents', 'fast', 'minha-skill'] });
let n = 0;
require('readline').createInterface({ input: process.stdin }).on('line', (l) => {
  fs.appendFileSync(LOG, l + '\\n');
  let d; try { d = JSON.parse(l); } catch { return; }
  if (d.type !== 'user') return;
  const t = typeof d.message.content === 'string' ? d.message.content : JSON.stringify(d.message.content);
  if (t.includes('PERGUNTA')) sai({ type: 'control_request', request_id: 'cf-q' + (++n), request: { subtype: 'can_use_tool', tool_name: 'AskUserQuestion',
    input: { questions: [{ header: 'Cor', question: 'Qual cor?', multiSelect: false, options: [{ label: 'Azul', description: '' }, { label: 'Verde', description: '' }] }] } } });
  else if (t.includes('ELICIT')) sai({ type: 'control_request', request_id: 'cf-e' + (++n), request: { subtype: 'elicitation', mcp_server_name: 'x', message: 'Digite a senha' } });
  else sai({ type: 'result', is_error: false, result: 'ok', duration_ms: 1, modelUsage: {} });
});
`, { mode: 0o755 });
  const linhas = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { bin, linhas };
}

test('etapa 0.A: vizinhança na conversa com o Claude', async (t) => {
  const cf = claudeFalso();
  const app = await abrirApp({ config: { iasCaminhos: { claude: cf.bin } } });
  t.after(() => app.fechar());
  await app.esperar('!!window.__orqTeste');
  const respostaDo = (rid) => cf.linhas().find((o) => o.type === 'control_response' && o.response && o.response.request_id === rid);
  async function ate(fn, ms = 8000) {
    for (let i = 0; i < ms / 100; i++) { const v = fn(); if (v) return v; await app.espera(100); }
    return null;
  }
  const digitar = (v) => app.avaliar(`(() => { const e = document.getElementById('entrada'); e.focus(); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input')); })()`);

  await t.test('pergunta com opções do Claude: clicar a opção responde pelo texto da pergunta (0.A3 trocou a chave)', async () => {
    await app.avaliar("window.orq.conversa.mandar('orquestrador', 'PERGUNTA de cor')");
    await app.esperar("!!document.querySelector('#mensagens .cartao-pedido:not(.respondido) .opcao')", 10000);
    assert.strictEqual(await app.avaliar("document.querySelector('#mensagens .cartao-pedido:not(.respondido) .outra')?.tagName"), 'TEXTAREA', 'pergunta comum continua com o campo de texto livre');
    await app.avaliar("[...document.querySelectorAll('#mensagens .cartao-pedido:not(.respondido) .opcao')].find((o) => o.dataset.rotulo === 'Verde').click()");
    const r = await ate(() => respostaDo('cf-q1'));
    assert.ok(r, 'o Claude não recebeu a resposta');
    assert.deepStrictEqual(r.response.response.updatedInput.answers, { 'Qual cor?': 'Verde' });
    assert.match(await app.avaliar("[...document.querySelectorAll('#mensagens .cartao-pedido.respondido')].pop().innerText"), /Verde/, 'a resposta comum continua à vista');
  });

  await t.test('pergunta do Claude respondida por texto livre e Enter', async () => {
    await app.avaliar("window.orq.conversa.mandar('orquestrador', 'PERGUNTA de novo')");
    await app.esperar("!!document.querySelector('#mensagens .cartao-pedido:not(.respondido) .outra')", 10000);
    await app.avaliar("document.querySelector('#mensagens .cartao-pedido:not(.respondido) .outra').focus()");
    await app.texto('Roxo, da Carla');
    await app.tecla('Enter', 'Enter', 13);
    const r = await ate(() => respostaDo('cf-q2'));
    assert.ok(r, 'Enter no texto livre não respondeu');
    assert.deepStrictEqual(r.response.response.updatedInput.answers, { 'Qual cor?': 'Roxo, da Carla' });
  });

  await t.test('pedido de controle que o app não conhece: erro na hora e a conversa não fica travada (0.A5)', async () => {
    await app.avaliar("window.orq.conversa.mandar('orquestrador', 'ELICIT por favor')");
    const r = await ate(() => respostaDo('cf-e3'));
    assert.ok(r, 'o app nunca respondeu o pedido: o Claude fica esperando para sempre');
    assert.strictEqual(r.response.subtype, 'error');
    assert.strictEqual(await app.avaliar("document.querySelectorAll('#mensagens .cartao-pedido:not(.respondido)').length"), 0, 'nenhum cartão pendurado');
  });

  await t.test('"/" + Enter não escolhe /exit e não fecha o app (0.B7)', async () => {
    await digitar('/');
    await app.esperar("!document.getElementById('sugestoes').hidden");
    const primeiro = await app.avaliar("document.querySelector('#sugestoes li .nome-comando').textContent.trim()");
    assert.doesNotMatch(primeiro, /^\/exit\b/, '/exit é o primeiro da lista');
    await app.tecla('Enter', 'Enter', 13);
    await app.espera(300);
    assert.notStrictEqual((await app.avaliar("document.getElementById('entrada').value")).trim(), '/exit');
    await app.tecla('Enter', 'Enter', 13);
    await app.espera(500);
    assert.strictEqual(await app.avaliar('1 + 1'), 2, 'o app fechou');
    await digitar('');
  });

  await t.test('"/ex" + Enter não completa para /exit (0.B7)', async () => {
    await digitar('/ex');
    await app.espera(200);
    await app.tecla('Enter', 'Enter', 13);
    await app.espera(200);
    assert.notStrictEqual((await app.avaliar("document.getElementById('entrada').value")).trim(), '/exit');
    await digitar('');
  });

  await t.test('"/comp" + Enter ainda completa o /compact (o Enter só deixou de completar o /exit)', async () => {
    await digitar('/comp');
    await app.esperar("!document.getElementById('sugestoes').hidden");
    await app.tecla('Enter', 'Enter', 13);
    await app.espera(200);
    assert.strictEqual(await app.avaliar("document.getElementById('entrada').value"), '/compact ');
    await digitar('');
  });

  await t.test('autocompletar ainda traz as skills e comandos do init (minha-skill, compact)', async () => {
    await digitar('/min');
    await app.esperar("!document.getElementById('sugestoes').hidden");
    assert.match(await app.avaliar("document.getElementById('sugestoes').innerText"), /\/minha-skill/);
    await digitar('/comp');
    await app.esperar("!document.getElementById('sugestoes').hidden");
    assert.match(await app.avaliar("document.getElementById('sugestoes').innerText"), /\/compact/);
    await digitar('');
  });

  await t.test('/restart digitado por inteiro reinicia o Claude com --resume', async () => {
    const antes = cf.linhas().filter((o) => o.args).length;
    await digitar('/restart');
    await app.tecla('Enter', 'Enter', 13);
    const depois = await ate(() => { const a = cf.linhas().filter((o) => o.args); return a.length > antes ? a : null; });
    assert.ok(depois, '/restart não subiu o Claude de novo');
    assert.ok(depois.at(-1).args.join(' ').includes('--resume S-cf'));
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
