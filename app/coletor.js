// Coletor — monta o retrato das frentes a partir do que já existe na máquina:
// as pastas de projeto (config.js), painéis do tmux, git, e os eventos que o
// hook orq-evento grava em <projeto>/.orq/. Só lê; a única escrita é o arquivo
// de resposta de permissão e o sinal de vida (.orq/app-vivo).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const config = require('./config');

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

function rodar(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
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

function paineis() {
  const saida = rodar('tmux', ['list-panes', '-a', '-F', '#{pane_id}\t#{pane_current_path}\t#{pane_title}\t#{session_name}']);
  return saida.split('\n').filter(Boolean).map((l) => {
    const [pane, dir, titulo, sessao] = l.split('\t');
    return { pane, dir, titulo, sessao };
  });
}

function tela(pane, linhas = 8) {
  const t = rodar('tmux', ['capture-pane', '-p', '-t', pane]);
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
  const linhas = fs.readFileSync(path.join(pasta, arquivos[0].f), 'utf8').trim().split('\n').slice(-limite);
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
// Relido a cada 30 s, não a cada desenho da tela.
let cacheModelos = { em: 0, porDir: {} };
function modelos(cfg) {
  if (Date.now() - cacheModelos.em < 30000) return cacheModelos.porDir;
  const porDir = {};
  const saida = rodar('docker', ['ps', '--format', `{{.Names}}\t{{.Label "${cfg.rotuloContainer}"}}`]);
  for (const l of saida.split('\n')) {
    const [nome, dir] = l.split('\t');
    if (!nome || !dir || !dir.startsWith(cfg.raizProjetos)) continue;
    const pasta = cfg.pastaTranscript.replace('{projeto}', path.basename(dir));
    const m = rodar('docker', ['exec', nome, 'sh', '-c',
      `f=$(ls -t "$HOME/.claude/projects/${pasta}"/*.jsonl 2>/dev/null | head -1); [ -n "$f" ] && tail -c 300000 "$f" | grep -o '"model":"claude-[a-z0-9-]*"' | tail -1`]);
    const x = m.match(/claude-([a-z]+)-(\d+)-(\d+)/);
    if (x) porDir[dir] = `${x[1][0].toUpperCase()}${x[1].slice(1)} ${x[2]}.${x[3]}`;
  }
  cacheModelos = { em: Date.now(), porDir };
  return porDir;
}

function git(dir) {
  const ultimo = rodar('git', ['-C', dir, 'log', '-1', '--format=%ct\t%s']).trim();
  const n = rodar('git', ['-C', dir, 'log', '--since=20 hours ago', '--oneline']).split('\n').filter(Boolean).length;
  if (!ultimo) return { commits20h: n };
  const [ct, assunto] = ultimo.split('\t');
  return { ultimoEm: Number(ct) * 1000, assunto, commits20h: n };
}

function pendencias(emp, proj, dirProj) {
  const lista = [];
  const pPerm = path.join(dirProj, '.orq', 'permissoes');
  for (const f of safeLs(pPerm)) {
    if (!f.endsWith('.json')) continue;
    try {
      const p = JSON.parse(fs.readFileSync(path.join(pPerm, f), 'utf8'));
      lista.push({ tipo: 'permissao', emp, proj, id: p.id, ferramenta: p.tool_name, entrada: p.tool_input, desde: p.ts });
    } catch { /* arquivo sendo escrito */ }
  }
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
function sinalDeVida() {
  for (const { dir } of projetos()) {
    const dirOrq = path.join(dir, '.orq');
    if (!fs.existsSync(path.join(dirOrq, 'eventos'))) continue;
    const arq = path.join(dirOrq, 'app-vivo');
    const agora = new Date();
    try { fs.utimesSync(arq, agora, agora); } catch { fs.writeFileSync(arq, ''); }
  }
}

// Todos os projetos de uma vez: o app não separa por grupo.
function estado() {
  const ps = paineis();
  const frentes = [];
  const fila = [];
  let semTerminal = 0;

  const cfg = config.ler();
  const tarefasAtuais = tarefas(cfg);
  const modelosAtuais = modelos(cfg);
  for (const { emp, proj, dir, alvo } of projetos(cfg)) {
    fila.push(...pendencias(emp, proj, dir));
    const candidatos = ps.filter((p) => p.dir === dir);
    const eventos = lerEventos(dir);
    let achou = false;
    for (const p of candidatos) {
      const statusAgente = lerStatus(dir);
      const inteira = tela(p.pane, 60);
      // 12 linhas: a dica que o Claude mostra embaixo do contador empurrava a
      // linha do contador para fora de uma janela menor.
      const fim = inteira.split('\n').slice(-12).join('\n');
      const mexeuAgora = mexeu(p.pane, inteira);
      if (!ehAgente(p.pane, fim)) continue;
      achou = true;
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
        git: git(dir),
        motor: motorDaTela(fim),
        modeloAgente: motorDaTela(fim) === 'codex' ? modeloDoCodex(inteira) : (modelosAtuais[dir] || null),
        tarefa: (tarefasAtuais[alvo] || {}).tarefa || null,
      });
    }
    if (!achou) semTerminal++;
  }
  return { frentes, fila, semTerminal, lidoEm: Date.now() };
}

// Espelho da tela de um agente, com cores (somente leitura).
function espelho(pane) {
  if (!/^%\d+$/.test(pane)) return '';
  return rodar('tmux', ['capture-pane', '-p', '-e', '-t', pane]);
}

// Resposta de permissão: grava o arquivo que o hook está esperando.
function responder(emp, proj, id, decisao) {
  if (!['permitir', 'negar'].includes(decisao)) throw new Error('decisão inválida');
  const alvo = projetos().find((p) => p.emp === emp && p.proj === proj);
  if (!/^[\w.-]+$/.test(id) || !alvo) throw new Error('alvo inválido');
  const pasta = path.join(alvo.dir, '.orq', 'permissoes');
  if (!fs.existsSync(path.join(pasta, id + '.json'))) return false; // já respondido no terminal
  // A resposta vai para .orq/respostas-perm, que o container monta só-leitura
  // (o agente lá dentro não consegue forjar um "permitir"); o app grava do host.
  const respostas = path.join(alvo.dir, '.orq', 'respostas-perm');
  fs.mkdirSync(respostas, { recursive: true });
  fs.writeFileSync(path.join(respostas, id + '.resposta'), decisao + '\n');
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

module.exports = { lerStatus, estadoComStatus, estadoPelaTela, mexeu, ehAgente, motorDaTela, modeloDoCodex, nomeDoAgente, projetos, tarefas, estado, espelho, responder, sinalDeVida, anotacoes, lerNota, raiz: () => config.ler().raizProjetos };
