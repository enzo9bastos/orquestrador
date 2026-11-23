// Modo reunião (plano de voz e reuniões, V3): grava a reunião em duas trilhas (você e os outros),
// tira print quando a pessoa pede, marca momentos e, no fim, monta a nota: transcrição com quem
// falou, os prints no minuto certo, resumo, decisões e pendências, e o assunto no nome da pasta.
//
// Regras: nunca grava sem a pessoa começar; o estado "gravando" é sempre visível (bichinho e app);
// o áudio nunca sai do computador (o resumo, se ligado, leva só o TEXTO); nada é apagado nem
// sobrescrito (a pasta é renomeada só se o nome novo estiver livre).
//
// Pasta de cada reunião: <base>/AAAA-MM-DD-HHhMM-reuniao → no fim, AAAA-MM-DD-HHhMM-<assunto>
//   reuniao.json      estado, horários, prints, marcas (é o que deixa retomar depois de uma queda)
//   reuniao.md        a nota
//   audio/voce.opus   audio/outros.opus
//   prints/MM-SS.png
//
// criar({ base, gravar, capturar, transcrever, resumir, aoMudar, agora })
//   gravar(trilha, arquivo)        → { parar(): Promise, dispositivo? }   (trilha: 'voce' | 'outros')
//   capturar(arquivo)              → Promise<void>  (print da tela, sem janela)
//   transcrever(arquivo, { aoProgresso }) → Promise<{ trechos: [{ ini, fim, texto }] }>
//   resumir(texto, { titulo })     → Promise<{ assunto, resumo, decisoes, pendencias }> | null
const fs = require('fs');
const path = require('path');

const TRILHAS = [['voce', 'Você'], ['outros', 'Outros']];
const doisDig = (n) => String(n).padStart(2, '0');
const minSeg = (s) => { const t = Math.max(0, Math.floor(s)); const h = Math.floor(t / 3600); return `${h ? `${h}:` : ''}${doisDig(Math.floor((t % 3600) / 60))}:${doisDig(t % 60)}`; };
const carimbo = (d) => `${d.getFullYear()}-${doisDig(d.getMonth() + 1)}-${doisDig(d.getDate())}-${doisDig(d.getHours())}h${doisDig(d.getMinutes())}`;
// Assunto para nome de pasta: minúsculas, sem acento, só letras, números e hífen, até 60.
function slug(t) {
  return String(t || '').replace(/ª/g, 'a').replace(/º/g, 'o').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
}
const limpo = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim().slice(0, n);

// Junta as duas trilhas na ordem do tempo, com quem falou; prints e marcas entram no minuto deles.
function juntar(porTrilha, prints = [], marcas = []) {
  const itens = [];
  for (const [trilha, nome] of TRILHAS) for (const t of porTrilha[trilha] || []) itens.push({ ini: t.ini, tipo: 'fala', quem: nome, texto: t.texto });
  for (const p of prints) itens.push({ ini: p.seg, tipo: 'print', arquivo: p.arquivo });
  for (const m of marcas) itens.push({ ini: m.seg, tipo: 'marca', texto: m.texto });
  itens.sort((a, b) => a.ini - b.ini || (a.tipo === 'fala' ? -1 : 1));
  // Falas seguidas da mesma pessoa, com menos de 4 s entre elas, viram um parágrafo só.
  const saida = [];
  for (const i of itens) {
    const ult = saida[saida.length - 1];
    if (i.tipo === 'fala' && ult && ult.tipo === 'fala' && ult.quem === i.quem && i.ini - ult.fimAprox < 4) { ult.texto += ` ${i.texto}`; ult.fimAprox = i.ini + 2; continue; }
    saida.push({ ...i, fimAprox: i.ini + 2 });
  }
  return saida;
}
// Só o texto falado, para o resumo (sem caminho de arquivo).
const textoParaResumo = (itens) => itens.filter((i) => i.tipo !== 'print').map((i) => (i.tipo === 'fala' ? `[${minSeg(i.ini)}] ${i.quem}: ${i.texto}` : `[${minSeg(i.ini)}] (momento marcado: ${i.texto || 'importante'})`)).join('\n');

function nota(meta, itens, r) {
  const ini = new Date(meta.inicio);
  const dur = meta.fim ? Math.round((meta.fim - meta.inicio) / 60000) : null;
  const titulo = (r && r.assunto) || meta.titulo || 'Reunião';
  const l = [`# ${titulo}`, '', `${ini.toLocaleDateString('pt-BR')} às ${doisDig(ini.getHours())}:${doisDig(ini.getMinutes())}${dur != null ? ` · ${dur} min` : ''}${meta.titulo && r && r.assunto && meta.titulo !== r.assunto ? ` · título dado: ${meta.titulo}` : ''}`, ''];
  if (r && r.resumo) l.push('## Resumo', '', r.resumo, '');
  if (r && r.decisoes && r.decisoes.length) l.push('## Decisões', '', ...r.decisoes.map((d) => `- ${d}`), '');
  if (r && r.pendencias && r.pendencias.length) l.push('## Pendências', '', ...r.pendencias.map((p) => `- [ ] ${p}`), '');
  if (meta.resumoErro) l.push(`> O resumo não foi feito: ${meta.resumoErro}`, '');
  const marcas = itens.filter((i) => i.tipo === 'marca');
  if (marcas.length) l.push('## Momentos marcados', '', ...marcas.map((m) => `- [${minSeg(m.ini)}] ★ ${m.texto || 'importante'}`), '');
  l.push('## Transcrição', '');
  for (const i of itens) {
    if (i.tipo === 'fala') l.push(`[${minSeg(i.ini)}] **${i.quem}:** ${i.texto}`, '');
    else if (i.tipo === 'print') l.push(`![Print em ${minSeg(i.ini)}](${i.arquivo})`, '');
    else l.push(`[${minSeg(i.ini)}] ★ **Momento marcado**${i.texto ? `: ${i.texto}` : ''}`, '');
  }
  if (!itens.some((i) => i.tipo === 'fala')) l.push('_(nenhuma fala reconhecida)_', '');
  return `${l.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

function criar({ base, gravar, capturar, transcrever, resumir = async () => null, aoMudar = () => {}, agora = Date.now }) {
  let atual = null; // { pasta, meta, gravadores }
  const processando = new Map(); // pasta → { fase, pct }
  const baseDir = () => (typeof base === 'function' ? base() : base);
  const ler = (pasta) => { try { return JSON.parse(fs.readFileSync(path.join(pasta, 'reuniao.json'), 'utf8')); } catch { return null; } };
  const gravarMeta = (pasta, meta) => {
    const tmp = path.join(pasta, `.reuniao.json.${process.pid}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(meta, null, 2));
    fs.renameSync(tmp, path.join(pasta, 'reuniao.json'));
  };
  const estado = () => ({
    gravando: !!atual,
    ...(atual ? { pasta: atual.pasta, titulo: atual.meta.titulo, inicio: atual.meta.inicio, prints: atual.meta.prints.length, marcas: atual.meta.marcas.length, dispositivos: atual.meta.dispositivos, printsLigados: atual.printsLigados } : {}),
    processando: [...processando.entries()].map(([p, x]) => ({ pasta: p, ...x })),
  });
  const avisar = (extra = {}) => { try { aoMudar({ ...estado(), ...extra }); } catch { /* a tela fechou */ } };

  async function comecar({ titulo = '' } = {}) {
    if (atual) throw new Error('já há uma reunião sendo gravada');
    const b = baseDir();
    if (!b) throw new Error('escolha a pasta das reuniões nas Configurações');
    fs.mkdirSync(b, { recursive: true });
    const inicio = agora();
    let pasta = path.join(b, `${carimbo(new Date(inicio))}-reuniao`);
    for (let n = 2; fs.existsSync(pasta); n++) pasta = path.join(b, `${carimbo(new Date(inicio))}-reuniao-${n}`);
    fs.mkdirSync(path.join(pasta, 'audio'), { recursive: true });
    fs.mkdirSync(path.join(pasta, 'prints'), { recursive: true });
    const meta = { versao: 1, titulo: limpo(titulo, 120), inicio, fim: null, estado: 'gravando', prints: [], marcas: [], dispositivos: {}, trilhas: {} };
    gravarMeta(pasta, meta);
    const gravadores = {};
    try {
      for (const [trilha] of TRILHAS) {
        const arquivo = path.join(pasta, 'audio', `${trilha}.opus`);
        gravadores[trilha] = await gravar(trilha, arquivo);
        meta.trilhas[trilha] = `audio/${trilha}.opus`;
        if (gravadores[trilha].dispositivo) meta.dispositivos[trilha] = limpo(gravadores[trilha].dispositivo, 200);
      }
    } catch (e) {
      for (const g of Object.values(gravadores)) { try { await g.parar(); } catch { /* já parou */ } }
      meta.estado = 'falhou'; meta.erro = `não consegui começar a gravar: ${e.message}`;
      gravarMeta(pasta, meta);
      throw new Error(meta.erro);
    }
    gravarMeta(pasta, meta);
    atual = { pasta, meta, gravadores, printsLigados: true };
    avisar({ evento: 'comecou' });
    return estado();
  }
  const segundo = () => Math.max(0, (agora() - atual.meta.inicio) / 1000);
  async function print() {
    if (!atual) throw new Error('nenhuma reunião sendo gravada');
    const seg = segundo();
    let nome = `${minSeg(seg).replace(/:/g, '-')}.png`;
    for (let n = 2; fs.existsSync(path.join(atual.pasta, 'prints', nome)); n++) nome = `${minSeg(seg).replace(/:/g, '-')}-${n}.png`;
    const arquivo = path.join(atual.pasta, 'prints', nome);
    await capturar(arquivo);
    if (!fs.existsSync(arquivo)) throw new Error('o print não foi gravado');
    atual.meta.prints.push({ seg, arquivo: `prints/${nome}` });
    gravarMeta(atual.pasta, atual.meta);
    avisar({ evento: 'print', arquivo });
    return { seg, arquivo };
  }
  function marcar(texto = '') {
    if (!atual) throw new Error('nenhuma reunião sendo gravada');
    const seg = segundo();
    atual.meta.marcas.push({ seg, texto: limpo(texto, 300) });
    gravarMeta(atual.pasta, atual.meta);
    avisar({ evento: 'marca' });
    return { seg };
  }
  // Para a gravação e começa a montar a nota (em segundo plano). Devolve a pasta.
  async function terminar() {
    if (!atual) throw new Error('nenhuma reunião sendo gravada');
    const { pasta, meta, gravadores } = atual;
    atual = null;
    for (const g of Object.values(gravadores)) { try { await g.parar(); } catch { /* segue com o que gravou */ } }
    meta.fim = agora();
    meta.estado = 'gravada';
    gravarMeta(pasta, meta);
    avisar({ evento: 'parou', pasta });
    const fim = processar(pasta).catch(() => {});
    return { pasta, fim };
  }

  // Transcreve as trilhas, resume e escreve a nota. Serve também para retomar uma reunião que
  // ficou no meio (o app fechou): o que já foi transcrito fica guardado em reuniao.json.
  async function processar(pasta) {
    if (processando.has(pasta)) throw new Error('esta reunião já está sendo montada');
    const meta = ler(pasta);
    if (!meta) throw new Error('não achei o reuniao.json desta pasta');
    processando.set(pasta, { fase: 'transcrevendo', pct: 0 });
    avisar();
    try {
      meta.estado = 'transcrevendo';
      gravarMeta(pasta, meta);
      meta.transcricao = meta.transcricao || {};
      const pendentes = TRILHAS.filter(([t]) => meta.trilhas && meta.trilhas[t] && !meta.transcricao[t]);
      let feitas = TRILHAS.length - pendentes.length;
      for (const [trilha] of pendentes) {
        const arquivo = path.join(pasta, meta.trilhas[trilha]);
        let trechos = [];
        if (fs.existsSync(arquivo) && fs.statSync(arquivo).size > 0) {
          const r = await transcrever(arquivo, { aoProgresso: (p) => { processando.set(pasta, { fase: 'transcrevendo', pct: Math.round((feitas * 100 + p) / TRILHAS.length) }); avisar(); } });
          trechos = r.trechos || [];
        }
        meta.transcricao[trilha] = trechos;
        feitas++;
        gravarMeta(pasta, meta);
      }
      const itens = juntar(meta.transcricao, meta.prints, meta.marcas);
      processando.set(pasta, { fase: 'resumindo', pct: 100 });
      avisar();
      let r = null;
      const falado = textoParaResumo(itens);
      if (itens.some((i) => i.tipo === 'fala')) {
        try { r = await resumir(falado, { titulo: meta.titulo }); meta.resumoErro = null; } catch (e) { meta.resumoErro = limpo(e.message, 300); }
      }
      if (r) r = { assunto: limpo(r.assunto, 80), resumo: limpo(r.resumo, 4000), decisoes: (r.decisoes || []).map((x) => limpo(x, 500)).filter(Boolean).slice(0, 30), pendencias: (r.pendencias || []).map((x) => limpo(x, 500)).filter(Boolean).slice(0, 30) };
      // A nota nunca passa por cima de outra: se já existe uma, a nova ganha número.
      let nomeNota = 'reuniao.md';
      for (let n = 2; fs.existsSync(path.join(pasta, nomeNota)); n++) nomeNota = `reuniao-${n}.md`;
      fs.writeFileSync(path.join(pasta, nomeNota), nota(meta, itens, r), { flag: 'wx' });
      meta.nota = nomeNota;
      meta.assunto = (r && r.assunto) || meta.titulo || '';
      meta.estado = 'pronta';
      gravarMeta(pasta, meta);
      // Assunto no nome da pasta, sem passar por cima de nada.
      let final = pasta;
      const s = slug(meta.assunto);
      if (s && /-reuniao(-\d+)?$/.test(path.basename(pasta))) {
        const alvoBase = path.join(path.dirname(pasta), path.basename(pasta).replace(/-reuniao(-\d+)?$/, `-${s}`));
        let alvo = alvoBase;
        for (let n = 2; fs.existsSync(alvo); n++) alvo = `${alvoBase}-${n}`;
        try { fs.renameSync(pasta, alvo); final = alvo; } catch { /* fica com o nome de antes */ }
      }
      processando.delete(pasta);
      avisar({ evento: 'pronta', pasta: final, nota: path.join(final, nomeNota), assunto: meta.assunto });
      return { pasta: final, nota: path.join(final, nomeNota), assunto: meta.assunto };
    } catch (e) {
      meta.estado = 'falhou';
      meta.erro = limpo(e.message, 500);
      try { gravarMeta(pasta, meta); } catch { /* a pasta sumiu */ }
      processando.delete(pasta);
      avisar({ evento: 'falhou', pasta, erro: meta.erro });
      throw e;
    }
  }
  // Reuniões que ficaram no meio (o app fechou gravando ou montando a nota).
  function pendentes() {
    const b = baseDir();
    let nomes = [];
    try { nomes = fs.readdirSync(b); } catch { return []; }
    return nomes.map((n) => path.join(b, n)).filter((p) => (!atual || atual.pasta !== p) && !processando.has(p))
      .map((p) => ({ pasta: p, meta: ler(p) })).filter((x) => x.meta && ['gravando', 'gravada', 'transcrevendo'].includes(x.meta.estado));
  }
  // O app vai fechar: para de gravar (o áudio até aqui fica), e a nota é montada na próxima abertura.
  async function encerrar() {
    if (!atual) return;
    const { pasta, meta, gravadores } = atual;
    atual = null;
    for (const g of Object.values(gravadores)) { try { await g.parar(); } catch { /* segue */ } }
    meta.fim = agora(); meta.estado = 'gravada';
    try { gravarMeta(pasta, meta); } catch { /* sem disco */ }
  }
  function printsDesligados(motivo) { if (atual) { atual.printsLigados = false; atual.motivoPrints = motivo; avisar({ evento: 'prints-off', motivo }); } }

  return { comecar, print, marcar, terminar, processar, pendentes, encerrar, estado, printsDesligados };
}

module.exports = { criar, juntar, nota, slug, minSeg, textoParaResumo };
