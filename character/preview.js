const character = document.querySelector('#character');
const poses = {
  idle: ['what am I again?', 'Idle · a little confused'],
  dog: ['oh! definitely a dog.', 'Woof · tail wag'],
  cat: ['one moment. bath time.', 'Meow · paw up, lick, lick'],
  cow: ['I brought refreshments.', 'Moo · a glass of milk'],
};

function setCharacterState(state) {
  if (!Object.hasOwn(poses, state)) throw new Error(`Unknown character state: ${state}`);
  character.dataset.state = state;
  document.querySelector('#bubble').textContent = poses[state][0];
  document.querySelector('#motion-label').textContent = poses[state][1];
  document.querySelectorAll('[data-pose]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.pose === state));
  });
}

document.querySelectorAll('[data-pose]').forEach(button => {
  button.addEventListener('click', () => setCharacterState(button.dataset.pose));
});
document.querySelector('#pause').addEventListener('click', event => {
  const paused = character.classList.toggle('paused');
  event.currentTarget.setAttribute('aria-pressed', String(paused));
  event.currentTarget.textContent = paused ? 'Resume motion' : 'Pause motion';
});

// Matches train.py's label order. Call only after a future model integration.
window.characterPreview = {
  setState: setCharacterState,
  reactToLabel(label) {
    const state = { Meow: 'cat', Woof: 'dog', Moo: 'cow' }[label];
    if (!state) throw new Error(`Unknown model label: ${label}`);
    setCharacterState(state);
  },
};

fetch('creature.svg', { cache: 'no-store' })
  .then(response => {
    if (!response.ok) throw new Error(`SVG could not load (${response.status})`);
    return response.text();
  })
  .then(svg => { character.innerHTML = svg; })
  .catch(error => {
    character.textContent = 'Preview needs a local server. See character/README.md.';
    console.error(error);
  });
