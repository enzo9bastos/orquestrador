// Área: voltar (o ✎ com arquivos; plano 7.1, protótipo P2 aprovado em 17/11/2026)
// Antes o ✎ voltava só a conversa. Agora o cartão oferece também "Conversa e arquivos" e
// "Só os arquivos", com um ensaio antes (quantos arquivos, quantas linhas, quem foi mexido
// por fora). Voltar arquivos pede um clique de verdade no botão vermelho, e o app guarda a
// cópia de como eles estão agora ANTES de o Claude restaurar.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pastaTemporaria } = require('../temporarias');
const { abrirApp } = require('./app');

const CLAUDE_FALSO = path.join(__dirname, '..', 'unit', 'claude-falso.js');
const linhas = (arq) => { try { return fs.readFileSync(arq, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };

test('voltar a conversa junto com os arquivos', async (t) => {
  const tmp = pastaTemporaria('orq-claude-falso-');
  const log = path.join(tmp, 'log.jsonl');
  const volta = path.join(tmp, 'volta.json');
  const CHAVES = { CLAUDE_FALSO_LOG: log, CLAUDE_FALSO_INIT_NA_SUBIDA: '1', CLAUDE_FALSO_SESSAO_REAL: '1', CLAUDE_FALSO_VOLTA: volta };
  Object.assign(process.env, CHAVES);
  const responder = (o) => { fs.writeFileSync(volta, JSON.stringify(o)); };
  const DOIS = { canRewind: true, filesChanged: ['projeto/botao.css', 'projeto/LEIAME.md'], insertions: 17, deletions: 42, escreve: 'como era antes\n' };
  responder(DOIS);
  const app = await abrirApp({
    config: { iasCaminhos: { claude: CLAUDE_FALSO }, mostrarBichinho: false },
    arquivos: { '.cache/orq-app/conversas-teste.json': JSON.stringify([{ id: 'orquestrador', titulo: 'Orquestrador', sessao: 'S1', orquestrador: true }]) },
  });
  t.after(() => { for (const k of Object.keys(CHAVES)) delete process.env[k]; return app.fechar(); });
  await app.esperar('!!window.__orqTeste');

  // Dois arquivos que o Claude editou depois da mensagem "troca o botão para azul". O LEIAME
  // foi alterado dez minutos depois da escrita do Claude: "mexido por fora".
  const T = Date.parse('2026-11-17T10:00:00.000Z');
  const iso = (ms) => new Date(ms).toISOString();
  const botao = path.join(app.casa, 'projeto', 'botao.css');
  const leiame = path.join(app.casa, 'projeto', 'LEIAME.md');
  const agora = (texto) => {
    fs.mkdirSync(path.dirname(botao), { recursive: true });
    fs.writeFileSync(botao, `botão ${texto}\n`); fs.utimesSync(botao, (T + 5000) / 1000, (T + 5000) / 1000);
    fs.writeFileSync(leiame, `leiame ${texto}\n`); fs.utimesSync(leiame, (T + 600000) / 1000, (T + 600000) / 1000);
  };
  agora('de agora');
  const l = (o) => JSON.stringify(o);
  const projeto = app.casa.replace(/[^A-Za-z0-9]/g, '-');
  fs.mkdirSync(path.join(app.casa, '.claude/projects', projeto), { recursive: true });
  app.escrever(`.claude/projects/${projeto}/S1.jsonl`, [
    l({ type: 'user', uuid: 'u1', timestamp: iso(T - 60000), message: { role: 'user', content: 'primeira pergunta' } }),
    l({ type: 'assistant', uuid: 'a1', timestamp: iso(T - 50000), message: { role: 'assistant', content: [{ type: 'text', text: 'resposta um' }] } }),
    l({ type: 'user', uuid: 'u2', timestamp: iso(T), message: { role: 'user', content: 'troca o botão para azul' } }),
    l({ type: 'assistant', uuid: 'a2', timestamp: iso(T + 1000), message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: botao } }, { type: 'tool_use', id: 't2', name: 'Write', input: { file_path: leiame } }] } }),
    l({ type: 'user', uuid: 'r1', timestamp: iso(T + 4000), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }, { type: 'tool_result', tool_use_id: 't2', content: 'ok' }] } }),
    l({ type: 'assistant', uuid: 'a3', timestamp: iso(T + 6000), message: { role: 'assistant', content: [{ type: 'text', text: 'troquei' }] } }),
    l({ type: 'user', uuid: 'u3', timestamp: iso(T + 700000), message: { role: 'user', content: 'outra coisa' } }),
    l({ type: 'assistant', uuid: 'a4', timestamp: iso(T + 701000), message: { role: 'assistant', content: [{ type: 'text', text: 'resposta três' }] } }),
  ].join('\n') + '\n');
  await app.avaliar("window.orq.conversa.reiniciar('orquestrador')");
  await app.esperar("document.querySelectorAll('#mensagens .msg-voce[data-texto]').length === 3", 8000);

  const baloes = () => app.avaliar("[...document.querySelectorAll('#mensagens .msg-voce[data-texto]')].map((b) => b.dataset.texto)");
  const cartao = "document.querySelector('#mensagens .cartao-volta')";
  // Desde 27/11 o ✎ abre a edição no próprio balão (editar-mensagem.e2e.js); o cartão de voltar,
  // com os três alcances, fica em "Mais jeitos de voltar…" dentro dela.
  const clicarEditar = async (texto) => {
    await app.avaliar(`[...document.querySelectorAll('#mensagens .msg-voce[data-texto]')].find((b) => b.dataset.texto === ${JSON.stringify(texto)}).querySelector('.editar-msg').click()`);
    await app.esperar("!!document.querySelector('#mensagens .editor-msg [data-ed=mais]')", 8000);
    await app.avaliar("document.querySelector('#mensagens .editor-msg [data-ed=mais]').click()");
  };
  const abrir = async (texto = 'troca o botão para azul') => { await clicarEditar(texto); await app.esperar(`!!${cartao} && !${cartao}.querySelector('input[value="tudo"]').disabled`, 8000); };
  const escolher = (q) => app.avaliar(`(() => { const r = ${cartao}.querySelector('input[value="${q}"]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  const botaoDoCartao = () => app.avaliar(`(() => { const b = ${cartao}.querySelector('[data-volta="confirmar"]'); return [b.innerText, b.className]; })()`);
  const clicarDeVerdade = async (seletor) => {
    const r = await app.avaliar(`(() => { const e = ${cartao}.querySelector(${JSON.stringify(seletor)}); e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
    await app.mouse('mousePressed', r.x, r.y); await app.mouse('mouseReleased', r.x, r.y);
  };
  // Os pedidos de voltar arquivos que o Claude falso recebeu: [id da mensagem, é ensaio?].
  const pedidos = () => linhas(log).filter((o) => o.type === 'control_request' && o.request && o.request.subtype === 'rewind_files' && typeof o.request.user_message_id === 'string').map((o) => [o.request.user_message_id, o.request.dry_run === true]);
  const deVerdade = () => pedidos().filter(([, ensaio]) => !ensaio);
  const copias = () => { const d = path.join(app.casa, '.local', 'share', 'orq-app', 'versoes'); try { return fs.readdirSync(d).filter((n) => n.startsWith('rewind-')).sort().map((n) => path.join(d, n)); } catch { return []; } };
  const ler = (p) => fs.readFileSync(p, 'utf8');

  await t.test('o ensaio liga as duas opções com arquivos; "Só a conversa" continua o padrão', async () => {
    await abrir();
    const v = await app.avaliar(`(() => { const c = ${cartao}; return { texto: c.innerText.replace(/\\s+/g, ' '), opcoes: [...c.querySelectorAll('.escopos-volta input')].map((i) => [i.value, i.checked, i.disabled]), painel: getComputedStyle(c.querySelector('.volta-arquivos')).display }; })()`);
    assert.deepStrictEqual(v.opcoes, [['conversa', true, false], ['tudo', false, false], ['arquivos', false, false]]);
    assert.match(v.texto, /Conversa e arquivos Além disso, 2 arquivos voltam ao que eram naquele ponto\./);
    assert.match(v.texto, /Só os arquivos A conversa fica como está; 2 arquivos voltam ao que eram naquele ponto\./);
    // (O painel tinha o atributo hidden mas aparecia: o estilo dele ganhava do atributo. Aqui vale o que a tela mostra.)
    assert.strictEqual(v.painel, 'none', 'com "Só a conversa" o painel dos arquivos não aparece');
    assert.doesNotMatch(v.texto, /arquivos voltam ·|mexido por fora/);
    assert.deepStrictEqual(await botaoDoCartao(), ['Voltar a conversa', 'botao primario']);
    assert.deepStrictEqual(pedidos(), [['u2', true]], 'o ensaio pergunta pela mensagem escolhida, sem mudar nada');
  });

  await t.test('com arquivos: quantos, quantas linhas, quem foi mexido por fora, a cópia e o botão vermelho', async () => {
    await escolher('tudo');
    const p = await app.avaliar(`(() => { const c = ${cartao}.querySelector('.volta-arquivos'); return { escondido: getComputedStyle(c).display === 'none', texto: c.innerText.replace(/\\s+/g, ' '), itens: [...c.querySelectorAll('.itens-acesso li')].map((x) => x.innerText.replace(/\\s+/g, ' ').trim()) }; })()`);
    assert.strictEqual(p.escondido, false);
    assert.match(p.texto, /2 arquivos voltam · \+17 −42 linhas/);
    assert.deepStrictEqual(p.itens, ['projeto/botao.css', 'projeto/LEIAME.md mexido por fora']);
    assert.match(p.texto, /projeto\/LEIAME\.md foi alterado depois da última edição que o Claude fez nele \(por você ou por um comando\)\. Ele volta junto: essa alteração sai do arquivo e fica só na cópia\./);
    assert.match(p.texto, /Antes de voltar, o app guarda os 2 arquivos como estão agora numa pasta nova em ~\/\.local\/share\/orq-app\/versoes\/ \(\d+ B\)\. Não dá para escolher arquivo por arquivo: o Claude volta todos os que mudou\./);
    assert.match(p.texto, /O que os comandos fizeram não volta: arquivo criado por script, banco de dados, commits do git\./);
    assert.deepStrictEqual(await botaoDoCartao(), ['Voltar a conversa e 2 arquivos', 'botao perigo']);
    await escolher('arquivos');
    assert.deepStrictEqual(await botaoDoCartao(), ['Voltar 2 arquivos', 'botao perigo']);
  });

  await t.test('voltar arquivos só com clique de verdade: clique de programa e Enter não fazem nada', async () => {
    await app.avaliar(`${cartao}.querySelector('[data-volta="confirmar"]').click()`);
    await app.avaliar(`${cartao}.focus()`);
    await app.tecla('Enter', 'Enter', 13);
    await app.espera(500);
    assert.deepStrictEqual(deVerdade(), [], 'nenhum pedido de volta de verdade');
    assert.deepStrictEqual([ler(botao), ler(leiame)], ['botão de agora\n', 'leiame de agora\n']);
    assert.deepStrictEqual(copias(), []);
    assert.strictEqual(await app.avaliar(`!!${cartao}`), true, 'o cartão continua aberto');
  });

  await t.test('"Só os arquivos": a cópia de como estavam é guardada antes, os arquivos voltam e a conversa fica', async () => {
    await clicarDeVerdade('[data-volta="confirmar"]');
    await app.esperar(`!${cartao}`, 10000);
    assert.deepStrictEqual(deVerdade(), [['u2', false]]);
    assert.deepStrictEqual([ler(botao), ler(leiame)], ['como era antes\n', 'como era antes\n'], 'o Claude (falso) restaurou os dois');
    const c = copias();
    assert.strictEqual(c.length, 1);
    assert.deepStrictEqual([ler(path.join(c[0], 'projeto', 'botao.css')), ler(path.join(c[0], 'projeto', 'LEIAME.md'))], ['botão de agora\n', 'leiame de agora\n'], 'a cópia tem o conteúdo de antes da volta');
    assert.deepStrictEqual(await baloes(), ['primeira pergunta', 'troca o botão para azul', 'outra coisa'], 'a conversa não muda');
    const aviso = "[...document.querySelectorAll('#mensagens .aviso-conversa')].pop()";
    await app.esperar(`!!${aviso} && /arquivos voltaram/.test(${aviso}.innerText)`, 8000);
    const texto = await app.avaliar(`${aviso}.innerText.replace(/\\s+/g, ' ')`);
    assert.match(texto, /↩ 2 arquivos voltaram ao que eram antes de «troca o botão para azul» \(\+17 −42 linhas\)\. A cópia de como estavam ficou em ~\/\.local\/share\/orq-app\/versoes\/rewind-\d{4}-\d\d-\d\d-\d{6}\. Abrir a pasta/);
    assert.strictEqual(await app.avaliar(`${aviso}.querySelector('[data-abrir-pasta]').dataset.abrirPasta`), c[0]);
  });

  await t.test('sem conseguir guardar a cópia, nada volta e o cartão diz por quê', async () => {
    agora('da segunda vez');
    const versoes = path.join(app.casa, '.local', 'share', 'orq-app', 'versoes');
    fs.chmodSync(versoes, 0o500); // só leitura: a pasta nova da cópia não nasce
    t.after(() => { try { fs.chmodSync(versoes, 0o700); } catch { /* a casa temporária já foi */ } });
    await abrir();
    await escolher('arquivos');
    await clicarDeVerdade('[data-volta="confirmar"]');
    await app.esperar(`/não consegui guardar a cópia dos arquivos antes de voltar/.test(${cartao}.querySelector('.erro-volta').textContent)`, 8000);
    assert.match(await app.avaliar(`${cartao}.querySelector('.erro-volta').textContent`), /nada mudou/);
    assert.strictEqual(deVerdade().length, 1, 'nenhum pedido novo de volta de verdade');
    assert.deepStrictEqual([ler(botao), ler(leiame)], ['botão da segunda vez\n', 'leiame da segunda vez\n']);
    fs.chmodSync(versoes, 0o700);
    await app.avaliar(`${cartao}.querySelector('[data-volta="cancelar"]').click()`);
  });

  await t.test('"Conversa e arquivos": os arquivos voltam (com outra cópia) e a conversa volta junto', async () => {
    await abrir();
    await escolher('tudo');
    await clicarDeVerdade('[data-volta="confirmar"]');
    await app.esperar("document.getElementById('entrada').value === 'troca o botão para azul'", 10000);
    await app.esperar("document.querySelectorAll('#mensagens .msg-voce[data-texto]').length === 1", 8000);
    assert.deepStrictEqual(await baloes(), ['primeira pergunta']);
    assert.deepStrictEqual([ler(botao), ler(leiame)], ['como era antes\n', 'como era antes\n']);
    const c = copias();
    assert.strictEqual(c.length, 2, 'cada volta tem a sua pasta de cópia');
    assert.deepStrictEqual([ler(path.join(c[1], 'projeto', 'botao.css')), ler(path.join(c[0], 'projeto', 'botao.css'))].sort(), ['botão da segunda vez\n', 'botão de agora\n'], 'a cópia de antes não foi tocada');
    assert.strictEqual(deVerdade().length, 2);
    await app.esperar("[...document.querySelectorAll('#mensagens .aviso-conversa')].some((x) => /2 arquivos voltaram/.test(x.innerText))", 8000);
    assert.strictEqual(await app.avaliar(`!!${cartao}`), false);
  });

  await t.test('nenhum arquivo mudou depois da mensagem: as opções ficam desligadas, com o motivo', async () => {
    responder({ canRewind: true, filesChanged: [] });
    await app.avaliar("document.getElementById('entrada').value = ''");
    await clicarEditar('primeira pergunta');
    await app.esperar(`!!${cartao} && !${cartao}.querySelector('.volta-sem-ponto').hidden`, 8000);
    const v = await app.avaliar(`(() => { const c = ${cartao}; return { texto: c.innerText.replace(/\\s+/g, ' '), desligadas: [...c.querySelectorAll('input[value="tudo"], input[value="arquivos"]')].map((i) => i.disabled) }; })()`);
    assert.deepStrictEqual(v.desligadas, [true, true]);
    assert.strictEqual(await app.avaliar(`getComputedStyle(${cartao}.querySelector('.volta-arquivos')).display`), 'none', 'sem arquivos, o painel não aparece (nem vazio)');
    assert.match(v.texto, /Nenhum arquivo mudou depois desta mensagem\./);
    assert.match(v.texto, /O Claude não alterou nenhum arquivo depois desta mensagem\. Só há a conversa para voltar\./);
    await app.avaliar(`${cartao}.querySelector('[data-volta="cancelar"]').click()`);
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
