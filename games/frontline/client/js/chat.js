// 경기 중 채팅 입력/표시 (방 전체). 로비·파티 채팅은 lobby.js.
// 채팅창이 열려 있는 동안 inp.chatOpen 이 true → 이동·사격 입력이 꺼진다.
import { inp, net } from './state.js';
import { $ } from './util.js';

const MAX_LINES = 40;
const chatEl = $('chat'), chatIn = $('chatIn'), chatLog = $('chatLog');

export function openChat() {
  inp.chatOpen = true; inp.keys.clear(); inp.fireHeld = inp.adsHeld = false;
  chatEl.classList.add('open'); chatIn.value = ''; chatIn.focus();
}
export function clearChat() { chatLog.replaceChildren(); }
export function closeChat() { inp.chatOpen = false; chatEl.classList.remove('open'); chatIn.blur(); }
function sendChat() {
  const text = chatIn.value.trim();
  if (text) net.send({ t: 'chat', ch: 'room', text });
  closeChat();
}
export function addChatLine(name, text, mine) {
  const line = document.createElement('div'), who = document.createElement('b');
  who.textContent = name; if (mine) who.className = 'me';
  line.append(who, document.createTextNode(` ${text}`));
  chatLog.append(line);
  while (chatLog.children.length > MAX_LINES) chatLog.firstChild.remove();
}
chatIn.addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); sendChat(); }
  else if (e.key === 'Escape') closeChat();
});
