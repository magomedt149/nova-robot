const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const listeners={}, storage=new Map(), messages=[];
let elements={};
const context=vm.createContext({
  console, URL, Headers, AbortController, DataView, TextDecoder, Uint8Array, Blob,
  setTimeout:()=>1,clearTimeout:()=>{},performance:{now:()=>100},
  navigator:{userAgent:'iPhone',platform:'iPhone'},location:{protocol:'https:'},
  isSecureContext:true,
  localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
  document:{readyState:'loading',hidden:false,querySelector:s=>elements[s]||null,querySelectorAll:()=>[],
    addEventListener:()=>{},documentElement:{}},
  MutationObserver:class{observe(){}disconnect(){}},
  fetch:()=>{throw new Error('Unexpected network request');},
  addEventListener:(name,fn)=>listeners[name]=fn,removeEventListener:name=>delete listeners[name]
});
context.window=context;
vm.runInContext(fs.readFileSync('nova-model-viewer.js','utf8'),context);
vm.runInContext(fs.readFileSync('nova-blender-camera.js','utf8'),context);
function glb(json){
  const bytes=Buffer.from(JSON.stringify({asset:{version:'2.0'},...json}));
  const out=Buffer.alloc(20+bytes.length);out.writeUInt32LE(0x46546c67);out.writeUInt32LE(2,4);
  out.writeUInt32LE(out.length,8);out.writeUInt32LE(bytes.length,12);out.writeUInt32LE(0x4e4f534a,16);bytes.copy(out,20);
  return out.buffer.slice(out.byteOffset,out.byteOffset+out.byteLength);
}
(async()=>{
  assert.equal(context.NovaBlenderAgent.getState().endpoint,'');
  for(const [endpoint,token,expected] of [
    ['http://127.0.0.1:9877','','сам телефон'],['http://192.168.1.2:9877','test','HTTPS'],
    ['https://blender.local:9877','','token'],['file:///tmp/data','','HTTP/HTTPS'],
    ['https://user:secret@blender.local:9877','test','без пароля']]){
    let error;try{context.NovaBlenderAgent.setEndpoint(endpoint,token);await context.NovaBlenderAgent.connect();}catch(e){error=e;}
    assert.ok(error?.message.includes(expected),error?.message);
  }
  assert.throws(()=>context.NovaModelViewer.validateGLB(new ArrayBuffer(4)),/GLB 2.0/);
  assert.equal(context.NovaModelViewer.validateGLB(glb({})).asset.version,'2.0');
  for(const uri of ['https://remote.test/a.png','//remote.test/a.bin','../a.bin']){
    assert.throws(()=>context.NovaModelViewer.validateGLB(glb({images:[{uri}]})),/встроены/);
    assert.throws(()=>context.NovaModelViewer.validateGLB(glb({buffers:[{uri}]})),/встроены/);
  }
  for(const extension of ['KHR_draco_mesh_compression','EXT_meshopt_compression','KHR_texture_basisu']){
    assert.throws(()=>context.NovaModelViewer.validateGLB(glb({extensionsRequired:[extension]})),/декодеров/);
  }
  elements['#statusText']={set textContent(text){messages.push(text);}};
  context.DeviceOrientationEvent={requestPermission:async()=>'denied'};
  await context.NovaBlenderCamera.startOrientationCapture();
  assert.ok(messages.at(-1).includes('не разрешён'));
  assert.equal(listeners.deviceorientation,undefined);
  context.DeviceOrientationEvent.requestPermission=async()=>'granted';
  await context.NovaBlenderCamera.startOrientationCapture();
  listeners.deviceorientation({alpha:null,beta:null,gamma:null});
  context.NovaBlenderCamera.stopOrientationCapture();
  assert.equal(context.NovaBlenderCamera.buildScenePack().virtual_camera.samples.length,0);
  assert.ok(messages.at(-1).includes('не передал данные'));
  await context.NovaBlenderCamera.startOrientationCapture();
  listeners.deviceorientation({alpha:10,beta:20,gamma:30});
  context.NovaBlenderCamera.stopOrientationCapture();
  assert.equal(context.NovaBlenderCamera.buildScenePack().virtual_camera.samples.length,1);
  assert.equal(listeners.deviceorientation,undefined);
  console.log('PASS: GLB validation, iPhone endpoint gates, permission refusal, empty sensor, sensor cleanup; no network');
})().catch(e=>{console.error(e);process.exit(1);});
