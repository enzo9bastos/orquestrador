// Área: conversa (P0 da tela: 0.B7 lista única do "/", 0.B8 popups do Claude
// numa conversa Codex, 0.B9 cartão de permissão, 0.B10 links na conversa)
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { abrirApp } = require('./app');

const CLAUDE_FALSO = path.join(__dirname, '..', 'unit', 'claude-falso.js');
const CODEX_FALSO = path.join(__dirname, '..', 'unit', 'codex-falso.js');
const sugestoes = "[...document.querySelectorAll('#sugestoes li')].map((li) => ({ nome: li.querySelector('.nome-comando').textContent.split(' ')[0], bloqueado: li.classList.contains('bloqueado'), texto: li.innerText, selecionada: li.getAttribute('aria-selected') === 'true' }))";
const linhas = (arq) => { try { return fs.readFileSync(arq, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };

async function digitar(app, v) {
  await app.avaliar(`(() => { const e = document.getElementById('entrada'); e.focus(); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input')); })()`);
}

test('0.B7: a lista do "/" vem de uma fonte só e tem TODOS os comandos: nada some, nada cinza', async (t) => {
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'orq-claude-falso-')), 'log.jsonl');
  process.env.CLAUDE_FALSO_LOG = log;
  process.env.CLAUDE_FALSO_COMANDOS = JSON.stringify(['compact', 'agents', 'fast', 'doctor']);
  const app = await abrirApp({ config: { iasCaminhos: { claude: CLAUDE_FALSO } } });
  t.after(() => { delete process.env.CLAUDE_FALSO_COMANDOS; return app.fechar(); });
  await app.esperar('!!window.__orqTeste');
  // O init só vem depois da primeira mensagem.
  await app.avaliar("window.orq.conversa.mandar('orquestrador', 'oi')");
  await app.esperar("[...document.querySelectorAll('#mensagens .texto-claude')].some((e) => e.textContent.trim() === 'ok')", 10000);

  await t.test('os que o 0.B7 tirava ou deixava cinza aparecem, nenhum cinza; com os do app, os do init e a skill /doctor', async () => {
    await digitar(app, '/');
    await app.esperar("!document.getElementById('sugestoes').hidden");
    const l = await app.avaliar(sugestoes);
    const nomes = l.map((x) => x.nome);
    for (const m of ['/status', '/memory', '/hooks', '/help', '/release-notes', '/todos', '/agents', '/fast', '/heapdump', '/workflow-launch-exec'])
      assert.ok(nomes.includes(m), `${m} sumiu da lista`);
    for (const n of ['/restart', '/model', '/effort', '/config', '/permissions', '/compact', '/doctor', '/exit']) assert.ok(nomes.includes(n), `faltou ${n}`);
    assert.ok(!l.some((x) => x.bloqueado), 'algum comando está cinza');
    assert.strictEqual(l.at(-1).nome, '/exit');
    assert.ok(l[0].nome !== '/exit' && l[0].selecionada);
  });

  await t.test('a lista mostra só uns 6 de cada vez (como o terminal); o resto rola, e a seleção pelas setas acompanha', async () => {
    await digitar(app, '/');
    await app.esperar("!document.getElementById('sugestoes').hidden");
    const m = await app.avaliar(`(() => {
      const s = document.getElementById('sugestoes');
      const r = s.getBoundingClientRect();
      const li = [...s.querySelectorAll('li')];
      const vis = li.filter((x) => { const b = x.getBoundingClientRect(); return b.top >= r.top - 1 && b.bottom <= r.bottom + 1; }).length;
      return { total: li.length, vis, rola: s.scrollHeight > s.clientHeight };
    })()`);
    assert.ok(m.total > 20, `lista curta demais para o teste: ${m.total}`);
    assert.ok(m.vis >= 5 && m.vis <= 6, `${m.vis} itens inteiros à vista (o esperado é 5 ou 6)`);
    assert.ok(m.rola, 'a lista não rola');
    for (let i = 0; i < 10; i++) await app.tecla('ArrowDown', 'ArrowDown', 40);
    const sel = await app.avaliar(`(() => {
      const s = document.getElementById('sugestoes'); const r = s.getBoundingClientRect();
      const b = s.querySelector('[aria-selected="true"]').getBoundingClientRect();
      return b.top >= r.top - 1 && b.bottom <= r.bottom + 1;
    })()`);
    assert.ok(sel, 'o item selecionado pelas setas ficou fora da vista');
    await app.tecla('Escape', 'Escape', 27);
  });

  await t.test('"/cos" acha o /usage pelo alias /cost', async () => {
    await digitar(app, '/cos');
    await app.esperar("!document.getElementById('sugestoes').hidden");
    const l = await app.avaliar(sugestoes);
    assert.strictEqual(l[0].nome, '/usage');
    assert.match(l[0].texto, /cost/);
  });

  await t.test('/agents digitado inteiro abre o popup dos subagentes e não vai ao Claude como texto', async () => {
    await digitar(app, '/agents');
    await app.tecla('Escape', 'Escape', 27);
    await app.avaliar("document.getElementById('compositor').requestSubmit()");
    await app.esperar("!!document.querySelector('#popup:not([hidden]) .cmd-popup[data-cmd=\"agents\"]')");
    await app.espera(300);
    const mandados = linhas(log).filter((o) => o.type === 'user').map((o) => JSON.stringify(o.message.content));
    assert.ok(!mandados.some((m) => m.includes('/agents')), 'o /agents foi mandado ao Claude');
    await app.tecla('Escape', 'Escape', 27);
  });

  await t.test('a paleta (Ctrl+K) oferece os mesmos comandos, sem cortar nenhum', async () => {
    await app.avaliar('window.orqPaleta.abrir()');
    const titulos = await app.avaliar("[...document.querySelectorAll('.paleta-lista .paleta-item .titulo')].map((x) => x.textContent)");
    for (const n of ['/compact', '/exit', '/agents', '/fast', '/status', '/usage', '/help']) assert.ok(titulos.includes(n), `${n} fora da paleta`);
    await app.tecla('Escape', 'Escape', 27);
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});

test('0.B8: numa conversa Codex, /config e /permissions abrem a tela do Codex no terminal: nem popup do Claude, nem texto ao Codex', async (t) => {
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'orq-codex-falso-')), 'log.jsonl');
  process.env.CODEX_FALSO_LOG = log;
  const app = await abrirApp({ config: { iaOrquestrador: 'codex', iasCaminhos: { codex: CODEX_FALSO } }, arquivos: { '.claude/settings.json': '{"permissions":{"allow":[]}}' } });
  t.after(() => app.fechar());
  await app.esperar('!!window.__orqTeste');
  await app.esperar("(document.getElementById('entrada').placeholder || '').length > 0");
  // O terminal do app: anota o que seria colado (sem abrir shell no teste).
  await app.avaliar('window.__colado = []; window.orqTerminal = { colar: async (t) => { window.__colado.push(t); return true; } }');
  await app.esperar("window.orq.comandos.estado('orquestrador').then((e) => !!e.sessao)", 8000);

  for (const cmd of ['/config', '/permissions']) {
    await t.test(`${cmd}: o Codex com a conversa vai para o terminal do app, sem popup e sem turn/start`, async () => {
      const antes = await app.avaliar("document.querySelectorAll('#mensagens .aviso-conversa').length");
      await digitar(app, cmd);
      await app.tecla('Escape', 'Escape', 27);
      await app.avaliar("document.getElementById('compositor').requestSubmit()");
      await app.esperar(`document.querySelectorAll('#mensagens .aviso-conversa').length > ${antes}`);
      assert.match(await app.avaliar("[...document.querySelectorAll('#mensagens .aviso-conversa')].pop().innerText"), new RegExp(`terminal do Codex.*${cmd}`, 's'));
      assert.match(await app.avaliar('window.__colado.at(-1)'), /fork/);
      assert.strictEqual(await app.avaliar("document.getElementById('popup').hidden"), true, 'o popup do Claude abriu');
      await app.espera(300);
      const turnos = linhas(log).filter((o) => o.method === 'turn/start').map((o) => JSON.stringify(o.params));
      assert.ok(!turnos.some((p) => p.includes(cmd)), `${cmd} foi mandado ao Codex como texto`);
      await digitar(app, '');
    });
  }

  await t.test('o settings do Claude continua intocado', () => {
    assert.strictEqual(app.ler('.claude/settings.json'), '{"permissions":{"allow":[]}}');
  });

  await t.test('/restart numa conversa Codex fala do Codex, não do Claude', async () => {
    await digitar(app, '/restart');
    await app.tecla('Escape', 'Escape', 27);
    await app.avaliar("document.getElementById('compositor').requestSubmit()");
    await app.esperar("[...document.querySelectorAll('#mensagens .aviso-conversa')].some((e) => /reiniciado/.test(e.textContent))", 8000);
    const t2 = await app.avaliar("[...document.querySelectorAll('#mensagens .aviso-conversa')].map((e) => e.textContent).join('\\n')");
    assert.match(t2, /Codex reiniciado/);
    assert.doesNotMatch(t2, /Claude reiniciado/);
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});

for (const idioma of ['pt-BR', 'en']) {
  test(`0.B9: cartão de permissão diz quem pede e "quer rodar" (${idioma})`, async (t) => {
    const app = await abrirApp({ config: { idioma, iasCaminhos: { claude: CLAUDE_FALSO } } });
    t.after(() => app.fechar());
    await app.esperar('!!window.__orqTeste');
    if (idioma === 'en') await app.esperar("window.orqI18n && window.orqI18n.idioma() === 'en'", 15000);
    const titulo = "document.querySelector('#mensagens .cartao-pedido:not(.respondido) .titulo-pedido').textContent.replace(/\\s+/g, ' ').trim()";
    const pedido = (id) => `window.__orqTeste.cartaoPedido({ id: '${id}', ferramenta: 'Bash', entrada: { command: 'git push origin main', description: 'Envia o branch' } })`;

    await t.test('no orquestrador', async () => {
      await app.avaliar(pedido('p-orq'));
      await app.espera(200);
      const txt = await app.avaliar(titulo);
      assert.match(txt, idioma === 'en' ? /^The Orchestrator wants to run: git push origin main$/ : /^O orquestrador quer rodar: git push origin main$/);
    });

    await t.test('numa conversa avulsa: o nome dela', async () => {
      await app.avaliar("(async () => { const id = await window.orq.conversa.nova(); await window.__orqTeste.trocar(id); })()");
      await app.esperar("/^Conversa(tion)? 2$/.test(document.querySelector('.item-conversa.ativo .titulo-conversa').textContent)");
      await app.avaliar(pedido('p-avulsa'));
      await app.espera(200);
      const txt = await app.avaliar(titulo);
      assert.match(txt, idioma === 'en' ? /^Conversation 2 wants to run: git push origin main$/ : /^Conversa 2 quer rodar: git push origin main$/);
      assert.doesNotMatch(txt, /orquestrador|Orchestrator|Rodou|\bRan\b/);
    });

    await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
  });
}

test('0.B10: links da conversa: Ctrl+clique abre; dica com o host; credenciais e domínio diferente', async (t) => {
  const app = await abrirApp({ config: {} });
  t.after(() => app.fechar());
  await app.esperar('!!window.__orqTeste');
  const md = '[docs](https://docs.exemplo.com.br/guia) · [github.com/ana/projeto](https://github-login.exemplo.net/entrar) · [painel](https://ana:segredo@exemplo.com/) · [livros](https://bücher.example/) · [mail](mailto:ana@exemplo.com) · [README.md](https://exemplo.com/readme)';
  await app.avaliar(`window.__orqTeste.desenharEvento({ tipo: 'assistant', message: { content: [{ type: 'text', text: ${JSON.stringify(md)} }] } })`);
  const link = (txt) => `[...document.querySelectorAll('#mensagens a[href]')].find((a) => a.textContent === ${JSON.stringify(txt)})`;
  const clicar = (txt, ctrl) => app.avaliar(`${link(txt)}.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: ${ctrl} }))`);
  const abertos = () => app.avaliar('[...window.__orqTeste.linksAbertos]');
  const dica = async (txt) => {
    await app.avaliar(`${link(txt)}.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))`);
    return app.avaliar("(() => { const d = document.querySelector('.dica-link'); return d.hidden ? null : d.innerText; })()");
  };

  await t.test('dica ao passar o mouse: "Ctrl+clique para abrir" e o host de verdade (punycode)', async () => {
    assert.match(await dica('docs'), /Ctrl\+clique para abrir\s+docs\.exemplo\.com\.br/);
    assert.match(await dica('livros'), /xn--bcher-kva\.example/);
    assert.match(await dica('painel'), /usuário e senha/);
    assert.match(await dica('mail'), /http e https/);
  });

  await t.test('clique simples não abre; Ctrl+clique abre pelo abrirLink', async () => {
    await clicar('docs', false);
    assert.deepStrictEqual(await abertos(), []);
    await clicar('docs', true);
    await app.esperar('window.__orqTeste.linksAbertos.length === 1');
    assert.deepStrictEqual(await abertos(), ['https://docs.exemplo.com.br/guia']);
  });

  await t.test('link com usuário e senha não abre (nem pelo processo principal)', async () => {
    await clicar('painel', true);
    await app.espera(300);
    assert.strictEqual((await abertos()).length, 1);
    assert.match(await app.avaliar("[...document.querySelectorAll('#mensagens .aviso-conversa.erro')].pop().textContent"), /usuário e senha/);
    assert.strictEqual(await app.avaliar("window.orq.abrirLink('https://ana:segredo@exemplo.com/')"), false);
    assert.strictEqual(await app.avaliar("window.orq.abrirLink('file:///etc/passwd')"), false);
  });

  await t.test('texto que parece outro domínio: confirmação dentro do app, e só abre se confirmar', async () => {
    await clicar('github.com/ana/projeto', true);
    await app.esperar("!document.getElementById('popup').hidden");
    assert.strictEqual(await app.visivel('#popup .confirmar-link'), 'ok');
    const txt = await app.avaliar("document.querySelector('#popup .confirmar-link').innerText");
    assert.match(txt, /github\.com/);
    assert.match(txt, /github-login\.exemplo\.net/);
    assert.strictEqual((await abertos()).length, 1, 'abriu sem confirmar');
    await app.avaliar("document.querySelector('[data-link-cancelar]').click()");
    assert.strictEqual(await app.avaliar("document.getElementById('popup').hidden"), true);
    assert.strictEqual((await abertos()).length, 1, 'cancelar abriu');
    await clicar('github.com/ana/projeto', true);
    await app.esperar("!document.getElementById('popup').hidden");
    await app.avaliar("document.querySelector('[data-link-abrir]').click()");
    await app.esperar('window.__orqTeste.linksAbertos.length === 2');
    assert.strictEqual((await abertos())[1], 'https://github-login.exemplo.net/entrar');
  });

  await t.test('nome de arquivo no texto (README.md) não pede confirmação', async () => {
    await clicar('README.md', true);
    await app.esperar('window.__orqTeste.linksAbertos.length === 3');
    assert.strictEqual(await app.avaliar("document.getElementById('popup').hidden"), true);
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
