import { describe, expect, it, vi } from 'vitest'
import { handleMixtapeManagement, handleRequest } from './index.js'

const owner = (email = 'crashbeats08@gmail.com', emailVerified = true) =>
  async () => ({ user: { id: 'owner', email, emailVerified } })

function database() {
  const queries = []
  return {
    queries,
    prepare(sql) {
      queries.push(sql)
      return {
        bind() { return this },
        async first() {
          if (sql.includes('RETURNING "count"')) return { count: 1 }
          if (sql.includes('FROM tracks WHERE id')) {
            return { id: 'song-1', mixtape_id: 'tape-a', sort_order: 0, object_key: 'catalog/song-1.mp3' }
          }
          if (sql.includes('FROM mixtapes WHERE id')) return { id: 'tape-b' }
          return null
        },
        async all() { return { results: [] } },
        async run() { return { meta: { changes: 1 } } },
      }
    },
    async batch(statements) { return statements },
  }
}

describe('mixtape management permissions and edits', () => {
  it('keeps an emptied mixtape visible in the public catalog', async () => {
    const row = {
      mixtape_id: 'tape-a', mixtape_title: 'Soft', mixtape_subtitle: '',
      catalog: 'CB-001', side: 'A', accent: '#fff', accent2: '#000', ink: '#333',
      track_id: null,
    }
    const response = await handleRequest(new Request('https://crash-beats.com/api/catalog'), {
      DB: { prepare: () => ({ all: async () => ({ results: [row] }) }) },
    }, {})
    expect((await response.json()).mixtapes).toMatchObject([{ id: 'tape-a', tracks: [] }])
  })

  it('conceals controls from guests, unverified owners, and other accounts', async () => {
    for (const authenticate of [async () => null, owner('crashbeats08@gmail.com', false), owner('someone@gmail.com')]) {
      const DB = database()
      const response = await handleMixtapeManagement(
        new Request('https://crash-beats.com/api/manage/mixtapes'), { DB }, authenticate,
      )
      expect(response.status).toBe(404)
      expect(DB.queries).toHaveLength(0)
    }
  })

  it('allows both verified owners and returns a private mixtape list', async () => {
    for (const email of ['crashbeats08@gmail.com', 'ewoodthomas@gmail.com']) {
      const response = await handleMixtapeManagement(
        new Request('https://crash-beats.com/api/manage/mixtapes'),
        { DB: database() }, owner(email),
      )
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect((await response.json()).mixtapes).toEqual([])
    }
  })

  it('rejects cross-origin writes before touching storage', async () => {
    const DB = database()
    const response = await handleMixtapeManagement(new Request('https://crash-beats.com/api/manage/tracks/song-1', {
      method: 'DELETE', headers: { origin: 'https://elsewhere.example' },
    }), { DB }, owner())
    expect(response.status).toBe(403)
    expect(DB.queries).toHaveLength(0)
  })

  it('moves songs between mixtapes and hides deleted songs while retaining their ledger row', async () => {
    const DB = database()
    const AUDIO = { delete: vi.fn().mockResolvedValue(undefined) }
    const moved = await handleMixtapeManagement(new Request('https://crash-beats.com/api/manage/tracks/song-1', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mixtapeId: 'tape-b' }),
    }), { DB, AUDIO }, owner())
    expect(moved.status).toBe(200)
    expect(DB.queries.some((sql) => sql.includes('UPDATE tracks SET mixtape_id'))).toBe(true)

    const deleted = await handleMixtapeManagement(new Request('https://crash-beats.com/api/manage/tracks/song-1', {
      method: 'DELETE',
    }), { DB, AUDIO }, owner())
    expect(deleted.status).toBe(200)
    expect(DB.queries.some((sql) => sql.includes('SET is_published = 0'))).toBe(true)
    expect(AUDIO.delete).toHaveBeenCalledWith('catalog/song-1.mp3')
  })

  it('validates and stores an MP3 upload in the chosen mixtape', async () => {
    const frames = new Uint8Array(838)
    frames.set([0xff, 0xfb, 0x90, 0x64], 0)
    frames.set([0xff, 0xfb, 0x90, 0x64], 417)
    const form = new FormData()
    form.set('song', new File([frames], 'New Beat.mp3', { type: 'audio/mpeg' }))
    const DB = database()
    const AUDIO = { put: vi.fn().mockResolvedValue(undefined) }
    const response = await handleMixtapeManagement(new Request('https://crash-beats.com/api/manage/mixtapes/tape-b/tracks', {
      method: 'POST', body: form,
    }), { DB, AUDIO }, owner())
    expect(response.status).toBe(201)
    expect(DB.queries.some((sql) => sql.includes('INSERT INTO tracks'))).toBe(true)
    expect(AUDIO.put).toHaveBeenCalledOnce()
  })
})
