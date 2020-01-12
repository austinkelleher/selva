import test from 'ava'
import { connect, SelvaClient } from '../src/index'
import { start } from 'selva-server'

//  const wait = () => new Promise(r => setTimeout(r, 500))
const idExists = async (
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

const dumpDb = async (client: SelvaClient): Promise<any[]> => {
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

const logDb = async (client: SelvaClient) => {
  console.log(await dumpDb(client))
}

test.before(async t => {
  await start({ port: 6061, modules: ['redisearch'] })
})

test.serial('basic', async t => {
  const client = connect({
    port: 6061
  })

  const match = await client.set({
    type: 'match'
  })

  const league = await client.set({
    type: 'league'
  })

  const person = await client.set({
    type: 'person',
    parents: [match],
    title: { en: 'flurpy man' }
  })

  t.deepEqual(
    await client.redis.smembers(match + '.children'),
    [person],
    'match has correct children'
  )

  t.deepEqual(
    (await client.redis.smembers('root.children')).sort(),
    [league, match].sort(),
    'root has correct children'
  )

  t.deepEqual(
    await client.redis.smembers(league + '.children'),
    [],
    'league has no children'
  )

  t.is(
    await client.redis.hget(person, 'title.en'),
    'flurpy man',
    'Title of person is correctly set'
  )

  t.is(
    await client.redis.hget(match, 'ancestors'),
    'root',
    'match has correct ancestors'
  )

  t.is(
    await client.redis.hget(league, 'ancestors'),
    'root',
    'league has correct ancestors'
  )

  // move person from match to league
  await client.set({
    $id: person,
    parents: [league]
  })

  t.deepEqual(
    await client.redis.smembers(league + '.children'),
    [person],
    'league has person after move'
  )

  t.deepEqual(
    await client.redis.smembers(match + '.children'),
    [],
    'match has no children after move'
  )

  t.is(
    await client.redis.hget(person, 'ancestors'),
    ['root', league].join(','),
    'person has correct ancestors after move'
  )

  // add extra parent using $add
  await client.set({
    $id: person,
    parents: {
      $add: match
    }
  })

  t.deepEqual(
    await client.redis.smembers(match + '.children'),
    [person],
    'match has children after $add'
  )

  t.deepEqual(
    (await client.redis.smembers(person + '.parents')).sort(),
    [league, match].sort(),
    'person has correct parents after $add'
  )

  t.is(
    await client.redis.hget(person, 'ancestors'),
    ['root', league, match].join(','),
    'person has correct ancestors after $add'
  )

  // remove league from person
  await client.set({
    $id: person,
    parents: {
      $delete: league
    }
  })

  t.deepEqual(
    await client.redis.smembers(league + '.children'),
    [],
    'league has no children after $delete'
  )

  t.deepEqual(
    await client.redis.smembers(person + '.parents'),
    [match],
    'person has correct parents after $delete'
  )

  t.is(
    await client.redis.hget(person, 'ancestors'),
    ['root', match].join(','),
    'person has correct ancestors after $delete'
  )

  // add parent again
  await client.set({
    $id: person,
    parents: {
      $add: league
    }
  })

  // double add
  await client.set({
    $id: person,
    parents: {
      $add: league
    }
  })

  t.deepEqual(
    await client.redis.smembers(match + '.children'),
    [person],
    'match has children after 2nd $add'
  )

  t.deepEqual(
    (await client.redis.smembers(person + '.parents')).sort(),
    [league, match].sort(),
    'person has correct parents after 2nd $add'
  )

  t.is(
    await client.redis.hget(person, 'ancestors'),
    ['root', match, league].join(','),
    'person has correct ancestors after 2nd $add'
  )

  // reset children
  await client.set({
    $id: match,
    children: []
  })

  t.deepEqual(
    await client.redis.smembers(match + '.children'),
    [],
    'match has no children after reset'
  )

  t.deepEqual(
    await client.redis.smembers(person + '.parents'),
    [league],
    'person has correct parents after reset of children of match'
  )

  t.is(
    await client.redis.hget(person, 'ancestors'),
    ['root', league].join(','),
    'person has correct ancestors after reset of children of match'
  )

  // add person to match using children
  await client.set({
    $id: match,
    children: [person]
  })

  t.deepEqual(
    await client.redis.smembers(match + '.children'),
    [person],
    'match has children after adding person to match using children'
  )

  t.deepEqual(
    (await client.redis.smembers(person + '.parents')).sort(),
    [league, match].sort(),
    'person has correct parents after adding person to match using children'
  )

  t.is(
    await client.redis.hget(person, 'ancestors'),
    ['root', league, match].join(','),
    'person has correct ancestors after adding person to match using children'
  )

  // add match to league using $add
  await client.set({
    $id: league,
    children: { $add: match }
  })

  t.deepEqual(
    (await client.redis.smembers(match + '.parents')).sort(),
    ['root', league].sort(),
    'match has correct parents after adding match as a child to league'
  )

  t.deepEqual(
    (await client.redis.smembers(league + '.children')).sort(),
    [match, person].sort(),
    'league has correct children after setting ancestors'
  )

  t.is(
    await client.redis.hget(person, 'ancestors'),
    ['root', league, match].join(','),
    'person ancestors is not affected after adding match as a child to league'
  )

  t.is(
    await client.redis.hget(match, 'ancestors'),
    ['root', league].join(','),
    'match has correct ancestors'
  )

  // delete match from league
  await client.set({
    $id: league,
    children: { $delete: match }
  })

  t.deepEqual(
    (await client.redis.smembers(person + '.parents')).sort(),
    [league, match].sort(),
    'person has correct parents after removing match from league'
  )

  t.deepEqual(
    (await client.redis.hget(person, 'ancestors')).split(',').sort(),
    ['root', league, match].sort(),
    'person has correct parents after removing match from league'
  )

  t.deepEqual(
    await client.redis.smembers(match + '.parents'),
    ['root'].sort(),
    'match has correct parents after removing match from league'
  )

  t.is(
    await client.redis.hget(match, 'ancestors'),
    ['root'].join(','),
    'match has correct ancestors after removing match from league'
  )

  // delete person
  await client.delete(person)
  t.false(
    await idExists(client, person),
    'person is removed from db after delete'
  )

  // delete league
  await client.delete(league)
  t.false(
    await idExists(client, league),
    'league is removed from db after delete'
  )

  // delete root
  await client.delete('root')
  t.deepEqual(await dumpDb(client), [])

  await client.destroy()
})

test('deep hierarchy manipulation', async t => {
  const client = connect({
    port: 6061
  })

  await client.set({
    $id: 'cuX',
    children: ['cuA']
  })

  await client.set({
    $id: 'cuA',
    children: ['cuB', 'cuC', 'cuD']
  })

  await client.set({
    $id: 'cuE',
    parents: ['cuD']
  })

  await client.set({
    $id: 'cuD',
    parents: { $add: 'root' }
  })

  t.is(await client.redis.hget('cuB', 'ancestors'), 'root,cuX,cuA')
  t.is(await client.redis.hget('cuC', 'ancestors'), 'root,cuX,cuA')
  t.is(await client.redis.hget('cuD', 'ancestors'), 'root,cuX,cuA')
  t.is(await client.redis.hget('cuE', 'ancestors'), 'root,cuX,cuA,cuD')

  await client.set({
    $id: 'cuD',
    parents: { $delete: 'cuA' }
  })

  t.is(await client.redis.hget('cuD', 'ancestors'), 'root')
  t.is(await client.redis.hget('cuE', 'ancestors'), 'root,cuD')
})

test.serial('$increment, $default', async t => {
  const client = connect({
    port: 6061
  })
  await client.set({
    $id: 'viDingDong',
    value: {
      $default: 100,
      $increment: 10
    }
  })

  t.is(
    await client.redis.hget('viDingDong', 'value'),
    '100',
    'uses default if value does not exist'
  )

  await client.set({
    $id: 'viDingDong',
    value: {
      $default: 100,
      $increment: 10
    }
  })

  t.is(
    await client.redis.hget('viDingDong', 'value'),
    '110',
    'increment if value exists'
  )

  await client.set({
    $id: 'viDingDong',
    title: {
      en: {
        $default: 'title'
      }
    }
  })

  t.is(
    await client.redis.hget('viDingDong', 'title.en'),
    'title',
    'set default'
  )

  await client.set({
    $id: 'viDingDong',
    title: {
      en: {
        $default: 'flurp'
      }
    }
  })

  t.is(
    await client.redis.hget('viDingDong', 'title.en'),
    'title',
    'does not overwrite if value exists'
  )

  await client.delete('root')

  client.destroy()
})

test.serial('$merge = false', async t => {
  const client = connect({
    port: 6061
  })

  await client.set({
    $id: 'arPower',
    title: {
      en: 'flap',
      de: 'flurpels'
    },
    image: {
      thumb: 'x'
    }
  })

  t.is(await client.redis.hget('arPower', 'title.en'), 'flap')
  t.is(await client.redis.hget('arPower', 'title.de'), 'flurpels')

  await client.set({
    $id: 'arPower',
    $merge: false,
    title: {
      de: 'deutschland'
    }
  })

  t.is(await client.redis.hget('arPower', 'title.en'), null)
  t.is(await client.redis.hget('arPower', 'title.de'), 'deutschland')

  await client.set({
    $id: 'arPower',
    title: {
      $merge: false,
      nl: 'nl'
    }
  })

  t.is(await client.redis.hget('arPower', 'title.nl'), 'nl')
  t.is(await client.redis.hget('arPower', 'title.de'), null)

  await client.set({
    $id: 'arPower',
    image: {
      $merge: false,
      poster: 'x'
    }
  })

  t.is(await client.redis.hget('arPower', 'image.thumb'), null)

  await client.delete('root')
})

// test.serial('Reference field', async t => {
//   const client = connect({
//     port: 6061
//   })

//   client.set({
//     $id: 'cuA',
//     layout: {
//       match: { components: [{ type: 'List', props: { x: true } }] },
//       custom: { $field: 'layout.match' },
//       video: { $field: 'layout.$type' }
//     }
//   })

//   await client.delete('root')
// })