// Janela escondida do modo reunião (main.js abre ao começar a reunião e fecha ao terminar).
// iniciar: pede a imagem da tela uma vez (no Wayland, o sistema mostra a escolha da tela);
// print: devolve o quadro atual em PNG; parar: solta a tela.
(() => {
  const C = window.captura;
  let trilha = null;
  let quadros = null;
  // O quadro da tela agora. Logo depois de começar, o primeiro quadro pode ainda não ter chegado:
  // tenta de novo algumas vezes, com uma pausa curta, em vez de falhar.
  async function quadro() {
    if (!quadros) throw new Error('a tela não está sendo compartilhada');
    let erro = null;
    for (let i = 0; i < 6; i++) {
      try { return await quadros.grabFrame(); } catch (e) { erro = e; await new Promise((r) => setTimeout(r, 150)); }
      if (!quadros) break;
    }
    throw erro || new Error('a tela não está sendo compartilhada');
  }
  C.ao(async (m) => {
    if (m.t === 'iniciar') {
      try {
        const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 10 }, audio: false });
        trilha = s.getVideoTracks()[0];
        trilha.addEventListener('ended', () => { trilha = null; quadros = null; C.r({ t: 'acabou' }); });
        quadros = new ImageCapture(trilha);
        const a = trilha.getSettings();
        C.r({ t: 'iniciou', id: m.id, largura: a.width || null, altura: a.height || null });
      } catch (e) { C.r({ t: 'iniciou', id: m.id, erro: String((e && e.message) || e) }); }
    } else if (m.t === 'print') {
      try {
        const bmp = await quadro();
        const tela = new OffscreenCanvas(bmp.width, bmp.height);
        tela.getContext('2d').drawImage(bmp, 0, 0);
        const png = await tela.convertToBlob({ type: 'image/png' });
        C.r({ t: 'print', id: m.id, png: new Uint8Array(await png.arrayBuffer()) });
      } catch (e) { C.r({ t: 'print', id: m.id, erro: String((e && e.message) || e) }); }
    } else if (m.t === 'miniatura') {
      try {
        const bmp = await quadro();
        const larg = Math.min(360, bmp.width);
        const alt = Math.round((bmp.height * larg) / bmp.width);
        const tela = new OffscreenCanvas(larg, alt);
        tela.getContext('2d').drawImage(bmp, 0, 0, larg, alt);
        const jpg = await tela.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
        const b = new Uint8Array(await jpg.arrayBuffer());
        let s = '';
        for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
        C.r({ t: 'miniatura', id: m.id, dataUrl: `data:image/jpeg;base64,${btoa(s)}` });
      } catch (e) { C.r({ t: 'miniatura', id: m.id, erro: String((e && e.message) || e) }); }
    } else if (m.t === 'parar') {
      if (trilha) trilha.stop();
      trilha = null; quadros = null;
    }
  });
})();
