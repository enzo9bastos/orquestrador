// Escrita do app (no host) dentro da pasta de um projeto, à prova de link
// simbólico.
//
// O agente roda num container que monta a pasta do projeto com escrita, então
// ele pode trocar qualquer coisa em <projeto>/.orq por um link simbólico para
// fora (ex.: .orq/bin → ~/.claude/hooks). O app roda no host, com o poder do
// usuário: se seguisse o link, gravaria fora do projeto. Por isso toda escrita
// do app numa pasta de projeto passa por aqui:
//   - o caminho é relativo ao projeto, sem "..", e fica dentro do realpath dele;
//   - nenhuma parte do caminho dentro do projeto pode ser link simbólico
//     (conferido com lstat, parte por parte), e o arquivo é aberto com
//     O_NOFOLLOW;
//   - no Linux, o arquivo aberto ainda é conferido pelo /proc/self/fd: se uma
//     pasta foi trocada por link entre a conferência e a abertura, nada é escrito;
//   - o rename só acontece para um destino conferido (que não existe, ou é um
//     arquivo comum).
// O que não passa é recusado com um erro que diz o motivo (code ORQ_RECUSADO).
const fs = require('fs');
const path = require('path');

const crypto = require('crypto');

const { O_WRONLY, O_RDONLY, O_CREAT, O_EXCL, O_NOFOLLOW, O_NONBLOCK } = fs.constants;

function recusa(motivo) {
  const e = new Error(motivo);
  e.code = 'ORQ_RECUSADO';
  return e;
}

const raizReal = (projeto) => fs.realpathSync(projeto);

function partesDe(rel) {
  const partes = (Array.isArray(rel) ? rel : [rel]).flatMap((p) => String(p).split('/')).filter((p) => p && p !== '.');
  if (!partes.length || partes.some((p) => p === '..')) throw recusa(`caminho inválido dentro do projeto: ${partes.join('/')}`);
  return partes;
}

// lstat que devolve null quando não existe.
function lstat(p) {
  try { return fs.lstatSync(p); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

// Confere as pastas do caminho (todas as partes menos a última): nenhuma pode
// ser link; com criar, as que faltam são criadas uma a uma.
function conferirPastas(raiz, partes, { criar = false } = {}) {
  let atual = raiz;
  for (const p of partes) {
    atual = path.join(atual, p);
    let st = lstat(atual);
    if (!st && criar) {
      try { fs.mkdirSync(atual); } catch (e) { if (e.code !== 'EEXIST') throw e; }
      st = lstat(atual);
    }
    if (!st) return null; // não existe (e não era para criar)
    if (st.isSymbolicLink()) throw recusa(`${path.relative(raiz, atual)} é um link simbólico: o app não grava nem segue link dentro do projeto`);
    if (!st.isDirectory()) throw recusa(`${path.relative(raiz, atual)} não é uma pasta`);
  }
  return atual;
}

// Caminho absoluto conferido (dentro do projeto, sem link em nenhuma parte).
// O último item pode não existir; se existe, não pode ser link (a não ser com
// aceitarLink, para mover o próprio link sem seguir).
function caminho(projeto, rel, { criarPastas = false, aceitarLink = false } = {}) {
  const raiz = raizReal(projeto);
  const partes = partesDe(rel);
  const pasta = conferirPastas(raiz, partes.slice(0, -1), { criar: criarPastas });
  const abs = path.join(pasta || path.join(raiz, ...partes.slice(0, -1)), partes[partes.length - 1]);
  const st = pasta ? lstat(abs) : null;
  if (st && st.isSymbolicLink() && !aceitarLink) throw recusa(`${partes.join('/')} é um link simbólico: o app não grava nem segue link dentro do projeto`);
  return { raiz, abs, existe: !!st, st, pastaExiste: !!pasta };
}

// Depois de abrir: o arquivo aberto tem de estar dentro do projeto.
function conferirAberto(fd, raiz, rel) {
  let real;
  try { real = fs.readlinkSync(`/proc/self/fd/${fd}`); } catch { return; } // fora do Linux: fica a conferência por lstat
  if (real !== raiz && !real.startsWith(raiz + path.sep)) {
    fs.closeSync(fd);
    throw recusa(`${rel} foi parar fora do projeto (uma pasta virou link no meio do caminho): nada foi gravado`);
  }
}

// O_NONBLOCK: um FIFO (ou outro arquivo especial) posto no lugar não trava a
// abertura; depois de aberto, só arquivo comum passa.
function abrir(projeto, rel, flags, modo) {
  const c = caminho(projeto, rel, { criarPastas: !!(flags & O_CREAT) });
  const nome = partesDe(rel).join('/');
  let fd;
  try { fd = fs.openSync(c.abs, flags | O_NOFOLLOW | O_NONBLOCK, modo); } catch (e) {
    if (e.code === 'ELOOP') throw recusa(`${nome} é um link simbólico: o app não grava nem segue link dentro do projeto`);
    if (e.code === 'ENXIO') throw recusa(`${nome} existe e não é um arquivo comum`); // FIFO sem leitor
    throw e;
  }
  if (!fs.fstatSync(fd).isFile()) { fs.closeSync(fd); throw recusa(`${nome} existe e não é um arquivo comum`); }
  conferirAberto(fd, c.raiz, nome);
  return { fd, ...c };
}

// Pasta conferida (cria o que falta). Devolve o caminho absoluto.
function garantirPasta(projeto, rel) {
  return conferirPastas(raizReal(projeto), partesDe(rel), { criar: true });
}

// Grava um arquivo inteiro: temporário novo (O_EXCL) + rename para o destino
// conferido. modo: permissões do arquivo novo. tmp: começo do nome do
// temporário; o fim é sorteado (um nome previsível o agente plantaria antes,
// e o O_EXCL falharia sempre).
function gravar(projeto, rel, conteudo, { modo = 0o644, tmp = null } = {}) {
  const partes = partesDe(rel);
  const destino = caminho(projeto, partes, { criarPastas: true });
  if (destino.existe && !destino.st.isFile()) throw recusa(`${partes.join('/')} existe e não é um arquivo comum`);
  let t = null;
  let relTmp = null;
  for (let i = 0; !t; i++) {
    relTmp = [...partes.slice(0, -1), `${tmp || `.${partes[partes.length - 1]}`}.${crypto.randomBytes(8).toString('hex')}.tmp`];
    try { t = abrir(projeto, relTmp, O_WRONLY | O_CREAT | O_EXCL, modo); } catch (e) { if (e.code !== 'EEXIST' || i >= 4) throw e; }
  }
  try {
    fs.writeSync(t.fd, conteudo);
    if (modo) fs.fchmodSync(t.fd, modo); // o umask pode ter tirado bits (ex.: o +x do script); pelo fd, nunca pelo caminho
  } finally { fs.closeSync(t.fd); }
  mover(projeto, relTmp, partes);
  return destino.abs;
}

// Cria um arquivo novo; se já existe (mesmo como link), falha com EEXIST.
function criarNovo(projeto, rel, conteudo, { modo = 0o644 } = {}) {
  const a = abrir(projeto, rel, O_WRONLY | O_CREAT | O_EXCL, modo);
  try { fs.writeSync(a.fd, conteudo); } finally { fs.closeSync(a.fd); }
  return a.abs;
}

// Lê um arquivo do projeto sem seguir link.
function ler(projeto, rel, codificacao = 'utf8') {
  const a = abrir(projeto, rel, O_RDONLY);
  try { return fs.readFileSync(a.fd, codificacao); } finally { fs.closeSync(a.fd); }
}

// Move dentro do projeto, sem seguir link: a origem pode ser um link (é o
// próprio link que vai); o destino não pode ser link nem pasta.
function mover(projeto, relOrigem, relDestino) {
  const o = caminho(projeto, relOrigem, { aceitarLink: true });
  if (!o.existe) { const e = new Error(`${partesDe(relOrigem).join('/')} não existe`); e.code = 'ENOENT'; throw e; }
  const d = caminho(projeto, relDestino, { criarPastas: true });
  if (d.existe && !d.st.isFile()) throw recusa(`${partesDe(relDestino).join('/')} existe e não é um arquivo comum`);
  fs.renameSync(o.abs, d.abs);
  return d.abs;
}

// Marca de tempo (cria vazio se não existe), sem seguir link.
function tocar(projeto, rel) {
  const a = abrir(projeto, rel, O_WRONLY | O_CREAT, 0o644);
  try { const agora = new Date(); fs.futimesSync(a.fd, agora, agora); } finally { fs.closeSync(a.fd); }
}

const ehRecusa = (e) => !!(e && e.code === 'ORQ_RECUSADO');

module.exports = { caminho, garantirPasta, gravar, criarNovo, ler, mover, tocar, ehRecusa, recusa };
