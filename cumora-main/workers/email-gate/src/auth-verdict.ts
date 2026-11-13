/**
 * Decide whether Cloudflare Email Routing authenticated the sender.
 *
 * The sender can put `Authentication-Results` in the message they transmit.
 * Cloudflare prepends its own, with authserv-id `mx.cloudflare.net`, and a
 * forger can claim that same id. This trusts the header only when exactly
 * one record carries that id. Zero means nothing authenticated the message.
 * Two means we cannot tell Cloudflare's record from a copy, so the message
 * stays unaligned.
 *
 * A method counts as pass only when its result word is exactly `pass`.
 * `passfail`, `pass-not-really`, and `pass/fail` do not. `dmarc=pass` inside
 * a comment does not either. Any DMARC result other than pass, including
 * `fail` and `none`, stays unaligned. SPF and DKIM are consulted only when
 * the record has no DMARC method at all, and then both must be pass.
 */
export const CLOUDFLARE_AUTHSERV_ID = 'mx.cloudflare.net'

export type InboundAuthVerdict = 'aligned' | 'unaligned'

interface AuthRecord {
  id: string
  methods: Map<string, string[]>
}

type HeaderSource = Headers | Array<{ key: string; value: string }> | undefined | null

export function deriveAuthVerdict(headers: HeaderSource): InboundAuthVerdict {
  const trusted = trustedRecords(headers)
  if (trusted.length !== 1) return 'unaligned'
  return recordAligned(trusted[0]) ? 'aligned' : 'unaligned'
}

function trustedRecords(headers: HeaderSource): AuthRecord[] {
  const records: AuthRecord[] = []
  for (const value of headerValues(headers, 'authentication-results')) {
    for (const part of splitRecords(normalizeAuthHeader(value))) {
      const record = parseRecord(part)
      if (record) records.push(record)
    }
  }
  return records.filter((record) => record.id === CLOUDFLARE_AUTHSERV_ID)
}

function headerValues(headers: HeaderSource, name: string): string[] {
  if (!headers) return []
  const want = name.toLowerCase()
  if (Array.isArray(headers)) {
    return headers.filter((header) => header.key.toLowerCase() === want).map((header) => header.value)
  }
  const values: string[] = []
  headers.forEach((value, key) => {
    if (key.toLowerCase() === want) values.push(value)
  })
  return values
}

/** Drop RFC 5322 comments so a parenthetical `dmarc=pass` cannot satisfy the check. */
function stripComments(input: string): string {
  let out = ''
  let quote = false
  let depth = 0
  let escaped = false
  for (const ch of input) {
    if (escaped) {
      if (depth === 0) out += ch
      escaped = false
      continue
    }
    if (ch === '\\') {
      escaped = true
      if (depth === 0 && quote) out += ch
      continue
    }
    if (quote) {
      if (ch === '"') quote = false
      if (depth === 0) out += ch
      continue
    }
    if (ch === '"') {
      quote = true
      if (depth === 0) out += ch
      continue
    }
    if (ch === '(') {
      depth += 1
      continue
    }
    if (ch === ')' && depth > 0) {
      depth -= 1
      continue
    }
    if (depth === 0) out += ch
  }
  return out
}

function normalizeAuthHeader(value: string): string {
  return stripComments(value).replace(/[\r\n\t ]+/g, ' ').trim()
}

/**
 * A Fetch `Headers` object joins repeated fields with ", ". A new
 * Authentication-Results record then looks like ", mx.cloudflare.net;".
 * Require a dot in that id so a comma inside a property value does not split
 * the record.
 */
function splitRecords(normalized: string): string[] {
  if (!normalized) return []
  return normalized
    .split(/,\s*(?=[A-Za-z0-9.-]*\.[A-Za-z0-9.-]+\s*(?:\d+\s*)?;)/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function parseRecord(value: string): AuthRecord | null {
  const parts = value.split(';').map((part) => part.trim()).filter(Boolean)
  if (parts.length === 0) return null
  const idMatch = /^([A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)\.?(?:\s+\d+)?$/.exec(parts[0])
  if (!idMatch) return null
  const methods = new Map<string, string[]>()
  for (const part of parts.slice(1)) {
    const method = /^([A-Za-z0-9]+)\s*=\s*(\S+)/.exec(part)
    if (!method) continue
    const name = method[1].toLowerCase()
    const result = method[2].replace(/[;,]+$/, '').toLowerCase()
    const existing = methods.get(name)
    if (existing) existing.push(result)
    else methods.set(name, [result])
  }
  return { id: idMatch[1].toLowerCase(), methods }
}

/** Every result word is exactly `pass`. An empty list, or any other word, is not. */
function exactlyPass(results: string[] | undefined): boolean {
  return !!results && results.length > 0 && results.every((result) => result === 'pass')
}

function recordAligned(record: AuthRecord): boolean {
  const dmarc = record.methods.get('dmarc') ?? []
  if (dmarc.length > 0) return exactlyPass(dmarc)
  return exactlyPass(record.methods.get('spf')) && exactlyPass(record.methods.get('dkim'))
}
