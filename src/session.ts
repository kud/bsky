export const PDS = "https://bsky.social"

const HANDLE = process.env.BLUESKY_HANDLE
const APP_PASSWORD = process.env.BLUESKY_APP_PASSWORD

export type Session = {
  accessJwt: string
  refreshJwt: string
  did: string
  handle: string
}

let cached: Session | undefined
let renewing: Promise<Session> | undefined

const login = async (): Promise<Session> => {
  if (!HANDLE || !APP_PASSWORD) {
    throw new Error(
      "Missing credentials. Set BLUESKY_HANDLE and BLUESKY_APP_PASSWORD (an App Password from Bluesky → Settings → App Passwords).",
    )
  }
  const res = await fetch(`${PDS}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: HANDLE, password: APP_PASSWORD }),
  })
  if (!res.ok)
    throw new Error(`Auth failed (${res.status}): ${await res.text()}`)
  cached = (await res.json()) as Session
  return cached
}

export const getSession = async (): Promise<Session> => cached ?? login()

const refresh = async (stale: Session): Promise<Session> => {
  const res = await fetch(`${PDS}/xrpc/com.atproto.server.refreshSession`, {
    method: "POST",
    headers: { Authorization: `Bearer ${stale.refreshJwt}` },
  })
  if (!res.ok) {
    cached = undefined
    return login()
  }
  cached = (await res.json()) as Session
  return cached
}

/** Renew the session after its access token was rejected; refresh first, re-login if that fails. */
const renewSession = (stale: Session): Promise<Session> => {
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
  const send = (session: Session) =>
    fetch(url, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        Authorization: `Bearer ${session.accessJwt}`,
      },
    })
  const session = await getSession()
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
