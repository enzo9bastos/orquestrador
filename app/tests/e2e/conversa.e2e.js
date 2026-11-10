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

  // Pedido de 2026-10-30: a passada que o workflow manda é por trás — não
  // aparece como mensagem do usuário, nem ao vivo nem no histórico.
  await t.test('mensagem de workflow não vira balão do usuário', async () => {
    const antes = (await baloes()).length;
    const msg = '<orq-workflow nome="Passada">\npasse nas frentes\n</orq-workflow>';
    await injetar({ tipo: 'user', local: true, message: { role: 'user', content: msg } });
    await injetar({ tipo: 'user', antigo: true, message: { role: 'user', content: msg } });
    assert.strictEqual((await baloes()).length, antes);
    assert.strictEqual(await app.avaliar("document.querySelectorAll('#mensagens .msg-bastidor').length"), 2);
    assert.match(await app.avaliar("document.querySelector('#mensagens .msg-bastidor summary').textContent"), /Por trás · workflow «Passada»/);
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

  // Regressão 2026-10-30: com linha comprida o bloco rolava para o lado e os
  // botões Copiar/▶ Terminal iam junto, parando em cima do texto.
  await t.test('regressão: botões do bloco de código ficam no canto, sem rolagem lateral', async () => {
    const longa = 'PESSOAS: quem escolhe o tipo de usuário define o campo '.repeat(12);
    await injetar({ tipo: 'assistant', message: { content: [{ type: 'text', text: `Passei o pedido:\n\n\`\`\`\n${longa}\n\`\`\`` }] } });
    const r = await app.avaliar(`(() => { const c = [...document.querySelectorAll('.caixa-codigo')].pop(); const pre = c.querySelector('pre'); const b = c.querySelector('.acoes-codigo').getBoundingClientRect(), p = pre.getBoundingClientRect();
      return { rola: pre.scrollWidth > pre.clientWidth + 1, dist: Math.round(p.right - b.right), dentro: c.querySelector('pre .acoes-codigo') === null }; })()`);
    assert.strictEqual(r.rola, false, 'linha comprida quebra');
    assert.ok(r.dist >= 0 && r.dist <= 12, `botões no canto direito (distância ${r.dist})`);
    assert.ok(r.dentro, 'botões fora do bloco que rola');
    await app.avaliar("navigator.clipboard.writeText = async (t) => { window.__copiado = t; }");
    await app.avaliar("[...document.querySelectorAll('[data-codigo=\"copiar\"]')].pop().click()");
    await app.esperar('!!window.__copiado');
    assert.strictEqual((await app.avaliar('window.__copiado')).trim(), longa.trim(), 'copia o texto inteiro');
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

  // Pedido de 2026-10-30: o app não começa a rodada sozinho; tem o botão Iniciar.
  await t.test('abrir o app não manda o comando da rodada; o botão Iniciar fica ao lado do Desligar', async () => {
    const e = await app.avaliar("window.orq.conversa.abrir('orquestrador')");
    assert.ok(!e.eventos.some((x) => x.tipo === 'user'), 'nada foi mandado ao orquestrador');
    assert.strictEqual(await app.visivel('#iniciar-rodada'), 'ok');
    assert.strictEqual(await app.avaliar("document.getElementById('iniciar-rodada').nextElementSibling.id"), 'desligar');
    await app.avaliar("window.dispatchEvent(new CustomEvent('orq:config', { detail: { tema: 'dark' } }))");
    assert.strictEqual(await app.avaliar("document.getElementById('iniciar-rodada').hidden"), false);
  });

  // Pedido de 2026-11-05: anexar arquivos (não só colar imagem).
  await t.test('anexar: botão 📎 na caixa; arquivo anexado aparece pelo nome e sai no ✕', async () => {
    assert.strictEqual(await app.visivel('#anexar'), 'ok');
    await app.avaliar("window.__orqTeste.anexarCaminho('relatorio.pdf', '/tmp/relatorio.pdf')");
    await app.esperar("!!document.querySelector('#anexos .anexo-arquivo')");
    assert.match(await app.avaliar("document.querySelector('#anexos .anexo-arquivo').textContent"), /relatorio\.pdf/);
    await app.avaliar("document.querySelector('[data-tirar-arquivo]').click()");
    await app.esperar("!document.querySelector('#anexos .anexo-arquivo')");
  });

  await t.test('Desligar pede confirmação no segundo clique', async () => {
    await app.avaliar("document.getElementById('desligar').click()");
    assert.match(await app.avaliar("document.getElementById('desligar').textContent"), /Confirmar/);
  });

  await t.test('nova conversa aparece na lateral e dá para voltar ao orquestrador', async () => {
    await app.avaliar("document.getElementById('nova-conversa').click()");
    await app.esperar("document.querySelectorAll('.item-conversa').length === 2");
    assert.ok(await app.avaliar("document.getElementById('desligar').hidden"), 'Desligar só no orquestrador');
    assert.ok(await app.avaliar("document.getElementById('iniciar-rodada').hidden"), 'Iniciar só no orquestrador');
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

  // Pedido de 2026-11-05: corrigir uma mensagem enviada com erro.
  await t.test('seta para cima traz de volta o que foi enviado', async () => {
    await app.avaliar("document.getElementById('popup').hidden = true");
    await injetar({ tipo: 'user', local: true, message: { role: 'user', content: 'me diz onde t' } });
    assert.ok((await baloes()).includes('me diz onde t'), 'o texto do balão não leva o botão ✎ junto');
    assert.strictEqual(await app.avaliar("!![...document.querySelectorAll('#mensagens .msg-voce[data-texto]')].pop().querySelector('.editar-msg')"), true);
    await app.avaliar("window.__orqTeste.lembrarEnviado('primeira'); window.__orqTeste.lembrarEnviado('segunda'); document.getElementById('entrada').value = ''; document.getElementById('entrada').focus()");
    await app.tecla('ArrowUp', 'ArrowUp', 38);
    await app.esperar("document.getElementById('entrada').value === 'segunda'");
    await app.tecla('ArrowUp', 'ArrowUp', 38);
    await app.esperar("document.getElementById('entrada').value === 'primeira'");
    await app.tecla('ArrowDown', 'ArrowDown', 40);
    await app.esperar("document.getElementById('entrada').value === 'segunda'");
    await app.avaliar("document.getElementById('entrada').value = ''");
    assert.deepStrictEqual(app.erros, []);
  });

  // Pedido de 2026-11-09: horário da mensagem ao lado de "Claude".
  await t.test('horário ao lado de Claude: só a hora se for hoje; data e hora se for outro dia', async () => {
    const autor = () => app.avaliar("[...document.querySelectorAll('#mensagens .msg-claude .autor')].pop().innerText.replace(/\\s+/g, ' ').trim()");
    const hoje = new Date(); hoje.setHours(9, 5, 0, 0);
    await injetar({ tipo: 'resultado' });
    await injetar({ tipo: 'assistant', ts: hoje.getTime(), message: { content: [{ type: 'text', text: 'de hoje' }] } });
    assert.match(await autor(), /Claude 09:05$/);
    await injetar({ tipo: 'resultado' });
    await injetar({ tipo: 'assistant', antigo: true, ts: new Date(2026, 0, 3, 17, 24).getTime(), message: { content: [{ type: 'text', text: 'antiga' }] } });
    assert.match(await autor(), /Claude 03\/01 17:24$/);
    await injetar({ tipo: 'resultado' });
    await injetar({ tipo: 'assistant', antigo: true, message: { content: [{ type: 'text', text: 'sem hora' }] } });
    assert.match(await autor(), /Claude$/, 'sem horário conhecido não inventa um');
    assert.deepStrictEqual(app.erros, []);
  });

  // Pedido de 2026-11-10: múltipla escolha não era visível; marcar e escrever
  // em "Outra resposta" apagava as marcas; prévia (preview) das opções sumia.
  await t.test('múltipla escolha: avisa, mostra caixinhas e junta marcas com "Outra resposta"', async () => {
    const multi = { id: 'pm', ferramenta: 'AskUserQuestion', entrada: { questions: [
      { header: 'Extras', question: 'O que entra junto?', multiSelect: true, options: [{ label: 'Filtros' }, { label: 'Lista na ficha' }, { label: 'Aba extra' }] },
      { header: 'Layout', question: 'Qual layout?', multiSelect: false, options: [{ label: 'A', description: 'em cima', preview: '+------+\n| topo |\n+------+' }, { label: 'B' }] },
    ] } };
    await app.avaliar(`window.__orqTeste.pedidos.set('pm', ${JSON.stringify(multi)}); window.__orqTeste.cartaoPedido(${JSON.stringify(multi)})`);
    const q = (n) => `document.querySelectorAll('[data-pedido="pm"] .pergunta')[${n}]`;
    assert.match(await app.avaliar(`${q(0)}.querySelector('legend').innerText`), /pode marcar mais de uma/i);
    assert.doesNotMatch(await app.avaliar(`${q(1)}.querySelector('legend').innerText`), /mais de uma/i);
    assert.strictEqual(await app.avaliar(`${q(0)}.querySelectorAll('.opcao.multi').length`), 3, 'opções com caixinha');
    assert.match(await app.avaliar(`${q(1)}.querySelector('.previa')?.textContent || ''`), /\| topo \|/, 'a prévia da opção aparece');
    await app.avaliar(`${q(0)}.querySelectorAll('.opcao')[0].click(); ${q(0)}.querySelectorAll('.opcao')[1].click()`);
    await app.avaliar(`(() => { const o = ${q(0)}.querySelector('.outra'); o.value = 'e a aba só leitura'; o.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    assert.strictEqual(await app.avaliar(`${q(0)}.querySelectorAll('.opcao.marcada').length`), 2, 'escrever não apaga as marcas na múltipla escolha');
    assert.strictEqual(await app.avaliar('document.querySelector(\'[data-pedido="pm"]\') !== null'), true, 'marcar na múltipla não envia sozinho');
    assert.deepStrictEqual(app.erros, []);
  });
});
