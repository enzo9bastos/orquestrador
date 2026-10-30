// Área: topicos
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { casaTemporaria } = require('../ajuda');

const casa = casaTemporaria({});
const topicos = require('../../topicos');
const cli = path.join(__dirname, '..', '..', 'bin', 'orq-topico');
const ARQ = path.join(casa, '.config/orq-app/topicos.json');
const VERSOES = path.join(casa, '.local/share/orq-app/versoes/topicos');

// Roda o orq-topico de verdade, na casa temporária.
function orq(...a) {
  return execFileSync(process.execPath, [cli, ...a], { env: { ...process.env, HOME: casa }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function orqFalha(...a) {
  try { orq(...a); } catch (e) { return String(e.stderr); }
  assert.fail('devia ter falhado');
}

test('topicos: sem arquivo, lista vazia e nada é criado só por ler', () => {
  assert.deepStrictEqual(topicos.ler(), []);
  assert.ok(!fs.existsSync(ARQ));
  assert.match(orq('listar'), /Nenhum tópico em andamento/);
});

test('topicos (CLI): abrir devolve o id, item/marcar/agente/nota gravam no arquivo', () => {
  const id = orq('abrir', 'Arrumar o redirect do login', '--codigo', 'ABC-123', '--agente', 'Agente 3').trim();
  assert.strictEqual(id, '1');
  orq('item', id, 'ajustar a rota');
  orq('item', id, 'testar no navegador');
  const saida = orq('marcar', id, '1');
  assert.match(saida, /\[x\] 1\. ajustar a rota/);
  assert.match(saida, /\[ \] 2\. testar no navegador/);
  orq('agente', id, 'Agente 5');
  orq('agente', id, 'Agente 5'); // repetido não duplica
  orq('nota', id, 'primeira nota');
  orq('nota', id, 'segunda nota');
  const t = JSON.parse(fs.readFileSync(ARQ, 'utf8')).topicos[0];
  assert.strictEqual(t.titulo, 'Arrumar o redirect do login');
  assert.strictEqual(t.codigo, 'ABC-123');
  assert.deepStrictEqual(t.agentes, ['Agente 3', 'Agente 5']);
  assert.deepStrictEqual(t.itens.map((i) => [i.texto, i.feito]), [['ajustar a rota', true], ['testar no navegador', false]]);
  assert.strictEqual(t.notas, 'primeira nota\nsegunda nota', 'nota acrescenta, não troca');
  assert.strictEqual(t.estado, 'aberto');
  // Segundo tópico ganha o id seguinte.
  assert.strictEqual(orq('abrir', 'Outra demanda').trim(), '2');
});

test('topicos (CLI): desmarcar, estado e listar --json', () => {
  orq('desmarcar', '1', '1');
  assert.strictEqual(topicos.ler()[0].itens[0].feito, false);
  orq('marcar', '1', '1');
  orq('estado', '#1', 'esperando');
  const j = JSON.parse(orq('listar', '--json'));
  assert.strictEqual(j.topicos.length, 2);
  assert.strictEqual(j.topicos[0].estado, 'esperando');
  assert.match(orqFalha('estado', '1', 'pausado'), /estado deve ser/);
  assert.match(orqFalha('marcar', '1', '9'), /não tem o item 9/);
  assert.match(orqFalha('item', '42', 'x'), /não existe tópico 42/);
  assert.match(orqFalha('abrir', '   '), /precisa de um título/);
});

test('topicos (CLI): concluir recusa com item em aberto; tudo feito, conclui', () => {
  assert.match(orqFalha('concluir', '1'), /1 item\(ns\) por fazer: testar no navegador/);
  assert.strictEqual(topicos.ler()[0].estado, 'esperando', 'recusa não muda nada');
  orq('marcar', '1', '2');
  orq('concluir', '1');
  const t = topicos.ler()[0];
  assert.strictEqual(t.estado, 'concluido');
  assert.ok(t.concluido > 0);
  // listar sem --todos esconde os concluídos.
  assert.doesNotMatch(orq('listar'), /redirect/);
  assert.match(orq('listar', '--todos'), /#1 \[concluído\] Arrumar o redirect/);
  // Reabrir tira a data de conclusão.
  orq('estado', '1', 'aberto');
  assert.strictEqual(topicos.ler()[0].concluido, undefined);
  orq('concluir', '2', '--mesmo-assim');
  assert.strictEqual(topicos.ler()[1].estado, 'concluido');
});

test('topicos: cada gravação guarda a versão anterior; arquivo estragado não é sobrescrito', () => {
  const versoes = fs.readdirSync(VERSOES);
  assert.ok(versoes.length >= 10, `versões guardadas: ${versoes.length}`);
  // A versão mais recente é o arquivo de antes da última mudança.
  const ultima = versoes.sort().pop();
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(VERSOES, ultima), 'utf8')).topicos[1].estado, 'aberto');
  const bom = fs.readFileSync(ARQ, 'utf8');
  fs.writeFileSync(ARQ, '{ quebrado');
  assert.match(orqFalha('abrir', 'Novo'), /estragado/);
  assert.strictEqual(fs.readFileSync(ARQ, 'utf8'), '{ quebrado');
  fs.writeFileSync(ARQ, bom);
  // Nenhum .tmp sobrando na pasta.
  assert.deepStrictEqual(fs.readdirSync(path.dirname(ARQ)).filter((f) => f.endsWith('.tmp')), []);
});

test('topicos: vigiar avisa quando o orq-topico muda o arquivo', async () => {
  const recebidos = [];
  const parar = topicos.vigiar((m) => recebidos.push(m));
  try {
    orq('item', '1', 'item vindo de fora');
    for (let i = 0; i < 30 && !recebidos.length; i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(recebidos.length >= 1, 'recebeu aviso');
    assert.ok(recebidos.at(-1).topicos[0].itens.some((i) => i.texto === 'item vindo de fora'));
  } finally { parar(); }
});
