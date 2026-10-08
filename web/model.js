const $ = selector => document.querySelector(selector);
const STORAGE = 'miso.lastInspection.v1';
let model, packet = null, filterIndex = 0, layerIndex = 0, busy = false;
let lastRecording = null;
let scanTimer = null;
function stopScan() {
  clearInterval(scanTimer); scanTimer = null;
  $('#scan-play').textContent = 'Play filter scan';
  $('#scan-play').setAttribute('aria-pressed', 'false');
}
const fmt = value => Math.abs(value) >= .001 && Math.abs(value) < 10000 ? Number(value.toPrecision(5)).toString() : value.toExponential(3);
const exact = value => Number(value).toString();
const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
function status(message, error = false) { $('#lab-status').textContent = message; $('#lab-status').classList.toggle('error', error); $('#lab-status').hidden = !message; }
function setBusy(value) {
  if (value) { stopScan(); stopNetwork(); }
  busy = value;
  $('#refresh').disabled = value;
  $('#last-recording').disabled = value || !lastRecording;
  $('#last-recording').title = lastRecording ? 'Inspect your latest microphone recording' : 'Record a sound on Meet Miso first';
  $('#clear-trace').disabled = value;
  $('#scan-play').disabled = value;
  $('#network-play').disabled = value || !packet;
  $('#network-step').disabled = value || !packet;
}
function color(value, max) {
  const strength = Math.min(1, Math.abs(value) / (max || 1));
  return value < 0 ? `rgba(199,128,112,${.08 + strength * .62})` : `rgba(99,146,179,${.08 + strength * .62})`;
}

// SVG plots stay sharp at every viewport size. Shared scales are passed explicitly.
function plot(target, values, {xLabel = '', yLabel = '', xStart = 0, xEnd = values.length - 1,
  min, max, marker, band, bars = false} = {}) {
  const tick = value => value === 0 ? '0' : Math.abs(value) < .001 ? value.toExponential(1) : Number(value.toPrecision(3)).toString();
  const w = 700, h = 290, left = 63, right = 18, top = 25, bottom = 44;
  const low = min ?? Math.min(0, ...values);
  let high = max ?? Math.max(0, ...values);
  if (high === low) high = low + 1;
  const span = high - low || 1;
  const x = i => left + i / Math.max(1, values.length - 1) * (w - left - right);
  const y = value => top + (high - value) / span * (h - top - bottom);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`); svg.classList.add('plot'); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${yLabel} against ${xLabel}; ${values.length} plotted values, range ${fmt(low)} to ${fmt(high)}`);
  const add = (tag, attrs, text) => {
    const item = document.createElementNS(svg.namespaceURI, tag);
    Object.entries(attrs).forEach(([name, value]) => item.setAttribute(name, value));
    if (text !== undefined) item.textContent = text;
    svg.append(item); return item;
  };
  if (band) add('rect', {x: x(band[0]), y: top, width: Math.max(2, x(band[1]) - x(band[0])), height: h - top - bottom, fill: '#dce4cd'});
  for (let i = 0; i <= 4; i++) {
    const value = low + span * i / 4;
    add('line', {x1: left, x2: w - right, y1: y(value), y2: y(value), stroke: '#e8e5dc', 'stroke-width': 1});
    add('text', {x: left - 8, y: y(value) + 3, 'text-anchor': 'end'}, tick(value));
  }
  if (bars) {
    values.forEach((value, i) => add('line', {x1: x(i), x2: x(i), y1: y(0), y2: y(value), stroke: value < 0 ? '#c78070' : '#6392b3', 'stroke-width': 2}));
  } else {
    add('path', {d: values.map((value, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)},${y(value).toFixed(2)}`).join(' '), fill: 'none', stroke: ({'input-chart':'#477899','kernel-chart':'#a25068','frequency-chart':'#8161aa','window-chart':'#477899','response-chart':'#b36b25'}[target.id] || '#8161aa'), 'stroke-width': 2, 'stroke-linejoin': 'round'});
  }
  if (marker !== undefined) {
    add('line', {x1: x(marker), x2: x(marker), y1: top, y2: h - bottom, stroke: '#ae795f', 'stroke-dasharray': '4 3'});
    add('circle', {cx: x(marker), cy: y(values[marker]), r: 4, fill: '#ae795f'});
  }
  add('text', {x: left, y: 12}, yLabel);
  for (let i = 0; i <= 4; i++) add('text', {x: left + i / 4 * (w - left - right), y: h - 25, 'text-anchor': 'middle'}, tick(xStart + i / 4 * (xEnd - xStart)));
  add('text', {x: (left + w - right) / 2, y: h - 5, 'text-anchor': 'middle'}, xLabel);
  target.replaceChildren(svg);
}

// The explorer reads the same checkpoint and forward-pass trace as the plots.
let networkSelection = {column: 3, index: 0};
let networkTimer = null;
const networkStages = ['Audio input', 'Four learned filters', 'Pooled & scaled features', 'Hidden layer 1 · tanh', 'Hidden layer 2 · tanh', 'Output logits → softmax'];
const graphNS = 'http://www.w3.org/2000/svg';
function graphElement(tag, attrs = {}, text) {
  const node = document.createElementNS(graphNS, tag);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
  if (text !== undefined) node.textContent = text;
  return node;
}
function stopNetwork() {
  clearInterval(networkTimer); networkTimer = null;
  document.querySelectorAll('.signal-moving').forEach(edge => edge.classList.remove('signal-moving'));
  $('#network-play').textContent = '▶ Follow the signal';
  $('#network-play').setAttribute('aria-pressed', 'false');
}
function networkValue(column, index) {
  if (!packet) return null;
  if (column === 2) return packet.trace.features[index];
  if (column >= 3) return packet.trace.layers[column - 3].outputs[index];
  return null;
}
function networkName(column, index) {
  if (column === 0) return 'Audio input';
  if (column === 1) return `Filter ${index + 1}`;
  if (column === 2) return `S${Math.floor(index / model.filters.length) + 1} / F${index % model.filters.length + 1}`;
  if (column === 5) return model.labels[index];
  return `Hidden ${column - 2} · neuron ${index + 1}`;
}
function renderNetwork() {
  stopNetwork();
  const host = $('#network-graph'); host.replaceChildren();
  const svg = graphElement('svg', {viewBox: '0 0 1160 615', class: 'network-svg', 'aria-label': 'Audio to four filters, sixteen pooled features, two hidden layers, and three output logits'});
  const columns = [1, model.filters.length, model.layers[0].weights[0].length, ...model.layers.map(l => l.weights.length)];
  const xs = [75, 246, 449, 661, 857, 1057];
  const ys = (col, i) => columns[col] === 1 ? 294 : 96 + i * 450 / (columns[col] - 1);
  const titles = ['SOUND', 'FILTERS', 'FEATURES', 'HIDDEN 01', 'HIDDEN 02', 'OUTPUT'];
  const subtitles = ['16,000 samples', '101 taps · stride 64', '4 segments × 4 filters', '16 neurons · tanh', '16 neurons · tanh', '3 logits → scores'];
  titles.forEach((title, c) => {
    svg.append(graphElement('text', {x:xs[c],y:27,'text-anchor':'middle',class:'graph-column-title'}, title));
    svg.append(graphElement('text', {x:xs[c],y:47,'text-anchor':'middle',class:'graph-column-subtitle'}, subtitles[c]));
  });
  const edges = graphElement('g', {'aria-hidden':'true'});
  const addEdge = (sc, si, tc, ti, weight) => {
    const sx = xs[sc] + (sc === 0 ? 52 : sc === 1 ? 48 : 18), tx = xs[tc] - (tc === 1 ? 48 : 18);
    const sy = ys(sc,si), ty = ys(tc,ti), mid = (sx+tx)/2;
    const path = graphElement('path', {d:`M${sx},${sy} C${mid},${sy} ${mid},${ty} ${tx},${ty}`, fill:'none', class:'graph-edge',
      stroke:weight === undefined ? '#9aaaa4' : weight < 0 ? '#c78070' : '#6392b3',
      'data-source':`${sc}:${si}`, 'data-target':`${tc}:${ti}`, 'data-stage':tc,
      'data-dense':String(weight !== undefined), 'stroke-width':weight === undefined ? 1.3 : .6 + Math.min(1,Math.abs(weight) / weightMax) * 2.8});
    edges.append(path);
  };
  const weightMax = Math.max(...model.layers.flatMap(l => l.weights.flat().map(Math.abs)), .000001);
  model.filters.forEach((_, f) => addEdge(0,0,1,f));
  for(let i=0;i<columns[2];i++) addEdge(1,i % model.filters.length,2,i);
  model.layers.forEach((layer,l) => layer.weights.forEach((weights,n) => weights.forEach((weight,j) => addEdge(l+2,j,l+3,n,weight))));
  svg.append(edges);
  columns.forEach((count,c) => {
    const values = c === 2 ? packet?.trace.features : c >= 3 ? packet?.trace.layers[c-3].outputs : [];
    const maximum = c === 3 || c === 4 ? 1 : Math.max(...(values || []).map(Math.abs),.000001);
    for(let i=0;i<count;i++) {
      const x=xs[c], y=ys(c,i), value=networkValue(c,i);
      const group=graphElement('g', {class:'graph-node',role:'button',tabindex:'0','aria-label':`${networkName(c,i)}${value === null ? '' : `, activation ${exact(value)}`}`, 'data-key':`${c}:${i}`, 'data-stage':c});
      const width=c===0?104:c===1?96:36, height=c===0?90:c===1?68:24;
      group.append(graphElement('rect',{x:x-width/2,y:y-height/2,width,height,rx:c<2?4:7,fill:value === null?'#f7f8f4':color(value,maximum),class:'graph-node-shape'}));
      if(c < 2) {
        const signal = c===0 ? packet ? waveformBuckets(packet.trace.samples) : [] : model.filters[i].coefficients;
        const peak = Math.max(...signal.map(Math.abs),.000001);
        group.append(graphElement('line',{x1:x-width/2+7,x2:x+width/2-7,y1:y,y2:y,stroke:'#cad4cf'}));
        if(signal.length) group.append(graphElement('path',{d:signal.map((v,j)=>`${j?'L':'M'}${x-width/2+7+j/(signal.length-1)*(width-14)},${y-v/peak*19}`).join(' '),fill:'none',stroke:c===0?'#597e75':'#6392b3','stroke-width':1.3}));
        group.append(graphElement('text',{x,y:y+height/2+19,'text-anchor':'middle',class:'graph-label'}, c===0 ? packet?'1 second':'Load a sound' : `Filter ${i+1}`));
      } else {
        group.append(graphElement('text',{x,y:y+4,'text-anchor':'middle',class:'graph-number'},i+1));
        if(c===2) group.append(graphElement('text',{x:x-25,y:y+4,'text-anchor':'end',class:'graph-feature-label'},networkName(c,i)));
        if(c===5) {
          group.append(graphElement('text',{x:x+26,y:y+4,class:'graph-label'},model.labels[i]));
          if(packet) group.append(graphElement('text',{x,y:y+35,'text-anchor':'middle',class:'graph-score'},`${(packet.probabilities[model.labels[i]]*100).toFixed(1)}%`));
        }
      }
      group.append(graphElement('title',{},`${networkName(c,i)}${value===null?'':`: ${exact(value)}`}`));
      const select = () => { stopNetwork(); networkSelection={column:c,index:i}; $('#network-step').value=5; updateNetworkFocus(); renderNetworkInspector(); };
      group.addEventListener('click', select);
      group.addEventListener('keydown',event=>{ if(event.key==='Enter'||event.key===' ') {event.preventDefault();select();} });
      svg.append(group);
    }
  });
  host.append(svg);
  $('#network-play').disabled = !packet || busy;
  $('#network-step').disabled = !packet || busy;
  $('#network-step').value = 5;
  $('#network-mode').textContent = packet ? 'Values from this recording · tanh scale −1 to +1; other columns scaled separately.' : 'Weights visible · load a sound for activations.';
  updateNetworkFocus(); renderNetworkInspector();
}
function updateNetworkFocus() {
  const key = `${networkSelection.column}:${networkSelection.index}`;
  const all = $('#all-connections').checked, stage = Number($('#network-step').value);
  document.querySelectorAll('.graph-node').forEach(node=>{
    const selected=node.dataset.key===key;
    node.classList.toggle('selected',selected);node.setAttribute('aria-pressed',String(selected));
    node.style.opacity=Number(node.dataset.stage)>stage?'.16':'1';
  });
  document.querySelectorAll('.graph-edge').forEach(edge=>{
    const selected=edge.dataset.source===key||edge.dataset.target===key;
    const revealed=Number(edge.dataset.stage)<=stage;
    edge.style.opacity=!revealed?'.025':selected?'.85':edge.dataset.dense==='true'?(all?'.18':'.035'):'.3';
    edge.classList.toggle('signal-moving',networkTimer!==null && revealed && Number(edge.dataset.stage)===stage);
  });
  $('#network-step-label').textContent = stage===5 && networkTimer===null ? 'Full network · select a node' : networkStages[stage];
}
function renderNetworkInspector() {
  const {column:c,index:i}=networkSelection;
  const box=$('#network-inspector');box.replaceChildren();
  const summary=el('div',undefined,'inspector-summary');
  summary.append(el('p','SELECTED / '+networkName(c,i),'eyebrow'));
  box.append(summary);
  if(c===0) {
    summary.append(el('h3','One second, 16,000 samples.'),el('p','The same waveform feeds all four filters. Each filter looks at a 101-sample window, then advances 64 samples.'));
    return;
  }
  if(c===1) {
    const f=model.filters[i];
    summary.append(el('h3',`Filter ${i+1} · a learned sound pattern`),el('p',`101 coefficients multiply 101 input samples. Their sum produces one response. Peak frequency gain: ${fmt(f.peak_hz)} Hz. Each of the four time segments supplies one feature to the network.`));
    const button=el('button','Inspect this filter ↓','lab-button');
    button.addEventListener('click',()=>{filterIndex=i;renderModel();if(packet)renderWindow();$('#filters-title').scrollIntoView({block:'start',behavior:'smooth'});});box.append(button);return;
  }
  if(c===2) {
    summary.append(el('h3',`Feature ${i+1} · ${networkName(c,i)}`));
    summary.append(el('p',packet?`Mean squared response ${exact(packet.trace.pooled[i])} × 1,000 = ${exact(packet.trace.features[i])}. This value goes to every neuron in hidden layer 1.`:'This feature is the average squared filter response in one time segment, multiplied by 1,000. Load a sound to see its value.'));
    return;
  }
  const layer=model.layers[c-3], recorded=packet?.trace.layers[c-3];
  summary.append(el('h3',`${layer.weights[i].length} inputs. One ${layer.activation==='tanh'?'activation':'logit'}.`));
  summary.append(el('p',recorded?`Weighted sum + bias = ${exact(recorded.preactivation[i])} → ${layer.activation} → ${exact(recorded.outputs[i])}`:`Each input is multiplied by its weight, then summed with bias ${exact(layer.biases[i])}. Activation: ${layer.activation}. Load a sound to see contributions.`));
  const detail=el('details',undefined,'contribution-details');detail.append(el('summary','Inspect incoming weights & contributions'));
  const wrap=el('div',undefined,'table-scroll'), table=el('table'), head=el('thead'), header=el('tr');
  ['Input','Value','Weight','Contribution (input × weight)'].forEach(t=>header.append(el('th',t)));head.append(header);table.append(head);
  const body=el('tbody');
  layer.weights[i].forEach((w,j)=>{const row=el('tr');row.append(el('td',networkName(c-1,j)),el('td',recorded?exact(recorded.inputs[j]):'—'),el('td',exact(w)),el('td',recorded?exact(recorded.inputs[j]*w):'—'));body.append(row);});
  const bias=el('tr');bias.append(el('td','Bias'),el('td','1'),el('td',exact(layer.biases[i])),el('td',exact(layer.biases[i])));body.append(bias);table.append(body);wrap.append(table);detail.append(wrap);box.append(detail);
}
$('#all-connections').addEventListener('change',updateNetworkFocus);
$('#network-step').addEventListener('input',()=>{stopNetwork();updateNetworkFocus();});
$('#network-play').addEventListener('click',()=>{
  if(networkTimer!==null){stopNetwork();updateNetworkFocus();return;}
  if(!packet||busy)return;
  $('#network-step').value=0;
  $('#network-play').textContent='Ⅱ Pause walkthrough';$('#network-play').setAttribute('aria-pressed','true');
  networkTimer=setInterval(()=>{
    const step=Number($('#network-step').value)+1;$('#network-step').value=step;
    if(step>=5)stopNetwork();updateNetworkFocus();
  },1100);
  updateNetworkFocus();
});
document.addEventListener('visibilitychange',()=>{if(document.hidden){stopNetwork();if(model)updateNetworkFocus();}});

function renderModel() {
  $('#lab-content').hidden = false;
  $('#checkpoint').textContent = `Checkpoint ${model.checkpoint}${packet ? ' · used for this trace' : ' · latest saved weights'}`;
  $('#parameter-count').textContent = `${model.parameter_count.toLocaleString()} learned parameters`;
  const count = Math.floor((16000 - model.filters[0].coefficients.length) / model.stride) + 1;
  $('#pipeline').replaceChildren();
  const stages = [['16,000 samples', 'Mono audio · 16 kHz · one second'],
    [`${model.filters.length} × ${count} responses`, `${model.filters[0].coefficients.length}-tap filters · stride ${model.stride}`],
    ['16 features', '4 time segments × 4 filters · energy × 1000'],
    ['16 → 16 → 3', 'Two tanh layers → linear logits'], ['3 scores', 'Softmax → Meow / Woof / Moo']];
  for (const [title, note] of stages) { const li = el('li'); li.append(el('strong', title), el('span', note)); $('#pipeline').append(li); }
  $('#filter-picker').replaceChildren();
  const coeffMax = Math.max(...model.filters.flatMap(f => f.coefficients.map(Math.abs)), .000001);
  model.filters.forEach((filter, i) => {
    const button = el('button', undefined, 'filter-choice'); button.setAttribute('aria-pressed', String(i === filterIndex));
    button.append(el('span', `Filter ${i + 1}`));
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.classList.add('mini'); svg.setAttribute('viewBox', '0 0 200 42'); svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', filter.coefficients.map((v, j) => `${j ? 'L' : 'M'}${j / (filter.coefficients.length - 1) * 200},${21 - v / coeffMax * 19}`).join(' '));
    path.setAttribute('fill', 'none'); path.setAttribute('stroke', ['#a25068','#8161aa','#b36b25','#477899'][i]); path.setAttribute('stroke-width', '1.3'); svg.append(path);
    button.append(svg, el('small', `Peak gain near ${(filter.peak_hz / 1000).toFixed(2)} kHz`));
    button.addEventListener('click', () => { filterIndex = i; renderModel(); if (packet) renderWindow(); });
    $('#filter-picker').append(button);
  });
  const filter = model.filters[filterIndex];
  $('#trace-filter').value = filterIndex;
  $('#kernel-title').textContent = `Filter ${filterIndex + 1} · learned coefficients`;
  plot($('#kernel-chart'), filter.coefficients, {xLabel: 'Lag (samples; 0 = newest)', yLabel: 'Coefficient', min: -coeffMax, max: coeffMax});
  const gainMax = Math.max(...model.filters.flatMap(f => f.gain), .000001);
  plot($('#frequency-chart'), filter.gain, {xLabel: 'Frequency (Hz)', yLabel: 'Magnitude gain', xEnd: 8000, min: 0, max: gainMax});
  $('#filter-stats').replaceChildren();
  for (const [name, value] of [['L2 norm', fmt(filter.l2)], ['DC gain', fmt(filter.dc_gain)], ['Window', `${(filter.coefficients.length / model.sample_rate * 1000).toFixed(3)} ms`], ['Plot scales', 'shared across filters']]) {
    const item = el('span', `${name}: `); item.append(el('strong', value)); $('#filter-stats').append(item);
  }
  $('#coefficient-rows').replaceChildren();
  filter.coefficients.forEach((value, i) => { const tr = el('tr'); tr.append(el('td', i), el('td', filter.parameter_offset + i), el('td', exact(value))); $('#coefficient-rows').append(tr); });
  $('#layer').replaceChildren();
  model.layers.forEach((layer, i) => { const option = el('option', `Layer ${i + 1} · ${layer.weights[0].length} → ${layer.weights.length} · ${layer.activation}`); option.value = i; $('#layer').append(option); });
  $('#layer').value = layerIndex;
  renderWeights();
  renderNetwork();
}

function renderWeights() {
  const layer = model.layers[layerIndex], inputCount = layer.weights[0].length;
  const maximum = Math.max(...layer.weights.flat().map(Math.abs), ...layer.biases.map(Math.abs), .000001);
  const table = $('#weights-table'); table.replaceChildren();
  const head = el('thead'), header = el('tr'); header.append(el('th', 'Neuron ↓ / input →'));
  for (let j = 0; j < inputCount; j++) header.append(el('th', j));
  header.append(el('th', 'Bias')); head.append(header); table.append(head);
  const body = el('tbody');
  layer.weights.forEach((weights, i) => {
    const tr = el('tr'); tr.append(el('th', layerIndex === model.layers.length - 1 ? model.labels[i] : i));
    [...weights, layer.biases[i]].forEach((value, j) => {
      const cell = el('td'), button = el('button', value.toFixed(2));
      const name = j === inputCount ? 'bias' : `input ${j}`;
      button.title = `Neuron ${i}, ${name}: ${exact(value)}`; button.setAttribute('aria-label', button.title);
      button.style.background = color(value, maximum);
      button.addEventListener('click', () => {
        const index = layer.parameter_offset + i * (inputCount + 1) + j;
        let message = `Layer ${layerIndex + 1}, neuron ${i}, ${name} = ${exact(value)} · checkpoint weights[${index}]`;
        if (packet) {
          const trace = packet.trace.layers[layerIndex];
          message += j === inputCount ? ` · bias contributes ${fmt(value)}` : ` · input ${fmt(trace.inputs[j])} × weight = ${fmt(trace.inputs[j] * value)}`;
          message += ` · total before activation ${fmt(trace.preactivation[i])} → ${layer.activation} → ${fmt(trace.outputs[i])}`;
        }
        $('#weight-detail').textContent = message;
      });
      cell.append(button); tr.append(cell);
    }); body.append(tr);
  }); table.append(body);
  $('#weight-detail').textContent = 'Select a weight to see its full value and checkpoint index.';
}

function waveformBuckets(samples) {
  const result = [];
  for (let i = 0; i < samples.length; i += 20) {
    const chunk = samples.slice(i, i + 20); result.push(Math.min(...chunk), Math.max(...chunk));
  }
  return result;
}
function selectResponse(filter, step) {
  stopScan();
  filterIndex = filter;
  $('#window').value = step;
  renderModel(); renderWindow();
}
function renderResponseMap() {
  const responses = packet.trace.responses;
  const limit = Math.max(...responses.flat().map(Math.abs), .000001);
  $('#response-map').replaceChildren();
  responses.forEach((values, f) => {
    const row = el('div', undefined, 'response-map-row');
    row.append(el('span', `Filter ${f + 1}`));
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${values.length} 24`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('role', 'slider'); svg.setAttribute('tabindex', '0');
    svg.setAttribute('aria-label', `Filter ${f + 1} response step`);
    svg.setAttribute('aria-valuemin', '1'); svg.setAttribute('aria-valuemax', values.length);
    values.forEach((value, i) => {
      const rect = document.createElementNS(svg.namespaceURI, 'rect');
      rect.setAttribute('x', i); rect.setAttribute('width', '1'); rect.setAttribute('height', '24');
      rect.setAttribute('fill', color(value, limit)); svg.append(rect);
    });
    const marker = document.createElementNS(svg.namespaceURI, 'rect');
    marker.classList.add('response-marker'); marker.setAttribute('width', '1');
    marker.setAttribute('height', '24'); marker.setAttribute('fill', '#44392f'); svg.append(marker);
    svg.addEventListener('click', event => {
      const bounds = svg.getBoundingClientRect();
      const step = Math.max(0, Math.min(values.length - 1, Math.floor((event.clientX - bounds.left) / bounds.width * values.length)));
      selectResponse(f, step);
    });
    svg.addEventListener('keydown', event => {
      let step = Number($('#window').value);
      if (event.key === 'ArrowRight' || event.key === 'ArrowUp') step++;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') step--;
      else if (event.key === 'Home') step = 0;
      else if (event.key === 'End') step = values.length - 1;
      else return;
      event.preventDefault(); selectResponse(f, Math.max(0, Math.min(values.length - 1, step)));
    });
    const peak = values.reduce((best, value, i) => Math.abs(value) > Math.abs(values[best]) ? i : best, 0);
    const jump = el('button', 'Strongest response ↗', 'lab-button');
    jump.setAttribute('aria-label', `Inspect filter ${f + 1} strongest response`);
    jump.addEventListener('click', () => selectResponse(f, peak));
    row.append(svg, jump); $('#response-map').append(row);
  });
  $('#response-scale').textContent = `Shared color scale: −${fmt(limit)} to +${fmt(limit)}. Left → right follows time. Arrow keys move one step; Home / End jump to the edges. A strong response can still be suppressed or combined by later layers.`;
}
function renderWindow() {
  if (!packet) return;
  const trace = packet.trace, index = Number($('#window').value);
  $('#trace-filter').value = filterIndex;
  const selected = model.filters[filterIndex];
  $('#filter-explanation').textContent = `Filter ${filterIndex + 1} has its largest frequency gain near ${(selected.peak_hz / 1000).toFixed(2)} kHz. Slide through the blue sound waveform to see its amber response. A large response means a strong signed match to this learned pattern, not recognition of a particular animal.`;
  const end = trace.response_sample_indices[index], coefficients = model.filters[filterIndex].coefficients;
  const start = end - coefficients.length + 1;
  document.querySelectorAll('#response-map svg').forEach((svg, f) => {
    svg.querySelector('.response-marker').setAttribute('x', index);
    svg.setAttribute('aria-valuenow', index + 1);
    svg.setAttribute('aria-valuetext', `Step ${index + 1}, ${(end / 16).toFixed(2)} ms, response ${fmt(trace.responses[f][index])}`);
  });
  $('#window-label').textContent = `Step ${index + 1}/${trace.responses[0].length} · ${(start / 16).toFixed(2)}–${(end / 16).toFixed(2)} ms`;
  const wave = waveformBuckets(trace.samples);
  plot($('#input-chart'), wave, {xLabel: 'Time (ms)', yLabel: 'Amplitude', xEnd: 1000, band: [start / 16000 * (wave.length - 1), end / 16000 * (wave.length - 1)]});
  const windowSamples = coefficients.map((_, j) => trace.samples[end - j]);
  const products = coefficients.map((value, j) => value * windowSamples[j]);
  plot($('#window-chart'), windowSamples, {xLabel: 'Lag (samples; 0 = newest)', yLabel: 'Amplitude'});
  plot($('#product-chart'), products, {xLabel: 'Coefficient index', yLabel: 'Weighted contribution', bars: true});
  $('#dot-product').textContent = `Add all ${products.length} products → ${exact(trace.responses[filterIndex][index])}. This is the actual response recorded from the filter.`;
  const limit = Math.max(...trace.responses.flat().map(Math.abs), .000001);
  plot($('#response-chart'), trace.responses[filterIndex], {xLabel: 'Window end time (ms)', yLabel: 'Response', xStart: trace.response_sample_indices[0] / 16, xEnd: trace.response_sample_indices.at(-1) / 16, min: -limit, max: limit, marker: index});
  $('#response-title').textContent = `Filter ${filterIndex + 1} · ${trace.responses[filterIndex].length} responses`;
  $('#response-note').textContent = `The window advances ${model.stride} samples (${model.stride / 16} ms) each step. All filters share the same response scale. ${index >= trace.pooling.used_responses ? 'This last response is discarded by the current pooling code.' : `This response belongs to time segment ${Math.floor(index / trace.pooling.responses_per_segment) + 1}.`}`;
}

function showTrace(result, source) {
  if (!result.trace?.model || result.trace.samples?.length !== 16000) throw new Error('This recording has no valid analysis. Record another sound.');
  stopScan();
  packet = result; model = result.trace.model;
  renderModel();
  $('#trace-empty').hidden = true; $('#trace-content').hidden = false;
  $('#trace-source').textContent = `${source} · checkpoint ${model.checkpoint}`;
  $('#window').max = result.trace.responses[0].length - 1; $('#window').value = 0;
  renderResponseMap();
  renderWindow();
  const trace = result.trace, pooling = trace.pooling;
  $('#pool-note').textContent = `Each filter’s responses are split into ${pooling.segments} equal groups of ${pooling.responses_per_segment}. That uses ${pooling.used_responses} responses and leaves ${pooling.discarded_responses} at the end unused. The 16 features are ordered by segment, then filter.`;
  const grid = $('#feature-grid'); grid.replaceChildren(el('span', ''));
  model.filters.forEach((_, i) => grid.append(el('span', `F${i + 1}`)));
  const max = Math.max(...trace.features, .000001);
  for (let segment = 0; segment < pooling.segments; segment++) {
    grid.append(el('span', `Segment ${segment + 1}`));
    model.filters.forEach((_, f) => {
      const i = segment * model.filters.length + f;
      const button = el('button', fmt(trace.features[i])); button.style.background = color(trace.features[i], max);
      button.title = `Feature ${i}: segment ${segment + 1}, filter ${f + 1}`;
      button.addEventListener('click', () => { $('#feature-detail').textContent = `MLP input[${i}] · S${segment + 1}/F${f + 1} · mean square ${exact(trace.pooled[i])} → scaled feature ${exact(trace.features[i])}`; });
      grid.append(button);
    });
  }
  $('#feature-detail').textContent = 'Select a feature for its exact value.';
  $('#activations').replaceChildren();
  trace.layers.forEach((layer, i) => {
    const card = el('div', undefined, 'activation-card'); card.append(el('h4', `Layer ${i + 1} · ${model.layers[i].activation}`));
    const cells = el('div', undefined, 'neuron-values');
    const max = model.layers[i].activation === 'tanh' ? 1 : Math.max(...layer.outputs.map(Math.abs), .000001);
    layer.outputs.forEach((value, j) => { const cell = el('span', value.toFixed(3)); cell.title = `Neuron ${j}: ${exact(value)}`; cell.style.background = color(value, max); cells.append(cell); });
    card.append(cells, el('p', model.layers[i].activation === 'tanh' ? `${layer.outputs.filter(x => Math.abs(x) > .99).length}/${layer.outputs.length} outputs have |value| > 0.99 (near tanh saturation).` : 'Raw logits, before softmax. Colors are relative to this layer.'));
    $('#activations').append(card);
  });
  $('#prediction-label').textContent = `${result.label} · ${(result.probabilities[result.label] * 100).toFixed(1)}%`;
  $('#prediction-scores').replaceChildren();
  model.labels.forEach(label => {
    const row = el('div', undefined, 'prediction-row'), track = el('div', undefined, 'prediction-track'), fill = el('div');
    const value = result.probabilities[label] * 100; fill.style.width = `${value}%`; track.append(fill);
    row.append(el('span', label), track, el('span', `${value.toFixed(1)}%`)); $('#prediction-scores').append(row);
  });
  showLabView('trace');
  status('');
}

async function request(url, options) {
  const response = await fetch(url, {...options, signal: AbortSignal.timeout(30000)});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Unable to load the model.');
  return result;
}
function fail(error) { status(error.name === 'TimeoutError' ? 'Analysis timed out. Try again when the model is available.' : error.message, true); }
async function refresh() {
  if (busy) return; setBusy(true); status('Reading saved checkpoint…');
  try {
    const data = await request('/api/model'); model = data.model; packet = null; $('#audio-source').textContent = lastRecording ? 'Your latest sound is ready.' : 'Record one second with Miso to begin.';
    $('#trace-content').hidden = true; $('#trace-empty').hidden = false;
    renderModel(); status('');
  } catch (error) { fail(error); } finally { setBusy(false); }
}
$('#refresh').addEventListener('click', refresh);
$('#layer').addEventListener('change', () => { layerIndex = Number($('#layer').value); renderWeights(); });
$('#window').addEventListener('input', () => { stopScan(); renderWindow(); });
$('#scan-play').addEventListener('click', () => {
  if (scanTimer !== null) { stopScan(); return; }
  if (!packet || busy) return;
  const slider = $('#window');
  if (Number(slider.value) >= Number(slider.max)) slider.value = 0;
  renderWindow();
  $('#scan-play').textContent = 'Pause filter scan';
  $('#scan-play').setAttribute('aria-pressed', 'true');
  scanTimer = setInterval(() => {
    slider.value = Number(slider.value) + 1;
    renderWindow();
    if (Number(slider.value) >= Number(slider.max)) stopScan();
  }, 100);
});
document.addEventListener('visibilitychange', () => { if (document.hidden) stopScan(); });
$('#last-recording').addEventListener('click', () => { try { showTrace(lastRecording, 'Last microphone recording'); $('#audio-source').textContent = 'Latest microphone recording'; } catch (error) { fail(error); } });
$('#clear-trace').addEventListener('click', () => {
  try { sessionStorage.removeItem(STORAGE); } catch {}
  lastRecording = null; packet = null; $('#trace-content').hidden = true; $('#trace-empty').hidden = false;
  refresh();
});
try { lastRecording = JSON.parse(sessionStorage.getItem(STORAGE)); if (!lastRecording?.trace?.model) lastRecording = null; } catch { lastRecording = null; }
setupFocusedLab();
await refresh();
if (lastRecording && new URLSearchParams(location.search).get('source') === 'last') {
  try { showTrace(lastRecording, 'Last microphone recording'); $('#audio-source').textContent = 'Latest microphone recording'; } catch (error) { fail(error); }
}


function showLabView(name) {
  stopScan(); stopNetwork();
  document.querySelectorAll('[data-lab-view]').forEach(panel => panel.hidden = panel.dataset.labView !== name);
  document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === name)));
}
function setupFocusedLab() {
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => showLabView(button.dataset.view)));
  document.addEventListener('click', event => {
    if (event.target.closest('a[href="#filters-title"]')) showLabView('filters');
  });
  const kernel = $('#kernel-chart').closest('article'), frequency = $('#frequency-chart').closest('article');
  frequency.hidden = true;
  document.querySelectorAll('[data-filter-plot]').forEach(button => button.addEventListener('click', () => {
    kernel.hidden = button.dataset.filterPlot !== 'kernel-chart'; frequency.hidden = !kernel.hidden;
    document.querySelectorAll('[data-filter-plot]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  }));
  // Move existing plots into focused steps; every plot still reads the same trace.
  const groups = [
    [$('#input-chart').closest('article'), $('.response-card'), $('.response-overview')],
    [$('#window-chart').closest('.chart-grid')],
    [$('.pool-layout')],
    [$('.activation-section'), $('.prediction-box')]
  ];
  const controls = document.createElement('div'); controls.className = 'shared-scan';
  controls.append($('.scan-controls'), $('.window-control'));
  $('#filter-explanation').after(controls);
  const panels = groups.map((nodes, i) => {
    const panel = document.createElement('div'); panel.className = 'trace-step-panel'; panel.hidden = i !== 0;
    panel.append(...nodes); $('#trace-content').append(panel); return panel;
  });
  document.querySelectorAll('[data-step]').forEach(button => button.addEventListener('click', () => {
    stopScan(); const step = Number(button.dataset.step);
    panels.forEach((panel,i) => panel.hidden = i !== step);
    controls.hidden = step > 1;
    $('.trace-filter-control').hidden = step > 1; $('#filter-explanation').hidden = step > 1;
    document.querySelectorAll('[data-step]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  }));
  $('#trace-filter').addEventListener('change', () => { stopScan(); filterIndex = Number($('#trace-filter').value); renderModel(); renderWindow(); });
  $('#strongest').addEventListener('click', () => {
    if (!packet) return;
    const values = packet.trace.responses[filterIndex];
    selectResponse(filterIndex, values.reduce((best,v,i) => Math.abs(v) > Math.abs(values[best]) ? i : best, 0));
  });
}
