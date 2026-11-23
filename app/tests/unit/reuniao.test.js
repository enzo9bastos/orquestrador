// Área: voz (modo reunião: gravar, prints, marcas, transcrição, resumo e a nota)
// Pedido de 23/11: o modo reunião do plano de voz (V3). Aqui o motor (reuniao.js) com peças falsas:
// gravador, captura, transcrição e resumo. As peças de verdade estão em reuniao-pecas.test.js.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pastaTemporaria } = require('../temporarias');
const reuniao = require('../../reuniao');

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
function montar(extra = {}) {
  const base = path.join(pastaTemporaria('orq-reuniao-'), 'Reuniões');
  let t = new Date(2026, 10, 23, 9, 30, 0).getTime();
  const relogio = { agora: () => t, andar: (s) => { t += s * 1000; } };
  const gravados = [], parados = [], eventos = [], resumos = [];
  const o = {
    base,
    agora: relogio.agora,
    gravar: async (trilha, arquivo) => { gravados.push(trilha); fs.writeFileSync(arquivo, `audio ${trilha}`); return { dispositivo: trilha === 'voce' ? 'Microfone de teste' : 'Fone de teste', parar: async () => { parados.push(trilha); } }; },
    capturar: async (arquivo) => { fs.writeFileSync(arquivo, PNG, { flag: 'wx' }); },
    transcrever: async (arquivo, { aoProgresso }) => {
      aoProgresso(50); aoProgresso(100);
      return path.basename(arquivo).startsWith('voce')
        ? { trechos: [{ ini: 1, fim: 3, texto: 'Bom dia.' }, { ini: 3.5, fim: 5, texto: 'Vamos começar.' }, { ini: 40, fim: 44, texto: 'Fica decidido.' }] }
        : { trechos: [{ ini: 10, fim: 14, texto: 'Eu levanto os casos.' }] };
    },
    resumir: async (texto, op) => { resumos.push({ texto, op }); return { assunto: 'NF obrigatória no cartão', resumo: 'Discutimos a NF.', decisoes: ['Manter a NF'], pendencias: ['Levantar os casos (Outros)'] }; },
    aoMudar: (e) => eventos.push(e),
    ...extra,
  };
  return { r: reuniao.criar(o), base, relogio, gravados, parados, eventos, resumos };
}
const meta = (pasta) => JSON.parse(fs.readFileSync(path.join(pasta, 'reuniao.json'), 'utf8'));

test('reunião: começar cria a pasta com data e hora, grava as duas trilhas e fica à vista no estado; não começa duas vezes', async () => {
  const { r, base, gravados } = montar();
  const e = await r.comecar({ titulo: 'Alinhamento' });
  assert.strictEqual(e.gravando, true);
  assert.strictEqual(path.basename(e.pasta), '2026-11-23-09h30-reuniao');
  assert.strictEqual(path.dirname(e.pasta), base);
  assert.deepStrictEqual(gravados, ['voce', 'outros']);
  assert.deepStrictEqual(e.dispositivos, { voce: 'Microfone de teste', outros: 'Fone de teste' });
  const m = meta(e.pasta);
  assert.deepStrictEqual([m.estado, m.titulo, m.trilhas], ['gravando', 'Alinhamento', { voce: 'audio/voce.opus', outros: 'audio/outros.opus' }]);
  // Só o próprio usuário lê a reunião (pasta 700).
  for (const p of [e.pasta, path.join(e.pasta, 'audio'), path.join(e.pasta, 'prints')]) assert.strictEqual(fs.statSync(p).mode & 0o777, 0o700, p);
  await assert.rejects(r.comecar({}), /já há uma reunião/);
});

test('reunião: print e marca guardam o minuto; o nome do print nunca passa por cima de outro', async () => {
  const { r, relogio } = montar();
  const { pasta } = await r.comecar({});
  relogio.andar(125);
  const p1 = await r.print();
  const p2 = await r.print();
  relogio.andar(10);
  r.marcar('combinado o prazo');
  assert.strictEqual(path.basename(p1.arquivo), '02-05.png');
  assert.strictEqual(path.basename(p2.arquivo), '02-05-2.png');
  const m = meta(pasta);
  assert.deepStrictEqual(m.prints.map((x) => [x.seg, x.arquivo]), [[125, 'prints/02-05.png'], [125, 'prints/02-05-2.png']]);
  assert.deepStrictEqual(m.marcas, [{ seg: 135, texto: 'combinado o prazo' }]);
  assert.strictEqual(r.estado().prints, 2);
});

test('reunião: terminar para as trilhas e monta a nota: quem falou, prints e marcas no minuto, resumo; a pasta ganha o assunto', async () => {
  const { r, relogio, parados, eventos, resumos } = montar();
  const { pasta } = await r.comecar({ titulo: 'Alinhamento' });
  relogio.andar(12);
  await r.print();
  relogio.andar(30);
  r.marcar('decisão');
  relogio.andar(60);
  const t = await r.terminar();
  assert.deepStrictEqual(parados, ['voce', 'outros']);
  assert.strictEqual(r.estado().gravando, false);
  await t.fim;
  const pronta = eventos.find((e) => e.evento === 'pronta');
  assert.ok(pronta, JSON.stringify(eventos.map((e) => e.evento)));
  assert.strictEqual(path.basename(pronta.pasta), '2026-11-23-09h30-nf-obrigatoria-no-cartao');
  assert.ok(!fs.existsSync(pasta), 'a pasta foi renomeada');
  const nota = fs.readFileSync(pronta.nota, 'utf8');
  assert.match(nota, /^# NF obrigatória no cartão\n/);
  assert.match(nota, /título dado: Alinhamento/);
  assert.match(nota, /## Resumo\n\nDiscutimos a NF\./);
  assert.match(nota, /## Decisões\n\n- Manter a NF/);
  assert.match(nota, /## Pendências\n\n- \[ \] Levantar os casos \(Outros\)/);
  assert.match(nota, /## Momentos marcados\n\n- \[00:42\] ★ decisão/);
  // Falas seguidas da mesma pessoa viram um parágrafo; o print e a marca entram no minuto deles.
  const trans = nota.slice(nota.indexOf('## Transcrição'));
  assert.deepStrictEqual(trans.split('\n').filter(Boolean).slice(1), [
    '[00:01] **Você:** Bom dia. Vamos começar.',
    '[00:10] **Outros:** Eu levanto os casos.',
    '![Print em 00:12](prints/00-12.png)',
    '[00:40] **Você:** Fica decidido.',
    '[00:42] ★ **Momento marcado**: decisão',
  ]);
  // O resumo recebe só o texto falado e as marcas, nunca o caminho do print.
  assert.strictEqual(resumos.length, 1);
  assert.doesNotMatch(resumos[0].texto, /prints\//);
  assert.match(resumos[0].texto, /\[00:10\] Outros: Eu levanto os casos\./);
  assert.strictEqual(resumos[0].op.titulo, 'Alinhamento');
  const m = meta(pronta.pasta);
  assert.deepStrictEqual([m.estado, m.nota, m.assunto], ['pronta', 'reuniao.md', 'NF obrigatória no cartão']);
  // Andamento: transcrevendo (com %) e depois resumindo.
  const fases = eventos.flatMap((e) => (e.processando || []).map((p) => p.fase));
  assert.ok(fases.includes('transcrevendo') && fases.includes('resumindo'));
});

test('reunião: renomear nunca passa por cima de pasta que já existe; nota nunca passa por cima de nota', async () => {
  const { r, base, eventos } = montar();
  fs.mkdirSync(path.join(base, '2026-11-23-09h30-nf-obrigatoria-no-cartao'), { recursive: true });
  const { pasta } = await r.comecar({});
  fs.writeFileSync(path.join(pasta, 'reuniao.md'), 'nota escrita à mão');
  await (await r.terminar()).fim;
  const pronta = eventos.find((e) => e.evento === 'pronta');
  assert.strictEqual(path.basename(pronta.pasta), '2026-11-23-09h30-nf-obrigatoria-no-cartao-2');
  assert.strictEqual(fs.readFileSync(path.join(pronta.pasta, 'reuniao.md'), 'utf8'), 'nota escrita à mão');
  assert.strictEqual(path.basename(pronta.nota), 'reuniao-2.md');
});

test('reunião: resumo que falha não impede a nota (a transcrição sai, com o motivo); sem fala, não pede resumo', async () => {
  const a = montar({ resumir: async () => { throw new Error('sem internet'); } });
  await a.r.comecar({ titulo: 'Sem rede' });
  await (await a.r.terminar()).fim;
  const p = a.eventos.find((e) => e.evento === 'pronta');
  const nota = fs.readFileSync(p.nota, 'utf8');
  assert.match(nota, /^# Sem rede/);
  assert.match(nota, /O resumo não foi feito: sem internet/);
  assert.match(nota, /\*\*Você:\*\* Bom dia\./);
  assert.strictEqual(path.basename(p.pasta), '2026-11-23-09h30-sem-rede');
  const b = montar({ transcrever: async () => ({ trechos: [] }) });
  await b.r.comecar({});
  await (await b.r.terminar()).fim;
  assert.strictEqual(b.resumos.length, 0);
  const p2 = b.eventos.find((e) => e.evento === 'pronta');
  assert.match(fs.readFileSync(p2.nota, 'utf8'), /nenhuma fala reconhecida/);
  assert.strictEqual(path.basename(p2.pasta), '2026-11-23-09h30-reuniao', 'sem assunto, o nome fica');
});

test('reunião: se a 2ª trilha não começa, a 1ª para e nada fica gravando', async () => {
  const parados = [];
  const { r } = montar({ gravar: async (trilha) => { if (trilha === 'outros') throw new Error('sem som do computador'); return { parar: async () => parados.push(trilha) }; } });
  await assert.rejects(r.comecar({}), /não consegui começar a gravar: sem som do computador/);
  assert.deepStrictEqual(parados, ['voce']);
  assert.strictEqual(r.estado().gravando, false);
});

test('reunião: o app fechou gravando ou no meio da nota: as pendentes aparecem e a nota sai sem transcrever de novo o que já foi', async () => {
  const transcritos = [];
  const a = montar({ transcrever: async (arquivo) => { transcritos.push(path.basename(arquivo)); return { trechos: [{ ini: 0, fim: 1, texto: `fala de ${path.basename(arquivo)}` }] }; } });
  const { pasta } = await a.r.comecar({});
  await a.r.encerrar();
  assert.strictEqual(meta(pasta).estado, 'gravada');
  // Metade feita: a trilha "voce" já tinha sido transcrita antes da queda.
  const m = meta(pasta);
  m.estado = 'transcrevendo'; m.transcricao = { voce: [{ ini: 0, fim: 1, texto: 'já transcrito antes' }] };
  fs.writeFileSync(path.join(pasta, 'reuniao.json'), JSON.stringify(m));
  const b = montar({ base: a.base, transcrever: async (arquivo) => { transcritos.push(path.basename(arquivo)); return { trechos: [{ ini: 2, fim: 3, texto: 'fala dos outros' }] }; } });
  assert.deepStrictEqual(b.r.pendentes().map((x) => x.pasta), [pasta]);
  const fim = await b.r.processar(pasta);
  assert.deepStrictEqual(transcritos, ['outros.opus']);
  const nota = fs.readFileSync(fim.nota, 'utf8');
  assert.match(nota, /já transcrito antes/);
  assert.match(nota, /fala dos outros/);
  assert.deepStrictEqual(b.r.pendentes(), []);
});

test('reunião: sem pasta escolhida não começa; título e marca são limpos de caracteres de controle', async () => {
  const { r } = montar({ base: '' });
  await assert.rejects(r.comecar({}), /escolha a pasta das reuniões/);
  const b = montar();
  const { pasta } = await b.r.comecar({ titulo: 'a\u0007b'.padEnd(500, 'x') });
  b.r.marcar('x\u0000y');
  const m = meta(pasta);
  assert.strictEqual(m.titulo.length, 120);
  assert.ok(!/[\u0000-\u0008]/.test(m.titulo + m.marcas[0].texto));
});

test('reunião: o nome da pasta vem do assunto sem acento nem símbolo', () => {
  assert.strictEqual(reuniao.slug('Ação: NF / cartão corporativo — 2ª fase!'), 'acao-nf-cartao-corporativo-2a-fase');
  assert.strictEqual(reuniao.slug('../../etc'), 'etc');
  assert.strictEqual(reuniao.slug(''), '');
  assert.strictEqual(reuniao.minSeg(3725), '1:02:05');
});

// 23/11: botão flutuante de print — cliques seguidos no mesmo segundo não disputam o nome do arquivo.
test('reunião: prints seguidos no mesmo segundo ganham nomes diferentes, todos guardados', async () => {
  const lentos = [];
  const { r } = montar({ capturar: (arquivo) => new Promise((ok) => { lentos.push(() => { fs.writeFileSync(arquivo, PNG, { flag: 'wx' }); ok(); }); }) });
  const { pasta } = await r.comecar({});
  const ps = [r.print(), r.print(), r.print()];
  await new Promise((x) => setTimeout(x, 10));
  for (const f of lentos) f();
  const res = await Promise.all(ps);
  assert.deepStrictEqual(res.map((x) => path.basename(x.arquivo)).sort(), ['00-00-2.png', '00-00-3.png', '00-00.png']);
  assert.strictEqual(meta(pasta).prints.length, 3);
});
