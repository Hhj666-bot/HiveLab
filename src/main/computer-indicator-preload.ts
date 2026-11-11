import { ipcRenderer } from 'electron';
window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('stop')?.addEventListener('click', () => ipcRenderer.send('hivelab:computer-stop'));
});
