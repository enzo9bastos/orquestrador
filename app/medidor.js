// Medidor de desempenho do processo principal. Mede o atraso do laço de eventos
// (perf_hooks.monitorEventLoopDelay), quanto leva cada chamada cronometrada
// (ex.: o retrato do coletor) e a CPU do processo. Nos testes de tela
// (ORQ_APP_E2E) o main.js o expõe pelo IPC 'diag:laco'.
const { monitorEventLoopDelay } = require('perf_hooks');

const RESOLUCAO = 10; // ms: o histograma já conta o intervalo do próprio temporizador
const histograma = monitorEventLoopDelay({ resolution: RESOLUCAO });
// O histograma conta AMOSTRAS: um travamento de 300 ms vale uma amostra só, e
// dez deles em 20 s ficam abaixo do p99. Por isso também guardamos o atraso de
// cada batida do temporizador e calculamos o p99 PONDERADO PELO TEMPO: o atraso
// L tal que 99 % do tempo de relógio passou em batidas com atraso <= L.
let batidas = [];
let ultimaBatida = 0;
let tempos = {}; // nome → [ms de cada chamada]
let cpuIni = process.cpuUsage();
let relogioIni = process.hrtime.bigint();

function iniciar() {
  histograma.enable();
  ultimaBatida = Date.now();
  const batida = setInterval(() => {
    const agora = Date.now();
    const d = Math.max(0, agora - ultimaBatida - RESOLUCAO);
    ultimaBatida = agora;
    if (batidas.length < 200000) batidas.push(d);
  }, RESOLUCAO);
  batida.unref();
  // Laço lento vai para o log (a cada 60 s, só se o p99 passar de 100 ms).
  const aviso = setInterval(() => {
    const s = fotografia();
    if (s.laco.p99 > 100) console.error(`[medidor] atraso do laço: p50 ${s.laco.p50} ms, p99 ${s.laco.p99} ms, máx ${s.laco.max} ms`);
    reiniciar();
  }, 60000);
  aviso.unref();
}

function reiniciar() {
  histograma.reset();
  batidas = [];
  ultimaBatida = Date.now();
  tempos = {};
  cpuIni = process.cpuUsage();
  relogioIni = process.hrtime.bigint();
}

// Atraso = valor medido menos o intervalo do temporizador (nunca negativo).
const atraso = (ns) => Math.max(0, Math.round((ns / 1e6 - RESOLUCAO) * 10) / 10);

function ponderado() {
  const o = [...batidas].sort((a, b) => a - b);
  const total = o.reduce((s, d) => s + d + RESOLUCAO, 0);
  let acum = 0; let p99 = 0; let parado = 0;
  for (const d of o) { acum += d + RESOLUCAO; if (!p99 && acum >= total * 0.99) p99 = d; if (d > 50) parado += d; }
  return { p99Ponderado: p99, porcentoDoTempoTravado: total ? Math.round((parado / total) * 1000) / 10 : 0 };
}

function fotografia() {
  const cpu = process.cpuUsage(cpuIni);
  const decorridoMs = Number(process.hrtime.bigint() - relogioIni) / 1e6;
  const resumo = {};
  for (const [nome, lista] of Object.entries(tempos)) {
    const o = [...lista].sort((a, b) => a - b);
    resumo[nome] = { n: o.length, p50: o[Math.floor(o.length * 0.5)] || 0, p99: o[Math.min(o.length - 1, Math.floor(o.length * 0.99))] || 0, max: o[o.length - 1] || 0 };
  }
  return {
    laco: { amostras: histograma.count, p50: atraso(histograma.percentile(50)), p99: atraso(histograma.percentile(99)), max: atraso(histograma.max), ...ponderado() },
    chamadas: resumo,
    cpu: { usuarioMs: Math.round(cpu.user / 1000), sistemaMs: Math.round(cpu.system / 1000), janelaMs: Math.round(decorridoMs), porcentoDeUmNucleo: Math.round(((cpu.user + cpu.system) / 1000 / decorridoMs) * 1000) / 10 },
  };
}

// Cronometra fn (síncrona ou que devolve promessa) e guarda o tempo sob "nome".
function medir(nome, fn) {
  const t0 = process.hrtime.bigint();
  const fim = () => { (tempos[nome] ||= []).push(Number(process.hrtime.bigint() - t0) / 1e6); };
  let r;
  try { r = fn(); } catch (e) { fim(); throw e; }
  if (r && typeof r.then === 'function') return r.then((v) => { fim(); return v; }, (e) => { fim(); throw e; });
  fim();
  return r;
}

module.exports = { iniciar, reiniciar, fotografia, medir };
