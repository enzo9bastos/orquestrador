// Área: conversa (barra da conversa do P1: uso num chip só e faixa de atividade)
// Plano 1.1: a barra tem no máximo 4 chips + ⋯ + "Nova"; os três medidores
// (Contexto, 5 h, 7 dias) moram num chip só, que avisa sozinho acima de 80%;
// a faixa de atividade substitui o "Pensando… Parar".
const test = require('node:test');
const assert = require('node:assert');
const { abrirApp } = require('./app');

test('barra da conversa: uso num chip só e faixa de atividade', async (t) => {
  const app = await abrirApp({ config: { mostrarBichinho: false } });
  t.after(() => app.fechar());
  await app.esperar('!!window.__orqTeste');
  const info = (o) => app.avaliar(`window.__orqTeste.desenharInfo(${JSON.stringify({ pasta: '/casa/projetos/api-pedidos', modelo: 'claude-opus-5-5', esforco: 'high', ...o })})`);
  const texto = (sel) => app.avaliar(`(document.querySelector(${JSON.stringify(sel)}) || {}).innerText || ''`).then((s) => s.replace(/\s+/g, ' ').trim());
  const escondido = (sel) => app.avaliar(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !e || e.hidden || e.offsetParent === null; })()`);

  await t.test('os três medidores viraram um chip só: o anel e o número mostram o contexto', async () => {
    await info({ contexto: 92000, janela: 200000, uso5h: 23, uso7d: 41 });
    assert.strictEqual(await app.avaliar("document.querySelectorAll('.conversa-barra > .medidor').length"), 0, 'nenhum medidor solto na barra');
    assert.strictEqual(await app.visivel('#chip-uso'), 'ok');
    assert.strictEqual(await texto('#chip-uso .valor'), '46%');
    assert.strictEqual(await app.avaliar("getComputedStyle(document.getElementById('anel-uso')).getPropertyValue('--pct').trim()"), '46');
    assert.ok(await escondido('#alerta-uso'), 'abaixo de 80% o chip não avisa nada');
    assert.match(await app.avaliar("document.getElementById('chip-uso').title"), /Contexto 46% · 5 h 23% · 7 dias 41%/);
  });

  await t.test('o clique abre contexto, 5 horas e 7 dias com os números; clicar fora fecha', async () => {
    await app.avaliar("document.getElementById('chip-uso').click()");
    assert.strictEqual(await app.visivel('#menu-uso'), 'ok');
    assert.strictEqual(await app.avaliar("document.getElementById('chip-uso').getAttribute('aria-expanded')"), 'true');
    const linhas = await app.avaliar("[...document.querySelectorAll('#menu-uso .linha-uso')].map((l) => l.innerText.replace(/\\s+/g, ' ').trim())");
    assert.deepStrictEqual(linhas, ['Contexto 46%', '5 h 23%', '7 dias 41%']);
    await app.avaliar("document.getElementById('mensagens').click()");
    assert.ok(await escondido('#menu-uso'));
    assert.strictEqual(await app.avaliar("document.getElementById('chip-uso').getAttribute('aria-expanded')"), 'false');
  });

  await t.test('janela de 5 h ou de 7 dias acima de 80%: o chip avisa com o número, sem abrir', async () => {
    await info({ contexto: 92000, janela: 200000, uso5h: 85, uso7d: 41 });
    assert.strictEqual(await app.visivel('#alerta-uso'), 'ok');
    assert.strictEqual(await texto('#alerta-uso'), '5 h 85%');
    assert.ok(await app.avaliar("document.getElementById('alerta-uso').classList.contains('medio')"));
    await info({ contexto: 92000, janela: 200000, uso5h: 62, uso7d: 97 });
    assert.strictEqual(await texto('#alerta-uso'), '7 dias 97%');
    assert.ok(await app.avaliar("document.getElementById('alerta-uso').classList.contains('alto')"), '95% ou mais fica vermelho');
    // Codex: a janela longa leva o nome que o plano dá a ela.
    await info({ contexto: 1000, janela: 200000, uso5h: 10, uso7d: 90, rotuloLongo: '30 dias' });
    assert.strictEqual(await texto('#alerta-uso'), '30 dias 90%');
  });

  await t.test('sem o contexto ainda, o chip mostra o que há; sem número nenhum, não aparece', async () => {
    await info({ uso5h: 30 });
    assert.strictEqual(await app.visivel('#chip-uso'), 'ok');
    assert.strictEqual(await texto('#chip-uso .valor'), '5 h 30%');
    await info({});
    assert.ok(await escondido('#chip-uso'));
  });

  await t.test('faixa de atividade: trabalhando mostra o estado, o que roda em segundo plano e o Parar', async () => {
    await info({ ocupado: true, fundo: 2 });
    assert.strictEqual(await app.visivel('#trabalhando'), 'ok');
    assert.strictEqual(await texto('#trabalhando-texto'), 'Pensando…');
    assert.strictEqual(await texto('#faixa-fundo'), '2 em segundo plano');
    assert.strictEqual(await app.visivel('#parar'), 'ok');
    // Uma tarefa só: singular igual.
    await info({ ocupado: true, fundo: 1 });
    assert.strictEqual(await texto('#faixa-fundo'), '1 em segundo plano');
    await info({ ocupado: true });
    assert.ok(await escondido('#faixa-fundo'), 'sem nada em segundo plano, o pedaço some');
  });

  await t.test('faixa parada: com algo em segundo plano continua à vista, sem o Parar; sem nada, some', async () => {
    await info({ ocupado: false, fundo: 2 });
    assert.strictEqual(await app.visivel('#trabalhando'), 'ok');
    assert.strictEqual(await texto('#trabalhando-texto'), 'Parado');
    assert.ok(await escondido('#parar'), 'parado não tem o que parar');
    assert.ok(await escondido('#trabalhando .pontinhos'));
    await info({ ocupado: false, fundo: 0 });
    assert.ok(await escondido('#trabalhando'));
  });

  await t.test('o pedaço "em segundo plano" abre a lista de tarefas (/tasks)', async () => {
    await info({ ocupado: false, fundo: 2 });
    await app.avaliar("document.getElementById('faixa-fundo').click()");
    await app.esperar("!document.getElementById('popup').hidden", 8000);
    assert.match(await texto('#popup-titulo'), /segundo plano/i);
    await app.avaliar("document.getElementById('fechar-popup').click()");
    await info({ ocupado: false, fundo: 0 });
  });

  for (const largura of [1480, 1000]) {
    await t.test(`em ${largura} px tudo da barra aparece inteiro`, async () => {
      await app.tamanho(largura, 900);
      await info({ contexto: 92000, janela: 200000, uso5h: 85, uso7d: 41 });
      await app.espera(120);
      for (const sel of ['#botao-modelo', '#chip-modo', '#chip-uso', '#nova-conversa']) assert.strictEqual(await app.visivel(sel), 'ok', `${sel} em ${largura} px`);
      // Apertada, a barra troca nomes por ícones; a dica continua dizendo o modo.
      assert.match(await app.avaliar("document.getElementById('chip-modo').title"), /Modo de permissão: Auto/);
      if (largura === 1000) assert.ok(await app.avaliar("document.querySelector('.conversa-barra').classList.contains('apertada') && document.querySelector('#chip-modo .rotulo-chip').offsetParent === null"), 'em 1000 px o chip de modo fica só com o ícone');
    });
  }

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
