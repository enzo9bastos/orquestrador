// Área: conversa (histórico de uma conversa reaberta em páginas: "carregar as anteriores"; plano 3.4)
// A conversa reaberta mostra só as últimas 600 mensagens. Antes não havia aviso nem como ver
// as de antes. Agora o motor lê a página anterior a partir de onde parou, sem reler o que já
// está na tela e sem contar o arquivo inteiro.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { casaTemporaria } = require('../ajuda');

const casa = casaTemporaria({ iasCaminhos: { claude: path.join(__dirname, 'claude-falso.js'), codex: path.join(__dirname, 'codex-falso.js') } });
process.env.CLAUDE_FALSO_LOG = path.join(casa, 'claude-falso.log');
const conversa = require('../../conversa');

conversa.ligar(() => {});
conversa.ligarAvisos(() => {});
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
async function ate(cond, ms = 6000) {
  for (let i = 0; i < ms / 20; i++) { if (cond()) return; await espera(20); }
  throw new Error('não aconteceu a tempo');
}
const raiz = path.join(casa, '.claude', 'projects', casa.replace(/[^A-Za-z0-9]/g, '-'));
let n = 0;
// Um arquivo de conversa com `quantas` mensagens ("mensagem 1" … "mensagem N"), a pessoa e o Claude alternando.
function guardada(quantas, { extra = [] } = {}) {
  const sessao = `sessao-comprida-${String(++n).padStart(4, '0')}`;
  fs.mkdirSync(raiz, { recursive: true });
  const linhas = [JSON.stringify({ type: 'summary', summary: 'linha que não é mensagem' })];
  for (let i = 1; i <= quantas; i++) {
    linhas.push(i % 2 ? JSON.stringify({ type: 'user', message: { role: 'user', content: `mensagem ${i}` }, cwd: casa, uuid: `u-${i}` })
      : JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: `mensagem ${i}` }] }, uuid: `u-${i}` }));
    if (extra.includes(i)) linhas.push(JSON.stringify({ type: 'user', isMeta: true, message: { role: 'user', content: 'linha interna, fora da conversa' } }));
  }
  fs.writeFileSync(path.join(raiz, `${sessao}.jsonl`), `${linhas.join('\n')}\n`);
  return sessao;
}
const texto = (e) => (typeof e.message.content === 'string' ? e.message.content : e.message.content[0].text);
const numeros = (eventos) => eventos.map((e) => Number(texto(e).replace('mensagem ', '')));

test('histórico em páginas: 600 por vez, da mais nova para trás, sem pular nem repetir, até o começo do arquivo', () => {
  const sessao = guardada(1500, { extra: [450, 900, 901] });
  const p1 = conversa._paginaDoHistorico(sessao);
  assert.strictEqual(p1.eventos.length, 600);
  assert.deepStrictEqual([numeros(p1.eventos)[0], numeros(p1.eventos)[599]], [901, 1500]);
  assert.strictEqual(p1.haMais, true);
  const p2 = conversa._paginaDoHistorico(sessao, null, p1.inicio);
  assert.deepStrictEqual([p2.eventos.length, numeros(p2.eventos)[0], numeros(p2.eventos)[599], p2.haMais], [600, 301, 900, true]);
  const p3 = conversa._paginaDoHistorico(sessao, null, p2.inicio);
  assert.deepStrictEqual([p3.eventos.length, numeros(p3.eventos)[0], numeros(p3.eventos)[299], p3.haMais], [300, 1, 300, false]);
  assert.deepStrictEqual([...numeros(p3.eventos), ...numeros(p2.eventos), ...numeros(p1.eventos)], Array.from({ length: 1500 }, (_, i) => i + 1));
  // O jeito antigo de pedir (sem página) continua devolvendo as últimas 600.
  assert.deepStrictEqual(numeros(conversa._historico(sessao)).slice(-1), [1500]);
  assert.strictEqual(conversa._historico(sessao).length, 600);
});

test('histórico em páginas: conversa curta vem inteira e não oferece mais; conversa que não existe vem vazia', () => {
  const curta = guardada(40);
  const p = conversa._paginaDoHistorico(curta);
  assert.deepStrictEqual([p.eventos.length, p.haMais, p.inicio], [40, false, 0]);
  assert.deepStrictEqual(conversa._paginaDoHistorico('sessao-que-nao-existe-0009'), { eventos: [], inicio: 0, haMais: false });
});

test('carregar as anteriores: a conversa reaberta mostra as últimas 600, avisa que há mais e traz as de antes para o começo, em ordem', async (t) => {
  const sessao = guardada(1500);
  await espera(3);
  const id = conversa.retomar(sessao, 'claude', 'Conversa comprida');
  t.after(() => conversa.fechar(id));
  const c = conversa._pegar(id);
  c.iniciar();
  await ate(() => c.proc);
  assert.strictEqual(c.eventos.filter((e) => e.antigo).length, 600);
  assert.deepStrictEqual(c.estado().historico, { haMais: true, carregouAnteriores: false });
  assert.deepStrictEqual(c.carregarAnteriores(), { ok: true, haMais: true, novas: 600 });
  assert.deepStrictEqual([numeros(c.eventos.filter((e) => e.antigo))[0], c.eventos.filter((e) => e.antigo).length], [301, 1200]);
  assert.deepStrictEqual(c.estado().historico, { haMais: true, carregouAnteriores: true });
  assert.deepStrictEqual(c.carregarAnteriores(), { ok: true, haMais: false, novas: 300 });
  assert.deepStrictEqual(numeros(c.eventos.filter((e) => e.antigo)), Array.from({ length: 1500 }, (_, i) => i + 1));
  assert.deepStrictEqual(c.estado().historico, { haMais: false, carregouAnteriores: true });
  assert.deepStrictEqual(c.carregarAnteriores(), { ok: false, haMais: false, novas: 0 });
  // O que chega agora entra no fim e não corta o que a pessoa pediu para carregar.
  for (let i = 0; i < 2600; i++) c.registrar({ tipo: 'aviso', texto: `ao vivo ${i}` });
  assert.strictEqual(numeros(c.eventos.filter((e) => e.antigo))[0], 1, 'as mensagens carregadas foram cortadas pelo que chegou depois');
  assert.strictEqual(c.eventos[c.eventos.length - 1].texto, 'ao vivo 2599');
});

test('carregar as anteriores: conversa que cabe inteira não oferece; conversa nova e conversa do Codex também não', async (t) => {
  const curta = guardada(12);
  await espera(3);
  const id = conversa.retomar(curta, 'claude', 'Curta');
  t.after(() => conversa.fechar(id));
  const c = conversa._pegar(id);
  c.iniciar();
  await ate(() => c.proc);
  assert.deepStrictEqual(c.estado().historico, { haMais: false, carregouAnteriores: false });
  assert.deepStrictEqual(c.carregarAnteriores(), { ok: false, haMais: false, novas: 0 });
  await espera(3);
  const nova = conversa.nova();
  t.after(() => conversa.fechar(nova));
  assert.strictEqual(conversa._pegar(nova).estado().historico, null);
  const x = new conversa._Conversa({ id: 'hist-x', titulo: 'X', motor: 'codex', sessao: 'th-qualquer-123' });
  assert.deepStrictEqual(x.carregarAnteriores(), { ok: false, haMais: false, novas: 0 });
});

// 23/11: a conversa guardada com o login recusado voltava com a frase em inglês como se fosse
// resposta do Claude. Agora volta como o registro do login recusado (sem os botões, na tela).
test('histórico: o login recusado gravado pelo Claude volta como evento "login", e a frase citada numa resposta comum continua resposta', () => {
  const sessao = 'sessao-com-login-recusado-01';
  const frase = 'Failed to authenticate: this login reached its time limit and cannot be renewed.';
  fs.mkdirSync(raiz, { recursive: true });
  fs.writeFileSync(path.join(raiz, `${sessao}.jsonl`), `${[
    { type: 'user', message: { role: 'user', content: 'faz a passada' }, cwd: casa, uuid: 'l-1' },
    { type: 'assistant', message: { role: 'assistant', model: '<synthetic>', content: [{ type: 'text', text: frase }] }, error: 'authentication_failed', isApiErrorMessage: true, uuid: 'l-2' },
    { type: 'user', message: { role: 'user', content: 'o que quer dizer isso?' }, cwd: casa, uuid: 'l-3' },
    { type: 'assistant', message: { role: 'assistant', model: 'claude-x', content: [{ type: 'text', text: `A frase "${frase}" quer dizer que o login expirou.` }] }, uuid: 'l-4' },
  ].map((l) => JSON.stringify(l)).join('\n')}\n`);
  const p = conversa._paginaDoHistorico(sessao);
  assert.deepStrictEqual(p.eventos.map((e) => e.tipo), ['user', 'login', 'user', 'assistant']);
  assert.strictEqual(p.eventos[1].detalhe, frase);
  assert.strictEqual(p.eventos[1].antigo, true);
});
