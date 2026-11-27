// Fundo da extensão: guarda a conversa com o programa do computador (orq-meet-host.py, por
// native messaging) e repassa a ele o que a página do Meet viu. O programa só guarda enquanto o
// App de Orquestração grava uma reunião; a página pergunta isso aqui a cada poucos segundos.
const HOST = 'com.orquestrador.meet';
let porta = null;
let gravando = false;
let erro = '';

function conectar() {
  try {
    porta = chrome.runtime.connectNative(HOST);
    erro = '';
    porta.onMessage.addListener((m) => { if (m && m.t === 'estado') gravando = !!m.gravando; });
    porta.onDisconnect.addListener(() => {
      erro = (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'desconectado';
      porta = null;
      gravando = false;
    });
  } catch (e) { porta = null; gravando = false; erro = String(e && e.message || e); }
}
function mandar(m) {
  if (!porta) conectar();
  try { if (porta) porta.postMessage(m); } catch { porta = null; gravando = false; }
}

// Assim que é carregada (ou o navegador abre), diz "oi" ao programa: o app fica sabendo na hora que
// a extensão está funcionando, sem esperar uma ligação do Meet (pedido de 27/11).
// Mensagem avulsa: o programa abre, responde e fecha (não fica um programa aberto à toa).
const oi = () => { try { chrome.runtime.sendNativeMessage(HOST, { t: 'estado' }, () => { void chrome.runtime.lastError; }); } catch { /* sem o programa */ } };
chrome.runtime.onInstalled.addListener(oi);
chrome.runtime.onStartup.addListener(oi);

chrome.runtime.onMessage.addListener((m, _de, responder) => {
  if (!m || typeof m !== 'object') return;
  if (m.t === 'estado') { mandar({ t: 'estado' }); responder({ gravando, conectado: !!porta, erro }); return; }
  if ((m.t === 'falando' || m.t === 'participantes') && gravando) mandar(m);
});
