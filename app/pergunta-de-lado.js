// Pergunta rápida (/btw): uma pergunta sobre a conversa, respondida pelo Claude sem
// entrar nela e sem interromper o que ele está fazendo.
//
// Quem responde é o próprio Claude, pelo pedido de controle side_question (conferido
// no 2.1.326):
//   { subtype: 'side_question', question, history?: [{ question, response, fallback_notice? }] }
//   → { response: string | null, synthetic: boolean,
//       refusal_fallback?: { original_model, fallback_model, content } }
// Ele responde só com o que já está na conversa (sem ferramentas, uma resposta só) e não
// grava nada no histórico dela. `history` são as perguntas rápidas anteriores: o terminal
// manda as 20 mais novas, e o app faz igual. Enquanto a resposta não vem, chega
//   { type: 'system', subtype: 'control_request_progress', request_id,
//     status: 'started' | 'api_retry', attempt?, max_retries?, retry_delay_ms?, error_status? }
// e { type: 'control_cancel_request', request_id } desiste da pergunta (o pedido termina
// com o erro "Side question cancelled").
//
// synthetic: true quer dizer que o texto NÃO é uma resposta do modelo: é um aviso do
// próprio Claude Code ("(API error: Not logged in)", "(The model tried to call …"). O
// pedido volta como "sucesso" mesmo assim, então quem confere é o app: texto sintético é
// erro, não entra na lista de respostas e não é mandado de volta como histórico.
//
// Este módulo não fala com o Claude: confere a pergunta, confere a resposta e monta o
// histórico. As perguntas e respostas vivem só na memória da conversa (conversa.js).
const MAX_PERGUNTA = 10000;
const MAX_RESPOSTA = 200000;
const MAX_HISTORICO = 20; // o que o Claude relê a cada pergunta (o mesmo número do terminal)
const MAX_TROCAS = 100; // o que a gaveta guarda para mostrar
const ESPERA_MS = 120000; // sem resposta nesse tempo, o app desiste e manda o Claude desistir

const semControle = (s) => String(s == null ? '' : s).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
const umaLinha = (s, n) => semControle(s).replace(/\s+/g, ' ').trim().slice(0, n);

// A pergunta como vai ao Claude: { ok: true, pergunta } ou { ok: false, erro }.
function conferirPergunta(texto) {
  if (typeof texto !== 'string') return { ok: false, erro: 'a pergunta precisa ser um texto' };
  const pergunta = texto.replace(/\u0000/g, '').trim();
  if (!pergunta) return { ok: false, erro: 'escreva a pergunta' };
  if (pergunta.length > MAX_PERGUNTA) return { ok: false, erro: `a pergunta passa de ${MAX_PERGUNTA} caracteres` };
  return { ok: true, pergunta };
}

// A resposta do Claude, conferida: { ok: true, resposta, reserva } ou
// { ok: false, motivo: 'sintetica' | 'vazia' | 'formato', detalhe }.
// reserva: { de, para, texto } quando outro modelo respondeu no lugar do escolhido
// (refusal_fallback); o texto é o aviso que o Claude manda mostrar junto.
function conferirResposta(r) {
  const nao = (motivo, detalhe = '') => ({ ok: false, motivo, detalhe });
  if (!r || typeof r !== 'object' || Array.isArray(r)) return nao('formato');
  if (r.response === null || r.response === undefined) return nao('vazia');
  if (typeof r.response !== 'string') return nao('formato');
  // Só `false` (ou o campo ausente, como nos Claude antigos) é resposta de verdade.
  if (r.synthetic !== undefined && r.synthetic !== false) return nao('sintetica', umaLinha(r.response, 300));
  const resposta = r.response.replace(/\u0000/g, '').slice(0, MAX_RESPOSTA);
  if (!resposta.trim()) return nao('vazia');
  const f = r.refusal_fallback;
  const texto = f && typeof f === 'object' && !Array.isArray(f) && typeof f.content === 'string' ? umaLinha(f.content, 600) : '';
  return { ok: true, resposta, reserva: texto ? { de: umaLinha(f.original_model, 80), para: umaLinha(f.fallback_model, 80), texto } : null };
}

// O que vai em `history`: as respondidas mais novas, da mais antiga para a mais nova.
// Pergunta sem resposta (erro, parada, texto sintético) não entra.
function historico(trocas) {
  return (trocas || []).filter((t) => t && typeof t.pergunta === 'string' && typeof t.resposta === 'string' && t.resposta)
    .slice(-MAX_HISTORICO)
    .map((t) => ({ question: t.pergunta, response: t.resposta, ...(t.reserva && t.reserva.texto ? { fallback_notice: t.reserva.texto } : {}) }));
}

// O andamento que o Claude manda durante a espera, conferido: { estado: 'comecou' } ou
// { estado: 'tentando', tentativa, de } (a API falhou e ele vai tentar de novo); senão null.
function conferirAndamento(d) {
  if (!d || typeof d !== 'object') return null;
  if (d.status === 'started') return { estado: 'comecou' };
  if (d.status !== 'api_retry') return null;
  const n = (v) => (Number.isInteger(v) && v >= 0 && v < 1000 ? v : null);
  return { estado: 'tentando', tentativa: n(d.attempt), de: n(d.max_retries) };
}

// O erro de um pedido que não chegou a responder, em palavras de quem usa.
function motivoDoErro(e) {
  const m = umaLinha(e && e.message ? e.message : e, 300);
  if (/Side question cancelled/i.test(m)) return { motivo: 'parada', detalhe: '' };
  if (/não respondeu|timed out/i.test(m)) return { motivo: 'demorou', detalhe: '' };
  return { motivo: 'falhou', detalhe: m };
}

module.exports = { conferirPergunta, conferirResposta, conferirAndamento, historico, motivoDoErro, MAX_PERGUNTA, MAX_HISTORICO, MAX_TROCAS, ESPERA_MS };
