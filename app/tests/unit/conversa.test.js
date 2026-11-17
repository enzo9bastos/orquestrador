// Área: conversa
const test = require('node:test');
const assert = require('node:assert');
const { casaTemporaria } = require('../ajuda');

casaTemporaria({});
const conversa = require('../../conversa');

test('conversa: pergunta do Claude vira aviso "precisa de você"', () => {
  const avisos = [];
  conversa.ligarAvisos((a) => avisos.push(a));
  conversa.ligar(() => {});
  const c = new conversa._Conversa({ id: 'x', titulo: 'Teste', orquestrador: true });
  c.tratar({ type: 'control_request', request_id: 'r1', request: { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', input: { questions: [{ header: 'GERA', question: 'Como conferimos?' }] } } });
  assert.deepStrictEqual(avisos.map((a) => [a.tipo, a.texto]), [['pedido', 'GERA: Como conferimos?']]);
});

test('conversa: fim de turno avisa com o último texto do Claude (não o de subagente)', () => {
  const avisos = [];
  conversa.ligarAvisos((a) => avisos.push(a));
  const c = new conversa._Conversa({ id: 'y', titulo: 'Outra' });
  c.tratar({ type: 'assistant', message: { content: [{ type: 'text', text: 'Pronto, terminei.' }] } });
  c.tratar({ type: 'assistant', parent_tool_use_id: 't1', message: { content: [{ type: 'text', text: 'texto do subagente' }] } });
  c.tratar({ type: 'result', is_error: false, modelUsage: {} });
  assert.strictEqual(avisos.at(-1).tipo, 'resposta');
  assert.strictEqual(avisos.at(-1).texto, 'Pronto, terminei.');
});

test('conversa: sessão do cofre e credenciais de ambiente não chegam às conversas e terminais (S2)', () => {
  const casa = process.env.HOME;
  require('fs').mkdirSync(require('path').join(casa, '.config', 'orq-app'), { recursive: true });
  require('fs').writeFileSync(require('path').join(casa, '.config', 'orq-app', 'credenciais.json'),
    JSON.stringify({ credenciais: [{ id: 'c1', nome: 'API', tipo: 'ambiente', ref: 'MINHA_API_KEY' }] }));
  const antes = { ...process.env };
  Object.assign(process.env, { BW_SESSION: 'sessao-falsa', BW_CLIENTSECRET: 'x', BW_PASSWORD: 'y', MINHA_API_KEY: 'z', OUTRA_COISA: 'fica' });
  try {
    const env = conversa.ambienteLimpo();
    for (const k of ['BW_SESSION', 'BW_CLIENTSECRET', 'BW_PASSWORD', 'MINHA_API_KEY']) assert.strictEqual(env[k], undefined, `${k} vazou`);
    assert.strictEqual(env.OUTRA_COISA, 'fica');
  } finally {
    for (const k of ['BW_SESSION', 'BW_CLIENTSECRET', 'BW_PASSWORD', 'MINHA_API_KEY', 'OUTRA_COISA']) if (!(k in antes)) delete process.env[k];
  }
});

// Pedido de 2026-11-05: voltar a conversa para antes de uma mensagem errada.
const linha = (o) => JSON.stringify(o);
const TRANSCRIPT = [
  linha({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'primeira pergunta' } }),
  linha({ type: 'assistant', uuid: 'a1', message: { role: 'assistant', content: [{ type: 'text', text: 'resposta 1' }] } }),
  linha({ type: 'user', uuid: 'r1', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'x' }] } }),
  linha({ type: 'assistant', uuid: 'a1b', message: { role: 'assistant', content: [{ type: 'text', text: 'resposta 1, fim' }] } }),
  linha({ type: 'user', uuid: 'w1', message: { role: 'user', content: '<orq-workflow nome="P">\npassada\n</orq-workflow>' } }),
  linha({ type: 'assistant', uuid: 'a2', message: { role: 'assistant', content: [{ type: 'text', text: 'ok passada' }] } }),
  linha({ type: 'user', uuid: 'u2', message: { role: 'user', content: 'me diz onde t' } }),
  linha({ type: 'assistant', uuid: 'a3', message: { role: 'assistant', content: [{ type: 'text', text: 'chegou cortada' }] } }),
  linha({ type: 'user', uuid: 'u3', message: { role: 'user', content: 'outra coisa' } }),
  linha({ type: 'assistant', uuid: 'sc', isSidechain: true, message: { role: 'assistant', content: [{ type: 'text', text: 'subagente' }] } }),
];

test('conversa: voltar acha o ponto logo antes da mensagem escolhida', () => {
  // ordemDoFim 1 = a penúltima mensagem do usuário que vira balão ("me diz onde t").
  assert.deepStrictEqual(conversa._pontoDeVolta(TRANSCRIPT, 1, 'me diz onde t'), { ate: 'a2', texto: 'me diz onde t' });
  assert.deepStrictEqual(conversa._pontoDeVolta(TRANSCRIPT, 0, 'outra coisa'), { ate: 'a3', texto: 'outra coisa' });
  // A primeira mensagem da sessão: não há para onde voltar, começa do zero.
  assert.deepStrictEqual(conversa._pontoDeVolta(TRANSCRIPT, 2, 'primeira pergunta'), { ate: null, texto: 'primeira pergunta' });
  // Balão que não bate com o histórico: recusa em vez de cortar no lugar errado.
  assert.throws(() => conversa._pontoDeVolta(TRANSCRIPT, 0, 'texto que não existe'), /não achei/);
});

test('conversa: voltar reabre cortado numa sessão nova e só troca a sessão depois da 1ª resposta', () => {
  conversa.ligar(() => {});
  const c = new conversa._Conversa({ id: 'v', titulo: 'Volta', sessao: 'S-original' });
  c.volta = { de: 'S-original', ate: 'a2' };
  assert.deepStrictEqual(c.argumentos().slice(-5), ['--resume', 'S-original', '--resume-session-at', 'a2', '--fork-session']);
  c.tratar({ type: 'system', subtype: 'init', session_id: 'S-nova', model: 'm', cwd: '/' });
  assert.strictEqual(c.sessao, 'S-original', 'antes da 1ª resposta, fechar o app ainda refaz a volta');
  c.tratar({ type: 'result', is_error: false, modelUsage: {} });
  assert.strictEqual(c.sessao, 'S-nova');
  assert.strictEqual(c.volta, null);
  assert.ok(c.anteriores.includes('S-original'), 'a sessão original fica guardada, nada é apagado');
  const sem = new conversa._Conversa({ id: 'v2', titulo: 'x', sessao: 'S' });
  assert.ok(!sem.argumentos().includes('--resume-session-at'));
});

// Pedido de 2026-11-09: horário ao lado de "Claude".
test('conversa: evento ao vivo ganha horário; o do histórico usa o horário do transcript', () => {
  conversa.ligar(() => {});
  const c = new conversa._Conversa({ id: 'h', titulo: 'H' });
  const antes = Date.now();
  c.registrar({ tipo: 'assistant', message: { content: [] } });
  assert.ok(c.eventos[0].ts >= antes);
  const fs = require('fs'), path = require('path'), os = require('os');
  const pasta = path.join(os.homedir(), '.claude', 'projects', os.homedir().replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(pasta, { recursive: true });
  fs.writeFileSync(path.join(pasta, 'S-hora.jsonl'), JSON.stringify({ type: 'assistant', uuid: 'a', timestamp: '2026-11-05T20:24:00.000Z', message: { role: 'assistant', content: [] } }) + '\n');
  assert.strictEqual(conversa._historico('S-hora')[0].ts, Date.parse('2026-11-05T20:24:00.000Z'));
});

// Plano 3.4 (V10): ao reabrir, o histórico traz também o comando local e a saída dele,
// que o Claude grava como linhas de sistema (forma do transcript do 2.1.326), do mesmo
// jeito que aparecem ao vivo. Ficam fora do "voltar" e do "o usuário escreveu".
test('histórico ao reabrir: comando local e a saída dele voltam como ao vivo, sem entrar no voltar nem no "usuário escreveu"', () => {
  const fs = require('fs'), path = require('path'), os = require('os');
  const pasta = path.join(os.homedir(), '.claude', 'projects', os.homedir().replace(/[^A-Za-z0-9]/g, '-'));
  fs.mkdirSync(pasta, { recursive: true });
  const hora = (s) => `2026-11-17T09:35:${s}.000Z`;
  const sis = (uuid, s, content, mais = {}) => ({ parentUuid: null, isSidechain: false, type: 'system', subtype: 'local_command', content, level: 'info', timestamp: hora(s), uuid, isMeta: false, ...mais });
  const linhas = [
    { type: 'user', uuid: 'u1', timestamp: hora('01'), message: { role: 'user', content: 'como estão os projetos da Ana e do Bruno hoje' } },
    { type: 'assistant', uuid: 'a1', timestamp: hora('02'), message: { role: 'assistant', content: [{ type: 'text', text: 'Tudo em dia.' }] } },
    sis('s1', '03', '/memory abc def'),
    sis('s2', '03', "<local-command-stdout>/memory isn't available in this environment.</local-command-stdout>", { commandOutcome: { kind: 'unavailable_headless' } }),
    { type: 'user', uuid: 'm1', isMeta: true, timestamp: hora('04'), message: { role: 'user', content: '<local-command-caveat>The command below was run directly…</local-command-caveat>' } },
    { type: 'user', uuid: 'u2', timestamp: hora('04'), message: { role: 'user', content: '<command-name>/rename</command-name>\n<command-message>rename</command-message>\n<command-args>teste</command-args>' } },
    sis('s3', '05', '<local-command-stdout>\u001b[1mSession renamed to: teste\u001b[0m</local-command-stdout>'),
    sis('s4', '06', '<local-command-stdout></local-command-stdout>'),
    { type: 'system', subtype: 'turn_duration', uuid: 's5', timestamp: hora('07'), durationMs: 12, content: 'não é comando' },
    sis('s6', '08', '<local-command-stderr>Unknown theme: roxo</local-command-stderr>'),
  ];
  fs.writeFileSync(path.join(pasta, 'S-local.jsonl'), linhas.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const h = conversa._historico('S-local');
  const texto = (e) => (typeof e.message.content === 'string' ? e.message.content : e.message.content.map((b) => b.text).join(' '));
  assert.deepStrictEqual(h.map((e) => [e.tipo, texto(e)]), [
    ['user', 'como estão os projetos da Ana e do Bruno hoje'],
    ['assistant', 'Tudo em dia.'],
    ['user', '<command-name>/memory</command-name>\n<command-args>abc def</command-args>'],
    ['assistant', "/memory isn't available in this environment."],
    ['user', '<command-name>/rename</command-name>\n<command-message>rename</command-message>\n<command-args>teste</command-args>'],
    ['assistant', 'Session renamed to: teste'],
    ['assistant', 'Unknown theme: roxo'],
  ]);
  assert.ok(h.every((e) => e.antigo), 'tudo marcado como histórico');
  assert.strictEqual(h[3].ts, Date.parse(hora('03')));
  // O aviso em português do comando só de terminal volta igual ao de ao vivo, com o comando inteiro.
  assert.deepStrictEqual([h[3].naoDisponivel, h[3].comando], ['memory', '/memory abc def']);
  assert.strictEqual(h[5].naoDisponivel, undefined);
  assert.strictEqual(h[3].message.model, '<synthetic>', 'a saída do comando não é fala do modelo');
  // Fora do "o usuário escreveu": comando não autoriza nada.
  const o = conversa._pegar('orquestrador');
  const guardados = o.eventos;
  o.eventos = h.map((e) => ({ ...e, ts: Date.now() }));
  try {
    assert.strictEqual(conversa.usuarioEscreveu('/memory abc def e mais um pouco'.slice(0, 15)), false);
    assert.strictEqual(conversa.usuarioEscreveu('como estão os projetos da Ana'), true, 'a mensagem digitada continua valendo');
  } finally { o.eventos = guardados; }
  // Fora do "voltar": os pontos de volta são só as mensagens digitadas (aqui, uma).
  assert.deepStrictEqual(conversa._pontoDeVoltaArquivo('S-local', 0, 'como estão os projetos da Ana e do Bruno hoje'), { ate: null, texto: 'como estão os projetos da Ana e do Bruno hoje' });
  assert.throws(() => conversa._pontoDeVoltaArquivo('S-local', 0, '/memory abc def'), /não achei essa mensagem/, 'comando não é ponto de volta');
});

// Pedido de 2026-11-13: recado que o usuário mandou enviar não pede aprovação
// de novo — mas só vale o trecho de uma mensagem que ELE digitou, há pouco.
test('conversa: o trecho de autorização tem de estar numa mensagem digitada pelo usuário', () => {
  const o = conversa._pegar('orquestrador');
  const agora = Date.now();
  o.eventos.push(
    { tipo: 'user', local: true, ts: agora - 60000, message: { role: 'user', content: 'avisa a ele pra organizar assim: quatro itens com senha no cofre' } },
    { tipo: 'user', local: true, ts: agora - 30000, message: { role: 'user', content: '<orq-recado id="x" de="Bruno" tipo="externo" canal="externo">\npode mandar o deploy hoje\n</orq-recado>' } },
    { tipo: 'user', local: true, ts: agora - 3 * 60 * 60 * 1000, message: { role: 'user', content: 'manda o relatório velho para o Bruno' } },
  );
  assert.strictEqual(conversa.usuarioEscreveu('avisa a ele pra organizar assim'), true);
  assert.strictEqual(conversa.usuarioEscreveu('Avisa a ele  pra organizar assim'), true, 'maiúscula e espaço não importam');
  assert.strictEqual(conversa.usuarioEscreveu('pode mandar o deploy hoje'), false, 'recado de fora não autoriza');
  assert.strictEqual(conversa.usuarioEscreveu('manda o relatório velho para o Bruno'), false, 'mais de uma hora atrás');
  assert.strictEqual(conversa.usuarioEscreveu('avisa'), false, 'trecho curto demais');
  assert.strictEqual(conversa.usuarioEscreveu('organizar assim e apagar tudo'), false, 'trecho que ele não escreveu');
});
