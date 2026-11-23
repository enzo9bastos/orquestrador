// Janela escondida do modo reunião (main.js abre ao começar a reunião e fecha ao terminar).
// iniciar: pede a imagem da tela uma vez (no Wayland, o sistema mostra a escolha da tela);
// print: devolve o quadro atual em PNG; parar: solta a tela.
(() => {
  const C = window.captura;
  let trilha = null;
  let quadros = null;
  C.ao(async (m) => {
    if (m.t === 'iniciar') {
      try {
        const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 2 }, audio: false });
        trilha = s.getVideoTracks()[0];
        trilha.addEventListener('ended', () => { trilha = null; quadros = null; C.r({ t: 'acabou' }); });
        quadros = new ImageCapture(trilha);
        const a = trilha.getSettings();
        C.r({ t: 'iniciou', id: m.id, largura: a.width || null, altura: a.height || null });
      } catch (e) { C.r({ t: 'iniciou', id: m.id, erro: String((e && e.message) || e) }); }
    } else if (m.t === 'print') {
      try {
        if (!quadros) throw new Error('a tela não está sendo compartilhada');
        const bmp = await quadros.grabFrame();
        const tela = new OffscreenCanvas(bmp.width, bmp.height);
        tela.getContext('2d').drawImage(bmp, 0, 0);
        const png = await tela.convertToBlob({ type: 'image/png' });
        C.r({ t: 'print', id: m.id, png: new Uint8Array(await png.arrayBuffer()) });
      } catch (e) { C.r({ t: 'print', id: m.id, erro: String((e && e.message) || e) }); }
    } else if (m.t === 'parar') {
      if (trilha) trilha.stop();
      trilha = null; quadros = null;
    }
  });
})();
