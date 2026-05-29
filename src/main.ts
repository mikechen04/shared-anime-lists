import './style.css'

// empty on cloud run (same host). set on github pages build to your cloud run url
const API_BASE = import.meta.env.VITE_API_URL || ''
const BASE = import.meta.env.BASE_URL || '/'

type Platform = 'mal' | 'anilist'

type UserInput = {
  platform: Platform
  username: string
}

type SharedAnime = {
  match_key: string
  mal_id: number | null
  anilist_id: number | null
  title: string
  english_title: string | null
  image: string | null
  url: string
  scores: Record<string, number>
  avg_score: number | null
}

type UserListData = {
  label: string
  username: string
  platform: Platform
  anime: SharedAnime[]
}

type ApiResult = {
  users: { platform: Platform; username: string; label: string }[]
  stats: { username: string; platform: Platform; label: string; completed_count: number }[]
  lists_by_user: UserListData[]
  shared_count: number
  shared: SharedAnime[]
}

let loadedLists: UserListData[] = []

const app = document.querySelector<HTMLDivElement>('#app')!

app.innerHTML = `
<div class="page">
  <header class="header">
    <div class="logo">
      <div class="logo-icon">共</div>
      <span>SharedAnime</span>
    </div>
    <span class="header-note">myanimelist & anilist compatible</span>
  </header>

  <section class="hero">
    <h1>see anime everyone <span>has completed</span></h1>
    <p>add a mix of myanimelist + anilist users. it'll calculate shows that appears on everyone's list.</p>
  </section>

  <div class="input-card">
    <div class="input-label">Usernames</div>
    <div class="user-rows" id="user-rows"></div>
    <button type="button" class="add-user-btn" id="add-user">+ Add another user</button>
  </div>

  <button type="button" class="cta-btn" id="find-btn">find shared anime →</button>
  <div id="status-msg"></div>

  <div class="dashboard-wrap" id="results">
    <div class="browser-frame">
      <div class="browser-top">
        <span class="dot red"></span>
        <span class="dot yellow"></span>
        <span class="dot green"></span>
        <span class="breadcrumb">SharedAnime / Results</span>
      </div>
      <div class="browser-body">
        <div class="stats-row" id="stats-row"></div>
        <div class="compare-section">
          <h3>compare users</h3>
          <div class="user-checkboxes" id="user-checkboxes"></div>
          <div class="mutual-box" id="mutual-simple-list"></div>
        </div>
        <div class="results-section">
          <h3>details</h3>
          <div class="anime-list" id="anime-list"></div>
        </div>
      </div>
    </div>
  </div>

  <footer class="site-footer">
    <p>not affiliated with MyAnimeList or AniList</p>
    <p><a href="${BASE}privacy.html">privacy policy</a></p>
  </footer>
</div>
`

const userRows = document.querySelector<HTMLDivElement>('#user-rows')!
const addUserBtn = document.querySelector<HTMLButtonElement>('#add-user')!
const findBtn = document.querySelector<HTMLButtonElement>('#find-btn')!
const statusMsg = document.querySelector<HTMLDivElement>('#status-msg')!
const resultsWrap = document.querySelector<HTMLDivElement>('#results')!
const statsRow = document.querySelector<HTMLDivElement>('#stats-row')!
const userCheckboxes = document.querySelector<HTMLDivElement>('#user-checkboxes')!
const mutualSimpleList = document.querySelector<HTMLDivElement>('#mutual-simple-list')!
const animeList = document.querySelector<HTMLDivElement>('#anime-list')!

function addUserRow(platform: Platform = 'mal', value = '') {
  const row = document.createElement('div')
  row.className = 'user-row'
  row.innerHTML = `
    <select class="platform-select" aria-label="platform">
      <option value="mal" ${platform === 'mal' ? 'selected' : ''}>MAL</option>
      <option value="anilist" ${platform === 'anilist' ? 'selected' : ''}>AniList</option>
    </select>
    <input type="text" placeholder="username" value="${value}" autocomplete="off" />
    <button type="button" class="remove-btn" title="remove">×</button>
  `

  const removeBtn = row.querySelector<HTMLButtonElement>('.remove-btn')!
  removeBtn.addEventListener('click', () => {
    if (userRows.children.length <= 2) return
    row.remove()
    updateRemoveButtons()
  })

  userRows.appendChild(row)
  updateRemoveButtons()
}

function updateRemoveButtons() {
  const rows = userRows.querySelectorAll('.user-row')
  rows.forEach((row) => {
    const btn = row.querySelector<HTMLButtonElement>('.remove-btn')!
    if (rows.length <= 2) {
      btn.classList.add('hidden')
    } else {
      btn.classList.remove('hidden')
    }
  })
}

function cleanUsernameInput(raw: string): string {
  let name = raw.trim()
  if (name.toLowerCase().startsWith('anilist:')) {
    name = name.slice(8).trim()
  }
  if (name.toLowerCase().startsWith('mal:')) {
    name = name.slice(4).trim()
  }
  return name
}

function getUsers(): UserInput[] {
  const rows = userRows.querySelectorAll('.user-row')
  const users: UserInput[] = []

  rows.forEach((row) => {
    const platform = row.querySelector<HTMLSelectElement>('.platform-select')!.value as Platform
    const username = cleanUsernameInput(row.querySelector<HTMLInputElement>('input')!.value)
    if (username) {
      users.push({ platform, username })
    }
  })

  return users
}

function showStatus(text: string, isError = false) {
  statusMsg.className = isError ? 'error-msg' : 'loading-msg'
  statusMsg.textContent = text
}

function getCheckedLabels(): string[] {
  const labels: string[] = []
  const boxes = userCheckboxes.querySelectorAll<HTMLInputElement>('input[type=checkbox]')
  boxes.forEach((box) => {
    if (box.checked) labels.push(box.value)
  })
  return labels
}

function intersectSelected(lists: UserListData[], selectedLabels: string[]): SharedAnime[] {
  if (selectedLabels.length < 2) return []

  const picked: UserListData[] = []
  for (let i = 0; i < lists.length; i++) {
    if (selectedLabels.indexOf(lists[i].label) >= 0) {
      picked.push(lists[i])
    }
  }

  if (picked.length < 2) return []

  const keySets: Set<string>[] = []
  for (let i = 0; i < picked.length; i++) {
    const keys = new Set<string>()
    for (let j = 0; j < picked[i].anime.length; j++) {
      keys.add(picked[i].anime[j].match_key)
    }
    keySets.push(keys)
  }

  let sharedKeys = keySets[0]
  for (let i = 1; i < keySets.length; i++) {
    const next = new Set<string>()
    sharedKeys.forEach((key) => {
      if (keySets[i].has(key)) next.add(key)
    })
    sharedKeys = next
  }

  const shared: SharedAnime[] = []
  const firstMap = new Map<string, SharedAnime>()
  for (let i = 0; i < picked[0].anime.length; i++) {
    firstMap.set(picked[0].anime[i].match_key, picked[0].anime[i])
  }

  sharedKeys.forEach((key) => {
    const base = firstMap.get(key)
    if (!base) return

    const entry: SharedAnime = {
      match_key: base.match_key,
      mal_id: base.mal_id,
      anilist_id: base.anilist_id,
      title: base.title,
      english_title: base.english_title,
      image: base.image,
      url: base.url,
      scores: { ...base.scores },
      avg_score: base.avg_score,
    }

    for (let i = 1; i < picked.length; i++) {
      for (let j = 0; j < picked[i].anime.length; j++) {
        if (picked[i].anime[j].match_key === key) {
          const other = picked[i].anime[j]
          Object.assign(entry.scores, other.scores)
          if (!entry.mal_id && other.mal_id) entry.mal_id = other.mal_id
          if (!entry.anilist_id && other.anilist_id) entry.anilist_id = other.anilist_id
          if (!entry.image && other.image) entry.image = other.image
        }
      }
    }

    const scoreValues: number[] = []
    for (const label in entry.scores) {
      if (entry.scores[label] > 0) scoreValues.push(entry.scores[label])
    }
    entry.avg_score =
      scoreValues.length > 0
        ? Math.round((scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length) * 10) / 10
        : null

    shared.push(entry)
  })

  shared.sort((a, b) => String(a.title).localeCompare(String(b.title)))
  return shared
}

function renderMutualLists(shared: SharedAnime[]) {
  if (shared.length === 0) {
    mutualSimpleList.innerHTML =
      '<div class="mutual-empty">no shared anime for the selected users (need at least 2 checked)</div>'
    animeList.innerHTML = '<div class="empty-state">nothing in common for this group</div>'
    return
  }

  let simpleHtml = ''
  for (let i = 0; i < shared.length; i++) {
    simpleHtml += '<div class="mutual-line">' + shared[i].title + '</div>'
  }
  mutualSimpleList.innerHTML = simpleHtml

  renderAnimeCards(shared)
}

function renderAnimeCards(shared: SharedAnime[]) {
  let listHtml = ''
  for (let i = 0; i < shared.length; i++) {
    const anime = shared[i]
    const img = anime.image
      ? `<img src="${anime.image}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none';this.nextElementSibling?.classList.remove('hidden');" /><div class="no-img hidden"></div>`
      : `<div class="no-img"></div>`

    const eng = anime.english_title ? `<div class="eng">${anime.english_title}</div>` : ''

    const scoreParts: string[] = []
    for (const user in anime.scores) {
      const sc = anime.scores[user]
      if (sc > 0) scoreParts.push(user + ': ' + sc)
    }

    const barWidth = anime.avg_score ? (anime.avg_score / 10) * 100 : 0
    const avgText = anime.avg_score ? anime.avg_score + '/10' : 'N/A'

    let links = ''
    if (anime.mal_id) {
      links += `<a class="mini-link" href="https://myanimelist.net/anime/${anime.mal_id}" target="_blank" rel="noopener">MAL</a>`
    }
    if (anime.anilist_id) {
      links += `<a class="mini-link" href="https://anilist.co/anime/${anime.anilist_id}" target="_blank" rel="noopener">AniList</a>`
    }

    listHtml += `
      <div class="anime-item">
        ${img}
        <div class="anime-info">
          <a href="${anime.url}" target="_blank" rel="noopener">${anime.title}</a>
          ${eng}
          <div class="link-row">${links}</div>
        </div>
        <div class="anime-score">
          <div class="avg">${avgText}</div>
          <div class="detail">${scoreParts.join(' · ')}</div>
          <div class="score-bar-wrap">
            <div class="score-bar"><div class="score-bar-fill" style="width:${barWidth}%"></div></div>
          </div>
        </div>
      </div>
    `
  }

  animeList.innerHTML = listHtml
}

function updateFromCheckboxes() {
  const selected = getCheckedLabels()
  const shared = intersectSelected(loadedLists, selected)

  const countCard = statsRow.querySelector('.shared-count-value')
  if (countCard) {
    countCard.textContent = String(shared.length)
  }

  renderMutualLists(shared)
}

function buildUserCheckboxes() {
  userCheckboxes.innerHTML = ''

  for (let i = 0; i < loadedLists.length; i++) {
    const u = loadedLists[i]
    const label = document.createElement('label')
    label.className = 'user-check'
    label.innerHTML =
      '<input type="checkbox" value="' +
      u.label +
      '" checked /> ' +
      u.username

    const box = label.querySelector('input')!
    box.addEventListener('change', () => {
      const checked = getCheckedLabels()
      if (checked.length < 2) {
        box.checked = true
        showStatus('keep at least 2 users checked', true)
        return
      }
      statusMsg.textContent = ''
      updateFromCheckboxes()
    })

    userCheckboxes.appendChild(label)
  }
}

function renderResults(data: ApiResult) {
  resultsWrap.classList.add('visible')
  loadedLists = data.lists_by_user || []

  const userLabels = data.users.map((u) => u.label).join(', ')

  let statsHtml = `
    <div class="stat-card">
      <div class="label">Shared anime</div>
      <div class="value shared-count-value">${data.shared_count}</div>
      <div class="sub">checked users only</div>
    </div>
    <div class="stat-card">
      <div class="label">Users compared</div>
      <div class="value">${data.users.length}</div>
      <div class="sub">${userLabels}</div>
    </div>
  `

  data.stats.forEach((s) => {
    const tag = s.platform === 'anilist' ? 'AniList' : 'MAL'
    statsHtml += `
      <div class="stat-card">
        <div class="label">${s.username} <span class="platform-tag">${tag}</span></div>
        <div class="value">${s.completed_count}</div>
        <div class="sub">completed</div>
      </div>
    `
  })

  statsRow.innerHTML = statsHtml

  buildUserCheckboxes()
  renderMutualLists(data.shared)
}

async function findShared() {
  const users = getUsers()

  if (users.length < 2) {
    showStatus('Enter at least 2 usernames.', true)
    return
  }

  if (users.length > 10) {
    showStatus('Maximum 10 users per search.', true)
    return
  }

  findBtn.disabled = true
  showStatus('Loading lists… big lists can take a minute.')

  const params = new URLSearchParams()
  users.forEach((u) => {
    params.append('users', u.platform + ':' + u.username)
  })

  try {
    const res = await fetch(API_BASE + '/api/shared?' + params.toString())
    const data = await res.json()

    if (!res.ok) {
      showStatus(data.error || 'Request failed.', true)
      return
    }

    statusMsg.textContent = ''
    renderResults(data as ApiResult)
  } catch {
    showStatus('Could not reach the server. Run npm run dev.', true)
  } finally {
    findBtn.disabled = false
  }
}

addUserBtn.addEventListener('click', () => {
  if (userRows.children.length >= 10) {
    showStatus('Maximum 10 users per search.', true)
    return
  }
  addUserRow()
})
findBtn.addEventListener('click', findShared)

addUserRow('mal')
addUserRow('anilist')
