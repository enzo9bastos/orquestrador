// Aba Recados: o que os agentes e o orquestrador trocaram (agente → orquestrador
// pelo .orq/bin/orq-recado; orquestrador → agente pelo orq-recado para) e a
// memória de cada projeto (.orq/memoria). Só leitura, fora "Liberar" num
// recado que o freio segurou.
(() => {
  const $ = (id) => document.getElementById(id);
  const R = window.orq.recados;
  if (!R) return; // ponte antiga
  const { esc } = window.orqUtil;
  let recados = [];
  let vezes = [];
  let projetos = [];
  let filtro = '';       // '' = todos os projetos
  let vista = 'recados'; // 'recados' | 'vezes' | 'memoria'

  const ESTADO = { novo: 'esperando o orquestrador', entregue: 'entregue', segurado: 'segurado', recusado: 'recusado',
    aguardando: 'espera você', 'na-fila': 'na fila', rodando: 'rodando', pronto: 'pronto', falhou: 'falhou', negado: 'negado' };
  const TIPO = { pergunta: 'pergunta', aviso: 'aviso', pronto: 'terminou', travado: 'travado', vez: 'passou a vez',
    pedido: 'pedido avulso', resposta: 'resposta', falhou: 'não deu certo', negado: 'negado', externo: 'de outro computador' };
  const ESTADO_VEZ = { aberta: 'aberta', pega: 'pega', recusada: 'recusada' };
  const NOTA = { decisao: 'decisão', falhou: 'não funcionou', onde: 'onde está', aviso: 'aviso' };
  const hora = (ts) => {
    const d = new Date(ts);
    const hoje = new Date().toDateString() === d.toDateString();
    return hoje ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  };
  const alvoDo = (r) => r.de.alvo || r.para.alvo || '';
  const quem = (x) => (x.tipo === 'orquestrador' ? 'Orquestrador' : x.tipo === 'usuario' ? 'Você' : x.nome || x.alvo || x.caixa);

  function desenharContador() {
    const n = recados.filter((r) => r.estado === 'segurado' || r.estado === 'aguardando').length;
    const el = $('n-recados-atencao');
    el.hidden = !n;
    el.textContent = n ? String(n) : '';
    el.title = n ? `${n} recado(s) ou pedido(s) esperando você` : '';
  }

  function desenharProjetos() {
    const contagem = new Map();
    for (const r of recados) contagem.set(alvoDo(r), (contagem.get(alvoDo(r)) || 0) + 1);
    const lista = projetos.filter((p) => contagem.get(p.alvo) || p.notas);
    $('recados-projetos').innerHTML = [`<button type="button" class="item-repertorio${filtro ? '' : ' ativo'}" data-rc-projeto=""><span class="nome">Todos</span><span class="contador">${recados.length}</span></button>`,
      ...lista.map((p) => `<button type="button" class="item-repertorio${filtro === p.alvo ? ' ativo' : ''}" data-rc-projeto="${esc(p.alvo)}" title="${esc(`${contagem.get(p.alvo) || 0} recado(s), ${p.notas} nota(s) na memória`)}"><span class="nome" data-sem-traducao>${esc(p.alvo)}</span><span class="contador">${contagem.get(p.alvo) || 0} · ${p.notas}</span></button>`),
    ].join('') + (lista.length ? '' : '<p class="nota">Nenhum projeto com recado ou memória ainda.</p>');
  }

  // O que espera o usuário fica em cima, em "Para aprovar" (de qualquer
  // projeto, mesmo com filtro); embaixo, todos os outros.
  function desenharLinha() {
    const aprovar = recados.filter((r) => r.estado === 'aguardando').slice().reverse();
    const lista = recados.filter((r) => r.estado !== 'aguardando' && (!filtro || alvoDo(r) === filtro)).slice().reverse();
    $('recados-aprovar').hidden = !aprovar.length;
    $('recados-aprovar-linha').innerHTML = aprovar.map(itemRecado).join('');
    $('recados-dica').textContent = lista.length || aprovar.length ? ''
      : 'Nenhum recado ainda. Os agentes do app falam com o orquestrador por .orq/bin/orq-recado enviar; o orquestrador responde com orq-recado para <projeto>.';
    $('recados-linha').innerHTML = lista.map(itemRecado).join('');
  }
  const CLASSE = { ciente: 'ciente', informacao: 'informação', pedido: 'pedido', decisao: 'decisão' };
  function itemRecado(r) {
    return `<li class="recado recado-${esc(r.estado)} recado-tipo-${esc(r.tipo)}" data-id="${esc(r.id)}">
      <div class="recado-topo"><span class="recado-de" data-sem-traducao>${esc(quem(r.de))}</span><span class="recado-seta">→</span><span class="recado-para" data-sem-traducao>${esc(quem(r.para))}</span>
        <span class="recado-projeto" data-sem-traducao>${esc(alvoDo(r))}</span>
        <span class="selo recado-selo-tipo">${esc(TIPO[r.tipo] || r.tipo)}</span>
        ${r.canal && r.classe ? `<span class="selo recado-selo-classe">${esc(CLASSE[r.classe] || r.classe)}</span>` : ''}
        <span class="selo recado-selo-estado">${esc(ESTADO[r.estado] || r.estado)}</span>
        <span class="recado-hora">${esc(hora(r.ts))}</span></div>
      ${r.canal && r.titulo ? `<div class="recado-titulo" data-sem-traducao><strong>${esc(r.titulo)}</strong></div>` : ''}
      <div class="recado-texto" data-sem-traducao>${esc(r.texto)}</div>
      ${r.canal && r.para.tipo === 'externo' && r.estado === 'aguardando' ? `<div class="nota recado-motivo">Sai deste computador para ${esc(r.para.nome)} (caixa <code data-sem-traducao>${esc(r.para.caixa)}</code>) se você aprovar.</div>` : ''}
      ${r.motivo ? `<div class="nota recado-motivo">${esc(r.motivo)}</div>` : ''}
      ${r.tipo === 'pedido' ? `<div class="nota recado-motivo">${r.escrever ? 'Pode escrever na pasta do projeto' : 'Só leitura'}${r.modelo ? ` · modelo ${esc(r.modelo)}` : ''}${r.nota ? ` · sua orientação: <span data-sem-traducao>${esc(r.nota)}</span>` : ''}</div>` : ''}
      ${r.tipo === 'pedido' && r.arquivos && r.arquivos.length ? `<div class="recado-texto pedido-arquivos"><strong>Arquivos:</strong> <span data-sem-traducao>${r.arquivos.map(esc).join(', ')}</span></div>` : ''}
      ${r.tipo === 'pedido' && r.erro ? `<div class="nota recado-motivo">${esc(r.erro)}</div>` : ''}
      ${r.estado === 'segurado' ? `<button type="button" class="botao-texto" data-rc-liberar="${esc(r.id)}">Liberar para o orquestrador</button>` : ''}
      ${r.estado === 'aguardando' ? `<div class="pedido-decidir">
        <textarea class="campo-config" rows="2" maxlength="2000" data-rc-nota="${esc(r.id)}" placeholder="Orientação ou motivo (opcional): vai junto da sua resposta" aria-label="Orientação ou motivo (opcional)"></textarea>
        <div class="acoes"><button type="button" class="botao secundario" data-rc-decidir="${esc(r.id)}" data-aprovar="0">Negar</button>
        <button type="button" class="botao primario" data-rc-decidir="${esc(r.id)}" data-aprovar="1">Aprovar</button></div></div>` : ''}
      ${r.semAprovacao ? '<div class="nota recado-motivo">Saiu sem aprovação, pela regra que você escolheu.</div>' : ''}
    </li>`;
  }

  function desenharVezes() {
    const lista = vezes.filter((v) => !filtro || v.de.alvo === filtro || (v.pegaPor && v.pegaPor.alvo === filtro)).slice().reverse();
    $('vezes-linha').innerHTML = lista.length ? lista.map((v) => `<li class="recado vez vez-${esc(v.estado)}" data-id="${esc(v.id)}">
      <div class="recado-topo"><span class="recado-de" data-sem-traducao>${esc(v.de.nome)}</span><span class="recado-seta">→</span><span class="recado-para" data-sem-traducao>${esc(v.pegaPor ? v.pegaPor.nome : (v.para || 'qualquer agente'))}</span>
        <span class="recado-projeto" data-sem-traducao>${esc(v.de.alvo)}</span>
        <span class="selo recado-selo-estado">${esc(ESTADO_VEZ[v.estado] || v.estado)}</span>
        <span class="recado-hora">${esc(hora(v.ts))}</span></div>
      <div class="recado-texto" data-sem-traducao>${esc(v.texto)}</div>
      ${v.falta ? `<div class="recado-texto vez-falta"><strong>Falta:</strong> <span data-sem-traducao>${esc(v.falta)}</span></div>` : ''}
      ${v.falhou ? `<div class="recado-texto vez-falhou"><strong>Não funcionou:</strong> <span data-sem-traducao>${esc(v.falhou)}</span></div>` : ''}
      ${v.motivo ? `<div class="nota recado-motivo">${esc(v.motivo)}</div>` : ''}
    </li>`).join('')
      : '<p class="nota">Nenhuma vez passada ainda. Um agente passa a vez com .orq/bin/orq-recado passar; outro pega com pegar &lt;id&gt;.</p>';
  }

  async function desenharMemoria() {
    if (!filtro) {
      $('memoria-notas').innerHTML = '<p class="nota">Escolha um projeto à esquerda para ver a memória dele.</p>';
      return;
    }
    const termo = $('filtro-memoria').value.trim().toLowerCase();
    const notas = (await R.memoria(filtro)).filter((n) => !termo || `${n.titulo} ${n.texto}`.toLowerCase().includes(termo));
    $('memoria-notas').innerHTML = notas.length ? notas.map((n) => `<li class="memoria-nota memoria-${esc(n.tipo)}">
      <div class="recado-topo"><span class="selo">${esc(NOTA[n.tipo] || n.tipo)}</span><strong data-sem-traducao>${esc(n.titulo)}</strong><span class="recado-hora">${esc(n.quando)} · ${esc(n.autor)}${n.origem ? ` · <span data-sem-traducao>${esc(n.origem)}</span>` : ''}</span></div>
      <div class="recado-texto" data-sem-traducao>${esc(n.texto)}</div></li>`).join('')
      : `<p class="nota">${termo ? 'Nenhuma nota com esse termo.' : 'A memória deste projeto ainda está vazia. Os agentes gravam com .orq/bin/orq-recado lembrar; o orquestrador, com orq-recado lembrar <projeto>.'}</p>`;
  }

  function desenhar() {
    desenharContador();
    desenharProjetos();
    document.querySelectorAll('[data-rc-aba]').forEach((b) => b.classList.toggle('ativa', b.dataset.rcAba === vista));
    $('recados-linha').hidden = vista !== 'recados';
    $('recados-dica').hidden = vista !== 'recados';
    if (vista !== 'recados') $('recados-aprovar').hidden = true;
    $('vezes-linha').hidden = vista !== 'vezes';
    $('recados-memoria').hidden = vista !== 'memoria';
    if (vista === 'recados') desenharLinha(); else if (vista === 'vezes') desenharVezes(); else desenharMemoria();
  }

  async function carregar() {
    [recados, projetos, vezes] = await Promise.all([R.lista(), R.projetos(), R.vezes ? R.vezes() : []]);
    desenhar();
  }

  $('aba-recados').addEventListener('click', async (ev) => {
    const p = ev.target.closest('[data-rc-projeto]');
    if (p) { filtro = p.dataset.rcProjeto; desenhar(); return; }
    const a = ev.target.closest('[data-rc-aba]');
    if (a) { vista = a.dataset.rcAba; desenhar(); return; }
    const d = ev.target.closest('[data-rc-decidir]');
    if (d) {
      const id = d.dataset.rcDecidir;
      const campo = document.querySelector(`[data-rc-nota="${CSS.escape(id)}"]`);
      d.disabled = true;
      const r = await R.decidir(id, d.dataset.aprovar === '1', campo ? campo.value : '');
      if (r && r.erro) { d.disabled = false; d.textContent = r.erro; return; }
      await carregar();
      return;
    }
    const l = ev.target.closest('[data-rc-liberar]');
    if (l) {
      l.disabled = true;
      const r = await R.liberar(l.dataset.rcLiberar);
      if (r && r.erro) { l.disabled = false; l.textContent = r.erro; }
      await carregar();
    }
  });
  $('filtro-memoria').addEventListener('input', () => desenharMemoria());
  document.querySelector('[data-aba="aba-recados"]').addEventListener('click', () => carregar());
  R.aoMudar((l) => { recados = l; Promise.all([R.projetos(), R.vezes ? R.vezes() : []]).then(([p, v]) => { projetos = p; vezes = v; desenhar(); }); });
  carregar();
  if (window.orq.teste) window.__orqRecados = { carregar, estado: () => ({ recados, vezes, projetos, filtro, vista }) };
})();
