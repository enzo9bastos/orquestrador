// Área: conversa
// Escrever a mensagem no editor de texto do computador (o Ctrl+G do terminal): o arquivo
// temporário é do app, fechado para os outros usuários, some quando a pessoa termina, e o
// que volta dele é só texto de um arquivo comum.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pastaTemporaria } = require('../temporarias');
const { criar, LIMITE, VELHO_MS } = require('../../editor-de-texto');

const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function ate(cond, oQue, ms = 3000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) { if (cond()) return; await espera(20); }
  assert.fail(`não aconteceu em ${ms} ms: ${oQue}`);
}
// Um editor de mentira: guarda o que abriu e o que a pessoa "salvou".
function montar(extra = {}) {
  const pasta = path.join(pastaTemporaria('orq-editor-'), 'editor');
  const abertos = [], mudou = [];
  const e = criar({ pasta, abrir: async (arq) => { abertos.push(arq); return ''; }, aoMudar: (t) => mudou.push(t), intervalo: 25, ...extra });
  return { pasta, abertos, mudou, e };
}
const modo = (p) => fs.statSync(p).mode & 0o777;

test('editor de texto: o arquivo nasce na pasta do app, fechado (700/600), com o texto da caixa, e o editor abre nele', async () => {
  const { pasta, abertos, e } = montar();
  const r = await e.comecar('primeira linha\nsegunda');
  assert.deepStrictEqual(r, { ok: true });
  assert.strictEqual(abertos.length, 1);
  const arq = abertos[0];
  assert.strictEqual(path.dirname(arq), pasta);
  assert.match(path.basename(arq), /^mensagem-[0-9a-f]{12}\.txt$/);
  assert.strictEqual(modo(pasta), 0o700);
  assert.strictEqual(modo(arq), 0o600);
  assert.strictEqual(fs.readFileSync(arq, 'utf8'), 'primeira linha\nsegunda');
  assert.deepStrictEqual(e.estado(), { editando: true, texto: 'primeira linha\nsegunda' });
  assert.deepStrictEqual(e.terminar(), { ok: true, texto: 'primeira linha\nsegunda' });
  assert.strictEqual(fs.existsSync(arq), false, 'terminou: o arquivo some');
  assert.deepStrictEqual(e.estado(), { editando: false });
  assert.deepStrictEqual(e.terminar(), { ok: false }, 'terminar sem edição aberta não faz nada');
});

test('editor de texto: cada vez que a pessoa salva, o texto novo chega (sem a quebra de linha do fim), também quando o editor troca o arquivo', async () => {
  const { pasta, abertos, mudou, e } = montar();
  await e.comecar('rascunho');
  const arq = abertos[0];
  fs.writeFileSync(arq, 'rascunho com mais uma frase\n');
  await ate(() => mudou.length === 1, 'o primeiro salvar chegar');
  assert.strictEqual(mudou[0], 'rascunho com mais uma frase');
  // Editor que salva num arquivo ao lado e troca pelo de verdade (é assim que a maioria faz).
  const ao_lado = path.join(pasta, '.salvando');
  fs.writeFileSync(ao_lado, 'texto trocado\r\n');
  fs.renameSync(ao_lado, arq);
  await ate(() => mudou.length === 2, 'o salvar por troca chegar');
  assert.strictEqual(mudou[1], 'texto trocado');
  // Salvar igual ao que já estava não avisa de novo.
  fs.writeFileSync(arq, 'texto trocado\n');
  await espera(120);
  assert.strictEqual(mudou.length, 2);
  assert.deepStrictEqual(e.terminar(), { ok: true, texto: 'texto trocado' });
  assert.strictEqual(fs.existsSync(arq), false);
});

test('editor de texto: terminar e perguntar o estado leem o arquivo na hora (não esperam a próxima espiada)', async () => {
  const { abertos, mudou, e } = montar({ intervalo: 60000 });
  await e.comecar('a');
  fs.writeFileSync(abertos[0], 'salvo agora\n');
  assert.deepStrictEqual(e.estado(), { editando: true, texto: 'salvo agora' });
  assert.deepStrictEqual(mudou, ['salvo agora']);
  fs.writeFileSync(abertos[0], 'salvo por último');
  assert.deepStrictEqual(e.terminar(), { ok: true, texto: 'salvo por último' });
});

test('editor de texto: não segue link, não lê arquivo gigante e tira o caractere nulo', async () => {
  const { pasta, abertos, mudou, e } = montar();
  await e.comecar('meu texto');
  const arq = abertos[0];
  const segredo = path.join(path.dirname(pasta), 'segredo.txt');
  fs.writeFileSync(segredo, 'conteúdo de outro arquivo');
  fs.unlinkSync(arq);
  fs.symlinkSync(segredo, arq);
  await espera(150);
  assert.deepStrictEqual(mudou, [], 'link no lugar do arquivo: nada chega à caixa');
  assert.deepStrictEqual(e.estado(), { editando: true, texto: 'meu texto' });
  fs.unlinkSync(arq);
  fs.writeFileSync(arq, Buffer.alloc(LIMITE + 1, 0x61));
  await espera(150);
  assert.deepStrictEqual(mudou, [], 'arquivo acima do limite: nada chega à caixa');
  fs.writeFileSync(arq, 'com\u0000nulo');
  await ate(() => mudou.length === 1, 'o texto válido chegar');
  assert.strictEqual(mudou[0], 'comnulo');
  // Terminar com um link no lugar: não apaga o que o link aponta e devolve o último texto bom.
  fs.unlinkSync(arq);
  fs.symlinkSync(segredo, arq);
  assert.deepStrictEqual(e.terminar(), { ok: true, texto: 'comnulo' });
  assert.strictEqual(fs.readFileSync(segredo, 'utf8'), 'conteúdo de outro arquivo');
  assert.ok(fs.lstatSync(arq).isSymbolicLink(), 'o link fica: este módulo só apaga arquivo comum criado por ele');
});

test('editor de texto: uma edição por vez; pedir de novo só abre o editor outra vez no mesmo arquivo', async () => {
  const { pasta, abertos, e } = montar();
  await e.comecar('um');
  const r = await e.comecar('outro texto que não entra');
  assert.deepStrictEqual(r, { ok: true, jaEditando: true, texto: 'um' });
  assert.strictEqual(abertos.length, 2);
  assert.strictEqual(abertos[0], abertos[1]);
  assert.strictEqual(fs.readdirSync(pasta).length, 1);
  assert.strictEqual(fs.readFileSync(abertos[0], 'utf8'), 'um');
  e.terminar();
  assert.deepStrictEqual(fs.readdirSync(pasta), []);
});

test('editor de texto: se o editor não abre, a edição não começa e o arquivo não fica', async () => {
  for (const abrir of [async () => 'nenhum programa para abrir texto', async () => { throw new Error('quebrou'); }]) {
    const { pasta, e } = montar({ abrir });
    const r = await e.comecar('texto');
    assert.ok(r.erro, JSON.stringify(r));
    assert.deepStrictEqual(e.estado(), { editando: false });
    assert.deepStrictEqual(fs.readdirSync(pasta), []);
  }
});

test('editor de texto: recusa o que não é texto e o que passa do limite, sem criar nada', async () => {
  const { pasta, abertos, e } = montar();
  for (const v of [null, undefined, 7, {}, ['a']]) assert.deepStrictEqual(await e.comecar(v), { erro: 'texto inválido' }, JSON.stringify(v));
  assert.ok((await e.comecar('a'.repeat(LIMITE + 1))).erro);
  assert.strictEqual(abertos.length, 0);
  assert.strictEqual(fs.existsSync(pasta), false);
});

test('editor de texto: a limpeza de sobras só tira arquivo de mensagem com mais de 7 dias, e nunca o que está aberto', async () => {
  let agora = Date.now();
  const { pasta, abertos, e } = montar({ agora: () => agora });
  await e.comecar('em edição');
  const emEdicao = abertos[0];
  const velha = path.join(pasta, 'mensagem-0123456789ab.txt');
  const copia = path.join(pasta, 'mensagem-0123456789ab.txt~');
  const nova = path.join(pasta, 'mensagem-ba9876543210.txt');
  const outra = path.join(pasta, 'anotacoes.txt');
  const subpasta = path.join(pasta, 'mensagem-aaaaaaaaaaaa.txt');
  for (const a of [velha, copia, nova, outra]) fs.writeFileSync(a, 'x');
  fs.mkdirSync(subpasta);
  const antigo = new Date(agora - VELHO_MS - 60000);
  for (const a of [velha, copia, outra, subpasta, emEdicao]) fs.utimesSync(a, antigo, antigo);
  assert.strictEqual(e.limparSobras(), 2);
  assert.deepStrictEqual(fs.readdirSync(pasta).sort(), [path.basename(outra), path.basename(subpasta), path.basename(nova), path.basename(emEdicao)].sort());
  // Sete dias depois, a que era nova também sai; a que está aberta continua.
  agora += VELHO_MS + 60000;
  assert.strictEqual(e.limparSobras(), 1);
  assert.ok(fs.existsSync(emEdicao));
  e.terminar();
  // Sem a pasta: não quebra.
  assert.strictEqual(criar({ pasta: path.join(pasta, 'nao-existe'), abrir: async () => '' }).limparSobras(), 0);
});
