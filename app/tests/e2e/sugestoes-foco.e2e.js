// Área: conversa (a lista de sugestões do "/" e o foco da caixa de mensagem)
// A lista fecha 100 ms depois de a caixa perder o foco (o intervalo deixa o clique num item
// valer). Quem saía da caixa, voltava e digitava "/" dentro desse intervalo via a lista abrir e
// fechar em seguida: o fechamento pendente caía em cima da lista recém-aberta. Era a causa da
// falha intermitente do etapa0a-vizinhanca (0.B7), sem causa achada desde 16/11.
const test = require('node:test');
const assert = require('node:assert');
const { abrirApp } = require('./app');

test('a lista do "/" e o foco da caixa de mensagem', async (t) => {
  const app = await abrirApp({ config: { mostrarBichinho: false } });
  t.after(() => app.fechar());
  await app.esperar('!!window.__orqTeste');
  const ABERTA = "!document.getElementById('sugestoes').hidden";
  const limpar = () => app.avaliar("(() => { const e = document.getElementById('entrada'); e.focus(); e.value = ''; e.dispatchEvent(new Event('input')); })()");

  await t.test('antes de tudo: digitar "/" abre a lista', async () => {
    await app.avaliar("(() => { const e = document.getElementById('entrada'); e.focus(); e.value = '/'; e.dispatchEvent(new Event('input')); })()");
    await app.esperar(ABERTA, 8000);
    await limpar();
    await app.espera(250);
    assert.strictEqual(await app.avaliar(ABERTA), false);
  });

  await t.test('sair da caixa, voltar e digitar "/" logo em seguida: a lista abre e continua aberta', async () => {
    // Tudo no mesmo instante: a caixa perde o foco, recebe de volta e ganha a "/".
    const saiu = await app.avaliar(`(() => {
      const e = document.getElementById('entrada');
      let perdeu = 0;
      e.addEventListener('blur', () => { perdeu++; }, { once: true });
      e.focus();
      document.getElementById('abrir-config').focus();
      e.focus(); e.value = '/'; e.dispatchEvent(new Event('input'));
      return perdeu;
    })()`);
    assert.strictEqual(saiu, 1, 'a caixa não chegou a perder o foco: o teste não exercita o caso');
    assert.strictEqual(await app.avaliar(ABERTA), true, 'a lista nem abriu');
    await app.espera(400);
    assert.strictEqual(await app.avaliar(ABERTA), true, 'a lista fechou sozinha depois de aberta');
    assert.strictEqual(await app.avaliar("document.activeElement.id"), 'entrada');
  });

  await t.test('sair da caixa sem digitar continua fechando a lista', async () => {
    assert.strictEqual(await app.avaliar(ABERTA), true);
    await app.avaliar("document.getElementById('abrir-config').focus()");
    await app.esperar(`!(${ABERTA})`, 3000);
    // Voltar para a caixa sem digitar não reabre nem atrapalha o próximo "/".
    await app.avaliar("document.getElementById('entrada').focus()");
    await app.espera(250);
    assert.strictEqual(await app.avaliar(ABERTA), false);
    await limpar();
    assert.deepStrictEqual(app.erros, []);
  });
});
