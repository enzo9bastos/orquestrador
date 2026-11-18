// Área: conversa (o que acontece com as conversas avulsas ao fechar o app; plano 3.5)
// Antes, ao fechar o app, toda conversa avulsa saía da lista. Agora fica na lista, pausada, e
// volta de onde parou; quem prefere como era troca nas Configurações. A que nem começou sai
// sempre (não há de onde voltar). O orquestrador não muda.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { casaTemporaria } = require('../ajuda');

const casa = casaTemporaria({ iasCaminhos: { claude: path.join(__dirname, 'claude-falso.js'), codex: path.join(__dirname, 'codex-falso.js') } });
process.env.CLAUDE_FALSO_LOG = path.join(casa, 'claude-falso.log');
const conversa = require('../../conversa');
const config = require('../../config');

conversa.ligar(() => {});
conversa.ligarAvisos(() => {});
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const guardadas = () => JSON.parse(fs.readFileSync(path.join(casa, '.cache', 'orq-app', process.env.ORQ_APP_TESTE === '1' ? 'conversas-teste.json' : 'conversas.json'), 'utf8'));
const naLista = (id) => conversa.lista().some((c) => c.id === id);
async function avulsa({ sessao = null, titulo = null, pasta = null } = {}) {
  await espera(3); // o id da conversa nova vem do relógio (ms)
  const id = conversa.nova(pasta ? { pasta } : {});
  const c = conversa._pegar(id);
  if (sessao) c.sessao = sessao;
  if (titulo) c.titulo = titulo;
  return id;
}

test('ao fechar o app: por padrão a conversa avulsa que já começou fica na lista e guardada; a que nem começou sai; o orquestrador fica', async () => {
  assert.strictEqual(config.ler().conversasAoFechar, 'pausadas');
  const dir = path.join(casa, 'proj', 'api');
  fs.mkdirSync(dir, { recursive: true });
  const comecou = await avulsa({ sessao: 'sessao-que-ja-comecou-01', titulo: 'Ajuste do botão de exportar', pasta: dir });
  const vazia = await avulsa();
  conversa.encerrarTodas();
  assert.strictEqual(naLista(comecou), true, 'a conversa que já tinha começado saiu da lista');
  assert.strictEqual(naLista(vazia), false, 'a conversa que nem começou ficou na lista');
  assert.strictEqual(naLista('orquestrador'), true);
  const g = guardadas().find((c) => c.id === comecou);
  assert.deepStrictEqual({ titulo: g.titulo, sessao: g.sessao, pasta: g.pasta }, { titulo: 'Ajuste do botão de exportar', sessao: 'sessao-que-ja-comecou-01', pasta: dir });
  assert.strictEqual(guardadas().some((c) => c.id === vazia), false);
  assert.strictEqual(conversa._pegar(comecou).proc, null, 'o motor da conversa pausada continuou rodando');
  assert.strictEqual(conversa.lista().find((c) => c.id === comecou).vivo, false);
  conversa.fechar(comecou);
});

test('ao fechar o app com a opção "saem da lista": as conversas avulsas saem, como era antes', async () => {
  config.gravar(config.validar({ conversasAoFechar: 'saem' }).ok);
  const comecou = await avulsa({ sessao: 'sessao-que-ja-comecou-02' });
  const vazia = await avulsa();
  conversa.encerrarTodas();
  assert.strictEqual(naLista(comecou), false);
  assert.strictEqual(naLista(vazia), false);
  assert.strictEqual(naLista('orquestrador'), true);
  assert.deepStrictEqual(guardadas().map((c) => c.id), ['orquestrador']);
  config.gravar(config.validar({ conversasAoFechar: 'pausadas' }).ok);
});

test('ao fechar o app: conversa com uma volta ou um ramo ainda por abrir também fica (há de onde voltar)', async () => {
  const id = await avulsa();
  conversa._pegar(id).forkDe = 'sessao-de-onde-o-ramo-sai-01';
  conversa.encerrarTodas();
  assert.strictEqual(naLista(id), true);
  conversa.fechar(id);
});

test('configuração: conversasAoFechar aceita só "pausadas" e "saem"', () => {
  assert.deepStrictEqual(config.validar({ conversasAoFechar: 'saem' }), { ok: { conversasAoFechar: 'saem' }, recusado: [] });
  assert.deepStrictEqual(config.validar({ conversasAoFechar: 'pausadas' }), { ok: { conversasAoFechar: 'pausadas' }, recusado: [] });
  for (const ruim of ['', 'sempre', true, null, 1, {}]) assert.deepStrictEqual(config.validar({ conversasAoFechar: ruim }), { ok: {}, recusado: ['conversasAoFechar'] }, JSON.stringify(ruim));
});
