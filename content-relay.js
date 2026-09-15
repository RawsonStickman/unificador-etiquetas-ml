function sendEnabledState() {
  chrome.storage.local.get({ enabled: true }, (settings) => {
    if (chrome.runtime.lastError) return;
    window.postMessage({
      __mlLabelUnifier: true,
      type: 'EXTENSION_ENABLED_STATE',
      enabled: settings.enabled
    }, '*');
  });
}

sendEnabledState();
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && Object.prototype.hasOwnProperty.call(changes, 'enabled')) {
    sendEnabledState();
  }
});

window.addEventListener('message', (event) => {
  if (event.source !== window) return;

  const data = event.data;
  if (!data || data.__mlLabelUnifier !== true) return;

  if (data.type === 'REQUEST_ENABLED_STATE') {
    sendEnabledState();
    return;
  }

  if (data.type === 'BLOB_PDF_CREATED') {
    chrome.runtime.sendMessage({
      target: 'background',
      type: 'BLOB_PDF_CAPTURED',
      url: data.url,
      base64: data.base64
    }).catch(() => {});
    return;
  }

  if (data.type === 'BLOB_PDF_DOWNLOAD_CLICKED') {
    chrome.runtime.sendMessage({
      target: 'background',
      type: 'BLOB_PDF_DOWNLOAD_CLICKED',
      url: data.url,
      filename: data.filename
    }).catch(() => {});
  }
});
