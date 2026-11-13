// Área: pet
// O app está na tela? (janelas.js) — as contas e a leitura de cada ambiente.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const janelas = require('../../janelas');

test('janelas: fração coberta pela união das janelas de cima', () => {
  const app = { x: 0, y: 0, w: 100, h: 100 };
  assert.strictEqual(janelas.fracaoCoberta(app, []), 0);
  assert.strictEqual(janelas.fracaoCoberta(app, [{ x: 0, y: 0, w: 50, h: 100 }]), 0.5);
  assert.strictEqual(janelas.fracaoCoberta(app, [{ x: 0, y: 0, w: 50, h: 100 }, { x: 25, y: 0, w: 50, h: 100 }]), 0.75, 'sobreposição não conta duas vezes');
  assert.strictEqual(janelas.fracaoCoberta(app, [{ x: 200, y: 0, w: 50, h: 50 }]), 0, 'longe não cobre');
});

test('janelas: sway — foco e à vista pela árvore', () => {
  const arvore = { type: 'root', nodes: [{ type: 'output', nodes: [
    { type: 'workspace', name: '1', nodes: [{ type: 'con', pid: 10, visible: true, focused: false }, { type: 'con', pid: 20, visible: true, focused: true }] },
    { type: 'workspace', name: '2', nodes: [{ type: 'con', pid: 30, visible: false, focused: false }] },
  ] }] };
  assert.deepStrictEqual(janelas.estadoSway(arvore, [10]), { foco: 'outro', visivel: true, via: 'sway' });
  assert.deepStrictEqual(janelas.estadoSway(arvore, [20]), { foco: 'app', visivel: true, via: 'sway' });
  assert.deepStrictEqual(janelas.estadoSway(arvore, [30]), { foco: 'outro', visivel: false, via: 'sway' }, 'em outra área de trabalho');
});

test('janelas: Hyprland — área de trabalho, escondida e flutuante por cima', () => {
  const c = (pid, ws, extra = {}) => ({ pid, address: `0x${pid}`, workspace: { id: ws }, at: [0, 0], size: [100, 100], hidden: false, floating: false, ...extra });
  const area = { id: 1 };
  assert.deepStrictEqual(janelas.estadoHyprland(null, [c(10, 1)], area, [10]), { foco: 'nenhum', visivel: true, via: 'hyprland' });
  assert.deepStrictEqual(janelas.estadoHyprland(c(20, 1), [c(10, 1), c(20, 1, { floating: true })], area, [10]).visivel, false, 'flutuante cobrindo tudo');
  assert.deepStrictEqual(janelas.estadoHyprland(c(20, 1), [c(10, 1), c(20, 1, { floating: true, size: [30, 30] })], area, [10]), { foco: 'outro', visivel: true, via: 'hyprland' });
  assert.strictEqual(janelas.estadoHyprland(null, [c(10, 2)], area, [10]).visivel, false, 'em outra área');
});

test('janelas: GNOME — lê a resposta da extensão pelo gdbus; sem extensão, ninguém responde (null)', async () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'orq-janelas-'));
  const env = { ...process.env };
  try {
    fs.writeFileSync(path.join(bin, 'gdbus'), "#!/bin/sh\necho \"('{\\\"foco\\\":\\\"nenhum\\\",\\\"visivel\\\":true}',)\"\n", { mode: 0o755 });
    process.env.PATH = `${bin}:/usr/bin:/bin`;
    for (const k of ['SWAYSOCK', 'HYPRLAND_INSTANCE_SIGNATURE']) delete process.env[k];
    process.env.XDG_SESSION_TYPE = 'wayland';
    janelas._zerar();
    assert.deepStrictEqual(await janelas.estado([process.pid]), { foco: 'nenhum', visivel: true, via: 'gnome' });
    fs.writeFileSync(path.join(bin, 'gdbus'), '#!/bin/sh\necho "Error: No such interface" >&2; exit 1\n', { mode: 0o755 });
    janelas._zerar();
    assert.strictEqual(await janelas.estado([process.pid]), null);
  } finally { process.env = env; janelas._zerar(); }
});

test('janelas: a extensão do GNOME não manda nada sobre outras janelas', () => {
  const ext = fs.readFileSync(path.join(__dirname, '../../../extras/gnome-shell/orq-janelas@orquestrador/extension.js'), 'utf8');
  const devolve = [...ext.matchAll(/return JSON\.stringify\(([^;]+)\);/g)].map((m) => m[1]);
  assert.deepStrictEqual(devolve, ["{erro: 'pids'}", '{foco, visivel: false}', '{foco, visivel: fracaoCoberta(pilha[i].get_frame_rect(), deCima) < COBERTA}']);
  assert.doesNotMatch(ext, /get_title|get_wm_class|get_gtk_application_id/, 'nada de título ou nome de app');
});
