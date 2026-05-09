const pasteZone = document.getElementById('pasteZone');
const statusText = document.getElementById('statusText');
const outputLog = document.getElementById('outputLog');
const inspectSelectionButton = document.getElementById('inspectSelectionButton');
const copyOutputButton = document.getElementById('copyOutputButton');
const clearButton = document.getElementById('clearButton');

// ── Output helpers ────────────────────────────────────────────────────────────

function pageLog(...args) {
  const text = args.map(arg => {
    if (typeof arg === 'string') return arg;
    if (arg instanceof Error) return arg.stack || arg.message;
    try { return JSON.stringify(arg, null, 2); } catch { return String(arg); }
  }).join(' ');

  if (outputLog) {
    outputLog.value += text + '\n';
    outputLog.scrollTop = outputLog.scrollHeight;
  }
  console.log(...args);
}

function setStatus(text) {
  if (statusText) statusText.textContent = text;
}

// ── Unicode analysis ──────────────────────────────────────────────────────────
// This is the core of the reverse-engineering: each character is broken down
// into its Unicode code point, hex value, UTF-8 byte sequence, and a human
// readable note so we can see exactly what Threads encodes GIF-letters as.

function analyzeUnicode(text) {
  if (!text || text.length === 0) return '(empty string)';

  const encoder = new TextEncoder();
  const allBytes = encoder.encode(text);
  const chars = Array.from(text); // handles surrogate pairs correctly

  const lines = [
    `Total characters : ${chars.length}`,
    `Total UTF-8 bytes: ${allBytes.length}`,
    `Raw base64       : ${btoa(unescape(encodeURIComponent(text)))}`,
    ''
  ];

  chars.forEach((char, i) => {
    const cp = char.codePointAt(0);
    const hex = 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
    const utf8bytes = Array.from(encoder.encode(char))
      .map(b => b.toString(16).padStart(2, '0'))
      .join(' ');
    const dec = cp;
    const visible = (cp >= 0x20 && cp < 0x7f) ? char : '·';
    const note = unicodeNote(cp);
    lines.push(`[${i}]  ${hex}  dec:${dec}  utf8:[${utf8bytes}]  glyph:${visible}  ${note}`);
  });

  return lines.join('\n');
}

function unicodeNote(cp) {
  // Highlight characters commonly used by Threads / Meta rich text encoding
  if (cp === 0x200B) return '← ZERO WIDTH SPACE';
  if (cp === 0x200C) return '← ZERO WIDTH NON-JOINER';
  if (cp === 0x200D) return '← ZERO WIDTH JOINER (emoji ZWJ sequences)';
  if (cp === 0xFEFF) return '← BOM / ZERO WIDTH NO-BREAK SPACE';
  if (cp === 0x2060) return '← WORD JOINER';
  if (cp >= 0xE000 && cp <= 0xF8FF) return '← Private Use Area';
  if (cp >= 0x100000 && cp <= 0x10FFFD) return '← Supplementary Private Use Area-B';
  if (cp >= 0xF0000 && cp <= 0xFFFFD) return '← Supplementary Private Use Area-A';
  if (cp >= 0x1F000 && cp <= 0x1FFFF) return '← Supplementary Multilingual (emoji range)';
  if (cp >= 0xD800 && cp <= 0xDFFF) return '← Surrogate (should not appear standalone)';
  if (cp < 0x20) return `← Control char (0x${cp.toString(16).toUpperCase()})`;
  return '';
}

// ── Clipboard paste capture ──────────────────────────────────────────────────

document.addEventListener('paste', function (e) {
  // Allow the paste zone to receive focus/trigger the paste menu on iOS,
  // but intercept before the content lands in the contenteditable.
  e.preventDefault();
  e.stopPropagation();

  pageLog('════════════════════════════════════');
  pageLog('PASTE CAPTURED  ' + new Date().toISOString());
  pageLog('════════════════════════════════════');

  const clipboardData = e.clipboardData || window.clipboardData;
  const types = clipboardData?.types ? Array.from(clipboardData.types) : [];

  pageLog('Available MIME types: ' + (types.join(', ') || 'none'));

  const safeOutput = { timestamp: new Date().toISOString(), types, data: {} };

  types.forEach(type => {
    try {
      const data = clipboardData.getData(type);
      pageLog('\n── ' + type + ' ──');
      pageLog('Length: ' + data.length + ' chars');

      if (type === 'text/plain' || type === 'text/html') {
        pageLog('\n--- Unicode Analysis ---');
        pageLog(analyzeUnicode(data));
        if (type === 'text/html') {
          pageLog('\n--- Raw HTML ---');
          pageLog(data);
        }
      }

      safeOutput.data[type] = {
        raw: data,
        base64: btoa(unescape(encodeURIComponent(data))),
        length: data.length,
        charCodes: Array.from(data).map(c => c.codePointAt(0))
      };
    } catch (err) {
      safeOutput.data[type] = { error: err?.message || String(err) };
      pageLog('Failed to read ' + type + ': ' + (err?.message || String(err)));
    }
  });

  if (clipboardData?.items) {
    pageLog('\n── Clipboard Items ──');
    for (let i = 0; i < clipboardData.items.length; i++) {
      const item = clipboardData.items[i];
      pageLog(`Item ${i}: type=${item.type}  kind=${item.kind}`);
      if (item.kind === 'string') {
        item.getAsString(str => {
          pageLog(`Item ${i} raw string (${str.length} chars):`);
          pageLog(analyzeUnicode(str));
        });
      }
    }
  }

  pageLog('\n── Full JSON blob ──');
  pageLog(JSON.stringify(safeOutput, null, 2));
  setStatus('Paste captured! See output below.');

}, true /* capture phase — fires before contenteditable receives content */);

// ── Inspect selection ─────────────────────────────────────────────────────────

function inspectSelection() {
  pageLog('\n── Inspect Selection ──');

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.toString() === '') {
    pageLog('No selection. Select text in the paste zone first.');
    setStatus('No selection found.');
    return;
  }

  const range = selection.getRangeAt(0);
  const fragment = range.cloneContents();
  const tempDiv = document.createElement('div');
  tempDiv.appendChild(fragment);

  const selectedText = selection.toString();
  pageLog('Selected text (' + selectedText.length + ' chars):');
  pageLog(analyzeUnicode(selectedText));
  pageLog('\nSelection HTML:');
  pageLog(tempDiv.innerHTML);

  setStatus('Selection inspected.');
}

// ── Copy output (iOS-compatible) ──────────────────────────────────────────────

function copyOutput() {
  if (!outputLog || !outputLog.value) {
    setStatus('Nothing to copy yet.');
    return;
  }

  outputLog.focus();
  outputLog.select();
  outputLog.setSelectionRange(0, outputLog.value.length); // required on iOS

  let success = false;
  try {
    success = document.execCommand('copy');
  } catch (err) {
    // fall through to Clipboard API
  }

  if (success) {
    setStatus('Output copied to clipboard.');
    return;
  }

  // Modern fallback (works on desktop and newer iOS with HTTPS)
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(outputLog.value)
      .then(() => setStatus('Output copied to clipboard.'))
      .catch(() => setStatus('Copy failed — long-press the output and choose Select All → Copy.'));
  } else {
    setStatus('Long-press the output area, then Select All → Copy.');
  }
}

// ── Wire up buttons ───────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  if (inspectSelectionButton) {
    inspectSelectionButton.addEventListener('click', inspectSelection);
  }

  if (copyOutputButton) {
    copyOutputButton.addEventListener('click', copyOutput);
  }

  if (clearButton) {
    clearButton.addEventListener('click', () => {
      if (outputLog) outputLog.value = '';
      if (pasteZone) pasteZone.textContent = 'Tap to focus, then paste your Threads text here.';
      setStatus('Cleared.');
    });
  }

  pageLog('Threads Rich Text Debug Tool ready.');
  pageLog('Tap the paste zone above, then long-press and paste from Threads.');
  pageLog('Every character will be decoded into its Unicode code points.\n');
  setStatus('Paste debugger active.');
});
