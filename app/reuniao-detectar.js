// Detectar uma reunião começando e acabando, sem bot e sem ler nada da ligação: pelo servidor de som
// (PipeWire), o app vê quais programas estão usando o microfone. Uma ligação no Meet, Zoom, Teams,
// Slack ou Discord abre o microfone pelo navegador ou pelo programa; quando ela acaba, o microfone
// é solto. Só o nome do programa é lido (nunca o áudio, o título da aba ou quem está na ligação).
//
// criar({ listar, aoMudar, agora, intervalo, gravando, nossos })
//   listar()   → Promise<[{ app, binario, pid }]> (quem está usando o microfone agora)
//   aoMudar(e) → { evento: 'detectada', app, nome } quando uma ligação passa de ~10 s
//                { evento: 'acabou', app, nome } quando o programa da ligação solta o microfone por ~60 s
//   gravando() → se o app está gravando uma reunião (aí o 'acabou' importa)
//   nossos()   → pids do próprio app (o ffmpeg da gravação também usa o microfone)
const { execFile } = require('child_process');

// Programas de reunião conhecidos: pelo nome do executável ou do programa no servidor de som.
const PROGRAMAS = [
  [/^(google-chrome|chrome|chromium|chromium-browser|brave|brave-browser|microsoft-edge|msedge|vivaldi|opera)/i, 'o navegador'],
  [/^(firefox|firefox-esr|librewolf|zen)/i, 'o navegador'],
  [/zoom/i, 'o Zoom'],
  [/teams/i, 'o Teams'],
  [/slack/i, 'o Slack'],
  [/discord|vesktop/i, 'o Discord'],
  [/webex/i, 'o Webex'],
  [/skype/i, 'o Skype'],
  [/whatsapp/i, 'o WhatsApp'],
  [/jitsi/i, 'o Jitsi'],
];
function nomeDe(c) {
  for (const [re, nome] of PROGRAMAS) if (re.test(c.binario || '') || re.test(c.app || '')) return nome;
  return null;
}

// Quem está usando o microfone agora, pelo pw-dump (só os nós de captura de áudio).
function listarPipeWire({ comando = process.env.ORQ_PW_DUMP || 'pw-dump' } = {}) {
  return new Promise((ok) => {
    execFile(comando, [], { timeout: 4000, maxBuffer: 16 * 1024 * 1024 }, (erro, saida) => {
      if (erro) { ok(null); return; }
      let d;
      try { d = JSON.parse(String(saida)); } catch { ok(null); return; }
      const l = [];
      for (const o of Array.isArray(d) ? d : []) {
        const p = (o && o.info && o.info.props) || {};
        if (p['media.class'] !== 'Stream/Input/Audio') continue;
        // Captura do som do computador (monitor) não é microfone: fica de fora.
        if (p['stream.capture.sink'] === true || p['stream.capture.sink'] === 'true') continue;
        l.push({ app: String(p['application.name'] || ''), binario: String(p['application.process.binary'] || ''), pid: Number(p['application.process.id']) || null });
      }
      ok(l);
    });
  });
}

function criar({ listar = listarPipeWire, aoMudar = () => {}, agora = Date.now, intervalo = 4000, gravando = () => false, nossos = () => [], minimoMs = 10000, acabouMs = 60000 }) {
  const vistos = new Map(); // nome do programa → desde quando usa o microfone
  let avisado = null; // nome do programa da ligação já avisada (não avisa de novo até ela acabar)
  let ultimaVez = 0; // última vez em que o programa avisado usava o microfone
  let relogio = null;
  let rodando = false;

  async function passo() {
    if (rodando) return;
    rodando = true;
    try {
      const l = await listar();
      if (!l) return; // sem PipeWire: não dá para saber; fica quieto
      const meus = new Set(nossos());
      const agoraMs = agora();
      const ativos = new Set();
      for (const c of l) {
        if (c.pid && meus.has(c.pid)) continue;
        if (/^(ffmpeg|lavf)/i.test(c.app) || /^ffmpeg$/i.test(c.binario)) continue;
        const nome = nomeDe(c);
        if (nome) ativos.add(nome);
      }
      for (const n of [...vistos.keys()]) if (!ativos.has(n)) vistos.delete(n);
      for (const n of ativos) if (!vistos.has(n)) vistos.set(n, agoraMs);
      if (avisado) {
        if (ativos.has(avisado)) ultimaVez = agoraMs;
        else if (agoraMs - ultimaVez >= acabouMs) {
          const nome = avisado;
          avisado = null;
          if (gravando()) aoMudar({ evento: 'acabou', nome });
        }
        return;
      }
      for (const [nome, desde] of vistos) {
        if (agoraMs - desde < minimoMs) continue;
        avisado = nome; ultimaVez = agoraMs;
        if (!gravando()) aoMudar({ evento: 'detectada', nome });
        return;
      }
    } finally { rodando = false; }
  }
  return {
    ligar() { if (!relogio) { relogio = setInterval(() => { passo().catch(() => {}); }, intervalo); if (relogio.unref) relogio.unref(); } },
    desligar() { clearInterval(relogio); relogio = null; vistos.clear(); avisado = null; },
    passo,
    // A pessoa disse "agora não": esta ligação não é avisada de novo (a próxima, sim).
    estado: () => ({ avisado, vistos: [...vistos.keys()] }),
  };
}

module.exports = { criar, listarPipeWire, nomeDe };
