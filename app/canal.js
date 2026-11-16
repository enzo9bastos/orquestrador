// Canal entre orquestradores de computadores diferentes, por um servidor ntfy
// (https://ntfy.sh, de preferência um da própria equipe, numa rede privada).
//
// Cada pessoa tem uma caixa (tópico) que só ela lê; os outros escrevem nela.
// O app escuta a caixa do usuário e entrega o que chega à conversa do
// orquestrador, como recado "de fora" (dado, nunca ordem). O orquestrador
// responde com `orq-recado externo <contato> "texto"`; o envio espera o usuário
// aprovar na aba Recados (canalAprovarEnvio) e só então o app publica.
//
// Só o orquestrador usa o canal: os agentes continuam falando só com o
// orquestrador do próprio computador, e nada do canal entra nos containers.
//
// Token: o do cliente oficial do ntfy (~/.config/ntfy/client.yml,
// default-token), lido na hora de conectar e nunca mostrado nem gravado em
// outro lugar. O servidor vem de canalServidor ou do default-host do arquivo.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const anexo = require('./canal-anexo');
const i18n = require('./i18n');

const LIMITE_BYTES = 4096; // o tamanho que o ntfy aceita sem virar anexo
const casa = (p) => String(p || '').replace(/^~(?=$|\/)/, os.homedir());
const arquivoEstado = () => path.join(os.homedir(), '.local', 'share', 'orq-app', 'recados', 'canal.json');

// --- configuração -------------------------------------------------------------
// client.yml do ntfy: só as duas linhas que importam (formato chave: valor).
function lerCliente(arquivo) {
  let txt = '';
  try { txt = fs.readFileSync(casa(arquivo), 'utf8'); } catch { return { host: null, token: null }; }
  const valor = (k) => {
    const m = new RegExp(`^\\s*${k}\\s*:\\s*(.+?)\\s*$`, 'm').exec(txt);
    return m ? m[1].replace(/^["']|["']$/g, '') : null;
  };
  return { host: valor('default-host'), token: valor('default-token') };
}

const nomeCaixa = (s) => String(s || '').trim();
const caixaValida = (s) => /^[A-Za-z0-9_-]{1,64}$/.test(nomeCaixa(s));

// Contatos: [{ nome, caixa }] (ou o texto "Nome: caixa" por linha da tela).
function contatosDe(v) {
  const lista = Array.isArray(v) ? v : String(v || '').split('\n').map((l) => {
    const m = /^\s*(.+?)\s*:\s*([A-Za-z0-9_-]+)\s*$/.exec(l);
    return m ? { nome: m[1], caixa: m[2] } : null;
  });
  return lista.filter((c) => c && String(c.nome || '').trim() && caixaValida(c.caixa))
    .map((c) => ({ nome: String(c.nome).trim().slice(0, 60), caixa: nomeCaixa(c.caixa) }));
}

// O que o canal precisa, a partir da config do app. ativo: há caixa ou
// contato configurado; pronto: além disso, servidor e token achados.
function ajustes(cfg) {
  const cliente = lerCliente(cfg.canalArquivoCliente || '~/.config/ntfy/client.yml');
  const host = String(cfg.canalServidor || cliente.host || '').trim().replace(/\/+$/, '') || null;
  const minhaCaixa = caixaValida(cfg.canalMinhaCaixa) ? nomeCaixa(cfg.canalMinhaCaixa) : null;
  const contatos = contatosDe(cfg.canalContatos);
  const ativo = !!(minhaCaixa || contatos.length);
  let falta = null;
  if (ativo && !host) falta = 'falta o endereço do servidor (canalServidor ou default-host do client.yml)';
  else if (ativo && !/^https?:\/\//.test(host)) falta = 'o endereço do servidor precisa começar com http:// ou https://';
  else if (ativo && !cliente.token) falta = `falta o token (default-token em ${cfg.canalArquivoCliente || '~/.config/ntfy/client.yml'})`;
  return { ativo, pronto: ativo && !falta, falta, host, token: cliente.token, minhaCaixa, contatos,
    // Anexos: quanto o servidor aceita por arquivo e por quantos dias guarda (o
    // servidor combinado: 5 MB e 7 dias). Vêm da configuração; o que chega
    // traz a validade real de cada anexo.
    anexoMax: Math.round((Number(cfg.canalAnexoMaxMB) > 0 ? Math.min(Number(cfg.canalAnexoMaxMB), 20) : 5) * 1024 * 1024),
    anexoDias: Number(cfg.canalAnexoDias) > 0 ? Math.min(Math.round(Number(cfg.canalAnexoDias)), 365) : 7,
    pastaAnexos: String(cfg.canalPastaAnexos || '').trim() ? casa(String(cfg.canalPastaAnexos).trim()) : null,
    meuNome: String(cfg.canalMeuNome || '').trim().slice(0, 60) || null, aprovarEnvio: cfg.canalAprovarEnvio !== false,
    semAprovarCiente: cfg.canalSemAprovarCiente === true, semAprovarInformacao: cfg.canalSemAprovarInformacao === true };
}

function acharContato(contatos, quem) {
  const q = String(quem || '').trim().toLowerCase();
  if (!q) return null;
  return contatos.find((c) => c.caixa.toLowerCase() === q) || contatos.find((c) => c.nome.toLowerCase() === q)
    || (contatos.filter((c) => c.nome.toLowerCase().includes(q)).length === 1 ? contatos.find((c) => c.nome.toLowerCase().includes(q)) : null);
}

// --- o que pode sair ---------------------------------------------------------
// Segredo não passa pelo canal (o servidor guarda as mensagens): recusa texto
// com cara de senha, chave ou token.
const SEGREDOS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:senha|password|passwd|pwd|token|api[_-]?key|secret|segredo)\b\s*[:=]\s*\S{6,}/i,
  /\b(?:sk-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|tk_[a-z0-9]{29})\b/,
  /\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/, // usuario:senha@ numa URL
];
function problemaDoTexto(texto) {
  const t = String(texto || '');
  if (!t.trim()) return 'recado vazio';
  if (Buffer.byteLength(t, 'utf8') > LIMITE_BYTES) return `recado grande demais (${Buffer.byteLength(t, 'utf8')} bytes; o limite é ${LIMITE_BYTES}). Ponha o conteúdo num arquivo compartilhado e mande só o caminho`;
  if (SEGREDOS.some((re) => re.test(t))) return 'o recado parece ter senha, chave ou token; segredo não vai pelo canal (use o cofre)';
  return null;
}

// O nome do arquivo também vai para o servidor: mesma regra do texto. Olha o
// nome como veio (antes de limpar), porque "senha=abc123.png" some na limpeza.
function problemaDoNome(nome) {
  const n = String(nome || '');
  if (!n.trim()) return 'anexo sem nome';
  if (SEGREDOS.some((re) => re.test(n))) return `o nome do arquivo «${n.slice(0, 40)}» parece ter senha, chave ou token; renomeie o arquivo`;
  return null;
}

// Quem mandou: a etiqueta "de-<nome>" que o app põe ao publicar; o nome do
// contato quando ela bate com um. Sem etiqueta: remetente não identificado.
const etiqueta = (nome) => `de-${String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}`;
function remetente(msg, contatos) {
  const tag = (msg.tags || []).find((t) => /^de-[a-z0-9-]+$/.test(t));
  if (!tag) return null;
  // Pelo nome do contato ("de-bruno") ou pela caixa dele sem o "para-" ("de-maestro" → para-maestro).
  const c = contatos.find((x) => etiqueta(x.nome) === tag) || contatos.find((x) => `de-${x.caixa.toLowerCase().replace(/^para-/, '')}` === tag);
  return c ? c.nome : tag.slice(3);
}

// --- o que sai sem o usuário aprovar ------------------------------------------
// O orquestrador diz o tipo do envio; o usuário escolhe quais tipos saem
// sozinhos (canalSemAprovarCiente, canalSemAprovarInformacao). Pedido e
// decisão sempre esperam. O app confere por conta própria: pergunta, ou
// palavra de decisão, preferência, aprovação, promessa, prazo ou compromisso,
// segura o recado para o usuário (falar por ele é decisão dele).
const CLASSES = ['ciente', 'informacao', 'pedido', 'decisao'];
const NOME_CLASSE = { ciente: 'ciente', informacao: 'informação', pedido: 'pedido', decisao: 'decisão' };
const LIMITE_CIENTE = 300;
// Começo de palavra com acento contando como letra (\b do JavaScript não entende acento).
const FALA_POR_ELE = /(?<![\p{L}])(?:(?:decid|decis|prefer|aprov|autoriz|promet|promess|comprom|garant|prazo|concord|combinad)\p{L}*|(?:fechad[oa]s?|pode seguir|pode apagar|pode subir|em nome d[oa])(?![\p{L}]))/iu;
const VERBOS_DELE = '(?:prefer|quer|vai|v[aã]o|acha|pens|decid|aprov|autoriz|concord|top|aceit|promet|garant|disse|falou|pediu|pode|consegu|dev|precis|gost|combin|fic)\\p{L}*';
function falaPeloNome(nome) {
  const n = nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\d/._-])${n}(?![\\p{L}\\d/._-])(?:\\s+(?:n[aã]o|j[aá]|tamb[eé]m|s[oó]|ainda))?\\s+${VERBOS_DELE}`, 'iu');
}
function precisaAprovar(a, { classe, texto }) {
  if (!a.aprovarEnvio) return null;
  const c = CLASSES.includes(classe) ? classe : 'decisao';
  const livre = { ciente: a.semAprovarCiente, informacao: a.semAprovarInformacao }[c];
  if (!livre) return `${NOME_CLASSE[c]}: espera você aprovar`;
  const t = String(texto || '');
  if (c === 'ciente' && t.length > LIMITE_CIENTE) return `marcado como ciente, mas tem mais de ${LIMITE_CIENTE} caracteres: espera você aprovar`;
  if (/\?/.test(t)) return `marcado como ${NOME_CLASSE[c]}, mas tem pergunta (é pedido): espera você aprovar`;
  const m = FALA_POR_ELE.exec(t);
  if (m) return `marcado como ${NOME_CLASSE[c]}, mas parece falar por você («${m[0]}»): espera você aprovar`;
  // O nome do usuário com verbo de vontade, opinião ou compromisso ("o Enzo prefere",
  // "a Ana vai…", "o Enzo topa"). Apresentar-se ("orquestrador do Enzo") ou citar
  // algo dele ("a conta do Enzo", pasta enzo-799/) não segura.
  const n = a.meuNome ? falaPeloNome(a.meuNome).exec(t) : null;
  if (n) return `marcado como ${NOME_CLASSE[c]}, mas parece falar por você («${n[0]}»): espera você aprovar`;
  return null;
}

// --- rede ----------------------------------------------------------------------
// Cabeçalho HTTP só leva ASCII: texto fora disso vai codificado (RFC 2047),
// como o cliente oficial do ntfy faz. Com quebra de linha, sempre codificado.
const cabecalhoTexto = (t) => (/^[\x20-\x7e]*$/.test(t) ? t : `=?UTF-8?B?${Buffer.from(t, 'utf8').toString('base64')}?=`);
const MOTIVO_HTTP = { 401: 'token recusado pelo servidor', 403: 'sem permissão de escrever nessa caixa', 413: 'recado ou anexo grande demais para o servidor', 429: 'servidor pediu para esperar (muitos recados)', 507: 'o servidor está sem espaço para anexos' };

// Um envio. Com `arquivo` ({ nome, tipo, buf }), vai como anexo (PUT, o arquivo
// no corpo; o texto vai em Message). Sem ele, texto simples (POST).
async function publicar(a, { caixa, texto, titulo, arquivo = null, grupo = null }) {
  const headers = { Authorization: `Bearer ${a.token}` };
  if (titulo) headers.Title = cabecalhoTexto(titulo);
  const tags = [a.meuNome ? etiqueta(a.meuNome) : null, grupo ? `rc-${String(grupo).replace(/[^A-Za-z0-9]/g, '').slice(-12)}` : null].filter(Boolean);
  if (tags.length) headers.Tags = tags.join(',');
  let metodo = 'POST';
  let corpo = texto;
  if (arquivo) {
    metodo = 'PUT';
    corpo = arquivo.buf;
    headers['Content-Type'] = anexo.TIPOS[arquivo.tipo];
    headers.Filename = anexo.nomeSeguro(arquivo.nome, arquivo.tipo);
    // Sempre codificado: o texto pode ter quebra de linha, que não cabe em cabeçalho.
    headers.Message = `=?UTF-8?B?${Buffer.from(String(texto || ''), 'utf8').toString('base64')}?=`;
  } else headers['Content-Type'] = 'text/plain; charset=utf-8';
  const r = await fetch(`${a.host}/${encodeURIComponent(caixa)}`, { method: metodo, headers, body: corpo, signal: AbortSignal.timeout(arquivo ? 60000 : 15000) });
  if (!r.ok) {
    const motivo = MOTIVO_HTTP[r.status];
    throw Object.assign(new Error(`HTTP ${r.status}${motivo ? `: ${motivo}` : ''}`), { status: r.status });
  }
  const j = await r.json().catch(() => ({}));
  return { id: j.id || null };
}

// Para quem lê só o texto (ex.: `ntfy subscribe caixa | jq -r .message`) e não vê o
// campo `attachment`: toda mensagem com anexo termina com esta linha. Entra na
// conta dos 4 KB e na recusa de segredo, e sai no idioma do app (en.json).
function linhaDoAnexo(i, n, { nome, tipo, bytes }, dias = 7) {
  return i18n.t(`📎 anexo ${i}/${n}: ${nome} (${anexo.ehImagem(tipo) ? 'imagem' : 'PDF'}, ${anexo.tamanhoLegivel(bytes)}); o arquivo está no campo "attachment" desta mensagem; o link vale ${dias} dias.`);
}
// Texto completo de cada mensagem de um recado com anexos (o que vai em Message).
function textosComAnexos({ texto, titulo, anexos, dias = 7 }) {
  return anexos.map((x, i) => {
    const t = i === 0 ? texto : `Anexo ${i + 1} de ${anexos.length} do mesmo recado${titulo ? ` («${titulo}»)` : ''}.`;
    return `${t}\n${linhaDoAnexo(i + 1, anexos.length, x, dias)}`;
  });
}

// Recado com anexos: um envio por anexo, ligados pelo mesmo id de recado (etiqueta
// rc-<id>). O texto vai no primeiro; os outros dizem de qual recado são. Cada
// anexo é lido da cópia que o usuário aprovou, conferido (hash, tipo, tamanho)
// e sem metadados de novo antes de sair. `desde`: quantos já saíram numa
// tentativa anterior (não repete); aoEnviar(n) avisa a cada um que sai.
async function publicarComAnexos(a, { caixa, texto, titulo, id, anexos, desde = 0, aoEnviar = () => {} }) {
  const max = a.anexoMax || anexo.MAX_PADRAO;
  // Confere tudo ANTES de mandar o primeiro: nada sai pela metade por arquivo ruim.
  const prontos = anexos.map((x, i) => {
    const lido = anexo.lerArquivo(x.arquivo, { max });
    const erro = (m) => Object.assign(new Error(m), { status: 400 });
    if (lido.erro) throw erro(`anexo ${i + 1}: ${lido.erro}`);
    if (x.sha256 && crypto.createHash('sha256').update(lido.buf).digest('hex') !== x.sha256) throw erro(`anexo ${i + 1} (${x.nome}): o arquivo mudou depois da sua aprovação; não mandei`);
    const limpo = anexo.limparMetadados(lido.buf, lido.tipo);
    return { nome: x.nome, tipo: lido.tipo, buf: limpo.buf };
  });
  const textos = textosComAnexos({ texto, titulo, anexos: prontos.map((x, i) => ({ nome: anexos[i].nome, tipo: x.tipo, bytes: x.buf.length })), dias: a.anexoDias || 7 });
  for (const t of textos) {
    const p = problemaDoTexto(t);
    if (p) throw Object.assign(new Error(p), { status: 400 });
  }
  for (let i = desde; i < prontos.length; i++) {
    const t = textos[i];
    await publicar(a, { caixa, texto: t, titulo, arquivo: prontos[i], grupo: id });
    aoEnviar(i + 1);
  }
}

// --- anexo que chega ------------------------------------------------------------
// Baixa o arquivo de uma mensagem com `attachment` do ntfy para a pasta de
// anexos, sem nunca carregar nada fora da lista (png, jpg, webp, pdf) e do
// limite. O link só vale se for do próprio servidor do canal. O download no
// ntfy não pede token (quem tem o link abre): vai sem, e só com o token se o
// servidor pedir. Devolve { ok, caminho, nome, tipo, bytes } ou
// { erro, definitivo } (definitivo: tentar de novo não adianta).
async function baixarAnexo(a, att, { agora = Date.now(), fetchImpl = fetch } = {}) {
  const max = a.anexoMax || anexo.MAX_PADRAO;
  const falha = (erro, definitivo = true) => ({ erro, definitivo });
  if (!att || typeof att.url !== 'string') return falha('a mensagem não trouxe o link do anexo');
  if (Number(att.expires) > 0 && Number(att.expires) * 1000 < agora) return falha(`o anexo expirou no servidor (ele guarda por ${a.anexoDias || 7} dias)`);
  const declarado = anexo.extensaoDe(att.name);
  if (!declarado) return falha('o tipo do arquivo não é aceito (só png, jpg, webp e pdf)');
  if (Number(att.size) > max) return falha(`o anexo é maior que o limite de ${anexo.mb(max)}`);
  let url;
  try { url = new URL(att.url); } catch { return falha('o link do anexo é inválido'); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.origin !== new URL(a.host).origin) return falha('o link do anexo não é do servidor do canal; não baixei');
  try {
    let r = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
    if ((r.status === 401 || r.status === 403) && a.token) r = await fetchImpl(url, { redirect: 'error', headers: { Authorization: `Bearer ${a.token}` }, signal: AbortSignal.timeout(30000) });
    if (r.status === 404 || r.status === 410) return falha('o servidor já apagou o anexo');
    if (!r.ok) return falha(`não consegui baixar o anexo (HTTP ${r.status})`, r.status < 500 && r.status !== 429);
    if (Number(r.headers.get('content-length')) > max) { r.body && r.body.cancel().catch(() => {}); return falha(`o anexo é maior que o limite de ${anexo.mb(max)}`); }
    const partes = [];
    let total = 0;
    for await (const parte of r.body) {
      total += parte.length;
      if (total > max) return falha(`o anexo é maior que o limite de ${anexo.mb(max)}`);
      partes.push(parte);
    }
    const buf = Buffer.concat(partes);
    const tipo = anexo.tipoPorBytes(buf);
    if (!tipo) return falha('o tipo do arquivo não é aceito (só png, jpg, webp e pdf)');
    if (tipo !== declarado) return falha('o tipo do arquivo não bate com o nome; não abri');
    const caminho = anexo.guardarRecebido(a.pastaAnexos, att.name, tipo, buf, new Date(agora));
    return { ok: true, caminho, nome: path.basename(caminho), tipo, bytes: buf.length };
  } catch (e) {
    const msg = e.name === 'TimeoutError' ? 'demorou demais' : /fetch failed|redirect/.test(e.message) ? 'servidor fora do alcance' : e.message;
    return falha(`não consegui baixar o anexo (${msg})`, false);
  }
}

function lerEstado() { try { return JSON.parse(fs.readFileSync(arquivoEstado(), 'utf8')); } catch { return {}; } }
function gravarEstado(e) {
  fs.mkdirSync(path.dirname(arquivoEstado()), { recursive: true });
  const tmp = `${arquivoEstado()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(e) + '\n');
  fs.renameSync(tmp, arquivoEstado());
}

// Escuta a caixa do usuário (stream JSON do ntfy). Reconecta sozinho; ao
// voltar, pede só o que chegou depois da última mensagem vista (o servidor
// guarda por um tempo o que chegou com o app fechado).
// aoChegar(msg): cada mensagem; aoEstado({ conectado, erro }).
function escutar(a, { aoChegar, aoEstado = () => {} }) {
  let parado = false;
  let controle = null;
  let espera = 2000;
  const proximo = (ms) => { if (!parado) setTimeout(rodar, ms).unref?.(); };
  async function rodar() {
    if (parado) return;
    controle = new AbortController();
    const desde = lerEstado()[a.minhaCaixa] || '24h';
    try {
      const r = await fetch(`${a.host}/${encodeURIComponent(a.minhaCaixa)}/json?since=${encodeURIComponent(desde)}`, {
        headers: { Authorization: `Bearer ${a.token}` }, signal: controle.signal,
      });
      if (!r.ok) {
        const msg = { 401: 'token recusado pelo servidor', 403: 'sem permissão de ler essa caixa' }[r.status] || `HTTP ${r.status}`;
        aoEstado({ conectado: false, erro: msg });
        // Token ou permissão errados não se corrigem sozinhos: tenta de novo devagar.
        return proximo([401, 403].includes(r.status) ? 5 * 60 * 1000 : Math.min(espera *= 2, 60000));
      }
      aoEstado({ conectado: true, erro: null });
      espera = 2000;
      let resto = '';
      const dec = new TextDecoder();
      for await (const parte of r.body) {
        resto += dec.decode(parte, { stream: true });
        let i;
        while ((i = resto.indexOf('\n')) >= 0) {
          const linha = resto.slice(0, i).trim();
          resto = resto.slice(i + 1);
          if (!linha) continue;
          let m;
          try { m = JSON.parse(linha); } catch { continue; }
          if (m.event !== 'message') continue;
          try { aoChegar(m); } catch (e) { console.error('[canal]', e.message); }
          const e = lerEstado(); e[a.minhaCaixa] = m.id; gravarEstado(e);
        }
      }
      aoEstado({ conectado: false, erro: 'o servidor fechou a conexão' });
    } catch (e) {
      if (parado) return;
      aoEstado({ conectado: false, erro: e.name === 'TimeoutError' || /fetch failed/.test(e.message) ? 'servidor fora do alcance (rede privada desligada?)' : e.message });
    }
    proximo(Math.min(espera *= 2, 60000));
  }
  rodar();
  return { parar: () => { parado = true; if (controle) controle.abort(); } };
}

module.exports = { linhaDoAnexo, textosComAnexos, problemaDoNome, publicarComAnexos, baixarAnexo, CLASSES, NOME_CLASSE, precisaAprovar, lerCliente, contatosDe, ajustes, acharContato, problemaDoTexto, remetente, etiqueta, publicar, escutar, LIMITE_BYTES, arquivoEstado };
