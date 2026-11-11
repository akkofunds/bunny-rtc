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
  '✍️','💅','🤳','💪','🦾','🦿','🦵','🦶','👂','🦻','👃','🧠','🫀','🫁','🦷','🦴',
  '👀','👁️','👅','👄','💋','🩸','❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔',
  '❣️','💕','💞','💓','💗','💖','💘','💝','💟','🔥','✨','🌟','💫','⭐','🌈','☀️',
  '⛅','☁️','🌧️','⛈️','❄️','☃️','💨','🌪️','🌊','💧','💦','☔','⚡','💥','🎉','🎊',
  '🎈','🎁','🎀','🎄','🎃','🏆','🏅','🥇','🥈','🥉','⚽','🏀','🏈','⚾','🎾','🏐',
  '🎱','🏓','🏸','🏒','⛳','🎯','🎮','🕹️','🎲','🧩','♟️','🎭','🎨','🎵','🎶','🎹',
  '🥁','🎷','🎺','🎸','🎤','🎧','📷','📸','🎬','💡','🔒','🔓','🔑','💰','💵','💳'
]

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
  invite: $('#invite-button')
}

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
    ...utf8('MQTT'), 4,
    0x26,
    keepAlive >> 8, keepAlive & 0xff,
    ...utf8(clientId),
    ...utf8(willTopic),
    ...utf8('')
  ]
  return packet(0x10, body)
}

function packetAt(bytes, offset) {
  if (offset + 2 > bytes.length) return null
  const header = bytes[offset]
  let multiplier = 1
  let remaining = 0
  let index = offset + 1
  let digit
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
      setConnection(false, 'Server refused connection. Retrying…')
      socket?.close()
      return
    }
    connected = true
    window.clearTimeout(connectionTimeout)
    setConnection(true, 'Connected — chatting with everyone')
    subscribe(CHANNEL_TOPIC)
    subscribe(`${HISTORY_TOPIC}+`)
    subscribe(`${PRESENCE_TOPIC}+`)
    publish(`${PRESENCE_TOPIC}${selfId}`, { id: selfId, name: displayName, at: Date.now() }, true)
    heartbeatTimer = window.setInterval(sendPresence, 15000)
    pingTimer = window.setInterval(() => sendPacket(0xc0, []), KEEP_ALIVE_SECONDS * 500)
    return
  }
  if (kind !== 3) return
  const qos = (header >> 1) & 0x03
  const topicField = readString(body, 0)
  if (!topicField) return
  let cursor = topicField.next
  let packetId
  if (qos > 0) {
    packetId = (body[cursor] << 8) | body[cursor + 1]
    cursor += 2
  }
  const topic = topicField.value
  const payload = decoder.decode(body.subarray(cursor))
  if (qos === 1) sendPacket(0x40, [packetId >> 8, packetId & 0xff])
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
      if (member.id === id && typeof member.name === 'string') members.set(id, { ...member, at: Date.now() })
    } catch {}
  }
  updateOnlineCount()
}

function sendPresence() {
  if (!connected) return
  publish(`${PRESENCE_TOPIC}${selfId}`, { id: selfId, name: displayName, at: Date.now() }, true)
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
  ui.input.placeholder = isConnected ? 'Message #shared-room' : 'Connecting…'
}

function openConnection() {
  if (stopping) return
  window.clearTimeout(reconnectTimer)
  window.clearTimeout(connectionTimeout)
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
    connectionTimeout = window.setTimeout(() => {
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
    window.clearTimeout(connectionTimeout)
    window.clearInterval(heartbeatTimer)
    window.clearInterval(pingTimer)
    setConnection(false, 'Disconnected. Retrying…')
    if (!stopping) reconnectTimer = window.setTimeout(openConnection, 2500)
  }
}

function cleanName(value) {
  return String(value || 'Guest').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24) || 'Guest'
}

function colorFor(value) {
  let hash = 0
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) | 0
  const colors = ['#ed4245', '#faa61a', '#3ba55d', '#5865f2', '#eb459e', '#57f287', '#fee75c']
  return colors[Math.abs(hash) % colors.length]
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(timestamp))
}

function formatDay(timestamp) {
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(timestamp))
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
    <h2>Welcome to #shared-room</h2>
    <p>This is the beginning of the shared room. Everyone who visits Bunny RTC is here. Say hello.</p>
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

    const article = document.createElement('div')
    article.className = 'msg'

    const avatar = document.createElement('div')
    avatar.className = 'avatar'
    avatar.style.setProperty('--avatar-color', colorFor(msg.id))
    avatar.textContent = [...msg.name][0]?.toUpperCase() || '?'

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
    article.append(avatar, body)
    ui.messageList.append(article)
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
  ui.cancelName.hidden = !displayName
  ui.dialog.showModal()
  ui.nameInput.focus()
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
      // stays open
    })
    ui.emojiGrid.append(btn)
  }
}

function openEmojiPicker() {
  if (ui.input.disabled) return
  emojiPickerOpen = true
  ui.emojiPicker.hidden = false
}

function closeEmojiPicker() {
  emojiPickerOpen = false
  ui.emojiPicker.hidden = true
}

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
  localStorage.setItem('bunny_rtc_name', displayName)
  ui.dialog.close()
  ui.name.textContent = displayName
  ui.avatar.textContent = [...displayName][0].toUpperCase()
  publish(`${PRESENCE_TOPIC}${selfId}`, { id: selfId, name: displayName, at: Date.now() }, true)
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
ui.avatar.textContent = [...displayName][0].toUpperCase()
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
