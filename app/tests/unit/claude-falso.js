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
//   qualquer outra coisa       responde "ok" e termina o turno
// Pedidos de controle do app: set_model (o próximo init traz o modelo novo),
// set_permission_mode e interrupt recebem control_response de sucesso.
// apply_flag_settings (esforço só da sessão) também; com $CLAUDE_FALSO_RECUSA_ESFORCO
// ele é recusado com esse texto de erro.
// $CLAUDE_FALSO_RECUSA_MODELO: o set_model é recusado com esse texto de erro.
// $CLAUDE_FALSO_FALHA_RESUME: com --resume, escreve esse texto no stderr e sai
// com código 1 antes do init (sessão que o Claude não abriu).
const fs = require('fs');
const readline = require('readline');

if (process.argv[2] === '--version') { console.log('9.9.9 (Claude Code)'); process.exit(0); }
const log = (o) => { if (process.env.CLAUDE_FALSO_LOG) fs.appendFileSync(process.env.CLAUDE_FALSO_LOG, JSON.stringify(o) + '\n'); };
const sai = (o) => process.stdout.write(JSON.stringify(o) + '\n');
log({ args: process.argv.slice(2) });

const args = process.argv.slice(2);
const arg = (nome) => { const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : null; };
if (process.env.CLAUDE_FALSO_FALHA_RESUME && arg('--resume')) {
  process.stderr.write(process.env.CLAUDE_FALSO_FALHA_RESUME + '\n');
  process.exit(1);
}
let SESSAO = 'S-falso';
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
const init = () => sai({ type: 'system', subtype: 'init', session_id: SESSAO, model: modelo, permissionMode: modo, cwd: process.cwd(), slash_commands: COMANDOS });
const saidaLocal = (t) => { sai({ type: 'user', message: { role: 'user', content: `<local-command-stdout>${t}</local-command-stdout>` }, session_id: SESSAO }); fim(t); };
const responde = (d, response = {}) => sai({ type: 'control_response', response: { subtype: 'success', request_id: d.request_id, response } });

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
    return sai({ type: 'control_response', response: { subtype: 'error', request_id: d.request_id, error: `pedido desconhecido: ${r.subtype}` } });
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
  texto('ok');
  fim();
});
