// Coletor — monta o retrato das frentes a partir do que já existe na máquina:
// as pastas de projeto (config.js), painéis do tmux, git, e os eventos que o
// hook orq-evento grava em <projeto>/.orq/. Só lê; a única escrita é o arquivo
// de resposta de permissão e o sinal de vida (.orq/app-vivo).
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const config = require('./config');
const pastaProjeto = require('./pasta-projeto');

// Mesma interface do Claude que o `orq` usa para reconhecer um agente na tela.
const TELA_CLAUDE = /│ >|esc to interrupt|Try "|╭─+╮|⏵⏵|⏸|bypass|auto mode/;
// A interface do Codex CLI: caixa com "›", "Working (12s • esc to interrupt)",
// rodapé "<modelo> <esforço> · <pasta>" e a tela de abertura.
const TELA_CODEX = /OpenAI Codex \(v|Working \(\d|Ask Codex to do anything|^\s*› /m;
// Qual CLI está no painel. O Claude usa "❯" e "⏵⏵"; o Codex, "›".
function motorDaTela(fim) {
  return TELA_CODEX.test(fim) && !/⏵⏵|❯/.test(fim) ? 'codex' : 'claude';
}
// Modelo do Codex pelo rodapé ("GPT-6-Luna default · /pasta").
function modeloDoCodex(fim) {
  const m = /^\s*((?:gpt|GPT|o\d|codex)[\w.-]*)(?:\s+(?:default|minimal|low|medium|high|xhigh))?\s+·/m.exec(fim);
  return m ? m[1].replace(/^gpt/, 'GPT') : null;
}

// Nada aqui bloqueia o processo principal: cada comando externo (tmux, git,
// docker) roda com execFile assíncrono, no máximo MAX_EM_PARALELO ao mesmo tempo.
const MAX_EM_PARALELO = 4;
let rodando = 0;
const fila = [];
let execPadrao = (cmd, args) => new Promise((ok) => {
  execFile(cmd, args, { encoding: 'utf8', timeout: 4000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }, (erro, saida) => ok(erro ? '' : saida));
});
let executor = execPadrao;
function rodar(cmd, args) {
  return new Promise((ok) => {
    const lancar = () => {
      rodando++;
      Promise.resolve().then(() => executor(cmd, args)).catch(() => '').then((saida) => {
        rodando--;
        ok(typeof saida === 'string' ? saida : '');
        const prox = fila.shift();
        if (prox) prox();
      });
    };
    if (rodando < MAX_EM_PARALELO) lancar(); else fila.push(lancar);
  });
}

function pastas(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
}

// Projetos: <raiz>/<projeto>, ou <raiz>/<grupo>/<projeto> com niveis 2.
// emp é o grupo ('' com um nível só).
function projetos(cfg = config.ler()) {
  const fora = new RegExp(cfg.ignorar);
  const raiz = cfg.raizProjetos;
  const lista = [];
  const grupos = cfg.niveis === 2 ? pastas(raiz).filter((g) => !fora.test(g)).sort() : [''];
  for (const emp of grupos) {
    for (const proj of pastas(path.join(raiz, emp)).filter((p) => cfg.niveis === 2 || !fora.test(p)).sort()) {
      lista.push({ emp, proj, dir: path.join(raiz, emp, proj), alvo: emp ? `${emp}/${proj}` : proj });
    }
  }
  return lista;
}

async function paineis() {
  const saida = await rodar('tmux', ['list-panes', '-a', '-F', '#{pane_id}\t#{pane_current_path}\t#{pane_title}\t#{session_name}']);
  return saida.split('\n').filter(Boolean).map((l) => {
    const [pane, dir, titulo, sessao] = l.split('\t');
    return { pane, dir, titulo, sessao };
  });
}

async function tela(pane, linhas = 8) {
  const t = await rodar('tmux', ['capture-pane', '-p', '-t', pane]);
  return t.split('\n').filter((l) => l.trim()).slice(-linhas).join('\n');
}

// Estado pela tela — o mesmo critério do `estado_pane` do orq. Só vale quando
// o projeto ainda não tem o hook instalado.
// Três sinais de trabalho: o "esc to interrupt"; a linha do contador em
// andamento ("✶ Pensando… (12s · …)", reticências + contador entre
// parênteses; a de quem terminou fica no passado: "Cooked for 2m"); e
// movimento recente na parte de cima da tela (texto saindo, contador andando),
// ignorando a caixa de digitar e o rodapé, que ficam embaixo.
const CONTADOR = /…\s*\(\s*\d+\s*[smh]/;
function estadoPelaTela(fim, mexeuAgora = false) {
  if (/do you want|would you like to|[❯›] 1\.|\(y\/n\)|Allow|permitir/i.test(fim)) return 'permissao';
  if (/esc to interrupt/.test(fim) || CONTADOR.test(fim) || mexeuAgora) return 'trabalhando';
  if (/⏵⏵|shift\+tab|❯|^\s*› |Ask Codex to do anything/m.test(fim)) return 'esperando';
  return 'desconhecido';
}

// É um agente? Pela tela do Claude (TELA_CLAUDE). Enquanto o orquestrador
// digita uma demanda longa na caixa do agente, o fim da tela vira só o texto
// da demanda e nenhuma marca aparece: o painel que já foi reconhecido segura
// o lugar por até 2 min, para o cartão não sumir e voltar. Prompt de shell no
// fim (o Claude fechou) solta na hora.
const SEGURA_AGENTE = 2 * 60 * 1000;
const vistosComoAgente = new Map(); // pane → última vez que a tela era do Claude
function ehAgente(pane, fim, agora = Date.now()) {
  if (TELA_CLAUDE.test(fim) || TELA_CODEX.test(fim)) { vistosComoAgente.set(pane, agora); return true; }
  const ultima = String(fim).split('\n').filter((l) => l.trim()).pop() || '';
  if (/[$#]\s*$/.test(ultima)) { vistosComoAgente.delete(pane); return false; }
  const visto = vistosComoAgente.get(pane);
  return visto != null && agora - visto < SEGURA_AGENTE;
}

// Movimento: guarda um resumo da parte de cima de cada tela e quando ela
// mudou pela última vez. Conta como "mexeu agora" até 8 s depois.
const JANELA_MOVIMENTO = 8000;
const movimento = new Map(); // pane → { resumo, em }
function mexeu(pane, telaInteira, agora = Date.now()) {
  const linhas = telaInteira.split('\n').filter((l) => l.trim());
  const corpo = linhas.slice(0, Math.max(0, linhas.length - 5)).slice(-40).join('\n');
  const antes = movimento.get(pane);
  if (!antes) { movimento.set(pane, { resumo: corpo, em: 0 }); return false; }
  if (antes.resumo !== corpo) { antes.resumo = corpo; antes.em = agora; }
  return agora - antes.em < JANELA_MOVIMENTO;
}

// Status publicado pelo próprio agente (.orq/bin/orq-status → .orq/status.json).
// Vale por 12 h; depois disso é velho demais para dizer algo sobre o agora.
const VALIDADE_STATUS = 12 * 60 * 60 * 1000;
function lerStatus(dirProj, agora = Date.now()) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(dirProj, '.orq', 'status.json'), 'utf8'));
    if (!s || typeof s.ts !== 'number' || agora - s.ts > VALIDADE_STATUS) return null;
    return { texto: String(s.texto || ''), estado: s.estado, progresso: s.progresso || null, ts: s.ts };
  } catch { return null; }
}
// O estado que o agente declarou, traduzido para os estados do app.
// Recente (até 30 min) ele vale mais que a leitura da tela.
const ESTADO_DO_STATUS = { trabalhando: 'trabalhando', travado: 'permissao', revisao: 'esperando', pronto: 'esperando' };
function estadoComStatus(estadoTela, status, agora = Date.now()) {
  if (!status || agora - status.ts > 30 * 60 * 1000) return estadoTela;
  if (status.estado === 'trabalhando' && estadoTela === 'permissao') return estadoTela; // pergunta na tela vence
  return ESTADO_DO_STATUS[status.estado] || estadoTela;
}

// As últimas `limite` linhas do arquivo, lendo só o fim (o arquivo de eventos
// cresce a cada ferramenta que o agente usa). Mesmo resultado de ler tudo:
// se o pedaço lido não tem linhas de sobra, lê um pedaço maior.
function ultimasLinhas(arq, limite) {
  const fd = fs.openSync(arq, 'r');
  try {
    const { size } = fs.fstatSync(fd);
    let tam = 64 * 1024;
    for (;;) {
      const ler = Math.min(size, tam);
      const buf = Buffer.alloc(ler);
      fs.readSync(fd, buf, 0, ler, size - ler);
      let texto = buf.toString('utf8');
      if (ler < size) { // a primeira linha do pedaço pode estar cortada: descarta
        const i = texto.indexOf('\n');
        texto = i < 0 ? '' : texto.slice(i + 1);
      }
      const linhas = texto.trim().split('\n');
      if (ler >= size || linhas.length > limite) return linhas.slice(-limite);
      tam *= 4;
    }
  } finally { fs.closeSync(fd); }
}

function lerEventos(dirProj, limite = 60) {
  const pasta = path.join(dirProj, '.orq', 'eventos');
  let arquivos;
  try {
    arquivos = fs.readdirSync(pasta).filter((f) => f.endsWith('.jsonl'))
      .map((f) => ({ f, m: fs.statSync(path.join(pasta, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
  } catch {
    return null;
  }
  if (!arquivos.length) return null;
  const linhas = ultimasLinhas(path.join(pasta, arquivos[0].f), limite);
  const eventos = [];
  for (const l of linhas) {
    try { eventos.push(JSON.parse(l)); } catch { /* linha cortada no meio da escrita */ }
  }
  return eventos;
}

function estadoPeloSinal(ev) {
  switch (ev.evento) {
    case 'UserPromptSubmit': case 'PostToolUse': case 'SubagentStart': case 'SubagentStop':
      return 'trabalhando';
    case 'PermissionRequest':
      return 'permissao';
    case 'Notification':
      return ev.notification_type === 'permission_prompt' ? 'permissao' : 'esperando';
    case 'Stop': case 'SessionStart':
      return 'esperando';
    case 'SessionEnd':
      return 'encerrado';
    default:
      return 'desconhecido';
  }
}

// O Claude escreve "✳ <nome>" no título do painel (o mesmo que o orq usa).
// Sem --name o título é só "Claude Code": aí vale o nome do projeto.
// Título com lixo de código de controle (ex.: "Gi=31,s=1,v=1,a=q,…;AAAA", a
// pergunta de imagem do protocolo kitty que vaza para o título) não é nome.
function nomeDoAgente(titulo, proj, numero) {
  const nome = titulo.replace(/^[^\p{L}\p{N}]+\s*/u, '').trim();
  const m = nome.match(/^Agente\s+\d+(\s*\([^)]*\))?/);
  if (m) return m[0];
  if (numero) return `Agente ${numero}`;
  return !nome || nome === 'Claude Code' || /[=;]/.test(nome) ? proj : nome;
}

// O que cada agente está fazendo: a última linha do topicos.md que casa com
// config.linhaTarefa (grupos numero, alvo, tarefa). Relido só quando muda.
let cacheTarefas = { m: 0, re: '', porProj: {} };
function tarefas(cfg) {
  if (!cfg.pastaNotas || !cfg.linhaTarefa) return {};
  const arq = path.join(cfg.pastaNotas, 'topicos.md');
  let m;
  try { m = fs.statSync(arq).mtimeMs; } catch { return {}; }
  if (m !== cacheTarefas.m || cfg.linhaTarefa !== cacheTarefas.re) {
    const porProj = {};
    const re = new RegExp(cfg.linhaTarefa, 'gm');
    for (const x of fs.readFileSync(arq, 'utf8').matchAll(re)) {
      const g = x.groups || {};
      if (g.alvo) porProj[g.alvo] = { numero: Number(g.numero) || null, tarefa: (g.tarefa || '').trim() };
    }
    cacheTarefas = { m, re: cfg.linhaTarefa, porProj };
  }
  return cacheTarefas.porProj;
}

// Modelo que cada agente está usando: o último "model" do transcript da
// sessão mais recente, lido de dentro do devcontainer do projeto (a pasta
// ~/.claude dos containers é um volume do Docker, fora do alcance do host).
// Não dá para trocar pelo "model" do SessionStart: ele guarda o modelo do
// INÍCIO da sessão, e um /model no meio muda o que o transcript diz.
// Relido a cada 30 s, sem travar: quem pede enquanto o cache está velho recebe
// o último valor e a releitura (uma só, os `docker exec` em paralelo, no limite
// de 4) acontece por trás. Só a primeira vez espera.
let cacheModelos = { em: 0, porDir: {} };
let lendoModelos = null;
async function lerModelos(cfg) {
  const porDir = {};
  const saida = await rodar('docker', ['ps', '--format', `{{.Names}}\t{{.Label "${cfg.rotuloContainer}"}}`]);
  const itens = [];
  for (const l of saida.split('\n')) {
    const [nome, dir] = l.split('\t');
    if (!nome || !dir || !dir.startsWith(cfg.raizProjetos)) continue;
    itens.push({ nome, dir });
  }
  await Promise.all(itens.map(async ({ nome, dir }) => {
    const pasta = cfg.pastaTranscript.replace('{projeto}', path.basename(dir));
    const m = await rodar('docker', ['exec', nome, 'sh', '-c',
      `f=$(ls -t "$HOME/.claude/projects/${pasta}"/*.jsonl 2>/dev/null | head -1); [ -n "$f" ] && tail -c 300000 "$f" | grep -o '"model":"claude-[a-z0-9-]*"' | tail -1`]);
    const x = m.match(/claude-([a-z]+)-(\d+)-(\d+)/);
    if (x) porDir[dir] = `${x[1][0].toUpperCase()}${x[1].slice(1)} ${x[2]}.${x[3]}`;
  }));
  cacheModelos = { em: Date.now(), porDir };
  return porDir;
}
function modelos(cfg) {
  const velho = Date.now() - cacheModelos.em >= 30000;
  if (velho && !lendoModelos) lendoModelos = lerModelos(cfg).finally(() => { lendoModelos = null; });
  if (cacheModelos.em === 0 && lendoModelos) return lendoModelos; // primeira vez: espera
  return Promise.resolve(cacheModelos.porDir);
}

// Git por pasta: guardado por 60 s, ou até o .git/logs/HEAD mudar (commit,
// checkout, reset), o que vier primeiro. Chamadas simultâneas da mesma pasta
// dividem uma só consulta.
const VALIDADE_GIT = 60 * 1000;
const cacheGit = new Map(); // dir → { em, marca, valor }
const lendoGit = new Map(); // dir → promessa
function marcaGit(dir) {
  try { return fs.statSync(path.join(dir, '.git', 'logs', 'HEAD')).mtimeMs; } catch { return 0; }
}
async function lerGit(dir) {
  const [ultimo, lista] = await Promise.all([
    rodar('git', ['-C', dir, 'log', '-1', '--format=%ct\t%s']),
    rodar('git', ['-C', dir, 'log', '--since=20 hours ago', '--oneline']),
  ]);
  const n = lista.split('\n').filter(Boolean).length;
  if (!ultimo.trim()) return { commits20h: n };
  const [ct, assunto] = ultimo.trim().split('\t');
  return { ultimoEm: Number(ct) * 1000, assunto, commits20h: n };
}
function git(dir) {
  const marca = marcaGit(dir);
  const c = cacheGit.get(dir);
  if (c && Date.now() - c.em < VALIDADE_GIT && c.marca === marca) return Promise.resolve(c.valor);
  if (!lendoGit.has(dir)) {
    lendoGit.set(dir, lerGit(dir).then((valor) => { cacheGit.set(dir, { em: Date.now(), marca, valor }); return valor; }).finally(() => lendoGit.delete(dir)));
  }
  return lendoGit.get(dir);
}

// Pedidos de permissão dos agentes, congelados na 1ª leitura: o agente pode
// reescrever o .json depois (a pasta é dele), e o cartão continua mostrando o
// que foi lido primeiro. A resposta leva o hash desse conteúdo; o hook só
// aceita se for o hash do pedido que ele fez (hooks/orq-evento.sh). O id é o
// nome do arquivo, nunca o que está escrito dentro dele.
const congelados = new Map(); // `${dir}\n${id}` → { hash, p }
const chaveCongelado = (dir, id) => `${dir}\n${id}`;
function permissoesDoProjeto(emp, proj, dirProj) {
  const lista = [];
  let pasta;
  try { pasta = pastaProjeto.caminho(dirProj, ['.orq', 'permissoes']); } catch { return lista; } // link: não lê
  const vistos = new Set();
  for (const f of safeLs(pasta.abs)) {
    if (!f.endsWith('.json')) continue;
    const id = f.slice(0, -5);
    if (!/^[\w.-]+$/.test(id)) continue;
    const chave = chaveCongelado(dirProj, id);
    vistos.add(chave);
    let bruto;
    try { bruto = pastaProjeto.ler(dirProj, ['.orq', 'permissoes', f], null); } catch { continue; } // link ou sumiu
    const hash = crypto.createHash('sha256').update(bruto).digest('hex');
    let c = congelados.get(chave);
    if (!c) {
      let p;
      try { p = JSON.parse(bruto.toString('utf8')); } catch { continue; } // arquivo sendo escrito
      if (!p || typeof p !== 'object') continue;
      c = { hash, p };
      congelados.set(chave, c);
    }
    lista.push({ tipo: 'permissao', emp, proj, id, ferramenta: c.p.tool_name, entrada: c.p.tool_input, desde: c.p.ts, ...(hash !== c.hash ? { alterado: true } : {}) });
  }
  // Pedido que saiu da pasta (respondido, expirado): esquece.
  for (const k of congelados.keys()) if (k.startsWith(`${dirProj}\n`) && !vistos.has(k)) congelados.delete(k);
  return lista;
}

function pendencias(emp, proj, dirProj) {
  const lista = permissoesDoProjeto(emp, proj, dirProj);
  const pPed = path.join(dirProj, '.orq', 'pedidos');
  for (const f of safeLs(pPed)) {
    if (!f.endsWith('.sh')) continue;
    const nome = f.slice(0, -3);
    if (fs.existsSync(path.join(dirProj, '.orq', 'respostas', nome + '.txt'))) continue;
    const arq = path.join(pPed, f);
    lista.push({ tipo: 'pedido', emp, proj, id: nome, conteudo: fs.readFileSync(arq, 'utf8').slice(0, 4000), desde: fs.statSync(arq).mtimeMs });
  }
  return lista;
}

function safeLs(dir) {
  try { return fs.readdirSync(dir); } catch { return []; }
}

// Sinal de vida: só em projetos que já têm o hook (pasta .orq/eventos). Sem
// isso, um projeto sem o hook ganharia uma pasta .orq que ninguém pediu.
// Sem seguir link (o agente pode trocar .orq ou app-vivo por um link para
// fora): o projeto com link fica sem sinal, e o motivo vai uma vez para o log.
const avisadosSinal = new Set();
function sinalDeVida() {
  for (const { dir } of projetos()) {
    try {
      const eventos = pastaProjeto.caminho(dir, ['.orq', 'eventos']);
      if (!eventos.existe || !eventos.st.isDirectory()) continue;
      pastaProjeto.tocar(dir, ['.orq', 'app-vivo']);
    } catch (e) {
      if (!pastaProjeto.ehRecusa(e)) continue;
      if (!avisadosSinal.has(dir + e.message)) { avisadosSinal.add(dir + e.message); console.error(`[coletor] ${dir}: ${e.message}`); }
    }
  }
}

// Todos os projetos de uma vez: o app não separa por grupo.
// Uma só leitura em voo: quem pede enquanto outra roda (a tela, o ciclo de
// recados, o laço de 5 s) recebe a mesma promessa. Com maxIdade, um retrato
// pronto há menos que isso (ms) é devolvido sem ler de novo.
let emVoo = null;
let ultimoRetrato = null; // { em, retrato }
function estado({ maxIdade = 0 } = {}) {
  if (emVoo) return emVoo;
  if (maxIdade > 0 && ultimoRetrato && Date.now() - ultimoRetrato.em < maxIdade) return Promise.resolve(ultimoRetrato.retrato);
  emVoo = lerEstado().then((retrato) => { ultimoRetrato = { em: Date.now(), retrato }; return retrato; }).finally(() => { emVoo = null; });
  return emVoo;
}

async function lerEstado() {
  const ps = await paineis();
  const frentes = [];
  const fila = [];
  let semTerminal = 0;

  const cfg = config.ler();
  const tarefasAtuais = tarefas(cfg);
  const modelosAtuais = await modelos(cfg);
  const lista = projetos(cfg);

  // 1) A tela de cada painel candidato, uma vez só por painel, em paralelo (limite de 4).
  const telas = new Map(); // pane → tela (60 linhas com texto)
  await Promise.all(lista.flatMap(({ dir }) => ps.filter((p) => p.dir === dir)).map(async (p) => {
    telas.set(p.pane, await tela(p.pane, 60));
  }));

  // 2) Classifica na mesma ordem de sempre (mexeu e ehAgente guardam estado entre leituras).
  const achados = [];
  for (const { emp, proj, dir, alvo } of lista) {
    fila.push(...pendencias(emp, proj, dir));
    const candidatos = ps.filter((p) => p.dir === dir);
    const eventos = lerEventos(dir);
    let achou = false;
    for (const p of candidatos) {
      const statusAgente = lerStatus(dir);
      const inteira = telas.get(p.pane);
      // 12 linhas: a dica que o Claude mostra embaixo do contador empurrava a
      // linha do contador para fora de uma janela menor.
      const fim = inteira.split('\n').slice(-12).join('\n');
      const mexeuAgora = mexeu(p.pane, inteira);
      if (!ehAgente(p.pane, fim)) continue;
      achou = true;
      achados.push({ emp, proj, dir, alvo, p, statusAgente, inteira, fim, mexeuAgora, eventos });
    }
    if (!achou) semTerminal++;
  }

  // 3) Git das pastas dos agentes (cache; as consultas novas vão em paralelo).
  const gits = new Map();
  await Promise.all([...new Set(achados.map((a) => a.dir))].map(async (dir) => { gits.set(dir, await git(dir)); }));

  for (const { emp, proj, dir, alvo, p, statusAgente, inteira, fim, mexeuAgora, eventos } of achados) {
    const ultimo = eventos && eventos.length ? eventos[eventos.length - 1] : null;
    const resposta = eventos ? [...eventos].reverse().find((e) => e.last_assistant_message) : null;
    const inicio = eventos ? [...eventos].reverse().find((e) => e.evento === 'SessionStart') : null;
    frentes.push({
      chave: `${emp}/${proj}:${p.pane}`,
      emp, proj, dir,
      pane: p.pane,
      sessaoTmux: p.sessao,
      nome: nomeDoAgente(p.titulo, proj, (tarefasAtuais[alvo] || {}).numero),
      estado: ultimo ? estadoPeloSinal(ultimo) : estadoComStatus(estadoPelaTela(fim, mexeuAgora), statusAgente),
      statusAgente,
      fimDaTela: fim,
      fonte: ultimo ? 'sinal' : 'tela',
      desde: ultimo ? ultimo.ts : null,
      sessaoClaude: inicio ? inicio.sessao : null,
      modelo: inicio ? inicio.model : null,
      ultimaResposta: resposta ? resposta.last_assistant_message : null,
      linhaDoTempo: eventos || [],
      git: gits.get(dir),
      motor: motorDaTela(fim),
      modeloAgente: motorDaTela(fim) === 'codex' ? modeloDoCodex(inteira) : (modelosAtuais[dir] || null),
      tarefa: (tarefasAtuais[alvo] || {}).tarefa || null,
    });
  }
  return { frentes, fila, semTerminal, lidoEm: Date.now() };
}

// Espelho da tela de um agente, com cores (somente leitura). Uma captura por
// painel por vez: pedidos simultâneos dividem a mesma, e a leitura de menos
// de 1,5 s é reaproveitada (a tela pede a cada 2 s).
const VALIDADE_ESPELHO = 1500;
const espelhos = new Map(); // pane → { em, texto, voo }
function espelho(pane) {
  if (!/^%\d+$/.test(pane)) return Promise.resolve('');
  const e = espelhos.get(pane);
  if (e && e.voo) return e.voo;
  if (e && Date.now() - e.em < VALIDADE_ESPELHO) return Promise.resolve(e.texto);
  const voo = rodar('tmux', ['capture-pane', '-p', '-e', '-t', pane]).then((texto) => { espelhos.set(pane, { em: Date.now(), texto, voo: null }); return texto; });
  espelhos.set(pane, { em: e ? e.em : 0, texto: e ? e.texto : '', voo });
  if (espelhos.size > 60) espelhos.delete(espelhos.keys().next().value);
  return voo;
}

// Resposta de permissão: grava o arquivo que o hook está esperando.
function responder(emp, proj, id, decisao) {
  if (!['permitir', 'negar'].includes(decisao)) throw new Error('decisão inválida');
  const alvo = projetos().find((p) => p.emp === emp && p.proj === proj);
  if (!/^[\w.-]+$/.test(id) || !alvo) throw new Error('alvo inválido');
  if (!pastaProjeto.caminho(alvo.dir, ['.orq', 'permissoes', id + '.json']).existe) return false; // já respondido no terminal
  // Só responde ao que o app mostrou (congelado), com o hash do que mostrou.
  const c = congelados.get(chaveCongelado(alvo.dir, id));
  if (!c) return false;
  // A resposta vai para .orq/respostas-perm, que o container monta só-leitura
  // (o agente lá dentro não consegue forjar um "permitir"); o app grava do host.
  pastaProjeto.gravar(alvo.dir, ['.orq', 'respostas-perm', id + '.resposta'], `${decisao} ${c.hash}\n`);
  return true;
}

function hoje() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Tópicos e diários da orquestração (config.pastaNotas). Só leitura.
function anotacoes() {
  const notas = config.ler().pastaNotas;
  if (!notas) return { dias: [], hoje: hoje(), temTopicos: false };
  const dias = safeLs(path.join(notas, 'diario'))
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).map((f) => f.slice(0, -3)).sort().reverse();
  return { dias, hoje: hoje(), temTopicos: fs.existsSync(path.join(notas, 'topicos.md')) };
}

// qual = 'topicos' ou uma data AAAA-MM-DD; nada fora dessas duas formas é lido.
function lerNota(qual) {
  const notas = config.ler().pastaNotas;
  if (!notas) return null;
  let arq;
  if (qual === 'topicos') arq = path.join(notas, 'topicos.md');
  else if (/^\d{4}-\d{2}-\d{2}$/.test(qual)) arq = path.join(notas, 'diario', qual + '.md');
  else return null;
  try { return fs.readFileSync(arq, 'utf8'); } catch { return null; }
}

module.exports = { _executor: (f) => { executor = f || execPadrao; }, _limparCaches: () => { cacheGit.clear(); espelhos.clear(); cacheModelos = { em: 0, porDir: {} }; ultimoRetrato = null; }, _pendencias: pendencias, _ultimasLinhas: ultimasLinhas, _lerEventos: lerEventos, lerStatus, estadoComStatus, estadoPelaTela, mexeu, ehAgente, motorDaTela, modeloDoCodex, nomeDoAgente, projetos, tarefas, estado, espelho, responder, sinalDeVida, anotacoes, lerNota, raiz: () => config.ler().raizProjetos };
