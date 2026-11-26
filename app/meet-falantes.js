// Quem falou na reunião, pelo Google Meet (pedido de 26/11: "temos como fazer a gravação
// identificar quem está falando? Como o Granola faz isso?").
//
// A gravação separa só "Você" (o microfone) e "Outros" (o som do computador). Para pôr o nome de
// cada um nas falas dos Outros, uma extensão do navegador (extensao-meet/) lê, na página do Meet,
// os nomes dos participantes e quem está falando a cada momento (pela legenda do próprio Meet) e
// manda isso a um programa pequeno deste computador (extensao-meet/orq-meet-host.py), pelo canal
// que o navegador oferece às extensões (native messaging): sem porta de rede aberta.
//
// O app e o programa conversam por arquivos em ~/.local/share/orq-app/meet/ (pasta 700):
//   estado.json      o app escreve quando começa e quando para de gravar: { gravando, inicio }.
//                    O programa só guarda alguma coisa enquanto há gravação (fora dela, nada).
//   eventos.jsonl    o programa acrescenta uma linha por evento, sempre ao fim:
//                    { t: 'falando', ts, quem }        alguém fala (repetido a cada ~1 s)
//                    { t: 'participantes', ts, nomes, eu }
// Na montagem da nota, o app lê os eventos do intervalo da reunião e dá a cada fala dos Outros o
// nome de quem mais falou naquele trecho. Sem eventos (outra plataforma, extensão desligada),
// a nota fica como sempre foi: "Outros". O áudio nunca passa pela extensão.
const fs = require('fs');
const os = require('os');
const path = require('path');

const pasta = () => path.join(os.homedir(), '.local', 'share', 'orq-app', 'meet');
const arquivoEstado = () => path.join(pasta(), 'estado.json');
const arquivoEventos = () => path.join(pasta(), 'eventos.jsonl');

// Falas seguidas da mesma pessoa, com até este vão entre um aviso e outro, são uma fala só.
const VAO_MS = 2500;
// A legenda do Meet aparece um pouco depois da fala: os intervalos andam esse tanto para trás.
const ATRASO_LEGENDA_MS = 1000;
// Folga em volta de cada trecho transcrito, para pegar a legenda que chegou na borda.
const FOLGA_MS = 1000;

function garantirPasta() {
  fs.mkdirSync(pasta(), { recursive: true, mode: 0o700 });
  try { fs.chmodSync(pasta(), 0o700); } catch { /* segue */ }
}

// O app avisa o programa do navegador se há gravação (troca o arquivo inteiro de uma vez).
function marcarGravando(inicio) {
  garantirPasta();
  const tmp = path.join(pasta(), `.estado-${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(inicio ? { gravando: true, inicio } : { gravando: false }) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, arquivoEstado());
}

const nomeValido = (n) => typeof n === 'string' && n.trim().length >= 1 && n.length <= 120;

// Eventos entre ini e fim (ms), com uma margem; linha estragada é pulada.
function lerEventos(ini, fim, { arquivo = arquivoEventos() } = {}) {
  let texto = '';
  try { texto = fs.readFileSync(arquivo, 'utf8'); } catch { return []; }
  const de = ini - 60000, ate = fim + 60000;
  const saida = [];
  for (const l of texto.split('\n')) {
    if (!l.trim()) continue;
    let o;
    try { o = JSON.parse(l); } catch { continue; }
    if (!o || typeof o.ts !== 'number' || o.ts < de || o.ts > ate) continue;
    if (o.t === 'falando' && nomeValido(o.quem)) saida.push({ t: 'falando', ts: o.ts, quem: o.quem.trim() });
    else if (o.t === 'participantes' && Array.isArray(o.nomes)) saida.push({ t: 'participantes', ts: o.ts, nomes: o.nomes.filter(nomeValido).map((n) => n.trim()).slice(0, 200), eu: nomeValido(o.eu) ? o.eu.trim() : null });
  }
  return saida.sort((a, b) => a.ts - b.ts);
}

// Os avisos de "falando" viram intervalos por pessoa: [{ quem, ini, fim }] em ms.
function intervalos(eventos) {
  const abertos = new Map();
  const saida = [];
  for (const e of eventos) {
    if (e.t !== 'falando') continue;
    const a = abertos.get(e.quem);
    if (a && e.ts - a.fim <= VAO_MS) { a.fim = e.ts; continue; }
    if (a) saida.push(a);
    abertos.set(e.quem, { quem: e.quem, ini: e.ts, fim: e.ts });
  }
  for (const a of abertos.values()) saida.push(a);
  return saida.map((a) => ({ quem: a.quem, ini: a.ini - ATRASO_LEGENDA_MS, fim: a.fim + 500 - ATRASO_LEGENDA_MS })).sort((x, y) => x.ini - y.ini);
}

// Quem esteve na reunião e quem é a própria pessoa (o último "eu" informado).
function participantes(eventos) {
  const nomes = new Set();
  let eu = null;
  for (const e of eventos) {
    if (e.t === 'participantes') { for (const n of e.nomes) nomes.add(n); if (e.eu) eu = e.eu; }
    if (e.t === 'falando') nomes.add(e.quem);
  }
  if (eu) nomes.delete(eu);
  return { nomes: [...nomes], eu };
}

// Dá a cada trecho ({ ini, fim } em segundos desde o começo da gravação) o nome de quem mais
// falou nele, sem contar a própria pessoa (a voz dela é a trilha "Você"). Sem ninguém: null.
function atribuir(trechos, ivs, inicio, eu = null) {
  return trechos.map((t) => {
    const a = inicio + t.ini * 1000 - FOLGA_MS;
    const b = inicio + Math.max(t.fim, t.ini) * 1000 + FOLGA_MS;
    const soma = new Map();
    for (const i of ivs) {
      if (eu && i.quem === eu) continue;
      const s = Math.min(b, i.fim) - Math.max(a, i.ini);
      if (s > 0) soma.set(i.quem, (soma.get(i.quem) || 0) + s);
    }
    let melhor = null, max = 0;
    for (const [q, s] of soma) if (s > max) { melhor = q; max = s; }
    return melhor;
  });
}

// Para a nota: os trechos dos Outros com o nome de quem falou (quando se sabe) e o resumo do que
// veio do Meet. Sem nada do Meet, devolve null e a nota fica como antes.
function nomear(meta, trechosOutros, { arquivo } = {}) {
  if (!meta || !meta.inicio || !meta.fim) return null;
  const ev = lerEventos(meta.inicio, meta.fim, { arquivo });
  if (!ev.length) return null;
  const { nomes, eu } = participantes(ev);
  const quem = atribuir(trechosOutros || [], intervalos(ev), meta.inicio, eu);
  return { participantes: nomes, eu, quem, nomeados: quem.filter(Boolean).length };
}

module.exports = { pasta, arquivoEstado, arquivoEventos, marcarGravando, lerEventos, intervalos, participantes, atribuir, nomear, VAO_MS, ATRASO_LEGENDA_MS };
