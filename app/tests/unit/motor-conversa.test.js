// Área: conversa (motor da conversa: modelo, esforço, modo, sessão, /clear e título)
// Itens 0.B1–0.B6 da Etapa 0, com o Claude falso e o Codex falso:
//  - B1: trocar modelo ou esforço não reinicia o Claude (a tarefa de fundo
//    sobrevive): modelo por set_model ao vivo, esforço por "/effort x" calado;
//  - B2: o modo de permissão vivo sobrevive a um reinício (o mais restritivo);
//  - B3: --resume que cai antes do init só zera a sessão quando ela não existe;
//  - B4: mensagem no meio de um turno do Codex vai por turn/steer;
//  - B5: /clear guarda a sessão velha em anteriores e limpa a tela; o nome
//    que o Claude dá à sessão vira o título;
//  - B6: a conversa avulsa não ganha título de um comando "/".
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { casaTemporaria } = require('../ajuda');

const FALSO = path.join(__dirname, 'claude-falso.js');
const XFALSO = path.join(__dirname, 'codex-falso.js');
const casa = casaTemporaria({ iasCaminhos: { claude: FALSO, codex: XFALSO } });
// Um log por teste: cada Claude/Codex falso anota no log do teste que o abriu.
let LOG, XLOG, nLog = 0;
function novoLog() {
  nLog++;
  LOG = path.join(casa, `claude-falso-${nLog}.log`);
  XLOG = path.join(casa, `codex-falso-${nLog}.log`);
  process.env.CLAUDE_FALSO_LOG = LOG;
  process.env.CODEX_FALSO_LOG = XLOG;
}
novoLog();
test.beforeEach(() => novoLog());
const conversa = require('../../conversa');

const ler = (arq) => (fs.existsSync(arq) ? fs.readFileSync(arq, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const recebidos = () => ler(LOG);
const xrecebidos = () => ler(XLOG);
const telas = [];
conversa.ligar((canal, dado) => telas.push({ canal, ...dado }));
const avisos = [];
conversa.ligarAvisos((a) => avisos.push(a));
async function ate(cond, ms = 6000) {
  for (let i = 0; i < ms / 20; i++) { if (cond()) return; await new Promise((r) => setTimeout(r, 20)); }
  throw new Error('não aconteceu a tempo');
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const turnos = (c) => c.eventos.filter((e) => e.tipo === 'resultado').length;
const vivo = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const lista = () => JSON.parse(fs.readFileSync(path.join(casa, '.cache', 'orq-app', process.env.ORQ_APP_TESTE === '1' ? 'conversas-teste.json' : 'conversas.json'), 'utf8'));

test('B1: trocar o modelo com uma tarefa de fundo viva usa set_model; o processo (PID) e a tarefa continuam', async (t) => {
  const c = new conversa._Conversa({ id: 'b1m', titulo: 'Conversa 2' });
  t.after(() => c.parar());
  c.mandar('começa tarefa de fundo');
  await ate(() => turnos(c) === 1);
  const pid = c.proc.pid;
  const tarefa = recebidos().find((x) => x.tarefa).tarefa;
  assert.ok(vivo(tarefa), 'a tarefa de fundo subiu');

  assert.strictEqual(c.configurar({ modelo: 'sonnet' }), true);
  // O modelo só vale na tela quando o Claude confirma.
  assert.notStrictEqual(c.info.modelo, 'claude-sonnet-5-5', 'antes da confirmação a tela não muda');
  await ate(() => c.info.modelo === 'claude-sonnet-5-5');
  const pedido = recebidos().find((x) => x.type === 'control_request' && x.request.subtype === 'set_model');
  assert.ok(pedido, 'o log tem set_model');
  assert.strictEqual(pedido.request.model, 'claude-sonnet-5-5');
  assert.strictEqual(c.modeloEscolhido, 'sonnet');
  assert.strictEqual(c.proc && c.proc.pid, pid, 'mesmo PID: o Claude não reiniciou');
  assert.strictEqual(recebidos().filter((x) => x.args).length, 1, 'o Claude subiu uma vez só');
  assert.ok(vivo(tarefa), 'a tarefa de fundo continua viva');

  // O próximo init confirma; o modelo vale no reinício.
  c.mandar('oi');
  await ate(() => turnos(c) === 2);
  assert.strictEqual(c.info.modelo, 'claude-sonnet-5-5');
  assert.deepStrictEqual(c.argumentos().slice(c.argumentos().indexOf('--model'), c.argumentos().indexOf('--model') + 2), ['--model', 'claude-sonnet-5-5']);
});

test('B1: modelo recusado pelo Claude fica o antigo e aparece um aviso', async (t) => {
  process.env.CLAUDE_FALSO_RECUSA_MODELO = 'modelo indisponível';
  t.after(() => { delete process.env.CLAUDE_FALSO_RECUSA_MODELO; });
  const c = new conversa._Conversa({ id: 'b1r', titulo: 'Conversa 3' });
  t.after(() => c.parar());
  c.mandar('oi');
  await ate(() => turnos(c) === 1);
  const pid = c.proc.pid;
  c.configurar({ modelo: 'haiku' });
  await ate(() => c.eventos.some((e) => e.tipo === 'erro'));
  assert.match(c.eventos.find((e) => e.tipo === 'erro').texto, /^O Claude não trocou o modelo: modelo indisponível$/);
  assert.strictEqual(c.modeloEscolhido, null, 'a escolha não muda');
  assert.strictEqual(c.info.modelo, 'claude-falso-1-0', 'a tela continua no modelo que vale');
  assert.strictEqual(c.proc.pid, pid);
});

test('B1: trocar o esforço manda "/effort x" calado: sem balão, sem ocupado, sem título, sem aviso; mesmo PID', async (t) => {
  const id = conversa.nova();
  const c = conversa._pegar(id);
  t.after(() => conversa.fechar(id));
  const titulo = c.titulo;
  c.iniciar();
  c.configurar({ esforco: 'low' }); // processo vivo, ainda sem nenhuma mensagem
  await ate(() => recebidos().some((x) => x.type === 'user' && x.message.content === '/effort low'));
  const pid = c.proc.pid;
  assert.strictEqual(c.info.ocupado, false, 'não marca ocupado');
  await espera(300);
  assert.strictEqual(c.titulo, titulo, 'o /effort não vira título');
  assert.ok(!c.eventos.some((e) => e.tipo === 'user'), 'nenhum balão nem saída do comando');
  assert.strictEqual(turnos(c), 0, 'o fim do comando não vira fim de turno');
  assert.ok(!avisos.some((a) => a.id === id), 'nenhuma notificação');
  assert.strictEqual(c.esforco, 'low');
  assert.strictEqual(c.info.esforco, 'low');
  assert.strictEqual(c.proc.pid, pid);
  assert.strictEqual(recebidos().filter((x) => x.args).length, 1, 'o Claude subiu uma vez só');

  // Com um turno em andamento, o /effort espera o fim dele.
  c.mandar('primeira de verdade');
  c.configurar({ esforco: 'high' });
  assert.ok(!recebidos().some((x) => x.type === 'user' && x.message.content === '/effort high'), 'não manda no meio do turno');
  await ate(() => recebidos().some((x) => x.type === 'user' && x.message.content === '/effort high'));
  await espera(300);
  assert.strictEqual(turnos(c), 1, 'só o turno da mensagem conta');
  assert.strictEqual(c.titulo, 'primeira de verdade');
  assert.strictEqual(c.proc.pid, pid, 'nenhum reinício');
});

test('B2: o modo vivo (status) sobrevive ao /restart; reinício nunca sobe mais solto que auto', async (t) => {
  const c = new conversa._Conversa({ id: 'b2', titulo: 'Conversa 5' });
  t.after(() => c.parar());
  c.mandar('/config permissionMode=default');
  await ate(() => c.modo === 'default');
  c.reiniciar();
  await ate(() => recebidos().filter((x) => x.args).length === 2 && c.proc);
  const args = recebidos().filter((x) => x.args).pop().args;
  assert.deepStrictEqual(args.slice(args.indexOf('--permission-mode'), args.indexOf('--permission-mode') + 2), ['--permission-mode', 'default']);

  // Modo mais solto que o padrão do app (bypass): o reinício volta ao auto.
  c.tratar({ type: 'system', subtype: 'status', status: null, permissionMode: 'bypassPermissions' });
  assert.strictEqual(c.argumentos()[c.argumentos().indexOf('--permission-mode') + 1], 'auto');
  c.tratar({ type: 'system', subtype: 'status', status: null, permissionMode: 'plan' });
  assert.strictEqual(c.argumentos()[c.argumentos().indexOf('--permission-mode') + 1], 'plan');
});

test('B3: --resume que cai antes do init por outro motivo mantém a sessão e mostra o erro', async (t) => {
  process.env.CLAUDE_FALSO_FALHA_RESUME = 'Error: falha de rede qualquer';
  t.after(() => { delete process.env.CLAUDE_FALSO_FALHA_RESUME; });
  const c = new conversa._Conversa({ id: 'b3', titulo: 'Conversa 6', sessao: 'S-guardada' });
  c.iniciar();
  await ate(() => c.eventos.some((e) => e.tipo === 'fim'));
  assert.strictEqual(c.sessao, 'S-guardada', 'a sessão continua');
  assert.match(c.eventos.find((e) => e.tipo === 'fim').texto, /falha de rede qualquer/);
  assert.ok(!c.eventos.some((e) => /expirou/.test(e.texto || '')), 'não diz que expirou');
});

test('B3: --resume de sessão que não existe mais ("No conversation found") começa do zero', async (t) => {
  process.env.CLAUDE_FALSO_FALHA_RESUME = 'No conversation found with session ID: S-sumiu';
  t.after(() => { delete process.env.CLAUDE_FALSO_FALHA_RESUME; });
  const c = new conversa._Conversa({ id: 'b3b', titulo: 'Conversa 7', sessao: 'S-sumiu' });
  c.iniciar();
  await ate(() => c.eventos.some((e) => e.tipo === 'fim'));
  assert.strictEqual(c.sessao, null);
  assert.ok(c.eventos.some((e) => e.tipo === 'aviso' && /expirou/.test(e.texto)), 'só aqui aparece "esta conversa expirou"');
});

test('B3 (Codex): o Codex que cai ao retomar mantém a conversa guardada', async (t) => {
  process.env.CODEX_FALSO_SAI = 'panic: falha qualquer';
  t.after(() => { delete process.env.CODEX_FALSO_SAI; });
  const c = new conversa._Conversa({ id: 'b3x', titulo: 'X', motor: 'codex', sessao: 'th-velho' });
  c.iniciar();
  await ate(() => c.eventos.some((e) => e.tipo === 'fim'));
  assert.strictEqual(c.sessao, 'th-velho');
  assert.deepStrictEqual(c.anteriores, []);
});

test('B4 (Codex): mensagem no meio do turno vai por turn/steer com expectedTurnId; ocupado continua', async (t) => {
  const c = new conversa._Conversa({ id: 'b4', titulo: 'X', motor: 'codex' });
  t.after(() => c.parar());
  c.mandar('oi');
  await ate(() => c.pendentes.size === 1); // o turno tu1 fica segurado pela pergunta
  c.mandar('mais uma coisa');
  await ate(() => xrecebidos().some((x) => x.method === 'turn/steer'));
  const steer = xrecebidos().find((x) => x.method === 'turn/steer').params;
  assert.strictEqual(steer.expectedTurnId, 'tu1');
  assert.strictEqual(steer.input.at(-1).text, 'mais uma coisa');
  await espera(200);
  assert.strictEqual(xrecebidos().filter((x) => x.method === 'turn/start').length, 1, 'nenhum 2º turn/start');
  assert.strictEqual(c.info.ocupado, true);
});

test('B4 (Codex): steer e turn/start recusados devolvem o texto à caixa e não soltam o ocupado', async (t) => {
  process.env.CODEX_FALSO_RECUSA = '1';
  t.after(() => { delete process.env.CODEX_FALSO_RECUSA; });
  const c = new conversa._Conversa({ id: 'b4r', titulo: 'X', motor: 'codex' });
  t.after(() => c.parar());
  c.mandar('oi');
  await ate(() => c.pendentes.size === 1);
  c.mandar('texto que volta');
  await ate(() => c.eventos.some((e) => e.tipo === 'erro' && e.devolver === 'texto que volta'));
  assert.strictEqual(c.info.ocupado, true, 'o turno ainda está ativo');
});

test('B5: /clear guarda a sessão velha (id do init) em anteriores, limpa os eventos e mostra a divisória', async (t) => {
  const id = conversa.nova();
  const c = conversa._pegar(id);
  t.after(() => conversa.fechar(id));
  c.mandar('oi');
  await ate(() => turnos(c) === 1 && c.sessao === 'S-falso');
  c.mandar('/clear');
  await ate(() => c.sessao === 'S-falso-2' && c.eventos.some((e) => e.tipo === 'limpa'));
  await ate(() => !c.info.ocupado);
  assert.deepStrictEqual(c.anteriores, ['S-falso']);
  assert.ok(!c.anteriores.some((s) => /nao-e-a-sessao/.test(s)), 'new_conversation_id não é sessão');
  assert.ok(!c.eventos.some((e) => e.tipo === 'user' || e.tipo === 'assistant'), 'nada da conversa antiga fica');
  assert.ok(telas.some((x) => x.id === id && x.canal === 'conversa:tudo' && x.dado.eventos.some((e) => e.tipo === 'limpa')), 'a tela é redesenhada limpa');
  assert.deepStrictEqual(lista().find((x) => x.id === id).anteriores, ['S-falso']);
  assert.strictEqual(lista().find((x) => x.id === id).sessao, 'S-falso-2');
});

test('B5: o nome que o Claude dá à sessão (session_title_changed) vira o título e é gravado', async (t) => {
  const id = conversa.nova();
  const c = conversa._pegar(id);
  t.after(() => conversa.fechar(id));
  c.mandar('/rename Revisão do contrato');
  await ate(() => c.titulo === 'Revisão do contrato');
  assert.strictEqual(lista().find((x) => x.id === id).titulo, 'Revisão do contrato');
  assert.ok(telas.some((x) => x.canal === 'conversa:lista'));
});

test('B6: a primeira mensagem "/model" ou "/rename x" não vira título da conversa avulsa', async (t) => {
  const id = conversa.nova();
  const c = conversa._pegar(id);
  t.after(() => conversa.fechar(id));
  const titulo = c.titulo;
  assert.match(titulo, /^Conversa \d+$/);
  c.mandar('/model');
  assert.strictEqual(c.titulo, titulo);
  await ate(() => turnos(c) === 1);
  c.mandar('agora sim um assunto');
  assert.strictEqual(c.titulo, 'agora sim um assunto');
});
