// Área: conversa (lista única dos comandos /…: tudo o que funciona no Claude
// Code ou no Codex aparece e funciona no app; nada cinza, nada some)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const comandos = require('../../comandos');

const nomes = (l) => l.map((c) => c.nome);
// Os que o 0.B7 tirava ("mortos") ou deixava cinza (lista negra).
const ANTES_FORA = ['status', 'memory', 'hooks', 'help', 'release-notes', 'todos'];
const ANTES_CINZA = ['agents', 'fast', 'heapdump', 'workflow-launch-exec'];
// Uma amostra de cada jeito de funcionar (inventario.md).
const CLAUDE = ['add-dir', 'agents', 'background', 'branch', 'btw', 'clear', 'compact', 'config', 'context', 'copy', 'diff',
  'effort', 'exit', 'export', 'fast', 'feedback', 'fork', 'heapdump', 'help', 'hooks', 'init', 'keybindings', 'login', 'mcp',
  'memory', 'model', 'permissions', 'plan', 'plugin', 'release-notes', 'restart', 'resume', 'rewind', 'skills', 'status',
  'statusline', 'tasks', 'terminal-setup', 'theme', 'todos', 'usage', 'vim', 'workflow-launch-exec'];

test('comandos: Claude depois do init — nada some, nada cinza', () => {
  const l = comandos.montar({ motor: 'claude', anunciados: ['compact', 'agents', 'fast', 'doctor'] });
  for (const n of [...ANTES_FORA, ...ANTES_CINZA, ...CLAUDE]) assert.ok(nomes(l).includes(n), `faltou /${n}`);
  assert.ok(nomes(l).includes('doctor'), 'skill do init some');
  assert.ok(!l.some((c) => c.bloqueado), 'algum comando veio cinza');
  for (const c of l) assert.ok(['texto', 'app', 'terminal'].includes(c.como), `/${c.nome} sem jeito de funcionar`);
  for (const c of l) assert.ok(c.descricao, `/${c.nome} sem descrição`);
});

test('comandos: o init não manda tirar o que ele não anunciou', () => {
  const l = comandos.montar({ motor: 'claude', anunciados: ['compact'] });
  for (const n of ['context', 'status', 'memory', 'release-notes']) assert.ok(nomes(l).includes(n), `faltou /${n}`);
});

test('comandos: o jeito de cada um segue o inventário', () => {
  const l = comandos.montar({ motor: 'claude', anunciados: ['compact', 'agents', 'fast', 'heapdump', 'workflow-launch-exec'] });
  const como = (n) => { const c = l.find((x) => x.nome === n); return c && `${c.como}${c.acao ? ':' + c.acao : ''}`; };
  assert.strictEqual(como('compact'), 'texto');
  assert.strictEqual(como('workflow-launch-exec'), 'texto');
  assert.strictEqual(como('heapdump'), 'texto:confirmar-heapdump');
  assert.strictEqual(como('status'), 'app:status');
  assert.strictEqual(como('agents'), 'app:agents');
  assert.strictEqual(como('fast'), 'app:fast');
  assert.strictEqual(como('memory'), 'app:memory');
  assert.strictEqual(como('login'), 'terminal');
});

test('comandos: aliases ficam no comando (cost e stats no /usage) e o busca acha', () => {
  const l = comandos.montar({ motor: 'claude', anunciados: null });
  const usage = l.find((c) => c.nome === 'usage');
  assert.deepStrictEqual(usage.aliases, ['cost', 'stats']);
  assert.strictEqual(comandos.achar(l, 'cost').nome, 'usage');
  assert.strictEqual(comandos.achar(l, 'quit').nome, 'exit');
  assert.strictEqual(comandos.achar(l, 'nao-existe'), null);
});

test('comandos: commands_changed traz descrição de skill nova sem tirar ninguém', () => {
  const desc = new Map([['minha', { descricao: 'Minha skill', dica: '' }]]);
  const l = comandos.montar({ motor: 'claude', anunciados: ['compact'], descricoes: desc });
  assert.strictEqual(l.find((c) => c.nome === 'minha').descricao, 'Minha skill');
  assert.strictEqual(l.find((c) => c.nome === 'minha').como, 'texto');
  assert.ok(nomes(l).includes('agents'));
});

test('comandos: antes do init, o catálogo inteiro + skills locais', () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-skills-'));
  fs.mkdirSync(path.join(pasta, 'rodada'));
  fs.writeFileSync(path.join(pasta, 'rodada', 'SKILL.md'), '---\nname: rodada\ndescription: "Faz a rodada"\n---\n');
  const l = comandos.montar({ motor: 'claude', skills: comandos.skillsLocais(pasta) });
  for (const n of [...ANTES_FORA, ...ANTES_CINZA, ...CLAUDE]) assert.ok(nomes(l).includes(n), `faltou /${n} antes do init`);
  assert.strictEqual(l.find((c) => c.nome === 'rodada').descricao, 'Faz a rodada');
});

test('comandos: fora só o que nem o terminal tem (isEnabled falso, internos)', () => {
  const l = comandos.montar({ motor: 'claude', anunciados: ['__remote-workflow', 'compact'] });
  for (const n of ['loops', 'version', 'wellbeing', 'pause-memory', '__remote-workflow']) assert.ok(!nomes(l).includes(n), `/${n} não existe nem no terminal`);
});

test('comandos: conversa Codex tem os comandos do Codex, nenhum só do Claude', () => {
  const l = comandos.montar({ motor: 'codex', skills: [{ nome: 'rodada-x', descricao: 'Skill do Codex', dica: '' }] });
  for (const n of ['compact', 'review', 'rename', 'new', 'resume', 'fork', 'init', 'diff', 'status', 'mcp', 'model', 'permissions', 'exit', 'restart', 'rodada-x'])
    assert.ok(nomes(l).includes(n), `faltou /${n} no Codex`);
  for (const n of ['context', 'memory', 'add-dir', 'usage-credits', 'release-notes', 'security-review', 'heapdump', 'app'])
    assert.ok(!nomes(l).includes(n), `/${n} não existe no Codex`);
  assert.match(l.find((c) => c.nome === 'restart').descricao, /Codex/, 'o /restart do Codex não fala em Claude');
  assert.ok(!l.some((c) => c.como === 'texto' && !['init', 'rodada-x'].includes(c.nome)), 'o app-server não entende "/x" como texto');
});
