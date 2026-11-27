import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export class ConsentStore {
  #path: string
  #keys: Set<string>

  constructor (path: string) {
    this.#path = path
    this.#keys = new Set(readKeys(path))
  }

  has (guildId: string, userId: string): boolean {
    return this.#keys.has(key(guildId, userId))
  }

  set (guildId: string, userId: string, consented: boolean): void {
    const id = key(guildId, userId)
    if (consented === this.#keys.has(id)) return
    if (consented) this.#keys.add(id)
    else this.#keys.delete(id)
    mkdirSync(dirname(this.#path), { recursive: true })
    const temp = `${this.#path}.tmp`
    writeFileSync(temp, JSON.stringify([...this.#keys].sort()))
    renameSync(temp, this.#path)
  }
}

function key (guildId: string, userId: string): string {
  return `${guildId}:${userId}`
}

function readKeys (path: string): string[] {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as string[]
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}
