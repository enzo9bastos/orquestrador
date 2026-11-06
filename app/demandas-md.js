// Demanda em .md: o arquivo que o usuário abre na aba Notas. Tudo visível e
// editável, numa ordem fixa que o app e o orquestrador sabem ler:
//
//   Estado: Em andamento · Código: T-1042 · Agentes: Agente 3, Agente 4
//   Aberta em 30/10/2026 · Atualizada em 06/11/2026
//
//   ## Resumo        (um parágrafo; o orquestrador troca)
//   ## Etapas        (- [ ] / - [x]; app e orquestrador marcam)
//   ## Anotações     (livre: só o usuário mexe; o app guarda como está)
//
// O título é o nome do arquivo (a aba Notas já o mostra grande em cima); um
// "# Título" escrito no arquivo também é lido. Sem cabeçalho escondido (---):
// o editor de notas não o preserva.

const ROTULOS = { aberto: 'Em andamento', esperando: 'Esperando você', concluido: 'Concluída' };
const DE_ROTULO = { 'em andamento': 'aberto', aberta: 'aberto', aberto: 'aberto', 'esperando você': 'esperando', esperando: 'esperando', 'concluída': 'concluido', concluida: 'concluido', 'concluído': 'concluido', concluido: 'concluido' };

const data = (ms) => (ms ? new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
const umaLinha = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

function formatar(t, anotacoes = '') {
  const ficha = [`Estado: ${ROTULOS[t.estado] || ROTULOS.aberto}`];
  if (t.codigo) ficha.push(`Código: ${umaLinha(t.codigo)}`);
  if (t.agentes && t.agentes.length) ficha.push(`Agentes: ${t.agentes.map(umaLinha).join(', ')}`);
  const datas = [`Aberta em ${data(t.criado)}`, `Atualizada em ${data(t.atualizado)}`];
  if (t.estado === 'concluido' && t.concluido) datas.push(`Concluída em ${data(t.concluido)}`);
  const etapas = (t.itens || []).map((i) => `- [${i.feito ? 'x' : ' '}] ${umaLinha(i.texto)}`).join('\n');
  return [
    ficha.join(' · '), datas.join(' · '), '',
    '## Resumo', '', umaLinha(t.resumo) || '_(sem resumo ainda)_', '',
    '## Etapas', '', etapas || '_(nenhuma etapa ainda)_', '',
    '## Anotações', '', String(anotacoes || '').replace(/\s+$/, ''),
  ].join('\n').replace(/\n+$/, '') + '\n';
}

// Lê o .md de volta. Campo que não está lá vem null (quem chama mantém o que
// já sabia). Texto fora das seções conhecidas vai para as anotações, para
// nada se perder.
function ler(texto) {
  const linhas = String(texto || '').replace(/\r\n/g, '\n').split('\n');
  const r = { titulo: null, estado: null, codigo: null, agentes: null, resumo: null, itens: null, anotacoes: '' };
  let secao = 'topo';
  const blocos = { topo: [], resumo: [], etapas: [], anotacoes: [], outras: [] };
  for (const l of linhas) {
    const h1 = /^#\s+(.+?)\s*$/.exec(l);
    const h2 = /^##\s+(.+?)\s*$/.exec(l);
    if (h1 && r.titulo === null && secao === 'topo') { r.titulo = h1[1]; continue; }
    if (h2) {
      const nome = h2[1].toLowerCase();
      secao = nome === 'resumo' ? 'resumo' : nome === 'etapas' ? 'etapas' : nome === 'anotações' || nome === 'anotacoes' ? 'anotacoes' : 'outras';
      if (secao === 'outras') blocos.outras.push(l);
      continue;
    }
    blocos[secao].push(l);
  }
  for (const l of blocos.topo) {
    if (!/^Estado:/i.test(l.trim())) continue;
    for (const parte of l.split('·').map((p) => p.trim())) {
      const m = /^([^:]+):\s*(.*)$/.exec(parte);
      if (!m) continue;
      const k = m[1].trim().toLowerCase(), v = m[2].trim();
      if (k === 'estado') r.estado = DE_ROTULO[v.toLowerCase()] || null;
      else if (k === 'código' || k === 'codigo') r.codigo = v || null;
      else if (k === 'agentes') r.agentes = v.split(',').map((a) => a.trim()).filter(Boolean);
    }
    if (!r.agentes) r.agentes = [];
  }
  const semVazio = (bl) => bl.join('\n').trim();
  if (blocos.resumo.length) {
    const t = semVazio(blocos.resumo).replace(/\s+/g, ' ');
    r.resumo = /^_\(sem resumo ainda\)_$/.test(t) ? '' : t;
  }
  if (blocos.etapas.length) {
    r.itens = blocos.etapas.map((l) => /^\s*[-*+]\s+\[([ xX])\]\s+(.+?)\s*$/.exec(l)).filter(Boolean)
      .map((m, n) => ({ id: `i${n + 1}`, texto: m[2], feito: m[1] !== ' ' }));
  }
  // Fora do formato (sem título nem estado): o texto todo fica nas anotações.
  const soltos = r.titulo === null && r.estado === null ? semVazio(blocos.topo) : '';
  r.anotacoes = [soltos, semVazio(blocos.anotacoes), semVazio(blocos.outras)].filter(Boolean).join('\n\n');
  return r;
}

// Nome do arquivo: o título, sem o que o sistema de arquivos não aceita, e
// " - Concluída" no fim quando concluída.
function nomeArquivo(titulo, estado) {
  let base = umaLinha(titulo).replace(/[\\/:*?"<>|]+/g, ' - ').replace(/\s*-\s*(-\s*)+/g, ' - ').replace(/\s+/g, ' ').replace(/^[\s.-]+|[\s.-]+$/g, '');
  if (!base) base = 'Demanda sem título';
  base = base.slice(0, 120).trim();
  return `${base}${estado === 'concluido' ? ' - Concluída' : ''}.md`;
}

module.exports = { formatar, ler, nomeArquivo, ROTULOS };
