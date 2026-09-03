#!/usr/bin/env python3
"""Generate NOVA v3 two-person walk+laugh motion with explicit foot contacts."""
from __future__ import annotations
import argparse, json, math
from pathlib import Path

FPS=30; DURATION=5.0; GROUND_Z=-3.02; STEP_HZ=1.28; ROOT_SPEED=.62; STANCE=.62
ACTORS=(
    dict(id='man',x=-.53,hipZ=-1.31,torso=1.42,hipW=.31,shoulderW=.48,thigh=.88,shin=.86,upperArm=.46,forearm=.40,footLen=.22,stepClearance=.19),
    dict(id='woman',x=.60,hipZ=-1.42,torso=1.38,hipW=.27,shoulderW=.40,thigh=.83,shin=.80,upperArm=.41,forearm=.36,footLen=.20,stepClearance=.17),
)

def clamp(v,a,b): return max(a,min(b,v))
def fract(v): return v-math.floor(v)
def smooth01(v):
    x=clamp(v,0.,1.); return x*x*(3-2*x)
def add(a,b): return [a[i]+b[i] for i in range(3)]
def v3(x=0.,y=0.,z=0.): return [float(x),float(y),float(z)]

def foot_path(t,phase,actor,side):
    period=1/STEP_HZ; q=t/period+phase; cycle=fract(q); root_y=-ROOT_SPEED*t
    travel=ROOT_SPEED*period*STANCE
    if cycle<STANCE:
        u=cycle/STANCE; rel_y=-travel/2+travel*u; z=GROUND_Z; contact=True; swing=0.
    else:
        u=(cycle-STANCE)/(1-STANCE); e=smooth01(u); rel_y=travel/2-travel*e
        z=GROUND_Z+actor['stepClearance']*math.sin(math.pi*u); contact=False; swing=math.sin(math.pi*u)
    lateral=side*actor['hipW']*.52+side*.018*math.sin(math.pi*2*q)
    return dict(point=v3(actor['x']+lateral,root_y+rel_y,z),contact=contact,swing=swing,cycle=cycle)

def solve_knee(hip,ankle,l1,l2,bend):
    dy,dz=ankle[1]-hip[1],ankle[2]-hip[2]; d=math.hypot(dy,dz)
    d=clamp(d,abs(l1-l2)+1e-4,l1+l2-1e-4); uy,uz=dy/d,dz/d
    a=(l1*l1-l2*l2+d*d)/(2*d); h=math.sqrt(max(0,l1*l1-a*a)); by,bz=hip[1]+uy*a,hip[2]+uz*a
    py,pz=-uz,uy
    return v3(hip[0]+bend*.012,by+py*h*bend,bz+pz*h*bend)

def arm_chain(sh,upper,fore,angle,side,laugh):
    elbow=v3(sh[0]+side*.03,sh[1]+math.sin(angle)*upper,sh[2]-math.cos(angle)*upper+.018*laugh)
    a2=angle*.42+side*.12+.05*laugh
    wrist=v3(elbow[0]+side*.015,elbow[1]+math.sin(a2)*fore,elbow[2]-math.cos(a2)*fore)
    return elbow,wrist

def actor_frame(t,actor,phase):
    p=math.pi*2*STEP_HZ*t+phase*math.pi*2; root_y=-ROOT_SPEED*t
    left,right=foot_path(t,phase,actor,-1),foot_path(t,phase+.5,actor,1)
    support=-1 if left['contact'] and not right['contact'] else 1 if right['contact'] and not left['contact'] else 0
    laugh=smooth01((t-.55)/.9)*(1-smooth01((t-4.2)/.7)); lp=math.sin(math.pi*2*2.25*t+phase*1.7)*laugh
    pelvis=v3(actor['x']+support*actor['hipW']*.08+.018*math.sin(p*.5),root_y,actor['hipZ']+.025*math.cos(p*2)+.012*lp)
    hip_l,hip_r=add(pelvis,v3(-actor['hipW']/2,0,0)),add(pelvis,v3(actor['hipW']/2,0,0))
    knee_l,knee_r=solve_knee(hip_l,left['point'],actor['thigh'],actor['shin'],-1),solve_knee(hip_r,right['point'],actor['thigh'],actor['shin'],1)
    shoulder=add(pelvis,v3(0,.035*math.sin(p*.5)+.025*lp,actor['torso']))
    sh_l,sh_r=add(shoulder,v3(-actor['shoulderW']/2,0,0)),add(shoulder,v3(actor['shoulderW']/2,0,0))
    neck=add(shoulder,v3(0,.012*lp,.19)); head=add(neck,v3(.015*math.sin(p*.42),.018*lp,.25+.012*lp))
    swing=.58*math.sin(p+math.pi); el_l,wr_l=arm_chain(sh_l,actor['upperArm'],actor['forearm'],swing,-1,lp); el_r,wr_r=arm_chain(sh_r,actor['upperArm'],actor['forearm'],-swing,1,lp)
    toe_l=add(left['point'],v3(-.018,-actor['footLen'],0 if left['contact'] else .018*left['swing']))
    toe_r=add(right['point'],v3(.018,-actor['footLen'],0 if right['contact'] else .018*right['swing']))
    return dict(id=actor['id'],root=pelvis,laugh=laugh,contacts=dict(foot_l=left['contact'],foot_r=right['contact'],support='left' if left['contact'] else 'right' if right['contact'] else 'flight',ground_z=GROUND_Z),joints=dict(pelvis=pelvis,shoulder_center=shoulder,neck=neck,head=head,hip_l=hip_l,hip_r=hip_r,knee_l=knee_l,knee_r=knee_r,ankle_l=left['point'],ankle_r=right['point'],toe_l=toe_l,toe_r=toe_r,shoulder_l=sh_l,shoulder_r=sh_r,elbow_l=el_l,elbow_r=el_r,wrist_l=wr_l,wrist_r=wr_r))

def build(fps=FPS,duration=DURATION):
    count=round(fps*duration); frames=[]
    for i in range(count):
        t=i/fps; frames.append(dict(t=t,ground_z=GROUND_Z,camera=dict(x=.02*math.sin(t*1.4),y=-7.5-.08*t,z=0,ortho_scale=6.4),actors=[actor_frame(t,ACTORS[0],0),actor_frame(t,ACTORS[1],.37)]))
    return dict(version=3,engine='NOVA Blender Skeleton Motion v32.3.0',preset='duo_walk_laugh_footlock',fps=fps,duration=duration,frame_count=count,coordinate_system='x=screen horizontal, y=depth, z=up',ground_z=GROUND_Z,actors=ACTORS,frames=frames)

def main():
    p=argparse.ArgumentParser(); p.add_argument('--output',required=True,type=Path); p.add_argument('--fps',type=int,default=FPS); p.add_argument('--duration',type=float,default=DURATION); a=p.parse_args()
    a.output.parent.mkdir(parents=True,exist_ok=True); a.output.write_text(json.dumps(build(a.fps,a.duration),ensure_ascii=False),encoding='utf-8'); print(a.output)
if __name__=='__main__': main()
