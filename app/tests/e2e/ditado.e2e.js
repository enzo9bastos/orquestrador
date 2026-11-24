// Área: conversa (ditado: falar em vez de escrever; plano de voz, V2)
// Pedido de 24/11: "ao invés de eu escrever eu falo, ele transcreve em tempo real e aí mando a
// mensagem". O microfone ao lado do enviar (ou o atalho) liga; o texto aparece na caixa enquanto
// a pessoa fala, onde o cursor estava; quem envia é ela. O microfone e o motor de voz são
// programas de mentira (tests/unit/captura-falsa.js e ditado-falso.js): um teste nunca abre o
// microfone de verdade. O que cada ditado "ouve" vem do arquivo de controle do teste.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { pastaTemporaria } = require('../temporarias');
const { abrirApp } = require('./app');

const MOTOR = path.join(__dirname, '..', 'unit', 'ditado-falso.js');
const CAPTURA = path.join(__dirname, '..', 'unit', 'captura-falsa.js');
const lerLog = (arq) => { try { return fs.readFileSync(arq, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const vivo = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
const CAIXA = "document.getElementById('entrada').value";
const ESTADO = 'window.orqDitado.estado().estado';
const aVista = (id) => `(() => { const e = document.getElementById('${id}'); return !e.hidden && getComputedStyle(e).display !== 'none'; })()`;
const linha = (id) => `document.getElementById('${id}').innerText.replace(/\\s+/g, ' ').trim()`;
const AVISOS = "[...document.querySelectorAll('#mensagens .aviso-conversa')].map((e) => e.innerText.replace(/\\s+/g, ' ').trim())";
const CLICAR = "document.getElementById('ditar').click()";

// O app com o microfone e o motor de mentira; o teste diz, antes de cada ditado, o que será "falado".
async function abrir(t, { config = {}, env = {} } = {}) {
  const pasta = pastaTemporaria('orq-ditado-tela-');
  const log = path.join(pasta, 'claude.jsonl');
  const arq = { motor: path.join(pasta, 'motor.json'), mic: path.join(pasta, 'mic.json'), logMic: path.join(pasta, 'mic.log'), logMotor: path.join(pasta, 'motor.log') };
  process.env.CLAUDE_FALSO_LOG = log;
  const app = await abrirApp({
    config: { mostrarBichinho: false, comandoNaCaixa: true, ...config },
    env: {
      ORQ_DITADO_MOTOR: JSON.stringify([process.execPath, MOTOR]), ORQ_DITADO_CAPTURA: JSON.stringify([process.execPath, CAPTURA]),
      DITADO_FALSO_CONTROLE: arq.motor, CAPTURA_FALSA_CONTROLE: arq.mic, CAPTURA_FALSA_LOG: arq.logMic, DITADO_FALSO_LOG: arq.logMotor,
      CAPTURA_FALSA_MS: '60', DITADO_FALSO_CARGA_MS: '400', ...env,
    },
  });
  t.after(() => { delete process.env.CLAUDE_FALSO_LOG; return app.fechar(); });
  await app.esperar('!!window.__orqTeste && !!window.orqColunas && !!window.orqDitado');
  await app.avaliar('window.orq.conversa.nova().then((i) => window.__orqTeste.trocar(i))');
  const combo = async (code, key, modifiers, vk) => {
    await app.cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers, key, code, windowsVirtualKeyCode: vk });
    await app.cdp('Input.dispatchKeyEvent', { type: 'keyUp', modifiers, key, code, windowsVirtualKeyCode: vk });
  };
  const a = {
    app, arq, log,
    falar: (falas, mic = {}) => { fs.writeFileSync(arq.motor, JSON.stringify({ falas })); fs.writeFileSync(arq.mic, JSON.stringify(mic)); },
    controle: (motor, mic = {}) => { fs.writeFileSync(arq.motor, JSON.stringify(motor)); fs.writeFileSync(arq.mic, JSON.stringify(mic)); },
    porNaCaixa: (texto, cursor) => app.avaliar(`(() => { const e = document.getElementById('entrada'); e.focus(); e.value = ${JSON.stringify(texto)}; e.setSelectionRange(${cursor == null ? 'e.value.length' : cursor}, ${cursor == null ? 'e.value.length' : cursor}); e.dispatchEvent(new Event('input', { bubbles: true })); })()`),
    caixa: () => app.avaliar(CAIXA),
    ligar: async () => { await app.avaliar(CLICAR); await app.esperar(`${ESTADO} === 'ouvindo'`, 8000); },
    desligar: async () => { await app.avaliar(`${ESTADO} !== 'parado' && ${CLICAR}`); await app.esperar(`${ESTADO} === 'parado'`, 8000); },
    ctrlShiftD: () => combo('KeyD', 'D', 10, 68),
    ctrlG: () => combo('KeyG', 'g', 2, 71),
    enter: () => app.tecla('Enter', 'Enter', 13),
    esc: () => app.tecla('Escape', 'Escape', 27),
    aoClaude: () => lerLog(log).filter((o) => o.type === 'user').map((o) => (typeof o.message.content === 'string' ? o.message.content : JSON.stringify(o.message.content))),
    interrupcoes: () => lerLog(log).filter((o) => o.type === 'control_request' && o.request && o.request.subtype === 'interrupt').length,
    microfones: () => lerLog(arq.logMic).map((l) => l.pid),
    microfoneSolto: async () => { const pids = lerLog(arq.logMic).map((l) => l.pid); for (let i = 0; i < 150 && pids.some(vivo); i++) await dorme(20); return !pids.some(vivo); },
    parado: () => app.esperar("document.getElementById('parar').hidden", 10000),
  };
  return a;
}

test('ditado: o microfone da caixa escreve o que a pessoa fala, e quem envia é ela', async (t) => {
  const a = await abrir(t);
  const { app } = a;

  await t.test('parado: o microfone fica ao lado do enviar, apagado, e não há faixa nenhuma', async () => {
    assert.deepStrictEqual(await app.avaliar("(() => { const b = document.getElementById('ditar'); const r = b.getBoundingClientRect(); return { pressionado: b.getAttribute('aria-pressed'), titulo: b.title, nome: b.getAttribute('aria-label'), antesDoEnviar: b.nextElementSibling === document.getElementById('enviar'), ligado: b.classList.contains('ligado'), aVista: r.width > 20 && r.height > 20 }; })()"),
      { pressionado: 'false', titulo: 'Ditar: fale e o texto aparece aqui', nome: 'Ditar a mensagem', antesDoEnviar: true, ligado: false, aVista: true });
    assert.strictEqual(await app.avaliar(aVista('ditando')), false);
    assert.strictEqual(await app.avaliar(ESTADO), 'parado');
  });

  await t.test('clicar no microfone: "Preparando" enquanto o modelo carrega, depois "Ouvindo", com o nome do microfone', async () => {
    a.falar(['Bom dia, quero o relatório das vendas.', 'Mande para o time até sexta.']);
    // Na mesma hora do clique (antes de o processo principal responder) a faixa já diz o que acontece.
    assert.strictEqual(await app.avaliar(`(() => { ${CLICAR}; return ${linha('ditando')}; })()`), 'Preparando o ditado. Pode ir falando. Parar Ctrl+Shift+D');
    await app.esperar(`${ESTADO} === 'ouvindo'`, 8000);
    assert.strictEqual(await app.avaliar(linha('ditando')), 'Ouvindo. Fale: o texto aparece na caixa, e você envia quando quiser. Microfone: microfone de teste Parar Ctrl+Shift+D');
    assert.deepStrictEqual(await app.avaliar("(() => { const b = document.getElementById('ditar'); return { pressionado: b.getAttribute('aria-pressed'), titulo: b.title, ligado: b.classList.contains('ligado'), borda: document.getElementById('compositor').classList.contains('ditando-ligado') }; })()"),
      { pressionado: 'true', titulo: 'Parar de ouvir', ligado: true, borda: true });
  });

  await t.test('o texto aparece na caixa palavra por palavra, e cada fala é fechada com a pontuação', async () => {
    const vistos = [];
    for (let i = 0; i < 400; i++) {
      const v = await a.caixa();
      if (v !== vistos[vistos.length - 1]) vistos.push(v);
      if (v === 'Bom dia, quero o relatório das vendas. Mande para o time até sexta.') break;
      await dorme(15);
    }
    assert.strictEqual(vistos[vistos.length - 1], 'Bom dia, quero o relatório das vendas. Mande para o time até sexta.');
    const meio = vistos.filter(Boolean).slice(0, -1);
    assert.ok(meio.length >= 4, `o texto veio aos poucos: ${JSON.stringify(vistos)}`);
    assert.ok(meio.every((v) => 'Bom dia, quero o relatório das vendas. Mande para o time até sexta.'.startsWith(v.replace(/[.…]*$/, ''))), `cada passo é o começo do que foi falado: ${JSON.stringify(meio)}`);
    // O volume do microfone chega ao botão (o anel que cresce com a voz).
    await app.esperar("Number(document.getElementById('ditar').style.getPropertyValue('--nivel')) > 0.3", 4000);
  });

  await t.test('clicar de novo para: a faixa some, o microfone é solto e o texto fica', async () => {
    await a.desligar();
    assert.strictEqual(await app.avaliar(aVista('ditando')), false);
    assert.deepStrictEqual(await app.avaliar("(() => { const b = document.getElementById('ditar'); return [b.getAttribute('aria-pressed'), b.classList.contains('ligado'), b.style.getPropertyValue('--nivel')]; })()"), ['false', false, '']);
    assert.strictEqual(await a.caixa(), 'Bom dia, quero o relatório das vendas. Mande para o time até sexta.');
    assert.ok(await a.microfoneSolto(), 'o programa que lia o microfone saiu');
  });

  // Defeito achado em 24/11: a tela encerrava o ditado pela resposta do pedido de parar, que pode
  // chegar antes dos últimos textos; o fecho da última frase era jogado fora e ficava a prévia.
  await t.test('parar no meio de uma frase: o fecho dela (o texto cuidado) entra na caixa no lugar da prévia', async () => {
    const jaEstava = await a.caixa();
    a.controle({ falas: ['um dois três quatro cinco seis sete oito nove dez onze doze treze quatorze quinze dezesseis.'], fimDoParar: ' (fecho)' });
    await a.ligar();
    await app.esperar(`/ um dois três/.test(${CAIXA})`, 8000);
    await a.desligar();
    const v = await a.caixa();
    assert.match(v.slice(jaEstava.length), /^ um dois três( \S+)* \(fecho\)$/, `ficou a prévia, sem o fecho: ${v}`);
    await a.porNaCaixa(jaEstava);
  });

  await t.test('Enter manda o que está na caixa, como mensagem comum (o ditado nunca envia sozinho)', async () => {
    assert.strictEqual(a.aoClaude().length, 0, 'até aqui nada foi enviado');
    await app.avaliar("document.getElementById('entrada').focus()");
    await a.enter();
    await app.esperar(`${CAIXA} === ''`);
    await a.parado();
    assert.deepStrictEqual(a.aoClaude(), ['Bom dia, quero o relatório das vendas. Mande para o time até sexta.']);
  });

  await t.test('o que já estava na caixa fica: a fala entra onde o cursor estava', async () => {
    a.falar(['Bom dia, quero o relatório das vendas.']);
    await a.porNaCaixa('Olá, equipe. Fim.', 12);
    await a.ligar();
    await app.esperar(`/vendas\\./.test(${CAIXA})`, 8000);
    await a.desligar();
    assert.strictEqual(await a.caixa(), 'Olá, equipe. Bom dia, quero o relatório das vendas. Fim.');
    await a.porNaCaixa('');
  });

  await t.test('digitar no meio do ditado: o que a pessoa escreveu fica, o trecho aberto não volta e a fala seguinte entra depois', async () => {
    a.falar(['um dois três quatro cinco seis sete oito nove dez onze doze treze quatorze quinze dezesseis dezessete dezoito dezenove vinte.', 'Segunda fala aqui.']);
    await a.ligar();
    await app.esperar(`/^um dois/.test(${CAIXA})`, 8000);
    await app.avaliar("document.getElementById('entrada').focus()");
    await app.texto(' XX');
    await app.esperar(`/Segunda fala aqui\\.$/.test(${CAIXA})`, 8000);
    await a.desligar();
    const v = await a.caixa();
    assert.match(v, /^um dois( \S+)* XX Segunda fala aqui\.$/);
    assert.ok(!/vinte/.test(v), `a fala cortada não voltou inteira: ${v}`);
    assert.strictEqual((v.match(/um dois/g) || []).length, 1, 'nada repetido');
    await a.porNaCaixa('');
  });

  await t.test('Enter no meio do ditado: manda o que estava na caixa e o ditado termina (nada chega depois)', async () => {
    a.falar(['um dois três quatro cinco seis sete oito nove dez onze doze treze quatorze quinze dezesseis dezessete dezoito dezenove vinte.']);
    const antes = a.aoClaude().length;
    await a.ligar();
    await app.esperar(`/^um dois três/.test(${CAIXA})`, 8000);
    await app.avaliar("document.getElementById('entrada').focus()");
    await a.enter();
    await app.esperar(`${ESTADO} === 'parado'`, 8000);
    await a.parado();
    const enviados = a.aoClaude();
    assert.strictEqual(enviados.length, antes + 1);
    assert.match(enviados[enviados.length - 1], /^um dois três( \S+)*$/);
    assert.ok(!/vinte/.test(enviados[enviados.length - 1]), 'foi o que estava na caixa na hora do Enter');
    await dorme(500);
    assert.strictEqual(await a.caixa(), '', 'o resto da fala não cai na caixa depois do envio');
    assert.strictEqual(await app.avaliar(aVista('ditando')), false);
    assert.ok(await a.microfoneSolto());
  });

  await t.test('com "Continuar ouvindo depois de enviar": o Enter manda e a fala seguinte já é a mensagem seguinte', async () => {
    await app.avaliar('window.orq.config.gravar({ ditadoContinua: true })');
    a.falar(['um dois três quatro cinco seis sete oito nove dez onze doze treze quatorze quinze dezesseis dezessete dezoito dezenove vinte.', 'Segunda mensagem inteira.']);
    const antes = a.aoClaude().length;
    await a.ligar();
    await app.esperar(`/^um dois três/.test(${CAIXA})`, 8000);
    await app.avaliar("document.getElementById('entrada').focus()");
    await a.enter();
    await app.esperar(`${CAIXA} === 'Segunda mensagem inteira.'`, 8000);
    assert.strictEqual(await app.avaliar(ESTADO), 'ouvindo', 'continua ouvindo');
    assert.strictEqual(a.aoClaude().length, antes + 1, 'só a primeira foi enviada: a segunda espera o Enter da pessoa');
    assert.match(a.aoClaude()[antes], /^um dois três( \S+)*$/);
    await a.desligar();
    await app.avaliar('window.orq.config.gravar({ ditadoContinua: false })');
    await a.parado();
    await a.porNaCaixa('');
  });

  await t.test('"!comando" ditado é texto: não vira comando do computador', async () => {
    a.falar(['!ls -la']);
    const antes = a.aoClaude().length;
    await a.ligar();
    await app.esperar(`${CAIXA} === '!ls -la'`, 8000);
    await a.desligar();
    assert.strictEqual(await app.avaliar("document.querySelector('.caixa-entrada').classList.contains('modo-shell')"), false);
    await app.avaliar("document.getElementById('entrada').focus()");
    await a.enter();
    await app.esperar(`${CAIXA} === ''`);
    await a.parado();
    assert.strictEqual(a.aoClaude()[antes], '!ls -la', 'foi para a conversa como mensagem');
    assert.strictEqual(await app.avaliar("document.querySelectorAll('#mensagens .msg-shell').length"), 0, 'nenhum comando rodou');
  });

  await t.test('sem ligar o "Enviar por voz" (é assim que o app vem), dizer "enviar mensagem" é só texto: nada é enviado', async () => {
    a.falar(['Quero o relatório das vendas. Enviar mensagem.']);
    const antes = a.aoClaude().length;
    await a.ligar();
    assert.strictEqual(await app.avaliar(aVista('ditando-por-voz')), false, 'a faixa não ensina frase nenhuma');
    await app.esperar(`${CAIXA} === 'Quero o relatório das vendas. Enviar mensagem.'`, 8000);
    await dorme(400);
    assert.strictEqual(a.aoClaude().length, antes);
    assert.strictEqual(await app.avaliar(ESTADO), 'ouvindo');
    await a.desligar();
    await a.porNaCaixa('');
  });
});

test('ditado: enviar por voz (a fala que termina com "enviar mensagem" manda a mensagem, sem a frase)', async (t) => {
  const a = await abrir(t, { config: { ditadoEnviarPorVoz: true } });
  const { app } = a;
  // Espera a mensagem de número n chegar ao Claude e devolve o texto dela.
  const enviada = async (n) => { for (let i = 0; i < 200 && a.aoClaude().length <= n; i++) await dorme(40); return a.aoClaude()[n]; };

  await t.test('o corte da frase: só no fim da fala, sem ligar para maiúscula, acento e pontuação', async () => {
    const corta = (texto, frases) => app.avaliar(`window.orqDitado.tirarComando(${JSON.stringify(texto)}, ${JSON.stringify(frases)})`);
    const F = ['enviar mensagem', 'enviar a mensagem'];
    assert.strictEqual(await corta('Quero isso. Enviar mensagem.', F), 'Quero isso.');
    assert.strictEqual(await corta('quero isso, ENVIAR A MENSAGEM!', F), 'quero isso');
    assert.strictEqual(await corta('Enviar mensagem', F), '');
    assert.strictEqual(await corta('Preciso enviar mensagem para o time.', F), null, 'no meio da frase não é comando');
    assert.strictEqual(await corta('Vou reenviar mensagem', F), null, 'outra palavra que termina igual não é comando');
    assert.strictEqual(await corta('mensagem', F), null);
    assert.strictEqual(await corta('Tudo certo por aqui, câmbio.', ['cambio']), 'Tudo certo por aqui');
    assert.strictEqual(await corta('qualquer coisa', []), null);
  });

  await t.test('a fala termina com "enviar mensagem": o resto vai para a conversa, a frase não; o ditado termina', async () => {
    // Uma fala comprida, para a faixa ainda estar à vista quando o teste olha para ela.
    a.falar(['Quero o relatório das vendas de outubro, separado por vendedor e por região, com o total de cada mês e a comparação com o ano passado. Enviar mensagem.']);
    const antes = a.aoClaude().length;
    await a.ligar();
    assert.strictEqual(await app.avaliar(linha('ditando')), 'Ouvindo. Para enviar, diga “enviar mensagem” Microfone: microfone de teste Parar Ctrl+Shift+D');
    assert.strictEqual(await enviada(antes), 'Quero o relatório das vendas de outubro, separado por vendedor e por região, com o total de cada mês e a comparação com o ano passado.');
    await app.esperar(`${ESTADO} === 'parado'`, 8000);
    await a.parado();
    assert.strictEqual(await a.caixa(), '');
    assert.ok(await a.microfoneSolto());
    const baloes = await app.avaliar("[...document.querySelectorAll('#mensagens .msg-voce[data-texto]')].map((m) => m.dataset.texto)");
    assert.ok(baloes.some((x) => /comparação com o ano passado\.$/.test(x)) && baloes.every((x) => !/enviar mensagem/i.test(x)), `o balão mostra a mensagem sem a frase: ${JSON.stringify(baloes)}`);
  });

  await t.test('a frase dita sozinha, depois de uma pausa, manda o que já estava na caixa (ditado e digitado)', async () => {
    a.falar(['Primeira parte do pedido.', 'Enviar a mensagem!']);
    let antes = a.aoClaude().length;
    await a.ligar();
    assert.strictEqual(await enviada(antes), 'Primeira parte do pedido.');
    await app.esperar(`${ESTADO} === 'parado'`, 8000);
    await a.parado();
    a.falar(['enviar mensagem']);
    antes = a.aoClaude().length;
    await a.porNaCaixa('Texto que eu digitei');
    await a.ligar();
    assert.strictEqual(await enviada(antes), 'Texto que eu digitei');
    await app.esperar(`${ESTADO} === 'parado'`, 8000);
    await a.parado();
  });

  await t.test('no meio de uma frase não envia: "preciso enviar mensagem para o time" é texto', async () => {
    a.falar(['Preciso enviar mensagem para o time hoje.']);
    const antes = a.aoClaude().length;
    await a.ligar();
    await app.esperar(`${CAIXA} === 'Preciso enviar mensagem para o time hoje.'`, 8000);
    await dorme(400);
    assert.strictEqual(a.aoClaude().length, antes);
    await a.desligar();
    await a.porNaCaixa('');
  });

  await t.test('"!comando" enviado por voz vai como mensagem: não roda no computador', async () => {
    a.falar(['!ls -la enviar mensagem']);
    const antes = a.aoClaude().length;
    await a.ligar();
    assert.strictEqual(await enviada(antes), '!ls -la');
    await app.esperar(`${ESTADO} === 'parado'`, 8000);
    await a.parado();
    assert.strictEqual(await app.avaliar("document.querySelectorAll('#mensagens .msg-shell').length"), 0, 'nenhum comando rodou');
  });

  await t.test('a frase pode ser outra (Configurações): a escolhida envia, e "enviar mensagem" volta a ser texto', async () => {
    await app.avaliar("window.orq.config.gravar({ ditadoFraseEnviar: 'câmbio' })");
    a.falar(['Tudo certo por aqui, câmbio.']);
    let antes = a.aoClaude().length;
    await a.ligar();
    assert.strictEqual(await app.avaliar("document.getElementById('ditando-frase').textContent"), '“câmbio”');
    assert.strictEqual(await enviada(antes), 'Tudo certo por aqui');
    await app.esperar(`${ESTADO} === 'parado'`, 8000);
    await a.parado();
    a.falar(['Bom dia. Enviar mensagem.']);
    antes = a.aoClaude().length;
    await a.ligar();
    await app.esperar(`${CAIXA} === 'Bom dia. Enviar mensagem.'`, 8000);
    await dorme(400);
    assert.strictEqual(a.aoClaude().length, antes);
    await a.desligar();
    await a.porNaCaixa('');
    await app.avaliar("window.orq.config.gravar({ ditadoFraseEnviar: '' })");
  });

  await t.test('com "Continuar ouvindo depois de enviar": fala, "enviar mensagem", fala, "enviar mensagem", sem tocar no teclado', async () => {
    await app.avaliar('window.orq.config.gravar({ ditadoContinua: true })');
    // A fala logo depois do envio pode ser cortada junto com ele: a segunda mensagem vem repetida para o teste não depender disso.
    a.falar(['Primeira mensagem. Enviar mensagem.', 'Segunda mensagem. Enviar mensagem.', 'Segunda mensagem. Enviar mensagem.']);
    const antes = a.aoClaude().length;
    await a.ligar();
    assert.strictEqual(await enviada(antes), 'Primeira mensagem.');
    assert.strictEqual(await enviada(antes + 1), 'Segunda mensagem.');
    assert.notStrictEqual(await app.avaliar(ESTADO), 'parado', 'continua ouvindo depois de cada envio');
    await a.desligar();
    await app.avaliar('window.orq.config.gravar({ ditadoContinua: false })');
    await a.parado();
    await a.porNaCaixa('');
  });
});

// Correção por trás: o motor de mentira faz de conta que há um modelo maior, e a correção de cada
// trecho chega meio segundo depois do fecho dele (o que cada fecho vira está no arquivo de controle).
test('ditado: correção por trás (um modelo maior refaz cada frase e o texto da caixa é trocado)', async (t) => {
  const a = await abrir(t, { env: { DITADO_FALSO_REVISOR: '1', DITADO_FALSO_REVISAO_MS: '500' } });
  const { app } = a;
  const ERRADA = 'Quero o relatorio das vemdas.';
  const CERTA = 'Quero o relatório das vendas.';
  const DITADO = 'window.orqDitado.estado()';
  const enviada = async (n) => { for (let i = 0; i < 200 && a.aoClaude().length <= n; i++) await dorme(40); return a.aoClaude()[n]; };

  await t.test('o texto sai na hora como o modelo do ditado entendeu; a faixa avisa que está corrigindo; a correção troca o texto', async () => {
    a.controle({ falas: [ERRADA, 'Mande para o time.'], revisoes: { [ERRADA]: CERTA } });
    await a.ligar();
    assert.strictEqual(await app.avaliar(`${DITADO}.revisor`), true);
    await app.esperar(`${CAIXA}.startsWith(${JSON.stringify(ERRADA)})`, 8000);
    assert.strictEqual(await app.avaliar(aVista('ditando-corrigindo')), true);
    assert.strictEqual(await app.avaliar(linha('ditando')), 'Ouvindo. Corrigindo o que você falou… Microfone: microfone de teste Parar Ctrl+Shift+D');
    await app.esperar(`${CAIXA} === ${JSON.stringify(`${CERTA} Mande para o time.`)}`, 8000);
    // O segundo trecho não tinha o que corrigir: quando o aviso dele chega, a faixa para de dizer "corrigindo".
    await app.esperar(`${DITADO}.faltaCorrigir === 0`, 8000);
    assert.strictEqual(await app.avaliar(aVista('ditando-corrigindo')), false);
    assert.strictEqual(await app.avaliar(linha('ditando')), 'Ouvindo. Fale: o texto aparece na caixa, e você envia quando quiser. Microfone: microfone de teste Parar Ctrl+Shift+D', 'corrigido tudo, a faixa volta a ser a de sempre');
    assert.strictEqual(await a.caixa(), `${CERTA} Mande para o time.`);
    await a.desligar();
    await a.porNaCaixa('');
  });

  await t.test('uma correção pode valer por dois trechos (o curto vai junto com o anterior)', async () => {
    a.controle({ falas: ['Primeira parte', 'e a segumda.'], revisoes: { 'e a segumda.': { junto: true, texto: 'Primeira parte, e a segunda.' } } });
    await a.ligar();
    await app.esperar(`${CAIXA} === 'Primeira parte e a segumda.'`, 8000);
    await app.esperar(`${CAIXA} === 'Primeira parte, e a segunda.'`, 8000);
    await app.esperar(`${DITADO}.faltaCorrigir === 0`, 8000);
    await a.desligar();
    await a.porNaCaixa('');
  });

  await t.test('a pessoa mexeu no texto antes de a correção chegar: a correção não entra por cima', async () => {
    a.controle({ falas: [ERRADA], revisoes: { [ERRADA]: CERTA } });
    await a.ligar();
    await app.esperar(`${CAIXA} === ${JSON.stringify(ERRADA)}`, 8000);
    await app.avaliar("document.getElementById('entrada').focus()");
    await app.texto(' XX');
    await dorme(900);
    assert.strictEqual(await a.caixa(), `${ERRADA} XX`);
    assert.strictEqual(await app.avaliar(aVista('ditando-corrigindo')), false, 'não fica esperando uma correção que não vem mais');
    await a.desligar();
    await a.porNaCaixa('');
  });

  await t.test('Enter antes de a correção chegar manda o que está na caixa, e a correção atrasada não cai na caixa vazia', async () => {
    a.controle({ falas: [ERRADA], revisoes: { [ERRADA]: CERTA } });
    const antes = a.aoClaude().length;
    await a.ligar();
    await app.esperar(`${CAIXA} === ${JSON.stringify(ERRADA)}`, 8000);
    await app.avaliar("document.getElementById('entrada').focus()");
    await a.enter();
    assert.strictEqual(await enviada(antes), ERRADA);
    await app.esperar(`${ESTADO} === 'parado'`, 8000);
    await a.parado();
    await dorme(800);
    assert.strictEqual(await a.caixa(), '');
  });

  await t.test('parar espera a correção que falta: o texto fica corrigido', async () => {
    a.controle({ falas: [ERRADA, 'um dois três quatro cinco seis sete oito nove dez onze doze treze quatorze quinze.'], revisoes: { [ERRADA]: CERTA } });
    await a.ligar();
    // Para logo depois do primeiro fecho, com a correção dele ainda a caminho.
    await app.esperar(`${CAIXA}.startsWith(${JSON.stringify(`${ERRADA} um dois`)})`, 8000);
    await app.avaliar(CLICAR);
    await app.esperar(`${ESTADO} === 'parado'`, 8000);
    const v = await a.caixa();
    assert.ok(v.startsWith(CERTA), `o primeiro trecho saiu corrigido: ${v}`);
    await a.porNaCaixa('');
  });

  await t.test('enviar por voz espera a correção: a mensagem vai corrigida e sem a frase', async () => {
    await app.avaliar('window.orq.config.gravar({ ditadoEnviarPorVoz: true })');
    a.controle({ falas: [`${ERRADA} Enviar mensagem.`], revisoes: { [`${ERRADA} Enviar mensagem.`]: `${CERTA} Enviar mensagem.` } });
    let antes = a.aoClaude().length;
    await a.ligar();
    await app.esperar(`${DITADO}.enviando === true`, 8000);
    assert.strictEqual(a.aoClaude().length, antes, 'ainda não enviou: espera a correção');
    assert.strictEqual(await a.caixa(), ERRADA, 'a frase de enviar já saiu do texto');
    assert.match(await app.avaliar(linha('ditando')), /Corrigindo, e já envio…/);
    assert.strictEqual(await enviada(antes), CERTA);
    await app.esperar(`${ESTADO} === 'parado'`, 8000);
    await a.parado();
    assert.strictEqual(await a.caixa(), '');
    // Só a correção entendeu a frase de enviar (o modelo do ditado escreveu outra coisa): vale também.
    a.controle({ falas: ['Quero o relatório. em viar mem sagem'], revisoes: { 'Quero o relatório. em viar mem sagem': 'Quero o relatório. Enviar mensagem.' } });
    antes = a.aoClaude().length;
    await a.ligar();
    assert.strictEqual(await enviada(antes), 'Quero o relatório.');
    await app.esperar(`${ESTADO} === 'parado'`, 8000);
    await a.parado();
    await app.avaliar('window.orq.config.gravar({ ditadoEnviarPorVoz: false })');
  });
});

test('ditado: atalho, Esc, troca de aba, editor de texto e falhas', async (t) => {
  const a = await abrir(t);
  const { app } = a;
  const FALA = ['um dois três quatro cinco seis sete oito nove dez onze doze treze quatorze quinze dezesseis dezessete dezoito dezenove vinte.'];

  await t.test('o atalho (Ctrl+Shift+D) liga e desliga; uma tecla que não veio do teclado não abre o microfone', async () => {
    a.falar(FALA);
    await app.avaliar("document.getElementById('entrada').focus()");
    await app.avaliar("document.dispatchEvent(new KeyboardEvent('keydown', { ctrlKey: true, shiftKey: true, code: 'KeyD', key: 'D', bubbles: true, cancelable: true }))");
    await dorme(400);
    assert.strictEqual(await app.avaliar(ESTADO), 'parado');
    assert.deepStrictEqual(a.microfones(), [], 'o microfone nem foi aberto');
    await a.ctrlShiftD();
    await app.esperar(`${ESTADO} === 'ouvindo'`, 8000);
    await app.esperar(`/^um dois/.test(${CAIXA})`, 8000);
    await a.ctrlShiftD();
    await app.esperar(`${ESTADO} === 'parado'`, 8000);
    assert.match(await a.caixa(), /^um dois( \S+)*$/);
    assert.ok(await a.microfoneSolto());
    await a.porNaCaixa('');
  });

  await t.test('Esc com o ditado ligado para de ouvir e não interrompe o agente; o Esc seguinte volta a ser o de sempre', async () => {
    const ocupado = "!document.getElementById('parar').hidden && !document.getElementById('trabalhando').hidden";
    await app.avaliar("window.orq.conversa.mandar(window.orqConversa.ativa(), 'trabalha até parar')");
    await app.esperar(ocupado, 8000);
    a.falar(FALA);
    await a.ligar();
    await app.esperar(`/^um dois/.test(${CAIXA})`, 8000);
    await app.avaliar("document.getElementById('entrada').focus()");
    await a.esc();
    await app.esperar(`${ESTADO} === 'parado'`, 8000);
    await dorme(300);
    assert.strictEqual(a.interrupcoes(), 0, 'o agente continua trabalhando');
    assert.ok(await app.avaliar(ocupado));
    assert.match(await a.caixa(), /^um dois( \S+)*$/, 'o texto ditado fica');
    await a.porNaCaixa('');
    await a.esc();
    for (let i = 0; i < 50 && a.interrupcoes() === 0; i++) await dorme(100);
    assert.strictEqual(a.interrupcoes(), 1);
    await app.esperar("document.getElementById('trabalhando').hidden", 8000);
  });

  await t.test('sair da aba da conversa para de ouvir (a caixa não está mais à vista)', async () => {
    a.falar(FALA);
    await a.ligar();
    await app.avaliar("document.querySelector('[data-aba=aba-notas]').click()");
    await app.esperar(`${ESTADO} === 'parado'`, 8000);
    assert.ok(await a.microfoneSolto());
    await app.avaliar("document.querySelector('[data-aba=aba-orquestrador]').click()");
    await a.porNaCaixa('');
  });

  await t.test('com a mensagem aberta no editor de texto, o microfone não liga e a tela diz por quê', async () => {
    const antes = a.microfones().length;
    await a.porNaCaixa('texto no editor');
    await a.ctrlG();
    await app.esperar('window.orqEditorDeTexto.editando()', 4000);
    await app.avaliar(CLICAR);
    await dorme(300);
    assert.strictEqual(await app.avaliar(ESTADO), 'parado');
    assert.strictEqual(a.microfones().length, antes);
    assert.ok((await app.avaliar(AVISOS)).includes('A mensagem está aberta no editor de texto. Termine lá antes de ditar.'));
    await a.ctrlG();
    await app.esperar('!window.orqEditorDeTexto.editando()', 4000);
  });

  await t.test('falhas: o motor não carrega, o microfone não abre, o microfone cai no meio. A caixa fica como estava', async () => {
    await a.porNaCaixa('texto meu');
    a.controle({ erro: 'o modelo de voz não carregou' });
    await app.avaliar(CLICAR);
    await app.esperar(`(${AVISOS}).some((x) => /^O ditado parou: o modelo de voz não carregou\\. O que já estava na caixa continua lá\\.$/.test(x))`, 8000);
    await app.esperar(`${ESTADO} === 'parado'`, 8000);
    a.controle({}, { erro: 'Connection refused' });
    await app.avaliar(CLICAR);
    await app.esperar(`(${AVISOS}).some((x) => /^Não consegui ligar o ditado: Connection refused\\. O texto da caixa continua como estava\\.$/.test(x))`, 8000);
    assert.strictEqual(await app.avaliar(ESTADO), 'parado');
    a.controle({ mudo: true }, { acaba: 3 });
    await app.avaliar(CLICAR);
    await app.esperar(`(${AVISOS}).some((x) => /^O ditado parou: o microfone parou de mandar som\\./.test(x))`, 8000);
    await app.esperar(`${ESTADO} === 'parado'`, 8000);
    assert.strictEqual(await a.caixa(), 'texto meu');
    assert.strictEqual(await app.avaliar(aVista('ditando')), false);
    assert.ok(await a.microfoneSolto());
    // Depois das falhas, o ditado seguinte funciona.
    a.falar(['Agora foi.']);
    await a.porNaCaixa('');
    await a.ligar();
    await app.esperar(`${CAIXA} === 'Agora foi.'`, 8000);
    await a.desligar();
  });
});

test('ditado: um minuto sem fala para sozinho e avisa; Configurações e inglês', async (t) => {
  const a = await abrir(t, { config: { idioma: 'en' }, env: { ORQ_DITADO_SEM_FALA_MS: '700' } });
  const { app } = a;

  await t.test('sem fala pelo tempo combinado: para de ouvir e diz que parou (em inglês, traduzido)', async () => {
    a.controle({ mudo: true });
    assert.deepStrictEqual(await app.avaliar("[document.getElementById('ditar').title, document.getElementById('ditar').getAttribute('aria-label')]"), ['Dictate: speak and the text appears here', 'Dictate the message']);
    await a.ligar();
    assert.strictEqual(await app.avaliar(linha('ditando')), 'Listening. Speak: the text appears in the box, and you send it when you want. Microphone: microfone de teste Stop Ctrl+Shift+D');
    assert.strictEqual(await app.avaliar("document.getElementById('ditar').title"), 'Stop listening');
    await app.esperar(`${ESTADO} === 'parado'`, 8000);
    assert.ok((await app.avaliar(AVISOS)).includes('I stopped listening: a minute went by with no speech. What you dictated is still in the box.'));
    assert.ok(await a.microfoneSolto());
  });

  await t.test('uma falha aparece traduzida, com o motivo', async () => {
    a.controle({}, { erro: 'Connection refused' });
    await app.avaliar(CLICAR);
    await app.esperar(`(${AVISOS}).includes('Could not start dictation: Connection refused. The text in the box stays as it was.')`, 8000);
  });

  await t.test('em inglês a frase que envia é "send message", e a faixa ensina', async () => {
    await app.avaliar('window.orq.config.gravar({ ditadoEnviarPorVoz: true })');
    a.controle({ falas: ['Please check the sales report for October, split by seller and by region, with the total of each month and last year next to it. Send message.'] });
    const antes = a.aoClaude().length;
    await a.ligar();
    assert.strictEqual(await app.avaliar(linha('ditando')), 'Listening. To send, say “send message” Microphone: microfone de teste Stop Ctrl+Shift+D');
    for (let i = 0; i < 200 && a.aoClaude().length <= antes; i++) await dorme(40);
    assert.strictEqual(a.aoClaude()[antes], 'Please check the sales report for October, split by seller and by region, with the total of each month and last year next to it.');
    await app.esperar(`${ESTADO} === 'parado'`, 8000);
    await a.parado();
    await app.avaliar('window.orq.config.gravar({ ditadoEnviarPorVoz: false })');
  });

  await t.test('Configurações › Voz e reuniões tem o modelo do ditado, o "continuar ouvindo" e o "enviar por voz"; Atalhos tem a linha do ditado', async () => {
    await app.avaliar("document.getElementById('abrir-config').click()");
    await app.esperar("!document.getElementById('config').hidden");
    await app.avaliar("document.querySelector('[data-secao-config=voz]').click()");
    await app.esperar("/^Recommended for this computer \\(/.test(document.getElementById('config-ditado-modelo').options[0].textContent)", 8000);
    const voz = await app.avaliar("(() => { const s = document.getElementById('config-ditado-modelo'); const c = document.querySelector('[data-cfg=ditadoContinua]'); return { valor: s.value, opcoes: [...s.options].map((o) => o.value), continua: c.checked, titulos: [s.closest('.config-linha').querySelector('strong').textContent, c.closest('.config-linha').querySelector('strong').textContent] }; })()");
    assert.deepStrictEqual(voz, { valor: '', opcoes: ['', 'small', 'large-v3-turbo', 'large-v3'], continua: false, titulos: ['Dictation', 'Keep listening after sending'] });
    assert.deepStrictEqual(await app.avaliar("(() => { const s = document.getElementById('config-ditado-revisor'); return { valor: s.value, opcoes: [...s.options].map((o) => o.value), titulo: s.closest('.config-linha').querySelector('strong').textContent, primeira: s.options[0].textContent, segunda: s.options[1].textContent }; })()"),
      { valor: '', opcoes: ['', 'nenhum', 'large-v3-turbo', 'large-v3'], titulo: 'Fix each sentence with a bigger model', primeira: 'Recommended for this computer (does not fix)', segunda: 'Do not fix' });
    assert.deepStrictEqual(await app.avaliar("(() => { const v = document.querySelector('[data-cfg=ditadoEnviarPorVoz]'); const f = document.querySelector('[data-cfg=ditadoFraseEnviar]'); return { porVoz: v.checked, frase: f.value, dica: f.placeholder, titulos: [v.closest('.config-linha').querySelector('strong').textContent, f.closest('.config-linha').querySelector('strong').textContent] }; })()"),
      { porVoz: false, frase: '', dica: 'send message', titulos: ['Send by voice', 'Phrase that sends'] });
    await app.avaliar("document.querySelector('[data-secao-config=atalhos]').click()");
    assert.deepStrictEqual(await app.avaliar("(() => { const l = document.querySelector('[data-atalho-linha=ditado]'); return [l.querySelector('strong').textContent, document.querySelector('[data-atalho-mudar=ditado]').textContent]; })()"), ['Dictate the message', 'Ctrl+Shift+D']);
    // Desativar o atalho: a faixa deixa de mostrar a tecla, e a combinação não liga mais o ditado.
    await app.avaliar("document.querySelector('[data-atalho-desligar=ditado]').click()");
    await app.esperar("document.querySelector('[data-atalho-mudar=ditado]').classList.contains('desligado')");
    for (let i = 0; i < 50 && JSON.parse(app.ler('.config/orq-app/config.json')).atalhoDitado !== ''; i++) await dorme(50);
    assert.strictEqual(JSON.parse(app.ler('.config/orq-app/config.json')).atalhoDitado, '');
    await app.avaliar("document.querySelector('[data-atalho-padrao=ditado]').click()");
    await app.esperar("document.querySelector('[data-atalho-mudar=ditado]').textContent === 'Ctrl+Shift+D'");
  });
});

test('ditado: sem os programas de teste o app de teste não abre microfone nem motor', async (t) => {
  const app = await abrirApp({ config: { mostrarBichinho: false } });
  t.after(() => app.fechar());
  await app.esperar('!!window.__orqTeste && !!window.orqDitado');
  await app.avaliar(CLICAR);
  await app.esperar(`(${AVISOS}).some((x) => /^Não consegui ligar o ditado: sem (motor de ditado|microfone) nos testes\\. O texto da caixa continua como estava\\.$/.test(x))`, 8000);
  assert.strictEqual(await app.avaliar(ESTADO), 'parado');
  assert.strictEqual(await app.avaliar(aVista('ditando')), false);
});
