import * as THREE from './vendor/three.module.js';

export async function loadRiggedDemon() {
  const {GLTFLoader}=await import('./vendor/GLTFLoader.js');
  const response=await fetch('/character/demon/miso.glb',{signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new Error('Rigged character could not load');
  const asset=await new GLTFLoader().parseAsync(await response.arrayBuffer(),'');
  for(const name of ['Punch','Tear page','Reach out','Crawl study','Pounce','Seated idle','Look around']) {
    if(!asset.animations.some(clip=>clip.name===name))throw new Error(`Missing animation: ${name}`);
  }
  return asset;
}
export function disposeRiggedDemon(asset) {
  asset?.scene.traverse(object=>{object.geometry?.dispose();const mats=Array.isArray(object.material)?object.material:[object.material];mats.forEach(m=>m?.dispose());object.skeleton?.dispose();});
}
// A local, disposable scene. Nothing in the model or the recording is changed.
export function createDemon(host, still = false, rigAsset, playSound = ()=>{}) {
  if(!rigAsset)throw new Error('Blender character is required');
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(720, 720, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0, 0);
  const canvas = renderer.domElement;
  canvas.className = 'demon-webgl'; host.append(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, .1, 80);
  camera.position.set(0, 1, 12); camera.lookAt(0, .2, 0);
  scene.add(new THREE.HemisphereLight(0xaca4e0, 0x171021, 2));
  const key = new THREE.DirectionalLight(0xd4b8ff, 5); key.position.set(-4, 5, 6); scene.add(key);
  const rim = new THREE.PointLight(0x9900ff, 55, 16); rim.position.set(1, 1, -1); scene.add(rim);
  const warm = new THREE.DirectionalLight(0x698bff, 2); warm.position.set(4, 0, 2); scene.add(warm);
  // Two continuous halves of the visible page, rather than floating paper confetti.
  const paperCanvas=document.createElement('canvas'); paperCanvas.width=1024; paperCanvas.height=1024;
  const ink=paperCanvas.getContext('2d');
  const paperTexture=new THREE.CanvasTexture(paperCanvas); paperTexture.colorSpace=THREE.SRGBColorSpace;
  const paper=new THREE.MeshBasicMaterial({map:paperTexture,side:THREE.FrontSide});
  const backing=new THREE.MeshStandardMaterial({color:0x7e182e,side:THREE.BackSide,roughness:.93});
  const sheets=[];
  for(const side of [-1,1]) {
    const geo=new THREE.PlaneGeometry(1,1,32,64);
    const front=new THREE.Mesh(geo,paper), back=new THREE.Mesh(geo,backing);
    front.frustumCulled=false; back.frustumCulled=false; scene.add(front,back);
    const uv=geo.attributes.uv;
    for(let i=0;i<uv.count;i++) uv.setX(i,side<0?uv.getX(i)*.5:.5+uv.getX(i)*.5);
    sheets.push({front,back,side,base:geo.attributes.position.array.slice()});
  }
  const abyss=new THREE.Mesh(new THREE.PlaneGeometry(8.6,7.6),new THREE.MeshBasicMaterial({color:0x16070f}));
  abyss.position.z=-2.7; scene.add(abyss);
  const redLight=new THREE.PointLight(0xf32648,28,12); redLight.position.set(0,0,-.5); scene.add(redLight);
  // Paint the current page's visible boxes and text onto the tearing surface.
  function capturePage() {
    const rect=canvas.getBoundingClientRect(), k=1024/rect.width;
    ink.fillStyle='#f3efdf'; ink.fillRect(0,0,1024,1024);
    ink.save(); ink.scale(k,k); ink.translate(-rect.left,-rect.top);
    const visible=el=>{const r=el.getBoundingClientRect();return r.width && r.height && r.bottom>rect.top && r.top<rect.bottom && r.right>rect.left && r.left<rect.right;};
    document.querySelectorAll('main *').forEach(el=>{
      if(!visible(el)||el.closest('#character')||el.closest('[aria-hidden="true"]'))return;
      const cs=getComputedStyle(el),r=el.getBoundingClientRect();
      if(cs.backgroundColor!=='rgba(0, 0, 0, 0)'){ink.fillStyle=cs.backgroundColor;ink.fillRect(r.left,r.top,r.width,r.height);}
      if(parseFloat(cs.borderTopWidth)){ink.strokeStyle=cs.borderTopColor;ink.lineWidth=1;ink.strokeRect(r.left,r.top,r.width,r.height);}
      for(const node of el.childNodes){
        if(node.nodeType!==Node.TEXT_NODE || !node.textContent.trim())continue;
        const range=document.createRange();range.selectNodeContents(node);const b=range.getBoundingClientRect();
        if(!b.width)continue;
        ink.fillStyle=cs.color;ink.font=`${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;ink.textBaseline='top';
        ink.fillText(node.textContent.trim(),b.left,b.top,b.width);
      }
    });
    ink.restore();paperTexture.needsUpdate=true;
  }
  const actor=new THREE.Group(); scene.add(actor);
  const rigRoot=rigAsset?new THREE.Group():null;
  const rigMixer=rigAsset?new THREE.AnimationMixer(rigAsset.scene):null;
  const rigHead=rigAsset?.scene.getObjectByName('head');
  const clawContacts=['L','R'].map(side=>rigAsset?.scene.getObjectByName('ClawContact_'+side));
  const clawPoints=[new THREE.Vector3(),new THREE.Vector3()];
  const heldClaws=[new THREE.Vector3(),new THREE.Vector3()];
  const expressionDetails=[];rigAsset?.scene.traverse(o=>{if(o.name.startsWith('GrinCrease')||o.name.startsWith('EyeFlame'))expressionDetails.push(o);});
  const revealMeshes=[];rigAsset?.scene.traverse(o=>{if(o.isMesh){
    if(o.name.startsWith('Eye')&&!o.name.startsWith('EyeFlame')){o.material=o.material.clone();o.material.color.set(0x881aff);o.material.emissive.set(0x6500ed);o.material.emissiveIntensity=1.3;}
    else if(o.name.startsWith('Fang')){o.material=o.material.clone();o.material.emissive.set(0x8f75a9);o.material.emissiveIntensity=.8;}
    else if(!o.name.startsWith('EyeFlame')&&!o.name.startsWith('GrinCrease')){o.material=o.material.clone();o.material.transparent=true;revealMeshes.push(o);}
  }});
  const facialMeshes=[];rigAsset?.scene.traverse(o=>{if(o.morphTargetDictionary)facialMeshes.push(o);});
  const seatContact=rigAsset?.scene.getObjectByName('SeatContact');
  const contactPoint=new THREE.Vector3();
  const seatShadow=rigAsset?document.createElement('span'):null;
  if(seatShadow){seatShadow.className='miso-seat-shadow';seatShadow.hidden=true;host.closest('#demon-scene').append(seatShadow);}
  let rigAction=null,rigState='';
  if(rigAsset){
    rigRoot.add(rigAsset.scene);actor.add(rigRoot);rigRoot.scale.setScalar(.85);
    rigAsset.scene.traverse(o=>{if(o.isMesh)o.frustumCulled=false;});
    host.dataset.character='blender';
  }else host.dataset.character='original';
  function playRig(name,loop=true){
    if(!rigMixer || rigState===name)return;
    const next=rigMixer.clipAction(rigAsset.animations.find(c=>c.name===name));
    next.reset().setEffectiveWeight(1).setEffectiveTimeScale(name==='Pounce'?next.getClip().duration/.85:1);
    next.setLoop(loop?THREE.LoopRepeat:THREE.LoopOnce,loop?Infinity:1);next.clampWhenFinished=true;next.play();
    if(rigAction)rigAction.crossFadeTo(next,name==='Pounce'?(rigState==='Crawl study'?.35:.07):name==='Punch'?.1:.18,false);
    rigAction=next;rigState=name;host.dataset.clip=name;
  }
  const glitchBits=new THREE.Group();actor.add(glitchBits);
  const glitchMat=new THREE.MeshBasicMaterial({color:0x85f5f0,transparent:true,opacity:.32,depthTest:false});
  for(let i=0;i<6;i++) {
    const bit=new THREE.Mesh(new THREE.PlaneGeometry(.18+(i%3)*.18,.025),glitchMat);
    bit.position.set((i%2?1:-1)*(1.05+i*.09),-.9+i*.48,1.7);glitchBits.add(bit);
  }
  let lastFrame=performance.now();
  let home=null, platforms=[], landed=null, activeTarget=null;
  const repairs=[];const damage=[];const brokenComponents=new Map();const struckComponents=new Set(),soundCues=new Set();let lastImpact=-1;
  const hitKey=element=>element?.closest('#record-panel')||element;
  const cue=(key,kind)=>{if(!soundCues.has(key)){soundCues.add(key);playSound(kind);}};
  function crackSurface(element,visit){
    if(struckComponents.has(hitKey(element)))return;struckComponents.add(hitKey(element));cue('impact-'+visit,'impact');
    const r=element.getBoundingClientRect(), ns='http://www.w3.org/2000/svg';
    const svg=document.createElementNS(ns,'svg');svg.classList.add('miso-damage');svg.setAttribute('viewBox','0 0 240 240');
    const ix=activeTarget?.ix ?? r.left+r.width*.5, iy=activeTarget?.iy ?? r.top+20;
    svg.style.left=`${ix-120}px`;svg.style.top=`${iy-120}px`;svg.dataset.impact=String(visit);
    if(!brokenComponents.has(element))brokenComponents.set(element,element.style.clipPath);
    const cut=clamp(ix-r.left,45,r.width-45), depth=Math.min(Math.max(74,iy-r.top+35),r.height*.8);
    element.style.clipPath=`polygon(0 0, ${cut-43}px 0, ${cut-32}px ${depth*.36}px, ${cut-18}px ${depth*.28}px, ${cut-10}px ${depth*.82}px, ${cut+7}px ${depth}px, ${cut+22}px ${depth*.56}px, ${cut+32}px ${depth*.64}px, ${cut+49}px 0, 100% 0, 100% 100%, 0 100%)`;
    for(let i=0;i<9;i++){
      const a=i*Math.PI*2/9+.17, len=55+(i*31%64);
      const point=(d,offset=0)=>`${120+Math.cos(a+offset)*d},${120+Math.sin(a+offset)*d}`;
      const path=document.createElementNS(ns,'path');path.setAttribute('d',`M120,120 L${point(23,.12)} L${point(48,-.08)} L${point(len)} M${point(48,-.08)} L${point(len*.82,.25)}`);
      path.setAttribute('fill','none');path.setAttribute('stroke',visit%2?'#38233f':'#654759');path.setAttribute('stroke-width',i%3===0?'2':'1');svg.append(path);
    }
    host.closest('#demon-scene').append(svg);damage.push(svg);
    // Each shard carries the struck component's actual colors, borders and text.
    for(let i=0;i<8;i++){
      const shard=document.createElement('div');shard.className='miso-component-fragment';shard.setAttribute('aria-hidden','true');shard.inert=true;
      const copy=element.cloneNode(true);copy.removeAttribute('id');copy.querySelectorAll('[id]').forEach(o=>o.removeAttribute('id'));copy.classList.remove('miso-landing','miso-struck');
      Object.assign(copy.style,{position:'absolute',left:`${r.left-ix+60}px`,top:`${r.top-iy+60}px`,width:`${r.width}px`,height:`${r.height}px`,margin:'0',transform:'none',clipPath:brokenComponents.get(element)||'none'});
      const angle=i*Math.PI/4,ax=60+Math.cos(angle)*48,ay=60+Math.sin(angle)*48,bx=60+Math.cos(angle+.8)*50,by=60+Math.sin(angle+.8)*50;
      Object.assign(shard.style,{left:`${ix-60}px`,top:`${iy-60}px`,clipPath:`polygon(50% 50%,${ax/1.2}% ${ay/1.2}%,${bx/1.2}% ${by/1.2}%)`});shard.append(copy);host.closest('#demon-scene').append(shard);damage.push(shard);
      shard.animate([{transform:'translate(0,0) rotate(0deg)',opacity:1},{transform:`translate(${Math.cos(angle)*55}px,-25px) rotate(${(i-3)*12}deg)`,opacity:1,offset:.22},{transform:`translate(${Math.cos(angle)*130}px,${Math.min(380,innerHeight-iy+90)}px) rotate(${(i-3)*60}deg)`,opacity:0}],{duration:1050+i*65,easing:'cubic-bezier(.3,.05,.75,.55)',fill:'forwards'});
    }
  }
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  function setLanding(element) {
    if(element===landed)return;
    landed?.classList.remove('miso-landing','miso-struck','miso-component-glitch');landed=element;landed?.classList.add('miso-landing');
  }
  function locatePlatforms() {
    const selectors=['.visual','#record-panel','a[href="/model"]','#record'];
    const candidates=selectors.flatMap(sel=>Array.from(document.querySelectorAll(sel))).filter(el=>{
      const r=el.getBoundingClientRect();return r.width>90 && r.bottom>150 && r.top<innerHeight-70;
    });
    const unique=[...new Set(candidates)].sort((a,b)=>a.getBoundingClientRect().left-b.getBoundingClientRect().left);
    const left=unique[0],right=unique.find(el=>el.getBoundingClientRect().left>innerWidth*.45)||unique.at(-1);
    const low=unique.reduce((best,el)=>!best||el.getBoundingClientRect().top>best.getBoundingClientRect().top?el:best,null);
    const route=[[left,.35],[right,.7],[right,.25],[left,.8],[left,.25],[right,.85],[low,.6],[left,.65]];
    platforms=route.map(([el,fraction],i)=>{const r=el?.getBoundingClientRect();const ix=r?clamp(r.left+r.width*fraction,80,innerWidth-80):innerWidth*(i%2?.75:.25);const iy=r?clamp(r.top+Math.min(r.height*.12,28),130,innerHeight-90):innerHeight*.55;return {el,ix,iy,x:clamp(ix-130,0,innerWidth-260),y:iy-228};});
  }
  const tearAt=(y,p)=>Math.pow(Math.max(0,1-Math.pow(y/3.8,2)),.72)*p*2.65;
  let start=performance.now(), exiting=0, frame=0, disposed=false;
  const smooth=(a,b,t)=>{const x=Math.max(0,Math.min(1,(t-a)/(b-a)));return x*x*x*(x*(x*6-15)+10);};
  function draw(now) {
    if(disposed)return;
    const dt=Math.min(.05,Math.max(0,(now-lastFrame)/1000));lastFrame=now;
    const elapsedScene=((exiting||now)-start)/1000;
    const approaching=!still && elapsedScene<2.4;
    const storyTime=Math.max(0,elapsedScene-2.4);
    const seconds=.65;
    const roaming=!still && storyTime>3.8;
    const roamTime=Math.max(0,storyTime-3.8);
    host.dataset.sequence=approaching?'approaching':roaming?'havoc':storyTime<.6?'peek':storyTime<1.55?'eyes':storyTime<2?'peek':storyTime<3.2?'grin':'vanish';
    const caption=host.closest('#demon-scene').querySelector('#demon-caption');
    const label=approaching?'SOMETHING IS COMING…':'MISO UNCHAINED';
    if(caption && caption.textContent!==label)caption.textContent=label;
    const tempos=[1.3,.8,1.9,.65,1.7,1.0,2.0,.7];
    let elapsed=roamTime,visit=0;
    while(elapsed>=tempos[visit%tempos.length]){elapsed-=tempos[visit%tempos.length];visit++;}
    const duration=tempos[visit%tempos.length],beat=elapsed/duration*3.4,jumping=beat<.85;
    const finishedRoute=visit>=tempos.length;
    const targetComponent=platforms[visit%platforms.length]?.el;
    const mayStrike=!struckComponents.has(hitKey(targetComponent))||lastImpact===visit;
    const punching=roaming && mayStrike && !finishedRoute && !jumping && [2,4,6].includes(visit%8) && elapsed<duration*.25+.8;
    const settle=smooth(.85,1.45,beat)*(1-smooth(3.05,3.4,beat));
    const anticipation=smooth(2.95,3.4,beat);
    host.dataset.pose=roaming?(settle>.95?'seated':jumping?'jumping':'landing'):'breakout';
    if(!still && !approaching && !roaming && storyTime>=3.25)cue('initial-vanish','teleport');
    if(roaming && !finishedRoute && [0,3,5,7].includes(visit%8)){
      if(beat>=.12)cue('vanish-'+visit,'teleport');
      if(beat>=.48)cue('arrive-'+visit,'teleport');
    }
    const glitch=(!roaming && storyTime>3.05) || roaming && visit>0 && ((beat>.1 && beat<.34)||(beat>.89 && beat<1.16)||(beat>1.7 && beat<1.9)||(beat>2.55 && beat<2.72));
    canvas.classList.toggle('digital-glitch',glitch);
    glitchBits.visible=glitch;glitchBits.position.x=Math.sin(storyTime*47)*.28;glitchBits.scale.x=1+Math.abs(Math.sin(storyTime*31))*.9;
    landed?.classList.toggle('miso-component-glitch',glitch);
    const t=still?15:roaming?15:seconds*2.5;
    actor.rotation.set(0,0,0); actor.position.set(0,0,0); actor.scale.setScalar(1);actor.updateMatrixWorld(true);
    if(home && roaming) {
      const index=visit%platforms.length;
      const to=platforms[index],from=visit===0?home:platforms[(index+platforms.length-1)%platforms.length];
      activeTarget=to;
      const teleport=visit===0 || [3,5,7].includes(visit%8);
      const q=teleport?(beat<.43?0:1):rigAsset?smooth(.15,.72,beat):smooth(0,.85,beat), size=260;
      const flight=rigAsset?Math.max(0,Math.min(1,(beat-.15)/.57)):Math.min(1,beat/.85);
      const arc=Math.sin(flight*Math.PI)*(rigAsset?Math.min(visit%2?150:85,innerHeight*.2):Math.min(120,innerHeight*.14));
      host.style.width=`${size}px`;host.style.height=`${size}px`;
      host.style.left=`${from.x+(to.x-from.x)*q}px`;host.style.top=`${Math.max(5,from.y+(to.y-from.y)*q-arc+settle*35)}px`;
      setLanding(jumping?null:to.el);
      host.closest('#demon-scene').classList.add('miso-roaming');
    }
    for(const {front,back} of sheets){front.visible=!roaming;back.visible=!roaming;}abyss.visible=!roaming;
    // Three resisted pulls. The palms stay attached to the same torn edge.
    const pull=.25*smooth(1.8,4.5,t)+.3*smooth(5.2,7.8,t)+.45*smooth(8.6,11.5,t);
    if(!roaming) {
      // The body crosses toward the lens while the page remains at its original depth.
      actor.position.z=smooth(10.7,15,t)*1.15;
      actor.rotation.y=-smooth(10.7,15,t)*.19;
    } else {
      const direction=visit%2?1:-1;
      actor.rotation.y=direction*(.6*(1-settle)+.28*settle)+Math.sin(roamTime)*.1*settle;
      const squash=.1*Math.exp(-Math.max(0,beat-.85)*9)*Math.sin(Math.max(0,beat-.85)*18);
      actor.scale.set(1+squash*.35,1-squash-anticipation*.06,1+squash*.2);
    }
    if(rigAsset){
      const clip=still?'Seated idle':!roaming?(seconds<4?'Tear page':'Crawl study'):jumping?'Pounce':punching?'Punch':'Seated idle';
      playRig(clip,!['Pounce','Punch','Reach out','Tear page'].includes(clip));
      if(clip==='Pounce')rigAction.setEffectiveTimeScale(rigAction.getClip().duration/(duration*.25));
      if(clip==='Crawl study')rigAction.setEffectiveTimeScale(.62);
      if(clip==='Punch')rigAction.setEffectiveTimeScale(1.35);
      rigMixer.update(still?0:dt);
      if(!roaming && storyTime<2){
        rigAction.time=.65;rigMixer.update(0);
        if(rigHead){rigHead.rotation.z+=.48*(smooth(.25,.75,storyTime)-2*smooth(.9,1.35,storyTime)+smooth(1.55,2,storyTime));}
      }
      if(!roaming && storyTime>=2){rigAction.time=.65;rigMixer.update(0);if(rigHead)rigHead.rotation.y+=.1*smooth(2,2.6,storyTime);}
      if(still)rigMixer.setTime(.5);
      if(roaming){actor.scale.setScalar(1);actor.rotation.y=(visit%2?1:-1)*(.2+.25*(1-settle));}
      rigRoot.position.set(0,roaming?-1.9:-1.55,roaming?.4:-1.05+smooth(10,15,t)*2.5);
      if(!roaming && !still){actor.rotation.y=-.32*smooth(4,4.6,seconds);actor.position.x=.18*Math.sin((seconds-4)*5)*smooth(4,4.3,seconds);}
      if(roaming && jumping){actor.rotation.z=Math.sin(beat/.85*Math.PI)*(visit%2?-.18:.18);actor.rotation.y=(visit%2?1:-1)*.65;}
      if(landed){const impact=punching && elapsed>duration*.25+.28 && elapsed<duration*.25+.48;landed.classList.toggle('miso-struck',impact);if(impact && lastImpact!==visit){lastImpact=visit;crackSurface(landed,visit);}}

    }
    scene.updateMatrixWorld(true);
    if(rigAsset){
      clawContacts.forEach((o,i)=>{o?.getWorldPosition(clawPoints[i]);if(seconds<4)heldClaws[i].copy(clawPoints[i]);});
      const reveal=still||roaming?1:smooth(1.55,2.65,storyTime);
      for(const o of revealMeshes){o.material.opacity=reveal;o.visible=reveal>.005;}
      const wicked=!roaming?smooth(1.75,2.65,storyTime):.35;
      for(const o of expressionDetails)o.visible=!o.name.startsWith('EyeFlame') && wicked>.12;
      for(const o of facialMeshes){
        const d=o.morphTargetDictionary, v=o.morphTargetInfluences;
        if(d.Snarl!==undefined)v[d.Snarl]=roaming?.2:0;
        if(d.Grin!==undefined)v[d.Grin]=!roaming?smooth(1.75,2.65,storyTime):.25;
        if(d.Wide!==undefined)v[d.Wide]=!roaming?smooth(4,4.2,seconds)*(1-smooth(4.4,4.8,seconds)):0;
        if(d.Blink!==undefined)v[d.Blink]=roaming?Math.pow(Math.max(0,Math.cos(beat*2.2)),30):0;
      }
    }
    for(const {front,side,base} of sheets) {
      const p=front.geometry.attributes.position;
      for(let j=0;j<p.count;j++) {
        const u=base[j*3]+.5, y=base[j*3+1]*7.6;
        const edge=side<0?u:1-u;
        const serration=(Math.sin(y*21)+Math.sin(y*47)*.4)*.045*pull*edge;
        const grip=(seconds<4?clawPoints:heldClaws)[side<0?0:1];
        const gripping=rigAsset && clawContacts.every(Boolean) && seconds<4.7 && !still;
        const opening=gripping?THREE.MathUtils.lerp(Math.abs(grip.x)*smooth(.65,1.0,seconds),tearAt(y,pull),smooth(4,4.7,seconds)):tearAt(y,pull);
        const peekWidth=.8*smooth(0,.6,storyTime)*Math.pow(Math.max(0,1-Math.pow((y-1.35)/1.0,2)),.65);
        const gripWidth=!still && !roaming?peekWidth:opening;
        const profile=gripping?Math.pow(Math.max(0,1-Math.pow((y-grip.y)/4.5,2)),.72):1;
        const shift=gripWidth*profile*Math.pow(edge,2)+Math.sin(edge*Math.PI)*pull*.3;
        const x=side<0?-4.3+u*4.3:u*4.3;
        const curl=Math.sin(edge*Math.PI*.95)*pull*1.8;
        p.setXYZ(j,x+side*(shift+serration),y,gripping?edge*edge*grip.z+curl*.2:curl+edge*pull*.4);
      }
      p.needsUpdate=true;front.geometry.computeVertexNormals();
    }
    if(seatShadow)seatShadow.hidden=true;
    if(seatContact && roaming && !jumping && !punching && landed){
      // Project the animated support point, not the model bounds or a guessed pixel offset.
      scene.updateMatrixWorld(true);camera.updateMatrixWorld(true);
      seatContact.getWorldPosition(contactPoint).project(camera);
      const rect=canvas.getBoundingClientRect(),surface=landed.getBoundingClientRect();
      const currentY=rect.top+(1-contactPoint.y)*rect.height/2;
      const contactX=rect.left+(contactPoint.x+1)*rect.width/2;
      const weight=smooth(.85,1.2,beat);
      const correction=(surface.top-currentY)*weight;
      host.style.top=`${parseFloat(host.style.top)+correction}px`;
      host.dataset.seatGap=(surface.top-currentY-correction).toFixed(2);
      seatShadow.hidden=false;seatShadow.style.left=`${contactX-20}px`;seatShadow.style.top=`${surface.top-2}px`;seatShadow.style.opacity=String(weight*.28);
    }
    const teleportFade=!roaming?1-smooth(3.25,3.65,storyTime):roaming && [0,3,5,7].includes(visit%8) && jumping?1-smooth(.12,.36,beat)+smooth(.48,.75,beat):1;
    const exitAge=exiting?(now-exiting)/1000:0;
    if(exiting){canvas.classList.toggle('digital-glitch',exitAge<.55);glitchBits.visible=exitAge<.55;}
    canvas.style.opacity=exiting?String((1-smooth(.3,.85,exitAge))*(exitAge<.3?.45+.55*Math.abs(Math.sin(exitAge*55)):1)):String(teleportFade);
    canvas.style.visibility=approaching || finishedRoute?'hidden':'visible';
    renderer.render(scene,camera);
    if(!still)frame=requestAnimationFrame(draw);
  }
  draw(performance.now());
  return {
    restart(){rigMixer?.stopAllAction();rigState='';rigAction=null;start=performance.now();lastFrame=start;exiting=0;home={x:parseFloat(host.style.left),y:parseFloat(host.style.top),size:parseFloat(host.style.width)};locatePlatforms();capturePage();if(still)draw(start);},
    exit(){
      if(exiting)return;exiting=performance.now();cue('final-vanish','teleport');
      host.closest('#demon-scene').classList.add('demon-restoring');
      brokenComponents.forEach((original,element)=>{
        const cut=element.style.clipPath,closed=cut.replace(/(-?[\d.]+)px (-?[\d.]+)px/g,'$1px 0px');
        repairs.push(element.animate([{clipPath:cut},{clipPath:closed}],{delay:650,duration:850,easing:'ease-in-out',fill:'forwards'}));
      });
      damage.forEach(o=>repairs.push(o.animate([{opacity:1},{opacity:0}],{delay:650,duration:850,fill:'forwards'})));
    },
    dispose(){repairs.forEach(a=>a.cancel());host.closest('#demon-scene').classList.remove('demon-restoring');brokenComponents.forEach((clip,element)=>{element.style.clipPath=clip;});damage.forEach(o=>o.remove());seatShadow?.remove();rigMixer?.stopAllAction();if(rigAsset){rigMixer.uncacheRoot(rigAsset.scene);rigAsset.scene.traverse(o=>o.skeleton?.dispose());}setLanding(null);host.closest('#demon-scene').classList.remove('miso-roaming');disposed=true;cancelAnimationFrame(frame);const geos=new Set(),mats=new Set();scene.traverse(o=>{if(o.geometry)geos.add(o.geometry);if(o.material){if(Array.isArray(o.material))o.material.forEach(m=>mats.add(m));else mats.add(o.material);}});geos.forEach(g=>g.dispose());mats.forEach(m=>m.dispose());paperTexture.dispose();renderer.dispose();renderer.forceContextLoss();canvas.remove();}
  };
}
