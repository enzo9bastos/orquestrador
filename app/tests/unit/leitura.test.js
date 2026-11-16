// Área: leitura (leitor de arquivos .jsonl: transcripts, recados e eventos sem ler tudo)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const jsonl = require('../../jsonl');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-leitura-'));
let n = 0;
const novo = () => path.join(dir, `a${n++}.jsonl`);
const j = (o) => JSON.stringify(o);
const linhasDe = (qtd, f = (i) => ({ i, t: 'é'.repeat(i % 37) })) => Array.from({ length: qtd }, (_, i) => j(f(i)));

test('lerFim: nunca devolve linha cortada, em qualquer tamanho de janela', () => {
  const arq = novo();
  const ls = linhasDe(300);
  fs.writeFileSync(arq, ls.join('\n') + '\n');
  for (let b = 1; b < 900; b += 7) {
    const r = jsonl.lerFim(arq, b);
    for (const l of r.linhas) assert.doesNotThrow(() => JSON.parse(l), `janela ${b}`);
    assert.deepStrictEqual(r.linhas, ls.slice(ls.length - r.linhas.length), `janela ${b}: só as últimas, na ordem`);
  }
  assert.strictEqual(jsonl.lerFim(arq, 1e9).linhas.length, 300, 'janela maior que o arquivo lê tudo');
  assert.strictEqual(jsonl.lerFim(arq, 1e9).completo, true);
});

test('lerFim: a última linha sem \\n (ainda sendo escrita ou não) continua valendo', () => {
  const arq = novo();
  fs.writeFileSync(arq, linhasDe(5).join('\n')); // sem \n no fim
  assert.strictEqual(jsonl.lerFim(arq, 1e6).linhas.length, 5);
});

test('lerCabeca: nunca devolve linha cortada, e sem arquivo devolve vazio', () => {
  const arq = novo();
  const ls = linhasDe(300);
  fs.writeFileSync(arq, ls.join('\n') + '\n');
  for (let b = 1; b < 900; b += 7) {
    const r = jsonl.lerCabeca(arq, b);
    for (const l of r.linhas) assert.doesNotThrow(() => JSON.parse(l), `janela ${b}`);
    assert.deepStrictEqual(r.linhas, ls.slice(0, r.linhas.length));
  }
  assert.deepStrictEqual(jsonl.lerCabeca(path.join(dir, 'nao-existe.jsonl'), 10).linhas, []);
  assert.deepStrictEqual(jsonl.lerFim(path.join(dir, 'nao-existe.jsonl'), 10).linhas, []);
});

test('linhasDeTras: todas as linhas, da mais nova à mais antiga, com qualquer tamanho de página', () => {
  const arq = novo();
  const ls = linhasDe(120, (i) => ({ i, t: i === 50 ? 'x'.repeat(5000) : 'é'.repeat(i % 37) }));
  fs.writeFileSync(arq, ls.join('\n') + '\n');
  for (const pagina of [1, 2, 7, 64, 1000, 1e6]) {
    const r = [...jsonl.linhasDeTras(arq, { pagina })].map((x) => x.linha);
    assert.deepStrictEqual(r, [...ls].reverse(), `página ${pagina}`);
  }
  // fim = deslocamento logo depois de cada linha (sem o \n), e `ate` corta ali.
  const fins = [...jsonl.linhasDeTras(arq, { pagina: 50 })].map((x) => x.fim);
  let o = 0;
  ls.forEach((l, k) => { o += Buffer.byteLength(l); assert.strictEqual(fins[ls.length - 1 - k], o); o += 1; });
  const ate = fins[ls.length - 1 - 9]; // fim da linha 9
  assert.strictEqual([...jsonl.linhasDeTras(arq, { ate })].length, 10);
  assert.strictEqual(jsonl.fimDaLinhaCom(arq, '"i":9,'), ate);
  assert.strictEqual(jsonl.fimDaLinhaCom(arq, 'não existe'), null);
});

test('incremental: relê só o que entrou, espera linha pela metade e recomeça se o arquivo foi trocado', () => {
  const arq = novo();
  const leitor = jsonl.incremental(arq);
  assert.deepStrictEqual(leitor.ler(), { linhas: [], recomecou: false }, 'sem arquivo');
  fs.writeFileSync(arq, linhasDe(3).join('\n') + '\n');
  assert.strictEqual(leitor.ler().linhas.length, 3);
  const antes = jsonl.estatisticas.bytesLidos;
  assert.strictEqual(leitor.ler().linhas.length, 0, 'nada novo');
  assert.ok(jsonl.estatisticas.bytesLidos - antes <= 64, 'sem novidade só confere o cabeçalho');
  fs.appendFileSync(arq, j({ i: 3 }) + '\n' + '{"i":4,"meta');
  assert.deepStrictEqual(leitor.ler().linhas, [j({ i: 3 })], 'a linha pela metade espera');
  fs.appendFileSync(arq, 'de":1}\n');
  assert.deepStrictEqual(leitor.ler().linhas, ['{"i":4,"metade":1}'], 'completa, vem inteira');
  // Truncado: recomeça.
  fs.writeFileSync(arq, j({ novo: 1 }) + '\n');
  const t = leitor.ler();
  assert.deepStrictEqual([t.linhas, t.recomecou], [[j({ novo: 1 })], true]);
  // Reescrito maior que o deslocamento, mas com outro começo: também recomeça.
  fs.writeFileSync(arq, linhasDe(50).map((l) => l.replace('"i"', '"k"')).join('\n') + '\n');
  const r = leitor.ler();
  assert.deepStrictEqual([r.linhas.length, r.recomecou], [50, true]);
  // Trocado por outro arquivo (outro inode, tamanho parecido).
  const outro = novo();
  fs.writeFileSync(outro, linhasDe(50).map((l) => l.replace('"i"', '"k"')).join('\n') + '\n');
  fs.renameSync(outro, arq);
  assert.strictEqual(leitor.ler().recomecou, true);
});
