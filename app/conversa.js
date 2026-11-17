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
const codex = require('./conversa-codex');
const listaComandos = require('./comandos');
const jsonl = require('./jsonl');
const shell = require('./shell-usuario');
const permSempre = require('./permissao-sempre');
const voltarArquivos = require('./voltar-arquivos');
const permissoes = require('./permissoes');
const elicitacao = require('./elicitacao');
const capacidades = require('./capacidades');

const PASTA = os.homedir(); // as conversas trabalham a partir de ~
const TESTE = process.env.ORQ_APP_TESTE === '1';
const CACHE = path.join(os.homedir(), '.cache', 'orq-app');
// O modo de teste guarda as próprias conversas: abrir o app de verdade depois
// não pode retomar uma conversa de teste.
const ARQ_LISTA = path.join(CACHE, TESTE ? 'conversas-teste.json' : 'conversas.json');
const ARQ_SESSAO_ANTIGO = path.join(CACHE, TESTE ? 'sessao-teste' : 'sessao-orquestrador');
// O que o Claude instalado atende, por versão (capacidades.js). Só registra: o
// app não esconde nada com isto (decisão D16.1).
const registroCap = capacidades.criar({ arquivo: path.join(CACHE, TESTE ? 'capacidades-claude-teste.json' : 'capacidades-claude.json') });
// A sonda dos pedidos só de leitura, depois do 1º init de cada versão. Desligada
// no modo de teste do app (os testes de tela contam os pedidos que cada comando
// faz), a não ser com ORQ_SONDA_CAPACIDADES=1; ORQ_SONDA_CAPACIDADES=0 desliga sempre.
const sondaLigada = () => process.env.ORQ_SONDA_CAPACIDADES === '1' || (process.env.ORQ_SONDA_CAPACIDADES !== '0' && process.env.ORQ_APP_TESTE !== '1');
const sondando = new Set(); // versões com sonda em andamento (uma conversa sonda por vez)
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
// Quem abre uma página no navegador da pessoa (pedido de dado do MCP no modo página):
// main.js liga isto. Fora do app (testes de unidade) não abre nada.
let abrirPagina = () => {};
// Quem avisa o usuário (notificação do sistema) quando uma conversa precisa
// dele: main.js liga isto. tipo: 'pedido' (pergunta/permissão) ou 'resposta'.
let avisar = () => {};

// Modelos e esforços que o botão da barra oferece.
// opusplan é um apelido do próprio Claude Code (Opus no modo plano, Sonnet na execução).
const MODELOS = { opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5', fable: 'claude-fable-5-2', opusplan: 'opusplan' };
const ESFORCOS = ['low', 'medium', 'high', 'xhigh', 'max'];
// Modo de permissão com que o app sobe o Claude. Num reinício, vale o modo
// vivo da conversa (init ou system/status) quando ele é mais restritivo que o
// do app (a lista abaixo); qualquer outro, mais solto ou desconhecido, volta
// ao do app.
const MODO_APP = 'auto';
const MODOS_MAIS_RESTRITOS = ['plan', 'dontAsk', 'default', 'acceptEdits'];
const modoDeSubida = (vivo) => (MODOS_MAIS_RESTRITOS.includes(vivo) ? vivo : MODO_APP);
// Modos que o chip da barra oferece (o "manual" do Claude responde como default).
// Comando que só existe na tela do terminal. O Claude responde com uma mensagem
// sintética, em inglês ("/memory isn't available in this environment."), e a marca
// com local_command_outcome { kind: 'unavailable_headless' } (conferido no 2.1.326;
// o texto traz só o nome do comando, mesmo quando ele foi escrito com argumentos).
// CLI mais antigo, sem o campo: vale o texto, mas só em mensagem sintética, para a
// frase citada numa resposta do modelo nunca virar aviso.
const NAO_DISPONIVEL = /^\/(\S{1,80}) isn't available in this environment\.?$/;
function comandoIndisponivel(d, mandado) {
  const m = d && d.message;
  if (!m || d.parent_tool_use_id) return null;
  const marcado = !!(d.local_command_outcome && d.local_command_outcome.kind === 'unavailable_headless');
  if (!marcado && m.model !== '<synthetic>') return null;
  const texto = (Array.isArray(m.content) ? m.content : []).filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();
  const escrito = String(mandado || '').trim();
  const doTexto = texto.match(NAO_DISPONIVEL);
  // Marcado, mas com outro texto (o CLI mudou a frase): o nome vem do que foi mandado.
  const nome = doTexto ? doTexto[1] : (marcado && (escrito.match(/^\/(\S{1,80})/) || [])[1]) || null;
  if (!nome) return null;
  // O comando como a pessoa escreveu (com os argumentos), se foi ele o último mandado.
  const comando = escrito.split(/\s/)[0] === `/${nome}` ? escrito.slice(0, 2000) : `/${nome}`;
  return { nome, comando };
}

const MODOS_DO_CHIP = ['default', 'acceptEdits', 'auto', 'plan'];
// Bypass ("sem perguntas"): fora da lista de propósito. Só entra por
// definirModo, em conversa avulsa e com a opção das Configurações ligada.
const BYPASS = 'bypassPermissions';
const PERMITE_BYPASS = '--allow-dangerously-skip-permissions';
const bypassLigado = () => { try { return config.ler().mostrarBypass === true; } catch { return false; } };
// Esforços que o Claude aceita ao vivo, só para a sessão (apply_flag_settings
// { effortLevel }). Os outros ("Máximo" e o padrão) só valem ao subir (--effort).
// Nunca "/effort": no modo -p ele grava o nível como padrão no settings.json.
const ESFORCOS_AO_VIVO = ['low', 'medium', 'high', 'xhigh'];
const AVISO_REINICIO = 'Para trocar o esforço a conversa reinicia: o que estiver rodando em segundo plano (tarefas, Monitor, subagentes) é encerrado.';
// Reinício por outro motivo (/add-dir, /fast recusado ao vivo).
const AVISO_FUNDO = 'O que estiver rodando em segundo plano (tarefas, Monitor, subagentes) é encerrado.';
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

// Motores que o app sabe conduzir numa conversa.
const MOTORES = ['claude', 'codex'];
function motorDoOrquestrador() {
  const m = config.ler().iaOrquestrador;
  return MOTORES.includes(m) ? m : 'claude';
}
// O que o motor Codex precisa da conversa (conversa-codex.js).
const CTX_CODEX = {
  gravarLista: () => gravarLista(),
  avisar: (a) => avisar(a),
  avisarLista: () => avisarLista(),
  fimDeTurno: (c, r) => c.fimDeTurno(r),
};

// Onde o Claude guarda os transcripts: <CLAUDE_CONFIG_DIR ou ~/.claude>/projects.
const pastaProjetos = () => path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
const nomeDaPasta = (p) => p.replace(/[^A-Za-z0-9]/g, '-');
// O transcript de uma sessão, achado pelo id (<projects>/*/<id>.jsonl) e não
// montando o nome da pasta: o CLI corta nomes acima de 200 caracteres e
// acrescenta um hash, e o app não precisa saber a regra. Primeiro o caminho
// esperado para a pasta das conversas; senão procura em todas; havendo mais de
// uma cópia, vale a mais recente. Só ids de sessão (letras, números, - e _).
// A pasta de transcripts esperada para a pasta das conversas (o /resume lista dela).
const pastaDosTranscripts = () => path.join(pastaProjetos(), nomeDaPasta(PASTA));
const arquivosAchados = new Map(); // id → caminho (confere que ainda existe)
function arqTranscript(sessao) {
  if (!/^[\w-]+$/.test(String(sessao || ''))) return null;
  const raiz = pastaProjetos();
  const chave = raiz + '\n' + sessao;
  const lembrado = arquivosAchados.get(chave);
  if (lembrado && fs.existsSync(lembrado)) return lembrado;
  const esperado = path.join(raiz, nomeDaPasta(PASTA), sessao + '.jsonl');
  let achado = fs.existsSync(esperado) ? esperado : null;
  if (!achado) {
    let melhor = 0;
    let pastas = [];
    try { pastas = fs.readdirSync(raiz); } catch { /* sem projetos */ }
    for (const d of pastas) {
      const a = path.join(raiz, d, sessao + '.jsonl');
      try { const m = fs.statSync(a).mtimeMs; if (m >= melhor) { melhor = m; achado = a; } } catch { /* não está nesta pasta */ }
    }
  }
  if (achado) arquivosAchados.set(chave, achado);
  return achado;
}

// Histórico de uma sessão anterior, lido do transcript que o Claude grava.
// ate: uuid de uma linha; o histórico para nela (conversa que voltou).
// Lê de trás para frente, em páginas, só o que cabe nas últimas 600 mensagens:
// uma sessão de 120 MB abre sem ser lida inteira.
const MAX_HISTORICO = 600;
function historicoDoTranscript(sessao, ate = null) {
  const arq = arqTranscript(sessao);
  if (!arq) return [];
  let limite = null;
  if (ate) {
    limite = jsonl.fimDaLinhaCom(arq, `"uuid":"${ate}"`);
    // Sem a linha (não achou), vale o arquivo todo, como antes.
  }
  const lista = [];
  for (const { linha: l } of jsonl.linhasDeTras(arq, { ate: limite })) {
    let d;
    try { d = JSON.parse(l); } catch { continue; /* linha cortada */ }
    const ts = Date.parse(d.timestamp) || undefined;
    if ((d.type === 'user' || d.type === 'assistant') && d.message && !d.isMeta) {
      // Mensagem digitada que levou a saída de comandos "!": o balão volta só com o texto
      // da pessoa, e cada comando volta como o bloco que apareceu ao vivo (antes dele).
      const comShell = d.type === 'user' && typeof d.message.content === 'string' && d.message.content.startsWith('<bash-input>') ? shell.separar(d.message.content) : null;
      if (comShell && comShell.blocos.length) {
        if (comShell.resto.trim()) lista.push({ tipo: 'user', message: { ...d.message, content: comShell.resto }, antigo: true, ts });
        for (const b of [...comShell.blocos].reverse()) lista.push({ tipo: 'shell', estado: 'fim', comando: b.comando, saida: b.saida, erro: b.erro, antigo: true, ts });
      } else lista.push({ tipo: d.type, message: d.message, antigo: true, ts });
    } else if (d.type === 'system' && d.subtype === 'local_command' && typeof d.content === 'string' && !d.isSidechain) {
      // Comando local (/rename, /memory…): o Claude grava o comando e a saída como linhas
      // de sistema (forma do 2.1.326). Viram o mesmo que aparece ao vivo, montado abaixo.
      lista.push({ local: d.content, marca: d.commandOutcome, ts });
    } else continue;
    if (lista.length >= MAX_HISTORICO) break;
  }
  return comandosLocaisComoAoVivo(lista.reverse());
}
// As linhas de comando local do transcript, como os eventos que a tela recebe ao vivo:
// o comando vira o balão de comando (na forma <command-name>, que não ganha o lápis de
// voltar nem vale como texto digitado) e a saída vira a mensagem sintética do Claude,
// com a marca de "só existe no terminal" quando for o caso.
function comandosLocaisComoAoVivo(lista) {
  const eventos = [];
  let comando = ''; // o último comando local visto (para dizer qual a saída recusou)
  for (const e of lista) {
    if (e.local === undefined) {
      const c = e.tipo === 'user' && typeof e.message.content === 'string' ? e.message.content : '';
      const m = /<command-name>(\/[^<]*)<\/command-name>/.exec(c);
      if (m) comando = `${m[1]} ${(/<command-args>([^<]*)<\/command-args>/.exec(c) || [])[1] || ''}`.trim();
      eventos.push(e);
      continue;
    }
    const saida = /^<local-command-(?:stdout|stderr)>([\s\S]*?)<\/local-command-(?:stdout|stderr)>\s*$/.exec(e.local.trim());
    if (!saida) {
      const texto = e.local.trim();
      if (!texto.startsWith('/')) continue;
      const [nome, ...resto] = texto.split(/\s+/);
      // O mesmo comando já veio como mensagem <command-name> logo antes: não repete o balão.
      const anterior = eventos[eventos.length - 1];
      const jaVeio = anterior && anterior.tipo === 'user' && typeof anterior.message.content === 'string' && anterior.message.content.includes(`<command-name>${nome}</command-name>`);
      comando = texto;
      if (!jaVeio) eventos.push({ tipo: 'user', message: { role: 'user', content: `<command-name>${nome}</command-name>\n<command-args>${resto.join(' ')}</command-args>` }, antigo: true, ts: e.ts });
      continue;
    }
    const texto = saida[1].replace(/\x1b\[[0-9;]*m/g, '').trim();
    if (!texto) continue;
    const message = { role: 'assistant', model: '<synthetic>', content: [{ type: 'text', text: texto }] };
    const nd = comandoIndisponivel({ message, local_command_outcome: e.marca }, comando);
    eventos.push({ tipo: 'assistant', message, sub: null, antigo: true, ts: e.ts, ...(nd ? { naoDisponivel: nd.nome, comando: nd.comando } : {}) });
  }
  return eventos;
}

// --- voltar a conversa ------------------------------------------------------
// Mensagens do usuário que viram balão na tela (o mesmo filtro da tela: sem
// mensagem de bastidor, comando, aviso do sistema ou resultado de ferramenta),
// cada uma com o uuid da última linha do Claude antes dela.
const textoDoPrompt = (c) => (typeof c === 'string' ? c : Array.isArray(c) && !c.some((b) => b && b.type === 'tool_result')
  ? c.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n') : null);
const normal = (t) => String(t || '').replace(/\s+/g, ' ').trim();
// O que uma linha do transcript é para o "voltar": a resposta do Claude
// (marca o ponto de corte) ou uma mensagem do usuário que virou balão.
function itemDoTranscript(l) {
  if (!l) return null;
  let d;
  try { d = JSON.parse(l); } catch { return null; }
  if (d.isSidechain || !d.uuid) return null;
  if (d.type === 'assistant') return { assistant: d.uuid };
  if (d.type !== 'user' || d.isMeta || !d.message) return null;
  const t = textoDoPrompt(d.message.content);
  if (t == null) return null;
  const tt = t.trim();
  if (!tt || /^<(orq-|command-|local-command|system-reminder|task-notification)/.test(tt) || tt.startsWith('/')) return null;
  return { prompt: { uuid: d.uuid, texto: tt, antes: undefined } };
}
function promptsDoTranscript(linhas) {
  const lista = [];
  let antes = null;
  for (const l of linhas) {
    const it = itemDoTranscript(l);
    if (!it) continue;
    if (it.assistant) antes = it.assistant;
    else lista.push({ ...it.prompt, antes });
  }
  return lista;
}
// Onde cortar para tirar a mensagem escolhida (e tudo depois dela). ordemDoFim:
// 0 = a última mensagem do usuário, 1 = a penúltima… Confere o texto do balão
// com o do histórico; não batendo, procura a mais recente que bate, e se nenhuma
// bate recusa (cortar no lugar errado apagaria a parte certa da conversa).
// `deTras` entrega as linhas da mais nova à mais antiga e é lido só até o
// ponto de corte achado (um transcript de 120 MB não é lido inteiro).
function pontoDeVoltaDeTras(deTras, ordemDoFim, textoBalao, comUuid = false) {
  const alvo = normal(String(textoBalao || '').split('\n📎')[0]).slice(0, 80);
  const bate = (p) => !alvo || normal(p.texto).includes(alvo);
  const ordem = Number(ordemDoFim || 0);
  let n = 0;
  let primeiroQueBate = null; // a mais recente que bate (plano B)
  let escolhido = null;
  let semAntes = []; // mensagens vistas ainda sem a resposta que veio antes delas
  for (const l of deTras) {
    const it = itemDoTranscript(l);
    if (!it) continue;
    if (it.assistant) {
      for (const p of semAntes) p.antes = it.assistant;
      semAntes = [];
      if (escolhido && escolhido.antes !== undefined) break;
      continue;
    }
    const p = it.prompt;
    semAntes.push(p);
    if (!primeiroQueBate && bate(p)) primeiroQueBate = p;
    if (!escolhido) {
      if (n === ordem) escolhido = bate(p) ? p : primeiroQueBate;
      else if (n > ordem && bate(p)) escolhido = p;
    }
    n++;
    if (escolhido && escolhido.antes !== undefined) break;
  }
  if (!escolhido) escolhido = primeiroQueBate; // havia menos mensagens que a ordem pedida
  if (!escolhido) throw new Error('não achei essa mensagem no histórico do Claude');
  // comUuid: também o identificador da mensagem escolhida (é o que o "voltar arquivos" pede).
  return { ate: escolhido.antes === undefined ? null : escolhido.antes, texto: escolhido.texto, ...(comUuid ? { uuid: escolhido.uuid } : {}) };
}
function* deTrasDe(linhas) { for (let i = linhas.length - 1; i >= 0; i--) yield linhas[i]; }
function pontoDeVolta(linhas, ordemDoFim, textoBalao) {
  return pontoDeVoltaDeTras(deTrasDe(linhas), ordemDoFim, textoBalao);
}
// O mesmo, lendo o transcript do disco de trás para frente. `ate` (conversa já
// voltada): o transcript vale só até a linha com esse uuid.
function pontoDeVoltaDoArquivo(sessao, ordemDoFim, textoBalao, ate = null, comUuid = false) {
  const arq = arqTranscript(sessao);
  if (!arq) throw new Error('não achei essa mensagem no histórico do Claude');
  const limite = ate ? jsonl.fimDaLinhaCom(arq, `"uuid":"${ate}"`) : null;
  const deTras = (function* () { for (const { linha } of jsonl.linhasDeTras(arq, { ate: limite })) yield linha; })();
  return pontoDeVoltaDeTras(deTras, ordemDoFim, textoBalao, comUuid);
}

// Lista de comandos (/…) do autocompletar: fonte única em comandos.js. Antes
// do Claude subir (ele só manda a lista quando recebe a primeira mensagem),
// vale a lista de antes do init com as skills locais.
function comandosLocais() {
  return listaComandos.montar({ motor: 'claude', skills: listaComandos.skillsLocais() });
}

class Conversa {
  constructor({ id, titulo, sessao = null, orquestrador = false, modelo = null, esforco = null, anteriores = [], volta = null, motor = 'claude', sessoesMotor = {}, modo = null, rapido = null, pastasExtras = [], forkDe = null, rodada = false }) {
    // Motor: quem conduz a conversa por trás ('claude' ou 'codex'). A do
    // orquestrador segue a "IA do orquestrador" da configuração; trocar de
    // motor guarda a conversa do anterior em sessoesMotor e retoma a do novo.
    this.motor = MOTORES.includes(motor) ? motor : 'claude';
    this.sessoesMotor = sessoesMotor && typeof sessoesMotor === 'object' ? sessoesMotor : {};
    this.anteriores = anteriores; // sessões de rodadas já desligadas
    // Volta pendente: { de: sessão original, ate: uuid }. Vale até a 1ª
    // resposta da sessão nova; fechar o app antes disso refaz a volta.
    this.volta = volta && volta.de ? volta : null;
    this.modeloEscolhido = modelo; // null = o padrão do Claude
    this.esforco = esforco;
    // Modo de permissão vivo (o que o Claude disse no init ou no system/status).
    this.modo = typeof modo === 'string' && /^\w+$/.test(modo) ? modo : null;
    // Fila da caixa: o que o usuário manda com o motor trabalhando espera aqui e
    // vai quando o turno acaba. Cada item: { id, texto, imagens, exibir, ja }.
    // "ja" = enviar já (vai na frente). filaParada: o usuário parou o motor, e a
    // fila só volta a andar quando ele mandar algo.
    this.fila = [];
    this.filaParada = false;
    // "!" da caixa: o comando do usuário que está rodando e as saídas que ainda vão ao
    // modelo (junto com a próxima mensagem digitada). Só na memória.
    this.shellRodando = null;
    this.contextoShell = [];
    // Rodada aberta (só o orquestrador): abre com o comando da rodada, fecha no
    // fim dela. A barra mostra Iniciar OU Desligar conforme isto.
    this.rodada = orquestrador && rodada === true;
    this.pedidoModelo = null;  // set_model enviado e ainda sem resposta: { id, chave, ts }
    this.modeloDepois = undefined; // troca pedida enquanto outra esperava resposta
    this.pedidosEsforco = new Set(); // apply_flag_settings ainda sem resposta
    // Comandos do "/" que o app faz por pedido de controle: request_id → { ok, falha, timer }.
    this.controles = new Map();
    // Modo rápido (/fast): true/false escolhido aqui; null = o padrão do Claude.
    this.rapido = typeof rapido === 'boolean' ? rapido : null;
    // Pastas extras de trabalho (/add-dir), passadas em toda subida.
    this.pastasExtras = Array.isArray(pastasExtras) ? pastasExtras.filter((p) => typeof p === 'string' && path.isAbsolute(p)) : [];
    // Ramo (/branch, /fork): a 1ª subida abre esta sessão com --fork-session.
    this.forkDe = typeof forkDe === 'string' && forkDe ? forkDe : null;
    this.initInfo = null; // o último init (versão, MCP, ferramentas…), para o /status
    this.tarefas = new Map(); // task_id → { id, descricao, status, tipo } (o /tasks)
    // Registro de capacidades: o subtipo de cada pedido de controle enviado
    // (request_id → subtipo), a versão do processo vivo (do init) e o que foi
    // respondido antes de o init dizer a versão.
    this.pedidosEnviados = new Map();
    this.versaoViva = null;
    this.capPendentes = [];
    this.querSondar = false; // a sonda espera a conversa ficar parada (tentarSondar)
    this.id = id;
    this.titulo = titulo;
    this.sessao = sessao;
    this.orquestrador = orquestrador;
    this.proc = null;
    this.eventos = [];
    this.pendentes = new Map(); // request_id → control_request ainda sem resposta
    this.info = { motor: this.motor, modelo: this.motor === 'codex' ? null : modelo ? MODELOS[modelo] : modeloPadrao(), esforco: esforco || (this.motor === 'codex' ? null : esforcoPadrao()), pasta: PASTA, contexto: null, janela: null, uso5h: null, uso7d: null, modo: modoDeSubida(this.modo), rodada: this.rodada, rapido: this.rapido, fila: [], filaParada: false, shell: false, rotuloLongo: null, ocupado: false };
  }

  // O orquestrador segue a IA escolhida na configuração. Só troca parado:
  // a conversa do motor que sai fica guardada para quando ele voltar.
  acertarMotor() {
    if (!this.orquestrador || this.proc) return;
    const quer = motorDoOrquestrador();
    if (quer === this.motor) return;
    this.sessoesMotor[this.motor] = this.sessao;
    this.motor = quer;
    this.sessao = this.sessoesMotor[quer] || null;
    delete this.sessoesMotor[quer];
    this.volta = null;
    this.modeloEscolhido = quer === 'codex' ? null : this.modeloEscolhido;
    Object.assign(this.info, { motor: quer, modelo: quer === 'codex' ? null : this.modeloEscolhido ? MODELOS[this.modeloEscolhido] : modeloPadrao(), esforco: this.esforco || (quer === 'codex' ? null : esforcoPadrao()), contexto: null, janela: null, uso5h: null, uso7d: null, rotuloLongo: null });
    gravarLista();
  }

  enviar(canal, dado) { enviarTela(canal, { id: this.id, dado }); }
  registrar(ev) {
    if (!ev.ts && !ev.antigo) ev.ts = Date.now(); // horário ao lado de "Claude"
    this.eventos.push(ev);
    if (this.eventos.length > 4000) this.eventos = this.eventos.slice(-3000);
    this.enviar('conversa:evento', ev);
  }
  avisarInfo() { this.enviar('conversa:info', this.info); avisarLista(); }

  argumentos() {
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--include-partial-messages', '--permission-prompt-tool', 'stdio', '--permission-mode', modoDeSubida(this.modo)];
    if (this.modeloEscolhido) args.push('--model', MODELOS[this.modeloEscolhido]);
    if (this.esforco) args.push('--effort', this.esforco);
    // Modo rápido: no modo -p o Claude só libera com o fastMode nas flags.
    if (this.rapido !== null) args.push('--settings', JSON.stringify({ fastMode: this.rapido }));
    for (const p of this.pastasExtras) args.push('--add-dir', p);
    // Deixa o Bypass disponível como opção (não liga): só conversa avulsa, só com a opção das Configurações.
    if (!this.orquestrador && bypassLigado()) args.push(PERMITE_BYPASS);
    // Voltar: abre a sessão original cortada naquele ponto, numa sessão nova
    // (--fork-session); a original fica como estava.
    if (this.volta) args.push('--resume', this.volta.de, '--resume-session-at', this.volta.ate, '--fork-session');
    else if (this.sessao) args.push('--resume', this.sessao);
    else if (this.forkDe) args.push('--resume', this.forkDe, '--fork-session');
    return args;
  }

  // Tira a mensagem escolhida e tudo o que veio depois dela do contexto do
  // Claude. Devolve o texto dela, para a tela pôr na caixa e corrigir.
  voltar(ordemDoFim, textoBalao) {
    if (this.motor === 'codex') throw new Error('voltar a conversa ainda não funciona com o Codex');
    const de = this.volta ? this.volta.de : this.sessao;
    if (!de) throw new Error('esta conversa ainda não tem histórico para voltar');
    const p = pontoDeVoltaDoArquivo(de, ordemDoFim, textoBalao, this.volta ? this.volta.ate : null);
    if (this.proc) { this.proc.reiniciando = true; this.proc.stdin.end(); this.proc.kill(); this.proc = null; }
    this.pendentes.clear();
    this.info.ocupado = false;
    if (p.ate) this.volta = { de, ate: p.ate };
    else {
      // Era a primeira mensagem: a conversa recomeça do zero.
      this.volta = null;
      this.anteriores = [...(this.anteriores || []), de].slice(-20);
      this.sessao = null;
    }
    gravarLista();
    this.iniciar();
    return p.texto;
  }

  // --- voltar com os arquivos (plano 7.1) ---------------------------------------------
  // O ponto escolhido, com o identificador da mensagem (o que o Claude pede para voltar arquivos).
  pontoParaVoltar(ordemDoFim, textoBalao) {
    if (this.motor === 'codex') throw new Error('voltar a conversa ainda não funciona com o Codex');
    const de = this.volta ? this.volta.de : this.sessao;
    if (!de) throw new Error('esta conversa ainda não tem histórico para voltar');
    return { de, ...pontoDeVoltaDoArquivo(de, ordemDoFim, textoBalao, this.volta ? this.volta.ate : null, true) };
  }
  // Ensaio (nada muda): o que o Claude diz que voltaria nos arquivos.
  //   { pode: true, lista: [{ caminho, porFora }], mais, menos, bytes }
  //   { pode: false, motivo: 'desligado' | 'sem-ponto' | 'nada-mudou' | 'sem-resposta', erro? }
  async ensaioDeArquivos(sessao, uuid) {
    if (config.ler().pontosDeVolta === false) return { pode: false, motivo: 'desligado' };
    if (!uuid) return { pode: false, motivo: 'sem-ponto' };
    let r;
    try { r = voltarArquivos.conferirResposta(await this.controle('rewind_files', { user_message_id: uuid, dry_run: true }, 8000, 'volta')); } catch (e) { return { pode: false, motivo: 'sem-resposta', erro: String(e.message || e).slice(0, 300) }; }
    if (!r.pode) return { pode: false, motivo: 'sem-ponto', ...(r.erro ? { erro: r.erro } : {}) };
    if (!r.lista.length) return { pode: false, motivo: 'nada-mudou' };
    let escritas = new Map();
    try { escritas = voltarArquivos.ultimasEscritas(arqTranscript(sessao), uuid, PASTA); } catch { /* sem o histórico, só não marca "mexido por fora" */ }
    return { pode: true, lista: r.lista.map((f) => ({ caminho: f, porFora: voltarArquivos.mexido(f, escritas, PASTA) })), mais: r.mais, menos: r.menos, bytes: voltarArquivos.tamanho(r.lista, PASTA) };
  }
  async voltarEnsaio(ordemDoFim, textoBalao) {
    const p = this.pontoParaVoltar(ordemDoFim, textoBalao);
    return { texto: p.texto, arquivos: await this.ensaioDeArquivos(p.de, p.uuid) };
  }
  // Volta os arquivos e, com escopo 'tudo', também a conversa. Antes de pedir a volta ao
  // Claude, guarda os arquivos como estão agora numa pasta nova; sem conseguir guardar,
  // nada muda. A lista vem de um ensaio feito aqui, na hora (a tela não decide a lista).
  async voltarComArquivos(ordemDoFim, textoBalao, escopo) {
    if (!['tudo', 'arquivos'].includes(escopo)) throw new Error('escopo desconhecido');
    const p = this.pontoParaVoltar(ordemDoFim, textoBalao);
    const e = await this.ensaioDeArquivos(p.de, p.uuid);
    if (!e.pode) throw new Error(`não há arquivos para voltar neste ponto (${e.erro || e.motivo}); nada mudou`);
    const copia = voltarArquivos.copiar(e.lista.map((x) => x.caminho), PASTA, voltarArquivos.destinoNovo());
    if (!copia.ok) throw new Error(`não consegui guardar a cópia dos arquivos antes de voltar (${copia.erro}); nada mudou`);
    const onde = voltarArquivos.exibir(copia.pasta);
    let r;
    try { r = voltarArquivos.conferirResposta(await this.controle('rewind_files', { user_message_id: p.uuid }, 60000, 'volta')); } catch (err) {
      const texto = `O Claude não respondeu ao pedido de voltar os arquivos: não sei se eles mudaram. A cópia de como estavam antes ficou em ${onde}.`;
      this.registrar({ tipo: 'aviso', texto, pasta: copia.pasta });
      throw new Error(texto);
    }
    if (!r.pode) throw new Error(`o Claude não voltou os arquivos${r.erro ? ` (${r.erro})` : ''}. A cópia feita antes ficou em ${onde}.`);
    const n = r.lista.length || e.lista.length;
    const resumo = { n, mais: r.lista.length ? r.mais : e.mais, menos: r.lista.length ? r.menos : e.menos, copia: copia.pasta, copiaExibir: onde, bytes: copia.bytes };
    const texto = escopo === 'tudo' ? this.voltar(ordemDoFim, textoBalao) : p.texto;
    // Depois de a conversa recarregar (se voltou junto), para a linha ficar à vista.
    const trecho = String(p.texto || '').replace(/\s+/g, ' ').trim();
    this.registrar({ tipo: 'aviso', texto: `↩ ${n === 1 ? '1 arquivo voltou' : `${n} arquivos voltaram`} ao que ${n === 1 ? 'era' : 'eram'} antes de «${trecho.length > 60 ? `${trecho.slice(0, 60)}…` : trecho}» (+${resumo.mais} −${resumo.menos} linhas). A cópia de como ${n === 1 ? 'estava' : 'estavam'} ficou em ${onde}.`, pasta: copia.pasta });
    return { texto, arquivos: resumo };
  }

  iniciar({ primeiraMensagem } = {}) {
    if (this.proc) return;
    this.acertarMotor();
    if (this.motor === 'codex') {
      const retomando = !!this.sessao;
      this.eventos = []; // o histórico chega quando o Codex retoma a conversa
      this.enviar('conversa:tudo', this.estado());
      codex.iniciar(this, { comando: ias.comando('codex', config.ler().iasCaminhos), cwd: PASTA, env: ambienteLimpo(), ctx: CTX_CODEX });
      if (!retomando && primeiraMensagem) this.mandar(primeiraMensagem);
      return;
    }
    const args = this.argumentos();
    const retomando = !!(this.volta || this.sessao || this.forkDe);
    this.eventos = this.volta ? historicoDoTranscript(this.volta.de, this.volta.ate) : this.sessao ? historicoDoTranscript(this.sessao) : this.forkDe ? historicoDoTranscript(this.forkDe) : [];
    this.enviar('conversa:tudo', this.estado());

    // O caminho escolhido na engrenagem (IAs conectadas), se houver e for
    // executável; senão 'claude' do PATH.
    // Fora do terminal o Claude só guarda os pontos de volta dos arquivos (o "voltar arquivos"
    // do ✎) se nasce com esta variável (conferido no 2.1.326). Desligável nas Configurações.
    const env = ambienteLimpo();
    if (config.ler().pontosDeVolta !== false) env.CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING = '1';
    const proc = spawn(ias.comando('claude', config.ler().iasCaminhos), args, { cwd: PASTA, env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc = proc;
    proc.permiteBypass = args.includes(PERMITE_BYPASS);
    // Pedidos pendentes eram do processo anterior.
    this.pedidoModelo = null; this.modeloDepois = undefined; this.pedidosEsforco = new Set();
    this.recusarControles('o Claude reiniciou');
    // O que rodava em segundo plano era do processo anterior.
    this.info.fundo = 0;
    // A versão é a do processo novo: só vale depois do init dele.
    this.versaoViva = null; this.pedidosEnviados.clear(); this.capPendentes = [];
    let iniciou = false;
    proc.on('error', (e) => this.registrar({ tipo: 'erro', texto: `Não consegui abrir o Claude: ${e.message}` }));
    let erroTexto = '';
    proc.stderr.on('data', (d) => { erroTexto = (erroTexto + d).slice(-4000); });
    proc.on('exit', (codigo) => {
      if (this.proc === proc) { this.proc = null; this.recusarControles('o Claude saiu'); }
      let expirou = false;
      if (proc.reiniciando) return; // /restart ou voltar: já subiu outro
      if (proc.encerrando) return;  // rodada desligada: encerrar() já avisou
      // Sessão guardada que o Claude não acha mais: a próxima começa do zero.
      if (codigo && this.volta && !iniciou) {
        // A volta não abriu: desiste dela e continua na sessão original.
        this.volta = null; gravarLista();
        this.registrar({ tipo: 'erro', texto: 'Não consegui voltar a conversa; ela continua como estava.' });
      } else if (codigo && retomando && !iniciou && /No conversation found/i.test(erroTexto)) {
        // Só a sessão que o Claude não acha mais começa do zero. Outro erro
        // (rede, versão, permissão) mostra a mensagem e mantém a sessão.
        this.sessao = null; gravarLista();
        expirou = true;
      }
      this.info.ocupado = false;
      this.pendentes.clear();
      this.avisarInfo();
      this.registrar({ tipo: 'fim', texto: codigo ? `O Claude parou (código ${codigo}). ${erroTexto.trim().split('\n').slice(-3).join(' ')}` : 'A conversa foi pausada.' });
      if (expirou) this.registrar({ tipo: 'aviso', texto: 'Esta conversa expirou no Claude; a próxima mensagem começa uma conversa nova.' });
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
        // Tarefas em segundo plano (a lista vem em "tasks"): a faixa de atividade
        // só precisa de quantas são. A tela é avisada quando o número muda.
        if (d.subtype === 'background_tasks_changed') {
          const n = Array.isArray(d.tasks) ? d.tasks.length : 0;
          if ((this.info.fundo || 0) !== n) { this.info.fundo = n; this.avisarInfo(); }
        }
        if (d.subtype === 'commands_changed' && Array.isArray(d.commands)) {
          this.descComandos = new Map(d.commands.map((c) => [c.name, { descricao: c.description || '', dica: c.argumentHint || c.argument_hint || '' }]));
          this.juntarComandos();
        }
        if (d.subtype === 'init') {
          info.modelo = d.model; info.pasta = d.cwd;
          this.initInfo = { versao: d.claude_code_version || null, modelo: d.model, pasta: d.cwd, modo: d.permissionMode || null,
            mcp: Array.isArray(d.mcp_servers) ? d.mcp_servers : [], ferramentas: Array.isArray(d.tools) ? d.tools.length : null,
            estilo: d.output_style || null, chave: d.apiKeySource || null, sessao: d.session_id || null };
          if (this.forkDe && !this.volta) { this.forkDe = null; }
          // Quem manda no modelo é o Claude: se o init diz outro dos modelos
          // do botão (ex.: /model digitado), a escolha guardada acompanha.
          if (this.modeloEscolhido && MODELOS[this.modeloEscolhido] !== d.model) {
            const k = Object.keys(MODELOS).find((x) => MODELOS[x] === d.model);
            if (k) { this.modeloEscolhido = k; gravarLista(); }
          }
          if (d.permissionMode) this.guardarModo(d.permissionMode);
          this.versaoDoInit(d.claude_code_version);
          if (this.volta) this.sessaoDaVolta = d.session_id;
          else if (this.sessao !== d.session_id) {
            // Sessão nova no mesmo processo (ex.: /clear): a velha vai para
            // anteriores (o id é o do init; o new_conversation_id do
            // conversation_reset não é o da sessão).
            if (this.sessao) this.anteriores = [...(this.anteriores || []).filter((s) => s !== this.sessao), this.sessao].slice(-20);
            this.sessao = d.session_id; gravarLista();
          }
          this.avisarInfo();
        }
        if (d.subtype === 'status' && d.permissionMode) this.guardarModo(d.permissionMode);
        // Tarefas em segundo plano (o /tasks do app).
        if (d.subtype === 'task_started' && d.task_id) this.tarefas.set(d.task_id, { id: d.task_id, descricao: d.description || '', tipo: d.subagent_type || d.task_type || '', status: 'running', inicio: Date.now() });
        if ((d.subtype === 'task_notification' || d.subtype === 'task_updated') && d.task_id) {
          const t = this.tarefas.get(d.task_id) || { id: d.task_id, descricao: d.summary || '', tipo: '', inicio: Date.now() };
          if (d.status) t.status = d.status;
          if (d.summary) t.resumo = d.summary;
          this.tarefas.set(d.task_id, t);
          while (this.tarefas.size > 50) this.tarefas.delete(this.tarefas.keys().next().value);
        }
        if (d.subtype === 'session_title_changed' && typeof d.title === 'string' && d.title.trim() && !this.orquestrador) {
          // O nome da sessão (/rename) vira o título; o orquestrador mantém o dele.
          this.titulo = d.title.replace(/\s+/g, ' ').trim().slice(0, 200);
          gravarLista(); avisarLista();
        }
        return;
      case 'conversation_reset':
        // /clear (e afins): a conversa recomeça no mesmo processo. A tela
        // limpa e fica a divisória; a sessão nova chega pelo init.
        this.eventos = [];
        this.pendentes.clear();
        this.marcarRodada(false); // conversa limpa: o que a rodada tinha carregado não está mais no contexto
        this.registrar({ tipo: 'limpa' });
        this.enviar('conversa:tudo', this.estado());
        avisarLista();
        return;
      case 'control_response': {
        // Resposta do Claude a um pedido do app (set_model, apply_flag_settings).
        const r = d.response || {};
        this.anotarCapacidade(r);
        const ctl = this.controles.get(r.request_id);
        if (ctl) {
          this.controles.delete(r.request_id); clearTimeout(ctl.timer);
          if (r.subtype === 'success') ctl.ok(r.response || {}); else ctl.falha(new Error(r.error || 'o Claude recusou o pedido'));
          return;
        }
        if (this.pedidoModelo && r.request_id === this.pedidoModelo.id) this.modeloRespondido(r);
        if (this.pedidosEsforco.delete(r.request_id) && r.subtype !== 'success') this.esforcoPorReinicio();
        return;
      }
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
        const nd = comandoIndisponivel(d, this.ultimoMandado);
        this.registrar({ tipo: 'assistant', message: d.message, sub: d.parent_tool_use_id || null, ...(nd ? { naoDisponivel: nd.nome, comando: nd.comando } : {}) });
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
        // 1ª resposta depois de voltar: a sessão nova já está gravada.
        if (this.volta && this.sessaoDaVolta) {
          this.anteriores = [...(this.anteriores || []), this.volta.de].slice(-20);
          this.sessao = this.sessaoDaVolta;
          this.volta = null; this.sessaoDaVolta = null;
          gravarLista();
        }
        const mu = Object.values(d.modelUsage || {})[0];
        if (mu && mu.contextWindow) info.janela = mu.contextWindow;
        this.fimDeTurno({ erro: d.is_error, duracao: d.duration_ms, texto: d.is_error ? d.result : null });
        return;
      }
      case 'control_request':
        if (d.request && d.request.subtype === 'can_use_tool') {
          // motivo: por que o Claude pergunta (pode vir com códigos de cor do terminal: limpa).
          // sempre: a regra que ele sugere gravar, já conferida (permissao-sempre.js); a sugestão
          // crua fica só neste processo (propriedade que não viaja para a tela).
          const motivo = d.request.decision_reason ? String(d.request.decision_reason).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, 600) : null;
          const p = { id: d.request_id, ferramenta: d.request.tool_name, entrada: d.request.input, motivo: motivo || null, sempre: permSempre.resumo(d.request.permission_suggestions) };
          Object.defineProperty(p, 'sugestoes', { value: d.request.permission_suggestions, enumerable: false });
          this.pendentes.set(d.request_id, p);
          this.enviar('conversa:pedido', p);
          avisarLista();
          const q = (p.entrada && p.entrada.questions && p.entrada.questions[0]) || null;
          avisar({ tipo: 'pedido', id: this.id, titulo: this.titulo, orquestrador: this.orquestrador,
            texto: q ? `${q.header ? q.header + ': ' : ''}${q.question}` : `Quer usar ${p.ferramenta}${p.entrada && p.entrada.command ? `: ${p.entrada.command}` : ''}` });
        } else if (d.request && d.request.subtype === 'elicitation') {
          // Um servidor MCP pede um dado à pessoa (formulário ou página): vira cartão. O
          // pedido vai à tela já conferido e limitado (elicitacao.js); nada dele é confiável.
          const p = { id: d.request_id, tipo: 'elicitacao', ferramenta: 'MCP', entrada: {}, ...elicitacao.normalizar(d.request) };
          this.pendentes.set(d.request_id, p);
          this.enviar('conversa:pedido', p);
          avisarLista();
          avisar({ tipo: 'pedido', id: this.id, titulo: this.titulo, orquestrador: this.orquestrador, texto: `O servidor ${p.servidor} (MCP) pede um dado` });
        } else {
          // Pedido que o app não atende: sem resposta, o Claude esperaria para
          // sempre. Erro na hora, e uma linha na conversa dizendo o quê.
          const tipo = String((d.request && d.request.subtype) || 'sem tipo').slice(0, 60);
          this.escrever({ type: 'control_response', response: { subtype: 'error', request_id: d.request_id, error: `o App de Orquestração não atende o pedido ${tipo}` } });
          this.registrar({ tipo: 'aviso', texto: `Pedido não suportado: ${tipo} (o app recusou; a conversa segue sem ele)` });
        }
        return;
      case 'control_cancel_request':
        // O Claude desistiu de um pedido (ex.: o turno foi interrompido): o cartão fecha.
        if (this.pendentes.delete(d.request_id)) { this.enviar('conversa:cancelado', d.request_id); this.enviar('conversa:respondido', d.request_id); avisarLista(); }
        return;
      default:
    }
  }

  // Fim de turno (Claude ou Codex): a IA parou e espera o usuário (a tela
  // decide se avisa).
  fimDeTurno({ erro = false, duracao = null, texto = null } = {}) {
    this.info.ocupado = false;
    this.tentarSondar();
    // O turno acabou: pedido que ficou sem resposta não vale mais (o cartão fecha).
    if (this.pendentes.size) {
      for (const id of this.pendentes.keys()) this.enviar('conversa:respondido', id);
      this.pendentes.clear();
      avisarLista();
    }
    this.avisarInfo();
    this.registrar({ tipo: 'resultado', erro, duracao, texto: erro ? texto : null });
    if (!this.desligando && !this.bastidor) avisar({ tipo: 'resposta', id: this.id, titulo: this.titulo, orquestrador: this.orquestrador, texto: this.ultimoTexto || (erro ? 'Terminou com erro.' : 'Terminou.') });
    this.ultimoTexto = '';
    if (this.desligando) { this.desligando = false; this.encerrar(); return; }
    this.fimDeTurnoDepois();
  }
  fimDeTurnoDepois() {
    if (this.reiniciarDepois) { const porque = this.reiniciarDepois; this.reiniciarDepois = false; this.reiniciar(); if (porque) this.registrar({ tipo: 'aviso', texto: porque === 'esforco' ? AVISO_REINICIO : `A conversa reiniciou. ${AVISO_FUNDO}` }); }
    // O turno acabou: a próxima mensagem da fila da caixa vai (uma por turno).
    this.andarFila();
  }

  juntarComandos() {
    const desc = this.descComandos || new Map();
    const nomes = new Set([...(this.nomesComandos || []), ...desc.keys()]);
    this.comandos = listaComandos.montar({ motor: 'claude', anunciados: [...nomes], descricoes: desc });
    this.enviar('conversa:comandos', this.comandos);
  }

  escrever(o) {
    if (!this.proc) return false;
    if (o && o.type === 'control_request' && o.request_id && o.request) {
      this.pedidosEnviados.set(o.request_id, o.request.subtype);
      // Pedido que nunca teve resposta não segura memória.
      if (this.pedidosEnviados.size > 200) this.pedidosEnviados.delete(this.pedidosEnviados.keys().next().value);
    }
    this.proc.stdin.write(JSON.stringify(o) + '\n');
    return true;
  }

  // --- registro de capacidades (capacidades.js) ---
  // Resposta do Claude a um pedido do app: anota se o subtipo é atendido.
  anotarCapacidade(r) {
    const sub = this.pedidosEnviados.get(r.request_id);
    if (sub === undefined) return;
    this.pedidosEnviados.delete(r.request_id);
    const como = String(r.request_id).startsWith('sonda-') ? 'sonda' : 'uso';
    if (this.versaoViva) registroCap.anotar(this.versaoViva, sub, r, como);
    else if (this.capPendentes.length < 50) this.capPendentes.push([sub, r, como]);
  }
  // O init disse a versão: o que foi respondido antes dele vai para ela, e a
  // primeira vez de cada processo sonda em segundo plano o que falta saber.
  versaoDoInit(v) {
    if (typeof v !== 'string' || !v || v === this.versaoViva) return;
    this.versaoViva = v;
    registroCap.viu(v);
    for (const [sub, r, como] of this.capPendentes) registroCap.anotar(v, sub, r, como);
    this.capPendentes = [];
    if (sondaLigada()) { this.querSondar = true; this.tentarSondar(); }
  }
  // A sonda só roda com a conversa parada: nunca no meio de uma resposta (ela
  // não foi provada contra o Claude de verdade com um turno em andamento).
  // Quem chama: o init (se a conversa estiver parada) e o fim de cada turno.
  tentarSondar() {
    if (!this.querSondar || this.info.ocupado) return;
    this.querSondar = false;
    setImmediate(() => { this.sondar().catch(() => {}); });
  }
  // Pergunta, um por vez e com tempo limite, os subtipos só de leitura que a
  // versão ainda não tem no registro. Nunca um pedido que muda a conversa.
  async sondar(ms = 8000) {
    const v = this.versaoViva;
    if (!v || this.motor !== 'claude' || sondando.has(v)) return;
    sondando.add(v);
    try {
      await registroCap.carregado;
      for (const s of registroCap.faltam(v, capacidades.SONDAVEIS)) {
        if (this.versaoViva !== v || !this.proc) break;
        if (this.info.ocupado) { this.querSondar = true; break; } // o usuário mandou outra mensagem: continua no fim do turno
        try { await this.controle(s, {}, ms, 'sonda'); } catch { /* sem resposta ou "não atende": o registro já anotou o que deu */ }
      }
    } finally { sondando.delete(v); }
  }
  // O que se sabe do Claude desta conversa: { motor, versao, subtipos, sondaveis }.
  // subtipos[x] = { atende: true|false, como: 'uso'|'sonda', quando }; subtipo
  // ausente = ainda não se sabe.
  capacidades() {
    if (this.motor !== 'claude') return { motor: this.motor, versao: null, subtipos: {}, sondaveis: [] };
    const versao = this.versaoViva || (this.initInfo && this.initInfo.versao) || null;
    return { motor: 'claude', versao, subtipos: versao ? registroCap.daVersao(versao) : {}, sondaveis: [...capacidades.SONDAVEIS] };
  }

  // imagens: [{ tipo: 'image/png', dados: '<base64>' }] (coladas ou arrastadas).
  // exibir: o que aparece no balão quando é diferente do que vai ao Claude
  // (ex.: "@nota:x" no balão; o conteúdo da nota vai junto para o Claude).
  // doUsuario: a mensagem foi digitada na caixa (daCaixa e a fila dela). Só essa leva a
  // saída dos comandos "!" que a pessoa rodou; recado, workflow, pedido do app e comando
  // ("/x") nunca levam.
  mandar(texto, imagens = [], exibir = null, { doUsuario = false } = {}) {
    // Comando de desligar no orquestrador: quando ele terminar, a rodada acaba de vez.
    const desligar = config.ler().comandoDesligar;
    if (this.orquestrador && desligar && texto.trim().split(/\s/)[0] === desligar) this.desligando = true;
    // Comando que abre a rodada (pelo botão ou digitado): a rodada passa a estar aberta.
    const inicial = config.ler().comandoInicial;
    if (this.orquestrador && inicial && texto.trim().split(/\s/)[0] === inicial) this.marcarRodada(true);
    // Mensagem de workflow, de tópico aprovado/recusado ou recado de agente (por trás): a
    // resposta não vira notificação.
    this.bastidor = /^<orq-(workflow|topico|recado) /.test(texto);
    if (!this.proc) this.iniciar();
    // Conversa avulsa ganha o nome da primeira coisa escrita nela.
    // Comando ("/model", "/rename x") não é assunto: o título espera a próxima.
    if (!this.orquestrador && /^Conversa \d+$/.test(this.titulo) && !texto.trim().startsWith('/')) {
      this.titulo = texto.replace(/\s+/g, ' ').trim().slice(0, 40);
      gravarLista();
    }
    this.info.ocupado = true;
    this.avisarInfo();
    this.ultimoMandado = imagens.length ? '' : String(texto || ''); // para dizer qual comando o Claude recusou
    const content = imagens.length
      ? [...imagens.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.tipo, data: i.dados } })), ...(texto ? [{ type: 'text', text: texto }] : [])]
      : texto;
    const mostrado = exibir && !imagens.length ? exibir : content;
    this.registrar({ tipo: 'user', message: { role: 'user', content: mostrado }, local: true });
    if (this.motor === 'codex') return codex.mandar(this, texto, imagens);
    // O que a pessoa rodou com "!" desde a última mensagem vai na frente do texto, na
    // marcação que o Claude Code usa no terminal. O balão (acima) mostra só o que ela escreveu.
    const levaShell = doUsuario && this.contextoShell.length && typeof texto === 'string' && texto.trim() && !texto.trim().startsWith('/');
    const prefixo = levaShell ? `${this.contextoShell.splice(0).map(shell.paraOModelo).join('\n')}\n\n` : '';
    const paraOMotor = !prefixo ? content : typeof content === 'string' ? prefixo + content
      : content.map((b) => (b.type === 'text' ? { ...b, text: prefixo + b.text } : b));
    return this.escrever({ type: 'user', message: { role: 'user', content: paraOMotor } });
  }

  // --- "!" da caixa: comando do usuário ------------------------------------
  // O único caminho que roda comando digitado pela pessoa (main.js: conversa:shell,
  // que a tela só usa no Enter de verdade da caixa). Um por vez, na pasta da
  // conversa e com o ambiente das conversas (sem as credenciais do cofre).
  rodarShell(comando) {
    if (this.shellRodando) throw new Error('já há um comando seu rodando nesta conversa; espere ou pare o que está rodando');
    if (this.motor === 'codex') {
      // No Codex quem roda é ele (thread/shellCommand: na pasta da conversa, sem chamar o
      // modelo). O bloco "você rodou" vem das notificações dele (conversa-codex.js).
      shell.conferirComando(comando);
      const marca = { id: `cx${Date.now().toString(36)}`, parar: () => this.interromper() };
      this.shellRodando = marca;
      this.info.shell = true;
      this.avisarInfo();
      this.codex('thread/shellCommand', { command: comando, timeoutMs: shell.TEMPO }).catch((e) => {
        if (this.shellRodando !== marca) return;
        this.shellRodando = null;
        this.info.shell = false;
        this.avisarInfo();
        this.registrar({ tipo: 'erro', texto: `O Codex não rodou o comando: ${e.message}` });
      });
      return { id: marca.id };
    }
    const exec = shell.rodar(comando, { cwd: PASTA, env: ambienteLimpo() });
    const id = `sh${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const ev = { tipo: 'shell', id, comando, estado: 'rodando', pasta: PASTA };
    this.shellRodando = { id, parar: exec.parar };
    this.info.shell = true;
    this.registrar(ev);
    this.avisarInfo();
    exec.fim.then((r) => {
      this.shellRodando = null;
      this.info.shell = false;
      // O evento guardado passa a "fim" (quem redesenhar a conversa vê o resultado); a tela
      // que já mostrava o bloco recebe a atualização por um aviso que não entra na lista.
      Object.assign(ev, { estado: 'fim', saida: r.saida, erro: r.erro, codigo: r.codigo, cortado: r.cortado, tempoEsgotado: r.tempoEsgotado, parado: r.parado, ms: r.ms });
      this.contextoShell.push(r);
      if (this.contextoShell.length > 10) this.contextoShell.shift(); // muitos comandos sem mandar mensagem: ficam os últimos
      this.enviar('conversa:evento', { ...ev, tipo: 'shell-fim' });
      this.avisarInfo();
    });
    return { id };
  }
  pararShell() {
    if (!this.shellRodando) return false;
    this.shellRodando.parar();
    return true;
  }

  // --- fila da caixa de texto ----------------------------------------------
  // Só o que o usuário digita na caixa passa por aqui (o resto do app continua
  // usando mandar). Parado: vai na hora. Trabalhando: espera na fila.
  // agora (Ctrl+Enter, "enviar já"): no Claude o app interrompe o turno e a
  // mensagem vai assim que ele para, na frente da fila; nada é escrito no meio
  // do turno, então "ocupado" continua exato. No Codex vai por turn/steer.
  avisarFila() {
    this.info.fila = this.fila.map((m) => ({ id: m.id, texto: String(m.exibir || m.texto || '').slice(0, 2000), imagens: m.imagens.length, ja: m.ja === true }));
    this.info.filaParada = this.filaParada && this.fila.length > 0;
    this.avisarInfo();
  }
  porNaFila(texto, imagens, exibir, ja = false) {
    const m = { id: `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, texto, imagens: imagens || [], exibir: exibir || null, ja };
    if (ja) { const i = this.fila.findIndex((x) => !x.ja); if (i < 0) this.fila.push(m); else this.fila.splice(i, 0, m); } else this.fila.push(m);
    this.avisarFila();
    return m.id;
  }
  // A fila anda uma mensagem por turno. Parada pelo usuário, só anda o que ele marcou "enviar já".
  andarFila() {
    if (this.info.ocupado || !this.fila.length) return false;
    if (this.filaParada && !this.fila[0].ja) return false;
    const m = this.fila.shift();
    this.avisarFila();
    this.mandar(m.texto, m.imagens, m.exibir, { doUsuario: true });
    return true;
  }
  daCaixa(texto, imagens = [], exibir = null, { agora = false } = {}) {
    if (!this.info.ocupado) {
      if (!this.fila.length) { this.mandar(texto, imagens, exibir, { doUsuario: true }); return { enviada: true }; }
      // Havia fila parada: esta entra no fim e a fila volta a andar, na ordem.
      const id = this.porNaFila(texto, imagens, exibir);
      this.filaParada = false;
      this.andarFila();
      return { naFila: id };
    }
    if (agora && this.motor === 'codex') { this.mandar(texto, imagens, exibir, { doUsuario: true }); return { enviada: true }; }
    const id = this.porNaFila(texto, imagens, exibir, agora);
    if (agora) this.interromperParaEnviar();
    return { naFila: id };
  }
  tirarDaFila(id) {
    const i = this.fila.findIndex((m) => m.id === id);
    if (i < 0) return false;
    this.fila.splice(i, 1);
    this.avisarFila();
    return true;
  }
  enviarJaDaFila(id) {
    const i = this.fila.findIndex((m) => m.id === id);
    if (i < 0) return false;
    const [m] = this.fila.splice(i, 1);
    if (this.info.ocupado && this.motor === 'codex') { this.avisarFila(); this.mandar(m.texto, m.imagens, m.exibir, { doUsuario: true }); return true; }
    m.ja = true;
    const pos = this.fila.findIndex((x) => !x.ja);
    if (pos < 0) this.fila.push(m); else this.fila.splice(pos, 0, m);
    this.avisarFila();
    if (this.info.ocupado) this.interromperParaEnviar(); else this.andarFila();
    return true;
  }
  // Parada pedida pelo próprio app para entregar o "enviar já": não é o usuário mandando parar tudo.
  interromperParaEnviar() {
    if (this.filaParada) { this.filaParada = false; this.avisarFila(); }
    return this.interromper({ doUsuario: false });
  }

  // decisao: { permitir: bool, respostas?: {pergunta: resposta}, motivo?: string }
  responder(reqId, decisao) {
    const p = this.pendentes.get(reqId);
    if (!p) return false;
    this.pendentes.delete(reqId);
    const doCodex = this.motor === 'codex';
    // Pedido de dado de um servidor MCP (igual nos dois motores): aceitar (com os campos
    // conferidos, ou abrindo a página conferida), recusar ou cancelar. Quem responde sem dizer
    // a ação (o ajudante, com "permitir") nunca aceita. Preenchimento errado não vai: o pedido
    // continua aberto.
    if (p.tipo === 'elicitacao') {
      let resposta = { action: decisao.acao === 'cancel' ? 'cancel' : 'decline' };
      if (decisao.acao === 'accept' && p.ok) {
        if (p.modo === 'url') { abrirPagina(p.url); resposta = { action: 'accept' }; } else {
          const c = elicitacao.conferir(p.campos, decisao.conteudo);
          if (!c.ok) { this.pendentes.set(reqId, p); return { erro: c.erro, campo: c.campo }; }
          resposta = { action: 'accept', content: c.conteudo };
        }
      }
      if (doCodex) codex.responderCru(this, p, resposta);
      else this.escrever({ type: 'control_response', response: { subtype: 'success', request_id: reqId, response: resposta } });
      this.enviar('conversa:respondido', reqId);
      avisarLista();
      return true;
    }
    if (doCodex) {
      // "Sempre" (regra por prefixo, que o Codex grava no arquivo de regras dele): a versão de
      // agora do arquivo fica guardada antes; sem conseguir guardar, vale só desta vez.
      let d = decisao || {};
      let soDestaVez = false;
      if (d.permitir && d.sempre && p.codex && p.codex.prefixo) {
        const copia = permissoes.copiaAntesCodex(codex.arquivoDeRegras().arq);
        if (!copia.ok) { d = { ...d, sempre: false }; soDestaVez = true; this.registrar({ tipo: 'aviso', texto: `Permiti só desta vez: não consegui guardar a cópia do arquivo de regras do Codex antes de gravar (${copia.erro}).` }); }
      }
      codex.responder(this, p, d);
      this.enviar('conversa:respondido', reqId);
      avisarLista();
      return soDestaVez ? { ok: true, soDestaVez: true } : true;
    }
    // Pergunta (AskUserQuestion) responde como sempre respondeu. Permissão diz ao Claude qual
    // foi a decisão: desta vez, sempre (com a regra que ELE sugeriu, no alcance escolhido) ou
    // negada (com o que a pessoa pede em vez disso, se ela escreveu).
    const pergunta = p.ferramenta === 'AskUserQuestion';
    let soDestaVez = false;
    // Plano pronto (ExitPlanMode, entrada { plan } em Markdown): aprovar pode levar o plano
    // editado pela pessoa e o modo em que o Claude segue; "continuar planejando" é uma recusa
    // com o que ajustar. Só os dois modos do cartão passam.
    const plano = p.ferramenta === 'ExitPlanMode';
    let resposta;
    if (plano && decisao.permitir) {
      const editado = typeof decisao.plano === 'string' && decisao.plano.trim() ? decisao.plano.slice(0, 200000) : null;
      const modo = ['auto', 'default'].includes(decisao.modo) ? decisao.modo : null;
      resposta = { behavior: 'allow', updatedInput: editado ? { ...p.entrada, plan: editado } : p.entrada,
        ...(modo ? { updatedPermissions: [{ type: 'setMode', mode: modo, destination: 'session' }] } : {}), decisionClassification: 'user_temporary' };
    } else if (plano && decisao.continuarPlano) {
      const ajuste = typeof decisao.emVezDisso === 'string' ? decisao.emVezDisso.replace(/\s+/g, ' ').trim().slice(0, 2000) : '';
      resposta = { behavior: 'deny', message: `O usuário ainda não aprovou o plano e quer continuar planejando.${ajuste ? ` Ajuste pedido: ${ajuste}` : ''}`, decisionClassification: 'user_reject' };
    } else if (decisao.permitir) {
      let sempre = !pergunta && typeof decisao.sempre === 'string' ? permSempre.atualizacao(p.sugestoes, decisao.sempre) : null;
      if (sempre && decisao.sempre !== 'session') {
        // A regra vai para um arquivo: a versão de agora dele fica guardada antes.
        const copia = permissoes.copiaAntes(decisao.sempre, PASTA);
        if (!copia.ok) { sempre = null; this.registrar({ tipo: 'aviso', texto: `Permiti só desta vez: não consegui guardar a cópia do arquivo de permissões antes de gravar (${copia.erro}).` }); }
      }
      // Pediram "sempre" e a regra não foi: a tela precisa dizer "desta vez", não "sempre".
      soDestaVez = !pergunta && typeof decisao.sempre === 'string' && !sempre;
      resposta = { behavior: 'allow', updatedInput: decisao.respostas ? { ...p.entrada, answers: decisao.respostas } : p.entrada,
        ...(sempre ? { updatedPermissions: sempre } : {}), ...(pergunta ? {} : { decisionClassification: sempre ? 'user_permanent' : 'user_temporary' }) };
    } else {
      const emVez = typeof decisao.emVezDisso === 'string' ? decisao.emVezDisso.replace(/\s+/g, ' ').trim().slice(0, 2000) : '';
      resposta = { behavior: 'deny', message: decisao.motivo || `Negado pelo usuário no app.${emVez ? ` O que ele pede em vez disso: ${emVez}` : ''}`,
        ...(pergunta ? {} : { decisionClassification: 'user_reject' }) };
    }
    this.escrever({ type: 'control_response', response: { subtype: 'success', request_id: reqId, response: resposta } });
    this.enviar('conversa:respondido', reqId);
    avisarLista();
    return soDestaVez ? { ok: true, soDestaVez: true } : true;
  }

  // Troca modelo e/ou esforço SEM reiniciar o Claude (reiniciar mataria as
  // tarefas em segundo plano, o Monitor e os subagentes). Modelo: set_model ao
  // vivo, e a tela só muda quando o Claude confirma. Esforço: apply_flag_settings
  // { effortLevel }, que vale só para a sessão (sem balão, sem ocupado, sem
  // título). O que ele não aceita ("Máximo", o padrão, ou um Claude que recusa)
  // reinicia com --effort, avisando antes. Com o Claude parado, só guarda para
  // a próxima subida.
  configurar({ modelo, esforco }) {
    if (this.motor === 'codex') {
      // O Codex usa o modelo da configuração dele; o esforço vai a cada turno
      // (sem reiniciar).
      if (modelo) return false;
      if (esforco !== undefined) { if (esforco && !codex.ESFORCO[esforco]) return false; this.esforco = esforco || null; }
      this.info.esforco = this.esforco;
      gravarLista();
      this.avisarInfo();
      return true;
    }
    if (modelo !== undefined && modelo && !MODELOS[modelo]) return false;
    if (esforco !== undefined && esforco && !ESFORCOS.includes(esforco)) return false;
    if (modelo !== undefined) {
      if (this.proc) this.pedirModelo(modelo || null);
      else { this.modeloEscolhido = modelo || null; this.info.modelo = this.modeloEscolhido ? MODELOS[this.modeloEscolhido] : modeloPadrao(); }
    }
    if (esforco !== undefined) {
      this.esforco = esforco || null;
      this.info.esforco = this.esforco || esforcoPadrao();
      if (this.proc) { if (ESFORCOS_AO_VIVO.includes(this.esforco)) this.pedirEsforco(); else this.esforcoPorReinicio(); }
    }
    gravarLista();
    this.avisarInfo();
    return true;
  }

  // set_model ao vivo, um pedido por vez: o que for pedido enquanto um espera
  // resposta vai depois dele (vale o último). Pedido sem resposta em 10 s não
  // segura os próximos.
  pedirModelo(chave) {
    if (this.pedidoModelo && Date.now() - this.pedidoModelo.ts < 10000) { this.modeloDepois = chave; return; }
    const id = `modelo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    this.pedidoModelo = { id, chave, ts: Date.now() };
    this.modeloDepois = undefined;
    const request = { subtype: 'set_model' };
    if (chave) request.model = MODELOS[chave];
    this.escrever({ type: 'control_request', request_id: id, request });
  }
  modeloRespondido(r) {
    const { chave } = this.pedidoModelo;
    this.pedidoModelo = null;
    if (r.subtype === 'success') {
      this.modeloEscolhido = chave;
      this.info.modelo = (r.response && r.response.model) || (chave ? MODELOS[chave] : modeloPadrao()) || this.info.modelo;
      gravarLista();
      this.avisarInfo();
    } else {
      this.registrar({ tipo: 'erro', texto: `O Claude não trocou o modelo: ${r.error || 'sem detalhe'}` });
    }
    if (this.modeloDepois !== undefined) { const m = this.modeloDepois; this.modeloDepois = undefined; if (m !== this.modeloEscolhido) this.pedirModelo(m); }
  }

  // Esforço ao vivo, só da sessão: não grava nada no settings.json do usuário.
  pedirEsforco() {
    const id = `esforco-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    this.pedidosEsforco.add(id);
    this.escrever({ type: 'control_request', request_id: id, request: { subtype: 'apply_flag_settings', settings: { effortLevel: this.esforco } } });
  }
  // Caminho antigo (só da sessão): reinicia com --effort. O app não acompanha
  // as tarefas em segundo plano, então o aviso é genérico e vem sempre (o menu
  // já diz isso do "Máximo" antes do clique). No meio de um turno, avisa já e
  // reinicia quando ele acabar. O reinício redesenha a conversa; o aviso é
  // registrado de novo depois dele para continuar à vista.
  esforcoPorReinicio() {
    if (!this.proc) return;
    if (this.info.ocupado) { this.registrar({ tipo: 'aviso', texto: AVISO_REINICIO }); this.reiniciarDepois = 'esforco'; return; }
    this.reiniciar();
    this.registrar({ tipo: 'aviso', texto: AVISO_REINICIO });
  }

  // --- comandos do "/" que o app faz (comandos.js, renderer/comandos-tela.js) ---
  // Pedido de controle ao Claude, com a resposta como promessa. Sem o Claude
  // aberto, sobe ele antes (o pedido não precisa de mensagem). Sem resposta em
  // ms, desiste (o Claude antigo que não conhece o pedido responde erro; um
  // travado não segura a tela).
  controle(subtype, extra = {}, ms = 20000, prefixo = 'cmd') {
    if (this.motor === 'codex') return Promise.reject(new Error('pedido do Claude numa conversa Codex'));
    if (!this.proc) this.iniciar();
    return new Promise((ok, falha) => {
      const id = `${prefixo}-${subtype}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const timer = setTimeout(() => { if (this.controles.delete(id)) falha(new Error(`o Claude não respondeu ao ${subtype}`)); }, ms);
      this.controles.set(id, { ok, falha, timer });
      if (!this.escrever({ type: 'control_request', request_id: id, request: { subtype, ...extra } })) {
        this.controles.delete(id); clearTimeout(timer); falha(new Error('o Claude não está aberto'));
      }
    });
  }
  // "@" da caixa: os arquivos que o Claude sugere para o que foi digitado (o mesmo que o
  // terminal mostra; conferido no 2.1.326: { suggestions: [{ path }], cwd }, pasta termina
  // com a barra). Só com a conversa aberta e parada: autocompletar não sobe o Claude nem
  // fala com ele no meio de um turno. O que vem é conferido: só caminho de verdade, até 50.
  async sugerirArquivos(consulta) {
    if (this.motor === 'codex' || !this.proc || this.info.ocupado) return { arquivos: [] };
    let r;
    try { r = await this.controle('file_suggestions', { query: String(consulta || '').slice(0, 200) }, 1000, 'arq'); } catch { return { arquivos: [] }; }
    const lista = r && Array.isArray(r.suggestions) ? r.suggestions : [];
    const arquivos = lista.filter((s) => s && typeof s.path === 'string' && s.path && s.path.length <= 1000 && !/[\u0000-\u001f]/.test(s.path))
      .slice(0, 50).map((s) => ({ caminho: s.path }));
    return { arquivos, cwd: r && typeof r.cwd === 'string' ? r.cwd : null };
  }
  recusarControles(motivo) {
    for (const [id, c] of this.controles) { clearTimeout(c.timer); c.falha(new Error(motivo)); this.controles.delete(id); }
  }
  // Pedido ao app-server do Codex (os comandos do Codex que o app faz).
  async codex(metodo, params = {}) {
    if (this.motor !== 'codex') throw new Error('pedido do Codex numa conversa Claude');
    if (!this.proc) this.iniciar();
    const rpc = this.proc && this.proc.rpc;
    if (!rpc) throw new Error('o Codex não está aberto');
    if (!rpc.pronto) await new Promise((ok) => rpc.fila.push(ok));
    return rpc.pedir(metodo, { threadId: this.sessao, ...params });
  }

  // /fast: liga ou desliga o modo rápido só desta conversa. Ao vivo pelo
  // apply_flag_settings (o -p só libera o rápido com o fastMode nas flags); o
  // Claude recusando, reinicia com --settings, avisando antes. A escolha fica
  // guardada e vale em toda subida.
  async rapidoLigar(ligar) {
    this.rapido = !!ligar;
    this.info.rapido = this.rapido;
    this.avisarInfo();
    gravarLista();
    const frase = ligar ? 'Modo rápido ligado nesta conversa.' : 'Modo rápido desligado nesta conversa.';
    if (!this.proc) { this.registrar({ tipo: 'aviso', texto: `${frase} Vale a partir da próxima mensagem.` }); return { ok: true, aoVivo: false }; }
    try {
      await this.controle('apply_flag_settings', { settings: { fastMode: this.rapido } }, 10000);
      this.registrar({ tipo: 'aviso', texto: frase });
      return { ok: true, aoVivo: true };
    } catch (e) {
      // O reinício redesenha a conversa: o aviso vem depois dele para ficar à vista.
      if (this.info.ocupado) this.reiniciarDepois = 'rapido'; else this.reiniciar();
      this.registrar({ tipo: 'aviso', texto: `${frase} O Claude não trocou ao vivo (${e.message}): a conversa reinicia com a escolha. ${AVISO_FUNDO}` });
      return { ok: true, aoVivo: false };
    }
  }

  // /add-dir: a pasta passa a valer em toda subida (--add-dir). Reinicia,
  // avisando antes (o que roda em segundo plano é encerrado).
  pastaExtra(p) {
    const abs = path.resolve(String(p || '').replace(/^~(?=\/|$)/, os.homedir()));
    let st = null;
    try { st = fs.statSync(abs); } catch { /* não existe */ }
    if (!st || !st.isDirectory()) throw new Error(`a pasta não existe: ${abs}`);
    if (!this.pastasExtras.includes(abs)) this.pastasExtras.push(abs);
    gravarLista();
    const vivo = !!this.proc;
    // O reinício redesenha a conversa: o aviso vem depois dele para ficar à vista.
    if (vivo) { if (this.info.ocupado) this.reiniciarDepois = 'pasta'; else this.reiniciar(); }
    this.registrar({ tipo: 'aviso', texto: `Pasta adicionada: ${abs}. ${vivo ? `A conversa reinicia para o Claude passar a trabalhar nela. ${AVISO_FUNDO}` : 'Vale a partir da próxima mensagem.'}` });
    return abs;
  }

  // O que a tela precisa saber para os comandos do app.
  estadoComando() {
    return { motor: this.motor, sessao: this.sessao, titulo: this.titulo, orquestrador: this.orquestrador, init: this.initInfo,
      info: this.info, rapido: this.rapido, pastasExtras: this.pastasExtras, vivo: !!this.proc, tarefas: [...this.tarefas.values()] };
  }

  // /new, /clear e /archive no Codex: thread nova na mesma conversa do app; a
  // anterior vai para "anteriores" (continua no histórico do Codex).
  threadNova() {
    if (this.sessao) this.anteriores = [...(this.anteriores || []), this.sessao].slice(-20);
    this.sessao = null;
    gravarLista();
    if (this.proc) { this.proc.reiniciando = true; this.proc.stdin.end(); this.proc.kill(); this.proc = null; }
    this.pendentes.clear();
    this.info.ocupado = false;
    this.iniciar();
    this.registrar({ tipo: 'limpa' });
  }

  marcarRodada(aberta) {
    if (!this.orquestrador || this.rodada === !!aberta) return;
    this.rodada = !!aberta; this.info.rodada = this.rodada;
    gravarLista();
    this.avisarInfo();
  }

  guardarModo(m) {
    if (typeof m !== 'string' || !/^\w+$/.test(m)) return;
    // A tela (chip de modo) mostra o que o Claude confirmou.
    if (this.info.modo !== m) { this.info.modo = m; this.avisarInfo(); }
    if (m === this.modo) return;
    this.modo = m;
    gravarLista();
  }

  // Troca o modo de permissão ao vivo (chip da barra). O Claude confirma pelo
  // system/status, e é isso que a tela mostra.
  // Bypass: nunca no orquestrador, e só com a opção das Configurações ligada.
  // O Claude só aceita o modo se o processo subiu com a permissão (conferido
  // no 2.1.326); a conversa aberta sem ela sobe de novo, na mesma sessão, e
  // troca em seguida. Num reinício o modo volta ao do app (modoDeSubida).
  async definirModo(modo) {
    if (this.motor === 'codex') throw new Error('o modo de permissão é do Claude; no Codex ele vem da configuração do Codex');
    if (modo === BYPASS) {
      if (this.orquestrador) throw new Error('o modo sem perguntas nunca vale para o orquestrador');
      if (!bypassLigado()) throw new Error('o modo sem perguntas está desligado nas Configurações');
      if (!this.proc || !this.proc.permiteBypass) this.reiniciar();
    } else if (!MODOS_DO_CHIP.includes(modo)) throw new Error(`modo não oferecido: ${String(modo).slice(0, 40)}`);
    return this.controle('set_permission_mode', { mode: modo });
  }

  // Fim da rodada: o Claude sai, e o id da sessão deixa de ser o atual. Na
  // próxima abertura o orquestrador começa uma conversa nova (e a rodada, no
  // botão Iniciar) em vez de retomar esta. A conversa continua no histórico do Claude.
  encerrar() {
    this.rodada = false; this.info.rodada = false; // a rodada acabou com a sessão
    if (this.sessao) { this.anteriores = [...(this.anteriores || []), this.sessao].slice(-20); this.sessao = null; }
    if (this.proc) { this.proc.encerrando = true; this.proc.stdin.end(); this.proc.kill(); this.proc = null; }
    this.info.ocupado = false; this.info.contexto = null;
    this.pendentes.clear();
    gravarLista();
    this.avisarInfo();
    this.registrar({ tipo: 'encerrada' });
  }

  // /exit: fecha só esta conversa. O processo sai, a sessão vai para as
  // anteriores (dá para voltar a ela), a tela fica limpa e a próxima mensagem
  // começa uma sessão nova. O app e as outras conversas continuam.
  encerrarConversa() {
    const tinhaSessao = !!this.sessao;
    // O que esperava na fila não dispara numa sessão nova: fica à vista, parado.
    this.filaParada = this.fila.length > 0;
    this.eventos = [];
    this.encerrarSemAviso();
    this.avisarFila();
    this.enviar('conversa:tudo', this.estado());
    this.registrar({ tipo: 'encerrada', conversa: true, podeVoltar: tinhaSessao });
  }
  encerrarSemAviso() {
    this.rodada = false; this.info.rodada = false;
    if (this.sessao) { this.anteriores = [...(this.anteriores || []), this.sessao].slice(-20); this.sessao = null; }
    if (this.proc) { this.proc.encerrando = true; this.proc.stdin.end(); this.proc.kill(); this.proc = null; }
    this.info.ocupado = false; this.info.contexto = null; this.info.fundo = 0;
    this.pendentes.clear();
    this.volta = null;
    gravarLista();
  }
  // Desfaz o /exit: a última sessão guardada volta a ser a desta conversa (com o histórico dela).
  reabrirAnterior() {
    if (this.proc || this.sessao || !(this.anteriores || []).length) return false;
    this.sessao = this.anteriores.pop();
    gravarLista();
    this.iniciar();
    return true;
  }

  reiniciar() {
    if (this.proc) { this.proc.reiniciando = true; this.proc.stdin.end(); this.proc.kill(); this.proc = null; }
    this.pendentes.clear();
    this.iniciar();
  }

  // doUsuario (Parar, Esc): o que estava na fila não dispara sozinho depois da parada.
  interromper({ doUsuario = true } = {}) {
    if (doUsuario && this.fila.length && !this.filaParada) { this.filaParada = true; this.avisarFila(); }
    if (this.motor === 'codex') return codex.interromper(this);
    return this.escrever({ type: 'control_request', request_id: `int-${Date.now()}`, request: { subtype: 'interrupt' } });
  }

  parar() {
    this.pararShell(); // comando "!" do usuário não fica rodando depois que a conversa fecha
    if (this.proc) { this.proc.stdin.end(); this.proc.kill(); this.proc = null; }
  }

  estado() {
    const comandos = this.motor === 'codex' ? listaComandos.montar({ motor: 'codex', skills: codex.comandosDoCodex() }) : this.comandos || comandosLocais();
    return { id: this.id, comandos, eventos: this.eventos, pendentes: [...this.pendentes.values()], info: this.info, vivo: !!this.proc };
  }

  resumo() {
    return { id: this.id, titulo: this.titulo, orquestrador: this.orquestrador, motor: this.motor, ocupado: this.info.ocupado, pedidos: this.pendentes.size, vivo: !!this.proc };
  }
}

// --- lista guardada -----------------------------------------------------
function gravarLista() {
  fs.mkdirSync(CACHE, { recursive: true });
  const lista = [...conversas.values()].map((c) => ({ id: c.id, titulo: c.titulo, sessao: c.sessao, orquestrador: c.orquestrador, modelo: c.modeloEscolhido, esforco: c.esforco, anteriores: c.anteriores, volta: c.volta || undefined, motor: c.motor !== 'claude' ? c.motor : undefined, sessoesMotor: Object.keys(c.sessoesMotor || {}).length ? c.sessoesMotor : undefined, modo: c.modo && c.modo !== MODO_APP ? c.modo : undefined,
    rapido: c.rapido !== null ? c.rapido : undefined, pastasExtras: c.pastasExtras.length ? c.pastasExtras : undefined, forkDe: c.forkDe || undefined, rodada: c.rodada || undefined }));
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

// O usuário escreveu este trecho na conversa do orquestrador há pouco? Serve
// para o recado que ELE mandou enviar não pedir aprovação de novo. Só conta
// mensagem digitada por ele: recado de fora, workflow (<orq-…>) e comando (/…)
// não valem, então ninguém de fora consegue "autorizar" em nome dele.
// E só a ÚLTIMA mensagem que ele digitou (uma ordem antiga não vale para um
// envio novo). contato: { nome, caixa } — o trecho tem de citar o contato pelo
// nome ou pela caixa (um trecho genérico não autoriza mandar a qualquer um).
const normalizar = (t) => String(t || '').toLowerCase().normalize('NFC').replace(/[\s"'«»“”]+/g, ' ').trim();
const citaPalavra = (texto, palavra) => {
  const p = normalizar(palavra).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return !!p && new RegExp(`(?<![\\p{L}\\p{N}])${p}(?![\\p{L}\\p{N}])`, 'u').test(texto);
};
function usuarioEscreveu(trecho, { janelaMs = 60 * 60 * 1000, agora = Date.now(), contato = null } = {}) {
  const alvo = normalizar(trecho);
  if (alvo.length < 15) return false;
  // O contato pelo nome inteiro, pelo primeiro nome (o usuário escreve "Bruno"
  // para o contato "Bruno Lima") ou pela caixa.
  const primeiro = contato && String(contato.nome || '').trim().split(/\s+/)[0];
  if (contato && ![contato.nome, primeiro && primeiro.length >= 3 ? primeiro : null, contato.caixa].some((x) => x && citaPalavra(alvo, x))) return false;
  const o = [...conversas.values()].find((c) => c.orquestrador);
  if (!o) return false;
  let ultima = null; // a mais recente digitada por ele
  for (const e of o.eventos) {
    if (e.tipo !== 'user' || e.sub || !e.message) continue;
    const t = textoDoPrompt(e.message.content);
    if (t == null || /^\s*[</]/.test(t)) continue;
    if (!ultima || (e.ts || 0) >= ultima.ts) ultima = { ts: e.ts || 0, t };
  }
  if (!ultima || ultima.ts < agora - janelaMs) return false;
  return normalizar(ultima.t).includes(alvo);
}

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

// /branch e /fork: uma conversa nova do app com a conversa inteira copiada
// (Claude: --resume <sessão> --fork-session; Codex: thread/fork). A original
// fica como está. primeira: mensagem que vai logo para a conversa nova.
async function ramificar(id, primeira = '') {
  const c = pegar(id);
  const titulo = `${c.orquestrador ? 'Orquestrador' : c.titulo} (ramo)`.slice(0, 60);
  let nova;
  if (c.motor === 'codex') {
    if (!c.sessao) throw new Error('esta conversa ainda não começou: não há o que copiar');
    const r = await c.codex('thread/fork', {});
    const tid = (r && r.thread && r.thread.id) || (r && r.threadId);
    if (!tid) throw new Error('o Codex não devolveu a conversa nova');
    nova = new Conversa({ id: `c${Date.now().toString(36)}`, titulo, motor: 'codex', sessao: tid });
  } else {
    const de = c.sessao || (c.volta && c.volta.de);
    if (!de) throw new Error('esta conversa ainda não começou: não há o que copiar');
    nova = new Conversa({ id: `c${Date.now().toString(36)}`, titulo, forkDe: de, modelo: c.modeloEscolhido, esforco: c.esforco });
  }
  conversas.set(nova.id, nova);
  gravarLista();
  avisarLista();
  if (primeira && String(primeira).trim()) { nova.iniciar(); nova.mandar(String(primeira).trim()); }
  return nova.id;
}

// /resume: abre uma conversa antiga numa conversa nova do app. Se ela já está
// aberta numa conversa, volta essa.
function retomar(sessao, motor = 'claude', titulo = '') {
  if (!/^[\w-]{6,80}$/.test(String(sessao || ''))) throw new Error('sessão inválida');
  const ja = [...conversas.values()].find((c) => c.sessao === sessao);
  if (ja) return ja.id;
  const c = new Conversa({ id: `c${Date.now().toString(36)}`, titulo: String(titulo || 'Conversa retomada').replace(/\s+/g, ' ').trim().slice(0, 40), sessao, motor: MOTORES.includes(motor) ? motor : 'claude' });
  conversas.set(c.id, c);
  gravarLista();
  avisarLista();
  return c.id;
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
  usuarioEscreveu, _pegar: (id) => pegar(id),
  // { lote: true }: os envios de cada conversa se juntam num `conversa:lote` a cada 50 ms (envios.js).
  ligar: (fn, opc) => { enviarTela = opc && opc.lote ? require('./envios').criarLote({ enviar: fn }).enviar : fn; },
  ligarAvisos: (fn) => { avisar = fn; },
  ligarAbrirPagina: (fn) => { abrirPagina = typeof fn === 'function' ? fn : () => {}; },
  _Conversa: Conversa, // só para os testes de unidade
  _NAO_DISPONIVEL: NAO_DISPONIVEL, // idem: a frase que o contrato com o CLI também confere
  lista, abrir, nova, garantir, fechar, pararTodas, encerrarTodas, ambienteLimpo, _pontoDeVolta: pontoDeVolta, _pontoDeVoltaArquivo: pontoDeVoltaDoArquivo, _arqTranscript: arqTranscript, _historico: historicoDoTranscript,
  mandar: (id, t, imagens, exibir) => pegar(id).mandar(t, imagens, exibir),
  sugerirArquivos: (id, consulta) => pegar(id).sugerirArquivos(consulta),
  rodarShell: (id, comando) => pegar(id).rodarShell(comando),
  pararShell: (id) => pegar(id).pararShell(),
  responder: (id, reqId, d) => pegar(id).responder(reqId, d),
  pedidos: (id) => [...pegar(id).pendentes.values()],
  interromper: (id) => pegar(id).interromper(),
  voltar: (id, ordemDoFim, texto) => pegar(id).voltar(ordemDoFim, texto),
  voltarEnsaio: (id, ordemDoFim, texto) => pegar(id).voltarEnsaio(ordemDoFim, texto),
  voltarComArquivos: (id, ordemDoFim, texto, escopo) => pegar(id).voltarComArquivos(ordemDoFim, texto, escopo),
  configurar: (id, o) => pegar(id).configurar(o || {}),
  definirModo: (id, modo) => pegar(id).definirModo(modo),
  MODOS_DO_CHIP,
  reiniciar: (id) => { const c = pegar(id); if (c.proc) c.reiniciar(); else c.iniciar(); return true; },
  // Comandos do "/" feitos pelo app.
  controle: (id, subtype, extra, ms) => pegar(id).controle(subtype, extra, ms),
  // O que o Claude desta conversa atende (registro por versão do CLI).
  capacidades: (id) => pegar(id).capacidades(),
  _registroCapacidades: registroCap, // só para os testes
  codexPedir: (id, metodo, params) => pegar(id).codex(metodo, params),
  daCaixa: (id, texto, imagens, exibir, opcoes) => pegar(id).daCaixa(texto, imagens, exibir, opcoes),
  encerrarConversa: (id) => { pegar(id).encerrarConversa(); return true; },
  reabrirAnterior: (id) => pegar(id).reabrirAnterior(),
  tirarDaFila: (id, idFila) => pegar(id).tirarDaFila(idFila),
  enviarJaDaFila: (id, idFila) => pegar(id).enviarJaDaFila(idFila),
  estadoComando: (id) => pegar(id).estadoComando(),
  rapido: (id, ligar) => pegar(id).rapidoLigar(ligar),
  pastaExtra: (id, p) => pegar(id).pastaExtra(p),
  threadNova: (id) => { pegar(id).threadNova(); return true; },
  // /stop: o processo sai (a linha "A conversa foi pausada." vem da saída dele);
  // sem processo, só o aviso. A próxima mensagem retoma do mesmo ponto.
  pausar: (id) => { const c = pegar(id); if (c.proc) c.parar(); else c.registrar({ tipo: 'aviso', texto: 'Conversa pausada. A próxima mensagem retoma do mesmo ponto.' }); return true; },
  ramificar, retomar, arqTranscript, pastaDosTranscripts, PASTA,
};
