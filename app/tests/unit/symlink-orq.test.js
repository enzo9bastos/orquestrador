// Área: recados (escrita do app na pasta do projeto, à prova de link simbólico)
// 0.A1 da Etapa 0: o container do agente grava em <projeto>/.orq e pode pôr ali
// um link simbólico para fora do projeto (ex.: ~/.claude). O app roda no host:
// se seguisse o link, gravaria fora do projeto com o poder do usuário. Toda
// escrita do app em .orq/ fica dentro do projeto e recusa link, com motivo.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { casaTemporaria, escrever } = require('../ajuda');

const casa = casaTemporaria({ raizProjetos: '~/dev', niveis: 1, ignorar: '^[_-]' });
const recados = require('../../recados');
const coletor = require('../../coletor');

const fora = path.join(casa, 'fora'); // o que o agente quer alcançar no host
fs.mkdirSync(fora, { recursive: true });
let n = 0;
function projeto({ semOrq = false } = {}) {
  const proj = `p${++n}`;
  const dir = path.join(casa, 'dev', proj);
  fs.mkdirSync(semOrq ? dir : path.join(dir, '.orq'), { recursive: true });
  return { emp: '', proj, dir, alvo: proj };
}
const frente = (p, nome = 'Agente 1', sessao = null) => ({ emp: '', proj: p.proj, dir: p.dir, nome, sessaoClaude: sessao, pane: '%7' });
const alvoFora = (nome) => { const d = path.join(fora, nome); fs.mkdirSync(d, { recursive: true }); return d; };
const vazio = (d) => fs.readdirSync(d).length === 0;
const recado = (texto, extra = {}) => JSON.stringify({ texto, tipo: 'aviso', sessao: null, ...extra });

test('A1: lidos/ como link para fora → o recado não sai do projeto e é recusado com motivo', () => {
  const p = projeto();
  escrever(casa, `dev/${p.proj}/.orq/recados/saida/1.json`, recado('oi'));
  const destino = alvoFora('lidos');
  fs.symlinkSync(destino, path.join(p.dir, '.orq/recados/lidos'));
  const novos = recados.recolher([p], [frente(p)]);
  assert.ok(vazio(destino), 'nada foi movido para fora do projeto');
  assert.deepStrictEqual(fs.readdirSync(path.join(p.dir, '.orq/recados/saida')), ['1.json'], 'o arquivo fica onde estava');
  assert.strictEqual(novos.length, 1);
  assert.strictEqual(novos[0].estado, 'recusado');
  assert.match(novos[0].motivo, /link simbólico/);
  assert.strictEqual(recados.recolher([p], [frente(p)]).length, 0, 'o aviso não se repete a cada volta');
});

test('A1: recado que é link para um arquivo de fora → não é lido nem seguido; recusado com motivo', () => {
  const p = projeto();
  const segredo = path.join(alvoFora('segredo'), 'conta.json');
  fs.writeFileSync(segredo, recado('conteúdo do host que o agente não devia ler'));
  fs.mkdirSync(path.join(p.dir, '.orq/recados/saida'), { recursive: true });
  fs.symlinkSync(segredo, path.join(p.dir, '.orq/recados/saida/2.json'));
  const novos = recados.recolher([p], [frente(p)]);
  assert.strictEqual(novos.length, 1);
  assert.strictEqual(novos[0].estado, 'recusado');
  assert.match(novos[0].motivo, /link simbólico/);
  assert.doesNotMatch(JSON.stringify(recados.ler()), /conteúdo do host/, 'o conteúdo de fora não entra no registro');
  assert.ok(fs.existsSync(segredo), 'o arquivo de fora continua lá');
  assert.ok(!fs.existsSync(path.join(p.dir, '.orq/recados/saida/2.json')), 'o link sai da saída (vai para lidos, dentro do projeto)');
  assert.ok(fs.lstatSync(path.join(p.dir, '.orq/recados/lidos/2.json')).isSymbolicLink(), 'move o próprio link, sem seguir');
});

test('A1: pegar a vez com entrada/ como link para fora → a resposta não é gravada fora', () => {
  const p = projeto();
  const destino = alvoFora('entrada');
  fs.mkdirSync(path.join(p.dir, '.orq/recados'), { recursive: true });
  fs.symlinkSync(destino, path.join(p.dir, '.orq/recados/entrada'));
  escrever(casa, `dev/${p.proj}/.orq/recados/saida/3.json`, JSON.stringify({ acao: 'pegar', vez: 'x', req: 'r1' }));
  recados.recolher([p], [frente(p)]);
  assert.ok(vazio(destino), 'nada gravado fora do projeto');
});

test('A1: .orq/recados como link para fora → o quadro não é gravado fora', () => {
  const p = projeto();
  escrever(casa, `dev/${p.proj}/.orq/bin/orq-recado`, '#!/bin/sh\n');
  const destino = alvoFora('quadro');
  fs.symlinkSync(destino, path.join(p.dir, '.orq/recados'));
  recados.escreverQuadros([p], [frente(p)]);
  assert.ok(vazio(destino), 'agentes.json e vezes.json não foram parar fora');
});

test('A1: memória de destino como link para fora → a cópia entre pastas não grava fora', () => {
  const a = projeto(), b = projeto();
  recados.lembrar(a.dir, { titulo: 'Nota', texto: 'texto', tipo: 'onde' });
  const destino = alvoFora('memoria');
  fs.symlinkSync(destino, path.join(b.dir, '.orq/memoria'));
  recados.sincronizarMemoria([[a.dir, b.dir]]);
  assert.ok(vazio(destino), 'a nota não foi copiada para fora');
  assert.throws(() => recados.lembrar(b.dir, { titulo: 'Outra', texto: 'x', tipo: 'onde' }), /link simbólico/);
  assert.ok(vazio(destino), 'lembrar também não grava fora');
});

test('A1: .orq/bin como link para fora → o script não é instalado fora', () => {
  const p = projeto();
  const destino = alvoFora('bin');
  fs.symlinkSync(destino, path.join(p.dir, '.orq/bin'));
  assert.throws(() => recados.instalar(p.dir), /link simbólico/);
  assert.ok(vazio(destino));
});

test('A1: sinal de vida não segue link (nem em app-vivo, nem em .orq)', () => {
  const p = projeto();
  fs.mkdirSync(path.join(p.dir, '.orq/eventos'));
  const alvo = path.join(alvoFora('vivo'), 'arquivo-do-usuario');
  fs.writeFileSync(alvo, 'não mexer');
  const antes = fs.statSync(alvo).mtimeMs;
  fs.symlinkSync(alvo, path.join(p.dir, '.orq/app-vivo'));
  // Outro projeto com o próprio .orq apontando para fora.
  const q = projeto({ semOrq: true });
  const orqFora = alvoFora('orq-inteiro');
  fs.mkdirSync(path.join(orqFora, 'eventos'));
  fs.symlinkSync(orqFora, path.join(q.dir, '.orq'));
  const r = projeto(); // o normal continua funcionando
  fs.mkdirSync(path.join(r.dir, '.orq/eventos'));
  coletor.sinalDeVida();
  assert.strictEqual(fs.statSync(alvo).mtimeMs, antes, 'o arquivo de fora não foi tocado');
  assert.strictEqual(fs.readFileSync(alvo, 'utf8'), 'não mexer');
  assert.ok(!fs.existsSync(path.join(orqFora, 'app-vivo')), 'nada criado no .orq de fora');
  assert.ok(fs.existsSync(path.join(r.dir, '.orq/app-vivo')), 'o projeto normal ganha o sinal');
});

test('A1: resposta de permissão com respostas-perm como link para fora → não grava fora', () => {
  const p = projeto();
  escrever(casa, `dev/${p.proj}/.orq/permissoes/s-1.json`, JSON.stringify({ id: 's-1', ts: 1, tool_name: 'Bash', tool_input: { command: 'ls' } }) + '\n');
  coletor._pendencias('', p.proj, p.dir); // o app vê o pedido (e o congela)
  const destino = alvoFora('respostas');
  fs.symlinkSync(destino, path.join(p.dir, '.orq/respostas-perm'));
  assert.throws(() => coletor.responder('', p.proj, 's-1', 'permitir'), /link simbólico/);
  assert.ok(vazio(destino));
});

test('A1: escrita normal continua igual (recolher, quadro, memória, sinal)', () => {
  const p = projeto();
  escrever(casa, `dev/${p.proj}/.orq/recados/saida/9.json`, recado('tudo certo'));
  const [r] = recados.recolher([p], [frente(p)]);
  assert.strictEqual(r.estado, 'novo');
  assert.deepStrictEqual(fs.readdirSync(path.join(p.dir, '.orq/recados/lidos')), ['9.json']);
  escrever(casa, `dev/${p.proj}/.orq/bin/orq-recado`, '#!/bin/sh\n');
  assert.strictEqual(recados.escreverQuadros([p], [frente(p)]), 2);
  assert.ok(fs.existsSync(path.join(p.dir, '.orq/recados/agentes.json')));
  assert.match(recados.lembrar(p.dir, { titulo: 'Ok', texto: 'ok', tipo: 'onde' }), /ok$/);
});
