// WaveChat Admin Panel
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

let token = localStorage.getItem('wc_admin_token');
let adminUser = JSON.parse(localStorage.getItem('wc_admin_user') || 'null');
let currentTab = 'users';
let currentPage = { users: 1, messages: 1, logs: 1 };

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(path, { ...options, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

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

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// ===== Admin Login =====
async function adminLogin() {
  const username = $('#adminUser').value.trim();
  const password = $('#adminPass').value;
  if (!username || !password) { showAdminError('请输入用户名和密码'); return; }
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    if (data.user.role !== 'admin') {
      showAdminError('该账号不是管理员');
      return;
    }
    token = data.token;
    adminUser = data.user;
    localStorage.setItem('wc_admin_token', token);
    localStorage.setItem('wc_admin_user', JSON.stringify(adminUser));
    enterAdmin();
  } catch (e) {
    showAdminError(e.message);
  }
}

function showAdminError(msg) {
  const el = $('#adminError');
  el.textContent = msg;
  el.style.display = 'block';
}

function adminLogout() {
  token = null; adminUser = null;
  localStorage.removeItem('wc_admin_token');
  localStorage.removeItem('wc_admin_user');
  $('#adminDashboard').style.display = 'none';
  $('#adminLogin').style.display = 'flex';
}

// ===== Dashboard =====
async function enterAdmin() {
  $('#adminLogin').style.display = 'none';
  $('#adminDashboard').style.display = 'block';
  $('#adminWho').textContent = `@${adminUser.username}`;
  await loadStats();
  await loadTab('users');
}

async function loadStats() {
  try {
    const s = await api('/api/admin/stats');
    $('#statsGrid').innerHTML = `
      <div class="stat-card"><span>总用户数</span><b>${s.totalUsers}</b><div class="trend">今日新增 +${s.todayNewUsers}</div></div>
      <div class="stat-card"><span>活跃用户</span><b>${s.activeUsers}</b><div class="trend" style="color:var(--red)">封禁 ${s.bannedUsers}</div></div>
      <div class="stat-card"><span>群聊总数</span><b>${s.totalGroups}</b><div class="trend">好友关系 ${s.totalFriendships}</div></div>
      <div class="stat-card"><span>消息总数</span><b>${s.totalMessages}</b><div class="trend">今日 ${s.todayMessages}</div></div>
    `;
  } catch (e) { console.error(e); }
}

async function loadTab(tab) {
  currentTab = tab;
  $$('.admin-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  const content = $('#tabContent');

  if (tab === 'users') await loadUsers();
  else if (tab === 'groups') await loadGroups();
  else if (tab === 'messages') await loadMessages();
  else if (tab === 'logs') await loadLogs();
}

// ===== Users Tab =====
async function loadUsers(search = '') {
  try {
    const page = currentPage.users;
    const data = await api(`/api/admin/users?page=${page}&limit=20&search=${encodeURIComponent(search)}`);
    $('#tabContent').innerHTML = `
      <div class="panel">
        <div class="panel-head">
          用户管理（共 ${data.total} 人）
          <input id="userSearch" placeholder="搜索用户名或昵称…" value="${esc(search)}">
        </div>
        <div class="table-scroll">
          <table>
            <thead><tr><th>ID</th><th>用户名</th><th>显示名称</th><th>角色</th><th>状态</th><th>最后活跃</th><th>注册时间</th><th>操作</th></tr></thead>
            <tbody>
              ${data.users.map(u => `
                <tr>
                  <td>${u.id}</td>
                  <td><b>@${esc(u.username)}</b></td>
                  <td>${esc(u.display_name)}</td>
                  <td><span class="state-badge ${u.role}">${u.role === 'admin' ? '管理员' : '普通用户'}</span></td>
                  <td><span class="state-badge ${u.status}">${u.status === 'active' ? '正常' : '已封禁'}</span></td>
                  <td>${fmtDate(u.last_seen)}</td>
                  <td>${fmtDate(u.created_at)}</td>
                  <td>
                    ${u.role === 'admin' ? '<span style="color:var(--muted);font-size:12px">管理员账号</span>' :
                      u.status === 'banned'
                        ? `<button class="btn primary sm" data-unban="${u.id}">解封</button>`
                        : `<button class="btn danger sm" data-ban="${u.id}">封禁</button>`}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ${renderPagination(data.total, page, 20, 'users')}
      </div>
    `;

    $('#userSearch').oninput = e => {
      clearTimeout($('#userSearch').t);
      $('#userSearch').t = setTimeout(() => loadUsers(e.target.value.trim()), 400);
    };

    $$('[data-ban]').forEach(b => b.onclick = async () => {
      if (!confirm('确定封禁该用户？封禁后将无法登录和发送消息。')) return;
      try {
        await api(`/api/admin/users/${b.dataset.ban}/ban`, { method: 'POST', body: JSON.stringify({ reason: '管理员操作' }) });
        toast('已封禁用户');
        loadUsers($('#userSearch').value);
        loadStats();
      } catch (e) { toast(e.message); }
    });

    $$('[data-unban]').forEach(b => b.onclick = async () => {
      try {
        await api(`/api/admin/users/${b.dataset.unban}/unban`, { method: 'POST' });
        toast('已解封用户');
        loadUsers($('#userSearch').value);
        loadStats();
      } catch (e) { toast(e.message); }
    });

    bindPagination('users', () => loadUsers($('#userSearch')?.value || ''));
  } catch (e) { toast(e.message); }
}

// ===== Groups Tab =====
async function loadGroups() {
  try {
    const data = await api('/api/admin/groups');
    $('#tabContent').innerHTML = `
      <div class="panel">
        <div class="panel-head">群聊管理（共 ${data.groups.length} 个群）</div>
        <div class="table-scroll">
          <table>
            <thead><tr><th>ID</th><th>群聊名称</th><th>群主</th><th>成员数</th><th>消息数</th><th>创建时间</th><th>操作</th></tr></thead>
            <tbody>
              ${data.groups.length === 0 ? '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--muted)">暂无群聊</td></tr>' :
                data.groups.map(g => `
                <tr>
                  <td>${g.id}</td>
                  <td><b>${esc(g.name)}</b></td>
                  <td>@${esc(g.creator_username)}（${esc(g.creator_name)}）</td>
                  <td>${g.member_count}</td>
                  <td>${g.message_count}</td>
                  <td>${fmtDate(g.created_at)}</td>
                  <td><button class="btn danger sm" data-delgroup="${g.id}">删除群聊</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
    $$('[data-delgroup]').forEach(b => b.onclick = async () => {
      if (!confirm('确定删除该群聊？所有消息记录将被清除，此操作不可恢复。')) return;
      try {
        await api(`/api/admin/groups/${b.dataset.delgroup}`, { method: 'DELETE' });
        toast('已删除群聊');
        loadGroups();
        loadStats();
      } catch (e) { toast(e.message); }
    });
  } catch (e) { toast(e.message); }
}

// ===== Messages Tab =====
async function loadMessages() {
  try {
    const page = currentPage.messages;
    const data = await api(`/api/admin/messages?page=${page}&limit=30`);
    $('#tabContent').innerHTML = `
      <div class="panel">
        <div class="panel-head">消息审计（共 ${data.total} 条）</div>
        <div class="table-scroll">
          <table>
            <thead><tr><th>ID</th><th>类型</th><th>发送者</th><th>接收/群聊</th><th>内容</th><th>时间</th></tr></thead>
            <tbody>
              ${data.messages.map(m => `
                <tr>
                  <td>${m.id}</td>
                  <td><span class="state-badge ${m.chat_type}">${m.chat_type === 'group' ? '群聊' : '私聊'}</span></td>
                  <td>@${esc(m.sender_username)}</td>
                  <td>${m.chat_type === 'group' ? esc(m.group_name) : '@' + esc(m.receiver_username)}</td>
                  <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(m.content)}</td>
                  <td>${fmtDate(m.created_at)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        ${renderPagination(data.total, page, 30, 'messages')}
      </div>
    `;
    bindPagination('messages', loadMessages);
  } catch (e) { toast(e.message); }
}

// ===== Logs Tab =====
async function loadLogs() {
  try {
    const page = currentPage.logs;
    const data = await api(`/api/admin/logs?page=${page}&limit=30`);
    $('#tabContent').innerHTML = `
      <div class="panel">
        <div class="panel-head">操作日志（共 ${data.total} 条）</div>
        <div>
          ${data.logs.length === 0 ? '<div style="padding:30px;text-align:center;color:var(--muted)">暂无操作日志</div>' :
            data.logs.map(l => `
            <div class="log-entry">
              <span class="log-action">${esc(l.action)}</span>
              <span class="log-time">${fmtDate(l.created_at)}</span>
              <span style="margin-left:8px;font-size:12px;color:var(--muted)">by @${esc(l.admin_username)}</span>
              ${l.details ? `<div class="log-detail">${esc(l.details)}</div>` : ''}
            </div>
          `).join('')}
        </div>
        ${renderPagination(data.total, page, 30, 'logs')}
      </div>
    `;
    bindPagination('logs', loadLogs);
  } catch (e) { toast(e.message); }
}

// ===== Pagination =====
function renderPagination(total, page, limit, key) {
  const pages = Math.ceil(total / limit);
  if (pages <= 1) return '';
  let btns = '';
  for (let i = 1; i <= Math.min(pages, 7); i++) {
    btns += `<button class="${i === page ? 'active' : ''}" data-page="${i}" data-pkey="${key}">${i}</button>`;
  }
  return `<div class="pagination">
    <button data-page="prev" data-pkey="${key}" ${page <= 1 ? 'disabled' : ''}>上一页</button>
    ${btns}
    <button data-page="next" data-pkey="${key}" ${page >= pages ? 'disabled' : ''}>下一页</button>
  </div>`;
}

function bindPagination(key, loader) {
  $$(`[data-pkey="${key}"]`).forEach(b => b.onclick = () => {
    const p = b.dataset.page;
    if (p === 'prev') currentPage[key] = Math.max(1, currentPage[key] - 1);
    else if (p === 'next') currentPage[key] += 1;
    else currentPage[key] = parseInt(p);
    loader();
  });
}

// ===== Events =====
$('#adminLoginBtn').onclick = adminLogin;
$('#adminPass').onkeydown = e => { if (e.key === 'Enter') adminLogin(); };
$('#adminLogout').onclick = adminLogout;
$$('.admin-tab').forEach(t => t.onclick = () => loadTab(t.dataset.tab));

// ===== Init =====
if (token && adminUser) {
  api('/api/auth/me').then(data => {
    if (data.user.role === 'admin') enterAdmin();
    else adminLogout();
  }).catch(() => adminLogout());
}
