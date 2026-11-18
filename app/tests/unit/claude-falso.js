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
//   "/so-no-terminal", "/memory"  comando que só existe na tela do terminal: responde como o
//                              Claude de verdade (2.1.326), com uma mensagem "assistant"
//                              sintética "/x isn't available in this environment." e o
//                              campo local_command_outcome { kind: 'unavailable_headless' }
//   "trabalha até parar"       começa a responder ("começando…") e fica no turno até
//                              receber o interrupt; aí termina o turno
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
// O app liga os pontos de volta dos arquivos por uma variável (plano 7.1). Cada subida anota, num
// arquivo à parte ($CLAUDE_FALSO_LOG.ambiente; o registro principal não muda), se ela veio.
if (process.env.CLAUDE_FALSO_LOG) fs.appendFileSync(`${process.env.CLAUDE_FALSO_LOG}.ambiente`, JSON.stringify({ pontosDeVolta: process.env.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING || null }) + '\n');

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
let trabalhando = false; // turno aberto pelo "trabalha até parar", esperando o interrupt
const filhos = [];
process.on('SIGTERM', () => { for (const f of filhos) { try { f.kill(); } catch { /* já saiu */ } } process.exit(143); });
// Lista do init: ['compact'], ou a de $CLAUDE_FALSO_COMANDOS (JSON).
const COMANDOS = (() => { try { return JSON.parse(process.env.CLAUDE_FALSO_COMANDOS || 'null') || ['compact']; } catch { return ['compact']; } })();
const esperando = new Map(); // request_id → o que fazer quando a resposta chegar
const texto = (t) => sai({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: t }] } });
const fim = (result = 'ok') => sai({ type: 'result', subtype: 'success', is_error: false, duration_ms: 5, result, session_id: SESSAO });
// Como o Claude de verdade: opusplan é um apelido. O que ele informa (no init e na resposta ao
// set_model) é o modelo em uso no momento: Opus no modo plano, Sonnet fora dele.
const emUso = (m) => (m === 'opusplan' ? (modo === 'plan' ? 'claude-opus-5-5' : 'claude-sonnet-5-5') : m);
const init = () => sai({ type: 'system', subtype: 'init', session_id: SESSAO, model: emUso(modelo), permissionMode: modo, cwd: process.cwd(), slash_commands: COMANDOS, claude_code_version: VERSAO, tools: ['Bash', 'Read'], mcp_servers: [{ name: 'falso-mcp', status: 'connected' }] });
const HOME = require('os').homedir();
// Respostas dos pedidos de controle dos comandos do "/".
// get_settings (formato do 2.1.326): effective = o que está nos arquivos de
// settings (aqui, o ~/.claude/settings.json da casa do teste); applied = o que vale agora.
const settingsDaCasa = () => { try { return JSON.parse(fs.readFileSync(require('path').join(HOME, '.claude', 'settings.json'), 'utf8')); } catch { return {}; } };
const CONTROLES = {
  get_settings: () => ({ effective: settingsDaCasa(), sources: [], applied: { model: modelo, effort: 'high' } }),
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

// Como o Claude de verdade: mensagem que chega com um turno aberto ("trabalha
// até parar") fica na fila dele e roda quando o turno acaba (o interrupt
// encerra o turno e responde { still_queued }, como no 2.1.326).
const naFilaDoFalso = [];
const ladoEsperando = new Set(); // perguntas de lado que só terminam se o app desistir
const leitor = readline.createInterface({ input: process.stdin });
const soltarFila = () => { for (const m of naFilaDoFalso.splice(0)) leitor.emit('line', JSON.stringify({ ...m, jaAnotada: true })); };
leitor.on('line', (l) => {
  let d;
  try { d = JSON.parse(l); } catch { return; }
  if (d.jaAnotada) delete d.jaAnotada; else log(d);
  if (d.type === 'user' && trabalhando) { naFilaDoFalso.push(d); return; }
  if (d.type === 'control_response') {
    const id = d.response && d.response.request_id;
    const f = esperando.get(id);
    if (f) { esperando.delete(id); f(d.response); }
    return;
  }
  // O app desistiu de um pedido: a pergunta de lado que estava esperando termina com erro.
  if (d.type === 'control_cancel_request') {
    if (ladoEsperando.delete(d.request_id)) sai({ type: 'control_response', response: { subtype: 'error', request_id: d.request_id, error: 'Side question cancelled' } });
    return;
  }
  if (d.type === 'control_request') {
    const r = d.request || {};
    if (SEM.has(r.subtype)) return naoAtende(d, r.subtype);
    if (r.subtype === 'rename_session' && !process.env.CLAUDE_FALSO_SEM_CONTROLES) {
      // Como o Claude de verdade (2.1.326): { title, source?, session_id? }; o nome novo sai como session_title_changed.
      if (typeof r.title !== 'string' || !r.title.trim()) return sai({ type: 'control_response', response: { subtype: 'error', request_id: d.request_id, error: 'rename_session: title must be a non-empty string' } });
      if (r.session_id && r.session_id !== SESSAO) return sai({ type: 'control_response', response: { subtype: 'error', request_id: d.request_id, error: 'rename_session: this process has moved to another session' } });
      responde(d, {});
      return sai({ type: 'system', subtype: 'session_title_changed', title: r.title, uuid: 'u-t', session_id: SESSAO });
    }
    if (r.subtype === 'side_question' && !process.env.CLAUDE_FALSO_SEM_CONTROLES) {
      // Como o Claude de verdade (2.1.326): pergunta em texto, histórico em lista de
      // { question, response }; avisa o andamento, responde { response, synthetic } e
      // desiste no control_cancel_request. Não mexe no turno em andamento. A pergunta
      // escolhe o que acontece:
      //   "sintética"     o aviso de erro que volta como "sucesso" (synthetic: true);
      //   "nula"          sem resposta nenhuma;
      //   "tenta de novo" a API falhou, ele avisa e tenta outra vez;
      //   "demora"        só termina se o app desistir;
      //   "reserva"       outro modelo respondeu no lugar (refusal_fallback);
      //   "marcação"      resposta em Markdown, com código.
      const histOk = r.history === undefined || (Array.isArray(r.history) && r.history.every((h) => h && typeof h.question === 'string' && typeof h.response === 'string'));
      if (typeof r.question !== 'string' || !histOk) {
        return sai({ type: 'control_response', response: { subtype: 'error', request_id: d.request_id, error: 'side_question: question must be a string and history an array of {question, response} strings' } });
      }
      const andamento = (o) => sai({ type: 'system', subtype: 'control_request_progress', request_id: d.request_id, ...o, session_id: SESSAO });
      andamento({ status: 'started' });
      const q = r.question;
      const n = (r.history || []).length;
      const normal = `resposta de lado para: ${q}${n ? ` (com ${n} anterior${n > 1 ? 'es' : ''})` : ''}`;
      // $CLAUDE_FALSO_LADO (JSON): a resposta para uma pergunta exata. Texto = a resposta;
      // objeto = a resposta inteira ({ response, synthetic… }); null = fica esperando.
      let porPergunta = {};
      try { porPergunta = JSON.parse(process.env.CLAUDE_FALSO_LADO || '{}') || {}; } catch { /* variável torta: vale o de sempre */ }
      if (Object.prototype.hasOwnProperty.call(porPergunta, q)) {
        const v = porPergunta[q];
        if (v === null) { ladoEsperando.add(d.request_id); return undefined; }
        return responde(d, typeof v === 'string' ? { response: v, synthetic: false } : v);
      }
      if (/demora/.test(q)) { ladoEsperando.add(d.request_id); return undefined; }
      if (/sintética/.test(q)) return responde(d, { response: '(API error: Not logged in · Please run /login)', synthetic: true });
      if (/nula/.test(q)) return responde(d, { response: null, synthetic: false });
      if (/tenta de novo/.test(q)) {
        andamento({ status: 'api_retry', attempt: 2, max_retries: 10, retry_delay_ms: 50, error_status: 529 });
        return setTimeout(() => responde(d, { response: normal, synthetic: false }), Number(process.env.CLAUDE_FALSO_LADO_MS) || 400);
      }
      if (/reserva/.test(q)) return responde(d, { response: normal, synthetic: false, refusal_fallback: { original_model: 'claude-falso-1-0', fallback_model: 'claude-falso-0-5', content: 'Answered by claude-falso-0-5.' } });
      if (/marcação/.test(q)) return responde(d, { response: 'O arquivo é `config.json`.\n\n- fica na **raiz**\n- tem 3 chaves\n\n```sh\ncat config.json\n```', synthetic: false });
      return responde(d, { response: normal, synthetic: false });
    }
    if (r.subtype === 'set_model') {
      if (process.env.CLAUDE_FALSO_RECUSA_MODELO) return sai({ type: 'control_response', response: { subtype: 'error', request_id: d.request_id, error: process.env.CLAUDE_FALSO_RECUSA_MODELO } });
      modelo = r.model || 'claude-falso-1-0'; return responde(d, { model: emUso(modelo) });
    }
    if (r.subtype === 'set_permission_mode') {
      // Como o Claude de verdade (2.1.326): o Bypass só entra se o processo subiu com a opção que o libera.
      if (r.mode === 'bypassPermissions' && !args.includes('--allow-dangerously-skip-permissions') && !args.includes('--dangerously-skip-permissions')) {
        return sai({ type: 'control_response', response: { subtype: 'error', request_id: d.request_id, error: 'Cannot set permission mode to bypassPermissions because the session was not launched with --dangerously-skip-permissions' } });
      }
      const novo = r.mode === 'manual' ? 'default' : r.mode;
      const mudou = novo !== modo;
      modo = novo; responde(d, { mode: modo });
      return mudou ? sai({ type: 'system', subtype: 'status', status: null, permissionMode: modo, session_id: SESSAO }) : undefined;
    }
    if (r.subtype === 'apply_flag_settings') {
      if (process.env.CLAUDE_FALSO_RECUSA_ESFORCO) return sai({ type: 'control_response', response: { subtype: 'error', request_id: d.request_id, error: process.env.CLAUDE_FALSO_RECUSA_ESFORCO } });
      return responde(d);
    }
    if (r.subtype === 'interrupt') {
      responde(d, { still_queued: [] });
      if (trabalhando) { trabalhando = false; fim('interrompido'); soltarFila(); }
      return undefined;
    }
    if (r.subtype === 'rewind_files') {
      if (typeof r.user_message_id !== 'string') return sai({ type: 'control_response', response: { subtype: 'error', request_id: d.request_id, error: 'rewind_files: user_message_id must be a string' } });
      // $CLAUDE_FALSO_VOLTA (JSON): a resposta ao ensaio e à volta de verdade. Com "escreve", na
      // volta de verdade (sem dry_run) o falso regrava cada arquivo da lista com esse texto, como
      // o Claude restaurando. "mudo": não responde (o Claude travado). Sem a variável, o de sempre.
      // Começando com "/", é o caminho de um arquivo com o JSON (o teste troca a resposta com o app aberto).
      const cru = !process.env.CLAUDE_FALSO_VOLTA ? '' : !process.env.CLAUDE_FALSO_VOLTA.startsWith('/') ? process.env.CLAUDE_FALSO_VOLTA
        : (() => { try { return fs.readFileSync(process.env.CLAUDE_FALSO_VOLTA, 'utf8'); } catch { return ''; } })();
      if (cru) {
        const { escreve, mudo, ...resposta } = JSON.parse(cru);
        if (mudo) return undefined;
        if (!r.dry_run && resposta.canRewind && typeof escreve === 'string') {
          for (const f of resposta.filesChanged || []) { try { fs.writeFileSync(require('path').resolve(process.cwd(), f), escreve); } catch { /* arquivo de teste que não existe */ } }
        }
        return responde(d, resposta);
      }
      return responde(d, { canRewind: true, filesChanged: ['app/x.js'], insertions: 3, deletions: 1 });
    }
    if (r.subtype === 'file_suggestions' && !process.env.CLAUDE_FALSO_SEM_CONTROLES) {
      // Como o real (2.1.326): busca vazia = o que está na raiz; senão o que casa com o
      // caminho; { suggestions: [{ path }], cwd }. Pasta termina com a barra.
      // "lixo" e "muitos" devolvem respostas tortas, para o app provar que confere.
      // $CLAUDE_FALSO_ARQUIVOS_LENTO="e:700": a busca "e" demora 700 ms (resposta velha).
      const ARQ = ['src/', 'src/botao.css', 'src/botao.test.js', 'src/pedidos/exportar.js', 'LEIAME.md', 'docs/', ...Array.from({ length: 8 }, (_, i) => `docs/guia-${i + 1}.md`)];
      const q = String(r.query || '').toLowerCase();
      const lista = q === 'lixo' ? [{ path: 5 }, { path: 'a\nb' }, { path: '' }, null, 'solto', { path: 'bom.txt' }]
        : q === 'muitos' ? Array.from({ length: 80 }, (_, i) => ({ path: `muitos/arquivo-${i + 1}.txt` }))
          : (!q ? ARQ.filter((p) => !p.replace(/\/$/, '').includes('/')) : ARQ.filter((p) => p.toLowerCase().includes(q))).map((p) => ({ path: p, score: 1 }));
      const resposta = { suggestions: lista, cwd: process.cwd() };
      const lento = /^(.+):(\d+)$/.exec(process.env.CLAUDE_FALSO_ARQUIVOS_LENTO || '');
      if (lento && lento[1] === q) return setTimeout(() => responde(d, resposta), Number(lento[2]));
      return responde(d, resposta);
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
  const soTerminal = /^\/(so-no-terminal|memory)(\s|$)/.exec(t);
  if (soTerminal) {
    // Só o nome, mesmo com argumentos. $CLAUDE_FALSO_FRASE_INDISPONIVEL simula um CLI que mudou a frase.
    const texto = `/${soTerminal[1]} ${process.env.CLAUDE_FALSO_FRASE_INDISPONIVEL || "isn't available in this environment."}`;
    sai({ type: 'assistant', message: { role: 'assistant', model: '<synthetic>', content: [{ type: 'text', text: texto }] }, parent_tool_use_id: null,
      local_command_source: `<local-command-stdout>${texto}</local-command-stdout>`, local_command_outcome: { kind: 'unavailable_headless' }, session_id: SESSAO });
    return sai({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1, num_turns: 0, result: texto, session_id: SESSAO });
  }
  if (t === 'trabalha até parar') {
    trabalhando = true;
    return sai({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'começando…' }] }, session_id: SESSAO });
  }
  // "depois começa um turno sozinho": responde e, 300 ms depois, começa um turno por conta
  // própria, como um lembrete agendado ou uma tarefa em segundo plano que terminou (o app não
  // mandou nada). O turno dura $CLAUDE_FALSO_TURNO_SOZINHO_MS (1200); mensagem que chega no
  // meio fica na fila do falso e roda depois dele, como no Claude de verdade.
  if (t === 'depois começa um turno sozinho') {
    texto('combinado');
    fim();
    setTimeout(() => {
      trabalhando = true;
      sai({ type: 'stream_event', event: { type: 'message_start' } });
      sai({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'ts1', name: 'Bash', input: { command: 'orq passada', description: 'Passada: agentes e recados' } }] }, session_id: SESSAO });
      setTimeout(() => {
        if (!trabalhando) return; // interrompido no meio
        sai({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'ts1', content: 'nada novo' }] }, session_id: SESSAO });
        texto('Nada novo desde a última passada.');
        trabalhando = false;
        fim();
        log({ turnoSozinho: 'fim' });
        soltarFila();
      }, Number(process.env.CLAUDE_FALSO_TURNO_SOZINHO_MS || 1200));
    }, 300);
    return undefined;
  }
  if (t === 'começa tarefa de fundo') {
    const f = require('child_process').spawn('sleep', ['300'], { stdio: 'ignore' });
    filhos.push(f);
    log({ tarefa: f.pid });
    sai({ type: 'system', subtype: 'task_started', task_id: 't-fundo', description: 'sleep 300', session_id: SESSAO });
    texto('tarefa de fundo começou');
    return fim();
  }
  // Pedido de um tipo que o app não atende (existe no Claude 2.1.326; o app não tem tela para ele).
  if (t === 'pede algo que o app não atende') {
    esperando.set('nd-1', (r) => { texto(r.subtype === 'error' ? 'seguiu sem o pedido' : 'recebeu o pedido'); fim(); });
    sai({ type: 'control_request', request_id: 'nd-1', request: { subtype: 'request_user_dialog', dialog_kind: 'falso' } });
    return;
  }
  // Pedido de dado de um servidor MCP (forma do 2.1.326): formulário, página ou formulário torto.
  m = /^pede dado do MCP( por página| torto)?$/.exec(t);
  if (m) {
    const id = `el-${Date.now().toString(36)}`;
    const pedido = { subtype: 'elicitation', mcp_server_name: 'cofre-da-equipe', message: 'Informe o código para liberar a consulta.' };
    if (m[1] === ' por página') Object.assign(pedido, { mode: 'url', url: 'https://contas.exemplo.com/autorizar?cliente=agenda' });
    else if (m[1] === ' torto') Object.assign(pedido, { mode: 'form', requested_schema: { type: 'object', required: ['lista'], properties: { lista: { type: 'array' } } } });
    else Object.assign(pedido, { mode: 'form', property_order: ['codigo', 'ambiente'], requested_schema: { type: 'object', required: ['codigo'], properties: {
      ambiente: { type: 'string', title: 'Ambiente', enum: ['homologacao', 'producao'], enumNames: ['Homologação', 'Produção'] },
      codigo: { type: 'string', title: 'Código de verificação', minLength: 6, maxLength: 6 } } } });
    // Só a ação volta em texto: o conteúdo (pode ter segredo) fica só no log do falso.
    esperando.set(id, (r) => { texto(`resposta ao pedido de dado: ${r.subtype === 'error' ? 'erro' : r.response.action}`); fim(); });
    sai({ type: 'control_request', request_id: id, request: pedido });
    return;
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
  // Pedido de permissão com a regra que o Claude gravaria (forma do 2.1.326) e o motivo
  // com códigos de cor. A resposta do app volta como texto, para o teste conferir.
  m = /^pede permissão (com sugestão|docker|sem sugestão)$/.exec(t);
  if (m) {
    const docker = m[1] === 'docker';
    const id = `perm-${Date.now().toString(36)}`;
    const pedido = { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: docker ? 'docker compose restart web' : 'npm test -- --so-unidade' },
      decision_reason: '\u001b[33mEste comando não está entre os que o modo roda sozinho.\u001b[0m' };
    if (m[1] !== 'sem sugestão') pedido.permission_suggestions = [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: docker ? 'docker compose:*' : 'npm test:*' }], behavior: 'allow', destination: 'localSettings' }];
    esperando.set(id, (r) => { texto(`resposta à permissão: ${JSON.stringify(r.response)}`); fim(); });
    sai({ type: 'control_request', request_id: id, request: pedido });
    return;
  }
  // Plano pronto: pede para sair do modo Planejar, com o plano em Markdown (forma do 2.1.326).
  if (t === 'pede para sair do plano') {
    const id = `perm-${Date.now().toString(36)}`;
    esperando.set(id, (r) => { texto(`resposta à permissão: ${JSON.stringify(r.response)}`); fim(); });
    sai({ type: 'control_request', request_id: id, request: { subtype: 'can_use_tool', tool_name: 'ExitPlanMode',
      input: { plan: '# Plano: exportar em CSV\n\n## O que muda\n1. Botão **Exportar** na lista.\n2. Função `exportarCsv()`.\n\n## Como conferir\n- `npm test`' } } });
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
