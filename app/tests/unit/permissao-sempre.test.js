// Área: conversa (cartão de permissão: "permitir sempre"; plano 6.4)
// O Claude manda junto com o pedido a regra que ele gravaria ("permission_suggestions",
// forma do 2.1.326). O app só oferece "sempre" quando há uma regra dessas, mostra a regra
// como ela é, e NUNCA oferece para comandos da lista de recusa (o que roda outro programa
// qualquer, docker, ssh, rede, apagar, git push, coringa).
const test = require('node:test');
const assert = require('node:assert');
const ps = require('../../permissao-sempre');

const regra = (toolName, ruleContent) => (ruleContent === undefined ? { toolName } : { toolName, ruleContent });
const sug = (rules, mais = {}) => ({ type: 'addRules', rules, behavior: 'allow', destination: 'localSettings', ...mais });

test('permitir sempre: acha a regra sugerida e mostra como ela é', () => {
  const r = ps.resumo([sug([regra('Bash', 'npm test:*')])]);
  assert.deepStrictEqual(r, { ok: true, textos: ['Bash(npm test:*)'] });
  assert.deepStrictEqual(ps.resumo([sug([regra('Bash', 'npm run build'), regra('Read', './docs/**')])]).textos, ['Bash(npm run build)', 'Read(./docs/**)']);
  assert.deepStrictEqual(ps.resumo([sug([regra('mcp__agenda__listar')])]), { ok: true, textos: ['mcp__agenda__listar'] }, 'ferramenta de servidor MCP inteira pode');
});

test('permitir sempre: sem sugestão de regra de permitir, não há "sempre"', () => {
  for (const s of [undefined, null, [], 'x', [null], [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }], [sug([regra('Bash', 'ls')], { behavior: 'deny' })],
    [sug([])], [sug([{ toolName: 5 }])], [sug('x')], [{ type: 'addDirectories', directories: ['/x'], destination: 'session' }]]) {
    assert.strictEqual(ps.resumo(s), null, JSON.stringify(s));
  }
});

test('permitir sempre: lista de recusa (nunca ganha "sempre"), dizendo o motivo', () => {
  const recusado = (conteudo, ferramenta = 'Bash') => ps.resumo([sug([regra(ferramenta, conteudo)])]);
  for (const c of ['python3:*', 'python script.py', 'node:*', 'bash -c:*', 'sh:*', 'env:*', 'xargs:*', 'sudo apt:*', 'eval:*']) assert.strictEqual(recusado(c).motivo, 'roda outros programas', c);
  for (const c of ['docker:*', 'docker compose down:*', 'podman run:*', 'tmux:*', 'ssh:*', 'scp:*']) assert.strictEqual(recusado(c).motivo, 'docker, tmux ou ssh', c);
  for (const c of ['curl:*', 'wget https://x:*', 'nc:*']) assert.strictEqual(recusado(c).motivo, 'rede', c);
  for (const c of ['rm:*', 'rm -rf build:*', 'rmdir:*', 'shred:*', 'dd:*']) assert.strictEqual(recusado(c).motivo, 'apaga arquivos', c);
  for (const c of ['git push:*', 'git push origin main', 'git -C x push:*']) assert.strictEqual(recusado(c).motivo, 'git push', c);
  for (const c of [undefined, '', '*', ':*', '**']) assert.strictEqual(recusado(c).motivo, 'coringa', String(c));
  for (const c of ['npm test && rm -rf x:*', 'ls; curl x:*', 'cat x | sh', 'echo $(whoami):*', 'echo `id`:*']) assert.strictEqual(recusado(c).ok, false, c);
  // Ferramenta inteira (sem conteúdo) que escreve ou busca qualquer coisa: coringa.
  for (const f of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'WebFetch']) assert.strictEqual(recusado(undefined, f).motivo, 'coringa', f);
  assert.strictEqual(recusado('**', 'Edit').motivo, 'coringa');
  // Uma regra recusada no meio recusa a sugestão inteira.
  assert.strictEqual(ps.resumo([sug([regra('Bash', 'npm test:*'), regra('Bash', 'docker:*')])]).ok, false);
  // O que não está na lista continua podendo.
  for (const c of ['npm test:*', 'git status', 'git diff:*', 'ls:*', 'pnpm run lint:*', 'cargo build:*', 'make test']) assert.strictEqual(recusado(c).ok, true, c);
});

test('permitir sempre: a regra que volta ao Claude é a que ele sugeriu, só com o alcance escolhido', () => {
  const original = sug([regra('Bash', 'npm test:*')], { destination: 'localSettings', extra: 'fica' });
  assert.deepStrictEqual(ps.atualizacao([original], 'session'), [{ ...original, destination: 'session' }]);
  assert.deepStrictEqual(ps.atualizacao([original], 'userSettings')[0].destination, 'userSettings');
  assert.deepStrictEqual(original.destination, 'localSettings', 'a sugestão guardada não é mexida');
  for (const d of ['projectSettings', 'cliArg', '', null, 'qualquer']) assert.strictEqual(ps.atualizacao([original], d), null, `alcance não oferecido: ${d}`);
  assert.strictEqual(ps.atualizacao([sug([regra('Bash', 'docker:*')])], 'session'), null, 'comando da lista de recusa nunca volta com regra');
  assert.deepStrictEqual(ps.DESTINOS, ['session', 'localSettings', 'userSettings']);
});
