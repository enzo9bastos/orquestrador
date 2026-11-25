// Área: voz (ditado: falar em vez de escrever, com o texto aparecendo enquanto a pessoa fala)
// Pedido de 24/11: "ao invés de eu escrever eu falo, ele transcreve em tempo real e aí mando a
// mensagem". Aqui o motor (voz/ditado.py) e o microfone são trocados por ditado-falso.js e
// captura-falsa.js, que falam o mesmo protocolo: um teste nunca abre o microfone de verdade.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { pastaTemporaria } = require('../temporarias');
const D = require('../../ditado');

const MOTOR = path.join(__dirname, 'ditado-falso.js');
const CAPTURA = path.join(__dirname, 'captura-falsa.js');
const casa = pastaTemporaria('orq-ditado-');
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
const vivo = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// Um ditado de teste: o motor e o microfone de mentira, e a lista de tudo o que foi avisado.
function montar({ motorEnv = {}, capturaEnv = {}, ...opcoes } = {}) {
  const eventos = [];
  const capturas = [];
  const d = D.criar({
    motor: async () => ({ comando: process.execPath, args: [MOTOR], env: motorEnv }),
    capturar: () => new Promise((ok, falhou) => {
      const p = spawn(process.execPath, [CAPTURA], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...capturaEnv } });
      capturas.push(p);
      let erro = '';
      p.stderr.on('data', (x) => { erro += x; });
      p.on('close', () => { if (erro) falhou(new Error(erro.trim())); });
      p.stdout.once('data', () => ok({ processo: p, microfone: 'microfone de teste' }));
    }),
    aoEvento: (e) => eventos.push(e),
    ...opcoes,
  });
  const espera = async (fn, ms = 5000) => { for (let i = 0; i < ms / 10; i++) { const r = eventos.find(fn); if (r) return r; await dorme(10); } throw new Error(`não chegou: ${fn}\n${JSON.stringify(eventos.filter((e) => e.t !== 'nivel'))}`); };
  const textos = (t) => eventos.filter((e) => e.t === t).map((e) => e.texto);
  return { d, eventos, capturas, espera, textos };
}

test('ditado: fala → prévias que crescem → trecho fechado; parar fecha o que estava aberto e solta o microfone', async (t) => {
  const { d, eventos, capturas, espera, textos } = montar({ motorEnv: { DITADO_FALSO_FALAS: JSON.stringify(['Bom dia, quero o relatório das vendas.', 'Mande para o time até sexta, sem falta nenhuma, com todos os números do mês.']), DITADO_FALSO_CARGA_MS: '150' }, capturaEnv: { CAPTURA_FALSA_MS: '15' } });
  t.after(() => d.encerrar());
  const r = await d.comecar({ contexto: 'Olá.' });
  assert.deepStrictEqual(r, { id: 1, microfone: 'microfone de teste' });
  // O modelo ainda carrega: "preparando" (o som já vai sendo guardado); pronto, vira "ouvindo".
  assert.deepStrictEqual(eventos.filter((e) => e.t === 'estado').map((e) => e.estado), ['preparando']);
  await espera((e) => e.t === 'estado' && e.estado === 'ouvindo');
  await espera((e) => e.t === 'final');
  const previas = textos('parcial').slice(0, 6);
  assert.deepStrictEqual(previas, ['Bom', 'Bom dia,', 'Bom dia, quero', 'Bom dia, quero o', 'Bom dia, quero o relatório', 'Bom dia, quero o relatório das']);
  assert.strictEqual(textos('final')[0], 'Bom dia, quero o relatório das vendas.');
  // O volume do microfone chega enquanto ouve, entre 0 e 1.
  const niveis = eventos.filter((e) => e.t === 'nivel');
  assert.ok(niveis.length > 0 && niveis.every((e) => e.v >= 0 && e.v <= 1) && niveis.some((e) => e.v > 0.3), JSON.stringify(niveis.slice(0, 3)));
  // Parar no meio da segunda fala: o que já foi entendido dela é fechado, e depois vem o "parou".
  await espera((e) => e.t === 'parcial' && /^Mande para/.test(e.texto));
  const pid = capturas[0].pid;
  await d.parar();
  const finais = textos('final');
  assert.strictEqual(finais.length, 2);
  assert.match(finais[1], /^Mande para o time/);
  const ordem = eventos.filter((e) => e.t === 'final' || e.t === 'parou' || (e.t === 'estado' && e.estado !== 'ouvindo' && e.estado !== 'preparando')).map((e) => (e.t === 'estado' ? e.estado : e.t)).slice(-4);
  assert.deepStrictEqual(ordem, ['terminando', 'final', 'parou', 'parado']);
  assert.deepStrictEqual(eventos.find((e) => e.t === 'parou'), { t: 'parou', id: 1, motivo: 'pedido' });
  assert.deepStrictEqual(d.estado(), { estado: 'parado', id: null, microfone: 'microfone de teste', previa: true, revisor: false });
  assert.ok(eventos.filter((e) => e.t === 'estado' && e.estado === 'ouvindo').every((e) => e.previa === true), 'este motor escreve enquanto a pessoa fala');
  assert.deepStrictEqual(eventos.filter((e) => e.t === 'final').map((e) => e.n), [0, 1], 'cada fecho leva o número do trecho');
  assert.strictEqual(eventos.filter((e) => e.t === 'revisao').length, 0, 'sem modelo de correção não há correção');
  for (let i = 0; i < 100 && vivo(pid); i++) await dorme(20);
  assert.strictEqual(vivo(pid), false, 'o microfone foi solto');
  // Depois do "parou" não chega mais texto.
  const quantos = eventos.length;
  await dorme(200);
  assert.strictEqual(eventos.filter((e) => e.t === 'parcial' || e.t === 'final').length, eventos.slice(0, quantos).filter((e) => e.t === 'parcial' || e.t === 'final').length);
});

test('ditado: o segundo começa na hora, com o mesmo motor já carregado; o som e o contexto chegam ao motor', async (t) => {
  const log = path.join(casa, 'motor-segundo.log');
  const { d, eventos, espera } = montar({ motorEnv: { DITADO_FALSO_LOG: log, DITADO_FALSO_CARGA_MS: '100' } });
  t.after(() => d.encerrar());
  await d.comecar({ contexto: 'Primeiro.' });
  await espera((e) => e.t === 'final');
  await d.parar();
  const antes = eventos.length;
  await d.comecar({ contexto: 'Segundo contexto.' });
  assert.deepStrictEqual(eventos.slice(antes).filter((e) => e.t === 'estado').map((e) => e.estado), ['ouvindo'], 'sem "preparando": o motor já estava pronto');
  await espera((e) => e.t === 'final' && e.id === 2);
  await d.parar();
  const linhas = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.strictEqual(linhas.filter((l) => l.pid).length, 1, 'um processo de motor só');
  const comandos = linhas.filter((l) => l.cmd).map((l) => l.cmd);
  assert.deepStrictEqual(comandos.filter((c) => c.t === 'comecar'), [{ t: 'comecar', id: 1, contexto: 'Primeiro.' }, { t: 'comecar', id: 2, contexto: 'Segundo contexto.' }]);
  assert.ok(linhas.filter((l) => l.cmd && l.cmd.t === 'parar').every((l) => l.som > 3200), 'o som do microfone chegou ao motor');
});

test('ditado: largar termina sem fechar o trecho, e o que chegar depois é ignorado', async (t) => {
  const { d, eventos, espera, textos } = montar({ capturaEnv: { CAPTURA_FALSA_MS: '25' } });
  t.after(() => d.encerrar());
  await d.comecar({});
  await espera((e) => e.t === 'parcial');
  assert.deepStrictEqual(d.largar(), { ok: true });
  assert.strictEqual(d.estado().estado, 'parado');
  const finais = textos('final').length, previas = textos('parcial').length;
  await dorme(250);
  assert.deepStrictEqual([textos('final').length, textos('parcial').length], [finais, previas]);
  assert.deepStrictEqual(eventos.filter((e) => e.t === 'parou'), [{ t: 'parou', id: 1, motivo: 'pedido' }]);
});

test('ditado: cortar larga o trecho aberto e muda a época (o que vem depois é de outra fala)', async (t) => {
  const log = path.join(casa, 'motor-cortar.log');
  const { d, eventos, espera } = montar({ motorEnv: { DITADO_FALSO_LOG: log }, capturaEnv: { CAPTURA_FALSA_MS: '30' } });
  t.after(() => d.encerrar());
  await d.comecar({});
  await espera((e) => e.t === 'parcial' && e.texto === 'Bom dia,');
  assert.deepStrictEqual(d.cortar('Bom dia, pessoal'), { epoca: 1 });
  const novo = await espera((e) => (e.t === 'parcial' || e.t === 'final') && e.epoca === 1);
  assert.match(novo.texto, /^Mande/, 'a fala cortada não volta: vem a seguinte');
  assert.ok(eventos.filter((e) => e.t === 'final').every((e) => !/relatório das vendas/.test(e.texto)), 'o trecho cortado nunca foi fechado');
  await d.parar();
  const cmd = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((l) => l.cmd && l.cmd.t === 'cortar').map((l) => l.cmd);
  assert.deepStrictEqual(cmd, [{ t: 'cortar', epoca: 1, contexto: 'Bom dia, pessoal' }]);
  assert.deepStrictEqual(d.cortar('x'), { epoca: 1 }, 'parado, cortar não faz nada');
});

test('ditado: o motor falha ao carregar → erro com o motivo, microfone solto, tudo parado', async (t) => {
  const { d, eventos, capturas, espera } = montar({ motorEnv: { DITADO_FALSO_ERRO: 'o modelo small ainda não está neste computador' } });
  t.after(() => d.encerrar());
  await d.comecar({});
  const e = await espera((x) => x.t === 'erro');
  assert.strictEqual(e.erro, 'o modelo small ainda não está neste computador');
  await espera((x) => x.t === 'parou' && x.motivo === 'erro');
  assert.strictEqual(d.estado().estado, 'parado');
  for (let i = 0; i < 100 && vivo(capturas[0].pid); i++) await dorme(20);
  assert.strictEqual(vivo(capturas[0].pid), false);
  assert.strictEqual(eventos.filter((x) => x.t === 'erro').length, 1, 'um aviso só');
});

test('ditado: o microfone não abre → comecar diz o motivo e nada fica ligado; o microfone cai no meio → erro', async (t) => {
  const a = montar({ capturaEnv: { CAPTURA_FALSA_ERRO: 'Connection refused' } });
  t.after(() => a.d.encerrar());
  await assert.rejects(a.d.comecar({}), /Connection refused/);
  assert.strictEqual(a.d.estado().estado, 'parado');
  assert.strictEqual(a.d._motorVivo(), false, 'o motor nem chegou a ser ligado');
  const b = montar({ capturaEnv: { CAPTURA_FALSA_ACABA: '4', CAPTURA_FALSA_MS: '30' } });
  t.after(() => b.d.encerrar());
  await b.d.comecar({});
  const e = await b.espera((x) => x.t === 'erro');
  assert.strictEqual(e.erro, 'o microfone parou de mandar som');
  await b.espera((x) => x.t === 'parou' && x.motivo === 'erro');
});

test('ditado: muito tempo sem fala para sozinho; o motor ocioso é desligado e o ditado seguinte liga outro', async (t) => {
  const log = path.join(casa, 'motor-ocioso.log');
  const { d, espera } = montar({ motorEnv: { DITADO_FALSO_MUDO: '1', DITADO_FALSO_LOG: log }, semFalaMs: 300, ociosoMs: 200 });
  t.after(() => d.encerrar());
  await d.comecar({});
  const e = await espera((x) => x.t === 'parou');
  assert.strictEqual(e.motivo, 'silencio');
  assert.strictEqual(d._motorVivo(), true);
  for (let i = 0; i < 100 && d._motorVivo(); i++) await dorme(20);
  assert.strictEqual(d._motorVivo(), false, 'o motor foi desligado depois de ficar sem uso');
  await d.comecar({});
  await d.parar();
  assert.strictEqual(fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((l) => l.pid).length, 2);
});

test('ditado: o motor que não responde ao parar não prende a pessoa; fechar o app derruba o motor e o microfone', async (t) => {
  const log = path.join(casa, 'motor-surdo.log');
  const { d, capturas, espera } = montar({ motorEnv: { DITADO_FALSO_SURDO: '1', DITADO_FALSO_LOG: log }, pararMs: 250 });
  t.after(() => d.encerrar());
  await d.comecar({});
  await espera((x) => x.t === 'parcial');
  const t0 = Date.now();
  await d.parar();
  assert.ok(Date.now() - t0 < 2000, 'terminou sozinho depois do prazo');
  assert.strictEqual(d.estado().estado, 'parado');
  await d.comecar({});
  const motor = JSON.parse(fs.readFileSync(log, 'utf8').trim().split('\n')[0]).pid;
  const mic = capturas[1].pid;
  d.encerrar();
  for (let i = 0; i < 150 && (vivo(motor) || vivo(mic)); i++) await dorme(20);
  assert.deepStrictEqual([vivo(motor), vivo(mic)], [false, false]);
});

test('ditado: as peças de verdade nunca abrem microfone nem motor num teste de tela; monitor não é microfone', async () => {
  const antes = { m: process.env.ORQ_DITADO_MOTOR, c: process.env.ORQ_DITADO_CAPTURA };
  delete process.env.ORQ_DITADO_MOTOR; delete process.env.ORQ_DITADO_CAPTURA;
  try {
    await assert.rejects(D.capturarMicrofone({ emTeste: true }), /sem microfone nos testes/);
    await assert.rejects(D.capturarMicrofone({ aparelho: () => ({ descricao: 'Monitor of Fone', nome: 'alsa_output.x.monitor' }) }), /som do computador/);
    await assert.rejects(D.capturarMicrofone({ ffmpeg: path.join(casa, 'nao-existe'), aparelho: () => ({ descricao: 'Fone', nome: 'alsa_input.x' }) }), /não consegui abrir o microfone/);
    const transcricao = (nvidia, locais = ['small', 'large-v3-turbo']) => ({
      acharMotorSemTravar: async () => ({ ok: true, python: '/py/bin/python', versao: '1.2.1' }),
      maquina: () => ({ nucleos: 8, memoriaGB: 16, nvidia }),
      modelos: () => [{ id: 'small', nome: 'Leve', local: locais.includes('small') }, { id: 'large-v3-turbo', nome: 'Robusto', local: locais.includes('large-v3-turbo') }, { id: 'large-v3', nome: 'Melhor', local: false }],
    });
    const cfg = (c) => ({ ler: () => ({ vozPython: '', ditadoModelo: '', idioma: 'pt-BR', ...c }) });
    await assert.rejects(D.motorDeVerdade({ transcricao: transcricao(null), config: cfg({}), emTeste: true })(), /sem motor de ditado nos testes/);
    // O padrão sem placa NVIDIA: o leve escreve enquanto a pessoa fala e, quando o computador tem folga
    // e o robusto já está nele, o robusto corrige cada frase por trás. Com a placa: o robusto direto.
    assert.deepStrictEqual(await D.motorDeVerdade({ transcricao: transcricao(null), config: cfg({}) })(), { comando: '/py/bin/python', args: [D.SCRIPT, '--modelo', 'small', '--idioma', 'pt', '--revisor', 'large-v3-turbo'] });
    assert.deepStrictEqual((await D.motorDeVerdade({ transcricao: transcricao({ nome: 'RTX', memoriaGB: 8 }), config: cfg({}) })()).args.slice(1), ['--modelo', 'large-v3-turbo', '--idioma', 'pt']);
    assert.deepStrictEqual((await D.motorDeVerdade({ transcricao: transcricao(null, ['small']), config: cfg({}) })()).args.slice(1), ['--modelo', 'small', '--idioma', 'pt'], 'o robusto não está no computador: não corrige');
    assert.deepStrictEqual((await D.motorDeVerdade({ transcricao: { ...transcricao(null), maquina: () => ({ nucleos: 4, memoriaGB: 8, nvidia: null }) }, config: cfg({}) })()).args.slice(1), ['--modelo', 'small', '--idioma', 'pt'], 'computador sem folga: não corrige');
    // A pessoa pode desligar a correção, escolher quem corrige, ou usar só o robusto (frase por frase).
    assert.deepStrictEqual((await D.motorDeVerdade({ transcricao: transcricao(null), config: cfg({ ditadoRevisor: 'nenhum' }) })()).args.slice(1), ['--modelo', 'small', '--idioma', 'pt']);
    assert.deepStrictEqual((await D.motorDeVerdade({ transcricao: transcricao(null), config: cfg({ ditadoModelo: 'large-v3-turbo' }) })()).args.slice(1), ['--modelo', 'large-v3-turbo', '--idioma', 'pt'], 'com o robusto no ditado não há o que corrigir');
    assert.deepStrictEqual((await D.motorDeVerdade({ transcricao: transcricao(null), config: cfg({ ditadoModelo: 'large-v3-turbo', ditadoRevisor: 'large-v3-turbo' }) })()).args.slice(1), ['--modelo', 'large-v3-turbo', '--idioma', 'pt']);
    await assert.rejects(D.motorDeVerdade({ transcricao: transcricao(null), config: cfg({ ditadoRevisor: 'large-v3' }) })(), /"Melhor", escolhido para corrigir o ditado, ainda não está neste computador/);
    assert.deepStrictEqual((await D.motorDeVerdade({ transcricao: transcricao(null), config: cfg({ ditadoModelo: 'large-v3-turbo', idioma: 'en' }) })()).args.slice(1), ['--modelo', 'large-v3-turbo', '--idioma', 'en']);
    await assert.rejects(D.motorDeVerdade({ transcricao: transcricao(null, []), config: cfg({}) })(), /"Leve" ainda não está neste computador/);
    await assert.rejects(D.motorDeVerdade({ transcricao: { ...transcricao(null), acharMotorSemTravar: async () => ({ ok: false, motivo: 'não achei um Python com o faster-whisper neste computador' }) }, config: cfg({}) })(), /não achei um Python/);
    // As variáveis de teste trocam as duas peças.
    process.env.ORQ_DITADO_MOTOR = JSON.stringify([process.execPath, MOTOR]);
    assert.deepStrictEqual(await D.motorDeVerdade({ transcricao: transcricao(null), config: cfg({}), emTeste: true })(), { comando: process.execPath, args: [MOTOR] });
    process.env.ORQ_DITADO_CAPTURA = JSON.stringify([process.execPath, CAPTURA]);
    const c = await D.capturarMicrofone({ emTeste: true });
    assert.strictEqual(c.microfone, 'microfone de teste');
    c.processo.kill('SIGTERM');
  } finally {
    if (antes.m === undefined) delete process.env.ORQ_DITADO_MOTOR; else process.env.ORQ_DITADO_MOTOR = antes.m;
    if (antes.c === undefined) delete process.env.ORQ_DITADO_CAPTURA; else process.env.ORQ_DITADO_CAPTURA = antes.c;
  }
});

test('ditado: a correção por trás chega com os trechos que ela troca; parar espera a que falta; largar e cortar não deixam passar a atrasada', async (t) => {
  const FECHO = 'Bom dia, quero o relatório das vendas.';
  const COMPRIDA = 'Mande para o time até sexta, sem falta nenhuma, com todos os números do mês e do ano inteiro, por favor.';
  const { d, eventos, espera } = montar({ motorEnv: { DITADO_FALSO_REVISOR: '1', DITADO_FALSO_REVISAO_MS: '120' }, capturaEnv: { CAPTURA_FALSA_MS: '25' } });
  t.after(() => d.encerrar());
  const controle = path.join(casa, 'controle-revisor.json');
  process.env.DITADO_FALSO_CONTROLE = controle;
  t.after(() => { delete process.env.DITADO_FALSO_CONTROLE; });
  fs.writeFileSync(controle, JSON.stringify({ falas: [FECHO, COMPRIDA], revisoes: { [FECHO]: 'Bom dia! Quero o relatório das vendas.' } }));
  await d.comecar({});
  const pronto = await espera((e) => e.t === 'estado' && e.estado === 'ouvindo');
  assert.strictEqual(pronto.revisor, true, 'a tela fica sabendo que há correção por trás');
  const r = await espera((e) => e.t === 'revisao');
  assert.deepStrictEqual(r, { t: 'revisao', id: 1, epoca: 0, de: 0, ate: 0, texto: 'Bom dia! Quero o relatório das vendas.' });
  assert.ok(eventos.indexOf(r) > eventos.findIndex((e) => e.t === 'final' && e.n === 0));
  // Parar logo depois de um fecho: a correção dele (aqui, "fica como está") sai antes do "parou".
  await espera((e) => e.t === 'parcial' && /^Mande/.test(e.texto));
  await d.parar();
  const fim = eventos.filter((e) => ['final', 'revisao', 'parou'].includes(e.t)).slice(-3);
  assert.deepStrictEqual(fim.map((e) => e.t), ['final', 'revisao', 'parou']);
  assert.deepStrictEqual([fim[1].de, fim[1].ate, fim[1].igual], [1, 1, true]);
  // Largar com uma correção a caminho: ela não chega.
  fs.writeFileSync(controle, JSON.stringify({ falas: [FECHO, COMPRIDA] }));
  await d.comecar({});
  await espera((e) => e.t === 'final' && e.id === 2);
  d.largar();
  await dorme(300);
  assert.strictEqual(eventos.filter((e) => e.t === 'revisao' && e.id === 2).length, 0);
  // Cortar com uma correção a caminho: a do trecho antigo não chega; a do seguinte chega na época nova.
  fs.writeFileSync(controle, JSON.stringify({ falas: [FECHO, 'Mande para o time até sexta.'], revisoes: { 'Mande para o time até sexta.': 'Mande para o time até sexta-feira.' } }));
  await d.comecar({});
  await espera((e) => e.t === 'final' && e.id === 3);
  d.cortar('');
  const r3 = await espera((e) => e.t === 'revisao' && e.id === 3);
  assert.deepStrictEqual([r3.epoca, r3.texto], [1, 'Mande para o time até sexta-feira.']);
  assert.strictEqual(eventos.filter((e) => e.t === 'revisao' && e.id === 3 && e.epoca === 0).length, 0);
});

test('ditado: frase por frase (modelo grande sem placa de vídeo): não há prévia; a frase sai inteira, com o aviso de que está escrevendo', async (t) => {
  // Cada frase sai antes de a palavra seguinte chegar (como no motor de verdade, que faz uma coisa de cada vez).
  const { d, eventos, espera } = montar({ motorEnv: { DITADO_FALSO_SEM_PREVIA: '1', DITADO_FALSO_FRASE_MS: '15' }, capturaEnv: { CAPTURA_FALSA_MS: '45' } });
  t.after(() => d.encerrar());
  const controle = path.join(casa, 'controle-frase.json');
  process.env.DITADO_FALSO_CONTROLE = controle;
  t.after(() => { delete process.env.DITADO_FALSO_CONTROLE; });
  fs.writeFileSync(controle, JSON.stringify({ falas: ['Primeira frase inteira.', 'curta', 'um dois três quatro cinco seis sete oito nove dez onze doze treze quatorze quinze dezesseis dezessete dezoito.'], juntas: { curta: 'Primeira frase inteira, curta.' } }));
  await d.comecar({});
  const ouvindo = await espera((e) => e.t === 'estado' && e.estado === 'ouvindo');
  assert.strictEqual(ouvindo.previa, false, 'a tela fica sabendo que o texto vem frase por frase');
  const junta = await espera((e) => e.t === 'revisao');
  assert.deepStrictEqual(junta, { t: 'revisao', id: 1, epoca: 0, de: 0, ate: 1, texto: 'Primeira frase inteira, curta.' }, 'a frase curta sai junto com a anterior');
  assert.strictEqual(eventos.filter((e) => e.t === 'parcial').length, 0, 'nenhuma prévia');
  await espera(() => eventos.filter((e) => e.t === 'escrevendo' && e.sim === false).length >= 2); // o aviso de que a segunda acabou
  const ordem = eventos.filter((e) => ['escrevendo', 'final', 'revisao'].includes(e.t)).slice(0, 6).map((e) => (e.t === 'escrevendo' ? `escrevendo:${e.sim}` : e.t));
  assert.deepStrictEqual(ordem, ['escrevendo:true', 'final', 'escrevendo:false', 'escrevendo:true', 'revisao', 'escrevendo:false']);
  assert.deepStrictEqual(d.estado().previa, false);
  // Parar no meio da terceira fala: o que foi dito dela sai inteiro antes do "parou".
  await dorme(200);
  await d.parar();
  const fim = eventos.filter((e) => ['final', 'revisao', 'parou'].includes(e.t)).slice(-2);
  assert.deepStrictEqual(fim.map((e) => e.t), ['final', 'parou']);
  assert.match(fim[0].texto, /^um dois/);
});

test('ditado: o quadro que vai ao motor é tipo + tamanho + corpo', () => {
  const q = D.quadro('A', Buffer.from([1, 2, 3]));
  assert.deepStrictEqual([...q], [65, 3, 0, 0, 0, 1, 2, 3]);
  assert.strictEqual(D.recomendado({ nvidia: { memoriaGB: 4 } }), 'small');
  assert.strictEqual(D.recomendado({ nvidia: { memoriaGB: 6 } }), 'large-v3-turbo');
  assert.strictEqual(D.recomendado({}), 'small');
  assert.strictEqual(D.recomendado({ nucleos: 14, memoriaGB: 30 }), 'small', 'sem placa NVIDIA o padrão é o leve, por mais folga que o computador tenha');
});
