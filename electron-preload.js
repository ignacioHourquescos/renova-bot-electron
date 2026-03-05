const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  startBot: () => ipcRenderer.invoke('start-bot'),
  stopBot: () => ipcRenderer.invoke('stop-bot'),
  restartBot: () => ipcRenderer.invoke('restart-bot'),
  getBotStatus: () => ipcRenderer.invoke('get-bot-status'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  onBotOutput: (callback) => ipcRenderer.on('bot-output', (event, data) => callback(data)),
  onBotError: (callback) => ipcRenderer.on('bot-error', (event, data) => callback(data)),
  onBotStatus: (callback) => ipcRenderer.on('bot-status', (event, data) => callback(data)),
  onBotQrString: (callback) => ipcRenderer.on('bot-qr-string', (event, data) => callback(data)),
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
  // Kits / artículos
  getArticlesStock: (codes) => ipcRenderer.invoke('get-articles-stock', codes),
  // Cotización (listId: 0=Lista 1, 1=Lista 2, 3=Lista Normal, 4=Lista Tallerista)
  searchArticulo: (codigo, listId) => ipcRenderer.invoke('search-articulo', codigo, listId),
  getArticlesPrice: (codes, listId) => ipcRenderer.invoke('get-articles-price', codes, listId),
  getCotizacion: () => ipcRenderer.invoke('get-cotizacion'),
  saveCotizacion: (data) => ipcRenderer.invoke('save-cotizacion', data),
  getConversationsList: () => ipcRenderer.invoke('get-conversations-list'),
  getConversation: (phone) => ipcRenderer.invoke('get-conversation', phone),
  saveNote: (phone, text) => ipcRenderer.invoke('save-note', phone, text),
  deleteNote: (phone, noteId) => ipcRenderer.invoke('delete-note', phone, noteId),
  onConversationMsg: (callback) => ipcRenderer.on('conversation-msg', (event, data) => callback(data)),
  getMediaDataUrl: (filePath) => ipcRenderer.invoke('get-media-data-url', filePath),
  audioToOrder: (mediaPath, listId) => ipcRenderer.invoke('audio-to-order', mediaPath, listId),
  imageToOrder: (mediaPath) => ipcRenderer.invoke('image-to-order', mediaPath),
  // Window controls (custom frameless titlebar)
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close')
});

