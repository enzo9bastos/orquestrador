// Ponte da janelinha do ajudante: só manda e recebe mensagens.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ajudante', {
  enviar: (m) => ipcRenderer.send('ajudante', m),
  aoMsg: (fn) => ipcRenderer.on('ajudante', (_e, m) => fn(m)),
});
