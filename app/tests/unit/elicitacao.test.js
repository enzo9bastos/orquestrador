// Área: conversa (pedido de dado de um servidor MCP: "elicitation"; cartão do P2)
// O módulo que lê o que o servidor pede (forma do Claude 2.1.326 e esquema do MCP) e
// confere o que a pessoa preencheu antes de mandar. Nada do que o servidor manda é
// confiável: tudo é conferido, cortado e limitado.
const test = require('node:test');
const assert = require('node:assert');
const el = require('../../elicitacao');

const pedido = (mais) => ({ subtype: 'elicitation', mcp_server_name: 'cofre-da-equipe', message: 'Informe o código para liberar a consulta.', ...mais });

test('elicitação: formulário vira campos na ordem do servidor, com tipo, rótulo, obrigatório e opções', () => {
  const r = el.normalizar(pedido({ mode: 'form', property_order: ['codigo', 'ambiente', 'vezes', 'avisar'], requested_schema: { type: 'object', required: ['codigo'], properties: {
    avisar: { type: 'boolean', title: 'Avisar por e-mail', default: true },
    ambiente: { type: 'string', title: 'Ambiente', enum: ['homologacao', 'producao'], enumNames: ['Homologação', 'Produção'] },
    codigo: { type: 'string', title: 'Código de verificação', description: 'Seis dígitos', minLength: 6, maxLength: 6 },
    vezes: { type: 'integer', minimum: 1, maximum: 5 },
  } } }));
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual([r.servidor, r.mensagem, r.modo], ['cofre-da-equipe', 'Informe o código para liberar a consulta.', 'form']);
  assert.deepStrictEqual(r.campos.map((c) => [c.nome, c.tipo, c.rotulo, c.obrigatorio, c.secreto]), [
    ['codigo', 'texto', 'Código de verificação', true, true],
    ['ambiente', 'lista', 'Ambiente', false, false],
    ['vezes', 'inteiro', 'vezes', false, false],
    ['avisar', 'sim-nao', 'Avisar por e-mail', false, false],
  ]);
  assert.deepStrictEqual(r.campos[1].opcoes, [{ valor: 'homologacao', rotulo: 'Homologação' }, { valor: 'producao', rotulo: 'Produção' }]);
  assert.deepStrictEqual([r.campos[0].descricao, r.campos[0].max, r.campos[2].minimo, r.campos[2].maximo, r.campos[3].padrao], ['Seis dígitos', 6, 1, 5, true]);
});

test('elicitação: campo que parece segredo é mascarado (pelo nome, pelo título ou por format password)', () => {
  const campos = (props) => el.normalizar(pedido({ requested_schema: { type: 'object', properties: props } })).campos;
  for (const [nome, s] of [['senha', { type: 'string' }], ['x', { type: 'string', title: 'API key' }], ['y', { type: 'string', format: 'password' }], ['token_de_acesso', { type: 'string' }], ['z', { type: 'string', title: 'Código PIN' }]]) {
    assert.strictEqual(campos({ [nome]: s })[0].secreto, true, nome);
  }
  for (const [nome, s] of [['nome', { type: 'string' }], ['email', { type: 'string', format: 'email' }], ['cidade', { type: 'string', title: 'Cidade' }]]) assert.strictEqual(campos({ [nome]: s })[0].secreto, false, nome);
});

test('elicitação: pedido torto não vira formulário (o cartão só deixa recusar)', () => {
  const ruim = (schema, mais = {}) => el.normalizar(pedido({ requested_schema: schema, ...mais }));
  assert.strictEqual(ruim({ type: 'object', required: ['lista'], properties: { lista: { type: 'array', items: { type: 'string' } } } }).ok, false, 'campo obrigatório de um tipo que o app não mostra');
  assert.match(ruim({ type: 'object', required: ['lista'], properties: { lista: { type: 'array' } } }).problema, /lista/);
  // Campo opcional que o app não sabe mostrar fica de fora, e o resto vale.
  const parcial = ruim({ type: 'object', properties: { nome: { type: 'string' }, coisa: { type: 'object' } } });
  assert.deepStrictEqual([parcial.ok, parcial.campos.map((c) => c.nome)], [true, ['nome']]);
  // Sem esquema: só a mensagem, sem campos (aceitar manda conteúdo vazio).
  assert.deepStrictEqual([ruim(undefined).ok, ruim(undefined).campos], [true, []]);
  for (const s of ['x', 5, [], { type: 'string' }, { type: 'object', properties: 'x' }]) assert.strictEqual(ruim(s).ok, false, JSON.stringify(s));
  // Limites: no máximo 20 campos, textos cortados, sem caracteres de controle.
  const muitos = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`c${i}`, { type: 'string', title: 'T'.repeat(500) }]));
  const m = ruim({ type: 'object', properties: muitos });
  assert.deepStrictEqual([m.campos.length, m.campos[0].rotulo.length <= 120], [20, true]);
  const sujo = el.normalizar({ subtype: 'elicitation', mcp_server_name: 'ser\u001b[31mvidor\n', message: 'li\u0000nha' });
  assert.deepStrictEqual([sujo.servidor, sujo.mensagem], ['servidor', 'linha']);
});

test('elicitação: modo página só aceita endereço http(s) e mostra o site', () => {
  const ok = el.normalizar(pedido({ mode: 'url', url: 'https://contas.exemplo.com/autorizar?cliente=agenda&estado=8f2c' }));
  assert.deepStrictEqual([ok.ok, ok.modo, ok.site, ok.url], [true, 'url', 'contas.exemplo.com', 'https://contas.exemplo.com/autorizar?cliente=agenda&estado=8f2c']);
  for (const u of ['javascript:alert(1)', 'file:///etc/passwd', 'ftp://x', '', undefined, 'não é endereço', 'https://']) assert.strictEqual(el.normalizar(pedido({ mode: 'url', url: u })).ok, false, String(u));
  // Endereço com usuário e senha embutidos esconde o site de verdade: recusa.
  assert.strictEqual(el.normalizar(pedido({ mode: 'url', url: 'https://banco.exemplo.com@malvado.exemplo.net/x' })).ok, false);
});

test('elicitação: o que a pessoa preencheu é conferido e convertido antes de ir ao servidor', () => {
  const n = el.normalizar(pedido({ requested_schema: { type: 'object', required: ['codigo', 'vezes'], properties: {
    codigo: { type: 'string', minLength: 6, maxLength: 6 }, ambiente: { type: 'string', enum: ['homologacao', 'producao'] },
    vezes: { type: 'integer', minimum: 1, maximum: 5 }, nota: { type: 'number' }, avisar: { type: 'boolean' }, obs: { type: 'string' } } } }));
  assert.deepStrictEqual(el.conferir(n.campos, { codigo: '123456', ambiente: 'producao', vezes: '3', nota: '7,5', avisar: true, obs: '', de_fora: 'x' }),
    { ok: true, conteudo: { codigo: '123456', ambiente: 'producao', vezes: 3, nota: 7.5, avisar: true } });
  assert.deepStrictEqual(el.conferir(n.campos, { codigo: '123456', vezes: 2 }), { ok: true, conteudo: { codigo: '123456', vezes: 2 } });
  const erro = (v) => el.conferir(n.campos, { codigo: '123456', vezes: 2, ...v });
  assert.deepStrictEqual([erro({ codigo: '' }).ok, erro({ codigo: '' }).campo], [false, 'codigo']);
  assert.strictEqual(erro({ codigo: '12' }).campo, 'codigo', 'curto demais');
  assert.strictEqual(erro({ codigo: '1234567' }).campo, 'codigo', 'longo demais');
  assert.strictEqual(erro({ vezes: 9 }).campo, 'vezes');
  assert.strictEqual(erro({ vezes: '2.5' }).campo, 'vezes', 'inteiro não aceita fração');
  assert.strictEqual(erro({ nota: 'abc' }).campo, 'nota');
  assert.strictEqual(erro({ ambiente: 'outro' }).campo, 'ambiente');
  assert.strictEqual(erro({ avisar: 'sim' }).campo, 'avisar');
  assert.match(erro({ vezes: 9 }).erro, /entre 1 e 5/);
});
