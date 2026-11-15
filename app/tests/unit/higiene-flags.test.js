// Área: seguranca (higiene: nenhuma flag que desliga aprovação ou sandbox entra escondida)
// 0.A6 da Etapa 0 (O5 da segurança). Varre os montadores de argumentos das IAs
// procurando flags que desligam a aprovação ou o sandbox. Toda ocorrência tem
// de estar na lista abaixo, com o porquê; uma nova falha o teste até alguém
// decidir (e explicar aqui e no SECURITY.md). Entrada da lista que não acha mais
// a flag também falha: a lista não guarda exceção que já saiu do código.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', '..');
const MONTADORES = ['conversa.js', 'conversa-codex.js', 'avulso.js', 'workflows.js'];

// O que desliga aprovação ou sandbox, no Claude Code e no Codex.
const PERIGOSAS = [
  { nome: '--dangerously-*', re: /dangerously[-_]/i },
  { nome: '--yolo', re: /--yolo\b/ },
  { nome: '--force', re: /--force\b/ },
  { nome: '--full-auto', re: /--full-auto\b/ },
  { nome: 'bypassPermissions', re: /bypassPermissions/ },
  { nome: 'danger-full-access', re: /danger-full-access/ },
  { nome: "approvalPolicy: 'never'", re: /approval[_-]?policy['"]?\s*[:=]\s*['"]never['"]|--ask-for-approval[\s=]+never|['"]-a['"]\s*,\s*['"]never['"]/i },
];

// A lista nomeada: cada exceção com o arquivo, o trecho exato e o porquê.
const PERMITIDAS = [
  {
    arquivo: 'avulso.js', flag: '--dangerously-*', trecho: 'codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox',
    porque: 'Pedido avulso Codex: o sandbox do próprio Codex não funciona dentro de container. Quem limita é o Docker: container descartável (--rm), '
      + 'mesmo firewall do devcontainer, pasta do projeto só leitura a não ser que o usuário aprove escrita. Ninguém responde perguntas ali.',
  },
  {
    arquivo: 'conversa-codex.js', flag: 'danger-full-access', trecho: "sandbox: 'danger-full-access'",
    porque: 'Orquestrador Codex: precisa de tmux e docker, que o sandbox do Codex bloqueia mesmo com o comando aprovado. Roda fora do sandbox, '
      + 'com a política "untrusted" e o revisor automático do Codex (auto_review) decidindo pelo risco. Escolha do usuário em 2026-11-12.',
  },
];

// Linhas de código (sem os comentários de linha inteira) de cada montador.
function linhasDeCodigo(arquivo) {
  return fs.readFileSync(path.join(APP, arquivo), 'utf8').split('\n')
    .map((texto, i) => ({ arquivo, n: i + 1, texto }))
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l.texto));
}

function achados() {
  const lista = [];
  for (const arquivo of MONTADORES) {
    for (const l of linhasDeCodigo(arquivo)) {
      for (const p of PERIGOSAS) if (p.re.test(l.texto)) lista.push({ ...l, flag: p.nome });
    }
  }
  return lista;
}

test('higiene: flag que desliga aprovação ou sandbox só com exceção nomeada e explicada', () => {
  const fora = achados().filter((a) => !PERMITIDAS.some((x) => x.arquivo === a.arquivo && x.flag === a.flag && a.texto.includes(x.trecho)));
  assert.deepStrictEqual(fora.map((a) => `${a.arquivo}:${a.n} ${a.flag}: ${a.texto.trim()}`), [],
    'flag nova que desliga aprovação/sandbox: ponha na lista PERMITIDAS com o porquê (e no SECURITY.md), ou tire');
});

test('higiene: toda exceção da lista ainda existe no código e tem o porquê', () => {
  const tem = achados();
  for (const x of PERMITIDAS) {
    assert.ok(x.porque && x.porque.length > 40, `${x.arquivo}: falta o porquê`);
    assert.ok(tem.some((a) => a.arquivo === x.arquivo && a.flag === x.flag && a.texto.includes(x.trecho)), `${x.arquivo}: "${x.trecho}" não está mais no código; tire da lista`);
  }
});

test('higiene: o detector pega as formas conhecidas (controle)', () => {
  const pega = (t) => PERIGOSAS.filter((p) => p.re.test(t)).map((p) => p.nome);
  assert.deepStrictEqual(pega("args.push('--dangerously-skip-permissions')"), ['--dangerously-*']);
  assert.deepStrictEqual(pega("'--allow-dangerously-skip-permissions'"), ['--dangerously-*']);
  assert.deepStrictEqual(pega("['--permission-mode', 'bypassPermissions']"), ['bypassPermissions']);
  assert.deepStrictEqual(pega("const P = { approvalPolicy: 'never' }"), ["approvalPolicy: 'never'"]);
  assert.deepStrictEqual(pega("['exec', '-a', 'never']"), ["approvalPolicy: 'never'"]);
  assert.deepStrictEqual(pega("['exec', '--yolo']"), ['--yolo']);
  assert.deepStrictEqual(pega("['--permission-mode', 'auto']"), []);
  assert.deepStrictEqual(pega("['exec', '--sandbox', 'read-only']"), []);
});

test('higiene: o SECURITY.md fala das duas exceções', () => {
  const sec = fs.readFileSync(path.join(APP, '..', 'SECURITY.md'), 'utf8');
  assert.match(sec, /--dangerously-bypass-approvals-and-sandbox/);
  assert.match(sec, /danger-full-access/);
  assert.match(sec, /auto_review/);
});
