// Área: conversa (lista única dos comandos /…, 0.B7)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const comandos = require('../../comandos');

const nomes = (l) => l.map((c) => c.nome);
const MORTOS = ['status', 'memory', 'hooks', 'help', 'release-notes', 'todos', 'cost'];

test('comandos: depois do init, só a lista branca + o que o init trouxe; mortos somem', () => {
  const l = comandos.montar({ motor: 'claude', anunciados: ['compact', 'agents', 'fast', 'doctor'] });
  for (const m of MORTOS) assert.ok(!nomes(l).includes(m), `/${m} não existe no -p e apareceu`);
  for (const n of ['restart', 'model', 'effort', 'config', 'permissions', 'exit', 'compact', 'doctor']) assert.ok(nomes(l).includes(n), `faltou /${n}`);
  assert.ok(!nomes(l).includes('context'), 'o init não trouxe /context: não aparece');
});

test('comandos: lista negra vem marcada com o "use X" e por último', () => {
  const l = comandos.montar({ motor: 'claude', anunciados: ['agents', 'compact', 'fast', 'heapdump', 'workflow-launch-exec', 'doctor'] });
  const bloq = l.filter((c) => c.bloqueado);
  assert.deepStrictEqual(nomes(bloq).sort(), ['agents', 'fast', 'heapdump', 'workflow-launch-exec']);
  for (const c of bloq) { assert.match(c.bloqueado, /^use /); assert.ok(c.descricao, `/${c.nome} sem explicação`); }
  assert.ok(l.findIndex((c) => c.bloqueado) > l.findIndex((c) => c.nome === 'doctor'), 'bloqueado antes de um comando bom');
  assert.ok(!l.find((c) => c.nome === 'doctor').bloqueado, '/doctor é skill: não esconder');
});

test('comandos: commands_changed não tira a marca da lista negra nem traz morto de volta', () => {
  const desc = new Map([['agents', { descricao: 'Manage agents', dica: '' }], ['minha', { descricao: 'Minha skill', dica: '' }]]);
  const l = comandos.montar({ motor: 'claude', anunciados: ['compact'], descricoes: desc });
  assert.strictEqual(l.find((c) => c.nome === 'agents').bloqueado, 'use a aba Repertório');
  assert.ok(nomes(l).includes('minha'));
});

test('comandos: antes do init, lista branca + os de sempre + skills locais; sem os mortos', () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-skills-'));
  fs.mkdirSync(path.join(pasta, 'rodada'));
  fs.writeFileSync(path.join(pasta, 'rodada', 'SKILL.md'), '---\nname: rodada\ndescription: "Faz a rodada"\n---\n');
  const l = comandos.montar({ motor: 'claude', skills: comandos.skillsLocais(pasta) });
  for (const m of MORTOS) assert.ok(!nomes(l).includes(m), `/${m} apareceu antes do init`);
  for (const n of ['compact', 'context', 'clear', 'restart', 'exit']) assert.ok(nomes(l).includes(n), `faltou /${n}`);
  assert.strictEqual(l.find((c) => c.nome === 'rodada').descricao, 'Faz a rodada');
});

test('comandos: conversa Codex só tem o que o app trata lá + skills do Codex', () => {
  const l = comandos.montar({ motor: 'codex', skills: [{ nome: 'rodada-x', descricao: 'Skill do Codex', dica: '' }] });
  assert.deepStrictEqual(nomes(l), ['restart', 'model', 'effort', 'exit', 'rodada-x']);
  assert.match(l[0].descricao, /Codex/, 'o /restart do Codex não fala em Claude');
});
