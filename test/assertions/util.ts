import test from 'ava'
import { SelvaClient } from '../../src/index'

export const wait = (timeMs: number = 500): Promise<void> =>
  new Promise(r => setTimeout(r, timeMs))

export const idExists = async (
  client: SelvaClient,
  id: string,
  dump?: any[]
): Promise<boolean> => {
  if (!dump) dump = await dumpDb(client)
  for (let key in dump) {
    if (key === id) {
      return true
    }
    if (dump[key] === id) {
      return true
    }
    if (
      typeof dump[key] === 'string' &&
      dump[key].split(',').indexOf(id) !== -1
    ) {
      return true
    }
    if (typeof dump[key] === 'object') {
      if (await idExists(client, id, dump[key])) {
        return true
      }
    }
  }
  return false
}

export const dumpDb = async (client: SelvaClient): Promise<any[]> => {
  const ids = await client.redis.keys('*')
  return (
    await Promise.all(
      ids.map(id =>
        id.indexOf('.') > -1
          ? client.redis.smembers(id)
          : client.redis.hgetall(id)
      )
    )
  ).map((v, i) => {
    return [ids[i], v]
  })
}

export const logDb = async (client: SelvaClient) => {
  console.log(await dumpDb(client))
}
