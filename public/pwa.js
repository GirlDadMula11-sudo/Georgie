if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.warn("Georgie service worker unavailable", error);
    });
  });
}

let deferredInstallPrompt = null;
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  document.documentElement.dataset.installable = "true";
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  document.documentElement.dataset.installable = "false";
});

export async function installGeorgie() {
  if (!deferredInstallPrompt) return false;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  return true;
}
