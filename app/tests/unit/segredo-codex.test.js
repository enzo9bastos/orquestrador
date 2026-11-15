// Área: conversa (resposta secreta do Codex: isSecret)
// 0.A3 da Etapa 0. O Codex pode pedir uma resposta secreta (isSecret). O app
// descartava a marca: a resposta aparecia em claro na tela, no cartão
// respondido e no bichinho. E as respostas eram casadas pelo texto da pergunta:
// duas perguntas iguais colidiam. Agora isSecret/isOther/id chegam à tela, a
// resposta casa pelo id, e a secreta não passa por registrar, aviso nem bichinho.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { casaTemporaria } = require('../ajuda');

const FALSO = path.join(__dirname, 'codex-falso.js');
const casa = casaTemporaria({ iasCaminhos: { codex: FALSO }, iaOrquestrador: 'codex' });
const LOG = path.join(casa, 'codex-falso.log');
process.env.CODEX_FALSO_LOG = LOG;
const SEGREDO = 'S3nh4-do-teste-9431';
process.env.CODEX_FALSO_PERGUNTAS = JSON.stringify([
  { id: 'qa', header: 'Acesso', question: 'Qual a senha?', isSecret: true, isOther: true, options: null },
  { id: 'qb', header: 'Outra', question: 'Qual a senha?', isSecret: false, isOther: true, options: null },
]);
const conversa = require('../../conversa');
const codex = require('../../conversa-codex');
const ajudante = require('../../ajudante');
const t = codex._t;

const recebidos = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
const telas = [];
conversa.ligar((canal, dado) => telas.push({ canal, ...dado }));
const avisos = [];
conversa.ligarAvisos((a) => avisos.push(a));
async function ate(cond, ms = 8000) {
  for (let i = 0; i < ms / 20; i++) { if (cond()) return; await new Promise((r) => setTimeout(r, 20)); }
  throw new Error('não aconteceu a tempo');
}

test('A3: o cartão leva id, isSecret e isOther de cada pergunta (opções nulas viram lista vazia)', () => {
  const p = t.pedidoDaTela('item/tool/requestUserInput', JSON.parse(process.env.CODEX_FALSO_PERGUNTAS).reduce((o, q) => (o.questions.push(q), o), { questions: [] }));
  assert.deepStrictEqual(p.entrada.questions.map((q) => [q.id, q.isSecret, q.isOther, q.options]), [['qa', true, true, []], ['qb', false, true, []]]);
});

test('A3: duas perguntas com o mesmo texto não colidem: a resposta casa pelo id', () => {
  const params = { questions: [{ id: 'qa', question: 'Qual a senha?' }, { id: 'qb', question: 'Qual a senha?' }] };
  assert.deepStrictEqual(t.respostaAoServidor('item/tool/requestUserInput', params, { permitir: true, respostas: { qa: 'um', qb: 'dois' } }),
    { answers: { qa: { answers: ['um'] }, qb: { answers: ['dois'] } } });
});

test('A3: a resposta secreta vai ao Codex e a nenhum outro lugar (eventos, tela, avisos)', async (t2) => {
  const c = new conversa._Conversa({ id: 'cs', titulo: 'Orquestrador', orquestrador: true });
  t2.after(() => c.parar());
  c.mandar('oi');
  await ate(() => c.pendentes.size === 1);
  const pedido = [...c.pendentes.values()][0];
  c.responder(pedido.id, { permitir: true, respostas: { qa: SEGREDO, qb: 'publico' } });
  await ate(() => recebidos().some((x) => x.id === 99 && !x.method));
  assert.deepStrictEqual(recebidos().find((x) => x.id === 99 && !x.method).result, { answers: { qa: { answers: [SEGREDO] }, qb: { answers: ['publico'] } } });
  await ate(() => c.eventos.some((e) => e.tipo === 'resultado'));
  assert.ok(!JSON.stringify(c.eventos).includes(SEGREDO), 'fora de registrar');
  assert.ok(!JSON.stringify(telas).includes(SEGREDO), 'fora do que vai à tela');
  assert.ok(!JSON.stringify(avisos).includes(SEGREDO), 'fora das notificações');
});

test('A3: o bichinho não traz pergunta com resposta secreta (só avisa para responder no app)', () => {
  const pedidoSecreto = { id: 'cx-99', ferramenta: 'AskUserQuestion', entrada: { questions: [{ id: 'qa', question: 'Qual a senha?', isSecret: true, options: [] }] } };
  const s = ajudante.pendenciaDeConversa({ id: 'orquestrador', orquestrador: true, titulo: 'Orquestrador' }, pedidoSecreto);
  assert.strictEqual(s.item, null, 'sem campo para digitar no bichinho');
  assert.match(s.texto, /resposta secreta: responda no app/);
  const s2 = ajudante.pendenciaDeConversa({ id: 'c1', orquestrador: false, titulo: 'Testes' }, pedidoSecreto);
  assert.strictEqual(s2.texto, '"Testes" tem uma pergunta com resposta secreta: responda no app');
  // A pergunta comum continua vindo inteira, como antes.
  const comum = ajudante.pendenciaDeConversa({ id: 'orquestrador', orquestrador: true, titulo: 'Orquestrador' }, { id: 'r1', ferramenta: 'AskUserQuestion', entrada: { questions: [{ question: 'Qual cor?', options: [{ label: 'Azul' }] }] } });
  assert.deepStrictEqual([comum.texto, comum.item.tipo, comum.item.perguntas.length, comum.conversa], ['O orquestrador tem uma pergunta para você', 'pergunta', 1, 'orquestrador']);
});
