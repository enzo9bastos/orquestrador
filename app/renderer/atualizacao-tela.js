// Atualizar pelo app (atualizacao.js no processo principal): o aviso na barra de cima quando sai
// versão nova e o bloco das Configurações › Orquestração (procurar, o que mudou e atualizar).
(() => {
  const A = window.orq && window.orq.atualizacao;
  if (!A) return;
  const $ = (id) => document.getElementById(id);
  const { esc } = window.orqUtil;
  let e = null; // o estado que o processo principal manda
  let adiada = ''; // versão em que a pessoa clicou "Depois": o aviso dela não volta
  let aplicando = false;
  let falha = '';

  // Há versão nova, mas não dá para aplicar por aqui (ou nem dá para procurar).
  const MOTIVOS = {
    'sem-git': 'A pasta do app não veio do git: não há como procurar versão nova por aqui.',
    'sem-ramo': 'A pasta do app não está num ramo: não há como procurar versão nova por aqui.',
    'sem-origem': 'A pasta do app não acompanha um repositório publicado: não há como procurar versão nova por aqui.',
    mexido: 'Há arquivos do app mexidos à mão nesta pasta. Para não passar por cima deles, a atualização por aqui fica desligada. Veja o que está mexido:',
    'nao-avanco': 'Esta pasta tem mudanças próprias que a versão nova não tem. A atualização por aqui só avança; junte à mão. Veja como a pasta está:',
    dependencias: 'Esta versão muda as dependências do app, e isso pede um npm install. Atualize pelo terminal:',
    mudou: 'A última versão mudou enquanto isso. Procure de novo.',
    desligada: 'A atualização pelo app está desligada aqui.',
  };
  const hora = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  async function aplicar() {
    if (aplicando || !e || !e.ultima || !e.pode) return;
    aplicando = true; falha = '';
    desenhar();
    const r = await A.aplicar(e.ultima.versao).catch((x) => ({ erro: 'falhou', detalhe: String((x && x.message) || x) }));
    aplicando = false;
    if (r && r.erro) falha = r.erro === 'falhou' ? `falhou:${r.detalhe || ''}` : r.erro;
    desenhar();
  }
  async function procurar() {
    falha = '';
    e = { ...(e || {}), procurando: true };
    desenhar();
    e = await A.procurar().catch(() => e);
    desenhar();
  }
  function verOQueMudou() {
    $('abrir-config').click();
    const aba = document.querySelector('#config-nav [data-secao-config="orquestracao"]');
    if (aba) aba.click();
    setTimeout(() => { const l = $('atualizacao-linha'); if (l) l.scrollIntoView({ block: 'center' }); }, 80);
  }

  // --- aviso na barra de cima (mesmo lugar e mesmo jeito da faixa de reinício) ---------------
  function faixa() {
    const velha = $('faixa-atualizacao');
    const mostrar = !!(e && e.ultima && !e.baixada && e.ultima.versao !== adiada);
    if (!mostrar) { if (velha) velha.remove(); return; }
    const chave = `${e.ultima.versao}|${e.pode}|${aplicando}`;
    if (velha && velha.dataset.chave === chave) return;
    const el = velha || document.createElement('div');
    el.id = 'faixa-atualizacao';
    el.dataset.chave = chave;
    el.setAttribute('role', 'status');
    el.innerHTML = `<span class="fa-texto"><span>Versão</span> <strong data-sem-traducao>${esc(e.ultima.versao)}</strong> <span>disponível.</span></span>
      <button type="button" class="botao-texto" id="faixa-atualizacao-ver">O que mudou</button>
      ${e.pode ? `<button type="button" class="botao primario" id="faixa-atualizacao-agora"${aplicando ? ' disabled' : ''}>${aplicando ? 'Atualizando…' : 'Atualizar agora'}</button>` : ''}
      <button type="button" class="botao-texto" id="faixa-atualizacao-depois">Depois</button>`;
    if (!velha) { const vao = document.querySelector('.topo .espaco-topo'); if (vao) vao.before(el); else document.body.append(el); }
    el.querySelector('#faixa-atualizacao-ver').addEventListener('click', verOQueMudou);
    const agora = el.querySelector('#faixa-atualizacao-agora');
    if (agora) agora.addEventListener('click', aplicar);
    el.querySelector('#faixa-atualizacao-depois').addEventListener('click', () => {
      adiada = e.ultima.versao;
      window.orq.config.gravar({ atualizacaoAdiada: adiada }).catch(() => {});
      desenhar();
    });
  }

  // --- Configurações › Orquestração › Atualizações -------------------------------------------------
  function bloco() {
    const estado = $('atualizacao-estado');
    if (!estado) return;
    const x = e || {};
    let texto;
    if (x.procurando) texto = '<span>Procurando…</span>';
    else if (x.baixada) texto = `<span>Versão</span> <strong data-sem-traducao>${esc(x.baixada)}</strong> <span>baixada. Reinicie o app para aplicar.</span>`;
    else if (x.ultima) texto = `<span>Versão</span> <strong data-sem-traducao>${esc(x.ultima.versao)}</strong> <span>disponível. Você está na</span> <strong data-sem-traducao>${esc(x.instalada || '?')}</strong><span>.</span>`;
    else if (x.motivo === 'em-dia') texto = `<span>Você está na última versão.</span> <span>Conferido às</span> <span data-sem-traducao>${esc(hora(x.quando))}</span><span>.</span>`;
    else if (x.motivo === 'sem-rede') texto = `<span>Não consegui consultar o repositório.</span> <span data-sem-traducao>${esc(x.erro || '')}</span>`;
    else if (MOTIVOS[x.motivo]) texto = `<span>${esc(MOTIVOS[x.motivo])}</span>`;
    else texto = '<span>Ainda não procurei desde que o app abriu.</span>';
    estado.innerHTML = texto;
    $('atualizacao-procurar').disabled = !!x.procurando || aplicando;
    const b = $('atualizacao-aplicar');
    b.hidden = !(x.ultima && x.pode);
    b.disabled = aplicando;
    b.innerHTML = aplicando ? '<span>Atualizando…</span>' : `<span>Atualizar para a</span> <span data-sem-traducao>${esc(x.ultima ? x.ultima.versao : '')}</span>`;
    // O que mudou (as notas da versão, como foram publicadas) e, se não der para aplicar por aqui, o motivo e o comando.
    const notas = $('atualizacao-notas');
    const partes = [];
    const motivoFalha = falha.startsWith('falhou:') ? null : falha;
    if (falha) partes.push(`<p class="atualizacao-falha">${falha.startsWith('falhou:') ? `<span>Não consegui aplicar a versão nova.</span> <span data-sem-traducao>${esc(falha.slice(7))}</span>` : `<span>${esc(MOTIVOS[motivoFalha] || 'Não consegui aplicar a versão nova.')}</span>`}</p>`);
    if (x.ultima && !x.pode && MOTIVOS[x.motivo]) partes.push(`<p class="atualizacao-motivo"><span>${esc(MOTIVOS[x.motivo])}</span></p>${x.comando ? `<code class="atualizacao-comando" data-sem-traducao>${esc(x.comando)}</code>` : ''}`);
    if ((x.ultima || x.baixada) && (x.notas || []).length) {
      partes.push(`<h4>O que mudou</h4>${x.notas.map((n) => `<section data-sem-traducao><p class="atualizacao-versao"><strong>${esc(n.versao)}</strong>${n.data ? ` · ${esc(n.data)}` : ''}</p><ul>${n.itens.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></section>`).join('')}`);
    }
    notas.hidden = !partes.length;
    notas.innerHTML = partes.join('');
  }
  // Versão baixada (por aqui ou pelo "Atualizar sozinho"): o pedido de reinício aparece uma vez. O
  // processo principal também manda o pedido, mas ele se perde se a tela ainda não tinha carregado.
  let reinicioAvisado = '';
  function desenhar() {
    faixa(); bloco();
    if (e && e.baixada && reinicioAvisado !== e.baixada && window.orqAvisoDeReinicio) { reinicioAvisado = e.baixada; window.orqAvisoDeReinicio(); }
  }

  $('atualizacao-procurar').addEventListener('click', procurar);
  $('atualizacao-aplicar').addEventListener('click', aplicar);
  A.aoMudar((novo) => { e = novo; desenhar(); });
  const lerAdiada = (c) => { adiada = (c && c.atualizacaoAdiada) || ''; };
  window.addEventListener('orq:config', (ev) => { lerAdiada(ev.detail); desenhar(); });
  Promise.all([window.orq.config.ler().catch(() => null), A.estado().catch(() => null)]).then(([c, est]) => { lerAdiada(c); if (est) e = est; desenhar(); });
  window.orqPaleta?.registrar(() => [{ grupo: 'Ações', titulo: 'Procurar atualização do app', faz: () => { verOQueMudou(); procurar(); } }]);
  window.orqAtualizacao = { estado: () => e, procurar };
})();
