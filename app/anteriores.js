// Conversas anteriores (plano 3.2): o que o Claude guardou neste computador, para a pessoa
// achar, reabrir, arquivar e apagar pela tela "Anteriores".
//
// Cada conversa do Claude é um arquivo <projects>/<pasta-do-projeto>/<sessão>.jsonl. Há
// arquivo de 100+ MB, então a lista NUNCA lê um arquivo inteiro: de cada um, só o começo e
// o fim (64 KB cada). O que achou fica num índice (caminho + tamanho + data do arquivo), e
// só o arquivo que mudou é lido de novo. Tudo assíncrono, poucos arquivos por vez: a tela
// não trava.
//
// O que sai de cada arquivo: o título (o nome dado com /rename, senão a primeira mensagem
// da pessoa), a pasta em que a conversa rodava (o "cwd" das linhas), o tamanho e a data.
// Arquivo de subagente (agent-*.jsonl, ou marcado como conversa de lado) e arquivo sem
// mensagem da pessoa ficam de fora.
//
// Arquivadas: as conversas que a pessoa arquivou (saem da lista da esquerda e ficam aqui).
// É só uma marca do app; o arquivo do Claude não muda.
//
// Nada do que vem dos arquivos é confiável: título e pasta são cortados e limpos antes de
// irem para a tela, e a pasta só vale se for um caminho completo.
const fs = require('fs');
const os = require('os');
const path = require('path');

const fsp = fs.promises;
const FATIA = 64 * 1024; // o começo e o fim de cada arquivo
const JUNTOS = 4; // arquivos lidos ao mesmo tempo
const MAX_ARQUIVOS = 5000;
const SESSAO = /^[\w-]{6,80}$/;
const VERSAO = 1;

const pastaProjetos = () => path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
const cache = () => path.join(os.homedir(), '.cache', 'orq-app');
const deTeste = () => process.env.ORQ_APP_TESTE === '1';
const arqIndice = () => path.join(cache(), deTeste() ? 'anteriores-indice-teste.json' : 'anteriores-indice.json');
const arqArquivadas = () => path.join(cache(), deTeste() ? 'arquivadas-teste.json' : 'arquivadas.json');

const limpo = (s, n) => String(s == null ? '' : s).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

// O texto de uma mensagem da pessoa, ou '' se a linha não é uma (comando, meta, conversa de lado).
function textoDaPessoa(d) {
  if (!d || d.type !== 'user' || !d.message || d.isMeta || d.isSidechain) return '';
  const c = d.message.content;
  const t = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join(' ') : '';
  return t && !/^\s*</.test(t) ? t : '';
}

// Lê o começo e o fim do arquivo e resume: { titulo, pasta, mensagens, deLado }.
// mensagens conta só o que apareceu nesses dois pedaços (basta saber se há alguma).
async function resumir(arq, tam) {
  const fh = await fsp.open(arq, 'r');
  let linhas;
  try {
    const ler = async (de, n) => { const b = Buffer.alloc(n); await fh.read(b, 0, n, de); return b.toString('utf8').split('\n'); };
    if (tam <= 2 * FATIA) linhas = await ler(0, tam); // cabe inteiro nos dois pedaços: nenhuma linha fica cortada
    else {
      const cabeca = await ler(0, FATIA);
      cabeca.pop(); // a última linha do começo pode estar cortada
      const fim = await ler(tam - FATIA, FATIA);
      fim.shift(); // a primeira linha do fim também
      linhas = [...cabeca, ...fim];
    }
  } finally { await fh.close(); }
  let primeira = '', dado = '', pasta = '', mensagens = 0, deLado = false, vistas = 0;
  for (const l of linhas) {
    if (!l) continue;
    let d;
    try { d = JSON.parse(l); } catch { continue; }
    if (!d || typeof d !== 'object') continue;
    if (vistas++ < 5 && d.isSidechain === true) deLado = true;
    if (!pasta && typeof d.cwd === 'string' && path.isAbsolute(d.cwd) && !d.cwd.includes('\0') && d.cwd.length <= 4096) pasta = d.cwd;
    if (d.type === 'custom-title' && typeof d.customTitle === 'string' && d.customTitle.trim()) dado = d.customTitle; // o último vale
    const t = textoDaPessoa(d);
    if (t) { mensagens++; if (!primeira) primeira = t; }
  }
  return { titulo: limpo(dado || primeira, 100), pasta, mensagens, deLado };
}

async function emGrupos(itens, n, fn) {
  let i = 0;
  const um = async () => { while (i < itens.length) { const item = itens[i++]; await fn(item); } };
  await Promise.all(Array.from({ length: Math.min(n, itens.length) }, um));
}

async function lerJson(arq) {
  try { return JSON.parse(await fsp.readFile(arq, 'utf8')); } catch { return null; }
}
async function gravarJson(arq, dado) {
  await fsp.mkdir(path.dirname(arq), { recursive: true });
  const tmp = `${arq}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(dado) + '\n');
  await fsp.rename(tmp, arq);
}

// A lista das conversas guardadas, da mais nova para a mais antiga:
// [{ sessao, arquivo, titulo, pasta, bytes, quando }]. Não lê mais que 128 KB por arquivo.
let andando = null; // uma varredura por vez: quem pede junto espera a mesma
function listar() {
  if (!andando) andando = varrer().finally(() => { andando = null; });
  return andando;
}
async function varrer() {
  const raiz = pastaProjetos();
  let pastas = [];
  try { pastas = await fsp.readdir(raiz, { withFileTypes: true }); } catch { return []; }
  const arquivos = [];
  for (const p of pastas) {
    if (!p.isDirectory() || arquivos.length >= MAX_ARQUIVOS) continue;
    let nomes = [];
    try { nomes = await fsp.readdir(path.join(raiz, p.name)); } catch { continue; }
    for (const n of nomes) {
      if (arquivos.length >= MAX_ARQUIVOS) break;
      if (!n.endsWith('.jsonl') || n.startsWith('agent-')) continue;
      const sessao = n.slice(0, -'.jsonl'.length);
      if (SESSAO.test(sessao)) arquivos.push({ arq: path.join(raiz, p.name, n), sessao });
    }
  }
  const guardado = await lerJson(arqIndice());
  const indice = guardado && guardado.versao === VERSAO && guardado.arquivos && typeof guardado.arquivos === 'object' ? guardado.arquivos : {};
  const novo = {};
  let mudou = false;
  const porSessao = new Map();
  await emGrupos(arquivos, JUNTOS, async (a) => {
    let st;
    try { st = await fsp.stat(a.arq); } catch { return; }
    if (!st.isFile()) return;
    const g = indice[a.arq];
    let dados = g && g.tam === st.size && g.mtime === st.mtimeMs && g.dados && typeof g.dados === 'object' ? g.dados : null;
    if (!dados) {
      try { dados = await resumir(a.arq, st.size); } catch { return; }
      mudou = true;
    }
    novo[a.arq] = { tam: st.size, mtime: st.mtimeMs, dados };
    if (!dados.mensagens || dados.deLado) return;
    const item = { sessao: a.sessao, arquivo: a.arq, titulo: limpo(dados.titulo, 100) || '(sem título)', pasta: typeof dados.pasta === 'string' && path.isAbsolute(dados.pasta) ? dados.pasta : '', bytes: st.size, quando: st.mtimeMs };
    // A mesma sessão em duas pastas (pasta renomeada): vale a cópia mais nova.
    const outra = porSessao.get(a.sessao);
    if (!outra || outra.quando < item.quando) porSessao.set(a.sessao, item);
  });
  if (mudou || Object.keys(indice).length !== Object.keys(novo).length) {
    try { await gravarJson(arqIndice(), { versao: VERSAO, arquivos: novo }); } catch { /* sem o índice a lista só fica mais lenta */ }
  }
  return [...porSessao.values()].sort((a, b) => b.quando - a.quando);
}

// --- o que a pessoa já escreveu (o ↑ e o Ctrl+R da caixa de mensagem; plano 4.4) -------------
// As mensagens que a pessoa escreveu nas conversas guardadas de uma pasta, da mais nova para a
// mais antiga, sem repetir. Vem só do fim (256 KB) dos arquivos mais novos daquela pasta. É
// leitura: nada disso é gravado em lugar nenhum (o texto pode ter colagens da pessoa).
// Fica de fora o que não foi digitado como mensagem (comando, saída de comando, texto de
// bastidor, que começam com "<") e o que o app anexou depois do texto (menções: tudo a partir
// do primeiro bloco "---").
const FATIA_PROMPTS = 256 * 1024;
async function promptsDaPasta(pasta, { arquivos = 8, max = 200 } = {}) {
  if (typeof pasta !== 'string' || !pasta) return [];
  const lista = (await listar()).filter((x) => x.pasta === pasta).slice(0, arquivos);
  const vistos = new Set();
  const saida = [];
  for (const x of lista) {
    if (saida.length >= max) break;
    let linhas = [];
    try {
      const fh = await fsp.open(x.arquivo, 'r');
      try {
        const tam = (await fh.stat()).size;
        const n = Math.min(FATIA_PROMPTS, tam);
        const b = Buffer.alloc(n);
        await fh.read(b, 0, n, tam - n);
        linhas = b.toString('utf8').split('\n');
        if (tam > n) linhas.shift(); // a primeira linha do pedaço pode estar cortada
      } finally { await fh.close(); }
    } catch { continue; }
    for (let i = linhas.length - 1; i >= 0 && saida.length < max; i--) {
      if (!linhas[i]) continue;
      let d;
      try { d = JSON.parse(linhas[i]); } catch { continue; }
      const t = textoDaPessoa(d).split('\n\n---\n')[0].replace(/\u0000/g, '').trim();
      if (!t || t.length > 20000 || vistos.has(t)) continue;
      vistos.add(t);
      saida.push(t);
    }
  }
  return saida;
}

// --- arquivadas ---------------------------------------------------------------------
// { sessão: { quando, titulo, motor, pasta } }: o que a tela precisa para mostrar a conversa
// arquivada mesmo quando o arquivo dela não é do Claude (conversa do Codex).
function lerArquivadas() {
  let d = null;
  try { d = JSON.parse(fs.readFileSync(arqArquivadas(), 'utf8')); } catch { /* ainda não há, ou o arquivo estragou */ }
  const s = d && d.versao === VERSAO && d.sessoes && typeof d.sessoes === 'object' && !Array.isArray(d.sessoes) ? d.sessoes : {};
  const limpa = {};
  for (const [id, v] of Object.entries(s)) {
    if (!SESSAO.test(id) || !v || typeof v !== 'object') continue;
    limpa[id] = { quando: Number.isFinite(v.quando) ? v.quando : 0, titulo: limpo(v.titulo, 100), motor: v.motor === 'codex' ? 'codex' : 'claude', pasta: typeof v.pasta === 'string' && path.isAbsolute(v.pasta) ? v.pasta : '' };
  }
  return limpa;
}
function gravarArquivadas(s) {
  const arq = arqArquivadas();
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  const tmp = `${arq}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ versao: VERSAO, sessoes: s }, null, 2) + '\n');
  fs.renameSync(tmp, arq);
}
function arquivar(sessao, { titulo = '', motor = 'claude', pasta = '' } = {}) {
  if (!SESSAO.test(String(sessao || ''))) return false;
  const s = lerArquivadas();
  s[sessao] = { quando: Date.now(), titulo: limpo(titulo, 100), motor: motor === 'codex' ? 'codex' : 'claude', pasta: typeof pasta === 'string' && path.isAbsolute(pasta) ? pasta : '' };
  gravarArquivadas(s);
  return true;
}
function desarquivar(sessao) {
  const s = lerArquivadas();
  if (!Object.prototype.hasOwnProperty.call(s, sessao)) return false;
  delete s[sessao];
  gravarArquivadas(s);
  return true;
}

module.exports = { listar, resumir, promptsDaPasta, lerArquivadas, arquivar, desarquivar, pastaProjetos, FATIA, SESSAO, _arquivos: { indice: arqIndice, arquivadas: arqArquivadas } };
