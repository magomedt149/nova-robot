import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));
const pass = (message) => console.log(`PASS ${message}`);
const must = (condition, message) => {
  if (!condition) throw new Error(message);
  pass(message);
};

function filesBelow(directory = root) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...filesBelow(full));
    else result.push(full);
  }
  return result;
}

const allFiles = filesBelow();
const jsFiles = allFiles.filter((file) => /\.m?[jc]s$/.test(file));
for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  must(result.status === 0, `syntax ${path.relative(root, file)}${result.stderr ? `: ${result.stderr.trim()}` : ''}`);
}

const textFiles = allFiles.filter((file) => /\.(?:html|css|js|mjs|cjs|json|webmanifest|md|txt|yml|yaml|py)$/.test(file));
for (const file of textFiles) {
  must(!/^<<<<<<<|^=======|^>>>>>>>/m.test(fs.readFileSync(file, 'utf8')), `no conflict markers ${path.relative(root, file)}`);
}

const manifest = JSON.parse(read('manifest.webmanifest'));
must(manifest.name.startsWith('NOVA 33'), 'manifest release is NOVA 33');

const index = read('index.html');
must(index.includes('<title>NOVA 33'), 'main title is NOVA 33');
must(index.includes('class="version">v33.0<'), 'visible version is v33.0');
for (const match of index.matchAll(/(?:src|href)="(\.\/[^"]+\.(?:js|css))\?v=([^"]+)"/g)) {
  must(match[2] === '33.0.0', `${match[1]} cache version 33.0.0`);
}

const app = read('app.js');
must(app.includes("const VERSION = '33.0.0'"), 'app release is 33.0.0');
must(app.includes("service-worker.js?v=33.0.0"), 'service worker registration is versioned');

const modules = [
  'nova-media-studio.js',
  'nova-whisper.js',
  'nova-voice-editor.js',
  'nova-transcript-editor-sync.js',
  'nova-ios-photo-save.js',
  'nova-video-upgrade.js',
  'nova-multi-shorts.js',
  'nova-media-library.js',
  'nova-ios-output-actions.js',
  'nova-video-pro.js'
];
const loader = read('nova-stack-loader.js');
for (const file of modules) must(loader.includes(`file: '${file}'`), `central loader includes ${file}`);
must(!modules.some((file) => read('hollywood-studio.js').includes(file)), 'Hollywood has no duplicate module loader');
must(!['nova-whisper.js', 'nova-voice-editor.js', 'nova-transcript-editor-sync.js'].some((file) => read('beach-mode.js').includes(file)), 'Beach mode has no duplicate module loader');

const worker = read('nova-whisper-worker.js');
must(worker.includes("device: 'wasm'"), 'Whisper uses explicit WASM fallback');
must(worker.includes('requestAdapter()') && worker.includes('hasWebGPUAdapter'), 'Whisper verifies a real WebGPU adapter');
must(worker.includes("return_timestamps: 'word'"), 'Whisper requests word timestamps');
must(worker.includes('textCoverage') && worker.includes('groupWordItems'), 'Whisper protects transcript completeness');

const upgrade = read('nova-video-upgrade.js');
must(upgrade.includes('muxEnglishSubtitles'), 'MP4/MOV subtitle mux exists');
must(upgrade.includes('video/mp4,video/quicktime,.mp4,.mov'), 'MP4 and MOV inputs are enabled');
must(upgrade.includes('NovaIOSSave'), 'finished video supports iPhone save');

const shorts = read('nova-multi-shorts.js');
must(shorts.includes('sceneCount: 5'), 'five Shorts are exposed');
for (const mode of ['cinema', 'motion', 'threed', 'hologram', 'action']) must(shorts.includes(`style: '${mode}'`), `Short mode ${mode}`);
must(shorts.includes('720') && shorts.includes('1280'), 'Shorts use a 9:16 canvas');

const pro = read('nova-video-pro.js');
must(pro.includes("version: '33.0.0'"), 'Video PRO release is 33.0.0');
for (const id of ['novaProTab', 'novaProPrompt', 'novaProImageRef', 'novaProVideoRef', 'novaProExtend', 'novaProPlayer', 'novaProSeek']) {
  must(pro.includes(id), `Video PRO contains ${id}`);
}

const ios = read('nova-ios-photo-save.js');
must(ios.includes('navigator.share') && ios.includes('navigator.canShare'), 'native iPhone share is available');
const library = read('nova-media-library.js');
must(library.includes('indexedDB') && library.includes('Все файлы → iPhone'), 'persistent media library and iPhone export exist');

const serviceWorker = read('service-worker.js');
must(serviceWorker.includes("!key.startsWith('tumsoev-motion-studio-')"), 'main PWA preserves Motion Studio caches');
const core = [...serviceWorker.matchAll(/^\s*'(\.\/[^']*)',?$/gm)].map((match) => match[1]);
for (const item of core) must(item === './' || exists(item.slice(2)), `PWA core file exists: ${item}`);
for (const file of ['nova-stack-loader.js', ...modules, 'videogpt/index.html', 'videogpt/styles.css', 'videogpt/app.js', 'blender-colab/TUMSOEV_Blender_WanGP_Studio.ipynb', 'lip-sync/TUMSOEV_MuseTalk_Manual_5s.ipynb', 'lip-sync/TUMSOEV_LatentSync_Manual_5s.ipynb']) {
  must(core.includes(`./${file}`), `PWA precaches ${file}`);
}

for (const htmlFile of allFiles.filter((file) => file.endsWith('.html'))) {
  const html = fs.readFileSync(htmlFile, 'utf8');
  const directory = path.dirname(htmlFile);
  for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    const target = match[1].split('?')[0];
    if (!target || /^(?:https?:|data:|mailto:|tel:)/.test(target) || target === '/') continue;
    const resolved = target.startsWith('/') ? path.join(root, target.slice(1)) : path.resolve(directory, target);
    must(fs.existsSync(resolved), `local link exists: ${path.relative(root, htmlFile)} -> ${target}`);
  }
}

const studio = read('studio/index.html');
must(studio.includes('../videogpt/') && studio.includes('../?open=video-pro') && studio.includes('NOVA 33'), 'AI Studio links VideoGPT, Video PRO, and NOVA 33');
const videoGpt = read('videogpt/app.js');
must(videoGpt.includes('SHOT-BY-SHOT REFERENCE MATCHING') && videoGpt.includes('NEGATIVE CONSTRAINTS'), 'VideoGPT exact-reference prompt is complete');
must(read('videogpt/index.html').includes('Без автоматических списаний'), 'VideoGPT credit guard is visible');

for (const file of ['blender-colab/index.html', 'blender-colab/README.md', 'lip-sync/index.html']) {
  const content = read(file);
  must(!content.includes('/blob/blender-colab-studio/'), `${file} Colab link uses a live branch`);
  must(content.includes('/blob/main/'), `${file} Colab link targets main`);
}
const notebook = JSON.parse(read('blender-colab/TUMSOEV_Blender_WanGP_Studio.ipynb'));
must(JSON.stringify(notebook).includes("STUDIO_BRANCH = 'main'"), 'Blender notebook installs from main');
const motionWorker = read('motion-studio/service-worker.js');
must(motionWorker.includes("key.startsWith('tumsoev-motion-studio-')") && motionWorker.includes("ignoreSearch: true"), 'Motion Studio preserves NOVA caches and supports versioned assets offline');
must(read('motion-studio/index.html').includes('<option selected>9:16</option>'), 'Motion Studio defaults to vertical 9:16');

pass('all NOVA static checks completed');
