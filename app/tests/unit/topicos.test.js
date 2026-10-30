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

// Pedido de 2026-10-30: o orquestrador sugere; o usuário aprova ou recusa.
test('topicos (CLI): sugerir com resumo e etapas; listar --sugeridos e --json com o estado', () => {
  const id = orq('sugerir', 'Trocar o certificado do servidor', '--resumo', 'O certificado vence semana que vem;  renovar e testar.', '--codigo', 'Q-7', '--agente', 'Agente 4', '--item', 'gerar o pedido', '--item', 'instalar e testar').trim();
  assert.match(id, /^\d+$/);
  const t = topicos.ler().find((x) => x.id === id);
  assert.strictEqual(t.estado, 'sugerido');
  assert.strictEqual(t.resumo, 'O certificado vence semana que vem; renovar e testar.');
  assert.strictEqual(t.codigo, 'Q-7');
  assert.deepStrictEqual(t.agentes, ['Agente 4']);
  assert.deepStrictEqual(t.itens.map((i) => [i.id, i.texto, i.feito]), [['i1', 'gerar o pedido', false], ['i2', 'instalar e testar', false]]);
  // Etapa a mais numa sugestão.
  orq('item', id, 'avisar quem usa');
  const so = orq('listar', '--sugeridos');
  assert.match(so, new RegExp(`#${id} \\[sugerido, esperando aprovação\\] Trocar o certificado`));
  assert.match(so, /resumo: O certificado vence/);
  assert.match(so, /etapas previstas:/);
  assert.match(so, /3\. avisar quem usa/);
  assert.doesNotMatch(so, /redirect/, '--sugeridos mostra só os sugeridos');
  const j = JSON.parse(orq('listar', '--json'));
  assert.strictEqual(j.topicos[0].id, id, 'sugerido vem primeiro');
  assert.strictEqual(j.topicos[0].estado, 'sugerido');
  assert.ok(j.topicos.every((x) => typeof x.estado === 'string'));
  assert.match(orqFalha('sugerir', '  '), /precisa de um título/);
  assert.match(orqFalha('listar', '--estado', 'pausado'), /estado deve ser/);
});

test('topicos: resumo troca o anterior; aprovar (com título corrigido) vira aberto', () => {
  const id = topicos.ler().find((x) => x.estado === 'sugerido').id;
  assert.match(orq('resumo', id, 'Renovar o certificado antes de vencer.'), /resumo: Renovar o certificado antes de vencer\./);
  assert.strictEqual(topicos.ler().find((x) => x.id === id).resumo, 'Renovar o certificado antes de vencer.');
  assert.throws(() => topicos.recusar('1'), /não está sugerido/);
  const t = topicos.aprovar(id, { titulo: 'Renovar o certificado do servidor' });
  assert.strictEqual(t.estado, 'aberto');
  assert.strictEqual(t.titulo, 'Renovar o certificado do servidor');
  assert.ok(t.aprovado > 0);
  assert.throws(() => topicos.aprovar(id), /não está sugerido \(está aberto\)/, 'aprovar duas vezes não faz nada');
  // Aprovado anda como qualquer tópico: item, marcar, concluir.
  orq('marcar', id, '1');
  assert.match(orq('listar'), new RegExp(`#${id} \\[aberto\\] Renovar o certificado do servidor .*1/3`));
});

test('topicos: recusar guarda (não apaga) e reconsiderar volta a sugerido', () => {
  const antes = topicos.ler().length;
  const id = orq('sugerir', 'Migrar o banco de teste', '--item', 'copiar os dados').trim();
  assert.strictEqual(orq('recusar', id).trim(), `#${id} [recusado] Migrar o banco de teste`);
  const l = topicos.ler();
  assert.strictEqual(l.length, antes + 1, 'recusado continua no arquivo');
  const t = l.find((x) => x.id === id);
  assert.strictEqual(t.estado, 'recusado');
  assert.ok(t.recusado > 0);
  assert.deepStrictEqual(t.itens.map((i) => i.texto), ['copiar os dados']);
  // listar mostra o recusado numa linha só, no fim.
  const saida = orq('listar').trim().split('\n');
  assert.strictEqual(saida.at(-1), `#${id} [recusado] Migrar o banco de teste`);
  assert.throws(() => topicos.reconsiderar('1'), /não está recusado/);
  assert.strictEqual(topicos.reconsiderar(id).estado, 'sugerido');
  assert.strictEqual(topicos.ler().find((x) => x.id === id).recusado, undefined);
  topicos.recusar(id);
});

test('topicos: aviso ao orquestrador vai por trás, marcado, e só com ele vivo', () => {
  const mandados = [];
  let o = { id: 'orquestrador', orquestrador: true, vivo: false };
  const conversa = { lista: () => [{ id: 'c2', orquestrador: false, vivo: true }, o], mandar: (id, t) => mandados.push([id, t]) };
  const t = { id: '7', titulo: 'Arrumar "aspas" <e> sinais' };
  assert.strictEqual(topicos.avisarOrquestrador(conversa, t, 'aprovado'), false);
  assert.deepStrictEqual(mandados, [], 'orquestrador parado: não manda');
  o = { ...o, vivo: true };
  assert.strictEqual(topicos.avisarOrquestrador(conversa, t, 'aprovado'), true);
  assert.strictEqual(topicos.avisarOrquestrador(conversa, t, 'recusado'), true);
  assert.strictEqual(topicos.avisarOrquestrador(conversa, t, 'outro'), false);
  assert.strictEqual(mandados.length, 2);
  assert.strictEqual(mandados[0][0], 'orquestrador');
  assert.strictEqual(mandados[0][1], '<orq-topico id="7" acao="aprovado" titulo="Arrumar aspas e sinais">\nTópico #7 «Arrumar aspas e sinais» aprovado pelo usuário: crie as etapas (orq-topico item) e mande um resumo (orq-topico resumo).\n</orq-topico>');
  assert.match(mandados[1][1], /^<orq-topico id="7" acao="recusado" [^]*recusado pelo usuário/);
});
