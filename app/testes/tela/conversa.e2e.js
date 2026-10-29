// Área: conversa
const test = require('node:test');
const assert = require('node:assert');
const { abrirApp } = require('./app');

test('conversa', async (t) => {
  const app = await abrirApp({ config: { comandoInicial: '/rodada', comandoDesligar: '/fim' } });
  t.after(() => app.fechar());
  await app.esperar('!!window.__orqTeste');
  const injetar = (ev) => app.avaliar(`window.__orqTeste.desenharEvento(${JSON.stringify(ev)})`);
  const baloes = () => app.avaliar("[...document.querySelectorAll('#mensagens .msg-voce')].map((b) => b.innerText.trim())");

  // Regressão 2026-10-28: o eco do Claude do comando mandado virava um 2º balão.
  await t.test('regressão: eco do Claude não duplica o balão', async () => {
    await injetar({ tipo: 'user', local: true, message: { role: 'user', content: 'olá mundo' } });
    await injetar({ tipo: 'user', message: { role: 'user', content: 'olá mundo' } });
    assert.deepStrictEqual((await baloes()).filter((b) => b === 'olá mundo'), ['olá mundo']);
  });

  // Pedido de 2026-10-28: o comando que abre a rodada não aparece.
  await t.test('comando inicial escondido da conversa', async () => {
    await injetar({ tipo: 'user', local: true, message: { role: 'user', content: '/rodada' } });
    await injetar({ tipo: 'user', antigo: true, message: { role: 'user', content: '<command-name>/rodada</command-name>' } });
    assert.ok(!(await baloes()).some((b) => b.includes('/rodada')));
  });

  // Regressão 2026-10-28: a classe .resposta do painel lateral pegava o texto
  // do Claude e desenhava uma caixa em volta de tabelas.
  await t.test('regressão: texto do Claude sem caixa em volta', async () => {
    await injetar({ tipo: 'assistant', message: { content: [{ type: 'text', text: '| a | b |\n|---|---|\n| 1 | 2 |' }] } });
    const borda = await app.avaliar("getComputedStyle([...document.querySelectorAll('.texto-claude')].pop()).borderTopWidth");
    assert.strictEqual(borda, '0px');
  });

  await t.test('caminho escrito como código vira clicável', async () => {
    await injetar({ tipo: 'assistant', message: { content: [{ type: 'text', text: 'Está em `~/dev/x/.env` e em `/tmp`; `npm test` não é caminho.' }] } });
    const marcados = await app.avaliar("[...document.querySelectorAll('code.caminho-clicavel')].map((c) => c.textContent)");
    assert.deepStrictEqual(marcados.slice(-2), ['~/dev/x/.env', '/tmp']);
  });

  // Regressão 2026-10-29: não dava para mandar imagem na conversa.
  await t.test('regressão: imagem colada vira anexo e aparece no balão', async () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    await app.avaliar(`(() => { const b = Uint8Array.from(atob('${png}'), (c) => c.charCodeAt(0)); const f = new File([b], 'p.png', { type: 'image/png' });
      const dt = new DataTransfer(); dt.items.add(f); const e = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      document.getElementById('entrada').dispatchEvent(e); })()`);
    await app.esperar("document.querySelectorAll('#anexos .anexo img').length === 1");
    await injetar({ tipo: 'user', local: true, message: { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } }, { type: 'text', text: 'olha isso' }] } });
    assert.ok(await app.avaliar("!!document.querySelector('.balao-imagens img')"));
  });

  await t.test('clicar na print abre o visor, com zoom', async () => {
    await app.avaliar("document.querySelector('.balao-imagens img').click()");
    assert.ok(await app.avaliar('window.orqVisor.estado().aberto'));
    const antes = await app.avaliar('window.orqVisor.estado().escala');
    await app.avaliar("document.querySelector('[data-v=\"mais\"]').click()");
    assert.ok((await app.avaliar('window.orqVisor.estado().escala')) > antes);
    await app.avaliar("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))");
    assert.ok(!(await app.avaliar('window.orqVisor.estado().aberto')));
  });

  await t.test('bloco de código: ▶ Terminal escreve no terminal do app sem executar', async () => {
    await injetar({ tipo: 'assistant', message: { content: [{ type: 'text', text: 'Rode:\n\n```\necho texto-do-bloco\n```' }] } });
    await app.avaliar("[...document.querySelectorAll('[data-codigo=\"terminal\"]')].pop().click()");
    await app.esperar("document.querySelector('[data-aba=aba-terminal]').classList.contains('ativa')");
    await app.esperar("[...document.querySelectorAll('.xterm-rows')].some((r) => r.textContent.includes('echo texto-do-bloco'))", 8000);
    await app.espera(800);
    const linhas = await app.avaliar("[...document.querySelectorAll('.xterm-rows')].map((r) => r.textContent).join('\\n')");
    assert.ok(!/^texto-do-bloco\s*$/m.test(linhas.replace(/echo texto-do-bloco/g, '')), 'não pode ter executado');
    await app.avaliar("document.querySelector('[data-aba=aba-orquestrador]').click()");
  });

  await t.test('saída de comando (/model, /usage) aparece', async () => {
    await injetar({ tipo: 'user', message: { role: 'user', content: '<local-command-stdout>Current model: X</local-command-stdout>' } });
    assert.ok(await app.avaliar("[...document.querySelectorAll('.saida-comando')].some((s) => s.innerText.includes('Current model'))"));
  });

  const pergunta = { id: 'p1', ferramenta: 'AskUserQuestion', entrada: { questions: [{ header: 'Teste', question: 'Qual?', multiSelect: false,
    options: [1, 2, 3, 4].map((n) => ({ label: `Opção ${n}`, description: 'descrição '.repeat(n * 3) })) }, { header: 'Outra', question: 'E esta?', multiSelect: false, options: [{ label: 'Sim' }, { label: 'Não' }] }] } };

  // Regressão 2026-10-29: com 4 opções, 3 ficavam numa linha e 1 sobrava embaixo.
  await t.test('regressão: opções da pergunta uma por linha, mesma largura', async () => {
    await app.avaliar(`window.__orqTeste.pedidos.set('p1', ${JSON.stringify(pergunta)}); window.__orqTeste.cartaoPedido(${JSON.stringify(pergunta)})`);
    const caixas = await app.avaliar("[...document.querySelector('[data-pedido=\"p1\"] .pergunta').querySelectorAll('.opcao')].map((o) => { const b = o.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.width)]; })");
    assert.strictEqual(new Set(caixas.map((c) => c.join())).size, 1, `posições: ${JSON.stringify(caixas)}`);
  });

  // Regressão 2026-10-29: escrever em "Outra resposta" deixava a opção marcada.
  await t.test('regressão: escrever em Outra resposta desmarca a opção', async () => {
    await app.avaliar("document.querySelector('[data-pedido=\"p1\"] .opcao').click()");
    assert.ok(await app.avaliar("!!document.querySelector('[data-pedido=\"p1\"] .opcao.marcada')"));
    await app.avaliar("const o = document.querySelector('[data-pedido=\"p1\"] .outra'); o.focus()");
    await app.texto('quero outra coisa');
    assert.ok(await app.avaliar("!document.querySelector('[data-pedido=\"p1\"] .pergunta .opcao.marcada')"));
  });

  // Regressão 2026-10-29: não dava para responder uma pergunta com print.
  await t.test('regressão: print colada na pergunta aparece no cartão', async () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    await app.avaliar(`(() => { const b = Uint8Array.from(atob('${png}'), (c) => c.charCodeAt(0)); const f = new File([b], 'p.png', { type: 'image/png' });
      const dt = new DataTransfer(); dt.items.add(f);
      document.querySelector('[data-pedido="p1"] .outra').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
    await app.esperar("document.querySelectorAll('[data-pedido=\"p1\"] .anexos-pergunta img').length === 1");
  });

  await t.test('Outra resposta cresce para baixo com texto longo', async () => {
    const antes = await app.avaliar("document.querySelector('[data-pedido=\"p1\"] .outra').offsetHeight");
    await app.texto(' e mais texto '.repeat(30));
    const depois = await app.avaliar("document.querySelector('[data-pedido=\"p1\"] .outra').offsetHeight");
    assert.ok(depois > antes, `${antes} → ${depois}`);
  });

  // Regressão 2026-10-29: mudar o tema com o processo principal antigo (que
  // devolvia só tema e cor) apagava o comando de desligar e sumia o botão.
  await t.test('regressão: botão Desligar continua depois de uma configuração parcial', async () => {
    assert.strictEqual(await app.avaliar("document.getElementById('desligar').hidden"), false);
    await app.avaliar("window.dispatchEvent(new CustomEvent('orq:config', { detail: { tema: 'dark', destaque: '#8b5cf6' } }))");
    assert.strictEqual(await app.avaliar("document.getElementById('desligar').hidden"), false);
  });

  await t.test('ferramenta vira linha recolhida e recebe o resultado', async () => {
    await injetar({ tipo: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls', description: 'Listar a pasta' } }] } });
    await injetar({ tipo: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'a.txt' }] } });
    assert.match(await app.avaliar("[...document.querySelectorAll('.ferramenta')].pop().innerText"), /Rodou\s+Listar a pasta/);
    assert.ok(await app.avaliar("[...document.querySelectorAll('.ferramenta')].pop().classList.contains('feito')"));
  });

  await t.test('pedido de permissão mostra o comando com Permitir e Negar', async () => {
    const p = { id: 'perm-x', ferramenta: 'Bash', entrada: { command: 'git push', description: 'Enviar' } };
    await app.avaliar(`window.__orqTeste.pedidos.set('perm-x', ${JSON.stringify(p)}); window.__orqTeste.cartaoPedido(${JSON.stringify(p)})`);
    assert.match(await app.avaliar("document.querySelector('[data-pedido=\"perm-x\"]').innerText"), /git push/);
    assert.ok(await app.avaliar("!!document.querySelector('[data-pedido=\"perm-x\"] [data-permitir=\"1\"]')"));
  });

  await t.test('Desligar pede confirmação no segundo clique', async () => {
    await app.avaliar("document.getElementById('desligar').click()");
    assert.match(await app.avaliar("document.getElementById('desligar').textContent"), /Confirmar/);
  });

  await t.test('nova conversa aparece na lateral e dá para voltar ao orquestrador', async () => {
    await app.avaliar("document.getElementById('nova-conversa').click()");
    await app.esperar("document.querySelectorAll('.item-conversa').length === 2");
    assert.ok(await app.avaliar("document.getElementById('desligar').hidden"), 'Desligar só no orquestrador');
    await app.avaliar("document.querySelector('[data-conversa=\"orquestrador\"]').click()");
    await app.esperar("!document.getElementById('desligar').hidden");
  });

  await t.test('/config e /permissions abrem popup', async () => {
    await app.avaliar('window.__orqTeste.abrirPopupConfig()');
    assert.ok(await app.avaliar("!document.getElementById('popup').hidden && document.querySelectorAll('[data-config]').length > 20"));
    await app.avaliar("document.getElementById('fechar-popup').click()");
    await app.avaliar('window.__orqTeste.abrirPopupPermissoes()');
    await app.esperar("!document.getElementById('popup').hidden && !!document.getElementById('perm-salvar')");
  });
});
