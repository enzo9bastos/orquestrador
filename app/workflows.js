// Workflows: automações visuais, no jeito do n8n. Cada workflow é um desenho
// de nós ligados: um gatilho (relógio ou botão) e passos (mandar ao
// orquestrador, perguntar a um Claude, rodar um comando, condição, aviso).
// A saída de um passo é a entrada do seguinte ({{entrada}} no texto).
//
// O relógio roda aqui, no processo principal: com o app aberto, o workflow
// ativo dispara sozinho. Cada mudança guarda a versão anterior.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ARQ = path.join(os.homedir(), '.config', 'orq-app', 'workflows.json');
const VERSOES = path.join(os.homedir(), '.local', 'share', 'orq-app', 'versoes', 'workflows');
const ARQ_EXECUCOES = path.join(os.homedir(), '.cache', 'orq-app', 'workflows-execucoes.json');
const MAX_EXECUCOES = 30; // por workflow
const MAX_SAIDA = 20000;

// Catálogo dos nós. "campos" desenha o formulário na tela.
const TIPOS = {
  agenda: { nome: 'Relógio', grupo: 'gatilho', descricao: 'Dispara de tempos em tempos ou num horário.', campos: [
    { k: 'modo', rotulo: 'Quando', tipo: 'lista', opcoes: [['intervalo', 'A cada N minutos'], ['diario', 'Todo dia num horário']], padrao: 'intervalo' },
    { k: 'minutos', rotulo: 'A cada quantos minutos', tipo: 'numero', padrao: 3, se: { modo: 'intervalo' } },
    { k: 'horario', rotulo: 'Horário (HH:MM)', tipo: 'texto', padrao: '08:00', se: { modo: 'diario' } },
    { k: 'diasUteis', rotulo: 'Só de segunda a sexta', tipo: 'sim', padrao: false, se: { modo: 'diario' } },
  ] },
  manual: { nome: 'Botão', grupo: 'gatilho', descricao: 'Dispara só quando você aperta Rodar.', campos: [] },
  orquestrador: { nome: 'Mandar ao orquestrador', grupo: 'acao', descricao: 'Escreve na conversa do orquestrador.', campos: [
    { k: 'texto', rotulo: 'Texto', tipo: 'longo', padrao: '' },
    { k: 'soComRodada', rotulo: 'Só com a rodada iniciada (orquestrador aberto)', tipo: 'sim', padrao: true },
    { k: 'pularSeOcupado', rotulo: 'Pular se ele estiver respondendo', tipo: 'sim', padrao: true },
  ] },
  claude: { nome: 'Perguntar ao Claude', grupo: 'acao', descricao: 'Um Claude à parte responde; a resposta segue adiante.', campos: [
    { k: 'prompt', rotulo: 'Pedido', tipo: 'longo', padrao: '' },
    { k: 'modelo', rotulo: 'Modelo', tipo: 'lista', opcoes: [['sonnet', 'Sonnet'], ['haiku', 'Haiku'], ['opus', 'Opus']], padrao: 'sonnet' },
  ] },
  comando: { nome: 'Rodar comando', grupo: 'acao', descricao: 'Roda no shell; a saída segue adiante. A entrada chega em $ORQ_ENTRADA.', campos: [
    { k: 'comando', rotulo: 'Comando', tipo: 'longo', padrao: '' },
    { k: 'pasta', rotulo: 'Pasta', tipo: 'texto', padrao: '~' },
  ] },
  condicao: { nome: 'Condição', grupo: 'logica', descricao: 'Só segue se a entrada combinar.', campos: [
    { k: 'modo', rotulo: 'Segue quando a entrada', tipo: 'lista', opcoes: [['contem', 'contém o texto'], ['naoContem', 'não contém o texto'], ['regex', 'combina com a expressão'], ['naoVazia', 'não está vazia']], padrao: 'contem' },
    { k: 'valor', rotulo: 'Texto ou expressão', tipo: 'texto', padrao: '', se: { modo: ['contem', 'naoContem', 'regex'] } },
  ] },
  notificar: { nome: 'Avisar', grupo: 'acao', descricao: 'Notificação do sistema.', campos: [
    { k: 'titulo', rotulo: 'Título', tipo: 'texto', padrao: 'Workflow' },
    { k: 'texto', rotulo: 'Texto', tipo: 'longo', padrao: '{{entrada}}' },
  ] },
};
const GATILHOS = new Set(Object.keys(TIPOS).filter((t) => TIPOS[t].grupo === 'gatilho'));

// Exemplo que já vem pronto, desligado: a passada de 3 em 3 minutos que o
// orquestrador faz pelo agendamento do Claude. O do Claude continua; este é
// a cópia no app (ligar os dois manda a passada em dobro).
const EXEMPLO = {
  id: 'passada-frentes', nome: 'Passada nas frentes (3 em 3 min)', ativo: false,
  descricao: 'A cada 3 minutos, com a rodada iniciada, pede ao orquestrador a passada nas frentes. Cópia no app do lembrete que o Claude agenda.',
  nos: [
    { id: 'n1', tipo: 'agenda', x: 40, y: 60, config: { modo: 'intervalo', minutos: 3 } },
    { id: 'n2', tipo: 'orquestrador', x: 290, y: 60, config: { soComRodada: true, pularSeOcupado: true, texto: 'Passada automática (workflow do app): passe nas frentes, confira o que cada agente diz ter feito contra o git, marque como revisado e atualize ~/dev/_orq/topicos.md. Só me escreva se houver decisão minha, pedido de permissão parado na tela, achado que muda o rumo ou frente concluída. Silêncio é a resposta padrão.' } },
  ],
  ligacoes: [{ de: 'n1', para: 'n2' }],
};

let conversa = null; // ligar(): { lista, mandar }
let avisar = () => {};
let enviarTela = () => {};
const rodando = new Set();
const ultimoDisparo = new Map(); // "wf:no" → ms
let relogio = null;

const casa = (p) => (typeof p === 'string' ? p.replace(/^~(?=$|\/)/, os.homedir()) : p);
const texto = (v, max = 20000) => String(v ?? '').slice(0, max);

function limpar(w) {
  const nos = (Array.isArray(w.nos) ? w.nos : []).filter((n) => n && TIPOS[n.tipo]).slice(0, 60).map((n, i) => {
    const config = {};
    for (const c of TIPOS[n.tipo].campos) {
      const v = n.config ? n.config[c.k] : undefined;
      if (c.tipo === 'sim') config[c.k] = v === undefined ? c.padrao : v === true;
      else if (c.tipo === 'numero') config[c.k] = Math.max(1, Math.min(10080, Math.round(Number(v)) || c.padrao));
      else if (c.tipo === 'lista') config[c.k] = c.opcoes.some((o) => o[0] === v) ? v : c.padrao;
      else config[c.k] = v === undefined ? c.padrao : texto(v);
    }
    return { id: /^[\w-]{1,40}$/.test(n.id || '') ? n.id : `n${i + 1}`, tipo: n.tipo, x: Math.round(Number(n.x)) || 0, y: Math.round(Number(n.y)) || 0, config };
  });
  const ids = new Set(nos.map((n) => n.id));
  const vistas = new Set();
  const ligacoes = (Array.isArray(w.ligacoes) ? w.ligacoes : [])
    .filter((l) => l && ids.has(l.de) && ids.has(l.para) && l.de !== l.para && !GATILHOS.has(nos.find((n) => n.id === l.para).tipo))
    .filter((l) => !vistas.has(`${l.de}>${l.para}`) && vistas.add(`${l.de}>${l.para}`))
    .map((l) => ({ de: l.de, para: l.para }));
  return {
    id: /^[\w-]{1,60}$/.test(w.id || '') ? w.id : `w${Date.now().toString(36)}`,
    nome: texto(w.nome, 80).trim() || 'Workflow sem nome',
    descricao: texto(w.descricao, 500),
    ativo: w.ativo === true,
    nos, ligacoes,
  };
}

function ler() {
  try { return JSON.parse(fs.readFileSync(ARQ, 'utf8')).workflows.map(limpar); } catch { /* primeira vez */ }
  if (fs.existsSync(ARQ)) return []; // arquivo estragado: não sobrescreve com o exemplo
  gravarArquivo([EXEMPLO]);
  return [limpar(EXEMPLO)];
}

function gravarArquivo(lista) {
  if (fs.existsSync(ARQ)) {
    fs.mkdirSync(VERSOES, { recursive: true });
    // Nome único mesmo com duas gravações no mesmo milissegundo (uma versão
    // nunca fica por cima da outra).
    const base = new Date().toISOString().replace(/[:.]/g, '-');
    let destino = path.join(VERSOES, `${base}.json`);
    for (let n = 2; fs.existsSync(destino); n++) destino = path.join(VERSOES, `${base}-${n}.json`);
    fs.copyFileSync(ARQ, destino);
  }
  fs.mkdirSync(path.dirname(ARQ), { recursive: true });
  const tmp = `${ARQ}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ workflows: lista }, null, 2) + '\n');
  fs.renameSync(tmp, ARQ);
}

function gravar(w) {
  const limpo = limpar(w || {});
  const lista = ler();
  const i = lista.findIndex((x) => x.id === limpo.id);
  if (i >= 0) lista[i] = limpo; else lista.push(limpo);
  gravarArquivo(lista);
  return limpo;
}

// Apagar é pedido explícito do usuário na tela; a versão anterior fica em VERSOES.
function apagar(id) {
  const lista = ler();
  const resto = lista.filter((w) => w.id !== id);
  if (resto.length === lista.length) return false;
  gravarArquivo(resto);
  return true;
}

// --- execuções -----------------------------------------------------------
function lerExecucoes() { try { return JSON.parse(fs.readFileSync(ARQ_EXECUCOES, 'utf8')); } catch { return {}; } }
function guardarExecucao(e) {
  const todas = lerExecucoes();
  todas[e.wf] = [e, ...(todas[e.wf] || [])].slice(0, MAX_EXECUCOES);
  fs.mkdirSync(path.dirname(ARQ_EXECUCOES), { recursive: true });
  fs.writeFileSync(ARQ_EXECUCOES, JSON.stringify(todas) + '\n');
}
const execucoes = (id) => lerExecucoes()[id] || [];

const preencher = (t, entrada) => String(t || '')
  .replace(/\{\{\s*entrada\s*\}\}/g, entrada)
  .replace(/\{\{\s*data\s*\}\}/g, new Date().toLocaleString('pt-BR'));

function processo(cmd, args, { cwd, entrada, env, limite = 120000 }) {
  return new Promise((ok, falha) => {
    const p = spawn(cmd, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let saida = '', erro = '';
    const t = setTimeout(() => { p.kill(); falha(new Error(`passou de ${Math.round(limite / 1000)} s e foi parado`)); }, limite);
    p.stdout.on('data', (d) => { saida = (saida + d).slice(-MAX_SAIDA); });
    p.stderr.on('data', (d) => { erro = (erro + d).slice(-4000); });
    p.on('error', (e) => { clearTimeout(t); falha(e); });
    p.on('close', (c) => { clearTimeout(t); if (c === 0) ok(saida.trim()); else falha(new Error(`saiu com código ${c}${erro.trim() ? `: ${erro.trim().split('\n').slice(-3).join(' ')}` : ''}`)); });
    p.stdin.end(entrada || '');
  });
}

// Cada passo devolve { saida } para seguir, ou { parar: 'motivo' } para
// encerrar aquele ramo sem erro.
const PASSOS = {
  agenda: async (_c, entrada) => ({ saida: entrada }),
  manual: async (_c, entrada) => ({ saida: entrada }),
  orquestrador: async (c, entrada) => {
    const o = conversa.lista().find((x) => x.orquestrador);
    if (c.soComRodada && !(o && o.vivo)) return { parar: 'a rodada não está iniciada' };
    if (c.pularSeOcupado && o && o.ocupado) return { parar: 'o orquestrador estava respondendo' };
    const t = preencher(c.texto, entrada).trim();
    if (!t) return { parar: 'texto vazio' };
    conversa.mandar(o ? o.id : 'orquestrador', t);
    return { saida: t };
  },
  claude: async (c, entrada) => {
    const p = preencher(c.prompt, entrada).trim();
    if (!p) throw new Error('pedido vazio');
    const cmd = process.env.ORQ_WF_CLAUDE || 'claude';
    return { saida: await processo(cmd, ['-p', '--model', c.modelo], { cwd: os.homedir(), entrada: p, env: conversa.ambienteLimpo(), limite: 600000 }) };
  },
  comando: async (c, entrada) => {
    if (!c.comando.trim()) throw new Error('comando vazio');
    const pasta = casa(c.pasta || '~');
    return { saida: await processo('bash', ['-lc', c.comando], { cwd: fs.existsSync(pasta) ? pasta : os.homedir(), entrada, env: { ...conversa.ambienteLimpo(), ORQ_ENTRADA: entrada } }) };
  },
  condicao: async (c, entrada) => {
    let passa;
    if (c.modo === 'naoVazia') passa = !!entrada.trim();
    else if (c.modo === 'regex') { try { passa = new RegExp(c.valor, 'i').test(entrada); } catch { throw new Error('expressão inválida'); } }
    else passa = entrada.toLowerCase().includes(String(c.valor).toLowerCase()) === (c.modo === 'contem');
    return passa ? { saida: entrada } : { parar: 'a condição não bateu' };
  },
  notificar: async (c, entrada) => {
    const t = preencher(c.texto, entrada).slice(0, 400);
    avisar(preencher(c.titulo, entrada) || 'Workflow', t);
    return { saida: entrada };
  },
};

// Roda a partir dos gatilhos indicados (ou de todos, no Rodar manual), em
// largura: cada nó recebe a saída de quem liga nele.
async function rodar(id, { motivo = 'manual', gatilhos } = {}) {
  const w = ler().find((x) => x.id === id);
  if (!w) throw new Error('workflow não encontrado');
  if (rodando.has(id)) return { ok: false, erro: 'já está rodando' };
  rodando.add(id);
  const e = { id: `e${Date.now().toString(36)}`, wf: id, motivo, inicio: Date.now(), fim: null, passos: [], ok: true };
  const aviso = () => enviarTela('workflows:execucao', e);
  try {
    const porId = new Map(w.nos.map((n) => [n.id, n]));
    const fila = (gatilhos || w.nos.filter((n) => GATILHOS.has(n.tipo)).map((n) => n.id)).map((n) => ({ no: n, entrada: '' }));
    let passos = 0;
    while (fila.length && passos < 100) {
      const { no, entrada } = fila.shift();
      const n = porId.get(no);
      if (!n) continue;
      passos++;
      const p = { no: n.id, tipo: n.tipo, estado: 'rodando', inicio: Date.now() };
      e.passos.push(p);
      aviso();
      try {
        const r = await PASSOS[n.tipo](n.config, entrada);
        if (r.parar) { p.estado = 'parou'; p.saida = r.parar; } else {
          p.estado = 'ok';
          p.saida = texto(r.saida, 2000);
          for (const l of w.ligacoes.filter((x) => x.de === n.id)) fila.push({ no: l.para, entrada: String(r.saida ?? '') });
        }
      } catch (err) {
        p.estado = 'erro'; p.saida = err.message; e.ok = false;
      }
      p.fim = Date.now();
      aviso();
    }
  } finally {
    rodando.delete(id);
    e.fim = Date.now();
    guardarExecucao(e);
    aviso();
  }
  return { ok: e.ok, execucao: e };
}

// --- relógio --------------------------------------------------------------
// Diz se um nó de relógio vence agora. ultimo: ms do último disparo (ou
// da hora em que o relógio começou a contar, para não disparar na abertura).
function vence(c, agora, ultimo) {
  if (c.modo === 'diario') {
    const m = /^(\d{1,2}):(\d{2})$/.exec(c.horario || '');
    if (!m) return false;
    const d = new Date(agora);
    if (c.diasUteis && (d.getDay() === 0 || d.getDay() === 6)) return false;
    const alvo = new Date(d); alvo.setHours(Number(m[1]), Number(m[2]), 0, 0);
    return agora >= alvo.getTime() && agora - alvo.getTime() < 5 * 60000 && (!ultimo || ultimo < alvo.getTime());
  }
  return agora - (ultimo || 0) >= Math.max(1, c.minutos) * 60000;
}

function tique(agora = Date.now()) {
  for (const w of ler()) {
    if (!w.ativo) continue;
    const devidos = [];
    for (const n of w.nos.filter((x) => x.tipo === 'agenda')) {
      const chave = `${w.id}:${n.id}`;
      if (!ultimoDisparo.has(chave)) { ultimoDisparo.set(chave, n.config.modo === 'diario' ? 0 : agora); if (n.config.modo !== 'diario') continue; }
      if (vence(n.config, agora, ultimoDisparo.get(chave))) { ultimoDisparo.set(chave, agora); devidos.push(n.id); }
    }
    if (devidos.length) rodar(w.id, { motivo: 'relógio', gatilhos: devidos }).catch(() => {});
  }
}

function ligar({ conversa: c, avisar: a, enviarTela: t }) {
  conversa = c; avisar = a; enviarTela = t;
  clearInterval(relogio);
  relogio = setInterval(() => { try { tique(); } catch { /* arquivo estragado: tenta no próximo */ } }, 15000);
}
function desligar() { clearInterval(relogio); relogio = null; }

const tipos = () => TIPOS;
const lista = () => ler().map((w) => ({ ...w, rodando: rodando.has(w.id) }));

module.exports = { ligar, desligar, lista, gravar, apagar, rodar, execucoes, tipos, vence, tique, TIPOS, ARQ };
