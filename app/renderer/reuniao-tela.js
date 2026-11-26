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
  let tRelogio = null, tPronta = null;
  const relogio = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600); const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0'); const ss = String(s % 60).padStart(2, '0'); return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`; };
  const aviso = (t, tipo) => { if (window.orqConversa && window.orqConversa.aviso) window.orqConversa.aviso(t, tipo); };

  function desenhar() {
    clearInterval(tRelogio);
    const p = (e.processando || [])[0];
    if (e.gravando) {
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
    else if (a === 'continuar') { confirmando = false; desenhar(); return; }
    else if (a === 'terminar-sim') { confirmando = false; r = await R.terminar(); }
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
    // "Começou uma reunião? Quer gravar?" e "A ligação acabou?" quem pergunta é o bichinho (ajudante.js).
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
  const pedirTerminar = () => { if (!e.gravando) return; confirmando = true; desenhar(); }; // a confirmação aparece na barra
  window.orqPaleta?.registrar(() => (e.gravando
    ? [{ grupo: 'Reunião', titulo: 'Print da tela na reunião', faz: () => R.print() }, { grupo: 'Reunião', titulo: 'Marcar este momento da reunião', faz: () => R.marcar('') }, { grupo: 'Reunião', titulo: 'Terminar a reunião', faz: pedirTerminar }]
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
    // O ditado: sem placa NVIDIA os modelos grandes escrevem frase por frase; o leve, enquanto a pessoa fala.
    const recDitado = (r.ditado && r.ditado.recomendado) || 'small';
    for (const o of $('config-ditado-modelo').options) {
      if (!o.value) { o.textContent = `Recomendado para este computador (${NOMES[recDitado]})`; continue; }
      const x = r.modelos.find((y) => y.id === o.value);
      if (x) o.textContent = `${NOMES[x.id]}${!x.local ? ' · ainda não está neste computador' : x.id === recDitado ? ' · recomendado' : m.nvidia ? '' : x.id === 'small' ? ' · texto enquanto você fala, erra mais' : ' · frase por frase'}`;
    }
    // A correção por trás (só com o leve): o que o computador recomenda, e os modelos que podem corrigir.
    const revisor = r.ditado && r.ditado.revisor;
    for (const o of $('config-ditado-revisor').options) {
      if (!o.value) { o.textContent = revisor ? `Recomendado para este computador (corrige com o ${NOMES[revisor]})` : 'Recomendado para este computador (não corrige)'; continue; }
      const x = r.modelos.find((y) => y.id === o.value);
      if (x) o.textContent = `${NOMES[x.id]}${x.local ? '' : ' · ainda não está neste computador'}`;
    }
    const res = $('config-voz-resumo-escolha');
    for (const o of res.options) if (!o.value) o.textContent = `Recomendado para este computador (${r.resumo.recomendado === 'local' ? 'modelo local' : 'Claude'})`;
    $('config-voz-resumo').textContent = `Recomendação: ${r.resumo.recomendado === 'local' ? 'modelo local' : 'Claude'}, porque ${r.resumo.motivo}.`;
  }
  // Nomes no Google Meet: em quais navegadores está pronto e quando a extensão falou por último.
  const quando = (ts) => new Date(ts).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  function textoMeet(r) {
    if (!r || r.erro) return `Não consegui olhar o navegador${r && r.erro ? `: ${r.erro}` : '.'}`;
    if (!r.navegadores.length) return 'Nenhum navegador do tipo Chrome (Brave, Chrome, Chromium, Edge, Vivaldi) neste computador.';
    const prontos = r.navegadores.filter((n) => n.pronto).map((n) => n.navegador);
    const partes = [prontos.length ? `Pronto em: ${prontos.join(', ')}.` : `Ainda não preparado (${r.navegadores.map((n) => n.navegador).join(', ')}).`];
    partes.push(r.contato ? `A extensão falou com o app pela última vez em ${quando(r.contato)}.` : 'A extensão ainda não falou com o app (ela fala quando há uma ligação do Meet aberta).');
    if (r.alheios && r.alheios.length) partes.push(`Em ${r.alheios.join(', ')} já havia um arquivo com o mesmo nome que não é do app: não mexi.`);
    return partes.join(' ');
  }
  async function desenharMeet() {
    if (!R.meet) return;
    const r = await R.meet().catch(() => null);
    $('config-meet-estado').textContent = textoMeet(r);
  }
  $('config-meet-preparar')?.addEventListener('click', async () => {
    const b = $('config-meet-preparar');
    b.disabled = true;
    const r = await R.meetPreparar().catch((er) => ({ erro: er.message }));
    b.disabled = false;
    if (r && r.resultado) r.alheios = r.resultado.filter((x) => x.resultado === 'alheio').map((x) => x.navegador);
    $('config-meet-estado').textContent = textoMeet(r);
  });
  $('config-meet-pasta')?.addEventListener('click', () => R.meetPasta().catch(() => {}));
  document.querySelector('[data-secao-config="voz"]')?.addEventListener('click', () => { desenharVoz(false); desenharMeet(); });
  // comecar e pedirTerminar: o menu do bichinho de dentro do app (pet-tela.js) faz o mesmo que a paleta.
  window.orqReuniao = { estado: () => e, desenharVoz, comecar, pedirTerminar };
})();
