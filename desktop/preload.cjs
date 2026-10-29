const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("contentFlowDesktop", {
  pickFolder: () => ipcRenderer.invoke("content-flow:pick-folder"),
  pickFiles: (request) => ipcRenderer.invoke("content-flow:pick-files", request),
  readFiles: (paths) => ipcRenderer.invoke("content-flow:read-files", paths),
  openWorkflow: () => ipcRenderer.invoke("content-flow:open-workflow"),
  openRecentWorkflow: (filePath) => ipcRenderer.invoke("content-flow:open-recent-workflow", filePath),
  saveWorkflow: (request) => ipcRenderer.invoke("content-flow:save-workflow", request),
  onCloseCanvas: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("content-flow:close-canvas", listener);
    return () => ipcRenderer.removeListener("content-flow:close-canvas", listener);
  },
});
