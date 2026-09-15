(function () {
  const originalCreateObjectURL = URL.createObjectURL.bind(URL);
  const pdfBlobUrls = new Set();

  let extensionEnabled = true;

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.__mlLabelUnifier !== true) return;
    if (data.type === 'EXTENSION_ENABLED_STATE') {
      extensionEnabled = !!data.enabled;
    }
  });

  window.postMessage({ __mlLabelUnifier: true, type: 'REQUEST_ENABLED_STATE' }, '*');

  URL.createObjectURL = function (obj) {
    const url = originalCreateObjectURL(obj);

    try {
      if (extensionEnabled && obj instanceof Blob && obj.type === 'application/pdf') {
        pdfBlobUrls.add(url);
        obj.arrayBuffer()
          .then((buffer) => {
            const base64 = arrayBufferToBase64(buffer);
            window.postMessage({
              __mlLabelUnifier: true,
              type: 'BLOB_PDF_CREATED',
              url,
              base64
            }, '*');
          })
          .catch((err) => {
            console.warn('[Unificador ML] Falha ao ler blob PDF interceptado:', err);
          });
      }
    } catch (err) {
      console.warn('[Unificador ML] Erro ao interceptar createObjectURL:', err);
    }

    return url;
  };

  document.addEventListener('click', (event) => {
    if (!extensionEnabled) return;
    const anchor = event.target && event.target.closest ? event.target.closest('a[href^="blob:"]') : null;
    if (!anchor) return;
    if (!pdfBlobUrls.has(anchor.href)) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    window.postMessage({
      __mlLabelUnifier: true,
      type: 'BLOB_PDF_DOWNLOAD_CLICKED',
      url: anchor.href,
      filename: anchor.download || null
    }, '*');
  }, true);

  function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
  }
})();
