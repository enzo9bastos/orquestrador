// Visor de imagem: clicar numa print (balão da conversa ou miniatura de
// anexo) abre em tela cheia, com zoom pela roda do mouse (no ponto do cursor),
// arrastar para mover, duplo clique para encaixar. Esc fecha.
(() => {
  const visor = document.createElement('div');
  visor.id = 'visor-imagem';
  visor.className = 'visor-imagem';
  visor.hidden = true;
  visor.innerHTML = `<img alt="imagem ampliada" draggable="false">
    <div class="visor-barra">
      <button type="button" data-v="menos" title="Diminuir (−)">−</button>
      <span class="visor-zoom">100%</span>
      <button type="button" data-v="mais" title="Aumentar (+)">+</button>
      <button type="button" data-v="caber" title="Caber na tela (0)">Caber</button>
      <button type="button" data-v="real" title="Tamanho real (1)">1:1</button>
      <button type="button" data-v="fechar" title="Fechar (Esc)">✕</button>
    </div>`;
  document.body.append(visor);
  const img = visor.querySelector('img');
  let escala = 1, x = 0, y = 0, arrastando = null;

  function aplicar() {
    img.style.transform = `translate(${x}px, ${y}px) scale(${escala})`;
    visor.querySelector('.visor-zoom').textContent = `${Math.round(escala * 100)}%`;
  }
  function caber() {
    const w = img.naturalWidth || 1, h = img.naturalHeight || 1;
    escala = Math.min(1, (innerWidth - 80) / w, (innerHeight - 120) / h);
    x = (innerWidth - w * escala) / 2; y = (innerHeight - h * escala) / 2;
    aplicar();
  }
  function real() { escala = 1; x = (innerWidth - img.naturalWidth) / 2; y = (innerHeight - img.naturalHeight) / 2; aplicar(); }
  // Zoom mantendo fixo o ponto (px, py) da tela.
  function zoom(fator, px = innerWidth / 2, py = innerHeight / 2) {
    const nova = Math.min(12, Math.max(0.05, escala * fator));
    x = px - (px - x) * (nova / escala); y = py - (py - y) * (nova / escala);
    escala = nova;
    aplicar();
  }
  function abrir(src) {
    img.onload = caber;
    img.src = src;
    visor.hidden = false;
  }
  const fechar = () => { visor.hidden = true; img.removeAttribute('src'); };

  document.addEventListener('click', (ev) => {
    const alvo = ev.target.closest('.balao-imagens img, .anexo img');
    if (alvo && !ev.target.closest('button')) abrir(alvo.src);
  });
  // Nas notas o clique simples seleciona a imagem para editar; o duplo abre o visor.
  document.addEventListener('dblclick', (ev) => {
    const alvo = ev.target.closest('.tiptap img');
    if (alvo) abrir(alvo.src);
  });
  visor.addEventListener('wheel', (ev) => { ev.preventDefault(); zoom(ev.deltaY < 0 ? 1.15 : 1 / 1.15, ev.clientX, ev.clientY); }, { passive: false });
  img.addEventListener('mousedown', (ev) => { ev.preventDefault(); arrastando = { mx: ev.clientX, my: ev.clientY, x, y }; img.classList.add('movendo'); });
  window.addEventListener('mousemove', (ev) => { if (!arrastando) return; x = arrastando.x + ev.clientX - arrastando.mx; y = arrastando.y + ev.clientY - arrastando.my; aplicar(); });
  window.addEventListener('mouseup', () => { arrastando = null; img.classList.remove('movendo'); });
  img.addEventListener('dblclick', caber);
  visor.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-v]');
    if (b) {
      ({ menos: () => zoom(1 / 1.25), mais: () => zoom(1.25), caber, real, fechar })[b.dataset.v]();
    } else if (ev.target === visor) fechar();
  });
  document.addEventListener('keydown', (ev) => {
    if (visor.hidden) return;
    if (ev.key === 'Escape') fechar();
    else if (ev.key === '+' || ev.key === '=') zoom(1.25);
    else if (ev.key === '-') zoom(1 / 1.25);
    else if (ev.key === '0') caber();
    else if (ev.key === '1') real();
    else return;
    ev.preventDefault();
  });
  window.orqVisor = { abrir, fechar, estado: () => ({ aberto: !visor.hidden, escala }) };
})();
