import { Storage } from '@freearhey/storage-js'
import { PlaylistParser } from '../scripts/core'
import { Stream, Playlist } from '../scripts/models'
import { data, loadData } from '../scripts/api'
import { STREAMS_DIR } from '../scripts/constants'
import { Collection } from '@freearhey/core'
import fs from 'node:fs'
import path from 'node:path'
import { eachLimit } from 'async'
import axios from 'axios'


async function checkStreamFast(url: string, timeoutMs: number = 5000, userAgent?: string, referrer?: string): Promise<{ ok: boolean, code: string }> {
  try {
    const headers: any = {
      'User-Agent': userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
    if (referrer) {
      headers['Referer'] = referrer
    }

    // responseType: 'stream' is critical to avoid loading infinite live media data in memory
    const response = await axios.get(url, {
      headers,
      timeout: timeoutMs,
      responseType: 'stream',
      validateStatus: () => true // Allow any HTTP code
    })

    const status = response.status

    // Close the stream connection immediately to prevent background buffering
    if (response.data && typeof response.data.destroy === 'function') {
      response.data.destroy()
    }

    if (status === 403) {
      return { ok: false, code: 'HTTP_403_FORBIDDEN' }
    }
    if (status >= 400) {
      return { ok: false, code: `HTTP_${status}` }
    }

    return { ok: true, code: 'OK' }
  } catch (err: any) {
    let code = 'ERROR'
    if (err.code) {
      code = err.code
    } else if (err.message && err.message.includes('timeout')) {
      code = 'TIMEOUT'
    }
    return { ok: false, code }
  }
}

async function main() {
  console.log('Loading API data...')
  try {
    await loadData()
    console.log('API data loaded successfully.')
  } catch (error) {
    console.warn('Warning: Could not load API data from disk. Continuing without full metadata.', error)
  }

  console.log('Loading streams from streams/ directory...')
  const streamsStorage = new Storage(STREAMS_DIR)
  const parser = new PlaylistParser({
    storage: streamsStorage
  })
  
  const files = await streamsStorage.list('**/*.m3u')
  const streams = await parser.parse(files)
  console.log(`Found ${streams.count()} total streams in repository.`)

  // Load custom/config.json if it exists
  const configJsonPath = path.join(__dirname, 'config.json')
  let excludeGlobal = false
  let preferredLanguages: string[] = []
  let categoryOrder: string[] = []
  let excludeLanguages: string[] = []
  let excludeCountries: string[] = []
  let excludeChannels: string[] = []
  let excludeDead = false
  let excludeNoUrl = false
  let excludeClosed = false
  let sortBy = 'default'

  if (fs.existsSync(configJsonPath)) {
    try {
      const configData = JSON.parse(fs.readFileSync(configJsonPath, 'utf8'))
      excludeGlobal = !!configData.excludeGlobal
      if (Array.isArray(configData.preferredLanguages)) {
        preferredLanguages = configData.preferredLanguages.map((l: string) => l.trim().toLowerCase())
      }
      if (Array.isArray(configData.categoryOrder)) {
        categoryOrder = configData.categoryOrder.map((c: string) => c.trim().toLowerCase())
      }
      if (Array.isArray(configData.excludeLanguages)) {
        excludeLanguages = configData.excludeLanguages.map((l: string) => l.trim().toLowerCase())
      }
      if (Array.isArray(configData.excludeCountries)) {
        excludeCountries = configData.excludeCountries.map((c: string) => c.trim().toLowerCase())
      }
      if (Array.isArray(configData.excludeChannels)) {
        excludeChannels = configData.excludeChannels.map((ch: string) => ch.trim().toLowerCase())
      }
      excludeDead = !!configData.excludeDead
      excludeNoUrl = !!configData.excludeNoUrl
      excludeClosed = !!configData.excludeClosed
      if (configData.sortBy) {
        sortBy = configData.sortBy
      }
    } catch (e) {
      console.error('Error reading custom/config.json:', e)
    }
  }

  // Load cached stream status JSON files
  const cachedStatuses = new Map<string, { working: boolean, status: string }>()
  const cachedStreamStatuses: Record<string, { status_icon: string, status_text: string }> = {}
  
  const loadCacheFile = (filePath: string) => {
    if (fs.existsSync(filePath)) {
      try {
        const cacheData = JSON.parse(fs.readFileSync(filePath, 'utf8'))
        if (Array.isArray(cacheData)) {
          for (const item of cacheData) {
            if (item.url) {
              cachedStatuses.set(item.url, { working: !!item.working, status: item.status || '' })
            }
          }
        }
      } catch (e) {
        console.error(`Error reading cache file ${filePath}:`, e)
      }
    }
  }

  loadCacheFile(path.join(__dirname, 'status.json'))
  
  const streamStatusPath = path.join(__dirname, '..', 'gui', 'cache', 'stream_status.json')
  if (fs.existsSync(streamStatusPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(streamStatusPath, 'utf8'))
      Object.assign(cachedStreamStatuses, data)
    } catch (e) {
      console.error('Error reading cached stream status:', e)
    }
  }

  // Read selected channels from configuration
  const configPath = path.join(__dirname, 'selected-channels.txt')
  if (!fs.existsSync(configPath)) {
    console.warn('custom/selected-channels.txt not found. Creating empty file.');
    try {
      fs.writeFileSync(configPath, '# Add channel tvg-ids or exact channel names to include or exclude in your custom playlist.\n# Prefix rules with - to always exclude them.\n', 'utf8');
    } catch (e) {
      console.error('Failed to create custom/selected-channels.txt:', e);
    }
  }

  const lines = fs.readFileSync(configPath, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))

  console.log(`Loaded ${lines.length} rules/selections from config.`)

  // Split inclusions and exclusions
  const exactInclusions = new Set<string>()
  const regexInclusions: RegExp[] = []
  const exactExclusions = new Set<string>()
  const regexExclusions: RegExp[] = []

  for (const rule of lines) {
    const isExclude = rule.startsWith('-')
    const cleanRule = isExclude ? rule.slice(1).trim() : rule
    if (!cleanRule) continue

    if (cleanRule.startsWith('/') && cleanRule.endsWith('/')) {
      try {
        const pattern = cleanRule.slice(1, -1)
        const regex = new RegExp(pattern, 'i')
        if (isExclude) {
          regexExclusions.push(regex)
        } else {
          regexInclusions.push(regex)
        }
      } catch (e) {
        console.error(`Invalid regex rule: ${rule}`, e)
      }
    } else {
      if (isExclude) {
        exactExclusions.add(cleanRule)
        if (cleanRule.includes('@')) {
          const base = cleanRule.split('@')[0]
          if (base) {
            exactExclusions.add(base)
          }
        }
      } else {
        exactInclusions.add(cleanRule)
        if (cleanRule.includes('@')) {
          const base = cleanRule.split('@')[0]
          if (base) {
            exactInclusions.add(base)
          }
        }
      }
    }
  }

  // Filter the streams collection
  const filteredStreams = streams.filter((stream: Stream) => {
    const tvgId = stream.getTvgId()
    const title = stream.title
    const fullTitle = stream.getFullTitle()
    const id = stream.getId()
    const tvgIdBase = tvgId ? tvgId.split('@')[0] : ''
    const idBase = id ? id.split('@')[0] : ''

    const channel = stream.getChannel()
    const countryCode = channel ? channel.country?.toLowerCase() : ''
    const countryObj = countryCode ? data.countriesKeyByCode.get(countryCode.toUpperCase()) : null
    const countryName = countryObj ? countryObj.name.toLowerCase() : ''

    if (excludeNoUrl && (!stream.url || !stream.url.trim())) {
      return false
    }
    if (excludeClosed && channel && channel.closed) {
      return false
    }

    // A. Check explicit exclusions first (from selected-channels.txt)
    const matchesExactExclusion =
      (tvgId && exactExclusions.has(tvgId)) ||
      (id && exactExclusions.has(id)) ||
      (title && exactExclusions.has(title)) ||
      (fullTitle && exactExclusions.has(fullTitle)) ||
      (tvgIdBase && exactExclusions.has(tvgIdBase)) ||
      (idBase && exactExclusions.has(idBase)) ||
      Array.from(exactExclusions).some(rule => {
        const rLower = rule.toLowerCase()
        const langMatch = stream.getLanguages().all().some((l: any) => l.name.toLowerCase() === rLower || l.code.toLowerCase() === rLower)
        const catMatch = stream.getCategories() ? stream.getCategories().all().some((c: any) => c.name.toLowerCase() === rLower) : false
        const countryMatch = countryCode === rLower || countryName === rLower
        return langMatch || catMatch || countryMatch
      })

    if (matchesExactExclusion) {
      return false
    }

    if (
      regexExclusions.some(regex =>
        (tvgId && regex.test(tvgId)) ||
        (title && regex.test(title)) ||
        (fullTitle && regex.test(fullTitle)) ||
        (id && regex.test(id)) ||
        stream.getLanguages().all().some((l: any) => regex.test(l.name) || regex.test(l.code)) ||
        (stream.getCategories() ? stream.getCategories().all().some((c: any) => regex.test(c.name)) : false) ||
        (countryCode && regex.test(countryCode)) ||
        (countryName && regex.test(countryName))
      )
    ) {
      return false
    }

    // B. Check config.json always-exclude channels list
    if (excludeChannels.length > 0) {
      const matchExcludeChannel = excludeChannels.some((pattern: string) => 
        (tvgId && tvgId.toLowerCase().includes(pattern)) ||
        (id && id.toLowerCase().includes(pattern)) ||
        (title && title.toLowerCase().includes(pattern)) ||
        (fullTitle && fullTitle.toLowerCase().includes(pattern))
      )
      if (matchExcludeChannel) {
        return false
      }
    }

    // C. Exclude global channels if requested
    if (excludeGlobal && stream.isInternational()) {
      return false
    }

    // D. Exclude languages if requested
    if (excludeLanguages.length > 0) {
      const streamLangs = stream.getLanguages().all().map((l: any) => l.name.toLowerCase())
      const streamLangCodes = stream.getLanguages().all().map((l: any) => l.code.toLowerCase())
      const hasExcludedLang = streamLangs.some((name: string) => excludeLanguages.includes(name)) ||
                            streamLangCodes.some((code: string) => excludeLanguages.includes(code))
      if (hasExcludedLang) {
        return false
      }
    }

    // E. Exclude countries if requested
    if (excludeCountries.length > 0) {
      const hasExcludedCountry = (countryCode && excludeCountries.includes(countryCode)) || 
                                (countryName && excludeCountries.includes(countryName))
      if (hasExcludedCountry) {
        return false
      }
    }

    // F. Check Inclusions
    const matchesInclusion = (
      (tvgId && exactInclusions.has(tvgId)) ||
      (id && exactInclusions.has(id)) ||
      (title && exactInclusions.has(title)) ||
      (fullTitle && exactInclusions.has(fullTitle)) ||
      (tvgIdBase && exactInclusions.has(tvgIdBase)) ||
      (idBase && exactInclusions.has(idBase)) ||
      Array.from(exactInclusions).some(rule => {
        const rLower = rule.toLowerCase()
        const langMatch = stream.getLanguages().all().some((l: any) => l.name.toLowerCase() === rLower || l.code.toLowerCase() === rLower)
        const catMatch = stream.getCategories() ? stream.getCategories().all().some((c: any) => c.name.toLowerCase() === rLower) : false
        const countryMatch = countryCode === rLower || countryName === rLower
        return langMatch || catMatch || countryMatch
      }) ||
      regexInclusions.some(regex =>
        (tvgId && regex.test(tvgId)) ||
        (title && regex.test(title)) ||
        (fullTitle && regex.test(fullTitle)) ||
        (id && regex.test(id)) ||
        stream.getLanguages().all().some((l: any) => regex.test(l.name) || regex.test(l.code)) ||
        (stream.getCategories() ? stream.getCategories().all().some((c: any) => regex.test(c.name)) : false) ||
        (countryCode && regex.test(countryCode)) ||
        (countryName && regex.test(countryName))
      )
    )

    return matchesInclusion
  })

  console.log(`Filtered down to ${filteredStreams.count()} matching streams.`)

  if (filteredStreams.count() === 0) {
    console.warn('Warning: No channels matched your selected list!')
  }

  // Helper functions for Language & Category prioritization
  const getPrimaryLanguageName = (stream: Stream): string => {
    const langs = stream.getLanguages()
    return langs.isEmpty() ? 'Undefined' : langs.first().name
  }

  const getPrimaryCategory = (stream: Stream): string => {
    const categories = stream.getCategories()
    if (!categories || categories.isEmpty()) return 'Undefined'
    
    let bestCat = categories.first().name
    let bestScore = 9999
    
    categories.forEach((c: any) => {
      const idx = categoryOrder.indexOf(c.name.toLowerCase())
      if (idx !== -1 && idx < bestScore) {
        bestScore = idx
        bestCat = c.name
      }
    })
    
    return bestCat
  }

  const getLanguageScore = (stream: Stream): number => {
    const langs = stream.getLanguages()
    if (langs.isEmpty()) return 9999
    
    for (let i = 0; i < preferredLanguages.length; i++) {
      const prefLang = preferredLanguages[i]
      const hasLang = langs.all().some((l: any) => l.name.toLowerCase() === prefLang || l.code.toLowerCase() === prefLang)
      if (hasLang) return i
    }
    
    return 1000
  }

  const getCategoryScore = (stream: Stream): number => {
    const categories = stream.getCategories()
    if (!categories || categories.isEmpty()) return 9999
    
    for (let i = 0; i < categoryOrder.length; i++) {
      const prefCat = categoryOrder[i]
      const hasCat = categories.all().some((c: any) => c.name.toLowerCase() === prefCat)
      if (hasCat) return i
    }
    
    return 1000
  }


  // Convert filteredStreams collection to array
  let streamsArray = Array.isArray(filteredStreams) ? filteredStreams : (filteredStreams as any).all()

  // Track active check results
  const activeCheckResults = new Map<string, { ok: boolean, code: string }>()

  // Keep a copy of the list of streams before dead exclusion, for the status report
  const originalStreamsForStatus = [...streamsArray]

  // Filter out dead/aborted streams if excludeDead is enabled
  if (excludeDead) {
    if (process.argv.includes('--no-check')) {
      console.log('Excluding dead streams using cached status records...')
      streamsArray = streamsArray.filter((stream: Stream) => {
        // 1. Check custom/status.json cache
        const cacheRecord = cachedStatuses.get(stream.url)
        if (cacheRecord) {
          if (!cacheRecord.working || cacheRecord.status === 'ECONNABORTED' || cacheRecord.status === 'TIMEOUT' || cacheRecord.status === 'ERROR') {
            console.log(`Excluding dead stream (cached status.json): ${stream.title} (${stream.url})`)
            return false
          }
        }
        // 2. Check gui/cache/stream_status.json cache
        const tvgId = stream.getTvgId()
        const id = stream.getId()
        const statusRecord = (tvgId ? cachedStreamStatuses[tvgId] : null) || (id ? cachedStreamStatuses[id] : null)
        if (statusRecord) {
          if (statusRecord.status_text === 'Dead' || statusRecord.status_icon === '❌') {
            console.log(`Excluding dead stream (cached stream_status.json): ${stream.title} (${tvgId || id})`)
            return false
          }
        }
        return true
      })
    } else {
      console.log('Testing stream availability before writing playlist...')
      const checkedStreams: Stream[] = []
      await new Promise<void>((resolve) => {
        eachLimit(
          streamsArray,
          15, // Test 15 streams concurrently
          async (stream: Stream) => {
            try {
              const res = await checkStreamFast(stream.url, 5000, stream.user_agent, stream.referrer)
              activeCheckResults.set(stream.url, res)
              if (res.ok) {
                checkedStreams.push(stream)
              } else {
                console.log(`Excluding dead stream (active check failed: ${res.code}): ${stream.title} (${stream.url})`)
              }
            } catch (e) {
              const res = { ok: false, code: 'ERROR' }
              activeCheckResults.set(stream.url, res)
              console.log(`Excluding dead stream (active check error): ${stream.title} (${stream.url})`)
            }
          },
          (err) => {
            resolve()
          }
        )
      })
      streamsArray = checkedStreams
    }
  }

  // Helper function for sorting custom order based on selected-channels.txt index
  const getCustomSortIndex = (stream: Stream): number => {
    const tvgId = stream.getTvgId()
    const title = stream.title
    const fullTitle = stream.getFullTitle()
    const id = stream.getId()
    const tvgIdBase = tvgId ? tvgId.split('@')[0] : ''
    const idBase = id ? id.split('@')[0] : ''

    const channel = stream.getChannel()
    const countryCode = channel ? channel.country?.toLowerCase() : ''
    const countryObj = countryCode ? data.countriesKeyByCode.get(countryCode.toUpperCase()) : null
    const countryName = countryObj ? countryObj.name.toLowerCase() : ''

    for (let i = 0; i < lines.length; i++) {
      const rule = lines[i]
      if (rule.startsWith('-')) continue
      const cleanRule = rule.trim()
      if (!cleanRule) continue

      if (cleanRule.startsWith('/') && cleanRule.endsWith('/')) {
        try {
          const pattern = cleanRule.slice(1, -1)
          const regex = new RegExp(pattern, 'i')
          const matched = (tvgId && regex.test(tvgId)) ||
                          (title && regex.test(title)) ||
                          (fullTitle && regex.test(fullTitle)) ||
                          (id && regex.test(id)) ||
                          stream.getLanguages().all().some((l: any) => regex.test(l.name) || regex.test(l.code)) ||
                          (stream.getCategories() ? stream.getCategories().all().some((c: any) => regex.test(c.name)) : false) ||
                          (countryCode && regex.test(countryCode)) ||
                          (countryName && regex.test(countryName))
          if (matched) return i
        } catch (e) {}
      } else {
        const rLower = cleanRule.toLowerCase()
        const isTvgIdMatch = tvgId === cleanRule || tvgIdBase === cleanRule
        const isIdMatch = id === cleanRule || idBase === cleanRule
        const isTitleMatch = title === cleanRule || fullTitle === cleanRule
        const langMatch = stream.getLanguages().all().some((l: any) => l.name.toLowerCase() === rLower || l.code.toLowerCase() === rLower)
        const catMatch = stream.getCategories() ? stream.getCategories().all().some((c: any) => c.name.toLowerCase() === rLower) : false
        const countryMatch = countryCode === rLower || countryName === rLower

        if (isTvgIdMatch || isIdMatch || isTitleMatch || langMatch || catMatch || countryMatch) {
          return i
        }
      }
    }

    return 999999
  }

  // Map and sort streams, assign group titles based on categories
  const mappedStreams = streamsArray.map((stream: Stream) => {
    const langName = getPrimaryLanguageName(stream)
    const catName = getPrimaryCategory(stream)
    stream.groupTitle = langName !== 'Undefined' ? `${langName} - ${catName}` : catName
    return stream
  })

  // Sort streams array
  if (sortBy === 'custom') {
    console.log('Sorting custom playlist by manual order...')
    mappedStreams.sort((a: Stream, b: Stream) => {
      const idxA = getCustomSortIndex(a)
      const idxB = getCustomSortIndex(b)
      if (idxA !== idxB) return idxA - idxB
      return a.title.localeCompare(b.title) // fallback
    })
  } else {
    mappedStreams.sort((a: Stream, b: Stream) => {
      // 1. Preferred Languages
      const scoreLangA = getLanguageScore(a)
      const scoreLangB = getLanguageScore(b)
      if (scoreLangA !== scoreLangB) return scoreLangA - scoreLangB
      
      // 2. Language Name
      const langA = getPrimaryLanguageName(a)
      const langB = getPrimaryLanguageName(b)
      if (langA !== langB) return langA.localeCompare(langB)
      
      // 3. Preferred Categories
      const scoreCatA = getCategoryScore(a)
      const scoreCatB = getCategoryScore(b)
      if (scoreCatA !== scoreCatB) return scoreCatA - scoreCatB
      
      // 4. Category Name
      const catA = getPrimaryCategory(a)
      const catB = getPrimaryCategory(b)
      if (catA !== catB) return catA.localeCompare(catB)
      
      // 5. Title
      return a.title.localeCompare(b.title)
    })
  }

  const sortedCollection = new Collection<Stream>(mappedStreams)
  const playlist = new Playlist(sortedCollection, { public: true })
  
  const outputPath = path.join(__dirname, 'custom.m3u')
  fs.writeFileSync(outputPath, playlist.toString())
  console.log(`Successfully generated custom playlist with ${playlist.streams.count()} streams at: ${outputPath}`)

  if (process.argv.includes('--no-check')) {
    console.log('Skipping stream status check due to --no-check flag.')
    return
  }

  console.log('Testing streams status...')
  const results: any[] = []

  await new Promise<void>((resolve) => {
    eachLimit(
      originalStreamsForStatus,
      15, // Test 15 streams concurrently
      async (stream: Stream) => {
        if (activeCheckResults.has(stream.url)) {
          const res = activeCheckResults.get(stream.url)!
          results.push({
            name: stream.title,
            id: stream.getId(),
            tvg_id: stream.getTvgId(),
            url: stream.url,
            status: res.code,
            working: res.ok,
            checked_at: new Date().toISOString()
          })
          return
        }
        try {
          const res = await checkStreamFast(stream.url, 5000, stream.user_agent, stream.referrer)
          results.push({
            name: stream.title,
            id: stream.getId(),
            tvg_id: stream.getTvgId(),
            url: stream.url,
            status: res.code,
            working: res.ok,
            checked_at: new Date().toISOString()
          })
        } catch (e) {
          results.push({
            name: stream.title,
            id: stream.getId(),
            tvg_id: stream.getTvgId(),
            url: stream.url,
            status: 'ERROR',
            working: false,
            checked_at: new Date().toISOString()
          })
        }
      },
      (err) => {
        resolve()
      }
    )
  })

  // Sort results by name
  results.sort((a, b) => a.name.localeCompare(b.name))

  // Write status.json
  const statusJsonPath = path.join(__dirname, 'status.json')
  fs.writeFileSync(statusJsonPath, JSON.stringify(results, null, 2))
  console.log(`Saved stream status JSON at: ${statusJsonPath}`)

  // Write status.md
  const statusMdPath = path.join(__dirname, 'status.md')
  let mdContent = `# IPTV Stream Status Report\n\n`
  mdContent += `Last checked: \`${new Date().toISOString()}\`\n\n`
  mdContent += `| Status | Channel Name | tvg-id | Stream URL | Code |\n`
  mdContent += `| --- | --- | --- | --- | --- |\n`
  
  const escapeMarkdown = (text: string) => text ? text.replace(/\|/g, '\\|') : '';

  for (const r of results) {
    const statusIcon = r.working ? '✅' : '❌'
    mdContent += `| ${statusIcon} | ${escapeMarkdown(r.name)} | ${escapeMarkdown(r.tvg_id || 'N/A')} | \`${escapeMarkdown(r.url)}\` | ${escapeMarkdown(r.status)} |\n`
  }
  fs.writeFileSync(statusMdPath, mdContent)
  console.log(`Saved stream status Markdown at: ${statusMdPath}`)
}

main().catch(err => {
  console.error('Fatal error during custom playlist generation:', err)
  process.exit(1)
})
