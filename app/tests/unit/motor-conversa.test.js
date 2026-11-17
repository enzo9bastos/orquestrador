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
  // Espera o turno estar de fato aberto (a pergunta do Codex falso chegou): só aí
  // uma mensagem no meio dele é "corrigir o rumo" e não um turno novo.
  await ate(() => c.info.ocupado && c.pendentes.size === 1);
  const q = c.daCaixa('fica na fila');
  assert.ok(q.naFila);
  assert.ok(!xrecebidos().some((x) => x.method === 'turn/steer'), 'pela fila, nada vai ao Codex no meio do turno');
  assert.deepStrictEqual(c.daCaixa('corrige agora', [], null, { agora: true }), { enviada: true });
  await ate(() => xrecebidos().some((x) => x.method === 'turn/steer'));
  assert.deepStrictEqual(naFila(c), ['fica na fila']);
});

// D16.3: o /exit fecha só a conversa. O processo sai, a sessão vai para as
// anteriores, a tela fica limpa e a próxima mensagem começa uma sessão nova.
// Dá para voltar à sessão que foi encerrada.
test('/exit: encerra só aquela conversa; a sessão fica guardada, a próxima mensagem começa outra, e dá para voltar', async (t) => {
  process.env.CLAUDE_FALSO_SESSAO_REAL = '1';
  const c = new conversa._Conversa({ id: 'ex1', titulo: 'Conversa exit' });
  const outra = new conversa._Conversa({ id: 'ex2', titulo: 'Outra conversa' });
  t.after(() => { delete process.env.CLAUDE_FALSO_SESSAO_REAL; c.parar(); outra.parar(); });
  c.mandar('oi'); outra.mandar('oi');
  await ate(() => turnos(c) === 1 && turnos(outra) === 1);
  const sessao = c.sessao;
  const pidDaOutra = outra.proc.pid;
  assert.ok(sessao && c.proc);
  c.daCaixa('trabalha até parar');
  await ate(() => c.info.ocupado);
  c.daCaixa('estava na fila');
  c.encerrarConversa();
  assert.strictEqual(c.proc, null, 'o processo desta conversa sai');
  assert.strictEqual(c.sessao, null);
  assert.deepStrictEqual(c.anteriores.slice(-1), [sessao], 'a sessão fica guardada nas anteriores');
  assert.deepStrictEqual(c.eventos.map((e) => e.tipo), ['encerrada'], 'a tela fica limpa, só com o aviso');
  assert.strictEqual(c.eventos[0].podeVoltar, true);
  assert.deepStrictEqual([c.info.ocupado, c.info.filaParada, c.info.fila.length], [false, true, 1], 'o que estava na fila não dispara numa sessão nova');
  assert.ok(vivo(pidDaOutra) && outra.proc, 'as outras conversas continuam');
  // Voltar: a sessão encerrada volta a ser a desta conversa.
  assert.strictEqual(c.reabrirAnterior(), true);
  assert.strictEqual(c.sessao, sessao);
  await ate(() => c.proc && recebidos().filter((x) => x.args).some((a) => a.args.join(' ').includes(`--resume ${sessao}`)));
  assert.strictEqual(c.reabrirAnterior(), false, 'com a conversa aberta não há o que voltar');
  // De novo, e agora a próxima mensagem começa uma sessão nova.
  c.encerrarConversa();
  c.tirarDaFila(c.info.fila[0].id);
  c.mandar('recomeçando');
  await ate(() => c.sessao && c.sessao !== sessao);
  assert.ok(c.anteriores.includes(sessao));
  const ultimaSubida = recebidos().filter((x) => x.args).pop().args.join(' ');
  assert.ok(!ultimaSubida.includes('--resume'), 'sessão nova: sobe sem retomar');
});

// Plano 1.4 (K6): comando que só existe na tela do terminal. O Claude responde em
// inglês ("/x isn't available in this environment.") e marca a mensagem com
// local_command_outcome { kind: 'unavailable_headless' } (conferido no 2.1.326).
// O app guarda qual comando foi, para a tela explicar em português.
test('comando indisponível: a resposta do Claude vem marcada com o comando, pelo campo dele ou pelo texto (CLI antigo)', async (t) => {
  const c = new conversa._Conversa({ id: 'ni1', titulo: 'Conversa indisponível' });
  t.after(() => c.parar());
  c.mandar('/so-no-terminal');
  await ate(() => turnos(c) === 1);
  const ev = c.eventos.find((e) => e.tipo === 'assistant');
  assert.strictEqual(ev.naoDisponivel, 'so-no-terminal');
  assert.strictEqual(ev.comando, '/so-no-terminal', 'o comando como foi escrito, para abrir no terminal');
  // Com argumentos: o Claude responde só com o nome; o app guarda o que a pessoa escreveu.
  c.mandar('/so-no-terminal agora  mesmo');
  await ate(() => turnos(c) === 2);
  assert.strictEqual(c.eventos.filter((e) => e.tipo === 'assistant').at(-1).comando, '/so-no-terminal agora  mesmo');
  assert.strictEqual(ev.message.content[0].text, "/so-no-terminal isn't available in this environment.", 'o texto do Claude fica como veio');
  // CLI mais antigo, sem o campo: reconhece pelo texto (só em mensagem sintética, nunca numa resposta do modelo).
  c.tratar({ type: 'assistant', message: { role: 'assistant', model: '<synthetic>', content: [{ type: 'text', text: "/memory isn't available in this environment." }] } });
  assert.strictEqual(c.eventos.at(-1).naoDisponivel, 'memory');
  assert.strictEqual(c.eventos.at(-1).comando, '/memory', 'a última coisa mandada era outro comando: fica só o nome');
  c.tratar({ type: 'assistant', message: { role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: "/memory isn't available in this environment." }] } });
  assert.strictEqual(c.eventos.at(-1).naoDisponivel, undefined, 'o modelo citando a frase não vira aviso');
  c.tratar({ type: 'assistant', message: { role: 'assistant', model: '<synthetic>', content: [{ type: 'text', text: 'Session renamed to: x' }] }, local_command_run: { command: 'rename', args: 'x' } });
  assert.strictEqual(c.eventos.at(-1).naoDisponivel, undefined);
  // O CLI mudou a frase mas manteve a marca: o comando vem do que foi mandado.
  c.ultimoMandado = '/novidade com argumento';
  c.tratar({ type: 'assistant', message: { role: 'assistant', model: '<synthetic>', content: [{ type: 'text', text: 'This command needs the terminal UI.' }] }, local_command_outcome: { kind: 'unavailable_headless' } });
  assert.deepStrictEqual([c.eventos.at(-1).naoDisponivel, c.eventos.at(-1).comando], ['novidade', '/novidade com argumento']);
  // Dentro de um subagente nunca vira aviso.
  c.tratar({ type: 'assistant', parent_tool_use_id: 'toolu_1', message: { role: 'assistant', model: '<synthetic>', content: [{ type: 'text', text: "/memory isn't available in this environment." }] } });
  assert.strictEqual(c.eventos.at(-1).naoDisponivel, undefined);
  // A frase que o app procura é a mesma que o conferidor de contrato confere no CLI de verdade.
  const contrato = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'scripts', 'contrato-cli.json'), 'utf8'));
  const item = contrato.claude.itens.find((i) => i.id === 'evento:assistant (comando só de terminal)');
  assert.strictEqual(item.texto, conversa._NAO_DISPONIVEL.source);
  assert.ok(contrato.claude.turnoLocal.includes('/memory'), 'o conferidor manda um comando só de terminal');
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

// Plano 4.3 (C11): o "@" da caixa pede ao Claude os arquivos que casam com o que foi
// digitado (file_suggestions, o mesmo que o terminal mostra). Só com a conversa aberta
// e parada, e o que o Claude devolve é conferido antes de ir para a tela.
test('4.3: sugestão de arquivos do "@": só parada e aberta; resposta conferida e limitada', async (t) => {
  const c = new conversa._Conversa({ id: 'arq1', titulo: 'Conversa de arquivos' });
  t.after(() => c.parar());
  const pedidos = () => recebidos().filter((x) => x.type === 'control_request' && x.request && x.request.subtype === 'file_suggestions').length;
  const antes = pedidos();
  // Fechada: não sobe o Claude só para autocompletar.
  assert.deepStrictEqual(await c.sugerirArquivos('bot'), { arquivos: [] });
  assert.strictEqual(c.proc, null);
  c.mandar('oi');
  await ate(() => turnos(c) === 1 && !c.info.ocupado);
  const r = await c.sugerirArquivos('bot');
  assert.deepStrictEqual(r.arquivos, [{ caminho: 'src/botao.css' }, { caminho: 'src/botao.test.js' }]);
  assert.strictEqual(typeof r.cwd, 'string');
  assert.deepStrictEqual((await c.sugerirArquivos('')).arquivos.map((a) => a.caminho), ['src/', 'LEIAME.md', 'docs/'], 'busca vazia: o que está na raiz');
  // O que não é caminho de verdade fica fora; no máximo 50.
  assert.deepStrictEqual((await c.sugerirArquivos('lixo')).arquivos, [{ caminho: 'bom.txt' }]);
  assert.strictEqual((await c.sugerirArquivos('muitos')).arquivos.length, 50);
  // Trabalhando: nada é pedido ao Claude no meio do turno.
  const feitos = pedidos();
  assert.strictEqual(feitos - antes, 4);
  c.mandar('trabalha até parar');
  await ate(() => c.info.ocupado && c.eventos.some((e) => e.tipo === 'assistant' && JSON.stringify(e.message).includes('começando')));
  assert.deepStrictEqual(await c.sugerirArquivos('bot'), { arquivos: [] });
  await espera(200);
  assert.strictEqual(pedidos(), feitos, 'com o motor ocupado não sai pedido');
  // Conversa do Codex: por enquanto sem arquivos no "@".
  const x = new conversa._Conversa({ id: 'arq2', titulo: 'X', motor: 'codex' });
  assert.deepStrictEqual(await x.sugerirArquivos('bot'), { arquivos: [] });
  assert.strictEqual(x.proc || null, null);
});

// Plano 4.2 (C10): o "!" da caixa roda o comando do usuário por um caminho próprio
// (rodarShell). mandar() e a fila nunca interpretam "!". A saída vai ao modelo junto com
// a próxima mensagem DIGITADA (não com recado, workflow ou comando), na marcação que o
// Claude Code usa no terminal, e o balão mostra só o que a pessoa escreveu.
test('4.2: "!" roda só pelo caminho próprio; a saída vai ao modelo com a próxima mensagem digitada', async (t) => {
  const c = new conversa._Conversa({ id: 'sh1', titulo: 'Conversa do shell' });
  t.after(() => c.parar());
  const textos = () => recebidos().filter((x) => x.type === 'user').map((x) => x.message.content);
  const doShell = () => c.eventos.filter((e) => e.tipo === 'shell');
  // Pelo mandar (recado, workflow, atalho, orquestrador): "!" é texto comum.
  c.mandar('!echo nao-roda-por-aqui');
  await ate(() => turnos(c) === 1);
  assert.strictEqual(textos().at(-1), '!echo nao-roda-por-aqui');
  assert.deepStrictEqual(doShell(), []);
  // Pela caixa, sem o caminho próprio: também é texto (quem decide rodar é a tela, no Enter).
  c.daCaixa('!echo nem-por-aqui');
  await ate(() => turnos(c) === 2);
  assert.strictEqual(textos().at(-1), '!echo nem-por-aqui');
  assert.deepStrictEqual(doShell(), []);

  const antes = textos().length;
  const r = c.rodarShell('echo oi-do-shell; echo erro-do-shell >&2; exit 2');
  assert.ok(r.id);
  assert.strictEqual(c.info.shell, true, 'a tela sabe que há um comando rodando');
  await ate(() => doShell().some((e) => e.estado === 'fim'));
  const ev = doShell()[0];
  assert.deepStrictEqual([ev.comando, ev.saida, ev.erro, ev.codigo], ['echo oi-do-shell; echo erro-do-shell >&2; exit 2', 'oi-do-shell\n', 'erro-do-shell\n', 2]);
  assert.strictEqual(doShell().length, 1, 'um evento só, que passa de rodando a fim');
  assert.strictEqual(c.info.shell, false);
  assert.strictEqual(c.info.ocupado, false, 'o motor não foi acionado');
  await espera(150);
  assert.strictEqual(textos().length, antes, 'nada foi ao modelo ainda');

  // Mensagem por trás e comando não levam a saída; ela espera a próxima digitada.
  c.mandar('<orq-workflow nome="x">\noi\n</orq-workflow>');
  await ate(() => turnos(c) === 3);
  assert.ok(!textos().at(-1).includes('<bash-input>'));
  c.daCaixa('e agora?');
  await ate(() => turnos(c) === 4);
  assert.strictEqual(textos().at(-1), '<bash-input>echo oi-do-shell; echo erro-do-shell >&2; exit 2</bash-input>\n<bash-stdout>oi-do-shell</bash-stdout><bash-stderr>erro-do-shell\n[código de saída 2]</bash-stderr>\n\ne agora?');
  assert.strictEqual(c.eventos.filter((e) => e.tipo === 'user' && e.local).at(-1).message.content, 'e agora?', 'o balão mostra só o que foi digitado');
  c.daCaixa('mais uma');
  await ate(() => turnos(c) === 5);
  assert.strictEqual(textos().at(-1), 'mais uma', 'a saída vai uma vez só');

  // Um por vez; parar encerra.
  c.rodarShell('echo começou; sleep 30');
  assert.throws(() => c.rodarShell('echo outro'), /já há um comando/);
  await espera(300);
  c.pararShell();
  await ate(() => doShell().length === 2 && doShell()[1].estado === 'fim');
  assert.strictEqual(doShell()[1].parado, true);
  // Comando inválido não vira evento.
  assert.throws(() => c.rodarShell('   '), /comando vazio/);
  assert.strictEqual(doShell().length, 2);
});

// Plano 6.4: cartão de permissão completo. O pedido leva para a tela a regra que o Claude
// sugeriu (ou o motivo de não haver "sempre") e o porquê da pergunta, sem códigos de cor.
// A resposta devolve ao Claude a MESMA sugestão dele com o alcance escolhido; "desta vez" e
// "negar" continuam como eram, agora dizendo ao Claude qual foi a decisão.
test('6.4: permissão com "sempre": a regra sugerida vai à tela e volta ao Claude com o alcance escolhido', async (t) => {
  const c = new conversa._Conversa({ id: 'ps1', titulo: 'Conversa de permissão' });
  t.after(() => c.parar());
  let n = 0;
  const respostaDoApp = () => { const r = recebidos().filter((x) => x.type === 'control_response' && /^perm-/.test(x.response.request_id)).pop(); return r.response.response; };
  const pedir = async (qual) => { c.mandar(`pede permissão ${qual}`); await ate(() => c.pendentes.size === 1); return [...c.pendentes.values()][0]; };
  const responder = async (p, decisao) => { assert.strictEqual(c.responder(p.id, decisao), true); n++; await ate(() => turnos(c) === n); return respostaDoApp(); };
  const SUG = { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }], behavior: 'allow', destination: 'localSettings' };

  let p = await pedir('com sugestão');
  assert.deepStrictEqual(p.sempre, { ok: true, textos: ['Bash(npm test:*)'] });
  assert.strictEqual(p.motivo, 'Este comando não está entre os que o modo roda sozinho.', 'o motivo chega sem os códigos de cor');
  assert.ok(!JSON.stringify(p).includes('permission_suggestions') && !JSON.stringify(p).includes('addRules'), 'a sugestão crua não viaja para a tela');
  assert.deepStrictEqual(await responder(p, { permitir: true, sempre: 'session' }),
    { behavior: 'allow', updatedInput: { command: 'npm test -- --so-unidade' }, updatedPermissions: [{ ...SUG, destination: 'session' }], decisionClassification: 'user_permanent' });

  p = await pedir('com sugestão');
  assert.deepStrictEqual(await responder(p, { permitir: true }), { behavior: 'allow', updatedInput: { command: 'npm test -- --so-unidade' }, decisionClassification: 'user_temporary' });

  p = await pedir('com sugestão');
  const negado = await responder(p, { permitir: false, emVezDisso: 'rode só o arquivo que mudou' });
  assert.deepStrictEqual([negado.behavior, negado.decisionClassification], ['deny', 'user_reject']);
  assert.match(negado.message, /Negado pelo usuário no app\.[\s\S]*rode só o arquivo que mudou/);

  // Alcance que o app não oferece (o do time, gravado no git): vale como "desta vez".
  p = await pedir('com sugestão');
  assert.strictEqual((await responder(p, { permitir: true, sempre: 'projectSettings' })).updatedPermissions, undefined);

  // Comando da lista de recusa: a tela recebe o motivo, e mesmo pedindo "sempre" volta só "desta vez".
  p = await pedir('docker');
  assert.deepStrictEqual(p.sempre, { ok: false, motivo: 'docker, tmux ou ssh', textos: ['Bash(docker compose:*)'] });
  const d = await responder(p, { permitir: true, sempre: 'session' });
  assert.deepStrictEqual([d.behavior, d.updatedPermissions, d.decisionClassification], ['allow', undefined, 'user_temporary']);

  // Sem sugestão do Claude não há "sempre"; quem responde sem saber disso (o ajudante) continua funcionando.
  p = await pedir('sem sugestão');
  assert.strictEqual(p.sempre, null);
  assert.deepStrictEqual(await responder(p, { permitir: true }), { behavior: 'allow', updatedInput: { command: 'npm test -- --so-unidade' }, decisionClassification: 'user_temporary' });
  p = await pedir('sem sugestão');
  assert.strictEqual((await responder(p, { permitir: false })).message, 'Negado pelo usuário no app.');
});

test('6.4: "sempre" no projeto ou para o usuário guarda antes uma cópia do arquivo que o Claude vai gravar', async (t) => {
  const os = require('os');
  const c = new conversa._Conversa({ id: 'ps2', titulo: 'Conversa de permissão 2' });
  t.after(() => c.parar());
  const copias = path.join(os.homedir(), '.local', 'share', 'orq-app', 'versoes', 'claude-settings');
  const quantas = () => { try { return fs.readdirSync(copias).length; } catch { return 0; } };
  const doUsuario = path.join(os.homedir(), '.claude', 'settings.json');
  fs.mkdirSync(path.dirname(doUsuario), { recursive: true });
  const jaHavia = fs.existsSync(doUsuario);
  if (!jaHavia) fs.writeFileSync(doUsuario, '{"permissions":{"allow":["Bash(ls)"]}}\n');
  let n = 0;
  const pedir = async () => { c.mandar('pede permissão com sugestão'); await ate(() => c.pendentes.size === 1); return [...c.pendentes.values()][0]; };
  const responder = async (p, decisao) => { c.responder(p.id, decisao); n++; await ate(() => turnos(c) === n); };
  let antes = quantas();
  await responder(await pedir(), { permitir: true, sempre: 'session' });
  assert.strictEqual(quantas(), antes, 'só nesta conversa: nada é gravado, nada é copiado');
  await responder(await pedir(), { permitir: true, sempre: 'userSettings' });
  assert.strictEqual(quantas(), antes + 1, 'para o usuário: cópia do settings.json antes');
  const copia = fs.readdirSync(copias).sort().pop();
  assert.strictEqual(fs.readFileSync(path.join(copias, copia), 'utf8'), fs.readFileSync(doUsuario, 'utf8'));
  // No projeto: o arquivo ainda não existe na pasta da conversa → nada a copiar, e a resposta vai igual.
  antes = quantas();
  await responder(await pedir(), { permitir: true, sempre: 'localSettings' });
  assert.strictEqual(quantas(), antes);
});

// Plano 2.3: cartão do plano (sair do modo Planejar). Três saídas: aprovar e seguir em Auto,
// aprovar e perguntar a cada mudança, continuar planejando (com o que ajustar). O plano
// editado pela pessoa volta no lugar do original. O modo depois de aprovar vai na resposta.
test('2.3: plano pronto: aprovar leva o modo escolhido (e o plano editado); continuar planejando nega dizendo o ajuste', async (t) => {
  const c = new conversa._Conversa({ id: 'pl1', titulo: 'Conversa do plano' });
  t.after(() => c.parar());
  let n = 0;
  const respostaDoApp = () => recebidos().filter((x) => x.type === 'control_response' && /^perm-/.test(x.response.request_id)).pop().response.response;
  const pedir = async () => { c.mandar('pede para sair do plano'); await ate(() => c.pendentes.size === 1); return [...c.pendentes.values()][0]; };
  const responder = async (p, decisao) => { assert.strictEqual(c.responder(p.id, decisao), true); n++; await ate(() => turnos(c) === n); return respostaDoApp(); };

  let p = await pedir();
  assert.strictEqual(p.ferramenta, 'ExitPlanMode');
  assert.match(p.entrada.plan, /^# Plano: exportar em CSV/);
  assert.strictEqual(p.sempre, null, 'plano não tem "permitir sempre"');
  let r = await responder(p, { permitir: true, modo: 'auto' });
  assert.deepStrictEqual([r.behavior, r.updatedInput.plan, r.updatedPermissions], ['allow', p.entrada.plan, [{ type: 'setMode', mode: 'auto', destination: 'session' }]]);

  p = await pedir();
  r = await responder(p, { permitir: true, modo: 'default', plano: '# Plano editado\n\nSem botão novo.' });
  assert.deepStrictEqual([r.updatedInput.plan, r.updatedPermissions[0].mode], ['# Plano editado\n\nSem botão novo.', 'default']);

  // Modo que o cartão não oferece (ou plano vazio) não passa: aprova sem trocar o modo, com o plano original.
  p = await pedir();
  r = await responder(p, { permitir: true, modo: 'bypassPermissions', plano: '   ' });
  assert.deepStrictEqual([r.behavior, r.updatedPermissions, r.updatedInput.plan], ['allow', undefined, p.entrada.plan]);

  p = await pedir();
  r = await responder(p, { permitir: false, continuarPlano: true, emVezDisso: 'ponha a exportação no menu' });
  assert.strictEqual(r.behavior, 'deny');
  assert.match(r.message, /continuar planejando[\s\S]*ponha a exportação no menu/);

  // O modo só vai em pedido de plano: num comando comum, "modo" é ignorado.
  c.mandar('pede permissão sem sugestão');
  await ate(() => c.pendentes.size === 1);
  r = await responder([...c.pendentes.values()][0], { permitir: true, modo: 'auto', plano: 'x' });
  assert.deepStrictEqual([r.updatedPermissions, r.updatedInput], [undefined, { command: 'npm test -- --so-unidade' }]);
});

// Plano 8.8 (X8): o Codex recusa abrir a conversa com a política do app (uma organização
// pode limitar as políticas permitidas). O app falha fechado: não abre, não tenta outra
// política, diz por quê, devolve o texto à caixa e não fica preso em "trabalhando".
test('8.8 (Codex): thread/start recusado → não abre, não tenta política mais frouxa, explica e devolve o texto', async (t) => {
  const RECUSA = 'invalid value for `approval_policy`: `untrusted` is not in the allowed set [on-request, never]';
  process.env.CODEX_FALSO_RECUSA_POLITICA = RECUSA;
  t.after(() => { delete process.env.CODEX_FALSO_RECUSA_POLITICA; });
  const antes = xrecebidos().length;
  const c = new conversa._Conversa({ id: 'x88', titulo: 'X', motor: 'codex' });
  t.after(() => c.parar());
  c.mandar('roda os testes do projeto');
  await ate(() => c.eventos.some((e) => e.tipo === 'erro'));
  const erro = c.eventos.find((e) => e.tipo === 'erro');
  assert.match(erro.texto, /O Codex não abriu a conversa/);
  assert.ok(erro.texto.includes(RECUSA), 'o motivo do Codex aparece como veio');
  assert.match(erro.texto, /não tenta abrir com uma política mais frouxa/);
  assert.strictEqual(erro.devolver, 'roda os testes do projeto', 'o texto volta para a caixa');
  await ate(() => !c.proc);
  assert.strictEqual(c.info.ocupado, false, 'não fica preso em "trabalhando"');
  assert.strictEqual(c.sessao || null, null, 'nenhuma conversa aberta');
  await espera(300);
  const meus = xrecebidos().slice(antes);
  const inicios = meus.filter((x) => x.method === 'thread/start');
  assert.strictEqual(inicios.length, 1, 'uma tentativa só');
  assert.deepStrictEqual([inicios[0].params.approvalPolicy, inicios[0].params.approvalsReviewer], ['untrusted', 'auto_review']);
  assert.ok(!meus.some((x) => x.method === 'turn/start'), 'nada foi mandado ao modelo');
  assert.ok(!c.eventos.some((e) => e.tipo === 'fim'), 'um aviso só: sem "o Codex parou" por cima');
  // Outra mensagem tenta de novo com a MESMA política (nunca muda sozinha).
  c.mandar('de novo');
  await ate(() => c.eventos.some((e) => e.tipo === 'erro' && e.devolver === 'de novo'));
  await ate(() => !c.proc && !c.info.ocupado);
  await espera(200);
  const todos = xrecebidos().slice(antes).filter((x) => x.method === 'thread/start').map((x) => x.params.approvalPolicy);
  assert.deepStrictEqual(todos, ['untrusted', 'untrusted']);
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
