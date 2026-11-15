// Área: workflows
// Gatilho "Arquivo novo na pasta" com fila por workflow: arquivos que chegam
// juntos (ou enquanto o workflow já roda) esperam a vez, nenhum se perde.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { casaTemporaria } = require('../ajuda');

const casa = casaTemporaria({});
const wf = require('../../workflows');

wf.ligar({ conversa: { lista: () => [], mandar: () => {}, ambienteLimpo: () => ({ ...process.env }) }, avisar: () => {}, enviarTela: () => {} });
wf.desligar(); // o vigia de verdade não roda; o teste chama olharPastas() à mão

const esperarExecucoes = async (id, n) => {
  for (let i = 0; i < 100 && wf.execucoes(id).filter((e) => e.fim).length < n; i++) await new Promise((r) => setTimeout(r, 50));
  return wf.execucoes(id);
};

test('workflows: 2 arquivos ao mesmo tempo na pasta → 2 execuções, sem reler a pasta a cada um', async () => {
  const entrada = path.join(casa, 'chegada');
  fs.mkdirSync(entrada);
  wf.gravar({ id: 'w-fila', nome: 'fila', ativo: true, nos: [
    { id: 'n1', tipo: 'pasta', config: { pasta: '~/chegada', padrao: '*.txt' } },
    { id: 'n2', tipo: 'ler', config: { caminho: '{{arquivo}}' } },
  ], ligacoes: [{ de: 'n1', para: 'n2' }] });
  wf.olharPastas(); // primeira olhada: pasta vazia
  fs.writeFileSync(path.join(entrada, 'a.txt'), 'primeiro');
  fs.writeFileSync(path.join(entrada, 'b.txt'), 'segundo');
  wf.olharPastas(); // viu os dois; espera o tamanho parar de mudar
  // Daqui em diante, conta quantas vezes alguém lista a pasta: a fila anda
  // sozinha, sem reler a pasta inteira a cada arquivo despachado.
  const listar = fs.readdirSync;
  let leituras = 0;
  fs.readdirSync = (p, ...r) => { if (path.resolve(String(p)) === entrada) leituras++; return listar(p, ...r); };
  try {
    wf.olharPastas(); // os dois estáveis: o 1º roda, o 2º espera a vez
    const e = await esperarExecucoes('w-fila', 2);
    assert.strictEqual(e.length, 2, `as duas chegadas viram execução: ${JSON.stringify(e.map((x) => x.motivo))}`);
    assert.deepStrictEqual(e.map((x) => x.motivo).sort(), ['arquivo novo: a.txt', 'arquivo novo: b.txt']);
    assert.ok(e.every((x) => x.ok), JSON.stringify(e.map((x) => x.passos)));
    assert.deepStrictEqual(e.map((x) => x.passos[1].saida).sort(), ['primeiro', 'segundo'], 'cada execução leu o próprio arquivo');
    assert.strictEqual(leituras, 1, 'só a olhada de 3 em 3 s lista a pasta; a fila não relê');
  } finally { fs.readdirSync = listar; }
  wf.olharPastas();
  assert.strictEqual(wf.execucoes('w-fila').length, 2, 'não dispara de novo');
  wf.gravar({ ...wf.lista().find((w) => w.id === 'w-fila'), ativo: false });
});

test('workflows: arquivo que chega com o workflow rodando (manual) espera a vez em vez de sumir', async () => {
  const entrada = path.join(casa, 'chegada2');
  fs.mkdirSync(entrada);
  wf.gravar({ id: 'w-ocupado', nome: 'ocupado', ativo: true, nos: [
    { id: 'm', tipo: 'manual' },
    { id: 'c', tipo: 'comando', config: { comando: 'sleep 0.6; echo manual' } },
    { id: 'n1', tipo: 'pasta', config: { pasta: '~/chegada2', padrao: '' } },
  ], ligacoes: [{ de: 'm', para: 'c' }] });
  wf.olharPastas();
  const manual = wf.rodar('w-ocupado', { gatilhos: ['m'] }); // ocupa o workflow por ~0,6 s
  fs.writeFileSync(path.join(entrada, 'c.txt'), 'x');
  wf.olharPastas();
  wf.olharPastas(); // estável enquanto o manual roda: entra na fila
  assert.strictEqual(wf.execucoes('w-ocupado').length, 0, 'ainda só o manual rodando');
  await manual;
  const e = await esperarExecucoes('w-ocupado', 2);
  assert.strictEqual(e.length, 2, JSON.stringify(e.map((x) => x.motivo)));
  assert.ok(e.some((x) => x.motivo === 'arquivo novo: c.txt'), 'o arquivo rodou depois do manual');
  wf.olharPastas();
  assert.strictEqual(wf.execucoes('w-ocupado').length, 2, 'e não roda duas vezes');
  wf.gravar({ ...wf.lista().find((w) => w.id === 'w-ocupado'), ativo: false });
});
