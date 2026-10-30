// Área: pet
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { casaTemporaria } = require('../ajuda');

process.env.ORQ_APP_TESTE = '1';
const casa = casaTemporaria({});
const ajudante = require('../../ajudante');

// O catálogo é código de tela (window.petVisual): roda num contexto à parte.
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../renderer/pet-visual.js'), 'utf8'), ctx);
const V = ctx.window.petVisual;

test('pet: guarda-roupa tem 30 itens nas 6 partes do corpo', () => {
  assert.strictEqual(Object.keys(V.ITENS).length, 30);
  const partes = new Set(V.PARTES.map((p) => p[0]));
  for (const [id, i] of Object.entries(V.ITENS)) assert.ok(partes.has(i.parte), id);
  for (const p of partes) assert.ok(Object.values(V.ITENS).some((i) => i.parte === p), p);
});

test('pet: desenho veste o que foi escolhido; item na parte errada é ignorado', () => {
  const s = V.svg({ cor: 'roxo', itens: { cabeca: 'cartola', mao: 'caneca', olhos: 'bigode' } });
  assert.match(s, /item-cartola/);
  assert.match(s, /item-caneca/);
  assert.doesNotMatch(s, /item-bigode/, 'bigode não é de olhos');
  assert.match(s, /--pet-cor:#8b5cf6/);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(V.limpar({ cor: 'xyz', itens: { cabeca: 'nada' } }))), { especie: 'bicho', cor: 'padrao', itens: {} });
  assert.ok(s.indexOf('item-capa') < 0);
  const capa = V.svg({ itens: { corpo: 'capa' } });
  assert.ok(capa.indexOf('item-capa') < capa.indexOf('class="perna p1"'), 'a capa fica atrás do corpo');
});

// Pedido de 2026-10-30: outros bichinhos, compatíveis com o guarda-roupa.
test('pet: 4 espécies, todas vestem os 30 itens e as cores', () => {
  assert.deepStrictEqual(Object.keys(V.ESPECIES), ['bicho', 'fantasma', 'nuvem', 'gosma']);
  for (const especie of Object.keys(V.ESPECIES)) {
    for (const [id, i] of Object.entries(V.ITENS)) assert.match(V.svg({ especie, cor: 'branco', itens: { [i.parte]: id } }), new RegExp(`item-${id}`), `${especie} + ${id}`);
    const s = V.svg({ especie });
    assert.match(s, new RegExp(`especie-${especie}`));
    assert.strictEqual((s.match(/class="perna p\d"/g) || []).length, 4, `${especie}: 4 pernas para a animação de andar`);
    assert.match(s, /class="braco braco-d"/, `${especie}: mão direita para os itens`);
  }
  assert.strictEqual(V.limpar({ especie: 'dragao' }).especie, 'bicho');
});

test('pet: preferências guardam a roupa e o aviso fora do app', () => {
  assert.strictEqual(ajudante.ler().avisarFora, true, 'por padrão ele avisa fora do app');
  ajudante.gravar({ visual: { cor: 'verde', itens: { cabeca: 'coroa' } }, avisarFora: false });
  const p = JSON.parse(fs.readFileSync(path.join(casa, '.config/orq-app/pet.json'), 'utf8'));
  assert.deepStrictEqual(p.visual.itens, { cabeca: 'coroa' });
  assert.strictEqual(ajudante.ler().avisarFora, false);
  ajudante.gravar({ avisarFora: true });
});

test('pet: pendência nova é avisada uma vez; a que some e volta é avisada de novo', () => {
  ajudante.ligar({ janela: () => ({ isFocused: () => false, isMinimized: () => false }), conversa: null, enviarTela: () => {} });
  assert.deepStrictEqual(ajudante.pendencias([{ id: 'a', texto: 'A' }]).map((p) => p.id), ['a']);
  assert.deepStrictEqual(ajudante.pendencias([{ id: 'a', texto: 'A' }]).map((p) => p.id), [], 'a mesma não avisa de novo');
  assert.deepStrictEqual(ajudante.pendencias([{ id: 'a', texto: 'A' }, { id: 'b', texto: 'B' }]).map((p) => p.id), ['b']);
  ajudante.pendencias([{ id: 'b', texto: 'B' }]);
  assert.deepStrictEqual(ajudante.pendencias([{ id: 'a', texto: 'A' }, { id: 'b', texto: 'B' }]).map((p) => p.id), ['a'], 'a voltou');
});

test('pet: resposta da conversa do ajudante vai para o bichinho, não vira notificação', () => {
  assert.strictEqual(ajudante.aviso({ id: 'ajudante', tipo: 'resposta', texto: 'oi' }), true);
  assert.strictEqual(ajudante.aviso({ id: 'orquestrador', tipo: 'resposta', texto: 'oi' }), false);
});

test('pet: só vai avisar se a pendência ainda existe e o app está fora de foco', () => {
  let foco = false;
  ajudante.ligar({ janela: () => ({ isFocused: () => foco, isMinimized: () => false }), conversa: null, enviarTela: () => {} });
  ajudante.pendencias([{ id: 'p1', texto: 'Pergunta', conversa: 'orquestrador' }]);
  ajudante.pendencias([]); // respondida antes da hora de avisar
  assert.strictEqual(ajudante.confirmarAviso(['p1']), null, 'já respondida: não vai');
  ajudante.pendencias([{ id: 'p2', texto: 'Outra', conversa: 'orquestrador' }]);
  foco = true;
  assert.strictEqual(ajudante.confirmarAviso(['p2']), null, 'usuário no app: não vai');
  foco = false;
  assert.deepStrictEqual(ajudante.confirmarAviso(['p2']), { t: 'pendencia', texto: 'Outra', total: 1, conversa: 'orquestrador', id: 'p2', item: null }, 'vai, e sabe qual conversa abrir');
});

test('pet: resposta dada no ajudante vai para a conversa ou para o agente certo', () => {
  const chamadas = [];
  ajudante.ligar({
    janela: () => ({ isFocused: () => false, isMinimized: () => false }),
    conversa: { responder: (...a) => { chamadas.push(['conversa', ...a]); return true; } },
    responderAgente: (...a) => { chamadas.push(['agente', ...a]); return true; },
    enviarTela: () => {},
  });
  const perguntas = [{ question: 'Qual ordem vale?', options: [{ label: 'A' }, { label: 'B' }] }];
  ajudante.pendencias([
    { id: 'conversa:orquestrador:r1', conversa: 'orquestrador', texto: 'x', item: { tipo: 'pergunta', reqId: 'r1', perguntas } },
    { id: 'conversa:orquestrador:r2', conversa: 'orquestrador', texto: 'y', item: { tipo: 'permissao', reqId: 'r2', ferramenta: 'Bash', comando: 'ls' } },
    { id: 'fila:g:proj:p9', texto: 'z', item: { tipo: 'agente', emp: 'g', proj: 'proj', id: 'p9', ferramenta: 'Bash' } },
  ]);
  assert.ok(ajudante.responder({ id: 'conversa:orquestrador:r1', respostas: { 'Qual ordem vale?': 'B' } }));
  assert.ok(ajudante.responder({ id: 'conversa:orquestrador:r2', permitir: false }));
  assert.ok(ajudante.responder({ id: 'fila:g:proj:p9', permitir: true }));
  assert.deepStrictEqual(chamadas, [
    ['conversa', 'orquestrador', 'r1', { permitir: true, respostas: { 'Qual ordem vale?': 'B' } }],
    ['conversa', 'orquestrador', 'r2', { permitir: false }],
    ['agente', 'g', 'proj', 'p9', 'permitir'],
  ]);
  assert.strictEqual(ajudante.responder({ id: 'conversa:orquestrador:r1', respostas: {} }), false, 'a mesma não responde duas vezes');
});

// Pedido de 2026-10-30: o orquestrador pediu para rodar um comando e nada avisou.
test('pet: resposta que pede para rodar um comando vira pendência "acao" até o Feito', () => {
  assert.ok(ajudante.pedeAcao('Rode de novo no seu computador:\n\n```\n./instalar.sh --aplicar\n```'));
  assert.strictEqual(ajudante.pedeAcao('Rodou tudo certo:\n```\nok\n```'), null, 'relato, não pedido');
  assert.strictEqual(ajudante.pedeAcao('Rode os testes depois.'), null, 'sem comando para rodar');
  ajudante.ligar({ janela: () => ({ isFocused: () => false, isMinimized: () => false }), conversa: { responder: () => true }, enviarTela: () => {} });
  ajudante.pendencias([]);
  ajudante.aviso({ tipo: 'resposta', id: 'orquestrador', orquestrador: true, texto: 'Execute no seu terminal:\n```\nls -la\n```' });
  const [id] = ajudante.acoesAbertas();
  assert.ok(id, 'virou pendência');
  ajudante.pendencias([]); // a próxima leitura do estado não a apaga
  const msg = ajudante.confirmarAviso([id]);
  assert.strictEqual(msg.item.tipo, 'acao');
  assert.deepStrictEqual(msg.item.comandos, ['ls -la']);
  assert.ok(ajudante.responder({ id, feito: true }), 'Feito');
  assert.deepStrictEqual(ajudante.acoesAbertas(), []);
  ajudante.aviso({ tipo: 'resposta', id: 'orquestrador', orquestrador: true, texto: 'Rode:\n```\necho oi\n```' });
  assert.strictEqual(ajudante.acoesAbertas().length, 1);
  ajudante.limparAcoes('orquestrador'); // o usuário escreveu ao orquestrador
  assert.deepStrictEqual(ajudante.acoesAbertas(), []);
});
