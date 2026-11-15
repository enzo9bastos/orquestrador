// Área: terminais
// "Abrir terminal" numa janela do sistema: só diz que abriu quando abriu.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { casaTemporaria } = require('../ajuda');

const casa = casaTemporaria({});
const terminal = require('../../terminal-externo');

test('terminal externo: sem nenhum terminal no PATH → false (não diz que abriu)', async () => {
  const vazia = fs.mkdtempSync(path.join(casa, 'path-vazio-'));
  assert.strictEqual(await terminal.abrir('agente-1', { env: { ...process.env, PATH: vazia } }), false);
});

test('terminal externo: pula o que não existe e abre o primeiro que existe', async () => {
  const bin = fs.mkdtempSync(path.join(casa, 'bin-'));
  const anotado = path.join(casa, 'args.txt');
  fs.writeFileSync(path.join(bin, 'xterm'), `#!/bin/sh\nprintf '%s ' "$@" > '${anotado}'\n`, { mode: 0o755 });
  assert.strictEqual(await terminal.abrir('agente-1', { env: { ...process.env, PATH: bin } }), true);
  for (let i = 0; i < 40 && !fs.existsSync(anotado); i++) await new Promise((r) => setTimeout(r, 50));
  assert.strictEqual(fs.readFileSync(anotado, 'utf8').trim(), '-- tmux attach -f ignore-size -t agente-1');
});

test('terminal externo: nome de sessão estranho nem tenta', async () => {
  assert.strictEqual(await terminal.abrir('a; echo oi', { env: { ...process.env, PATH: '/nao-existe' } }), false);
  assert.strictEqual(await terminal.abrir(null), false);
});
