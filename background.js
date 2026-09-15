const OFFSCREEN_PATH = 'offscreen.html';

const OFFSCREEN_MESSAGE_TIMEOUT_MS = 240000;
const BLOB_WAIT_TIMEOUT_MS = 5000;
const BLOB_WAIT_POLL_INTERVAL_MS = 100;
const CAPTURED_BLOB_TTL_MS = 60000;

const capturedBlobs = new Map();
const clickInterceptedBlobUrls = new Set();
const processedDownloadIds = new Set();
const ourOwnDownloads = new Set();

function cleanupOldCapturedBlobs() {
  const now = Date.now();
  for (const [url, entry] of capturedBlobs.entries()) {
    if (now - entry.capturedAt > CAPTURED_BLOB_TTL_MS) {
      capturedBlobs.delete(url);
    }
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.target !== 'background' || message.type !== 'BLOB_PDF_CAPTURED') {
    return false;
  }
  cleanupOldCapturedBlobs();
  capturedBlobs.set(message.url, { base64: message.base64, capturedAt: Date.now() });
  return false;
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.target !== 'background' || message.type !== 'BLOB_PDF_DOWNLOAD_CLICKED') {
    return false;
  }

  clickInterceptedBlobUrls.add(message.url);
  setTimeout(() => clickInterceptedBlobUrls.delete(message.url), CAPTURED_BLOB_TTL_MS);

  (async () => {
    const settings = await chrome.storage.local.get({ enabled: true });
    if (!settings.enabled) return;

    const base64 = await waitForCapturedBlob(message.url, BLOB_WAIT_TIMEOUT_MS);
    if (!base64) {
      console.warn('[Unificador ML] Blob não capturado a tempo (clique interceptado):', message.url);
      notifyError(message.filename, 'Não foi possível ler o PDF a tempo.');
      return;
    }

    const arrayBuffer = base64ToArrayBuffer(base64);
    const fakeDownloadItem = { filename: message.filename || 'etiqueta.pdf' };

    try {
      await handleLabelDownload(fakeDownloadItem, arrayBuffer);
    } catch (error) {
      console.error('Erro ao processar etiqueta (via clique):', error);
      notifyError(fakeDownloadItem.filename, error.message);

      try {
        const originalBase64 = arrayBufferToBase64(arrayBuffer);
        const originalDataUrl = `data:application/pdf;base64,${originalBase64}`;
        ourOwnDownloads.add(originalDataUrl);
        await chrome.downloads.download({
          url: originalDataUrl,
          filename: fakeDownloadItem.filename,
          saveAs: false
        });
      } catch (fallbackError) {
        console.error('Fallback de download também falhou:', fallbackError);
      }
    }
  })();

  return false;
});

function waitForCapturedBlob(url, timeoutMs) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;

    (function poll() {
      const entry = capturedBlobs.get(url);
      if (entry) {
        capturedBlobs.delete(url);
        resolve(entry.base64);
        return;
      }
      if (Date.now() >= deadline) {
        resolve(null);
        return;
      }
      setTimeout(poll, BLOB_WAIT_POLL_INTERVAL_MS);
    })();
  });
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

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

async function offscreenDocumentExists() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });
  return existing.length > 0;
}

async function ensureOffscreenDocument() {
  const alreadyExists = await offscreenDocumentExists();
  if (alreadyExists) return;

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ['BLOBS'],
    justification: 'Processar e unificar PDFs de etiquetas usando pdf-lib/pdf.js, que precisam de DOM (canvas) para gerar código de barras.'
  });
}

function isLikelyLabelDownload(downloadItem) {
  const url = downloadItem.url || downloadItem.finalUrl || '';
  const filename = downloadItem.filename || '';

  if (!url.toLowerCase().includes('.pdf') && !filename.toLowerCase().endsWith('.pdf')) {
    if (downloadItem.mime !== 'application/pdf') {
      return false;
    }
  }

  const isFromML = /vendedores\.mercadolivre\.com\.br/i.test(url) ||
                    (downloadItem.referrer && /vendedores\.mercadolivre\.com\.br/i.test(downloadItem.referrer));

  return isFromML;
}

chrome.downloads.onCreated.addListener(async (downloadItem) => {
  if (downloadItem.state && downloadItem.state !== 'in_progress') return;
  if (downloadItem.startTime) {
    const startedAt = new Date(downloadItem.startTime).getTime();
    if (Number.isFinite(startedAt) && Date.now() - startedAt > 15000) return;
  }

  if (ourOwnDownloads.has(downloadItem.url)) {
    ourOwnDownloads.delete(downloadItem.url);
    return;
  }

  if (clickInterceptedBlobUrls.has(downloadItem.url)) return;

  const settings = await chrome.storage.local.get({ enabled: true });
  if (!settings.enabled) return;

  if (!isLikelyLabelDownload(downloadItem)) return;
  if (processedDownloadIds.has(downloadItem.id)) return;
  processedDownloadIds.add(downloadItem.id);

  let arrayBuffer;

  if (downloadItem.url.startsWith('blob:')) {
    const base64 = await waitForCapturedBlob(downloadItem.url, BLOB_WAIT_TIMEOUT_MS);
    if (!base64) {
      console.warn('[Unificador ML] Blob não capturado a tempo, deixando download original seguir:', downloadItem.url);
      return;
    }
    arrayBuffer = base64ToArrayBuffer(base64);
  } else {
    try {
      const response = await fetch(downloadItem.url);
      if (!response.ok) {
        throw new Error(`Falha ao buscar PDF original (status ${response.status})`);
      }
      arrayBuffer = await response.arrayBuffer();
    } catch (fetchError) {
      console.warn('Não foi possível buscar o PDF para processar, deixando download original seguir:', fetchError);
      return;
    }
  }

  try {
    await chrome.downloads.cancel(downloadItem.id);
    try {
      await chrome.downloads.removeFile(downloadItem.id);
    } catch (removeErr) {
      // Arquivo pode nem ter chegado a ser criado - não é crítico.
    }
  } catch (e) {
    console.warn('Não foi possível cancelar download original:', e);
  }

  try {
    await handleLabelDownload(downloadItem, arrayBuffer);
  } catch (error) {
    console.error('Erro ao processar etiqueta:', error);
    notifyError(downloadItem.filename, error.message);

    try {
      const originalBase64 = arrayBufferToBase64(arrayBuffer);
      const originalDataUrl = `data:application/pdf;base64,${originalBase64}`;
      ourOwnDownloads.add(originalDataUrl);
      await chrome.downloads.download({
        url: originalDataUrl,
        filename: downloadItem.filename || 'etiqueta.pdf',
        saveAs: false
      });
    } catch (fallbackError) {
      console.error('Fallback de download também falhou:', fallbackError);
    }
  }
});

function sendMessageWithTimeout(message, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('O processamento demorou demais e foi cancelado (offscreen document pode ter sido descartado).'));
    }, timeoutMs);

    chrome.runtime.sendMessage(message)
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

async function handleLabelDownload(downloadItem, arrayBuffer) {
  await ensureOffscreenDocument();

  const result = await sendMessageWithTimeout({
    target: 'offscreen',
    type: 'PROCESS_PDF',
    payload: { base64: arrayBufferToBase64(arrayBuffer) }
  }, OFFSCREEN_MESSAGE_TIMEOUT_MS);

  if (!result || !result.success) {
    throw new Error(result?.error || 'Erro desconhecido ao processar PDF');
  }

  const pdfDataUrl = `data:application/pdf;base64,${result.pdfBase64}`;

  const originalName = downloadItem.filename || 'etiqueta.pdf';
  const hasPdfExt = /\.pdf$/i.test(originalName);
  const baseName = hasPdfExt ? originalName.replace(/\.pdf$/i, '') : originalName;
  const unifiedName = `${baseName}_unificado.pdf`;

  ourOwnDownloads.add(pdfDataUrl);
  await chrome.downloads.download({
    url: pdfDataUrl,
    filename: unifiedName,
    saveAs: false
  });

  notifySuccess(unifiedName);
}

function notifySuccess(filename) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'images/icon48.png',
    title: 'Etiqueta unificada!',
    message: `${filename} baixado com sucesso.`
  });
}

function notifyError(filename, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'images/icon48.png',
    title: 'Erro ao unificar etiqueta',
    message: `${filename || 'arquivo'}: ${message}. Baixando original sem modificações.`
  });
}
