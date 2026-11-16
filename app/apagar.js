// Apagar e gravar por cima, sempre com volta (regra 3 do plano: toda deleção ou
// sobrescrita passa por aqui).
//
// Nada some direto. Cada alvo vai para a LIXEIRA do sistema (função injetada:
// no app é shell.trashItem; nos testes, uma falsa) ou é COPIADO para
// ~/.local/share/orq-app/versoes/<tipo>-<data>/ ANTES de ser removido ou
// sobrescrito. Se nenhum dos dois der certo, não apaga.
//
// Sempre em dois tempos:
//   1. preparar: confere as recusas, mede o custo em números (quantos
//      arquivos e bytes somem, o que volta e de onde, o que fica órfão, a
//      alternativa que não destrói) e devolve um COMPROVANTE;
//   2. executar: só com o comprovante, que vale para aquele alvo, naquele
//      estado (mudou desde o preparar → recusa), uma vez só e por pouco tempo.
// Não dá para contar (pasta ilegível, link para fora, grande demais, demorou)
// = motivo para recusar, nunca para seguir sem número.
//
// Recusa sempre: o que está aberto no app e o que é do orquestrador (listas
// de quem chama), o que está fora das raízes declaradas, a raiz em si, a
// pasta versoes/ e o registro, a casa do usuário inteira, raízes do sistema,
// alvo que é link e caminho que escapa por link (conferido pelo caminho real).
//
// Cada operação feita deixa uma linha em registro-apagar.jsonl (o que, quando,
// para onde, quanto), só para o usuário poder desfazer: sem conteúdo de
// arquivo, sem texto livre de quem chama.
//
// Tudo assíncrono (fs.promises), com limite de tempo e de tamanho. Nome de
// arquivo é dado não confiável: nada aqui monta comando de shell.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const fsp = fs.promises;

const LIMITES = {
  entradas: 20000, // arquivos + pastas + links medidos por operação
  profundidade: 200,
  tempoMedirMs: 5000,
  bytesCopia: 512 * 1024 * 1024, // o que cabe numa cópia em versoes/
  tempoCopiaMs: 120000,
  tempoLixeiraMs: 30000, // por alvo
  conteudo: 64 * 1024 * 1024, // gravar por cima
  validadeMs: 2 * 60 * 1000, // comprovante
  comprovantes: 200, // em aberto ao mesmo tempo
  alvos: 50, // por registro lógico
};

// Apagar uma destas (ou o que contém uma delas) nunca passa.
const RAIZES_SISTEMA = ['/', '/bin', '/boot', '/dev', '/etc', '/home', '/lib', '/lib32', '/lib64', '/libx32', '/media', '/mnt', '/opt',
  '/proc', '/root', '/run', '/sbin', '/snap', '/srv', '/sys', '/tmp', '/usr', '/var', '/var/tmp',
  '/Applications', '/Library', '/System', '/Users', '/Volumes', '/private'];

const TIPO_OK = /^[a-z0-9][a-z0-9-]{0,39}$/;

// --- caminhos ----------------------------------------------------------------
const dentro = (filho, pai) => filho === pai || (pai === path.sep ? filho.startsWith(pai) : filho.startsWith(pai + path.sep));
const casaReal = async () => { try { return await fsp.realpath(os.homedir()); } catch { return path.resolve(os.homedir()); } };
async function realOuLexico(p) { try { return await fsp.realpath(p); } catch { return path.resolve(p); } }
const caminhoValido = (p) => typeof p === 'string' && p.length > 0 && p.length < 4096 && !p.includes('\0') && path.isAbsolute(p);
const carimbo = () => new Date().toISOString().replace(/[:.]/g, '-');
const textoCurto = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

// Recusa = resultado esperado, não erro: volta como objeto para a tela mostrar.
class Recusa extends Error {
  constructor(codigo, motivo, extra = {}) { super(motivo); this.codigo = codigo; this.extra = extra; }
}
const recusa = (codigo, motivo, extra) => { throw new Recusa(codigo, motivo, extra); };
const comoResultado = (e) => {
  if (e instanceof Recusa) return { ok: false, recusado: true, codigo: e.codigo, motivo: e.message, ...e.extra };
  // Erro fora do previsto: só acontece antes de remover (a remoção trata os dela).
  return { ok: false, recusado: true, codigo: 'erro', motivo: `a operação parou antes de apagar ou gravar (${e && e.code ? e.code : 'erro'}); nada foi apagado` };
};

// O que o app trata como dele hoje (levantado no código da v0.4.1; ver
// inventario.md da entrega 0.E2). Texto → a subárvore toda é intocável;
// { caminho, dentroLivre: true } → só o ponto e quem o contém (o que está
// dentro pode ser apagado, com raiz declarada, como uma nota da pasta).
function protegidosDoApp({ casa = os.homedir(), pastaNotas = null, pastaDemandas = null, transcriptsDoOrquestrador = [], projetos = [] } = {}) {
  const l = [
    path.join(casa, '.config', 'orq-app'), // config.json, topicos.json, workflows.json, credenciais.json…
    path.join(casa, '.cache', 'orq-app', 'conversas.json'), // a lista das conversas (com a do orquestrador)
    path.join(casa, '.cache', 'orq-app', 'sessao-orquestrador'),
  ];
  if (pastaNotas) {
    // A pasta de notas da orquestração: topicos.md e o diário são do orquestrador.
    l.push({ caminho: pastaNotas, dentroLivre: true }, path.join(pastaNotas, 'topicos.md'), path.join(pastaNotas, 'diario'));
  }
  if (pastaDemandas) l.push({ caminho: pastaDemandas, dentroLivre: true }); // cada demanda sai por topicos.apagar
  for (const t of transcriptsDoOrquestrador) if (t) l.push(t, t.replace(/\.jsonl$/, ''));
  for (const p of projetos) if (p) l.push(path.join(p, '.orq')); // recados, eventos e o orq-recado do projeto
  return l;
}

// --- medir -------------------------------------------------------------------
// Anda pela árvore sem seguir link, com prazo e teto de entradas, e devolve os
// números e a "impressão" (lista de nome, tipo, tamanho, data e inode): se
// qualquer coisa mudar até o executar, a impressão muda. raizesOk: para onde
// um link de dentro pode apontar (null = não confere; é a cópia em versoes/).
async function medir(raiz, { prazo, conta, raizesOk }) {
  const r = { arquivos: 0, pastas: 0, links: 0, bytes: 0, linhas: [], forma: [] };
  async function andar(abs, rel, nivel) {
    if (Date.now() > prazo) recusa('demorou', `não deu para medir ${raiz} no tempo limite; nada foi apagado`);
    if (++conta.entradas > conta.max) recusa('grande-demais', `${raiz} tem mais de ${conta.max} itens; grande demais para medir, nada foi apagado`);
    if (nivel > LIMITES.profundidade) recusa('grande-demais', `${raiz} é fundo demais para medir; nada foi apagado`);
    let st;
    try { st = await fsp.lstat(abs, { bigint: true }); } catch (e) {
      if (e.code === 'ENOENT') recusa('alvo-mudou', `${abs} sumiu durante a medição; prepare de novo`);
      recusa('ilegivel', `não consegui ler ${abs} (${e.code}); sem número, nada é apagado`);
    }
    if (st.isSymbolicLink()) {
      let destino;
      try { destino = await fsp.readlink(abs); } catch (e) { recusa('ilegivel', `não consegui ler o link ${abs} (${e.code})`); }
      const lexico = path.resolve(path.dirname(abs), destino);
      const real = await realOuLexico(abs);
      if (raizesOk && !raizesOk.some((z) => dentro(real, z) || dentro(lexico, z))) recusa('link-para-fora', `${abs} é um link para fora das pastas permitidas (${real}); nada foi apagado`);
      r.links++;
      r.linhas.push(`${rel}\0l\0${destino}\0${st.mtimeNs}\0${st.ino}`);
      r.forma.push(`${rel}\0l\0${destino}`);
    } else if (st.isFile()) {
      r.arquivos++;
      r.bytes += Number(st.size);
      r.linhas.push(`${rel}\0f\0${st.size}\0${st.mtimeNs}\0${st.ino}`);
      r.forma.push(`${rel}\0f\0${st.size}`);
    } else if (st.isDirectory()) {
      r.pastas++;
      r.linhas.push(`${rel}\0d`);
      r.forma.push(`${rel}\0d`);
      let nomes;
      try { nomes = (await fsp.readdir(abs)).sort(); } catch (e) { recusa('ilegivel', `não consegui ler a pasta ${abs} (${e.code}); sem número, nada é apagado`); }
      for (const n of nomes) await andar(path.join(abs, n), rel ? `${rel}/${n}` : n, nivel + 1);
    } else {
      recusa('tipo-especial', `${abs} não é arquivo, pasta nem link (soquete, fila ou dispositivo); o app não apaga isso`);
    }
  }
  await andar(raiz, '', 0);
  r.impressao = crypto.createHash('sha256').update(r.linhas.join('\n')).digest('hex');
  delete r.linhas;
  return r;
}

// --- copiar para versoes/ ----------------------------------------------------
async function copiar(origem, destino, orc) {
  if (Date.now() > orc.prazo) recusa('demorou', 'a cópia para versoes/ passou do tempo limite; nada foi apagado');
  const st = await fsp.lstat(origem);
  if (st.isSymbolicLink()) { await fsp.symlink(await fsp.readlink(origem), destino); return; }
  if (st.isFile()) {
    orc.bytes += st.size;
    if (orc.bytes > orc.maxBytes) recusa('grande-demais-para-copiar', 'a cópia passou do limite de tamanho; nada foi apagado');
    await fsp.copyFile(origem, destino, fs.constants.COPYFILE_EXCL);
    await fsp.chmod(destino, st.mode & 0o777);
    return;
  }
  if (st.isDirectory()) {
    await fsp.mkdir(destino, { mode: 0o700 });
    for (const n of (await fsp.readdir(origem)).sort()) await copiar(path.join(origem, n), path.join(destino, n), orc);
    await fsp.chmod(destino, st.mode & 0o777);
    return;
  }
  recusa('tipo-especial', `${origem} não é arquivo, pasta nem link`);
}

// Pasta nova e só nossa em versoes/: <tipo>-<data>-<sorteio>.
async function novaPastaDeVersao(base, tipo) {
  await fsp.mkdir(base, { recursive: true, mode: 0o700 });
  const st = await fsp.lstat(base);
  if (st.isSymbolicLink() || !st.isDirectory()) recusa('versoes-invalida', `${base} não é uma pasta comum; sem onde guardar a cópia, nada é apagado`);
  for (let i = 0; i < 5; i++) {
    const dir = path.join(base, `${tipo}-${carimbo()}-${crypto.randomBytes(3).toString('hex')}`);
    try { await fsp.mkdir(dir, { mode: 0o700 }); return dir; } catch (e) { if (e.code !== 'EEXIST') throw e; }
  }
  recusa('versoes-invalida', 'não consegui criar a pasta da cópia em versoes/; nada foi apagado');
}

const comPrazo = (promessa, ms, motivo) => {
  let t;
  return Promise.race([promessa, new Promise((_, nao) => { t = setTimeout(() => nao(new Error(motivo)), ms); })]).finally(() => clearTimeout(t));
};
const existe = async (p) => { try { await fsp.lstat(p); return true; } catch { return false; } };

async function hashArquivo(p, max) {
  const st = await fsp.lstat(p);
  if (st.size > max) recusa('grande-demais-para-copiar', `${p} passa do limite de ${Math.round(max / 1048576)} MB para guardar a versão anterior`);
  return crypto.createHash('sha256').update(await fsp.readFile(p)).digest('hex');
}

// --- o módulo ------------------------------------------------------------------
// opcoes:
//   lixeira(abs) → Promise   a lixeira do sistema (app: shell.trashItem); sem ela, só versoes/
//   protegidos() → lista      o que é do orquestrador (protegidosDoApp), consultado a cada apagar
//   pastaVersoes, arquivoRegistro: caminhos (padrão em ~/.local/share/orq-app, calculados na hora)
//   limites: troca valores de LIMITES (os testes usam prazos curtos)
//   agora() → ms              relógio (os testes avançam o tempo do comprovante)
//   depoisDaCopia() → Promise só para teste: roda entre a cópia em versoes/ e a remoção
function criar(opcoes = {}) {
  const lim = { ...LIMITES, ...(opcoes.limites || {}) };
  const lixeira = typeof opcoes.lixeira === 'function' ? opcoes.lixeira : null;
  const protegidosFn = typeof opcoes.protegidos === 'function' ? opcoes.protegidos : async () => [];
  const agora = typeof opcoes.agora === 'function' ? opcoes.agora : Date.now;
  const depoisDaCopia = typeof opcoes.depoisDaCopia === 'function' ? opcoes.depoisDaCopia : async () => {};
  const dadosApp = () => path.join(os.homedir(), '.local', 'share', 'orq-app');
  const pastaVersoes = () => opcoes.pastaVersoes || path.join(dadosApp(), 'versoes');
  const arquivoRegistro = () => opcoes.arquivoRegistro || path.join(dadosApp(), 'registro-apagar.jsonl');
  const comprovantes = new Map();

  function limparVencidos() { const t = agora(); for (const [k, c] of comprovantes) if (c.expira <= t) comprovantes.delete(k); }

  async function registrar(linha) {
    try {
      const arq = arquivoRegistro();
      await fsp.mkdir(path.dirname(arq), { recursive: true, mode: 0o700 });
      await fsp.appendFile(arq, JSON.stringify({ quando: new Date(agora()).toISOString(), ...linha }) + '\n', { mode: 0o600 });
      return null;
    } catch (e) { return `a operação foi feita, mas a linha do registro não foi gravada (${e.code || 'erro'})`; }
  }

  // Raízes declaradas: absolutas, existentes, nunca o sistema nem acima da casa.
  async function conferirRaizes(raizes, casa) {
    if (!Array.isArray(raizes) || !raizes.length || raizes.length > 20 || !raizes.every(caminhoValido)) recusa('raiz-invalida', 'quem chama precisa declarar as pastas onde pode apagar (caminhos absolutos)');
    const reais = [];
    for (const r of raizes) {
      let real;
      try { real = await fsp.realpath(r); } catch { recusa('raiz-invalida', `a pasta declarada ${r} não existe`); }
      if (RAIZES_SISTEMA.includes(real) || (real !== casa && dentro(casa, real))) recusa('raiz-invalida', `${r} não pode ser raiz para apagar (é do sistema ou contém a casa do usuário)`);
      reais.push(real);
    }
    return reais;
  }

  // Lista de caminhos protegidos → { arvore: [...], ponto: [...] }, nas duas formas (como veio e real).
  async function normalizarProtegidos(lista, dentroLivrePadrao) {
    const arvore = [], ponto = [];
    for (const item of Array.isArray(lista) ? lista : []) {
      const p = typeof item === 'string' ? item : item && item.caminho;
      if (!caminhoValido(p)) continue;
      const livre = typeof item === 'string' ? dentroLivrePadrao : item.dentroLivre === true;
      for (const c of new Set([path.resolve(p), await realOuLexico(p)])) (livre ? ponto : arvore).push(c);
    }
    return { arvore, ponto };
  }

  // Todas as recusas de um caminho real (o alvo) antes de medir.
  function conferirCaminho(real, lexico, ctx) {
    const { raizes, casa, versoes, registro, emUso, doOrq } = ctx;
    for (const c of new Set([real, lexico])) {
      if (RAIZES_SISTEMA.some((s) => dentro(s, c))) recusa('raiz-do-sistema', `${c} é (ou contém) uma pasta do sistema; o app nunca apaga isso`);
      if (dentro(casa, c)) recusa('casa-inteira', `${c} é (ou contém) a casa do usuário; o app nunca apaga isso`);
      if (versoes.some((v) => dentro(c, v) || dentro(v, c)) || registro.some((r) => dentro(r, c))) recusa('versoes', `${c} é a pasta das versões guardadas (ou o registro) do app; limpar versões é outra decisão, fora daqui`);
      if (emUso.arvore.some((u) => dentro(c, u) || dentro(u, c)) || emUso.ponto.some((u) => dentro(u, c))) recusa('em-uso', `${c} está aberto no app; feche antes de apagar`);
      if (doOrq.arvore.some((u) => dentro(c, u) || dentro(u, c)) || doOrq.ponto.some((u) => dentro(u, c))) recusa('do-orquestrador', `${c} é do orquestrador (ou contém algo dele); o app não apaga isso`);
    }
    const raiz = raizes.find((z) => dentro(real, z));
    if (!raiz) recusa('fora-das-raizes', `${lexico} está fora das pastas permitidas para esta operação${real !== lexico ? ` (o caminho real é ${real})` : ''}`);
    if (raiz === real) recusa('e-a-raiz', `${real} é a própria pasta declarada; o app não apaga a raiz`);
  }

  // comApp: a lista de criar({ protegidos }) vale para APAGAR. Na sobrescrita
  // (sempre com cópia antes) vale só a do pedido: o próprio app grava a
  // config.json, que está na lista dele (proposta-ligacao.md, pergunta 2).
  async function contexto(p, emUsoAgora, comApp) {
    const casa = await casaReal();
    const raizes = await conferirRaizes(p.raizes, casa);
    const versoes = [...new Set([path.resolve(pastaVersoes()), await realOuLexico(pastaVersoes())])];
    const registro = [...new Set([path.resolve(arquivoRegistro()), await realOuLexico(arquivoRegistro())])];
    // No executar, o que abriu desde o preparar soma ao que já estava aberto.
    const emUso = await normalizarProtegidos([...(Array.isArray(p.emUso) ? p.emUso : []), ...(Array.isArray(emUsoAgora) ? emUsoAgora : [])], true);
    let doApp = [];
    if (comApp) try { doApp = await protegidosFn(); } catch { recusa('erro', 'não consegui saber o que é do orquestrador; sem isso, nada é apagado'); }
    const doOrq = await normalizarProtegidos([...(Array.isArray(doApp) ? doApp : []), ...(Array.isArray(p.doOrquestrador) ? p.doOrquestrador : [])], false);
    return { casa, raizes, versoes, registro, emUso, doOrq };
  }

  const sobrepostos = (l) => l.some((a, i) => l.some((b, j) => i !== j && dentro(a, b)));
  const dependentesLimpos = (d) => (Array.isArray(d) ? d : []).slice(0, 50).map((x) => ({ quem: textoCurto(x && x.quem, 200), porque: textoCurto(x && x.porque, 300) })).filter((x) => x.quem);

  // Confere e mede um pedido de apagar. Devolve o estado completo (o custo e o que guardar no comprovante).
  async function avaliarApagar(p, emUsoAgora) {
    if (!p || typeof p !== 'object') recusa('pedido-invalido', 'pedido de apagar sem dados');
    if (!TIPO_OK.test(String(p.tipo || ''))) recusa('pedido-invalido', 'tipo inválido (letras minúsculas, números e hífen, como "conversa" ou "nota")');
    if (!Array.isArray(p.alvos) || !p.alvos.length || p.alvos.length > lim.alvos || !p.alvos.every(caminhoValido)) recusa('pedido-invalido', `os alvos são de 1 a ${lim.alvos} caminhos absolutos`);
    const ctx = await contexto(p, emUsoAgora, true);
    const itens = [];
    for (const a of p.alvos) {
      const lexico = path.resolve(a);
      let st;
      try { st = await fsp.lstat(lexico); } catch { recusa('nao-existe', `${lexico} não existe (ou não dá para ver); nada foi apagado`); }
      if (st.isSymbolicLink()) recusa('alvo-e-link', `${lexico} é um link simbólico; apagar o link ou o que ele aponta é ambíguo, o app recusa`);
      let real;
      try { real = await fsp.realpath(lexico); } catch { recusa('ilegivel', `não consegui achar o caminho real de ${lexico}`); }
      conferirCaminho(real, lexico, ctx);
      itens.push({ lexico, real });
    }
    if (sobrepostos(itens.map((i) => i.real))) recusa('alvos-sobrepostos', 'um alvo está dentro de outro; mande cada coisa uma vez só');
    let destino = p.destino || 'auto';
    if (!['auto', 'lixeira', 'versoes'].includes(destino)) recusa('pedido-invalido', 'destino: auto, lixeira ou versoes');
    if (destino === 'auto') destino = lixeira ? 'lixeira' : 'versoes';
    if (destino === 'lixeira' && !lixeira) recusa('sem-lixeira', 'este app não tem lixeira do sistema ligada; peça com destino "versoes"');
    const conta = { entradas: 0, max: lim.entradas };
    const prazo = Date.now() + lim.tempoMedirMs;
    const medidos = [];
    for (const it of itens) {
      const m = await medir(it.real, { prazo, conta, raizesOk: ctx.raizes });
      medidos.push({ ...it, ...m, tipo: (await fsp.lstat(it.real)).isDirectory() ? 'pasta' : 'arquivo' });
    }
    const soma = (k) => medidos.reduce((n, m) => n + m[k], 0);
    const bytes = soma('bytes');
    if (destino === 'versoes' && bytes > lim.bytesCopia) {
      recusa('grande-demais-para-copiar', `são ${bytes} bytes, acima do limite de ${lim.bytesCopia} para a cópia em versoes/; nada foi apagado`, { alternativa: lixeira ? 'lixeira' : null });
    }
    const custo = {
      operacao: 'apagar',
      tipo: p.tipo,
      alvos: medidos.map((m) => ({ caminho: m.real, tipo: m.tipo, arquivos: m.arquivos, pastas: m.pastas, links: m.links, bytes: m.bytes })),
      arquivos: soma('arquivos'), pastas: soma('pastas'), links: soma('links'), bytes,
      destino,
      volta: { de: destino, onde: destino === 'versoes' ? pastaVersoes() : null, arquivos: soma('arquivos'), links: soma('links'), bytes },
      // O que não volta, em códigos (a tela traduz):
      //   lixeira-esvaziada: se a lixeira for esvaziada, nada volta;
      //   datas-e-dono: a cópia traz conteúdo e permissões, não datas, dono nem atributos estendidos.
      naoVolta: destino === 'lixeira' ? ['lixeira-esvaziada'] : ['datas-e-dono'],
      orfaos: dependentesLimpos(p.dependentes),
      alternativa: p.alternativa ? textoCurto(p.alternativa, 300) : null,
    };
    return { custo, itens: medidos.map((m) => ({ lexico: m.lexico, real: m.real, impressao: m.impressao, forma: m.forma })), destino, raizes: ctx.raizes };
  }

  function emitir(dados) {
    limparVencidos();
    if (comprovantes.size >= lim.comprovantes) recusa('muitos-comprovantes', 'há confirmações demais em aberto; cancele ou espere vencerem');
    const id = crypto.randomBytes(24).toString('hex');
    const expira = agora() + lim.validadeMs;
    comprovantes.set(id, { ...dados, expira });
    return { id, expira };
  }

  // Tira o comprovante da lista ANTES de qualquer coisa: uso único, mesmo se falhar.
  function consumir(id, operacao) {
    const c = typeof id === 'string' ? comprovantes.get(id) : null;
    if (c) comprovantes.delete(id);
    if (!c || c.operacao !== operacao) recusa('comprovante-invalido', 'não há confirmação válida para isto (já usada, de outra operação ou inexistente); prepare de novo');
    if (c.expira <= agora()) recusa('comprovante-vencido', 'a confirmação venceu; prepare de novo para ver o custo atualizado');
    return c;
  }

  const mesmaLista = (a, b) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

  async function prepararApagar(pedido) {
    try {
      const av = await avaliarApagar(pedido);
      const { id, expira } = emitir({ operacao: 'apagar', pedido: structuredClone(pedido), itens: av.itens, destino: av.destino });
      return { ok: true, comprovante: id, validoAte: expira, custo: av.custo };
    } catch (e) { return comoResultado(e); }
  }

  // executar: { comprovante, alvos (os mesmos do preparar), emUso (opcional: a lista de agora) }
  async function executarApagar({ comprovante, alvos, emUso } = {}) {
    let c;
    try {
      c = consumir(comprovante, 'apagar');
      if (!Array.isArray(alvos) || !alvos.every(caminhoValido) || !mesmaLista(alvos.map((a) => path.resolve(a)), c.itens.map((i) => i.lexico))) {
        recusa('comprovante-de-outro-alvo', 'esta confirmação é de outro alvo; nada foi apagado');
      }
      // Tudo de novo: recusas (o que abriu no meio do caminho conta) e a medição.
      const av = await avaliarApagar(c.pedido, emUso);
      if (av.destino !== c.destino) recusa('alvo-mudou', 'o destino mudou desde a confirmação; prepare de novo');
      for (const it of c.itens) {
        const agoraIt = av.itens.find((x) => x.lexico === it.lexico);
        if (!agoraIt || agoraIt.real !== it.real || agoraIt.impressao !== it.impressao) {
          recusa('alvo-mudou', `${it.lexico} mudou desde a confirmação (arquivos novos, mexidos ou trocados); prepare de novo para ver o custo atualizado`);
        }
      }
      return c.destino === 'lixeira' ? await paraLixeira(av) : await paraVersoes(av, c.pedido.tipo);
    } catch (e) { return comoResultado(e); }
  }

  async function paraLixeira(av) {
    const foram = [];
    for (const it of av.itens) {
      let falhou = null;
      try { await comPrazo(Promise.resolve().then(() => lixeira(it.real)), lim.tempoLixeiraMs, 'a lixeira não respondeu a tempo'); } catch (e) { falhou = e; }
      // Conferido pelo disco: só conta como ido o que de fato saiu do lugar.
      if (await existe(it.real)) {
        const ficaram = av.itens.filter((x) => !foram.includes(x.real)).map((x) => x.real);
        const resumo = av.custo.alvos.filter((a) => foram.includes(a.caminho));
        let aviso = null;
        if (foram.length) aviso = await registrar({ operacao: 'apagar', tipo: av.custo.tipo, resultado: 'parcial', destino: 'lixeira', onde: null, alvos: foram, arquivos: resumo.reduce((n, a) => n + a.arquivos, 0), bytes: resumo.reduce((n, a) => n + a.bytes, 0) });
        return { ok: false, codigo: foram.length ? 'parcial' : 'lixeira-falhou', motivo: `a lixeira não aceitou ${it.real}${falhou ? ` (${textoCurto(falhou.message, 200)})` : ''}; ${foram.length ? `${foram.length} item(ns) já tinham ido para a lixeira, o resto ficou onde estava` : 'nada foi apagado'}`, foram, ficaram, aviso };
      }
      foram.push(it.real);
    }
    const aviso = await registrar({ operacao: 'apagar', tipo: av.custo.tipo, resultado: 'ok', destino: 'lixeira', onde: null, alvos: foram, arquivos: av.custo.arquivos, bytes: av.custo.bytes });
    return { ok: true, destino: 'lixeira', onde: null, alvos: foram, arquivos: av.custo.arquivos, bytes: av.custo.bytes, aviso };
  }

  async function paraVersoes(av, tipo) {
    const dir = await novaPastaDeVersao(pastaVersoes(), tipo);
    const orc = { prazo: Date.now() + lim.tempoCopiaMs, bytes: 0, maxBytes: lim.bytesCopia };
    const manifesto = { operacao: 'apagar', tipo, itens: [] };
    // 1. Copia tudo e confere a cópia (mesma forma: nomes, tipos, tamanhos).
    for (let i = 0; i < av.itens.length; i++) {
      const it = av.itens[i];
      const rel = path.join(String(i + 1), path.basename(it.real));
      await fsp.mkdir(path.join(dir, String(i + 1)), { mode: 0o700 });
      try { await copiar(it.real, path.join(dir, rel), orc); } catch (e) {
        if (e instanceof Recusa) throw new Recusa(e.codigo, e.message, { copiaParcial: dir });
        recusa('copia-falhou', `não consegui copiar ${it.real} para versoes/ (${e.code || 'erro'}); nada foi apagado`, { copiaParcial: dir });
      }
      const conta = { entradas: 0, max: lim.entradas };
      const copia = await medir(path.join(dir, rel), { prazo: Date.now() + lim.tempoMedirMs, conta, raizesOk: null });
      if (copia.forma.join('\n') !== it.forma.join('\n')) recusa('copia-falhou', `a cópia de ${it.real} não bateu com o original; nada foi apagado`, { copiaParcial: dir });
      const c = av.custo.alvos[i];
      manifesto.itens.push({ original: it.real, copia: rel, tipo: c.tipo, arquivos: c.arquivos, bytes: c.bytes });
    }
    await fsp.writeFile(path.join(dir, 'manifesto.json'), JSON.stringify(manifesto, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await depoisDaCopia();
    // 2. Mudou enquanto copiava? Não remove nada (a cópia fica, é só uma cópia).
    for (const it of av.itens) {
      const m = await medir(it.real, { prazo: Date.now() + lim.tempoMedirMs, conta: { entradas: 0, max: lim.entradas }, raizesOk: av.raizes }).catch(() => null);
      if (!m || m.impressao !== it.impressao) recusa('alvo-mudou', `${it.real} mudou durante a cópia; nada foi apagado (a cópia ficou em ${dir})`, { copiaParcial: dir });
    }
    // 3. Só agora remove o original.
    const foram = [];
    for (const it of av.itens) {
      try {
        if ((await fsp.lstat(it.real)).isDirectory()) await fsp.rm(it.real, { recursive: true, force: false });
        else await fsp.unlink(it.real);
        foram.push(it.real);
      } catch (e) {
        const resumo = av.custo.alvos.filter((a) => foram.includes(a.caminho));
        const aviso = await registrar({ operacao: 'apagar', tipo, resultado: 'parcial', destino: 'versoes', onde: dir, alvos: foram, arquivos: resumo.reduce((n, a) => n + a.arquivos, 0), bytes: resumo.reduce((n, a) => n + a.bytes, 0) });
        return { ok: false, codigo: 'parcial', motivo: `não consegui remover ${it.real} (${e.code || 'erro'}); a cópia de tudo está em ${dir}`, foram, ficaram: av.itens.map((x) => x.real).filter((x) => !foram.includes(x)), onde: dir, aviso };
      }
    }
    const aviso = await registrar({ operacao: 'apagar', tipo, resultado: 'ok', destino: 'versoes', onde: dir, alvos: foram, arquivos: av.custo.arquivos, bytes: av.custo.bytes });
    return { ok: true, destino: 'versoes', onde: dir, alvos: foram, arquivos: av.custo.arquivos, bytes: av.custo.bytes, aviso };
  }

  // --- gravar por cima ---------------------------------------------------------
  // Sobrescrever é apagar a versão de antes: ela é copiada para versoes/ antes
  // da gravação (ou nada é gravado). Arquivo novo (não existia) não custa nada.
  async function avaliarSobrescrita(p, emUsoAgora) {
    if (!p || typeof p !== 'object') recusa('pedido-invalido', 'pedido de gravar sem dados');
    if (!TIPO_OK.test(String(p.tipo || ''))) recusa('pedido-invalido', 'tipo inválido (letras minúsculas, números e hífen)');
    if (!caminhoValido(p.caminho)) recusa('pedido-invalido', 'o caminho precisa ser absoluto');
    const ctx = await contexto(p, emUsoAgora, false);
    const lexico = path.resolve(p.caminho);
    let st = null;
    try { st = await fsp.lstat(lexico); } catch { /* arquivo novo */ }
    if (st && st.isSymbolicLink()) recusa('alvo-e-link', `${lexico} é um link simbólico; gravar por cima dele é ambíguo, o app recusa`);
    if (st && !st.isFile()) recusa('nao-e-arquivo', `${lexico} existe e não é um arquivo comum`);
    let paiReal;
    try { paiReal = await fsp.realpath(path.dirname(lexico)); } catch { recusa('nao-existe', `a pasta de ${lexico} não existe`); }
    const real = path.join(paiReal, path.basename(lexico));
    conferirCaminho(real, lexico, ctx);
    let impressao = null, bytes = 0;
    if (st) {
      const s = await fsp.lstat(real, { bigint: true });
      bytes = Number(s.size);
      if (bytes > lim.bytesCopia) recusa('grande-demais-para-copiar', `${real} tem ${bytes} bytes, acima do limite para guardar a versão anterior; nada foi gravado`);
      impressao = `${s.size}\0${s.mtimeNs}\0${s.ino}\0${await hashArquivo(real, lim.bytesCopia)}`;
    }
    const custo = {
      operacao: 'sobrescrever', tipo: p.tipo, caminho: real, existe: !!st,
      arquivos: st ? 1 : 0, bytes,
      destino: 'versoes',
      volta: { de: 'versoes', onde: st ? pastaVersoes() : null, arquivos: st ? 1 : 0, bytes },
      naoVolta: st ? ['datas-e-dono'] : [],
      orfaos: dependentesLimpos(p.dependentes),
      alternativa: p.alternativa ? textoCurto(p.alternativa, 300) : null,
    };
    return { custo, lexico, real, impressao, modo: st ? st.mode & 0o777 : 0o644 };
  }

  async function prepararSobrescrita(pedido) {
    try {
      const av = await avaliarSobrescrita(pedido);
      const { id, expira } = emitir({ operacao: 'sobrescrever', pedido: structuredClone(pedido), lexico: av.lexico, real: av.real, impressao: av.impressao });
      return { ok: true, comprovante: id, validoAte: expira, custo: av.custo };
    } catch (e) { return comoResultado(e); }
  }

  async function gravarComCopia(av, conteudo, tipo) {
    const dados = Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(String(conteudo ?? ''), 'utf8');
    if (dados.length > lim.conteudo) recusa('grande-demais', `o conteúdo novo passa de ${lim.conteudo} bytes; nada foi gravado`);
    let dir = null;
    if (av.impressao) {
      dir = await novaPastaDeVersao(pastaVersoes(), tipo);
      const rel = path.join('1', path.basename(av.real));
      await fsp.mkdir(path.join(dir, '1'), { mode: 0o700 });
      try { await fsp.copyFile(av.real, path.join(dir, rel), fs.constants.COPYFILE_EXCL); } catch (e) {
        recusa('copia-falhou', `não consegui guardar a versão anterior de ${av.real} (${e.code || 'erro'}); nada foi gravado`, { copiaParcial: dir });
      }
      if (await hashArquivo(path.join(dir, rel), lim.bytesCopia) !== av.impressao.split('\0')[3]) recusa('alvo-mudou', `${av.real} mudou durante a cópia; nada foi gravado`, { copiaParcial: dir });
      await fsp.writeFile(path.join(dir, 'manifesto.json'), JSON.stringify({ operacao: 'sobrescrever', tipo, itens: [{ original: av.real, copia: rel, tipo: 'arquivo', arquivos: 1, bytes: av.custo.bytes }] }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    }
    // Temporário novo (O_EXCL) na mesma pasta e rename por cima: cair no meio não deixa o arquivo cortado.
    const tmp = path.join(path.dirname(av.real), `.${path.basename(av.real)}.${crypto.randomBytes(6).toString('hex')}.orq-tmp`);
    await fsp.writeFile(tmp, dados, { flag: 'wx', mode: av.modo });
    // Última conferência: o arquivo de antes ainda é o que foi copiado (ou ainda não existe).
    let st = null;
    try { st = await fsp.lstat(av.real, { bigint: true }); } catch { /* não existe */ }
    const igual = av.impressao ? !!st && st.isFile() && av.impressao.startsWith(`${st.size}\0${st.mtimeNs}\0${st.ino}\0`) : !st;
    if (!igual) {
      await fsp.unlink(tmp).catch(() => {}); // o temporário é nosso, nasceu aqui
      recusa('alvo-mudou', `${av.real} mudou desde a confirmação; nada foi gravado`, dir ? { copiaParcial: dir } : {});
    }
    try {
      // Arquivo novo: link() não pisa em quem tenha aparecido no meio (EEXIST); existente: rename por cima da versão já copiada.
      if (av.impressao) await fsp.rename(tmp, av.real);
      else { await fsp.link(tmp, av.real); await fsp.unlink(tmp); }
    } catch (e) {
      await fsp.unlink(tmp).catch(() => {});
      recusa(e.code === 'EEXIST' ? 'alvo-mudou' : 'gravar-falhou', `não consegui gravar ${av.real} (${e.code || 'erro'}); o que estava lá continua${dir ? ` e a cópia está em ${dir}` : ''}`);
    }
    const aviso = av.impressao ? await registrar({ operacao: 'sobrescrever', tipo, resultado: 'ok', destino: 'versoes', onde: dir, alvos: [av.real], arquivos: 1, bytes: av.custo.bytes }) : null;
    return { ok: true, destino: av.impressao ? 'versoes' : null, onde: dir, caminho: av.real, bytesAnteriores: av.custo.bytes, bytes: dados.length, aviso };
  }

  // executar: { comprovante, caminho (o mesmo do preparar), conteudo, emUso (opcional) }
  async function executarSobrescrita({ comprovante, caminho, conteudo, emUso } = {}) {
    try {
      const c = consumir(comprovante, 'sobrescrever');
      if (!caminhoValido(caminho) || path.resolve(caminho) !== c.lexico) recusa('comprovante-de-outro-alvo', 'esta confirmação é de outro arquivo; nada foi gravado');
      const av = await avaliarSobrescrita(c.pedido, emUso);
      if (av.real !== c.real || av.impressao !== c.impressao) recusa('alvo-mudou', `${av.real} mudou desde a confirmação; prepare de novo`);
      return await gravarComCopia(av, conteudo, c.pedido.tipo);
    } catch (e) { return comoResultado(e); }
  }

  // Num passo só, para a gravação que o próprio usuário pediu (salvar a nota,
  // a configuração): as mesmas recusas e a cópia obrigatória; nada se perde,
  // então não pede confirmação. Ver proposta-ligacao.md (pergunta 1).
  async function gravarComVersao(pedido, conteudo) {
    try { return await gravarComCopia(await avaliarSobrescrita(pedido), conteudo, pedido.tipo); } catch (e) { return comoResultado(e); }
  }

  const cancelar = (id) => comprovantes.delete(id);

  return { prepararApagar, executarApagar, prepararSobrescrita, executarSobrescrita, gravarComVersao, cancelar, pastaVersoes, arquivoRegistro, _emAberto: () => comprovantes.size };
}

module.exports = { criar, protegidosDoApp, LIMITES, RAIZES_SISTEMA };
