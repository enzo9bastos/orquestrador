// Área: workflows
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { casaTemporaria } = require('../ajuda');

const casa = casaTemporaria({});
const wf = require('../../workflows');

const mandados = [];
const avisos = [];
let orq = { id: 'orquestrador', orquestrador: true, vivo: false, ocupado: false };
wf.ligar({
  conversa: { lista: () => [orq], mandar: (id, t) => mandados.push([id, t]), ambienteLimpo: () => ({ ...process.env }) },
  avisar: (t, c) => avisos.push([t, c]),
  enviarTela: () => {},
});
wf.desligar(); // o relógio de verdade não roda no teste; o teste roda tique() à mão

test('workflows: primeira vez traz a passada de 3 em 3 min, desligada', () => {
  const l = wf.lista();
  assert.strictEqual(l.length, 1);
  assert.strictEqual(l[0].id, 'passada-frentes');
  assert.strictEqual(l[0].ativo, false, 'o lembrete do Claude continua; este nasce desligado');
  assert.deepStrictEqual(l[0].nos.map((n) => n.tipo), ['agenda', 'orquestrador']);
  assert.strictEqual(l[0].nos[0].config.minutos, 3);
});

test('workflows: limpeza tira tipo desconhecido e ligação que entra num gatilho', () => {
  const g = wf.gravar({ id: 'w-limpo', nome: '  ', nos: [{ id: 'a', tipo: 'manual' }, { id: 'b', tipo: 'xyz' }, { id: 'c', tipo: 'notificar', config: { titulo: 'oi' } }],
    ligacoes: [{ de: 'c', para: 'a' }, { de: 'a', para: 'c' }, { de: 'a', para: 'c' }, { de: 'a', para: 'b' }] });
  assert.strictEqual(g.nome, 'Workflow sem nome');
  assert.deepStrictEqual(g.nos.map((n) => n.id), ['a', 'c']);
  assert.deepStrictEqual(g.ligacoes, [{ de: 'a', para: 'c' }]);
  assert.strictEqual(g.nos[1].config.texto, '{{entrada}}', 'campo que faltou ganha o padrão');
});

test('workflows: gravar guarda a versão anterior; apagar tira só aquele', () => {
  const versoes = path.join(casa, '.local/share/orq-app/versoes/workflows');
  const antes = fs.existsSync(versoes) ? fs.readdirSync(versoes).length : 0;
  wf.gravar({ id: 'w-tmp', nome: 'tmp', nos: [], ligacoes: [] });
  assert.ok(fs.readdirSync(versoes).length > antes);
  assert.ok(wf.apagar('w-tmp'));
  assert.ok(!wf.lista().some((w) => w.id === 'w-tmp'));
  assert.ok(wf.lista().some((w) => w.id === 'passada-frentes'));
});

test('workflows: comando → condição → comando, com a saída passando adiante', async () => {
  wf.gravar({ id: 'w-cadeia', nome: 'cadeia', nos: [
    { id: 'n1', tipo: 'manual' },
    { id: 'n2', tipo: 'comando', config: { comando: 'echo olá mundo' } },
    { id: 'n3', tipo: 'condicao', config: { modo: 'contem', valor: 'OLÁ' } },
    { id: 'n4', tipo: 'comando', config: { comando: 'echo "recebi $ORQ_ENTRADA"' } },
    { id: 'n5', tipo: 'condicao', config: { modo: 'contem', valor: 'xyz' } },
    { id: 'n6', tipo: 'notificar', config: { titulo: 'não devia' } },
    { id: 'n7', tipo: 'notificar', config: { titulo: 'Aviso', texto: 'veio: {{entrada}}' } },
  ], ligacoes: [{ de: 'n1', para: 'n2' }, { de: 'n2', para: 'n3' }, { de: 'n3', para: 'n4' }, { de: 'n2', para: 'n5' }, { de: 'n5', para: 'n6' }, { de: 'n4', para: 'n7' }] });
  const r = await wf.rodar('w-cadeia');
  assert.ok(r.ok, JSON.stringify(r.execucao.passos));
  const p = Object.fromEntries(r.execucao.passos.map((x) => [x.no, x]));
  assert.strictEqual(p.n4.saida, 'recebi olá mundo');
  assert.strictEqual(p.n5.estado, 'parou');
  assert.ok(!p.n6, 'ramo da condição falsa não roda');
  assert.deepStrictEqual(avisos.pop(), ['Aviso', 'veio: recebi olá mundo']);
  assert.strictEqual(wf.execucoes('w-cadeia')[0].id, r.execucao.id, 'a execução fica guardada');
});

test('workflows: comando que falha marca erro e não segue', async () => {
  wf.gravar({ id: 'w-erro', nome: 'erro', nos: [{ id: 'n1', tipo: 'manual' }, { id: 'n2', tipo: 'comando', config: { comando: 'echo ruim >&2; exit 3' } }, { id: 'n3', tipo: 'notificar' }],
    ligacoes: [{ de: 'n1', para: 'n2' }, { de: 'n2', para: 'n3' }] });
  const r = await wf.rodar('w-erro');
  assert.strictEqual(r.ok, false);
  assert.match(r.execucao.passos[1].saida, /código 3: ruim/);
  assert.strictEqual(r.execucao.passos.length, 2);
});

test('workflows: mandar ao orquestrador respeita rodada iniciada e ocupado', async () => {
  wf.gravar({ id: 'w-orq', nome: 'orq', nos: [{ id: 'n1', tipo: 'manual' }, { id: 'n2', tipo: 'orquestrador', config: { texto: 'passada {{entrada}}fim' } }], ligacoes: [{ de: 'n1', para: 'n2' }] });
  let r = await wf.rodar('w-orq');
  assert.strictEqual(r.execucao.passos[1].estado, 'parou');
  assert.match(r.execucao.passos[1].saida, /rodada não está iniciada/);
  orq = { ...orq, vivo: true, ocupado: true };
  r = await wf.rodar('w-orq');
  assert.match(r.execucao.passos[1].saida, /respondendo/);
  assert.strictEqual(mandados.length, 0);
  orq = { ...orq, ocupado: false };
  r = await wf.rodar('w-orq');
  assert.strictEqual(r.execucao.passos[1].estado, 'ok');
  assert.deepStrictEqual(mandados, [['orquestrador', 'passada fim']]);
});

test('workflows: Perguntar ao Claude manda o pedido pela entrada e devolve a resposta', async () => {
  const falso = path.join(casa, 'claude-falso');
  fs.writeFileSync(falso, '#!/bin/sh\necho "modelo $3"; cat\n', { mode: 0o755 });
  process.env.ORQ_WF_CLAUDE = falso;
  wf.gravar({ id: 'w-claude', nome: 'claude', nos: [{ id: 'n1', tipo: 'manual' }, { id: 'n2', tipo: 'claude', config: { prompt: 'resuma isto', modelo: 'haiku' } }], ligacoes: [{ de: 'n1', para: 'n2' }] });
  const r = await wf.rodar('w-claude');
  assert.strictEqual(r.execucao.passos[1].saida, 'modelo haiku\nresuma isto');
  delete process.env.ORQ_WF_CLAUDE;
});

test('workflows: relógio — intervalo não dispara na abertura; dispara depois do prazo', async () => {
  wf.gravar({ id: 'w-relogio', nome: 'relógio', ativo: true, nos: [{ id: 'n1', tipo: 'agenda', config: { modo: 'intervalo', minutos: 2 } }, { id: 'n2', tipo: 'notificar', config: { titulo: 'tique' } }], ligacoes: [{ de: 'n1', para: 'n2' }] });
  const t0 = Date.now();
  wf.tique(t0);
  wf.tique(t0 + 60000);
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(!avisos.some((a) => a[0] === 'tique'));
  wf.tique(t0 + 121000);
  await new Promise((r) => setTimeout(r, 300));
  assert.strictEqual(avisos.filter((a) => a[0] === 'tique').length, 1);
  assert.strictEqual(wf.execucoes('w-relogio')[0].motivo, 'relógio');
});

test('workflows: relógio diário — uma vez no horário, nunca fora dele, sem fim de semana', () => {
  const c = { modo: 'diario', horario: '08:30', diasUteis: true };
  const seg = new Date(2026, 9, 26, 8, 31).getTime(); // segunda
  assert.ok(wf.vence(c, seg, 0));
  assert.ok(!wf.vence(c, seg, seg - 30000), 'já disparou hoje');
  assert.ok(!wf.vence(c, new Date(2026, 9, 26, 8, 29).getTime(), 0), 'antes da hora');
  assert.ok(!wf.vence(c, new Date(2026, 9, 26, 9, 0).getTime(), 0), 'passou muito da hora');
  assert.ok(!wf.vence(c, new Date(2026, 9, 25, 8, 31).getTime(), 0), 'domingo');
  assert.ok(wf.vence({ ...c, diasUteis: false }, new Date(2026, 9, 25, 8, 31).getTime(), 0));
});
