import test from 'ava'
import { connect } from '../src/index'
import { start } from 'selva-server'
import './assertions'
import { wait, dumpDb } from './assertions'

let srv
test.before(async t => {
  srv = await start({
    port: 6090,
    developmentLogging: true,
    loglevel: 'info'
  })

  await wait(500)

  const client = connect({ port: 6090 })
  await client.updateSchema({
    languages: ['en'],
    types: {
      league: {
        prefix: 'le',
        fields: {
          value: { type: 'number', search: { type: ['NUMERIC', 'SORTABLE'] } },
          name: { type: 'string', search: { type: ['TAG'] } }
        }
      },
      match: {
        prefix: 'ma',
        fields: {
          fun: { type: 'set', items: { type: 'string' } },
          related: { type: 'references', search: { type: ['TAG'] } },
          name: { type: 'string', search: { type: ['TAG'] } },
          value: { type: 'number', search: { type: ['NUMERIC', 'SORTABLE'] } },
          status: { type: 'number', search: { type: ['NUMERIC'] } }
        }
      }
    }
  })

  await client.destroy()
})

test.after(async _t => {
  const client = connect({ port: 6090 })
  const d = Date.now()
  await client.delete('root')
  console.log('removed', Date.now() - d, 'ms')
  await client.destroy()
  await srv.destroy()
})

test.serial('find - references', async t => {
  // simple nested - single query
  const client = connect({ port: 6090 })
  const globMatches = []
  const leaguesSet = []
  for (let i = 0; i < 10; i++) {
    const matches = []
    for (let j = 0; j < 10; j++) {
      const match = {
        $id: await client.id({ type: 'match' }),
        type: 'match',
        name: 'match' + j,
        value: Number(i + '.' + j),
        related: globMatches.map(v => v.$id)
      }
      matches.push(match)
      globMatches.push(match)
    }
    leaguesSet.push({
      type: 'league',
      name: 'league' + i,
      value: i,
      children: matches
    })
  }
  await Promise.all(leaguesSet.map(v => client.set(v)))

  const leagues = await client.query({
    id: true,
    name: true,
    value: true,
    $list: {
      $sort: { $field: 'value', $order: 'desc' },
      $find: {
        $traverse: 'descendants',
        $filter: {
          $field: 'type',
          $operator: '=',
          $value: 'league'
        }
      }
    }
  })

  const league = leagues[0].id

  const matches = await client.query({
    $id: league,
    id: true,
    name: true,
    value: true,
    $list: {
      $sort: { $field: 'value', $order: 'desc' },
      $find: {
        $traverse: 'children',
        $filter: [
          {
            $field: 'type',
            $operator: '=',
            $value: 'match'
          },
          {
            $field: 'value',
            $operator: '..',
            $value: [5, 10]
          }
        ]
      }
    }
  })

  const relatedMatches = await client.query({
    $id: matches[0].id,
    name: true,
    value: true,
    $list: {
      $sort: { $field: 'value', $order: 'desc' },
      $find: {
        $traverse: 'related',
        $filter: [
          {
            $field: 'value',
            $operator: '<',
            $value: 4
          },
          {
            $field: 'value',
            $operator: '<',
            $value: 'now'
          },
          {
            $field: 'value',
            $operator: '>',
            $value: 2
          }
        ]
      }
    }
  })

  t.deepEqual(relatedMatches, [
    { value: 4, name: 'match0' },
    { value: 3.9, name: 'match9' },
    { value: 3.8, name: 'match8' },
    { value: 3.7, name: 'match7' },
    { value: 3.6, name: 'match6' },
    { value: 3.5, name: 'match5' },
    { value: 3.4, name: 'match4' },
    { value: 3.3, name: 'match3' },
    { value: 3.2, name: 'match2' },
    { value: 3.1, name: 'match1' },
    { value: 3, name: 'match0' },
    { value: 2.9, name: 'match9' },
    { value: 2.8, name: 'match8' },
    { value: 2.7, name: 'match7' },
    { value: 2.6, name: 'match6' },
    { value: 2.5, name: 'match5' },
    { value: 2.4, name: 'match4' },
    { value: 2.3, name: 'match3' },
    { value: 2.2, name: 'match2' },
    { value: 2.1, name: 'match1' },
    { value: 2, name: 'match0' }
  ])

  const relatedMatchesLeagues = await client.query({
    $id: matches[0].id,
    name: true,
    value: true,
    $list: {
      $find: {
        $traverse: 'related',
        $find: {
          $traverse: 'ancestors',
          $filter: {
            $field: 'type',
            $operator: '=',
            $value: 'league'
          }
        }
      }
    }
  })

  console.log(relatedMatchesLeagues)

  // now nested
})
