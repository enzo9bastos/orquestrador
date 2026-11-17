// Conversa conduzida pelo Codex CLI em vez do Claude: o mesmo painel, os
// mesmos cartões de pergunta e permissão, outro motor por trás.
//
// O Codex roda como `codex app-server` (JSON-RPC, uma mensagem por linha no
// stdin/stdout). Este módulo traduz o que ele manda para os eventos que a tela
// já desenha para o Claude (conversa.js): texto vira mensagem do assistente,
// comando vira a linha "Rodou …" (tool_use Bash + tool_result), pergunta com
// opções vira o cartão do AskUserQuestion e pedido de aprovação vira o cartão
// "Permitir?".
//
// Proteção: o orquestrador precisa de tmux e docker, que o sandbox do Codex
// bloqueia mesmo com o comando aprovado. Por isso ele roda fora do sandbox
// (danger-full-access), com a política "untrusted" (o que só lê roda direto)
// e o revisor automático do Codex (auto_review) decidindo o resto pelo risco.
// Escolha do usuário em 2026-11-12. Quando o revisor nega, o motivo aparece na
// conversa.
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

const POLITICA = { approvalPolicy: 'untrusted', approvalsReviewer: 'auto_review', sandbox: 'danger-full-access' };
// Quando o Codex recusa essa política (uma organização pode limitar as permitidas), o app
// não abre a conversa e diz isto. Trocar de política sozinho seria afrouxar sem ninguém pedir.
const AVISO_POLITICA = 'O app só abre o Codex com a política dele (pergunta antes de tudo o que não for só leitura, com o revisor automático do Codex) e não tenta abrir com uma política mais frouxa. Se a sua organização limita as políticas do Codex, veja com quem administra.';
// A pergunta com opções (request_user_input) ainda vem desligada no modo
// normal do Codex; o app liga ao subir o servidor.
const ARGS = ['app-server', '--enable', 'default_mode_request_user_input', '-c', 'suppress_unstable_features_warning=true'];
// Esforços que o Codex aceita; o "Máximo" do app vira o maior dele.
const ESFORCO = { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'xhigh' };
// /init do Codex: o app-server não entende "/init"; a TUI manda este pedido
// (texto do próprio Codex 0.167.1, conferido no binário; Apache-2.0).
const PROMPT_INIT = `Generate a file named AGENTS.md that serves as a contributor guide for this repository.
Before writing, check whether AGENTS.md already exists in the current working directory. If it does, do not overwrite or modify it.
Your goal is to produce a clear, concise, and well-structured document with descriptive headings and actionable explanations for each section.
Follow the outline below, but adapt as needed — add sections if relevant, and omit those that do not apply to this project.

Document Requirements

- Title the document "Repository Guidelines".
- Use Markdown headings (#, ##, etc.) for structure.
- Keep the document concise. 200-400 words is optimal.
- Keep explanations short, direct, and specific to this repository.
- Provide examples where helpful (commands, directory paths, naming patterns).
- Maintain a professional, instructional tone.

Recommended Sections

Project Structure & Module Organization
- Outline the project structure, including where the source code, tests, and assets are located.

Build, Test, and Development Commands
- List key commands for building, testing, and running locally (e.g., npm test, make build).
- Briefly explain what each command does.

Coding Style & Naming Conventions
- Specify indentation rules, language-specific style preferences, and naming patterns.
- Include any formatting or linting tools used.

Testing Guidelines
- Identify testing frameworks and coverage requirements.
- State test naming conventions and how to run tests.

Commit & Pull Request Guidelines
- Summarize commit message conventions found in the project's Git history.
- Outline pull request requirements (descriptions, linked issues, screenshots, etc.).

(Optional) Add other sections if relevant, such as Security & Configuration Tips, Architecture Overview, or Agent-Specific Instructions.`;

// Erro do Codex que quer dizer "essa conversa não existe mais".
const NAO_ACHOU = /no rollout found|thread not found|invalid thread id|not found/i;

// --- tradução (funções puras, testadas em unidade) ---------------------------

// "/bin/bash -lc 'tmux ls | wc -l'" → "tmux ls | wc -l" (o que o Codex
// entendeu como comando, quando ele diz; senão o texto sem o invólucro).
function comandoLimpo(item) {
  const a = Array.isArray(item.commandActions) && item.commandActions.length === 1 ? item.commandActions[0] : null;
  if (a && typeof a.command === 'string' && a.command.trim()) return a.command;
  const m = /^\/bin\/(?:ba|z)?sh -lc '([\s\S]*)'$/.exec(String(item.command || ''));
  return m ? m[1].replace(/'\\''/g, "'") : String(item.command || '');
}

// Linha de ferramenta (tool_use) para um item que o Codex começou.
function usoDeFerramenta(item) {
  switch (item.type) {
    case 'commandExecution': return { type: 'tool_use', id: item.id, name: 'Bash', input: { command: comandoLimpo(item) } };
    case 'fileChange': {
      const arqs = (item.changes || []).map((c) => c.path);
      return { type: 'tool_use', id: item.id, name: 'Edit', input: { file_path: arqs[0] || '', arquivos: arqs } };
    }
    case 'mcpToolCall': return { type: 'tool_use', id: item.id, name: `mcp__${item.server}__${item.tool}`, input: item.arguments && typeof item.arguments === 'object' ? item.arguments : { argumentos: item.arguments } };
    case 'webSearch': return { type: 'tool_use', id: item.id, name: 'WebSearch', input: { query: item.query || '' } };
    case 'imageGeneration': return { type: 'tool_use', id: item.id, name: 'Gerou uma imagem', input: {} };
    default: return null;
  }
}

// Resultado (tool_result) de um item terminado.
function resultadoDeFerramenta(item) {
  switch (item.type) {
    case 'commandExecution': {
      const falhou = item.status !== 'completed' || (item.exitCode != null && item.exitCode !== 0);
      const negado = item.status === 'declined' ? 'Comando negado.' : '';
      return { type: 'tool_result', tool_use_id: item.id, content: item.aggregatedOutput || negado, is_error: falhou };
    }
    case 'fileChange':
      return { type: 'tool_result', tool_use_id: item.id, content: (item.changes || []).map((c) => c.diff || c.path).join('\n'), is_error: item.status !== 'completed' };
    case 'mcpToolCall': {
      const r = item.result && Array.isArray(item.result.content) ? item.result.content : null;
      return { type: 'tool_result', tool_use_id: item.id, content: item.error ? String(item.error.message || 'erro') : r || '', is_error: !!item.error };
    }
    case 'webSearch': case 'imageGeneration':
      return { type: 'tool_result', tool_use_id: item.id, content: '', is_error: item.status === 'failed' };
    default: return null;
  }
}

// Itens de um turno antigo (histórico ao retomar) → eventos da tela.
function eventosDoHistorico(turns) {
  const lista = [];
  for (const t of turns || []) {
    const ts = t.startedAt ? t.startedAt * 1000 : undefined;
    for (const it of t.items || []) {
      if (it.type === 'userMessage') {
        const texto = (it.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
        if (texto) lista.push({ tipo: 'user', antigo: true, ts, message: { role: 'user', content: texto } });
      } else if (it.type === 'agentMessage') {
        if (it.text) lista.push({ tipo: 'assistant', antigo: true, ts, message: { role: 'assistant', content: [{ type: 'text', text: it.text }] } });
      } else {
        const uso = usoDeFerramenta(it);
        const res = resultadoDeFerramenta(it);
        if (uso) lista.push({ tipo: 'assistant', antigo: true, ts, message: { role: 'assistant', content: [uso] } });
        if (res) lista.push({ tipo: 'user', antigo: true, ts, message: { role: 'user', content: [res] } });
      }
    }
  }
  return lista.slice(-600);
}

// Pedido do servidor → cartão da tela ({ ferramenta, entrada, motivo }).
// Cada pergunta leva o id (a resposta casa por ele, não pelo texto: duas
// perguntas iguais não colidem), isSecret (campo de senha; a resposta nunca
// aparece na tela, no histórico do app nem no bichinho) e isOther (texto livre).
function pedidoDaTela(method, params) {
  if (method === 'item/tool/requestUserInput') {
    return {
      ferramenta: 'AskUserQuestion',
      entrada: { questions: (params.questions || []).map((q) => ({
        id: q.id, question: q.question, header: q.header || '', multiSelect: false,
        isSecret: !!q.isSecret, isOther: !!q.isOther,
        options: (q.options || []).map((o) => ({ label: o.label, description: o.description || '' })),
      })) },
      motivo: null,
    };
  }
  if (method === 'item/commandExecution/requestApproval') {
    const cmd = Array.isArray(params.commandActions) && params.commandActions.length === 1 && params.commandActions[0].command
      ? params.commandActions[0].command : comandoLimpo({ command: params.command || '' });
    return { ferramenta: 'Bash', entrada: { command: cmd }, motivo: params.reason || null };
  }
  if (method === 'item/fileChange/requestApproval') {
    return { ferramenta: 'Edit', entrada: { file_path: params.grantRoot || '' }, motivo: params.reason || 'O Codex quer alterar arquivos.' };
  }
  return null;
}

// Decisão do usuário → resposta JSON-RPC para o servidor.
// decisao: { permitir, respostas?: { [id da pergunta]: resposta } } (o texto
// da pergunta como chave ainda vale, para quem responde pelo texto).
function respostaAoServidor(method, params, decisao) {
  if (method === 'item/tool/requestUserInput') {
    const answers = {};
    const rs = decisao.respostas || {};
    for (const q of params.questions || []) {
      const r = Object.prototype.hasOwnProperty.call(rs, q.id) ? rs[q.id] : rs[q.question];
      answers[q.id] = { answers: decisao.permitir && r != null && r !== '' ? [String(r)] : [] };
    }
    return { answers };
  }
  return { decision: decisao.permitir ? 'accept' : 'decline' };
}

// Uso de contexto: o que entrou no último pedido ao modelo.
function contextoDoUso(tokenUsage) {
  const u = tokenUsage || {};
  return { contexto: u.last ? u.last.inputTokens || 0 : null, janela: u.modelContextWindow || null };
}

// Cota da conta (janelas de uso). Janela de até 5 h → medidor "5 h"; a
// outra (semana, ou o mês do plano free) → segundo medidor, com o rótulo do
// tamanho dela.
function cotaDaConta(rateLimits) {
  const r = {};
  for (const w of [rateLimits && rateLimits.primary, rateLimits && rateLimits.secondary]) {
    if (!w || typeof w.usedPercent !== 'number') continue;
    const min = w.windowDurationMins || 0;
    if (min && min <= 300) r.uso5h = Math.round(w.usedPercent);
    else {
      r.uso7d = Math.round(w.usedPercent);
      const dias = Math.round(min / 1440);
      r.rotuloLongo = dias ? `${dias} ${dias === 1 ? 'dia' : 'dias'}` : null;
    }
  }
  return r;
}

// "/orquestrar-app resto" → entrada com a skill do Codex, quando ela existe.
function pastasDeSkills() {
  const casa = os.homedir();
  return [path.join(process.env.CODEX_HOME || path.join(casa, '.codex'), 'skills'), path.join(casa, '.agents', 'skills')];
}
function skillDoCodex(nome) {
  if (!/^[\w.-]+$/.test(nome)) return null;
  for (const p of pastasDeSkills()) {
    const arq = path.join(p, nome, 'SKILL.md');
    if (fs.existsSync(arq)) return arq;
  }
  return null;
}
function entradaDoTexto(texto, imagens = []) {
  const entrada = [];
  const m = /^\/([\w.-]+)(?:\s|$)/.exec(texto || '');
  const skill = m ? skillDoCodex(m[1]) : null;
  if (skill) entrada.push({ type: 'skill', name: m[1], path: skill });
  for (const i of imagens) entrada.push({ type: 'image', url: `data:${i.tipo};base64,${i.dados}` });
  if (texto) entrada.push({ type: 'text', text: texto, text_elements: [] });
  return entrada;
}

// Skills do Codex para o autocompletar (/nome).
function comandosDoCodex() {
  const lista = [];
  const vistos = new Set();
  for (const p of pastasDeSkills()) {
    let nomes = [];
    try { nomes = fs.readdirSync(p); } catch { continue; }
    for (const nome of nomes) {
      if (vistos.has(nome)) continue;
      let txt = '';
      try { txt = fs.readFileSync(path.join(p, nome, 'SKILL.md'), 'utf8').slice(0, 3000); } catch { continue; }
      vistos.add(nome);
      const d = txt.match(/^description:\s*(.+)$/m);
      lista.push({ nome, descricao: d ? d[1].replace(/^["']|["']$/g, '') : '', dica: '' });
    }
  }
  return lista.sort((a, b) => a.nome.localeCompare(b.nome));
}

// --- o processo -------------------------------------------------------------
// c: a Conversa (conversa.js). ctx: { gravarLista, avisar, avisarLista,
// fimDeTurno(c, { erro, texto, duracao }) }.
function iniciar(c, { comando, cwd, env, ctx }) {
  const proc = spawn(comando, ARGS, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  const rpc = { n: 0, espera: new Map(), servidor: new Map(), fila: [], pronto: false, turno: null, inicioTurno: 0 };
  proc.rpc = rpc;
  c.proc = proc;
  const retomando = !!c.sessao;

  const escrever = (o) => { try { proc.stdin.write(JSON.stringify(o) + '\n'); return true; } catch { return false; } };
  const pedir = (method, params) => new Promise((ok, falha) => {
    const id = ++rpc.n;
    rpc.espera.set(id, { ok, falha });
    escrever({ id, method, params });
  });
  rpc.pedir = pedir;
  rpc.escrever = escrever;

  let erroTexto = '';
  proc.stderr.on('data', (d) => { erroTexto = (erroTexto + d).slice(-4000); });
  proc.on('error', (e) => c.registrar({ tipo: 'erro', texto: `Não consegui abrir o Codex: ${e.message}` }));
  proc.on('exit', (codigo) => {
    if (c.proc === proc) c.proc = null;
    for (const { falha } of rpc.espera.values()) falha(new Error('o Codex saiu'));
    rpc.espera.clear();
    if (proc.reiniciando || proc.encerrando) return;
    // Cair antes de retomar não quer dizer que a conversa sumiu (isso vem como
    // erro do thread/resume): só zera quando o próprio Codex diz que não achou.
    if (codigo && retomando && !rpc.pronto && NAO_ACHOU.test(erroTexto)) { c.sessao = null; ctx.gravarLista(); }
    c.info.ocupado = false;
    c.pendentes.clear();
    c.avisarInfo();
    c.registrar({ tipo: 'fim', texto: codigo ? `O Codex parou (código ${codigo}). ${erroTexto.trim().split('\n').slice(-3).join(' ')}` : 'A conversa foi pausada.' });
  });

  readline.createInterface({ input: proc.stdout }).on('line', (l) => {
    let d;
    try { d = JSON.parse(l); } catch { return; }
    if (d.id != null && !d.method) { // resposta a um pedido nosso
      const w = rpc.espera.get(d.id);
      if (!w) return;
      rpc.espera.delete(d.id);
      if (d.error) w.falha(new Error(d.error.message || 'erro do Codex')); else w.ok(d.result);
      return;
    }
    if (d.method && d.id != null) return pedidoDoServidor(c, rpc, d, ctx);
    if (d.method) notificacao(c, rpc, d.method, d.params || {}, ctx);
  });

  (async () => {
    try {
      // experimentalApi: sem declarar, o Codex recusa os terminais em segundo
      // plano (/ps e /stop). Declarar só acrescenta: métodos novos e campos
      // opcionais a mais nas respostas (conferido no esquema do 0.167.1), e um
      // pedido que ele passa a poder fazer ao app (currentTime/read, atendido
      // em pedidoDoServidor).
      await pedir('initialize', { clientInfo: { name: 'orq-app', title: 'App de Orquestração', version: '1' }, capabilities: { experimentalApi: true } });
      escrever({ method: 'initialized' });
      const base = { cwd, ...POLITICA };
      let r;
      if (retomando) {
        try { r = await pedir('thread/resume', { threadId: c.sessao, ...base }); } catch (e) {
          // Só a conversa que o Codex não acha mais começa outra; se ele caiu
          // ou deu outro erro, a guardada fica como está.
          if (!NAO_ACHOU.test(e.message)) throw e;
          c.anteriores = [...(c.anteriores || []), c.sessao].slice(-20);
          c.sessao = null;
        }
      }
      if (!r) r = await pedir('thread/start', base);
      const t = r.thread || {};
      if (c.sessao !== t.id) { c.sessao = t.id; ctx.gravarLista(); }
      if (retomando && Array.isArray(t.turns) && t.turns.length) {
        c.eventos = eventosDoHistorico(t.turns);
        c.enviar('conversa:tudo', c.estado());
      }
      c.info.modelo = r.model || c.info.modelo;
      c.info.pasta = r.cwd || cwd;
      if (r.reasoningEffort && !c.esforco) c.info.esforco = r.reasoningEffort;
      c.avisarInfo();
      rpc.pronto = true;
      for (const f of rpc.fila.splice(0)) f();
    } catch (e) {
      if (c.proc !== proc) return;
      // Falhar fechado: a conversa não abriu (o Codex recusou a política do app, a pasta,
      // a retomada…). Nada fica meio aberto, nada vai ao modelo, e o app NUNCA tenta de
      // novo com uma política mais frouxa (ex.: "never", que rodaria tudo sem perguntar).
      const naFila = rpc.fila.splice(0);
      const devolver = naFila.map((f) => f.texto).filter((x) => typeof x === 'string' && x.trim()).join('\n\n');
      proc.encerrando = true; // o aviso é este; a saída do processo não põe outro por cima
      c.info.ocupado = false;
      c.pendentes.clear();
      // O que esperava na fila da caixa não dispara sozinho (falharia igual): fica à vista, parado.
      c.filaParada = (c.fila || []).length > 0;
      if (typeof c.avisarFila === 'function') c.avisarFila(); else c.avisarInfo();
      const motivo = String(e.message || e).replace(/\.+$/, '');
      const daPolitica = /approval|sandbox|reviewer|allowed set|requirements/i.test(motivo);
      c.registrar({ tipo: 'erro', texto: `O Codex não abriu a conversa: ${motivo}. ${daPolitica ? `${AVISO_POLITICA} ` : ''}${devolver ? 'Nada foi enviado; o seu texto voltou para a caixa.' : 'Nada foi enviado.'}`, ...(devolver ? { devolver } : {}) });
      try { proc.kill(); } catch { /* já saiu */ }
    }
  })();
  return proc;
}

function notificacao(c, rpc, method, p, ctx) {
  switch (method) {
    case 'turn/started':
      rpc.turno = (p.turn || {}).id || rpc.turno;
      rpc.inicioTurno = Date.now();
      return;
    case 'item/agentMessage/delta':
      if (p.delta) c.enviar('conversa:parcial', p.delta);
      return;
    case 'item/started': {
      const it = p.item || {};
      if (it.type === 'agentMessage') { c.enviar('conversa:parcial', null); return; }
      const uso = usoDeFerramenta(it);
      if (uso) c.registrar({ tipo: 'assistant', message: { role: 'assistant', content: [uso] } });
      return;
    }
    case 'item/completed': {
      const it = p.item || {};
      if (it.type === 'agentMessage') {
        if (!it.text) return;
        c.ultimoTexto = it.text;
        c.registrar({ tipo: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: it.text }] } });
        return;
      }
      const res = resultadoDeFerramenta(it);
      if (res) c.registrar({ tipo: 'user', message: { role: 'user', content: [res] } });
      return;
    }
    case 'item/autoApprovalReview/completed': {
      const rv = p.review || {};
      if (rv.status === 'denied' || rv.status === 'timedOut') {
        c.registrar({ tipo: 'erro', texto: `O revisor do Codex ${rv.status === 'denied' ? 'negou' : 'não respondeu a tempo sobre'} um comando${rv.riskLevel ? ` (risco ${rv.riskLevel})` : ''}${rv.rationale ? `: ${rv.rationale}` : '.'}` });
      }
      return;
    }
    case 'thread/tokenUsage/updated':
      Object.assign(c.info, contextoDoUso(p.tokenUsage));
      c.avisarInfo();
      return;
    case 'account/rateLimits/updated':
      Object.assign(c.info, cotaDaConta(p.rateLimits));
      c.avisarInfo();
      return;
    case 'error':
      if (!p.willRetry) c.registrar({ tipo: 'erro', texto: `Erro do Codex: ${(p.error || {}).message || 'sem detalhe'}` });
      return;
    case 'serverRequest/resolved':
      // O servidor desistiu de um pedido (ex.: turno interrompido): o cartão sai.
      for (const [id, q] of c.pendentes) if (q.rpcId === p.requestId) { c.pendentes.delete(id); c.enviar('conversa:respondido', id); ctx.avisarLista(); }
      return;
    case 'turn/completed': {
      const t = p.turn || {};
      rpc.turno = null;
      ctx.fimDeTurno(c, {
        erro: t.status === 'failed',
        texto: t.status === 'failed' ? ((t.error || {}).message || 'O turno falhou.') : null,
        duracao: t.durationMs || (rpc.inicioTurno ? Date.now() - rpc.inicioTurno : null),
      });
      return;
    }
    default:
  }
}

function pedidoDoServidor(c, rpc, d, ctx) {
  // A hora de agora, em segundos inteiros: o Codex pode perguntar a quem
  // declarou experimentalApi no initialize. Não passa pela tela.
  if (d.method === 'currentTime/read') { rpc.escrever({ id: d.id, result: { currentTimeAt: Math.floor(Date.now() / 1000) } }); return; }
  const tela = pedidoDaTela(d.method, d.params || {});
  if (!tela) {
    // Pedido que o app não sabe mostrar: recusa, e o Codex segue sem ele.
    rpc.escrever({ id: d.id, error: { code: -32601, message: `o App de Orquestração não atende ${d.method}` } });
    return;
  }
  const id = `cx-${d.id}`;
  const p = { id, ...tela, rpcId: d.id, metodo: d.method, params: d.params };
  c.pendentes.set(id, p);
  c.enviar('conversa:pedido', { id, ferramenta: p.ferramenta, entrada: p.entrada, motivo: p.motivo });
  ctx.avisarLista();
  const q = (p.entrada.questions && p.entrada.questions[0]) || null;
  ctx.avisar({ tipo: 'pedido', id: c.id, titulo: c.titulo, orquestrador: c.orquestrador,
    texto: q ? `${q.header ? q.header + ': ' : ''}${q.question}` : `Quer usar ${p.ferramenta}${p.entrada.command ? `: ${p.entrada.command}` : ''}` });
}

// --- ações da conversa ------------------------------------------------------
// Com um turno em andamento, a mensagem corrige o rumo dele (turn/steer, com
// o id do turno esperado); recusado (o turno acabou no meio do caminho), vira
// um turno novo. Se nada aceitar, o texto volta para a caixa (devolver) e o
// "trabalhando" só sai se não houver turno ativo.
function mandar(c, texto, imagens) {
  const rpc = c.proc && c.proc.rpc;
  if (!rpc) return false;
  const digitado = texto; // o que a pessoa escreveu: volta para a caixa se a conversa não abrir
  // /init (sem uma skill "init" do usuário): o pedido que a TUI do Codex manda.
  if (/^\/init\s*$/.test(texto || '') && !skillDoCodex('init')) texto = PROMPT_INIT;
  const envia = () => {
    const input = entradaDoTexto(texto, imagens);
    const comecar = () => {
      const params = { threadId: c.sessao, input };
      if (c.esforco) params.effort = ESFORCO[c.esforco] || null;
      return rpc.pedir('turn/start', params).then((r) => { if (r && r.turn) rpc.turno = r.turn.id; });
    };
    const falhou = (e) => {
      if (!rpc.turno) { c.info.ocupado = false; c.avisarInfo(); }
      c.registrar({ tipo: 'erro', texto: `O Codex não aceitou a mensagem: ${e.message}`, devolver: texto });
    };
    if (rpc.turno) {
      rpc.pedir('turn/steer', { threadId: c.sessao, input, expectedTurnId: rpc.turno })
        .catch(() => comecar()).catch(falhou);
    } else comecar().catch(falhou);
  };
  envia.texto = digitado;
  if (rpc.pronto) envia(); else rpc.fila.push(envia);
  return true;
}

function responder(c, p, decisao) {
  const rpc = c.proc && c.proc.rpc;
  if (!rpc) return false;
  return rpc.escrever({ id: p.rpcId, result: respostaAoServidor(p.metodo, p.params || {}, decisao) });
}

function interromper(c) {
  const rpc = c.proc && c.proc.rpc;
  if (!rpc || !rpc.turno || !c.sessao) return false;
  rpc.pedir('turn/interrupt', { threadId: c.sessao, turnId: rpc.turno }).catch(() => {});
  return true;
}

module.exports = {
  iniciar, mandar, responder, interromper, comandosDoCodex, POLITICA, ARGS, ESFORCO, PROMPT_INIT,
  _t: { comandoLimpo, usoDeFerramenta, resultadoDeFerramenta, eventosDoHistorico, pedidoDaTela, respostaAoServidor, contextoDoUso, cotaDaConta, entradaDoTexto, skillDoCodex },
};
