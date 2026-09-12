#!/usr/bin/env python3
"""NOVA Blender Agent HTTP gateway v1.0.0 — FREE local bridge adapter."""
from __future__ import annotations
import argparse, base64, json, socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

VERSION='1.0.0'; DEFAULT_HTTP_HOST='127.0.0.1'; DEFAULT_HTTP_PORT=9877; DEFAULT_BRIDGE_HOST='127.0.0.1'; DEFAULT_BRIDGE_PORT=9876
ALLOWED_TOOLS={'ping','scene_summary','get_object','set_transform','set_camera','configure_render','create_orbit_loop','render_preview','preview_sequence','render_still','save_blend','build_wolf_scene','scan_scene','analyze_render','check_flow','check_loop','auto_refine','full_cycle'}
IMAGE_TOOLS={'render_preview','preview_sequence'}

def bridge_call(host:str,port:int,tool:str,args:dict[str,Any]|None=None)->dict[str,Any]:
    if tool not in ALLOWED_TOOLS: raise ValueError(f'Tool not allowed: {tool}')
    request={'tool':tool,'args':args or {}}
    with socket.create_connection((host,port),timeout=8) as sock:
        sock.settimeout(360); stream=sock.makefile('rwb'); stream.write((json.dumps(request,ensure_ascii=False)+'\n').encode()); stream.flush(); line=stream.readline()
        if not line: raise RuntimeError('Blender bridge closed the connection')
        return json.loads(line.decode())

def png_data_url(path_value:str)->str|None:
    if not path_value:return None
    path=Path(path_value).expanduser()
    if not path.is_file() or path.suffix.lower()!='.png' or path.stat().st_size>20*1024*1024:return None
    return 'data:image/png;base64,'+base64.b64encode(path.read_bytes()).decode('ascii')

def attach_images(tool:str,payload:dict[str,Any])->dict[str,Any]:
    if tool not in IMAGE_TOOLS or not payload.get('ok'):return payload
    result=payload.get('result')
    if not isinstance(result,dict):return payload
    if tool=='render_preview':
        image=png_data_url(str(result.get('filepath') or ''))
        if image:result['image_data']=image
    else:
        for item in (result.get('previews') or [])[:8]:
            if isinstance(item,dict):
                image=png_data_url(str(item.get('filepath') or ''))
                if image:item['image_data']=image
    return payload

class Config:
    def __init__(self,bridge_host:str,bridge_port:int,token:str):self.bridge_host=bridge_host;self.bridge_port=bridge_port;self.token=token

def run_cycle(config:Config,options:dict[str,Any])->dict[str,Any]:
    steps={}
    def call(label,tool,args=None,images=False):
        payload=bridge_call(config.bridge_host,config.bridge_port,tool,args)
        if images:payload=attach_images(tool,payload)
        steps[label]=payload
        if not payload.get('ok'):raise RuntimeError(f"{label}: {payload.get('error') or 'Blender tool failed'}")
        return payload
    call('scan_before','scan_scene')
    if bool(options.get('make_loop',True)):call('orbit','create_orbit_loop',{'frames':int(options.get('frames',240)),'radius':float(options.get('radius',9.4)),'height_offset':float(options.get('height_offset',1.6))})
    size={'width':int(options.get('preview_width',400)),'height':int(options.get('preview_height',225))}
    call('look_before','preview_sequence',size,True);call('analyze_before','analyze_render');call('flow_before','check_flow');call('loop_before','check_loop')
    if bool(options.get('refine',True)):
        call('refine','auto_refine',{**size,'max_passes':min(2,max(1,int(options.get('max_passes',2))))});call('look_after','preview_sequence',size,True);call('flow_after','check_flow');call('loop_after','check_loop')
    call('scan_after','scan_scene');return {'ok':True,'gateway_version':VERSION,'steps':steps}

class Handler(BaseHTTPRequestHandler):
    server_version=f'NovaBlenderGateway/{VERSION}'; config:Config
    def log_message(self,fmt,*args):print(f'[NOVA Blender Gateway] {self.address_string()} - {fmt%args}')
    def _origin(self):return self.headers.get('Origin') or '*'
    def _headers(self,status=200):
        self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Cache-Control','no-store');self.send_header('Access-Control-Allow-Origin',self._origin());self.send_header('Vary','Origin');self.send_header('Access-Control-Allow-Methods','GET, POST, OPTIONS');self.send_header('Access-Control-Allow-Headers','Content-Type, X-NOVA-Blender-Token');self.send_header('Access-Control-Allow-Private-Network','true');self.send_header('X-Content-Type-Options','nosniff');self.end_headers()
    def _json(self,payload,status=200):self._headers(status);self.wfile.write(json.dumps(payload,ensure_ascii=False).encode())
    def _authorized(self):return not self.config.token or self.headers.get('X-NOVA-Blender-Token','')==self.config.token
    def _body(self):
        length=min(int(self.headers.get('Content-Length','0') or 0),2*1024*1024);parsed=json.loads((self.rfile.read(length) if length else b'{}').decode())
        if not isinstance(parsed,dict):raise ValueError('JSON object required')
        return parsed
    def do_OPTIONS(self):self._headers(204)
    def do_GET(self):
        if not self._authorized():return self._json({'ok':False,'error':'Unauthorized'},401)
        if self.path.rstrip('/')!='/health':return self._json({'ok':False,'error':'Not found'},404)
        try:
            bridge=bridge_call(self.config.bridge_host,self.config.bridge_port,'ping');self._json({'ok':bool(bridge.get('ok')),'gateway_version':VERSION,'bridge':bridge},200 if bridge.get('ok') else 502)
        except Exception as exc:self._json({'ok':False,'gateway_version':VERSION,'error':str(exc)},502)
    def do_POST(self):
        if not self._authorized():return self._json({'ok':False,'error':'Unauthorized'},401)
        try:
            body=self._body();path=self.path.rstrip('/')
            if path=='/tool':
                tool=str(body.get('tool') or '');args=body.get('args') or {}
                if tool not in ALLOWED_TOOLS:return self._json({'ok':False,'error':f'Tool not allowed: {tool}'},400)
                if not isinstance(args,dict):return self._json({'ok':False,'error':'args must be an object'},400)
                payload=attach_images(tool,bridge_call(self.config.bridge_host,self.config.bridge_port,tool,args));return self._json(payload,200 if payload.get('ok') else 502)
            if path=='/cycle':return self._json(run_cycle(self.config,body))
            self._json({'ok':False,'error':'Not found'},404)
        except json.JSONDecodeError:self._json({'ok':False,'error':'Invalid JSON'},400)
        except Exception as exc:self._json({'ok':False,'error':str(exc)},502)

def main()->int:
    parser=argparse.ArgumentParser(description='NOVA browser gateway for the local FREE Blender Agent');parser.add_argument('--host',default=DEFAULT_HTTP_HOST);parser.add_argument('--port',type=int,default=DEFAULT_HTTP_PORT);parser.add_argument('--bridge-host',default=DEFAULT_BRIDGE_HOST);parser.add_argument('--bridge-port',type=int,default=DEFAULT_BRIDGE_PORT);parser.add_argument('--token',default='');parser.add_argument('--allow-lan',action='store_true');args=parser.parse_args();loopback=args.host in {'127.0.0.1','localhost','::1'}
    if not loopback and (not args.allow_lan or not args.token):raise SystemExit('Non-local bind requires --allow-lan and --token.')
    Handler.config=Config(args.bridge_host,args.bridge_port,args.token);server=ThreadingHTTPServer((args.host,args.port),Handler);print(f'[NOVA Blender Gateway v{VERSION}] http://{args.host}:{args.port} -> {args.bridge_host}:{args.bridge_port}');print('[NOVA Blender Gateway] FREE local mode; paid/cloud tools are not exposed.')
    try:server.serve_forever(poll_interval=.25)
    except KeyboardInterrupt:pass
    finally:server.server_close()
    return 0
if __name__=='__main__':raise SystemExit(main())
