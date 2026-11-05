// Conversas com o Claude sem tela de terminal: o orquestrador e as conversas
// avulsas abertas ao lado dele.
//
// Cada conversa é um Claude rodando por trás em modo stream-json (o mesmo
// protocolo do Agent SDK): cada linha de stdout é um evento (texto, ferramenta,
// resultado, limite de uso) e as perguntas e permissões chegam como
// control_request, respondidas pelo app. O id da sessão de cada conversa fica
// guardado: fechar o app pausa todas e abrir de novo continua do mesmo ponto
// (--resume), com o histórico lido do transcript.
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const config = require('./config');
const ias = require('./ias');

const PASTA = os.homedir(); // as conversas trabalham a partir de ~
const TESTE = process.env.ORQ_APP_TESTE === '1';
const CACHE = path.join(os.homedir(), '.cache', 'orq-app');
// O modo de teste guarda as próprias conversas: abrir o app de verdade depois
// não pode retomar uma conversa de teste.
const ARQ_LISTA = path.join(CACHE, TESTE ? 'conversas-teste.json' : 'conversas.json');
const ARQ_SESSAO_ANTIGO = path.join(CACHE, TESTE ? 'sessao-teste' : 'sessao-orquestrador');
// Variáveis que o Claude põe no ambiente dos filhos. Herdadas, elas desligam a
// gravação do transcript e confundem o processo novo com uma sub-sessão.
const HERDADAS = ['CLAUDECODE', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_PID',
  'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_EXECPATH', 'CLAUDE_EFFORT', 'AI_AGENT'];

// Segredos que o app pode ter no próprio ambiente e que NÃO descem para as
// conversas, terminais e passos de workflow: a sessão do cofre (com ela
// qualquer conversa leria qualquer item) e as variáveis cadastradas como
// credencial "Variável de ambiente". Quem precisa delas é só o passo de
// workflow que as escolheu, e ele as recebe pelo nome que a credencial define.
const SEGREDOS_BW = /^BW_(SESSION|CLIENTID|CLIENTSECRET|PASSWORD)$/;
function variaveisDeCredencial() {
  try {
    const lista = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config', 'orq-app', 'credenciais.json'), 'utf8')).credenciais || [];
    return lista.filter((c) => c && c.tipo === 'ambiente' && c.ref).map((c) => String(c.ref).trim());
  } catch { return []; }
}

function ambienteLimpo() {
  const env = { ...process.env };
  for (const k of HERDADAS) delete env[k];
  delete env.TMUX;
  for (const k of Object.keys(env)) if (SEGREDOS_BW.test(k)) delete env[k];
  for (const k of variaveisDeCredencial()) delete env[k];
  // Variáveis extras da configuração (ex.: avisar os scripts de projeto de
  // que estão dentro do app e não devem abrir janela de terminal solta).
  Object.assign(env, config.ler().ambiente || {});
  return env;
}

let enviarTela = () => {};
// Quem avisa o usuário (notificação do sistema) quando uma conversa precisa
// dele: main.js liga isto. tipo: 'pedido' (pergunta/permissão) ou 'resposta'.
let avisar = () => {};

// Modelos e esforços que o botão da barra oferece.
const MODELOS = { opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5', fable: 'claude-fable-5-1' };
const ESFORCOS = ['low', 'medium', 'high', 'xhigh', 'max'];
// Esforço que vale quando nada foi escolhido: o do settings.json do Claude.
// Modelo que vale quando nada foi escolhido: o "model" do settings.json.
function modeloPadrao() {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8')).model;
    return MODELOS[m] || m || null;
  } catch { return null; }
}
function esforcoPadrao() {
  try { return JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8')).effortLevel || null; } catch { return null; }
}
const conversas = new Map(); // id → Conversa

// Histórico de uma sessão anterior, lido do transcript que o Claude grava.
function historicoDoTranscript(sessao) {
  const arq = path.join(os.homedir(), '.claude', 'projects', PASTA.replace(/[^A-Za-z0-9]/g, '-'), sessao + '.jsonl');
  let linhas;
  try { linhas = fs.readFileSync(arq, 'utf8').split('\n'); } catch { return []; }
  const lista = [];
  for (const l of linhas) {
    if (!l) continue;
    try {
      const d = JSON.parse(l);
      if ((d.type === 'user' || d.type === 'assistant') && d.message && !d.isMeta) lista.push({ tipo: d.type, message: d.message, antigo: true });
    } catch { /* linha cortada */ }
  }
  return lista.slice(-600);
}

// Antes do Claude subir (ele só manda a lista quando recebe a primeira
// mensagem), o autocompletar usa os comandos mais comuns e as skills locais.
const COMANDOS_BASE = [
  ['compact', 'Resume a conversa para liberar contexto'], ['context', 'Mostra o uso do contexto'],
  ['effort', 'Troca o esforço: low, medium, high, xhigh, max'], ['model', 'Troca o modelo'],
  ['cost', 'Mostra custo e uso da sessão'], ['clear', 'Limpa a conversa'], ['help', 'Ajuda'],
];
function comandosLocais() {
  const lista = COMANDOS_BASE.map(([nome, descricao]) => ({ nome, descricao, dica: '' }));
  const pasta = path.join(os.homedir(), '.claude', 'skills');
  let skills = [];
  try { skills = fs.readdirSync(pasta); } catch { /* sem skills */ }
  for (const nome of skills) {
    let txt = '';
    try { txt = fs.readFileSync(path.join(pasta, nome, 'SKILL.md'), 'utf8').slice(0, 3000); } catch { continue; }
    const m = txt.match(/^description:\s*(.+)$/m);
    lista.push({ nome, descricao: m ? m[1].replace(/^["']|["']$/g, '') : '', dica: '' });
  }
  return lista;
}

class Conversa {
  constructor({ id, titulo, sessao = null, orquestrador = false, modelo = null, esforco = null, anteriores = [] }) {
    this.anteriores = anteriores; // sessões de rodadas já desligadas
    this.modeloEscolhido = modelo; // null = o padrão do Claude
    this.esforco = esforco;
    this.id = id;
    this.titulo = titulo;
    this.sessao = sessao;
    this.orquestrador = orquestrador;
    this.proc = null;
    this.eventos = [];
    this.pendentes = new Map(); // request_id → control_request ainda sem resposta
    this.info = { modelo: modelo ? MODELOS[modelo] : modeloPadrao(), esforco: esforco || esforcoPadrao(), pasta: PASTA, contexto: null, janela: null, uso5h: null, uso7d: null, ocupado: false };
  }

  enviar(canal, dado) { enviarTela(canal, { id: this.id, dado }); }
  registrar(ev) {
    this.eventos.push(ev);
    if (this.eventos.length > 4000) this.eventos = this.eventos.slice(-3000);
    this.enviar('conversa:evento', ev);
  }
  avisarInfo() { this.enviar('conversa:info', this.info); avisarLista(); }

  iniciar({ primeiraMensagem } = {}) {
    if (this.proc) return;
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--include-partial-messages', '--permission-prompt-tool', 'stdio', '--permission-mode', 'auto'];
    const retomando = !!this.sessao;
    if (retomando) args.push('--resume', this.sessao);
    if (this.modeloEscolhido) args.push('--model', MODELOS[this.modeloEscolhido]);
    if (this.esforco) args.push('--effort', this.esforco);
    this.eventos = retomando ? historicoDoTranscript(this.sessao) : [];
    this.enviar('conversa:tudo', this.estado());

    // O caminho escolhido na engrenagem (IAs conectadas), se houver e for
    // executável; senão 'claude' do PATH.
    const proc = spawn(ias.comando('claude', config.ler().iasCaminhos), args, { cwd: PASTA, env: ambienteLimpo(), stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = proc;
    let iniciou = false;
    proc.on('error', (e) => this.registrar({ tipo: 'erro', texto: `Não consegui abrir o Claude: ${e.message}` }));
    let erroTexto = '';
    proc.stderr.on('data', (d) => { erroTexto = (erroTexto + d).slice(-4000); });
    proc.on('exit', (codigo) => {
      if (this.proc === proc) this.proc = null;
      if (proc.reiniciando) return; // troca de modelo/esforço: já subiu outro
      if (proc.encerrando) return;  // rodada desligada: encerrar() já avisou
      // Sessão guardada que o Claude não acha mais: a próxima começa do zero.
      if (codigo && retomando && !iniciou) { this.sessao = null; gravarLista(); }
      this.info.ocupado = false;
      this.pendentes.clear();
      this.avisarInfo();
      this.registrar({ tipo: 'fim', texto: codigo ? `O Claude parou (código ${codigo}). ${erroTexto.trim().split('\n').slice(-3).join(' ')}` : 'A conversa foi pausada.' });
    });
    readline.createInterface({ input: proc.stdout }).on('line', (l) => {
      let d;
      try { d = JSON.parse(l); } catch { return; }
      if (d.type === 'system' && d.subtype === 'init') iniciou = true;
      this.tratar(d);
    });
    if (!retomando && primeiraMensagem) this.mandar(primeiraMensagem);
  }

  tratar(d) {
    const info = this.info;
    switch (d.type) {
      case 'system':
        // Lista de comandos (/…) para o autocompletar da caixa de texto.
        // O init traz o nome de todos os comandos; o commands_changed traz a
        // descrição de parte deles. A lista é a união dos dois.
        if (d.subtype === 'init' && Array.isArray(d.slash_commands)) {
          this.nomesComandos = d.slash_commands.filter((n) => !n.startsWith('__'));
          this.juntarComandos();
        }
        if (d.subtype === 'commands_changed' && Array.isArray(d.commands)) {
          this.descComandos = new Map(d.commands.map((c) => [c.name, { descricao: c.description || '', dica: c.argumentHint || c.argument_hint || '' }]));
          this.juntarComandos();
        }
        if (d.subtype === 'init') {
          info.modelo = d.model; info.pasta = d.cwd;
          if (this.sessao !== d.session_id) { this.sessao = d.session_id; gravarLista(); }
          this.avisarInfo();
        }
        return;
      case 'stream_event': {
        const e = d.event || {};
        if (d.parent_tool_use_id) return;
        if (e.type === 'content_block_delta' && e.delta && e.delta.type === 'text_delta') this.enviar('conversa:parcial', e.delta.text);
        if (e.type === 'message_start') this.enviar('conversa:parcial', null);
        return;
      }
      case 'assistant': {
        const u = d.message.usage;
        if (u && !d.parent_tool_use_id) {
          info.contexto = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
          this.avisarInfo();
        }
        if (!d.parent_tool_use_id) {
          const t = (d.message.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();
          if (t) this.ultimoTexto = t;
        }
        this.registrar({ tipo: 'assistant', message: d.message, sub: d.parent_tool_use_id || null });
        return;
      }
      case 'user':
        this.registrar({ tipo: 'user', message: d.message, sub: d.parent_tool_use_id || null });
        return;
      case 'rate_limit_event': {
        const w = (d.rate_limit_info || {}).unifiedWindows || {};
        if (w.five_hour) info.uso5h = Math.round(w.five_hour.utilization * 100);
        if (w.seven_day) info.uso7d = Math.round(w.seven_day.utilization * 100);
        this.avisarInfo();
        return;
      }
      case 'result': {
        info.ocupado = false;
        const mu = Object.values(d.modelUsage || {})[0];
        if (mu && mu.contextWindow) info.janela = mu.contextWindow;
        this.avisarInfo();
        this.registrar({ tipo: 'resultado', erro: d.is_error, duracao: d.duration_ms, texto: d.is_error ? d.result : null });
        // Fim de turno: o Claude parou e espera o usuário (a tela decide se avisa).
        if (!this.desligando && !this.bastidor) avisar({ tipo: 'resposta', id: this.id, titulo: this.titulo, orquestrador: this.orquestrador, texto: this.ultimoTexto || (d.is_error ? 'Terminou com erro.' : 'Terminou.') });
        this.ultimoTexto = '';
        if (this.desligando) { this.desligando = false; this.encerrar(); return; }
        if (this.reiniciarDepois) { this.reiniciarDepois = false; this.reiniciar(); }
        return;
      }
      case 'control_request':
        if (d.request && d.request.subtype === 'can_use_tool') {
          const p = { id: d.request_id, ferramenta: d.request.tool_name, entrada: d.request.input, motivo: d.request.decision_reason || null };
          this.pendentes.set(d.request_id, p);
          this.enviar('conversa:pedido', p);
          avisarLista();
          const q = (p.entrada && p.entrada.questions && p.entrada.questions[0]) || null;
          avisar({ tipo: 'pedido', id: this.id, titulo: this.titulo, orquestrador: this.orquestrador,
            texto: q ? `${q.header ? q.header + ': ' : ''}${q.question}` : `Quer usar ${p.ferramenta}${p.entrada && p.entrada.command ? `: ${p.entrada.command}` : ''}` });
        }
        return;
      default:
    }
  }

  juntarComandos() {
    const desc = this.descComandos || new Map();
    const nomes = new Set([...(this.nomesComandos || []), ...desc.keys()]);
    this.comandos = [...nomes].filter((n) => !n.startsWith('__')).sort()
      .map((nome) => ({ nome, descricao: (desc.get(nome) || {}).descricao || '', dica: (desc.get(nome) || {}).dica || '' }));
    this.enviar('conversa:comandos', this.comandos);
  }

  escrever(o) {
    if (!this.proc) return false;
    this.proc.stdin.write(JSON.stringify(o) + '\n');
    return true;
  }

  // imagens: [{ tipo: 'image/png', dados: '<base64>' }] (coladas ou arrastadas).
  // exibir: o que aparece no balão quando é diferente do que vai ao Claude
  // (ex.: "@nota:x" no balão; o conteúdo da nota vai junto para o Claude).
  mandar(texto, imagens = [], exibir = null) {
    // Comando de desligar no orquestrador: quando ele terminar, a rodada acaba de vez.
    const desligar = config.ler().comandoDesligar;
    if (this.orquestrador && desligar && texto.trim().split(/\s/)[0] === desligar) this.desligando = true;
    // Mensagem de workflow ou de tópico aprovado/recusado (por trás): a
    // resposta não vira notificação.
    this.bastidor = /^<orq-(workflow|topico) /.test(texto);
    if (!this.proc) this.iniciar();
    // Conversa avulsa ganha o nome da primeira coisa escrita nela.
    if (!this.orquestrador && /^Conversa \d+$/.test(this.titulo)) {
      this.titulo = texto.replace(/\s+/g, ' ').trim().slice(0, 40);
      gravarLista();
    }
    this.info.ocupado = true;
    this.avisarInfo();
    const content = imagens.length
      ? [...imagens.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.tipo, data: i.dados } })), ...(texto ? [{ type: 'text', text: texto }] : [])]
      : texto;
    const mostrado = exibir && !imagens.length ? exibir : content;
    this.registrar({ tipo: 'user', message: { role: 'user', content: mostrado }, local: true });
    return this.escrever({ type: 'user', message: { role: 'user', content } });
  }

  // decisao: { permitir: bool, respostas?: {pergunta: resposta}, motivo?: string }
  responder(reqId, decisao) {
    const p = this.pendentes.get(reqId);
    if (!p) return false;
    this.pendentes.delete(reqId);
    const resposta = decisao.permitir
      ? { behavior: 'allow', updatedInput: decisao.respostas ? { ...p.entrada, answers: decisao.respostas } : p.entrada }
      : { behavior: 'deny', message: decisao.motivo || 'Negado pelo usuário no app.' };
    this.escrever({ type: 'control_response', response: { subtype: 'success', request_id: reqId, response: resposta } });
    this.enviar('conversa:respondido', reqId);
    avisarLista();
    return true;
  }

  // Troca modelo e/ou esforço. O Claude só aceita isso ao subir, então a
  // conversa reinicia com --resume (mesma conversa, histórico intacto). No meio
  // de um turno, espera o turno acabar.
  configurar({ modelo, esforco }) {
    if (modelo !== undefined) { if (modelo && !MODELOS[modelo]) return false; this.modeloEscolhido = modelo || null; }
    if (esforco !== undefined) { if (esforco && !ESFORCOS.includes(esforco)) return false; this.esforco = esforco || null; }
    if (this.modeloEscolhido) this.info.modelo = MODELOS[this.modeloEscolhido];
    this.info.esforco = this.esforco || esforcoPadrao();
    gravarLista();
    this.avisarInfo();
    if (!this.proc) return true;
    if (this.info.ocupado) this.reiniciarDepois = true; else this.reiniciar();
    return true;
  }

  // Fim da rodada: o Claude sai, e o id da sessão deixa de ser o atual. Na
  // próxima abertura o orquestrador começa uma conversa nova (e a rodada, no
  // botão Iniciar) em vez de retomar esta. A conversa continua no histórico do Claude.
  encerrar() {
    if (this.sessao) { this.anteriores = [...(this.anteriores || []), this.sessao].slice(-20); this.sessao = null; }
    if (this.proc) { this.proc.encerrando = true; this.proc.stdin.end(); this.proc.kill(); this.proc = null; }
    this.info.ocupado = false; this.info.contexto = null;
    this.pendentes.clear();
    gravarLista();
    this.avisarInfo();
    this.registrar({ tipo: 'encerrada' });
  }

  reiniciar() {
    if (this.proc) { this.proc.reiniciando = true; this.proc.stdin.end(); this.proc.kill(); this.proc = null; }
    this.pendentes.clear();
    this.iniciar();
  }

  interromper() {
    return this.escrever({ type: 'control_request', request_id: `int-${Date.now()}`, request: { subtype: 'interrupt' } });
  }

  parar() {
    if (this.proc) { this.proc.stdin.end(); this.proc.kill(); this.proc = null; }
  }

  estado() {
    return { id: this.id, comandos: this.comandos || comandosLocais(), eventos: this.eventos, pendentes: [...this.pendentes.values()], info: this.info, vivo: !!this.proc };
  }

  resumo() {
    return { id: this.id, titulo: this.titulo, orquestrador: this.orquestrador, ocupado: this.info.ocupado, pedidos: this.pendentes.size, vivo: !!this.proc };
  }
}

// --- lista guardada -----------------------------------------------------
function gravarLista() {
  fs.mkdirSync(CACHE, { recursive: true });
  const lista = [...conversas.values()].map((c) => ({ id: c.id, titulo: c.titulo, sessao: c.sessao, orquestrador: c.orquestrador, modelo: c.modeloEscolhido, esforco: c.esforco, anteriores: c.anteriores }));
  fs.writeFileSync(ARQ_LISTA, JSON.stringify(lista, null, 2) + '\n');
}

function carregarLista() {
  let lista = [];
  try { lista = JSON.parse(fs.readFileSync(ARQ_LISTA, 'utf8')); } catch { /* primeira vez */ }
  if (!lista.some((c) => c.orquestrador)) {
    // Versão anterior guardava só o id da sessão do orquestrador num arquivo solto.
    let sessao = null;
    try { sessao = fs.readFileSync(ARQ_SESSAO_ANTIGO, 'utf8').trim() || null; } catch { /* não havia */ }
    lista.unshift({ id: 'orquestrador', titulo: 'Orquestrador', sessao, orquestrador: true });
  }
  for (const c of lista) conversas.set(c.id, new Conversa(c));
  gravarLista();
}

function avisarLista() { enviarTela('conversa:lista', lista()); }
function lista() { return [...conversas.values()].map((c) => c.resumo()); }

function pegar(id) {
  const c = conversas.get(id);
  if (!c) throw new Error('conversa desconhecida');
  return c;
}

// Abre (ou só mostra) uma conversa. O orquestrador não manda nada sozinho: a
// rodada começa quando o usuário aperta Iniciar (que manda o comandoInicial).
function abrir(id) {
  const c = pegar(id);
  c.iniciar();
  return c.estado();
}

function nova() {
  let n = 2;
  const titulos = new Set([...conversas.values()].map((c) => c.titulo));
  while (titulos.has(`Conversa ${n}`)) n++;
  const c = new Conversa({ id: `c${Date.now().toString(36)}`, titulo: `Conversa ${n}` });
  conversas.set(c.id, c);
  gravarLista();
  avisarLista();
  return c.id;
}

// Conversa de id fixo (a do ajudante, por exemplo): cria se não existir.
function garantir(id, titulo) {
  if (!conversas.has(id)) {
    conversas.set(id, new Conversa({ id, titulo }));
    gravarLista();
    avisarLista();
  }
  return id;
}

// Tira uma conversa avulsa da lista. A conversa em si continua no histórico do
// Claude (`claude --resume`); o orquestrador nunca sai da lista.
function fechar(id) {
  const c = pegar(id);
  if (c.orquestrador) return false;
  c.parar();
  conversas.delete(id);
  gravarLista();
  avisarLista();
  return true;
}

function pararTodas() { for (const c of conversas.values()) c.parar(); }

// Sair do app (X ou /exit), como o /exit do terminal: encerra todas as
// conversas. O orquestrador começa uma rodada nova na próxima abertura e as
// conversas avulsas saem da lista. Tudo continua no histórico do Claude.
function encerrarTodas() {
  for (const c of [...conversas.values()]) {
    if (c.orquestrador) c.encerrar();
    else { c.parar(); conversas.delete(c.id); }
  }
  gravarLista();
}

carregarLista();

module.exports = {
  ligar: (fn) => { enviarTela = fn; },
  ligarAvisos: (fn) => { avisar = fn; },
  _Conversa: Conversa, // só para os testes de unidade
  lista, abrir, nova, garantir, fechar, pararTodas, encerrarTodas, ambienteLimpo,
  mandar: (id, t, imagens, exibir) => pegar(id).mandar(t, imagens, exibir),
  responder: (id, reqId, d) => pegar(id).responder(reqId, d),
  pedidos: (id) => [...pegar(id).pendentes.values()],
  interromper: (id) => pegar(id).interromper(),
  configurar: (id, o) => pegar(id).configurar(o || {}),
  reiniciar: (id) => { const c = pegar(id); if (c.proc) c.reiniciar(); else c.iniciar(); return true; },
};
