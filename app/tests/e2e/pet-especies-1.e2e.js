// Área: pet [lento] (chegada e saída de cada espécie, parte 1 de 3: o jeito de andar, voar, pular e brotar)
// Pedido de 2026-11-05: cada espécie chega e vai embora do seu jeito.
// Era um teste só em pet.e2e.js (~70 s); dividido em três arquivos, com o mesmo
// nome e os mesmos subtestes, para rodar em paralelo.
const test = require('node:test');
const assert = require('node:assert');
const { acompanhar, varia, semTela, NOME } = require('./pet-ajudante');

test(NOME, { skip: semTela }, async (t) => {
  await t.test('bicho: chega e sai andando no chão (como sempre)', async () => {
    const r = await acompanhar('bicho');
    assert.strictEqual(r.parado.modo, 'parado');
    assert.strictEqual(varia(r.chegada), 0, `altura mudou ao chegar: ${r.chegada}`);
    assert.strictEqual(varia(r.saida), 0, `altura mudou ao sair: ${r.saida}`);
  });
  for (const especie of ['fantasma', 'nuvem']) {
    await t.test(`${especie}: chega voando ondulado, para no ar e vai embora subindo`, async () => {
      const r = await acompanhar(especie);
      assert.strictEqual(r.parado.modo, 'parado');
      assert.ok(varia(r.chegada) > 25, `não voou na chegada: ${r.chegada}`);
      assert.ok(Math.min(...r.saida) < r.parado.pos.y - 100, `não subiu ao sair: ${r.saida} (parado em ${r.parado.pos.y})`);
    });
  }
  await t.test('gosma: chega e vai embora pulando', async () => {
    const r = await acompanhar('gosma');
    assert.strictEqual(r.parado.modo, 'parado');
    assert.ok(varia(r.chegada) > 40, `não pulou na chegada: ${r.chegada}`);
    assert.ok(varia(r.saida) > 40, `não pulou na saída: ${r.saida}`);
    assert.ok(Math.max(...r.chegada) <= r.parado.pos.y, 'os pulos são para cima do chão');
  });
  await t.test('cogumelo: brota do chão onde vai ficar e afunda nele para ir embora', async () => {
    const r = await acompanhar('cogumelo');
    assert.strictEqual(r.parado.modo, 'parado');
    assert.strictEqual(r.parado.floreio, 'brota');
    assert.strictEqual(varia(r.chegadaX), 0, `andou ao chegar: ${r.chegadaX}`);
    assert.strictEqual(varia(r.chegada), 0, `saiu do chão ao chegar: ${r.chegada}`);
    assert.strictEqual(r.floreioSaida, 'afunda');
    assert.strictEqual(varia(r.saidaX), 0, `andou ao sair: ${r.saidaX}`);
  });
});
