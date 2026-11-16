// Área: recarga
// Publicação que muda o processo principal: a tela não recarrega sozinha (ficaria
// falando com o processo antigo); aparece a faixa pedindo o reinício. A decisão
// "recarrega ou pede reinício" está no teste de unidade (recarga.test.js).
const test = require('node:test');
const assert = require('node:assert');
const { abrirApp } = require('./app');

test('recarga: a faixa de reinício aparece, traduz e não some sozinha', async (t) => {
  for (const idioma of ['pt-BR', 'en']) {
    await t.test(idioma, async () => {
      const app = await abrirApp({ config: { idioma } });
      try {
        await app.esperar('!!window.orqAvisoDeReinicio');
        assert.strictEqual(await app.avaliar("typeof window.orq.app.aoPrecisarReiniciar"), 'function', 'a ponte não avisa a tela');
        await app.avaliar('window.orqAvisoDeReinicio(); window.orqAvisoDeReinicio()');
        assert.strictEqual(await app.avaliar("document.querySelectorAll('#faixa-reinicio').length"), 1, 'uma faixa só');
        assert.strictEqual(await app.visivel('#faixa-reinicio-agora'), 'ok');
        await app.espera(300);
        const txt = await app.avaliar("document.getElementById('faixa-reinicio').innerText");
        assert.match(txt, idioma === 'en' ? /Update ready[\s\S]*Restart now[\s\S]*Later/ : /Atualização pronta[\s\S]*Reiniciar agora[\s\S]*Depois/);
        await app.avaliar("document.getElementById('faixa-reinicio-depois').click()");
        assert.strictEqual(await app.avaliar("!!document.getElementById('faixa-reinicio')"), false);
        assert.deepStrictEqual(app.erros, []);
      } finally { await app.fechar(); }
    });
  }
});

// A faixa mora na barra de cima, entre o botão da coluna de agentes e os
// controles da direita. Flutuando por cima, ela cobria o botão de recolher a
// coluna de agentes e, em janela estreita, o tema, as Configurações e a contagem.
test('recarga: a faixa de reinício não cobre nenhum botão da barra de cima, em nenhuma largura', async (t) => {
  const agora = Date.now();
  const frente = (n, estado) => ({ chave: `g/p${n}:%${n}`, emp: 'g', proj: `proj-${n}`, dir: `/x/${n}`, pane: `%${n}`, sessaoTmux: `proj-${n}`, nome: `Agente ${n}`, estado, fonte: 'sinal', desde: agora - 60000, tarefa: `Tarefa ${n}`, git: {}, linhaDoTempo: [] });
  const PRECISA = { lidoEm: agora, semTerminal: 0, frentes: [frente(1, 'trabalhando'), frente(2, 'permissao'), frente(3, 'esperando')],
    fila: [{ tipo: 'permissao', emp: 'g', proj: 'proj-2', id: 'perm-1', ferramenta: 'Bash', entrada: { command: 'git push', description: 'Enviar' }, desde: agora - 5000 }] };
  for (const idioma of ['pt-BR', 'en']) {
    await t.test(idioma, async () => {
      const app = await abrirApp({ config: { idioma, mostrarBichinho: false } });
      try {
        await app.esperar('!!window.orqAvisoDeReinicio && !!window.__orqLateral');
        if (idioma === 'en') await app.esperar("document.documentElement.lang === 'en'", 6000);
        await app.avaliar(`window.__estadoFalso = ${JSON.stringify(PRECISA)}; window.__orqLateral.atualizar()`);
        await app.esperar("document.querySelectorAll('.cartao-agente').length === 3", 6000);
        await app.avaliar('window.orqAvisoDeReinicio()');
        for (const larg of [1920, 1480, 1000, 900]) {
          await app.tamanho(larg, 900);
          await app.espera(300);
          const r = await app.avaliar(`(() => {
            const caixa = (e) => e.getBoundingClientRect();
            const f = caixa(document.getElementById('faixa-reinicio'));
            const cobertos = [...document.querySelectorAll('header.topo button, header.topo .contagem > *, header.topo .marca')]
              .filter((e) => !e.closest('#faixa-reinicio'))
              .filter((e) => { const c = caixa(e); return c.width > 0 && c.left < f.right - 0.5 && c.right > f.left + 0.5 && c.top < f.bottom && c.bottom > f.top; })
              .map((e) => e.id || e.className);
            const agora = caixa(document.getElementById('faixa-reinicio-agora'));
            const depois = caixa(document.getElementById('faixa-reinicio-depois'));
            const topo = caixa(document.querySelector('header.topo'));
            const janela = caixa(document.querySelector('.controles-janela'));
            return { cobertos, faixa: [Math.round(f.left), Math.round(f.right)], agora: [Math.round(agora.left), Math.round(agora.right)], depois: [Math.round(depois.left), Math.round(depois.right)],
              dica: document.querySelector('#faixa-reinicio > span').title, dentro: f.top >= topo.top && f.bottom <= topo.bottom,
              janelaDentro: janela.width === 0 || janela.right <= innerWidth + 0.5, pagina: document.documentElement.scrollWidth, janela: innerWidth };
          })()`);
          assert.deepStrictEqual(r.cobertos, [], `${larg} px: a faixa (${r.faixa}) cobre ${r.cobertos.join(', ')}`);
          assert.ok(r.dentro, `${larg} px: a faixa sai da barra de cima`);
          assert.ok(r.agora[0] >= r.faixa[0] && r.agora[1] <= r.faixa[1], `${larg} px: o "Reiniciar agora" (${r.agora}) não cabe inteiro na faixa (${r.faixa})`);
          assert.strictEqual(await app.visivel('#faixa-reinicio-agora'), 'ok', `${larg} px: o "Reiniciar agora" não está à vista`);
          // Na janela mínima (900 px) com a contagem cheia o texto some e o "Depois" pode ficar cortado; de 1000 px em diante os dois botões cabem inteiros.
          if (larg >= 1000) assert.ok(r.depois[0] >= r.faixa[0] && r.depois[1] <= r.faixa[1], `${larg} px: o "Depois" (${r.depois}) não cabe inteiro na faixa (${r.faixa})`);
          assert.match(r.dica, idioma === 'en' ? /^Update ready/ : /^Atualização pronta/, `${larg} px: o texto encolhido precisa da frase inteira na dica`);
          assert.ok(r.janelaDentro, `${larg} px: os controles da janela saíram da tela`);
          assert.strictEqual(r.pagina, r.janela, `${larg} px: a página ficou mais larga que a janela`);
        }
        assert.deepStrictEqual(app.erros, []);
      } finally { await app.fechar(); }
    });
  }
});
