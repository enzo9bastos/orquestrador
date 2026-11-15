// Área: recados (recado digitado no painel do agente só com a tela livre)
// 0.A7 da Etapa 0. O recado ao agente é digitado no painel do tmux (C-u, texto,
// Enter) sem olhar a tela: com um menu de permissão aberto, o Enter respondia
// o menu. Agora o app confere a tela antes (estadoPelaTela do coletor); com
// pergunta ou menu pendente, não digita nada, o recado espera e diz por quê.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const casa = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-cegas-'));
process.env.HOME = casa;
const recados = require('../../recados');

function projeto(nome) {
  const dir = path.join(casa, 'projetos', nome);
  fs.mkdirSync(dir, { recursive: true });
  return { emp: '', proj: nome, dir, alvo: nome };
}
const frente = (p, nome, pane) => ({ emp: p.emp, proj: p.proj, dir: p.dir, nome, sessaoClaude: null, pane });
const MENU = 'Bash command\n  rm -rf build\nDo you want to proceed?\n❯ 1. Yes\n  2. No, and tell Claude what to do differently';
const LIVRE = '╭────────────╮\n│ >          │\n╰────────────╯\n  ⏵⏵ auto mode on';

test('A7: orquestrador → agente com menu de permissão na tela: nada é digitado, o recado espera com o motivo', () => {
  const p = projeto('a');
  const chamadas = [];
  const r = recados.mandarAoAgente(frente(p, 'Agente 1', '%61'), 'pode seguir', { tmux: (a) => chamadas.push(a), tela: () => MENU });
  assert.deepStrictEqual(chamadas.filter((a) => a[0] === 'send-keys'), [], 'nenhum send-keys com o menu aberto');
  assert.strictEqual(r.esperando, true);
  assert.strictEqual(r.recado.estado, 'novo');
  assert.match(r.recado.motivo, /pergunta ou menu aberto na tela/);
  // Tela livre: a próxima entrega digita a mesma linha de sempre e marca entregue.
  recados.entregar({ lista: () => [] }, () => [frente(p, 'Agente 1', '%61')], { tmux: (a) => chamadas.push(a), tela: () => LIVRE });
  const linha = chamadas.find((a) => a[3] === '-l');
  assert.match(linha[4], /^\[recado do orquestrador\] pode seguir — /);
  const d = recados.ler().find((x) => x.id === r.recado.id);
  assert.deepStrictEqual([d.estado, d.motivo], ['entregue', null]);
});

test('A7: agente → agente com menu de permissão na tela do destino: espera, e entrega depois', () => {
  const a = projeto('b-a'), b = projeto('b-b');
  fs.mkdirSync(path.join(a.dir, '.orq', 'recados', 'saida'), { recursive: true });
  fs.writeFileSync(path.join(a.dir, '.orq', 'recados', 'saida', '1.json'), JSON.stringify({ texto: 'a rota mudou', tipo: 'aviso', para: 'Agente B' }));
  const fr = [frente(a, 'Agente A', '%71'), frente(b, 'Agente B', '%72')];
  const [r] = recados.recolher([a, b], fr);
  assert.strictEqual(r.estado, 'novo');
  const chamadas = [];
  recados.entregar({ lista: () => [] }, () => fr, { tmux: (x) => chamadas.push(x), tela: (pane) => (pane === '%72' ? MENU : LIVRE) });
  assert.deepStrictEqual(chamadas, [], 'nada digitado no painel com o menu');
  const esperando = recados.ler().find((x) => x.id === r.id);
  assert.strictEqual(esperando.estado, 'novo');
  assert.match(esperando.motivo, /Agente B está com uma pergunta ou menu aberto na tela/);
  recados.entregar({ lista: () => [] }, () => fr, { tmux: (x) => chamadas.push(x), tela: () => LIVRE });
  assert.strictEqual(chamadas.find((x) => x[3] === '-l')[2], '%72');
  assert.strictEqual(recados.ler().find((x) => x.id === r.id).estado, 'entregue');
});

test('A7: o menu do Codex também conta como pergunta pendente', () => {
  const p = projeto('c');
  const chamadas = [];
  const r = recados.mandarAoAgente(frente(p, 'Agente 3', '%81'), 'oi', { tmux: (a) => chamadas.push(a), tela: () => 'Allow command?\n› 1. Yes, proceed\n  2. No' });
  assert.strictEqual(r.esperando, true);
  assert.deepStrictEqual(chamadas.filter((a) => a[0] === 'send-keys'), []);
});
