#!/usr/bin/env node
// Claude falso para os testes (0.D1, a parte que a Etapa 0.A usa): fala o
// stream-json do `claude -p --input-format stream-json` e anota cada linha que
// recebe em $CLAUDE_FALSO_LOG (a primeira linha é { args }).
//
// Roteiro, pelo texto da mensagem do usuário:
//   "pede elicitation"         control_request de um subtipo que o app não atende;
//                              espera a control_response e então termina o turno
//   "pede e cancela"           pede permissão (can_use_tool) e cancela o pedido
//                              (control_cancel_request); depois termina o turno
//   "pede permissão e termina" pede permissão e termina o turno sem esperar
//   "começa tarefa de fundo"   sobe um `sleep` filho (a "tarefa em segundo plano",
//                              anotada no log como { tarefa: pid }) e termina o turno;
//                              ao receber SIGTERM o falso encerra os filhos, como o
//                              Claude de verdade faz com as tarefas dele
//   "/effort x"                saída do comando (<local-command-stdout>) e fim de turno
//   "/config permissionMode=x" troca o modo: system/status com permissionMode
//   "/clear"                   init da sessão nova, conversation_reset, fim de turno
//   "/rename x"                system/session_title_changed com o nome novo
//   "manda N deltas"           N text_delta ("d0 ", "d1 "…) espalhados em ~1 s, depois a
//                              mensagem inteira e o fim de turno (0.C5: junção dos envios)
//   "pede controle <subtipo>"  control_request desse subtipo ao app (qualquer um); espera
//                              a control_response e responde "resposta ao <subtipo>:
//                              success" (ou "error: <texto>") e termina o turno
//   qualquer outra coisa       responde "ok" e termina o turno
// Pedidos de controle do app: set_model (o próximo init traz o modelo novo),
// set_permission_mode e interrupt recebem control_response de sucesso.
// apply_flag_settings (esforço só da sessão) também; com $CLAUDE_FALSO_RECUSA_ESFORCO
// ele é recusado com esse texto de erro.
// $CLAUDE_FALSO_RECUSA_MODELO: o set_model é recusado com esse texto de erro.
// rewind_files responde { canRewind, filesChanged, insertions, deletions } (o
// formato do 2.1.325), com ou sem dry_run.
// Pedidos dos comandos do "/" que o app faz (respostas no formato do 2.1.325):
// get_status, get_memory_dialog, get_skills_dialog, get_hooks_listing,
// export_conversation, get_plan, get_workspace_diff, side_question,
// submit_feedback, background_tasks, get_task_output, stop_task e mcp_status.
// "/heapdump" responde como o de verdade (<local-command-stdout>).
// $CLAUDE_FALSO_SEM_CONTROLES: esses pedidos respondem erro só com o texto, sem
// error_code (Claude antigo que não os conhece).
// Subtipo que o falso não conhece: erro como o do CLI de verdade,
// "Unsupported control request subtype: x" com error_code "unsupported_request".
// $CLAUDE_FALSO_FALHA_RESUME: com --resume, escreve esse texto no stderr e sai
// com código 1 antes do init (sessão que o Claude não abriu).
//
// Para testar comportamento por versão do CLI (nada disto muda o padrão):
//   $CLAUDE_FALSO_VERSAO        o que o --version imprime, o claude_code_version do
//                               init e a linha "Versão" do get_status (padrão 9.9.9)
//   $CLAUDE_FALSO_SEM           subtipos que "este CLI não tem", separados por vírgula
//                               (qualquer um, inclusive set_model e interrupt): respondem
//                               o erro unsupported_request do CLI de verdade
//   $CLAUDE_FALSO_SESSAO_REAL   =1: a sessão do init segue o --resume, e o
//                               --fork-session dá uma sessão nova (como o CLI)
//   $CLAUDE_FALSO_INIT_NA_SUBIDA =1: manda um init assim que sobe, sem esperar mensagem
//   $CLAUDE_FALSO_ROTEIRO       arquivo JSON com as mesmas escolhas:
//                               { "versao": "2.0.0", "sem": ["get_plan"],
//                                 "sessaoReal": true, "initNaSubida": true }
//                               (a variável de ambiente vale mais que o arquivo)
const fs = require('fs');
const readline = require('readline');

const ROTEIRO = (() => {
  if (!process.env.CLAUDE_FALSO_ROTEIRO) return {};
  try { return JSON.parse(fs.readFileSync(process.env.CLAUDE_FALSO_ROTEIRO, 'utf8')) || {}; } catch { return {}; }
})();
const escolha = (env, chave) => (process.env[env] !== undefined && process.env[env] !== '' ? process.env[env] : ROTEIRO[chave]);
const VERSAO = String(escolha('CLAUDE_FALSO_VERSAO', 'versao') || '9.9.9');
const SEM = new Set((() => {
  const v = escolha('CLAUDE_FALSO_SEM', 'sem');
  return Array.isArray(v) ? v : String(v || '').split(',');
})().map((s) => String(s).trim()).filter(Boolean));
const ligado = (env, chave) => { const v = escolha(env, chave); return v === true || v === '1' || v === 'true'; };
const SESSAO_REAL = ligado('CLAUDE_FALSO_SESSAO_REAL', 'sessaoReal');
const INIT_NA_SUBIDA = ligado('CLAUDE_FALSO_INIT_NA_SUBIDA', 'initNaSubida');

if (process.argv[2] === '--version') { console.log(`${VERSAO} (Claude Code)`); process.exit(0); }
const log = (o) => { if (process.env.CLAUDE_FALSO_LOG) fs.appendFileSync(process.env.CLAUDE_FALSO_LOG, JSON.stringify(o) + '\n'); };
const sai = (o) => process.stdout.write(JSON.stringify(o) + '\n');
log({ args: process.argv.slice(2) });

const args = process.argv.slice(2);
const arg = (nome) => { const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : null; };
if (process.env.CLAUDE_FALSO_FALHA_RESUME && arg('--resume')) {
  process.stderr.write(process.env.CLAUDE_FALSO_FALHA_RESUME + '\n');
  process.exit(1);
}
// Sessão: S-falso sempre (o padrão de sempre). Com a sessão real, como o CLI:
// --resume x continua a x, e --fork-session abre uma nova.
let SESSAO = 'S-falso';
if (SESSAO_REAL) SESSAO = args.includes('--fork-session') || !arg('--resume') ? `S-nova-${process.pid}` : arg('--resume');
let modelo = arg('--model') || 'claude-falso-1-0';
let modo = arg('--permission-mode') || 'default';
let limpezas = 0;
const filhos = [];
process.on('SIGTERM', () => { for (const f of filhos) { try { f.kill(); } catch { /* já saiu */ } } process.exit(143); });
// Lista do init: ['compact'], ou a de $CLAUDE_FALSO_COMANDOS (JSON).
const COMANDOS = (() => { try { return JSON.parse(process.env.CLAUDE_FALSO_COMANDOS || 'null') || ['compact']; } catch { return ['compact']; } })();
const esperando = new Map(); // request_id → o que fazer quando a resposta chegar
const texto = (t) => sai({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: t }] } });
const fim = (result = 'ok') => sai({ type: 'result', subtype: 'success', is_error: false, duration_ms: 5, result, session_id: SESSAO });
const init = () => sai({ type: 'system', subtype: 'init', session_id: SESSAO, model: modelo, permissionMode: modo, cwd: process.cwd(), slash_commands: COMANDOS, claude_code_version: VERSAO, tools: ['Bash', 'Read'], mcp_servers: [{ name: 'falso-mcp', status: 'connected' }] });
const HOME = require('os').homedir();
// Respostas dos pedidos de controle dos comandos do "/".
const CONTROLES = {
  get_status: () => ({ sections: [{ title: 'Sessão', rows: [{ label: 'Versão', value: VERSAO }, { label: 'Modelo', value: modelo }, { label: 'Pasta', value: process.cwd() }] },
    { title: 'Conta', rows: [{ label: 'Login', value: 'ana@exemplo.com' }] }] }),
  get_memory_dialog: () => ({ files: [
    { kind: 'user', path: require('path').join(HOME, '.claude', 'CLAUDE.md'), label: 'User memory', description: 'Saved in ~/.claude/CLAUDE.md', exists: require('fs').existsSync(require('path').join(HOME, '.claude', 'CLAUDE.md')) },
    { kind: 'project', path: require('path').join(process.cwd(), 'CLAUDE.md'), label: 'Project memory', description: 'Saved in ./CLAUDE.md', exists: false }],
    folders: [], auto_memory: { enabled: false, toggleable: true, status: 'off' }, auto_dream: { shown: false, enabled: false, toggleable: false, status: '', detail: '' } }),
  get_skills_dialog: () => ({ skills: [{ name: 'rodada', display_name: 'rodada', description: 'Faz a rodada', source: 'user', tokens: 120, state: 'on', advertised: true },
    { name: 'pesada', display_name: 'pesada', description: 'Skill grande', source: 'user', tokens: 4000, state: 'on', advertised: true }] }),
  get_hooks_listing: () => ({ events: [], hooks: [{ event: 'Stop', matcher: '', source: 'pluginHook', sourceLabel: 'Plugin falso', type: 'command', displayText: 'echo fim' }] }),
  export_conversation: () => ({ text: 'Você: oi\n\nClaude: ok\n', default_filename: '2026-11-16-oi.txt' }),
  get_plan: () => ({ exists: true, content: '# Plano falso\n\n1. Ler\n2. Fazer', path: '/tmp/plano.md' }),
  get_workspace_diff: () => ({ diff: { stats: { filesCount: 1, linesAdded: 3, linesRemoved: 1 }, perFileStats: [{ path: 'app/x.js', added: 3, removed: 1, isBinary: false, isUntracked: false }], hunks: [] } }),
  side_question: (r) => ({ response: `resposta de lado para: ${r.question}` }),
  submit_feedback: () => ({ feedback_id: 'fb-falso-1' }),
  background_tasks: () => ({}),
  get_task_output: (r) => ({ output: `saída da tarefa ${r.task_id}` }),
  stop_task: () => ({}),
  mcp_status: () => ({ mcpServers: [{ name: 'falso-mcp', status: 'connected' }] }),
};
const saidaLocal = (t) => { sai({ type: 'user', message: { role: 'user', content: `<local-command-stdout>${t}</local-command-stdout>` }, session_id: SESSAO }); fim(t); };
const responde = (d, response = {}) => sai({ type: 'control_response', response: { subtype: 'success', request_id: d.request_id, response } });
// Erro do CLI de verdade para o subtipo que ele não atende (2.1.325: o texto fica
// para os clientes antigos, o error_code é o que diz "não atende").
const naoAtende = (d, subtipo) => sai({ type: 'control_response', response: { subtype: 'error', request_id: d.request_id,
  error: `Unsupported control request subtype: ${subtipo}`, error_code: 'unsupported_request' } });
if (INIT_NA_SUBIDA) init();

readline.createInterface({ input: process.stdin }).on('line', (l) => {
  let d;
  try { d = JSON.parse(l); } catch { return; }
  log(d);
  if (d.type === 'control_response') {
    const id = d.response && d.response.request_id;
    const f = esperando.get(id);
    if (f) { esperando.delete(id); f(d.response); }
    return;
  }
  if (d.type === 'control_request') {
    const r = d.request || {};
    if (SEM.has(r.subtype)) return naoAtende(d, r.subtype);
    if (r.subtype === 'set_model') {
      if (process.env.CLAUDE_FALSO_RECUSA_MODELO) return sai({ type: 'control_response', response: { subtype: 'error', request_id: d.request_id, error: process.env.CLAUDE_FALSO_RECUSA_MODELO } });
      modelo = r.model || 'claude-falso-1-0'; return responde(d, { model: modelo });
    }
    if (r.subtype === 'set_permission_mode') { modo = r.mode; responde(d, { mode: modo }); return sai({ type: 'system', subtype: 'status', status: null, permissionMode: modo, session_id: SESSAO }); }
    if (r.subtype === 'apply_flag_settings') {
      if (process.env.CLAUDE_FALSO_RECUSA_ESFORCO) return sai({ type: 'control_response', response: { subtype: 'error', request_id: d.request_id, error: process.env.CLAUDE_FALSO_RECUSA_ESFORCO } });
      return responde(d);
    }
    if (r.subtype === 'interrupt') return responde(d);
    if (r.subtype === 'rewind_files') {
      if (typeof r.user_message_id !== 'string') return sai({ type: 'control_response', response: { subtype: 'error', request_id: d.request_id, error: 'rewind_files: user_message_id must be a string' } });
      return responde(d, { canRewind: true, filesChanged: ['app/x.js'], insertions: 3, deletions: 1 });
    }
    if (CONTROLES[r.subtype]) {
      if (process.env.CLAUDE_FALSO_SEM_CONTROLES) return sai({ type: 'control_response', response: { subtype: 'error', request_id: d.request_id, error: `Unsupported control request subtype: ${r.subtype}` } });
      return responde(d, CONTROLES[r.subtype](r));
    }
    return naoAtende(d, String(r.subtype));
  }
  if (d.type !== 'user') return;
  const t = typeof d.message.content === 'string' ? d.message.content : (d.message.content.find((b) => b.type === 'text') || {}).text || '';
  if (t === '/clear') {
    // Como o Claude de verdade: o init do turno do /clear já traz a sessão nova,
    // e o new_conversation_id NÃO é o id da sessão.
    SESSAO = `S-falso-${++limpezas + 1}`;
    init();
    sai({ type: 'conversation_reset', new_conversation_id: `nao-e-a-sessao-${limpezas}`, uuid: `u-${limpezas}`, session_id: SESSAO, trigger: 'clear' });
    return fim('');
  }
  init();
  if (t === '/heapdump') return saidaLocal(`Heap dump written to ${HOME}/falso.heapsnapshot`);
  let m = /^\/effort (\S+)$/.exec(t);
  if (m) return saidaLocal(`Set effort level to ${m[1]} (this session only): falso`);
  m = /^\/config permissionMode=(\S+)$/.exec(t);
  if (m) { modo = m[1]; sai({ type: 'system', subtype: 'status', status: null, permissionMode: modo, session_id: SESSAO }); return saidaLocal(`Set permissionMode to ${modo}`); }
  m = /^\/rename (.+)$/.exec(t);
  if (m) { sai({ type: 'system', subtype: 'session_title_changed', title: m[1], uuid: 'u-t', session_id: SESSAO }); return saidaLocal(`Session renamed to: ${m[1]}`); }
  if (t === 'começa tarefa de fundo') {
    const f = require('child_process').spawn('sleep', ['300'], { stdio: 'ignore' });
    filhos.push(f);
    log({ tarefa: f.pid });
    sai({ type: 'system', subtype: 'task_started', task_id: 't-fundo', description: 'sleep 300', session_id: SESSAO });
    texto('tarefa de fundo começou');
    return fim();
  }
  if (t === 'pede elicitation') {
    esperando.set('el-1', (r) => { texto(r.subtype === 'error' ? 'seguiu sem a elicitação' : 'recebeu a elicitação'); fim(); });
    sai({ type: 'control_request', request_id: 'el-1', request: { subtype: 'elicitation', mcp_server_name: 'falso', message: 'Digite o token' } });
    return;
  }
  m = /^pede controle (\S+)$/.exec(t);
  if (m) {
    const sub = m[1];
    const id = `ctl-${sub}`;
    esperando.set(id, (r) => { texto(`resposta ao ${sub}: ${r.subtype === 'error' ? `error: ${r.error}` : r.subtype}`); fim(); });
    sai({ type: 'control_request', request_id: id, request: { subtype: sub } });
    return;
  }
  if (t === 'pede e cancela') {
    sai({ type: 'control_request', request_id: 'p-1', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'ls' } } });
    setTimeout(() => { sai({ type: 'control_cancel_request', request_id: 'p-1' }); texto('cancelado'); fim(); }, 100);
    return;
  }
  if (t === 'pede permissão e termina') {
    sai({ type: 'control_request', request_id: 'p-2', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'ls' } } });
    setTimeout(() => { texto('terminou sem a resposta'); fim(); }, 100);
    return;
  }
  m = /^manda (\d+) deltas$/.exec(t);
  if (m) {
    const n = Number(m[1]);
    const delta = (txt) => sai({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: txt } } });
    sai({ type: 'stream_event', event: { type: 'message_start' } });
    let i = 0;
    const passo = () => { // lotes de ~n/100 por 10 ms: n deltas em cerca de 1 s
      for (let k = 0; k < Math.max(1, Math.ceil(n / 100)) && i < n; k++, i++) delta(`d${i} `);
      if (i < n) return setTimeout(passo, 10);
      texto(Array.from({ length: n }, (_, j) => `d${j} `).join(''));
      fim();
    };
    return passo();
  }
  texto('ok');
  fim();
});
