// Ditado: a pessoa fala e o texto aparece na caixa de mensagem enquanto ela fala (plano de voz, V2).
//
// O microfone é lido pelo ffmpeg (o mesmo caminho do modo reunião) e o som vai direto, por um
// cano, para o motor (voz/ditado.py, o faster-whisper deste computador). Nada é gravado em disco
// e nada sai do computador. Quem envia a mensagem é a pessoa: daqui só sai texto para a caixa.
//
//   criar({ motor, capturar, aoEvento, ociosoMs, semFalaMs, pararMs })
//     motor()        → Promise<{ comando, args, env }> do processo do motor (lança se não houver)
//     capturar()     → Promise<{ processo, microfone }>: o processo escreve na saída o som em PCM de
//                      16 bits, 16 kHz, mono (lança se o microfone não abrir)
//     aoEvento(e)    → { t: 'estado', estado, id, microfone, previa, revisor }
//                          previa: o texto aparece enquanto a pessoa fala (senão, frase por frase)
//                          revisor: há um modelo maior corrigindo por trás
//                      { t: 'escrevendo', id, epoca, sim }         sem prévia: uma frase está sendo transcrita
//                      { t: 'nivel', v }                           volume do microfone, de 0 a 1
//                      { t: 'parcial', id, epoca, texto }
//                      { t: 'final', id, epoca, n, texto }         n conta os trechos fechados do ditado
//                      { t: 'revisao', id, epoca, de, ate, texto } o texto corrigido dos trechos de..ate
//                      { t: 'revisao', id, epoca, de, ate, igual: true }  esses trechos ficam como estão
//                      { t: 'parou', id, motivo }                  motivo: 'pedido' | 'silencio' | 'erro'
//                      { t: 'erro', erro }
//   .comecar({ contexto }) → { id, microfone }
//   .parar(motivo)   → fecha o trecho aberto e termina (espera o motor entregar o fim)
//   .largar()        → termina sem fechar o trecho (o que estava na caixa já foi enviado)
//   .cortar(contexto)→ larga o trecho aberto (a pessoa mexeu no texto) e devolve a época nova
//   .estado()        → { estado: 'parado' | 'preparando' | 'ouvindo' | 'terminando', id, microfone }
//   .encerrar()      → derruba o motor e a captura (o app está fechando)
//
// O motor fica carregado entre um ditado e outro (o segundo começa na hora) e é desligado depois
// de ociosoMs sem uso, para devolver a memória.
const { spawn } = require('child_process');
const path = require('path');

const SCRIPT = path.join(__dirname, 'voz', 'ditado.py');

function quadro(tipo, corpo) {
  const c = Buffer.alloc(5);
  c.write(tipo, 0, 'latin1');
  c.writeUInt32LE(corpo.length, 1);
  return Buffer.concat([c, corpo]);
}

function criar({ motor, capturar, aoEvento = () => {}, ociosoMs = 5 * 60 * 1000, semFalaMs = 60 * 1000, pararMs = 20 * 1000 }) {
  let estado = 'parado';
  let n = 0;
  let id = null; // o ditado de agora (os eventos de um ditado antigo são ignorados)
  let epoca = 0;
  let microfone = null;
  let captura = null;
  let motorP = null, motorPronto = false, motorChave = '', motorRevisor = false, motorPrevia = true;
  let comecando = null;
  let aoParar = null; // quem espera o motor dizer que terminou
  let tOcioso = null, tSemFala = null;
  let restoNivel = Buffer.alloc(0), ultimoNivel = 0;

  const dizer = (e) => { try { aoEvento(e); } catch { /* a tela fechou */ } };
  const mudar = (novo) => { estado = novo; dizer({ t: 'estado', estado, id, microfone, previa: motorPrevia, revisor: motorRevisor }); };
  const escrever = (tipo, corpo) => {
    if (!motorP || !motorP.stdin.writable) return;
    try { motorP.stdin.write(quadro(tipo, Buffer.isBuffer(corpo) ? corpo : Buffer.from(JSON.stringify(corpo)))); } catch { /* o motor saiu */ }
  };

  function soltarCaptura() {
    const c = captura;
    captura = null;
    if (!c) return;
    try { c.processo.kill('SIGTERM'); } catch { /* já saiu */ }
    const t = setTimeout(() => { try { c.processo.kill('SIGKILL'); } catch { /* já saiu */ } }, 2000);
    if (t.unref) t.unref();
  }
  function derrubarMotor() {
    const p = motorP;
    motorP = null; motorPronto = false; motorChave = '';
    if (!p) return;
    try { p.kill('SIGTERM'); } catch { /* já saiu */ }
    const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* já saiu */ } }, 2000);
    if (t.unref) t.unref();
  }
  function armarOcioso() {
    clearTimeout(tOcioso);
    tOcioso = setTimeout(() => { if (estado === 'parado') derrubarMotor(); }, ociosoMs);
    if (tOcioso.unref) tOcioso.unref();
  }
  function armarSemFala() {
    clearTimeout(tSemFala);
    if (!semFalaMs) return;
    tSemFala = setTimeout(() => { if (estado === 'ouvindo' || estado === 'preparando') parar('silencio').catch(() => {}); }, semFalaMs);
    if (tSemFala.unref) tSemFala.unref();
  }
  // O ditado acabou (por pedido, por silêncio ou por erro): tudo volta ao começo.
  function acabar(motivo, erro) {
    if (estado === 'parado') return;
    const qual = id;
    clearTimeout(tSemFala);
    soltarCaptura();
    id = null;
    if (erro) dizer({ t: 'erro', erro });
    estado = 'parado';
    dizer({ t: 'parou', id: qual, motivo });
    dizer({ t: 'estado', estado, id: null, microfone });
    const f = aoParar;
    aoParar = null;
    if (f) f();
    armarOcioso();
  }

  function aoMotor(e) {
    if (!e || typeof e !== 'object') return;
    if (e.t === 'pronto') {
      motorPronto = true;
      motorRevisor = !!e.revisor;
      motorPrevia = e.previa !== false;
      if (estado === 'preparando') mudar('ouvindo');
    } else if (e.t === 'parcial' || e.t === 'final') {
      if (id === null || e.id !== id || typeof e.texto !== 'string') return;
      if (e.texto) armarSemFala();
      dizer({ t: e.t, id, epoca: Number(e.epoca) || 0, ...(e.t === 'final' ? { n: Number(e.n) || 0 } : {}), texto: e.texto.slice(0, 8000) });
    } else if (e.t === 'revisao') {
      if (id === null || e.id !== id) return;
      const base = { t: 'revisao', id, epoca: Number(e.epoca) || 0, de: Number(e.de) || 0, ate: Number(e.ate) || 0 };
      if (typeof e.texto === 'string' && e.texto) armarSemFala();
      dizer(typeof e.texto === 'string' && e.texto ? { ...base, texto: e.texto.slice(0, 8000) } : { ...base, igual: true });
    } else if (e.t === 'escrevendo') {
      if (id !== null && e.id === id) dizer({ t: 'escrevendo', id, epoca: Number(e.epoca) || 0, sim: e.sim === true });
    } else if (e.t === 'parou') {
      if (e.id === id && estado === 'terminando') acabar(motivoDoParar);
    } else if (e.t === 'erro') {
      const texto = String(e.erro || 'erro').slice(0, 400);
      if (estado !== 'parado') acabar('erro', texto);
    }
  }
  let motivoDoParar = 'pedido';

  function garantirMotor(m) {
    const chave = JSON.stringify([m.comando, m.args, m.env || null]);
    if (motorP && motorChave === chave) return;
    derrubarMotor();
    const p = spawn(m.comando, m.args, { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONUNBUFFERED: '1', ...(m.env || {}) } });
    motorP = p; motorChave = chave; motorPronto = false; motorRevisor = false; motorPrevia = true;
    let resto = '', errSaida = '';
    p.stdin.on('error', () => { /* o motor saiu com o cano aberto */ });
    p.stdout.on('data', (d) => {
      if (motorP !== p) return;
      resto += d;
      const linhas = resto.split('\n');
      resto = linhas.pop();
      for (const l of linhas) { let e; try { e = JSON.parse(l); } catch { continue; } aoMotor(e); }
    });
    p.stderr.on('data', (d) => { errSaida = (errSaida + d).slice(-2000); });
    const caiu = (motivo) => {
      if (motorP !== p) return;
      motorP = null; motorPronto = false; motorChave = '';
      if (estado !== 'parado') acabar('erro', motivo);
    };
    p.on('error', (e) => caiu(`não consegui rodar o motor do ditado: ${e.message}`));
    p.on('close', (c) => caiu(`o motor do ditado parou${errSaida.trim() ? `: ${errSaida.trim().split('\n').pop().slice(0, 300)}` : ` (código ${c})`}`));
  }

  // O volume do microfone (para a pessoa ver que ele está ouvindo), no máximo 12 vezes por segundo.
  function nivel(d) {
    const b = restoNivel.length ? Buffer.concat([restoNivel, d]) : d;
    const pares = b.length >> 1;
    restoNivel = b.length & 1 ? b.subarray(b.length - 1) : Buffer.alloc(0);
    if (!pares) return;
    let soma = 0;
    for (let i = 0; i < pares; i++) { const x = b.readInt16LE(i * 2); soma += x * x; }
    const agora = Date.now();
    if (agora - ultimoNivel < 80) return;
    ultimoNivel = agora;
    const db = 20 * Math.log10(Math.sqrt(soma / pares) / 32768 + 1e-9);
    dizer({ t: 'nivel', v: Math.max(0, Math.min(1, (db + 55) / 45)) });
  }

  async function comecar({ contexto = '' } = {}) {
    if (estado === 'preparando' || estado === 'ouvindo') return { id, microfone };
    if (comecando) return comecando;
    comecando = (async () => {
      if (estado === 'terminando') await new Promise((ok) => { const antes = aoParar; aoParar = () => { if (antes) antes(); ok(); }; });
      const m = await motor();
      const c = await capturar();
      clearTimeout(tOcioso);
      try { garantirMotor(m); } catch (e) { try { c.processo.kill('SIGTERM'); } catch { /* já saiu */ } throw e; }
      captura = c;
      microfone = c.microfone || null;
      id = ++n;
      epoca = 0;
      restoNivel = Buffer.alloc(0);
      escrever('C', { t: 'comecar', id, contexto: String(contexto || '').slice(-600) });
      c.processo.stdout.on('data', (d) => { if (captura !== c) return; escrever('A', d); nivel(d); });
      c.processo.on('close', () => { if (captura === c && (estado === 'preparando' || estado === 'ouvindo')) acabar('erro', 'o microfone parou de mandar som'); });
      mudar(motorPronto ? 'ouvindo' : 'preparando');
      armarSemFala();
      return { id, microfone };
    })();
    try { return await comecando; } finally { comecando = null; }
  }

  function parar(motivo = 'pedido') {
    if (estado === 'parado') return Promise.resolve({ ok: true });
    if (estado !== 'terminando') {
      motivoDoParar = motivo;
      clearTimeout(tSemFala);
      soltarCaptura();
      mudar('terminando');
      escrever('C', { t: 'parar' });
      // O motor não respondeu a tempo (ou caiu): termina assim mesmo, com o que já chegou.
      const qual = id;
      const t = setTimeout(() => { if (estado === 'terminando' && id === qual) { escrever('C', { t: 'largar' }); acabar(motivoDoParar); } }, pararMs);
      if (t.unref) t.unref();
    }
    return new Promise((ok) => { const antes = aoParar; aoParar = () => { if (antes) antes(); ok({ ok: true }); }; });
  }

  function largar() {
    if (estado === 'parado') return { ok: true };
    escrever('C', { t: 'largar' });
    acabar('pedido');
    return { ok: true };
  }

  function cortar(contexto = '') {
    if (estado !== 'preparando' && estado !== 'ouvindo') return { epoca };
    epoca += 1;
    escrever('C', { t: 'cortar', epoca, contexto: String(contexto || '').slice(-600) });
    return { epoca };
  }

  function encerrar() {
    clearTimeout(tOcioso); clearTimeout(tSemFala);
    soltarCaptura();
    escrever('C', { t: 'sair' });
    derrubarMotor();
    if (estado !== 'parado') { estado = 'parado'; id = null; const f = aoParar; aoParar = null; if (f) f(); }
  }

  return { comecar, parar, largar, cortar, encerrar, estado: () => ({ estado, id, microfone, previa: motorPrevia, revisor: motorRevisor }), _motorVivo: () => !!motorP };
}

// --- as peças de verdade ------------------------------------------------------------
// ORQ_DITADO_MOTOR e ORQ_DITADO_CAPTURA (uma lista em JSON: comando e argumentos) trocam o motor e
// o microfone por programas de teste. Nos testes de tela, sem elas, o ditado não liga: um teste
// nunca abre o microfone de verdade.
const listaDoAmbiente = (nome) => {
  try { const l = JSON.parse(process.env[nome] || ''); return Array.isArray(l) && l.length && l.every((x) => typeof x === 'string') ? l : null; } catch { return null; }
};

// O microfone padrão do sistema, lido pelo ffmpeg. fragment_size: pedaços de 0,1 s, para o som
// chegar logo (o padrão do servidor de som pode segurar bem mais).
function capturarMicrofone({ ffmpeg = process.env.ORQ_DITADO_FFMPEG || 'ffmpeg', aparelho = () => ({ descricao: null, nome: '' }), emTeste = false } = {}) {
  return new Promise((ok, falhou) => {
    const falso = listaDoAmbiente('ORQ_DITADO_CAPTURA');
    if (emTeste && !falso) { falhou(new Error('sem microfone nos testes')); return; }
    const ap = falso ? { descricao: 'microfone de teste', nome: '' } : aparelho();
    if (/\.monitor$/.test(ap.nome || '')) { falhou(new Error('o microfone padrão do sistema é o som do computador (um "monitor"); escolha o microfone nas configurações de som e tente de novo')); return; }
    const [comando, ...args] = falso || [ffmpeg, '-hide_banner', '-loglevel', 'error', '-nostdin', '-f', 'pulse', '-fragment_size', '19200', '-i', '@DEFAULT_SOURCE@', '-ac', '1', '-ar', '16000', '-f', 's16le', '-'];
    const p = spawn(comando, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let erro = '', saiu = false, entregue = false;
    p.stderr.on('data', (d) => { erro = (erro + d).slice(-1000); });
    p.on('error', (e) => { saiu = true; if (!entregue) { entregue = true; falhou(new Error(`não consegui abrir o microfone (${comando}): ${e.message}`)); } });
    p.on('close', () => { saiu = true; if (!entregue) { entregue = true; falhou(new Error(erro.trim().split('\n').pop() || 'o microfone não abriu')); } });
    // Chegou som, ou em 400 ms o programa continua de pé: o microfone abriu.
    const pronto = () => { if (entregue || saiu) return; entregue = true; ok({ processo: p, microfone: ap.descricao || null }); };
    p.stdout.once('data', pronto);
    setTimeout(pronto, 400);
  });
}

// O modelo do ditado: o escolhido nas Configurações ou o recomendado para este computador.
// - Com placa NVIDIA: o robusto, que ali acompanha a fala (o texto aparece enquanto a pessoa fala).
// - Sem ela, num computador com folga (8 núcleos e 12 GB ou mais) e com o robusto já no
//   computador: o robusto também, frase por frase. Ele não acompanha a fala no processador, então
//   cada frase aparece alguns segundos depois da pausa (medido: 1 a 3 s de conta por frase), com
//   uma transcrição só por frase. Erra bem menos que o leve e é o modo que menos usa o processador.
// - Senão: o leve, que acompanha a fala e erra mais.
function recomendado(maquina, modelos) {
  if (maquina && maquina.nvidia && (maquina.nvidia.memoriaGB || 0) >= 6) return 'large-v3-turbo';
  const folga = maquina && (maquina.nucleos || 0) >= 8 && (maquina.memoriaGB || 0) >= 12;
  return folga && (modelos || []).some((x) => x.id === 'large-v3-turbo' && x.local) ? 'large-v3-turbo' : 'small';
}

// Corrigir por trás (só quando a pessoa escolhe, e só com o modelo leve): o leve escreve enquanto
// ela fala e um modelo maior refaz cada frase em outra linha de processamento, trocando o texto
// alguns segundos depois. Usa os dois modelos ao mesmo tempo: mais memória e mais processador.
function revisorDoDitado({ escolhido = '', modelo }) {
  return escolhido && modelo === 'small' && escolhido !== modelo ? escolhido : null;
}

// O processo do motor: o Python com o faster-whisper (transcricao.js acha) rodando voz/ditado.py.
function motorDeVerdade({ transcricao, config, emTeste = false }) {
  return async () => {
    const falso = listaDoAmbiente('ORQ_DITADO_MOTOR');
    if (falso) return { comando: falso[0], args: falso.slice(1) };
    if (emTeste) throw new Error('sem motor de ditado nos testes');
    const c = config.ler();
    const achado = await transcricao.acharMotorSemTravar({ escolhido: c.vozPython });
    if (!achado.ok) throw new Error(`${achado.motivo}. Veja em Configurações › Voz e reuniões`);
    const lista = transcricao.modelos();
    const modelo = c.ditadoModelo || recomendado(transcricao.maquina(), lista);
    const m = lista.find((x) => x.id === modelo);
    if (m && !m.local) throw new Error(`o modelo de voz "${m.nome}" ainda não está neste computador. Veja em Configurações › Voz e reuniões`);
    const revisor = revisorDoDitado({ escolhido: c.ditadoRevisor || '', modelo });
    const r = revisor && lista.find((x) => x.id === revisor);
    if (r && !r.local) throw new Error(`o modelo de voz "${r.nome}", escolhido para corrigir o ditado, ainda não está neste computador. Veja em Configurações › Voz e reuniões`);
    return { comando: achado.python, args: [SCRIPT, '--modelo', modelo, '--idioma', c.idioma === 'en' ? 'en' : 'pt', ...(revisor ? ['--revisor', revisor] : [])] };
  };
}

module.exports = { criar, capturarMicrofone, motorDeVerdade, recomendado, revisorDoDitado, quadro, SCRIPT };
