export function logGep(message: string, data?: unknown): void {
  if (data === undefined) {
    console.log(message)
    return
  }

  try {
    console.log(`${message} ${JSON.stringify(data)}`)
  } catch {
    console.log(message, data)
  }
}
