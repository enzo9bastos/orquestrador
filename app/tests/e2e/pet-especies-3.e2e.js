// Área: pet [lento] (chegada e saída de cada espécie, parte 3 de 3: o floreio de quem anda)
// Era parte de um teste só em pet.e2e.js (~70 s); ver pet-especies-1.e2e.js.
const test = require('node:test');
const assert = require('node:assert');
const { acompanhar, semTela, NOME } = require('./pet-ajudante');

test(NOME, { skip: semTela }, async (t) => {
  await t.test('cada espécie chega com o seu floreio', async () => {
    const esperado = { bicho: 'oi', gatinho: 'espreguica', pinguim: 'levanta', sapinho: 'quica', gosma: 'quica' };
    for (const [especie, floreio] of Object.entries(esperado)) {
      const r = await acompanhar(especie);
      assert.strictEqual(r.parado.floreio, floreio, especie);
    }
  });
});
