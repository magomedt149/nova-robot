#!/usr/bin/env python3
"""Aligned NOVA v32.4 wrapper around the v32.3 foot-lock generator."""
import generate_dual_walk_laugh_motion as core

core.ACTORS=(
    dict(id='man',x=-.53,hipZ=-1.31,torso=2.05,hipW=.31,shoulderW=.48,thigh=.88,shin=.86,upperArm=.46,forearm=.40,footLen=.22,stepClearance=.19),
    dict(id='woman',x=.76,hipZ=-1.42,torso=1.86,hipW=.27,shoulderW=.40,thigh=.83,shin=.80,upperArm=.41,forearm=.36,footLen=.20,stepClearance=.17),
)

if __name__=='__main__':
    core.main()
