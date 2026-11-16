// Área: versao (número de versão, CHANGELOG e notas da Release)
// O script que o publicar usa: escolhe a próxima versão, grava no
// package.json e no package-lock.json, abre a entrada no CHANGELOG, e não
// sobe o número duas vezes quando a publicação é repetida depois de falhar.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', '..', '..', 'scripts', 'versao.js');
const git = (d, ...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: d, stdio: 'pipe' }).toString();
const ler = (d, rel) => fs.readFileSync(path.join(d, rel), 'utf8');

function repo(versao = '0.2.1') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-versao-'));
  fs.mkdirSync(path.join(d, 'app'));
  fs.writeFileSync(path.join(d, 'app', 'package.json'), JSON.stringify({ name: 'app', version: versao, main: 'main.js' }, null, 2) + '\n');
  fs.writeFileSync(path.join(d, 'app', 'package-lock.json'), JSON.stringify({ name: 'app', version: versao, lockfileVersion: 3, packages: { '': { name: 'app', version: versao }, 'node_modules/x': { version: '1.8.0' } } }, null, 2) + '\n');
  fs.writeFileSync(path.join(d, 'CHANGELOG.md'), `# Changelog\n\nAll notable changes.\n\n## ${versao} (2026-11-16)\n\n- Earlier work.\n`);
  git(d, 'init', '-q'); git(d, 'add', '.'); git(d, 'commit', '-qm', 'um'); git(d, 'tag', `v${versao}`);
  return d;
}

test('versao: a próxima versão conforme o tipo', () => {
  const { proxima } = require(SCRIPT);
  assert.strictEqual(proxima('0.2.1', 'correcao'), '0.2.2');
  assert.strictEqual(proxima('0.2.1', 'recurso'), '0.3.0');
  assert.strictEqual(proxima('0.9.9', 'recurso'), '0.10.0');
  assert.throws(() => proxima('0.2.1', 'qualquer'), /recurso|correcao/);
  assert.throws(() => proxima('abc', 'correcao'), /versão/);
});

test('versao: preparar grava package.json, package-lock.json e a entrada do CHANGELOG', () => {
  const { preparar, notasDa } = require(SCRIPT);
  const d = repo();
  const r = preparar({ raiz: d, tipo: 'recurso', msg: 'Attachments on the channel', hoje: '2026-11-17' });
  assert.deepStrictEqual(r, { versao: '0.3.0', mudou: true });
  assert.strictEqual(JSON.parse(ler(d, 'app/package.json')).version, '0.3.0');
  const lock = JSON.parse(ler(d, 'app/package-lock.json'));
  assert.deepStrictEqual([lock.version, lock.packages[''].version, lock.packages['node_modules/x'].version], ['0.3.0', '0.3.0', '1.8.0'], 'só a versão do app muda no lock');
  const log = ler(d, 'CHANGELOG.md');
  assert.match(log, /^# Changelog\n\nAll notable changes\.\n\n## 0\.3\.0 \(2026-11-17\)\n\n- Attachments on the channel\n\n## 0\.2\.1 /, 'a entrada nova vem logo depois do cabeçalho, antes da anterior');
  assert.strictEqual(notasDa(d, '0.3.0'), '- Attachments on the channel');
  assert.strictEqual(notasDa(d, '0.2.1'), '- Earlier work.');
  assert.strictEqual(notasDa(d, '9.9.9'), null);
});

test('versao: publicação repetida depois de falhar não sobe o número de novo', () => {
  const { preparar } = require(SCRIPT);
  const d = repo();
  assert.strictEqual(preparar({ raiz: d, tipo: 'correcao', msg: 'Fix', hoje: '2026-11-17' }).versao, '0.2.2');
  git(d, 'commit', '-qam', 'release 0.2.2 (os testes falharam depois; a tag não saiu)');
  const antes = ler(d, 'CHANGELOG.md');
  assert.deepStrictEqual(preparar({ raiz: d, tipo: 'correcao', msg: 'Fix', hoje: '2026-11-18' }), { versao: '0.2.2', mudou: false });
  assert.deepStrictEqual(preparar({ raiz: d, tipo: 'recurso', msg: 'Outra', hoje: '2026-11-18' }), { versao: '0.2.2', mudou: false }, 'a versão pendente vale até ganhar a tag');
  assert.strictEqual(ler(d, 'CHANGELOG.md'), antes, 'o CHANGELOG não ganha entrada repetida');
  git(d, 'tag', 'v0.2.2');
  assert.strictEqual(preparar({ raiz: d, tipo: 'correcao', msg: 'Depois da tag', hoje: '2026-11-19' }).versao, '0.2.3');
});

test('versao: arquivo de notas vira a entrada; a tag mais alta manda quando o package.json ficou para trás', () => {
  const { preparar, notasDa } = require(SCRIPT);
  const d = repo('0.1.0');
  git(d, 'tag', 'v0.2.1'); git(d, 'tag', 'v0.10.0');
  const notas = path.join(d, 'notas.md');
  fs.writeFileSync(notas, '- First thing.\n- Second thing.\n\n');
  const r = preparar({ raiz: d, tipo: 'correcao', msg: 'ignorada', notas, hoje: '2026-11-17' });
  assert.strictEqual(r.versao, '0.10.1', 'v0.10.0 é maior que v0.2.1 (ordem de versão, não de texto)');
  assert.strictEqual(notasDa(d, '0.10.1'), '- First thing.\n- Second thing.');
});

test('versao: pela linha de comando', () => {
  const d = repo();
  const rodar = (...a) => execFileSync(process.execPath, [SCRIPT, ...a], { cwd: d, stdio: 'pipe' }).toString().trim();
  assert.strictEqual(rodar('atual'), '0.2.1');
  assert.strictEqual(rodar('preparar', 'correcao', 'Fix the thing'), '0.2.2');
  assert.strictEqual(rodar('atual'), '0.2.2');
  assert.strictEqual(rodar('notas', '0.2.2'), '- Fix the thing');
  assert.throws(() => rodar('preparar', 'grande', 'x'), /recurso|correcao/);
});
