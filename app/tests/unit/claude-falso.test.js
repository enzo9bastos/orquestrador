// Área: conversa (o Claude falso dos testes: tests/unit/claude-falso.js)
// 0.D1 da Etapa 0. O falso é a base dos testes da conversa: se ele mudar sem
// querer, dezenas de testes passam a testar outra coisa. Aqui cada comportamento
// do roteiro tem o seu teste, falando com o falso direto pelo stdin/stdout.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const FALSO = path.join(__dirname, 'claude-falso.js');
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-claude-falso-teste-'));
let nLog = 0;

// Sobe o falso com estas variáveis (as CLAUDE_FALSO_* de fora não vazam).
function subir(env = {}, args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--permission-mode', 'auto']) {
  const log = path.join(pasta, `log-${++nLog}.jsonl`);
  const limpo = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE_FALSO_')));
  const p = spawn(process.execPath, [FALSO, ...args], { env: { ...limpo, HOME: pasta, CLAUDE_FALSO_LOG: log, ...env }, cwd: pasta, stdio: ['pipe', 'pipe', 'pipe'] });
  const saidas = [];
  let resto = '';
  p.stdout.on('data', (b) => {
    resto += b;
    const linhas = resto.split('\n');
    resto = linhas.pop();
    for (const l of linhas) if (l.trim()) saidas.push(JSON.parse(l));
  });
  let saiu = null;
  p.on('exit', (codigo) => { saiu = codigo; });
  const f = {
    p, log, saidas,
    saiu: () => saiu,
    manda: (o) => p.stdin.write(JSON.stringify(o) + '\n'),
    msg: (texto) => f.manda({ type: 'user', message: { role: 'user', content: texto } }),
    pede: (request_id, request) => f.manda({ type: 'control_request', request_id, request }),
    ate: async (cond, ms = 4000) => {
      for (let i = 0; i < ms / 10; i++) { const r = cond(saidas); if (r) return r; await new Promise((ok) => setTimeout(ok, 10)); }
      throw new Error(`não aconteceu a tempo; saídas: ${JSON.stringify(saidas).slice(0, 600)}`);
    },
    resposta: (id) => f.ate((s) => s.find((o) => o.type === 'control_response' && o.response.request_id === id)),
    fimDeTurno: (n = 1) => f.ate((s) => s.filter((o) => o.type === 'result').length >= n),
    anotado: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []),
    fecha: () => { try { p.kill(); } catch { /* já saiu */ } },
  };
  return f;
}
const textos = (s) => s.filter((o) => o.type === 'assistant').map((o) => o.message.content[0].text);
const rodar = (args, env = {}) => spawnSync(process.execPath, [FALSO, ...args], { env: { ...process.env, CLAUDE_FALSO_LOG: '', ...env }, encoding: 'utf8' });

// --- versão ------------------------------------------------------------------
test('falso: --version imprime 9.9.9 por padrão', () => {
  assert.strictEqual(rodar(['--version'], { CLAUDE_FALSO_VERSAO: '' }).stdout.trim(), '9.9.9 (Claude Code)');
});

test('falso: $CLAUDE_FALSO_VERSAO muda o --version, o init e o get_status', async (t) => {
  assert.strictEqual(rodar(['--version'], { CLAUDE_FALSO_VERSAO: '2.0.1' }).stdout.trim(), '2.0.1 (Claude Code)');
  const f = subir({ CLAUDE_FALSO_VERSAO: '2.0.1' });
  t.after(f.fecha);
  f.msg('oi');
  await f.fimDeTurno();
  assert.strictEqual(f.saidas.find((o) => o.subtype === 'init').claude_code_version, '2.0.1');
  f.pede('s1', { subtype: 'get_status' });
  const r = await f.resposta('s1');
  assert.strictEqual(r.response.response.sections[0].rows[0].value, '2.0.1');
});

test('falso: roteiro em arquivo ($CLAUDE_FALSO_ROTEIRO) escolhe versão e subtipos que faltam; a variável vale mais', async (t) => {
  const roteiro = path.join(pasta, 'roteiro.json');
  fs.writeFileSync(roteiro, JSON.stringify({ versao: '1.5.0', sem: ['get_plan'] }));
  assert.strictEqual(rodar(['--version'], { CLAUDE_FALSO_ROTEIRO: roteiro }).stdout.trim(), '1.5.0 (Claude Code)');
  assert.strictEqual(rodar(['--version'], { CLAUDE_FALSO_ROTEIRO: roteiro, CLAUDE_FALSO_VERSAO: '1.6.0' }).stdout.trim(), '1.6.0 (Claude Code)');
  const f = subir({ CLAUDE_FALSO_ROTEIRO: roteiro });
  t.after(f.fecha);
  f.pede('p1', { subtype: 'get_plan' });
  assert.strictEqual((await f.resposta('p1')).response.error_code, 'unsupported_request');
  f.pede('p2', { subtype: 'get_status' });
  assert.strictEqual((await f.resposta('p2')).response.subtype, 'success');
});

// --- log, init e mensagens -----------------------------------------------------
test('falso: anota os argumentos e cada linha recebida em $CLAUDE_FALSO_LOG', async (t) => {
  const f = subir();
  t.after(f.fecha);
  f.msg('oi');
  await f.fimDeTurno();
  const l = f.anotado();
  assert.deepStrictEqual(l[0].args.slice(0, 2), ['-p', '--input-format']);
  assert.strictEqual(l[1].type, 'user');
  assert.strictEqual(l[1].message.content, 'oi');
});

test('falso: init a cada mensagem (nada antes dela), "ok" e fim de turno', async (t) => {
  const f = subir();
  t.after(f.fecha);
  await new Promise((ok) => setTimeout(ok, 150));
  assert.strictEqual(f.saidas.length, 0, 'sem mensagem, sem init');
  f.msg('oi');
  f.msg('de novo');
  await f.fimDeTurno(2);
  assert.deepStrictEqual(f.saidas.map((o) => o.type), ['system', 'assistant', 'result', 'system', 'assistant', 'result']);
  const init = f.saidas[0];
  assert.strictEqual(init.subtype, 'init');
  assert.strictEqual(init.session_id, 'S-falso');
  assert.strictEqual(init.permissionMode, 'auto', 'o modo do --permission-mode');
  assert.deepStrictEqual(init.slash_commands, ['compact']);
  assert.deepStrictEqual(textos(f.saidas), ['ok', 'ok']);
});

test('falso: $CLAUDE_FALSO_COMANDOS troca a lista do init; --model vale no init', async (t) => {
  const f = subir({ CLAUDE_FALSO_COMANDOS: JSON.stringify(['compact', 'agents']) }, ['-p', '--model', 'claude-sonnet-5-5']);
  t.after(f.fecha);
  f.msg('oi');
  await f.fimDeTurno();
  const init = f.saidas.find((o) => o.subtype === 'init');
  assert.deepStrictEqual(init.slash_commands, ['compact', 'agents']);
  assert.strictEqual(init.model, 'claude-sonnet-5-5');
});

test('falso: $CLAUDE_FALSO_INIT_NA_SUBIDA manda o init sem esperar mensagem', async (t) => {
  const f = subir({ CLAUDE_FALSO_INIT_NA_SUBIDA: '1' });
  t.after(f.fecha);
  const init = await f.ate((s) => s.find((o) => o.subtype === 'init'));
  assert.strictEqual(init.session_id, 'S-falso');
});

test('falso: sessão S-falso qualquer que seja o --resume (padrão); com $CLAUDE_FALSO_SESSAO_REAL segue o --resume e o --fork-session', async (t) => {
  const padrao = subir({ CLAUDE_FALSO_INIT_NA_SUBIDA: '1' }, ['-p', '--resume', 'S-velha']);
  t.after(padrao.fecha);
  assert.strictEqual((await padrao.ate((s) => s.find((o) => o.subtype === 'init'))).session_id, 'S-falso');
  const real = subir({ CLAUDE_FALSO_INIT_NA_SUBIDA: '1', CLAUDE_FALSO_SESSAO_REAL: '1' }, ['-p', '--resume', 'S-velha']);
  t.after(real.fecha);
  assert.strictEqual((await real.ate((s) => s.find((o) => o.subtype === 'init'))).session_id, 'S-velha');
  const ramo = subir({ CLAUDE_FALSO_INIT_NA_SUBIDA: '1', CLAUDE_FALSO_SESSAO_REAL: '1' }, ['-p', '--resume', 'S-velha', '--fork-session']);
  t.after(ramo.fecha);
  const s = (await ramo.ate((x) => x.find((o) => o.subtype === 'init'))).session_id;
  assert.ok(s !== 'S-velha' && /^S-nova-\d+$/.test(s), s);
});

test('falso: $CLAUDE_FALSO_FALHA_RESUME sai com código 1 e o texto no stderr, antes do init', async () => {
  const r = rodar(['-p', '--resume', 'S-x'], { CLAUDE_FALSO_FALHA_RESUME: 'No conversation found with session ID: S-x' });
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /No conversation found/);
  assert.strictEqual(r.stdout, '');
});

// --- comandos digitados --------------------------------------------------------
test('falso: /clear manda o init da sessão nova e o conversation_reset (new_conversation_id não é a sessão)', async (t) => {
  const f = subir();
  t.after(f.fecha);
  f.msg('oi');
  await f.fimDeTurno();
  f.msg('/clear');
  await f.fimDeTurno(2);
  const inits = f.saidas.filter((o) => o.subtype === 'init');
  assert.strictEqual(inits.at(-1).session_id, 'S-falso-2');
  const reset = f.saidas.find((o) => o.type === 'conversation_reset');
  assert.strictEqual(reset.session_id, 'S-falso-2');
  assert.notStrictEqual(reset.new_conversation_id, 'S-falso-2');
});

test('falso: /config permissionMode=x manda system/status com o modo novo', async (t) => {
  const f = subir();
  t.after(f.fecha);
  f.msg('/config permissionMode=plan');
  await f.fimDeTurno();
  const st = f.saidas.find((o) => o.type === 'system' && o.subtype === 'status');
  assert.strictEqual(st.permissionMode, 'plan');
  assert.ok(f.saidas.some((o) => o.type === 'user' && /<local-command-stdout>Set permissionMode to plan/.test(o.message.content)));
});

test('falso: /rename x manda session_title_changed', async (t) => {
  const f = subir();
  t.after(f.fecha);
  f.msg('/rename Plano novo');
  await f.fimDeTurno();
  assert.strictEqual(f.saidas.find((o) => o.subtype === 'session_title_changed').title, 'Plano novo');
});

test('falso: /effort x e /heapdump respondem como saída de comando local', async (t) => {
  const f = subir();
  t.after(f.fecha);
  f.msg('/effort high');
  await f.fimDeTurno();
  f.msg('/heapdump');
  await f.fimDeTurno(2);
  const locais = f.saidas.filter((o) => o.type === 'user').map((o) => o.message.content);
  assert.match(locais[0], /^<local-command-stdout>Set effort level to high/);
  assert.match(locais[1], /^<local-command-stdout>Heap dump written to /);
});

test('falso: "manda N deltas" manda message_start, N text_delta e a mensagem inteira', async (t) => {
  const f = subir();
  t.after(f.fecha);
  f.msg('manda 5 deltas');
  await f.fimDeTurno();
  const deltas = f.saidas.filter((o) => o.type === 'stream_event' && o.event.type === 'content_block_delta').map((o) => o.event.delta.text);
  assert.deepStrictEqual(deltas, ['d0 ', 'd1 ', 'd2 ', 'd3 ', 'd4 ']);
  assert.ok(f.saidas.some((o) => o.type === 'stream_event' && o.event.type === 'message_start'));
  assert.deepStrictEqual(textos(f.saidas), ['d0 d1 d2 d3 d4 ']);
});

test('falso: "começa tarefa de fundo" sobe um sleep filho, avisa task_started, e o SIGTERM encerra o filho', async (t) => {
  const f = subir();
  t.after(f.fecha);
  f.msg('começa tarefa de fundo');
  await f.fimDeTurno();
  assert.strictEqual(f.saidas.find((o) => o.subtype === 'task_started').task_id, 't-fundo');
  const pid = f.anotado().find((o) => o.tarefa).tarefa;
  assert.doesNotThrow(() => process.kill(pid, 0), 'o sleep está vivo');
  f.p.kill('SIGTERM');
  await f.ate(() => f.saiu() !== null);
  let vivo = true;
  for (let i = 0; i < 100 && vivo; i++) { try { process.kill(pid, 0); await new Promise((ok) => setTimeout(ok, 20)); } catch { vivo = false; } }
  assert.strictEqual(vivo, false, 'o sleep saiu junto');
});

// --- pedidos do falso ao app ---------------------------------------------------
test('falso: "pede elicitation" espera a control_response; com erro, segue sem ela', async (t) => {
  const f = subir();
  t.after(f.fecha);
  f.msg('pede elicitation');
  const pedido = await f.ate((s) => s.find((o) => o.type === 'control_request'));
  assert.strictEqual(pedido.request.subtype, 'elicitation');
  assert.ok(!f.saidas.some((o) => o.type === 'result'), 'o turno espera a resposta');
  f.manda({ type: 'control_response', response: { subtype: 'error', request_id: pedido.request_id, error: 'não' } });
  await f.fimDeTurno();
  assert.deepStrictEqual(textos(f.saidas), ['seguiu sem a elicitação']);
});

test('falso: "pede controle <subtipo>" pede qualquer subtipo e conta a resposta', async (t) => {
  const f = subir();
  t.after(f.fecha);
  f.msg('pede controle ui_coisa_nova');
  const pedido = await f.ate((s) => s.find((o) => o.type === 'control_request'));
  assert.deepStrictEqual(pedido.request, { subtype: 'ui_coisa_nova' });
  f.manda({ type: 'control_response', response: { subtype: 'error', request_id: pedido.request_id, error: 'o app não atende' } });
  await f.fimDeTurno();
  assert.deepStrictEqual(textos(f.saidas), ['resposta ao ui_coisa_nova: error: o app não atende']);
});

test('falso: "pede e cancela" pede permissão e manda control_cancel_request', async (t) => {
  const f = subir();
  t.after(f.fecha);
  f.msg('pede e cancela');
  await f.fimDeTurno();
  const pedido = f.saidas.find((o) => o.type === 'control_request');
  assert.strictEqual(pedido.request.subtype, 'can_use_tool');
  assert.strictEqual(f.saidas.find((o) => o.type === 'control_cancel_request').request_id, pedido.request_id);
});

test('falso: "pede permissão e termina" termina o turno sem esperar a resposta', async (t) => {
  const f = subir();
  t.after(f.fecha);
  f.msg('pede permissão e termina');
  await f.fimDeTurno();
  assert.strictEqual(f.saidas.find((o) => o.type === 'control_request').request_id, 'p-2');
  assert.deepStrictEqual(textos(f.saidas), ['terminou sem a resposta']);
});

// --- pedidos do app ao falso ---------------------------------------------------
test('falso: set_model responde sucesso e o próximo init traz o modelo; $CLAUDE_FALSO_RECUSA_MODELO recusa', async (t) => {
  const f = subir();
  t.after(f.fecha);
  f.pede('m1', { subtype: 'set_model', model: 'claude-haiku-5-5' });
  assert.deepStrictEqual((await f.resposta('m1')).response, { subtype: 'success', request_id: 'm1', response: { model: 'claude-haiku-5-5' } });
  f.msg('oi');
  await f.fimDeTurno();
  assert.strictEqual(f.saidas.find((o) => o.subtype === 'init').model, 'claude-haiku-5-5');
  const g = subir({ CLAUDE_FALSO_RECUSA_MODELO: 'modelo indisponível' });
  t.after(g.fecha);
  g.pede('m2', { subtype: 'set_model', model: 'x' });
  assert.deepStrictEqual((await g.resposta('m2')).response, { subtype: 'error', request_id: 'm2', error: 'modelo indisponível' });
});

test('falso: set_permission_mode responde sucesso e manda system/status', async (t) => {
  const f = subir();
  t.after(f.fecha);
  f.pede('pm', { subtype: 'set_permission_mode', mode: 'plan' });
  assert.deepStrictEqual((await f.resposta('pm')).response.response, { mode: 'plan' });
  const st = await f.ate((s) => s.find((o) => o.type === 'system' && o.subtype === 'status'));
  assert.strictEqual(st.permissionMode, 'plan');
});

test('falso: apply_flag_settings responde sucesso; $CLAUDE_FALSO_RECUSA_ESFORCO recusa', async (t) => {
  const f = subir();
  t.after(f.fecha);
  f.pede('e1', { subtype: 'apply_flag_settings', settings: { effortLevel: 'high' } });
  assert.strictEqual((await f.resposta('e1')).response.subtype, 'success');
  const g = subir({ CLAUDE_FALSO_RECUSA_ESFORCO: 'não dá' });
  t.after(g.fecha);
  g.pede('e2', { subtype: 'apply_flag_settings', settings: { effortLevel: 'high' } });
  assert.strictEqual((await g.resposta('e2')).response.error, 'não dá');
});

test('falso: interrupt responde sucesso', async (t) => {
  const f = subir();
  t.after(f.fecha);
  f.pede('i1', { subtype: 'interrupt' });
  assert.deepStrictEqual((await f.resposta('i1')).response, { subtype: 'success', request_id: 'i1', response: {} });
});

test('falso: rewind_files responde no formato do 2.1.325 (canRewind, filesChanged, insertions, deletions)', async (t) => {
  const f = subir();
  t.after(f.fecha);
  f.pede('r1', { subtype: 'rewind_files', user_message_id: 'u-1', dry_run: true });
  assert.deepStrictEqual((await f.resposta('r1')).response.response, { canRewind: true, filesChanged: ['app/x.js'], insertions: 3, deletions: 1 });
  f.pede('r2', { subtype: 'rewind_files' });
  assert.strictEqual((await f.resposta('r2')).response.subtype, 'error', 'sem user_message_id é erro');
});

test('falso: os pedidos dos comandos do "/" respondem sucesso no formato de cada um', async (t) => {
  const f = subir();
  t.after(f.fecha);
  const formatos = {
    get_status: (r) => Array.isArray(r.sections),
    get_memory_dialog: (r) => Array.isArray(r.files),
    get_skills_dialog: (r) => Array.isArray(r.skills),
    get_hooks_listing: (r) => Array.isArray(r.hooks),
    export_conversation: (r) => typeof r.text === 'string',
    get_plan: (r) => r.exists === true && typeof r.content === 'string',
    get_workspace_diff: (r) => r.diff && r.diff.stats.filesCount === 1,
    side_question: (r) => r.response === 'resposta de lado para: qual?',
    submit_feedback: (r) => r.feedback_id === 'fb-falso-1',
    background_tasks: (r) => typeof r === 'object',
    get_task_output: (r) => r.output === 'saída da tarefa t-1',
    stop_task: (r) => typeof r === 'object',
    mcp_status: (r) => Array.isArray(r.mcpServers) && r.mcpServers[0].name === 'falso-mcp',
  };
  for (const sub of Object.keys(formatos)) f.pede(`c-${sub}`, { subtype: sub, question: 'qual?', task_id: 't-1' });
  for (const [sub, ok] of Object.entries(formatos)) {
    const r = (await f.resposta(`c-${sub}`)).response;
    assert.strictEqual(r.subtype, 'success', sub);
    assert.ok(ok(r.response), `formato do ${sub}: ${JSON.stringify(r.response)}`);
  }
});

test('falso: $CLAUDE_FALSO_SEM_CONTROLES — os pedidos do "/" respondem erro só com o texto (CLI antigo, sem error_code)', async (t) => {
  const f = subir({ CLAUDE_FALSO_SEM_CONTROLES: '1' });
  t.after(f.fecha);
  f.pede('s1', { subtype: 'get_status' });
  assert.deepStrictEqual((await f.resposta('s1')).response, { subtype: 'error', request_id: 's1', error: 'Unsupported control request subtype: get_status' });
  f.pede('s2', { subtype: 'set_model', model: 'x' });
  assert.strictEqual((await f.resposta('s2')).response.subtype, 'success', 'o set_model não é dos comandos do "/"');
});

test('falso: subtipo desconhecido responde como o CLI de verdade (texto + error_code unsupported_request)', async (t) => {
  const f = subir();
  t.after(f.fecha);
  f.pede('x1', { subtype: 'subtipo_que_nao_existe' });
  assert.deepStrictEqual((await f.resposta('x1')).response,
    { subtype: 'error', request_id: 'x1', error: 'Unsupported control request subtype: subtipo_que_nao_existe', error_code: 'unsupported_request' });
});

test('falso: $CLAUDE_FALSO_SEM tira subtipos um a um (qualquer um, inclusive set_model e interrupt); o resto segue igual', async (t) => {
  const f = subir({ CLAUDE_FALSO_SEM: 'set_model, interrupt,get_plan' });
  t.after(f.fecha);
  for (const [id, sub] of [['a', 'set_model'], ['b', 'interrupt'], ['c', 'get_plan']]) {
    f.pede(id, { subtype: sub, model: 'x' });
    const r = (await f.resposta(id)).response;
    assert.strictEqual(r.error_code, 'unsupported_request', sub);
    assert.strictEqual(r.error, `Unsupported control request subtype: ${sub}`);
  }
  f.pede('d', { subtype: 'get_status' });
  assert.strictEqual((await f.resposta('d')).response.subtype, 'success');
  f.msg('oi');
  await f.fimDeTurno();
  assert.strictEqual(f.saidas.find((o) => o.subtype === 'init').model, 'claude-falso-1-0', 'o set_model recusado não trocou o modelo');
});
