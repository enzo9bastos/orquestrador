// Pedido de dado de um servidor MCP ("elicitation"): um servidor que o Claude usa pede
// uma informação à pessoa, por um formulário pequeno ou mandando abrir uma página.
//
// Forma do pedido (Claude Code 2.1.326):
//   { subtype: 'elicitation', mcp_server_name, message, mode?: 'form' | 'url', url?,
//     requested_schema?, property_order? }
// e da resposta: { action: 'accept' | 'decline' | 'cancel', content? }.
// O esquema dos campos é o do MCP: um objeto raso em que cada propriedade é texto,
// número, inteiro, sim/não ou uma lista de opções.
//
// Nada do que o servidor manda é confiável. Este módulo confere, corta e limita o
// pedido antes de ele virar tela (normalizar) e confere o que a pessoa preencheu antes
// de ir ao servidor (conferir).
const MAX_CAMPOS = 20;
const MAX_OPCOES = 50;
const MAX_TEXTO = 10000;

// Texto de uma linha, sem códigos de cor do terminal nem caracteres de controle.
const limpo = (s, n) => String(s == null ? '' : s).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, n);
// O esquema do MCP não tem "campo de senha": o app mascara pelo que o campo parece ser.
const PARECE_SEGREDO = /senha|password|passwd|secret|segredo|token|api[\s_-]?key|chave|c[oó]digo|\bcode\b|\bpin\b|\botp\b/i;
const numero = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function campoDe(nome, s, obrigatorio) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  const base = { nome, rotulo: limpo(s.title, 120) || nome, descricao: limpo(s.description, 300), obrigatorio,
    secreto: s.format === 'password' || s.writeOnly === true || PARECE_SEGREDO.test(`${nome} ${limpo(s.title, 120)}`) };
  if (s.type === 'boolean') return { ...base, tipo: 'sim-nao', secreto: false, ...(typeof s.default === 'boolean' ? { padrao: s.default } : {}) };
  if (s.type === 'number' || s.type === 'integer') {
    return { ...base, tipo: s.type === 'integer' ? 'inteiro' : 'numero', secreto: false, minimo: numero(s.minimum), maximo: numero(s.maximum), ...(numero(s.default) !== undefined ? { padrao: s.default } : {}) };
  }
  if (s.type !== 'string') return null;
  // Lista de opções: enum (com enumNames) ou oneOf [{ const, title }].
  const pares = Array.isArray(s.enum) ? s.enum.map((v, i) => [v, Array.isArray(s.enumNames) ? s.enumNames[i] : v])
    : Array.isArray(s.oneOf) ? s.oneOf.map((o) => [o && o.const, o && o.title]) : null;
  if (pares) {
    const opcoes = pares.filter(([v]) => typeof v === 'string' && v).slice(0, MAX_OPCOES).map(([v, r]) => ({ valor: v.slice(0, 200), rotulo: limpo(r, 120) || v.slice(0, 200) }));
    if (!opcoes.length) return null;
    return { ...base, tipo: 'lista', secreto: false, opcoes, ...(typeof s.default === 'string' && opcoes.some((o) => o.valor === s.default) ? { padrao: s.default } : {}) };
  }
  return { ...base, tipo: 'texto', formato: ['email', 'uri', 'date', 'date-time'].includes(s.format) ? s.format : null,
    min: numero(s.minLength), max: numero(s.maxLength), ...(typeof s.default === 'string' && !base.secreto ? { padrao: s.default.slice(0, 500) } : {}) };
}

// O pedido como a tela vai mostrar: { ok, servidor, mensagem, modo, campos } ou, no modo
// página, { ok, servidor, mensagem, modo: 'url', url, site }. ok: false traz `problema`:
// o cartão mostra o pedido, mas só deixa recusar.
function normalizar(pedido) {
  const p = pedido && typeof pedido === 'object' ? pedido : {};
  const base = { servidor: limpo(p.mcp_server_name, 80) || 'servidor MCP', mensagem: limpo(p.message, 1000), modo: p.mode === 'url' ? 'url' : 'form' };
  if (base.modo === 'url') {
    let u = null;
    try { u = new URL(String(p.url || '')); } catch { /* cai no erro abaixo */ }
    if (!u || !/^https?:$/.test(u.protocol) || !u.hostname || u.username || u.password) return { ...base, ok: false, problema: 'o endereço pedido não é uma página http(s) simples', campos: [] };
    return { ...base, ok: true, url: u.toString().slice(0, 2000), site: u.hostname, campos: [] };
  }
  const s = p.requested_schema;
  if (s === undefined || s === null) return { ...base, ok: true, campos: [] };
  if (typeof s !== 'object' || Array.isArray(s) || s.type !== 'object' || !s.properties || typeof s.properties !== 'object' || Array.isArray(s.properties)) {
    return { ...base, ok: false, problema: 'o formulário pedido tem um formato que o app não sabe mostrar', campos: [] };
  }
  const obrigatorios = new Set(Array.isArray(s.required) ? s.required.filter((x) => typeof x === 'string') : []);
  const nomes = Object.keys(s.properties);
  const ordem = [...(Array.isArray(p.property_order) ? p.property_order.filter((n) => typeof n === 'string' && nomes.includes(n)) : []), ...nomes]
    .filter((n, i, l) => l.indexOf(n) === i);
  const campos = [];
  for (const nome of ordem) {
    if (!/^[\w.\- ]{1,80}$/.test(nome)) { if (obrigatorios.has(nome)) return { ...base, ok: false, problema: `campo obrigatório com um nome que o app não aceita: ${limpo(nome, 40)}`, campos: [] }; continue; }
    const c = campoDe(nome, s.properties[nome], obrigatorios.has(nome));
    if (!c) { if (obrigatorios.has(nome)) return { ...base, ok: false, problema: `campo obrigatório de um tipo que o app não sabe mostrar: ${nome}`, campos: [] }; continue; }
    if (campos.length < MAX_CAMPOS) campos.push(c);
    else if (c.obrigatorio) return { ...base, ok: false, problema: `o formulário pede mais de ${MAX_CAMPOS} campos`, campos: [] };
  }
  return { ...base, ok: true, campos };
}

// O que a pessoa preencheu, conferido contra os campos: { ok: true, conteudo } ou
// { ok: false, campo, erro }. Só entram os campos pedidos; opcional vazio fica de fora.
function conferir(campos, valores) {
  const v = valores && typeof valores === 'object' ? valores : {};
  const conteudo = {};
  const falha = (c, erro) => ({ ok: false, campo: c.nome, erro: `${c.rotulo}: ${erro}` });
  for (const c of campos || []) {
    const bruto = v[c.nome];
    const vazio = bruto === undefined || bruto === null || bruto === '';
    if (vazio) { if (c.obrigatorio) return falha(c, 'falta preencher'); continue; }
    if (c.tipo === 'sim-nao') {
      if (typeof bruto !== 'boolean') return falha(c, 'precisa ser sim ou não');
      conteudo[c.nome] = bruto;
    } else if (c.tipo === 'numero' || c.tipo === 'inteiro') {
      const n = typeof bruto === 'number' ? bruto : Number(String(bruto).trim().replace(',', '.'));
      if (!Number.isFinite(n) || (c.tipo === 'inteiro' && !Number.isInteger(n))) return falha(c, c.tipo === 'inteiro' ? 'precisa ser um número inteiro' : 'precisa ser um número');
      if ((c.minimo !== undefined && n < c.minimo) || (c.maximo !== undefined && n > c.maximo)) {
        return falha(c, c.minimo !== undefined && c.maximo !== undefined ? `precisa ficar entre ${c.minimo} e ${c.maximo}` : c.minimo !== undefined ? `precisa ser pelo menos ${c.minimo}` : `precisa ser no máximo ${c.maximo}`);
      }
      conteudo[c.nome] = n;
    } else if (c.tipo === 'lista') {
      if (!c.opcoes.some((o) => o.valor === bruto)) return falha(c, 'escolha uma das opções');
      conteudo[c.nome] = bruto;
    } else {
      if (typeof bruto !== 'string' || bruto.length > MAX_TEXTO) return falha(c, 'texto inválido ou grande demais');
      if (c.min !== undefined && bruto.length < c.min) return falha(c, `precisa ter pelo menos ${c.min} caracteres`);
      if (c.max !== undefined && bruto.length > c.max) return falha(c, `precisa ter no máximo ${c.max} caracteres`);
      conteudo[c.nome] = bruto;
    }
  }
  return { ok: true, conteudo };
}

module.exports = { normalizar, conferir };
