import test from 'ava'
import { connect } from '../src/index'
import { start } from '@saulx/selva-server'
import './assertions'
import { wait } from './assertions'
import getPort from 'get-port'

let srv
let port: number
test.before(async t => {
  port = await getPort()
  srv = await start({
    port
  })
  const client = connect({ port })
  await client.updateSchema({
    languages: ['en'],
    rootType: {
      fields: { yesh: { type: 'string' }, no: { type: 'string' } }
    },
    types: {
      thing: {
        prefix: 'th'
      }
    }
  })
})

test.after(async _t => {
  const client = connect({ port })
  const d = Date.now()
  await client.delete('root')
  console.log('removed', Date.now() - d, 'ms')
  await client.destroy()
  await srv.destroy()
})

test.serial('subscription $rawAncestors', async t => {
  const client = connect(
    {
      port
    },
    { loglevel: 'info' }
  )

  let setObj: Record<string, any> = {
    type: 'thing',
    $id: 'th0'
  }
  let nested = setObj
  for (let i = 1; i < 20; i++) {
    const newChild = {
      type: 'thing',
      $id: 'th' + i
    }
    nested.children = [newChild]
    nested = newChild
  }

  await client.set(setObj)

  const item = await client.get({
    $id: 'th0',
    children: true
  })

  t.deepEqualIgnoreOrder(item.children, ['th1'])

  //   const obs = await client.observe({
  //     $id: match,
  //     $rawAncestors: true
  //   })
  //   let cnt = 0
  //   const sub = obs.subscribe(d => {
  //     cnt++
  //     console.log('FLURPY GO!', cnt, d)
  //   })

  // observe

  t.true(true)
})
