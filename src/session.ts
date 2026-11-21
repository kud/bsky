export const PDS = "https://bsky.social"

/** The full session as the PDS returns it; the refresh token never leaves this module. */
type StoredSession = {
  accessJwt: string
  refreshJwt: string
  did: string
  handle: string
}

/** The session as exposed to callers, without the long-lived refresh token. */
export type Session = Omit<StoredSession, "refreshJwt">

type Credentials = { handle: string; password: string }

let cached: StoredSession | undefined
let renewing: Promise<StoredSession> | undefined
let credentials: Credentials | undefined

/** Read the credentials from the environment on first use, never at import, so the module has no side effects. */
const readCredentials = (): Credentials => {
  if (credentials) return credentials
  const handle = process.env.BLUESKY_HANDLE
  const password = process.env.BLUESKY_APP_PASSWORD
  if (!handle || !password) {
    throw new Error(
      "Missing credentials. Set BLUESKY_HANDLE and BLUESKY_APP_PASSWORD (an App Password from Bluesky → Settings → App Passwords).",
    )
  }
  credentials = { handle, password }
  return credentials
}

const login = async (): Promise<StoredSession> => {
  const { handle, password } = readCredentials()
  const res = await fetch(`${PDS}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: handle, password }),
  })
  if (!res.ok)
    throw new Error(`Auth failed (${res.status}): ${await res.text()}`)
  cached = (await res.json()) as StoredSession
  return cached
}

const currentSession = async (): Promise<StoredSession> => cached ?? login()

export const getSession = async (): Promise<Session> => {
  const { accessJwt, did, handle } = await currentSession()
  return { accessJwt, did, handle }
}

const refresh = async (stale: StoredSession): Promise<StoredSession> => {
  const res = await fetch(`${PDS}/xrpc/com.atproto.server.refreshSession`, {
    method: "POST",
    headers: { Authorization: `Bearer ${stale.refreshJwt}` },
  })
  if (!res.ok) {
    cached = undefined
    return login()
  }
  cached = (await res.json()) as StoredSession
  return cached
}

/** Renew the session after its access token was rejected; refresh first, re-login if that fails. */
const renewSession = (stale: StoredSession): Promise<StoredSession> => {
  if (cached && cached.accessJwt !== stale.accessJwt)
    return Promise.resolve(cached)
  renewing ??= refresh(stale).finally(() => {
    renewing = undefined
  })
  return renewing
}

const isTokenRejected = async (res: Response): Promise<boolean> => {
  if (res.status !== 400 && res.status !== 401) return false
  try {
    const { error } = JSON.parse(await res.clone().text()) as { error?: string }
    return error === "ExpiredToken" || error === "InvalidToken"
  } catch {
    return false
  }
}

/** fetch with the session's bearer token; on an expired token, renew the session and retry once. */
export const authFetch = async (
  url: string,
  init: RequestInit = {},
): Promise<Response> => {
  const send = (session: StoredSession) =>
    fetch(url, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        Authorization: `Bearer ${session.accessJwt}`,
      },
    })
  const session = await currentSession()
  const res = await send(session)
  if (!(await isTokenRejected(res))) return res
  return send(await renewSession(session))
}

type XrpcOptions = {
  method?: "GET" | "POST"
  params?: Record<string, string | number | undefined>
  body?: unknown
  auth?: boolean
}

export const xrpc = async <T>(
  nsid: string,
  { method = "GET", params, body, auth = true }: XrpcOptions = {},
): Promise<T> => {
  const query = params
    ? "?" +
      new URLSearchParams(
        Object.entries(params)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)]),
      ).toString()
    : ""

  const headers: Record<string, string> = {}
  if (method === "POST") headers["Content-Type"] = "application/json"

  const init: RequestInit = {
    method,
    headers,
    body: method === "POST" ? JSON.stringify(body) : undefined,
  }
  const url = `${PDS}/xrpc/${nsid}${query}`
  const res = auth ? await authFetch(url, init) : await fetch(url, init)
  if (!res.ok)
    throw new Error(`${nsid} failed (${res.status}): ${await res.text()}`)
  return res.json() as Promise<T>
}
