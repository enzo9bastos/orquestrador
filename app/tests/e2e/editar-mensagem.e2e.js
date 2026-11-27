// Área: voltar (conversa: editar uma mensagem já enviada)
// Pedido de 27/11 (com print do cartão de voltar): "quando eu quero editar, eu quero poder editar o
// que eu escrevi, tirar imagens e arquivos ou adicionar imagens e arquivos, ele não deve aparecer
// assim, ficou confuso e ruim". O ✎ agora abre a edição no próprio balão; ao enviar, a conversa volta
// para antes da mensagem (como antes) e a mensagem nova vai no lugar. O cartão com os três alcances
// continua em "Mais jeitos de voltar…" (voltar.e2e.js, voltar-arquivos.e2e.js).
const test = require('node:test');
const { pastaTemporaria } = require('../temporarias');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { abrirApp } = require('./app');

const CLAUDE_FALSO = path.join(__dirname, '..', 'unit', 'claude-falso.js');
const PNG_A = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const PNG_B = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC';

test('editar uma mensagem no próprio balão: texto, imagens e arquivos', async (t) => {
  const log = path.join(pastaTemporaria('orq-claude-falso-'), 'log.jsonl');
  const CHAVES = { CLAUDE_FALSO_LOG: log, CLAUDE_FALSO_INIT_NA_SUBIDA: '1', CLAUDE_FALSO_SESSAO_REAL: '1', CLAUDE_FALSO_VOLTA: JSON.stringify({ canRewind: false, error: 'No file checkpoint found for this message.' }) };
  Object.assign(process.env, CHAVES);
  const app = await abrirApp({
    config: { iasCaminhos: { claude: CLAUDE_FALSO }, mostrarBichinho: false },
    env: { ORQ_ARQUIVOS_ESCOLHIDOS: JSON.stringify([path.join(pastaTemporaria('orq-escolhidos-'), 'planilha.csv')]) },
    arquivos: { '.cache/orq-app/conversas-teste.json': JSON.stringify([{ id: 'orquestrador', titulo: 'Orquestrador', sessao: 'S1', orquestrador: true }]), 'projeto/relatorio.pdf': '%PDF-1.4', 'projeto/planilha.csv': 'a;b' },
  });
  t.after(() => { for (const k of Object.keys(CHAVES)) delete process.env[k]; return app.fechar(); });
  await app.esperar('!!window.__orqTeste');
  const recebidos = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []).map((l) => JSON.parse(l));
  const subidas = () => recebidos().filter((o) => Array.isArray(o.args)).map((o) => o.args.join(' '));
  const pdf = path.join(app.casa, 'projeto/relatorio.pdf');
  const l = (o) => JSON.stringify(o);
  const projeto = app.casa.replace(/[^A-Za-z0-9]/g, '-');
  fs.mkdirSync(path.join(app.casa, '.claude/projects', projeto), { recursive: true });
  app.escrever(`.claude/projects/${projeto}/S1.jsonl`, [
    l({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'primeira pergunta' } }),
    l({ type: 'assistant', uuid: 'a1', message: { role: 'assistant', content: [{ type: 'text', text: 'resposta um' }] } }),
    l({ type: 'user', uuid: 'u2', message: { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_A } }, { type: 'text', text: `olha esta tela\n\nArquivos anexados (leia do disco):\n- ${pdf}` }] } }),
    l({ type: 'assistant', uuid: 'a2', message: { role: 'assistant', content: [{ type: 'text', text: 'vi a tela' }] } }),
    l({ type: 'user', uuid: 'u3', message: { role: 'user', content: 'outra coisa' } }),
    l({ type: 'assistant', uuid: 'a3', message: { role: 'assistant', content: [{ type: 'text', text: 'resposta três' }] } }),
  ].join('\n') + '\n');
  await app.avaliar("window.orq.conversa.reiniciar('orquestrador')");
  await app.esperar("document.querySelectorAll('#mensagens .msg-voce[data-texto]').length === 3", 8000);
  // O que aparece de verdade na tela (ocupa espaço), não só o atributo hidden.
  const baloes = () => app.avaliar("[...document.querySelectorAll('#mensagens .msg-voce[data-texto]')].filter((b) => b.getClientRects().length > 0).map((b) => b.dataset.texto.split('\\n')[0])");
  const ED = "document.querySelector('#mensagens .editor-msg')";
  const editar = async (inicio) => {
    await app.avaliar(`[...document.querySelectorAll('#mensagens .msg-voce[data-texto]')].find((b) => b.dataset.texto.startsWith(${JSON.stringify(inicio)})).querySelector('.editar-msg').click()`);
    await app.esperar(`!!${ED}`, 8000);
  };
  const editor = () => app.avaliar(`(() => { const e = ${ED}; return { texto: e.querySelector('.editor-texto').value, imagens: [...e.querySelectorAll('.editor-anexos img')].map((i) => i.src.slice(-20)), arquivos: [...e.querySelectorAll('.editor-anexos .anexo-nome')].map((s) => s.textContent), dica: e.querySelector('.editor-dica').textContent, voltarArquivos: !e.querySelector('.editor-voltar-arquivos').hidden, foco: document.activeElement === e.querySelector('.editor-texto') }; })()`);

  await t.test('✎ abre a edição no lugar do balão, com o texto, a imagem e o arquivo daquela mensagem', async () => {
    await editar('olha esta tela');
    const e = await editor();
    assert.deepStrictEqual([e.texto, e.imagens.length, e.arquivos, e.foco], ['olha esta tela', 1, ['relatorio.pdf'], true]);
    assert.match(e.dica, /esta mensagem e a 1 mensagem sua depois dela saem da conversa/);
    assert.strictEqual(e.voltarArquivos, false, 'sem arquivo mudado pelo Claude, nada de arquivos para voltar');
    assert.strictEqual(await app.avaliar("!!document.querySelector('#mensagens .cartao-volta')"), false, 'o cartão de três alcances não aparece');
    assert.deepStrictEqual(await baloes(), ['primeira pergunta', 'outra coisa'], 'o balão original some enquanto edita');
    assert.strictEqual(await app.avaliar("[...document.querySelectorAll('#mensagens .balao-imagens')].filter((b) => b.getClientRects().length > 0).length"), 0, 'a imagem dela também');
  });

  await t.test('Esc cancela: tudo volta como estava, nada vai ao Claude', async () => {
    const antes = recebidos().length;
    await app.avaliar(`${ED}.querySelector('.editor-texto').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await app.esperar(`!${ED}`);
    assert.deepStrictEqual(await baloes(), ['primeira pergunta', 'olha esta tela', 'outra coisa']);
    assert.strictEqual(await app.avaliar("document.querySelectorAll('#mensagens .balao-imagens img').length"), 1);
    assert.strictEqual(recebidos().length, antes);
  });

  await t.test('mensagem vazia (sem texto, imagem nem arquivo) não sai', async () => {
    await editar('olha esta tela');
    await app.avaliar(`(() => { const e = ${ED}; e.querySelector('.editor-texto').value = ''; e.querySelector('[data-ed-tirar-imagem]').click(); })()`);
    await app.avaliar(`${ED}.querySelector('[data-ed-tirar-arquivo]').click()`);
    await app.avaliar(`${ED}.querySelector('[data-ed=enviar]').click()`);
    assert.match(await app.avaliar(`${ED}.querySelector('.editor-erro').textContent`), /A mensagem ficou vazia/);
    await app.avaliar(`${ED}.querySelector('[data-ed=cancelar]').click()`);
    await app.esperar(`!${ED}`);
    assert.deepStrictEqual(await baloes(), ['primeira pergunta', 'olha esta tela', 'outra coisa'], 'cancelar devolve o balão como era (com a imagem e o arquivo)');
  });

  // (Uma edição só: o Claude de mentira não grava o histórico da conversa nova, então uma segunda
  // volta nela não acharia a mensagem; com o Claude de verdade, sim.)
  await t.test('trocar o texto, tirar a imagem e o arquivo, colar outra imagem e anexar outro arquivo pelo 📎; Enter troca a mensagem', async () => {
    await editar('olha esta tela');
    await app.avaliar(`(() => { const e = ${ED}; const ta = e.querySelector('.editor-texto'); ta.value = 'olha esta outra tela'; ta.dispatchEvent(new Event('input', { bubbles: true })); e.querySelector('[data-ed-tirar-imagem]').click(); })()`);
    await app.avaliar(`${ED}.querySelector('[data-ed-tirar-arquivo]').click()`);
    // Colar uma imagem na edição.
    await app.avaliar(`(() => { const b = Uint8Array.from(atob(${JSON.stringify(PNG_B)}), (c) => c.charCodeAt(0)); const dt = new DataTransfer(); dt.items.add(new File([b], 'nova.png', { type: 'image/png' })); ${ED}.querySelector('.editor-texto').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); })()`);
    await app.esperar(`${ED}.querySelectorAll('.editor-anexos img').length === 1`, 5000);
    // O 📎 da edição abre a janela do sistema; nos testes ela devolve o caminho de ORQ_ARQUIVOS_ESCOLHIDOS.
    await app.avaliar(`${ED}.querySelector('[data-ed=anexar]').click()`);
    await app.esperar(`${ED}.querySelectorAll('.editor-anexos .anexo-nome').length === 1`, 5000);
    let e = await editor();
    assert.deepStrictEqual([e.texto, e.arquivos], ['olha esta outra tela', ['planilha.csv']]);
    await app.avaliar(`${ED}.querySelector('.editor-texto').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
    // A conversa volta para antes da mensagem (como o voltar de sempre) e a nova vai no lugar.
    for (let i = 0; i < 80 && !subidas().some((c) => /--resume S1 --resume-session-at a1 --fork-session/.test(c)); i++) await app.espera(100);
    assert.ok(subidas().some((c) => /--resume S1 --resume-session-at a1 --fork-session/.test(c)), `o Claude não reabriu cortado: ${JSON.stringify(subidas())}`);
    let msg = null;
    for (let i = 0; i < 80 && !msg; i++) { msg = recebidos().filter((o) => o.type === 'user' && o.message && Array.isArray(o.message.content)).pop(); if (!msg) await app.espera(100); }
    assert.ok(msg, 'a mensagem nova chegou ao Claude');
    const c = msg.message.content;
    assert.deepStrictEqual(c.filter((b) => b.type === 'image').map((b) => b.source.data), [PNG_B], 'só a imagem colada, sem a antiga');
    const texto = c.filter((b) => b.type === 'text').map((b) => b.text).join('');
    assert.match(texto, /^olha esta outra tela\n\nArquivos anexados \(leia do disco\):\n- .*\/planilha\.csv$/, 'o texto novo e o arquivo novo pelo caminho');
    assert.doesNotMatch(texto, /relatorio\.pdf/, 'o arquivo tirado não vai');
    await app.esperar("[...document.querySelectorAll('#mensagens .msg-voce[data-texto]')].some((b) => b.dataset.texto.startsWith('olha esta outra tela'))", 8000);
    assert.deepStrictEqual(await baloes(), ['primeira pergunta', 'olha esta outra tela'], 'a mensagem antiga e o que veio depois saíram; a nova está no lugar');
    assert.deepStrictEqual(await app.avaliar("[...document.querySelectorAll('#mensagens .msg-voce[data-texto]')].pop().querySelectorAll('.arquivo-msg').length"), 1, 'o cartão do arquivo novo no balão');
    assert.strictEqual(await app.avaliar("document.getElementById('entrada').value"), '', 'a caixa de baixo não foi usada');
    e = null;
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
