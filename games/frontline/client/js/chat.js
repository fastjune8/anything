// 채팅 입력창과 메시지 표시
// 채팅창이 열려 있는 동안 inp.chatOpen 이 true → input.js 의 isActive() 가 false → 이동/사격 입력이 꺼진다.
import { inp, net } from './state.js';
import { $ } from './util.js';

const chatEl = $('chat'), chatIn = $('chatIn'), chatLog = $('chatLog');

export function openChat() {
  inp.chatOpen = true; inp.keys.clear(); inp.fireHeld = inp.adsHeld = inp.fireFresh = false;
  chatEl.classList.add('open'); chatIn.value = ''; chatIn.focus();
}
export function closeChat() { inp.chatOpen = false; chatEl.classList.remove('open'); chatIn.blur(); }

function sendChat() {
  const text = chatIn.value.trim();
  if (text) net.send({ t: 'chat', text });
  closeChat();
}

export function addChatLine(name, text, mine) {
  // textContent 계열만 사용해서 HTML 이 주입될 수 없게 한다
  const line = document.createElement('div'), who = document.createElement('b');
  who.textContent = name; if (mine) who.className = 'me';
  line.append(who, document.createTextNode(` ${text}`));
  chatLog.append(line);
  while (chatLog.children.length > 8) chatLog.firstChild.remove();
  setTimeout(() => line.remove(), 10500);
}

chatIn.addEventListener('keydown', e => {
  e.stopPropagation(); // 게임 단축키로 전달되지 않게
  if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); sendChat(); } // 한글 조합 중 Enter 는 제외
  else if (e.key === 'Escape') closeChat();
});
