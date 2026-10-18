// WaveChat Frontend Application
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

// State
let token = localStorage.getItem('wc_token');
let me = JSON.parse(localStorage.getItem('wc_user') || 'null');
let socket = null;
let chats = []; // {id, kind, name, username, initial, color, members, messages, unread}
let currentChat = null;
let filter = 'all';
let onlineUsers = new Set();

// API helper
async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(path, { ...options, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

// Toast
function toast(msg) {
  const n = $('#notice');
  n.textContent = msg;
  n.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => n.classList.remove('show'), 3000);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function initials(name) {
  return name ? name[0].toUpperCase() : '?';
}

// ===== Auth =====
async function login(username, password) {
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    token = data.token;
    me = data.user;
    localStorage.setItem('wc_token', token);
    localStorage.setItem('wc_user', JSON.stringify(me));
    enterChat();
  } catch (e) {
    $('#loginError').textContent = e.message;
    $('#loginError').classList.add('show');
  }
}

async function register(username, displayName, password) {
  try {
    const data = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, display_name: displayName, password })
    });
    token = data.token;
    me = data.user;
    localStorage.setItem('wc_token', token);
    localStorage.setItem('wc_user', JSON.stringify(me));
    enterChat();
  } catch (e) {
    $('#regError').textContent = e.message;
    $('#regError').classList.add('show');
  }
}

function logout() {
  if (socket) socket.disconnect();
  token = null; me = null; chats = []; currentChat = null;
  localStorage.removeItem('wc_token');
  localStorage.removeItem('wc_user');
  $('#chatApp').style.display = 'none';
  $('#authPage').style.display = 'flex';
}

// ===== Socket.io =====
function connectSocket() {
  if (socket) socket.disconnect();
  socket = io({ auth: { token }, transports: ['websocket', 'polling'] });

  socket.on('connect', () => console.log('[Socket] Connected'));
  socket.on('connect_error', (e) => console.error('[Socket] Error:', e.message));

  socket.on('new_direct_message', (msg) => {
    handleIncomingMessage('direct', msg);
  });

  socket.on('new_group_message', (msg) => {
    handleIncomingMessage('group', msg);
  });

  socket.on('user_typing', ({ username, chat_type, target_id }) => {
    if (currentChat && currentChat.kind === chat_type) {
      if ((chat_type === 'direct' && currentChat.otherId === target_id) ||
          (chat_type === 'group' && currentChat.id === `g${target_id}`)) {
        $('#typingIndicator').textContent = `${username} 正在输入…`;
        clearTimeout($('#typingIndicator').t);
        $('#typingIndicator').t = setTimeout(() => { $('#typingIndicator').textContent = ''; }, 2000);
      }
    }
  });

  socket.on('friend_request_received', () => {
    loadRequests();
    toast('收到新的好友申请');
  });

  socket.on('group_invited', ({ group_id }) => {
    loadChats();
    toast('你被邀请加入了一个群聊');
  });

  socket.on('user_online', ({ userId, online }) => {
    if (online) onlineUsers.add(userId);
    else onlineUsers.delete(userId);
    renderList();
  });
}

function handleIncomingMessage(kind, msg) {
  let chatId;
  if (kind === 'direct') {
    const otherId = msg.sender_id === me.id ? msg.receiver_id : msg.sender_id;
    chatId = `d${otherId}`;
  } else {
    chatId = `g${msg.group_id}`;
  }

  let chat = chats.find(c => c.id === chatId);
  if (!chat) {
    // Create chat entry if not in list
    if (kind === 'direct') {
      const otherId = msg.sender_id === me.id ? msg.receiver_id : msg.sender_id;
      chat = {
        id: chatId, kind: 'direct', otherId,
        name: msg.display_name, username: msg.username,
        initial: initials(msg.display_name), color: msg.avatar_color,
        messages: [], unread: 0
      };
    } else {
      chat = { id: chatId, kind: 'group', group_id: msg.group_id, name: '群聊', initial: '👥', color: '#36a89b', messages: [], unread: 0 };
    }
    chats.unshift(chat);
  }

  chat.messages.push(msg);
  if (currentChat?.id !== chatId) {
    chat.unread = (chat.unread || 0) + 1;
  }
  // Move to top
  chats = chats.filter(c => c.id !== chatId);
  chats.unshift(chat);

  if (currentChat?.id === chatId) {
    renderMessages();
  }
  renderList();
}

// ===== Load Data =====
async function loadChats() {
  try {
    const [friendsData, groupsData] = await Promise.all([
      api('/api/friends'),
      api('/api/groups')
    ]);

    const newChats = [];

    // Direct chats from friends
    for (const f of friendsData.friends) {
      const chatId = `d${f.id}`;
      const existing = chats.find(c => c.id === chatId);
      newChats.push({
        id: chatId, kind: 'direct', otherId: f.id,
        name: f.display_name, username: f.username,
        initial: initials(f.display_name), color: f.avatar_color,
        messages: existing?.messages || [],
        unread: existing?.unread || 0,
        online: onlineUsers.has(f.id)
      });
    }

    // Group chats
    for (const g of groupsData.groups) {
      const chatId = `g${g.id}`;
      const existing = chats.find(c => c.id === chatId);
      newChats.push({
        id: chatId, kind: 'group', group_id: g.id,
        name: g.name, initial: g.name[0] || '👥', color: g.avatar_color,
        member_count: g.member_count,
        messages: existing?.messages || [],
        unread: existing?.unread || 0
      });
    }

    chats = newChats;
    renderList();
  } catch (e) {
    console.error('Load chats error:', e);
  }
}

async function loadRequests() {
  try {
    const data = await api('/api/friends/requests');
    const count = data.received.length;
    const badge = $('#requestBadge');
    if (count > 0) {
      badge.textContent = count;
      badge.style.display = 'inline';
    } else {
      badge.style.display = 'none';
    }
    if (filter === 'requests') renderList();
  } catch (e) { console.error(e); }
}

// ===== Render =====
function renderList() {
  const list = $('#list');
  const q = $('#search').value.toLowerCase();
  list.innerHTML = '';

  if (filter === 'requests') {
    renderRequestsList(list);
    return;
  }

  const filtered = chats.filter(c => {
    if (filter !== 'all' && filter !== c.kind) return false;
    if (q && !(c.name + ' ' + (c.username || '')).toLowerCase().includes(q)) return false;
    return true;
  });

  if (filtered.length === 0) {
    list.innerHTML = '<div style="padding:30px;text-align:center;color:var(--muted);font-size:13px">暂无聊天</div>';
    return;
  }

  for (const c of filtered) {
    const lastMsg = c.messages[c.messages.length - 1];
    const btn = document.createElement('button');
    btn.className = 'item' + (currentChat?.id === c.id ? ' active' : '');
    btn.innerHTML = `
      <div class="avatar ${c.online ? 'online' : ''}" style="background:${c.color}">${esc(c.initial)}</div>
      <div class="itembody">
        <div class="topline">
          <span class="itemname">${esc(c.name)}</span>
          <span class="small">${c.kind === 'group' ? `群聊·${c.member_count || ''}人` : '@' + esc(c.username)}</span>
        </div>
        <div class="preview">${esc(lastMsg?.content || '还没有消息')}</div>
      </div>
      ${c.unread ? '<div class="unread-dot"></div>' : ''}
    `;
    btn.onclick = () => selectChat(c.id);
    list.appendChild(btn);
  }
}

async function renderRequestsList(list) {
  try {
    const data = await api('/api/friends/requests');
    if (data.received.length === 0 && data.sent.length === 0) {
      list.innerHTML = '<div style="padding:30px;text-align:center;color:var(--muted);font-size:13px">暂无好友申请</div>';
      return;
    }
    if (data.received.length > 0) {
      const title = document.createElement('div');
      title.style.cssText = 'padding:10px 12px;font-size:12px;color:var(--muted);font-weight:600';
      title.textContent = '收到的申请';
      list.appendChild(title);
      for (const req of data.received) {
        const div = document.createElement('div');
        div.className = 'friend-request-item';
        div.innerHTML = `
          <div class="avatar" style="background:${req.avatar_color}">${esc(initials(req.display_name))}</div>
          <div class="search-result-info">
            <b>${esc(req.display_name)}</b>
            <span>@${esc(req.username)}</span>
          </div>
          <div class="friend-request-actions">
            <button class="btn primary sm" data-accept="${req.id}">接受</button>
            <button class="btn danger sm" data-reject="${req.id}">拒绝</button>
          </div>
        `;
        list.appendChild(div);
      }
    }
    if (data.sent.length > 0) {
      const title = document.createElement('div');
      title.style.cssText = 'padding:10px 12px;font-size:12px;color:var(--muted);font-weight:600';
      title.textContent = '已发送';
      list.appendChild(title);
      for (const req of data.sent) {
        const div = document.createElement('div');
        div.className = 'friend-request-item';
        div.innerHTML = `
          <div class="avatar" style="background:${req.avatar_color}">${esc(initials(req.display_name))}</div>
          <div class="search-result-info">
            <b>${esc(req.display_name)}</b>
            <span>@${esc(req.username)} · 等待确认</span>
          </div>
        `;
        list.appendChild(div);
      }
    }
    $$('[data-accept]').forEach(b => b.onclick = async () => {
      await api(`/api/friends/accept/${b.dataset.accept}`, { method: 'POST' });
      toast('已接受好友申请');
      loadChats(); loadRequests();
    });
    $$('[data-reject]').forEach(b => b.onclick = async () => {
      await api(`/api/friends/reject/${b.dataset.reject}`, { method: 'POST' });
      toast('已拒绝');
      loadRequests();
    });
  } catch (e) { toast(e.message); }
}

async function selectChat(chatId) {
  const chat = chats.find(c => c.id === chatId);
  if (!chat) return;
  currentChat = chat;
  chat.unread = 0;
  $('#chatApp').classList.add('openchat');
  $('#headAvatar').textContent = chat.initial;
  $('#headAvatar').style.background = chat.color;
  $('#headTitle').textContent = chat.name;

  if (chat.kind === 'direct') {
    $('#headStatus').textContent = chat.online ? '在线' : `@${chat.username}`;
    $('#groupInfoBtn').style.display = 'none';
  } else {
    $('#headStatus').textContent = `群聊 · ${chat.member_count || ''} 位成员`;
    $('#groupInfoBtn').style.display = '';
  }

  // Load message history
  try {
    let data;
    if (chat.kind === 'direct') {
      data = await api(`/api/messages/direct/${chat.otherId}`);
    } else {
      data = await api(`/api/messages/group/${chat.group_id}`);
    }
    chat.messages = data.messages || [];
    if (chat.kind === 'direct' && data.other) {
      chat.name = data.other.display_name;
      chat.color = data.other.avatar_color;
      chat.username = data.other.username;
      $('#headTitle').textContent = chat.name;
      $('#headAvatar').textContent = initials(chat.name);
      $('#headAvatar').style.background = chat.color;
    }
  } catch (e) { console.error(e); }

  renderList();
  renderMessages();
  $('#message').focus();
}

function renderMessages() {
  const container = $('#messages');
  if (!currentChat) {
    container.innerHTML = '<div class="empty"><b>欢迎使用 WaveChat</b><p>选择一个聊天开始。</p></div>';
    return;
  }
  container.innerHTML = '<div class="day">聊天记录</div>';
  for (const m of currentChat.messages) {
    if (m.sender_id === 0 || m.username === 'system') {
      const div = document.createElement('div');
      div.className = 'msg system';
      div.textContent = m.content;
      container.appendChild(div);
      continue;
    }
    const div = document.createElement('div');
    const isMine = m.sender_id === me.id;
    div.className = 'msg' + (isMine ? ' mine' : '');
    const senderLabel = currentChat.kind === 'group' && !isMine
      ? `<div class="sender">${esc(m.display_name)} · @${esc(m.username)}</div>` : '';
    div.innerHTML = `${senderLabel}${esc(m.content)}<div class="stamp">${fmtTime(m.created_at)}${isMine ? ' ✓✓' : ''}</div>`;
    container.appendChild(div);
  }
  container.scrollTop = container.scrollHeight;
}

// ===== Send Message =====
function sendMessage() {
  const text = $('#message').value.trim();
  if (!text || !currentChat) return;

  if (currentChat.kind === 'direct') {
    socket.emit('send_direct', { receiver_id: currentChat.otherId, content: text }, (res) => {
      if (res.error) toast(res.error);
    });
  } else {
    socket.emit('send_group', { group_id: currentChat.group_id, content: text }, (res) => {
      if (res.error) toast(res.error);
    });
  }
  $('#message').value = '';
  $('#message').style.height = 'auto';
}

// ===== Modals =====
function showModal(html) {
  $('#modalContent').innerHTML = html;
  $('#modalback').classList.add('show');
}
function closeModal() {
  $('#modalback').classList.remove('show');
}

// Add friend modal
function showAddFriend() {
  showModal(`
    <h2>添加好友</h2>
    <p>通过用户名查找其他用户并发送好友申请。</p>
    <label>用户名</label>
    <input id="friendSearchInput" placeholder="输入用户名搜索">
    <div class="search-results" id="friendSearchResults" style="display:none"></div>
    <div class="modalactions">
      <button class="btn" id="modalCancel">取消</button>
    </div>
  `);
  $('#modalCancel').onclick = closeModal;
  let debounce;
  $('#friendSearchInput').oninput = async (e) => {
    clearTimeout(debounce);
    const q = e.target.value.trim();
    if (q.length < 1) { $('#friendSearchResults').style.display = 'none'; return; }
    debounce = setTimeout(async () => {
      try {
        const data = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
        const results = $('#friendSearchResults');
        if (data.users.length === 0) {
          results.innerHTML = '<div style="padding:16px;text-align:center;color:var(--muted);font-size:13px">没有找到用户</div>';
        } else {
          results.innerHTML = data.users.map(u => `
            <div class="search-result" data-uid="${u.id}" data-username="${esc(u.username)}">
              <div class="avatar" style="background:${u.avatar_color}">${esc(initials(u.display_name))}</div>
              <div class="search-result-info">
                <b>${esc(u.display_name)}</b>
                <span>@${esc(u.username)} · ${u.friendship === 'accepted' ? '已是好友' : u.friendship === 'pending' ? '申请待处理' : '可添加'}</span>
              </div>
              ${u.friendship !== 'accepted' ? '<button class="btn primary sm">添加</button>' : ''}
            </div>
          `).join('');
          $$('.search-result').forEach(el => {
            el.onclick = async () => {
              try {
                await api('/api/friends/request', { method: 'POST', body: JSON.stringify({ username: el.dataset.username }) });
                toast('好友申请已发送');
                closeModal();
                loadRequests();
              } catch (err) { toast(err.message); }
            };
          });
        }
        results.style.display = '';
      } catch (e) { toast(e.message); }
    }, 300);
  };
}

// New group modal
function showNewGroup() {
  showModal(`
    <h2>创建群聊</h2>
    <p>创建一个新的群聊并邀请好友加入。</p>
    <label>群聊名称</label>
    <input id="groupNameInput" placeholder="例如 周末游戏小队">
    <label>邀请好友（可多选）</label>
    <div id="groupFriendList" style="max-height:180px;overflow-y:auto;border:1px solid var(--line);border-radius:10px"></div>
    <div class="modalactions">
      <button class="btn" id="modalCancel">取消</button>
      <button class="btn primary" id="createGroupBtn">创建群聊</button>
    </div>
  `);
  $('#modalCancel').onclick = closeModal;

  api('/api/friends').then(data => {
    const list = $('#groupFriendList');
    if (data.friends.length === 0) {
      list.innerHTML = '<div style="padding:16px;text-align:center;color:var(--muted);font-size:13px">还没有好友，先添加好友吧</div>';
    } else {
      list.innerHTML = data.friends.map(f => `
        <label class="search-result" style="cursor:pointer">
          <div class="avatar" style="background:${f.avatar_color}">${esc(initials(f.display_name))}</div>
          <div class="search-result-info"><b>${esc(f.display_name)}</b><span>@${esc(f.username)}</span></div>
          <input type="checkbox" value="${esc(f.username)}" style="width:18px;height:18px">
        </label>
      `).join('');
    }
  });

  $('#createGroupBtn').onclick = async () => {
    const name = $('#groupNameInput').value.trim();
    if (!name) { toast('请输入群聊名称'); return; }
    const selected = [...$$('#groupFriendList input:checked')].map(c => c.value);
    try {
      await api('/api/groups', { method: 'POST', body: JSON.stringify({ name, member_usernames: selected }) });
      toast('群聊创建成功');
      closeModal();
      loadChats();
    } catch (e) { toast(e.message); }
  };
}

// Profile modal
function showProfile() {
  showModal(`
    <h2>个人资料</h2>
    <p>修改你的显示名称和头像颜色。</p>
    <label>用户名（不可修改）</label>
    <input value="@${esc(me.username)}" disabled style="background:#f5f8fa">
    <label>显示名称</label>
    <input id="profileName" value="${esc(me.display_name)}">
    <label>头像颜色</label>
    <div id="colorPicker" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
      ${['#e8798f','#4f91d8','#8e79d6','#e9a34d','#36a89b','#6c9a74','#c16eb5','#c16f54','#3390ec'].map(c =>
        `<div data-color="${c}" style="width:32px;height:32px;border-radius:50%;background:${c};cursor:pointer;border:3px solid ${me.avatar_color===c?'#17212b':'transparent'}"></div>`
      ).join('')}
    </div>
    <div class="modalactions">
      <button class="btn" id="modalCancel">取消</button>
      <button class="btn primary" id="saveProfileBtn">保存</button>
    </div>
  `);
  $('#modalCancel').onclick = closeModal;
  let selectedColor = me.avatar_color;
  $$('#colorPicker div').forEach(d => d.onclick = () => {
    selectedColor = d.dataset.color;
    $$('#colorPicker div').forEach(x => x.style.border = '3px solid transparent');
    d.style.border = '3px solid #17212b';
  });
  $('#saveProfileBtn').onclick = async () => {
    try {
      const data = await api('/api/auth/me', { method: 'PUT', body: JSON.stringify({ display_name: $('#profileName').value.trim(), avatar_color: selectedColor }) });
      me = data.user;
      localStorage.setItem('wc_user', JSON.stringify(me));
      updateUserUI();
      toast('资料已保存');
      closeModal();
    } catch (e) { toast(e.message); }
  };
}

// Group info panel
async function showGroupInfo() {
  if (!currentChat || currentChat.kind !== 'group') return;
  try {
    const data = await api(`/api/groups/${currentChat.group_id}`);
    const panel = $('#groupPanelBody');
    panel.innerHTML = `
      <div style="text-align:center;margin-bottom:20px">
        <div class="avatar" style="width:70px;height:70px;font-size:28px;background:${currentChat.color};margin:0 auto 12px">${esc(currentChat.initial)}</div>
        <h3 style="font-size:20px">${esc(data.group.name)}</h3>
        <p style="color:var(--muted);font-size:13px;margin-top:4px">${data.members.length} 位成员</p>
      </div>
      <div style="font-size:13px;font-weight:700;color:#405563;margin-bottom:8px">成员列表</div>
      ${data.members.map(m => `
        <div class="member-list-item">
          <div class="avatar" style="background:${m.avatar_color}">${esc(initials(m.display_name))}</div>
          <div class="member-info">
            <b>${esc(m.display_name)}</b>
            <span>@${esc(m.username)}</span>
          </div>
          ${m.role === 'admin' ? '<span class="role-tag">管理员</span>' : ''}
          ${data.my_role === 'admin' && m.id !== me.id ? `<button class="btn danger sm" data-remove="${m.id}">移除</button>` : ''}
        </div>
      `).join('')}
      <div style="margin-top:16px">
        <label style="font-size:13px;font-weight:700;color:#405563">添加成员</label>
        <div style="display:flex;gap:8px;margin-top:8px">
          <input id="addMemberInput" placeholder="输入用户名" style="flex:1;padding:10px;border:1px solid var(--line);border-radius:9px;outline:none">
          <button class="btn primary" id="addMemberBtn">添加</button>
        </div>
      </div>
      ${data.my_role !== 'admin' ? `<button class="btn danger" style="width:100%;margin-top:20px" id="leaveGroupBtn">退出群聊</button>` : ''}
    `;
    $('#groupPanel').classList.add('show');

    $$('[data-remove]').forEach(b => b.onclick = async () => {
      if (!confirm('确定移除该成员？')) return;
      try {
        await api(`/api/groups/${currentChat.group_id}/members/${b.dataset.remove}`, { method: 'DELETE' });
        toast('已移除成员');
        showGroupInfo();
        loadChats();
      } catch (e) { toast(e.message); }
    });

    $('#addMemberBtn').onclick = async () => {
      const username = $('#addMemberInput').value.trim();
      if (!username) return;
      try {
        await api(`/api/groups/${currentChat.group_id}/members`, { method: 'POST', body: JSON.stringify({ username }) });
        toast('已添加成员');
        $('#addMemberInput').value = '';
        showGroupInfo();
        loadChats();
      } catch (e) { toast(e.message); }
    };

    const leaveBtn = $('#leaveGroupBtn');
    if (leaveBtn) leaveBtn.onclick = async () => {
      if (!confirm('确定退出群聊？')) return;
      try {
        await api(`/api/groups/${currentChat.group_id}/leave`, { method: 'POST' });
        toast('已退出群聊');
        $('#groupPanel').classList.remove('show');
        currentChat = null;
        loadChats();
        renderMessages();
      } catch (e) { toast(e.message); }
    };
  } catch (e) { toast(e.message); }
}

function updateUserUI() {
  $('#myAvatar').textContent = initials(me.display_name);
  $('#myAvatar').style.background = me.avatar_color;
  $('#myName').textContent = me.display_name;
  $('#myUsername').textContent = '@' + me.username;
}

// ===== Enter Chat =====
async function enterChat() {
  $('#authPage').style.display = 'none';
  $('#chatApp').style.display = 'grid';
  updateUserUI();
  connectSocket();
  await loadChats();
  await loadRequests();
}

// ===== Event Bindings =====
$$('.auth-tab').forEach(tab => tab.onclick = () => {
  $$('.auth-tab').forEach(t => t.classList.toggle('active', t === tab));
  $('#loginForm').style.display = tab.dataset.auth === 'login' ? '' : 'none';
  $('#registerForm').style.display = tab.dataset.auth === 'register' ? '' : 'none';
});

$('#loginBtn').onclick = () => login($('#loginUsername').value.trim(), $('#loginPassword').value);
$('#registerBtn').onclick = () => register($('#regUsername').value.trim(), $('#regName').value.trim(), $('#regPassword').value);
$('#loginPassword').onkeydown = e => { if (e.key === 'Enter') $('#loginBtn').click(); };
$('#regPassword').onkeydown = e => { if (e.key === 'Enter') $('#registerBtn').click(); };

$('#logoutBtn').onclick = logout;
$('#addFriend').onclick = showAddFriend;
$('#newGroup').onclick = showNewGroup;
$('#myProfile').onclick = showProfile;
$('#adminOpen').onclick = () => window.open('/admin', '_blank');
$('#groupInfoBtn').onclick = showGroupInfo;
$('#closeGroupPanel').onclick = () => $('#groupPanel').classList.remove('show');
$('#backBtn').onclick = () => $('#chatApp').classList.remove('openchat');

$('#form').onsubmit = e => { e.preventDefault(); sendMessage(); };
$('#message').onkeydown = e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
};
$('#message').oninput = e => {
  e.target.style.height = 'auto';
  e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  if (currentChat) {
    socket.emit('typing', { chat_type: currentChat.kind, target_id: currentChat.kind === 'direct' ? currentChat.otherId : currentChat.group_id });
  }
};
$('#search').oninput = renderList;

$$('[data-filter]').forEach(b => b.onclick = () => {
  filter = b.dataset.filter;
  $$('[data-filter]').forEach(x => x.classList.toggle('active', x === b));
  renderList();
});

$('#modalback').onclick = e => { if (e.target.id === 'modalback') closeModal(); };

// ===== Init =====
if (token && me) {
  // Verify token is still valid
  api('/api/auth/me').then(() => enterChat()).catch(() => {
    token = null; me = null;
    localStorage.removeItem('wc_token');
    localStorage.removeItem('wc_user');
  });
}
