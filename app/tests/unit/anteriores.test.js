// Área: conversa (conversas anteriores: a lista do que o Claude guardou e as arquivadas; plano 3.2)
// Há conversa de 100+ MB: a lista lê só o começo e o fim de cada arquivo (64 KB cada) e guarda
// o que achou num índice, relendo só o arquivo que mudou.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { casaTemporaria } = require('../ajuda');

const casa = casaTemporaria({});
const anteriores = require('../../anteriores');

const raiz = path.join(casa, '.claude', 'projects');
let n = 0;
const linha = (o) => JSON.stringify(o);
const deVoce = (texto, extra = {}) => linha({ type: 'user', message: { role: 'user', content: texto }, cwd: '/srv/projetos/api', timestamp: '2026-11-10T10:00:00.000Z', ...extra });
const doClaude = (texto) => linha({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: texto }] } });
// Grava um arquivo de conversa e devolve { sessao, arq }. quando: data do arquivo (ms).
function conversa(linhas, { pasta = '-srv-projetos-api', sessao = null, quando = null } = {}) {
  const id = sessao || `sessao-de-teste-${String(++n).padStart(4, '0')}`;
  const dir = path.join(raiz, pasta);
  fs.mkdirSync(dir, { recursive: true });
  const arq = path.join(dir, `${id}.jsonl`);
  fs.writeFileSync(arq, `${linhas.join('\n')}\n`);
  if (quando) fs.utimesSync(arq, quando / 1000, quando / 1000);
  return { sessao: id, arq };
}
const achar = async (sessao) => (await anteriores.listar()).find((x) => x.sessao === sessao);

test('anteriores: o título é a primeira mensagem da pessoa; a pasta vem do arquivo; o nome dado com /rename vale mais', async () => {
  const a = conversa([linha({ type: 'summary', summary: 'x' }), deVoce('<local-command-stdout>x</local-command-stdout>'), deVoce('ajusta o botão   de exportar\npor favor'), doClaude('feito'), deVoce('obrigado')]);
  const r = await achar(a.sessao);
  assert.deepStrictEqual({ titulo: r.titulo, pasta: r.pasta, arquivo: r.arquivo }, { titulo: 'ajusta o botão de exportar por favor', pasta: '/srv/projetos/api', arquivo: a.arq });
  assert.strictEqual(r.bytes, fs.statSync(a.arq).size);
  const b = conversa([deVoce('primeira mensagem'), linha({ type: 'custom-title', customTitle: 'Nome antigo' }), doClaude('ok'), linha({ type: 'custom-title', customTitle: 'Revisão do contrato' })]);
  assert.strictEqual((await achar(b.sessao)).titulo, 'Revisão do contrato');
});

test('anteriores: ficam de fora o arquivo de subagente, a conversa de lado, o que não tem mensagem da pessoa e nome que não é de sessão', async () => {
  const boa = conversa([deVoce('esta entra')]);
  conversa([deVoce('subagente')], { sessao: 'agent-abcdef123456' });
  const lado = conversa([deVoce('de lado', { isSidechain: true }), doClaude('x')]);
  const vazia = conversa([linha({ type: 'summary', summary: 'só resumo' }), doClaude('sem ninguém')]);
  const meta = conversa([deVoce('instrução interna', { isMeta: true })]);
  fs.writeFileSync(path.join(raiz, '-srv-projetos-api', 'curto.jsonl'), `${deVoce('nome curto demais')}\n`);
  fs.writeFileSync(path.join(raiz, '-srv-projetos-api', 'notas.txt'), 'não é conversa\n');
  const ids = (await anteriores.listar()).map((x) => x.sessao);
  assert.ok(ids.includes(boa.sessao));
  for (const fora of ['agent-abcdef123456', lado.sessao, vazia.sessao, meta.sessao, 'curto']) assert.ok(!ids.includes(fora), fora);
});

test('anteriores: arquivo grande é lido só no começo e no fim (o meio não é lido) e o nome dado no fim é achado', async () => {
  const meio = Array.from({ length: 6000 }, (_, i) => doClaude(`linha de enchimento ${i} ${'x'.repeat(400)}`));
  // Um nome dado bem no meio do arquivo: se o meio fosse lido, ele viraria o título.
  meio[3000] = linha({ type: 'custom-title', customTitle: 'NOME DO MEIO' });
  const a = conversa([deVoce('conversa comprida'), ...meio, doClaude('fim')]);
  assert.ok(fs.statSync(a.arq).size > 2 * 1024 * 1024, 'o arquivo de teste ficou pequeno');
  assert.strictEqual((await achar(a.sessao)).titulo, 'conversa comprida');
  const b = conversa([deVoce('outra comprida'), ...meio.filter((_, i) => i !== 3000), linha({ type: 'custom-title', customTitle: 'Nome dado no fim' })]);
  assert.strictEqual((await achar(b.sessao)).titulo, 'Nome dado no fim');
  // Linha gigante cortada no começo (maior que o pedaço lido) não derruba a leitura.
  const c = conversa([deVoce(`gigante ${'y'.repeat(200000)}`), ...meio.slice(0, 500), deVoce('mensagem do fim')]);
  assert.strictEqual((await achar(c.sessao)).titulo, 'mensagem do fim');
});

test('anteriores: o índice evita reler arquivo que não mudou (tamanho e data iguais) e relê o que mudou', async () => {
  const quando = Date.now() - 60000;
  const a = conversa([deVoce('titulo um')], { quando });
  assert.strictEqual((await achar(a.sessao)).titulo, 'titulo um');
  // Mesmo tamanho e mesma data, conteúdo diferente: sem reler, a lista continua com o que estava no índice.
  fs.writeFileSync(a.arq, `${deVoce('titulo 99')}\n`);
  fs.utimesSync(a.arq, quando / 1000, quando / 1000);
  assert.strictEqual((await achar(a.sessao)).titulo, 'titulo um', 'releu um arquivo que não mudou de tamanho nem de data');
  // A data mudou: relê.
  fs.utimesSync(a.arq, (quando + 5000) / 1000, (quando + 5000) / 1000);
  assert.strictEqual((await achar(a.sessao)).titulo, 'titulo 99');
  const indice = JSON.parse(fs.readFileSync(anteriores._arquivos.indice(), 'utf8'));
  assert.ok(indice.arquivos[a.arq] && indice.arquivos[a.arq].tam === fs.statSync(a.arq).size);
  // Índice estragado não derruba a lista.
  fs.writeFileSync(anteriores._arquivos.indice(), '{ isto não é json');
  assert.strictEqual((await achar(a.sessao)).titulo, 'titulo 99');
});

test('anteriores: 80 conversas em várias pastas saem todas, da mais nova para a mais antiga; a mesma sessão em duas pastas aparece uma vez', async () => {
  const base = Date.now() - 80 * 60000;
  const feitas = Array.from({ length: 80 }, (_, i) => conversa([deVoce(`conversa em lote ${i}`)], { pasta: `-lote-${i % 5}`, quando: base + i * 60000 }));
  const lista = (await anteriores.listar()).filter((x) => /^conversa em lote \d+$/.test(x.titulo));
  assert.strictEqual(lista.length, 80);
  assert.deepStrictEqual(lista.slice(0, 3).map((x) => x.titulo), ['conversa em lote 79', 'conversa em lote 78', 'conversa em lote 77']);
  assert.ok(lista.every((x, i) => i === 0 || lista[i - 1].quando >= x.quando), 'fora de ordem');
  // A pasta foi renomeada e a sessão ficou nas duas: vale a cópia mais nova.
  conversa([deVoce('cópia velha')], { pasta: '-pasta-velha', sessao: feitas[0].sessao, quando: base - 60000 });
  const repetidas = (await anteriores.listar()).filter((x) => x.sessao === feitas[0].sessao);
  assert.strictEqual(repetidas.length, 1);
  assert.strictEqual(repetidas[0].titulo, 'conversa em lote 0');
});

test('anteriores: título e pasta que vêm do arquivo são limpos (uma linha, tamanho limitado, pasta só se for caminho completo)', async () => {
  const a = conversa([linha({ type: 'user', message: { role: 'user', content: `linha um\n\x1b[31mvermelho\x1b[0m\u0007 ${'z'.repeat(300)}` }, cwd: 'relativa/sem-barra' })]);
  const r = await achar(a.sessao);
  assert.ok(r.titulo.startsWith('linha um vermelho z') && r.titulo.length === 100, r.titulo);
  assert.strictEqual(r.pasta, '');
});

test('arquivadas: arquivar grava a marca com título, motor e pasta; desarquivar tira; arquivo estragado vale como lista vazia', () => {
  assert.deepStrictEqual(anteriores.lerArquivadas(), {});
  assert.strictEqual(anteriores.arquivar('sessao-arquivada-1', { titulo: 'Teste de importação\nde planilha', motor: 'claude', pasta: '/srv/projetos/api' }), true);
  assert.strictEqual(anteriores.arquivar('th-codex-123456', { titulo: 'Revisão do site', motor: 'codex', pasta: 'relativa' }), true);
  assert.strictEqual(anteriores.arquivar('x', { titulo: 'id inválido' }), false);
  const s = anteriores.lerArquivadas();
  assert.deepStrictEqual(Object.keys(s).sort(), ['sessao-arquivada-1', 'th-codex-123456']);
  assert.deepStrictEqual({ titulo: s['sessao-arquivada-1'].titulo, motor: s['sessao-arquivada-1'].motor, pasta: s['sessao-arquivada-1'].pasta }, { titulo: 'Teste de importação de planilha', motor: 'claude', pasta: '/srv/projetos/api' });
  assert.deepStrictEqual({ motor: s['th-codex-123456'].motor, pasta: s['th-codex-123456'].pasta }, { motor: 'codex', pasta: '' });
  assert.ok(s['sessao-arquivada-1'].quando > 0);
  assert.strictEqual(anteriores.desarquivar('sessao-arquivada-1'), true);
  assert.strictEqual(anteriores.desarquivar('sessao-arquivada-1'), false);
  assert.deepStrictEqual(Object.keys(anteriores.lerArquivadas()), ['th-codex-123456']);
  fs.writeFileSync(anteriores._arquivos.arquivadas(), 'lixo');
  assert.deepStrictEqual(anteriores.lerArquivadas(), {});
});
