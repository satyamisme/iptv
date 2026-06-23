import { Storage } from '@freearhey/storage-js'
import { PlaylistParser, StreamTester } from '../scripts/core'
import { Stream, Playlist } from '../scripts/models'
import { loadData } from '../scripts/api'
import { STREAMS_DIR } from '../scripts/constants'
import fs from 'node:fs'
import path from 'node:path'
import { eachLimit } from 'async'

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

  // Filter the streams collection
  const filteredStreams = streams.filter((stream: Stream) => {
    const tvgId = stream.getTvgId()
    const title = stream.title
    const fullTitle = stream.getFullTitle()
    const id = stream.getId()

    return lines.some(rule => {
      // 1. Check for regex format (e.g. /regex/)
      if (rule.startsWith('/') && rule.endsWith('/')) {
        try {
          const pattern = rule.slice(1, -1)
          const regex = new RegExp(pattern, 'i')
          return (
            (tvgId && regex.test(tvgId)) ||
            (title && regex.test(title)) ||
            (fullTitle && regex.test(fullTitle)) ||
            (id && regex.test(id))
          )
        } catch (e) {
          console.error(`Invalid regex rule: ${rule}`, e)
          return false
        }
      }

      // 2. Exact match check (including base-id matching by splitting at @)
      return (
        tvgId === rule ||
        id === rule ||
        title === rule ||
        fullTitle === rule ||
        (tvgId && tvgId.split('@')[0] === rule) ||
        (id && id.split('@')[0] === rule)
      )
    })
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
  const tester = new StreamTester({
    options: {
      timeout: 5000, // 5 seconds timeout
      proxy: undefined
    }
  })

  const streamsArray = Array.isArray(processedStreams) ? processedStreams : (processedStreams as any).all()
  const results: any[] = []

  await new Promise<void>((resolve) => {
    eachLimit(
      streamsArray,
      10, // Test 10 streams concurrently
      async (stream: Stream) => {
        try {
          const res = await tester.test(stream)
          results.push({
            name: stream.title,
            id: stream.getId(),
            tvg_id: stream.getTvgId(),
            url: stream.url,
            status: res.status.code,
            working: res.status.ok,
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
  for (const r of results) {
    const statusIcon = r.working ? '✅' : '❌'
    mdContent += `| ${statusIcon} | ${r.name} | ${r.tvg_id || 'N/A'} | \`${r.url}\` | ${r.status} |\n`
  }
  fs.writeFileSync(statusMdPath, mdContent)
  console.log(`Saved stream status Markdown at: ${statusMdPath}`)
}

main().catch(err => {
  console.error('Fatal error during custom playlist generation:', err)
  process.exit(1)
})
