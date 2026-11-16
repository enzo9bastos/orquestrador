#!/usr/bin/env node
// Versão do app: escolhe o próximo número, grava em app/package.json e
// app/package-lock.json e abre a entrada no CHANGELOG.md. Quem publica chama
// isto antes do commit; a tag vX.Y.Z e a Release saem depois dos testes.
//
//   node scripts/versao.js atual                        mostra a versão do package.json
//   node scripts/versao.js preparar <tipo> "<o que mudou>" [notas.md]
//                                                       tipo: recurso (0.X+1.0) ou correcao (0.X.Y+1)
//   node scripts/versao.js notas <versão>               mostra a entrada do CHANGELOG (para a Release)
//
// Publicação repetida depois de falhar não sobe o número duas vezes: enquanto a
// versão do package.json tiver entrada no CHANGELOG e ainda não tiver tag, ela
// é a versão pendente e vale como está.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const partes = (v) => {
  const m = String(v || '').match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) throw new Error(`versão inválida: "${v}" (esperado X.Y.Z)`);
  return m.slice(1).map(Number);
};
const maior = (a, b) => { const x = partes(a), y = partes(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? a : b; return a; };

function proxima(atual, tipo) {
  const [a, b, c] = partes(atual);
  if (tipo === 'recurso') return `${a}.${b + 1}.0`;
  if (tipo === 'correcao') return `${a}.${b}.${c + 1}`;
  throw new Error(`tipo inválido: "${tipo}" (use recurso ou correcao)`);
}

function tags(raiz) {
  try {
    return execFileSync('git', ['tag', '-l', 'v*'], { cwd: raiz, stdio: ['ignore', 'pipe', 'ignore'] }).toString().split('\n')
      .map((t) => t.trim().replace(/^v/, '')).filter((t) => /^\d+\.\d+\.\d+$/.test(t));
  } catch { return []; }
}

const arqPacote = (raiz) => path.join(raiz, 'app', 'package.json');
const arqLock = (raiz) => path.join(raiz, 'app', 'package-lock.json');
const arqLog = (raiz) => path.join(raiz, 'CHANGELOG.md');
const lerJson = (arq) => JSON.parse(fs.readFileSync(arq, 'utf8'));
const gravarJson = (arq, o) => fs.writeFileSync(arq, JSON.stringify(o, null, 2) + '\n');
const atual = (raiz) => lerJson(arqPacote(raiz)).version;
const titulo = (versao) => new RegExp(`^## ${versao.replace(/\./g, '\\.')}(?: |$)`, 'm');

// A entrada de uma versão no CHANGELOG, sem o título; null se não existe.
function notasDa(raiz, versao) {
  let log;
  try { log = fs.readFileSync(arqLog(raiz), 'utf8'); } catch { return null; }
  const m = titulo(versao).exec(log);
  if (!m) return null;
  const resto = log.slice(m.index).split('\n').slice(1).join('\n');
  const fim = resto.search(/^## /m);
  return (fim < 0 ? resto : resto.slice(0, fim)).trim();
}

function preparar({ raiz, tipo, msg, notas, hoje = new Date().toISOString().slice(0, 10) }) {
  const noPacote = atual(raiz);
  const comTag = tags(raiz);
  proxima(noPacote, tipo); // valida o tipo mesmo quando a versão fica como está
  // Pendente: já tem entrada no CHANGELOG e ainda não ganhou a tag.
  if (!comTag.includes(noPacote) && notasDa(raiz, noPacote) !== null) return { versao: noPacote, mudou: false };
  const versao = proxima(comTag.reduce(maior, noPacote), tipo);

  const pacote = lerJson(arqPacote(raiz));
  pacote.version = versao;
  gravarJson(arqPacote(raiz), pacote);
  if (fs.existsSync(arqLock(raiz))) {
    const lock = lerJson(arqLock(raiz));
    lock.version = versao;
    if (lock.packages && lock.packages['']) lock.packages[''].version = versao;
    gravarJson(arqLock(raiz), lock);
  }

  const corpo = (notas ? fs.readFileSync(notas, 'utf8') : `- ${String(msg || '').trim()}`).trim();
  if (!corpo || corpo === '-') throw new Error('faltou dizer o que mudou');
  const entrada = `## ${versao} (${hoje})\n\n${corpo}\n\n`;
  let log = '# Changelog\n\n';
  try { log = fs.readFileSync(arqLog(raiz), 'utf8'); } catch { /* primeiro CHANGELOG */ }
  const primeira = log.search(/^## /m);
  fs.writeFileSync(arqLog(raiz), primeira < 0 ? `${log.replace(/\s*$/, '\n\n')}${entrada}` : log.slice(0, primeira) + entrada + log.slice(primeira));
  return { versao, mudou: true };
}

module.exports = { proxima, preparar, notasDa, atual };

if (require.main === module) {
  const [cmd, a, b, c] = process.argv.slice(2);
  const raiz = path.join(__dirname, '..');
  const base = fs.existsSync(arqPacote(process.cwd())) ? process.cwd() : raiz;
  try {
    if (cmd === 'atual') console.log(atual(base));
    else if (cmd === 'preparar') console.log(preparar({ raiz: base, tipo: a, msg: b, notas: c }).versao);
    else if (cmd === 'notas') { const n = notasDa(base, a); if (n === null) throw new Error(`o CHANGELOG não tem a versão ${a}`); console.log(n); }
    else throw new Error('uso: versao.js atual | preparar <recurso|correcao> "<o que mudou>" [notas.md] | notas <versão>');
  } catch (e) { console.error(e.message); process.exit(1); }
}
