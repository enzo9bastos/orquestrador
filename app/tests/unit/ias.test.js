// Área: ias
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { casaTemporaria } = require('../ajuda');

const casa = casaTemporaria({});
const config = require('../../config');
const ias = require('../../ias');

// CLIs de mentira: scripts pequenos numa pasta da casa temporária, primeira no
// PATH. Nenhuma IA de verdade roda nestes testes.
const bin = path.join(casa, 'bin');
fs.mkdirSync(bin);
function cli(nome, corpo) {
  const arq = path.join(bin, nome);
  fs.writeFileSync(arq, `#!/bin/sh\n${corpo}\n`, { mode: 0o755 });
  return arq;
}
cli('claude', 'echo "9.8.7 (Claude Code)"');
// Imprime um segredo junto: só a versão pode sair daqui.
cli('codex', 'echo "codex-cli 0.41.2"; echo "token: sk-SEGREDO-NAO-PODE-SAIR" >&2');
cli('gemini', 'exit 3'); // instalado, mas sem versão legível
cli('qwen', 'exec sleep 30'); // trava: o tempo limite corta
fs.writeFileSync(path.join(bin, 'aider'), '#!/bin/sh\necho 1.0.0\n', { mode: 0o644 }); // sem permissão de executar
const env = { PATH: `${bin}:/usr/bin:/bin`, HOME: casa };
const real = (c) => !['/usr/bin', '/bin'].some((d) => (c.caminho || '').startsWith(`${d}/`));

test('ias: acha os CLIs do PATH com caminho e versão', async () => {
  const lista = await ias.listar({ env, forcar: true });
  const por = Object.fromEntries(lista.map((c) => [c.id, c]));
  assert.deepStrictEqual(lista.map((c) => c.id), ['claude', 'codex', 'gemini', 'opencode', 'cursor', 'aider', 'qwen']);
  assert.deepStrictEqual(por.claude, { id: 'claude', nome: 'Claude Code', comando: 'claude', encontrado: true, caminho: path.join(bin, 'claude'), versao: '9.8.7', suportado: true });
  assert.strictEqual(por.codex.versao, '0.41.2');
  assert.strictEqual(por.codex.suportado, false, 'por enquanto só o Claude é orquestrador');
  assert.strictEqual(por.gemini.encontrado, true);
  assert.strictEqual(por.gemini.versao, null);
  assert.strictEqual(por.cursor.comando, 'cursor-agent');
  if (real(por.opencode)) assert.strictEqual(por.opencode.encontrado, false);
  if (real(por.aider)) assert.strictEqual(por.aider.encontrado, false, 'arquivo sem permissão de executar não conta');
});

test('ias: nada do que o CLI imprime além da versão chega ao resultado', async () => {
  const lista = await ias.listar({ env });
  assert.ok(!JSON.stringify(lista).includes('SEGREDO'));
});

test('ias: CLI que trava não segura a lista (tempo limite curto)', async () => {
  const qwen = (await ias.listar({ env })).find((c) => c.id === 'qwen');
  assert.strictEqual(qwen.encontrado, true);
  assert.strictEqual(qwen.versao, null);
  fs.chmodSync(path.join(bin, 'qwen'), 0o644); // daqui em diante, fora (os próximos testes não esperam o tempo)
});

test('ias: guarda o resultado por 1 min; forcar detecta de novo', async () => {
  const antes = await ias.listar({ env, forcar: true });
  cli('opencode', 'echo "opencode 0.15.0"');
  assert.strictEqual(await ias.listar({ env }), antes, 'dentro do minuto, a mesma lista');
  const depois = await ias.listar({ env, forcar: true });
  assert.strictEqual(depois.find((c) => c.id === 'opencode').versao, '0.15.0');
});

test('ias: a IA efetiva é a escolhida só se for suportada e estiver instalada', async () => {
  const lista = await ias.listar({ env });
  assert.strictEqual(ias.efetiva('claude', lista), 'claude');
  assert.strictEqual(ias.efetiva('codex', lista), 'claude', 'codex ainda não é suportado: volta ao Claude');
  assert.strictEqual(ias.efetiva('nada', lista), 'claude');
  assert.strictEqual(ias.efetiva(undefined, []), 'claude');
});

test('ias: versão tirada de saídas de vários formatos', () => {
  assert.strictEqual(ias.versaoDe('2.1.314 (Claude Code)'), '2.1.314');
  assert.strictEqual(ias.versaoDe('codex-cli 0.40.0'), '0.40.0');
  assert.strictEqual(ias.versaoDe('v1.2.3-beta.1'), '1.2.3-beta.1');
  assert.strictEqual(ias.versaoDe('aider 0.86'), '0.86');
  assert.strictEqual(ias.versaoDe('sem número'), null);
});

test('config: iaOrquestrador e iaAgentes valem claude sem configuração e aceitam só ids conhecidos', () => {
  assert.strictEqual(config.ler().iaOrquestrador, 'claude');
  assert.strictEqual(config.ler().iaAgentes, 'claude');
  const { ok, recusado } = config.validar({ iaOrquestrador: 'codex', iaAgentes: 'gemini' });
  assert.deepStrictEqual(ok, { iaOrquestrador: 'codex', iaAgentes: 'gemini' });
  assert.deepStrictEqual(recusado, []);
  assert.deepStrictEqual(config.validar({ iaOrquestrador: 'rm -rf', iaAgentes: 3 }).recusado, ['iaOrquestrador', 'iaAgentes']);
});
