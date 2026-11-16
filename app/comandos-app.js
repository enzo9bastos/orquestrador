// O lado do processo principal dos comandos do "/" que o app faz com arquivo
// (comandos.js, renderer/comandos-tela.js): /memory, /hooks, /agents,
// /keybindings, /todos, /release-notes, /resume, o /diff do Codex e o salvar do
// /export.
//
// Só mexe nos arquivos que esses comandos editam no terminal: os CLAUDE.md, o
// bloco "hooks" dos settings, os subagentes (.md em .claude/agents) e o
// keybindings.json. Antes de cada gravação a versão anterior é guardada; um
// subagente apagado vira cópia na pasta de apagados do app. Tirar hook ou
// apagar subagente só acontece com a confirmação (a tela mostra o custo antes).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const casa = () => os.homedir();
const CLAUDE_DIR = () => path.join(casa(), '.claude');
const VERSOES = () => path.join(casa(), '.local', 'share', 'orq-app', 'versoes', 'claude-arquivos');
const APAGADOS = () => path.join(casa(), '.local', 'share', 'orq-app', 'apagados', 'agentes');
const carimbo = () => new Date().toISOString().replace(/[:.]/g, '-');

// Caminhos que a tela pode ler e gravar por aqui (o /memory acrescenta os
// arquivos que o Claude disse ter carregado).
const liberados = new Set();
let PASTA_ATUAL = casa();
const pastaAgentes = (cwd) => path.join(cwd, '.claude', 'agents');
// Subagente: um .md direto na pasta de agentes do usuário ou do projeto.
const ehAgente = (p) => p.endsWith('.md') && [path.join(CLAUDE_DIR(), 'agents'), pastaAgentes(PASTA_ATUAL)].includes(path.dirname(p));
const keybindings = () => path.join(CLAUDE_DIR(), 'keybindings.json');
function liberado(p) {
  const abs = path.resolve(String(p || ''));
  return liberados.has(abs) || ehAgente(abs) || abs === keybindings();
}

function lerTexto(p) { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } }
function mtime(p) { try { return fs.statSync(p).mtimeMs; } catch { return null; } }

// Guarda a versão de agora (se existe) e grava a nova por cima, de uma vez.
function gravarComCopia(p, conteudo) {
  let copia = null;
  if (fs.existsSync(p)) {
    fs.mkdirSync(VERSOES(), { recursive: true });
    copia = path.join(VERSOES(), `${carimbo()}-${path.basename(p)}`);
    fs.copyFileSync(p, copia);
  }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.orq-tmp`;
  fs.writeFileSync(tmp, conteudo);
  fs.renameSync(tmp, p);
  return copia;
}

// --- /memory ------------------------------------------------------------------
// Os CLAUDE.md que o terminal lista: do usuário, do projeto (./CLAUDE.md e
// ./.claude/CLAUDE.md) e o local (./CLAUDE.local.md). dialogo: a resposta do
// get_memory_dialog, quando o Claude respondeu (traz também os outros
// arquivos carregados).
function memoria(cwd, dialogo = null) {
  PASTA_ATUAL = cwd || casa();
  const conhecidos = [
    { kind: 'user', path: path.join(CLAUDE_DIR(), 'CLAUDE.md'), label: 'Do usuário', description: '~/.claude/CLAUDE.md — vale em todos os projetos' },
    { kind: 'project', path: path.join(PASTA_ATUAL, 'CLAUDE.md'), label: 'Do projeto', description: './CLAUDE.md — vai junto com o projeto' },
    { kind: 'project-alt', path: path.join(PASTA_ATUAL, '.claude', 'CLAUDE.md'), label: 'Do projeto (alternativo)', description: './.claude/CLAUDE.md' },
    { kind: 'local', path: path.join(PASTA_ATUAL, 'CLAUDE.local.md'), label: 'Local', description: './CLAUDE.local.md — só nesta máquina' },
  ];
  const vistos = new Map();
  const doClaude = dialogo && Array.isArray(dialogo.files) ? dialogo.files : [];
  for (const f of [...doClaude, ...conhecidos]) {
    if (!f || typeof f.path !== 'string' || !path.isAbsolute(f.path) || !/\.md$/i.test(f.path)) continue;
    const abs = path.resolve(f.path);
    if (vistos.has(abs)) continue;
    const existe = fs.existsSync(abs);
    // Arquivo que não existe: só os do usuário, do projeto e o local (o terminal cria esses).
    if (!existe && !['user', 'project', 'local'].includes(f.kind)) continue;
    vistos.set(abs, { kind: f.kind || 'other', path: abs, label: f.label || path.basename(abs), description: f.description || '', exists: existe });
  }
  for (const p of vistos.keys()) liberados.add(p);
  return { arquivos: [...vistos.values()], fonte: doClaude.length ? 'claude' : 'app',
    automemoria: dialogo && dialogo.auto_memory ? dialogo.auto_memory : null, pastas: dialogo && Array.isArray(dialogo.folders) ? dialogo.folders : [] };
}

function lerArquivo(p) {
  const abs = path.resolve(String(p || ''));
  if (!liberado(abs)) throw new Error('arquivo fora do que os comandos editam');
  const conteudo = lerTexto(abs);
  return { caminho: abs, conteudo: conteudo == null ? '' : conteudo, existe: conteudo != null, mtime: mtime(abs) };
}

// Grava um arquivo aberto pelo /memory, /agents ou /keybindings. Recusa se
// ele mudou desde que foi aberto (alguém gravou por fora).
function gravarArquivo(p, conteudo, mtimeLido) {
  const abs = path.resolve(String(p || ''));
  if (!liberado(abs)) throw new Error('arquivo fora do que os comandos editam');
  const agora = mtime(abs);
  if (mtimeLido !== undefined && agora !== (mtimeLido == null ? null : mtimeLido)) throw new Error('o arquivo mudou desde que foi aberto; feche e abra de novo para não perder a outra mudança');
  if (abs === keybindings() && String(conteudo).trim()) { try { JSON.parse(conteudo); } catch (e) { throw new Error(`JSON inválido: ${e.message}`); } }
  const copia = gravarComCopia(abs, String(conteudo));
  return { ok: true, caminho: abs, copia, mtime: mtime(abs) };
}

// --- /hooks ---------------------------------------------------------------------
const contarHooks = (h) => Object.values(h && typeof h === 'object' ? h : {})
  .reduce((n, grupos) => n + (Array.isArray(grupos) ? grupos.reduce((m, g) => m + (g && Array.isArray(g.hooks) ? g.hooks.length : 1), 0) : 0), 0);

function arquivosDeSettings(cwd) {
  const l = [
    ['Do usuário', path.join(CLAUDE_DIR(), 'settings.json')],
    ['Do projeto', path.join(cwd, '.claude', 'settings.json')],
    ['Local', path.join(cwd, '.claude', 'settings.local.json')],
  ];
  const vistos = new Map();
  for (const [rotulo, p] of l) {
    const abs = path.resolve(p);
    if (vistos.has(abs)) { vistos.get(abs).rotulo += ` e ${rotulo.toLowerCase()}`; continue; }
    vistos.set(abs, { rotulo, caminho: abs });
  }
  return [...vistos.values()];
}

function hooks(cwd) {
  PASTA_ATUAL = cwd || casa();
  return arquivosDeSettings(PASTA_ATUAL).map((a) => {
    const bruto = lerTexto(a.caminho);
    if (bruto == null) return { ...a, existe: false, hooks: {}, contagem: 0 };
    try {
      const j = JSON.parse(bruto);
      const h = j && typeof j.hooks === 'object' && j.hooks ? j.hooks : {};
      return { ...a, existe: true, hooks: h, contagem: contarHooks(h) };
    } catch (e) { return { ...a, existe: true, hooks: {}, contagem: 0, erro: `JSON inválido: ${e.message}` }; }
  });
}

// novo: o bloco "hooks" inteiro (texto JSON). Se tira hooks, devolve o custo e
// só grava com confirmado = true. O resto do settings fica como está.
function gravarHooks(cwd, caminho, novoTexto, confirmado = false) {
  const alvo = arquivosDeSettings(cwd || casa()).find((a) => a.caminho === path.resolve(String(caminho || '')));
  if (!alvo) throw new Error('arquivo de settings desconhecido');
  let novo;
  try { novo = JSON.parse(String(novoTexto || '{}')); } catch (e) { throw new Error(`JSON inválido: ${e.message}`); }
  if (!novo || typeof novo !== 'object' || Array.isArray(novo)) throw new Error('o bloco hooks tem de ser um objeto { evento: [...] }');
  const bruto = lerTexto(alvo.caminho);
  let atual = {};
  if (bruto != null) { try { atual = JSON.parse(bruto); } catch { throw new Error(`${alvo.caminho} está estragado (JSON inválido); corrija o arquivo antes de mudar os hooks por aqui`); } }
  const antes = contarHooks(atual.hooks), depois = contarHooks(novo);
  if (depois < antes && !confirmado) {
    const eventos = Object.keys(atual.hooks || {}).filter((ev) => contarHooks({ [ev]: (novo[ev] || []) }) < contarHooks({ [ev]: atual.hooks[ev] }));
    return { precisaConfirmar: true, antes, depois, somem: antes - depois, eventos, caminho: alvo.caminho };
  }
  const saida = { ...atual };
  if (Object.keys(novo).length) saida.hooks = novo; else delete saida.hooks;
  const copia = gravarComCopia(alvo.caminho, JSON.stringify(saida, null, 2) + '\n');
  return { ok: true, antes, depois, copia, caminho: alvo.caminho };
}

// --- /agents --------------------------------------------------------------------
function frontmatter(txt) {
  const m = /^---\n([\s\S]*?)\n---/.exec(txt || '');
  const o = {};
  if (m) for (const l of m[1].split('\n')) { const k = /^([\w-]+):\s*(.*)$/.exec(l); if (k) o[k[1]] = k[2].replace(/^["']|["']$/g, ''); }
  return o;
}
function agentes(cwd) {
  PASTA_ATUAL = cwd || casa();
  const pastas = [...new Set([path.join(CLAUDE_DIR(), 'agents'), pastaAgentes(PASTA_ATUAL)].map((p) => path.resolve(p)))];
  const lista = [];
  for (const d of pastas) {
    let nomes = [];
    try { nomes = fs.readdirSync(d).filter((n) => n.endsWith('.md')); } catch { continue; }
    for (const n of nomes) {
      const p = path.join(d, n);
      const txt = lerTexto(p) || '';
      const fm = frontmatter(txt);
      liberados.add(p);
      lista.push({ caminho: p, nome: fm.name || n.replace(/\.md$/, ''), descricao: fm.description || '', modelo: fm.model || '', ferramentas: fm.tools || '',
        onde: d === path.join(CLAUDE_DIR(), 'agents') ? 'usuário' : 'projeto', linhas: txt.split('\n').length });
    }
  }
  return { pastas, agentes: lista.sort((a, b) => a.nome.localeCompare(b.nome)) };
}

function criarAgente(cwd, { onde = 'usuario', nome, descricao = '', ferramentas = '', modelo = '', prompt = '' } = {}) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(String(nome || ''))) throw new Error('nome: letras minúsculas, números e hífen (ex.: revisor-de-codigo)');
  const d = onde === 'projeto' ? pastaAgentes(cwd || casa()) : path.join(CLAUDE_DIR(), 'agents');
  const p = path.join(d, `${nome}.md`);
  if (fs.existsSync(p)) throw new Error(`já existe um subagente com esse nome: ${p}`);
  const linha = (k, v) => (v && String(v).trim() ? `${k}: ${String(v).replace(/\n/g, ' ').trim()}\n` : '');
  const txt = `---\nname: ${nome}\n${linha('description', descricao)}${linha('tools', ferramentas)}${linha('model', modelo)}---\n\n${String(prompt || '').trim()}\n`;
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(p, txt, { flag: 'wx' });
  liberados.add(p);
  return { ok: true, caminho: p };
}

// O custo de apagar: tamanho, onde ele é citado (o que fica órfão) e para
// onde vai a cópia.
function custoApagarAgente(caminho) {
  const p = path.resolve(String(caminho || ''));
  if (!ehAgente(p)) throw new Error('não é um subagente');
  const txt = lerTexto(p);
  if (txt == null) throw new Error('o subagente não existe mais');
  const nome = frontmatter(txt).name || path.basename(p, '.md');
  const citacoes = [];
  const olhar = (arq) => {
    if (path.resolve(arq) === p) return;
    const t = lerTexto(arq);
    if (!t) return;
    const n = t.split(nome).length - 1;
    if (n) citacoes.push({ arquivo: arq, vezes: n });
  };
  for (const d of [path.join(CLAUDE_DIR(), 'agents'), pastaAgentes(PASTA_ATUAL)]) { try { fs.readdirSync(d).filter((x) => x.endsWith('.md')).forEach((x) => olhar(path.join(d, x))); } catch { /* sem pasta */ } }
  try { fs.readdirSync(path.join(CLAUDE_DIR(), 'skills')).forEach((x) => olhar(path.join(CLAUDE_DIR(), 'skills', x, 'SKILL.md'))); } catch { /* sem skills */ }
  olhar(path.join(CLAUDE_DIR(), 'CLAUDE.md'));
  return { caminho: p, nome, linhas: txt.split('\n').length, bytes: Buffer.byteLength(txt), citacoes, copiaEm: APAGADOS() };
}
function apagarAgente(caminho, confirmado) {
  if (confirmado !== true) throw new Error('apagar precisa da confirmação');
  const c = custoApagarAgente(caminho);
  fs.mkdirSync(APAGADOS(), { recursive: true });
  const copia = path.join(APAGADOS(), `${carimbo()}-${path.basename(c.caminho)}`);
  fs.copyFileSync(c.caminho, copia);
  fs.unlinkSync(c.caminho);
  liberados.delete(c.caminho);
  return { ok: true, copia };
}

// --- /todos ---------------------------------------------------------------------
// A última lista do TodoWrite no transcript da sessão.
function todos(arqTranscript) {
  const txt = lerTexto(arqTranscript);
  if (txt == null) return { achou: false, itens: [] };
  let ultimo = null;
  for (const l of txt.split('\n')) {
    if (!l.includes('TodoWrite')) continue;
    let d;
    try { d = JSON.parse(l); } catch { continue; }
    const c = d && d.message && Array.isArray(d.message.content) ? d.message.content : [];
    for (const b of c) if (b && b.type === 'tool_use' && b.name === 'TodoWrite' && b.input && Array.isArray(b.input.todos)) ultimo = { itens: b.input.todos, quando: d.timestamp || null };
  }
  if (!ultimo) return { achou: false, itens: [] };
  return { achou: true, quando: ultimo.quando, itens: ultimo.itens.map((t) => ({ texto: String(t.content || t.activeForm || ''), status: String(t.status || 'pending') })) };
}

// --- /release-notes --------------------------------------------------------------
// O changelog que o próprio Claude baixa e guarda; a seção da versão instalada
// primeiro e mais algumas anteriores.
function notasVersao(versao, quantas = 5) {
  const txt = lerTexto(path.join(CLAUDE_DIR(), 'cache', 'changelog.md'));
  if (txt == null) return { achou: false, secoes: [] };
  const secoes = [];
  const partes = txt.split(/^## /m).slice(1);
  let comecou = !versao;
  for (const p of partes) {
    const v = p.split('\n')[0].trim();
    if (!comecou && v === versao) comecou = true;
    if (!comecou) continue;
    secoes.push({ versao: v, texto: p.split('\n').slice(1).join('\n').trim() });
    if (secoes.length >= quantas) break;
  }
  if (!secoes.length) for (const p of partes.slice(0, quantas)) secoes.push({ versao: p.split('\n')[0].trim(), texto: p.split('\n').slice(1).join('\n').trim() });
  return { achou: true, versao, secoes };
}

// --- /resume (Claude) --------------------------------------------------------------
function sessoes(pastaProjetos, abertas = []) {
  let nomes = [];
  try { nomes = fs.readdirSync(pastaProjetos).filter((n) => n.endsWith('.jsonl')); } catch { return []; }
  const lista = nomes.map((n) => ({ arq: path.join(pastaProjetos, n), sessao: n.replace(/\.jsonl$/, ''), mtime: mtime(path.join(pastaProjetos, n)) || 0 }))
    .sort((a, b) => b.mtime - a.mtime).slice(0, 40);
  return lista.map((s) => {
    let titulo = '', mensagens = 0;
    const txt = (lerTexto(s.arq) || '').split('\n').slice(0, 400);
    for (const l of txt) {
      if (!l) continue;
      let d;
      try { d = JSON.parse(l); } catch { continue; }
      if (d.type === 'custom-title' && d.customTitle) titulo = d.customTitle;
      if (d.type === 'user' && d.message && !d.isMeta && !d.isSidechain) {
        const c = d.message.content;
        const t = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b && b.type === 'text').map((b) => b.text).join(' ') : '';
        if (t && !/^\s*</.test(t)) { mensagens++; if (!titulo) titulo = t.replace(/\s+/g, ' ').trim().slice(0, 100); }
      }
    }
    return { sessao: s.sessao, quando: s.mtime, titulo: titulo || '(sem mensagem)', mensagens, aberta: abertas.includes(s.sessao) };
  }).filter((s) => s.mensagens > 0);
}

// --- /diff do Codex (o do Claude vem pelo get_workspace_diff) -------------------
function diffGit(cwd) {
  const git = (...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', timeout: 5000, maxBuffer: 4 * 1024 * 1024 });
  try { git('rev-parse', '--is-inside-work-tree'); } catch { return { git: false, texto: '' }; }
  const status = git('status', '--porcelain');
  let diff = git('diff', 'HEAD');
  if (diff.length > 200000) diff = `${diff.slice(0, 200000)}\n… (cortado)`;
  const novos = status.split('\n').filter((l) => l.startsWith('??')).map((l) => l.slice(3));
  return { git: true, status, diff, novos };
}

// --- salvar o /export ------------------------------------------------------------
// Nunca grava por cima: se o arquivo existe, recusa e a tela pede outro nome.
function salvarTexto(caminho, texto) {
  const abs = path.resolve(String(caminho || ''));
  if (!path.isAbsolute(abs)) throw new Error('caminho inválido');
  fs.writeFileSync(abs, String(texto), { flag: 'wx' });
  return { ok: true, caminho: abs };
}

module.exports = { memoria, lerArquivo, gravarArquivo, hooks, gravarHooks, agentes, criarAgente, custoApagarAgente, apagarAgente,
  todos, notasVersao, sessoes, diffGit, salvarTexto, keybindings, _contarHooks: contarHooks };
