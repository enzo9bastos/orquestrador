// Área: conversa (registro do que o Claude instalado atende: capacidades.js)
// 0.D3 da Etapa 0, na versão da decisão D16.1: nada some do app. O app só
// REGISTRA, por versão do CLI, quais subtipos de pedido de controle o Claude
// atende; o resto do app consulta com conversa.capacidades(id). Pedido com
// efeito (interrupt, set_model…) nunca é sondado: aprende-se no primeiro uso.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { casaTemporaria } = require('../ajuda');

const FALSO = path.join(__dirname, 'claude-falso.js');
const casa = casaTemporaria({ iasCaminhos: { claude: FALSO } });
let LOG = null;
let nLog = 0;
function novoLog() { LOG = path.join(casa, `claude-falso-${++nLog}.log`); process.env.CLAUDE_FALSO_LOG = LOG; }
novoLog();
const capacidades = require('../../capacidades');
const conversa = require('../../conversa');
conversa.ligar(() => {});
conversa.ligarAvisos(() => {});

const recebidos = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
const pedidos = () => recebidos().filter((x) => x.type === 'control_request');
async function ate(cond, ms = 8000) {
  for (let i = 0; i < ms / 20; i++) { if (cond()) return; await new Promise((r) => setTimeout(r, 20)); }
  throw new Error('não aconteceu a tempo');
}
const turnos = (c) => c.eventos.filter((e) => e.tipo === 'resultado').length;
// Variáveis do falso e da sonda só dentro de cada teste.
function ambiente(t, vars) {
  const antes = {};
  for (const [k, v] of Object.entries(vars)) { antes[k] = process.env[k]; process.env[k] = v; }
  t.after(() => { for (const [k, v] of Object.entries(antes)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
}
let n = 0;
function nova(t) {
  const c = new conversa._Conversa({ id: `cap${++n}`, titulo: `Conversa ${n + 1}` });
  t.after(() => c.parar());
  return c;
}
const COM_EFEITO = ['interrupt', 'set_model', 'set_permission_mode', 'rewind_files', 'apply_flag_settings', 'stop_task', 'background_tasks', 'side_question', 'submit_feedback'];

// --- a leitura da resposta ---------------------------------------------------
test('capacidades: sucesso = atende; unsupported_request (código ou só as palavras, CLI antigo) = não atende; outro erro não diz nada', () => {
  const { atendeDaResposta: a } = capacidades;
  assert.strictEqual(a({ subtype: 'success', request_id: 'x' }), true);
  assert.strictEqual(a({ subtype: 'error', error: 'qualquer coisa', error_code: 'unsupported_request' }), false);
  assert.strictEqual(a({ subtype: 'error', error: 'Unsupported control request subtype: get_plan' }), false);
  assert.strictEqual(a({ subtype: 'error', error: 'REPL bridge does not handle control_request subtype: x' }), false);
  assert.strictEqual(a({ subtype: 'error', error: 'set_color is not supported in this context (onSetColor callback not registered)' }), false);
  assert.strictEqual(a({ subtype: 'error', error: 'modelo indisponível', error_code: 'not_found' }), null, 'o CLI conhece o set_model; recusou por outro motivo');
  assert.strictEqual(a({ subtype: 'error', error: 'o Claude recusou' }), null);
  assert.strictEqual(a(null), null);
});

test('capacidades: a sonda só tem pedidos de leitura', () => {
  for (const s of COM_EFEITO) assert.ok(!capacidades.SONDAVEIS.includes(s), s);
});

// --- o registro em si ------------------------------------------------------------
test('capacidades: o registro guarda por versão, grava sem bloquear e lê de volta', async () => {
  const arquivo = path.join(casa, 'cap-teste', 'registro.json');
  const r = capacidades.criar({ arquivo, esperaGravar: 5 });
  await r.carregado;
  r.viu('1.0.0');
  assert.strictEqual(r.anotar('1.0.0', 'get_plan', { subtype: 'error', error_code: 'unsupported_request', error: 'x' }, 'sonda'), false);
  assert.strictEqual(r.anotar('1.0.0', 'get_status', { subtype: 'success' }), true);
  assert.strictEqual(r.anotar('1.0.0', 'set_model', { subtype: 'error', error: 'outro motivo' }), null);
  assert.deepStrictEqual(Object.keys(r.daVersao('1.0.0')).sort(), ['get_plan', 'get_status']);
  assert.deepStrictEqual(r.faltam('1.0.0', ['get_plan', 'get_status', 'mcp_status']), ['mcp_status']);
  assert.deepStrictEqual(r.faltam('2.0.0', ['get_plan']), ['get_plan'], 'versão nova começa vazia');
  await r.gravarJa();
  const lido = capacidades.criar({ arquivo });
  await lido.carregado;
  assert.deepStrictEqual(lido.daVersao('1.0.0').get_plan.atende, false);
  assert.strictEqual(lido.daVersao('1.0.0').get_plan.como, 'sonda');
  assert.strictEqual(lido.daVersao('1.0.0').get_status.atende, true);
});

test('capacidades: guarda só as últimas versões vistas; versão e subtipo estranhos não entram', async () => {
  const r = capacidades.criar({ arquivo: null, maxVersoes: 2 });
  for (const v of ['1.0.0', '1.1.0', '1.2.0']) { r.viu(v); await new Promise((ok) => setTimeout(ok, 2)); }
  assert.deepStrictEqual(r.versoes().sort(), ['1.1.0', '1.2.0']);
  assert.strictEqual(r.anotar('../x', 'get_plan', { subtype: 'success' }), null);
  assert.strictEqual(r.anotar('1.2.0', 'a b', { subtype: 'success' }), null);
});

// --- com o Claude falso ------------------------------------------------------------
test('capacidades: versão A sem get_plan → depois do 1º init a sonda registra que falta (e que o resto atende)', async (t) => {
  ambiente(t, { CLAUDE_FALSO_VERSAO: '1.0.0', CLAUDE_FALSO_SEM: 'get_plan', ORQ_SONDA_CAPACIDADES: '1' });
  novoLog();
  // Pela função que o resto do app usa: conversa.capacidades(id).
  const id = conversa.garantir('cap-a', 'Conversa A');
  const c = conversa._pegar(id);
  t.after(() => c.parar());
  c.mandar('oi');
  await ate(() => turnos(c) === 1);
  await ate(() => Object.keys(conversa.capacidades(id).subtipos).length === capacidades.SONDAVEIS.length);
  const cap = conversa.capacidades(id);
  assert.strictEqual(cap.versao, '1.0.0');
  assert.deepStrictEqual(cap.subtipos.get_plan.atende, false);
  assert.strictEqual(cap.subtipos.get_plan.como, 'sonda');
  for (const s of capacidades.SONDAVEIS.filter((x) => x !== 'get_plan')) assert.strictEqual(cap.subtipos[s].atende, true, s);
  // A primeira mensagem foi antes de qualquer pedido da sonda.
  const linhas = recebidos();
  assert.strictEqual(linhas[1].type, 'user', 'a mensagem do usuário saiu primeiro');
  assert.ok(pedidos().every((p) => capacidades.SONDAVEIS.includes(p.request.subtype)), 'a sonda só pergunta o que é de leitura');
  assert.ok(pedidos().every((p) => !COM_EFEITO.includes(p.request.subtype)));
  // Nada na conversa: a sonda é de bastidor.
  assert.ok(!c.eventos.some((e) => e.tipo === 'erro' || e.tipo === 'aviso'));
});

test('capacidades: versão B com get_plan → registro diz que tem; trocar de versão refaz o registro e mantém o da anterior', async (t) => {
  ambiente(t, { CLAUDE_FALSO_VERSAO: '2.0.0', CLAUDE_FALSO_SEM: '', ORQ_SONDA_CAPACIDADES: '1' });
  novoLog();
  const c = nova(t);
  c.mandar('oi');
  await ate(() => turnos(c) === 1);
  await ate(() => c.capacidades().subtipos.get_plan);
  assert.strictEqual(c.capacidades().versao, '2.0.0');
  assert.strictEqual(c.capacidades().subtipos.get_plan.atende, true);
  assert.strictEqual(conversa._registroCapacidades.daVersao('1.0.0').get_plan.atende, false, 'a versão A continua registrada como era');
  // O CLI é atualizado e a conversa reinicia: o registro passa a ser o da versão nova.
  process.env.CLAUDE_FALSO_VERSAO = '3.0.0';
  process.env.CLAUDE_FALSO_SEM = 'mcp_status';
  c.reiniciar();
  c.mandar('de novo');
  await ate(() => c.capacidades().versao === '3.0.0' && c.capacidades().subtipos.mcp_status);
  const cap = c.capacidades();
  assert.strictEqual(cap.subtipos.mcp_status.atende, false);
  assert.strictEqual(cap.subtipos.get_plan.atende, true);
});

test('capacidades: versão já conhecida não é sondada de novo', async (t) => {
  ambiente(t, { CLAUDE_FALSO_VERSAO: '2.0.0', CLAUDE_FALSO_SEM: '', ORQ_SONDA_CAPACIDADES: '1' });
  novoLog();
  const c = nova(t);
  c.mandar('oi');
  await ate(() => turnos(c) === 1);
  await new Promise((ok) => setTimeout(ok, 300));
  assert.deepStrictEqual(pedidos(), [], 'nenhum pedido de sonda');
});

test('capacidades: pedido com efeito aprende no primeiro uso de verdade (set_model e interrupt sem suporte → "não atende")', async (t) => {
  ambiente(t, { CLAUDE_FALSO_VERSAO: '4.0.0', CLAUDE_FALSO_SEM: 'set_model,interrupt', ORQ_SONDA_CAPACIDADES: '0' });
  novoLog();
  const c = nova(t);
  c.mandar('oi');
  await ate(() => turnos(c) === 1);
  assert.deepStrictEqual(c.capacidades().subtipos, {}, 'sem sonda e sem uso, nada se sabe');
  c.configurar({ modelo: 'haiku' });
  c.interromper();
  await ate(() => c.capacidades().subtipos.set_model && c.capacidades().subtipos.interrupt);
  const cap = c.capacidades().subtipos;
  assert.deepStrictEqual([cap.set_model.atende, cap.set_model.como], [false, 'uso']);
  assert.deepStrictEqual([cap.interrupt.atende, cap.interrupt.como], [false, 'uso']);
  assert.ok(c.eventos.some((e) => e.tipo === 'erro' && /não trocou o modelo/.test(e.texto)), 'a tela continua avisando como antes');
});

test('capacidades: pedido com efeito atendido vira "atende"; outro erro não mexe no registro', async (t) => {
  ambiente(t, { CLAUDE_FALSO_VERSAO: '4.1.0', CLAUDE_FALSO_SEM: '', ORQ_SONDA_CAPACIDADES: '0', CLAUDE_FALSO_RECUSA_ESFORCO: 'esforço inválido' });
  novoLog();
  const c = nova(t);
  c.mandar('oi');
  await ate(() => turnos(c) === 1);
  c.configurar({ modelo: 'haiku' });
  await ate(() => c.capacidades().subtipos.set_model);
  assert.strictEqual(c.capacidades().subtipos.set_model.atende, true);
  c.pedirEsforco();
  await ate(() => recebidos().some((x) => x.type === 'control_request' && x.request.subtype === 'apply_flag_settings'));
  await new Promise((ok) => setTimeout(ok, 200));
  assert.strictEqual(c.capacidades().subtipos.apply_flag_settings, undefined, 'recusa com outro texto não diz se atende');
});

test('capacidades: resposta que chega antes do init (versão ainda desconhecida) vai para a versão quando o init vem', async (t) => {
  ambiente(t, { CLAUDE_FALSO_VERSAO: '5.0.0', CLAUDE_FALSO_SEM: 'get_hooks_listing', ORQ_SONDA_CAPACIDADES: '0' });
  novoLog();
  const c = nova(t);
  await assert.rejects(c.controle('get_hooks_listing', {}, 4000), /Unsupported control request subtype/);
  assert.strictEqual(c.capacidades().versao, null);
  c.mandar('oi');
  await ate(() => turnos(c) === 1);
  assert.strictEqual(c.capacidades().versao, '5.0.0');
  assert.strictEqual(c.capacidades().subtipos.get_hooks_listing.atende, false);
});

test('capacidades: no modo de teste do app a sonda fica desligada (sem ORQ_SONDA_CAPACIDADES=1)', async (t) => {
  ambiente(t, { CLAUDE_FALSO_VERSAO: '6.0.0', CLAUDE_FALSO_SEM: '', ORQ_APP_TESTE: '1' });
  delete process.env.ORQ_SONDA_CAPACIDADES;
  novoLog();
  const c = nova(t);
  c.mandar('oi');
  await ate(() => turnos(c) === 1);
  await new Promise((ok) => setTimeout(ok, 300));
  assert.deepStrictEqual(pedidos(), []);
  assert.strictEqual(c.capacidades().versao, '6.0.0');
});

test('capacidades: conversa Codex não tem registro do Claude', () => {
  const c = new conversa._Conversa({ id: 'capx', titulo: 'Codex', motor: 'codex' });
  assert.deepStrictEqual(c.capacidades(), { motor: 'codex', versao: null, subtipos: {}, sondaveis: [] });
});

test('capacidades: o registro fica na pasta de cache do app', async () => {
  await conversa._registroCapacidades.gravarJa();
  const arq = path.join(casa, '.cache', 'orq-app', 'capacidades-claude.json');
  const dado = JSON.parse(fs.readFileSync(arq, 'utf8'));
  // Só as 5 últimas versões VISTAS ficam: a 2.0.0 foi vista de novo depois da
  // 3.0.0 (teste "versão já conhecida"), então saíram a 1.0.0 e a 3.0.0.
  assert.deepStrictEqual(Object.keys(dado.versoes).sort(), ['2.0.0', '4.0.0', '4.1.0', '5.0.0', '6.0.0']);
  assert.strictEqual(dado.versoes['2.0.0'].subtipos.get_plan.atende, true);
  assert.strictEqual(dado.versoes['5.0.0'].subtipos.get_hooks_listing.atende, false);
});

// A sonda nunca foi provada contra o Claude de verdade com um turno em
// andamento: ela só pergunta com a conversa parada, e para se o usuário mandar
// outra mensagem no meio (continua quando o turno acabar).
test('capacidades: a sonda espera a resposta terminar; nenhum pedido dela sai no meio do turno', async (t) => {
  ambiente(t, { CLAUDE_FALSO_VERSAO: '6.0.0', CLAUDE_FALSO_SEM: '', ORQ_SONDA_CAPACIDADES: '1' });
  novoLog();
  const id = conversa.garantir('cap-parada', 'Conversa parada');
  const c = conversa._pegar(id);
  t.after(() => c.parar());
  c.mandar('manda 20 deltas'); // um turno de ~1 s
  await ate(() => recebidos().some((x) => x.type === 'user'));
  // Enquanto o turno não acaba, nenhum pedido da sonda.
  while (turnos(c) === 0) {
    assert.deepStrictEqual(pedidos().map((p) => p.request.subtype), [], 'a sonda perguntou no meio da resposta');
    await new Promise((r) => setTimeout(r, 25));
  }
  // Turno acabou: agora ela pergunta tudo o que é de leitura.
  await ate(() => Object.keys(conversa.capacidades(id).subtipos).length === capacidades.SONDAVEIS.length);
  assert.strictEqual(conversa.capacidades(id).versao, '6.0.0');
});
