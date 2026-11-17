// Área: conversa (chaves do /config do Claude Code, lidas do texto do próprio CLI)
// Plano 2.5. O app não guarda lista fixa: lê o "Usage: /config" (conferido no
// 2.1.326 de verdade, 33 chaves) e mostra valor atual só onde o Claude informa.
const test = require('node:test');
const assert = require('node:assert');
const C = require('../../renderer/config-claude');

test('config do Claude: o texto do "Usage" do 2.1.326 vira 33 chaves com as opções de cada uma', () => {
  const l = C.chavesDoUso(C.USO_CONFERIDO);
  assert.strictEqual(l.length, 33);
  const por = Object.fromEntries(l.map((x) => [x.chave, x.opcoes]));
  assert.deepStrictEqual(por.permissionMode, ['default', 'plan', 'acceptEdits', 'auto', 'dontAsk']);
  assert.deepStrictEqual(por.editor, ['normal', 'vim']);
  assert.deepStrictEqual(por.switchModelsOnFlag, ['Switch automatically', 'Ask each time'], 'opção com espaço fica inteira');
  assert.deepStrictEqual(por.model.slice(-4), ['sonnet[1m]', 'opus[1m]', 'fable[1m]', 'opusplan']);
  assert.strictEqual(por.language, null, '<value> = valor livre');
  assert.ok(!('remoteControl' in por) && !('promptSuggestionEnabled' in por), 'chave que saiu do CLI sai da lista');
  for (const nova of ['idleCompaction', 'turnDuration', 'useAutoModeDuringPlan', 'verbose', 'workflows', 'worktreeBaseRef']) assert.ok(nova in por, nova);
});

test('config do Claude: versão que troca as chaves é lida do texto dela; texto sem "Usage" não dá lista', () => {
  const outra = 'Unknown key: x\n\nUsage: /config key=value [key=value ...]\n  model=default|opus\n  chaveNova=a|b|c\n  idioma=<value>\n\nSee the docs.\n  naoEntra=1|2';
  assert.deepStrictEqual(C.chavesDoUso(outra), [{ chave: 'model', opcoes: ['default', 'opus'] }, { chave: 'chaveNova', opcoes: ['a', 'b', 'c'] }, { chave: 'idioma', opcoes: null }]);
  assert.deepStrictEqual(C.chavesDoUso('Set model to opus'), []);
  assert.deepStrictEqual(C.chavesDoUso(null), []);
});

test('config do Claude: grupos com nome em português; chave sem nome aparece pelo nome técnico, em "Outras"', () => {
  const g = C.agrupar(C.chavesDoUso(C.USO_CONFERIDO));
  assert.deepStrictEqual(g.map((x) => x.grupo), ['Modelo e permissões', 'Respostas', 'Conversa e arquivos', 'Tela do terminal']);
  assert.strictEqual(g.reduce((n, x) => n + x.itens.length, 0), 33, 'nenhuma chave some ao agrupar');
  assert.ok(g.every((x) => x.itens.every((i) => !i.semRotulo)), 'toda chave do 2.1.326 tem nome em português');
  const terminal = g.find((x) => x.grupo === 'Tela do terminal').itens;
  assert.ok(terminal.every((i) => i.soTerminal) && terminal.some((i) => i.chave === 'theme'));
  assert.ok(!g[0].itens.some((i) => i.soTerminal));
  const comNova = C.agrupar([{ chave: 'model', opcoes: ['default'] }, { chave: 'chaveNova', opcoes: ['a'] }]);
  assert.deepStrictEqual(comNova.map((x) => [x.grupo, x.itens.map((i) => i.rotulo)]), [['Modelo e permissões', ['Modelo padrão']], ['Outras', ['chaveNova']]]);
});

test('config do Claude: o valor vai ao comando com aspas quando precisa, e as aspas de dentro escapadas', () => {
  assert.strictEqual(C.valorParaComando('opus'), 'opus');
  assert.strictEqual(C.valorParaComando('Ask each time'), '"Ask each time"');
  assert.strictEqual(C.valorParaComando('diga "oi"'), '"diga \\"oi\\""');
  assert.strictEqual(C.valorParaComando('a\\b'), '"a\\\\b"');
});

test('config do Claude: valor atual só onde o Claude informa (o resto fica sem valor, não adivinhado)', () => {
  const settings = { effective: { model: 'opus', outputStyle: 'Concise', language: 'português', permissions: { defaultMode: 'plan' } }, sources: [], applied: { model: 'claude-opus-5-5', effort: 'high' } };
  assert.strictEqual(C.valorAtual('model', { settings }), 'opus');
  assert.strictEqual(C.valorAtual('outputStyle', { settings }), 'Concise');
  assert.strictEqual(C.valorAtual('language', { settings }), 'português');
  assert.strictEqual(C.valorAtual('permissionMode', { settings, info: { modo: 'auto' } }), 'auto', 'o modo vivo da conversa vale mais');
  assert.strictEqual(C.valorAtual('permissionMode', { settings }), 'plan');
  assert.strictEqual(C.valorAtual('theme', { settings }), undefined);
  assert.strictEqual(C.valorAtual('model', { settings: { effective: {}, applied: { model: 'claude-opus-5-5' } } }), undefined, 'sem modelo padrão gravado: não mostra o modelo em uso como se fosse o padrão');
  assert.strictEqual(C.valorAtual('thinking', {}), undefined);
});
