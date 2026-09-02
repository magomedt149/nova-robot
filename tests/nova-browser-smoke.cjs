'use strict';

const { chromium, webkit } = require('playwright');

const engine = process.env.NOVA_BROWSER === 'webkit' ? webkit : chromium;
const base = (process.env.NOVA_BASE_URL || 'http://127.0.0.1:4173').replace(/\/$/, '');
const must = (condition, message) => {
  if (!condition) throw new Error(message);
  console.log(`PASS ${message}`);
};

(async () => {
  const browser = await engine.launch({ headless: true });
  const contextOptions = process.env.NOVA_BROWSER === 'webkit'
    ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1' }
    : { viewport: { width: 1280, height: 900 } };
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));

  try {
    let response = await page.goto(`${base}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    must(response?.ok(), 'NOVA home loads');
    must((await page.title()).includes('NOVA 33'), 'NOVA 33 title is visible');
    const stack = await page.evaluate(async () => window.NovaStack?.ready);
    must(stack?.release === '33.0.0', 'central stack release is 33.0.0');
    must(stack.loaded === 10 && stack.errors.length === 0, 'all ten media modules load once');
    const capabilities = await page.evaluate(() => ({
      whisper: Boolean(window.NovaWhisper),
      editor: Boolean(window.NovaTranscriptEditor),
      save: Boolean(window.NovaIOSSave),
      shorts: window.NovaMultiShorts?.sceneCount,
      library: Boolean(window.NovaMediaLibrary),
      pro: window.NovaVideoPro?.version
    }));
    must(capabilities.whisper && capabilities.editor && capabilities.save && capabilities.library, 'Whisper, editor, iPhone save, and library APIs are ready');
    must(capabilities.shorts === 5 && capabilities.pro === '33.0.0', 'five Shorts and Video PRO 33 are ready');

    await page.waitForSelector('#novaMediaLaunch', { timeout: 15000 });
    await page.click('#novaMediaLaunch');
    await page.waitForSelector('#novaMediaModal:not([hidden])');
    for (const id of ['#novaMotionTab', '#novaMultiShortsTab', '#novaLibraryTab', '#novaProTab']) {
      must(await page.locator(id).count() === 1, `${id} is installed once`);
    }

    response = await page.goto(`${base}/studio/`, { waitUntil: 'domcontentloaded' });
    must(response?.ok(), 'AI Studio loads');
    must(await page.locator('a[href="../videogpt/"]').count() === 1, 'AI Studio links VideoGPT Prompt Studio');
    must(await page.locator('a[href="../?open=video-pro"]').count() === 1, 'AI Studio links NOVA Video PRO');
    must(await page.locator('a[href="../blender-colab/"]').count() === 1, 'AI Studio links Blender and WanGP');
    must(await page.locator('a[href="../lip-sync/"]').count() === 1, 'AI Studio links Russian Lip-Sync');

    response = await page.goto(`${base}/videogpt/`, { waitUntil: 'domcontentloaded' });
    must(response?.ok(), 'VideoGPT Prompt Studio loads');
    must((await page.locator('.cost-guard').innerText()).includes('Без автоматических списаний'), 'credit guard is visible');
    await page.fill('#sceneBrief', 'Сохранить руки на руле и ночные отражения.');
    await page.check('#consent');
    await page.click('button.build');
    const prompt = await page.inputValue('#promptOutput');
    must(prompt.includes('SHOT-BY-SHOT REFERENCE MATCHING'), 'prompt includes exact shot matching');
    must(prompt.includes('Vertical format: 9:16') && prompt.includes('Exact duration: 5 seconds'), 'prompt defaults to economical 5-second vertical test');
    must(prompt.includes('Сохранить руки на руле'), 'prompt preserves the scene note');
    must(!(await page.locator('#copyPrompt').isDisabled()), 'copy action is enabled');

    must(errors.length === 0, `no uncaught page errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
