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
//   qualquer outra coisa       responde "ok" e termina o turno
const fs = require('fs');
const readline = require('readline');

if (process.argv[2] === '--version') { console.log('9.9.9 (Claude Code)'); process.exit(0); }
const log = (o) => { if (process.env.CLAUDE_FALSO_LOG) fs.appendFileSync(process.env.CLAUDE_FALSO_LOG, JSON.stringify(o) + '\n'); };
const sai = (o) => process.stdout.write(JSON.stringify(o) + '\n');
log({ args: process.argv.slice(2) });

const SESSAO = 'S-falso';
const esperando = new Map(); // request_id → o que fazer quando a resposta chegar
const texto = (t) => sai({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: t }] } });
const fim = () => sai({ type: 'result', subtype: 'success', is_error: false, duration_ms: 5, result: 'ok', session_id: SESSAO });

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
  if (d.type !== 'user') return;
  const t = typeof d.message.content === 'string' ? d.message.content : (d.message.content.find((b) => b.type === 'text') || {}).text || '';
  sai({ type: 'system', subtype: 'init', session_id: SESSAO, model: 'claude-falso-1-0', cwd: process.cwd(), slash_commands: ['compact'] });
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
