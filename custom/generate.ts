import { Storage } from '@freearhey/storage-js'
import { PlaylistParser } from '../scripts/core'
import { Stream, Playlist } from '../scripts/models'
import { loadData } from '../scripts/api'
import { STREAMS_DIR } from '../scripts/constants'
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

  // Read selected channels from configuration
  const configPath = path.join(__dirname, 'selected-channels.txt')
  if (!fs.existsSync(configPath)) {
    console.error('Error: custom/selected-channels.txt not found!')
    process.exit(1)
  }

  const lines = fs.readFileSync(configPath, 'utf8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))

  console.log(`Loaded ${lines.length} rules/selections from config.`)

  // Optimize rule lookup by splitting exact and regex rules
  const exactRules = new Set<string>()
  const regexRules: RegExp[] = []

  for (const rule of lines) {
    if (rule.startsWith('/') && rule.endsWith('/')) {
      try {
        const pattern = rule.slice(1, -1)
        regexRules.push(new RegExp(pattern, 'i'))
      } catch (e) {
        console.error(`Invalid regex rule: ${rule}`, e)
      }
    } else {
      exactRules.add(rule)
      if (rule.includes('@')) {
        exactRules.add(rule.split('@')[0])
      }
    }
  }

  // Filter the streams collection (O(1) lookups for exact matches)
  const filteredStreams = streams.filter((stream: Stream) => {
    const tvgId = stream.getTvgId()
    const title = stream.title
    const fullTitle = stream.getFullTitle()
    const id = stream.getId()

    // 1. Fast Set lookups
    if (
      (tvgId && exactRules.has(tvgId)) ||
      (id && exactRules.has(id)) ||
      (title && exactRules.has(title)) ||
      (fullTitle && exactRules.has(fullTitle)) ||
      (tvgId && exactRules.has(tvgId.split('@')[0])) ||
      (id && exactRules.has(id.split('@')[0]))
    ) {
      return true
    }

    // 2. Fallback to Regex list search
    return regexRules.some(regex => 
      (tvgId && regex.test(tvgId)) ||
      (title && regex.test(title)) ||
      (fullTitle && regex.test(fullTitle)) ||
      (id && regex.test(id))
    )
  })

  console.log(`Filtered down to ${filteredStreams.count()} matching streams.`)

  if (filteredStreams.count() === 0) {
    console.warn('Warning: No channels matched your selected list!')
  }

  // Map and sort streams, assign group titles based on categories
  const processedStreams = filteredStreams
    .sortBy(stream => stream.title)
    .map((stream: Stream) => {
      try {
        const categories = stream.getCategories()
        if (categories && typeof categories.map === 'function') {
          const groupTitle = categories
            .map(category => category.name)
            .sort()
            .join(';')
          if (groupTitle) {
            stream.groupTitle = groupTitle
          }
        }
      } catch (err) {
        // Fallback if categories data isn't loaded
      }
      return stream
    })

  const playlist = new Playlist(processedStreams, { public: true })
  
  const outputPath = path.join(__dirname, 'custom.m3u')
  fs.writeFileSync(outputPath, playlist.toString())
  console.log(`Successfully generated custom playlist with ${processedStreams.count()} streams at: ${outputPath}`)

  console.log('Testing streams status...')
  const streamsArray = Array.isArray(processedStreams) ? processedStreams : (processedStreams as any).all()
  const results: any[] = []

  await new Promise<void>((resolve) => {
    eachLimit(
      streamsArray,
      15, // Test 15 streams concurrently
      async (stream: Stream) => {
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
