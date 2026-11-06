// Área: topicos (demandas gravadas como .md na pasta de notas)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { casaTemporaria } = require('../ajuda');

const casa = casaTemporaria({ pastasNotas: [{ nome: 'Orquestração', caminho: '~/orq' }] });
fs.mkdirSync(path.join(casa, 'orq'));
const topicos = require('../../topicos');
const PASTA = path.join(casa, 'orq', 'Demandas');
const cli = path.join(__dirname, '..', '..', 'bin', 'orq-topico');
const orq = (...a) => execFileSync(process.execPath, [cli, ...a], { env: { ...process.env, HOME: casa }, encoding: 'utf8' });
const arquivos = () => (fs.existsSync(PASTA) ? fs.readdirSync(PASTA).filter((f) => f.endsWith('.md')).sort() : []);
const lerMd = (n) => fs.readFileSync(path.join(PASTA, n), 'utf8');

test('demandas: abrir cria o .md na pasta Demandas da nota Orquestração', () => {
  const t = topicos.abrir({ titulo: 'Revisar os backups', codigo: 'T-2001', agente: 'Agente 1' });
  assert.deepStrictEqual(arquivos(), ['Revisar os backups.md']);
  assert.match(lerMd('Revisar os backups.md'), /^Estado: Em andamento · Código: T-2001 · Agentes: Agente 1\n/);
  assert.strictEqual(topicos.ler().find((x) => x.id === t.id).arquivo, 'Revisar os backups.md');
});

test('demandas: o orquestrador (orq-topico) e a nota mexem no mesmo arquivo; as anotações do usuário ficam intactas', () => {
  const id = topicos.ler().find((x) => x.titulo === 'Revisar os backups').id;
  orq('item', id, 'Conferir o backup de ontem');
  orq('item', id, 'Testar uma restauração');
  // O usuário escreve nas anotações e marca a 1ª etapa pela aba Notas.
  const arq = path.join(PASTA, 'Revisar os backups.md');
  fs.writeFileSync(arq, lerMd('Revisar os backups.md').replace('- [ ] Conferir o backup de ontem', '- [x] Conferir o backup de ontem')
    .replace(/## Anotações\n\n?/, '## Anotações\n\nLigar para o fornecedor na sexta.\n'));
  const t = topicos.ler().find((x) => x.id === id);
  assert.deepStrictEqual(t.itens.map((i) => i.feito), [true, false], 'a marca feita na nota vale');
  orq('marcar', id, '2');
  orq('nota', id, 'Restauração ok em 06/11.');
  const final = lerMd('Revisar os backups.md');
  assert.match(final, /- \[x\] Conferir o backup de ontem\n- \[x\] Testar uma restauração/);
  assert.match(final, /## Anotações\n\nLigar para o fornecedor na sexta\.\nRestauração ok em 06\/11\.\n$/);
});

test('demandas: concluir renomeia para " - Concluída"; reabrir tira; nada é apagado', () => {
  const id = topicos.ler().find((x) => x.titulo === 'Revisar os backups').id;
  topicos.concluir(id);
  assert.deepStrictEqual(arquivos(), ['Revisar os backups - Concluída.md']);
  assert.match(lerMd('Revisar os backups - Concluída.md'), /Estado: Concluída/);
  assert.match(lerMd('Revisar os backups - Concluída.md'), /Ligar para o fornecedor/);
  topicos.estado(id, 'aberto');
  assert.deepStrictEqual(arquivos(), ['Revisar os backups.md']);
});

test('demandas: sugestão só vira arquivo quando aprovada; recusada não vira', () => {
  const s = topicos.sugerir({ titulo: 'Trocar o tema do editor', itens: ['ver cores'] });
  const r = topicos.sugerir({ titulo: 'Ideia recusada' });
  assert.ok(!arquivos().some((f) => f.startsWith('Trocar') || f.startsWith('Ideia')));
  topicos.recusar(r.id);
  topicos.aprovar(s.id, { titulo: 'Trocar o tema do editor (claro)' });
  assert.ok(arquivos().includes('Trocar o tema do editor (claro).md'));
  assert.ok(!arquivos().some((f) => f.startsWith('Ideia')));
});

test('demandas: título igual a outro arquivo nunca sobrescreve — ganha (2)', () => {
  fs.writeFileSync(path.join(PASTA, 'Nota minha.md'), 'NÃO PODE SUMIR\n');
  topicos.abrir({ titulo: 'Nota minha' });
  assert.strictEqual(lerMd('Nota minha.md'), 'NÃO PODE SUMIR\n');
  assert.ok(arquivos().includes('Nota minha (2).md'));
});

test('demandas: estado mudado à mão na nota vale no painel', () => {
  const t = topicos.ler().find((x) => x.titulo === 'Trocar o tema do editor (claro)');
  const arq = path.join(PASTA, t.arquivo);
  fs.writeFileSync(arq, fs.readFileSync(arq, 'utf8').replace('Estado: Em andamento', 'Estado: Esperando você'));
  assert.strictEqual(topicos.ler().find((x) => x.id === t.id).estado, 'esperando');
});

test('demandas: migração — demandas antigas sem arquivo ganham o .md (com as notas antigas nas anotações)', () => {
  const j = JSON.parse(fs.readFileSync(topicos.arq(), 'utf8'));
  j.topicos.push({ id: '99', titulo: 'Antiga concluída', estado: 'concluido', itens: [{ id: 'i1', texto: 'feito', feito: true }], notas: 'nota antiga', criado: 1, atualizado: 1, concluido: 2 });
  fs.writeFileSync(topicos.arq(), JSON.stringify(j));
  const r = topicos.migrarParaNotas();
  assert.ok(r.criados.includes('Antiga concluída - Concluída.md'));
  assert.match(lerMd('Antiga concluída - Concluída.md'), /## Anotações\n\nnota antiga\n$/);
  assert.deepStrictEqual(topicos.migrarParaNotas().criados, [], 'rodar de novo não cria nada');
});

test('demandas: se a ligação com o arquivo se perder, a demanda adota a nota de mesmo título em vez de criar "(2)"', () => {
  const t = topicos.abrir({ titulo: 'Ligação perdida' });
  const arq = path.join(PASTA, 'Ligação perdida.md');
  fs.writeFileSync(arq, fs.readFileSync(arq, 'utf8').replace(/## Anotações\n\n?/, '## Anotações\n\nminha anotação\n'));
  // Um app antigo regravou o índice sem o nome do arquivo.
  const j = JSON.parse(fs.readFileSync(topicos.arq(), 'utf8'));
  for (const x of j.topicos) if (x.id === t.id) { delete x.arquivo; delete x.nomeBase; }
  fs.writeFileSync(topicos.arq(), JSON.stringify(j));
  topicos.migrarParaNotas();
  assert.ok(!arquivos().includes('Ligação perdida (2).md'));
  assert.strictEqual(topicos.ler().find((x) => x.id === t.id).arquivo, 'Ligação perdida.md');
  assert.match(lerMd('Ligação perdida.md'), /minha anotação/);
});
