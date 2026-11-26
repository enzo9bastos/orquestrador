// Programa do Electron para o teste da extensão do Meet: abre a página de mentira (meet-falso.html)
// numa janela que não aparece e roda o código que o teste manda (uma linha JSON por pedido na
// entrada; a resposta sai numa linha JSON). Não abre nada da internet.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const readline = require('readline');

app.whenReady().then(async () => {
  const j = new BrowserWindow({ show: false, width: 1000, height: 700, webPreferences: { backgroundThrottling: false, contextIsolation: true } });
  await j.loadFile(path.join(__dirname, 'meet-falso.html'));
  console.log(JSON.stringify({ t: 'pronto' }));
  readline.createInterface({ input: process.stdin }).on('line', async (l) => {
    let m;
    try { m = JSON.parse(l); } catch { return; }
    try { console.log(JSON.stringify({ id: m.id, r: await j.webContents.executeJavaScript(m.js) })); } catch (e) { console.log(JSON.stringify({ id: m.id, erro: String(e && e.message || e) })); }
  });
});
app.on('window-all-closed', () => app.quit());
