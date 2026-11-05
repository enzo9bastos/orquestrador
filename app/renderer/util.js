// Utilidades que todas as telas usam. Carregado antes delas (index.html).
(() => {
  // Escapa texto para pôr dentro de HTML, inclusive em atributo com aspas
  // simples ou duplas. null/undefined viram texto vazio.
  const MAPA = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => MAPA[c]);
  window.orqUtil = Object.freeze({ esc });
})();
