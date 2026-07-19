import { describe, it, expect } from 'vitest'
import { parsePls } from '@shared/plsParser'

// Guardian tests for the `.pls` parser. The fixtures are real-shaped LiveATC
// playlists (and the messy variants the wild actually produces) so a regression
// in the parse — the very first hop of stream resolution — is caught here rather
// than as a silently-dead stream at 6 a.m. mid-airshow.

describe('parsePls', () => {
  it('parses a canonical LiveATC playlist', () => {
    const pls = [
      '[playlist]',
      'numberofentries=1',
      'File1=http://d.liveatc.net/kosh_twr?nocache=2026071812',
      'Title1=KOSH Twr',
      'Length1=-1',
      'Version=2'
    ].join('\n')
    expect(parsePls(pls)).toEqual({
      url: 'http://d.liveatc.net/kosh_twr?nocache=2026071812',
      title: 'KOSH Twr'
    })
  })

  it('tolerates CRLF line endings', () => {
    const pls = '[playlist]\r\nFile1=http://d.liveatc.net/kosh6\r\nTitle1=ATIS\r\n'
    expect(parsePls(pls)).toEqual({ url: 'http://d.liveatc.net/kosh6', title: 'ATIS' })
  })

  it('returns a null title when Title1 is missing', () => {
    const pls = '[playlist]\nnumberofentries=1\nFile1=http://d.liveatc.net/kosh_guard\n'
    expect(parsePls(pls)).toEqual({ url: 'http://d.liveatc.net/kosh_guard', title: null })
  })

  it('keeps `=` characters inside the URL query string (splits on the first `=` only)', () => {
    const pls = 'File1=http://example.net/mount?a=1&b=2&nocache=xyz\nTitle1=Q'
    expect(parsePls(pls).url).toBe('http://example.net/mount?a=1&b=2&nocache=xyz')
  })

  it('strips a leading UTF-8 BOM before the [playlist] header', () => {
    const pls = '\uFEFF[playlist]\nFile1=http://d.liveatc.net/kosh3\nTitle1=Fisk\n'
    expect(parsePls(pls)).toEqual({ url: 'http://d.liveatc.net/kosh3', title: 'Fisk' })
  })

  it('ignores blank and junk lines', () => {
    const pls = [
      '',
      '   ',
      '; a comment-ish stray line',
      'random garbage without an equals sign',
      'File1=http://d.liveatc.net/kosh7',
      '',
      'Title1=Ground'
    ].join('\n')
    expect(parsePls(pls)).toEqual({ url: 'http://d.liveatc.net/kosh7', title: 'Ground' })
  })

  it('is case-insensitive on the FileN / TitleN keys and trims whitespace', () => {
    const pls = 'file1 =  http://d.liveatc.net/kosh2  \ntitle1 = South Tower '
    expect(parsePls(pls)).toEqual({ url: 'http://d.liveatc.net/kosh2', title: 'South Tower' })
  })

  it('picks the lowest-numbered entry when several are present', () => {
    const pls = [
      'File2=http://backup.example.net/mount',
      'Title2=Backup',
      'File1=http://primary.example.net/mount',
      'Title1=Primary'
    ].join('\n')
    expect(parsePls(pls)).toEqual({ url: 'http://primary.example.net/mount', title: 'Primary' })
  })

  it('falls back to a higher-numbered entry when File1 is absent', () => {
    const pls = 'File3=http://only.example.net/mount\nTitle3=Only'
    expect(parsePls(pls)).toEqual({ url: 'http://only.example.net/mount', title: 'Only' })
  })

  it('throws a descriptive error when no FileN entry exists', () => {
    const pls = '[playlist]\nnumberofentries=0\nVersion=2'
    expect(() => parsePls(pls)).toThrow(/File1/)
  })

  it('ignores a FileN line whose value is empty', () => {
    const pls = 'File1=\nFile2=http://d.liveatc.net/kosh4\nTitle2=Air Show'
    expect(parsePls(pls)).toEqual({ url: 'http://d.liveatc.net/kosh4', title: 'Air Show' })
  })
})
