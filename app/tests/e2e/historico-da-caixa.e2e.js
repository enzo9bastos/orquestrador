// Área: conversa (a caixa de mensagem lembra o que a pessoa já escreveu: seta ↑ e busca do Ctrl+R; plano 4.4)
// Antes a seta ↑ só lembrava o que foi mandado desde que o app abriu. Agora ela também traz o
// que a pessoa escreveu nas conversas guardadas da mesma pasta, e o Ctrl+R abre uma busca nesse
// texto (como no terminal). Nada é gravado pelo app: vem das conversas que o Claude já guarda.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { pastaTemporaria } = require('../temporarias');
const { abrirApp } = require('./app');

const lerLog = (arq) => { try { return fs.readFileSync(arq, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const CAIXA = "document.getElementById('entrada').value";
const BUSCA_ABERTA = "(() => { const b = document.getElementById('busca-historico'); return !b.hidden && getComputedStyle(b).display !== 'none'; })()";
const ITENS = "[...document.querySelectorAll('#busca-historico-lista .historico-item')].map((l) => l.innerText.trim())";
// Uma conversa guardada pelo Claude, com as mensagens da pessoa na ordem dada.
function guardar(casa, sessao, cwd, mensagens) {
  const dir = path.join(casa, '.claude', 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${sessao}.jsonl`), `${mensagens.flatMap((m) => [JSON.stringify({ type: 'user', message: { role: 'user', content: m }, cwd }), JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } })]).join('\n')}\n`);
}

for (const idioma of ['pt-BR', 'en']) {
  test(`a caixa lembra o que a pessoa já escreveu: seta ↑ e Ctrl+R (${idioma})`, async (t) => {
    const log = path.join(pastaTemporaria('orq-claude-falso-'), 'log.jsonl');
    process.env.CLAUDE_FALSO_LOG = log;
    const app = await abrirApp({ config: { mostrarBichinho: false, idioma } });
    t.after(() => { delete process.env.CLAUDE_FALSO_LOG; return app.fechar(); });
    await app.esperar('!!window.__orqTeste && !!window.orqHistorico');
    const en = idioma === 'en';
    guardar(app.casa, 'sessao-com-pedidos-0001', app.casa, ['primeiro pedido antigo', 'segundo pedido antigo', 'terceiro pedido antigo']);
    guardar(app.casa, 'sessao-de-outra-pasta-01', '/srv/outra/pasta', ['pedido de outra pasta']);
    const id = await app.avaliar('window.orq.conversa.nova().then((i) => window.__orqTeste.trocar(i).then(() => i))');
    assert.deepStrictEqual(await app.avaliar(`window.orqHistorico.buscar(${JSON.stringify(id)})`), ['terceiro pedido antigo', 'segundo pedido antigo', 'primeiro pedido antigo']);
    const seta = (qual) => app.tecla(qual, qual, qual === 'ArrowUp' ? 38 : 40);
    const ctrlR = async () => {
      await app.cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers: 2, key: 'r', code: 'KeyR', windowsVirtualKeyCode: 82 });
      await app.cdp('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'r', code: 'KeyR', windowsVirtualKeyCode: 82 });
    };
    const mensagens = () => lerLog(log).filter((x) => x.type === 'user').length;

    await t.test('seta ↑ com a caixa vazia traz o que foi escrito antes nesta pasta, da mais nova para trás; seta ↓ volta', async () => {
      await app.avaliar("document.getElementById('entrada').focus()");
      await seta('ArrowUp');
      assert.strictEqual(await app.avaliar(CAIXA), 'terceiro pedido antigo');
      await seta('ArrowUp');
      assert.strictEqual(await app.avaliar(CAIXA), 'segundo pedido antigo');
      await seta('ArrowUp');
      await seta('ArrowUp');
      assert.strictEqual(await app.avaliar(CAIXA), 'primeiro pedido antigo', 'passou do mais antigo');
      await seta('ArrowDown');
      assert.strictEqual(await app.avaliar(CAIXA), 'segundo pedido antigo');
      await seta('ArrowDown');
      await seta('ArrowDown');
      assert.strictEqual(await app.avaliar(CAIXA), '', 'a seta para baixo, no fim, devolve a caixa vazia');
      assert.strictEqual(mensagens(), 0, 'andar pelo que já foi escrito mandou mensagem');
    });

    await t.test('o que foi mandado agora vem primeiro; texto que está sendo escrito não é trocado pela seta', async () => {
      await app.avaliar(`window.orq.conversa.daCaixa(${JSON.stringify(id)}, 'pedido de agora', [], null, {}); window.__orqTeste.lembrarEnviado('pedido de agora')`);
      await app.esperar("[...document.querySelectorAll('#mensagens .msg-voce')].some((m) => /pedido de agora/.test(m.innerText))", 8000);
      await app.esperar("document.getElementById('parar').hidden", 8000);
      await app.avaliar("document.getElementById('entrada').focus()");
      await seta('ArrowUp');
      assert.strictEqual(await app.avaliar(CAIXA), 'pedido de agora');
      await seta('ArrowUp');
      assert.strictEqual(await app.avaliar(CAIXA), 'terceiro pedido antigo');
      await app.avaliar("(() => { const e = document.getElementById('entrada'); e.value = ''; e.dispatchEvent(new Event('input')); e.value = 'estou escrevendo'; e.dispatchEvent(new Event('input')); })()");
      await seta('ArrowUp');
      assert.strictEqual(await app.avaliar(CAIXA), 'estou escrevendo');
      await app.avaliar("(() => { const e = document.getElementById('entrada'); e.value = ''; e.dispatchEvent(new Event('input')); })()");
    });

    await t.test('Ctrl+R abre a busca com o que já foi escrito, do mais novo para o mais antigo; só desta pasta', async () => {
      assert.strictEqual(await app.avaliar("getComputedStyle(document.getElementById('busca-historico')).display"), 'none');
      await app.avaliar("document.getElementById('entrada').focus()");
      await ctrlR();
      await app.esperar(BUSCA_ABERTA, 4000);
      await app.esperar(`(${ITENS}).length === 4`, 8000);
      assert.deepStrictEqual(await app.avaliar(ITENS), ['pedido de agora', 'terceiro pedido antigo', 'segundo pedido antigo', 'primeiro pedido antigo']);
      assert.strictEqual(await app.avaliar("document.getElementById('busca-historico-texto').placeholder"), en ? 'Search what you wrote before…' : 'Buscar no que você já escreveu…');
      assert.ok(await app.avaliar("document.activeElement === document.getElementById('busca-historico-texto')"));
    });

    await t.test('digitar filtra; Enter põe o texto escolhido na caixa, sem enviar', async () => {
      const antes = mensagens();
      await app.avaliar("(() => { const c = document.getElementById('busca-historico-texto'); c.value = 'SEGUNDO'; c.dispatchEvent(new Event('input')); })()");
      assert.deepStrictEqual(await app.avaliar(ITENS), ['segundo pedido antigo']);
      await app.avaliar("(() => { const c = document.getElementById('busca-historico-texto'); c.value = 'nada disso'; c.dispatchEvent(new Event('input')); })()");
      assert.strictEqual(await app.avaliar("document.querySelector('#busca-historico-lista .paleta-vazio').innerText"), en ? 'Nothing found.' : 'Nada encontrado.');
      await app.avaliar("(() => { const c = document.getElementById('busca-historico-texto'); c.value = 'pedido antigo'; c.dispatchEvent(new Event('input')); c.focus(); })()");
      await seta('ArrowDown');
      await app.tecla('Enter', 'Enter', 13);
      await app.esperar(`!(${BUSCA_ABERTA})`, 4000);
      assert.strictEqual(await app.avaliar(CAIXA), 'segundo pedido antigo');
      assert.ok(await app.avaliar("document.activeElement === document.getElementById('entrada')"));
      await new Promise((r) => setTimeout(r, 300));
      assert.strictEqual(mensagens(), antes, 'escolher na busca enviou a mensagem');
      await app.avaliar("(() => { const e = document.getElementById('entrada'); e.value = ''; e.dispatchEvent(new Event('input')); })()");
    });

    await t.test('Esc fecha a busca sem mexer na caixa; a lista de atalhos mostra o Ctrl+R', async () => {
      await app.avaliar("document.getElementById('entrada').focus()");
      await ctrlR();
      await app.esperar(BUSCA_ABERTA, 4000);
      await app.tecla('Escape', 'Escape', 27);
      await app.esperar(`!(${BUSCA_ABERTA})`, 4000);
      assert.strictEqual(await app.avaliar(CAIXA), '');
      await app.avaliar("document.getElementById('abrir-atalhos').click()");
      await app.esperar("!document.getElementById('popup').hidden");
      const linha = await app.avaliar("[...document.querySelectorAll('#popup-corpo .linha-atalho')].map((l) => l.innerText.replace(/\\s+/g, ' ').trim()).find((x) => /Ctrl\\+R$/.test(x))");
      assert.strictEqual(linha, en ? 'Search what you wrote before Ctrl+R' : 'Buscar no que você já escreveu Ctrl+R');
      await app.avaliar("document.getElementById('fechar-popup').click()");
      assert.deepStrictEqual(app.erros, []);
    });
  });
}

// O atalho da busca é dos que a pessoa troca ou desativa (Configurações › Atalhos). Sem um atalho
// do app nessa combinação, o Ctrl+R é o "recarregar a tela" de fábrica; por isso ele não fica fixo.
test('o atalho da busca no que você já escreveu: Configurações › Atalhos troca e desativa', async (t) => {
  const app = await abrirApp({ config: { mostrarBichinho: false } });
  t.after(() => app.fechar());
  await app.esperar('!!window.__orqTeste && !!window.orqHistorico && !!window.orqColunas');
  const VK = { KeyR: 82, KeyJ: 74, KeyP: 80, Escape: 27 };
  const combo = async (code, key, modifiers) => {
    await app.cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers, key, code, windowsVirtualKeyCode: VK[code] });
    await app.cdp('Input.dispatchKeyEvent', { type: 'keyUp', modifiers, key, code, windowsVirtualKeyCode: VK[code] });
  };
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  const texto = (nome) => app.avaliar(`document.querySelector('[data-atalho-mudar="${nome}"]').textContent`);
  const aviso = () => app.avaliar("document.getElementById('atalhos-aviso').innerText.trim()");
  const config = () => JSON.parse(app.ler('.config/orq-app/config.json'));
  const abrirAtalhosDasConfiguracoes = async () => {
    await app.avaliar("document.getElementById('abrir-config').click()");
    await app.avaliar("document.querySelector('[data-secao-config=\"atalhos\"]').click()");
  };
  const naCaixa = async () => { await app.avaliar("document.getElementById('fechar-config').click()"); await app.avaliar("document.getElementById('entrada').focus()"); };
  const fecharBusca = async () => { await app.tecla('Escape', 'Escape', 27); await app.esperar(`!(${BUSCA_ABERTA})`, 4000); };
  const naFolha = async () => {
    await app.avaliar("document.getElementById('abrir-atalhos').click()");
    await app.esperar("!document.getElementById('popup').hidden");
    const linha = await app.avaliar("[...document.querySelectorAll('#popup-corpo .linha-atalho')].map((l) => l.innerText.replace(/\\s+/g, ' ').trim()).find((x) => /^Buscar no que você já escreveu/.test(x))");
    await app.avaliar("document.getElementById('fechar-popup').click()");
    return linha;
  };
  await app.avaliar('window.orq.conversa.nova().then((i) => window.__orqTeste.trocar(i))');

  await t.test('a linha aparece com Ctrl+R; as outras três continuam como estavam; com as Configurações abertas a busca não abre por trás', async () => {
    await abrirAtalhosDasConfiguracoes();
    assert.strictEqual(await app.visivel('[data-atalho-mudar="escritos"]'), 'ok');
    assert.strictEqual(await texto('escritos'), 'Ctrl+R');
    assert.strictEqual(await app.avaliar("document.querySelector('[data-atalho-linha=\"escritos\"] strong').innerText"), 'Buscar no que você já escreveu');
    assert.strictEqual(await app.avaliar("document.querySelector('[data-atalho-padrao=\"escritos\"]').disabled"), true, 'já está no padrão');
    assert.strictEqual(await app.avaliar("document.querySelector('[data-atalho-desligar=\"escritos\"]').disabled"), false);
    assert.deepStrictEqual([await texto('agentes'), await texto('demandas'), await texto('pergunta')], ['Ctrl+Alt+,', 'Ctrl+Alt+.', 'Ctrl+Alt+P']);
    await combo('KeyR', 'r', 2);
    await espera(300);
    assert.strictEqual(await app.avaliar(BUSCA_ABERTA), false);
  });

  await t.test('não repete o atalho de outro da lista nem um do app; combinação nova é gravada e passa a valer no lugar do Ctrl+R', async () => {
    await app.avaliar("document.querySelector('[data-atalho-mudar=\"escritos\"]').click()");
    assert.match(await texto('escritos'), /Aperte as teclas/);
    await combo('KeyP', 'p', 3);
    assert.match(await aviso(), /já é de outro atalho desta lista/);
    await combo('Escape', 'Escape', 0);
    assert.strictEqual(await texto('escritos'), 'Ctrl+R');
    // E os outros não pegam o da busca.
    await app.avaliar("document.querySelector('[data-atalho-mudar=\"pergunta\"]').click()");
    await combo('KeyR', 'r', 2);
    assert.match(await aviso(), /já é de outro atalho desta lista/);
    await combo('Escape', 'Escape', 0);
    assert.strictEqual(await texto('pergunta'), 'Ctrl+Alt+P');
    assert.strictEqual(config().atalhoBuscaEscritos, undefined, 'nada foi gravado');
    await app.avaliar("document.querySelector('[data-atalho-mudar=\"escritos\"]').click()");
    await combo('KeyJ', 'j', 3);
    await app.esperar("document.querySelector('[data-atalho-mudar=\"escritos\"]').textContent === 'Ctrl+Alt+J'");
    await espera(300);
    assert.strictEqual(config().atalhoBuscaEscritos, 'Ctrl+Alt+KeyJ');
    assert.strictEqual(config().atalhoPerguntaRapida, 'Ctrl+Alt+KeyP', 'o atalho da pergunta rápida mudou junto');
    await naCaixa();
    await combo('KeyR', 'r', 2);
    await espera(300);
    assert.strictEqual(await app.avaliar(BUSCA_ABERTA), false, 'o atalho antigo não deveria valer mais');
    await combo('KeyJ', 'j', 3);
    await app.esperar(BUSCA_ABERTA, 4000);
    await fecharBusca();
    assert.strictEqual(await naFolha(), 'Buscar no que você já escreveu Ctrl+Alt+J');
  });

  await t.test('desativar tira o atalho (a seta ↑ continua); Voltar ao padrão religa o Ctrl+R', async () => {
    await abrirAtalhosDasConfiguracoes();
    await app.avaliar("document.querySelector('[data-atalho-desligar=\"escritos\"]').click()");
    await app.esperar("document.querySelector('[data-atalho-mudar=\"escritos\"]').textContent === 'Desligado'");
    await espera(300);
    assert.strictEqual(config().atalhoBuscaEscritos, '');
    await naCaixa();
    await combo('KeyJ', 'j', 3);
    await combo('KeyR', 'r', 2);
    await espera(300);
    assert.strictEqual(await app.avaliar(BUSCA_ABERTA), false, 'desligado não reage');
    assert.strictEqual(await naFolha(), 'Buscar no que você já escreveu desativado');
    await app.avaliar("window.__orqTeste.lembrarEnviado('mandado antes'); document.getElementById('entrada').focus()");
    await app.tecla('ArrowUp', 'ArrowUp', 38);
    assert.strictEqual(await app.avaliar(CAIXA), 'mandado antes');
    await app.avaliar("(() => { const e = document.getElementById('entrada'); e.value = ''; e.dispatchEvent(new Event('input')); })()");
    await abrirAtalhosDasConfiguracoes();
    await app.avaliar("document.querySelector('[data-atalho-padrao=\"escritos\"]').click()");
    await app.esperar("document.querySelector('[data-atalho-mudar=\"escritos\"]').textContent === 'Ctrl+R'");
    await espera(300);
    assert.strictEqual(config().atalhoBuscaEscritos, 'Ctrl+KeyR');
    await naCaixa();
    await combo('KeyR', 'r', 2);
    await app.esperar(BUSCA_ABERTA, 4000);
    await fecharBusca();
    assert.deepStrictEqual(app.erros, []);
  });
});
