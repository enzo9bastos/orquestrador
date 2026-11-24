// Área: voz (o menu do bichinho de dentro do app também começa e termina a reunião)
// Pedido de 24/11: o botão direito no bichinho de dentro do app não oferecia "Gravar reunião";
// só o bichinho da área de trabalho e a paleta ofereciam. O ffmpeg grava um tom gerado por ele
// (sem microfone), a transcrição é o voz-falso.js e o resumo é o claude-resumo-falso.js; sem prints.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { abrirApp } = require('./app');

const FALSO = path.join(__dirname, '..', 'unit', 'voz-falso.js');
const CLAUDE = path.join(__dirname, '..', 'unit', 'claude-resumo-falso.js');
const BARRA = "document.getElementById('reuniao-barra')";
const textoBarra = `${BARRA}.innerText.replace(/\\s+/g, ' ').trim()`;
const ITENS = "[...document.querySelectorAll('.pet-menu li')].filter((li) => getComputedStyle(li).display !== 'none').map((li) => li.firstChild.textContent.trim())";

const TEXTOS = {
  'pt-BR': {
    fixos: ['Conversar com ele', '📷 Mostrar um pedaço da tela', 'Guarda-roupa…', 'Passear pela área de trabalho', 'Esconder o bichinho'],
    gravar: '🎙 Gravar reunião', terminar: '🎙 Terminar a reunião…',
    gravando: /^Gravando \d\d:\d\d ★ 0 Terminar$|^Gravando \d\d:\d\d 📷 0 ★ 0 Terminar$/, confirma: /^Terminar a reunião\? Continuar gravando Terminar$/, pronta: /Nota pronta/,
  },
  en: {
    fixos: ['Chat with it','📷 Show a piece of the screen', 'Wardrobe…', 'Wander around the desktop', 'Hide the pet'],
    gravar: '🎙 Record meeting', terminar: '🎙 End the meeting…',
    gravando: /^Recording \d\d:\d\d ★ 0 Done$|^Recording \d\d:\d\d 📷 0 ★ 0 Done$/, confirma: /^End the meeting\? /, pronta: /Note ready/,
  },
};

for (const idioma of ['pt-BR', 'en']) {
  test(`menu do bichinho de dentro do app: reunião (${idioma})`, async (t) => {
    const app = await abrirApp({
      config: { idioma, reunioesPasta: '~/Reuniões', reuniaoResumo: 'claude', reuniaoPrints: false },
      env: { ORQ_REUNIAO_ENTRADA: 'teste', ORQ_VOZ_PYTHON: process.execPath, ORQ_VOZ_SCRIPT: FALSO, ORQ_REUNIAO_CLAUDE: CLAUDE },
    });
    t.after(() => app.fechar());
    await app.esperar('!!window.orqReuniao && !!window.orqGuardaRoupa && !!document.querySelector("#palco-pet .pet svg")');
    const T = TEXTOS[idioma];
    const base = path.join(app.casa, 'Reuniões');
    const pastas = () => { try { return fs.readdirSync(base); } catch { return []; } };
    const com = (item) => [T.fixos[0], T.fixos[1], item, ...T.fixos.slice(2)];
    const abrirMenu = async () => {
      await app.avaliar("document.querySelector('#palco-pet .pet').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 300, clientY: 300 }))");
      await app.esperar("!document.querySelector('.pet-menu').hidden");
      await app.espera(150); // a tradução do texto trocado na hora
      return app.avaliar(ITENS);
    };
    const clicarItem = () => app.avaliar("document.querySelector('.pet-menu [data-pm=reuniao]').click()");
    const clicarBarra = (rb) => app.avaliar(`document.querySelector('#reuniao-barra [data-rb="${rb}"]').click()`);

    await t.test('sem reunião, o menu oferece "Gravar reunião" e os itens de antes continuam, na mesma ordem', async () => {
      assert.deepStrictEqual(await abrirMenu(), com(T.gravar));
      assert.strictEqual(await app.avaliar(`${BARRA}.hidden`), true);
      assert.deepStrictEqual(pastas(), []);
    });

    await t.test('clicar em "Gravar reunião" fecha o menu e começa a gravar: a barra mostra o tempo e a pasta nasce', async () => {
      await clicarItem();
      assert.strictEqual(await app.avaliar("document.querySelector('.pet-menu').hidden"), true);
      await app.esperar(`!${BARRA}.hidden && ${BARRA}.classList.contains('gravando')`, 8000);
      assert.match(await app.avaliar(textoBarra), T.gravando);
      assert.strictEqual(pastas().length, 1);
    });

    await t.test('gravando, o item vira "Terminar a reunião…" e pede a confirmação na barra, sem parar a gravação', async () => {
      assert.deepStrictEqual(await abrirMenu(), com(T.terminar));
      await clicarItem();
      assert.match(await app.avaliar(textoBarra), T.confirma);
      assert.strictEqual(await app.avaliar('window.orqReuniao.estado().gravando'), true);
      await clicarBarra('continuar');
      assert.match(await app.avaliar(textoBarra), T.gravando);
    });

    await t.test('terminar pelo menu e confirmar: a nota sai, o item volta a ser "Gravar reunião" e não nasce pasta a mais', async () => {
      await abrirMenu();
      await clicarItem();
      await clicarBarra('terminar-sim');
      await app.esperar(`${T.pronta}.test(${textoBarra})`, 20000);
      assert.deepStrictEqual(await abrirMenu(), com(T.gravar));
      assert.strictEqual(pastas().length, 1);
      assert.ok(fs.existsSync(path.join(base, pastas()[0], 'reuniao.md')));
      assert.deepStrictEqual(app.erros, []);
    });
  });
}
