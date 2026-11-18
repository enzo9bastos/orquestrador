// Área: conversa (guardar o rascunho com Ctrl+S e escrever a mensagem no editor de texto com Ctrl+G; plano 4.4, H2)
// Como no terminal: o Ctrl+S tira da caixa o que a pessoa está escrevendo e guarda (de novo, com
// a caixa vazia, traz de volta; depois de outro envio, volta sozinho), e o Ctrl+G abre o texto da
// caixa no editor de texto do computador. Os dois atalhos se trocam e se desativam em
// Configurações › Atalhos. Aqui nenhum programa de fora abre: o teste escreve no arquivo, como o
// editor faria.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { pastaTemporaria } = require('../temporarias');
const { abrirApp } = require('./app');

const lerLog = (arq) => { try { return fs.readFileSync(arq, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const CAIXA = "document.getElementById('entrada').value";
const aVista = (id) => `(() => { const e = document.getElementById('${id}'); return !e.hidden && getComputedStyle(e).display !== 'none'; })()`;
const MARCADOR = aVista('rascunho-guardado');
const FAIXA = aVista('editando-fora');
const linha = (id) => `document.getElementById('${id}').innerText.replace(/\\s+/g, ' ').trim()`;
const MODO_SHELL = "document.querySelector('.caixa-entrada').classList.contains('modo-shell')";
const VK = { KeyS: 83, KeyG: 71, KeyJ: 74, KeyR: 82, KeyL: 76, Escape: 27 };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

function ajudantes(app, log) {
  const combo = async (code, key, modifiers) => {
    await app.cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers, key, code, windowsVirtualKeyCode: VK[code] });
    await app.cdp('Input.dispatchKeyEvent', { type: 'keyUp', modifiers, key, code, windowsVirtualKeyCode: VK[code] });
  };
  return {
    combo,
    ctrlS: () => combo('KeyS', 's', 2),
    ctrlG: () => combo('KeyG', 'g', 2),
    // Digitado de verdade (como a pessoa); a caixa é esvaziada antes.
    digitar: async (texto) => {
      await app.avaliar("(() => { const e = document.getElementById('entrada'); e.focus(); e.value = ''; e.setSelectionRange(0, 0); e.dispatchEvent(new Event('input', { bubbles: true })); })()");
      if (texto) await app.texto(texto);
    },
    porCodigo: (texto) => app.avaliar(`(() => { const e = document.getElementById('entrada'); e.focus(); e.value = ${JSON.stringify(texto)}; e.setSelectionRange(e.value.length, e.value.length); e.dispatchEvent(new Event('input', { bubbles: true })); })()`),
    enter: () => app.tecla('Enter', 'Enter', 13),
    aoClaude: () => lerLog(log).filter((o) => o.type === 'user').map((o) => (typeof o.message.content === 'string' ? o.message.content : JSON.stringify(o.message.content))),
    parado: () => app.esperar("document.getElementById('parar').hidden", 10000),
    clicarDeVerdade: async (seletor) => {
      const r = await app.avaliar(`(() => { const b = document.querySelector(${JSON.stringify(seletor)}).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
      await app.mouse('mousePressed', r.x, r.y); await app.mouse('mouseReleased', r.x, r.y);
    },
  };
}

test('rascunho guardado: Ctrl+S guarda o que está na caixa e traz de volta', async (t) => {
  const log = path.join(pastaTemporaria('orq-claude-falso-'), 'log.jsonl');
  process.env.CLAUDE_FALSO_LOG = log;
  const app = await abrirApp({ config: { mostrarBichinho: false, comandoNaCaixa: true } });
  t.after(() => { delete process.env.CLAUDE_FALSO_LOG; return app.fechar(); });
  await app.esperar('!!window.__orqTeste && !!window.orqColunas && !!window.orqEditorDeTexto');
  const { ctrlS, digitar, porCodigo, enter, aoClaude, parado } = ajudantes(app, log);
  await app.avaliar('window.orq.conversa.nova().then((i) => window.__orqTeste.trocar(i))');
  const tem = () => app.avaliar('window.orqConversa.rascunho.tem()');

  await t.test('caixa vazia e nada guardado: nada acontece; com texto, guarda e esvazia; de novo, traz de volta', async () => {
    await digitar('');
    await ctrlS();
    assert.strictEqual(await app.avaliar(CAIXA), '');
    assert.strictEqual(await app.avaliar(MARCADOR), false);
    await digitar('um rascunho comprido');
    await ctrlS();
    assert.strictEqual(await app.avaliar(CAIXA), '');
    assert.strictEqual(await app.avaliar(MARCADOR), true);
    assert.strictEqual(await app.avaliar(linha('rascunho-guardado')), 'Rascunho guardado Ctrl+S traz de volta');
    assert.strictEqual(await tem(), true);
    assert.strictEqual(await app.avaliar('document.activeElement.id'), 'entrada', 'o teclado continua na caixa');
    await ctrlS();
    assert.strictEqual(await app.avaliar(CAIXA), 'um rascunho comprido');
    assert.strictEqual(await app.avaliar(MARCADOR), false);
    assert.strictEqual(await tem(), false);
    assert.deepStrictEqual(aoClaude(), [], 'guardar e trazer de volta não manda nada');
  });

  await t.test('com outro texto na caixa os dois trocam de lugar: nada se perde', async () => {
    await digitar('primeiro');
    await ctrlS();
    await digitar('segundo');
    await ctrlS();
    assert.strictEqual(await app.avaliar(CAIXA), 'primeiro');
    assert.strictEqual(await app.avaliar(MARCADOR), true, 'o "segundo" ficou guardado');
    await ctrlS();
    assert.strictEqual(await app.avaliar(CAIXA), 'segundo');
    assert.strictEqual(await app.avaliar(MARCADOR), true, 'o "primeiro" voltou a ficar guardado');
    await digitar('');
    await ctrlS();
    assert.strictEqual(await app.avaliar(CAIXA), 'primeiro');
    assert.strictEqual(await app.avaliar(MARCADOR), false);
  });

  await t.test('depois de enviar outra mensagem o rascunho volta sozinho; o clique no marcador também traz', async () => {
    await digitar('rascunho que espera');
    await ctrlS();
    await digitar('pergunta do meio');
    await enter();
    await app.esperar("[...document.querySelectorAll('#mensagens .msg-voce')].some((m) => /pergunta do meio/.test(m.innerText))", 8000);
    assert.strictEqual(await app.avaliar(CAIXA), 'rascunho que espera');
    assert.strictEqual(await app.avaliar(MARCADOR), false);
    await parado();
    assert.deepStrictEqual(aoClaude(), ['pergunta do meio'], 'só a pergunta foi enviada; o rascunho não');
    await ctrlS();
    assert.strictEqual(await app.avaliar(CAIXA), '');
    await app.avaliar("document.getElementById('rascunho-guardado').click()");
    assert.strictEqual(await app.avaliar(CAIXA), 'rascunho que espera');
    assert.strictEqual(await app.avaliar(MARCADOR), false);
  });

  await t.test('mensagem que o motor recusa: o rascunho que tinha voltado sozinho é guardado de novo e o texto recusado volta para a caixa', async () => {
    await digitar('rascunho que espera');
    await ctrlS();
    await digitar('vai ser recusada');
    await enter();
    await app.esperar(`${CAIXA} === 'rascunho que espera'`, 8000);
    await app.avaliar("window.__orqTeste.devolverParaACaixa('vai ser recusada')");
    assert.strictEqual(await app.avaliar(CAIXA), 'vai ser recusada');
    assert.strictEqual(await app.avaliar(MARCADOR), true, 'o rascunho voltou a ficar guardado');
    await ctrlS();
    assert.strictEqual(await app.avaliar(CAIXA), 'rascunho que espera');
    // A caixa tem texto que não é o que voltou sozinho: nada é trocado nem pisado.
    await app.avaliar("window.__orqTeste.devolverParaACaixa('outro texto recusado')");
    assert.strictEqual(await app.avaliar(CAIXA), 'rascunho que espera');
    await digitar('');
    await ctrlS();
    assert.strictEqual(await app.avaliar(CAIXA), 'vai ser recusada', 'o que estava guardado continua guardado');
    await digitar('');
    // Caixa vazia e nada guardado: como sempre foi, o texto recusado volta.
    await app.avaliar("window.__orqTeste.devolverParaACaixa('recusada com a caixa vazia')");
    assert.strictEqual(await app.avaliar(CAIXA), 'recusada com a caixa vazia');
    await digitar('');
    await parado();
  });

  await t.test('um "!comando" que a pessoa digitou volta como comando; texto posto por código nunca vira comando', async () => {
    await digitar('!echo guardado');
    assert.strictEqual(await app.avaliar(MODO_SHELL), true);
    await ctrlS();
    assert.strictEqual(await app.avaliar(MODO_SHELL), false);
    await ctrlS();
    assert.strictEqual(await app.avaliar(CAIXA), '!echo guardado');
    assert.strictEqual(await app.avaliar(MODO_SHELL), true);
    // Pelo caminho do "volta sozinho" também.
    await ctrlS();
    const antes = aoClaude().length;
    await digitar('mensagem comum');
    await enter();
    await app.esperar(`${CAIXA} === '!echo guardado'`, 8000);
    assert.strictEqual(await app.avaliar(MODO_SHELL), true);
    await parado();
    assert.strictEqual(aoClaude().length, antes + 1);
    assert.strictEqual(await app.avaliar("document.querySelectorAll('#mensagens .msg-shell').length"), 0, 'trazer de volta não roda nada');
    await porCodigo('!echo por-codigo');
    assert.strictEqual(await app.avaliar(MODO_SHELL), false);
    await ctrlS();
    await ctrlS();
    assert.strictEqual(await app.avaliar(CAIXA), '!echo por-codigo');
    assert.strictEqual(await app.avaliar(MODO_SHELL), false);
    await digitar('');
  });

  await t.test('não age com as Configurações abertas, em outra aba do app nem com o teclado em outro campo', async () => {
    await digitar('fica aqui');
    await app.avaliar("document.getElementById('abrir-config').click()");
    await ctrlS();
    await app.avaliar("document.getElementById('fechar-config').click()");
    assert.strictEqual(await app.avaliar(CAIXA), 'fica aqui');
    assert.strictEqual(await app.avaliar(MARCADOR), false);
    await app.avaliar("document.querySelector('[data-aba=\"aba-notas\"]').click()");
    await ctrlS();
    await app.avaliar("document.querySelector('[data-aba=\"aba-orquestrador\"]').click()");
    assert.strictEqual(await app.avaliar(CAIXA), 'fica aqui');
    assert.strictEqual(await tem(), false);
    await digitar('');
    assert.deepStrictEqual(app.erros, []);
  });
});

test('escrever a mensagem no editor de texto: Ctrl+G', async (t) => {
  const log = path.join(pastaTemporaria('orq-claude-falso-'), 'log.jsonl');
  process.env.CLAUDE_FALSO_LOG = log;
  const app = await abrirApp({ config: { mostrarBichinho: false, comandoNaCaixa: true } });
  t.after(() => { delete process.env.CLAUDE_FALSO_LOG; return app.fechar(); });
  await app.esperar('!!window.__orqTeste && !!window.orqColunas && !!window.orqEditorDeTexto');
  const { ctrlS, ctrlG, digitar, enter, aoClaude, parado, clicarDeVerdade } = ajudantes(app, log);
  await app.avaliar('window.orq.conversa.nova().then((i) => window.__orqTeste.trocar(i))');
  const pasta = path.join(app.casa, '.cache', 'orq-app', 'editor');
  const arquivos = () => { try { return fs.readdirSync(pasta); } catch { return []; } };
  const arquivo = () => path.join(pasta, arquivos()[0]);
  const EDITANDO = 'window.orqEditorDeTexto.editando()';
  const abrirNoEditor = async () => { await ctrlG(); await app.esperar(EDITANDO, 4000); for (let i = 0; i < 100 && arquivos().length !== 1; i++) await espera(30); assert.strictEqual(arquivos().length, 1); };

  await t.test('Ctrl+G põe o texto da caixa num arquivo do app, fechado para os outros; a caixa fica só para leitura, com a faixa', async () => {
    await digitar('começo da mensagem');
    await abrirNoEditor();
    assert.match(arquivos()[0], /^mensagem-[0-9a-f]{12}\.txt$/);
    assert.strictEqual(fs.readFileSync(arquivo(), 'utf8'), 'começo da mensagem');
    assert.strictEqual(fs.statSync(arquivo()).mode & 0o777, 0o600);
    assert.strictEqual(fs.statSync(pasta).mode & 0o777, 0o700);
    assert.strictEqual(await app.avaliar(FAIXA), true);
    assert.strictEqual(await app.avaliar(linha('editando-fora')), 'Escrevendo no editor de texto. O que você salvar lá aparece aqui. Terminar Ctrl+G');
    assert.strictEqual(await app.avaliar("document.getElementById('entrada').readOnly"), true);
    assert.strictEqual(await app.avaliar(CAIXA), 'começo da mensagem');
  });

  await t.test('cada vez que o editor salva, o texto aparece na caixa, sem tirar o teclado de onde está', async () => {
    await app.avaliar("document.getElementById('botao-modelo').focus()");
    fs.writeFileSync(arquivo(), 'começo da mensagem\ncom uma segunda linha\n');
    await app.esperar(`${CAIXA} === 'começo da mensagem\\ncom uma segunda linha'`, 5000);
    assert.strictEqual(await app.avaliar('document.activeElement.id'), 'botao-modelo');
    assert.strictEqual(await app.avaliar(EDITANDO), true);
  });

  await t.test('com a mensagem no editor, o Ctrl+S (guardar o rascunho) espera: a caixa não muda', async () => {
    await app.avaliar("document.getElementById('entrada').focus()");
    await ctrlS();
    assert.strictEqual(await app.avaliar(CAIXA), 'começo da mensagem\ncom uma segunda linha');
    assert.strictEqual(await app.avaliar(MARCADOR), false);
  });

  await t.test('Ctrl+G de novo termina: a caixa volta a aceitar texto com o último texto salvo, e o arquivo some', async () => {
    fs.writeFileSync(arquivo(), 'texto final');
    await ctrlG(); // logo depois de salvar: não depende da próxima espiada no arquivo
    await app.esperar(`!${EDITANDO}`, 4000);
    await app.esperar(`${CAIXA} === 'texto final'`, 4000);
    assert.strictEqual(await app.avaliar("document.getElementById('entrada').readOnly"), false);
    assert.strictEqual(await app.avaliar(FAIXA), false);
    for (let i = 0; i < 100 && arquivos().length; i++) await espera(30);
    assert.deepStrictEqual(arquivos(), []);
    assert.deepStrictEqual(aoClaude(), [], 'abrir, salvar e terminar não manda nada');
    await digitar('');
  });

  await t.test('o botão Terminar faz o mesmo; texto que começa com "!" vindo do editor é texto comum, nunca comando', async () => {
    await digitar('!echo digitado');
    assert.strictEqual(await app.avaliar(MODO_SHELL), true);
    await abrirNoEditor();
    fs.writeFileSync(arquivo(), '!echo veio-do-editor > marca-editor.txt\n');
    await app.esperar(`${CAIXA} === '!echo veio-do-editor > marca-editor.txt'`, 5000);
    assert.strictEqual(await app.avaliar(MODO_SHELL), false);
    await clicarDeVerdade('#editando-fora-terminar');
    await app.esperar(`!${EDITANDO}`, 4000);
    assert.strictEqual(await app.avaliar(MODO_SHELL), false);
    assert.strictEqual(await app.avaliar('document.activeElement.id'), 'entrada');
    await enter();
    await app.esperar("[...document.querySelectorAll('#mensagens .msg-voce')].some((m) => /veio-do-editor/.test(m.innerText))", 8000);
    await parado();
    assert.deepStrictEqual(aoClaude(), ['!echo veio-do-editor > marca-editor.txt'], 'foi ao Claude como texto');
    assert.strictEqual(fs.existsSync(path.join(app.casa, 'marca-editor.txt')), false, 'nenhum comando rodou');
    assert.strictEqual(await app.avaliar("document.querySelectorAll('#mensagens .msg-shell').length"), 0);
  });

  await t.test('enviar com a mensagem ainda no editor manda o que está na caixa, termina a edição e o arquivo some', async () => {
    await digitar('rascunho no editor');
    await abrirNoEditor();
    fs.writeFileSync(arquivo(), 'versão salva no editor\n');
    await app.esperar(`${CAIXA} === 'versão salva no editor'`, 5000);
    await app.avaliar("document.getElementById('entrada').focus()");
    await enter();
    await app.esperar("[...document.querySelectorAll('#mensagens .msg-voce')].some((m) => /versão salva no editor/.test(m.innerText))", 8000);
    await app.esperar(`!${EDITANDO}`, 4000);
    assert.strictEqual(await app.avaliar(CAIXA), '');
    assert.strictEqual(await app.avaliar("document.getElementById('entrada').readOnly"), false);
    for (let i = 0; i < 100 && arquivos().length; i++) await espera(30);
    assert.deepStrictEqual(arquivos(), []);
    await parado();
    assert.strictEqual(aoClaude().pop(), 'versão salva no editor');
  });

  await t.test('uma tecla que não veio da pessoa não abre o editor; com as Configurações abertas também não', async () => {
    await digitar('texto');
    await app.avaliar("document.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true, code: 'KeyG', key: 'g', bubbles: true, cancelable: true }))");
    await espera(300);
    assert.strictEqual(await app.avaliar(EDITANDO), false);
    await app.avaliar("document.getElementById('abrir-config').click()");
    await ctrlG();
    await espera(300);
    await app.avaliar("document.getElementById('fechar-config').click()");
    assert.strictEqual(await app.avaliar(EDITANDO), false);
    assert.deepStrictEqual(arquivos(), []);
    await digitar('');
  });

  await t.test('a tela recarregada no meio continua a edição, com o texto salvo', async () => {
    await digitar('antes de recarregar');
    await abrirNoEditor();
    fs.writeFileSync(arquivo(), 'salvo antes de recarregar\n');
    await app.esperar(`${CAIXA} === 'salvo antes de recarregar'`, 5000);
    await app.avaliar('window.__telaDeAntes = true');
    await app.cdp('Page.reload');
    await app.esperar("!window.__telaDeAntes && document.readyState === 'complete' && !!window.__orqTeste && !!window.orqEditorDeTexto && window.orqEditorDeTexto.editando()", 15000);
    await app.esperar(`${CAIXA} === 'salvo antes de recarregar'`, 5000);
    assert.strictEqual(await app.avaliar(FAIXA), true);
    assert.strictEqual(await app.avaliar("document.getElementById('entrada').readOnly"), true);
    await app.avaliar("document.getElementById('editando-fora-terminar').click()");
    await app.esperar(`!${EDITANDO}`, 4000);
    for (let i = 0; i < 100 && arquivos().length; i++) await espera(30);
    assert.deepStrictEqual(arquivos(), []);
    assert.strictEqual(await app.avaliar(CAIXA), 'salvo antes de recarregar');
    assert.deepStrictEqual(app.erros, []);
  });
});

// Os dois atalhos são dos que a pessoa troca ou desativa (Configurações › Atalhos).
test('os atalhos do rascunho e do editor de texto: Configurações › Atalhos troca e desativa', async (t) => {
  const app = await abrirApp({ config: { mostrarBichinho: false } });
  t.after(() => app.fechar());
  await app.esperar('!!window.__orqTeste && !!window.orqColunas && !!window.orqEditorDeTexto');
  const { combo, ctrlS, ctrlG, digitar } = ajudantes(app, null);
  const texto = (nome) => app.avaliar(`document.querySelector('[data-atalho-mudar="${nome}"]').textContent`);
  const aviso = () => app.avaliar("document.getElementById('atalhos-aviso').innerText.trim()");
  const config = () => JSON.parse(app.ler('.config/orq-app/config.json'));
  const abrirAtalhosDasConfiguracoes = async () => {
    await app.avaliar("document.getElementById('abrir-config').click()");
    await app.avaliar("document.querySelector('[data-secao-config=\"atalhos\"]').click()");
  };
  const naCaixa = async () => { await app.avaliar("document.getElementById('fechar-config').click()"); await app.avaliar("document.getElementById('entrada').focus()"); };
  const naFolha = async (comeco) => {
    await app.avaliar("document.getElementById('abrir-atalhos').click()");
    await app.esperar("!document.getElementById('popup').hidden");
    const l = await app.avaliar(`[...document.querySelectorAll('#popup-corpo .linha-atalho')].map((l) => l.innerText.replace(/\\s+/g, ' ').trim()).find((x) => x.startsWith(${JSON.stringify(comeco)}))`);
    await app.avaliar("document.getElementById('fechar-popup').click()");
    return l;
  };
  const pasta = path.join(app.casa, '.cache', 'orq-app', 'editor');
  const arquivos = () => { try { return fs.readdirSync(pasta); } catch { return []; } };
  const EDITANDO = 'window.orqEditorDeTexto.editando()';
  await app.avaliar('window.orq.conversa.nova().then((i) => window.__orqTeste.trocar(i))');

  await t.test('as duas linhas aparecem com Ctrl+S e Ctrl+G; as outras quatro continuam como estavam', async () => {
    await abrirAtalhosDasConfiguracoes();
    for (const n of ['rascunho', 'editor']) {
      await app.avaliar(`document.querySelector('[data-atalho-mudar="${n}"]').scrollIntoView({ block: 'center' })`);
      assert.strictEqual(await app.visivel(`[data-atalho-mudar="${n}"]`), 'ok');
    }
    assert.deepStrictEqual([await texto('rascunho'), await texto('editor')], ['Ctrl+S', 'Ctrl+G']);
    assert.strictEqual(await app.avaliar("document.querySelector('[data-atalho-linha=\"rascunho\"] strong').innerText"), 'Guardar o rascunho');
    assert.strictEqual(await app.avaliar("document.querySelector('[data-atalho-linha=\"editor\"] strong').innerText"), 'Escrever a mensagem no editor de texto');
    for (const n of ['rascunho', 'editor']) {
      assert.strictEqual(await app.avaliar(`document.querySelector('[data-atalho-padrao="${n}"]').disabled`), true, 'já está no padrão');
      assert.strictEqual(await app.avaliar(`document.querySelector('[data-atalho-desligar="${n}"]').disabled`), false);
    }
    assert.deepStrictEqual([await texto('agentes'), await texto('demandas'), await texto('pergunta'), await texto('escritos')], ['Ctrl+Alt+,', 'Ctrl+Alt+.', 'Ctrl+Alt+P', 'Ctrl+R']);
  });

  await t.test('não repete o atalho de outro da lista; a combinação nova é gravada e passa a valer no lugar da antiga', async () => {
    await app.avaliar("document.querySelector('[data-atalho-mudar=\"rascunho\"]').click()");
    await combo('KeyG', 'g', 2);
    assert.match(await aviso(), /já é de outro atalho desta lista/);
    await combo('KeyR', 'r', 2);
    assert.match(await aviso(), /já é de outro atalho desta lista/);
    await combo('Escape', 'Escape', 0);
    assert.strictEqual(await texto('rascunho'), 'Ctrl+S');
    await app.avaliar("document.querySelector('[data-atalho-mudar=\"escritos\"]').click()");
    await combo('KeyS', 's', 2);
    assert.match(await aviso(), /já é de outro atalho desta lista/);
    await combo('Escape', 'Escape', 0);
    assert.strictEqual(config().atalhoGuardarRascunho, undefined, 'nada foi gravado');
    await app.avaliar("document.querySelector('[data-atalho-mudar=\"rascunho\"]').click()");
    await combo('KeyJ', 'j', 3);
    await app.esperar("document.querySelector('[data-atalho-mudar=\"rascunho\"]').textContent === 'Ctrl+Alt+J'");
    await espera(300);
    assert.strictEqual(config().atalhoGuardarRascunho, 'Ctrl+Alt+KeyJ');
    assert.strictEqual(config().atalhoEditorDeTexto, 'Ctrl+KeyG', 'o atalho do editor mudou junto');
    assert.strictEqual(config().atalhoBuscaEscritos, 'Ctrl+KeyR', 'o atalho da busca mudou junto');
    await naCaixa();
    await digitar('texto do rascunho');
    await ctrlS();
    assert.strictEqual(await app.avaliar(CAIXA), 'texto do rascunho', 'o atalho antigo não deveria valer mais');
    await combo('KeyJ', 'j', 3);
    assert.strictEqual(await app.avaliar(CAIXA), '');
    assert.strictEqual(await app.avaliar(linha('rascunho-guardado')), 'Rascunho guardado Ctrl+Alt+J traz de volta');
    assert.strictEqual(await naFolha('Guardar o rascunho'), 'Guardar o rascunho e trazer de volta Ctrl+Alt+J');
    assert.strictEqual(await naFolha('Escrever a mensagem'), 'Escrever a mensagem no editor de texto Ctrl+G');
  });

  await t.test('desativar tira o atalho (o marcador passa a dizer "clique"); Voltar ao padrão religa', async () => {
    await abrirAtalhosDasConfiguracoes();
    for (const n of ['rascunho', 'editor']) {
      await app.avaliar(`document.querySelector('[data-atalho-desligar="${n}"]').click()`);
      await app.esperar(`document.querySelector('[data-atalho-mudar="${n}"]').textContent === 'Desligado'`);
    }
    await espera(300);
    assert.strictEqual(config().atalhoGuardarRascunho, '');
    assert.strictEqual(config().atalhoEditorDeTexto, '');
    await naCaixa();
    assert.strictEqual(await app.avaliar(linha('rascunho-guardado')), 'Rascunho guardado clique para trazer de volta');
    await combo('KeyJ', 'j', 3);
    await ctrlS();
    assert.strictEqual(await app.avaliar(CAIXA), '', 'desligado não reage');
    await ctrlG();
    await espera(300);
    assert.strictEqual(await app.avaliar(EDITANDO), false, 'desligado não abre o editor');
    assert.deepStrictEqual(arquivos(), []);
    assert.strictEqual(await naFolha('Guardar o rascunho'), 'Guardar o rascunho e trazer de volta desativado');
    assert.strictEqual(await naFolha('Escrever a mensagem'), 'Escrever a mensagem no editor de texto desativado');
    // Sem atalho, o clique no marcador continua trazendo o rascunho.
    await app.avaliar("document.getElementById('rascunho-guardado').click()");
    assert.strictEqual(await app.avaliar(CAIXA), 'texto do rascunho');
    await abrirAtalhosDasConfiguracoes();
    for (const [n, padrao] of [['rascunho', 'Ctrl+S'], ['editor', 'Ctrl+G']]) {
      await app.avaliar(`document.querySelector('[data-atalho-padrao="${n}"]').click()`);
      await app.esperar(`document.querySelector('[data-atalho-mudar="${n}"]').textContent === '${padrao}'`);
    }
    await espera(300);
    assert.strictEqual(config().atalhoGuardarRascunho, 'Ctrl+KeyS');
    assert.strictEqual(config().atalhoEditorDeTexto, 'Ctrl+KeyG');
    await naCaixa();
    await ctrlS();
    assert.strictEqual(await app.avaliar(CAIXA), '');
    assert.strictEqual(await app.avaliar(linha('rascunho-guardado')), 'Rascunho guardado Ctrl+S traz de volta');
    await ctrlS();
    assert.strictEqual(await app.avaliar(CAIXA), 'texto do rascunho');
    await ctrlG();
    await app.esperar(EDITANDO, 4000);
    await ctrlG();
    await app.esperar(`!${EDITANDO}`, 4000);
    assert.deepStrictEqual(app.erros, []);
  });
});

test('rascunho e editor de texto em inglês', async (t) => {
  const app = await abrirApp({ config: { mostrarBichinho: false, idioma: 'en' } });
  t.after(() => app.fechar());
  await app.esperar('!!window.__orqTeste && !!window.orqColunas && !!window.orqEditorDeTexto');
  const { ctrlS, ctrlG, digitar } = ajudantes(app, null);
  await app.avaliar('window.orq.conversa.nova().then((i) => window.__orqTeste.trocar(i))');
  await digitar('a draft');
  await ctrlS();
  await app.esperar(`${linha('rascunho-guardado')} === 'Draft stashed Ctrl+S brings it back'`, 4000);
  assert.strictEqual(await app.avaliar("document.getElementById('rascunho-guardado').title"), 'Bring the draft back to the box');
  await ctrlS();
  await ctrlG();
  await app.esperar('window.orqEditorDeTexto.editando()', 4000);
  await app.esperar(`${linha('editando-fora')} === 'Writing in the text editor. What you save there shows up here. Done Ctrl+G'`, 4000);
  await ctrlG();
  await app.esperar('!window.orqEditorDeTexto.editando()', 4000);
  await app.avaliar("document.getElementById('abrir-config').click()");
  await app.avaliar("document.querySelector('[data-secao-config=\"atalhos\"]').click()");
  await app.esperar("document.querySelector('[data-atalho-linha=\"rascunho\"] strong').innerText === 'Stash the draft'", 4000);
  assert.strictEqual(await app.avaliar("document.querySelector('[data-atalho-linha=\"editor\"] strong').innerText"), 'Write the message in the text editor');
  assert.doesNotMatch(await app.avaliar("document.querySelector('[data-atalho-linha=\"rascunho\"]').innerText + document.querySelector('[data-atalho-linha=\"editor\"]').innerText"), /rascunho|caixa|você|salvar/i);
  assert.deepStrictEqual(app.erros, []);
});
