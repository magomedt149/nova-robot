#!/usr/bin/env python3
"""Overlay NOVA dual skeleton + foot contacts onto a reference video for verification."""
from __future__ import annotations
import argparse, json
from pathlib import Path
import cv2

BONES=(('pelvis','shoulder_center'),('shoulder_center','neck'),('neck','head'),('shoulder_l','shoulder_r'),('hip_l','hip_r'),('shoulder_l','elbow_l'),('elbow_l','wrist_l'),('shoulder_r','elbow_r'),('elbow_r','wrist_r'),('pelvis','hip_l'),('hip_l','knee_l'),('knee_l','ankle_l'),('ankle_l','toe_l'),('pelvis','hip_r'),('hip_r','knee_r'),('knee_r','ankle_r'),('ankle_r','toe_r'))
COLORS={'man':(255,190,35),'woman':(125,55,255)}

def project(p,w,h):
    x,y,z=p; return int(round((x/3.6+.5)*w)),int(round((.5-z/6.4)*h))

def main():
    p=argparse.ArgumentParser(); p.add_argument('--video',required=True,type=Path); p.add_argument('--motion',required=True,type=Path); p.add_argument('--output',required=True,type=Path); a=p.parse_args()
    data=json.loads(a.motion.read_text(encoding='utf-8')); frames=data['frames']; fps=float(data.get('fps',30))
    cap=cv2.VideoCapture(str(a.video)); w=int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)); h=int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)); srcfps=float(cap.get(cv2.CAP_PROP_FPS) or fps)
    fourcc=cv2.VideoWriter_fourcc(*'mp4v'); out=cv2.VideoWriter(str(a.output),fourcc,fps,(w,h))
    for i,motion in enumerate(frames):
        cap.set(cv2.CAP_PROP_POS_MSEC,(i/fps)*1000); ok,frame=cap.read()
        if not ok: break
        overlay=frame.copy()
        for actor in motion['actors']:
            color=COLORS.get(actor['id'],(255,255,255)); jf=actor['joints']; contacts=actor.get('contacts') or {}
            for s,e in BONES:
                cv2.line(overlay,project(jf[s],w,h),project(jf[e],w,h),color,3,cv2.LINE_AA)
            for name,pnt in jf.items():
                cv2.circle(overlay,project(pnt,w,h),4,color,-1,cv2.LINE_AA)
            for side in ('l','r'):
                if contacts.get(f'foot_{side}'):
                    ankle=project(jf[f'ankle_{side}'],w,h); toe=project(jf[f'toe_{side}'],w,h)
                    cv2.line(overlay,ankle,toe,(70,255,80),7,cv2.LINE_AA)
                    cv2.circle(overlay,ankle,8,(70,255,80),2,cv2.LINE_AA)
        # Transparent overlay: intended only for QC, never as generation input.
        frame=cv2.addWeighted(frame,.62,overlay,.38,0)
        out.write(frame)
    cap.release(); out.release(); print(a.output)
if __name__=='__main__': main()
