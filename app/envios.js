// Envios à tela em lote (0.C5): menos mensagens entre o principal e a tela.
// Antes, cada pedaço de texto da conversa e cada pedaço da saída do terminal
// era uma mensagem própria. Aqui eles se juntam, SEM mudar a ordem:
//  - conversa: uma fila por conversa, esvaziada a cada 50 ms num só
//    `conversa:lote` ({ id, itens: [[canal, dado], ...] }); textos parciais
//    seguidos viram um só texto; passou do teto de bytes, esvazia na hora;
//  - eventos "urgentes" (pergunta/permissão, resposta, fim de turno, erro,
//    tela refeita) esvaziam a fila na hora, já levando tudo o que veio antes:
//    o cartão não espera os 50 ms e nada passa na frente de nada;
//  - terminal: uma fila por terminal, esvaziada a cada 16 ms (um quadro);
//  - historico do terminal: lista de pedaços (sem recopiar a string inteira
//    a cada pedaço de saída).
// Este módulo não conhece Electron nem a conversa: recebe as funções de envio.

const MS_CONVERSA = 50;
const MS_TERMINAL = 16;
const TETO_BYTES = 256 * 1024;

// Eventos de conversa que esvaziam o lote na hora.
const CANAIS_URGENTES = new Set(['conversa:pedido', 'conversa:respondido', 'conversa:tudo', 'conversa:comandos']);
const TIPOS_URGENTES = new Set(['erro', 'fim', 'resultado', 'encerrada', 'resposta', 'pedido', 'limpa', 'aviso']);
// Canais que não são de uma conversa só (lista, foco) seguem direto.
const urgente = (canal, dado) => CANAIS_URGENTES.has(canal) || (canal === 'conversa:evento' && !!dado && TIPOS_URGENTES.has(dado.tipo));

// Tamanho aproximado, barato (sem JSON.stringify de cada evento).
function bytes(dado) {
  if (typeof dado === 'string') return dado.length;
  if (!dado || typeof dado !== 'object') return 8;
  let n = 64;
  for (const k in dado) { const v = dado[k]; n += typeof v === 'string' ? v.length : 32; }
  return n;
}

function criarLote({ enviar, ms = MS_CONVERSA, teto = TETO_BYTES, relogio = { set: setTimeout, clear: clearTimeout } }) {
  const filas = new Map(); // id → { itens, bytes, timer }
  function esvaziar(id) {
    const f = filas.get(id);
    if (!f) return;
    filas.delete(id);
    if (f.timer) relogio.clear(f.timer);
    if (f.itens.length) enviar('conversa:lote', { id, itens: f.itens });
  }
  function empurrar(canal, msg) {
    const id = msg && msg.id;
    if (!id || typeof canal !== 'string' || !canal.startsWith('conversa:') || ['conversa:lista', 'conversa:focar'].includes(canal)) {
      return enviar(canal, msg); // não é de uma conversa: direto
    }
    let f = filas.get(id);
    if (!f) { f = { itens: [], bytes: 0, timer: null }; filas.set(id, f); }
    const ult = f.itens[f.itens.length - 1];
    if (canal === 'conversa:parcial' && typeof msg.dado === 'string' && ult && ult[0] === canal && typeof ult[1] === 'string') ult[1] += msg.dado;
    else f.itens.push([canal, msg.dado]);
    f.bytes += bytes(msg.dado);
    if (urgente(canal, msg.dado) || f.bytes >= teto) return esvaziar(id);
    if (!f.timer) { f.timer = relogio.set(() => esvaziar(id), ms); if (f.timer && f.timer.unref) f.timer.unref(); }
  }
  return { enviar: empurrar, esvaziar, esvaziarTudo: () => { for (const id of [...filas.keys()]) esvaziar(id); }, _pendentes: () => filas.size };
}

// Saída do terminal: junta os pedaços de cada terminal por 16 ms.
function criarLoteTerminal({ enviar, ms = MS_TERMINAL, teto = TETO_BYTES, relogio = { set: setTimeout, clear: clearTimeout } }) {
  const filas = new Map(); // id → { pedacos, bytes, timer }
  function esvaziar(id) {
    const f = filas.get(id);
    if (!f) return;
    filas.delete(id);
    if (f.timer) relogio.clear(f.timer);
    if (f.pedacos.length) enviar('pty:dados', id, f.pedacos.length === 1 ? f.pedacos[0] : f.pedacos.join(''));
  }
  return {
    dados(id, d) {
      let f = filas.get(id);
      if (!f) { f = { pedacos: [], bytes: 0, timer: null }; filas.set(id, f); }
      f.pedacos.push(d); f.bytes += d.length;
      if (f.bytes >= teto) return esvaziar(id);
      if (!f.timer) { f.timer = relogio.set(() => esvaziar(id), ms); if (f.timer && f.timer.unref) f.timer.unref(); }
    },
    esvaziar,
    // Joga fora o que ainda não saiu (o historico já o tem, e vai inteiro).
    descartar(id) { const f = filas.get(id); if (f && f.timer) relogio.clear(f.timer); filas.delete(id); },
    _pendentes: () => filas.size,
  };
}

// Os últimos `limite` caracteres da saída, como lista de pedaços: acrescentar
// custa o tamanho do pedaço, não o do histórico.
function criarHistorico(limite = 200000) {
  let pedacos = [];
  let total = 0;
  return {
    add(d) {
      if (!d) return;
      pedacos.push(d); total += d.length;
      while (pedacos.length > 1 && total - pedacos[0].length >= limite) total -= pedacos.shift().length;
      if (total > limite) { const corta = total - limite; pedacos[0] = pedacos[0].slice(corta); total = limite; }
    },
    texto() { if (pedacos.length > 1) pedacos = [pedacos.join('')]; return pedacos[0] || ''; },
    get tamanho() { return total; },
    get pedacos() { return pedacos.length; },
  };
}

module.exports = { criarLote, criarLoteTerminal, criarHistorico, MS_CONVERSA, MS_TERMINAL, TETO_BYTES };
