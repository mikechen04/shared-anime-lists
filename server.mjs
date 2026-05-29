import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3001

const MAL_COMPLETED = 2
const MAL_PAGE_SIZE = 300
const ANILIST_PAGE_SIZE = 50

const ANILIST_LIST_QUERY = `
query ($name: String, $page: Int) {
  Page(page: $page, perPage: ${ANILIST_PAGE_SIZE}) {
    pageInfo { hasNextPage lastPage }
    mediaList(userName: $name, type: ANIME, status: COMPLETED) {
      score(format: POINT_10)
      media {
        id
        idMal
        title { romaji english }
        siteUrl
        coverImage { medium }
      }
    }
  }
}
`

// same anime on mal + anilist usually share mal id
function getMatchKey(malId, anilistId) {
  if (malId && malId > 0) {
    return 'mal:' + malId
  }
  return 'anilist:' + anilistId
}

function malImageUrl(imagePath) {
  if (!imagePath) return null
  // mal load.json already gives full urls now
  if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
    return imagePath
  }
  if (imagePath.startsWith('/')) {
    return 'https://cdn.myanimelist.net' + imagePath
  }
  return 'https://cdn.myanimelist.net/' + imagePath
}

function makeScoreLabel(platform, username) {
  if (platform === 'anilist') {
    return 'AniList:' + username
  }
  return 'MAL:' + username
}

// strip mal: or anilist: if someone pasted it into the username box
function cleanUsername(username, platform) {
  let name = String(username).trim()

  if (name.toLowerCase().startsWith('anilist:')) {
    name = name.slice(8).trim()
  }
  if (name.toLowerCase().startsWith('mal:')) {
    name = name.slice(4).trim()
  }

  return name
}

function parseUsers(raw) {
  let parts = []

  if (Array.isArray(raw)) {
    parts = raw
  } else if (typeof raw === 'string') {
    parts = raw.split(',')
  }

  const users = []

  for (let i = 0; i < parts.length; i++) {
    const str = String(parts[i]).trim()
    if (!str) continue

    let platform = 'mal'
    let username = str

    if (str.toLowerCase().startsWith('anilist:')) {
      platform = 'anilist'
      username = str.slice(8).trim()
    } else if (str.toLowerCase().startsWith('mal:')) {
      platform = 'mal'
      username = str.slice(4).trim()
    }

    username = cleanUsername(username, platform)
    if (username.length > 0) {
      users.push({ platform, username })
    }
  }

  return users
}

async function fetchMalCompleted(username) {
  username = cleanUsername(username, 'mal')
  const animeMap = new Map()
  let offset = 0
  const scoreLabel = makeScoreLabel('mal', username)

  while (true) {
    const url =
      'https://myanimelist.net/animelist/' +
      encodeURIComponent(username) +
      '/load.json?offset=' +
      offset +
      '&status=' +
      MAL_COMPLETED

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SharedAnimeList/1.0)',
      },
    })

    if (response.status === 404) {
      throw new Error('User "' + username + '" was not found on MyAnimeList.')
    }

    if (!response.ok) {
      if (response.status === 400) {
        throw new Error(
          'Could not load MAL list for "' +
            username +
            '". Check the username and make sure the list is public.'
        )
      }
      throw new Error(
        'Could not load MAL list for "' + username + '" (HTTP ' + response.status + ').'
      )
    }

    const chunk = await response.json()

    if (!Array.isArray(chunk) || chunk.length === 0) {
      break
    }

    for (let i = 0; i < chunk.length; i++) {
      const item = chunk[i]
      const malId = item.anime_id
      const key = getMatchKey(malId, null)

      if (!animeMap.has(key)) {
        animeMap.set(key, {
          match_key: key,
          mal_id: malId,
          anilist_id: null,
          title: item.anime_title,
          english_title: item.anime_title_eng || null,
          image: malImageUrl(item.anime_image_path),
          url: 'https://myanimelist.net' + item.anime_url,
          scores: {},
        })
      }

      animeMap.get(key).scores[scoreLabel] = item.score || 0
    }

    if (chunk.length < MAL_PAGE_SIZE) {
      break
    }

    offset += MAL_PAGE_SIZE
    await sleep(400)
  }

  return animeMap
}

async function fetchAnilistCompleted(username) {
  username = cleanUsername(username, 'anilist')
  const animeMap = new Map()
  const scoreLabel = makeScoreLabel('anilist', username)
  let page = 1
  let hasNext = true

  while (hasNext) {
    const response = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: ANILIST_LIST_QUERY,
        variables: { name: username, page: page },
      }),
    })

    const json = await response.json()

    if (json.errors && json.errors.length > 0) {
      throw new Error(json.errors[0].message || 'AniList API error.')
    }

    const pageData = json.data && json.data.Page

    if (!pageData) {
      throw new Error('User "' + username + '" was not found on AniList.')
    }

    const entries = pageData.mediaList || []

    // first page empty might mean bad username or empty list
    if (page === 1 && entries.length === 0) {
      const check = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: 'query($n:String){User(name:$n){id name}}',
          variables: { n: username },
        }),
      })
      const checkJson = await check.json()
      if (!checkJson.data || !checkJson.data.User) {
        throw new Error('User "' + username + '" was not found on AniList.')
      }
    }

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      const media = entry.media
      if (!media) continue

      const malId = media.idMal || null
      const anilistId = media.id
      const key = getMatchKey(malId, anilistId)

      if (!animeMap.has(key)) {
        const title = media.title.romaji || media.title.english || 'Unknown'
        let url = media.siteUrl
        if (malId && malId > 0) {
          url = 'https://myanimelist.net/anime/' + malId
        }

        animeMap.set(key, {
          match_key: key,
          mal_id: malId && malId > 0 ? malId : null,
          anilist_id: anilistId,
          title: title,
          english_title: media.title.english || null,
          image: media.coverImage ? media.coverImage.medium : null,
          url: url,
          scores: {},
        })
      }

      animeMap.get(key).scores[scoreLabel] = entry.score || 0
    }

    hasNext = pageData.pageInfo && pageData.pageInfo.hasNextPage
    page++

    if (hasNext) {
      await sleep(350)
    }
  }

  return animeMap
}

async function fetchUserList(platform, username) {
  if (platform === 'anilist') {
    return fetchAnilistCompleted(username)
  }
  return fetchMalCompleted(username)
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function intersectLists(lists) {
  let sharedKeys = new Set(lists[0].anime.keys())

  for (let i = 1; i < lists.length; i++) {
    sharedKeys = new Set([...sharedKeys].filter((key) => lists[i].anime.has(key)))
  }

  const shared = []

  sharedKeys.forEach((key) => {
    const base = lists[0].anime.get(key)
    const entry = {
      match_key: base.match_key,
      mal_id: base.mal_id,
      anilist_id: base.anilist_id,
      title: base.title,
      english_title: base.english_title,
      image: base.image,
      url: base.url,
      scores: { ...base.scores },
    }

    for (let i = 1; i < lists.length; i++) {
      const other = lists[i].anime.get(key)
      Object.assign(entry.scores, other.scores)

      if (!entry.mal_id && other.mal_id) entry.mal_id = other.mal_id
      if (!entry.anilist_id && other.anilist_id) entry.anilist_id = other.anilist_id
      if (!entry.image && other.image) entry.image = other.image
    }

    const scoreValues = Object.values(entry.scores).filter((s) => s > 0)
    entry.avg_score =
      scoreValues.length > 0
        ? Math.round((scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length) * 10) / 10
        : null

    shared.push(entry)
  })

  shared.sort((a, b) => String(a.title).localeCompare(String(b.title)))
  return shared
}

app.use(express.json())
app.set('trust proxy', 1)

// let github pages frontend call this api
app.use((req, res, next) => {
  const origin = req.headers.origin
  if (
    origin &&
    (origin.endsWith('.github.io') ||
      origin.includes('localhost') ||
      origin.endsWith('.aheriez.cafe'))
  ) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  }
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204)
  }
  next()
})

// simple rate limit - per ip, resets every minute
const RATE_LIMIT_MAX = 8
const RATE_LIMIT_WINDOW_MS = 60 * 1000
const MAX_USERS_PER_SEARCH = 10
const rateLimitMap = new Map()

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim()
  }
  return req.ip || req.socket.remoteAddress || 'unknown'
}

function rateLimit(req, res, next) {
  const ip = getClientIp(req)
  const now = Date.now()
  let record = rateLimitMap.get(ip)

  if (!record || now > record.resetAt) {
    record = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS }
    rateLimitMap.set(ip, record)
  }

  record.count++

  if (record.count > RATE_LIMIT_MAX) {
    return res.status(429).json({
      error: 'Too many searches. Please wait about a minute and try again.',
    })
  }

  next()
}

// clean up old entries every 5 min so memory doesnt grow forever
setInterval(() => {
  const now = Date.now()
  for (const [ip, record] of rateLimitMap.entries()) {
    if (now > record.resetAt) {
      rateLimitMap.delete(ip)
    }
  }
}, 5 * 60 * 1000)

app.get('/api/health', (req, res) => {
  res.json({ ok: true })
})

app.get('/api/shared', rateLimit, async (req, res) => {
  const users = parseUsers(req.query.users)

  if (users.length < 2) {
    return res.status(400).json({ error: 'Add at least 2 usernames.' })
  }

  if (users.length > MAX_USERS_PER_SEARCH) {
    return res.status(400).json({
      error: 'Maximum ' + MAX_USERS_PER_SEARCH + ' users per search.',
    })
  }

  try {
    const lists = []

    for (let i = 0; i < users.length; i++) {
      const u = users[i]
      const list = await fetchUserList(u.platform, u.username)
      lists.push({
        platform: u.platform,
        username: u.username,
        label: makeScoreLabel(u.platform, u.username),
        anime: list,
      })

      if (i < users.length - 1) {
        await sleep(500)
      }
    }

    const shared = intersectLists(lists)

    const stats = lists.map((l) => ({
      username: l.username,
      platform: l.platform,
      label: l.label,
      completed_count: l.anime.size,
    }))

    // send each user's list so the frontend can toggle checkboxes
    const lists_by_user = lists.map((l) => ({
      label: l.label,
      username: l.username,
      platform: l.platform,
      anime: Array.from(l.anime.values()),
    }))

    res.json({
      users: users.map((u) => ({
        platform: u.platform,
        username: u.username,
        label: makeScoreLabel(u.platform, u.username),
      })),
      stats,
      lists_by_user,
      shared_count: shared.length,
      shared,
    })
  } catch (err) {
    res.status(500).json({ error: err.message || 'Something went wrong.' })
  }
})

const distPath = path.join(__dirname, 'dist')
app.use(express.static(distPath))
app.get('/*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Not found' })
  }
  res.sendFile(path.join(distPath, 'index.html'))
})

app.listen(PORT, () => {
  console.log('API server on http://localhost:' + PORT)
})
