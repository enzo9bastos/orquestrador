// Área: conversa (comandos do "/" que o app faz com arquivo: /memory, /hooks,
// /agents, /keybindings, /todos, /release-notes, /resume. Só os arquivos que
// esses comandos editam; tirar hook e apagar subagente só com confirmação, e
// sempre com cópia antes.)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Casa temporária: o módulo lê os.homedir() a cada chamada.
const CASA = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-cmd-casa-'));
process.env.HOME = CASA;
const A = require('../../comandos-app');
const esc = (rel, txt) => { const p = path.join(CASA, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, txt); return p; };

test('arquivos: só os que os comandos editam (nada de ler ou gravar arquivo qualquer)', () => {
  assert.throws(() => A.lerArquivo('/etc/passwd'), /fora do que os comandos editam/);
  assert.throws(() => A.gravarArquivo(path.join(CASA, '.bashrc'), 'x'), /fora do que os comandos editam/);
  assert.throws(() => A.gravarArquivo(path.join(CASA, '.claude', 'agents', '..', 'settings.json'), 'x'), /fora/);
});

test('/memory: lista os CLAUDE.md e grava com a versão anterior guardada; recusa se mudou por fora', () => {
  const p = esc('.claude/CLAUDE.md', '# Ana\n');
  const m = A.memoria(CASA, null);
  assert.ok(m.arquivos.some((a) => a.path === p && a.exists));
  assert.ok(m.arquivos.some((a) => a.kind === 'project' && !a.exists), 'o do projeto, que ainda não existe, também aparece');
  const r = A.lerArquivo(p);
  fs.writeFileSync(p, '# Ana mudou por fora\n');
  fs.utimesSync(p, new Date(), new Date(Date.now() + 5000));
  assert.throws(() => A.gravarArquivo(p, '# novo\n', r.mtime), /mudou desde que foi aberto/);
  const r2 = A.lerArquivo(p);
  const g = A.gravarArquivo(p, '# novo\n', r2.mtime);
  assert.strictEqual(fs.readFileSync(p, 'utf8'), '# novo\n');
  assert.strictEqual(fs.readFileSync(g.copia, 'utf8'), '# Ana mudou por fora\n');
});

test('/hooks: tirar hook devolve o custo e só grava com confirmação; o resto do settings fica', () => {
  const p = esc('.claude/settings.json', JSON.stringify({ model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'a' }, { type: 'command', command: 'b' }] }] } }));
  const menos = JSON.stringify({ Stop: [{ hooks: [{ type: 'command', command: 'a' }] }] });
  const c = A.gravarHooks(CASA, p, menos, false);
  assert.deepStrictEqual([c.precisaConfirmar, c.somem, c.eventos], [true, 1, ['Stop']]);
  assert.match(fs.readFileSync(p, 'utf8'), /"b"/, 'gravou sem confirmação');
  const g = A.gravarHooks(CASA, p, menos, true);
  const s = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.strictEqual(s.model, 'opus');
  assert.strictEqual(s.hooks.Stop[0].hooks.length, 1);
  assert.match(fs.readFileSync(g.copia, 'utf8'), /"b"/);
  assert.throws(() => A.gravarHooks(CASA, '/etc/x.json', '{}', true), /desconhecido/);
  assert.throws(() => A.gravarHooks(CASA, p, '[1]', true), /objeto/);
});

test('/agents: cria sem gravar por cima, apaga só confirmado e com cópia; diz quem cita', () => {
  esc('.claude/agents/revisor.md', '---\nname: revisor\ndescription: Revisa\n---\nx\n');
  esc('.claude/skills/usa/SKILL.md', 'chame o revisor e o revisor de novo');
  assert.throws(() => A.criarAgente(CASA, { nome: 'Nome Ruim' }), /nome/);
  assert.throws(() => A.criarAgente(CASA, { nome: 'revisor' }), /já existe/);
  const r = A.criarAgente(CASA, { nome: 'tradutor', descricao: 'Traduz', prompt: 'Traduza.' });
  assert.match(fs.readFileSync(r.caminho, 'utf8'), /^---\nname: tradutor\ndescription: Traduz\n---\n\nTraduza\.\n$/);
  const p = path.join(CASA, '.claude/agents/revisor.md');
  const c = A.custoApagarAgente(p);
  assert.deepStrictEqual(c.citacoes.map((x) => [path.basename(path.dirname(x.arquivo)), x.vezes]), [['usa', 2]]);
  assert.throws(() => A.apagarAgente(p), /confirmação/);
  assert.ok(fs.existsSync(p));
  const a = A.apagarAgente(p, true);
  assert.ok(!fs.existsSync(p));
  assert.match(fs.readFileSync(a.copia, 'utf8'), /name: revisor/);
  assert.throws(() => A.custoApagarAgente(path.join(CASA, '.claude', 'settings.json')), /não é um subagente/);
});

test('/todos: a última lista do TodoWrite; /release-notes: a seção da versão instalada', () => {
  const uso = (todos) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'TodoWrite', input: { todos } }] } });
  const t = esc('t.jsonl', `${uso([{ content: 'velha', status: 'pending' }])}\n{quebrada\n${uso([{ content: 'nova', status: 'completed' }])}\n`);
  assert.deepStrictEqual(A.todos(t).itens, [{ texto: 'nova', status: 'completed' }]);
  assert.strictEqual(A.todos(path.join(CASA, 'nao-existe.jsonl')).achou, false);
  esc('.claude/cache/changelog.md', '# Changelog\n\n## 2.0.1\n\n- futura\n\n## 2.0.0\n\n- instalada\n\n## 1.9.9\n\n- velha\n');
  const n = A.notasVersao('2.0.0');
  assert.deepStrictEqual(n.secoes.map((s) => s.versao), ['2.0.0', '1.9.9']);
  assert.match(n.secoes[0].texto, /instalada/);
});

test('/resume: sessões do projeto com a primeira mensagem e as abertas marcadas', () => {
  const dir = path.join(CASA, 'proj');
  esc('proj/s-1.jsonl', `${JSON.stringify({ type: 'user', message: { content: 'arrumar o login' } })}\n`);
  esc('proj/s-2.jsonl', `${JSON.stringify({ type: 'user', message: { content: '<command-name>/x</command-name>' } })}\n`);
  const l = A.sessoes(dir, ['s-1']);
  assert.deepStrictEqual(l.map((s) => [s.sessao, s.titulo, s.aberta]), [['s-1', 'arrumar o login', true]]);
});

test('/resume: a lista lê só o começo de cada sessão, nunca o transcript inteiro', () => {
  const dir = path.join(CASA, 'proj-grande');
  esc('proj-grande/s-g.jsonl', `${JSON.stringify({ type: 'user', message: { content: 'revisar o relatório' } })}\n${'{"type":"assistant"}\n'.repeat(1000)}`);
  const lerInteiro = fs.readFileSync;
  fs.readFileSync = (p, ...r) => { if (String(p).endsWith('s-g.jsonl')) throw new Error('leu o transcript inteiro'); return lerInteiro(p, ...r); };
  try {
    assert.deepStrictEqual(A.sessoes(dir, []).map((s) => [s.sessao, s.titulo]), [['s-g', 'revisar o relatório']]);
  } finally { fs.readFileSync = lerInteiro; }
});
