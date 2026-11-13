import { pool } from './db/pool.js'
import { CH_STATUS } from './redis.js'
import { enqueueBroadcast, nudgeRealtimeOutbox } from './realtime-outbox.js'

export const BUSY_STATUS_LEASE_MS = 90_000
export const BUSY_STATUS_HEARTBEAT_MS = 20_000

type ParticipantStatus = 'avail' | 'working' | 'thinking' | 'waiting' | 'resting'

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

/**
 * Update a participant's status in Postgres and broadcast it. The turn
 * loop, tool executor, and WS presence tracker funnel through here.
 * This is not the only writer: `GET /api/participants` expires a busy
 * lease in SQL and does not publish `CH_STATUS`, so clients learn about
 * that transition on the next read or a later broadcast.
 *
 * A participant id can map to multiple rows when a human belongs to more
 * than one company (humans share an id across tenants). We update every
 * matching row and emit one CH_STATUS broadcast per company so each
 * tenant's connected clients see the transition.
 */
export async function setStatus(participantId: string, status: ParticipantStatus): Promise<void> {
  // `avail` carries no lease: `status_updated_at` only matters for the busy
  // statuses (routing-election reads it to tell "mid-turn" from "stale"), so
  // re-asserting avail on an already-avail row has nothing to record. Skipping
  // it matters because every BYOA daemon posts avail at the end of every idle
  // poll tick — at fleet scale that was ~180 row writes + Redis fan-outs per
  // second (each fan-out re-resolving the tenant's WS recipients on every
  // replica) to announce a status nobody changed. Busy statuses still always
  // write: a repeat is a lease renewal.
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query<{ company_id: string; status_updated_at: Date }>(
      status === 'avail'
        ? `UPDATE participants
              SET status = $2,
                  status_updated_at = NOW()
            WHERE id = $1 AND status IS DISTINCT FROM $2
            RETURNING company_id, status_updated_at`
        : `UPDATE participants
              SET status = $2,
                  status_updated_at = NOW()
            WHERE id = $1
            RETURNING company_id, status_updated_at`,
      [participantId, status],
    )
    for (const r of rows) {
      await enqueueBroadcast(client, CH_STATUS, {
        type: 'participants.status',
        participantId,
        status,
        statusUpdatedAt: toIso(r.status_updated_at),
        companyId: r.company_id,
      })
    }
    await client.query('COMMIT')
    if (rows.length > 0) nudgeRealtimeOutbox()
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

/** Renew a busy status lease without changing the semantic status. */
export async function heartbeatStatus(participantId: string, status: Extract<ParticipantStatus, 'working' | 'thinking' | 'waiting'>): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query<{ company_id: string; status_updated_at: Date }>(
      `UPDATE participants
          SET status_updated_at = NOW()
        WHERE id = $1 AND status = $2
        RETURNING company_id, status_updated_at`,
      [participantId, status],
    )
    if (rows[0]) {
      await enqueueBroadcast(client, CH_STATUS, {
        type: 'participants.status',
        participantId,
        status,
        statusUpdatedAt: toIso(rows[0].status_updated_at),
        companyId: rows[0].company_id,
      })
    }
    await client.query('COMMIT')
    if (rows[0]) nudgeRealtimeOutbox()
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}
