// Imagens, GIFs e vídeos do computador mostrados dentro da conversa do app (pedido de 26/11: "seria
// bom ele mesmo poder mandar em tela cheia ou prévia imagens, vídeos, gifs, aí eu vejo pelo próprio
// app, ao invés de ele ficar abrindo na minha tela").
//
// O orquestrador (ou um agente, por recado) escreve na resposta ![legenda](/caminho/absoluto.gif);
// a tela troca por uma prévia que carrega o arquivo por orqmidia://local/<caminho codificado>.
// Aqui fica a regra de quais arquivos podem ser servidos: só imagem e vídeo (pela extensão e pelo
// começo do arquivo), arquivo comum (não pasta nem aparelho), dentro da pasta da pessoa ou da pasta
// temporária, e nunca de dentro das pastas de chaves e senhas. A tela nunca lê o disco direto.
const fs = require('fs');
const os = require('os');
const path = require('path');

const IMAGEM = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };
const VIDEO = { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mov: 'video/quicktime' };
const EXT = /\.(png|jpe?g|gif|webp|bmp|mp4|m4v|webm|ogv|mov)$/i;
// Pastas de onde nada é servido, mesmo sendo imagem (chaves, senhas, cofres, sessões).
const PROIBIDAS = ['.ssh', '.gnupg', '.password-store', '.aws', '.kube', '.docker', '.config/Bitwarden', '.mozilla', '.config/BraveSoftware', '.config/google-chrome', '.config/chromium'];
const MAX_BYTES = 300 * 1024 * 1024;

function tipoDe(caminho) {
  const e = path.extname(caminho).slice(1).toLowerCase();
  if (IMAGEM[e]) return { tipo: 'imagem', mime: IMAGEM[e] };
  if (VIDEO[e]) return { tipo: 'video', mime: VIDEO[e] };
  return null;
}

// Confere o começo do arquivo: um .png que não é PNG não passa.
function assinaturaBate(real, tipo) {
  let fd;
  const b = Buffer.alloc(16);
  try { fd = fs.openSync(real, 'r'); fs.readSync(fd, b, 0, 16, 0); } catch { return false; } finally { if (fd !== undefined) fs.closeSync(fd); }
  const h = b.toString('hex');
  const a = b.toString('latin1');
  if (tipo.mime === 'image/png') return h.startsWith('89504e47');
  if (tipo.mime === 'image/jpeg') return h.startsWith('ffd8ff');
  if (tipo.mime === 'image/gif') return a.startsWith('GIF8');
  if (tipo.mime === 'image/webp') return a.startsWith('RIFF') && a.slice(8, 12) === 'WEBP';
  if (tipo.mime === 'image/bmp') return a.startsWith('BM');
  if (tipo.mime === 'video/webm') return h.startsWith('1a45dfa3');
  if (tipo.mime === 'video/ogg') return a.startsWith('OggS');
  return a.slice(4, 8) === 'ftyp'; // mp4, m4v, mov
}

// { ok: true, real, tipo, mime, bytes } ou { ok: false, motivo }.
function validar(caminho, { casa = os.homedir(), tmp = os.tmpdir() } = {}) {
  let p = String(caminho || '');
  if (p.startsWith('~/')) p = path.join(casa, p.slice(2));
  if (!path.isAbsolute(p)) return { ok: false, motivo: 'o caminho precisa ser completo' };
  if (!EXT.test(p)) return { ok: false, motivo: 'só imagem (png, jpg, gif, webp, bmp) ou vídeo (mp4, webm, mov, ogv)' };
  let real;
  try { real = fs.realpathSync(p); } catch { return { ok: false, motivo: 'arquivo não encontrado' }; }
  const tipo = tipoDe(real);
  if (!tipo) return { ok: false, motivo: 'o arquivo de verdade não é imagem nem vídeo' };
  const raizes = [casa, tmp].map((r) => { try { return fs.realpathSync(r); } catch { return r; } });
  const dentro = (r) => real === r || real.startsWith(r + path.sep);
  if (!raizes.some(dentro)) return { ok: false, motivo: 'só arquivos da sua pasta pessoal ou da pasta temporária' };
  const rel = path.relative(raizes[0], real);
  if (dentro(raizes[0]) && PROIBIDAS.some((x) => rel === x || rel.startsWith(x + path.sep))) return { ok: false, motivo: 'pasta protegida (chaves e senhas)' };
  let st;
  try { st = fs.statSync(real); } catch { return { ok: false, motivo: 'arquivo não encontrado' }; }
  if (!st.isFile()) return { ok: false, motivo: 'não é um arquivo' };
  if (st.size > MAX_BYTES) return { ok: false, motivo: 'arquivo grande demais (mais de 300 MB)' };
  if (!assinaturaBate(real, tipo)) return { ok: false, motivo: 'o conteúdo não bate com a extensão' };
  return { ok: true, real, tipo: tipo.tipo, mime: tipo.mime, bytes: st.size };
}

const url = (caminho) => `orqmidia://local/${encodeURIComponent(caminho)}`;
function caminhoDaUrl(u) {
  const x = new URL(u);
  if (x.hostname !== 'local') throw new Error('endereço inválido');
  return decodeURIComponent(x.pathname.replace(/^\//, ''));
}

module.exports = { validar, tipoDe, url, caminhoDaUrl, EXT, MAX_BYTES };
