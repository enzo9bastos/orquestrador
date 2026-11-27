// Área: voltar (conversa: voltar para antes de uma mensagem)
// O ✎ abre o cartão de voltar (plano 7.1). Aqui a conversa não tem ponto de volta dos arquivos:
// só dá para voltar a conversa, como sempre foi. Com arquivos: voltar-arquivos.e2e.js.
const test = require('node:test');
const { pastaTemporaria } = require('../temporarias');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { abrirApp } = require('./app');

// O Claude falso comum (tests/unit/claude-falso.js): manda o init assim que sobe
// e, como o Claude de verdade, --resume mantém a sessão e --fork-session abre
// outra. A 1ª linha de cada subida no log é { args }: os argumentos de cada vez.
const CLAUDE_FALSO = path.join(__dirname, '..', 'unit', 'claude-falso.js');
function claudeFalso() {
  const log = path.join(pastaTemporaria('orq-claude-falso-'), 'log.jsonl');
  Object.assign(process.env, { CLAUDE_FALSO_LOG: log, CLAUDE_FALSO_INIT_NA_SUBIDA: '1', CLAUDE_FALSO_SESSAO_REAL: '1', CLAUDE_FALSO_VOLTA: JSON.stringify({ canRewind: false, error: 'No file checkpoint found for this message.' }) });
  const chamadas = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [])
    .map((l) => JSON.parse(l)).filter((o) => Array.isArray(o.args)).map((o) => o.args.join(' '));
  const desligar = () => { for (const k of ['CLAUDE_FALSO_LOG', 'CLAUDE_FALSO_INIT_NA_SUBIDA', 'CLAUDE_FALSO_SESSAO_REAL', 'CLAUDE_FALSO_VOLTA']) delete process.env[k]; };
  // Espera uma subida com aqueles argumentos. Não conta subidas nem olha "a
  // última": o app mostra o histórico ANTES de o processo novo escrever a
  // linha dele, então com a máquina carregada a linha de um reinício anterior
  // chega atrasada e passava por subida nova (falhou assim na publicação da
  // v0.4.2, com 7 arquivos de tela rodando ao mesmo tempo).
  const subiuCom = async (serve, ms = 8000) => {
    for (let t = 0; t < ms; t += 100) { if (chamadas().some(serve)) return true; await new Promise((r) => setTimeout(r, 100)); }
    return false;
  };
  return { bin: CLAUDE_FALSO, chamadas, subiuCom, desligar };
}

test('voltar a conversa para antes de uma mensagem', async (t) => {
  const falso = claudeFalso();
  const app = await abrirApp({
    config: { iasCaminhos: { claude: falso.bin } },
    arquivos: { '.cache/orq-app/conversas-teste.json': JSON.stringify([{ id: 'orquestrador', titulo: 'Orquestrador', sessao: 'S1', orquestrador: true }]) },
  });
  t.after(() => { falso.desligar(); return app.fechar(); });
  await app.esperar('!!window.__orqTeste');
  // Histórico do Claude: três mensagens do usuário, cada uma com resposta.
  const l = (o) => JSON.stringify(o);
  const projeto = app.casa.replace(/[^A-Za-z0-9]/g, '-');
  fs.mkdirSync(path.join(app.casa, '.claude/projects', projeto), { recursive: true });
  app.escrever(`.claude/projects/${projeto}/S1.jsonl`, [
    l({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'primeira pergunta' } }),
    l({ type: 'assistant', uuid: 'a1', message: { role: 'assistant', content: [{ type: 'text', text: 'resposta um' }] } }),
    l({ type: 'user', uuid: 'u2', message: { role: 'user', content: 'me diz onde t' } }),
    l({ type: 'assistant', uuid: 'a2', message: { role: 'assistant', content: [{ type: 'text', text: 'chegou cortada' }] } }),
    l({ type: 'user', uuid: 'u3', message: { role: 'user', content: 'outra coisa' } }),
    l({ type: 'assistant', uuid: 'a3', message: { role: 'assistant', content: [{ type: 'text', text: 'resposta três' }] } }),
  ].join('\n') + '\n');
  // Reabre a conversa para a tela ler o histórico.
  await app.avaliar("window.orq.conversa.reiniciar('orquestrador')");
  const baloes = () => app.avaliar("[...document.querySelectorAll('#mensagens .msg-voce[data-texto]')].map((b) => b.dataset.texto)");
  await app.esperar("document.querySelectorAll('#mensagens .msg-voce[data-texto]').length === 3", 8000);
  // Desde 27/11 o ✎ abre a edição no próprio balão (editar-mensagem.e2e.js); o cartão de voltar,
  // com os três alcances, fica em "Mais jeitos de voltar…" dentro dela.
  const clicarEditar = async (texto) => {
    await app.avaliar(`[...document.querySelectorAll('#mensagens .msg-voce[data-texto]')].find((b) => b.dataset.texto === ${JSON.stringify(texto)}).querySelector('.editar-msg').click()`);
    await app.esperar("!!document.querySelector('#mensagens .editor-msg [data-ed=mais]')", 8000);
    await app.avaliar("document.querySelector('#mensagens .editor-msg [data-ed=mais]').click()");
  };

  const cartao = "document.querySelector('#mensagens .cartao-volta')";
  const ensaiado = `!!${cartao} && !${cartao}.querySelector('.volta-sem-ponto').hidden`;

  await t.test('✎ na mensagem do meio abre o cartão dizendo quantas saem; sem ponto de volta, só a conversa', async () => {
    await clicarEditar('me diz onde t');
    await app.esperar(ensaiado, 8000);
    const v = await app.avaliar(`(() => { const c = ${cartao}; return { texto: c.innerText.replace(/\\s+/g, ' '), opcoes: [...c.querySelectorAll('.escopos-volta input')].map((i) => [i.value, i.checked, i.disabled]), botao: c.querySelector('[data-volta="confirmar"]').innerText, depoisDoBalao: c.previousElementSibling.dataset.texto }; })()`);
    assert.match(v.texto, /Voltar para antes de: «me diz onde t»/);
    assert.match(v.texto, /Ela e a 1 mensagem sua depois dela saem da conversa, com as respostas\. Os arquivos ficam como estão\./);
    assert.deepStrictEqual(v.opcoes, [['conversa', true, false], ['tudo', false, true], ['arquivos', false, true]]);
    assert.match(v.texto, /Sem ponto de volta dos arquivos nesta conversa\./);
    assert.match(v.texto, /O Claude não tem ponto de volta dos arquivos para esta mensagem[\s\S]*Aqui só dá para voltar a conversa\.\s*\(No file checkpoint found for this message\.\)/);
    assert.strictEqual(v.botao, 'Voltar a conversa');
    assert.deepStrictEqual(await app.avaliar(`['.volta-arquivos', '.erro-volta'].map((s) => getComputedStyle(${cartao}.querySelector(s)).display)`), ['none', 'none'], 'sem caixa vazia no cartão');
    assert.strictEqual(v.depoisDoBalao, 'me diz onde t', 'o cartão fica logo abaixo da mensagem');
    await app.avaliar(`${cartao}.querySelector('[data-volta="cancelar"]').click()`);
    await app.esperar(`!${cartao}`);
    assert.deepStrictEqual(await baloes(), ['primeira pergunta', 'me diz onde t', 'outra coisa'], 'cancelar não muda nada');
  });

  await t.test('Esc fecha o cartão sem mudar nada', async () => {
    await clicarEditar('me diz onde t');
    await app.esperar(`!!${cartao}`);
    await app.tecla('Escape', 'Escape', 27);
    await app.esperar(`!${cartao}`);
    assert.deepStrictEqual(await baloes(), ['primeira pergunta', 'me diz onde t', 'outra coisa']);
  });

  await t.test('confirmar volta: o Claude reabre cortado, numa sessão nova, e o texto vai para a caixa', async () => {
    await clicarEditar('me diz onde t');
    await app.esperar(ensaiado, 8000);
    await app.avaliar(`${cartao}.querySelector('[data-volta="confirmar"]').click()`);
    await app.esperar("document.getElementById('entrada').value === 'me diz onde t'", 8000);
    assert.ok(await falso.subiuCom((c) => /--resume S1 --resume-session-at a1 --fork-session/.test(c)),
      `o Claude não reabriu cortado; subidas: ${JSON.stringify(falso.chamadas())}`);
    await app.esperar("document.querySelectorAll('#mensagens .msg-voce[data-texto]').length === 1", 8000);
    assert.deepStrictEqual(await baloes(), ['primeira pergunta'], 'a mensagem errada e o que veio depois saem da tela');
    assert.strictEqual(await app.avaliar(`!!${cartao}`), false, 'o cartão some');
    const lista = JSON.parse(app.ler('.cache/orq-app/conversas-teste.json'));
    assert.deepStrictEqual(lista.find((c) => c.orquestrador).volta, { de: 'S1', ate: 'a1' }, 'a volta fica gravada até a 1ª resposta');
    assert.ok(fs.existsSync(path.join(app.casa, `.claude/projects/${projeto}/S1.jsonl`)), 'o histórico original não é apagado');
  });

  await t.test('✎ na última mensagem: Enter no cartão confirma "Só a conversa"; sendo a primeira da conversa, o Claude recomeça do zero', async () => {
    // A volta anterior ainda não teve resposta: a sessão de partida continua a S1.
    await clicarEditar('primeira pergunta');
    await app.esperar(`!!${cartao} && document.activeElement === ${cartao}`, 8000);
    assert.match(await app.avaliar(`${cartao}.innerText.replace(/\\s+/g, ' ')`), /Esta mensagem e a resposta saem da conversa, e o texto volta para a caixa\. Os arquivos ficam como estão\./);
    await app.tecla('Enter', 'Enter', 13);
    await app.esperar("document.getElementById('entrada').value === 'primeira pergunta'", 8000);
    // Só esta subida vem sem --resume (as anteriores retomam a S1).
    assert.ok(await falso.subiuCom((c) => !/--resume/.test(c)), `o Claude não recomeçou do zero; subidas: ${JSON.stringify(falso.chamadas())}`);
    await app.esperar("document.querySelectorAll('#mensagens .msg-voce[data-texto]').length === 0", 8000);
    const o = JSON.parse(app.ler('.cache/orq-app/conversas-teste.json')).find((c) => c.orquestrador);
    assert.ok(o.anteriores.includes('S1'), 'a conversa original fica guardada');
  });

  await t.test('sem erros na tela', () => assert.deepStrictEqual(app.erros, []));
});
