// Voltar os arquivos junto com a conversa (o ✎ dos balões; plano 7.1).
//
// Quem volta os arquivos é o próprio Claude, pelo pedido de controle rewind_files
// (conferido no 2.1.326):
//   { subtype: 'rewind_files', user_message_id, dry_run? }
//   → { canRewind, error?, filesChanged?: string[], insertions?, deletions?, skippedLinks? }
// São totais: não vem contagem por arquivo e não dá para escolher arquivo. Fora do
// terminal o Claude só guarda os pontos de volta se nasce com a variável
// CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING (conversa.js liga, pela configuração).
//
// Este módulo não fala com o Claude. Ele confere a resposta, descobre que arquivo foi
// alterado depois da última edição do Claude e guarda a cópia de como os arquivos
// estão agora, antes de a volta acontecer.
const fs = require('fs');
const os = require('os');
const path = require('path');
const jsonl = require('./jsonl');

const MAX_ARQUIVOS = 500;
const limpo = (s, n) => String(s == null ? '' : s).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);

// A resposta do Claude, conferida: { pode, lista, mais, menos, erro }. Lista que o app
// não consegue conferir inteira não vale: sem saber todos os arquivos, não dá para
// guardar a cópia de todos antes.
function conferirResposta(r) {
  const nao = (erro) => ({ pode: false, lista: [], mais: 0, menos: 0, erro: erro || null });
  if (!r || typeof r !== 'object' || r.canRewind !== true) return nao(r && typeof r.error === 'string' ? limpo(r.error, 300) : null);
  const bruta = r.filesChanged === undefined || r.filesChanged === null ? [] : r.filesChanged;
  if (!Array.isArray(bruta) || bruta.length > MAX_ARQUIVOS) return nao('a lista de arquivos veio num formato que o app não sabe conferir');
  if (!bruta.every((f) => typeof f === 'string' && f && f.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(f))) return nao('a lista de arquivos veio num formato que o app não sabe conferir');
  const inteiro = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
  return { pode: true, lista: [...new Set(bruta)], mais: inteiro(r.insertions), menos: inteiro(r.deletions), erro: null };
}

// Quando o Claude escreveu pela última vez em cada arquivo, depois da mensagem escolhida:
// Map(caminho absoluto → ms). Lê o transcript de trás para frente e para na mensagem
// (uuid). A hora é a do resultado da ferramenta (a escrita de verdade); sem ele, a do pedido.
const ESCREVEM = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
function ultimasEscritas(arqTranscript, uuid, pasta) {
  const quando = new Map();
  const resultados = new Map(); // id do uso da ferramenta → ms do resultado
  if (!arqTranscript) return quando;
  for (const { linha } of jsonl.linhasDeTras(arqTranscript)) {
    if (uuid && linha.includes(`"uuid":"${uuid}"`)) break;
    let d;
    try { d = JSON.parse(linha); } catch { continue; }
    if (!d || !d.message || !Array.isArray(d.message.content)) continue;
    const ts = Date.parse(d.timestamp) || 0;
    for (const b of d.message.content) {
      if (!b) continue;
      if (b.type === 'tool_result' && b.tool_use_id) resultados.set(b.tool_use_id, ts);
      else if (b.type === 'tool_use' && ESCREVEM.has(b.name) && b.input) {
        const f = b.input.file_path || b.input.notebook_path;
        if (typeof f !== 'string' || !f) continue;
        const abs = path.resolve(pasta, f);
        const t = resultados.get(b.id) || ts;
        if (t && !quando.has(abs)) quando.set(abs, t); // de trás para frente: a primeira que aparece é a mais nova
      }
    }
  }
  return quando;
}
// O arquivo foi alterado depois da última escrita do Claude (por alguém ou por um comando)?
// Só afirma quando sabe a hora da escrita; a folga cobre a diferença entre gravar e registrar.
function mexido(arquivo, escritas, pasta, folgaMs = 3000) {
  const abs = path.resolve(pasta, arquivo);
  const t = escritas.get(abs);
  if (!t) return false;
  try { return fs.statSync(abs).mtimeMs > t + folgaMs; } catch { return false; }
}

// Onde a cópia vai: uma pasta nova por volta, que nunca existe antes.
function destinoNovo(agora = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  const nome = `rewind-${agora.getFullYear()}-${p(agora.getMonth() + 1)}-${p(agora.getDate())}-${p(agora.getHours())}${p(agora.getMinutes())}${p(agora.getSeconds())}`;
  const base = path.join(os.homedir(), '.local', 'share', 'orq-app', 'versoes', nome);
  // Duas voltas no mesmo segundo: a segunda ganha um número (nunca a pasta da primeira).
  let destino = base;
  for (let i = 2; fs.existsSync(destino) && i < 100; i++) destino = `${base}-${i}`;
  return destino;
}
// O que seria copiado: [{ abs, destino, bytes }]. Arquivo que não existe agora não entra
// (não há o que guardar); link não entra (o Claude não restaura através de link).
function itensDaCopia(lista, pasta, raiz) {
  const itens = [];
  for (const f of lista) {
    const abs = path.resolve(pasta, f);
    let st = null;
    try { st = fs.lstatSync(abs); } catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') continue; throw e; }
    if (!st.isFile()) continue;
    const rel = path.relative(pasta, abs);
    const dentro = !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
    itens.push({ abs, destino: path.join(raiz, dentro ? rel : path.join('_fora_da_pasta', abs.replace(/^\/+/, ''))), bytes: st.size });
  }
  return itens;
}
function tamanho(lista, pasta) {
  try { return itensDaCopia(lista, pasta, '/').reduce((s, i) => s + i.bytes, 0); } catch { return null; }
}
// Guarda os arquivos como estão agora: { ok: true, pasta, bytes, copiados } ou
// { ok: false, erro }. Nunca escreve por cima: a pasta é nova e cada cópia é exclusiva.
function copiar(lista, pasta, raiz) {
  try {
    const itens = itensDaCopia(lista, pasta, raiz);
    fs.mkdirSync(path.dirname(raiz), { recursive: true });
    fs.mkdirSync(raiz); // falha se já existe: uma cópia nunca cai em cima de outra
    for (const i of itens) {
      fs.mkdirSync(path.dirname(i.destino), { recursive: true });
      fs.copyFileSync(i.abs, i.destino, fs.constants.COPYFILE_EXCL);
    }
    return { ok: true, pasta: raiz, bytes: itens.reduce((s, i) => s + i.bytes, 0), copiados: itens.length };
  } catch (e) { return { ok: false, erro: e.message }; }
}
// Caminho como a pessoa lê: com ~ no lugar da casa.
function exibir(p) {
  const casa = os.homedir();
  return p === casa || p.startsWith(casa + path.sep) ? `~${p.slice(casa.length)}` : p;
}

module.exports = { conferirResposta, ultimasEscritas, mexido, destinoNovo, tamanho, copiar, exibir, MAX_ARQUIVOS };
