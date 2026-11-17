// Área: conversa (motor da conversa: modelo, esforço, modo, sessão, /clear e título)
// Itens 0.B1–0.B6 da Etapa 0, com o Claude falso e o Codex falso:
//  - B1: trocar modelo ou esforço não reinicia o Claude (a tarefa de fundo
//    sobrevive): modelo por set_model ao vivo, esforço por apply_flag_settings
//    (só da sessão; nunca "/effort", que grava no settings.json do usuário);
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

test('B1: trocar o esforço vai por apply_flag_settings (só da sessão): sem balão, sem ocupado, sem título, sem reinício', async (t) => {
  const id = conversa.nova();
  const c = conversa._pegar(id);
  t.after(() => conversa.fechar(id));
  c.mandar('começa tarefa de fundo');
  await ate(() => turnos(c) === 1);
  const pid = c.proc.pid;
  const tarefa = recebidos().find((x) => x.tarefa).tarefa;
  const eventos = c.eventos.length;
  const avisosAntes = avisos.length;
  c.configurar({ esforco: 'low' });
  await ate(() => recebidos().some((x) => x.type === 'control_request' && x.request.subtype === 'apply_flag_settings'));
  const pedido = recebidos().find((x) => x.type === 'control_request' && x.request.subtype === 'apply_flag_settings');
  assert.deepStrictEqual(pedido.request.settings, { effortLevel: 'low' });
  await espera(300);
  assert.strictEqual(c.info.ocupado, false, 'não marca ocupado');
  assert.strictEqual(c.eventos.length, eventos, 'nenhum balão, linha ou aviso na conversa');
  assert.strictEqual(avisos.length, avisosAntes, 'nenhuma notificação');
  assert.strictEqual([c.esforco, c.info.esforco].join(), 'low,low');
  assert.strictEqual(c.proc.pid, pid, 'mesmo PID: nada de reinício');
  assert.strictEqual(recebidos().filter((x) => x.args).length, 1);
  assert.ok(vivo(tarefa), 'a tarefa de fundo continua viva');
  // No meio de um turno também vai na hora, sem mexer no turno.
  c.mandar('primeira de verdade');
  c.configurar({ esforco: 'high' });
  await ate(() => recebidos().some((x) => x.type === 'control_request' && x.request.subtype === 'apply_flag_settings' && x.request.settings.effortLevel === 'high'));
  await ate(() => turnos(c) === 2);
  assert.strictEqual(c.titulo, 'começa tarefa de fundo', 'o esforço não vira título');
  assert.strictEqual(c.proc.pid, pid);
});

test('B1: o app nunca manda "/effort" (ele grava o esforço como padrão no settings.json do usuário)', async (t) => {
  const c = new conversa._Conversa({ id: 'b1n', titulo: 'Conversa 9' });
  t.after(() => c.parar());
  c.mandar('oi');
  await ate(() => turnos(c) === 1);
  for (const e of ['low', 'medium', 'high', 'xhigh', 'max', null]) {
    c.configurar({ esforco: e });
    await espera(150);
    await ate(() => !!c.proc && !c.info.ocupado);
  }
  await espera(300);
  const mandados = recebidos().filter((x) => x.type === 'user').map((x) => (typeof x.message.content === 'string' ? x.message.content : JSON.stringify(x.message.content)));
  assert.ok(!mandados.some((m) => /^\s*\/effort\b/.test(m)), `mandou /effort: ${mandados.join(' | ')}`);
});

test('B1: esforço recusado ao vivo: aviso antes e reinício com --effort (só da sessão)', async (t) => {
  process.env.CLAUDE_FALSO_RECUSA_ESFORCO = 'unsupported_request';
  t.after(() => { delete process.env.CLAUDE_FALSO_RECUSA_ESFORCO; });
  const c = new conversa._Conversa({ id: 'b1x', titulo: 'Conversa 10' });
  t.after(() => c.parar());
  c.mandar('oi');
  await ate(() => turnos(c) === 1);
  c.configurar({ esforco: 'high' });
  await ate(() => recebidos().filter((x) => x.args).length === 2);
  const aviso = c.eventos.find((e) => e.tipo === 'aviso' && /reinicia/.test(e.texto));
  assert.ok(aviso, 'avisa que a conversa reinicia');
  assert.match(aviso.texto, /segundo plano/);
  const args = recebidos().filter((x) => x.args).pop().args;
  assert.deepStrictEqual(args.slice(args.indexOf('--effort'), args.indexOf('--effort') + 2), ['--effort', 'high']);
  assert.ok(!recebidos().some((x) => x.type === 'user' && /^\/effort/.test(x.message.content)));
});

test('B1: "Máximo" não existe no apply_flag_settings: aviso antes e reinício com --effort max', async (t) => {
  const c = new conversa._Conversa({ id: 'b1max', titulo: 'Conversa 11' });
  t.after(() => c.parar());
  c.mandar('oi');
  await ate(() => turnos(c) === 1);
  c.configurar({ esforco: 'max' });
  await ate(() => recebidos().filter((x) => x.args).length === 2);
  assert.ok(c.eventos.some((e) => e.tipo === 'aviso' && /reinicia/.test(e.texto)), 'avisa antes de reiniciar');
  const args = recebidos().filter((x) => x.args).pop().args;
  assert.deepStrictEqual(args.slice(args.indexOf('--effort'), args.indexOf('--effort') + 2), ['--effort', 'max']);
  assert.ok(!recebidos().some((x) => x.type === 'control_request' && x.request.subtype === 'apply_flag_settings'), 'não tenta o apply_flag_settings');
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

// Plano 1.1 (faixa de atividade): o Claude avisa o que roda em segundo plano
// (system/background_tasks_changed, com a lista em "tasks"); a conversa guarda
// só quantas são, para a faixa mostrar.
test('faixa: o aviso de tarefas em segundo plano do Claude vira a contagem da conversa', () => {
  const c = new conversa._Conversa({ id: 'fx', titulo: 'Conversa faixa' });
  const avisos = [];
  c.avisarInfo = () => avisos.push(c.info.fundo);
  assert.strictEqual(c.info.fundo || 0, 0);
  c.tratar({ type: 'system', subtype: 'background_tasks_changed', tasks: [{}, {}] });
  assert.strictEqual(c.info.fundo, 2);
  c.tratar({ type: 'system', subtype: 'background_tasks_changed', tasks: [] });
  assert.strictEqual(c.info.fundo, 0);
  c.tratar({ type: 'system', subtype: 'background_tasks_changed' });
  assert.strictEqual(c.info.fundo, 0, 'sem a lista, conta zero');
  assert.deepStrictEqual(avisos, [2, 0], 'a tela só é avisada quando o número muda');
});

// Plano 2.2 (chip de modo). Conferido no Claude 2.1.326 de verdade: a troca ao
// vivo é o set_permission_mode; o Bypass só é aceito se o processo subiu com
// --allow-dangerously-skip-permissions (senão: "Cannot set permission mode…").
const pedidosDeModo = () => recebidos().filter((x) => x.type === 'control_request' && x.request.subtype === 'set_permission_mode').map((x) => x.request.mode);
test('modo: a troca ao vivo vai por set_permission_mode e a conversa mostra o modo que o Claude confirma', async (t) => {
  const c = new conversa._Conversa({ id: 'md1', titulo: 'Conversa modo' });
  t.after(() => c.parar());
  assert.strictEqual(c.info.modo, 'auto', 'antes de subir, o modo é o do app');
  c.mandar('oi');
  await ate(() => turnos(c) === 1);
  await c.definirModo('plan');
  await ate(() => c.info.modo === 'plan');
  await c.definirModo('default');
  await ate(() => c.info.modo === 'default');
  assert.deepStrictEqual(pedidosDeModo(), ['plan', 'default']);
  for (const fora of ['dontAsk', 'qualquer', '', null, 'bypassPermissions; rm']) await assert.rejects(() => c.definirModo(fora), /modo não oferecido/);
  assert.deepStrictEqual(pedidosDeModo(), ['plan', 'default'], 'modo de fora da lista não chega ao Claude');
});

test('modo: Bypass nunca no orquestrador; na avulsa só com a opção das Configurações, e não sobrevive a um reinício', async (t) => {
  const cfg = path.join(casa, '.config', 'orq-app', 'config.json');
  const base = JSON.parse(fs.readFileSync(cfg, 'utf8'));
  const orq = new conversa._Conversa({ id: 'md-orq', titulo: 'Orquestrador', orquestrador: true });
  const c = new conversa._Conversa({ id: 'md2', titulo: 'Conversa bypass' });
  t.after(() => { fs.writeFileSync(cfg, JSON.stringify(base)); c.parar(); orq.parar(); });
  const permite = (x) => x.argumentos().includes('--allow-dangerously-skip-permissions');
  // Opção desligada (o padrão): recusa, e ninguém sobe com a permissão.
  c.mandar('oi');
  await ate(() => turnos(c) === 1);
  await assert.rejects(() => c.definirModo('bypassPermissions'), /desligado nas Configurações/);
  assert.deepStrictEqual([permite(c), permite(orq)], [false, false]);
  // Opção ligada: o orquestrador continua recusando e nunca sobe com a permissão.
  fs.writeFileSync(cfg, JSON.stringify({ ...base, mostrarBypass: true }));
  await assert.rejects(() => orq.definirModo('bypassPermissions'), /nunca vale para o orquestrador/);
  assert.deepStrictEqual([permite(c), permite(orq)], [true, false]);
  // A conversa aberta antes de ligar a opção não aceita o modo (o Claude recusaria):
  // ela sobe de novo, na mesma sessão, com a permissão, e só então troca.
  const sessao = c.sessao;
  await c.definirModo('bypassPermissions');
  await ate(() => c.info.modo === 'bypassPermissions');
  const subidas = recebidos().filter((x) => x.args).map((x) => x.args);
  assert.strictEqual(subidas.length, 2, 'subiu de novo uma vez');
  assert.ok(!subidas[0].includes('--allow-dangerously-skip-permissions') && subidas[1].includes('--allow-dangerously-skip-permissions'));
  assert.deepStrictEqual(subidas[1].slice(subidas[1].indexOf('--resume'), subidas[1].indexOf('--resume') + 2), ['--resume', sessao], 'a conversa é a mesma');
  assert.strictEqual(subidas[1][subidas[1].indexOf('--permission-mode') + 1], 'auto', 'a subida nunca é em Bypass');
  assert.deepStrictEqual(pedidosDeModo(), ['bypassPermissions']);
  // Já com a permissão: voltar ao Auto e ligar de novo não reinicia.
  await c.definirModo('auto');
  await ate(() => c.info.modo === 'auto');
  await c.definirModo('bypassPermissions');
  await ate(() => c.info.modo === 'bypassPermissions');
  assert.strictEqual(recebidos().filter((x) => x.args).length, 2);
  // Reinício: volta ao modo do app (o Bypass não sobrevive).
  assert.strictEqual(c.argumentos()[c.argumentos().indexOf('--permission-mode') + 1], 'auto');
  // Opção desligada de novo: recusa e a próxima subida vem sem a permissão.
  fs.writeFileSync(cfg, JSON.stringify(base));
  assert.strictEqual(permite(c), false);
  await assert.rejects(() => c.definirModo('bypassPermissions'), /desligado nas Configurações/);
});

// Plano 1.1 (Iniciar e Desligar, um por vez): a conversa do orquestrador sabe
// se a rodada está aberta. Abre com o comando da rodada (botão ou digitado) e
// fecha quando a rodada termina (Desligar) ou a conversa é limpa.
test('rodada: o comando que abre a rodada marca só o orquestrador; o fim da rodada desmarca; a marca volta ao reabrir o app', async (t) => {
  const cfg = path.join(casa, '.config', 'orq-app', 'config.json');
  const base = JSON.parse(fs.readFileSync(cfg, 'utf8'));
  fs.writeFileSync(cfg, JSON.stringify({ ...base, comandoInicial: '/rodada', comandoDesligar: '/fim' }));
  const orq = new conversa._Conversa({ id: 'rd-orq', titulo: 'Orquestrador', orquestrador: true });
  const c = new conversa._Conversa({ id: 'rd-c', titulo: 'Conversa 9' });
  t.after(() => { fs.writeFileSync(cfg, JSON.stringify(base)); orq.parar(); c.parar(); });
  assert.strictEqual(orq.info.rodada, false);
  orq.mandar('uma mensagem qualquer');
  await ate(() => turnos(orq) === 1);
  assert.strictEqual(orq.info.rodada, false, 'mensagem comum não abre a rodada');
  orq.mandar('/rodada agora');
  assert.strictEqual(orq.info.rodada, true, 'vale também digitado, com argumento');
  c.mandar('/rodada');
  assert.strictEqual(c.info.rodada, false, 'conversa avulsa não tem rodada');
  await ate(() => turnos(orq) === 2);
  // Reabrindo o app com a rodada aberta: a conversa guardada volta marcada.
  assert.strictEqual(new conversa._Conversa({ id: 'rd-volta', titulo: 'Orquestrador', orquestrador: true, rodada: true }).info.rodada, true);
  assert.strictEqual(new conversa._Conversa({ id: 'rd-volta2', titulo: 'Conversa 10', rodada: true }).info.rodada, false);
  // Desligar: quando o orquestrador termina a resposta, a rodada acaba.
  orq.mandar('/fim');
  await ate(() => orq.info.rodada === false);
});

// Plano 2.1 e 2.4 (menu de modelo): opusplan e Fable 5.2 pelos nomes que a
// documentação do Claude Code dá; o modo rápido aparece no estado da conversa.
test('modelo: opusplan vai como apelido (ao vivo e na subida); Fable é o 5.2; o modo rápido entra no estado da tela', async (t) => {
  const c = new conversa._Conversa({ id: 'mm1', titulo: 'Conversa modelo' });
  t.after(() => c.parar());
  c.mandar('oi');
  await ate(() => turnos(c) === 1);
  assert.strictEqual(c.configurar({ modelo: 'opusplan' }), true);
  await ate(() => c.info.modelo === 'opusplan');
  assert.strictEqual(recebidos().filter((x) => x.type === 'control_request' && x.request.subtype === 'set_model').pop().request.model, 'opusplan');
  assert.deepStrictEqual(c.argumentos().slice(c.argumentos().indexOf('--model'), c.argumentos().indexOf('--model') + 2), ['--model', 'opusplan']);
  assert.strictEqual(c.configurar({ modelo: 'fable' }), true);
  await ate(() => c.info.modelo === 'claude-fable-5-2');
  assert.strictEqual(c.configurar({ modelo: 'nao-existe' }), false);
  assert.strictEqual(c.info.rapido, null, 'sem escolha, vale o padrão do Claude');
  await c.rapidoLigar(true);
  assert.strictEqual(c.info.rapido, true);
  await c.rapidoLigar(false);
  assert.strictEqual(c.info.rapido, false);
});

// Plano 4.1 (fila visível): com o motor trabalhando, o que o usuário manda pela
// caixa fica numa fila do app e vai quando o turno acaba. "Enviar já": no
// Claude o app interrompe o turno e manda a mensagem assim que ele para (nada
// é escrito no meio do turno); no Codex vai por turn/steer.
const mensagens = () => recebidos().filter((x) => x.type === 'user').map((x) => (typeof x.message.content === 'string' ? x.message.content : (x.message.content.find((b) => b.type === 'text') || {}).text));
const interrupcoes = () => recebidos().filter((x) => x.type === 'control_request' && x.request.subtype === 'interrupt').length;
const naFila = (c) => c.info.fila.map((x) => x.texto);
test('fila: ocupado, a mensagem da caixa espera no app e vai sozinha quando o turno acaba; tirar não manda nada', async (t) => {
  const c = new conversa._Conversa({ id: 'fl1', titulo: 'Conversa fila' });
  t.after(() => c.parar());
  // Parado: a mensagem da caixa vai na hora, sem passar pela fila.
  assert.deepStrictEqual(c.daCaixa('manda 30 deltas'), { enviada: true });
  await ate(() => c.info.ocupado && mensagens().length === 1);
  // Ocupado: fica na fila do app; nada chega ao Claude.
  const a = c.daCaixa('primeira da fila');
  const b = c.daCaixa('segunda, que vou tirar');
  const d = c.daCaixa('terceira');
  assert.ok(a.naFila && b.naFila && d.naFila);
  assert.deepStrictEqual(naFila(c), ['primeira da fila', 'segunda, que vou tirar', 'terceira']);
  assert.deepStrictEqual(mensagens(), ['manda 30 deltas']);
  assert.strictEqual(c.tirarDaFila(b.naFila), true);
  assert.strictEqual(c.tirarDaFila('nao-existe'), false);
  assert.deepStrictEqual(naFila(c), ['primeira da fila', 'terceira']);
  // O turno acaba: a fila anda sozinha, uma mensagem por turno, na ordem.
  await ate(() => mensagens().length === 3 && !c.info.ocupado, 10000);
  assert.deepStrictEqual(mensagens(), ['manda 30 deltas', 'primeira da fila', 'terceira']);
  assert.deepStrictEqual(naFila(c), []);
  assert.strictEqual(turnos(c), 3);
  assert.strictEqual(interrupcoes(), 0);
});

test('fila: "enviar já" interrompe o turno e a mensagem vai na frente; a parada do usuário segura a fila', async (t) => {
  const c = new conversa._Conversa({ id: 'fl2', titulo: 'Conversa fila 2' });
  t.after(() => c.parar());
  c.daCaixa('trabalha até parar');
  await ate(() => c.info.ocupado && mensagens().length === 1);
  c.daCaixa('espera a vez');
  // Mensagem nova com "enviar já" (Ctrl+Enter): interrompe e vai na frente da fila.
  assert.ok(c.daCaixa('muda o rumo', [], null, { agora: true }).naFila);
  assert.deepStrictEqual(c.info.fila.map((x) => [x.texto, !!x.ja]), [['muda o rumo', true], ['espera a vez', false]]);
  assert.deepStrictEqual(mensagens(), ['trabalha até parar'], 'nada é escrito no meio do turno');
  await ate(() => mensagens().length === 3 && !c.info.ocupado, 10000);
  assert.strictEqual(interrupcoes(), 1);
  assert.deepStrictEqual(mensagens(), ['trabalha até parar', 'muda o rumo', 'espera a vez']);
  assert.strictEqual(c.info.filaParada, false, 'a parada foi do "enviar já", não do usuário: a fila seguiu');
  // "Enviar já" numa mensagem que estava na fila.
  c.daCaixa('trabalha até parar');
  await ate(() => c.info.ocupado && mensagens().length === 4);
  c.daCaixa('esta continua esperando');
  const x = c.daCaixa('esta sai na frente');
  assert.strictEqual(c.enviarJaDaFila(x.naFila), true);
  assert.deepStrictEqual(naFila(c), ['esta sai na frente', 'esta continua esperando']);
  await ate(() => mensagens().length === 6 && !c.info.ocupado, 10000);
  assert.deepStrictEqual(mensagens().slice(4), ['esta sai na frente', 'esta continua esperando']);
  // O usuário para o motor (Parar ou Esc): a fila não dispara sozinha depois disso.
  c.daCaixa('trabalha até parar');
  await ate(() => c.info.ocupado && mensagens().length === 7);
  const z = c.daCaixa('não quero que vá sozinha');
  c.interromper();
  await ate(() => !c.info.ocupado);
  await espera(300);
  assert.deepStrictEqual(naFila(c), ['não quero que vá sozinha'], 'continua na fila, parada');
  assert.strictEqual(c.info.filaParada, true);
  assert.strictEqual(mensagens().length, 7);
  // Mensagem nova com a fila parada: entra no fim e a fila volta a andar, na ordem.
  assert.ok(c.daCaixa('e mais esta').naFila);
  await ate(() => mensagens().length === 9 && !c.info.ocupado, 10000);
  assert.deepStrictEqual(mensagens().slice(7), ['não quero que vá sozinha', 'e mais esta']);
  assert.strictEqual(c.info.filaParada, false);
  assert.ok(z.naFila);
});

test('fila (Codex): ocupado, a mensagem da caixa espera no app; "enviar já" corrige o rumo por turn/steer', async (t) => {
  const c = new conversa._Conversa({ id: 'fl3', titulo: 'Conversa fila Codex', motor: 'codex' });
  t.after(() => c.parar());
  c.daCaixa('oi codex');
  await ate(() => c.info.ocupado && xrecebidos().some((x) => x.method === 'turn/start'));
  const q = c.daCaixa('fica na fila');
  assert.ok(q.naFila);
  assert.ok(!xrecebidos().some((x) => x.method === 'turn/steer'), 'pela fila, nada vai ao Codex no meio do turno');
  assert.deepStrictEqual(c.daCaixa('corrige agora', [], null, { agora: true }), { enviada: true });
  await ate(() => xrecebidos().some((x) => x.method === 'turn/steer'));
  assert.deepStrictEqual(naFila(c), ['fica na fila']);
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
