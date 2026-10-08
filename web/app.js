const $ = selector => document.querySelector(selector);
const record = $('#record');
const panel = $('#record-panel');
const character = $('#character');
const canvas = $('#waveform');
const pen = canvas.getContext('2d');
const reactions = {
  Meow: { state: 'cat', bubble: "I'm a cat!", title: "I'm a cat!" },
  Woof: { state: 'dog', bubble: "I'm a dog!", title: "I'm a dog!" },
  Moo: { state: 'cow', bubble: "I'm a cow!", title: "I'm a cow!" },
};

let busy = false;
let artworkReady = false;
let live = null;
let frame = 0;
let demonTimer = null;
let demon3d = null;
const demonMusic=new Audio('/audio/bent-and-broken.mp3');demonMusic.preload='none';demonMusic.id='demon-music';demonMusic.hidden=true;document.body.append(demonMusic);
let musicFade=null, demonSound=null;
function makeDemonSound(){
  const C=window.AudioContext||window.webkitAudioContext;if(!C)return null;
  const context=new C(),master=context.createGain();master.gain.value=.32;master.connect(context.destination);context.resume().catch(()=>{});
  const buffer=context.createBuffer(1,context.sampleRate,context.sampleRate),data=buffer.getChannelData(0);
  for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;
  return {mute(value){master.gain.setTargetAtTime(value?0:.32,context.currentTime,.02);},stop(){context.close().catch(()=>{});},play(kind){
    if(context.state!=='running')return;
    const t=context.currentTime,teleport=kind==='teleport';
    const osc=context.createOscillator(),gain=context.createGain();osc.type=teleport?'sine':'triangle';osc.frequency.setValueAtTime(teleport?760:130,t);osc.frequency.exponentialRampToValueAtTime(teleport?95:38,t+(teleport?.2:.16));gain.gain.setValueAtTime(.001,t);gain.gain.exponentialRampToValueAtTime(teleport?.23:.5,t+.008);gain.gain.exponentialRampToValueAtTime(.001,t+.28);osc.connect(gain).connect(master);osc.start(t);osc.stop(t+.3);
    for(let i=0;i<(teleport?2:7);i++){
      const start=t+(teleport?i*.07:i*.035),duration=teleport?.16:.1+i*.015;
      const noise=context.createBufferSource(),filter=context.createBiquadFilter(),env=context.createGain();noise.buffer=buffer;filter.type=teleport?'bandpass':'highpass';filter.frequency.setValueAtTime(teleport?2200:1700+i*380,start);filter.frequency.exponentialRampToValueAtTime(teleport?220:700,start+duration);filter.Q.value=teleport?3:.7;env.gain.setValueAtTime(teleport?.12:.19/(1+i*.25),start);env.gain.exponentialRampToValueAtTime(.001,start+duration);noise.connect(filter).connect(env).connect(master);noise.start(start,i*.07,duration);noise.stop(start+duration);
    }
    document.querySelector('#demon-scene').dataset.lastSound=kind;
  }};
}

let demonGeneration = 0;
let demonActive = false;

function phase(name, message, button) {
  panel.dataset.phase = name;
  const showingResult = name === 'result';
  $('#result').setAttribute('aria-hidden', String(!showingResult));
  $('.record-input').setAttribute('aria-hidden', String(showingResult));
  $('#status').textContent = message;
  $('#button-label').textContent = button;
  record.disabled = busy || !artworkReady;
}

function drawWave(analyser) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const ratio = devicePixelRatio || 1;
  if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  pen.setTransform(ratio, 0, 0, ratio, 0, 0);
  pen.clearRect(0, 0, width, height);
  pen.strokeStyle = analyser ? '#75875e' : '#d2d5c5';
  pen.lineWidth = 2;
  pen.lineCap = 'round';
  pen.beginPath();
  if (analyser) {
    const data = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(data);
    for (let x = 0; x < width; x++) {
      const value = data[Math.floor(x / width * data.length)];
      const y = height / 2 - Math.max(-1, Math.min(1, value * 3)) * height * .42;
      if (!x) pen.moveTo(x, y); else pen.lineTo(x, y);
    }
  } else {
    pen.moveTo(0, height / 2);
    pen.lineTo(width, height / 2);
  }
  pen.stroke();
}

function visualize(analyser, start) {
  const elapsed = Math.min(1, (performance.now() - start) / 1000);
  $('#timer').textContent = `${(1 - elapsed).toFixed(1)}s`;
  $('#progress').style.transform = `scaleX(${elapsed})`;
  drawWave(analyser);
  frame = requestAnimationFrame(() => visualize(analyser, start));
}

function wav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset, value) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((value, i) => {
    const sample = Math.max(-1, Math.min(1, value));
    view.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  });
  return new Blob([buffer], { type: 'audio/wav' });
}

async function cleanup() {
  cancelAnimationFrame(frame);
  const session = live;
  live = null;
  if (!session) return;
  session.stream?.getTracks().forEach(track => track.stop());
  session.source?.disconnect();
  session.node?.disconnect();
  session.analyser?.disconnect();
  if (session.context.state !== 'closed') await session.context.close();
}

async function capture() {
  if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) {
    throw new Error('Use a current browser at localhost (or HTTPS) to record audio.');
  }
  const context = new AudioContext();
  const session = { context };
  live = session;
  await context.resume();
  session.stream = await navigator.mediaDevices.getUserMedia({ audio: {
    channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false,
  } });
  // Permission can finish after the page has been left or hidden.
  if (live !== session || document.hidden) {
    session.stream.getTracks().forEach(track => track.stop());
    throw new Error('Keep this tab open while recording.');
  }
  await context.audioWorklet.addModule('/recorder-worklet.js');
  session.source = context.createMediaStreamSource(session.stream);
  session.analyser = context.createAnalyser();
  session.analyser.fftSize = 1024;
  session.node = new AudioWorkletNode(context, 'one-second-recorder');
  const recording = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error('No audio arrived. Check your microphone and try again.')), 6000);
    const track = session.stream.getAudioTracks()[0];
    const ended = () => finish(new Error('Microphone disconnected. Reconnect it and try again.'));
    const hidden = () => { if (document.hidden) finish(new Error('Recording stopped. Keep this tab open and try again.')); };
    function finish(error, data) {
      clearTimeout(timeout);
      track.removeEventListener('ended', ended);
      document.removeEventListener('visibilitychange', hidden);
      session.node.port.onmessage = null;
      session.node.onprocessorerror = null;
      if (error) reject(error); else resolve(data);
    }
    track.addEventListener('ended', ended, { once: true });
    document.addEventListener('visibilitychange', hidden);
    session.node.onprocessorerror = () => finish(new Error('Audio capture failed. Please try again.'));
    session.node.port.onmessage = event => finish(null, event.data);
  });
  phase('recording', 'Listening now—meow, woof, or moo!', 'Listening…');
  $('#record-label').textContent = 'Make your sound now';
  $('#bubble').textContent = "I'm all ears.";
  session.source.connect(session.analyser);
  session.source.connect(session.node);
  session.node.connect(context.destination); // Worklet outputs silence, never mic playback.
  visualize(session.analyser, performance.now());
  try {
    return await recording;
  } finally {
    await cleanup();
    $('#timer').textContent = '0.0s';
    $('#progress').style.transform = 'scaleX(1)';
  }
}

function showResult(data) {
  const reaction = reactions[data.label];
  const values = Object.keys(reactions).map(label => data.probabilities?.[label]);
  if (!reaction || values.some(value => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new Error('The model sent an invalid result. Please try again.');
  }
  character.dataset.state = reaction.state;
  $('#bubble').textContent = reaction.bubble;
  $('#pose-label').textContent = `Miso · ${data.label.toLowerCase()} mode`;
  $('#result-label').textContent = reaction.title;
  $('#scores').replaceChildren();
  for (const label of Object.keys(reactions)) {
    const score = data.probabilities[label] * 100;
    const row = document.createElement('div');
    row.className = `score${label === data.label ? ' winner' : ''}`;
    const name = document.createElement('span'); name.textContent = label;
    const track = document.createElement('div'); track.className = 'score-track';
    const fill = document.createElement('div'); fill.className = 'score-fill'; fill.style.width = `${score}%`;
    track.append(fill);
    const value = document.createElement('span'); value.className = 'score-value'; value.textContent = `${score.toFixed(1)}%`;
    row.append(name, track, value); $('#scores').append(row);
  }

}

async function start() {
  if (busy || !artworkReady) return;
  stopDemon(false);
  busy = true;

  $('#inspect-result').hidden = true;
  character.dataset.state = 'idle';
  $('#pose-label').textContent = 'Miso · listening for a clue';
  $('#timer').textContent = '1.0s';
  $('#progress').style.transform = 'scaleX(0)';
  phase('requesting', 'Allow microphone access if your browser asks. Recording starts as soon as it is ready.', 'Opening mic…');
  try {
    const { samples, sampleRate } = await capture();
    if (samples.length !== sampleRate) throw new Error('Recording was incomplete. Please try again.');
    const rms = Math.sqrt(samples.reduce((total, sample) => total + sample * sample, 0) / samples.length);
    if (rms < .0001) throw new Error("I couldn't hear anything. Check your mic or try a little louder.");
    phase('thinking', 'Recording finished. Miso is thinking…', 'Thinking…');
    $('#record-label').textContent = 'A small identity crisis';
    $('#bubble').textContent = 'hmm. who does that sound like?';
    const response = await fetch('/api/predict?inspect=1', {
      method: 'POST', headers: { 'Content-Type': 'audio/wav' },
      body: wav(samples, sampleRate), signal: AbortSignal.timeout(30000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Prediction failed. Please try again.');
    showResult(data);
    $('#inspect-result').hidden = true;
    try {
      sessionStorage.setItem('miso.lastInspection.v1', JSON.stringify(data));
      $('#inspect-result').hidden = false;
    } catch { /* Recording and prediction still work when tab storage is unavailable. */ }
    $('#model-status').textContent = 'Model connected';
    busy = false;
    phase('result', `Miso heard ${data.label.toLowerCase()}! Want to try another sound?`, 'Try again');
    $('#record-label').textContent = 'Another identity awaits';
  } catch (error) {
    await cleanup();
    busy = false;
    const messages = {
      NotAllowedError: 'Microphone access was blocked. Allow it in your browser’s site settings, then try again.',
      NotFoundError: 'No microphone found. Connect one and try again.',
      NotReadableError: 'The microphone is unavailable. Check whether another app is using it.',
      TimeoutError: 'The model took too long. Check the server and try again.',
      TypeError: 'Could not reach Miso. Check that the Python server is running.',
    };
    phase('error', messages[error.name] || error.message, 'Try again');
    $('#record-label').textContent = "Let's try that again";
    $('#bubble').textContent = 'one more try?';
    $('#pose-label').textContent = 'Miso · still undecided';
    $('#timer').textContent = '1.0s';
    $('#progress').style.transform = 'scaleX(0)';
    drawWave();
  }
}

record.addEventListener('click', start);
document.addEventListener('keydown', event => {
  if (event.code !== 'Space' || event.repeat || event.altKey || event.metaKey || event.ctrlKey
      || $('#cheat-dialog').open || demonActive || event.target.closest('button,a,input,textarea,select,[contenteditable]')) return;
  event.preventDefault(); start();
});
$('#pause').addEventListener('click', event => {
  const paused = character.classList.toggle('paused');
  event.currentTarget.setAttribute('aria-pressed', String(paused));
  event.currentTarget.textContent = paused ? 'Resume motion' : 'Pause motion';
});
window.addEventListener('pagehide', cleanup);
window.addEventListener('resize', () => { if (!busy) drawWave(); });

async function initialize() {
  drawWave();
  try {
    const response = await fetch('/character/creature.svg');
    if (!response.ok) throw new Error('Character artwork could not load. Refresh to try again.');
    character.innerHTML = await response.text();
    setupPetting();
    artworkReady = true;
    const health = await fetch('/api/health', { signal: AbortSignal.timeout(5000) });
    const data = await health.json();
    $('#model-status').textContent = data.ready ? 'Model connected' : 'Waiting for model';
    phase('idle', data.ready ? 'Ready when you are.' : data.error, 'Make a sound');
  } catch (error) {
    $('#model-status').textContent = 'Not connected';
    phase('error', error.message || 'Check the server and refresh.', 'Make a sound');
  }
}
initialize();

// Reveal each section once as it enters view; keyboard focus reveals it immediately.
if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.remove('awaiting-reveal');
        observer.unobserve(entry.target);
      }
    }
  }, { threshold: 0.08 });
  document.querySelectorAll('[data-reveal]').forEach(section => {
    if (section.getBoundingClientRect().top > innerHeight) section.classList.add('awaiting-reveal');
    section.addEventListener('focusin', () => section.classList.remove('awaiting-reveal'));
    observer.observe(section);
  });
}


function setupPetting() {
  const button = document.createElement('button');
  button.className = 'pet-head'; button.setAttribute('aria-label', 'Pet Miso’s head');
  const hearts = document.createElement('span'); hearts.className = 'pet-hearts'; hearts.textContent = '♥ ♥'; hearts.setAttribute('aria-hidden','true');
  character.append(button, hearts);
  const hint = document.createElement('p'); hint.className = 'pet-hint'; hint.textContent = 'Psst… rub my head';
  character.parentElement.append(hint);
  let timer, lastX = null, distance = 0;
  const pet = () => {
    if (busy) return;
    character.classList.add('petting'); hint.textContent = 'That’s the spot. ♥';
    clearTimeout(timer);
    timer = setTimeout(() => { character.classList.remove('petting'); hint.textContent = 'Psst… rub my head'; }, 1800);
  };
  button.addEventListener('pointermove', event => {
    if (lastX !== null) distance += Math.abs(event.clientX - lastX);
    lastX = event.clientX;
    if (distance > 20) { pet(); distance = 0; }
  });
  button.addEventListener('pointerleave', () => { lastX = null; distance = 0; });
  button.addEventListener('click', pet); // Tap, Enter, and Space work too.
  window.addEventListener('pagehide', () => clearTimeout(timer));
}


// Deliberately local and cosmetic: this cheat never touches the model or recordings.
const cheatDialog = $('#cheat-dialog');
$('#cheat-open').addEventListener('click', () => {
  stopDemon(false);
  $('#cheat-error').textContent = '';
  $('#cheat-code').value = '';
  cheatDialog.showModal(); $('#cheat-code').focus();
});
$('#cheat-close').addEventListener('click', () => cheatDialog.close());
$('#cheat-form').addEventListener('submit', event => {
  event.preventDefault();
  if ($('#cheat-code').value.trim().toUpperCase() !== 'MISO.EXE') {
    $('#cheat-error').textContent = 'Unknown code. The creature window has a clue.';
    return;
  }
  if (!artworkReady || busy) {
    $('#cheat-error').textContent = 'Let Miso finish loading or listening first.'; return;
  }
  cheatDialog.close(); startDemon();
});
$('#demon-mute').addEventListener('click',()=>{demonMusic.muted=!demonMusic.muted;demonSound?.mute(demonMusic.muted);$('#demon-mute').textContent=demonMusic.muted?'Unmute audio':'Mute audio';$('#demon-mute').setAttribute('aria-pressed',String(demonMusic.muted));});
$('#demon-stop').addEventListener('click', () => stopDemon());
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && demonActive) { event.preventDefault(); stopDemon(); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) stopDemon(false); });
window.addEventListener('pagehide', () => stopDemon(false));
window.addEventListener('resize', () => { if (demonActive) stopDemon(); });
function stopDemon(restoreFocus = true) {
  clearInterval(musicFade);musicFade=null;demonSound?.stop();demonSound=null;demonMusic.pause();demonMusic.currentTime=0;
  clearTimeout(demonTimer); demonTimer = null;
  demonGeneration++;
  demon3d?.dispose(); demon3d = null;
  $('#demon-portal').classList.remove('has-3d');
  const wasActive = demonActive; demonActive = false;
  $('#demon-scene').hidden = true;
  $('#demon-scene').classList.remove('cinematic-tear');
  $('#demon-portal').classList.remove('portal-enter', 'portal-exit');
  document.body.classList.remove('demon-active');
  $('.visual').classList.remove('portal-breach');
  if (wasActive && restoreFocus) $('#cheat-open').focus({preventScroll: true});
}
async function startDemon() {
  stopDemon(false); demonActive = true;demonSound=makeDemonSound();
  demonMusic.muted=false;demonMusic.volume=0;$('#demon-mute').textContent='Mute audio';$('#demon-mute').setAttribute('aria-pressed','false');
  $('#demon-mute').hidden=false;
  if($('#demon-music-enabled').checked){demonMusic.play().then(()=>{if(!demonActive){demonMusic.pause();return;}musicFade=setInterval(()=>{demonMusic.volume=Math.min(.22,demonMusic.volume+.011);if(demonMusic.volume>=.22){clearInterval(musicFade);musicFade=null;}},100);}).catch(()=>{});}
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches || character.classList.contains('paused');
  const scene = $('#demon-scene'), portal = $('#demon-portal');
  scene.classList.toggle('still-demon', reduced);
  scene.hidden = false; document.body.classList.add('demon-active');
  $('.visual').classList.add('portal-breach');
  $('#demon-stop').focus({preventScroll: true});
  const generation = demonGeneration;
  try {
    const { createDemon, loadRiggedDemon, disposeRiggedDemon } = await import('/demon3d.js');
    if (!demonActive || generation !== demonGeneration) return;
    $('#demon-caption').textContent='LOADING MISO…';
    const asset=await loadRiggedDemon();
    if(!demonActive || generation!==demonGeneration){disposeRiggedDemon(asset);return;}
    demon3d = createDemon(portal, reduced, asset,kind=>demonSound?.play(kind));
    portal.classList.add('has-3d');
    scene.classList.add('cinematic-tear');
  } catch (error) { console.error('Miso could not load.',error);stopDemon(false);cheatDialog.showModal();$('#cheat-error').textContent='Miso could not load. Please try again.';return; }
  if (!demonActive || generation !== demonGeneration) return;
  const size = Math.min(620, innerWidth * .78, innerHeight * .72);
  portal.style.width = `${size}px`; portal.style.height = `${size}px`;
  portal.style.left=`${(innerWidth-size)/2}px`;portal.style.top=`${(innerHeight-size)/2}px`;
  demon3d.restart();
  if(reduced)return;
  demonTimer=setTimeout(()=>{
    demon3d?.exit();
    clearInterval(musicFade);
    musicFade=setInterval(()=>{demonMusic.volume=Math.max(0,demonMusic.volume-.02);},100);
    demonTimer=setTimeout(()=>stopDemon(),1800);
  },15500);
}
