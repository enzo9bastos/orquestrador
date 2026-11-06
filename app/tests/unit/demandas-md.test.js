// Área: topicos (demandas em .md)
const test = require('node:test');
const assert = require('node:assert');
const md = require('../../demandas-md');

const T = { id: '3', titulo: 'Pedidos: migrar para o formulário novo', codigo: 'T-1042', agentes: ['Agente 3', 'Agente 4'], estado: 'aberto',
  resumo: 'O formulário de pedidos muda para o novo.', itens: [{ id: 'i1', texto: 'Conferir a regra nova', feito: true }, { id: 'i2', texto: 'Provar as recusas', feito: false }],
  criado: new Date(2026, 9, 30).getTime(), atualizado: new Date(2026, 10, 6).getTime() };

test('demandas: o .md tem linha de estado, resumo, etapas e anotações (o título é o nome do arquivo)', () => {
  const t = md.formatar(T, 'Anotação minha.\n\n- um\n- dois');
  assert.match(t, /^Estado: Em andamento · Código: T-1042 · Agentes: Agente 3, Agente 4\nAberta em 30\/10\/2026 · Atualizada em 06\/11\/2026\n\n## Resumo\n\nO formulário de pedidos muda para o novo\.\n\n## Etapas\n\n- \[x\] Conferir a regra nova\n- \[ \] Provar as recusas\n\n## Anotações\n\nAnotação minha\.\n\n- um\n- dois\n$/);
});

test('demandas: ler devolve o que o .md diz, inclusive o que o usuário mudou à mão', () => {
  let t = md.formatar(T, 'livre');
  t = t.replace('- [ ] Provar as recusas', '- [x] Provar as recusas').replace('Estado: Em andamento', 'Estado: Esperando você')
    .replace('## Anotações', '## Etapas extra?\n\n## Anotações') + '\n';
  const l = md.ler(t);
  assert.strictEqual(l.titulo, null, 'o título vem do nome do arquivo');
  assert.strictEqual(md.ler('# Outro título\n\n' + t).titulo, 'Outro título', 'um # Título escrito à mão também vale');
  assert.strictEqual(l.estado, 'esperando');
  assert.strictEqual(l.codigo, 'T-1042');
  assert.deepStrictEqual(l.agentes, ['Agente 3', 'Agente 4']);
  assert.strictEqual(l.resumo, T.resumo);
  assert.deepStrictEqual(l.itens.map((i) => [i.texto, i.feito]), [['Conferir a regra nova', true], ['Provar as recusas', true]]);
  assert.match(l.anotacoes, /^livre/);
});

test('demandas: o editor de notas devolvendo o arquivo (linha em branco no fim, * no lugar de -) não muda nada', () => {
  const t = md.formatar(T, 'x');
  const editado = t.replace(/^- \[/gm, '* [') + '\n\n';
  assert.deepStrictEqual(md.ler(editado), md.ler(t));
});

test('demandas: arquivo sem a estrutura vira demanda sem perder o texto (fica nas anotações)', () => {
  const l = md.ler('texto solto que alguém escreveu\n\n- [ ] uma etapa');
  assert.strictEqual(l.titulo, null);
  assert.strictEqual(l.estado, null);
  assert.match(l.anotacoes, /texto solto/);
});

test('demandas: nome do arquivo é o título; concluída ganha " - Concluída"; nada de / ou caractere proibido', () => {
  assert.strictEqual(md.nomeArquivo('Pedidos: migrar / formulário', 'aberto'), 'Pedidos - migrar - formulário.md');
  assert.strictEqual(md.nomeArquivo('Painel de vendas', 'concluido'), 'Painel de vendas - Concluída.md');
  assert.strictEqual(md.nomeArquivo('  ', 'aberto'), 'Demanda sem título.md');
  assert.ok(md.nomeArquivo('x'.repeat(400), 'aberto').length <= 150);
});
