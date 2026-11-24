// Atualizar pelo app: procura a última versão lançada no repositório de onde o app foi instalado,
// mostra o que mudou e, a pedido, avança a pasta do app até ela.
//
// "Versão lançada" é uma tag vX.Y.Z que já está no ramo publicado (o ramo que a pasta acompanha
// no remoto): nunca um commit solto. O único acesso à rede é o `git fetch` desse repositório,
// sem perguntar nada (credencial faltando: falha e avisa; não abre pedido de senha).
//
//   procurar(pasta, { buscar })  → { instalada, ultima, notas, pode, motivo, comando, erro, quando }
//       ultima: { versao, tag } ou null (já está na última); notas: [{ versao, data, itens }]
//       pode: dá para atualizar por aqui; senão, motivo diz por quê e comando mostra como fazer à mão
//   aplicar(pasta, versao)       → { ok, versao } ou { erro, detalhe }
//
// Motivos: 'em-dia', 'sem-rede', 'sem-git', 'sem-ramo', 'sem-origem' (nada a oferecer) e 'mexido',
// 'nao-avanco', 'dependencias' (há versão nova, mas não dá para aplicar por aqui).
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const ambiente = () => ({
  ...process.env,
  GIT_TERMINAL_PROMPT: '0', // nunca pede usuário e senha
  GCM_INTERACTIVE: 'never',
  GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || 'ssh -o BatchMode=yes', // nem a senha da chave
  LC_ALL: 'C',
});
function git(pasta, args, ms = 15000) {
  return new Promise((ok) => {
    execFile('git', args, { cwd: pasta, timeout: ms, maxBuffer: 8 * 1024 * 1024, env: ambiente() },
      (erro, saida, falha) => ok({ ok: !erro, saida: String(saida || ''), falha: String(falha || '') }));
  });
}
// O que o git disse, em uma linha e sem credencial (um endereço pode ter usuário e senha embutidos).
const semSegredo = (t) => String(t || '').trim().split('\n').filter(Boolean).pop()?.replace(/\/\/[^@\s/]+@/g, '//').slice(0, 240) || '';

const partes = (v) => { const m = String(v || '').match(/^v?(\d+)\.(\d+)\.(\d+)$/); return m ? m.slice(1).map(Number) : null; };
function compara(a, b) {
  const x = partes(a), y = partes(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

// A versão que está na pasta do app (o package.json no disco): depois de aplicar e antes de
// reiniciar, é maior do que a versão que está rodando.
function versaoInstalada(pasta) {
  try { const v = JSON.parse(fs.readFileSync(path.join(pasta, 'package.json'), 'utf8')).version; return partes(v) ? v : null; } catch { return null; }
}

async function situacao(pasta) {
  const r = await git(pasta, ['rev-parse', '--show-toplevel']);
  if (!r.ok || !r.saida.trim()) return { ok: false, motivo: 'sem-git' };
  const raiz = r.saida.trim();
  const ramo = (await git(raiz, ['symbolic-ref', '--short', '-q', 'HEAD'])).saida.trim();
  if (!ramo) return { ok: false, motivo: 'sem-ramo', raiz };
  const ac = await git(raiz, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  const acompanha = ac.ok ? ac.saida.trim() : '';
  if (!acompanha || !acompanha.includes('/')) return { ok: false, motivo: 'sem-origem', raiz, ramo };
  const prefixo = (await git(pasta, ['rev-parse', '--show-prefix'])).saida.trim();
  return { ok: true, raiz, ramo, acompanha, remoto: acompanha.split('/')[0], prefixo };
}

// O que mudou, do CHANGELOG da versão nova: as entradas "## X.Y.Z (data)" acima da instalada.
function lerNotas(texto, instalada, ate) {
  const notas = [];
  let atual = null;
  for (const linha of String(texto || '').split('\n')) {
    const t = linha.match(/^##\s+v?(\d+\.\d+\.\d+)(?:\s+\(([^)]*)\))?\s*$/);
    if (t) {
      atual = (!instalada || compara(t[1], instalada) > 0) && compara(t[1], ate) <= 0 ? { versao: t[1], data: t[2] || '', itens: [] } : null;
      if (atual) notas.push(atual);
    } else if (atual) {
      if (/^[-*]\s+/.test(linha)) atual.itens.push(linha.replace(/^[-*]\s+/, '').trim());
      else if (/^\s+\S/.test(linha) && atual.itens.length) atual.itens[atual.itens.length - 1] += ` ${linha.trim()}`;
    }
  }
  return notas.sort((a, b) => compara(b.versao, a.versao)).slice(0, 12).map((n) => ({ ...n, itens: n.itens.slice(0, 30).map((i) => i.slice(0, 600)) }));
}

async function procurar(pasta, { buscar = true } = {}) {
  const base = { instalada: versaoInstalada(pasta), ultima: null, notas: [], pode: false, motivo: null, comando: null, erro: null, quando: Date.now() };
  const s = await situacao(pasta);
  if (!s.ok) return { ...base, motivo: s.motivo };
  if (buscar) {
    const f = await git(s.raiz, ['fetch', '--quiet', '--tags', s.remoto], 45000);
    if (!f.ok) base.erro = semSegredo(f.falha) || 'o git não respondeu';
  }
  const t = await git(s.raiz, ['tag', '--list', 'v*', '--merged', s.acompanha]);
  const tag = t.saida.split('\n').map((x) => x.trim()).filter(partes).sort(compara).pop() || null;
  if (!tag || (base.instalada && compara(tag, base.instalada) <= 0)) return { ...base, motivo: base.erro ? 'sem-rede' : 'em-dia' };
  const versao = tag.replace(/^v/, '');
  const log = await git(s.raiz, ['show', `${tag}:CHANGELOG.md`]);
  const notas = log.ok ? lerNotas(log.saida, base.instalada, versao) : [];
  // Dá para aplicar por aqui? Nada mexido à mão, avanço simples e as mesmas dependências.
  const mexido = (await git(s.raiz, ['status', '--porcelain', '--untracked-files=no'])).saida.trim() !== '';
  const avanco = (await git(s.raiz, ['merge-base', '--is-ancestor', 'HEAD', tag])).ok;
  const dependencias = !(await git(s.raiz, ['diff', '--quiet', 'HEAD', tag, '--', `${s.prefixo}package-lock.json`])).ok;
  const motivo = mexido ? 'mexido' : !avanco ? 'nao-avanco' : dependencias ? 'dependencias' : null;
  const comando = motivo === 'dependencias' ? `cd ${s.raiz} && git merge --ff-only ${tag} && cd ${path.join(s.raiz, s.prefixo)} && npm install`
    : motivo ? `cd ${s.raiz} && git status` : null;
  return { ...base, ultima: { versao, tag }, notas, pode: !motivo, motivo, comando };
}

async function aplicar(pasta, versao) {
  const r = await procurar(pasta, { buscar: false });
  if (!r.ultima || r.ultima.versao !== versao) return { erro: 'mudou' };
  if (!r.pode) return { erro: r.motivo };
  const s = await situacao(pasta);
  const m = await git(s.raiz, ['merge', '--ff-only', '--quiet', r.ultima.tag], 60000);
  if (!m.ok) return { erro: 'falhou', detalhe: semSegredo(m.falha) };
  return { ok: true, versao };
}

module.exports = { procurar, aplicar, versaoInstalada, compara, _lerNotas: lerNotas, _semSegredo: semSegredo };
