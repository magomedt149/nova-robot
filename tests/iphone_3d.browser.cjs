// Optional real-browser integration check: node tests/iphone_3d.browser.cjs
// Requires Playwright; all requests are fulfilled locally or blocked.
const {chromium, webkit, devices} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const fixture = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>
<div id="statusText"></div><div id="nova3DPane"><div class="n3-wrap"></div></div>
<script src="/nova-model-viewer.js"></script><script src="/nova-blender-camera.js"></script></body></html>`;
function glb(overrides = {}) {
  const positions = new Float32Array([-1,-1,0, 1,-1,0, 0,1,0]);
  const json = {asset:{version:'2.0'}, scene:0, scenes:[{nodes:[0]}], nodes:[{mesh:0}],
    meshes:[{primitives:[{attributes:{POSITION:0},material:0}]}],
    materials:[{doubleSided:true,pbrMetallicRoughness:{baseColorFactor:[1,0.2,0.1,1],metallicFactor:0,roughnessFactor:1}}],
    buffers:[{byteLength:positions.byteLength}],bufferViews:[{buffer:0,byteOffset:0,byteLength:positions.byteLength}],
    accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[-1,-1,0],max:[1,1,0]}], ...overrides};
  let text = Buffer.from(JSON.stringify(json));
  text = Buffer.concat([text,Buffer.alloc((4-text.length%4)%4,0x20)]);
  const header=Buffer.alloc(20); header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);
  header.writeUInt32LE(20+text.length+8+positions.byteLength,8);header.writeUInt32LE(text.length,12);header.writeUInt32LE(0x4e4f534a,16);
  const bin=Buffer.alloc(8);bin.writeUInt32LE(positions.byteLength);bin.writeUInt32LE(0x004e4942,4);
  return Buffer.concat([header,text,bin,Buffer.from(positions.buffer)]);
}
(async()=>{
  for(const engine of [chromium,webkit]){
    const browser = await engine.launch({headless:true, ...(engine===chromium?{args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}: {})});
    try {
      const context=await browser.newContext({...devices['iPhone 13'],defaultBrowserType:undefined});
      const page=await context.newPage(); const unexpected=[], errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/*',async route=>{
        const url=new URL(route.request().url());
        if(url.origin!=='https://nova.test'){unexpected.push(url.href);return route.abort();}
        if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:fixture});
        const relative=decodeURIComponent(url.pathname).slice(1);
        if(relative.includes('..'))return route.abort();
        try{return route.fulfill({contentType:relative.endsWith('.js')?'text/javascript':'image/png',body:await fs.readFile(path.join(root,relative))});}catch{return route.abort();}
      });
      await page.goto('https://nova.test');
      await page.waitForFunction(()=>window.NovaBlenderAgent&&window.NovaModelViewer);
      assert.equal(await page.locator('#novaBlenderAgentEndpoint').inputValue(),'');
      for(const [endpoint,token,expected] of [
        ['http://127.0.0.1:9877','','сам телефон'],
        ['http://192.168.1.2:9877','test','HTTPS'],
        ['https://blender.local:9877','','token'],
        ['https://user:secret@blender.local:9877','test','без пароля']]){
        const error=await page.evaluate(async({endpoint,token})=>{try{window.NovaBlenderAgent.setEndpoint(endpoint,token);await window.NovaBlenderAgent.connect();return '';}catch(e){return e.message;}},{endpoint,token});
        assert.ok(error.includes(expected),error);
      }
      const choose=async buffer=>page.locator('#novaModelFile').setInputFiles({name:'triangle.glb',mimeType:'model/gltf-binary',buffer});
      await choose(glb({images:[{uri:'https://forbidden.test/texture.png'}]}));
      await page.getByText('Текстуры и геометрия должны быть встроены в GLB.').waitFor();
      await choose(glb({extensionsUsed:['KHR_draco_mesh_compression']}));
      await page.getByText('Экспортируй GLB без Draco/Meshopt/KTX2:',{exact:false}).waitFor();
      await choose(Buffer.from('not a model'));
      await page.getByText('Нужен корректный GLB 2.0.').waitFor();
      await choose(glb());
      await page.waitForFunction(()=>document.querySelector('model-viewer')?.loaded,{timeout:30000});
      const dimensions=await page.locator('model-viewer').evaluate(v=>v.getDimensions());
      assert.equal(dimensions.x,2);assert.equal(dimensions.y,2);
      await page.locator('#novaModelReset').click();
      await page.locator('#novaModelClear').click();
      assert.equal(await page.locator('model-viewer').count(),0);
      // Verify native USDZ handoff only; Quick Look validates the actual archive.
      await page.locator('#novaModelFile').setInputFiles({name:'asset.usdz',mimeType:'model/vnd.usdz+zip',buffer:Buffer.from('PK\x03\x04test')});
      assert.ok((await page.locator('#novaModelUSDZ').getAttribute('href')).startsWith('blob:'));
      assert.equal(await page.locator('#novaModelUSDZ').getAttribute('rel'),'ar');
      await page.locator('#novaModelClear').click();
      assert.equal(await page.locator('#novaModelUSDZ').getAttribute('href'),null);
      assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);
      console.log(`PASS ${engine.name()}: local GLB render, invalid files, CDN blocking, cleanup, USDZ link, iPhone endpoint errors`);
      await context.close();
    } finally {await browser.close();}
  }
})().catch(e=>{console.error(e);process.exit(1);});
