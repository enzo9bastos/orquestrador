// Anexos do canal entre orquestradores (imagem e PDF pelo ntfy).
//
// Só o que não depende de rede nem de Electron mora aqui, para o CLI
// (orq-recado) e o app usarem o mesmo código:
//   - tipo conferido pelos BYTES (a extensão sozinha não vale) e tamanho;
//   - retirada de metadados (EXIF, XMP, texto, hora) de PNG, JPEG e WebP, sem
//     reencodar: copia só os blocos de imagem, então a imagem não muda e não
//     perde qualidade. PDF vai como está (o PDF pode ter autor e título: o
//     cartão de aprovação avisa);
//   - nome de arquivo seguro, pasta 700, arquivo 600, nunca sobrescreve.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TIPOS = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', pdf: 'application/pdf' };
const EXTENSAO = { png: 'png', jpg: 'jpg', jpeg: 'jpg', webp: 'webp', pdf: 'pdf' };
const MAX_PADRAO = 5 * 1024 * 1024;
const MAX_ANEXOS = 3;
const casa = (p) => String(p || '').replace(/^~(?=$|\/)/, os.homedir());

function tamanhoLegivel(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 102.4) / 10} KB`;
  return `${Math.round((b / 1024 / 1024) * 10) / 10} MB`;
}
const mb = tamanhoLegivel;

// png | jpg | webp | pdf | null, pelos primeiros bytes.
function tipoPorBytes(b) {
  if (!Buffer.isBuffer(b) || b.length < 12) return null;
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (b.toString('latin1', 0, 5) === '%PDF-') return 'pdf';
  return null;
}
const ehImagem = (tipo) => tipo === 'png' || tipo === 'jpg' || tipo === 'webp';
const extensaoDe = (nome) => EXTENSAO[path.extname(String(nome || '')).slice(1).toLowerCase()] || null;

// Abre sem seguir link simbólico e lê no máximo `max` bytes. Devolve
// { nome, tipo, bytes, buf } ou { erro } (mensagem para o usuário).
function lerArquivo(arquivo, { max = MAX_PADRAO } = {}) {
  const abs = path.resolve(casa(arquivo));
  const nome = path.basename(abs);
  const porExt = extensaoDe(nome);
  if (!porExt) return { erro: `${nome}: só aceito png, jpg, jpeg, webp e pdf` };
  let fd;
  try {
    fd = fs.openSync(abs, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch (e) {
    return { erro: `${nome}: ${e.code === 'ELOOP' ? 'link simbólico não vale; indique o arquivo de verdade' : e.code === 'ENOENT' ? 'arquivo não encontrado' : `não consegui abrir (${e.code || e.message})`}` };
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return { erro: `${nome}: não é um arquivo comum` };
    if (st.size > max) return { erro: `${nome}: ${mb(st.size)}; o limite é ${mb(max)} por arquivo` };
    if (st.size < 12) return { erro: `${nome}: arquivo vazio ou pequeno demais` };
    const buf = Buffer.alloc(st.size);
    let lido = 0;
    while (lido < st.size) { const n = fs.readSync(fd, buf, lido, st.size - lido, lido); if (!n) break; lido += n; }
    const tipo = tipoPorBytes(buf.subarray(0, lido));
    if (!tipo) return { erro: `${nome}: o conteúdo não é png, jpg, webp nem pdf (conferi os bytes, não só a extensão)` };
    if (tipo !== porExt) return { erro: `${nome}: a extensão diz ${porExt}, mas o conteúdo é ${tipo}; recusei` };
    return { nome, tipo, bytes: lido, buf: buf.subarray(0, lido) };
  } finally { fs.closeSync(fd); }
}

// --- retirada de metadados -----------------------------------------------------
const corrompido = () => Object.assign(new Error('imagem corrompida ou cortada: não consegui retirar os metadados'), { corrompida: true });

// JPEG: tira EXIF/XMP (APP1), IPTC e afins (APP3 a APP13, APP15) e comentários.
// Fica o que muda a cor ou o desenho: JFIF (APP0), perfil ICC (APP2) e Adobe (APP14).
function limparJpg(b) {
  const partes = [b.subarray(0, 2)];
  const retirado = [];
  let i = 2;
  for (;;) {
    if (i + 1 >= b.length) throw corrompido();
    if (b[i] !== 0xff) throw corrompido();
    let m = b[i + 1];
    if (m === 0xff) { i++; continue; } // enchimento
    if (m === 0xd9) { partes.push(b.subarray(i)); break; }
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { partes.push(b.subarray(i, i + 2)); i += 2; continue; }
    if (i + 4 > b.length) throw corrompido();
    const tam = b.readUInt16BE(i + 2);
    if (tam < 2 || i + 2 + tam > b.length) throw corrompido();
    if (m === 0xda) { partes.push(b.subarray(i)); break; } // dados da imagem até o fim
    const seg = b.subarray(i, i + 2 + tam);
    const icc = m === 0xe2 && seg.toString('latin1', 4, 15) === 'ICC_PROFILE';
    const tirar = m === 0xfe || (m >= 0xe1 && m <= 0xef && m !== 0xee && !icc);
    if (tirar) retirado.push(m === 0xfe ? 'comentário' : m === 0xe1 ? (seg.toString('latin1', 4, 8) === 'Exif' ? 'EXIF' : 'XMP') : `APP${m - 0xe0}`);
    else partes.push(seg);
    i += 2 + tam;
  }
  return { buf: Buffer.concat(partes), retirado };
}

// PNG: só os blocos que desenham a imagem; texto, EXIF, hora e afins saem.
const PNG_FICA = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'cICP', 'acTL', 'fcTL', 'fdAT']);
function limparPng(b) {
  const partes = [b.subarray(0, 8)];
  const retirado = [];
  let i = 8;
  let fim = false;
  while (i < b.length) {
    if (i + 12 > b.length) throw corrompido();
    const tam = b.readUInt32BE(i);
    const tipo = b.toString('latin1', i + 4, i + 8);
    if (i + 12 + tam > b.length) throw corrompido();
    if (PNG_FICA.has(tipo)) partes.push(b.subarray(i, i + 12 + tam));
    else retirado.push(tipo === 'eXIf' ? 'EXIF' : tipo);
    i += 12 + tam;
    if (tipo === 'IEND') { fim = true; break; }
  }
  if (!fim) throw corrompido();
  return { buf: Buffer.concat(partes), retirado };
}

// WebP: tira os blocos EXIF e XMP e desliga as bandeiras deles no VP8X.
function limparWebp(b) {
  const total = b.readUInt32LE(4) + 8;
  if (total > b.length || total < 20) throw corrompido();
  const partes = [];
  const retirado = [];
  let i = 12;
  while (i + 8 <= total) {
    const tipo = b.toString('latin1', i, i + 4);
    const tam = b.readUInt32LE(i + 4);
    const ate = i + 8 + tam + (tam % 2);
    if (i + 8 + tam > total) throw corrompido();
    const bloco = b.subarray(i, Math.min(ate, total));
    if (tipo === 'EXIF' || tipo === 'XMP ') retirado.push(tipo.trim());
    else if (tipo === 'VP8X') { const c = Buffer.from(bloco); c[8] &= ~0x0c; partes.push(c); }
    else partes.push(bloco);
    i = ate;
  }
  const corpo = Buffer.concat(partes);
  const cab = Buffer.alloc(12);
  cab.write('RIFF', 0, 'latin1');
  cab.writeUInt32LE(corpo.length + 4, 4);
  cab.write('WEBP', 8, 'latin1');
  return { buf: Buffer.concat([cab, corpo]), retirado };
}

// { buf, retirado: [nomes do que saiu] }. PDF e tipo desconhecido passam como estão.
function limparMetadados(buf, tipo) {
  if (tipo === 'jpg') return limparJpg(buf);
  if (tipo === 'png') return limparPng(buf);
  if (tipo === 'webp') return limparWebp(buf);
  return { buf, retirado: [] };
}

// --- nome e pasta seguros ----------------------------------------------------
// Sem pasta, sem ponto na frente, só letras, números, ponto, hífen e sublinhado;
// a extensão vem do tipo conferido pelos bytes.
function nomeSeguro(nome, tipo) {
  const base = path.basename(String(nome || '').replace(/\\/g, '/'));
  const semExt = base.replace(/\.[A-Za-z0-9]{1,5}$/, '');
  let n = semExt.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/\.{2,}/g, '.').replace(/^[-._]+|[-._]+$/g, '').slice(0, 60);
  if (!n) n = 'anexo';
  return `${n}.${tipo === 'jpg' ? 'jpg' : tipo}`;
}

// Cria a pasta com modo 700 (e ajusta, se já existia mais aberta). Recusa link simbólico.
function pastaPrivada(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = fs.lstatSync(dir);
  if (st.isSymbolicLink() || !st.isDirectory()) throw new Error(`${dir} não é uma pasta comum`);
  if ((st.mode & 0o077) !== 0) fs.chmodSync(dir, 0o700);
  return dir;
}

// Grava com modo 600 sem nunca sobrescrever: nome repetido ganha -2, -3…
function gravarSemSobrescrever(dir, nome, buf) {
  const ext = path.extname(nome);
  const raiz = nome.slice(0, nome.length - ext.length);
  for (let n = 1; n < 1000; n++) {
    const alvo = path.join(dir, n === 1 ? nome : `${raiz}-${n}${ext}`);
    let fd;
    try { fd = fs.openSync(alvo, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600); }
    catch (e) { if (e.code === 'EEXIST') continue; throw e; }
    try { fs.writeSync(fd, buf, 0, buf.length); fs.fchmodSync(fd, 0o600); } finally { fs.closeSync(fd); }
    return alvo;
  }
  throw new Error('nomes demais iguais na pasta de anexos');
}

const dados = () => path.join(os.homedir(), '.local', 'share', 'orq-app');
// Onde o anexo que chega é guardado: a pasta configurada (canalPastaAnexos) ou,
// sem ela, dentro dos dados do app. Uma subpasta por dia.
const pastaRecebidos = () => path.join(dados(), 'anexos-canal');
const pastaSaida = () => path.join(dados(), 'recados', 'anexos-saida');
const dia = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function guardarRecebido(base, nome, tipo, buf, agora = new Date()) {
  const raiz = base ? casa(base) : pastaRecebidos();
  pastaPrivada(raiz);
  const pasta = pastaPrivada(path.join(raiz, dia(agora)));
  return gravarSemSobrescrever(pasta, nomeSeguro(nome, tipo), buf);
}

// Cópia exata do que o usuário vai aprovar (já sem metadados): o envio sai
// desta cópia, não do arquivo original, que pode mudar depois.
function guardarSaida(idRecado, itens) {
  const pasta = pastaPrivada(path.join(pastaSaida(), String(idRecado).replace(/[^A-Za-z0-9._-]/g, '_')));
  return itens.map((x, i) => {
    const arquivo = gravarSemSobrescrever(pasta, nomeSeguro(`${i + 1}-${x.nome}`, x.tipo), x.buf);
    return { nome: nomeSeguro(x.nome, x.tipo), tipo: x.tipo, bytes: x.buf.length, arquivo, sha256: crypto.createHash('sha256').update(x.buf).digest('hex'), retirado: x.retirado || [] };
  });
}

// Confere a cópia guardada de um anexo contra o que o usuário aprovou (tipo, tamanho e
// hash). { ok: true } ou { erro }.
function conferirCopia(x, { max = MAX_PADRAO } = {}) {
  const lido = lerArquivo(x.arquivo, { max });
  if (lido.erro) return { erro: `${x.nome}: ${lido.erro.replace(/^[^:]*: /, '')}` };
  if (x.sha256 && crypto.createHash('sha256').update(lido.buf).digest('hex') !== x.sha256) return { erro: `${x.nome}: o arquivo mudou depois de guardado; não vale aprovar nem enviar` };
  return { ok: true };
}

// Depois que o servidor confirmou TODOS os pedaços, a cópia de envio (a pasta
// saida/<id>) não serve mais: some. Só apaga a pasta desse recado, dentro da pasta
// de saída do app, e só o que é arquivo comum; o arquivo ORIGINAL do usuário nunca
// foi tocado (a cópia nasceu de uma leitura). Devolve quantos arquivos saíram.
function apagarSaida(idRecado) {
  const raiz = pastaSaida();
  const dir = path.join(raiz, String(idRecado).replace(/[^A-Za-z0-9._-]/g, '_'));
  if (path.dirname(dir) !== raiz) return 0;
  let st;
  try { st = fs.lstatSync(dir); } catch { return 0; }
  if (st.isSymbolicLink() || !st.isDirectory()) return 0;
  let n = 0;
  for (const nome of fs.readdirSync(dir)) {
    const f = path.join(dir, nome);
    if (fs.lstatSync(f).isFile()) { fs.unlinkSync(f); n++; }
  }
  try { fs.rmdirSync(dir); } catch { /* sobrou algo que não é nosso: fica */ }
  return n;
}

// "data:" para a tela mostrar a miniatura sem carregar nada de fora. Só imagem
// conferida pelos bytes, até o limite.
function miniatura(arquivo, { max = MAX_PADRAO } = {}) {
  try {
    const r = lerArquivo(arquivo, { max });
    if (r.erro || !ehImagem(r.tipo)) return null;
    return `data:${TIPOS[r.tipo]};base64,${r.buf.toString('base64')}`;
  } catch { return null; }
}

module.exports = { TIPOS, MAX_PADRAO, MAX_ANEXOS, tipoPorBytes, ehImagem, extensaoDe, lerArquivo, limparMetadados, nomeSeguro, pastaPrivada, gravarSemSobrescrever,
  guardarRecebido, guardarSaida, conferirCopia, apagarSaida, miniatura, pastaRecebidos, pastaSaida, tamanhoLegivel, mb, dia };
