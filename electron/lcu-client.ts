import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import type { ClientApiResponse } from '../src/platform/types'

// Read-only access to the Riot League client's local API (LCU), which also hosts TFT lobbies.
// Only GET requests on an allowlist; never anything that changes client or game state.

const REQUEST_TIMEOUT_MS = 4000
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024
const RIOT_METADATA_DIR = 'C:/ProgramData/Riot Games/Metadata'
// Products whose install folder may hold the client's lockfile (standalone TFT from 2026-11-03)
const RIOT_PRODUCTS = ['league_of_legends.live', 'teamfighttactics.live']
const DEFAULT_INSTALL_DIRS = ['C:/Riot Games/League of Legends']

const ALLOWED_PATH_PATTERNS = [
  /^\/lol-gameflow\/v1\/gameflow-phase$/,
  /^\/lol-gameflow\/v1\/session$/,
  /^\/lol-summoner\/v1\/current-summoner$/,
  /^\/lol-end-of-game\/v1\/tft-eog-stats$/,
  /^\/lol-match-history\/v1\/products\/tft\/[A-Za-z0-9_-]+\/matches(\?begin=\d+&count=\d+)?$/,
]

// Riot's self-signed "LoL Game Engineering Certificate Authority" (valid 2013-12-04 to 2043-11-27,
// SHA-256 CA:8C:9D:32:...:4E:A3). It signs the LCU certificate, whose SAN covers 127.0.0.1.
const RIOT_LCU_CA = `-----BEGIN CERTIFICATE-----
MIIEIDCCAwgCCQDJC+QAdVx4UDANBgkqhkiG9w0BAQUFADCB0TELMAkGA1UEBhMC
VVMxEzARBgNVBAgTCkNhbGlmb3JuaWExFTATBgNVBAcTDFNhbnRhIE1vbmljYTET
MBEGA1UEChMKUmlvdCBHYW1lczEdMBsGA1UECxMUTG9MIEdhbWUgRW5naW5lZXJp
bmcxMzAxBgNVBAMTKkxvTCBHYW1lIEVuZ2luZWVyaW5nIENlcnRpZmljYXRlIEF1
dGhvcml0eTEtMCsGCSqGSIb3DQEJARYeZ2FtZXRlY2hub2xvZ2llc0ByaW90Z2Ft
ZXMuY29tMB4XDTEzMTIwNDAwNDgzOVoXDTQzMTEyNzAwNDgzOVowgdExCzAJBgNV
BAYTAlVTMRMwEQYDVQQIEwpDYWxpZm9ybmlhMRUwEwYDVQQHEwxTYW50YSBNb25p
Y2ExEzARBgNVBAoTClJpb3QgR2FtZXMxHTAbBgNVBAsTFExvTCBHYW1lIEVuZ2lu
ZWVyaW5nMTMwMQYDVQQDEypMb0wgR2FtZSBFbmdpbmVlcmluZyBDZXJ0aWZpY2F0
ZSBBdXRob3JpdHkxLTArBgkqhkiG9w0BCQEWHmdhbWV0ZWNobm9sb2dpZXNAcmlv
dGdhbWVzLmNvbTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAKoJemF/
6PNG3GRJGbjzImTdOo1OJRDI7noRwJgDqkaJFkwv0X8aPUGbZSUzUO23cQcCgpYj
21ygzKu5dtCN2EcQVVpNtyPuM2V4eEGr1woodzALtufL3Nlyh6g5jKKuDIfeUBHv
JNyQf2h3Uha16lnrXmz9o9wsX/jf+jUAljBJqsMeACOpXfuZy+YKUCxSPOZaYTLC
y+0GQfiT431pJHBQlrXAUwzOmaJPQ7M6mLfsnpHibSkxUfMfHROaYCZ/sbWKl3lr
ZA9DbwaKKfS1Iw0ucAeDudyuqb4JntGU/W0aboKA0c3YB02mxAM4oDnqseuKV/CX
8SQAiaXnYotuNXMCAwEAATANBgkqhkiG9w0BAQUFAAOCAQEAf3KPmddqEqqC8iLs
lcd0euC4F5+USp9YsrZ3WuOzHqVxTtX3hR1scdlDXNvrsebQZUqwGdZGMS16ln3k
WObw7BbhU89tDNCN7Lt/IjT4MGRYRE+TmRc5EeIXxHkQ78bQqbmAI3GsW+7kJsoO
q3DdeE+M+BUJrhWorsAQCgUyZO166SAtKXKLIcxa+ddC49NvMQPJyzm3V+2b1roP
SvD2WV8gRYUnGmy/N0+u6ANq5EsbhZ548zZc+BI4upsWChTLyxt2RxR7+uGlS1+5
EcGfKZ+g024k/J32XP4hdho7WYAS2xMiV83CfLR/MNi8oSMaVQTdKD8cpgiWJk3L
XWehWA==
-----END CERTIFICATE-----
`

interface LockfileInfo {
  port: number
  password: string
  source: string
}

export function isAllowedClientApiPath(apiPath: string): boolean {
  return ALLOWED_PATH_PATTERNS.some(pattern => pattern.test(apiPath))
}

function readInstallDirFromMetadata(product: string): string | null {
  try {
    const settingsPath = path.join(RIOT_METADATA_DIR, product, `${product}.product_settings.yaml`)
    const match = /^product_install_full_path:\s*"([^"]+)"/m.exec(fs.readFileSync(settingsPath, 'utf8'))
    return match?.[1] ?? null
  } catch {
    return null
  }
}

// Lockfile format: <process>:<pid>:<port>:<password>:<protocol>
function parseLockfile(content: string, source: string): LockfileInfo | null {
  const [, , portText, password, protocol] = content.trim().split(':')
  const port = Number(portText)
  if (!Number.isInteger(port) || port <= 0 || !password || protocol !== 'https') return null
  return { port, password, source }
}

export class LcuClient {
  private readonly installDirs: string[]
  private lastLockfileSource: string | null = null

  constructor(configuredInstallDirs: string[]) {
    const metadataDirs = RIOT_PRODUCTS.map(readInstallDirFromMetadata).filter((dir): dir is string => dir !== null)
    this.installDirs = [...new Set([...configuredInstallDirs, ...metadataDirs, ...DEFAULT_INSTALL_DIRS])]
    console.log('Riot client install dirs:', this.installDirs)
  }

  // The lockfile only exists while the client runs; re-read it on every request (port changes per launch)
  private findLockfile(): LockfileInfo | null {
    for (const dir of this.installDirs) {
      const lockfilePath = path.join(dir, 'lockfile')
      try {
        const info = parseLockfile(fs.readFileSync(lockfilePath, 'utf8'), lockfilePath)
        if (info) {
          if (info.source !== this.lastLockfileSource) {
            this.lastLockfileSource = info.source
            console.log('Riot client lockfile found:', { path: info.source, port: info.port })
          }
          return info
        }
      } catch {
        // Not running from this folder
      }
    }
    if (this.lastLockfileSource !== null) {
      this.lastLockfileSource = null
      console.log('Riot client lockfile gone')
    }
    return null
  }

  // null: client not running or unreachable
  get(apiPath: string): Promise<ClientApiResponse | null> {
    if (!isAllowedClientApiPath(apiPath)) {
      console.warn('Blocked client API path:', apiPath)
      return Promise.resolve(null)
    }
    const lockfile = this.findLockfile()
    if (!lockfile) return Promise.resolve(null)

    return new Promise((resolve) => {
      const request = https.request({
        host: '127.0.0.1',
        port: lockfile.port,
        path: apiPath,
        method: 'GET',
        ca: RIOT_LCU_CA,
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          Authorization: `Basic ${Buffer.from(`riot:${lockfile.password}`).toString('base64')}`,
          Accept: 'application/json',
        },
      }, (response) => {
        const chunks: Buffer[] = []
        let size = 0
        response.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > MAX_RESPONSE_BYTES) {
            request.destroy()
            return
          }
          chunks.push(chunk)
        })
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let data: unknown = null
          try {
            data = text ? JSON.parse(text) : null
          } catch {
            data = null
          }
          resolve({ status: response.statusCode ?? 0, data })
        })
      })
      request.on('timeout', () => request.destroy(new Error('timeout')))
      request.on('error', () => resolve(null))
      request.end()
    })
  }
}
