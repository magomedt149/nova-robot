import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const must = (condition, message) => {
  if (!condition) throw new Error(message);
  console.log(`PASS ${message}`);
};

async function testStackLoader() {
  const scripts = [];
  const events = [];
  const clicks = [];
  const status = { textContent: '' };
  const globals = {};
  const readyMarkers = {
    'nova-media-studio.js': () => { globals.__novaMediaStudioInstalled = true; },
    'nova-whisper.js': () => { globals.__novaWhisperInstalled = true; },
    'nova-voice-editor.js': () => { globals.__novaTranscriptEditorInstalled = true; },
    'nova-transcript-editor-sync.js': () => { globals.__novaTranscriptEditorSyncInstalled = true; },
    'nova-ios-photo-save.js': () => { globals.NovaIOSSave = {}; },
    'nova-video-upgrade.js': () => { globals.__novaVideoUpgradeInstalled = true; },
    'nova-multi-shorts.js': () => { globals.__novaMultiShortsInstalled = true; },
    'nova-media-library.js': () => { globals.NovaMediaLibrary = {}; },
    'nova-ios-output-actions.js': () => { globals.__novaIOSOutputActionsInstalled = true; },
    'nova-video-pro.js': () => { globals.NovaVideoPro = {}; }
  };

  const document = {
    baseURI: 'https://nova.test/',
    scripts,
    querySelector(selector) {
      if (selector === '#statusText') return status;
      if (selector === '#novaMediaLaunch' || selector === '#novaProTab') return { click: () => clicks.push(selector) };
      return null;
    },
    createElement(tag) {
      must(tag === 'script', 'stack creates script elements only');
      return {
        dataset: {},
        async: true,
        listeners: {},
        addEventListener(type, handler) { this.listeners[type] = handler; }
      };
    },
    head: {
      appendChild(script) {
        scripts.push(script);
        const file = new URL(script.src, document.baseURI).pathname.split('/').pop();
        queueMicrotask(() => {
          readyMarkers[file]?.();
          script.listeners.load?.();
        });
      }
    }
  };
  globals.window = globals;
  globals.document = document;
  globals.URL = URL;
  globals.CustomEvent = class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } };
  globals.location = { href: 'https://nova.test/?open=video-pro' };
  globals.dispatchEvent = (event) => events.push(event);
  globals.console = console;
  const context = vm.createContext(globals);
  const code = fs.readFileSync(path.join(root, 'nova-stack-loader.js'), 'utf8');
  vm.runInContext(code, context);
  const result = await globals.NovaStack.ready;

  must(result.release === '33.0.0', 'stack runtime exposes release 33.0.0');
  must(result.loaded === 10 && result.errors.length === 0, 'stack runtime loads all ten modules');
  must(scripts.length === 10, 'stack runtime injects each module once');
  must(scripts.every((script) => script.async === false && /\?v=33\.0\.0$/.test(script.src)), 'stack runtime preserves order and cache version');
  must(events.some((event) => event.type === 'nova-stack-ready'), 'stack runtime announces readiness');
  must(clicks.join(',') === '#novaMediaLaunch,#novaProTab', 'stack runtime opens a requested Video PRO route');

  vm.runInContext(code, context);
  must(scripts.length === 10, 'stack runtime guard prevents duplicate loading');
}

function element(value = '') {
  return {
    value,
    files: [],
    checked: false,
    disabled: true,
    textContent: '',
    className: '',
    listeners: {},
    classList: { toggle() {} },
    addEventListener(type, handler) { this.listeners[type] = handler; },
    focus() {},
    select() {},
    setSelectionRange() {}
  };
}

async function testVideoGptPrompt() {
  const nodes = {
    '#promptForm': element(),
    '#personImage': element(),
    '#referenceVideo': element(),
    '#promptOutput': element(),
    '#promptStatus': element(),
    '#copyPrompt': element(),
    '#downloadPrompt': element(),
    '#imageName': element(),
    '#videoName': element(),
    '#imageDrop': element(),
    '#videoDrop': element(),
    '#sceneBrief': element('Сохранить руки на руле и ночные отражения.'),
    '#style': element('cinematic'),
    '#aspect': element('9:16'),
    '#duration': element('5'),
    '#voice': element('off'),
    '#subtitles': element('match'),
    '#music': element('off'),
    '#consent': element()
  };
  nodes['#consent'].checked = true;
  const document = {
    querySelector(selector) { return nodes[selector] || null; },
    createElement() { return { click() {}, href: '', download: '' }; },
    execCommand() { return true; }
  };
  const context = vm.createContext({
    document,
    navigator: { clipboard: { writeText: async () => {} } },
    Blob,
    URL,
    setTimeout,
    console
  });
  const code = fs.readFileSync(path.join(root, 'videogpt/app.js'), 'utf8');
  vm.runInContext(code, context);
  nodes['#promptForm'].listeners.submit({ preventDefault() {} });
  const prompt = nodes['#promptOutput'].value;

  must(prompt.includes('SHOT-BY-SHOT REFERENCE MATCHING'), 'VideoGPT runtime builds shot-by-shot instructions');
  must(prompt.includes('Vertical format: 9:16') && prompt.includes('Exact duration: 5 seconds'), 'VideoGPT runtime uses economical vertical defaults');
  must(prompt.includes('Сохранить руки на руле'), 'VideoGPT runtime preserves the scene brief');
  must(prompt.includes('Do not generate narration') && prompt.includes('Do not add background music'), 'VideoGPT runtime honors voice and music settings');
  must(nodes['#copyPrompt'].disabled === false && nodes['#downloadPrompt'].disabled === false, 'VideoGPT runtime enables copy and download');
}

await testStackLoader();
await testVideoGptPrompt();
console.log('PASS all NOVA lightweight runtime tests completed');
