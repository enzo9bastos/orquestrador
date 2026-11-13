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
