// Botão flutuante do modo reunião (pet/main.js abre enquanto grava). Clique: o print sai na hora
// (o flash aparece antes da resposta, e o app pega o quadro da tela daquele instante). Arrastar:
// muda o botão de lugar. A conta mostra quantos prints a reunião já tem.
(() => {
  const A = window.ajudante;
  const b = document.getElementById('b');
  const n = document.getElementById('n');
  let apertou = null;
  b.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    apertou = { x: ev.screenX, y: ev.screenY, ux: ev.screenX, uy: ev.screenY, moveu: false };
    b.setPointerCapture(ev.pointerId);
  });
  b.addEventListener('pointermove', (ev) => {
    if (!apertou) return;
    if (!apertou.moveu && Math.hypot(ev.screenX - apertou.x, ev.screenY - apertou.y) < 5) return;
    apertou.moveu = true;
    A.enviar({ t: 'botaoArrastar', dx: ev.screenX - apertou.ux, dy: ev.screenY - apertou.uy });
    apertou.ux = ev.screenX; apertou.uy = ev.screenY;
  });
  b.addEventListener('pointerup', () => {
    const foi = apertou;
    apertou = null;
    if (!foi || foi.moveu) return;
    b.classList.remove('flash', 'erro'); void b.offsetWidth; b.classList.add('flash');
    A.enviar({ t: 'printRapido' });
  });
  A.aoMsg((m) => {
    if (m.t === 'contaPrints') { n.hidden = !m.n; n.textContent = String(m.n || ''); }
    else if (m.t === 'printErro') { b.classList.remove('flash'); b.classList.add('erro'); b.title = m.erro || 'O print não saiu'; }
    else if (m.t === 'idioma' && window.orqI18n && window.orqI18n.idioma() !== m.idioma) window.orqI18n.definir(m.idioma, '../renderer/i18n/');
  });
})();
