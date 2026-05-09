const BUILD_ID = 'v3  2026-05-09';

const pasteZone = document.getElementById('pasteZone');
const statusText = document.getElementById('statusText');
const outputLog = document.getElementById('outputLog');
const readClipboardButton = document.getElementById('readClipboardButton');
const analyzeManualButton = document.getElementById('analyzeManualButton');
const manualInput = document.getElementById('manualInput');
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
    const itemCount = clipboardData.items.length;
    pageLog(`${itemCount} item(s) found.`);
    for (let i = 0; i < itemCount; i++) {
      const item = clipboardData.items[i];
      pageLog(`Item ${i}: type=${item.type}  kind=${item.kind}`);
      if (item.kind === 'string') {
        item.getAsString(str => {
          pageLog(`Item ${i} raw string (${str.length} chars):`);
          pageLog(analyzeUnicode(str));
        });
      } else if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) {
          pageLog(`Item ${i} is a FILE: name=${file.name || '(none)'}  size=${file.size} bytes  type=${file.type}`);
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result;
            if (typeof result === 'string') {
              pageLog(`Item ${i} file content (${result.length} chars):`);
              pageLog(result.slice(0, 2000));
            } else {
              const bytes = new Uint8Array(result);
              const hex = Array.from(bytes.slice(0, 128)).map(b => b.toString(16).padStart(2, '0')).join(' ');
              const b64 = btoa(String.fromCharCode(...bytes));
              pageLog(`Item ${i} binary (${bytes.length} bytes), first 128 hex bytes:`);
              pageLog(hex);
              pageLog(`Item ${i} full base64:`);
              pageLog(b64);
            }
          };
          if (file.type.startsWith('text/')) {
            reader.readAsText(file);
          } else {
            reader.readAsArrayBuffer(file);
          }
        }
      }
    }
  }

  pageLog('\n── Full JSON blob ──');
  pageLog(JSON.stringify(safeOutput, null, 2));

  // Diagnosis: detect iOS stripping
  const onlyPlain = types.length === 1 && types[0] === 'text/plain';
  const allZWS = onlyPlain && safeOutput.data['text/plain']?.charCodes?.every(c => c === 0x200B);
  if (onlyPlain) {
    pageLog('\n⚠️  DIAGNOSIS');
    pageLog('Only text/plain was exposed. iOS Safari strips all proprietary');
    pageLog('clipboard formats written by native apps (like Threads).');
    pageLog('The actual GIF/object references are in a native UTType pasteboard');
    pageLog('item that the web clipboard API cannot access on iOS.');
    if (allZWS) {
      pageLog('\nAll characters are U+200B (zero-width space) — these are likely');
      pageLog('placeholder glyphs Threads uses in its text/plain fallback.');
      pageLog('The real encoding is in the stripped native format.');
    }
    pageLog('\n→ OPTION 1 — iOS Shortcuts (no extra hardware needed):');
    pageLog('  1. Copy a GIF-letter in Threads.');
    pageLog('  2. Open the Shortcuts app and run a shortcut that does:');
    pageLog('     Get Clipboard → Get Details of Rich Text (try HTML / RTF)');
    pageLog('     → paste the result into the "Alternative input" field above.');
    pageLog('\n→ OPTION 2 — Mac + Universal Clipboard (same iCloud account):');
    pageLog('  1. Copy a GIF-letter on iPhone.');
    pageLog('  2. On Mac, open Terminal and run:');
    pageLog('       osascript -e \'clipboard info\'');
    pageLog('     to list all UTTypes, then:');
    pageLog('       osascript -e \'the clipboard as record\'');
    pageLog('     to dump the full pasteboard data.');
    pageLog('\n→ OPTION 3 — Network traffic (most reliable):');
    pageLog('  Use mitmproxy or Charles Proxy on the same Wi-Fi.');
    pageLog('  Post a thread with GIF-letters and capture the API request body.');
    pageLog('  The encoding will be in the POST payload directly.');
  }

  setStatus('Paste captured! See output below.');

}, true /* capture phase — fires before contenteditable receives content */);

// ── Analyze manual / Shortcuts input ────────────────────────────────────────────

function analyzeManualInput() {
  const raw = manualInput?.value?.trim();
  if (!raw) {
    pageLog('Manual input is empty.');
    setStatus('Nothing to analyze.');
    return;
  }

  pageLog('════════════════════════════════════');
  pageLog('MANUAL INPUT ANALYSIS  ' + new Date().toISOString());
  pageLog('════════════════════════════════════');

  // 1. Analyze as-is
  pageLog('── Raw string analysis ──');
  pageLog(analyzeUnicode(raw));

  // 2. Try base64 decode
  try {
    const decoded = decodeURIComponent(escape(atob(raw.replace(/\s/g, ''))));
    pageLog('\n── Decoded as base64 ──');
    pageLog(analyzeUnicode(decoded));
    pageLog('\nDecoded text:');
    pageLog(decoded.slice(0, 2000));
  } catch {
    // not valid base64
  }

  // 3. Try URL-decode
  try {
    const urlDecoded = decodeURIComponent(raw);
    if (urlDecoded !== raw) {
      pageLog('\n── URL-decoded ──');
      pageLog(analyzeUnicode(urlDecoded));
    }
  } catch {
    // not URL-encoded
  }

  // 4. Detect RTF
  if (raw.startsWith('{\\rtf')) {
    pageLog('\n── RTF detected ──');
    pageLog('This looks like an RTF document. Key things to look for:');
    pageLog('\'\\u<decimal>\' sequences = Unicode code points');
    pageLog('\'\\objattph\' or \'\\object\' blocks = embedded objects (GIFs?)');
    // extract unicode escapes
    const unicodeEscapes = [...raw.matchAll(/\\u(-?\d+)/g)];
    if (unicodeEscapes.length) {
      pageLog(`Found ${unicodeEscapes.length} \\u escape(s):`);
      unicodeEscapes.forEach(m => {
        let cp = parseInt(m[1]);
        if (cp < 0) cp += 65536; // RTF uses signed 16-bit
        pageLog(`  \\u${m[1]} => U+${cp.toString(16).toUpperCase().padStart(4,'0')}  ${unicodeNote(cp)}`);
      });
    }
    // look for object blocks
    const objMatches = [...raw.matchAll(/\\objattph|\\object|\\pict/g)];
    if (objMatches.length) {
      pageLog(`Found ${objMatches.length} object/picture block(s) — these may contain the GIF references.`);
    }
  }

  setStatus('Manual input analyzed.');
}

// ── Read full clipboard (all MIME types) ────────────────────────────────────
// Uses the modern Clipboard API which can expose proprietary / binary types
// that the paste event never surfaces. Requires user gesture + permission prompt.

async function readClipboard() {
  if (!navigator.clipboard?.read) {
    pageLog('navigator.clipboard.read() is not available in this browser.');
    pageLog('This API is needed to see non-text clipboard formats (like the Threads rich text type).');
    setStatus('Clipboard.read() not supported here.');
    return;
  }

  pageLog('════════════════════════════════════');
  pageLog('CLIPBOARD.READ()  ' + new Date().toISOString());
  pageLog('════════════════════════════════════');
  setStatus('Requesting clipboard access…');

  try {
    const clipboardItems = await navigator.clipboard.read();
    pageLog(`${clipboardItems.length} ClipboardItem(s) found.`);

    for (let i = 0; i < clipboardItems.length; i++) {
      const ci = clipboardItems[i];
      pageLog(`\n── ClipboardItem ${i} ──`);
      pageLog('Types: ' + ci.types.join(', '));

      for (const type of ci.types) {
        try {
          const blob = await ci.getType(type);
          pageLog(`\n  [${type}]  size=${blob.size} bytes`);

          if (type.startsWith('text/') || type === 'application/json') {
            const text = await blob.text();
            pageLog(`  Content (${text.length} chars):`);
            if (type === 'text/plain' || type === 'text/html') {
              pageLog(analyzeUnicode(text));
            }
            if (type === 'text/html') {
              pageLog('  Raw HTML:');
              pageLog(text);
            } else {
              pageLog(text.slice(0, 3000));
            }
          } else {
            // Binary or unknown type — dump hex + base64
            const buf = await blob.arrayBuffer();
            const bytes = new Uint8Array(buf);
            const hex = Array.from(bytes.slice(0, 256)).map(b => b.toString(16).padStart(2, '0')).join(' ');
            // Convert binary to base64 in chunks to avoid stack overflow
            let b64 = '';
            const CHUNK = 8192;
            for (let j = 0; j < bytes.length; j += CHUNK) {
              b64 += btoa(String.fromCharCode(...bytes.subarray(j, j + CHUNK)));
            }
            pageLog(`  First 256 bytes (hex):`);
            pageLog(hex);
            pageLog(`  Full base64 (${bytes.length} bytes):`);
            pageLog(b64);
          }
        } catch (err) {
          pageLog(`  Failed to read type ${type}: ${err?.message || String(err)}`);
        }
      }
    }

    setStatus('Clipboard read complete.');
  } catch (err) {
    pageLog('clipboard.read() failed: ' + (err?.message || String(err)));
    pageLog('If this says "not allowed": tap Allow when the permission prompt appears, or check iOS Settings → Safari → Paste from Other Apps.');
    setStatus('Clipboard read failed.');
  }
}

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
  if (analyzeManualButton) {
    analyzeManualButton.addEventListener('click', analyzeManualInput);
  }

  if (readClipboardButton) {
    readClipboardButton.addEventListener('click', readClipboard);
  }

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
  pageLog('Build: ' + BUILD_ID);
  pageLog('Tap the paste zone above, then long-press and paste from Threads.');
  pageLog('Every character will be decoded into its Unicode code points.\n');
  setStatus('Paste debugger active.');
});
