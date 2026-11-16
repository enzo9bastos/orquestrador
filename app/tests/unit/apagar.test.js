// Área: apagar
// apagar.js (0.E2): lixeira ou cópia em versoes/, custo em números antes e um
// comprovante por item. Tudo numa casa temporária e com uma lixeira FALSA
// (move para uma pasta do teste): nada aqui toca a lixeira de verdade nem
// ~/.local/share/orq-app.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { casaTemporaria, escrever } = require('../ajuda');

const casa = casaTemporaria();
const apagar = require('../../apagar');

const fsp = fs.promises;
let n = 0;
// Um cenário por teste: a raiz permitida (proj), versões e registro próprios.
function cenario(opcoes = {}) {
  const dir = path.join(casa, `c${++n}`);
  const proj = path.join(dir, 'proj');
  fs.mkdirSync(proj, { recursive: true });
  const lixo = path.join(dir, 'lixeira-falsa');
  const chamadas = [];
  const lixeira = opcoes.semLixeira ? null : async (abs) => {
    chamadas.push(abs);
    if (opcoes.falharEm && opcoes.falharEm(abs)) throw new Error('lixeira falsa: não aceitou');
    await fsp.mkdir(lixo, { recursive: true });
    await fsp.rename(abs, path.join(lixo, `${chamadas.length}-${path.basename(abs)}`));
  };
  const m = apagar.criar({
    lixeira,
    pastaVersoes: path.join(dir, 'versoes'),
    arquivoRegistro: path.join(dir, 'registro-apagar.jsonl'),
    ...(opcoes.criar || {}),
  });
  const esc = (rel, txt) => escrever(dir, path.join('proj', rel), txt);
  const registro = () => { try { return fs.readFileSync(path.join(dir, 'registro-apagar.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } };
  return { dir, proj, lixo, chamadas, m, esc, registro, raizes: [proj] };
}
const existe = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };

// --- custo certo -------------------------------------------------------------------

test('apagar: o custo conta arquivos, pastas, links e bytes certos, e diz para onde vai', async () => {
  const c = cenario();
  c.esc('conversa/a.jsonl', '12345');          // 5
  c.esc('conversa/sub/b.txt', 'abcdefghij');   // 10
  c.esc('conversa/sub/c.bin', 'x'.repeat(100)); // 100
  fs.symlinkSync('a.jsonl', path.join(c.proj, 'conversa', 'atalho'));
  const r = await c.m.prepararApagar({ tipo: 'conversa', alvos: [path.join(c.proj, 'conversa')], raizes: c.raizes,
    dependentes: [{ quem: 'Conversa "Ana"', porque: 'o --resume usa este transcript' }], alternativa: 'Arquivar a conversa' });
  assert.equal(r.ok, true, r.motivo);
  assert.equal(r.custo.arquivos, 3);
  assert.equal(r.custo.pastas, 2);
  assert.equal(r.custo.links, 1);
  assert.equal(r.custo.bytes, 115);
  assert.equal(r.custo.destino, 'lixeira');
  assert.deepEqual(r.custo.volta, { de: 'lixeira', onde: null, arquivos: 3, links: 1, bytes: 115 });
  assert.deepEqual(r.custo.naoVolta, ['lixeira-esvaziada']);
  assert.deepEqual(r.custo.orfaos, [{ quem: 'Conversa "Ana"', porque: 'o --resume usa este transcript' }]);
  assert.equal(r.custo.alternativa, 'Arquivar a conversa');
  assert.match(r.comprovante, /^[0-9a-f]{48}$/);
});

test('apagar: um registro lógico (vários arquivos) soma o custo de todos', async () => {
  const c = cenario();
  const t = c.esc('s1.jsonl', 'a'.repeat(40));
  c.esc('s1/sub-1.jsonl', 'b'.repeat(2));
  const r = await c.m.prepararApagar({ tipo: 'conversa', alvos: [t, path.join(c.proj, 's1')], raizes: c.raizes });
  assert.equal(r.ok, true, r.motivo);
  assert.equal(r.custo.arquivos, 2);
  assert.equal(r.custo.bytes, 42);
  assert.deepEqual(r.custo.alvos.map((a) => [a.tipo, a.arquivos, a.bytes]), [['arquivo', 1, 40], ['pasta', 1, 2]]);
});

test('apagar: sem lixeira ligada, o destino é a cópia em versoes/ e o custo diz o que não volta', async () => {
  const c = cenario({ semLixeira: true });
  const a = c.esc('n.md', 'nota');
  const r = await c.m.prepararApagar({ tipo: 'nota', alvos: [a], raizes: c.raizes });
  assert.equal(r.custo.destino, 'versoes');
  assert.equal(r.custo.volta.onde, path.join(c.dir, 'versoes'));
  assert.deepEqual(r.custo.naoVolta, ['datas-e-dono']);
  const pedeLixeira = await c.m.prepararApagar({ tipo: 'nota', alvos: [a], raizes: c.raizes, destino: 'lixeira' });
  assert.equal(pedeLixeira.codigo, 'sem-lixeira');
});

// --- nada some sem confirmação ------------------------------------------------------

test('apagar: preparar não apaga nada; executar sem comprovante (ou inventado) recusa e nada some', async () => {
  const c = cenario();
  const a = c.esc('x.md', 'conteúdo');
  const r = await c.m.prepararApagar({ tipo: 'nota', alvos: [a], raizes: c.raizes });
  assert.equal(r.ok, true);
  assert.ok(existe(a), 'preparar não pode apagar');
  for (const comprovante of [undefined, null, '', 'f'.repeat(48), { id: r.comprovante }]) {
    const e = await c.m.executarApagar({ comprovante, alvos: [a] });
    assert.equal(e.ok, false);
    assert.equal(e.codigo, 'comprovante-invalido');
  }
  assert.ok(existe(a), 'executar sem comprovante não pode apagar');
  assert.equal(c.chamadas.length, 0, 'a lixeira não foi chamada');
  assert.deepEqual(c.registro(), []);
});

test('apagar: com o comprovante vai para a lixeira, e o registro diz o que, para onde e quanto (sem conteúdo)', async () => {
  const c = cenario();
  const a = c.esc('pasta/x.md', 'SEGREDO-NAO-VAI-AO-REGISTRO');
  const alvo = path.join(c.proj, 'pasta');
  const r = await c.m.prepararApagar({ tipo: 'nota', alvos: [alvo], raizes: c.raizes, alternativa: 'texto livre de quem chama' });
  const e = await c.m.executarApagar({ comprovante: r.comprovante, alvos: [alvo] });
  assert.equal(e.ok, true, e.motivo);
  assert.equal(e.destino, 'lixeira');
  assert.ok(!existe(a));
  assert.deepEqual(c.chamadas, [alvo]);
  assert.ok(fs.readdirSync(c.lixo).length === 1, 'está na lixeira (falsa)');
  const l = c.registro();
  assert.equal(l.length, 1);
  assert.deepEqual({ ...l[0], quando: 'x' }, { quando: 'x', operacao: 'apagar', tipo: 'nota', resultado: 'ok', destino: 'lixeira', onde: null, alvos: [alvo], arquivos: 1, bytes: 27 });
  const cru = fs.readFileSync(path.join(c.dir, 'registro-apagar.jsonl'), 'utf8');
  assert.doesNotMatch(cru, /SEGREDO|texto livre/);
  assert.equal(fs.statSync(path.join(c.dir, 'registro-apagar.jsonl')).mode & 0o777, 0o600);
});

test('apagar: destino versoes copia ANTES de remover, com manifesto, e a cópia é igual ao original', async () => {
  const c = cenario({ semLixeira: true });
  c.esc('conv/t.jsonl', '{"a":1}\n');
  c.esc('conv/sub/s.jsonl', '{"b":2}\n');
  fs.symlinkSync('t.jsonl', path.join(c.proj, 'conv', 'l'));
  const alvo = path.join(c.proj, 'conv');
  const r = await c.m.prepararApagar({ tipo: 'conversa', alvos: [alvo], raizes: c.raizes });
  const e = await c.m.executarApagar({ comprovante: r.comprovante, alvos: [alvo] });
  assert.equal(e.ok, true, e.motivo);
  assert.ok(!existe(alvo));
  assert.match(path.basename(e.onde), /^conversa-\d{4}-\d\d-\d\dT[\d-]+Z-[0-9a-f]{6}$/);
  assert.equal(path.dirname(e.onde), path.join(c.dir, 'versoes'));
  assert.equal(fs.readFileSync(path.join(e.onde, '1', 'conv', 't.jsonl'), 'utf8'), '{"a":1}\n');
  assert.equal(fs.readFileSync(path.join(e.onde, '1', 'conv', 'sub', 's.jsonl'), 'utf8'), '{"b":2}\n');
  assert.equal(fs.readlinkSync(path.join(e.onde, '1', 'conv', 'l')), 't.jsonl');
  const man = JSON.parse(fs.readFileSync(path.join(e.onde, 'manifesto.json'), 'utf8'));
  assert.deepEqual(man.itens, [{ original: alvo, copia: path.join('1', 'conv'), tipo: 'pasta', arquivos: 2, bytes: 16 }]);
  assert.equal(c.registro()[0].onde, e.onde);
});

// --- corridas -------------------------------------------------------------------------

test('apagar corrida: o alvo ganhou um arquivo entre preparar e executar → recusa e nada some', async () => {
  const c = cenario();
  c.esc('p/a.md', 'a');
  const alvo = path.join(c.proj, 'p');
  const r = await c.m.prepararApagar({ tipo: 'nota', alvos: [alvo], raizes: c.raizes });
  const novo = c.esc('p/novo.md', 'chegou depois');
  const e = await c.m.executarApagar({ comprovante: r.comprovante, alvos: [alvo] });
  assert.equal(e.codigo, 'alvo-mudou');
  assert.ok(existe(novo) && existe(path.join(alvo, 'a.md')));
  assert.equal(c.chamadas.length, 0);
});

test('apagar corrida: o conteúdo mudou (mesmo tamanho) entre preparar e executar → recusa', async () => {
  const c = cenario();
  const a = c.esc('a.md', 'aaaa');
  const r = await c.m.prepararApagar({ tipo: 'nota', alvos: [a], raizes: c.raizes });
  fs.writeFileSync(a, 'bbbb');
  const futuro = new Date(Date.now() + 5000);
  fs.utimesSync(a, futuro, futuro);
  const e = await c.m.executarApagar({ comprovante: r.comprovante, alvos: [a] });
  assert.equal(e.codigo, 'alvo-mudou');
  assert.equal(fs.readFileSync(a, 'utf8'), 'bbbb');
});

test('apagar corrida: o comprovante vale uma vez só', async () => {
  const c = cenario();
  const a = c.esc('a.md', 'a');
  const r = await c.m.prepararApagar({ tipo: 'nota', alvos: [a], raizes: c.raizes });
  const [e1, e2] = await Promise.all([
    c.m.executarApagar({ comprovante: r.comprovante, alvos: [a] }),
    c.m.executarApagar({ comprovante: r.comprovante, alvos: [a] }),
  ]);
  assert.deepEqual([e1.ok, e2.ok], [true, false]);
  assert.equal(e2.codigo, 'comprovante-invalido');
  // E um arquivo novo com o mesmo nome não é apagado pelo comprovante já usado.
  const de2 = c.esc('a.md', 'outro');
  const e3 = await c.m.executarApagar({ comprovante: r.comprovante, alvos: [a] });
  assert.equal(e3.codigo, 'comprovante-invalido');
  assert.ok(existe(de2));
  assert.equal(c.chamadas.length, 1);
});

test('apagar corrida: o comprovante de um alvo não serve para outro', async () => {
  const c = cenario();
  const a = c.esc('a.md', 'a');
  const b = c.esc('b.md', 'b');
  const r = await c.m.prepararApagar({ tipo: 'nota', alvos: [a], raizes: c.raizes });
  for (const alvos of [[b], [a, b], [], undefined]) {
    const r2 = await c.m.prepararApagar({ tipo: 'nota', alvos: [a], raizes: c.raizes });
    const e = await c.m.executarApagar({ comprovante: r2.comprovante, alvos });
    assert.equal(e.codigo, 'comprovante-de-outro-alvo', JSON.stringify(alvos));
  }
  assert.ok(existe(a) && existe(b));
  assert.equal(c.chamadas.length, 0);
  // O primeiro comprovante (não usado) ainda vale só para "a".
  assert.equal((await c.m.executarApagar({ comprovante: r.comprovante, alvos: [a] })).ok, true);
  assert.ok(existe(b));
});

test('apagar corrida: a lixeira falha no meio de um registro lógico → para, diz o que foi e o que ficou', async () => {
  const c = cenario({ falharEm: (abs) => abs.endsWith('2.jsonl') });
  const a1 = c.esc('1.jsonl', 'um');
  const a2 = c.esc('2.jsonl', 'dois');
  const a3 = c.esc('3.jsonl', 'tres');
  const r = await c.m.prepararApagar({ tipo: 'conversa', alvos: [a1, a2, a3], raizes: c.raizes });
  const e = await c.m.executarApagar({ comprovante: r.comprovante, alvos: [a1, a2, a3] });
  assert.equal(e.ok, false);
  assert.equal(e.codigo, 'parcial');
  assert.deepEqual(e.foram, [a1]);
  assert.deepEqual(e.ficaram, [a2, a3]);
  assert.ok(!existe(a1) && existe(a2) && existe(a3), 'depois da falha, nada mais é tocado');
  const l = c.registro();
  assert.equal(l.length, 1);
  assert.deepEqual([l[0].resultado, l[0].alvos, l[0].arquivos, l[0].bytes], ['parcial', [a1], 1, 2]);
});

test('apagar corrida: a lixeira falha no primeiro → nada some e nada vai ao registro', async () => {
  const c = cenario({ falharEm: () => true });
  const a = c.esc('a.md', 'a');
  const r = await c.m.prepararApagar({ tipo: 'nota', alvos: [a], raizes: c.raizes });
  const e = await c.m.executarApagar({ comprovante: r.comprovante, alvos: [a] });
  assert.equal(e.codigo, 'lixeira-falhou');
  assert.ok(existe(a));
  assert.deepEqual(c.registro(), []);
});

test('apagar corrida: a lixeira que diz que foi mas o arquivo continua lá conta como falha', async () => {
  const c = cenario({ criar: { lixeira: async () => {} } });
  const a = c.esc('a.md', 'a');
  const r = await c.m.prepararApagar({ tipo: 'nota', alvos: [a], raizes: c.raizes });
  const e = await c.m.executarApagar({ comprovante: r.comprovante, alvos: [a] });
  assert.equal(e.codigo, 'lixeira-falhou');
  assert.deepEqual(c.registro(), []);
});

test('apagar corrida: o comprovante vence', async () => {
  let relogio = 1000;
  const c = cenario({ criar: { agora: () => relogio } });
  const a = c.esc('a.md', 'a');
  const r = await c.m.prepararApagar({ tipo: 'nota', alvos: [a], raizes: c.raizes });
  relogio += apagar.LIMITES.validadeMs + 1;
  const e = await c.m.executarApagar({ comprovante: r.comprovante, alvos: [a] });
  assert.equal(e.codigo, 'comprovante-vencido');
  assert.ok(existe(a));
});

test('apagar corrida: abriu no app depois do preparar → o executar recusa', async () => {
  const c = cenario();
  const a = c.esc('a.md', 'a');
  const r = await c.m.prepararApagar({ tipo: 'nota', alvos: [a], raizes: c.raizes });
  const e = await c.m.executarApagar({ comprovante: r.comprovante, alvos: [a], emUso: [a] });
  assert.equal(e.codigo, 'em-uso');
  assert.ok(existe(a));
});

test('apagar corrida: mudou durante a cópia para versoes/ → não remove (a cópia fica)', async () => {
  const c = cenario({ semLixeira: true, criar: { depoisDaCopia: async () => { c.esc('d/b.md', 'chegou durante a cópia'); } } });
  const a = c.esc('d/a.md', 'a');
  const alvo = path.join(c.proj, 'd');
  const r = await c.m.prepararApagar({ tipo: 'nota', alvos: [alvo], raizes: c.raizes });
  const e = await c.m.executarApagar({ comprovante: r.comprovante, alvos: [alvo] });
  assert.equal(e.ok, false);
  assert.equal(e.codigo, 'alvo-mudou');
  assert.ok(existe(a) && existe(path.join(alvo, 'b.md')));
  assert.ok(existe(path.join(e.copiaParcial, '1', 'd', 'a.md')), 'a cópia fica (é só uma cópia)');
  assert.deepEqual(c.registro(), []);
});

// --- recusas ---------------------------------------------------------------------------

async function recusa(c, pedido, codigo) {
  const r = await c.m.prepararApagar({ tipo: 'nota', raizes: c.raizes, ...pedido });
  assert.equal(r.ok, false, `devia recusar (${codigo})`);
  assert.equal(r.codigo, codigo, r.motivo);
  assert.equal(r.comprovante, undefined);
  return r;
}

test('apagar recusa: o que está aberto no app (o arquivo, ou a pasta que o contém)', async () => {
  const c = cenario();
  const a = c.esc('p/aberta.md', 'a');
  await recusa(c, { alvos: [a], emUso: [a] }, 'em-uso');
  await recusa(c, { alvos: [path.join(c.proj, 'p')], emUso: [a] }, 'em-uso');
  assert.ok(existe(a));
});

test('apagar recusa: o que é do orquestrador (conversa principal e pasta de notas da orquestração)', async () => {
  const c = cenario();
  const transcript = c.esc('transcripts/orq.jsonl', '{}');
  const notas = path.join(c.proj, 'notas');
  const topicosMd = c.esc('notas/topicos.md', '# t');
  c.esc('notas/diario/2026-11-16.md', 'dia');
  const nota = c.esc('notas/uma-nota.md', 'livre');
  const prot = apagar.protegidosDoApp({ casa, pastaNotas: notas, transcriptsDoOrquestrador: [transcript], projetos: [c.proj] });
  const m = apagar.criar({ lixeira: async () => {}, protegidos: async () => prot, pastaVersoes: path.join(c.dir, 'versoes') });
  const c2 = { ...c, m };
  await recusa(c2, { alvos: [transcript] }, 'do-orquestrador');
  await recusa(c2, { alvos: [topicosMd] }, 'do-orquestrador');
  await recusa(c2, { alvos: [path.join(notas, 'diario')] }, 'do-orquestrador');
  await recusa(c2, { alvos: [notas] }, 'do-orquestrador'); // contém o que é dele
  // A pasta de notas em si é protegida, mas uma nota comum dentro dela não.
  assert.equal((await m.prepararApagar({ tipo: 'nota', alvos: [nota], raizes: c.raizes })).ok, true);
  // A mesma recusa vale pela lista passada no próprio pedido.
  await recusa(c, { alvos: [transcript], doOrquestrador: [transcript] }, 'do-orquestrador');
  // E .orq do projeto (recados, eventos, orq-recado).
  const orq = c.esc('.orq/recados/saida/r.json', '{}');
  await recusa(c2, { alvos: [orq] }, 'do-orquestrador');
});

test('apagar recusa: a lista do orquestrador indisponível = não apaga', async () => {
  const c = cenario();
  const a = c.esc('a.md', 'a');
  const m = apagar.criar({ lixeira: async () => {}, protegidos: async () => { throw new Error('sem config'); } });
  await recusa({ ...c, m }, { alvos: [a] }, 'erro');
});

test('apagar recusa: fora das raízes declaradas, e a própria raiz', async () => {
  const c = cenario();
  const fora = escrever(c.dir, 'fora/x.md', 'x');
  await recusa(c, { alvos: [fora] }, 'fora-das-raizes');
  await recusa(c, { alvos: [c.proj] }, 'e-a-raiz');
  await recusa(c, { alvos: [fora], raizes: [] }, 'raiz-invalida');
  await recusa(c, { alvos: [fora], raizes: ['relativo/x'] }, 'raiz-invalida');
  await recusa(c, { alvos: [fora], raizes: [path.join(c.dir, 'nao-existe')] }, 'raiz-invalida');
  assert.ok(existe(fora));
});

test('apagar recusa: a pasta versoes/ do app (e quem a contém) e o registro', async () => {
  const c = cenario();
  const dados = path.join(casa, '.local', 'share', 'orq-app');
  const v = escrever(casa, '.local/share/orq-app/versoes/notas/1.md', 'versão');
  const reg = escrever(casa, '.local/share/orq-app/registro-apagar.jsonl', '{}\n');
  const m = apagar.criar({ lixeira: async () => {} }); // caminhos padrão, dentro da casa temporária
  const c2 = { ...c, m, raizes: [path.join(casa, '.local')] };
  await recusa(c2, { alvos: [v] }, 'versoes');
  await recusa(c2, { alvos: [path.join(dados, 'versoes')] }, 'versoes');
  await recusa(c2, { alvos: [dados] }, 'versoes');
  await recusa(c2, { alvos: [reg] }, 'versoes');
});

test('apagar recusa: a casa do usuário inteira e raízes do sistema', async () => {
  const c = cenario();
  await recusa({ ...c, raizes: [casa] }, { alvos: [casa] }, 'casa-inteira');
  await recusa({ ...c, raizes: [casa] }, { alvos: ['/etc'] }, 'raiz-do-sistema');
  await recusa({ ...c, raizes: [casa] }, { alvos: ['/usr'] }, 'raiz-do-sistema');
  await recusa(c, { alvos: [c.proj], raizes: ['/'] }, 'raiz-invalida');
  await recusa(c, { alvos: [c.proj], raizes: ['/usr'] }, 'raiz-invalida');
  await recusa(c, { alvos: [c.proj], raizes: [path.dirname(casa)] }, 'raiz-invalida'); // acima da casa
});

test('apagar recusa: caminho que escapa por link simbólico (conferido pelo caminho real)', async () => {
  const c = cenario();
  const segredo = escrever(c.dir, 'fora/segredo.txt', 'não é do projeto');
  fs.symlinkSync(path.join(c.dir, 'fora'), path.join(c.proj, 'atalho'));
  const r = await recusa(c, { alvos: [path.join(c.proj, 'atalho', 'segredo.txt')] }, 'fora-das-raizes');
  assert.match(r.motivo, /caminho real/);
  await recusa(c, { alvos: [path.join(c.proj, 'atalho')] }, 'alvo-e-link');
  assert.ok(existe(segredo));
});

test('apagar recusa: pasta com link para fora não dá para contar', async () => {
  const c = cenario();
  escrever(c.dir, 'fora/y.txt', 'y');
  c.esc('p/a.md', 'a');
  fs.symlinkSync(path.join(c.dir, 'fora'), path.join(c.proj, 'p', 'saida'));
  await recusa(c, { alvos: [path.join(c.proj, 'p')] }, 'link-para-fora');
});

test('apagar recusa: pasta ilegível, grande demais ou que demora para medir', { skip: process.getuid && process.getuid() === 0 ? 'root lê tudo' : false }, async () => {
  const c = cenario();
  c.esc('p/fechada/a.md', 'a');
  fs.chmodSync(path.join(c.proj, 'p', 'fechada'), 0o000);
  try { await recusa(c, { alvos: [path.join(c.proj, 'p')] }, 'ilegivel'); } finally { fs.chmodSync(path.join(c.proj, 'p', 'fechada'), 0o755); }
  for (let i = 0; i < 8; i++) c.esc(`g/${i}.md`, 'x');
  const pequeno = { ...c, m: apagar.criar({ lixeira: async () => {}, limites: { entradas: 5 } }) };
  await recusa(pequeno, { alvos: [path.join(c.proj, 'g')] }, 'grande-demais');
  const lento = { ...c, m: apagar.criar({ lixeira: async () => {}, limites: { tempoMedirMs: -1 } }) };
  await recusa(lento, { alvos: [path.join(c.proj, 'g')] }, 'demorou');
  const semEspaco = { ...c, m: apagar.criar({ limites: { bytesCopia: 3 } }) };
  const r = await recusa(semEspaco, { alvos: [path.join(c.proj, 'g')], destino: 'versoes' }, 'grande-demais-para-copiar');
  assert.equal(r.alternativa, null);
});

test('apagar recusa: alvo que não existe, alvos sobrepostos, tipo inválido, soquete/fila', async () => {
  const c = cenario();
  c.esc('p/a.md', 'a');
  await recusa(c, { alvos: [path.join(c.proj, 'nada.md')] }, 'nao-existe');
  await recusa(c, { alvos: [path.join(c.proj, 'p'), path.join(c.proj, 'p', 'a.md')] }, 'alvos-sobrepostos');
  await recusa(c, { alvos: [path.join(c.proj, 'p')], tipo: '../fuga' }, 'pedido-invalido');
  await recusa(c, { alvos: ['relativo.md'] }, 'pedido-invalido');
  let fila = null;
  try { execFileSync('mkfifo', [path.join(c.proj, 'f', 'fila')].map((p) => { fs.mkdirSync(path.dirname(p), { recursive: true }); return p; })); fila = true; } catch { /* sem mkfifo */ }
  if (fila) await recusa(c, { alvos: [path.join(c.proj, 'f')] }, 'tipo-especial');
});

test('apagar: os caminhos padrão ficam dentro da casa (temporária no teste)', () => {
  const m = apagar.criar({});
  assert.ok(m.pastaVersoes().startsWith(casa + path.sep));
  assert.ok(m.arquivoRegistro().startsWith(casa + path.sep));
  assert.equal(m.pastaVersoes(), path.join(casa, '.local', 'share', 'orq-app', 'versoes'));
});

test('apagar: cancelar descarta o comprovante', async () => {
  const c = cenario();
  const a = c.esc('a.md', 'a');
  const r = await c.m.prepararApagar({ tipo: 'nota', alvos: [a], raizes: c.raizes });
  assert.equal(c.m._emAberto(), 1);
  c.m.cancelar(r.comprovante);
  assert.equal((await c.m.executarApagar({ comprovante: r.comprovante, alvos: [a] })).codigo, 'comprovante-invalido');
  assert.ok(existe(a));
});

// --- gravar por cima ----------------------------------------------------------------------

test('sobrescrever: o custo diz quantos bytes a versão de agora tem; executar guarda ela antes de gravar', async () => {
  const c = cenario();
  const a = c.esc('config.json', '{"velho":true}\n');
  const r = await c.m.prepararSobrescrita({ tipo: 'config', caminho: a, raizes: c.raizes });
  assert.equal(r.ok, true, r.motivo);
  assert.deepEqual([r.custo.existe, r.custo.arquivos, r.custo.bytes, r.custo.destino], [true, 1, 15, 'versoes']);
  assert.equal(fs.readFileSync(a, 'utf8'), '{"velho":true}\n', 'preparar não grava');
  const e = await c.m.executarSobrescrita({ comprovante: r.comprovante, caminho: a, conteudo: '{"novo":true}\n' });
  assert.equal(e.ok, true, e.motivo);
  assert.equal(fs.readFileSync(a, 'utf8'), '{"novo":true}\n');
  assert.equal(fs.readFileSync(path.join(e.onde, '1', 'config.json'), 'utf8'), '{"velho":true}\n');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(e.onde, 'manifesto.json'), 'utf8')).itens[0].original, a);
  assert.deepEqual(c.registro().map((l) => [l.operacao, l.alvos[0], l.bytes]), [['sobrescrever', a, 15]]);
  assert.deepEqual(fs.readdirSync(c.proj).filter((f) => f.includes('orq-tmp')), [], 'sem temporário sobrando');
});

test('sobrescrever corrida: mudou entre preparar e executar → recusa e o arquivo fica como estava', async () => {
  const c = cenario();
  const a = c.esc('n.md', 'um');
  const r = await c.m.prepararSobrescrita({ tipo: 'nota', caminho: a, raizes: c.raizes });
  fs.writeFileSync(a, 'de fora');
  const e = await c.m.executarSobrescrita({ comprovante: r.comprovante, caminho: a, conteudo: 'meu' });
  assert.equal(e.codigo, 'alvo-mudou');
  assert.equal(fs.readFileSync(a, 'utf8'), 'de fora');
});

test('sobrescrever: comprovante de outro arquivo, de apagar, ou usado duas vezes não grava', async () => {
  const c = cenario();
  const a = c.esc('a.md', 'a');
  const b = c.esc('b.md', 'b');
  const r = await c.m.prepararSobrescrita({ tipo: 'nota', caminho: a, raizes: c.raizes });
  assert.equal((await c.m.executarSobrescrita({ comprovante: r.comprovante, caminho: b, conteudo: 'x' })).codigo, 'comprovante-de-outro-alvo');
  const ap = await c.m.prepararApagar({ tipo: 'nota', alvos: [a], raizes: c.raizes });
  assert.equal((await c.m.executarSobrescrita({ comprovante: ap.comprovante, caminho: a, conteudo: 'x' })).codigo, 'comprovante-invalido');
  const sob = await c.m.prepararSobrescrita({ tipo: 'nota', caminho: a, raizes: c.raizes });
  assert.equal((await c.m.executarApagar({ comprovante: sob.comprovante, alvos: [a] })).codigo, 'comprovante-invalido');
  assert.deepEqual([fs.readFileSync(a, 'utf8'), fs.readFileSync(b, 'utf8')], ['a', 'b']);
  const r2 = await c.m.prepararSobrescrita({ tipo: 'nota', caminho: a, raizes: c.raizes });
  assert.equal((await c.m.executarSobrescrita({ comprovante: r2.comprovante, caminho: a, conteudo: 'um' })).ok, true);
  assert.equal((await c.m.executarSobrescrita({ comprovante: r2.comprovante, caminho: a, conteudo: 'dois' })).codigo, 'comprovante-invalido');
  assert.equal(fs.readFileSync(a, 'utf8'), 'um');
});

test('sobrescrever recusa: link, pasta, fora das raízes, aberto no app, do orquestrador', async () => {
  const c = cenario();
  const a = c.esc('a.md', 'a');
  const fora = escrever(c.dir, 'fora/x.md', 'x');
  fs.symlinkSync(a, path.join(c.proj, 'l.md'));
  fs.symlinkSync(path.join(c.dir, 'fora'), path.join(c.proj, 'atalho'));
  const casos = [
    [{ caminho: path.join(c.proj, 'l.md') }, 'alvo-e-link'],
    [{ caminho: c.proj, raizes: [c.dir] }, 'nao-e-arquivo'],
    [{ caminho: fora }, 'fora-das-raizes'],
    [{ caminho: path.join(c.proj, 'atalho', 'x.md') }, 'fora-das-raizes'],
    [{ caminho: a, emUso: [a] }, 'em-uso'],
    [{ caminho: a, doOrquestrador: [a] }, 'do-orquestrador'],
  ];
  for (const [p, codigo] of casos) {
    const r = await c.m.prepararSobrescrita({ tipo: 'nota', raizes: c.raizes, ...p });
    assert.equal(r.codigo, codigo, `${JSON.stringify(p)}: ${r.motivo}`);
  }
  assert.deepEqual([fs.readFileSync(a, 'utf8'), fs.readFileSync(fora, 'utf8')], ['a', 'x']);
});

test('sobrescrever: a lista do orquestrador de criar() vale para apagar, não para a gravação com cópia do próprio app', async () => {
  const c = cenario();
  const cfg = c.esc('orq-app/config.json', '{"a":1}');
  const m = apagar.criar({ lixeira: async () => {}, protegidos: async () => [path.join(c.proj, 'orq-app')], pastaVersoes: path.join(c.dir, 'versoes') });
  assert.equal((await m.prepararApagar({ tipo: 'config', alvos: [cfg], raizes: c.raizes })).codigo, 'do-orquestrador');
  const e = await m.gravarComVersao({ tipo: 'config', caminho: cfg, raizes: [path.join(c.proj, 'orq-app')] }, '{"a":2}');
  assert.equal(e.ok, true, e.motivo);
  assert.equal(fs.readFileSync(path.join(e.onde, '1', 'config.json'), 'utf8'), '{"a":1}');
});

test('gravarComVersao: guarda a anterior e grava num passo; arquivo novo não custa cópia nem pisa em outro', async () => {
  const c = cenario();
  const a = c.esc('w.json', 'v1');
  const e = await c.m.gravarComVersao({ tipo: 'workflows', caminho: a, raizes: c.raizes }, 'v2');
  assert.equal(e.ok, true, e.motivo);
  assert.equal(fs.readFileSync(a, 'utf8'), 'v2');
  assert.equal(fs.readFileSync(path.join(e.onde, '1', 'w.json'), 'utf8'), 'v1');
  const novo = path.join(c.proj, 'novo.json');
  const e2 = await c.m.gravarComVersao({ tipo: 'workflows', caminho: novo, raizes: c.raizes }, 'n1');
  assert.deepEqual([e2.ok, e2.destino, e2.onde, e2.bytesAnteriores], [true, null, null, 0]);
  assert.equal(fs.readFileSync(novo, 'utf8'), 'n1');
  assert.equal(c.registro().length, 1, 'arquivo novo não é deleção: não vai ao registro');
  const grande = { ...c, m: apagar.criar({ limites: { conteudo: 4 } }) };
  const e3 = await grande.m.gravarComVersao({ tipo: 'workflows', caminho: a, raizes: c.raizes }, 'grande demais');
  assert.equal(e3.codigo, 'grande-demais');
  assert.equal(fs.readFileSync(a, 'utf8'), 'v2');
});

test('apagar: protegidosDoApp lista o que o app trata como dele', () => {
  const l = apagar.protegidosDoApp({ casa: '/c', pastaNotas: '/c/n', pastaDemandas: '/c/n/Demandas', transcriptsDoOrquestrador: ['/c/.claude/projects/x/s.jsonl'], projetos: ['/p'] });
  const txt = JSON.stringify(l);
  for (const p of ['/c/.config/orq-app', '/c/.cache/orq-app/conversas.json', '/c/n/topicos.md', '/c/n/diario', '/c/.claude/projects/x/s.jsonl', '/c/.claude/projects/x/s', '/p/.orq']) assert.ok(txt.includes(`"${p}"`), p);
  assert.ok(l.some((x) => x.caminho === '/c/n' && x.dentroLivre === true));
  assert.ok(l.some((x) => x.caminho === '/c/n/Demandas' && x.dentroLivre === true));
});
