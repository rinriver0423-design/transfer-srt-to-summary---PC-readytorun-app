const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    selectFile: () => ipcRenderer.invoke('select-file'),
    summarize: (content, apiKey, groupId, language) => ipcRenderer.invoke('summarize', { content, apiKey, groupId, language }),
    saveSummary: (summary) => ipcRenderer.invoke('save-summary', { summary })
});
