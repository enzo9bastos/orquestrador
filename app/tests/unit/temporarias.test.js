// Área: testes (a bateria não deixa sobra em /tmp e nunca abre janela na tela de verdade)
// 16/11: cada teste deixava a casa temporária em /tmp (uma bateria inteira,
// ~170 pastas; 38 GB acumulados). Agora a pasta é apagada quando o teste passa,
// fica quando falha, e a limpeza só toca no que o próprio processo criou.
// E o npm test, fora de uma tela virtual, se reexecuta no xvfb-run (ou para,
// se não houver xvfb-run): uma caixa de erro de teste já apareceu na tela.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { pastaTemporaria, podeApagar, RAIZ } = require('../temporarias');

const TEMPORARIAS = path.join(__dirname, '..', 'temporarias.js');
const RODAR = path.join(__dirname, '..', 'rodar.js');

test('temporárias: só aceita prefixo "orq-" e cria direto na pasta temporária do sistema', () => {
  assert.throws(() => pastaTemporaria('outra-'), /prefixo/);
  assert.throws(() => pastaTemporaria('orq-../fora-'), /prefixo/);
  const d = pastaTemporaria('orq-temporarias-');
  assert.strictEqual(path.dirname(d), RAIZ);
  assert.ok(podeApagar(d), 'a pasta criada por este processo pode ser apagada');
});

test('temporárias: a limpeza recusa o que não é exatamente uma pasta criada por este processo', () => {
  const a = pastaTemporaria('orq-temporarias-');
  const b = pastaTemporaria('orq-temporarias-');
  fs.mkdirSync(path.join(a, 'dentro'));
  fs.symlinkSync(b, path.join(a, 'link'));
  assert.strictEqual(podeApagar(path.join(a, 'dentro')), false, 'subpasta: não está direto na pasta temporária');
  assert.strictEqual(podeApagar(path.join(a, 'link')), false, 'link');
  assert.strictEqual(podeApagar(`${a}/../${path.basename(b)}x`), false, 'caminho com ".." que não foi criado aqui');
  assert.strictEqual(podeApagar(RAIZ), false, 'a própria pasta temporária');
  assert.strictEqual(podeApagar(path.join(RAIZ, 'orq-nunca-criada')), false, 'pasta que este processo não criou');
  assert.strictEqual(podeApagar('orq-relativo'), false, 'caminho relativo');
  // A pasta anotada foi trocada por um link no meio do caminho: não segue.
  fs.rmSync(path.join(a, 'link'));
  fs.rmdirSync(path.join(a, 'dentro'));
  fs.rmdirSync(a);
  fs.symlinkSync(b, a);
  try {
    assert.strictEqual(podeApagar(a), false, 'pasta trocada por link');
    assert.ok(fs.existsSync(b));
  } finally { fs.unlinkSync(a); fs.mkdirSync(a); }
});

// Um arquivo de teste de verdade, rodado pelo node --test, com uma pasta
// temporária própria (TMPDIR dentro da pasta deste teste): o que ele guardar
// some junto com a pasta deste teste.
function rodarArquivoDeTeste(corpo, env = {}) {
  const area = pastaTemporaria('orq-temporarias-');
  const tmp = path.join(area, 'tmp');
  fs.mkdirSync(tmp);
  const arq = path.join(area, 'exemplo.test.js');
  fs.writeFileSync(arq, `const test = require('node:test');\nconst { pastaTemporaria } = require(${JSON.stringify(TEMPORARIAS)});\nconst fs = require('fs');\n${corpo}\n`);
  const e = { ...process.env, TMPDIR: tmp, ORQ_TESTE_GUARDAR: '', ...env };
  delete e.NODE_TEST_CONTEXT; // um node --test de verdade, não um filho deste
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', arq], { env: e, encoding: 'utf8' });
  return { ...r, saida: r.stdout + r.stderr, sobras: fs.readdirSync(tmp).sort() };
}

test('temporárias: teste que passa apaga a pasta dele; o que falha guarda e mostra o caminho', () => {
  const r = rodarArquivoDeTeste(`
    const topo = pastaTemporaria('orq-topo-');
    test('passa', () => { fs.writeFileSync(pastaTemporaria('orq-passa-') + '/a', 'x'); });
    test('falha', () => { pastaTemporaria('orq-falha-'); throw new Error('de propósito'); });
    test('pai', async (t) => { pastaTemporaria('orq-pai-'); await t.test('filho que falha', () => { throw new Error('de propósito'); }); });
    test('pendente', { todo: true }, () => { pastaTemporaria('orq-todo-'); throw new Error('ainda não'); });
  `);
  assert.strictEqual(r.status, 1, r.saida);
  const prefixos = r.sobras.map((s) => s.replace(/-[^-]+$/, ''));
  assert.deepStrictEqual(prefixos, ['orq-falha', 'orq-pai', 'orq-todo', 'orq-topo'], 'fica o que falhou (e o pai de quem falhou, e o começo do arquivo); o que passou some');
  for (const s of r.sobras.filter((x) => !x.startsWith('orq-todo'))) assert.match(r.saida, new RegExp(`pasta temporária guardada \\(teste falhou\\): .*${s}`));
});

test('temporárias: sem falha nada fica (teste "todo" não conta como falha)', () => {
  const r = rodarArquivoDeTeste(`
    pastaTemporaria('orq-topo-');
    test('passa', () => { pastaTemporaria('orq-passa-'); });
    test('pendente', { todo: true }, () => { pastaTemporaria('orq-todo-'); throw new Error('ainda não'); });
  `);
  assert.strictEqual(r.status, 0, r.saida);
  assert.deepStrictEqual(r.sobras, []);
});

test('temporárias: ORQ_TESTE_GUARDAR=1 guarda tudo e diz onde', () => {
  const r = rodarArquivoDeTeste("test('passa', () => { pastaTemporaria('orq-passa-'); });", { ORQ_TESTE_GUARDAR: '1' });
  assert.strictEqual(r.status, 0, r.saida);
  assert.strictEqual(r.sobras.length, 1);
  assert.match(r.saida, new RegExp(`pasta temporária guardada: .*${r.sobras[0]}`));
});

// ── Tela virtual ────────────────────────────────────────────────────────────
// O rodar.js só decide (não abre app nenhum): um xvfb-run falso anota com que
// argumentos rodou. DISPLAY aponta para uma tela que não é Xvfb.
const temElectron = (() => { try { return fs.existsSync(require(path.join(__dirname, '..', '..', 'node_modules', 'electron'))); } catch { return false; } })();
function rodarComPath(bin, env = {}) {
  const e = { ...process.env, PATH: bin, DISPLAY: ':4242', WAYLAND_DISPLAY: 'wayland-teste', ORQ_TESTE_NA_TELA: '', ORQ_TESTE_REEXECUTADO: '', ...env };
  delete e.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, [RODAR, 'testes'], { env: e, encoding: 'utf8', timeout: 20000 });
}

test('tela virtual: fora dela, o npm test se reexecuta dentro do xvfb-run -a, sem a sessão Wayland', { skip: !temElectron && 'sem Electron instalado' }, () => {
  const bin = pastaTemporaria('orq-xvfb-');
  const anota = path.join(bin, 'chamada.json');
  fs.writeFileSync(path.join(bin, 'xvfb-run'), `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(anota)}, JSON.stringify({ args: process.argv.slice(2), wayland: process.env.WAYLAND_DISPLAY || null, marca: process.env.ORQ_TESTE_REEXECUTADO }));\nprocess.exit(7);\n`, { mode: 0o755 });
  const r = rodarComPath(bin);
  assert.strictEqual(r.status, 7, 'o código de saída é o da bateria reexecutada');
  const c = JSON.parse(fs.readFileSync(anota, 'utf8'));
  assert.deepStrictEqual(c.args, ['-a', process.execPath, RODAR, 'testes']);
  assert.strictEqual(c.wayland, null, 'o Electron não pode achar a sessão Wayland de verdade');
  assert.strictEqual(c.marca, '1');
});

test('tela virtual: sem xvfb-run, para e diz como instalar (não abre nada)', { skip: !temElectron && 'sem Electron instalado' }, () => {
  const r = rodarComPath(pastaTemporaria('orq-xvfb-'));
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /sudo apt install xvfb/);
  assert.match(r.stderr, /ORQ_TESTE_NA_TELA=1/);
  assert.doesNotMatch(r.stdout, /== tela/, 'não rodou teste de tela');
});

test('tela virtual: reexecutado e ainda fora de um Xvfb, para em vez de abrir janela', { skip: !temElectron && 'sem Electron instalado' }, () => {
  const r = rodarComPath(pastaTemporaria('orq-xvfb-'), { ORQ_TESTE_REEXECUTADO: '1' });
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /não é um Xvfb/);
});
