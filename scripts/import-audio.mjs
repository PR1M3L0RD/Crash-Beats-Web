import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import ffmpegPath from 'ffmpeg-static'
import yauzl from 'yauzl'
import { mixtapes } from '../src/data/mixtapes.js'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const wranglerBin = path.join(projectRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
const remote = process.argv.includes('--remote')
const keepTemp = process.argv.includes('--keep-temp')
const storageBudgetBytes = 9_000_000_000
const bucketName = 'crash-beats-audio'
const databaseName = 'crash-beats-db'

if (!remote && !process.argv.includes('--local')) {
  throw new Error('Choose a target explicitly: npm run audio:import -- --remote (or --local).')
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    if (options.capture) {
      child.stdout.on('data', (chunk) => { stdout += chunk })
      child.stderr.on('data', (chunk) => { stderr += chunk })
    }
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`${path.basename(command)} exited ${code}\n${stderr || stdout}`))
    })
  })
}

function runWrangler(args, options) {
  return run(process.execPath, [wranglerBin, ...args], options)
}

function sql(value) {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return String(value)
  return `'${String(value).replaceAll("'", "''")}'`
}

async function getRemoteState() {
  const target = remote ? '--remote' : '--local'
  const { stdout } = await runWrangler([
    'd1', 'execute', databaseName, target, '--json', '--command',
    `SELECT id, byte_size FROM tracks WHERE is_published = 1
     UNION ALL
     SELECT id, byte_size FROM submission_tracks;`,
  ], { capture: true })
  const payload = JSON.parse(stdout)
  const rows = payload.flatMap((result) => result.results || [])
  return {
    publishedIds: new Set(rows.map((row) => row.id)),
    usedBytes: rows.reduce((total, row) => total + Number(row.byte_size || 0), 0),
  }
}

async function reserveStorage(id, byteSize) {
  const target = remote ? '--remote' : '--local'
  const { stdout } = await runWrangler([
    'd1', 'execute', databaseName, target, '--json', '--command',
    `INSERT INTO audio_storage_reservations (id, byte_size, purpose)
     SELECT ${sql(id)}, ${byteSize}, 'catalog_import'
     WHERE (
       (SELECT COALESCE(SUM(byte_size), 0) FROM tracks) +
       (SELECT COALESCE(SUM(byte_size), 0) FROM submission_tracks) +
       (SELECT COALESCE(SUM(preview_byte_size + full_byte_size), 0) FROM store_beats) +
       (SELECT COALESCE(SUM(byte_size), 0) FROM audio_storage_reservations) + ${byteSize}
     ) <= ${storageBudgetBytes};
     SELECT COUNT(*) AS reserved FROM audio_storage_reservations WHERE id = ${sql(id)};`,
  ], { capture: true })
  const payload = JSON.parse(stdout)
  const rows = payload.flatMap((result) => result.results || [])
  return Number(rows.at(-1)?.reserved || 0) === 1
}

async function releaseStorage(id) {
  await runWrangler([
    'd1', 'execute', databaseName, remote ? '--remote' : '--local', '--command',
    `DELETE FROM audio_storage_reservations WHERE id = ${sql(id)};`,
  ], { capture: true })
}

async function cleanupUploadedObjects(keys) {
  const results = await Promise.allSettled(keys.map((key) => runWrangler([
    'r2', 'object', 'delete', `${bucketName}/${key}`, remote ? '--remote' : '--local', '--force',
  ], { capture: true })))
  return results.every((result) => result.status === 'fulfilled')
}

function openZip(zipPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (error, zip) => {
      if (error) reject(error)
      else resolve(zip)
    })
  })
}

function openZipEntry(zip, entry) {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error) reject(error)
      else resolve(stream)
    })
  })
}

async function extractArchive(zipPath, destination) {
  const zip = await openZip(zipPath)
  const extracted = new Map()

  await new Promise((resolve, reject) => {
    zip.on('error', reject)
    zip.on('end', resolve)
    zip.on('entry', async (entry) => {
      try {
        if (/\/$/.test(entry.fileName)) {
          zip.readEntry()
          return
        }
        const relative = entry.fileName.replaceAll('\\', '/')
        const target = path.resolve(destination, relative)
        const safeRoot = `${path.resolve(destination)}${path.sep}`
        if (!target.startsWith(safeRoot)) throw new Error(`Unsafe archive path: ${relative}`)
        await mkdir(path.dirname(target), { recursive: true })
        await pipeline(await openZipEntry(zip, entry), createWriteStream(target))
        extracted.set(relative.toLowerCase(), target)
        zip.readEntry()
      } catch (error) {
        reject(error)
      }
    })
    zip.readEntry()
  })

  zip.close()
  return extracted
}

async function transcodeToMp3(input, output) {
  await mkdir(path.dirname(output), { recursive: true })
  await run(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', input,
    '-map_metadata', '-1', '-codec:a', 'libmp3lame', '-b:a', '192k', output,
  ], { capture: true })
}

function findArchiveFile(extracted, folder, filename) {
  const suffix = `/${folder}/${filename}`.toLowerCase()
  const match = [...extracted.entries()].find(([entry]) => `/${entry}`.endsWith(suffix))
  if (!match) throw new Error(`Missing archive track: ${folder}/${filename}`)
  return match[1]
}

async function mapWithConcurrency(values, concurrency, task) {
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      await task(values[index], index)
    }
  })
  const results = await Promise.allSettled(workers)
  const failure = results.find((result) => result.status === 'rejected')
  if (failure) throw failure.reason
}

function buildCatalogSql(processedTracks, reservationId) {
  const uploadedIds = new Set(processedTracks.map((item) => item.track.id))
  const statements = ['PRAGMA foreign_keys = ON;']

  mixtapes.forEach((mixtape, mixtapeIndex) => {
    const allReady = mixtape.tracks.every((track) => uploadedIds.has(track.id))
    statements.push(
      `INSERT INTO mixtapes
        (id, title, subtitle, catalog, side, accent, accent2, ink, sort_order, is_published)
       VALUES (${[
         mixtape.id, mixtape.title, mixtape.subtitle, mixtape.catalog, mixtape.side,
         mixtape.accent, mixtape.accent2, mixtape.ink,
       ].map(sql).join(', ')}, ${mixtapeIndex}, ${allReady ? 1 : 0})
       ON CONFLICT(id) DO UPDATE SET
         title=excluded.title, subtitle=excluded.subtitle, catalog=excluded.catalog,
         side=excluded.side, accent=excluded.accent, accent2=excluded.accent2,
         ink=excluded.ink, sort_order=excluded.sort_order,
         is_published=excluded.is_published,
         updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now');`,
    )
  })

  processedTracks.forEach(({ mixtape, track, size }) => {
    statements.push(
      `INSERT INTO tracks
        (id, mixtape_id, title, credit, featured_artist, object_key, mime_type, byte_size, sort_order, is_published)
       VALUES (${[
         track.id, mixtape.id, track.title, track.credit, track.featuredArtist,
         track.objectKey, 'audio/mpeg', size, track.sortOrder, 1,
       ].map(sql).join(', ')})
       ON CONFLICT(id) DO UPDATE SET
         mixtape_id=excluded.mixtape_id, title=excluded.title, credit=excluded.credit,
         featured_artist=excluded.featured_artist, object_key=excluded.object_key,
         mime_type=excluded.mime_type, byte_size=excluded.byte_size,
         sort_order=excluded.sort_order, is_published=1,
         updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now');`,
    )
  })

  if (reservationId) {
    statements.push(`DELETE FROM audio_storage_reservations WHERE id = ${sql(reservationId)};`)
  }

  return statements.join('\n')
}

const workDirectory = await mkdtemp(path.join(tmpdir(), 'crash-beats-audio-'))
let storageReservationId = null
const uploadedKeys = []

try {
  const trackCount = mixtapes.reduce((count, tape) => count + tape.tracks.length, 0)
  console.log(`Preparing ${trackCount} tracks...`)
  const archiveTrack = mixtapes
    .flatMap((mixtape) => mixtape.tracks)
    .find((track) => track.source.type === 'archive')
  const extracted = archiveTrack
    ? await extractArchive(
      path.resolve(projectRoot, archiveTrack.source.path),
      path.join(workDirectory, 'archive'),
    )
    : new Map()

  const state = await getRemoteState()
  const prepared = []
  for (const mixtape of mixtapes) {
    for (const track of mixtape.tracks) {
      const sourcePath = track.source.type === 'directory'
        ? path.resolve(projectRoot, track.source.path, track.filename)
        : findArchiveFile(extracted, track.source.folder, track.filename)
      let uploadPath = sourcePath
      if (/\.wav$/i.test(sourcePath)) {
        uploadPath = path.join(workDirectory, 'encoded', `${track.id}.mp3`)
        await transcodeToMp3(sourcePath, uploadPath)
      }
      const details = await stat(uploadPath)
      prepared.push({ mixtape, track, uploadPath, size: details.size })
      console.log(`Prepared ${prepared.length}/${trackCount}: ${track.title}`)
    }
  }

  const bytesToAdd = prepared
    .filter(({ track }) => !state.publishedIds.has(track.id))
    .reduce((total, item) => total + item.size, 0)
  if (state.usedBytes + bytesToAdd > storageBudgetBytes) {
    throw new Error(`Import exceeds the ${storageBudgetBytes}-byte R2 safety budget.`)
  }

  const pendingUploads = prepared.filter(({ track }) => !state.publishedIds.has(track.id))
  if (bytesToAdd) {
    storageReservationId = `catalog-${randomUUID()}`
    if (!await reserveStorage(storageReservationId, bytesToAdd)) {
      throw new Error(`Import could not reserve ${bytesToAdd} bytes inside the R2 safety budget.`)
    }
  }
  let uploaded = 0
  await mapWithConcurrency(pendingUploads, 3, async ({ track, uploadPath }) => {
    await runWrangler([
      'r2', 'object', 'put', `${bucketName}/${track.objectKey}`,
      remote ? '--remote' : '--local', '--file', uploadPath,
      '--content-type', 'audio/mpeg', '--cache-control', 'public, max-age=31536000, immutable',
      '--force',
    ], { capture: true })
    uploadedKeys.push(track.objectKey)
    uploaded += 1
    console.log(`Uploaded ${uploaded}/${pendingUploads.length}: ${track.title}`)
  })

  const migrationPath = path.join(workDirectory, 'catalog.sql')
  await writeFile(migrationPath, buildCatalogSql(prepared, storageReservationId), 'utf8')
  await runWrangler([
    'd1', 'execute', databaseName, remote ? '--remote' : '--local',
    '--file', migrationPath, '--yes',
  ])
  storageReservationId = null

  const totalBytes = prepared.reduce((total, item) => total + item.size, 0)
  console.log(`Audio import complete: ${prepared.length} tracks, ${(totalBytes / 1024 / 1024).toFixed(1)} MiB.`)
  console.log(`Safety-budget headroom: ${((storageBudgetBytes - state.usedBytes - bytesToAdd) / 1024 / 1024 / 1024).toFixed(2)} GiB.`)
} catch (error) {
  if (storageReservationId) {
    const cleaned = await cleanupUploadedObjects(uploadedKeys)
    if (cleaned) await releaseStorage(storageReservationId)
    else console.error(`R2 cleanup was incomplete; reservation ${storageReservationId} was retained for safety.`)
  }
  throw error
} finally {
  if (keepTemp) console.log(`Temporary files kept at ${workDirectory}`)
  else await rm(workDirectory, { recursive: true, force: true })
}
