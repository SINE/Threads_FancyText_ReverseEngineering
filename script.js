const enableButton = document.getElementById('enableDebuggerButton');
const inspectEditorButton = document.getElementById('inspectEditorButton');
const inspectSelectionButton = document.getElementById('inspectSelectionButton');
const captureEncodeButton = document.getElementById('captureEncodeButton');
const monitorStateButton = document.getElementById('monitorStateButton');
const statusText = document.getElementById('statusText');
const outputLog = document.getElementById('outputLog');

let clipboardDebuggerActive = false;

function pageLog(...args) {
  const text = args
    .map(arg => {
      if (typeof arg === 'string') {
        return arg;
      }
      if (arg instanceof Error) {
        return arg.stack || arg.message;
      }
      try {
        return JSON.stringify(arg, null, 2);
      } catch {
        return String(arg);
      }
    })
    .join(' ');

  if (outputLog) {
    outputLog.textContent += text + '\n';
    outputLog.scrollTop = outputLog.scrollHeight;
  }

  console.log(...args);
}

function setStatus(text) {
  if (statusText) {
    statusText.textContent = text;
  }
}

function setupClipboardDebugger() {
  if (clipboardDebuggerActive) {
    pageLog('Paste debugger is already enabled.');
    setStatus('Paste debugger is already enabled.');
    return;
  }

  clipboardDebuggerActive = true;
  pageLog('📋 Paste debugger enabled. Copy rich text from Threads and paste into the page.');
  setStatus('Paste debugger enabled.');

  document.addEventListener('paste', function (e) {
    e.preventDefault();
    e.stopPropagation();

    pageLog('=== CLIPBOARD DATA CAPTURED ===');

    const clipboardData = e.clipboardData || window.clipboardData;
    const types = clipboardData?.types ? Array.from(clipboardData.types) : [];
    pageLog('Available types:', types.join(', ') || 'none');

    const results = {};

    types.forEach(type => {
      try {
        const data = clipboardData.getData(type);
        results[type] = data;
        pageLog(`--- ${type} ---`);
        pageLog(data);
      } catch (err) {
        pageLog(`Failed to get ${type}:`, err?.message || String(err));
      }
    });

    if (clipboardData && clipboardData.items) {
      pageLog('--- Clipboard Items ---');
      for (let i = 0; i < clipboardData.items.length; i++) {
        const item = clipboardData.items[i];
        pageLog(`Item ${i}:`, item.type, item.kind);

        if (item.kind === 'string') {
          item.getAsString(str => {
            pageLog(`Item ${i} content:`, str);
          });
        }
      }
    }

    const safeOutput = {
      timestamp: new Date().toISOString(),
      types,
      data: {}
    };

    types.forEach(type => {
      try {
        const data = clipboardData.getData(type);
        safeOutput.data[type] = {
          raw: data,
          base64: btoa(unescape(encodeURIComponent(data))),
          length: data.length,
          charCodes: Array.from(data.slice(0, 100)).map(c => c.charCodeAt(0))
        };
      } catch (err) {
        safeOutput.data[type] = { error: err?.message || String(err) };
      }
    });

    pageLog('=== SAFE OUTPUT (copy this) ===');
    pageLog(JSON.stringify(safeOutput, null, 2));

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(JSON.stringify(safeOutput, null, 2))
        .then(() => {
          pageLog('✅ Debug JSON copied to clipboard.');
          setStatus('Debug JSON copied to clipboard.');
        })
        .catch(err => {
          pageLog('Clipboard write failed:', err?.message || String(err));
          setStatus('Clipboard write failed. See output log.');
        });
    } else {
      pageLog('Clipboard API unavailable. Copy the output from the page.');
      setStatus('Clipboard API unavailable. Copy the output from the page.');
    }
  }, true);
}

function inspectRichTextEditor() {
  pageLog('=== INSPECTING DOM ===');

  const selectors = [
    '[contenteditable="true"]',
    '[role="textbox"]',
    'textarea',
    '.DraftEditor-root',
    '.public-DraftEditor-content',
    '[data-lexical-editor]',
    '[data-slate-editor]',
    '.ql-editor',
    '.tiptap'
  ];

  const editors = [];

  selectors.forEach(selector => {
    document.querySelectorAll(selector).forEach(el => {
      editors.push({
        selector,
        innerHTML: el.innerHTML,
        innerText: el.innerText,
        textContent: el.textContent,
        attributes: Array.from(el.attributes).map(a => ({ name: a.name, value: a.value })),
        dataset: { ...el.dataset }
      });
    });
  });

  if (editors.length > 0) {
    pageLog(`Found ${editors.length} editor element(s).`);
    pageLog(JSON.stringify(editors, null, 2));
    setStatus(`Found ${editors.length} editor element(s).`);
    return editors[0];
  }

  pageLog('❌ No rich text editor found.');
  setStatus('No rich text editor found.');
  return null;
}

function inspectSelection() {
  pageLog('=== INSPECTING SELECTION ===');

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    pageLog('❌ No selection found. Select some text first!');
    setStatus('No selection found.');
    return;
  }

  const range = selection.getRangeAt(0);
  const fragment = range.cloneContents();
  const tempDiv = document.createElement('div');
  tempDiv.appendChild(fragment);

  const output = {
    selectedText: selection.toString(),
    html: tempDiv.innerHTML,
    html_base64: btoa(unescape(encodeURIComponent(tempDiv.innerHTML))),
    rangeInfo: {
      startOffset: range.startOffset,
      endOffset: range.endOffset,
      startContainer: range.startContainer.nodeName,
      endContainer: range.endContainer.nodeName
    }
  };

  pageLog(JSON.stringify(output, null, 2));
  setStatus('Selection inspected.');
  return output;
}

function monitorEditorState() {
  pageLog('=== MONITORING EDITOR STATE ===');

  const draftEditor = document.querySelector('.DraftEditor-root');
  if (draftEditor && window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
    pageLog('Draft.js editor detected.');
    const key = Object.keys(draftEditor).find(k => k.startsWith('__reactInternalInstance'));
    if (key) {
      pageLog('React instance found:', key);
    }
  }

  const lexicalEditor = document.querySelector('[data-lexical-editor]');
  if (lexicalEditor) {
    pageLog('Lexical editor found.');
  }

  const editorVars = Object.keys(window)
    .filter(k => /editor|draft|lexical|slate/i.test(k));

  if (editorVars.length) {
    pageLog('Window editor-related variables:', JSON.stringify(editorVars, null, 2));
  } else {
    pageLog('No obvious editor-related window variables found.');
  }

  setStatus('Editor state monitored.');
}

function captureElement(element) {
  const output = {
    outerHTML_base64: btoa(unescape(encodeURIComponent(element.outerHTML))),
    innerHTML_base64: btoa(unescape(encodeURIComponent(element.innerHTML))),
    innerText: element.innerText,
    textContent: element.textContent,
    attributes: {},
    children: []
  };

  Array.from(element.attributes).forEach(attr => {
    output.attributes[attr.name] = attr.value;
  });

  Array.from(element.children).forEach(child => {
    output.children.push({
      tagName: child.tagName,
      className: child.className,
      outerHTML_base64: btoa(unescape(encodeURIComponent(child.outerHTML))),
      attributes: Object.fromEntries(Array.from(child.attributes).map(a => [a.name, a.value]))
    });
  });

  pageLog(JSON.stringify(output, null, 2));
  setStatus('Element captured.');
  return output;
}

function captureAndEncode() {
  const editor = document.querySelector('[contenteditable="true"]') || inspectRichTextEditor();
  if (!editor) {
    pageLog('❌ No contenteditable element found.');
    setStatus('No contenteditable element found.');
    return;
  }

  return captureElement(editor.element ? editor.element : editor);
}

function showMenu() {
  pageLog('=== THREADS RICH TEXT DEBUG TOOL ===');
  pageLog('Available commands:');
  pageLog('• Enable paste debugger');
  pageLog('• Inspect editor');
  pageLog('• Inspect selection');
  pageLog('• Capture and encode');
  pageLog('• Monitor editor state');
  pageLog('Use the buttons above on mobile or desktop to run each action.');
}

document.addEventListener('DOMContentLoaded', () => {
  if (enableButton) {
    enableButton.addEventListener('click', () => {
      setupClipboardDebugger();
    });
  }

  if (inspectEditorButton) {
    inspectEditorButton.addEventListener('click', () => {
      inspectRichTextEditor();
    });
  }

  if (inspectSelectionButton) {
    inspectSelectionButton.addEventListener('click', () => {
      inspectSelection();
    });
  }

  if (captureEncodeButton) {
    captureEncodeButton.addEventListener('click', () => {
      captureAndEncode();
    });
  }

  if (monitorStateButton) {
    monitorStateButton.addEventListener('click', () => {
      monitorEditorState();
    });
  }

  showMenu();
  setStatus('Ready. Tap a button to begin.');
});
