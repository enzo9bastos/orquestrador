// Área: pet (0.B11: o bichinho ficava em cima do botão Parar, e a barra da
// conversa cortava o último botão numa janela de 1480 px)
const test = require('node:test');
const assert = require('node:assert');
const { abrirApp } = require('./app');

test('0.B11: com o bichinho ligado e a barra cheia, o Parar fica visível e clicável (1480 px)', async (t) => {
  const app = await abrirApp({ config: { comandoInicial: '/rodada', comandoDesligar: '/fim' } });
  t.after(() => app.fechar());
  await app.tamanho(1480, 900);
  await app.esperar('!!window.__orqTeste');
  // Barra cheia (pasta, modelo + esforço, três medidores, Iniciar, Desligar,
  // Nova conversa) e a faixa "Pensando… Parar" à vista.
  await app.avaliar("window.__orqTeste.desenharInfo({ modelo: 'claude-opus-5-5', esforco: 'high', pasta: '/home/ana/projetos/api-pedidos', uso5h: 23, uso7d: 41, contexto: 92000, janela: 200000, ocupado: true })");
  await app.esperar("!document.getElementById('trabalhando').hidden");
  await app.espera(1500);

  await t.test('o bichinho está na conversa, à vista (o teste não passa à toa)', async () => {
    assert.strictEqual(await app.avaliar('window.orqPetAtual.salaNome'), 'centro');
    assert.strictEqual(await app.avaliar("getComputedStyle(window.orqPetAtual.el).visibility"), 'visible');
    assert.strictEqual(await app.avaliar("document.getElementById('palco-pet').hidden || document.getElementById('palco-pet').classList.contains('desligado')"), false);
  });

  await t.test('#parar visível e clicável, mesmo com o bichinho passeando', async () => {
    for (let i = 0; i < 6; i++) {
      assert.strictEqual(await app.visivel('#parar'), 'ok', `volta ${i}`);
      await app.espera(500);
    }
  });

  await t.test('com o bichinho na direita, em cima da caixa: ainda o Parar à vista', async () => {
    // O pior lugar de antes: o canto direito, onde fica o Parar.
    await app.avaliar('(() => { const p = window.orqPetAtual; p.x = p.sala().x1; p.encaixar(); })()');
    await app.espera(300);
    assert.strictEqual(await app.visivel('#parar'), 'ok');
  });

  await t.test('a barra cabe: Nova conversa, Desligar e Iniciar inteiros', async () => {
    for (const b of ['#nova-conversa', '#desligar', '#iniciar-rodada', '#botao-modelo']) assert.strictEqual(await app.visivel(b), 'ok', b);
  });

  await t.test('sem a faixa, o bichinho desce de novo até a caixa', async () => {
    const antes = await app.avaliar('window.orqPetAtual.sala().chao');
    await app.avaliar("window.__orqTeste.desenharInfo({ modelo: 'claude-opus-5-5', esforco: 'high', pasta: '/home/ana/projetos/api-pedidos', uso5h: 23, uso7d: 41, contexto: 92000, janela: 200000, ocupado: false })");
    await app.espera(300);
    assert.ok(await app.avaliar('window.orqPetAtual.sala().chao') > antes, 'o chão não desceu com a faixa fechada');
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
