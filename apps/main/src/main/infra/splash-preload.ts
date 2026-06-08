/**
 * Splash preload script (P7)
 *
 * 暴露给 splash 窗口的 contextBridge API: window.tabulaSplash
 *  - onProgress(cb): 订阅主进程推送的 progress + message
 *  - onMessage(cb): 订阅纯文本 message(无 progress)
 *  - markReady(): 通知主进程"splash 已绘制完成,渲染端可以接管"
 *
 * 设计要点:
 *  - splash 是临时窗口,需要 contextBridge,因为 contextIsolation: true
 *  - 这里不暴露 ipcRenderer 原始对象,只暴露白名单方法(防泄漏)
 *  - markReady 走 ipcRenderer.send(SPLASH_READY)
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IpcChannels } from '@tabula/bridge';

contextBridge.exposeInMainWorld('tabulaSplash', {
  onProgress: (cb: (status: { progress: number | undefined; message: string }) => void) => {
    const wrapped = (_e: IpcRendererEvent, status: { progress: number | undefined; message: string }) =>
      cb(status);
    ipcRenderer.on(IpcChannels.SPLASH_PROGRESS, wrapped);
    return () => ipcRenderer.removeListener(IpcChannels.SPLASH_PROGRESS, wrapped);
  },
  onMessage: (cb: (payload: { message: string }) => void) => {
    const wrapped = (_e: IpcRendererEvent, payload: { message: string }) => cb(payload);
    ipcRenderer.on(IpcChannels.SPLASH_MESSAGE, wrapped);
    return () => ipcRenderer.removeListener(IpcChannels.SPLASH_MESSAGE, wrapped);
  },
  markReady: () => {
    ipcRenderer.send(IpcChannels.SPLASH_READY);
  },
});
