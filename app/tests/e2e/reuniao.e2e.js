// Área: voz [sozinho] (modo reunião no app: gravar, print, marcar, terminar e a nota pronta)
// [sozinho]: o print captura a tela inteira; com outros apps de teste na mesma tela virtual, a captura falha.
// Pedido de 23/11. O ffmpeg grava um tom gerado por ele (sem microfone), a transcrição é o
// voz-falso.js, o resumo é o claude-resumo-falso.js; o print é de verdade, da tela virtual.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { abrirApp } = require('./app');

const FALSO = path.join(__dirname, '..', 'unit', 'voz-falso.js');
const CLAUDE = path.join(__dirname, '..', 'unit', 'claude-resumo-falso.js');
const BARRA = "document.getElementById('reuniao-barra')";
const textoBarra = `${BARRA}.innerText.replace(/\\s+/g, ' ').trim()`;

for (const idioma of ['pt-BR', 'en']) {
  test(`modo reunião no app (${idioma})`, async (t) => {
    const app = await abrirApp({
      config: { idioma, mostrarBichinho: false, reunioesPasta: '~/Reuniões', reuniaoResumo: 'claude', reuniaoPrints: true },
      env: { ORQ_REUNIAO_ENTRADA: 'teste', ORQ_VOZ_PYTHON: process.execPath, ORQ_VOZ_SCRIPT: FALSO, ORQ_REUNIAO_CLAUDE: CLAUDE },
    });
    t.after(() => app.fechar());
    await app.esperar('!!window.orqReuniao');
    const en = idioma === 'en';
    const base = path.join(app.casa, 'Reuniões');
    const pastas = () => { try { return fs.readdirSync(base); } catch { return []; } };
    const clicar = (rb) => app.avaliar(`document.querySelector('#reuniao-barra [data-rb="${rb}"]').click()`);

    await t.test('sem reunião, a barra não aparece; a paleta oferece "Gravar reunião"', async () => {
      assert.strictEqual(await app.avaliar(`${BARRA}.hidden`), true);
    });

    await t.test('começar: a barra mostra "Gravando" com o tempo, Print, Marcar e Terminar; a pasta nasce com data e hora', async () => {
      const r = await app.avaliar("window.orq.reuniao.comecar('Alinhamento')");
      assert.ok(r.ok, JSON.stringify(r));
      await app.esperar(`!${BARRA}.hidden && ${BARRA}.classList.contains('gravando')`, 8000);
      assert.match(await app.avaliar(textoBarra), en ? /^Recording \d\d:\d\d 📷 0 ★ 0 Done$/ : /^Gravando \d\d:\d\d 📷 0 ★ 0 Terminar$/);
      assert.deepStrictEqual(pastas().map((p) => /^\d{4}-\d\d-\d\d-\d\dh\d\d-reuniao$/.test(p)), [true]);
    });

    if (en) { await clicar('terminar'); await clicar('terminar-sim'); await app.esperar(`/Note ready/.test(${textoBarra})`, 20000); assert.deepStrictEqual(app.erros, []); return; }

    await t.test('print: a imagem da tela vira um arquivo no minuto certo; marcar conta o momento', async () => {
      await app.espera(1500);
      assert.strictEqual(await app.avaliar("window.orqReuniao.estado().printsLigados === false ? 'prints desligados: ' + window.orqReuniao.estado().motivoPrints : 'ligados'"), 'ligados');
      await app.espera(1200);
      await clicar('print');
      await app.esperar(`/📷 1/.test(${textoBarra})`, 15000);
      const pasta = path.join(base, pastas()[0]);
      const prints = fs.readdirSync(path.join(pasta, 'prints'));
      assert.strictEqual(prints.length, 1);
      assert.match(prints[0], /^\d\d-\d\d\.png$/);
      const png = fs.readFileSync(path.join(pasta, 'prints', prints[0]));
      assert.strictEqual(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'é um PNG');
      await clicar('marcar');
      await app.esperar(`/★ 1/.test(${textoBarra})`, 5000);
    });

    await t.test('terminar pede confirmação; "Continuar gravando" volta; "Terminar" para e monta a nota', async () => {
      await clicar('terminar');
      assert.match(await app.avaliar(textoBarra), /Terminar a reunião\? Continuar gravando Terminar/);
      await clicar('continuar');
      assert.match(await app.avaliar(textoBarra), /^Gravando/);
      await clicar('terminar');
      await clicar('terminar-sim');
      await app.esperar(`/Nota pronta: NF obrigatória no cartão/.test(${textoBarra})`, 20000);
      assert.deepStrictEqual(pastas(), [pastas()[0]]);
      assert.match(pastas()[0], /^\d{4}-\d\d-\d\d-\d\dh\d\d-nf-obrigatoria-no-cartao$/);
      const pasta = path.join(base, pastas()[0]);
      const nota = fs.readFileSync(path.join(pasta, 'reuniao.md'), 'utf8');
      assert.match(nota, /^# NF obrigatória no cartão/);
      assert.match(nota, /## Decisões\n\n- Manter a NF obrigatória/);
      assert.match(nota, /\*\*Você:\*\* Bom dia, vamos começar pela nota fiscal\./);
      assert.match(nota, /\*\*Outros:\*\* Concordo, mas o cartão corporativo precisa de exceção\./);
      assert.match(nota, /!\[Print em \d\d:\d\d\]\(prints\/\d\d-\d\d\.png\)/);
      assert.match(nota, /★ \*\*Momento marcado\*\*/);
      const audio = fs.readdirSync(path.join(pasta, 'audio')).sort();
      assert.deepStrictEqual(audio, ['outros.opus', 'voce.opus']);
      for (const a of audio) assert.ok(fs.statSync(path.join(pasta, 'audio', a)).size > 0, `${a} gravado`);
    });

    await t.test('"Abrir a nota" só abre dentro da pasta das reuniões', async () => {
      const r = await app.avaliar("window.orq.reuniao.abrir('/etc/passwd')");
      assert.match(r.erro, /fora da pasta das reuniões/);
      await clicar('nota');
      await clicar('fechar');
      assert.strictEqual(await app.avaliar(`${BARRA}.hidden`), true);
    });

    await t.test('Configurações › Voz e reuniões: pasta, motor, modelo e resumo com a recomendação deste computador', async () => {
      await app.avaliar("document.getElementById('abrir-config').click()");
      await app.avaliar("document.querySelector('[data-secao-config=\"voz\"]').click()");
      await app.esperar("!/Procurando/.test(document.getElementById('config-voz-motor').textContent)", 15000);
      assert.ok(['~/Reuniões', path.join(app.casa, 'Reuniões')].includes(await app.avaliar("document.querySelector('[data-cfg=\"reunioesPasta\"]').value")));
      assert.match(await app.avaliar("document.getElementById('config-voz-maquina').textContent"), /Este computador: \d+ núcleos, \d+ GB de memória/);
      assert.match(await app.avaliar("document.getElementById('config-voz-modelo').options[0].textContent"), /^Recomendado para este computador \((Leve|Robusto|Melhor)\)$/);
      assert.match(await app.avaliar("document.getElementById('config-voz-resumo').textContent"), /^Recomendação: (Claude|modelo local), porque /);
      assert.strictEqual(await app.avaliar("document.querySelector('[data-cfg=\"reuniaoPrints\"]').checked"), true);
      await app.avaliar("(() => { const s = document.getElementById('config-voz-modelo'); s.value = 'small'; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
      await app.espera(400);
      assert.strictEqual(JSON.parse(app.ler('.config/orq-app/config.json')).vozModelo, 'small');
      assert.deepStrictEqual(app.erros, []);
    });
  });
}

// Pedido de 23/11 (como o Granola): o app nota a ligação pelo microfone. Aqui o pw-dump é falso:
// o teste escreve num arquivo quem está usando o microfone.
for (const modo of ['perguntar', 'gravar']) {
  test(`reunião detectada pelo microfone (${modo})`, async (t) => {
    const { pastaTemporaria } = require('../temporarias');
    const lista = path.join(pastaTemporaria('orq-pw-'), 'microfone.json');
    fs.writeFileSync(lista, '[]');
    const app = await abrirApp({
      config: { mostrarBichinho: false, reunioesPasta: '~/Reuniões', reuniaoResumo: 'claude', reuniaoPrints: true, reuniaoDetectar: modo },
      env: { ORQ_REUNIAO_ENTRADA: 'teste', ORQ_VOZ_PYTHON: process.execPath, ORQ_VOZ_SCRIPT: FALSO, ORQ_REUNIAO_CLAUDE: CLAUDE, ORQ_PW_DUMP: path.join(__dirname, '..', 'unit', 'pw-dump-falso.js'), PW_FALSO_ARQ: lista },
    });
    t.after(() => app.fechar());
    await app.esperar('!!window.orqReuniao');
    const base = path.join(app.casa, 'Reuniões');
    const pastas = () => { try { return fs.readdirSync(base); } catch { return []; } };
    const clicar = (rb) => app.avaliar(`document.querySelector('#reuniao-barra [data-rb="${rb}"]').click()`);

    fs.writeFileSync(lista, JSON.stringify([{ app: 'Google Chrome', binario: 'chrome', pid: 4242 }]));
    if (modo === 'perguntar') {
      await t.test('a ligação no navegador: quem pergunta é o bichinho (a barra não); nada é gravado antes do sim', async () => {
        await app.espera(2500);
        assert.strictEqual(await app.avaliar(`${BARRA}.hidden`), true, 'a barra do app não pergunta');
        assert.deepStrictEqual(pastas(), []);
        // O "Sim, gravar" do bichinho chega ao app como este pedido.
        await app.avaliar("window.orq.reuniao.comecar('')");
        await app.esperar(`${BARRA}.classList.contains('gravando')`, 8000);
        assert.strictEqual(pastas().length, 1);
      });
      await t.test('a miniatura do que os prints mostram fica disponível', async () => {
        await app.esperar('window.orq.reuniao.tela().then((x) => !!(x && /^data:image\\/jpeg;base64,/.test(x.miniatura)))', 10000);
      });
      await t.test('a ligação solta o microfone: a barra continua só com a gravação (quem pergunta é o bichinho); terminar monta a nota', async () => {
        fs.writeFileSync(lista, '[]');
        await app.espera(2500);
        assert.match(await app.avaliar(textoBarra), /^Gravando/);
        await clicar('terminar');
        await clicar('terminar-sim');
        await app.esperar(`/Nota pronta/.test(${textoBarra})`, 20000);
        assert.deepStrictEqual(app.erros, []);
      });
    } else {
      await t.test('a ligação no navegador: começa a gravar sozinho e avisa para avisar as pessoas', async () => {
        await app.esperar(`${BARRA}.classList.contains('gravando')`, 8000);
        await app.esperar("[...document.querySelectorAll('#mensagens .aviso-conversa')].some((a) => /Comecei a gravar a reunião no navegador[\\s\\S]*Avise as pessoas/.test(a.innerText))", 5000);
      });
      await t.test('a ligação acaba: termina sozinho e a nota sai', async () => {
        fs.writeFileSync(lista, '[]');
        await app.esperar(`/Nota pronta/.test(${textoBarra})`, 20000);
        assert.strictEqual(pastas().length, 1);
        assert.deepStrictEqual(app.erros, []);
      });
    }
  });
}
