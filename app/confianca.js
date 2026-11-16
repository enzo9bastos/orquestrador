// Pasta confiável (Etapa 0.E1): antes de abrir uma conversa do Claude numa
// pasta, saber se o usuário já aceitou o que ela faz rodar, e perceber quando
// isso mudou depois do aceite.
//
// Por que existe: o app abre o CLI em modo não interativo (-p), que pula o
// aviso de confiança do próprio CLI. Nesse modo, assim que a conversa começa,
// a pasta do projeto já roda coisas na máquina do usuário:
//   - hooks de .claude/settings.json e .claude/settings.local.json;
//   - servidores MCP de .mcp.json (no -p o CLI aprova todos sozinho);
//   - comandos de apoio (statusLine, apiKeyHelper...) e regras "allow";
//   - instruções de CLAUDE.md (e do que ele importa com @caminho), que o
//     modelo segue.
// O que o CLI de verdade lê foi conferido nos arquivos empacotados do Claude
// Code 2.1.325 (e 2.1.326); cada função abaixo diz o que copia dele.
//
// O que este módulo faz (sem ligar em nada; quem chama é a Etapa 3.1):
//   verificar(pasta, {container})  → estado (nunca vista / aceita / mudou), o
//       que vai rodar (dado estruturado e limitado, nunca interpretado) e a
//       "ficha" para aceitar e conferir de novo na hora de abrir;
//   aceitar(resultado)             → grava o aceite do que o usuário VIU;
//   conferirNaHora(resultado)      → mede de novo logo antes de abrir;
//   argumentosSemProjeto()         → argumentos para abrir sem as
//       configurações do projeto.
//
// Regras de segurança:
//   - identidade da pasta = caminho real (realpath);
//   - impressão digital (sha256) do conteúdo de tudo o que o CLI lê e pode
//     rodar ou mandar; mudou um byte → pergunta de novo;
//   - na dúvida, pergunta: arquivo que não deu para ler, JSON inválido, limite
//     estourado ou link para pasta fora → "incerta", e o aceite não é lembrado;
//   - pasta com agente em container → sempre cartão, aceite nunca lembrado;
//   - nada síncrono: tudo com fs.promises, com limite de tamanho e de tempo;
//   - FIFO, dispositivo e arquivo enorme não travam: só arquivo comum é lido,
//     aberto com O_NONBLOCK e conferido pelo próprio descritor.
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { O_RDONLY, O_NONBLOCK, O_NOFOLLOW } = fs.constants;

const LIMITE = {
  arquivo: 4 * 1024 * 1024,   // o CLI pula CLAUDE.md maior que 4 MiB (N3 = 4194304)
  arquivos: 2000,             // arquivos lidos numa verificação
  total: 32 * 1024 * 1024,    // bytes lidos numa verificação
  profundidadeImport: 5,      // o CLI para em profundidade 5 (Rwo = 5): raiz 0, importações 1 a 4
  profundidadePasta: 8,       // subpastas em .claude/skills, rules etc.
  scripts: 50,                // arquivos citados pelos comandos (hooks, MCP)
  itens: 100,                 // itens por lista do cartão
  texto: 300,                 // caracteres por texto do cartão
  mudancas: 40,               // linhas de "o que mudou"
  avisos: 50,
  tempoMs: 10000,             // a verificação inteira
};
const VERSAO_IMPRESSAO = 'orq-confianca-1';

// Chaves de settings que fazem o CLI rodar um comando (a mesma lista que o
// diálogo de confiança do próprio CLI mostra).
const AJUDANTES = ['apiKeyHelper', 'awsAuthRefresh', 'awsCredentialExport', 'gcpAuthRefresh', 'otelHeadersHelper', 'proxyAuthHelper'];
const COM_COMANDO = ['statusLine', 'fileSuggestion', 'subagentStatusLine'];

// O que "abrir sem as configurações do projeto" desliga e o que não desliga
// (conferido nos arquivos do CLI 2.1.325 e 2.1.326).
const SEM_PROJETO = {
  desliga: [
    '.claude/settings.json e .claude/settings.local.json do projeto (hooks, regras allow, env, comandos de apoio, plugins, defaultMode)',
    '.mcp.json da pasta e das pastas acima',
    'CLAUDE.md, .claude/CLAUDE.md, CLAUDE.local.md e .claude/rules da pasta e das pastas acima (com as importações)',
    'skills, comandos, agentes e workflows do projeto (.claude/skills, commands, agents, workflows)',
    'com --strict-mcp-config: também os servidores MCP do usuário, do escopo local e dos plugins (só ficam os de --mcp-config)',
  ],
  naoDesliga: [
    '~/.claude/settings.json do usuário (os hooks dele continuam rodando)',
    '~/.claude/CLAUDE.md e ~/.claude/rules do usuário',
    'plugins instalados pelo usuário e configurações gerenciadas (policy)',
    'as ferramentas: o modelo ainda pode LER os arquivos da pasta (inclusive o CLAUDE.md, como texto) e rodar comandos conforme as permissões do usuário',
  ],
};

function argumentosSemProjeto({ mcpDoUsuario = false } = {}) {
  return mcpDoUsuario ? ['--setting-sources', 'user'] : ['--setting-sources', 'user', '--strict-mcp-config'];
}

// --- caminhos -----------------------------------------------------------------

const casaPadrao = () => os.homedir();
const arquivoPadrao = (casa) => path.join(casa, '.config', 'orq-app', 'confianca.json');
const versoesPadrao = (casa) => path.join(casa, '.local', 'share', 'orq-app', 'versoes', 'confianca');

const dentro = (raiz, p) => p === raiz || p.startsWith(raiz.endsWith(path.sep) ? raiz : raiz + path.sep);
const posix = (p) => p.split(path.sep).join('/');

function erroPasta(msg) {
  const e = new Error(msg);
  e.code = 'ORQ_PASTA_INVALIDA';
  return e;
}

// --- texto para o cartão -------------------------------------------------------
// Texto vindo dos arquivos é dado não confiável: tira caracteres de controle e
// de formatação invisível (inclui os que invertem a direção do texto), corta no
// limite e esconde o que parece segredo. Nunca é interpretado.
const INVISIVEIS = /[\x00-\x1f\x7f-\x9f\u2028\u2029]|\p{Cf}/gu;
const SEGREDO_CHAVE = /((?:token|api[_-]?key|key|secret|senha|password|passwd|pwd|auth\w*|credential\w*)\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi;
const SEGREDO_BEARER = /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const SEGREDO_URL = /(\/\/)[^/\s:@]+:[^/\s@]+@/g;

function mascarar(t) {
  return t.replace(SEGREDO_URL, '$1•••@').replace(SEGREDO_BEARER, '$1 •••').replace(SEGREDO_CHAVE, '$1•••');
}
function limpo(v) {
  const t = mascarar(String(v == null ? '' : v).replace(INVISIVEIS, ' ').replace(/ {2,}/g, ' ').trim());
  return t.length > LIMITE.texto ? `${t.slice(0, LIMITE.texto - 1)}…` : t;
}
const nomeDe = (k) => limpo(k).slice(0, 80);

// --- leitura medida -----------------------------------------------------------

function novoContexto(pastaReal, casa) {
  return {
    pasta: pastaReal,
    casa,
    prazo: Date.now() + LIMITE.tempoMs,
    lidos: 0,
    bytes: 0,
    entradas: new Map(), // rótulo → entrada (o que entra na impressão)
    avisos: [],
    incerta: [],         // motivos de "não deu para conferir tudo"
  };
}

function rotuloDe(ctx, abs) {
  if (dentro(ctx.pasta, abs)) return abs === ctx.pasta ? '.' : posix(path.relative(ctx.pasta, abs));
  if (dentro(ctx.casa, abs)) return `~/${posix(path.relative(ctx.casa, abs))}`;
  return abs;
}

function avisar(ctx, tipo, rotulo, detalhe) {
  if (ctx.avisos.some((a) => a.tipo === tipo && a.rotulo === rotulo)) return;
  if (ctx.avisos.length >= LIMITE.avisos) return;
  ctx.avisos.push({ tipo, rotulo: limpo(rotulo), ...(detalhe != null ? { detalhe: limpo(detalhe) } : {}) });
}
function incerta(ctx, motivo, rotulo) {
  if (!ctx.incerta.some((m) => m.motivo === motivo && m.rotulo === rotulo)) ctx.incerta.push({ motivo, rotulo: limpo(rotulo) });
}
function noPrazo(ctx) {
  if (Date.now() <= ctx.prazo) return true;
  incerta(ctx, 'tempo-esgotado', '.');
  return false;
}

const AUSENTE = new Set(['ENOENT', 'ENOTDIR']);

// Lê um arquivo para a impressão. Segue link (o CLI segue), mas só lê arquivo
// comum, dentro dos limites, aberto sem bloquear (FIFO não trava) e conferido
// pelo descritor aberto (trocar o arquivo entre o stat e a abertura não passa).
// categoria: 'config' (settings, .mcp.json: estourar limite = incerta),
// 'instrucoes', 'extra' ou 'script'.
async function lerArquivo(ctx, abs, categoria) {
  const rotulo = rotuloDe(ctx, abs);
  if (ctx.entradas.has(rotulo)) return ctx.entradas.get(rotulo);
  const e = { rotulo, categoria, tipo: 'ausente' };
  ctx.entradas.set(rotulo, e);
  if (!noPrazo(ctx)) { e.tipo = 'nao-lido'; return e; }
  let real;
  try {
    const l = await fsp.lstat(abs);
    if (l.isSymbolicLink()) e.link = await fsp.readlink(abs).catch(() => '?');
    real = await fsp.realpath(abs);
  } catch (err) {
    if (AUSENTE.has(err.code)) { if (e.link) e.tipo = 'link-quebrado'; return e; }
    if (err.code === 'ELOOP') { e.tipo = 'link-quebrado'; return e; }
    e.tipo = 'erro'; e.codigo = err.code || 'erro';
    incerta(ctx, 'nao-deu-para-ler', rotulo);
    return e;
  }
  // Arquivo dentro da pasta que, pelo caminho real, mora fora dela (link no
  // próprio arquivo ou numa pasta do caminho, como .claude → fora).
  if (dentro(ctx.pasta, abs) && !dentro(ctx.pasta, real)) {
    e.real = real;
    avisar(ctx, 'link-para-fora', rotulo, rotuloDe(ctx, real));
  }
  let st;
  try { st = await fsp.stat(real); } catch (err) {
    e.tipo = 'erro'; e.codigo = err.code || 'erro';
    incerta(ctx, 'nao-deu-para-ler', rotulo);
    return e;
  }
  if (st.isDirectory()) { e.tipo = 'pasta'; return e; }
  if (!st.isFile()) {
    e.tipo = 'nao-comum';
    avisar(ctx, 'nao-e-arquivo-comum', rotulo);
    if (categoria === 'config') incerta(ctx, 'nao-e-arquivo-comum', rotulo);
    return e;
  }
  if (st.size > LIMITE.arquivo) {
    e.tipo = 'grande'; e.tamanho = st.size;
    avisar(ctx, 'grande-demais', rotulo, `${st.size} bytes`);
    if (categoria !== 'instrucoes') incerta(ctx, 'grande-demais', rotulo); // o CLI não lê CLAUDE.md desse tamanho
    return e;
  }
  if (ctx.lidos >= LIMITE.arquivos || ctx.bytes + st.size > LIMITE.total) {
    e.tipo = 'nao-lido';
    incerta(ctx, 'limite-de-leitura', rotulo);
    return e;
  }
  let fd;
  try {
    fd = await fsp.open(real, O_RDONLY | O_NONBLOCK | O_NOFOLLOW);
    const f = await fd.stat();
    if (!f.isFile() || f.ino !== st.ino || f.dev !== st.dev) throw Object.assign(new Error('trocado'), { code: 'ORQ_TROCADO' });
    const buf = Buffer.alloc(Math.min(f.size, LIMITE.arquivo) + 1);
    let n = 0;
    while (n < buf.length) {
      const { bytesRead } = await fd.read(buf, n, buf.length - n, n);
      if (!bytesRead) break;
      n += bytesRead;
    }
    if (n > LIMITE.arquivo) {
      e.tipo = 'grande'; e.tamanho = n;
      avisar(ctx, 'grande-demais', rotulo, `${n}+ bytes`);
      if (categoria !== 'instrucoes') incerta(ctx, 'grande-demais', rotulo);
      return e;
    }
    const conteudo = buf.subarray(0, n);
    ctx.lidos += 1;
    ctx.bytes += n;
    e.tipo = 'arquivo';
    e.tamanho = n;
    e.sha256 = crypto.createHash('sha256').update(conteudo).digest('hex');
    Object.defineProperty(e, 'conteudo', { value: conteudo, enumerable: false });
    return e;
  } catch (err) {
    e.tipo = 'erro'; e.codigo = err.code || 'erro';
    incerta(ctx, 'nao-deu-para-ler', rotulo);
    return e;
  } finally {
    if (fd) await fd.close().catch(() => {});
  }
}

// Percorre uma pasta de configuração (.claude/rules, skills...) e lê cada
// arquivo comum. Pasta que é link não é seguida (o conteúdo de fora não
// entraria na conta): fica "incerta". Devolve os caminhos lidos.
async function lerPasta(ctx, absDir, categoria, { soMd = false, ler = true, prof = 0 } = {}) {
  const rotulo = rotuloDe(ctx, absDir);
  let l;
  try { l = await fsp.lstat(absDir); } catch (err) {
    if (AUSENTE.has(err.code)) return [];
    incerta(ctx, 'nao-deu-para-ler', rotulo);
    ctx.entradas.set(rotulo, { rotulo, categoria, tipo: 'erro', codigo: err.code || 'erro' });
    return [];
  }
  if (l.isSymbolicLink()) {
    const alvo = await fsp.realpath(absDir).catch(() => null);
    ctx.entradas.set(rotulo, { rotulo, categoria, tipo: 'link-pasta', link: await fsp.readlink(absDir).catch(() => '?') });
    if (alvo) {
      avisar(ctx, 'pasta-e-link', rotulo, rotuloDe(ctx, alvo));
      incerta(ctx, 'pasta-e-link', rotulo);
    }
    return [];
  }
  if (!l.isDirectory()) return [];
  if (prof > LIMITE.profundidadePasta) { incerta(ctx, 'pasta-funda-demais', rotulo); return []; }
  // Uma pasta do caminho que é link para fora (ex.: .claude → fora).
  const real = await fsp.realpath(absDir).catch(() => absDir);
  if (dentro(ctx.pasta, absDir) && !dentro(ctx.pasta, real)) avisar(ctx, 'link-para-fora', rotulo, rotuloDe(ctx, real));
  let nomes;
  try { nomes = await fsp.readdir(absDir); } catch (err) {
    incerta(ctx, 'nao-deu-para-ler', rotulo);
    ctx.entradas.set(rotulo, { rotulo, categoria, tipo: 'erro', codigo: err.code || 'erro' });
    return [];
  }
  if (nomes.length > LIMITE.arquivos) { incerta(ctx, 'limite-de-leitura', rotulo); return []; }
  nomes.sort();
  const lidos = [];
  for (const nome of nomes) {
    if (!noPrazo(ctx)) break;
    const abs = path.join(absDir, nome);
    let s;
    try { s = await fsp.lstat(abs); } catch { continue; }
    if (s.isDirectory()) { lidos.push(...await lerPasta(ctx, abs, categoria, { soMd, ler, prof: prof + 1 })); continue; }
    if (s.isSymbolicLink()) {
      const alvo = await fsp.stat(abs).catch(() => null);
      if (alvo && alvo.isDirectory()) { lidos.push(...await lerPasta(ctx, abs, categoria, { soMd, ler, prof: prof + 1 })); continue; }
    }
    if (soMd && !nome.endsWith('.md')) continue;
    if (ler) await lerArquivo(ctx, abs, categoria);
    lidos.push(abs);
  }
  return lidos;
}

// --- CLAUDE.md e importações ---------------------------------------------------
// A mesma regra do CLI (função de importação do 2.1.325): "@caminho" no começo
// ou depois de espaço; "\ " vale espaço; "#..." é cortado; aceita ./, ~/, /x
// ou nome que começa com letra, número, ".", "_" ou "-". O CLI ainda ignora o
// que está em bloco de código e comentário HTML; aqui não, de propósito: lemos
// a mais (um arquivo a mais na conta não abre brecha; um a menos abriria).
const RE_IMPORT = /(?:^|\s)@((?:[^\s\\]|\\ )+)/g;
function importsDe(texto, arqAbs, casa) {
  const r = [];
  for (const m of texto.matchAll(RE_IMPORT)) {
    let h = m[1];
    const cerq = h.indexOf('#');
    if (cerq !== -1) h = h.slice(0, cerq);
    h = h.replaceAll('\\ ', ' ');
    if (!h) continue;
    const aceito = h.startsWith('./') || h.startsWith('~/') || (h.startsWith('/') && h !== '/')
      || (!h.startsWith('@') && !/^[#%^&*()]+/.test(h) && /^[a-zA-Z0-9._-]/.test(h));
    if (!aceito || h.includes('\0')) continue;
    const abs = h.startsWith('~/') ? path.join(casa, h.slice(2)) : path.resolve(path.dirname(arqAbs), h);
    if (!r.includes(abs)) r.push(abs);
  }
  return r;
}

// vistos: arquivos já contados (um arquivo importado por dois não é lido de
// novo); cadeia: o caminho de importações até aqui (voltar a um deles é ciclo).
async function lerInstrucao(ctx, abs, prof, vistos, arvore, cadeia = new Set()) {
  const e = await lerArquivo(ctx, abs, 'instrucoes');
  if (e.tipo !== 'arquivo') return;
  const real = await fsp.realpath(abs).catch(() => abs);
  if (vistos.has(real)) return;
  vistos.add(real);
  arvore.push({ rotulo: e.rotulo, bytes: e.tamanho, importadoPor: null, prof });
  if (!e.conteudo) return;
  const minhaCadeia = new Set(cadeia).add(real);
  for (const imp of importsDe(e.conteudo.toString('utf8'), abs, ctx.casa)) {
    const rot = rotuloDe(ctx, imp);
    const realImp = await fsp.realpath(imp).catch(() => imp);
    if (minhaCadeia.has(realImp)) { avisar(ctx, 'importacao-em-ciclo', rot, e.rotulo); continue; }
    if (vistos.has(realImp)) continue;
    if (prof + 1 >= LIMITE.profundidadeImport) { avisar(ctx, 'importacao-funda-demais', rot, e.rotulo); continue; }
    if (!dentro(ctx.pasta, realImp)) avisar(ctx, 'importacao-de-fora', rot, e.rotulo);
    const antes = arvore.length;
    await lerInstrucao(ctx, imp, prof + 1, vistos, arvore, minhaCadeia);
    if (arvore.length > antes) arvore[antes].importadoPor = e.rotulo;
  }
}

// --- pastas acima ---------------------------------------------------------------
// O CLI lê CLAUDE.md e .mcp.json da pasta e de todas as de cima até a raiz.
// Aqui a subida para antes da casa do usuário: ~ e o que está acima dela são do
// próprio usuário (pergunta de desenho ainda aberta).
function pastasAcima(pastaReal, casa) {
  const r = [];
  const parar = dentro(casa, pastaReal) ? casa : path.parse(pastaReal).root;
  let d = path.dirname(pastaReal);
  while (d !== parar && d !== path.dirname(d) && dentro(parar, d)) { r.push(d); d = path.dirname(d); }
  return r;
}

// Cópia de trabalho (git worktree): o CLI também lê o settings.local.json do
// repositório principal.
async function raizPrincipalDoWorktree(pastaReal) {
  let t;
  try {
    const fd = await fsp.open(path.join(pastaReal, '.git'), O_RDONLY | O_NONBLOCK | O_NOFOLLOW);
    try {
      if (!(await fd.stat()).isFile()) return null;
      const buf = Buffer.alloc(4096);
      const { bytesRead } = await fd.read(buf, 0, buf.length, 0);
      t = buf.subarray(0, bytesRead).toString('utf8');
    } finally { await fd.close().catch(() => {}); }
  } catch { return null; }
  const m = /^gitdir:\s*(.+?)\s*$/m.exec(t || '');
  if (!m) return null;
  const gitdir = path.resolve(pastaReal, m[1]);
  const w = /^(.*)[/\\]\.git[/\\]worktrees[/\\][^/\\]+[/\\]?$/.exec(gitdir);
  return w && w[1] !== pastaReal ? w[1] : null;
}

// --- o que vai rodar ------------------------------------------------------------

function lerJson(ctx, e) {
  if (e.tipo !== 'arquivo' || !e.conteudo) return null;
  try {
    const v = JSON.parse(e.conteudo.toString('utf8').replace(/^﻿/, ''));
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  } catch { /* abaixo */ }
  avisar(ctx, 'json-invalido', e.rotulo);
  incerta(ctx, 'json-invalido', e.rotulo);
  return null;
}

function lista() { return { itens: [], total: 0 }; }
function por(l, item) {
  l.total += 1;
  if (l.itens.length < LIMITE.itens) l.itens.push(item);
}
const formatoEstranho = (ctx, rotulo, chave) => { avisar(ctx, 'formato-inesperado', rotulo, chave); incerta(ctx, 'formato-inesperado', rotulo); };
const comandoDe = (h) => [h.command, ...(Array.isArray(h.args) ? h.args : [])].filter((x) => x != null).map(String).join(' ');

function extrairSettings(ctx, s, origem, roda, cmds) {
  if (s.hooks !== undefined) {
    if (!s.hooks || typeof s.hooks !== 'object' || Array.isArray(s.hooks)) formatoEstranho(ctx, origem, 'hooks');
    else {
      for (const [evento, grupos] of Object.entries(s.hooks)) {
        if (!Array.isArray(grupos)) { formatoEstranho(ctx, origem, `hooks.${evento}`); continue; }
        for (const g of grupos) {
          if (!g || typeof g !== 'object' || !Array.isArray(g.hooks)) { formatoEstranho(ctx, origem, `hooks.${evento}`); continue; }
          for (const h of g.hooks) {
            if (!h || typeof h !== 'object') { formatoEstranho(ctx, origem, `hooks.${evento}`); continue; }
            const item = { evento: nomeDe(evento), tipo: nomeDe(h.type || 'command'), origem };
            if (g.matcher != null) item.filtro = limpo(g.matcher);
            if (h.command != null) { item.comando = limpo(comandoDe(h)); cmds.push(comandoDe(h)); }
            if (h.url != null) item.endereco = limpo(h.url);
            if (h.server != null) item.servidor = limpo(h.server);
            if (h.tool != null) item.ferramenta = limpo(h.tool);
            if (h.prompt != null) item.texto = limpo(h.prompt);
            por(roda.hooks, item);
          }
        }
      }
    }
  }
  const p = s.permissions;
  if (p !== undefined && (!p || typeof p !== 'object')) formatoEstranho(ctx, origem, 'permissions');
  else if (p) {
    if (p.allow !== undefined) {
      if (!Array.isArray(p.allow)) formatoEstranho(ctx, origem, 'permissions.allow');
      else for (const r of p.allow) por(roda.allow, { regra: limpo(r), origem });
    }
    if (p.defaultMode !== undefined) por(roda.outros, { chave: 'permissions.defaultMode', valor: limpo(p.defaultMode), origem });
    if (Array.isArray(p.additionalDirectories)) for (const d of p.additionalDirectories) por(roda.outros, { chave: 'permissions.additionalDirectories', valor: limpo(d), origem });
  }
  for (const k of COM_COMANDO) {
    if (s[k] == null) continue;
    const c = typeof s[k] === 'object' ? s[k].command : s[k];
    por(roda.outros, { chave: k, valor: limpo(c), origem });
    if (c != null) cmds.push(String(c));
  }
  for (const k of AJUDANTES) {
    if (s[k] == null) continue;
    por(roda.outros, { chave: k, valor: limpo(s[k]), origem });
    cmds.push(String(s[k]));
  }
  // env: só os nomes (o valor pode ser segredo).
  if (s.env && typeof s.env === 'object') for (const nome of Object.keys(s.env)) por(roda.outros, { chave: 'env', valor: nomeDe(nome), origem });
  if (s.enabledPlugins && typeof s.enabledPlugins === 'object') for (const [nome, lig] of Object.entries(s.enabledPlugins)) if (lig) por(roda.outros, { chave: 'enabledPlugins', valor: nomeDe(nome), origem });
  if (s.extraKnownMarketplaces && typeof s.extraKnownMarketplaces === 'object') for (const nome of Object.keys(s.extraKnownMarketplaces)) por(roda.outros, { chave: 'extraKnownMarketplaces', valor: nomeDe(nome), origem });
  for (const k of ['enableAllProjectMcpServers', 'autoMemoryDirectory']) if (s[k] !== undefined) por(roda.outros, { chave: k, valor: limpo(JSON.stringify(s[k])), origem });
  if (Array.isArray(s.enabledMcpjsonServers)) for (const n of s.enabledMcpjsonServers) por(roda.outros, { chave: 'enabledMcpjsonServers', valor: nomeDe(n), origem });
}

// .mcp.json: a pasta mais perto vence (o CLI junta da mais longe para a mais
// perto, e a de perto sobrescreve o mesmo nome).
function extrairMcp(ctx, arquivos, roda, cmds) {
  const servidores = new Map();
  for (const { e, j } of arquivos) {
    if (!j) continue;
    if (j.mcpServers === undefined) continue;
    if (!j.mcpServers || typeof j.mcpServers !== 'object' || Array.isArray(j.mcpServers)) { formatoEstranho(ctx, e.rotulo, 'mcpServers'); continue; }
    for (const [nome, c] of Object.entries(j.mcpServers)) servidores.set(nome, { c, origem: e.rotulo });
  }
  for (const [nome, { c, origem }] of servidores) {
    if (!c || typeof c !== 'object') { formatoEstranho(ctx, origem, `mcpServers.${nome}`); continue; }
    const item = { nome: nomeDe(nome), tipo: nomeDe(c.type || (c.url ? 'http' : 'stdio')), origem };
    if (c.command != null) { item.comando = limpo(comandoDe(c)); cmds.push(comandoDe(c)); }
    if (c.url != null) item.endereco = limpo(c.url);
    if (c.env && typeof c.env === 'object') item.env = Object.keys(c.env).slice(0, 20).map(nomeDe);
    if (c.headers && typeof c.headers === 'object') item.cabecalhos = Object.keys(c.headers).slice(0, 20).map(nomeDe);
    por(roda.mcp, item);
  }
}

// Arquivos da pasta citados nos comandos (ex.: "python3 .claude/hooks/x.py",
// "$CLAUDE_PROJECT_DIR/scripts/y.sh", "node ./mcp/servidor.js"): mudar o
// script muda o que roda sem mudar o settings, então ele entra na conta. É o
// melhor possível: o script pode chamar outros arquivos (package.json,
// node_modules...) que não entram.
async function lerScripts(ctx, cmds) {
  const vistos = new Set();
  for (const c of cmds) {
    // A pasta entra depois de partir o comando (ela pode ter espaço); as aspas
    // saem antes ("$CLAUDE_PROJECT_DIR"/x.sh é um caminho só).
    const t = String(c).replace(/\$\{?CLAUDE_PROJECT_DIR\}?/g, '\0P\0').replace(/["']/g, '');
    for (const pedaco of t.split(/[\s;|&()<>`=]+/)) {
      const bruto = pedaco.replaceAll('\0P\0', ctx.pasta);
      if (vistos.size >= LIMITE.scripts) return;
      if (!bruto || !(bruto.includes('/') || bruto.startsWith('.'))) continue;
      if (bruto.startsWith('-') || /^[a-z][a-z0-9+.-]*:\/\//i.test(bruto)) continue;
      const abs = path.resolve(ctx.pasta, bruto.startsWith('~/') ? path.join(ctx.casa, bruto.slice(2)) : bruto);
      if (!dentro(ctx.pasta, abs) || abs === ctx.pasta || vistos.has(abs)) continue;
      const st = await fsp.stat(abs).catch(() => null);
      if (!st || !st.isFile()) continue;
      vistos.add(abs);
      await lerArquivo(ctx, abs, 'script');
    }
  }
}

// --- medir uma pasta -----------------------------------------------------------

async function caminhoReal(pasta) {
  if (typeof pasta !== 'string' || !pasta) throw erroPasta('pasta não informada');
  if (pasta.includes('\0')) throw erroPasta('caminho de pasta inválido');
  if (!path.isAbsolute(pasta)) throw erroPasta('a pasta precisa de caminho absoluto');
  let real;
  try { real = await fsp.realpath(pasta); } catch (err) { throw erroPasta(`a pasta não existe ou não abre (${err.code || 'erro'})`); }
  const st = await fsp.stat(real);
  if (!st.isDirectory()) throw erroPasta('o caminho não é uma pasta');
  return { real, dev: st.dev, ino: st.ino };
}

async function medir(pasta, { casa = casaPadrao() } = {}) {
  const { real, dev, ino } = await caminhoReal(pasta);
  const casaReal = await fsp.realpath(casa).catch(() => path.resolve(casa));
  const ctx = novoContexto(real, casaReal);
  const roda = { hooks: lista(), mcp: lista(), allow: lista(), outros: lista(), instrucoes: lista(), extras: { skills: 0, commands: 0, agents: 0, hooks: 0, 'output-styles': 0, workflows: 0 } };
  const cmds = [];

  // 1. settings do projeto (e o local do repositório principal, num worktree).
  const settings = [path.join(real, '.claude', 'settings.json'), path.join(real, '.claude', 'settings.local.json')];
  const principal = await raizPrincipalDoWorktree(real);
  if (principal) settings.push(path.join(principal, '.claude', 'settings.local.json'));
  for (const abs of settings) {
    const e = await lerArquivo(ctx, abs, 'config');
    const j = lerJson(ctx, e);
    if (j) extrairSettings(ctx, j, e.rotulo, roda, cmds);
  }

  // 2. .mcp.json da pasta e das de cima (da mais longe para a mais perto).
  const acima = pastasAcima(real, casaReal);
  const mcps = [];
  for (const d of [...acima].reverse().concat(real)) {
    const e = await lerArquivo(ctx, path.join(d, '.mcp.json'), 'config');
    mcps.push({ e, j: lerJson(ctx, e) });
  }
  extrairMcp(ctx, mcps, roda, cmds);

  // 3. instruções: CLAUDE.md, .claude/CLAUDE.md, .claude/rules/**.md e
  //    CLAUDE.local.md, da mais longe para a mais perto, com as importações.
  const vistos = new Set();
  const arvore = [];
  for (const d of [...acima].reverse().concat(real)) {
    await lerInstrucao(ctx, path.join(d, 'CLAUDE.md'), 0, vistos, arvore);
    await lerInstrucao(ctx, path.join(d, '.claude', 'CLAUDE.md'), 0, vistos, arvore);
    for (const abs of await lerPasta(ctx, path.join(d, '.claude', 'rules'), 'instrucoes', { soMd: true, ler: false })) {
      await lerInstrucao(ctx, abs, 0, vistos, arvore);
    }
    await lerInstrucao(ctx, path.join(d, 'CLAUDE.local.md'), 0, vistos, arvore);
  }
  for (const a of arvore) por(roda.instrucoes, a);

  // 4. o que o projeto traz para o CLI usar: skills, comandos e agentes (da
  //    pasta e das de cima até a casa), hooks, estilos e workflows (da pasta).
  for (const tipo of ['skills', 'commands', 'agents']) {
    for (const d of [...acima].reverse().concat(real)) roda.extras[tipo] += (await lerPasta(ctx, path.join(d, '.claude', tipo), 'extra')).length;
  }
  for (const tipo of ['hooks', 'output-styles', 'workflows']) roda.extras[tipo] += (await lerPasta(ctx, path.join(real, '.claude', tipo), 'extra')).length;

  // 5. scripts da pasta citados pelos comandos.
  await lerScripts(ctx, cmds);

  // Impressão: versão + cada entrada que existe (ausente não entra; criar um
  // arquivo novo muda a conta do mesmo jeito).
  const arquivos = {};
  for (const e of [...ctx.entradas.values()].sort((a, b) => (a.rotulo < b.rotulo ? -1 : a.rotulo > b.rotulo ? 1 : 0))) {
    if (e.tipo === 'ausente') continue;
    arquivos[e.rotulo] = e.tipo === 'arquivo' ? e.sha256 : `${e.tipo}:${e.tamanho ?? ''}:${e.link ?? ''}:${e.codigo ?? ''}`;
  }
  const impressao = crypto.createHash('sha256').update(JSON.stringify([VERSAO_IMPRESSAO, real, arquivos])).digest('hex');
  return { real, dev, ino, impressao, arquivos, roda, avisos: ctx.avisos, incerta: ctx.incerta };
}

// --- o que mudou ---------------------------------------------------------------

const alvoHook = (h) => h.comando ?? h.endereco ?? (h.servidor != null || h.ferramenta != null ? `${h.servidor ?? ''}/${h.ferramenta ?? ''}` : h.texto ?? '');
const chaveHook = (h) => `hook|${h.evento}|${h.filtro ?? ''}|${h.tipo}|${alvoHook(h)}|${h.origem}`;
const chaveMcp = (m) => `mcp|${m.nome}|${m.comando ?? ''}|${m.endereco ?? ''}|${m.origem}`;
const chaveAllow = (a) => `allow|${a.regra}|${a.origem}`;
const chaveOutro = (o) => `outro|${o.chave}|${o.valor}|${o.origem}`;

function itensDe(roda) {
  return [
    ...roda.hooks.itens.map((h) => ({ tipo: 'hook', chave: chaveHook(h), item: h })),
    ...roda.mcp.itens.map((m) => ({ tipo: 'mcp', chave: chaveMcp(m), item: m })),
    ...roda.allow.itens.map((a) => ({ tipo: 'allow', chave: chaveAllow(a), item: a })),
    ...roda.outros.itens.map((o) => ({ tipo: 'outro', chave: chaveOutro(o), item: o })),
  ];
}

function mudancasEntre(guardado, atual) {
  const r = [];
  const antes = guardado.arquivos || {};
  for (const [rot, d] of Object.entries(atual.arquivos)) {
    if (!(rot in antes)) r.push({ tipo: 'arquivo', acao: 'novo', rotulo: limpo(rot) });
    else if (antes[rot] !== d) r.push({ tipo: 'arquivo', acao: 'mudou', rotulo: limpo(rot) });
  }
  for (const rot of Object.keys(antes)) if (!(rot in atual.arquivos)) r.push({ tipo: 'arquivo', acao: 'removido', rotulo: limpo(rot) });
  const velhos = new Map((guardado.itens || []).map((i) => [i.chave, i]));
  const novos = itensDe(atual.roda);
  const chavesNovas = new Set(novos.map((i) => i.chave));
  for (const i of novos) if (!velhos.has(i.chave)) r.push({ tipo: i.tipo, acao: 'novo', item: i.item });
  for (const [k, i] of velhos) if (!chavesNovas.has(k)) r.push({ tipo: i.tipo, acao: 'removido', item: i.item });
  // O que roda vem antes do arquivo que mudou: é o que o cartão destaca.
  const peso = { hook: 0, mcp: 1, allow: 2, outro: 3, arquivo: 4 };
  r.sort((a, b) => peso[a.tipo] - peso[b.tipo]);
  return { itens: r.slice(0, LIMITE.mudancas), mais: Math.max(0, r.length - LIMITE.mudancas) };
}

// --- registro dos aceites --------------------------------------------------------
// ~/.config/orq-app/confianca.json, modo 600: { versao, pastas: { realpath: aceite } }.
// Gravação atômica (temporário + rename), uma por vez (fila), relendo o arquivo
// antes de cada gravação (nenhum aceite antigo se perde). A versão anterior é
// guardada em ~/.local/share/orq-app/versoes/confianca/. Arquivo estragado não
// é apagado nem sobrescrito sem cópia: fica ao lado (.estragado-<data>), e
// enquanto isso nenhuma pasta conta como aceita.

const carimbo = () => `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`;

async function lerRegistro(arq) {
  let bruto;
  try { bruto = await fsp.readFile(arq, 'utf8'); } catch (err) {
    if (err.code === 'ENOENT') return { pastas: {}, estragado: false, existe: false };
    return { pastas: {}, estragado: true, existe: true, erro: err.code };
  }
  try {
    const j = JSON.parse(bruto);
    if (j && typeof j === 'object' && !Array.isArray(j) && j.pastas && typeof j.pastas === 'object' && !Array.isArray(j.pastas)) {
      const pastas = {};
      for (const [k, v] of Object.entries(j.pastas)) {
        if (v && typeof v === 'object' && typeof v.impressao === 'string' && /^[0-9a-f]{64}$/.test(v.impressao)) pastas[k] = v;
      }
      return { pastas, estragado: false, existe: true };
    }
  } catch { /* abaixo */ }
  return { pastas: {}, estragado: true, existe: true };
}

const filas = new Map();
function naFila(arq, fn) {
  const anterior = filas.get(arq) || Promise.resolve();
  const p = anterior.then(fn, fn);
  filas.set(arq, p.catch(() => {}));
  return p;
}

async function gravarRegistro(arq, versoes, mudar) {
  return naFila(arq, async () => {
    const atual = await lerRegistro(arq);
    await fsp.mkdir(path.dirname(arq), { recursive: true, mode: 0o700 });
    if (atual.estragado && atual.existe) {
      const copia = `${arq}.estragado-${carimbo()}`;
      await fsp.copyFile(arq, copia, fs.constants.COPYFILE_EXCL);
      await fsp.chmod(copia, 0o600);
      console.error(`[confianca] ${arq} não era um registro válido; o original ficou guardado em ${copia}`);
    } else if (atual.existe) {
      await fsp.mkdir(versoes, { recursive: true, mode: 0o700 });
      const copia = path.join(versoes, `${carimbo()}.json`);
      await fsp.copyFile(arq, copia, fs.constants.COPYFILE_EXCL);
      await fsp.chmod(copia, 0o600);
    }
    const pastas = mudar({ ...atual.pastas });
    const tmp = `${arq}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    const fd = await fsp.open(tmp, 'wx', 0o600);
    try {
      await fd.writeFile(JSON.stringify({ versao: 1, pastas }, null, 2) + '\n');
      await fd.sync();
    } finally { await fd.close(); }
    await fsp.rename(tmp, arq);
    return pastas;
  });
}

// --- interface ------------------------------------------------------------------

// Resultados que este módulo emitiu: aceitar() só aceita um deles (um objeto
// montado por fora, por exemplo vindo da tela, não vira aceite).
const emitidos = new WeakSet();

function opcoesDe(o = {}) {
  const casa = o.casa || casaPadrao();
  return { casa, arquivo: o.arquivo || arquivoPadrao(casa), versoes: o.versoes || versoesPadrao(casa), container: o.container === true };
}

// Verifica uma pasta. Devolve:
//   pasta       caminho real (é ele que vai como cwd do CLI)
//   estado      'nunca-vista' | 'aceita' (igual ao aceite) | 'mudou'
//   perguntar   true = mostrar o cartão
//   lembrar     false = o aceite não será guardado (container ou incerta)
//   motivos     por que pergunta: nunca-vista, mudou, container, incerta, registro-estragado
//   mudancas    (estado 'mudou') { itens: [{tipo, acao, rotulo|item}], mais }
//   oQueRoda    { hooks, mcp, allow, outros, instrucoes: {itens, total}, extras: {skills, ...} }
//   avisos      [{tipo, rotulo, detalhe}] (link para fora, JSON inválido, importação de fora...)
//   incerta     [{motivo, rotulo}] (vazio quando deu para conferir tudo)
//   impressao   sha256 do que o CLI lê
//   semProjeto  argumentos para abrir sem as configurações do projeto
async function verificar(pasta, opcoes = {}) {
  const o = opcoesDe(opcoes);
  const m = await medir(pasta, o);
  const reg = await lerRegistro(o.arquivo);
  const guardado = Object.prototype.hasOwnProperty.call(reg.pastas, m.real) ? reg.pastas[m.real] : null;
  let estado = 'nunca-vista';
  let mudancas = null;
  if (guardado && guardado.impressao === m.impressao) estado = 'aceita';
  else if (guardado) { estado = 'mudou'; mudancas = mudancasEntre(guardado, m); }
  const motivos = [];
  if (estado !== 'aceita') motivos.push(estado);
  if (o.container) motivos.push('container');
  if (m.incerta.length) motivos.push('incerta');
  if (reg.estragado) motivos.push('registro-estragado');
  const r = {
    pedida: pasta,
    pasta: m.real,
    estado,
    perguntar: motivos.length > 0,
    lembrar: !o.container && m.incerta.length === 0,
    motivos,
    mudancas,
    oQueRoda: m.roda,
    avisos: m.avisos,
    incerta: m.incerta,
    impressao: m.impressao,
    container: o.container,
    semProjeto: argumentosSemProjeto(),
  };
  Object.defineProperty(r, '_medida', { value: { dev: m.dev, ino: m.ino, arquivos: m.arquivos, itens: itensDe(m.roda).slice(0, 4 * LIMITE.itens).map(({ tipo, chave, item }) => ({ tipo, chave, item })) }, enumerable: false });
  emitidos.add(r);
  return r;
}

// Grava o aceite do que o usuário viu no cartão (a impressão do resultado, não
// uma medida nova: se a pasta mudou entre o cartão e o clique, a próxima
// verificação diz "mudou"). Container ou incerta: não grava.
async function aceitar(resultado, opcoes = {}) {
  if (!resultado || !emitidos.has(resultado)) throw new Error('aceitar: use o resultado de verificar()');
  if (resultado.container) return { lembrado: false, motivo: 'container' };
  if (resultado.incerta.length) return { lembrado: false, motivo: 'incerta' };
  const o = opcoesDe(opcoes);
  const { arquivos, itens } = resultado._medida;
  await gravarRegistro(o.arquivo, o.versoes, (pastas) => {
    pastas[resultado.pasta] = { impressao: resultado.impressao, quando: new Date().toISOString(), arquivos, itens };
    return pastas;
  });
  return { lembrado: true };
}

// Logo antes de abrir a conversa: mede de novo e confere que é a mesma pasta
// (mesmo caminho real, mesma pasta no disco) com o mesmo conteúdo que o
// usuário aceitou ou viu. Diferente → não abrir; mostrar o cartão de novo.
async function conferirNaHora(resultado, opcoes = {}) {
  if (!resultado || !emitidos.has(resultado)) throw new Error('conferirNaHora: use o resultado de verificar()');
  const o = opcoesDe(opcoes);
  let m;
  try { m = await medir(resultado.pedida, o); } catch (err) { return { ok: false, motivo: 'pasta-sumiu', detalhe: err.message }; }
  if (m.real !== resultado.pasta) return { ok: false, motivo: 'outra-pasta' };
  if (m.dev !== resultado._medida.dev || m.ino !== resultado._medida.ino) return { ok: false, motivo: 'outra-pasta' };
  if (m.impressao !== resultado.impressao) return { ok: false, motivo: 'mudou', mudancas: mudancasEntre(resultado._medida, m) };
  return { ok: true, pasta: m.real };
}

module.exports = {
  verificar,
  aceitar,
  conferirNaHora,
  argumentosSemProjeto,
  SEM_PROJETO,
  LIMITE,
  arquivoPadrao,
  _interno: { importsDe, pastasAcima, limpo, medir, lerRegistro },
};
