(() => {
  'use strict';
  const URL='https://colab.research.google.com/github/magomedt149/nova-robot/blob/blender-colab-studio/blender-colab/NOVA_Blender_Skeleton_v32_3.ipynb';
  function patch(){
    const button=document.getElementById('novaSkeletonColab');
    if(!button||button.dataset.v323==='1') return false;
    const fresh=button.cloneNode(true); fresh.dataset.v323='1'; fresh.textContent='🦴 Blender + Contact Check v32.3';
    fresh.addEventListener('click',()=>{
      try{ window.NovaBlenderSkeletonMotion?.downloadMotion?.(); }catch(_){}
      window.open(URL,'_blank','noopener,noreferrer');
      const s=document.getElementById('novaMediaStatus')||document.getElementById('statusText');
      if(s) s.textContent='🦴 Открыт исправленный Blender v32.3: DUO + IK + Foot Lock + Contact Check.';
    });
    button.replaceWith(fresh); return true;
  }
  if(!patch()){
    const o=new MutationObserver(()=>{if(patch())o.disconnect();});
    o.observe(document.documentElement,{childList:true,subtree:true});
  }
})();