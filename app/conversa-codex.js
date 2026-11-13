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
// A pergunta com opções (request_user_input) ainda vem desligada no modo
// normal do Codex; o app liga ao subir o servidor.
const ARGS = ['app-server', '--enable', 'default_mode_request_user_input', '-c', 'suppress_unstable_features_warning=true'];
// Esforços que o Codex aceita; o "Máximo" do app vira o maior dele.
const ESFORCO = { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'xhigh' };

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
function pedidoDaTela(method, params) {
  if (method === 'item/tool/requestUserInput') {
    return {
      ferramenta: 'AskUserQuestion',
      entrada: { questions: (params.questions || []).map((q) => ({
        question: q.question, header: q.header || '', multiSelect: false,
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
// decisao: { permitir, respostas?: { [texto da pergunta]: resposta } }
function respostaAoServidor(method, params, decisao) {
  if (method === 'item/tool/requestUserInput') {
    const answers = {};
    for (const q of params.questions || []) {
      const r = decisao.respostas && decisao.respostas[q.question];
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
    if (codigo && retomando && !rpc.pronto) { c.sessao = null; ctx.gravarLista(); }
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
      await pedir('initialize', { clientInfo: { name: 'orq-app', title: 'App de Orquestração', version: '1' } });
      escrever({ method: 'initialized' });
      const base = { cwd, ...POLITICA };
      let r;
      if (retomando) {
        try { r = await pedir('thread/resume', { threadId: c.sessao, ...base }); } catch {
          // Conversa guardada que o Codex não acha mais: começa uma nova.
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
      if (c.proc === proc) c.registrar({ tipo: 'erro', texto: `O Codex não iniciou a conversa: ${e.message}` });
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
function mandar(c, texto, imagens) {
  const rpc = c.proc && c.proc.rpc;
  if (!rpc) return false;
  const envia = () => {
    const params = { threadId: c.sessao, input: entradaDoTexto(texto, imagens) };
    if (c.esforco) params.effort = ESFORCO[c.esforco] || null;
    rpc.pedir('turn/start', params).then((r) => { if (r && r.turn) rpc.turno = r.turn.id; })
      .catch((e) => { c.info.ocupado = false; c.avisarInfo(); c.registrar({ tipo: 'erro', texto: `O Codex não aceitou a mensagem: ${e.message}` }); });
  };
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
  iniciar, mandar, responder, interromper, comandosDoCodex, POLITICA, ARGS, ESFORCO,
  _t: { comandoLimpo, usoDeFerramenta, resultadoDeFerramenta, eventosDoHistorico, pedidoDaTela, respostaAoServidor, contextoDoUso, cotaDaConta, entradaDoTexto, skillDoCodex },
};
