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
const configApp = require('./config');
const ias = require('./ias');

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
  pasta: { nome: 'Arquivo novo na pasta', grupo: 'gatilho', descricao: 'Dispara quando aparece um arquivo novo na pasta (ligado). A saída é o caminho do arquivo.', campos: [
    { k: 'pasta', rotulo: 'Pasta', tipo: 'texto', padrao: '~/Downloads' },
    { k: 'padrao', rotulo: 'Que arquivos (ex.: *.pdf, *.png; vazio = todos)', tipo: 'texto', padrao: '*.pdf' },
  ] },
  orquestrador: { nome: 'Mandar ao orquestrador', grupo: 'acao', descricao: 'Escreve na conversa do orquestrador.', campos: [
    { k: 'texto', rotulo: 'Texto', tipo: 'longo', padrao: '' },
    { k: 'soComRodada', rotulo: 'Só com a rodada iniciada (orquestrador aberto)', tipo: 'sim', padrao: true },
    { k: 'pularSeOcupado', rotulo: 'Pular se ele estiver respondendo', tipo: 'sim', padrao: true },
  ] },
  claude: { nome: 'Perguntar ao Claude', grupo: 'ia', descricao: 'Um Claude à parte responde; a resposta segue adiante.', campos: [
    { k: 'prompt', rotulo: 'Pedido', tipo: 'longo', padrao: '' },
    { k: 'modelo', rotulo: 'Modelo', tipo: 'lista', opcoes: [['sonnet', 'Sonnet'], ['haiku', 'Haiku'], ['opus', 'Opus']], padrao: 'sonnet' },
  ] },
  comando: { nome: 'Rodar comando', grupo: 'acao', descricao: 'Roda no shell; a saída segue adiante. A entrada chega em $ORQ_ENTRADA.', campos: [
    { k: 'comando', rotulo: 'Comando', tipo: 'longo', padrao: '' },
    { k: 'pasta', rotulo: 'Pasta', tipo: 'texto', padrao: '~' },
    { k: 'credenciais', rotulo: 'Credenciais (viram variáveis de ambiente do comando)', tipo: 'credenciais', padrao: [] },
  ] },
  condicao: { nome: 'Condição', grupo: 'logica', descricao: 'Só segue se a entrada combinar.', campos: [
    { k: 'modo', rotulo: 'Segue quando a entrada', tipo: 'lista', opcoes: [['contem', 'contém o texto'], ['naoContem', 'não contém o texto'], ['regex', 'combina com a expressão'], ['naoVazia', 'não está vazia']], padrao: 'contem' },
    { k: 'valor', rotulo: 'Texto ou expressão', tipo: 'texto', padrao: '', se: { modo: ['contem', 'naoContem', 'regex'] } },
  ] },
  ler: { nome: 'Ler arquivo', grupo: 'arquivos', descricao: 'Lê o texto de um arquivo; o texto segue adiante.', campos: [
    { k: 'caminho', rotulo: 'Arquivo', tipo: 'texto', padrao: '{{entrada}}' },
  ] },
  mover: { nome: 'Mover ou copiar arquivo', grupo: 'arquivos', descricao: 'Leva o arquivo para outra pasta. Nunca sobrescreve: se já existir um com o mesmo nome, o novo ganha um número.', campos: [
    { k: 'modo', rotulo: 'O que fazer', tipo: 'lista', opcoes: [['mover', 'Mover'], ['copiar', 'Copiar']], padrao: 'mover' },
    { k: 'caminho', rotulo: 'Arquivo', tipo: 'texto', padrao: '{{arquivo}}' },
    { k: 'destino', rotulo: 'Para a pasta', tipo: 'texto', padrao: '~/Documentos' },
  ] },
  escrever: { nome: 'Escrever arquivo', grupo: 'arquivos', descricao: 'Grava texto num arquivo. Nunca sobrescreve: arquivo novo ganha um número se o nome já existir; "acrescentar" escreve no fim.', campos: [
    { k: 'modo', rotulo: 'Como', tipo: 'lista', opcoes: [['novo', 'Arquivo novo'], ['acrescentar', 'Acrescentar no fim']], padrao: 'novo' },
    { k: 'pasta', rotulo: 'Pasta', tipo: 'texto', padrao: '~/Documentos' },
    { k: 'nome', rotulo: 'Nome do arquivo', tipo: 'texto', padrao: 'resultado-{{data_arquivo}}.md' },
    { k: 'conteudo', rotulo: 'Conteúdo', tipo: 'longo', padrao: '{{entrada}}' },
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
  id: 'passada-frentes', nome: 'Passada nos agentes (a cada 3 min)', ativo: false,
  descricao: 'A cada 3 minutos, com a rodada iniciada, pede ao orquestrador para conferir os agentes. Nasce desligado.',
  nos: [
    { id: 'n1', tipo: 'agenda', x: 40, y: 60, config: { modo: 'intervalo', minutos: 3 } },
    { id: 'n2', tipo: 'orquestrador', x: 290, y: 60, config: { soComRodada: true, pularSeOcupado: true, texto: 'Passada automática: veja como está cada agente e confira o que diz ter feito. Só me escreva se precisar de uma decisão minha, se houver um pedido de permissão parado ou se algo terminou.' } },
  ],
  ligacoes: [{ de: 'n1', para: 'n2' }],
};

let conversa = null; // ligar(): { lista, mandar }
let avisar = () => {};
let enviarTela = () => {};
const rodando = new Set();
// Último disparo de cada relógio, guardado em disco: reiniciar o app não pode
// disparar de novo o diário que já rodou hoje, nem zerar a contagem do intervalo.
const ARQ_RELOGIO = path.join(os.homedir(), '.local', 'share', 'orq-app', 'workflows-relogio.json');
const ultimoDisparo = new Map(); // "wf:no" → ms
let relogioGuardado = null;
function disparoGuardado(chave) {
  if (!relogioGuardado) { try { relogioGuardado = JSON.parse(fs.readFileSync(ARQ_RELOGIO, 'utf8')) || {}; } catch { relogioGuardado = {}; } }
  const v = Number(relogioGuardado[chave]);
  return v > 0 ? v : null;
}
function guardarDisparo(chave, ms) {
  ultimoDisparo.set(chave, ms);
  if (!relogioGuardado) disparoGuardado(chave);
  relogioGuardado[chave] = ms;
  try {
    fs.mkdirSync(path.dirname(ARQ_RELOGIO), { recursive: true });
    const tmp = `${ARQ_RELOGIO}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(relogioGuardado) + '\n');
    fs.renameSync(tmp, ARQ_RELOGIO);
  } catch (e) { console.error('[workflows] não guardei o último disparo do relógio:', e.message); }
}
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
      else if (c.tipo === 'credenciais') config[c.k] = (Array.isArray(v) ? v : []).filter((x) => typeof x === 'string' && /^[\w-]{1,60}$/.test(x)).slice(0, 10);
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
    atualizado: Number(w.atualizado) || null,
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
  const limpo = limpar({ ...(w || {}), atualizado: Date.now() });
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
// Todas as execuções, de todos os workflows, mais novas primeiro.
const todasExecucoes = () => Object.values(lerExecucoes()).flat().sort((a, b) => b.inicio - a.inicio).slice(0, 150);

// --- credenciais ---------------------------------------------------------
// Só a REFERÊNCIA fica guardada (onde a credencial mora), nunca o valor. O
// valor é lido na hora de rodar o passo, vai ao comando por variável de
// ambiente e é trocado por •••• em qualquer saída que fique guardada.
const ARQ_CRED = path.join(os.homedir(), '.config', 'orq-app', 'credenciais.json');
const VERSOES_CRED = path.join(os.homedir(), '.local', 'share', 'orq-app', 'versoes', 'credenciais');
const TIPOS_CRED = {
  bitwarden: { nome: 'Item do cofre (Bitwarden)', ref: 'Nome ou id do item', dica: 'Lido com o bw (Bitwarden CLI, vale para servidor próprio compatível) na hora de rodar; o cofre precisa estar destravado (BW_SESSION no ambiente do app).' },
  arquivo: { nome: 'Arquivo', ref: 'Caminho do arquivo', dica: 'O conteúdo do arquivo é a credencial. O certo é o arquivo estar com modo 600.' },
  ambiente: { nome: 'Variável de ambiente', ref: 'Nome da variável', dica: 'Lida do ambiente em que o app foi aberto.' },
};
const CAMPOS_BW = [['password', 'Senha'], ['username', 'Usuário'], ['notes', 'Notas'], ['totp', 'Código TOTP']];
function limparCred(c) {
  const tipo = TIPOS_CRED[c.tipo] ? c.tipo : 'bitwarden';
  return {
    id: /^[\w-]{1,60}$/.test(c.id || '') ? c.id : `c${Date.now().toString(36)}`,
    nome: texto(c.nome, 80).trim() || 'Credencial sem nome',
    tipo,
    ref: texto(c.ref, 300).trim(),
    campo: tipo === 'bitwarden' && CAMPOS_BW.some((x) => x[0] === c.campo) ? c.campo : 'password',
    variavel: /^[A-Z_][A-Z0-9_]{0,60}$/.test(c.variavel || '') ? c.variavel : 'SEGREDO',
    atualizado: Date.now(),
  };
}
function credenciais() { try { return JSON.parse(fs.readFileSync(ARQ_CRED, 'utf8')).credenciais || []; } catch { return []; } }
function gravarCreds(lista) {
  if (fs.existsSync(ARQ_CRED)) {
    fs.mkdirSync(VERSOES_CRED, { recursive: true });
    fs.copyFileSync(ARQ_CRED, path.join(VERSOES_CRED, `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.hrtime.bigint()}.json`));
  }
  fs.mkdirSync(path.dirname(ARQ_CRED), { recursive: true });
  fs.writeFileSync(`${ARQ_CRED}.tmp`, JSON.stringify({ credenciais: lista }, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(`${ARQ_CRED}.tmp`, ARQ_CRED);
}
function gravarCredencial(c) {
  const limpa = limparCred(c || {});
  const lista = credenciais();
  const i = lista.findIndex((x) => x.id === limpa.id);
  if (i >= 0) lista[i] = limpa; else lista.push(limpa);
  gravarCreds(lista);
  return limpa;
}
// Pedido explícito do usuário na tela; a versão anterior fica guardada. O
// valor de verdade (no cofre, no arquivo) não é tocado.
function apagarCredencial(id) {
  const lista = credenciais();
  const resto = lista.filter((c) => c.id !== id);
  if (resto.length === lista.length) return false;
  gravarCreds(resto);
  return true;
}
async function resolver(c) {
  if (!c.ref) throw new Error(`a credencial «${c.nome}» está sem referência`);
  if (c.tipo === 'arquivo') {
    try { return fs.readFileSync(casa(c.ref), 'utf8').trim(); } catch { throw new Error(`não consegui ler o arquivo da credencial «${c.nome}»`); }
  }
  if (c.tipo === 'ambiente') {
    if (!process.env[c.ref]) throw new Error(`a variável ${c.ref} (credencial «${c.nome}») não existe no ambiente do app`);
    return process.env[c.ref];
  }
  try { return await processo(process.env.ORQ_WF_BW || 'bw', ['get', c.campo, c.ref], { cwd: os.homedir(), entrada: '', env: process.env, limite: 30000 }); } catch {
    throw new Error(`não consegui ler «${c.nome}» do cofre (trancado ou item não achado)`);
  }
}
// Testar diz só se deu para ler e o tamanho — nunca o valor.
async function testarCredencial(id) {
  const c = credenciais().find((x) => x.id === id);
  if (!c) return { ok: false, erro: 'credencial não encontrada' };
  try {
    const v = await resolver(c);
    if (!v) return { ok: false, erro: 'leu, mas veio vazia' };
    let aviso = null;
    if (c.tipo === 'arquivo') {
      const modo = fs.statSync(casa(c.ref)).mode & 0o777;
      if (modo & 0o077) aviso = `o arquivo está com modo ${modo.toString(8)}; o certo é 600`;
    }
    return { ok: true, tamanho: v.length, aviso };
  } catch (e) { return { ok: false, erro: e.message }; }
}
// Troca por •••• o valor e as formas em que um comando costuma reimprimi-lo
// (base64 com e sem "=", base64 de URL, hex, codificado para URL). Valor com
// menos de 4 caracteres não é mascarado: trocaria pedaços comuns do texto.
function formasDoSegredo(v) {
  const b = Buffer.from(v);
  const b64 = b.toString('base64');
  return [...new Set([v, b64, b64.replace(/=+$/, ''), b.toString('base64url'), b.toString('hex'), b.toString('hex').toUpperCase(), encodeURIComponent(v)])]
    .filter((f) => f.length >= 4).sort((x, y) => y.length - x.length);
}
const mascarar = (t, valores) => valores.filter((v) => v && v.length >= 4).flatMap(formasDoSegredo)
  .reduce((s, f) => s.split(f).join('••••'), String(t ?? ''));

// Mensagem de workflow ao orquestrador: vai embrulhada, para a tela (ao vivo
// e no histórico) saber que não foi o usuário que escreveu.
const marcarBastidor = (w, t) => `<orq-workflow nome="${String(w?.nome || 'workflow').replace(/["<>]/g, '')}">\n${t}\n</orq-workflow>`;
// {{entrada}} saída do passo anterior · {{data}} data e hora · {{data_arquivo}}
// data boa para nome de arquivo · {{arquivo}} / {{nome_arquivo}} o arquivo
// que disparou o workflow (gatilho "Arquivo novo na pasta").
const dataArquivo = () => new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
const preencher = (t, entrada, ctx = {}) => String(t || '')
  .replace(/\{\{\s*entrada\s*\}\}/g, entrada)
  .replace(/\{\{\s*data_arquivo\s*\}\}/g, dataArquivo())
  .replace(/\{\{\s*data\s*\}\}/g, new Date().toLocaleString('pt-BR'))
  .replace(/\{\{\s*arquivo\s*\}\}/g, ctx.arquivo || '')
  .replace(/\{\{\s*nome_arquivo\s*\}\}/g, ctx.arquivo ? path.basename(ctx.arquivo) : '');

// valores: segredos a mascarar ANTES de cortar a saída (cortar antes deixaria
// o fim de um segredo no começo do que fica guardado).
function processo(cmd, args, { cwd, entrada, env, limite = 120000, valores = [] }) {
  return new Promise((ok, falha) => {
    const p = spawn(cmd, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let saida = '', erro = '';
    const t = setTimeout(() => { p.kill(); falha(new Error(`passou de ${Math.round(limite / 1000)} s e foi parado`)); }, limite);
    // Guarda folga do tamanho do maior segredo antes de mascarar e cortar: um
    // segredo que chega partido entre dois pedaços ainda é achado inteiro.
    const folga = valores.reduce((m, v) => Math.max(m, ...formasDoSegredo(String(v || '')).map((f) => f.length), 0), 0);
    const juntar = (atual, d, max) => {
      const t = atual + d;
      if (!valores.length) return t.slice(-max);
      return mascarar(t.slice(-(max + folga)), valores).slice(-max);
    };
    p.stdout.on('data', (d) => { saida = juntar(saida, d, MAX_SAIDA); });
    p.stderr.on('data', (d) => { erro = juntar(erro, d, 4000); });
    p.on('error', (e) => { clearTimeout(t); falha(e); });
    p.on('close', (c) => { clearTimeout(t); if (c === 0) ok(saida.trim()); else falha(new Error(`saiu com código ${c}${erro.trim() ? `: ${erro.trim().split('\n').slice(-3).join(' ')}` : ''}`)); });
    p.stdin.end(entrada || '');
  });
}

// Cada passo devolve { saida } para seguir, ou { parar: 'motivo' } para
// encerrar aquele ramo sem erro.
const PASSOS = {
  agenda: async (_c, entrada) => ({ saida: entrada }),
  pasta: async (_c, entrada, _w, ctx) => ({ saida: ctx.arquivo || entrada }),
  manual: async (_c, entrada) => ({ saida: entrada }),
  orquestrador: async (c, entrada, w, ctx) => {
    const o = conversa.lista().find((x) => x.orquestrador);
    if (c.soComRodada && !(o && o.vivo)) return { parar: 'a rodada não está iniciada' };
    if (c.pularSeOcupado && o && o.ocupado) return { parar: 'o orquestrador estava respondendo' };
    const t = preencher(c.texto, entrada, ctx).trim();
    if (!t) return { parar: 'texto vazio' };
    // Vai por trás, marcado: a tela não mostra como mensagem do usuário (só
    // uma linha discreta) e a resposta não vira notificação.
    conversa.mandar(o ? o.id : 'orquestrador', marcarBastidor(w, t));
    return { saida: t };
  },
  claude: async (c, entrada, _w, ctx) => {
    const p = preencher(c.prompt, entrada, ctx).trim();
    if (!p) throw new Error('pedido vazio');
    // ORQ_WF_CLAUDE (testes) vale antes do caminho escolhido na engrenagem.
    const cmd = process.env.ORQ_WF_CLAUDE || ias.comando('claude', configApp.ler().iasCaminhos);
    return { saida: await processo(cmd, ['-p', '--model', c.modelo], { cwd: os.homedir(), entrada: p, env: conversa.ambienteLimpo(), limite: 600000 }) };
  },
  comando: async (c, entrada, _w, ctx) => {
    if (!c.comando.trim()) throw new Error('comando vazio');
    const pasta = casa(c.pasta || '~');
    const env = { ...conversa.ambienteLimpo(), ORQ_ENTRADA: entrada, ORQ_ARQUIVO: ctx.arquivo || '' };
    const valores = [];
    const todas = credenciais();
    for (const id of c.credenciais || []) {
      const cr = todas.find((x) => x.id === id);
      if (!cr) throw new Error('uma credencial escolhida neste passo não existe mais');
      const v = await resolver(cr);
      env[cr.variavel] = v;
      valores.push(v);
    }
    try {
      return { saida: mascarar(await processo('bash', ['-lc', c.comando], { cwd: fs.existsSync(pasta) ? pasta : os.homedir(), entrada, env, valores }), valores) };
    } catch (e) { throw new Error(mascarar(e.message, valores)); }
  },
  condicao: async (c, entrada) => {
    let passa;
    if (c.modo === 'naoVazia') passa = !!entrada.trim();
    else if (c.modo === 'regex') { try { passa = new RegExp(c.valor, 'i').test(entrada); } catch { throw new Error('expressão inválida'); } }
    else passa = entrada.toLowerCase().includes(String(c.valor).toLowerCase()) === (c.modo === 'contem');
    return passa ? { saida: entrada } : { parar: 'a condição não bateu' };
  },
  ler: async (c, entrada, _w, ctx) => {
    const arq = casa(preencher(c.caminho, entrada, ctx).trim());
    if (!arq) throw new Error('sem arquivo');
    let st;
    try { st = fs.statSync(arq); } catch { throw new Error(`não achei o arquivo ${arq}`); }
    if (!st.isFile()) throw new Error(`${arq} não é um arquivo`);
    const buf = Buffer.alloc(Math.min(st.size, 200000));
    const fd = fs.openSync(arq, 'r'); fs.readSync(fd, buf, 0, buf.length, 0); fs.closeSync(fd);
    return { saida: buf.toString('utf8') + (st.size > buf.length ? '\n…(cortado: arquivo maior que 200 KB)' : '') };
  },
  mover: async (c, entrada, _w, ctx) => {
    const arq = casa(preencher(c.caminho, entrada, ctx).trim());
    const pasta = casa(preencher(c.destino, entrada, ctx).trim());
    if (!arq || !fs.existsSync(arq)) throw new Error(`não achei o arquivo ${arq}`);
    fs.mkdirSync(pasta, { recursive: true });
    const destino = livre(path.join(pasta, path.basename(arq)));
    if (c.modo === 'copiar') fs.copyFileSync(arq, destino, fs.constants.COPYFILE_EXCL);
    else {
      try { fs.linkSync(arq, destino); fs.unlinkSync(arq); } // mesmo disco: sem risco de sobrescrever
      catch { fs.copyFileSync(arq, destino, fs.constants.COPYFILE_EXCL); fs.unlinkSync(arq); }
    }
    return { saida: destino };
  },
  escrever: async (c, entrada, _w, ctx) => {
    const pasta = casa(preencher(c.pasta, entrada, ctx).trim());
    const nome = preencher(c.nome, entrada, ctx).trim().replace(/[/\\]/g, '-') || `resultado-${dataArquivo()}.md`;
    fs.mkdirSync(pasta, { recursive: true });
    const conteudo = preencher(c.conteudo, entrada, ctx);
    let alvo = path.join(pasta, nome);
    if (c.modo === 'acrescentar') fs.appendFileSync(alvo, conteudo.endsWith('\n') ? conteudo : `${conteudo}\n`);
    else { alvo = livre(alvo); fs.writeFileSync(alvo, conteudo, { flag: 'wx' }); }
    return { saida: alvo };
  },
  notificar: async (c, entrada, _w, ctx) => {
    const t = preencher(c.texto, entrada, ctx).slice(0, 400);
    avisar(preencher(c.titulo, entrada, ctx) || 'Workflow', t);
    return { saida: entrada };
  },
};

// Nome que ainda não existe: "x.pdf" → "x-2.pdf", "x-3.pdf"… (nunca sobrescreve).
function livre(alvo) {
  if (!fs.existsSync(alvo)) return alvo;
  const ext = path.extname(alvo), base = alvo.slice(0, alvo.length - ext.length);
  for (let n = 2; ; n++) { const c = `${base}-${n}${ext}`; if (!fs.existsSync(c)) return c; }
}

// Roda a partir dos gatilhos indicados (ou de todos, no Rodar manual), em
// largura: cada nó recebe a saída de quem liga nele.
async function rodar(id, { motivo = 'manual', gatilhos, arquivo = null } = {}) {
  const ctx = { arquivo };
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
        const r = await PASSOS[n.tipo](n.config, entrada, w, ctx);
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
      if (!ultimoDisparo.has(chave)) {
        const guardado = disparoGuardado(chave);
        if (guardado) ultimoDisparo.set(chave, guardado);
        else { ultimoDisparo.set(chave, n.config.modo === 'diario' ? 0 : agora); if (n.config.modo !== 'diario') continue; }
      }
      if (vence(n.config, agora, ultimoDisparo.get(chave))) { guardarDisparo(chave, agora); devidos.push(n.id); }
    }
    if (devidos.length) rodar(w.id, { motivo: 'relógio', gatilhos: devidos }).catch(() => {});
  }
}

// --- vigia de pastas ---------------------------------------------------------
// Gatilho "Arquivo novo na pasta": a cada 3 s olha as pastas dos workflows
// ligados. Arquivo que já estava lá quando começou a olhar não dispara; um
// arquivo novo dispara quando o tamanho para de mudar (terminou de copiar).
const vigias = new Map(); // "wf:no:pasta:padrao" → { conhecidos: Map(nome → tamanho), prontos: Set }
const casaPadrao = (padrao) => {
  const l = String(padrao || '').split(/[,;]/).map((p) => p.trim()).filter(Boolean);
  if (!l.length) return () => true;
  const rx = l.map((p) => new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i'));
  return (nome) => rx.some((r) => r.test(nome));
};
function olharPastas() {
  const ativos = new Set();
  for (const w of ler()) {
    if (!w.ativo) continue;
    for (const n of w.nos.filter((x) => x.tipo === 'pasta')) {
      const pasta = casa(n.config.pasta || '');
      const chave = `${w.id}:${n.id}:${pasta}:${n.config.padrao}`;
      ativos.add(chave);
      let itens;
      try { itens = fs.readdirSync(pasta, { withFileTypes: true }).filter((d) => d.isFile() && !d.name.startsWith('.') && !/\.(part|crdownload|tmp)$/i.test(d.name)); } catch { continue; }
      const casaNome = casaPadrao(n.config.padrao);
      const tam = (nome) => { try { return fs.statSync(path.join(pasta, nome)).size; } catch { return -1; } };
      let v = vigias.get(chave);
      if (!v) { v = { conhecidos: new Map(itens.map((d) => [d.name, -2])), vistos: new Map() }; vigias.set(chave, v); continue; }
      for (const d of itens) {
        if (v.conhecidos.has(d.name) || !casaNome(d.name)) continue;
        const t = tam(d.name);
        if (v.vistos.get(d.name) === t && t >= 0) {
          v.conhecidos.set(d.name, t); v.vistos.delete(d.name);
          rodar(w.id, { motivo: `arquivo novo: ${d.name}`, gatilhos: [n.id], arquivo: path.join(pasta, d.name) }).catch(() => {});
        } else v.vistos.set(d.name, t);
      }
      const nomes = new Set(itens.map((d) => d.name));
      for (const k of v.conhecidos.keys()) if (!nomes.has(k)) v.conhecidos.delete(k); // saiu: se voltar, é novo
    }
  }
  for (const k of vigias.keys()) if (!ativos.has(k)) vigias.delete(k);
}
let vigiaTimer = null;

function ligar({ conversa: c, avisar: a, enviarTela: t }) {
  conversa = c; avisar = a; enviarTela = t;
  clearInterval(relogio);
  relogio = setInterval(() => { try { tique(); } catch { /* arquivo estragado: tenta no próximo */ } }, 15000);
  clearInterval(vigiaTimer);
  vigiaTimer = setInterval(() => { try { olharPastas(); } catch { /* tenta no próximo */ } }, 3000);
}
function desligar() { clearInterval(relogio); relogio = null; clearInterval(vigiaTimer); vigiaTimer = null; }

const tipos = () => TIPOS;
const tiposCred = () => ({ tipos: TIPOS_CRED, camposBw: CAMPOS_BW });
const lista = () => ler().map((w) => ({ ...w, rodando: rodando.has(w.id) }));

module.exports = { ligar, desligar, lista, gravar, apagar, rodar, execucoes, todasExecucoes, tipos, vence, tique, olharPastas, casaPadrao, livre, TIPOS, ARQ,
  credenciais, gravarCredencial, apagarCredencial, testarCredencial, tiposCred };
