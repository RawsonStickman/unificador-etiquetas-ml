const MAX_PAGES = 1000;
const MAX_TEXT_LENGTH = 50;
const TRANSPORT_SCALE_HEIGHT = 0.88;
const TRANSPORT_SCALE_WIDTH = 1.0;

if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
}

function validatePdf(pdfDoc) {
  const pageCount = pdfDoc.getPageCount();
  if (pageCount < 2) throw new Error('O PDF deve ter pelo menos 2 páginas');
  if (pageCount % 2 !== 0) throw new Error('O PDF deve ter um número par de páginas');
}

async function copyPage(newDoc, sourceDoc, pageIndex) {
  const [sourcePage] = await newDoc.copyPages(sourceDoc, [pageIndex]);
  const pageSize = sourcePage.getSize();
  const newPage = newDoc.addPage([pageSize.width, pageSize.height]);
  newPage.drawPage(sourcePage);
}

async function extractAccessCode(pdfjsDoc, invoicePageIndex) {
  try {
    const page = await pdfjsDoc.getPage(invoicePageIndex + 1);
    const textContent = await page.getTextContent();
    const items = textContent.items;
    let accessCode = null;

    for (let i = 0; i < items.length; i++) {
      const text = String(items[i].str || '').trim();
      if (text && (
        text.toLowerCase().includes('chave de acesso') ||
        text.toLowerCase().includes('chave de acess') ||
        text.toLowerCase().includes('chave acesso')
      )) {
        for (let j = i + 1; j < Math.min(i + 21, items.length); j++) {
          const nextText = String(items[j].str || '').trim();
          const cleanText = nextText.replace(/[\s.\-]/g, '');
          if (cleanText.length >= 35 && /^\d+$/.test(cleanText)) {
            accessCode = cleanText.substring(0, MAX_TEXT_LENGTH);
            break;
          }
        }
        if (accessCode) break;
      }
    }

    if (!accessCode) {
      for (let i = 0; i < items.length; i++) {
        const text = String(items[i].str || '').trim();
        const cleanText = text.replace(/[\s.\-]/g, '');
        if (cleanText.length >= 35 && /^\d+$/.test(cleanText)) {
          accessCode = cleanText.substring(0, MAX_TEXT_LENGTH);
          break;
        }
      }
    }

    return accessCode;
  } catch (error) {
    console.error(`Erro ao extrair código de acesso da página ${invoicePageIndex + 1}:`, error);
    return null;
  }
}

async function extractDestinatario(pdfjsDoc, invoicePageIndex) {
  try {
    const page = await pdfjsDoc.getPage(invoicePageIndex + 1);
    const textContent = await page.getTextContent();
    const items = textContent.items;

    for (let i = 0; i < items.length; i++) {
      const text = String(items[i].str || '').trim();
      if (/DESTINAT[AÁ]RIO/i.test(text)) {
        let rest = text.replace(/^.*DESTINAT[AÁ]RIO\s*:?/i, '').trim();
        let name = rest;
        let j = i + 1;
        while (name.length < 80 && j < items.length) {
          let nextText = String(items[j].str || '').trim();
          if (!nextText) { j++; continue; }
          if (/^UF\s*:/i.test(nextText)) break;
          if (/^CNPJ|^CPF|^ENDERE[CÇ]O|^INSCRI[CÇ][AÃ]O/i.test(nextText)) break;
          name = name ? `${name} ${nextText}` : nextText;
          j++;
        }
        name = name.replace(/\s{2,}/g, ' ').trim();
        if (name) return name.substring(0, MAX_TEXT_LENGTH);
      }
    }
    return null;
  } catch (error) {
    console.error(`Erro ao extrair destinatário da página ${invoicePageIndex + 1}:`, error);
    return null;
  }
}

async function generateBarcodePng(sanitizedAccessCode, barcodeWidth, barcodeHeight) {
  if (typeof JsBarcode === 'undefined' || !sanitizedAccessCode) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = barcodeWidth;
    canvas.height = barcodeHeight;
    JsBarcode(canvas, sanitizedAccessCode, {
      format: "CODE128", width: 2, height: barcodeHeight,
      displayValue: false, margin: 0, background: "#ffffff", lineColor: "#000000"
    });
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return null;
    return await blob.arrayBuffer();
  } catch (barcodeError) {
    console.warn('Erro ao gerar código de barras:', barcodeError);
    return null;
  }
}

async function processTransportPage(newDoc, sourceDoc, pageIndex, accessCode = null, destinatario = null, barcodePngBuffer = null) {
  const [sourcePage] = await newDoc.copyPages(sourceDoc, [pageIndex]);
  const pageSize = sourcePage.getSize();
  const newPage = newDoc.addPage([pageSize.width, pageSize.height]);

  const scaledWidth = pageSize.width * TRANSPORT_SCALE_WIDTH;
  const scaledHeight = pageSize.height * TRANSPORT_SCALE_HEIGHT;
  const embeddedPage = await newDoc.embedPage(sourcePage);
  const offsetX = (pageSize.width - scaledWidth) / 2;
  const offsetY = pageSize.height - scaledHeight;

  newPage.drawPage(embeddedPage, { x: offsetX, y: offsetY, width: scaledWidth, height: scaledHeight });

  if (accessCode) {
    try {
      const sanitizedAccessCode = String(accessCode).replace(/[^\d]/g, '').substring(0, 50);
      if (sanitizedAccessCode) {
        const helveticaFont = await newDoc.embedFont(PDFLib.StandardFonts.Helvetica);
        const helveticaBoldFont = await newDoc.embedFont(PDFLib.StandardFonts.HelveticaBold);

        const titleText = "NOTA FISCAL - DANFE SIMPLIFICADO";
        const titleSize = 8;
        const titleWidth = helveticaBoldFont.widthOfTextAtSize(titleText, titleSize);
        const titleX = (pageSize.width - titleWidth) / 2;

        const codeSize = 8;
        const codeWidth = helveticaFont.widthOfTextAtSize(sanitizedAccessCode, codeSize);
        const codeX = (pageSize.width - codeWidth) / 2;
        const codeY = 35;
        const titleY = codeY + 9;

        if (destinatario) {
          const nameSize = 8;
          const nameWidth = helveticaFont.widthOfTextAtSize(destinatario, nameSize);
          const nameX = (pageSize.width - nameWidth) / 2;
          const nameY = titleY + 9;
          newPage.drawText(destinatario, { x: nameX, y: nameY, size: nameSize, font: helveticaFont, color: PDFLib.rgb(0, 0, 0) });
        }

        newPage.drawText(titleText, { x: titleX, y: titleY, size: titleSize, font: helveticaBoldFont, color: PDFLib.rgb(0, 0, 0) });
        newPage.drawText(sanitizedAccessCode, { x: codeX, y: codeY, size: codeSize, font: helveticaFont, color: PDFLib.rgb(0, 0, 0) });

        const barcodeHeight = 25;
        const barcodeWidth = 200;
        const barcodeY = 7;
        const barcodeX = (pageSize.width - barcodeWidth) / 2;

        if (barcodePngBuffer) {
          try {
            const barcodeImage = await newDoc.embedPng(barcodePngBuffer);
            newPage.drawImage(barcodeImage, { x: barcodeX, y: barcodeY, width: barcodeWidth, height: barcodeHeight });
          } catch (barcodeError) {
            console.warn('Erro ao inserir código de barras:', barcodeError);
          }
        }
      }
    } catch (error) {
      console.warn('Erro ao adicionar código de acesso:', error);
    }
  }
}

async function processSinglePdf(arrayBuffer) {
  if (typeof PDFLib === 'undefined' || typeof pdfjsLib === 'undefined') {
    throw new Error('Bibliotecas não carregadas no offscreen document.');
  }

  const sourceDoc = await PDFLib.PDFDocument.load(arrayBuffer);
  validatePdf(sourceDoc);

  const totalPages = sourceDoc.getPageCount();
  if (totalPages > MAX_PAGES) throw new Error(`Muitas páginas (${totalPages}). Máximo: ${MAX_PAGES}`);

  let pdfjsDoc = null;
  try {
    pdfjsDoc = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;
  } catch (error) {
    console.warn('Erro ao carregar PDF.js:', error);
  }

  const invoiceData = [];
  if (pdfjsDoc !== null) {
    const pairsCount = totalPages / 2;
    const BARCODE_WIDTH = 200;
    const BARCODE_HEIGHT = 25;

    invoiceData.push(...await Promise.all(
      Array.from({ length: pairsCount }, (_, i) => i).map(async (i) => {
        const invoicePageIndex = i * 2 + 1;
        const accessCode = await extractAccessCode(pdfjsDoc, invoicePageIndex);
        if (!accessCode) throw new Error('FORMA DO ARQUIVO INVÁLIDO');
        const destinatario = await extractDestinatario(pdfjsDoc, invoicePageIndex);
        const sanitizedAccessCode = String(accessCode).replace(/[^\d]/g, '').substring(0, 50);
        const barcodePngBuffer = await generateBarcodePng(sanitizedAccessCode, BARCODE_WIDTH, BARCODE_HEIGHT);
        return { accessCode, destinatario, barcodePngBuffer };
      })
    ));
  }

  const newDoc = await PDFLib.PDFDocument.create();
  newDoc.setTitle('Etiquetas Unificadas - Mercado Livre');
  newDoc.setAuthor('Unificador de Etiquetas');
  newDoc.setSubject('Etiquetas de transporte com DANFE simplificado');
  newDoc.setCreator('Unificador de Etiquetas v2.0 (Extensão)');
  newDoc.setProducer('pdf-lib');

  for (let i = 0; i < totalPages; i += 2) {
    if (pdfjsDoc !== null) {
      try {
        const { accessCode, destinatario, barcodePngBuffer } = invoiceData[i / 2];
        await processTransportPage(newDoc, sourceDoc, i, accessCode, destinatario, barcodePngBuffer);
      } catch (error) {
        console.error(`Erro ao processar página ${i + 1}:`, error);
        await copyPage(newDoc, sourceDoc, i);
      }
    } else {
      await copyPage(newDoc, sourceDoc, i);
    }
  }

  const pdfBytes = await newDoc.save({
    useObjectStreams: false,
    addDefaultPage: false,
    updateMetadata: true,
  });

  return pdfBytes;
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen' || message.type !== 'PROCESS_PDF') {
    return false;
  }

  (async () => {
    try {
      const arrayBuffer = base64ToArrayBuffer(message.payload.base64);
      const pdfBytes = await processSinglePdf(arrayBuffer);
      const pdfBase64 = arrayBufferToBase64(pdfBytes);
      sendResponse({ success: true, pdfBase64 });
    } catch (error) {
      console.error('Erro no offscreen ao processar PDF:', error);
      sendResponse({ success: false, error: error.message });
    }
  })();

  return true;
});
