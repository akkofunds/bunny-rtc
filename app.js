const BROKER_URL = 'wss://broker.emqx.io:8084/mqtt'
const ROOM_ID = 'bunny-rtc-public-room-v1'
const SERVER_TOPIC = `bunny-rtc/${ROOM_ID}`
const CHANNEL_TOPIC = `${SERVER_TOPIC}/chat`
const HISTORY_TOPIC = `${SERVER_TOPIC}/history/`
const PRESENCE_TOPIC = `${SERVER_TOPIC}/presence/`
const KEEP_ALIVE_SECONDS = 30
const MAX_VISIBLE_MESSAGES = 100

if (location.hash) history.replaceState(null, '', `${location.pathname}${location.search}`)

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const storedId = localStorage.getItem('bunny_rtc_id')
const selfId = storedId || crypto.randomUUID().replaceAll('-', '').slice(0, 16)
localStorage.setItem('bunny_rtc_id', selfId)

let displayName = localStorage.getItem('bunny_rtc_name') || ''
let selfAvatar = localStorage.getItem('bunny_rtc_avatar') || null // base64 or null
let socket = null
let reconnectTimer = 0
let heartbeatTimer = 0
let pingTimer = 0
let messageSequence = 1
let connected = false
let connectionTimeout = 0
let stopping = false
let historyReceived = new Map()
let members = new Map()
let lastRenderedDay = ''
let emojiPickerOpen = false
let pendingAvatar = selfAvatar // for the dialog preview

const EMOJIS = [
  '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩',
  '😘','😗','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐',
  '🤨','😐','😑','😶','😏','😒','🙄','😬','😮‍💨','🤥','😌','😔','😪','🤤','😴','😷',
  '🤒','🤕','🤢','🤮','🤧','🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸','😎','🤓','🧐',
  '😕','😟','🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭',
  '😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️',
  '💩','🤡','👹','👺','👻','👽','👾','🤖','😺','😸','😹','😻','😼','😽','🙀','😿',
  '😾','👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉',
  '👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏',
  '💪','🔥','✨','🌟','💫','⭐','❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔',
  '💯','💢','💥','💫','💦','💨','🕳️','💣','💬','👁️‍🗨️','🗨️','🗯️','💭','💤','🎉','🎊'
]

const BUNNY_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="bunny-icon"><path d="M12 3c-1.5 2.5-4 4-4 7.5a4 4 0 0 0 8 0c0-3.5-2.5-5-4-7.5z"/><path d="M8.5 14.5c.8 1.8 2 2.5 3.5 2.5s2.7-.7 3.5-2.5"/><circle cx="9.5" cy="11" r="0.8" fill="currentColor" stroke="none"/><circle cx="14.5" cy="11" r="0.8" fill="currentColor" stroke="none"/></svg>`

const $ = s => document.querySelector(s)
const ui = {
  status: $('#connection-label'),
  banner: $('#connection-banner'),
  reconnect: $('#reconnect-button'),
  onlineCount: $('#header-online-count'),
  messageList: $('#message-list'),
  input: $('#message-input'),
  send: $('.send-btn'),
  name: $('#self-name'),
  avatar: $('#self-avatar'),
  nameButton: $('#name-button'),
  dialog: $('#name-dialog'),
  nameInput: $('#name-input'),
  nameForm: $('#name-form'),
  cancelName: $('#cancel-name'),
  form: $('#message-form'),
  emoji: $('#emoji-button'),
  emojiPicker: $('#emoji-picker'),
  emojiGrid: $('#emoji-grid'),
  invite: $('#invite-button'),
  previewAvatar: $('#preview-avatar'),
  avatarInput: $('#avatar-input'),
  resetAvatar: $('#reset-avatar')
}

function colorFor(id) {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
  const colors = ['#ed4245','#faa61a','#3ba55d','#5865f2','#eb459e','#57f287','#fee75c','#9b59b6','#1abc9c','#e67e22']
  return colors[Math.abs(hash) % colors.length]
}

function renderAvatar(el, id, avatarData) {
  el.innerHTML = ''
  el.style.setProperty('--avatar-color', colorFor(id))
  if (avatarData) {
    const img = document.createElement('img')
    img.src = avatarData
    img.alt = ''
    el.append(img)
  } else {
    el.innerHTML = BUNNY_SVG
  }
}

function setupBackground() {
  const bg = $('#bg')
  const video = $('#bg-video')
  video.src = 'home.mp4'
  video.onloadeddata = () => {
    video.hidden = false
    bg.style.backgroundImage = 'none'
  }
  video.onerror = () => {
    video.hidden = true
    const img = new Image()
    img.onload = () => { bg.style.backgroundImage = `url(home.jpg)` }
    img.onerror = () => {
      img.onload = () => { bg.style.backgroundImage = `url(home.png)` }
      img.src = 'home.png'
    }
    img.src = 'home.jpg'
  }
}
setupBackground()

function encodeLength(length) {
  const bytes = []
  do {
    let digit = length % 128
    length = Math.floor(length / 128)
    if (length > 0) digit |= 0x80
    bytes.push(digit)
  } while (length > 0)
  return bytes
}
function utf8(value) {
  const bytes = [...encoder.encode(value)]
  return [bytes.length >> 8, bytes.length & 0xff, ...bytes]
}
function packet(header, body) {
  return new Uint8Array([header, ...encodeLength(body.length), ...body])
}
function sendPacket(header, body) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(packet(header, body))
}
function publish(topic, value, retained = false) {
  const data = typeof value === 'string' ? encoder.encode(value) : encoder.encode(JSON.stringify(value))
  sendPacket(0x30 | (retained ? 1 : 0), [...utf8(topic), ...data])
}
function subscribe(topic) {
  const id = messageSequence++ & 0xffff
  sendPacket(0x82, [id >> 8, id & 0xff, ...utf8(topic), 0])
}
function connectPacket() {
  const willTopic = `${PRESENCE_TOPIC}${selfId}`
  const clientId = `bunny-rtc-${selfId}`
  const keepAlive = KEEP_ALIVE_SECONDS
  const body = [
    ...utf8('MQTT'), 4, 0x26,
    keepAlive >> 8, keepAlive & 0xff,
    ...utf8(clientId), ...utf8(willTopic), ...utf8('')
  ]
  return packet(0x10, body)
}
function packetAt(bytes, offset) {
  if (offset + 2 > bytes.length) return null
  const header = bytes[offset]
  let multiplier = 1, remaining = 0, index = offset + 1, digit
  do {
    if (index >= bytes.length) return null
    digit = bytes[index++]
    remaining += (digit & 0x7f) * multiplier
    multiplier *= 128
  } while (digit & 0x80)
  if (index + remaining > bytes.length) return null
  return { header, body: bytes.subarray(index, index + remaining), next: index + remaining }
}
function readString(bytes, offset) {
  if (offset + 2 > bytes.length) return null
  const length = (bytes[offset] << 8) | bytes[offset + 1]
  const start = offset + 2
  if (start + length > bytes.length) return null
  return { value: decoder.decode(bytes.subarray(start, start + length)), next: start + length }
}

function onPacket(header, body) {
  const kind = header >> 4
  if (kind === 2) {
    if (body.length < 2 || body[1] !== 0) {
      setConnection(false, 'Server refused. Retrying…')
      socket?.close()
      return
    }
    connected = true
    clearTimeout(connectionTimeout)
    setConnection(true, 'Connected')
    subscribe(CHANNEL_TOPIC)
    subscribe(`${HISTORY_TOPIC}+`)
    subscribe(`${PRESENCE_TOPIC}+`)
    publishPresence()
    heartbeatTimer = setInterval(sendPresence, 15000)
    pingTimer = setInterval(() => sendPacket(0xc0, []), KEEP_ALIVE_SECONDS * 500)
    return
  }
  if (kind !== 3) return
  const qos = (header >> 1) & 0x03
  const topicField = readString(body, 0)
  if (!topicField) return
  let cursor = topicField.next
  if (qos > 0) cursor += 2
  const topic = topicField.value
  const payload = decoder.decode(body.subarray(cursor))
  if (qos === 1) sendPacket(0x40, [(body[topicField.next] << 8) | body[topicField.next + 1]])
  if (topic === CHANNEL_TOPIC || topic.startsWith(HISTORY_TOPIC)) onMessage(payload, topic)
  else if (topic.startsWith(PRESENCE_TOPIC)) onPresence(topic, payload)
}

function onMessage(payload, topic) {
  if (!payload) {
    historyReceived.delete(topic)
    renderMessages()
    return
  }
  try {
    const msg = JSON.parse(payload)
    if (!msg || typeof msg.id !== 'string' || typeof msg.text !== 'string') return
    msg.text = msg.text.slice(0, 500)
    msg.name = cleanName(msg.name)
    msg.at = Number.isFinite(msg.at) ? msg.at : Date.now()
    const msgTopic = topic.startsWith(HISTORY_TOPIC) ? topic : `${HISTORY_TOPIC}${msg.id}`
    historyReceived.set(msgTopic, msg)
    renderMessages()
    if (topic === CHANNEL_TOPIC && historyReceived.size > MAX_VISIBLE_MESSAGES) trimHistory()
  } catch {}
}

function trimHistory() {
  const sorted = [...historyReceived.entries()].sort((a, b) => a[1].at - b[1].at)
  for (const [topic] of sorted.slice(0, Math.max(0, sorted.length - MAX_VISIBLE_MESSAGES))) {
    publish(topic, '', true)
    historyReceived.delete(topic)
  }
}

function onPresence(topic, payload) {
  const id = topic.slice(PRESENCE_TOPIC.length)
  if (!payload) members.delete(id)
  else {
    try {
      const member = JSON.parse(payload)
      if (member.id === id && typeof member.name === 'string') {
        members.set(id, { ...member, at: Date.now() })
      }
    } catch {}
  }
  updateOnlineCount()
}

function publishPresence() {
  publish(`${PRESENCE_TOPIC}${selfId}`, {
    id: selfId,
    name: displayName,
    avatar: selfAvatar,
    at: Date.now()
  }, true)
}

function sendPresence() {
  if (!connected) return
  publishPresence()
  const cutoff = Date.now() - 40000
  for (const [id, member] of members) if (member.at < cutoff) members.delete(id)
  updateOnlineCount()
}

function setConnection(isConnected, message) {
  connected = isConnected
  ui.status.textContent = message
  ui.banner.dataset.state = isConnected ? 'connected' : (/could not|timed out|refused|disconnected/i.test(message) ? 'error' : 'connecting')
  ui.reconnect.hidden = isConnected
  ui.onlineCount.textContent = isConnected ? `${Math.max(1, members.size)} online` : 'Connecting…'
  ui.input.disabled = !isConnected
  ui.send.disabled = !isConnected
  ui.input.placeholder = isConnected ? 'Message everyone…' : 'Connecting…'
}

function openConnection() {
  if (stopping) return
  clearTimeout(reconnectTimer)
  clearTimeout(connectionTimeout)
  setConnection(false, 'Connecting…')
  if (socket) {
    socket.onclose = null
    socket.onerror = null
    socket.close()
  }
  socket = new WebSocket(BROKER_URL, 'mqtt')
  socket.binaryType = 'arraybuffer'
  socket.onopen = () => {
    socket?.send(connectPacket())
    connectionTimeout = setTimeout(() => {
      if (!connected) {
        setConnection(false, 'Timed out. Retrying…')
        socket?.close()
      }
    }, 9000)
  }
  socket.onmessage = (event) => {
    const bytes = new Uint8Array(event.data)
    let offset = 0
    while (offset < bytes.length) {
      const parsed = packetAt(bytes, offset)
      if (!parsed) break
      onPacket(parsed.header, parsed.body)
      offset = parsed.next
    }
  }
  socket.onerror = () => setConnection(false, 'Could not reach server. Retrying…')
  socket.onclose = () => {
    connected = false
    clearTimeout(connectionTimeout)
    clearInterval(heartbeatTimer)
    clearInterval(pingTimer)
    setConnection(false, 'Disconnected. Retrying…')
    if (!stopping) reconnectTimer = setTimeout(openConnection, 2500)
  }
}

function cleanName(value) {
  return String(value || 'Guest').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24) || 'Guest'
}

function formatTime(ts) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(ts))
}
function formatDay(ts) {
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(ts))
}

function renderMessages() {
  const nearBottom = ui.messageList.scrollHeight - ui.messageList.scrollTop - ui.messageList.clientHeight < 80
  const messages = [...historyReceived.values()].sort((a, b) => a.at - b.at).slice(-MAX_VISIBLE_MESSAGES)
  ui.messageList.replaceChildren()

  const welcome = document.createElement('div')
  welcome.className = 'welcome'
  welcome.innerHTML = `
    <div class="welcome-icon">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 3c-1.5 2.5-4 4-4 7.5a4 4 0 0 0 8 0c0-3.5-2.5-5-4-7.5z"/>
        <path d="M8.5 14.5c.8 1.8 2 2.5 3.5 2.5s2.7-.7 3.5-2.5"/>
      </svg>
    </div>
    <h2>Welcome to Bunny RTC</h2>
    <p>Everyone who visits this site shares this one room. Say hello.</p>
  `
  ui.messageList.append(welcome)

  lastRenderedDay = ''
  for (const msg of messages) {
    const day = formatDay(msg.at)
    if (day !== lastRenderedDay) {
      const sep = document.createElement('div')
      sep.className = 'date-sep'
      sep.textContent = day
      ui.messageList.append(sep)
      lastRenderedDay = day
    }

    const el = document.createElement('div')
    el.className = 'msg'

    const av = document.createElement('div')
    av.className = 'avatar'
    // Try to get avatar from presence if available
    const member = members.get(msg.id)
    renderAvatar(av, msg.id, member?.avatar || null)

    const body = document.createElement('div')
    body.className = 'msg-body'

    const meta = document.createElement('div')
    meta.className = 'msg-meta'

    const name = document.createElement('span')
    name.className = 'msg-name'
    name.textContent = msg.name

    const time = document.createElement('span')
    time.className = 'msg-time'
    time.textContent = formatTime(msg.at)

    const text = document.createElement('div')
    text.className = 'msg-text'
    text.textContent = msg.text

    meta.append(name, time)
    body.append(meta, text)
    el.append(av, body)
    ui.messageList.append(el)
  }

  if (nearBottom) ui.messageList.scrollTop = ui.messageList.scrollHeight
}

function updateOnlineCount() {
  const cutoff = Date.now() - 40000
  const active = [...members.values()].filter(m => m.at >= cutoff)
  if (!active.some(m => m.id === selfId)) active.push({ id: selfId, name: displayName, at: Date.now() })
  ui.onlineCount.textContent = connected ? `${active.length} online` : 'Connecting…'
}

function sendMessage(value) {
  const text = value.trim().slice(0, 500)
  if (!text || !connected || !displayName) return
  const msg = {
    id: `${Date.now().toString(36)}-${selfId}-${Math.random().toString(36).slice(2, 6)}`,
    name: displayName,
    text,
    at: Date.now()
  }
  publish(`${HISTORY_TOPIC}${msg.id}`, msg, true)
  historyReceived.set(`${HISTORY_TOPIC}${msg.id}`, msg)
  renderMessages()
  trimHistory()
}

function openNameDialog() {
  ui.nameInput.value = displayName
  pendingAvatar = selfAvatar
  renderAvatar(ui.previewAvatar, selfId, pendingAvatar)
  ui.cancelName.hidden = !displayName
  ui.dialog.showModal()
  ui.nameInput.focus()
}

function resizeAndToBase64(file) {
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const size = 128
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      // cover crop
      const scale = Math.max(size / img.width, size / img.height)
      const w = img.width * scale
      const h = img.height * scale
      const x = (size - w) / 2
      const y = (size - h) / 2
      ctx.drawImage(img, x, y, w, h)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.7))
    }
    img.src = url
  })
}

ui.avatarInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0]
  if (!file) return
  pendingAvatar = await resizeAndToBase64(file)
  renderAvatar(ui.previewAvatar, selfId, pendingAvatar)
})

ui.resetAvatar.addEventListener('click', () => {
  pendingAvatar = null
  renderAvatar(ui.previewAvatar, selfId, null)
})

ui.form.addEventListener('submit', e => {
  e.preventDefault()
  sendMessage(ui.input.value)
  ui.input.value = ''
  closeEmojiPicker()
})

ui.nameButton.addEventListener('click', openNameDialog)
ui.reconnect.addEventListener('click', openConnection)

ui.nameForm.addEventListener('submit', e => {
  e.preventDefault()
  displayName = cleanName(ui.nameInput.value)
  if (displayName.length < 2) return
  selfAvatar = pendingAvatar
  localStorage.setItem('bunny_rtc_name', displayName)
  if (selfAvatar) localStorage.setItem('bunny_rtc_avatar', selfAvatar)
  else localStorage.removeItem('bunny_rtc_avatar')
  ui.dialog.close()
  ui.name.textContent = displayName
  renderAvatar(ui.avatar, selfId, selfAvatar)
  publishPresence()
  updateOnlineCount()
})

ui.cancelName.addEventListener('click', () => ui.dialog.close())

ui.emoji.addEventListener('click', e => {
  e.stopPropagation()
  if (emojiPickerOpen) closeEmojiPicker()
  else openEmojiPicker()
})

document.addEventListener('click', e => {
  if (!emojiPickerOpen) return
  if (ui.emojiPicker.contains(e.target) || ui.emoji.contains(e.target)) return
  closeEmojiPicker()
})

function openEmojiPicker() {
  if (ui.input.disabled) return
  emojiPickerOpen = true
  ui.emojiPicker.hidden = false
}
function closeEmojiPicker() {
  emojiPickerOpen = false
  ui.emojiPicker.hidden = true
}

function buildEmojiPicker() {
  ui.emojiGrid.replaceChildren()
  for (const emoji of EMOJIS) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'emoji-item'
    btn.textContent = emoji
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      if (ui.input.disabled) return
      const start = ui.input.selectionStart ?? ui.input.value.length
      const end = ui.input.selectionEnd ?? ui.input.value.length
      ui.input.value = ui.input.value.slice(0, start) + emoji + ui.input.value.slice(end)
      ui.input.focus()
      const pos = start + emoji.length
      ui.input.setSelectionRange(pos, pos)
    })
    ui.emojiGrid.append(btn)
  }
}

ui.invite.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.href)
    ui.invite.title = 'Copied!'
  } catch {
    ui.invite.title = 'Copy failed'
  }
  setTimeout(() => ui.invite.title = 'Copy invite link', 2000)
})

if (!displayName) {
  displayName = `Guest-${Math.floor(100 + Math.random() * 900)}`
  localStorage.setItem('bunny_rtc_name', displayName)
}
ui.name.textContent = displayName
renderAvatar(ui.avatar, selfId, selfAvatar)
updateOnlineCount()
buildEmojiPicker()
openConnection()

window.addEventListener('beforeunload', () => {
  stopping = true
  clearTimeout(reconnectTimer)
  clearTimeout(connectionTimeout)
  clearInterval(heartbeatTimer)
  clearInterval(pingTimer)
  publish(`${PRESENCE_TOPIC}${selfId}`, '', true)
  sendPacket(0xe0, [])
  socket?.close()
})
