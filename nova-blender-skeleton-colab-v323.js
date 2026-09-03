(() => {
  'use strict';
  const URL='https://colab.research.google.com/github/magomedt149/nova-robot/blob/blender-colab-studio/blender-colab/NOVA_Blender_Skeleton_v32_4.ipynb';
  function patch(){
    const button=document.getElementById('novaSkeletonColab');
    if(!button||button.dataset.v324==='1') return false;
    const fresh=button.cloneNode(true); fresh.dataset.v324='1'; fresh.textContent='🦴 Blender + Auto Align + Contact';
    fresh.addEventListener('click',()=>{
      window.open(URL,'_blank','noopener,noreferrer');
      const s=document.getElementById('novaMediaStatus')||document.getElementById('statusText');
      if(s) s.textContent='🦴 Blender v32.4: DUO + IK + Foot Lock + Auto Align + Contact Check.';
    });
    button.replaceWith(fresh); return true;
  }
  if(!patch()){
    const o=new MutationObserver(()=>{if(patch())o.disconnect();});
    o.observe(document.documentElement,{childList:true,subtree:true});
  }
})();