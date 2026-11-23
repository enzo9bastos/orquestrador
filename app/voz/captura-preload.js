// Ponte da janela escondida de captura (voz/captura.js) com o processo principal.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('captura', {
  ao: (fn) => ipcRenderer.on('captura', (_e, m) => fn(m)),
  r: (m) => ipcRenderer.send('captura:r', m),
});
