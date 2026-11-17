// Área: conversa (pilha única do Esc do P1: cada Esc faz uma coisa só)
// Plano 1.2. Ordem: lista ou menu aberto → fecha; popup ou janela por cima →
// fecha (o dono dela); "corrigindo" → cancela; motor ocupado → interrompe;
// parado e com a caixa vazia, Esc Esc → abre o voltar. Nunca interrompe com o
// foco num terminal ou num campo que não é a caixa da conversa, nem fora da
// aba da conversa.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pastaTemporaria } = require('../temporarias');
const { abrirApp } = require('./app');

const linhas = (arq) => { try { return fs.readFileSync(arq, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };

test('Esc: um nível por vez', async (t) => {
  const log = path.join(pastaTemporaria('orq-claude-falso-'), 'log.jsonl');
  process.env.CLAUDE_FALSO_LOG = log;
  const app = await abrirApp({ config: { mostrarBichinho: false } });
  t.after(() => { delete process.env.CLAUDE_FALSO_LOG; return app.fechar(); });
  await app.esperar('!!window.__orqTeste');
  const interrupcoes = () => linhas(log).filter((o) => o.type === 'control_request' && o.request && o.request.subtype === 'interrupt').length;
  const esc = () => app.tecla('Escape', 'Escape', 27);
  const ocupado = "!document.getElementById('parar').hidden && !document.getElementById('trabalhando').hidden";
  const comecar = async () => {
    await app.avaliar("window.orq.conversa.mandar('orquestrador', 'trabalha até parar')");
    await app.esperar(ocupado, 8000);
    await app.avaliar("document.getElementById('entrada').focus()");
  };
  const focoNaCaixa = () => app.avaliar("document.getElementById('entrada').focus()");

  await t.test('o Parar ensina o atalho: "Parar Esc"', async () => {
    await comecar();
    assert.match(await app.avaliar("document.getElementById('parar').innerText.replace(/\\s+/g, ' ')"), /^Parar Esc$/);
  });

  await t.test('menu aberto e motor ocupado: o Esc fecha só o menu', async () => {
    for (const [botao, menu] of [['botao-modelo', 'menu-modelo'], ['chip-modo', 'menu-modo'], ['chip-uso', 'menu-uso'], ['chip-mais', 'menu-mais']]) {
      if (botao === 'chip-uso') await app.avaliar("window.__orqTeste.desenharInfo({ pasta: '/casa', modelo: 'claude-opus-5-5', esforco: 'high', contexto: 1000, janela: 200000, ocupado: true })");
      await app.avaliar(`document.getElementById('${botao}').click()`);
      await app.esperar(`!document.getElementById('${menu}').hidden`);
      await esc();
      await app.esperar(`document.getElementById('${menu}').hidden`);
      assert.strictEqual(interrupcoes(), 0, `${menu}: o Esc não pode interromper`);
      assert.ok(await app.avaliar(ocupado), `${menu}: o motor continua trabalhando`);
    }
  });

  await t.test('lista de comandos aberta e motor ocupado: o Esc fecha só a lista', async () => {
    await app.avaliar("(() => { const e = document.getElementById('entrada'); e.focus(); e.value = '/'; e.dispatchEvent(new Event('input')); })()");
    await app.esperar("!document.getElementById('sugestoes').hidden");
    await esc();
    await app.esperar("document.getElementById('sugestoes').hidden");
    assert.strictEqual(interrupcoes(), 0);
    assert.strictEqual(await app.avaliar("document.getElementById('entrada').value"), '/', 'o texto da caixa não é apagado');
    await app.avaliar("(() => { const e = document.getElementById('entrada'); e.value = ''; e.dispatchEvent(new Event('input')); })()");
  });

  await t.test('popup, Configurações e paleta abertos e motor ocupado: o Esc fecha só o que está por cima', async () => {
    await app.avaliar("window.__orqTeste.abrirPopupConfig()");
    await app.esperar("!document.getElementById('popup').hidden");
    await esc();
    await app.esperar("document.getElementById('popup').hidden");
    await app.avaliar("document.getElementById('abrir-config').click()");
    await app.esperar("!document.getElementById('config').hidden");
    await esc();
    await app.esperar("document.getElementById('config').hidden");
    await app.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, modifiers: 2 });
    await app.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', windowsVirtualKeyCode: 75, modifiers: 2 });
    await app.esperar("!document.querySelector('.paleta-fundo').hidden");
    await esc();
    await app.esperar("document.querySelector('.paleta-fundo').hidden");
    assert.strictEqual(interrupcoes(), 0);
    assert.ok(await app.avaliar(ocupado));
  });

  await t.test('foco num campo que não é a caixa da conversa, ou fora da aba da conversa: o Esc não interrompe', async () => {
    await app.avaliar("document.getElementById('filtro').focus()");
    await esc();
    // Um botão de uma coluna do lado (ex.: o painel de demandas): o Esc ali não é parada do motor.
    await app.avaliar("document.getElementById('novo-topico').focus()");
    await esc();
    await app.avaliar("document.querySelector('[data-aba=aba-notas]').click()");
    await esc();
    await app.avaliar("document.querySelector('[data-aba=aba-terminal]').click()");
    await app.espera(300);
    await esc();
    await app.avaliar("document.querySelector('[data-aba=aba-orquestrador]').click()");
    await app.espera(200);
    assert.strictEqual(interrupcoes(), 0);
    assert.ok(await app.avaliar(ocupado));
  });

  await t.test('nada aberto, na conversa, motor ocupado: o Esc interrompe e a tela diz o que isso significa', async () => {
    await focoNaCaixa();
    await esc();
    for (let i = 0; i < 50 && interrupcoes() === 0; i++) await app.espera(100);
    assert.strictEqual(interrupcoes(), 1);
    await app.esperar("document.getElementById('trabalhando').hidden", 8000);
    assert.match(await app.avaliar("[...document.querySelectorAll('#mensagens .aviso-conversa')].map((e) => e.innerText).join(' | ')"), /Interrompido por você\. Arquivos já alterados continuam alterados\./);
  });

  await t.test('parado: um Esc não faz nada; com texto na caixa, nem dois; com a caixa vazia, Esc Esc abre o voltar na última mensagem', async () => {
    await focoNaCaixa();
    await esc();
    await app.espera(900);
    assert.ok(await app.avaliar("document.getElementById('corrigindo').hidden"), 'um Esc só não abre nada');
    await app.avaliar("document.getElementById('entrada').value = 'rascunho'");
    await esc(); await esc();
    await app.espera(200);
    assert.ok(await app.avaliar("document.getElementById('corrigindo').hidden"), 'com texto na caixa, o Esc não mexe em nada');
    assert.strictEqual(await app.avaliar("document.getElementById('entrada').value"), 'rascunho', 'e o texto fica');
    await app.avaliar("document.getElementById('entrada').value = ''");
    await esc(); await esc();
    await app.esperar("!document.getElementById('corrigindo').hidden || document.getElementById('entrada').value === 'trabalha até parar'", 8000);
    // "corrigindo" aberto: o Esc seguinte cancela (e não interrompe nada).
    if (await app.avaliar("!document.getElementById('corrigindo').hidden")) { await esc(); await app.esperar("document.getElementById('corrigindo').hidden"); }
    assert.strictEqual(interrupcoes(), 1);
  });

  await t.test('o botão Parar também diz o que a interrupção significa', async () => {
    await comecar();
    await app.avaliar("document.getElementById('parar').click()");
    for (let i = 0; i < 50 && interrupcoes() < 2; i++) await app.espera(100);
    await app.esperar("document.getElementById('trabalhando').hidden", 8000);
    assert.strictEqual(await app.avaliar("[...document.querySelectorAll('#mensagens .aviso-conversa')].filter((e) => /Interrompido por você/.test(e.innerText)).length"), 2);
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
