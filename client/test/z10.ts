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
    rootType: {
      fields: {
        menu: { type: 'references' }
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

test.serial('inherit references $list', async t => {
  const client = connect({ port }, { loglevel: 'info' })
  const res = await client.get({
    $id: 'root',
    menu: {
      id: true,
      $list: {
        $inherit: true
      }
    }
  })
  t.deepEqualIgnoreOrder(res, { $isNull: true, menu: [] })
})
