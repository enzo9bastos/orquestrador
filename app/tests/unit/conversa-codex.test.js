// Área: conversa
// O orquestrador conduzido pelo Codex (conversa-codex.js), com um Codex falso
// que fala o protocolo do `codex app-server`.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { casaTemporaria, escrever } = require('../ajuda');

const FALSO = path.join(__dirname, 'codex-falso.js');
const casa = casaTemporaria({ iasCaminhos: { codex: FALSO }, iaOrquestrador: 'codex' });
const LOG = path.join(casa, 'codex-falso.log');
process.env.CODEX_FALSO_LOG = LOG;
escrever(casa, '.codex/skills/orquestrar-app/SKILL.md', '---\nname: orquestrar-app\ndescription: Rodada pelo app\n---\nx');
const conversa = require('../../conversa');
const codex = require('../../conversa-codex');
const t = codex._t;

const recebidos = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
const telas = [];
conversa.ligar((canal, dado) => telas.push({ canal, ...dado }));
const avisos = [];
conversa.ligarAvisos((a) => avisos.push(a));
async function ate(cond, ms = 8000) {
  for (let i = 0; i < ms / 20; i++) { if (cond()) return; await new Promise((r) => setTimeout(r, 20)); }
  throw new Error('não aconteceu a tempo');
}

test('codex: comando sem o invólucro do bash', () => {
  assert.strictEqual(t.comandoLimpo({ command: "/bin/bash -lc 'tmux ls | wc -l'" }), 'tmux ls | wc -l');
  assert.strictEqual(t.comandoLimpo({ command: "/bin/bash -lc 'echo '\\''a'\\'''" }), "echo 'a'");
  assert.strictEqual(t.comandoLimpo({ command: 'x', commandActions: [{ command: 'orq peek a' }] }), 'orq peek a');
});

test('codex: pergunta com opções vira o cartão do AskUserQuestion e a resposta volta pelo id', () => {
  const params = { questions: [{ id: 'q1', header: 'Cor', question: 'Qual cor?', options: [{ label: 'Azul', description: 'a' }] }, { id: 'q2', header: 'X', question: 'Outra?', options: null }] };
  const p = t.pedidoDaTela('item/tool/requestUserInput', params);
  assert.strictEqual(p.ferramenta, 'AskUserQuestion');
  assert.deepStrictEqual(p.entrada.questions[0], { question: 'Qual cor?', header: 'Cor', multiSelect: false, options: [{ label: 'Azul', description: 'a' }] });
  assert.deepStrictEqual(t.respostaAoServidor('item/tool/requestUserInput', params, { permitir: true, respostas: { 'Qual cor?': 'Azul' } }),
    { answers: { q1: { answers: ['Azul'] }, q2: { answers: [] } } });
  assert.deepStrictEqual(t.respostaAoServidor('item/tool/requestUserInput', params, { permitir: false }), { answers: { q1: { answers: [] }, q2: { answers: [] } } });
});

test('codex: aprovação de comando vira "Permitir?" e a decisão vira accept/decline', () => {
  const p = t.pedidoDaTela('item/commandExecution/requestApproval', { command: "/bin/bash -lc 'docker ps'", reason: 'fora do sandbox' });
  assert.deepStrictEqual(p, { ferramenta: 'Bash', entrada: { command: 'docker ps' }, motivo: 'fora do sandbox' });
  assert.deepStrictEqual(t.respostaAoServidor('item/commandExecution/requestApproval', {}, { permitir: true }), { decision: 'accept' });
  assert.deepStrictEqual(t.respostaAoServidor('item/commandExecution/requestApproval', {}, { permitir: false }), { decision: 'decline' });
  assert.strictEqual(t.pedidoDaTela('item/tool/call', {}), null, 'pedido desconhecido não vira cartão');
});

test('codex: cota do plano: janela curta no "5 h", a longa com o tamanho dela', () => {
  assert.deepStrictEqual(t.cotaDaConta({ primary: { usedPercent: 12.4, windowDurationMins: 300 }, secondary: { usedPercent: 40, windowDurationMins: 10080 } }), { uso5h: 12, uso7d: 40, rotuloLongo: '7 dias' });
  assert.deepStrictEqual(t.cotaDaConta({ primary: { usedPercent: 2, windowDurationMins: 43200 }, secondary: null }), { uso7d: 2, rotuloLongo: '30 dias' });
});

test('codex: "/skill" vira entrada de skill quando ela existe; senão é texto', () => {
  const e = t.entradaDoTexto('/orquestrar-app');
  assert.deepStrictEqual(e[0], { type: 'skill', name: 'orquestrar-app', path: path.join(casa, '.codex', 'skills', 'orquestrar-app', 'SKILL.md') });
  assert.strictEqual(e[1].text, '/orquestrar-app');
  assert.deepStrictEqual(t.entradaDoTexto('/nao-existe oi'), [{ type: 'text', text: '/nao-existe oi', text_elements: [] }]);
  assert.strictEqual(t.entradaDoTexto('', [{ tipo: 'image/png', dados: 'QUJD' }])[0].url, 'data:image/png;base64,QUJD');
  assert.deepStrictEqual(codex.comandosDoCodex().map((c) => [c.nome, c.descricao]), [['orquestrar-app', 'Rodada pelo app']]);
});

test('codex: uma rodada inteira com o Codex falso', async (t2) => {
  const c = new conversa._Conversa({ id: 'cx', titulo: 'Orquestrador', orquestrador: true });
  t2.after(() => c.parar());
  assert.strictEqual(c.motor, 'claude', 'nasce como estava guardada');
  c.mandar('/orquestrar-app');
  assert.strictEqual(c.motor, 'codex', 'ao subir, segue a IA do orquestrador da configuração');
  await ate(() => c.pendentes.size === 1);

  // Sobe com a proteção escolhida e a pergunta ligada.
  const r = recebidos();
  assert.deepStrictEqual(r[0].args, ['app-server', '--enable', 'default_mode_request_user_input', '-c', 'suppress_unstable_features_warning=true']);
  const inicio = r.find((x) => x.method === 'thread/start').params;
  assert.deepStrictEqual([inicio.approvalPolicy, inicio.approvalsReviewer, inicio.sandbox], ['untrusted', 'auto_review', 'danger-full-access']);
  const turno = r.find((x) => x.method === 'turn/start').params;
  assert.strictEqual(turno.threadId, 'th-novo');
  assert.strictEqual(turno.input[0].type, 'skill', 'o comando inicial vai como skill do Codex');
  assert.strictEqual(c.sessao, 'th-novo');

  // Texto, comando e pergunta chegam à tela no formato do Claude.
  const ev = c.eventos;
  assert.ok(ev.some((e) => e.tipo === 'assistant' && e.message.content[0].text === 'Olá'));
  const uso = ev.find((e) => e.tipo === 'assistant' && e.message.content[0].type === 'tool_use').message.content[0];
  assert.deepStrictEqual([uso.name, uso.input.command], ['Bash', 'orq send x']);
  assert.ok(ev.some((e) => e.tipo === 'user' && e.message.content[0].type === 'tool_result' && e.message.content[0].content === 'enviado'));
  assert.ok(telas.some((x) => x.canal === 'conversa:parcial' && x.dado === 'Ol'));
  const pedido = [...c.pendentes.values()][0];
  assert.strictEqual(pedido.ferramenta, 'AskUserQuestion');
  assert.deepStrictEqual(avisos.at(-1).texto, 'Cor: Qual cor?');

  // A resposta do cartão volta ao Codex; o turno termina.
  c.responder(pedido.id, { permitir: true, respostas: { 'Qual cor?': 'Verde' } });
  await ate(() => c.eventos.some((e) => e.tipo === 'resultado'));
  assert.deepStrictEqual(recebidos().find((x) => x.id === 99 && !x.method).result, { answers: { q1: { answers: ['Verde'] } } });
  assert.match(c.eventos.find((e) => e.tipo === 'erro').texto, /revisor do Codex negou um comando \(risco high\): apagaria arquivos/);
  assert.deepStrictEqual([c.info.contexto, c.info.janela, c.info.uso7d, c.info.rotuloLongo, c.info.ocupado], [1234, 200000, 3, '30 dias', false]);
  assert.strictEqual(avisos.at(-1).tipo, 'resposta');
  assert.strictEqual(avisos.at(-1).texto, 'Olá');

  // Esforço vai no próximo turno ("Máximo" vira o maior do Codex); modelo não troca.
  assert.strictEqual(c.configurar({ modelo: 'opus' }), false);
  assert.strictEqual(c.configurar({ esforco: 'max' }), true);
  c.mandar('de novo');
  await ate(() => recebidos().filter((x) => x.method === 'turn/start').length === 2);
  assert.strictEqual(recebidos().filter((x) => x.method === 'turn/start')[1].params.effort, 'xhigh');
  assert.throws(() => c.voltar(0, 'de novo'), /ainda não funciona com o Codex/);
  c.parar();
});

test('codex: retomar traz o histórico; conversa sumida começa outra e guarda a velha', async () => {
  const velha = new conversa._Conversa({ id: 'cv', titulo: 'V', motor: 'codex', sessao: 'th-velho' });
  velha.iniciar();
  try {
    await ate(() => velha.eventos.length >= 4);
    const resumo = (c) => (typeof c === 'string' ? c : c[0].text || c[0].type);
    assert.deepStrictEqual(velha.eventos.map((e) => [e.tipo, e.antigo, resumo(e.message.content)]),
      [['user', true, 'oi antigo'], ['assistant', true, 'tool_use'], ['user', true, 'tool_result'], ['assistant', true, 'resposta antiga']]);
  } finally { velha.parar(); }

  const sumida = new conversa._Conversa({ id: 'cs', titulo: 'S', motor: 'codex', sessao: 'th-sumiu' });
  sumida.iniciar();
  try {
    await ate(() => sumida.sessao === 'th-novo');
    assert.deepStrictEqual(sumida.anteriores, ['th-sumiu']);
  } finally { sumida.parar(); }
});

test('codex: trocar a IA do orquestrador guarda a conversa de cada motor', () => {
  const cfg = path.join(casa, '.config', 'orq-app', 'config.json');
  const c = new conversa._Conversa({ id: 'ct', titulo: 'Orquestrador', orquestrador: true, sessao: 'sessao-claude' });
  c.acertarMotor();
  assert.deepStrictEqual([c.motor, c.sessao, c.sessoesMotor.claude], ['codex', null, 'sessao-claude']);
  c.sessao = 'th-x';
  fs.writeFileSync(cfg, JSON.stringify({ iasCaminhos: { codex: FALSO }, iaOrquestrador: 'claude' }));
  c.acertarMotor();
  assert.deepStrictEqual([c.motor, c.sessao, c.sessoesMotor.codex], ['claude', 'sessao-claude', 'th-x']);
  fs.writeFileSync(cfg, JSON.stringify({ iasCaminhos: { codex: FALSO }, iaOrquestrador: 'codex' }));
});
