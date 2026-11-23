// Modo reunião na tela do app (reuniao-ligacao.js grava e monta a nota): o sinal de gravando na
// barra de cima, com Print, Marcar momento e Terminar; o andamento da nota; a paleta; e o que as
// Configurações › Voz e reuniões mostram sobre este computador.
(() => {
  const R = window.orq && window.orq.reuniao;
  if (!R) return;
  const $ = (id) => document.getElementById(id);
  const { esc } = window.orqUtil;
  const barra = $('reuniao-barra');
  let e = { gravando: false, processando: [] };
  let pronta = null; // { nota, pasta, assunto } da última nota pronta (fica à vista por um tempo)
  let confirmando = false;
  let pergunta = null; // { tipo: 'detectada' | 'acabou', nome } — a ligação que o app notou pelo microfone
  let tPergunta = null;
  let tRelogio = null, tPronta = null;
  const relogio = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600); const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0'); const ss = String(s % 60).padStart(2, '0'); return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`; };
  const aviso = (t, tipo) => { if (window.orqConversa && window.orqConversa.aviso) window.orqConversa.aviso(t, tipo); };

  function desenhar() {
    clearInterval(tRelogio);
    const p = (e.processando || [])[0];
    if (pergunta && pergunta.tipo === 'detectada' && !e.gravando) {
      barra.hidden = false;
      barra.className = 'reuniao-barra detectada';
      barra.innerHTML = `<span><span>Reunião</span> <span data-sem-traducao>n${esc(pergunta.nome || 'o computador')}</span>?</span> <button type="button" class="botao-texto rb-gravar" data-rb="gravar">Sim, gravar</button> <button type="button" class="botao-texto" data-rb="agora-nao">Agora não</button>`;
    } else if (e.gravando && pergunta && pergunta.tipo === 'acabou') {
      barra.hidden = false;
      barra.className = 'reuniao-barra gravando';
      barra.innerHTML = `<span class="rb-ponto"></span><span>A ligação acabou? Terminar a gravação?</span> <button type="button" class="botao-texto rb-terminar" data-rb="terminar-sim">Terminar</button> <button type="button" class="botao-texto" data-rb="continuar">Continuar gravando</button>`;
    } else if (e.gravando) {
      barra.hidden = false;
      barra.className = 'reuniao-barra gravando';
      barra.innerHTML = confirmando
        ? `<span class="rb-ponto"></span><span>Terminar a reunião?</span><button type="button" class="botao-texto" data-rb="continuar">Continuar gravando</button><button type="button" class="botao-texto rb-terminar" data-rb="terminar-sim">Terminar</button>`
        : `<span class="rb-ponto"></span><span class="rb-tempo" title="${esc(e.titulo || 'Reunião')}">Gravando <span id="rb-relogio">${relogio(Date.now() - e.inicio)}</span></span>
          <button type="button" class="botao-texto" data-rb="print" title="Print da tela agora"${e.printsLigados === false ? ' disabled' : ''}>📷 <span>${e.prints || 0}</span></button>
          <button type="button" class="botao-texto" data-rb="marcar" title="Marcar este momento como importante">★ <span>${e.marcas || 0}</span></button>
          <button type="button" class="botao-texto rb-terminar" data-rb="terminar">Terminar</button>`;
      tRelogio = setInterval(() => { const r = $('rb-relogio'); if (r) r.textContent = relogio(Date.now() - e.inicio); }, 1000);
    } else if (p) {
      barra.hidden = false;
      barra.className = 'reuniao-barra montando';
      barra.innerHTML = `<span>${p.fase === 'resumindo' ? 'Escrevendo o resumo da reunião…' : `Transcrevendo a reunião… ${p.pct || 0}%`}</span>`;
    } else if (pronta) {
      barra.hidden = false;
      barra.className = 'reuniao-barra pronta';
      barra.innerHTML = `<span>Nota pronta:</span> <strong data-sem-traducao>${esc(pronta.assunto || 'Reunião')}</strong><button type="button" class="botao-texto" data-rb="nota">Abrir a nota</button><button type="button" class="botao-icone rb-fechar" data-rb="fechar" title="Fechar" aria-label="Fechar">✕</button>`;
    } else { barra.hidden = true; barra.innerHTML = ''; }
  }
  barra.addEventListener('click', async (ev) => {
    const a = ev.target.closest('[data-rb]')?.dataset.rb;
    if (!a) return;
    let r = null;
    if (a === 'print') r = await R.print();
    else if (a === 'marcar') r = await R.marcar('');
    else if (a === 'terminar') { confirmando = true; desenhar(); return; }
    else if (a === 'continuar') { confirmando = false; pergunta = null; desenhar(); return; }
    else if (a === 'terminar-sim') { confirmando = false; pergunta = null; r = await R.terminar(); }
    else if (a === 'gravar') { pergunta = null; r = await R.comecar(''); if (r && !r.erro) aviso('Gravando a reunião. Avise as pessoas que ela está sendo gravada.'); }
    else if (a === 'agora-nao') { pergunta = null; desenhar(); return; }
    else if (a === 'nota' && pronta) r = await R.abrir(pronta.nota);
    else if (a === 'fechar') { pronta = null; desenhar(); return; }
    if (r && r.erro) aviso(`Reunião: ${r.erro}`, 'erro');
  });
  R.aoMudar((novo) => {
    e = novo || e;
    if (!e.gravando) confirmando = false;
    if (e.evento === 'pronta') {
      pronta = { nota: e.nota, pasta: e.pasta, assunto: e.assunto };
      clearTimeout(tPronta);
      tPronta = setTimeout(() => { pronta = null; desenhar(); }, 10 * 60 * 1000);
    }
    if (e.evento === 'detectada' && !e.gravando) {
      pergunta = { tipo: 'detectada', nome: e.nome };
      clearTimeout(tPergunta);
      tPergunta = setTimeout(() => { if (pergunta && pergunta.tipo === 'detectada') { pergunta = null; desenhar(); } }, 5 * 60 * 1000);
    }
    if (e.evento === 'acabou' && e.gravando) pergunta = { tipo: 'acabou', nome: e.nome };
    if (e.gravando && pergunta && pergunta.tipo === 'detectada') pergunta = null;
    if (!e.gravando && pergunta && pergunta.tipo === 'acabou') pergunta = null;
    if (e.evento === 'comecou-sozinha') aviso(`Comecei a gravar a reunião n${e.nome || 'o computador'}, porque a ligação começou. Avise as pessoas que ela está sendo gravada.`);
    if (e.evento === 'falhou') aviso(`A nota da reunião não saiu: ${e.erro || ''}. O áudio continua na pasta.`, 'erro');
    if (e.evento === 'prints-off' && e.gravando) aviso(`Prints da reunião desligados: ${e.motivo || ''}. A gravação do áudio continua.`);
    desenhar();
  });
  R.estado().then((x) => { e = x || e; desenhar(); }).catch(() => {});

  // Paleta (Ctrl+K): começar, e durante a reunião, print, marcar e terminar.
  async function comecar() {
    const r = await R.comecar('');
    if (r && r.erro) aviso(`Não comecei a gravar a reunião: ${r.erro}`, 'erro');
    else aviso('Gravando a reunião. Avise as pessoas que ela está sendo gravada.');
  }
  window.orqPaleta?.registrar(() => (e.gravando
    ? [{ grupo: 'Reunião', titulo: 'Print da tela na reunião', faz: () => R.print() }, { grupo: 'Reunião', titulo: 'Marcar este momento da reunião', faz: () => R.marcar('') }, { grupo: 'Reunião', titulo: 'Terminar a reunião', faz: () => { confirmando = true; desenhar(); } }]
    : [{ grupo: 'Reunião', titulo: 'Gravar reunião', sub: 'grava você e os outros; no fim, a nota com transcrição e resumo', faz: comecar }]));

  // --- Configurações › Voz e reuniões: o que este computador tem --------------------------
  const NOMES = { small: 'Leve', 'large-v3-turbo': 'Robusto', 'large-v3': 'Melhor' };
  async function desenharVoz(deNovo) {
    const r = await R.voz(deNovo).catch(() => null);
    if (!r || r.erro) { $('config-voz-motor').textContent = `Não consegui olhar este computador${r && r.erro ? `: ${r.erro}` : '.'}`; return; }
    $('config-voz-motor').textContent = r.motor.ok ? `faster-whisper ${r.motor.versao} em ${r.motor.python}` : `${r.motor.motivo}. Instale o faster-whisper (pip install faster-whisper) e escreva aqui o caminho do Python.`;
    $('config-voz-motor').classList.toggle('erro', !r.motor.ok);
    const m = r.maquina;
    const rec = r.modelos.find((x) => x.recomendado);
    $('config-voz-maquina').textContent = `Este computador: ${m.nucleos} núcleos, ${m.memoriaGB} GB de memória${m.nvidia ? `, ${m.nvidia.nome}` : ', sem placa de vídeo NVIDIA'}. Os maiores erram menos, mas demoram mais.`;
    const sel = $('config-voz-modelo');
    for (const o of sel.options) {
      if (!o.value) { o.textContent = `Recomendado para este computador${rec ? ` (${NOMES[rec.id]})` : ''}`; continue; }
      const x = r.modelos.find((y) => y.id === o.value);
      if (x) o.textContent = `${NOMES[x.id]}: ${x.nota} · ${x.local ? 'já no computador' : `baixa ${x.tamanho}`}${x.recomendado ? ' · recomendado' : ''}`;
    }
    const res = $('config-voz-resumo-escolha');
    for (const o of res.options) if (!o.value) o.textContent = `Recomendado para este computador (${r.resumo.recomendado === 'local' ? 'modelo local' : 'Claude'})`;
    $('config-voz-resumo').textContent = `Recomendação: ${r.resumo.recomendado === 'local' ? 'modelo local' : 'Claude'}, porque ${r.resumo.motivo}.`;
  }
  document.querySelector('[data-secao-config="voz"]')?.addEventListener('click', () => desenharVoz(false));
  window.orqReuniao = { estado: () => e, desenharVoz };
})();
