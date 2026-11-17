#!/usr/bin/env node
// Área: cli-real
// Conferidor do contrato do app com os CLIs instalados (0.D2). Fica FORA do
// `npm test`: roda à mão a cada atualização do Claude Code ou do Codex.
//
//   node scripts/contrato-cli.js                 confere os dois
//   node scripts/contrato-cli.js --so claude     só um
//   node scripts/contrato-cli.js --ajuda         todas as opções
//
// O contrato (o que o app manda e o que ele lê de volta) é dado, não código:
// scripts/contrato-cli.json. Para cada item o script pergunta ao CLI de verdade
// e, quando não dá para perguntar sem chamar o modelo, procura nos arquivos
// empacotados do CLI (no Codex, no esquema JSON que o próprio CLI gera).
//
// Travas (a casa falsa e o ambiente do zero não têm opção para desligar; a
// rede só se abre com --rede=proxy, escrito à mão):
//  - casa falsa: HOME, CLAUDE_CONFIG_DIR, CODEX_HOME, XDG_* e TMPDIR apontam
//    para uma pasta temporária nova e vazia. O ambiente do CLI é montado do
//    zero: nenhuma variável do usuário (nem chave de API) desce para ele.
//  - sem rede: o CLI roda num espaço de rede próprio (`unshare -n`), onde só
//    existe a interface de loopback, desligada; os proxies e a URL da API
//    apontam para 127.0.0.1:9 (porta morta). Sem `unshare`, o script se recusa,
//    salvo com --rede=proxy (só os proxies; aí a rede NÃO fica isolada).
//  - nunca faz login, nunca lê arquivo de credencial, nunca manda mensagem que
//    comece um turno do modelo: só pedidos de controle e dois comandos locais
//    do Claude (/clear e /rename), que não saem da máquina.
//  - --prova <pasta>: roda o CLI sob `strace` e grava a lista de conexões que
//    ele tentou (todas têm de falhar).
// A casa temporária que o script cria é apagada no fim (--manter-casa guarda).
//
// Saída: tabela (item → atende / NÃO ATENDE / não deu para saber), um retrato
// em JSON por CLI e versão (só a forma do que veio, sem valores: rodar de novo
// na mesma versão dá o mesmo retrato) e o código de saída 1 quando algo de que
// o app depende não bate. 2: erro do próprio script. 3: uma conexão saiu.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ATENDE = 'atende';
const NAO = 'nao-atende';
const NAO_SEI = 'nao-sei';
const PORTA_MORTA = 'http://127.0.0.1:9';
const ID_FALSO = '00000000-0000-4000-8000-000000000001';

// --- funções puras (testadas em app/tests/unit/contrato-cli.test.js) ---------

// 'a.b[].c' → ['a', 'b[]', 'c'].
const partes = (caminho) => String(caminho).split('.').filter(Boolean);

// O caminho existe no valor? 'sim', 'nao' ou 'vazio' (passa por lista vazia,
// objeto vazio ou null: não dá para saber).
function verCampo(v, segs) {
  if (!segs.length) return v === undefined ? 'nao' : 'sim';
  if (v === null) return 'vazio';
  if (typeof v !== 'object') return 'nao';
  const [s, ...resto] = segs;
  if (s === '*') {
    const vals = Object.values(v);
    return vals.length ? melhor(vals.map((x) => verCampo(x, resto))) : 'vazio';
  }
  const lista = s.endsWith('[]');
  const nome = lista ? s.slice(0, -2) : s;
  const x = nome ? v[nome] : v;
  if (x === undefined) return 'nao';
  if (!lista) return verCampo(x, resto);
  if (!Array.isArray(x)) return 'nao';
  return x.length ? melhor(x.map((e) => verCampo(e, resto))) : 'vazio';
}
function melhor(rs) { return rs.includes('sim') ? 'sim' : rs.includes('vazio') ? 'vazio' : 'nao'; }

// Confere uma lista de campos ('x|y' = um ou outro; 'x?' = opcional) em vários
// valores (basta um ter). Devolve o que falta, o que não deu para ver e os
// opcionais ausentes.
function conferirCampos(valores, campos, ver = (v, segs) => verCampo(v, segs)) {
  const r = { faltam: [], semComoVer: [], opcionaisAusentes: [] };
  for (const c of campos || []) {
    const opcional = c.endsWith('?');
    const alternativas = c.replace(/\?$/, '').split('|');
    const res = melhor(alternativas.flatMap((a) => (valores.length ? valores.map((v) => ver(v, partes(a))) : ['vazio'])));
    if (res === 'sim' || (opcional && res === 'vazio')) continue;
    if (opcional) r.opcionaisAusentes.push(c);
    else if (res === 'vazio') r.semComoVer.push(c);
    else r.faltam.push(c);
  }
  return r;
}
function statusDosCampos(r) { return r.faltam.length ? NAO : r.semComoVer.length ? NAO_SEI : ATENDE; }
function textoDosCampos(r) {
  return [r.faltam.length ? `falta ${r.faltam.join(', ')}` : '', r.semComoVer.length ? `sem como ver ${r.semComoVer.join(', ')}` : '',
    r.opcionaisAusentes.length ? `opcionais ausentes ${r.opcionaisAusentes.join(', ')}` : ''].filter(Boolean).join('; ');
}

// Chave que muda a cada execução (id, caminho) vira um marcador na forma.
const chaveVariavel = (k) => /^[0-9a-f-]{16,}$/i.test(k) || k.includes('/') || /^\d+$/.test(k);
// A forma de um valor, sem os valores: o que o retrato guarda.
function forma(v, prof = 0) {
  if (v === null) return 'null';
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    return `[${[...new Set(v.map((e) => forma(e, prof + 1)))].sort().join('|')}]`;
  }
  if (typeof v === 'object') {
    const ks = Object.keys(v);
    if (!ks.length) return '{}';
    if (prof >= 4) return '{…}';
    const vistas = new Map();
    for (const k of ks) {
      const nome = chaveVariavel(k) ? '<chave>' : k;
      if (!vistas.has(nome)) vistas.set(nome, forma(v[k], prof + 1));
    }
    return `{${[...vistas.keys()].sort().map((k) => `${k}:${vistas.get(k)}`).join(',')}}`;
  }
  return typeof v;
}

// Texto de erro sem o que muda entre execuções (casa temporária, ids, horas).
function limpar(texto, casa) {
  let t = String(texto == null ? '' : texto);
  if (casa) t = t.split(casa).join('<casa>');
  return t.split(os.homedir()).join('~')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\d{4}-\d\d-\d\dT[\d:.]+Z?/g, '<hora>')
    .replace(/\s+/g, ' ').trim().slice(0, 200);
}

// --- esquema JSON (o do Codex) --------------------------------------------------
function deref(defs, s) {
  for (let i = 0; s && s.$ref && i < 50; i++) s = defs[String(s.$ref).replace(/^#\/(definitions|\$defs)\//, '')];
  return s || {};
}
// As alternativas de um esquema (oneOf/anyOf/allOf abertos; allOf conta como
// alternativa: basta o campo existir em uma das partes).
function ramos(defs, s, prof = 0) {
  s = deref(defs, s);
  const sub = ['oneOf', 'anyOf', 'allOf'].flatMap((k) => (Array.isArray(s[k]) ? s[k] : []));
  if (!sub.length || prof > 20) return [s];
  const fora = s.properties || s.items || s.type || s.enum || s.const !== undefined ? [s] : [];
  return [...fora, ...sub.flatMap((b) => ramos(defs, b, prof + 1))];
}
const valoresDe = (defs, s) => {
  const vs = [];
  for (const r of ramos(defs, s)) { if (r.const !== undefined) vs.push(r.const); if (Array.isArray(r.enum)) vs.push(...r.enum); }
  return vs;
};
// O caminho existe no esquema? Segmentos como em verCampo, mais '[campo=valor]'
// (escolhe a variante de uma união pelo valor do campo).
function noEsquema(defs, s, segs) {
  if (!segs.length) return 'sim';
  const [seg, ...resto] = segs;
  const filtro = /^\[(\w+)=([^\]]+)\]$/.exec(seg);
  const rs = ramos(defs, s);
  if (filtro) {
    const escolhidos = rs.filter((r) => r.properties && r.properties[filtro[1]] && valoresDe(defs, r.properties[filtro[1]]).includes(filtro[2]));
    return escolhidos.length ? melhor(escolhidos.map((r) => noEsquema(defs, r, resto))) : 'nao';
  }
  const res = [];
  for (const r of rs) {
    if (seg === '*') { if (r.additionalProperties && typeof r.additionalProperties === 'object') res.push(noEsquema(defs, r.additionalProperties, resto)); continue; }
    const lista = seg.endsWith('[]');
    const nome = lista ? seg.slice(0, -2) : seg;
    const p = nome ? r.properties && r.properties[nome] : r;
    if (!p) continue;
    if (!lista) { res.push(noEsquema(defs, p, resto)); continue; }
    for (const a of ramos(defs, p)) if (a.items) res.push(noEsquema(defs, a.items, resto));
  }
  return res.length ? melhor(res) : 'nao';
}
// Os valores que o esquema aceita no caminho (null: sem lista fechada).
function valoresNoEsquema(defs, s, segs) {
  let atuais = [s];
  for (const seg of segs) {
    const filtro = /^\[(\w+)=([^\]]+)\]$/.exec(seg);
    const prox = [];
    for (const a of atuais) {
      for (const r of ramos(defs, a)) {
        if (filtro) { if (r.properties && r.properties[filtro[1]] && valoresDe(defs, r.properties[filtro[1]]).includes(filtro[2])) prox.push(r); continue; }
        const lista = seg.endsWith('[]');
        const nome = lista ? seg.slice(0, -2) : seg;
        const p = r.properties && r.properties[nome];
        if (!p) continue;
        if (lista) { for (const b of ramos(defs, p)) if (b.items) prox.push(b.items); } else prox.push(p);
      }
    }
    atuais = prox;
  }
  const vs = atuais.flatMap((a) => valoresDe(defs, a));
  const abertos = atuais.some((a) => ramos(defs, a).some((r) => r.type === 'string' && r.enum === undefined && r.const === undefined));
  return vs.length && !abertos ? vs : null;
}
// Validador do pedaço de JSON Schema que o esquema do Codex usa: devolve a
// lista de problemas (vazia = válido).
function validar(defs, s, v, onde = '') {
  s = deref(defs, s);
  const aqui = onde || '(raiz)';
  for (const k of ['oneOf', 'anyOf']) {
    if (!Array.isArray(s[k])) continue;
    let menor = null;
    for (const b of s[k]) { const e = validar(defs, b, v, onde); if (!e.length) { menor = []; break; } if (!menor || e.length < menor.length) menor = e; }
    if (menor && menor.length) return menor;
  }
  if (Array.isArray(s.allOf)) for (const b of s.allOf) { const e = validar(defs, b, v, onde); if (e.length) return e; }
  if (s.const !== undefined && v !== s.const) return [`${aqui}: esperava ${JSON.stringify(s.const)}`];
  if (Array.isArray(s.enum) && !s.enum.includes(v)) return [`${aqui}: ${JSON.stringify(v)} fora de ${JSON.stringify(s.enum).slice(0, 120)}`];
  if (s.type) {
    const tipos = Array.isArray(s.type) ? s.type : [s.type];
    const t = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
    const ok = tipos.some((x) => x === t || (x === 'integer' && Number.isInteger(v)) || (x === 'number' && t === 'number'));
    if (!ok) return [`${aqui}: tipo ${t}, esperava ${tipos.join('|')}`];
  }
  const erros = [];
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const r of s.required || []) if (!(r in v)) erros.push(`${aqui}: falta ${r}`);
    for (const [k, x] of Object.entries(v)) {
      const p = s.properties && s.properties[k];
      if (p) erros.push(...validar(defs, p, x, onde ? `${onde}.${k}` : k));
      else if (s.additionalProperties === false) erros.push(`${aqui}: campo desconhecido ${k}`);
      else if (s.additionalProperties && typeof s.additionalProperties === 'object') erros.push(...validar(defs, s.additionalProperties, x, onde ? `${onde}.${k}` : k));
    }
  }
  if (Array.isArray(v) && s.items) v.forEach((x, i) => erros.push(...validar(defs, s.items, x, `${onde}[${i}]`)));
  return erros;
}

// Troca os marcadores dos parâmetros ($thread, $cwd, $tmp).
function preencher(v, valores) {
  if (typeof v === 'string' && Object.prototype.hasOwnProperty.call(valores, v)) return valores[v];
  if (Array.isArray(v)) return v.map((x) => preencher(x, valores));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, preencher(x, valores)]));
  return v;
}

// Junta duas fontes (ao vivo e esquema/estático): uma que reprova reprova;
// senão, uma que aprova aprova.
function combinar(...ss) {
  const xs = ss.filter((s) => s);
  if (xs.includes(NAO)) return NAO;
  if (xs.includes(ATENDE)) return ATENDE;
  return xs.length ? NAO_SEI : null;
}

// Pedido de controle que o Claude não conhece.
const naoExisteClaude = (r) => !!r && r.subtype === 'error'
  && (r.error_code === 'unsupported_request' || /unsupported control request|unknown (control )?request subtype|pedido desconhecido/i.test(String(r.error || '')));
// Método que o Codex não conhece.
const naoExisteCodex = (e) => !!e && (e.code === -32601 || /unknown variant|method not found/i.test(String(e.message || '')));
// O Codex recusou os parâmetros que o app manda.
const parametrosRecusados = (e) => !!e && /unknown field|missing field|invalid type|invalid params|failed to deserialize/i.test(String(e.message || ''));
// O Codex só atende com uma capacidade que o app não declara no initialize.
const capacidadeFaltando = (e) => (e && /requires (\w+) capability/i.exec(String(e.message || ''))) || null;

// Estático: todos os nomes têm de estar nos arquivos do CLI.
function avaliarEstatico(nomes, achados) {
  if (!nomes || !nomes.length) return null;
  if (!achados) return { status: NAO_SEI, texto: 'arquivos do CLI não lidos' };
  const faltam = nomes.filter((n) => !achados.has(n));
  return faltam.length ? { status: NAO, texto: `não achei nos arquivos do CLI: ${faltam.join(', ')}` } : { status: ATENDE, texto: `nomes presentes nos arquivos do CLI (${nomes.length})` };
}

function linha(item, cli, campos) {
  return { cli, id: item.id, depende: item.depende !== false, onde: item.onde || '', fonte: '', existe: null, formato: null, visto: '', detalhe: '', ...campos };
}

// obs (claude): { rodou, erro, versao, casa, eventos: [], controles: { id: resposta|null },
//   flags: { codigo, stderr } | null, transcript: { arquivo, pastaEsperada, linhas } | null,
//   estatico: Set | null }
function avaliarClaude(contrato, obs) {
  const linhas = [];
  for (const item of contrato.itens) {
    const est = avaliarEstatico(item.estatico, obs.estatico);
    if (!obs.rodou && item.tipo !== 'estatico') {
      linhas.push(linha(item, 'claude', { fonte: est ? 'estático' : '', existe: est ? est.status : NAO_SEI, formato: NAO_SEI, detalhe: [obs.erro || 'o CLI não rodou', est && est.texto].filter(Boolean).join('; ') }));
      continue;
    }
    if (item.tipo === 'estatico') {
      linhas.push(linha(item, 'claude', { fonte: 'estático', existe: est ? est.status : NAO_SEI, formato: null, detalhe: est ? est.texto : '' }));
    } else if (item.tipo === 'flags') {
      const f = obs.flags;
      if (!f) { linhas.push(linha(item, 'claude', { fonte: 'estático', existe: est ? est.status : NAO_SEI, formato: NAO_SEI, detalhe: 'não rodei com as opções' })); continue; }
      const desconhecida = /unknown option|unknown argument|error: option/i.exec(f.stderr);
      const bate = new RegExp(item.stderr).test(f.stderr) && f.codigo !== 0;
      linhas.push(linha(item, 'claude', { fonte: 'vivo', existe: desconhecida ? NAO : ATENDE, formato: bate ? ATENDE : NAO,
        visto: `código ${f.codigo}; ${limpar(f.stderr.split('\n').find((l) => l.trim()) || '(stderr vazio)', obs.casa)}`,
        detalhe: desconhecida ? `opção recusada: ${limpar(f.stderr.split('\n').find((l) => /unknown|error/i.test(l)), obs.casa)}` : bate ? '' : `sessão inexistente não disse "${item.stderr}" no stderr` }));
    } else if (item.tipo === 'controle') {
      if (item.vivo === false) {
        linhas.push(linha(item, 'claude', { fonte: 'estático', existe: est ? est.status : NAO_SEI, formato: NAO_SEI, detalhe: [`não mandado (${item.porque})`, est && est.texto].filter(Boolean).join('; ') }));
        continue;
      }
      const r = obs.controles[item.id];
      if (r === undefined || r === null) {
        linhas.push(linha(item, 'claude', { fonte: 'vivo', existe: NAO, formato: NAO_SEI, visto: 'sem resposta', detalhe: 'o CLI não respondeu: o app ficaria esperando até desistir' }));
        continue;
      }
      if (item.inexistente) {
        const erro = r.subtype === 'error';
        linhas.push(linha(item, 'claude', { fonte: 'vivo', existe: erro ? ATENDE : NAO, formato: erro && r.error_code === item.errorCode ? ATENDE : NAO,
          visto: erro ? `erro ${r.error_code || '(sem error_code)'}: ${limpar(r.error, obs.casa)}` : `aceitou: ${forma(r.response)}`,
          detalhe: erro && r.error_code !== item.errorCode ? `veio erro, mas sem error_code "${item.errorCode}"` : erro ? '' : 'um subtipo que não existe foi aceito' }));
        continue;
      }
      if (r.subtype !== 'success') {
        const nao = naoExisteClaude(r);
        linhas.push(linha(item, 'claude', { fonte: 'vivo', existe: nao ? NAO : ATENDE, formato: nao ? NAO : NAO_SEI,
          visto: `erro ${r.error_code || ''}: ${limpar(r.error, obs.casa)}`.replace('erro :', 'erro:'),
          detalhe: nao ? 'o CLI não conhece este pedido' : 'existe, mas recusou o pedido de teste (sem conta ou sem tarefa): formato não conferido' }));
        continue;
      }
      const c = conferirCampos([r.response || {}], item.campos);
      linhas.push(linha(item, 'claude', { fonte: 'vivo', existe: ATENDE, formato: statusDosCampos(c), visto: forma(r.response || {}), detalhe: textoDosCampos(c) }));
    } else if (item.tipo === 'evento') {
      // casa.com: campos (caminho com pontos) que o evento precisa trazer com aquele valor.
      const pegar = (o, caminho) => caminho.split('.').reduce((x, k) => (x && typeof x === 'object' ? x[k] : undefined), o);
      const vistos = item.vivo === false ? [] : obs.eventos.filter((e) => e && e.type === item.casa.type && (!item.casa.subtype || e.subtype === item.casa.subtype)
        && Object.entries(item.casa.com || {}).every(([caminho, valor]) => pegar(e, caminho) === valor));
      if (!vistos.length) {
        const porque = item.vivo === false ? `não dá para ver sem chamar o modelo (${item.porque})` : 'não apareceu nesta conferência';
        linhas.push(linha(item, 'claude', { fonte: est ? 'estático' : '', existe: est ? est.status : NAO_SEI, formato: NAO_SEI, detalhe: [porque, est && est.texto].filter(Boolean).join('; ') }));
        continue;
      }
      const c = conferirCampos(vistos, item.campos);
      // item.texto: o texto da mensagem precisa bater com a expressão que o app usa.
      const textoDe = (e) => ((e.message && Array.isArray(e.message.content) ? e.message.content : []).filter((b) => b && b.type === 'text').map((b) => b.text).join(' ').trim());
      const foraDoTexto = item.texto ? vistos.filter((e) => !new RegExp(item.texto).test(textoDe(e))) : [];
      const detalhe = [textoDosCampos(c), foraDoTexto.length ? `texto fora do formato que o app espera (${item.texto}): "${limpar(textoDe(foraDoTexto[0]), obs.casa).slice(0, 120)}"` : ''].filter(Boolean).join('; ');
      linhas.push(linha(item, 'claude', { fonte: 'vivo', existe: ATENDE, formato: foraDoTexto.length ? NAO : statusDosCampos(c), visto: forma(vistos[vistos.length - 1]), detalhe }));
    } else if (item.tipo === 'transcript') {
      const t = obs.transcript;
      if (!t || !t.arquivo) { linhas.push(linha(item, 'claude', { fonte: 'vivo', existe: NAO_SEI, formato: NAO_SEI, detalhe: 'o CLI não gravou transcript nesta conferência' })); continue; }
      const usuario = t.linhas.filter((l) => l.type === 'user');
      const c = conferirCampos(usuario, item.campos);
      const titulos = t.linhas.filter((l) => l.type === 'custom-title');
      const ct = titulos.length ? conferirCampos(titulos, item.titulo) : { faltam: [], semComoVer: item.titulo || [], opcionaisAusentes: [] };
      const junto = { faltam: [...c.faltam, ...ct.faltam], semComoVer: [...c.semComoVer, ...ct.semComoVer], opcionaisAusentes: c.opcionaisAusentes };
      linhas.push(linha(item, 'claude', { fonte: 'vivo', existe: ATENDE, formato: statusDosCampos(junto),
        visto: `${t.pastaEsperada ? 'pasta com o nome esperado' : 'pasta com OUTRO nome (o app procura em todas)'}; tipos: ${[...new Set(t.linhas.map((l) => l.type))].sort().join(',')}`,
        detalhe: textoDosCampos(junto) }));
    }
  }
  return linhas;
}

// obs (codex): { rodou, erro, versao, casa, iniciou, respostas: { id: { result } | { error } | null },
//   notificacoes: { metodo: [params] }, esquema: { defs, cliente, clienteEstavel, notifCliente, notifServidor, pedidosServidor } | null,
//   estatico: Set | null }
function avaliarCodex(contrato, obs) {
  const linhas = [];
  const esq = obs.esquema;
  const def = (nome) => (esq && nome && esq.defs[nome]) || null;
  const respDe = (paramsRef) => (paramsRef ? paramsRef.replace(/Params$/, 'Response') : null);
  const PREENCHER = { $thread: ID_FALSO, $cwd: '/tmp/orq-contrato', $tmp: '/tmp' };
  for (const item of contrato.itens) {
    const nomes = item.estatico || (item.metodo ? [item.metodo] : item.variante ? [item.variante] : []);
    const est = item.inexistente ? null : avaliarEstatico(nomes, obs.estatico);
    let vivoE = null, vivoF = null, esqE = null, esqF = null;
    const visto = [], detalhe = [], fontes = [];
    if (item.tipo === 'args') {
      if (obs.rodou) { fontes.push('vivo'); vivoE = obs.iniciou ? ATENDE : NAO; vivoF = vivoE; if (!obs.iniciou) detalhe.push(`o app-server não respondeu ao initialize com estes argumentos: ${limpar(obs.stderr, obs.casa)}`); }
    } else if (item.tipo === 'metodo') {
      const r = obs.respostas[item.id];
      if (item.vivo === false) detalhe.push(`não mandado ao vivo (${item.porque})`);
      else if (obs.iniciou && r === null) { fontes.push('vivo'); vivoE = NAO; vivoF = NAO_SEI; visto.push('sem resposta'); detalhe.push('o CLI não respondeu: o app ficaria esperando'); }
      else if (obs.iniciou && r) {
        fontes.push('vivo');
        if (item.inexistente) {
          vivoE = r.error ? ATENDE : NAO; vivoF = r.error && naoExisteCodex(r.error) ? ATENDE : r.error ? NAO_SEI : NAO;
          visto.push(r.error ? `erro ${r.error.code}: ${limpar(r.error.message, obs.casa).slice(0, 90)}` : `aceitou: ${forma(r.result)}`);
          if (!r.error) detalhe.push('um método que não existe foi aceito');
        } else if (r.error) {
          if (naoExisteCodex(r.error)) { vivoE = NAO; vivoF = NAO; detalhe.push('o CLI não conhece este método'); }
          else if (item.erro && new RegExp(item.erro, 'i').test(r.error.message || '')) { vivoE = ATENDE; vivoF = ATENDE; detalhe.push('o erro de "não achei" é o que o app reconhece'); }
          else if (item.erro) { vivoE = ATENDE; vivoF = NAO; detalhe.push(`o erro não casa com /${item.erro}/: o app não saberia que a conversa sumiu`); }
          else if (parametrosRecusados(r.error)) { vivoE = ATENDE; vivoF = NAO; detalhe.push('recusou os parâmetros que o app manda'); }
          else if (capacidadeFaltando(r.error)) { vivoE = ATENDE; vivoF = NAO; detalhe.push(`só atende com a capacidade ${capacidadeFaltando(r.error)[1]} no initialize, que o app não declara`); }
          else { vivoE = ATENDE; vivoF = NAO_SEI; detalhe.push('existe, mas recusou o pedido de teste (sem conta?): formato pelo esquema'); }
          visto.push(`erro ${r.error.code}: ${limpar(r.error.message, obs.casa)}`);
        } else {
          vivoE = ATENDE;
          const c = conferirCampos([r.result || {}], item.campos);
          vivoF = statusDosCampos(c);
          visto.push(forma(r.result || {}));
          if (textoDosCampos(c)) detalhe.push(`ao vivo: ${textoDosCampos(c)}`);
        }
      }
      if (esq) {
        fontes.push('esquema');
        const ref = esq.cliente.has(item.metodo) ? esq.cliente.get(item.metodo) : undefined;
        if (item.inexistente) { esqE = ref === undefined ? ATENDE : NAO; }
        else if (ref === undefined) { esqE = NAO; esqF = NAO; detalhe.push('o método não está no esquema do CLI'); }
        else {
          esqE = ATENDE;
          if (esq.clienteEstavel && !esq.clienteEstavel.has(item.metodo)) detalhe.push('método experimental no CLI');
          const ps = [];
          if (ref && def(ref)) ps.push(...validar(esq.defs, def(ref), preencher(item.params || {}, PREENCHER)));
          const resp = def(item.esquemaResposta || respDe(ref));
          let fCampos = null;
          if (resp) {
            const c = conferirCampos([resp], item.campos, (s, segs) => (noEsquema(esq.defs, s, segs) === 'sim' ? 'sim' : 'nao'));
            fCampos = statusDosCampos(c);
            if (textoDosCampos(c)) detalhe.push(`esquema da resposta: ${textoDosCampos(c)}`);
          } else if ((item.campos || []).length) detalhe.push('sem esquema da resposta');
          if (ps.length) detalhe.push(`parâmetros do app fora do esquema: ${ps.slice(0, 3).join('; ')}`);
          esqF = ps.length ? NAO : fCampos || (resp || !(item.campos || []).length ? ATENDE : NAO_SEI);
        }
      }
    } else if (item.tipo === 'notificacao-cliente') {
      if (esq) { fontes.push('esquema'); esqE = esq.notifCliente.has(item.metodo) ? ATENDE : NAO; esqF = esqE; }
    } else if (item.tipo === 'notificacao' || item.tipo === 'pedido-servidor' || item.tipo === 'item') {
      const vistos = item.metodo && obs.notificacoes[item.metodo];
      if (vistos && vistos.length) {
        fontes.push('vivo'); vivoE = ATENDE;
        const c = conferirCampos(vistos, item.campos);
        vivoF = statusDosCampos(c); visto.push(forma(vistos[vistos.length - 1]));
        if (textoDosCampos(c)) detalhe.push(`ao vivo: ${textoDosCampos(c)}`);
      }
      if (esq) {
        fontes.push('esquema');
        let s = null;
        if (item.tipo === 'item') {
          const base = def('ThreadItem');
          const ok = base && noEsquema(esq.defs, base, [`[type=${item.variante}]`]) === 'sim';
          s = ok ? { variante: item.variante, base } : null;
        } else {
          const mapa = item.tipo === 'notificacao' ? esq.notifServidor : esq.pedidosServidor;
          s = mapa.has(item.metodo) ? def(mapa.get(item.metodo)) || {} : null;
        }
        if (!s) { esqE = NAO; esqF = NAO; detalhe.push(item.tipo === 'item' ? 'a variante não está no esquema do CLI' : 'o método não está no esquema do CLI'); }
        else {
          esqE = ATENDE;
          const ver = item.tipo === 'item' ? (x, segs) => noEsquema(esq.defs, s.base, [`[type=${s.variante}]`, ...segs]) : (x, segs) => noEsquema(esq.defs, s, segs);
          const c = conferirCampos([s], item.campos, (x, segs) => (ver(x, segs) === 'sim' ? 'sim' : 'nao'));
          const probs = [];
          for (const [caminho, quer] of Object.entries(item.valores || {})) {
            const segs = item.tipo === 'item' ? [`[type=${s.variante}]`, ...partes(caminho)] : partes(caminho);
            const aceitos = valoresNoEsquema(esq.defs, item.tipo === 'item' ? s.base : s, segs);
            const fora = aceitos ? quer.filter((q) => !aceitos.includes(q)) : [];
            if (fora.length) probs.push(`${caminho} não tem mais ${fora.join(', ')} (tem ${aceitos.join(', ')})`);
          }
          if (item.tipo === 'pedido-servidor') {
            const resp = def(respDe(esq.pedidosServidor.get(item.metodo)));
            if (!resp) detalhe.push('sem esquema da resposta');
            else for (const ex of item.respostas || []) { const e = validar(esq.defs, resp, ex); if (e.length) probs.push(`resposta do app ${JSON.stringify(ex)} fora do esquema: ${e[0]}`); }
          }
          esqF = probs.length ? NAO : statusDosCampos(c);
          if (textoDosCampos(c)) detalhe.push(`esquema: ${textoDosCampos(c)}`);
          detalhe.push(...probs);
        }
      }
    }
    let existe = combinar(vivoE, esqE);
    let formato = combinar(vivoF, esqF);
    if (!existe && est) { existe = est.status; formato = NAO_SEI; fontes.push('estático'); detalhe.push(est.texto); }
    if (!obs.iniciou && !esq && obs.erro) detalhe.unshift(obs.erro);
    linhas.push(linha(item, 'codex', { fonte: fontes.join('+'), existe: existe || NAO_SEI, formato: item.tipo === 'notificacao-cliente' ? null : formato || NAO_SEI, visto: visto.join(' '), detalhe: detalhe.join('; ') }));
  }
  return linhas;
}

// O que vai para o retrato: só o que não muda de uma execução para outra.
function retrato({ cli, versao, contratoVersao, rede, linhas }) {
  const itens = {};
  for (const l of linhas) itens[l.id] = { depende: l.depende, fonte: l.fonte, existe: l.existe, formato: l.formato, visto: l.visto, detalhe: l.detalhe };
  return { contrato: contratoVersao, cli, versao, rede, itens };
}

const ROTULO = { [ATENDE]: 'atende', [NAO]: 'NÃO ATENDE', [NAO_SEI]: 'não deu para saber' };
const reprova = (l) => l.depende && (l.existe === NAO || l.formato === NAO);
function codigoDeSaida(linhas) { return linhas.some(reprova) ? 1 : 0; }

function tabela(linhas, { largura = 80 } = {}) {
  const corta = (t, n) => (String(t).length > n ? `${String(t).slice(0, n - 1)}…` : String(t));
  const col = [['item', 44], ['existe', 18], ['formato', 18], ['fonte', 16]];
  const cab = col.map(([n, w]) => n.padEnd(w)).join(' ') + ' visto';
  const out = [cab, '-'.repeat(Math.min(160, cab.length + largura))];
  for (const l of linhas) {
    const marca = reprova(l) ? '✗ ' : l.existe === NAO || l.formato === NAO ? '! ' : '  ';
    const vals = [marca + corta(l.id, 42), ROTULO[l.existe] || '—', l.formato ? ROTULO[l.formato] : '—', l.fonte || '—'];
    out.push(vals.map((v, i) => corta(v, col[i][1]).padEnd(col[i][1])).join(' ') + ' ' + corta(l.visto || '', largura));
    if (l.detalhe && (l.existe !== ATENDE || (l.formato && l.formato !== ATENDE) || l.detalhe.includes('opcionais'))) out.push(`      ↳ ${corta(l.detalhe, 150)}`);
  }
  return out.join('\n');
}
function resumo(linhas) {
  const n = (f) => linhas.filter(f).length;
  return `${linhas.length} itens: ${n((l) => l.existe === ATENDE && (!l.formato || l.formato === ATENDE))} atendem por inteiro, `
    + `${n((l) => l.existe === NAO || l.formato === NAO)} não atendem (${n(reprova)} de que o app depende), `
    + `${n((l) => l.existe !== NAO && l.formato !== NAO && (l.existe === NAO_SEI || l.formato === NAO_SEI))} sem como saber tudo`;
}

// --- execução -----------------------------------------------------------------

// Procura vários nomes num arquivo grande (o binário do CLI), em pedaços.
function buscarNomes(arquivo, nomes) {
  const achados = new Set();
  const bufs = [...new Set(nomes)].map((n) => [n, Buffer.from(n)]);
  if (!bufs.length) return achados;
  const maior = Math.max(...bufs.map(([, b]) => b.length));
  const fd = fs.openSync(arquivo, 'r');
  try {
    const TAM = 32 * 1024 * 1024;
    const buf = Buffer.alloc(TAM + maior);
    let pos = 0, guardado = 0;
    for (;;) {
      const lidos = fs.readSync(fd, buf, guardado, TAM, pos);
      if (lidos <= 0) break;
      const fim = guardado + lidos;
      const janela = buf.subarray(0, fim);
      for (const [n, b] of bufs) if (!achados.has(n) && janela.indexOf(b) >= 0) achados.add(n);
      if (achados.size === bufs.length) break;
      pos += lidos;
      guardado = Math.min(maior - 1, fim);
      buf.copy(buf, 0, fim - guardado, fim);
    }
  } finally { fs.closeSync(fd); }
  return achados;
}

// O arquivo de verdade de um comando ('claude' no PATH → o binário da versão).
function resolverComando(cmd) {
  // Um .js roda pelo node: não precisa ser executável.
  const tenta = (p) => { try { const r = fs.realpathSync(p); fs.accessSync(r, r.endsWith('.js') ? fs.constants.R_OK : fs.constants.X_OK); return fs.statSync(r).isFile() ? r : null; } catch { return null; } };
  if (cmd.includes('/')) return tenta(path.resolve(cmd));
  for (const d of String(process.env.PATH || '').split(':')) { const r = d && tenta(path.join(d, cmd)); if (r) return r; }
  return null;
}

// Como isolar a rede: 'unshare -cn' (usuário atual) ou 'unshare -rn'.
function modoUnshare() {
  for (const f of ['-cn', '-rn']) {
    const r = spawnSync('unshare', [f, 'true'], { stdio: 'ignore', timeout: 5000 });
    if (r.status === 0) return f;
  }
  return null;
}

class Cercado {
  constructor({ rede, prova, cli }) {
    this.casa = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-contrato-'));
    for (const p of ['.claude', '.codex', '.config', '.cache', '.local/share', 'tmp', 'trabalho']) fs.mkdirSync(path.join(this.casa, p), { recursive: true });
    this.trabalho = path.join(this.casa, 'trabalho');
    this.rede = rede; // { modo: 'unshare'|'proxy', flag }
    this.prova = prova;
    this.cli = cli;
    this.traces = [];
    this.env = {
      PATH: [path.dirname(process.execPath), '/usr/local/bin', '/usr/bin', '/bin'].join(':'),
      HOME: this.casa, CLAUDE_CONFIG_DIR: path.join(this.casa, '.claude'), CODEX_HOME: path.join(this.casa, '.codex'),
      XDG_CONFIG_HOME: path.join(this.casa, '.config'), XDG_CACHE_HOME: path.join(this.casa, '.cache'), XDG_DATA_HOME: path.join(this.casa, '.local', 'share'),
      TMPDIR: path.join(this.casa, 'tmp'), LANG: 'C.UTF-8',
      HTTPS_PROXY: PORTA_MORTA, HTTP_PROXY: PORTA_MORTA, ALL_PROXY: PORTA_MORTA, https_proxy: PORTA_MORTA, http_proxy: PORTA_MORTA, all_proxy: PORTA_MORTA, NO_PROXY: '', no_proxy: '',
      ANTHROPIC_BASE_URL: PORTA_MORTA, DISABLE_AUTOUPDATER: '1',
    };
    // Só para os testes: o comportamento dos CLIs falsos.
    for (const [k, v] of Object.entries(process.env)) if (/^(CLAUDE|CODEX)_FALSO_/.test(k)) this.env[k] = v;
  }

  // Uma skill e um hook na casa falsa: as listas do /skills e do /hooks vêm
  // com um item para conferir a forma (o hook só roda `true`).
  prepararClaude() {
    const sk = path.join(this.env.CLAUDE_CONFIG_DIR, 'skills', 'orq-contrato');
    fs.mkdirSync(sk, { recursive: true });
    fs.writeFileSync(path.join(sk, 'SKILL.md'), '---\nname: orq-contrato\ndescription: Skill de exemplo do conferidor de contrato.\n---\n\nNada a fazer.\n');
    fs.writeFileSync(path.join(this.env.CLAUDE_CONFIG_DIR, 'settings.json'), JSON.stringify({ hooks: { Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'true' }] }] } }, null, 2) + '\n');
  }

  // Um repositório com uma mudança (o get_workspace_diff mostra algo).
  prepararGit() {
    const env = { PATH: this.env.PATH, HOME: this.casa, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
    const git = (...a) => spawnSync('git', ['-c', 'user.name=Ana', '-c', 'user.email=ana@exemplo.com', '-c', 'init.defaultBranch=main', ...a], { cwd: this.trabalho, env, stdio: 'ignore', timeout: 10000 }).status === 0;
    if (!git('init', '-q')) return false;
    fs.writeFileSync(path.join(this.trabalho, 'a.txt'), 'a\n');
    if (!git('add', 'a.txt') || !git('commit', '-q', '-m', 'a')) return false;
    fs.appendFileSync(path.join(this.trabalho, 'a.txt'), 'b\n');
    fs.writeFileSync(path.join(this.trabalho, 'novo.txt'), 'novo\n');
    return true;
  }

  // [comando, args] dentro do cercado (sem rede e, com --prova, sob strace).
  comando(alvo, args) {
    let cmd = alvo.endsWith('.js') ? [process.execPath, alvo, ...args] : [alvo, ...args];
    if (this.rede.modo === 'unshare') cmd = ['unshare', this.rede.flag, '--', ...cmd];
    if (this.prova) {
      const arq = path.join(this.casa, `strace-${this.traces.length}.txt`);
      this.traces.push(arq);
      cmd = ['strace', '-f', '-qq', '-e', 'trace=connect,sendto,sendmsg', '-o', arq, ...cmd];
    }
    return [cmd[0], cmd.slice(1)];
  }
  rodar(alvo, args, ms = 30000) {
    const [c, a] = this.comando(alvo, args);
    const r = spawnSync(c, a, { cwd: this.trabalho, env: this.env, input: '', encoding: 'utf8', timeout: ms, maxBuffer: 64 * 1024 * 1024 });
    return { codigo: r.status, stdout: r.stdout || '', stderr: r.stderr || '', erro: r.error ? r.error.message : null };
  }
  abrir(alvo, args) {
    const [c, a] = this.comando(alvo, args);
    return spawn(c, a, { cwd: this.trabalho, env: this.env, stdio: ['pipe', 'pipe', 'pipe'] });
  }

  // O que o processo vê de rede dentro do cercado.
  redeVista() {
    if (this.rede.modo !== 'unshare') return { interfaces: null, rotas: null };
    const js = "const f=require('fs');const l=(p)=>{try{return f.readFileSync(p,'utf8')}catch{return ''}};"
      + "console.log(JSON.stringify({dev:l('/proc/net/dev'),r4:l('/proc/net/route'),r6:l('/proc/net/ipv6_route')}))";
    const r = spawnSync('unshare', [this.rede.flag, '--', process.execPath, '-e', js], { encoding: 'utf8', timeout: 10000 });
    try {
      const d = JSON.parse(r.stdout);
      const interfaces = d.dev.split('\n').slice(2).map((l) => l.split(':')[0].trim()).filter(Boolean);
      // Rotas que levam a algum lugar: a tabela IPv4 sem o cabeçalho e as IPv6
      // sem a marca de rejeição (RTF_REJECT, 0x200: o kernel sempre põe duas).
      const r4 = d.r4.trim().split('\n').slice(1).filter(Boolean).length;
      const r6 = d.r6.trim().split('\n').filter((l) => l && !(parseInt(l.trim().split(/\s+/)[8], 16) & 0x200)).length;
      return { interfaces, rotas: r4 + r6 };
    } catch { return { interfaces: null, rotas: null }; }
  }

  // Resumo das tentativas de conexão vistas pelo strace. saiu: alguma conexão
  // de rede que não falhou.
  resumoDaProva() {
    const linhas = [];
    let unix = 0;
    for (const arq of this.traces) {
      let txt = '';
      try { txt = fs.readFileSync(arq, 'utf8'); } catch { continue; }
      for (const l of txt.split('\n')) {
        if (!/^\d+\s+(connect|sendto|sendmsg)\(/.test(l)) continue;
        if (/AF_UNIX|AF_LOCAL|AF_NETLINK/.test(l)) { unix++; continue; }
        if (!/AF_INET/.test(l)) continue; // sem endereço (socket já conectado ou local)
        const end = /inet_addr\("([^"]+)"\)/.exec(l) || /inet_pton\(AF_INET6,\s*"([^"]+)"/.exec(l);
        const porta = /sin6?_port=htons\((\d+)\)/.exec(l);
        linhas.push({ chamada: /^\d+\s+(\w+)/.exec(l)[1], familia: /AF_INET6/.test(l) ? 'AF_INET6' : 'AF_INET', endereco: end ? end[1] : '?',
          porta: porta ? Number(porta[1]) : null, resultado: ((/\)\s+=\s+(-?\d.*)$/.exec(l) || [])[1] || '?').trim() });
      }
    }
    // Deu certo, ou ficou em andamento (EINPROGRESS) para fora do loopback.
    const saiu = linhas.filter((x) => !/^-1\b/.test(x.resultado) || (/EINPROGRESS/.test(x.resultado) && !/^(127\.|::1$)/.test(x.endereco)));
    return { tentativas: linhas, saiu, unix };
  }

  apagar() {
    // Só a pasta que este cercado criou (prefixo conferido).
    if (path.dirname(this.casa) === path.resolve(os.tmpdir()) && path.basename(this.casa).startsWith('orq-contrato-')) fs.rmSync(this.casa, { recursive: true, force: true });
  }
}

const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));
function versaoDe(texto) { const m = /(\d+\.\d+\.\d+)/.exec(String(texto || '')); return m ? m[1] : null; }

// Sessão de verdade com o Claude: só pedidos de controle e os comandos locais.
async function observarClaude(contrato, alvo, cerc, { espera }) {
  const obs = { rodou: false, erro: null, versao: null, casa: cerc.casa, eventos: [], controles: {}, flags: null, transcript: null, estatico: null, stderr: '' };
  const v = cerc.rodar(alvo, ['--version']);
  obs.versao = versaoDe(v.stdout);
  const proc = cerc.abrir(alvo, contrato.args);
  const esperando = [];
  const chegou = (d) => { for (const w of [...esperando]) if (w.quer(d)) { esperando.splice(esperando.indexOf(w), 1); w.ok(d); } };
  const aguardar = (quer, ms) => new Promise((ok) => {
    const w = { quer, ok: (d) => { clearTimeout(w.t); ok(d); } };
    w.t = setTimeout(() => { const i = esperando.indexOf(w); if (i >= 0) esperando.splice(i, 1); ok(null); }, ms);
    esperando.push(w);
  });
  let saiu = false;
  proc.on('exit', () => { saiu = true; });
  proc.on('error', (e) => { obs.erro = `não consegui abrir: ${e.message}`; saiu = true; });
  proc.stderr.on('data', (d) => { obs.stderr = (obs.stderr + d).slice(-4000); });
  let resto = '';
  proc.stdout.on('data', (d) => {
    resto += d;
    const ls = resto.split('\n');
    resto = ls.pop();
    for (const l of ls) { let x; try { x = JSON.parse(l); } catch { continue; } obs.eventos.push(x); chegou(x); }
  });
  const escrever = (o) => { if (!saiu) proc.stdin.write(JSON.stringify(o) + '\n'); };
  await esperar(300);
  if (!saiu) {
    obs.rodou = true;
    let n = 0;
    for (const item of contrato.itens) {
      if (item.tipo !== 'controle' || item.vivo === false || saiu) continue;
      const id = `orq-contrato-${++n}`;
      const p = aguardar((d) => d.type === 'control_response' && d.response && d.response.request_id === id, espera);
      escrever({ type: 'control_request', request_id: id, request: item.pedido });
      const r = await p;
      obs.controles[item.id] = r ? r.response : null;
    }
    // Comandos locais: não chamam o modelo (o resultado diz num_turns 0).
    for (const msg of contrato.turnoLocal || []) {
      if (saiu) break;
      const p = aguardar((d) => d.type === 'result', espera);
      escrever({ type: 'user', message: { role: 'user', content: msg } });
      await p;
    }
  }
  if (!saiu) proc.stdin.end();
  for (let i = 0; i < 50 && !saiu; i++) await esperar(100);
  if (!saiu) { proc.kill('SIGTERM'); for (let i = 0; i < 20 && !saiu; i++) await esperar(100); }
  if (!saiu) proc.kill('SIGKILL');
  if (!obs.rodou) obs.erro = obs.erro || `o CLI saiu logo ao abrir: ${limpar(obs.stderr, cerc.casa)}`;
  if (!obs.versao) { const ini = obs.eventos.find((e) => e.type === 'system' && e.subtype === 'init'); obs.versao = ini ? versaoDe(ini.claude_code_version) : null; }

  // As opções que o app passa, com uma sessão que não existe.
  const fl = contrato.itens.find((i) => i.tipo === 'flags');
  if (fl) { const r = cerc.rodar(alvo, preencher(fl.args, { $tmp: path.join(cerc.casa, 'tmp') })); obs.flags = { codigo: r.codigo, stderr: r.stderr }; }

  // O transcript da sessão (onde o app o procura).
  const ini = [...obs.eventos].reverse().find((e) => e.type === 'system' && e.subtype === 'init');
  if (ini && ini.session_id) {
    const projetos = path.join(cerc.env.CLAUDE_CONFIG_DIR, 'projects');
    const esperado = path.join(projetos, String(ini.cwd || '').replace(/[^A-Za-z0-9]/g, '-'), `${ini.session_id}.jsonl`);
    let arquivo = fs.existsSync(esperado) ? esperado : null;
    if (!arquivo) { try { for (const d of fs.readdirSync(projetos)) { const a = path.join(projetos, d, `${ini.session_id}.jsonl`); if (fs.existsSync(a)) arquivo = a; } } catch { /* sem projetos */ } }
    if (arquivo) {
      const linhas = fs.readFileSync(arquivo, 'utf8').split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      obs.transcript = { arquivo: true, pastaEsperada: arquivo === esperado, linhas };
    }
  }
  return obs;
}

// Sessão de verdade com o app-server do Codex: só pedidos que não chamam o modelo.
async function observarCodex(contrato, alvo, cerc, { espera }) {
  const obs = { rodou: false, erro: null, versao: null, casa: cerc.casa, iniciou: false, respostas: {}, notificacoes: {}, esquema: null, estatico: null, stderr: '' };
  obs.versao = versaoDe(cerc.rodar(alvo, ['--version']).stdout);
  // O esquema que o próprio CLI gera (estável e com o experimental).
  const gerar = (pasta, extra) => cerc.rodar(alvo, ['app-server', 'generate-json-schema', ...extra, '--out', pasta], 60000).codigo === 0
    && fs.existsSync(path.join(pasta, 'ClientRequest.json'));
  const pastaE = path.join(cerc.casa, 'esquema'), pastaS = path.join(cerc.casa, 'esquema-estavel');
  if (gerar(pastaE, ['--experimental'])) obs.esquema = lerEsquema(pastaE, gerar(pastaS, []) ? pastaS : null);

  const proc = cerc.abrir(alvo, contrato.args);
  const espera1 = new Map();
  let saiu = false;
  obs.rodou = true; // o processo abriu; 'error' desfaz
  proc.on('exit', () => { saiu = true; for (const f of espera1.values()) f(null); espera1.clear(); });
  proc.on('error', (e) => { obs.erro = `não consegui abrir: ${e.message}`; obs.rodou = false; saiu = true; });
  proc.stderr.on('data', (d) => { obs.stderr = (obs.stderr + d).slice(-4000); });
  const escrever = (o) => { if (!saiu) { try { proc.stdin.write(JSON.stringify(o) + '\n'); } catch { /* saiu */ } } };
  let resto = '';
  proc.stdout.on('data', (d) => {
    resto += d;
    const ls = resto.split('\n');
    resto = ls.pop();
    for (const l of ls) {
      let x; try { x = JSON.parse(l); } catch { continue; }
      if (x.id != null && !x.method) { const f = espera1.get(x.id); if (f) { espera1.delete(x.id); f(x); } continue; }
      if (x.method && x.id != null) { escrever({ id: x.id, error: { code: -32601, message: 'o conferidor de contrato não atende pedidos' } }); continue; }
      if (x.method) (obs.notificacoes[x.method] = obs.notificacoes[x.method] || []).push(x.params || {});
    }
  });
  let n = 0;
  const pedir = (method, params) => new Promise((ok) => {
    const id = ++n;
    const t = setTimeout(() => { espera1.delete(id); ok(null); }, espera);
    espera1.set(id, (x) => { clearTimeout(t); ok(x); });
    escrever({ id, method, params });
  });
  const guarda = (item, x) => { obs.respostas[item.id] = x ? (x.error ? { error: x.error } : { result: x.result }) : null; };
  const valores = { $thread: ID_FALSO, $cwd: cerc.trabalho, $tmp: path.join(cerc.casa, 'tmp') };
  const itens = contrato.itens.filter((i) => i.tipo === 'metodo' && i.vivo !== false);
  const ini = itens.find((i) => i.metodo === 'initialize');
  const iniR = ini && await pedir('initialize', preencher(ini.params, valores));
  if (ini) guarda(ini, iniR);
  if (iniR && iniR.result) {
    obs.iniciou = true;
    if (!obs.versao) obs.versao = versaoDe(iniR.result.userAgent);
    escrever({ method: 'initialized' });
    const st = itens.find((i) => i.metodo === 'thread/start');
    if (st) {
      const r = await pedir('thread/start', preencher(st.params, valores));
      guarda(st, r);
      if (r && r.result && r.result.thread && r.result.thread.id) valores.$thread = r.result.thread.id;
    }
    for (const item of itens) {
      if (item === ini || item === st || saiu) continue;
      guarda(item, await pedir(item.metodo, preencher(item.params || {}, valores)));
    }
  } else if (obs.rodou) {
    obs.erro = iniR ? `o initialize voltou erro: ${limpar(iniR.error && iniR.error.message, cerc.casa)}` : `o app-server não respondeu ao initialize: ${limpar(obs.stderr, cerc.casa)}`;
  }
  if (!saiu) proc.stdin.end();
  for (let i = 0; i < 50 && !saiu; i++) await esperar(100);
  if (!saiu) { proc.kill('SIGTERM'); for (let i = 0; i < 20 && !saiu; i++) await esperar(100); }
  if (!saiu) proc.kill('SIGKILL');
  return obs;
}

// Os métodos de cada direção e as definições do esquema gerado.
function lerEsquema(pasta, pastaEstavel) {
  const ler = (p, f) => { try { return JSON.parse(fs.readFileSync(path.join(p, f), 'utf8')); } catch { return null; } };
  const defs = {};
  for (const f of fs.readdirSync(pasta).filter((x) => x.endsWith('.json'))) {
    const j = ler(pasta, f);
    if (j && j.definitions) for (const [k, v] of Object.entries(j.definitions)) if (!defs[k]) defs[k] = v;
  }
  const refDe = (s) => { if (!s) return null; if (s.$ref) return String(s.$ref).split('/').pop(); for (const k of ['anyOf', 'oneOf', 'allOf']) for (const b of s[k] || []) { const r = refDe(b); if (r) return r; } return null; };
  const metodos = (j) => {
    const m = new Map();
    for (const o of (j && (j.oneOf || j.anyOf)) || []) {
      const p = o.properties || {};
      const nomes = p.method ? (p.method.enum || (p.method.const !== undefined ? [p.method.const] : [])) : [];
      for (const nome of nomes) m.set(nome, refDe(p.params));
    }
    return m;
  };
  return {
    defs,
    cliente: metodos(ler(pasta, 'ClientRequest.json')),
    clienteEstavel: pastaEstavel ? metodos(ler(pastaEstavel, 'ClientRequest.json')) : null,
    notifCliente: metodos(ler(pasta, 'ClientNotification.json')),
    notifServidor: metodos(ler(pasta, 'ServerNotification.json')),
    pedidosServidor: metodos(ler(pasta, 'ServerRequest.json')),
  };
}

function nomesEstaticos(contrato) {
  const n = [];
  for (const i of contrato.itens) {
    if (i.estatico) n.push(...i.estatico);
    else if (i.metodo && !i.inexistente) n.push(i.metodo);
    else if (i.variante) n.push(i.variante);
  }
  return n;
}

const AJUDA = `Conferidor do contrato do app com os CLIs instalados.
  --so claude|codex   confere só um
  --claude <cmd>      o Claude (padrão: claude do PATH)
  --codex <cmd>       o Codex (padrão: codex do PATH)
  --contrato <arq>    outro contrato (padrão: scripts/contrato-cli.json)
  --saida <pasta>     onde gravar os retratos (padrão: ~/.local/share/orq-contrato-cli)
  --rede unshare|proxy  isolamento (padrão: unshare; proxy só desvia os proxies e NÃO isola a rede)
  --prova <pasta>     roda sob strace e grava as conexões tentadas
  --espera <ms>       quanto esperar cada resposta (padrão: 15000)
  --json              imprime o resultado em JSON em vez da tabela
  --manter-casa       não apaga a casa temporária no fim`;

function lerOpcoes(argv) {
  const o = { so: null, claude: 'claude', codex: 'codex', contrato: path.join(__dirname, 'contrato-cli.json'), saida: path.join(os.homedir(), '.local', 'share', 'orq-contrato-cli'),
    rede: 'unshare', prova: null, espera: 15000, json: false, manterCasa: false, ajuda: false };
  for (let i = 0; i < argv.length; i++) {
    const [k, v0] = argv[i].split('=');
    const v = () => (v0 !== undefined ? v0 : argv[++i]);
    if (k === '--so') o.so = v();
    else if (k === '--claude') o.claude = v();
    else if (k === '--codex') o.codex = v();
    else if (k === '--contrato') o.contrato = path.resolve(v());
    else if (k === '--saida') o.saida = path.resolve(v());
    else if (k === '--rede') o.rede = v();
    else if (k === '--prova') o.prova = path.resolve(v());
    else if (k === '--espera') o.espera = Number(v()) || 15000;
    else if (k === '--json') o.json = true;
    else if (k === '--manter-casa') o.manterCasa = true;
    else if (k === '--ajuda' || k === '-h' || k === '--help') o.ajuda = true;
    else throw new Error(`opção desconhecida: ${argv[i]}`);
  }
  if (o.so && !['claude', 'codex'].includes(o.so)) throw new Error('--so: claude ou codex');
  if (!['unshare', 'proxy'].includes(o.rede)) throw new Error('--rede: unshare ou proxy');
  return o;
}

// Grava sem passar por cima: igual ao que já está → nada; diferente → um
// arquivo novo ao lado, com a hora no nome.
function gravarSemApagar(base, ext, txt) {
  fs.mkdirSync(path.dirname(base), { recursive: true });
  const arq = base + ext;
  if (!fs.existsSync(arq)) { fs.writeFileSync(arq, txt, { flag: 'wx' }); return arq; }
  if (fs.readFileSync(arq, 'utf8') === txt) return arq;
  const novo = `${base}.${new Date().toISOString().replace(/[:.]/g, '-')}${ext}`;
  fs.writeFileSync(novo, txt, { flag: 'wx' });
  return novo;
}

// Grava o retrato sem apagar nenhum anterior: igual → nada; diferente → um
// arquivo novo ao lado, e diz o que mudou.
function gravarRetrato(pasta, r) {
  fs.mkdirSync(pasta, { recursive: true });
  const base = path.join(pasta, `${r.cli}-${r.versao || 'desconhecida'}`);
  const txt = JSON.stringify(r, null, 2) + '\n';
  const arq = `${base}.json`;
  if (!fs.existsSync(arq)) { fs.writeFileSync(arq, txt, { flag: 'wx' }); return { arquivo: arq, situacao: 'novo' }; }
  const antes = fs.readFileSync(arq, 'utf8');
  if (antes === txt) return { arquivo: arq, situacao: 'igual' };
  let velho = {};
  try { velho = JSON.parse(antes).itens || {}; } catch { /* estragado */ }
  const mudaram = [...new Set([...Object.keys(velho), ...Object.keys(r.itens)])].filter((k) => JSON.stringify(velho[k]) !== JSON.stringify(r.itens[k]));
  const novo = `${base}.${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  fs.writeFileSync(novo, txt, { flag: 'wx' });
  return { arquivo: novo, situacao: 'mudou', mudaram, anterior: arq };
}

async function conferir(cli, contrato, o, rede) {
  const parte = contrato[cli];
  const alvo = resolverComando(o[cli]);
  if (!alvo) {
    const obs = { rodou: false, erro: `não achei o ${cli} (${o[cli]})`, eventos: [], controles: {}, respostas: {}, notificacoes: {}, estatico: null, esquema: null };
    return { cli, versao: null, linhas: cli === 'claude' ? avaliarClaude(parte, obs) : avaliarCodex(parte, obs), ausente: true };
  }
  const cerc = new Cercado({ rede, prova: !!o.prova, cli });
  try {
    if (cli === 'claude') { cerc.prepararClaude(); cerc.prepararGit(); }
    const obs = cli === 'claude' ? await observarClaude(parte, alvo, cerc, o) : await observarCodex(parte, alvo, cerc, o);
    obs.estatico = buscarNomes(alvo, nomesEstaticos(parte));
    const linhas = cli === 'claude' ? avaliarClaude(parte, obs) : avaliarCodex(parte, obs);
    const prova = o.prova ? cerc.resumoDaProva() : null;
    const vista = cerc.redeVista();
    return { cli, versao: obs.versao, linhas, prova, vista };
  } finally {
    if (!o.manterCasa) cerc.apagar();
  }
}

function textoDaProva(r, rede) {
  const p = r.prova;
  const l = [`# Prova de rede: ${r.cli} ${r.versao || ''}`.trim(), '',
    `isolamento: ${rede.modo === 'unshare' ? `espaço de rede próprio (unshare ${rede.flag})` : 'só proxies para 127.0.0.1:9 (rede NÃO isolada)'}`,
    `interfaces vistas dentro do cercado: ${r.vista.interfaces ? r.vista.interfaces.join(', ') || '(nenhuma)' : 'não conferido'}; rotas utilizáveis: ${r.vista.rotas == null ? '?' : r.vista.rotas}`,
    `strace: ${p.tentativas.length} tentativa(s) de rede (AF_INET/AF_INET6); ${p.unix} conexão(ões) locais (AF_UNIX/netlink), que não saem da máquina`];
  for (const t of p.tentativas) l.push(`  ${t.chamada} ${t.familia} ${t.endereco}:${t.porta} → ${t.resultado}`);
  l.push('', p.saiu.length ? `ALERTA: ${p.saiu.length} conexão(ões) não falharam` : 'nenhuma conexão de rede deu certo: nada saiu da máquina');
  return l.join('\n') + '\n';
}

async function main() {
  let o;
  try { o = lerOpcoes(process.argv.slice(2)); } catch (e) { console.error(e.message); console.error(AJUDA); process.exit(2); }
  if (o.ajuda) { console.log(AJUDA); return; }
  const contrato = JSON.parse(fs.readFileSync(o.contrato, 'utf8'));
  let rede;
  if (o.rede === 'unshare') {
    const flag = modoUnshare();
    if (!flag) { console.error('Não consigo isolar a rede (unshare -n falhou). Sem isso o script não roda o CLI de verdade.\nPara rodar só com os proxies desviados (a rede NÃO fica isolada), use --rede=proxy.'); process.exit(2); }
    rede = { modo: 'unshare', flag };
  } else rede = { modo: 'proxy', flag: null };
  if (o.prova && spawnSync('strace', ['-V'], { stdio: 'ignore' }).status !== 0) { console.error('--prova precisa do strace instalado.'); process.exit(2); }

  const resultados = [];
  for (const cli of ['claude', 'codex']) {
    if (o.so && o.so !== cli) continue;
    resultados.push(await conferir(cli, contrato, o, rede));
  }
  let saiu = false;
  const saida = { contrato: contrato.versao, rede: rede.modo, clis: [] };
  for (const r of resultados) {
    const ret = retrato({ cli: r.cli, versao: r.versao, contratoVersao: contrato.versao, rede: rede.modo, linhas: r.linhas });
    const gravado = r.ausente ? null : gravarRetrato(o.saida, ret);
    if (r.prova) {
      gravarSemApagar(path.join(o.prova, `prova-rede-${r.cli}-${r.versao || 'desconhecida'}`), '.txt', textoDaProva(r, rede));
      if (r.prova.saiu.length) saiu = true;
    }
    saida.clis.push({ cli: r.cli, versao: r.versao, ausente: !!r.ausente, linhas: r.linhas, retrato: gravado, prova: r.prova ? { tentativas: r.prova.tentativas.length, saiu: r.prova.saiu.length } : null, rede: r.vista || null });
  }
  const todas = resultados.flatMap((r) => r.linhas);
  saida.codigo = saiu ? 3 : codigoDeSaida(todas);
  if (o.json) console.log(JSON.stringify(saida, null, 2));
  else {
    for (const c of saida.clis) {
      const nome = c.cli === 'claude' ? 'Claude' : 'Codex';
      console.log(`\n== ${nome} ${c.versao || '(versão desconhecida)'}${c.ausente ? ' — não instalado' : ''} · rede: ${rede.modo === 'unshare' ? `isolada (unshare; interfaces: ${c.rede && c.rede.interfaces ? c.rede.interfaces.join(',') : '?'})` : 'NÃO isolada (só proxies)'} · casa: temporária ==\n`);
      console.log(tabela(c.linhas));
      console.log(`\n${resumo(c.linhas)}`);
      if (c.retrato) {
        const sit = c.retrato.situacao === 'mudou' ? `MUDOU em relação a ${c.retrato.anterior}: ${c.retrato.mudaram.join(', ')}` : c.retrato.situacao === 'igual' ? 'igual ao anterior' : 'novo';
        console.log(`retrato: ${c.retrato.arquivo} (${sit})`);
      }
      if (c.prova) console.log(`prova de rede: ${c.prova.tentativas} tentativa(s), ${c.prova.saiu} saíram`);
    }
    console.log(saida.codigo === 0 ? '\nTudo de que o app depende bate com os CLIs instalados (veja os "não deu para saber").'
      : saida.codigo === 3 ? '\nALERTA: uma conexão de rede deu certo durante a conferência.' : '\nAlgo de que o app depende NÃO bate (linhas com ✗).');
  }
  process.exitCode = saida.codigo;
}

if (require.main === module) main().catch((e) => { console.error(`erro do conferidor: ${e.stack || e.message}`); process.exit(2); });

module.exports = {
  partes, verCampo, conferirCampos, forma, limpar, noEsquema, valoresNoEsquema, validar, preencher, combinar,
  avaliarClaude, avaliarCodex, retrato, tabela, codigoDeSaida, buscarNomes, lerOpcoes, gravarRetrato,
  ATENDE, NAO, NAO_SEI,
};
