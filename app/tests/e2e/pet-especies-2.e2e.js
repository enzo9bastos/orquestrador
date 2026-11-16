// Área: pet [lento] (chegada e saída de cada espécie, parte 2 de 3: quem voa espera no ar)
// Pedido de 2026-11-10: o fantasma vinha "duro" de cima, descia e ficava
// parado lá embaixo, no mesmo lugar dos outros. Agora quem voa vem
// rapidinho, dá o seu floreio e fica voando ali esperando a resposta — e
// continua no ar quando a pergunta fecha.
// Era parte de um teste só em pet.e2e.js (~70 s); ver pet-especies-1.e2e.js.
const test = require('node:test');
const assert = require('node:assert');
const { acompanhar, semTela, NOME } = require('./pet-ajudante');

test(NOME, { skip: semTela }, async (t) => {
  for (const [especie, floreio] of [['fantasma', 'pirueta'], ['nuvem', 'rolinho'], ['passarinho', 'looping']]) {
    await t.test(`${especie}: vem rapidinho, faz ${floreio} e espera voando, alto (não no chão)`, async () => {
      const r = await acompanhar(especie);
      assert.strictEqual(r.parado.floreio, floreio);
      assert.ok(r.parado.pos.y <= r.parado.chao - 120, `espera perto do chão: y ${r.parado.pos.y}, chão ${r.parado.chao}`);
      if (especie === 'fantasma') assert.ok(r.msChegada < 1300, `chegada lenta: ${r.msChegada} ms`);
      assert.ok(Math.max(...r.chegada) > r.parado.pos.y, 'mergulha abaixo do ponto de espera antes de subir até ele');
    });
  }
  await t.test('fantasma: depois que a conversa fecha, continua voando onde estava', async () => {
    const r = await acompanhar('fantasma', async ({ manda, estado }) => {
      const antes = await estado();
      manda({ t: 'js', codigo: "document.getElementById('pet').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); true" });
      for (let i = 0; i < 40 && !(await estado()).conversaAberta; i++) await new Promise((x) => setTimeout(x, 50));
      manda({ t: 'js', codigo: "document.getElementById('fechar').click(); true" });
      for (let i = 0; i < 40 && (await estado()).conversaAberta; i++) await new Promise((x) => setTimeout(x, 50));
      return { antes, depois: await estado() };
    });
    assert.strictEqual(r.extra.depois.conversaAberta, false);
    assert.strictEqual(r.extra.depois.pos.y, r.extra.antes.pos.y, `caiu para o chão: ${r.extra.antes.pos.y} → ${r.extra.depois.pos.y}`);
  });
});
